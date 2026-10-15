// ─── Supplier invoices v2 ─────────────────────────────────────────────────────
// Invoices arrive from Xero (see xeroRoutes.ts) or are uploaded by hand. Each one
// is stored privately, read by Claude (invoiceReader.ts), matched to a supplier and
// saved with its lines for review. Matching lines to ingredients and approving
// prices is phase 3/4.
//
// Tables: supplier_invoices, supplier_invoice_lines, suppliers (abn, our_account_number, name_aliases)
// Storage: private bucket "supplier-invoices"
import type { Express } from "express";
import multer from "multer";
import crypto from "crypto";
import Anthropic from "@anthropic-ai/sdk";
import supabase from "./supabase";
import { readInvoiceDocument, normaliseInvoice, friendlyReaderError, INVOICE_READER_MODEL, type NormalisedInvoice } from "./invoiceReader";
import { matchLines, unitFactor, type Ingredient, type SupplierProduct } from "./invoiceMatching";

const BUCKET = "supplier-invoices";
const ACCEPTED = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"];
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024, files: 20 } });

const asyncRoute = (fn: any) => (req: any, res: any, next: any) =>
  Promise.resolve(fn(req, res, next)).catch((e: any) => {
    console.error("[invoices] route error:", e?.message || e);
    if (!res.headersSent) res.status(500).json({ error: e?.message || "Internal server error" });
  });

function anthropicClient(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  // Keys not tied to a workspace must name one on every request (ANTHROPIC_WORKSPACE_ID on Railway).
  const ws = process.env.ANTHROPIC_WORKSPACE_ID;
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, ...(ws ? { defaultHeaders: { "anthropic-workspace-id": ws } } : {}) });
}
const canStoreFiles = () => !!process.env.SUPABASE_SERVICE_ROLE_KEY;

// ─── Access: logged in, with Supplier Invoices in their access level (Settings → access levels) ─
export async function requireInvoiceAccess(req: any, res: any, next: any) {
  const staffId = req.session?.staffId;
  if (!staffId) return res.status(401).json({ error: "Please log in" });
  const { data: staff } = await supabase.from("staff").select("name, access_level_id, is_active").eq("id", staffId).single();
  if (!staff?.is_active) return res.status(401).json({ error: "Please log in" });
  const { data: level } = await supabase.from("access_levels").select("pages_json").eq("id", staff.access_level_id).single();
  let pages: string[] = [];
  try { pages = JSON.parse(level?.pages_json || "[]"); } catch {}
  if (!pages.includes("supplier-invoices")) {
    return res.status(403).json({ error: "You don't have access to supplier invoices" });
  }
  req.staffName = staff.name;
  next();
}

// ─── File preparation ────────────────────────────────────────────────────────
export function mimeFromName(name: string, given?: string): string {
  const ext = (name.split(".").pop() || "").toLowerCase();
  const byExt: Record<string, string> = { pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", heic: "image/heic", heif: "image/heif" };
  if (given && ACCEPTED.includes(given)) return given;
  return byExt[ext] || given || "application/octet-stream";
}

/** Photos: turn upright (phone EXIF), shrink to a size Claude reads well, convert to JPEG. PDFs pass through. */
export async function prepareForReader(data: Buffer, mime: string): Promise<{ data: Buffer; mediaType: string }> {
  if (mime === "application/pdf") return { data, mediaType: mime };
  const sharp = (await import("sharp")).default;
  try {
    const out = await sharp(data, { failOn: "none" })
      .rotate()
      .resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 88 })
      .toBuffer();
    return { data: out, mediaType: "image/jpeg" };
  } catch (e: any) {
    if (mime === "image/heic" || mime === "image/heif") throw new Error("This iPhone photo format (HEIC) can't be read. Please upload it as a JPG, or take the photo with the camera set to Most Compatible.");
    throw new Error(`Couldn't open this image: ${e?.message || e}`);
  }
}

// ─── Supplier recognition ────────────────────────────────────────────────────
const digits = (s: any) => String(s || "").replace(/\D/g, "");
function normName(s: any) {
  return String(s || "").toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(pty|ltd|limited|the|australia|wa|perth|wholesale|foods?|co|inc|trading|as|t\/a)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}
const OWN_ABNS = ["93695725038", "90638051313"]; // The Deli's own ABNs

export type SupplierMatch = { supplierId: number | null; method: string | null; suggestion?: { name: string | null; abn: string | null } };

