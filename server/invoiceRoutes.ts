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
import { readInvoiceDocument, normaliseInvoice, INVOICE_READER_MODEL, type NormalisedInvoice } from "./invoiceReader";

const BUCKET = "supplier-invoices";
const ACCEPTED = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"];
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024, files: 20 } });

const asyncRoute = (fn: any) => (req: any, res: any, next: any) =>
  Promise.resolve(fn(req, res, next)).catch((e: any) => {
    console.error("[invoices] route error:", e?.message || e);
    if (!res.headersSent) res.status(500).json({ error: e?.message || "Internal server error" });
  });

function anthropicClient(): Anthropic | null {
  return process.env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null;
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
    const match = matchSupplier(inv, suppliers || []);

    // Duplicate? Same supplier and invoice number already saved.
    let status = "needs_review";
    let note: string | null = inv.totals_check_ok === false ? inv.totals_check_note : null;
    if (match.supplierId && inv.invoice_number) {
      const { data: dupes } = await supabase.from("supplier_invoices").select("id, status")
        .eq("supplier_id", match.supplierId).ilike("invoice_number", inv.invoice_number).neq("id", id)
        .not("status", "in", "(failed,duplicate)");
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
        status: l.line_type === "personal" ? "skipped" : "pending",
      }));
      const { error } = await supabase.from("supplier_invoice_lines").insert(rows);
      if (error) throw new Error(`Saving lines failed: ${error.message}`);
    }
    const { error: hErr } = await supabase.from("supplier_invoices").update({ ...header, status, status_note: note, updated_at: new Date().toISOString() }).eq("id", id);
    if (hErr) throw new Error(`Saving invoice failed: ${hErr.message}`);
  } catch (e: any) {
    console.error(`[invoices] reading #${id} failed:`, e?.message || e);
    await setStatus(id, "failed", `Couldn't read this document: ${e?.message || e}`);
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
}): Promise<{ id: number; status: string; note?: string }> {
  const sha = crypto.createHash("sha256").update(opts.data).digest("hex");
  const { data: same } = await supabase.from("supplier_invoices").select("id, status").eq("file_sha256", sha).not("status", "in", "(failed)").limit(1);
  if (same && same.length) return { id: same[0].id, status: "duplicate", note: `This exact file is already in the app (invoice #${same[0].id}).` };

  const { data: row, error } = await supabase.from("supplier_invoices").insert({
    source: opts.source, xero_invoice_id: opts.xeroInvoiceId ?? null, file_name: opts.fileName, file_mime: opts.mime,
    file_sha256: sha, status: "new", uploaded_by: opts.uploadedBy ?? null,
  }).select("id").single();
  if (error || !row) throw new Error(error?.message || "Couldn't create the invoice record");

  const path = await storeFile(row.id, opts.data, opts.mime, opts.fileName);
  if (path) await supabase.from("supplier_invoices").update({ file_path: path }).eq("id", row.id);

  // Read in the background so the upload returns straight away.
  processInvoice(row.id, opts.data, opts.mime, opts.fileName).catch(() => {});
  return { id: row.id, status: "reading" };
}

// ─── Routes ──────────────────────────────────────────────────────────────────
export function registerInvoiceRoutes(app: Express) {
  // List (newest first)
  app.get("/api/supplier-invoices", requireInvoiceAccess, asyncRoute(async (req: any, res: any) => {
    const status = req.query.status ? String(req.query.status).split(",") : null;
    let q = supabase.from("supplier_invoices")
      .select("id, source, supplier_id, detected_supplier_name, document_type, invoice_number, invoice_date, subtotal_ex_gst, gst, total_inc_gst, status, status_note, totals_check_ok, file_name, created_at, approved_at, suppliers(name)")
      .order("created_at", { ascending: false }).limit(Math.min(Number(req.query.limit) || 100, 500));
    if (status) q = q.in("status", status);
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

  // Read again (after a failure, or once the API key is set)
  app.post("/api/supplier-invoices/:id/reread", requireInvoiceAccess, asyncRoute(async (req: any, res: any) => {
    const id = Number(req.params.id);
    const { data: inv } = await supabase.from("supplier_invoices").select("file_path, file_mime, file_name, status").eq("id", id).single();
    if (!inv) return res.status(404).json({ error: "Not found" });
    if (inv.status === "approved") return res.status(400).json({ error: "This invoice is already approved" });
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

  // Counts for the menu badge
  app.get("/api/supplier-invoices-summary", requireInvoiceAccess, asyncRoute(async (_req: any, res: any) => {
    const { data } = await supabase.from("supplier_invoices").select("status").in("status", ["new", "reading", "needs_review", "failed"]);
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
