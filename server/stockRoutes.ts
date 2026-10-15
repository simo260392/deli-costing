// ─── Stock Ordering: shopping lists ───────────────────────────────────────────
// Staff build a shopping list from a template (all items, by category or by
// supplier). Each item gets a supplier (default: the cheapest we have on file)
// and the submission is split into one draft list per supplier. A draft list is
// then sent either to the driver run (WhatsApp to the drivers group) or to the
// supplier (order email), and closed off when collected or delivered.
//
// Tables: stock_lists, stock_requests (list items, list_id), suppliers.collection_method
import type { Express } from "express";
import nodemailer from "nodemailer";
import supabase from "./supabase";
import { storage } from "./storage";

type SendWhatsApp = (message: string) => Promise<{ ok: boolean; error?: string }>;

const KITCHEN_ADDRESS = "9A/2 Powell St, Osborne Park WA 6017";
const KITCHEN_PHONE = "08 6107 5799";

const asyncRoute = (fn: any) => (req: any, res: any, next: any) =>
  Promise.resolve(fn(req, res, next)).catch((e: any) => {
    console.error("[stock] route error:", e?.message || e);
    if (!res.headersSent) res.status(500).json({ error: e?.message || "Internal server error" });
  });

async function staffName(req: any): Promise<string | null> {
  const id = req.session?.staffId;
  if (!id) return null;
  const { data } = await supabase.from("staff").select("name").eq("id", id).single();
  return data?.name ?? null;
}

const nowIso = () => new Date().toISOString();

function perthDateLabel(d = new Date()) {
  return d.toLocaleDateString("en-AU", { timeZone: "Australia/Perth", weekday: "short", day: "numeric", month: "short" });
}
// "2026-10-14" -> "Wed 14 Oct"
function dayLabel(ymd: string) {
  return new Date(`${ymd}T12:00:00+08:00`).toLocaleDateString("en-AU", { timeZone: "Australia/Perth", weekday: "short", day: "numeric", month: "short" });
}

function qtyLabel(r: any) {
  const q = Number(r.qty);
  const qty = Number.isInteger(q) ? String(q) : String(Math.round(q * 100) / 100);
  return r.unit ? `${qty} ${r.unit}` : qty;
}

// ── Email (SMTP) ──────────────────────────────────────────────────────────────
// Railway variables: SMTP_HOST, SMTP_PORT (default 587), SMTP_USER, SMTP_PASS,
// ORDER_EMAIL_FROM (default SMTP_USER). A copy is BCC'd to the sender address.
function smtpConfig() {
  const host = process.env.SMTP_HOST || "";
  const user = process.env.SMTP_USER || "";
  const pass = process.env.SMTP_PASS || "";
  const port = Number(process.env.SMTP_PORT || 587);
  const from = process.env.ORDER_EMAIL_FROM || user;
  return { host, user, pass, port, from, configured: !!(host && user && pass && from) };
}

async function sendOrderEmail(to: string, subject: string, body: string) {
  const cfg = smtpConfig();
  if (!cfg.configured) throw new Error("Email sending isn't set up yet (SMTP settings missing in Railway)");
  const transport = nodemailer.createTransport({
    host: cfg.host, port: cfg.port, secure: cfg.port === 465,
    auth: { user: cfg.user, pass: cfg.pass },
  });
  await transport.sendMail({
    from: `"The Deli by Greenhorns" <${cfg.from}>`,
    to, bcc: cfg.from, replyTo: cfg.from, subject, text: body,
  });
}