export function matchSupplier(inv: Pick<NormalisedInvoice, "supplier_name" | "supplier_abn" | "our_account_number">, suppliers: any[]): SupplierMatch {
  const abn = digits(inv.supplier_abn);
  if (abn.length === 11 && !OWN_ABNS.includes(abn)) {
    const hit = suppliers.find((s) => digits(s.abn) === abn);
    if (hit) return { supplierId: hit.id, method: "abn" };
  }
  const acct = String(inv.our_account_number || "").trim().replace(/^0+/, "").toLowerCase();
  if (acct) {
    const hit = suppliers.find((s) => s.our_account_number && String(s.our_account_number).trim().replace(/^0+/, "").toLowerCase() === acct);
    if (hit) return { supplierId: hit.id, method: "account_number" };
  }
  const name = normName(inv.supplier_name);
  if (name) {
    const candidates = suppliers.flatMap((s) => [s.name, ...(s.name_aliases || [])].map((n: string) => ({ s, n: normName(n) }))).filter((c) => c.n);
    const exact = candidates.find((c) => c.n === name);
    if (exact) return { supplierId: exact.s.id, method: "name" };
    // One name contains the other ("bidfood malaga" vs "bidfood"), but only on a whole first word
    const partial = candidates.filter((c) => (name.startsWith(c.n + " ") || c.n.startsWith(name + " ") || name === c.n.split(" ")[0]) && c.n.length >= 4);
    const ids = Array.from(new Set(partial.map((c) => c.s.id)));
    if (ids.length === 1) return { supplierId: ids[0], method: "name_partial" };
  }
  return { supplierId: null, method: null, suggestion: { name: inv.supplier_name, abn: abn || null } };
}

// ─── Processing ──────────────────────────────────────────────────────────────
const validDate = (s: any) => (typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s)) ? s : null);

async function setStatus(id: number, status: string, note: string | null, extra: Record<string, any> = {}) {
  await supabase.from("supplier_invoices").update({ status, status_note: note, updated_at: new Date().toISOString(), ...extra }).eq("id", id);
}

/** Read a stored invoice and save its header and lines. Safe to run again (re-read). */
export async function processInvoice(id: number, data: Buffer, mime: string, fileName: string | null): Promise<void> {
  const client = anthropicClient();
  if (!client) { await setStatus(id, "failed", "ANTHROPIC_API_KEY is not set on Railway, so invoices can't be read yet."); return; }
  await setStatus(id, "reading", null);
  try {
    const { data: suppliers } = await supabase.from("suppliers").select("id, name, abn, our_account_number, name_aliases, prices_include_gst");
    const prepared = await prepareForReader(data, mime);
    const { raw, usage, model } = await readInvoiceDocument(client, {
      data: prepared.data, mediaType: prepared.mediaType, fileName: fileName || undefined,
      knownSuppliers: (suppliers || []).map((s: any) => s.name),
    });
    const inv = normaliseInvoice(raw);
    let match = matchSupplier(inv, suppliers || []);
    if (!match.supplierId) {
      const { data: cur } = await supabase.from("supplier_invoices").select("supplier_id, supplier_match_method").eq("id", id).single();
      if (cur?.supplier_id) match = { supplierId: cur.supplier_id, method: cur.supplier_match_method || "previous" };
    }

    // Duplicate? Same supplier and invoice number already saved.
    let status = "needs_review";
    let note: string | null = inv.totals_check_ok === false ? inv.totals_check_note : null;
    if (match.supplierId && inv.invoice_number) {
      const { data: dupes } = await supabase.from("supplier_invoices").select("id, status")
        .eq("supplier_id", match.supplierId).ilike("invoice_number", inv.invoice_number).neq("id", id)
        .not("status", "in", "(failed,duplicate,removed)");
      if (dupes && dupes.length) { status = "duplicate"; note = `Already in the app as invoice #${dupes[0].id}.`; }
    }
    if (status !== "duplicate" && inv.document_type === "order_confirmation") { status = "ignored"; note = "This is an order confirmation, not an invoice."; }
    if (status !== "duplicate" && inv.document_type === "statement") { status = "ignored"; note = "This is a statement, not an invoice."; }
    if (!match.supplierId && status === "needs_review") {
      note = [note, `Supplier not recognised${inv.supplier_name ? `: "${inv.supplier_name}"` : ""}. Pick a supplier or add a new one.`].filter(Boolean).join(" ");
    }

    const header = {
      supplier_id: match.supplierId,
      supplier_match_method: match.method,
      detected_supplier_name: inv.supplier_name,
      detected_abn: digits(inv.supplier_abn) || null,
      document_type: inv.document_type,
      invoice_number: inv.invoice_number,
      invoice_date: validDate(inv.invoice_date),
      subtotal_ex_gst: inv.subtotal_ex_gst,
      gst: inv.gst,
      total_inc_gst: inv.total_inc_gst,
      totals_check_ok: inv.totals_check_ok,
      extraction_json: { raw, normalised: inv },
      reader_model: model,
      reader_input_tokens: usage?.input_tokens ?? null,
      reader_output_tokens: usage?.output_tokens ?? null,
    };
    // The unique (supplier, invoice number) index would reject a duplicate's header,
    // so a duplicate keeps its number only in extraction_json.
    if (status === "duplicate") (header as any).invoice_number = null;

    await supabase.from("supplier_invoice_lines").delete().eq("invoice_id", id);
    if (inv.lines.length) {
      const rows = inv.lines.map((l) => ({
        invoice_id: id, line_no: l.line_no, line_type: l.line_type, supplier_code: l.supplier_code, description: l.description,
        brand: l.brand, quantity: l.quantity, purchase_unit: l.purchase_unit, units_per_purchase: l.units_per_purchase,
        unit_size: l.unit_size, unit_size_uom: l.unit_size_uom, priced_by_weight: l.priced_by_weight,
        unit_price_ex_gst: l.unit_price_ex_gst, discount_ex_gst: l.discount_ex_gst, line_total_ex_gst: l.line_total_ex_gst,
        gst_amount: l.gst_amount, gst_applies: l.gst_applies, base_qty: l.base_qty, unit_cost: l.unit_cost,
        needs_pack_size: l.needs_pack_size, merged_from: l.merged_from, notes: l.notes,
        generic_name: l.generic_name, item_type: l.item_type,
        status: l.line_type === "personal" ? "skipped" : "pending",
      }));
      const { error } = await supabase.from("supplier_invoice_lines").insert(rows);
      if (error) throw new Error(`Saving lines failed: ${error.message}`);
    }
    const { error: hErr } = await supabase.from("supplier_invoices").update({ ...header, status, status_note: note, updated_at: new Date().toISOString() }).eq("id", id);
    if (hErr) throw new Error(`Saving invoice failed: ${hErr.message}`);
    if (status === "needs_review") await runMatching(id);
  } catch (e: any) {
    console.error(`[invoices] reading #${id} failed:`, e?.message || e);
    await setStatus(id, "failed", friendlyReaderError(e));
  }
}

async function storeFile(id: number, data: Buffer, mime: string, fileName: string) {
  if (!canStoreFiles()) return null;
  const safe = fileName.replace(/[^\w.\-]+/g, "_").slice(-80);
  const path = `${new Date().toISOString().slice(0, 7)}/${id}-${safe}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, data, { contentType: mime, upsert: true });
  if (error) { console.error("[invoices] file store failed:", error.message); return null; }
  return path;
}

async function loadFile(path: string): Promise<Buffer | null> {
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}

/** Create an invoice record from a file and read it in the background. Used by uploads and the Xero sync. */
export async function ingestInvoiceFile(opts: {
  data: Buffer; fileName: string; mime: string; source: "upload" | "xero"; xeroInvoiceId?: string; uploadedBy?: string | null;
  autoRead?: boolean; // uploads are read straight away; Xero bills wait until Scott presses Read
  supplierId?: number | null; xero?: { contactName: string | null; number: string | null; date: string | null; total: number | null };
}): Promise<{ id: number; status: string; note?: string }> {
  const autoRead = opts.autoRead !== false;
  const sha = crypto.createHash("sha256").update(opts.data).digest("hex");
  const { data: same } = await supabase.from("supplier_invoices").select("id, status").eq("file_sha256", sha).not("status", "in", "(failed,removed)").limit(1);
  if (same && same.length) return { id: same[0].id, status: "duplicate", note: `This exact file is already in the app (invoice #${same[0].id}).` };

  const { data: row, error } = await supabase.from("supplier_invoices").insert({
    source: opts.source, xero_invoice_id: opts.xeroInvoiceId ?? null, file_name: opts.fileName, file_mime: opts.mime,
    file_sha256: sha, status: autoRead ? "new" : "unread", uploaded_by: opts.uploadedBy ?? null,
    supplier_id: opts.supplierId ?? null, supplier_match_method: opts.supplierId ? "xero_contact" : null,
    xero_contact_name: opts.xero?.contactName ?? null, xero_invoice_number: opts.xero?.number ?? null,
    xero_date: opts.xero?.date ?? null, xero_total: opts.xero?.total ?? null,
  }).select("id").single();
  if (error || !row) throw new Error(error?.message || "Couldn't create the invoice record");

  const path = await storeFile(row.id, opts.data, opts.mime, opts.fileName);
  if (path) await supabase.from("supplier_invoices").update({ file_path: path }).eq("id", row.id);

  if (!autoRead) return { id: row.id, status: "unread" };
  // Read in the background so the upload returns straight away.
  processInvoice(row.id, opts.data, opts.mime, opts.fileName).catch(() => {});
  return { id: row.id, status: "reading" };
}

// ─── Matching lines to products and ingredients ─────────────────────────────
async function loadMatchingData() {
  const [{ data: ingredients }, { data: products }, { data: xeroHist }, { data: memory }] = await Promise.all([
    supabase.from("ingredients").select("id, name, unit, category, avg_weight_per_unit, best_cost_per_unit"),
    supabase.from("supplier_products").select("*").eq("active", true),
    supabase.from("xero_line_items").select("description, ingredient_id").not("ingredient_id", "is", null).in("status", ["matched", "added"]),
    supabase.from("invoice_memory").select("line_item_description, ingredient_id").not("ingredient_id", "is", null),
  ]);
  const history = [
    ...(xeroHist || []).map((h: any) => ({ description: h.description, ingredient_id: h.ingredient_id })),
    ...(memory || []).map((m: any) => ({ description: m.line_item_description, ingredient_id: m.ingredient_id })),
  ].filter((h) => h.description);
  return { ingredients: (ingredients || []) as Ingredient[], products: (products || []) as SupplierProduct[], history };
}

/** Work out suggestions for every pending line on an invoice. Safe to re-run (e.g. after picking the supplier). */
export async function runMatching(invoiceId: number) {
  const { data: inv } = await supabase.from("supplier_invoices").select("supplier_id").eq("id", invoiceId).single();
  const { data: lines } = await supabase.from("supplier_invoice_lines").select("*").eq("invoice_id", invoiceId).eq("status", "pending");
  if (!lines?.length) return;
  const data = await loadMatchingData();
  const toNum = (v: any) => (v === null || v === undefined ? null : Number(v));
  const results = matchLines({
    supplierId: inv?.supplier_id ?? null, ...data,
    lines: lines.map((l: any) => ({
      id: l.id, line_type: l.line_type, supplier_code: l.supplier_code, description: l.description, generic_name: l.generic_name, brand: l.brand,
      quantity: toNum(l.quantity), priced_by_weight: !!l.priced_by_weight, unit_size_uom: l.unit_size_uom, base_qty: toNum(l.base_qty),
      unit_cost: toNum(l.unit_cost), line_total_ex_gst: toNum(l.line_total_ex_gst), needs_pack_size: !!l.needs_pack_size, item_type: l.item_type, purchase_unit: l.purchase_unit,
    })),
  });
  for (const l of lines) {
    const m = results.get(l.id);
    if (!m) continue;
    await supabase.from("supplier_invoice_lines").update({
      supplier_product_id: m.supplier_product_id, ingredient_id: m.ingredient_id, match_method: m.match_method, match_confidence: m.match_confidence,
      suggestions: m.suggestions, warnings: m.warnings, price_change_pct: m.price_change_pct, base_qty: m.base_qty, unit_cost: m.unit_cost,
      needs_pack_size: m.needs_pack_size, item_type: m.item_type, ingredient_units_per_base: m.ingredient_units_per_base, random_weight: m.random_weight,
      ingredient_unit_cost: m.unit_cost !== null && m.ingredient_units_per_base ? Math.round((m.unit_cost / m.ingredient_units_per_base) * 10000) / 10000 : null,
    }).eq("id", l.id);
  }
}

// ─── Approval ────────────────────────────────────────────────────────────────
export type LineDecision = {
  lineId: number;
  action: "match" | "new" | "skip" | "personal";
  ingredientId?: number;
  newIngredient?: { name: string; unit: "kg" | "L" | "each"; category: string };
  itemType?: "ingredient" | "packaging" | "cleaning" | "other";
  brand?: string | null;
  basePerPurchase?: number | null;       // pack size: kg / L / each in ONE purchase unit, when the invoice doesn't say
  packUom?: "kg" | "L" | "each" | null;   // the unit basePerPurchase is in
  weightKg?: number | null;               // random-weight meat: total kg on this line (from the label weight or price per kg)
  ingredientUnitsPerBase?: number | null; // e.g. 10 when a loaf is bought but recipes use slices
};

const r4 = (n: number) => Math.round(n * 10000) / 10000;
const normD = (s: any) => String(s || "").toLowerCase().replace(/\s+/g, " ").replace(/\b(eac|each|ea)\b/g, "").trim();

export async function approveInvoice(invoiceId: number, decisions: LineDecision[], approvedBy: string | null) {
  const { data: inv } = await supabase.from("supplier_invoices").select("*").eq("id", invoiceId).single();
  if (!inv) throw Object.assign(new Error("Invoice not found"), { status: 404 });
  if (inv.status === "approved") throw Object.assign(new Error("Already approved"), { status: 400 });
  if (!inv.supplier_id) throw Object.assign(new Error("Pick the supplier first"), { status: 400 });
  const { data: lines } = await supabase.from("supplier_invoice_lines").select("*").eq("invoice_id", invoiceId).order("line_no");
  const byId = new Map((lines || []).map((l: any) => [l.id, l]));
  const pending = (lines || []).filter((l: any) => l.line_type === "product" && l.status === "pending");
  const decided = new Map(decisions.map((d) => [d.lineId, d]));
  const missing = pending.filter((l: any) => !decided.has(l.id));
  if (missing.length) throw Object.assign(new Error(`${missing.length} line${missing.length === 1 ? "" : "s"} still need a decision`), { status: 400 });

  const invoiceDate = inv.invoice_date || new Date().toISOString().slice(0, 10);
  const { data: ingRows } = await supabase.from("ingredients").select("id, name, unit, category, avg_weight_per_unit, best_cost_per_unit");
  const ings = new Map((ingRows || []).map((i: any) => [i.id, i as Ingredient]));
  const summary = { updated: 0, created: 0, skipped: 0, priceChanges: [] as { name: string; from: number | null; to: number; unit: string }[] };

  // Validate everything first so nothing is half-saved
  type Plan = { line: any; d: LineDecision; baseQty: number; unitCost: number; factor: number; ingCost: number };
  const plans: Plan[] = [];
  for (const d of decisions) {
    const line = byId.get(d.lineId);
    if (!line || line.invoice_id !== invoiceId) throw Object.assign(new Error(`Line ${d.lineId} isn't on this invoice`), { status: 400 });
    if (d.action === "skip" || d.action === "personal") continue;
    const total = Number(line.line_total_ex_gst);
    if (!Number.isFinite(total)) throw Object.assign(new Error(`"${line.description}" has no price`), { status: 400 });
    let baseQty = line.base_qty !== null ? Number(line.base_qty) : null;
    if (d.basePerPurchase && d.basePerPurchase > 0 && line.quantity) baseQty = Number(line.quantity) * d.basePerPurchase;
    if (d.weightKg && d.weightKg > 0) baseQty = d.weightKg;
    if (!baseQty || baseQty <= 0) throw Object.assign(new Error(`"${line.description}" needs a pack size`), { status: 400 });
    const unitCost = total / baseQty;
    let factor = d.ingredientUnitsPerBase && d.ingredientUnitsPerBase > 0 ? d.ingredientUnitsPerBase : null;
    if (!factor) {
      const ing = d.action === "match" ? ings.get(d.ingredientId!) : ({ unit: d.newIngredient?.unit, avg_weight_per_unit: null } as any);
      if (d.action === "match" && !ing) throw Object.assign(new Error(`Pick an ingredient for "${line.description}"`), { status: 400 });
      const lineUom = d.weightKg ? "kg" : d.packUom || (line.priced_by_weight ? "kg" : (line.unit_size_uom || d.newIngredient?.unit || null));
      factor = (!d.packUom && !d.weightKg && line.ingredient_units_per_base && d.action === "match" && line.ingredient_id === d.ingredientId) ? Number(line.ingredient_units_per_base) : unitFactor(lineUom, ing);
      if (!factor && d.action === "new") factor = 1;
    }
    if (!factor) throw Object.assign(new Error(`"${line.description}": set how many ${ings.get(d.ingredientId!)?.unit || "units"} are in one ${line.priced_by_weight ? "kg" : line.unit_size_uom || "unit"}`), { status: 400 });
    if (d.action === "new" && !d.newIngredient?.name?.trim()) throw Object.assign(new Error(`Give the new ingredient for "${line.description}" a name`), { status: 400 });
    plans.push({ line, d, baseQty, unitCost, factor, ingCost: unitCost / factor });
  }

  const { data: products } = await supabase.from("supplier_products").select("*").eq("supplier_id", inv.supplier_id);
  const now = new Date().toISOString();

  for (const p of plans) {
    const { line, d } = p;
    // 1. Ingredient (create if new)
    let ingredientId = d.ingredientId ?? null;
    if (d.action === "new") {
      const { data: created, error } = await supabase.from("ingredients").insert({
        name: d.newIngredient!.name.trim(), unit: d.newIngredient!.unit, category: d.newIngredient!.category || "General",
        best_cost_per_unit: r4(p.ingCost), best_supplier_id: inv.supplier_id, dietaries_json: "[]",
      }).select("id, name, unit, category, avg_weight_per_unit, best_cost_per_unit").single();
      if (error || !created) throw new Error(`Couldn't create ingredient "${d.newIngredient!.name}": ${error?.message}`);
      ingredientId = created.id; ings.set(created.id, created as any); summary.created++;
    }
    const ing = ings.get(ingredientId!)!;

    // 2. Supplier product: by id, then code, then wording, then an old migrated row for this ingredient
    let sp: any = (products || []).find((x: any) => x.id === line.supplier_product_id)
      || (line.supplier_code ? (products || []).find((x: any) => x.supplier_code && x.supplier_code.toLowerCase() === String(line.supplier_code).toLowerCase()) : null)
      || (products || []).find((x: any) => normD(x.supplier_description) === normD(line.description))
      || (products || []).find((x: any) => x.ingredient_id === ingredientId && !x.supplier_code && x.legacy_supplier_ingredient_id);
    const qty = Number(line.quantity) || null;
    const randomWeight = !!(d.weightKg && d.weightKg > 0);
    const perPurchase = line.priced_by_weight || randomWeight ? (randomWeight ? null : 1) : (qty ? r4(p.baseQty / qty) : null);
    const productFields: any = {
      supplier_id: inv.supplier_id, ingredient_id: ingredientId, item_type: d.itemType || line.item_type || (ing.category === "Packaging" ? "packaging" : "ingredient"),
      supplier_code: line.supplier_code || sp?.supplier_code || null, supplier_description: line.description,
      brand: d.brand !== undefined ? (d.brand || null) : (line.brand || sp?.brand || null),
      purchase_unit: line.purchase_unit, units_per_purchase: line.units_per_purchase, unit_size: line.unit_size,
      unit_size_uom: line.priced_by_weight || randomWeight ? "kg" : (d.packUom || line.unit_size_uom || sp?.unit_size_uom || null), priced_by_weight: !!line.priced_by_weight || randomWeight,
      base_qty_per_purchase: perPurchase, pack_size_confirmed: randomWeight ? false : !!(d.basePerPurchase || sp?.pack_size_confirmed || !line.needs_pack_size),
      gst_applicable: line.gst_applies, last_price_ex_gst: line.unit_price_ex_gst, last_unit_cost: r4(p.ingCost),
      last_invoice_id: invoiceId, last_invoice_date: invoiceDate, ingredient_units_per_base: p.factor, active: true, updated_at: now,
    };
    let productId: number;
    const previousCost = sp?.last_unit_cost !== undefined && sp?.last_unit_cost !== null ? Number(sp.last_unit_cost) : null;
    const newerThanStored = !sp?.last_invoice_date || sp.last_invoice_date <= invoiceDate;
    if (sp) {
      if (!newerThanStored) { // an older invoice: keep the latest price, still learn the code and wording
        delete productFields.last_price_ex_gst; delete productFields.last_unit_cost; delete productFields.last_invoice_id; delete productFields.last_invoice_date;
      }
      const { error } = await supabase.from("supplier_products").update(productFields).eq("id", sp.id);
      if (error) throw new Error(`Saving "${line.description}" failed: ${error.message}`);
      productId = sp.id;
    } else {
      const { data: created, error } = await supabase.from("supplier_products").insert(productFields).select("id").single();
      if (error || !created) throw new Error(`Saving "${line.description}" failed: ${error?.message}`);
      productId = created.id; (products || []).push({ id: productId, ...productFields });
    }
    // First product for an ingredient becomes the preferred one (what drivers buy)
    const { data: pref } = await supabase.from("supplier_products").select("id").eq("ingredient_id", ingredientId).eq("is_preferred", true).limit(1);
    if (!pref?.length) await supabase.from("supplier_products").update({ is_preferred: true }).eq("id", productId);

    // 3. Price history
    await supabase.from("supplier_price_history").insert({
      supplier_product_id: productId, invoice_id: invoiceId, invoice_line_id: line.id, invoice_date: invoiceDate,
      quantity: line.quantity, price_ex_gst: line.unit_price_ex_gst, unit_cost: r4(p.ingCost),
    });

    // 4. Ingredient cost = latest price paid (ignore older invoices than one already applied)
    const { data: newer } = await supabase.from("supplier_products").select("id").eq("ingredient_id", ingredientId).neq("id", productId).gt("last_invoice_date", invoiceDate).limit(1);
    if (!newer?.length) {
      const before = ing.best_cost_per_unit !== null ? Number(ing.best_cost_per_unit) : null;
      await supabase.from("ingredients").update({ best_cost_per_unit: r4(p.ingCost), best_supplier_id: inv.supplier_id }).eq("id", ingredientId);
      if (before === null || Math.abs(before - p.ingCost) > 0.0001) summary.priceChanges.push({ name: ing.name, from: before, to: r4(p.ingCost), unit: ing.unit });
    }

    await supabase.from("supplier_invoice_lines").update({
      status: "approved", ingredient_id: ingredientId, supplier_product_id: productId, base_qty: r4(p.baseQty), unit_cost: r4(p.unitCost),
      ingredient_units_per_base: p.factor, ingredient_unit_cost: r4(p.ingCost), item_type: productFields.item_type, brand: productFields.brand,
      match_method: line.match_method || (d.action === "new" ? "new" : "manual"),
      price_change_pct: previousCost ? Math.round(((p.ingCost - previousCost) / previousCost) * 1000) / 10 : null,
    }).eq("id", line.id);
    summary.updated++;
  }

  for (const d of decisions.filter((x) => x.action === "skip" || x.action === "personal")) {
    await supabase.from("supplier_invoice_lines").update({ status: "skipped", ...(d.action === "personal" ? { line_type: "personal" } : {}) }).eq("id", d.lineId);
    summary.skipped++;
  }
  await supabase.from("supplier_invoices").update({ status: "approved", approved_at: now, status_note: `Approved by ${approvedBy || "hand"}`, updated_at: now }).eq("id", invoiceId);
  return summary;
}

// ─── Routes ──────────────────────────────────────────────────────────────────
export function registerInvoiceRoutes(app: Express, deps: { recalcAllCosts: () => Promise<any> }) {
  // Re-run matching (e.g. after the supplier is picked)
  app.post("/api/supplier-invoices/:id/match", requireInvoiceAccess, asyncRoute(async (req: any, res: any) => {
    await runMatching(Number(req.params.id));
    res.json({ ok: true });
  }));

  // Approve: save products, prices and ingredient costs, then refresh recipe costs
  app.post("/api/supplier-invoices/:id/approve", requireInvoiceAccess, asyncRoute(async (req: any, res: any) => {
    const decisions: LineDecision[] = Array.isArray(req.body?.decisions) ? req.body.decisions : [];
    try {
      const summary = await approveInvoice(Number(req.params.id), decisions, req.staffName || null);
      deps.recalcAllCosts().catch((e) => console.error("[invoices] recalculating costs failed:", e?.message || e));
      res.json({ ok: true, ...summary });
    } catch (e: any) {
      res.status(e?.status || 500).json({ error: e?.message || String(e) });
    }
  }));

  // Add a new supplier from an invoice (uses the ABN and account number the reader found)
  app.post("/api/supplier-invoices/:id/new-supplier", requireInvoiceAccess, asyncRoute(async (req: any, res: any) => {
    const id = Number(req.params.id);
    const name = String(req.body?.name || "").trim();
    if (!name) return res.status(400).json({ error: "Supplier name is required" });
    const { data: inv } = await supabase.from("supplier_invoices").select("detected_abn, extraction_json, status").eq("id", id).single();
    if (!inv) return res.status(404).json({ error: "Not found" });
    const acct = inv.extraction_json?.raw?.our_account_number || null;
    const { data: sup, error } = await supabase.from("suppliers").insert({
      name, abn: inv.detected_abn && !OWN_ABNS.includes(inv.detected_abn) ? inv.detected_abn : null, our_account_number: acct,
      collection_method: req.body?.collectionMethod === "driver" ? "driver" : "delivery",
    }).select("id").single();
    if (error || !sup) throw new Error(error?.message || "Couldn't add the supplier");
    await supabase.from("supplier_invoices").update({ supplier_id: sup.id, supplier_match_method: "new", updated_at: new Date().toISOString() }).eq("id", id);
    await runMatching(id);
    res.json({ ok: true, supplierId: sup.id });
  }));
  // List (newest first)
  app.get("/api/supplier-invoices", requireInvoiceAccess, asyncRoute(async (req: any, res: any) => {
    const status = req.query.status ? String(req.query.status).split(",") : null;
    let q = supabase.from("supplier_invoices")
      .select("id, source, supplier_id, detected_supplier_name, document_type, invoice_number, invoice_date, subtotal_ex_gst, gst, total_inc_gst, status, status_note, totals_check_ok, file_name, file_path, file_mime, created_at, approved_at, xero_contact_name, xero_invoice_number, xero_date, xero_total, suppliers(name)")
      .order("created_at", { ascending: false }).limit(Math.min(Number(req.query.limit) || 200, 500));
    if (status) q = q.in("status", status);
    else q = q.neq("status", "removed");
    const { data, error } = await q;
    if (error) throw error;
    res.json(data);
  }));

  // One invoice with its lines
  app.get("/api/supplier-invoices/:id", requireInvoiceAccess, asyncRoute(async (req: any, res: any) => {
    const id = Number(req.params.id);
    const { data: inv, error } = await supabase.from("supplier_invoices").select("*, suppliers(name)").eq("id", id).single();
    if (error || !inv) return res.status(404).json({ error: "Not found" });
    const { data: lines } = await supabase.from("supplier_invoice_lines").select("*").eq("invoice_id", id).order("line_no");
    const { extraction_json, ...rest } = inv as any;
    res.json({ ...rest, reader_notes: extraction_json?.raw?.reader_notes ?? null, totals_check_note: extraction_json?.normalised?.totals_check_note ?? null, lines: lines || [] });
  }));

  // The original PDF or photo
  app.get("/api/supplier-invoices/:id/file", requireInvoiceAccess, asyncRoute(async (req: any, res: any) => {
    const { data: inv } = await supabase.from("supplier_invoices").select("file_path, file_mime, file_name").eq("id", Number(req.params.id)).single();
    if (!inv?.file_path) return res.status(404).json({ error: "No file stored for this invoice" });
    const buf = await loadFile(inv.file_path);
    if (!buf) return res.status(404).json({ error: "File not found in storage" });
    res.setHeader("Content-Type", inv.file_mime || "application/octet-stream");
    res.setHeader("Content-Disposition", `inline; filename="${(inv.file_name || "invoice").replace(/"/g, "")}"`);
    res.send(buf);
  }));

  // Upload one or more files
  app.post("/api/supplier-invoices/upload", requireInvoiceAccess, upload.array("files", 20), asyncRoute(async (req: any, res: any) => {
    const files: any[] = req.files || [];
    if (!files.length) return res.status(400).json({ error: "No files uploaded" });
    const results = [];
    for (const f of files) {
      const mime = mimeFromName(f.originalname, f.mimetype);
      if (!ACCEPTED.includes(mime)) { results.push({ fileName: f.originalname, status: "rejected", note: "Only PDFs and photos (JPG, PNG, WEBP, HEIC) can be read." }); continue; }
      const r = await ingestInvoiceFile({ data: f.buffer, fileName: f.originalname, mime, source: "upload", uploadedBy: req.staffName });
      results.push({ fileName: f.originalname, ...r });
    }
    res.json({ results, filesStored: canStoreFiles() });
  }));

  // Read (unread Xero bills) or read again (after a failure, or once the API key is set)
  app.post("/api/supplier-invoices/:id/reread", requireInvoiceAccess, asyncRoute(async (req: any, res: any) => {
    const id = Number(req.params.id);
    const { data: inv } = await supabase.from("supplier_invoices").select("file_path, file_mime, file_name, status").eq("id", id).single();
    if (!inv) return res.status(404).json({ error: "Not found" });
    if (inv.status === "approved") return res.status(400).json({ error: "This invoice is already approved" });
    if (inv.status === "reading") return res.json({ ok: true, status: "reading" });
    if (!inv.file_path) return res.status(400).json({ error: "No stored file to read. Please upload it again." });
    const buf = await loadFile(inv.file_path);
    if (!buf) return res.status(404).json({ error: "File not found in storage" });
    processInvoice(id, buf, inv.file_mime || "application/pdf", inv.file_name).catch(() => {});
    res.json({ ok: true, status: "reading" });
  }));

  // Set or change the supplier (and optionally teach the app this supplier's ABN/name)
  app.patch("/api/supplier-invoices/:id/supplier", requireInvoiceAccess, asyncRoute(async (req: any, res: any) => {
    const id = Number(req.params.id);
    const supplierId = Number(req.body.supplierId);
    if (!supplierId) return res.status(400).json({ error: "supplierId is required" });
    const { data: inv } = await supabase.from("supplier_invoices").select("detected_abn, detected_supplier_name, status").eq("id", id).single();
    if (!inv) return res.status(404).json({ error: "Not found" });
    if (inv.status === "approved") return res.status(400).json({ error: "This invoice is already approved" });
    const { error } = await supabase.from("supplier_invoices").update({ supplier_id: supplierId, supplier_match_method: "manual", updated_at: new Date().toISOString() }).eq("id", id);
    if (error) throw error;
    if (req.body.remember !== false) {
      const { data: s } = await supabase.from("suppliers").select("abn, name, name_aliases").eq("id", supplierId).single();
      const update: any = {};
      if (!s?.abn && inv.detected_abn && !OWN_ABNS.includes(inv.detected_abn)) update.abn = inv.detected_abn;
      const alias = (inv.detected_supplier_name || "").trim();
      if (alias && normName(alias) !== normName(s?.name) && !(s?.name_aliases || []).some((a: string) => normName(a) === normName(alias))) {
        update.name_aliases = [...(s?.name_aliases || []), alias];
      }
      if (Object.keys(update).length) await supabase.from("suppliers").update(update).eq("id", supplierId);
    }
    await runMatching(id);
    res.json({ ok: true });
  }));

  // Ignore (not ours, personal, junk)
  app.post("/api/supplier-invoices/:id/ignore", requireInvoiceAccess, asyncRoute(async (req: any, res: any) => {
    const id = Number(req.params.id);
    const { data: inv } = await supabase.from("supplier_invoices").select("status").eq("id", id).single();
    if (inv?.status === "approved") return res.status(400).json({ error: "This invoice is already approved" });
    await setStatus(id, "ignored", req.body?.note || "Ignored by hand");
    res.json({ ok: true });
  }));

  // Remove: clears it off the page and deletes the stored file. The record stays (status
  // "removed") so the Xero check doesn't pull the same bill back in.
  app.post("/api/supplier-invoices/:id/remove", requireInvoiceAccess, asyncRoute(async (req: any, res: any) => {
    const ids: number[] = (Array.isArray(req.body?.ids) ? req.body.ids : [req.params.id]).map(Number).filter(Boolean);
    let removed = 0;
    for (const id of ids) {
      const { data: inv } = await supabase.from("supplier_invoices").select("status, file_path").eq("id", id).single();
      if (!inv || inv.status === "approved" || inv.status === "removed") continue;
      if (inv.file_path) await supabase.storage.from(BUCKET).remove([inv.file_path]);
      await supabase.from("supplier_invoice_lines").delete().eq("invoice_id", id);
      await supabase.from("supplier_invoices").update({
        status: "removed", status_note: `Removed by ${req.staffName || "hand"}`, removed_at: new Date().toISOString(),
        file_path: null, extraction_json: null, invoice_number: null, updated_at: new Date().toISOString(),
      }).eq("id", id);
      removed++;
    }
    res.json({ ok: true, removed });
  }));

  // Read several unread invoices at once
  app.post("/api/supplier-invoices/read-many", requireInvoiceAccess, asyncRoute(async (req: any, res: any) => {
    const ids: number[] = (Array.isArray(req.body?.ids) ? req.body.ids : []).map(Number).filter(Boolean).slice(0, 50);
    let started = 0;
    for (const id of ids) {
      const { data: inv } = await supabase.from("supplier_invoices").select("file_path, file_mime, file_name, status").eq("id", id).single();
      if (!inv?.file_path || ["approved", "reading", "removed"].includes(inv.status)) continue;
      const buf = await loadFile(inv.file_path);
      if (!buf) continue;
      processInvoice(id, buf, inv.file_mime || "application/pdf", inv.file_name).catch(() => {});
      started++;
    }
    res.json({ ok: true, started });
  }));

  // Counts for the menu badge
  app.get("/api/supplier-invoices-summary", requireInvoiceAccess, asyncRoute(async (_req: any, res: any) => {
    const { data } = await supabase.from("supplier_invoices").select("status").in("status", ["new", "unread", "reading", "needs_review", "failed"]);
    const counts: Record<string, number> = {};
    (data || []).forEach((r: any) => (counts[r.status] = (counts[r.status] || 0) + 1));
    res.json({ counts, readerReady: !!process.env.ANTHROPIC_API_KEY, filesStored: canStoreFiles(), model: INVOICE_READER_MODEL });
  }));

  // Test hook for checking the reader against sample invoices without saving anything.
  // Only active while INVOICE_TEST_SECRET is set on Railway; remove that variable when done.
  app.post("/api/supplier-invoices/test-read", upload.single("file"), asyncRoute(async (req: any, res: any) => {
    const secret = process.env.INVOICE_TEST_SECRET;
    if (!secret || req.get("x-invoice-test-secret") !== secret) return res.status(404).json({ error: "Not found" });
    const client = anthropicClient();
    if (!client) return res.status(503).json({ error: "ANTHROPIC_API_KEY is not set" });
    if (!req.file) return res.status(400).json({ error: "No file" });
    const mime = mimeFromName(req.file.originalname, req.file.mimetype);
    const started = Date.now();
    const prepared = await prepareForReader(req.file.buffer, mime);
    const { data: suppliers } = await supabase.from("suppliers").select("id, name, abn, our_account_number, name_aliases");
    const { raw, usage, model } = await readInvoiceDocument(client, { data: prepared.data, mediaType: prepared.mediaType, fileName: req.file.originalname, knownSuppliers: (suppliers || []).map((s: any) => s.name) });
    const inv = normaliseInvoice(raw);
    res.json({ model, usage, seconds: (Date.now() - started) / 1000, supplierMatch: matchSupplier(inv, suppliers || []), invoice: inv });
  }));
}