export function buildSupplierEmail(supplier: any, items: any[]) {
  const greetingName = (supplier?.contact_name || "").trim().split(/\s+/)[0] || "team";
  const lines = items.map((r) => {
    const sku = r.sku ? ` (code ${r.sku})` : "";
    const note = r.notes ? ` (${r.notes})` : "";
    return `• ${r.supplier_item_name || r.item_name}${sku}: ${qtyLabel(r)}${note}`;
  });
  const subject = `Order from The Deli by Greenhorns, ${perthDateLabel()}`;
  const body = [
    `Hi ${greetingName},`,
    ``,
    `Could you please send through the following order for The Deli by Greenhorns:`,
    ``,
    ...lines,
    ``,
    `Deliver to: ${KITCHEN_ADDRESS}`,
    ``,
    `Can you hit reply to confirm, and let us know if anything's out of stock so we can sort an alternative.`,
    ``,
    `Cheers,`,
    `The Deli by Greenhorns Team`,
    KITCHEN_PHONE,
  ].join("\n");
  return { subject, body };
}

function buildChefAlert(heading: string, rows: any[]) {
  const parts = [heading, ""];
  for (const r of rows) parts.push(`• ${r.item_name} (${qtyLabel(r)})`);
  parts.push("", "Please order these from somewhere else. Details are in the app under Stock Ordering.");
  return parts.join("\n");
}

// ── WhatsApp: drivers group ───────────────────────────────────────────────────
// Uses the same Green API instance as the staff group. The group is found by
// name the first time ("The Deli Drivers", or WHATSAPP_DRIVERS_GROUP_NAME) and
// remembered in settings (whatsapp_drivers_group_id).
async function driversGroupId(): Promise<string> {
  const saved = (await storage.getSetting("whatsapp_drivers_group_id")) || process.env.WHATSAPP_DRIVERS_GROUP_ID || "";
  if (saved) return saved;
  const url = (process.env.GREEN_API_URL || "https://api.green-api.com").replace(/\/+$/, "");
  const instance = process.env.GREEN_API_INSTANCE || "";
  const token = process.env.GREEN_API_TOKEN || "";
  if (!instance || !token) return "";
  const wanted = (process.env.WHATSAPP_DRIVERS_GROUP_NAME || "The Deli Drivers").trim().toLowerCase();
  try {
    const r = await fetch(`${url}/waInstance${instance}/getContacts/${token}?group=true`, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) return "";
    const list: any[] = await r.json();
    const match = list.find((c) => String(c.id || "").endsWith("@g.us") &&
      String(c.name || c.contactName || "").trim().toLowerCase() === wanted);
    if (!match) { console.warn(`[whatsapp] no drivers group named "${wanted}"`); return ""; }
    await storage.setSetting("whatsapp_drivers_group_id", match.id);
    return match.id;
  } catch (e: any) {
    console.error("[whatsapp] drivers group lookup failed:", e?.message);
    return "";
  }
}

export async function sendDriversWhatsApp(message: string): Promise<{ ok: boolean; error?: string }> {
  const url = (process.env.GREEN_API_URL || "https://api.green-api.com").replace(/\/+$/, "");
  const instance = process.env.GREEN_API_INSTANCE || "";
  const token = process.env.GREEN_API_TOKEN || "";
  if (!instance || !token) return { ok: false, error: "Green API is not configured" };
  const chatId = await driversGroupId();
  if (!chatId) return { ok: false, error: "Couldn't find the drivers WhatsApp group" };
  try {
    const r = await fetch(`${url}/waInstance${instance}/sendMessage/${token}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatId, message }), signal: AbortSignal.timeout(20000),
    });
    if (r.ok) return { ok: true };
    const text = await r.text();
    console.error("[whatsapp] drivers send failed:", r.status, text.slice(0, 200));
    return { ok: false, error: `Green API ${r.status}` };
  } catch (e: any) {
    console.error("[whatsapp] drivers send error:", e?.message);
    return { ok: false, error: e?.message };
  }
}

// ── Data helpers ──────────────────────────────────────────────────────────────
// Supplier code + supplier's own item name for each list item
async function enrichItems(rows: any[]) {
  if (!rows.length) return rows;
  const ingIds = Array.from(new Set(rows.map((r) => r.ingredient_id).filter(Boolean)));
  const { data: sis } = ingIds.length
    ? await supabase.from("supplier_ingredients").select("ingredient_id,supplier_id,supplier_sku,supplier_ingredient_name").in("ingredient_id", ingIds)
    : { data: [] as any[] };
  return rows.map((r) => {
    const si: any = (sis || []).find((x: any) => x.ingredient_id === r.ingredient_id && x.supplier_id === r.supplier_id);
    return { ...r, sku: si?.supplier_sku || null, supplier_item_name: si?.supplier_ingredient_name || null };
  });
}

async function loadLists(filter: (q: any) => any) {
  const { data: lists, error } = await filter(supabase.from("stock_lists").select("*"));
  if (error) throw new Error(error.message);
  const ids = (lists || []).map((l: any) => l.id);
  const { data: items } = ids.length
    ? await supabase.from("stock_requests").select("*").in("list_id", ids).order("item_name")
    : { data: [] as any[] };
  const enriched = await enrichItems(items || []);
  const supIds = Array.from(new Set((lists || []).map((l: any) => l.supplier_id).filter(Boolean)));
  const { data: sups } = supIds.length
    ? await supabase.from("suppliers").select("id,collection_method").in("id", supIds)
    : { data: [] as any[] };
  return (lists || []).map((l: any) => ({
    ...l,
    supplier_method: (sups || []).find((s: any) => s.id === l.supplier_id)?.collection_method || "delivery",
    items: enriched.filter((i: any) => i.list_id === l.id),
  }));
}

async function loadList(id: number) {
  const [list] = await loadLists((q) => q.eq("id", id));
  return list || null;
}

// Add items to a list, topping up an existing line for the same item and unit
async function addItemsToList(listId: number, supplierId: number | null, items: any[], who: string | null) {
  const { data: existing } = await supabase.from("stock_requests").select("*").eq("list_id", listId);
  const now = nowIso();
  for (const it of items) {
    const unit = String(it.unit || "").trim();
    const name = String(it.itemName || "").trim();
    const dup = (existing || []).find((e: any) =>
      (it.ingredientId ? e.ingredient_id === it.ingredientId : !e.ingredient_id && e.item_name.toLowerCase() === name.toLowerCase()) &&
      (e.unit || "") === unit);
    if (dup) {
      dup.qty = Number(dup.qty) + Number(it.qty);
      await supabase.from("stock_requests").update({ qty: dup.qty, updated_at: now }).eq("id", dup.id);
    } else {
      const { data: row } = await supabase.from("stock_requests").insert({
        list_id: listId, ingredient_id: it.ingredientId || null, item_name: name, qty: Number(it.qty), unit,
        supplier_id: supplierId, method: "delivery", notes: it.notes || null, status: "requested",
        requested_by: who, updated_at: now,
      }).select().single();
      if (row) (existing || []).push(row);
    }
  }
  await supabase.from("stock_lists").update({ updated_at: now }).eq("id", listId);
}

const validItem = (it: any) => String(it?.itemName || "").trim() && Number(it?.qty) > 0;

export function registerStockRoutes(app: Express, sendTeamWhatsApp: SendWhatsApp) {
  // ── Template for a new shopping list ──
  // ?mode=all | category | supplier & keys=comma separated categories or supplier ids
  app.get("/api/stock/template", asyncRoute(async (req: any, res: any) => {
    const mode = String(req.query.mode || "all");
    const keys = String(req.query.keys || "").split(",").map((k) => k.trim()).filter(Boolean);
    const [{ data: ings, error: e1 }, { data: sis, error: e2 }, { data: sups, error: e3 }] = await Promise.all([
      supabase.from("ingredients").select("id,name,unit,category").order("name"),
      supabase.from("supplier_ingredients").select("ingredient_id,supplier_id,cost_per_unit,unit_size_qty,unit_size_unit,supplier_sku"),
      supabase.from("suppliers").select("id,name,collection_method,parent_supplier_id").order("name"),
    ]);
    if (e1 || e2 || e3) return res.status(500).json({ error: (e1 || e2 || e3)!.message });

    const supMap = new Map((sups || []).map((s: any) => [s.id, s]));
    // Selected suppliers include their child suppliers (e.g. individual market stalls)
    const chosenSups = new Set<number>();
    if (mode === "supplier") {
      for (const k of keys) {
        chosenSups.add(Number(k));
        for (const s of sups || []) if (s.parent_supplier_id === Number(k)) chosenSups.add(s.id);
      }
    }

    const byIng: Record<number, any[]> = {};
    for (const si of sis || []) {
      const s: any = supMap.get(si.supplier_id);
      if (!s) continue;
      (byIng[si.ingredient_id] ||= []).push({
        supplierId: s.id, supplierName: s.name, method: s.collection_method,
        costPerUnit: si.cost_per_unit != null ? Number(si.cost_per_unit) : null,
        pack: si.unit_size_qty ? `${si.unit_size_qty}${si.unit_size_unit || ""}` : null,
      });
    }
    const cheapestFirst = (a: any, b: any) =>
      (a.costPerUnit ?? Infinity) - (b.costPerUnit ?? Infinity) || a.supplierName.localeCompare(b.supplierName);

    const items = (ings || [])
      .filter((i: any) => {
        if (mode === "category") return keys.includes(i.category || "General");
        if (mode === "supplier") return (byIng[i.id] || []).some((o) => chosenSups.has(o.supplierId));
        return true;
      })
      .map((i: any) => {
        const options = (byIng[i.id] || []).sort(cheapestFirst);
        // De-dupe suppliers (keep the cheapest line per supplier)
        const seen = new Set<number>();
        const unique = options.filter((o) => (seen.has(o.supplierId) ? false : (seen.add(o.supplierId), true)));
        const pool = mode === "supplier" ? unique.filter((o) => chosenSups.has(o.supplierId)) : unique;
        const def = pool[0] || null;
        return {
          ingredientId: i.id, name: i.name, unit: i.unit || "", category: i.category || "General",
          options: unique, defaultSupplierId: def?.supplierId ?? null,
          cheapestSupplierId: unique[0]?.supplierId ?? null,
        };
      })
      .sort((a: any, b: any) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));

    const categories = Array.from(new Set((ings || []).map((i: any) => i.category || "General"))).sort();
    res.json({ items, categories, suppliers: sups || [] });
  }));

  // ── Lists ──
  // ?view=active (draft, driver, ordered) | history (completed/cancelled, last 30 days)
  app.get("/api/stock/lists", asyncRoute(async (req: any, res: any) => {
    const history = req.query.view === "history";
    const lists = await loadLists((q) => history
      ? q.in("status", ["completed", "cancelled"]).gte("updated_at", new Date(Date.now() - 30 * 86400000).toISOString()).order("updated_at", { ascending: false }).limit(100)
      : q.in("status", ["draft", "driver", "ordered"]).order("created_at", { ascending: true }));
    res.json(lists);
  }));

  // Submit a template: split by supplier into draft lists (adds to an existing draft for that supplier)
  // { items: [{ ingredientId?, itemName, qty, unit, supplierId }] }
  app.post("/api/stock/lists", asyncRoute(async (req: any, res: any) => {
    const items = (req.body?.items || []).filter(validItem);
    if (!items.length) return res.status(400).json({ error: "Add a quantity to at least one item" });
    if (items.some((i: any) => !i.supplierId)) return res.status(400).json({ error: "Every item needs a supplier" });
    const who = await staffName(req);
    const bySup: Record<number, any[]> = {};
    for (const it of items) (bySup[Number(it.supplierId)] ||= []).push(it);
    const { data: sups } = await supabase.from("suppliers").select("id,name").in("id", Object.keys(bySup).map(Number));

    const touched: number[] = [];
    for (const [sidStr, list] of Object.entries(bySup)) {
      const sid = Number(sidStr);
      const sup: any = (sups || []).find((s: any) => s.id === sid);
      if (!sup) return res.status(400).json({ error: `Supplier ${sid} not found` });
      let { data: draft } = await supabase.from("stock_lists").select("*").eq("supplier_id", sid).eq("status", "draft").limit(1).maybeSingle();
      if (!draft) {
        const { data, error } = await supabase.from("stock_lists").insert({ supplier_id: sid, supplier_name: sup.name, status: "draft", created_by: who }).select().single();
        if (error) return res.status(500).json({ error: error.message });
        draft = data;
      }
      await addItemsToList(draft.id, sid, list, who);
      touched.push(draft.id);
    }
    res.json({ listIds: touched });
  }));

  // Add one item to a list
  app.post("/api/stock/lists/:id/items", asyncRoute(async (req: any, res: any) => {
    const id = Number(req.params.id);
    const it = req.body || {};
    if (!validItem(it)) return res.status(400).json({ error: "Item name and a quantity are needed" });
    const { data: list } = await supabase.from("stock_lists").select("*").eq("id", id).single();
    if (!list) return res.status(404).json({ error: "List not found" });
    if (list.status !== "draft") return res.status(400).json({ error: "This list has already been sent" });
    await addItemsToList(id, list.supplier_id, [it], await staffName(req));
    res.json(await loadList(id));
  }));

  // Edit or tick an item. { qty?, unit?, notes?, status? }
  app.patch("/api/stock/items/:id", asyncRoute(async (req: any, res: any) => {
    const id = Number(req.params.id);
    const b = req.body || {};
    const updates: any = { updated_at: nowIso() };
    if (b.qty !== undefined) {
      if (!(Number(b.qty) > 0)) return res.status(400).json({ error: "Quantity must be more than 0" });
      updates.qty = Number(b.qty);
    }
    if (b.unit !== undefined) updates.unit = String(b.unit || "").trim();
    if (b.notes !== undefined) updates.notes = b.notes || null;
    if (b.status !== undefined) {
      if (!["requested", "collected", "unavailable", "cancelled"].includes(b.status)) return res.status(400).json({ error: "Invalid status" });
      updates.status = b.status;
      const who = await staffName(req);
      updates.handled_by = b.status === "requested" ? null : who;
      updates.handled_at = b.status === "requested" ? null : updates.updated_at;
      if (b.status === "requested") updates.alerted_at = null;
    }
    const { data, error } = await supabase.from("stock_requests").update(updates).eq("id", id).select().single();
    if (error) return res.status(500).json({ error: error.message });

    // Driver couldn't get it: tell the chefs straight away
    let alert: any = null;
    if (b.status === "unavailable" && data.list_id) {
      const { data: list } = await supabase.from("stock_lists").select("supplier_name").eq("id", data.list_id).single();
      alert = await sendTeamWhatsApp(buildChefAlert(
        `Heads up chefs. ${updates.handled_by || "The driver"} couldn't get this from ${list?.supplier_name || "the supplier"}:`, [data]));
      if (alert.ok) await supabase.from("stock_requests").update({ alerted_at: nowIso() }).eq("id", id);
    }
    res.json({ ...data, alert });
  }));

  app.delete("/api/stock/items/:id", asyncRoute(async (req: any, res: any) => {
    const id = Number(req.params.id);
    const { data: item } = await supabase.from("stock_requests").select("list_id").eq("id", id).single();
    const { error } = await supabase.from("stock_requests").delete().eq("id", id);
    if (error) return res.status(500).json({ error: error.message });
    // Remove an empty draft list
    if (item?.list_id) {
      const { count } = await supabase.from("stock_requests").select("id", { count: "exact", head: true }).eq("list_id", item.list_id);
      if (!count) await supabase.from("stock_lists").delete().eq("id", item.list_id).eq("status", "draft");
    }
    res.json({ ok: true });
  }));

  // Delete a draft, or cancel a sent list
  app.delete("/api/stock/lists/:id", asyncRoute(async (req: any, res: any) => {
    const id = Number(req.params.id);
    const { data: list } = await supabase.from("stock_lists").select("status").eq("id", id).single();
    if (!list) return res.json({ ok: true });
    if (list.status === "draft") {
      await supabase.from("stock_lists").delete().eq("id", id);
    } else {
      const now = nowIso();
      await supabase.from("stock_lists").update({ status: "cancelled", completed_by: await staffName(req), completed_at: now, updated_at: now }).eq("id", id);
      await supabase.from("stock_requests").update({ status: "cancelled", updated_at: now }).eq("list_id", id).in("status", ["requested", "ordered"]);
    }
    res.json({ ok: true });
  }));

  // Email draft for a list
  app.get("/api/stock/lists/:id/email", asyncRoute(async (req: any, res: any) => {
    const list = await loadList(Number(req.params.id));
    if (!list) return res.status(404).json({ error: "List not found" });
    const { data: supplier } = await supabase.from("suppliers").select("*").eq("id", list.supplier_id).single();
    const { subject, body } = buildSupplierEmail(supplier, list.items);
    const to = supplier?.email || (String(supplier?.order_contact || "").includes("@") ? supplier.order_contact : "");
    res.json({ supplier, to, subject, body, emailConfigured: smtpConfig().configured });
  }));

  // Send a draft list.
  // Driver:   { method: 'driver', collectBy: 'YYYY-MM-DD' }
  // Supplier: { method: 'delivery', mode: 'email' | 'manual', to, subject, body, saveEmail }
  app.post("/api/stock/lists/:id/send", asyncRoute(async (req: any, res: any) => {
    const id = Number(req.params.id);
    const b = req.body || {};
    const list = await loadList(id);
    if (!list) return res.status(404).json({ error: "List not found" });
    if (list.status !== "draft") return res.status(400).json({ error: "This list has already been sent" });
    if (!list.items.length) return res.status(400).json({ error: "This list is empty" });
    const who = await staffName(req);
    const now = nowIso();

    if (b.method === "driver") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.collectBy || ""))) return res.status(400).json({ error: "Pick a collection date for the drivers" });
      await supabase.from("stock_lists").update({ status: "driver", method: "driver", collect_by: b.collectBy, sent_by: who, sent_at: now, sent_via: "driver", updated_at: now }).eq("id", id);
      await supabase.from("stock_requests").update({ method: "driver", updated_at: now }).eq("list_id", id);
      const alert = await sendDriversWhatsApp(
        `Shopping List has been created for *${list.supplier_name}* for collection by *${dayLabel(b.collectBy)}*.\n\n` +
        `${list.items.length} item${list.items.length > 1 ? "s" : ""}. Open the Deli App and go to Stock Ordering, Driver run.`);
      return res.json({ ok: true, alert });
    }

    if (b.method === "delivery") {
      const { data: supplier } = await supabase.from("suppliers").select("*").eq("id", list.supplier_id).single();
      if (b.mode === "email") {
        const addr = String(b.to || "").trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) return res.status(400).json({ error: "Enter a valid email address for this supplier" });
        if (/[–—]/.test(`${b.subject}${b.body}`)) return res.status(400).json({ error: "Please remove dashes (– or —) before sending" });
        await sendOrderEmail(addr, b.subject, b.body);
        if (b.saveEmail && supplier && addr !== supplier.email) await supabase.from("suppliers").update({ email: addr }).eq("id", supplier.id);
      }
      await supabase.from("stock_lists").update({
        status: "ordered", method: "delivery", sent_by: who, sent_at: now, updated_at: now,
        sent_via: b.mode === "email" ? "email" : "manual", sent_to: b.mode === "email" ? b.to : null,
        email_subject: b.mode === "email" ? b.subject : null, email_body: b.mode === "email" ? b.body : null,
      }).eq("id", id);
      await supabase.from("stock_requests").update({ method: "delivery", status: "ordered", handled_by: who, handled_at: now, updated_at: now }).eq("list_id", id).eq("status", "requested");
      return res.json({ ok: true });
    }
    res.status(400).json({ error: "Choose driver run or supplier delivery" });
  }));

  // Driver finished the list: anything unticked is flagged and the chefs are told once
  app.post("/api/stock/lists/:id/finish", asyncRoute(async (req: any, res: any) => {
    const id = Number(req.params.id);
    const list = await loadList(id);
    if (!list) return res.status(404).json({ error: "List not found" });
    const who = (await staffName(req)) || "The driver";
    const now = nowIso();
    const missed = list.items.filter((i: any) => i.status === "requested");
    let alert: any = null;
    if (missed.length) {
      await supabase.from("stock_requests").update({ status: "unavailable", handled_by: who, handled_at: now, updated_at: now }).in("id", missed.map((i: any) => i.id));
      alert = await sendTeamWhatsApp(buildChefAlert(`Heads up chefs. ${who} has finished the ${list.supplier_name} list and didn't get these:`, missed));
      if (alert.ok) await supabase.from("stock_requests").update({ alerted_at: nowIso() }).in("id", missed.map((i: any) => i.id));
    }
    await supabase.from("stock_lists").update({ status: "completed", completed_by: who, completed_at: now, updated_at: now }).eq("id", id);
    res.json({ missed: missed.length, alert });
  }));

  // Supplier delivery complete. { arrivedIds: [] } — anything else is short and alerts the chefs
  app.post("/api/stock/lists/:id/delivered", asyncRoute(async (req: any, res: any) => {
    const id = Number(req.params.id);
    const list = await loadList(id);
    if (!list) return res.status(404).json({ error: "List not found" });
    const arrived = new Set((req.body?.arrivedIds || []).map(Number));
    const who = await staffName(req);
    const now = nowIso();
    const open = list.items.filter((i: any) => i.status === "ordered");
    const got = open.filter((i: any) => arrived.has(i.id));
    const short = open.filter((i: any) => !arrived.has(i.id));
    if (got.length) await supabase.from("stock_requests").update({ status: "received", handled_by: who, handled_at: now, updated_at: now }).in("id", got.map((i: any) => i.id));
    let alert: any = null;
    if (short.length) {
      await supabase.from("stock_requests").update({ status: "unavailable", handled_by: who, handled_at: now, updated_at: now }).in("id", short.map((i: any) => i.id));
      alert = await sendTeamWhatsApp(buildChefAlert(`Heads up chefs. The ${list.supplier_name} delivery came in short:`, short));
      if (alert.ok) await supabase.from("stock_requests").update({ alerted_at: nowIso() }).in("id", short.map((i: any) => i.id));
    }
    await supabase.from("stock_lists").update({ status: "completed", completed_by: who, completed_at: now, updated_at: now }).eq("id", id);
    res.json({ received: got.length, short: short.length, alert });
  }));

  // Items nobody could get, still to be sorted
  app.get("/api/stock/unavailable", asyncRoute(async (_req: any, res: any) => {
    const { data, error } = await supabase.from("stock_requests").select("*").eq("status", "unavailable").order("handled_at", { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  }));

  // ── Supplier ordering settings ──
  app.get("/api/stock/suppliers", asyncRoute(async (_req: any, res: any) => {
    const { data, error } = await supabase.from("suppliers").select("id,name,email,contact_name,collection_method,parent_supplier_id").order("name");
    if (error) return res.status(500).json({ error: error.message });
    res.json({ suppliers: data || [], emailConfigured: smtpConfig().configured, emailFrom: smtpConfig().from || null });
  }));

  app.patch("/api/stock/suppliers/:id", asyncRoute(async (req: any, res: any) => {
    const id = Number(req.params.id);
    const b = req.body || {};
    const updates: any = {};
    if (b.collectionMethod !== undefined) {
      if (!["driver", "delivery"].includes(b.collectionMethod)) return res.status(400).json({ error: "Invalid method" });
      updates.collection_method = b.collectionMethod;
    }
    if (b.email !== undefined) updates.email = String(b.email || "").trim() || null;
    if (b.contactName !== undefined) updates.contact_name = String(b.contactName || "").trim() || null;
    const { data, error } = await supabase.from("suppliers").update(updates).eq("id", id).select("id,name,email,contact_name,collection_method").single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  }));
}
