// ─── Stock Ordering (v2) ───────────────────────────────────────────────────────
// One shared list of stock requests. Each request belongs to a supplier and is
// either collected by a driver ("driver") or delivered by the supplier
// ("delivery"). Drivers tick items off; anything they can't get alerts the
// chefs on WhatsApp. Delivery items are sent to the supplier as an email.
//
// Tables: stock_requests, stock_supplier_orders, suppliers.collection_method
import type { Express } from "express";
import nodemailer from "nodemailer";
import supabase from "./supabase";

type SendWhatsApp = (message: string) => Promise<{ ok: boolean; error?: string }>;

const KITCHEN_ADDRESS = "9A/2 Powell St, Osborne Park WA 6017";
const KITCHEN_PHONE = "08 6107 5799";
const OPEN_STATUSES = ["requested", "ordered", "unavailable"];

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

// Perth "today" for subject lines, e.g. "Wed 14 Oct"
function perthDateLabel(d = new Date()) {
  return d.toLocaleDateString("en-AU", { timeZone: "Australia/Perth", weekday: "short", day: "numeric", month: "short" });
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

// ── Supplier email template ───────────────────────────────────────────────────
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

// ── Chef alert message ────────────────────────────────────────────────────────
function buildAlert(heading: string, rows: any[]) {
  const bySupplier: Record<string, any[]> = {};
  for (const r of rows) (bySupplier[r.supplier_name || "No supplier"] ||= []).push(r);
  const parts = [heading, ""];
  for (const [sup, list] of Object.entries(bySupplier)) {
    parts.push(`*${sup}*`);
    for (const r of list) parts.push(`• ${r.item_name} (${qtyLabel(r)})`);
    parts.push("");
  }
  parts.push("Please order these from somewhere else. Details are in the app under Stock Ordering.");
  return parts.join("\n");
}

// Attach supplier info (name, email, contact) and the supplier's code for each item
async function enrich(rows: any[]) {
  if (!rows.length) return rows;
  const supIds = Array.from(new Set(rows.map((r) => r.supplier_id).filter(Boolean)));
  const ingIds = Array.from(new Set(rows.map((r) => r.ingredient_id).filter(Boolean)));
  const [{ data: sups }, { data: sis }] = await Promise.all([
    supIds.length ? supabase.from("suppliers").select("id,name,email,contact_name,order_contact,how_to_order").in("id", supIds) : Promise.resolve({ data: [] as any[] }),
    ingIds.length ? supabase.from("supplier_ingredients").select("ingredient_id,supplier_id,supplier_sku,supplier_ingredient_name").in("ingredient_id", ingIds) : Promise.resolve({ data: [] as any[] }),
  ]);
  const supMap = new Map((sups || []).map((s: any) => [s.id, s]));
  return rows.map((r) => {
    const s: any = supMap.get(r.supplier_id);
    const si: any = (sis || []).find((x: any) => x.ingredient_id === r.ingredient_id && x.supplier_id === r.supplier_id);
    return {
      ...r,
      supplier_name: s?.name ?? null,
      sku: si?.supplier_sku || null,
      supplier_item_name: si?.supplier_ingredient_name || null,
    };
  });
}

export function registerStockRoutes(app: Express, sendTeamWhatsApp: SendWhatsApp) {
  // Catalogue for the "add item" search: ingredients plus the suppliers that sell them
  app.get("/api/stock/catalogue", asyncRoute(async (_req: any, res: any) => {
    const [{ data: ings, error: e1 }, { data: sis, error: e2 }, { data: sups, error: e3 }] = await Promise.all([
      supabase.from("ingredients").select("id,name,unit,category,best_supplier_id").order("name"),
      supabase.from("supplier_ingredients").select("ingredient_id,supplier_id,supplier_sku,supplier_ingredient_name,unit_size_qty,unit_size_unit,pack_size,is_preferred"),
      supabase.from("suppliers").select("id,name,collection_method").order("name"),
    ]);
    if (e1 || e2 || e3) return res.status(500).json({ error: (e1 || e2 || e3)!.message });
    const supMap = new Map((sups || []).map((s: any) => [s.id, s]));
    const byIng: Record<number, any[]> = {};
    for (const si of sis || []) {
      const s: any = supMap.get(si.supplier_id);
      if (!s) continue;
      (byIng[si.ingredient_id] ||= []).push({
        supplierId: s.id, supplierName: s.name, method: s.collection_method,
        sku: si.supplier_sku || null, supplierItemName: si.supplier_ingredient_name || null,
        pack: si.unit_size_qty ? `${si.unit_size_qty}${si.unit_size_unit || ""}` : null,
        preferred: !!si.is_preferred,
      });
    }
    res.json((ings || []).map((i: any) => {
      const options = (byIng[i.id] || []).sort((a, b) =>
        Number(b.preferred) - Number(a.preferred) || Number(b.supplierId === i.best_supplier_id) - Number(a.supplierId === i.best_supplier_id));
      return { ingredientId: i.id, name: i.name, unit: i.unit, category: i.category, suppliers: options };
    }));
  }));

  // Requests. ?scope=open (default) or ?scope=history (last 30 days, closed)
  app.get("/api/stock/requests", asyncRoute(async (req: any, res: any) => {
    const scope = req.query.scope === "history" ? "history" : "open";
    let q = supabase.from("stock_requests").select("*");
    if (scope === "open") q = q.in("status", OPEN_STATUSES).order("requested_at", { ascending: true });
    else {
      const since = new Date(Date.now() - 30 * 86400000).toISOString();
      q = q.not("status", "in", `(${OPEN_STATUSES.join(",")})`).gte("updated_at", since).order("updated_at", { ascending: false }).limit(300);
    }
    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    res.json(await enrich(data || []));
  }));

  // Add an item. If the same item is already waiting for the same supplier, top up the qty.
  app.post("/api/stock/requests", asyncRoute(async (req: any, res: any) => {
    const { ingredientId, itemName, qty, unit, supplierId, method, notes } = req.body || {};
    const name = String(itemName || "").trim();
    const amount = Number(qty);
    if (!name) return res.status(400).json({ error: "Item name is required" });
    if (!(amount > 0)) return res.status(400).json({ error: "Quantity must be more than 0" });
    const who = await staffName(req);

    let resolvedMethod = method === "driver" || method === "delivery" ? method : null;
    if (!resolvedMethod && supplierId) {
      const { data: s } = await supabase.from("suppliers").select("collection_method").eq("id", supplierId).single();
      resolvedMethod = s?.collection_method || "delivery";
    }
    resolvedMethod ||= "delivery";

    let dupQ = supabase.from("stock_requests").select("*").eq("status", "requested").eq("method", resolvedMethod)
      .eq("unit", unit || "");
    dupQ = supplierId ? dupQ.eq("supplier_id", supplierId) : dupQ.is("supplier_id", null);
    dupQ = ingredientId ? dupQ.eq("ingredient_id", ingredientId) : dupQ.ilike("item_name", name);
    const { data: dups } = await dupQ.limit(1);
    const now = new Date().toISOString();

    if (dups && dups.length) {
      const d = dups[0];
      const mergedNotes = [d.notes, notes].filter(Boolean).join(". ") || null;
      const { data, error } = await supabase.from("stock_requests")
        .update({ qty: Number(d.qty) + amount, notes: mergedNotes, updated_at: now }).eq("id", d.id).select().single();
      if (error) return res.status(500).json({ error: error.message });
      return res.json({ ...data, merged: true });
    }
    const { data, error } = await supabase.from("stock_requests").insert({
      ingredient_id: ingredientId || null, item_name: name, qty: amount, unit: unit || "",
      supplier_id: supplierId || null, method: resolvedMethod, notes: notes || null,
      requested_by: who, status: "requested", updated_at: now,
    }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  }));

  // Edit an item, or change its status (collected / unavailable / requested / received / cancelled)
  app.patch("/api/stock/requests/:id", asyncRoute(async (req: any, res: any) => {
    const id = Number(req.params.id);
    const b = req.body || {};
    const updates: any = { updated_at: new Date().toISOString() };
    if (b.qty !== undefined) {
      if (!(Number(b.qty) > 0)) return res.status(400).json({ error: "Quantity must be more than 0" });
      updates.qty = Number(b.qty);
    }
    if (b.unit !== undefined) updates.unit = b.unit;
    if (b.notes !== undefined) updates.notes = b.notes || null;
    if (b.supplierId !== undefined) updates.supplier_id = b.supplierId || null;
    if (b.method !== undefined) {
      if (!["driver", "delivery"].includes(b.method)) return res.status(400).json({ error: "Invalid method" });
      updates.method = b.method;
    }
    if (b.status !== undefined) {
      const allowed = ["requested", "collected", "unavailable", "received", "cancelled"];
      if (!allowed.includes(b.status)) return res.status(400).json({ error: "Invalid status" });
      updates.status = b.status;
      updates.handled_by = await staffName(req);
      updates.handled_at = updates.updated_at;
      if (b.status === "requested") { updates.alerted_at = null; updates.supplier_order_id = null; updates.handled_by = null; updates.handled_at = null; }
    }
    const { data, error } = await supabase.from("stock_requests").update(updates).eq("id", id).select().single();
    if (error) return res.status(500).json({ error: error.message });

    // Driver marks something as unavailable: tell the chefs straight away
    let alert: any = null;
    if (b.status === "unavailable") {
      const [row] = await enrich([data]);
      const who = updates.handled_by || "The driver";
      alert = await sendTeamWhatsApp(buildAlert(`Heads up chefs. ${who} couldn't get this:`, [row]));
      if (alert.ok) await supabase.from("stock_requests").update({ alerted_at: new Date().toISOString() }).eq("id", id);
    }
    res.json({ ...data, alert });
  }));

  // Remove an item that hasn't been ordered yet
  app.delete("/api/stock/requests/:id", asyncRoute(async (req: any, res: any) => {
    const id = Number(req.params.id);
    const { error } = await supabase.from("stock_requests").delete().eq("id", id).in("status", ["requested", "unavailable", "cancelled"]);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  }));

  // Driver finishes their run: anything still unticked is flagged and the chefs are told.
  // Optional { supplierIds: [] } limits it to the shops the driver went to.
  app.post("/api/stock/driver/finish", asyncRoute(async (req: any, res: any) => {
    const who = (await staffName(req)) || "The driver";
    const supplierIds: number[] = Array.isArray(req.body?.supplierIds) ? req.body.supplierIds.map(Number) : [];
    let q = supabase.from("stock_requests").select("*").eq("method", "driver").eq("status", "requested");
    if (supplierIds.length) q = q.in("supplier_id", supplierIds);
    const { data: missed, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    if (!missed?.length) return res.json({ missed: [], alert: null });

    const now = new Date().toISOString();
    const ids = missed.map((r: any) => r.id);
    await supabase.from("stock_requests").update({ status: "unavailable", handled_by: who, handled_at: now, updated_at: now }).in("id", ids);
    const rows = await enrich(missed);
    const alert = await sendTeamWhatsApp(buildAlert(`Heads up chefs. ${who} has finished the run and didn't get these:`, rows));
    if (alert.ok) await supabase.from("stock_requests").update({ alerted_at: new Date().toISOString() }).in("id", ids);
    res.json({ missed: rows, alert });
  }));

  // Email draft for one supplier's waiting delivery items
  app.get("/api/stock/supplier-orders/preview/:supplierId", asyncRoute(async (req: any, res: any) => {
    const supplierId = Number(req.params.supplierId);
    const [{ data: supplier }, { data: rows }] = await Promise.all([
      supabase.from("suppliers").select("*").eq("id", supplierId).single(),
      supabase.from("stock_requests").select("*").eq("supplier_id", supplierId).eq("method", "delivery").eq("status", "requested").order("item_name"),
    ]);
    if (!supplier) return res.status(404).json({ error: "Supplier not found" });
    const items = await enrich(rows || []);
    const { subject, body } = buildSupplierEmail(supplier, items);
    const to = supplier.email || (String(supplier.order_contact || "").includes("@") ? supplier.order_contact : "");
    res.json({ supplier, items, to, subject, body, emailConfigured: smtpConfig().configured });
  }));

  // Send (or record) a supplier order and mark its items as ordered.
  // { supplierId, requestIds, to, subject, body, mode: 'email' | 'manual', saveEmail?: boolean }
  app.post("/api/stock/supplier-orders", asyncRoute(async (req: any, res: any) => {
    const { supplierId, requestIds, to, subject, body, mode, saveEmail } = req.body || {};
    if (!supplierId || !Array.isArray(requestIds) || !requestIds.length) return res.status(400).json({ error: "Nothing to order" });
    const { data: supplier } = await supabase.from("suppliers").select("*").eq("id", supplierId).single();
    if (!supplier) return res.status(404).json({ error: "Supplier not found" });
    const who = await staffName(req);

    if (mode === "email") {
      const addr = String(to || "").trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) return res.status(400).json({ error: "Enter a valid email address for this supplier" });
      if (/[–—]/.test(`${subject}${body}`)) return res.status(400).json({ error: "Please remove dashes (– or —) before sending" });
      await sendOrderEmail(addr, subject, body);
      if (saveEmail && addr !== supplier.email) await supabase.from("suppliers").update({ email: addr }).eq("id", supplierId);
    }

    const { data: order, error } = await supabase.from("stock_supplier_orders").insert({
      supplier_id: supplierId, supplier_name: supplier.name,
      sent_to: mode === "email" ? to : null, subject, body,
      sent_by: who, sent_via: mode === "email" ? "email" : "manual",
    }).select().single();
    if (error) return res.status(500).json({ error: error.message });

    const now = new Date().toISOString();
    const { error: e2 } = await supabase.from("stock_requests")
      .update({ status: "ordered", supplier_order_id: order.id, handled_by: who, handled_at: now, updated_at: now })
      .in("id", requestIds.map(Number)).eq("status", "requested");
    if (e2) return res.status(500).json({ error: e2.message });
    res.json(order);
  }));

  // Supplier orders still waiting to arrive, with their items
  app.get("/api/stock/supplier-orders", asyncRoute(async (_req: any, res: any) => {
    const { data: orders, error } = await supabase.from("stock_supplier_orders").select("*")
      .eq("status", "sent").order("sent_at", { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    const ids = (orders || []).map((o: any) => o.id);
    const { data: items } = ids.length
      ? await supabase.from("stock_requests").select("*").in("supplier_order_id", ids)
      : { data: [] as any[] };
    const enriched = await enrich(items || []);
    res.json((orders || []).map((o: any) => ({ ...o, items: enriched.filter((i: any) => i.supplier_order_id === o.id) })));
  }));

  // Delivery arrived. { arrivedIds: [] } — every other item on the order is short and alerts the chefs.
  app.post("/api/stock/supplier-orders/:id/receive", asyncRoute(async (req: any, res: any) => {
    const orderId = Number(req.params.id);
    const arrived = new Set((req.body?.arrivedIds || []).map(Number));
    const who = await staffName(req);
    const now = new Date().toISOString();
    const { data: items } = await supabase.from("stock_requests").select("*").eq("supplier_order_id", orderId).eq("status", "ordered");
    const got = (items || []).filter((i: any) => arrived.has(i.id)).map((i: any) => i.id);
    const short = (items || []).filter((i: any) => !arrived.has(i.id));
    if (got.length) await supabase.from("stock_requests").update({ status: "received", handled_by: who, handled_at: now, updated_at: now }).in("id", got);
    let alert: any = null;
    if (short.length) {
      await supabase.from("stock_requests").update({ status: "unavailable", handled_by: who, handled_at: now, updated_at: now }).in("id", short.map((i: any) => i.id));
      const rows = await enrich(short);
      alert = await sendTeamWhatsApp(buildAlert(`Heads up chefs. ${rows[0]?.supplier_name || "A supplier"} delivery came in short:`, rows));
      if (alert.ok) await supabase.from("stock_requests").update({ alerted_at: new Date().toISOString() }).in("id", short.map((i: any) => i.id));
    }
    await supabase.from("stock_supplier_orders").update({ status: "received", received_at: now, received_by: who }).eq("id", orderId);
    res.json({ received: got.length, short: short.length, alert });
  }));

  // Supplier ordering settings: pickup or delivery, plus order email
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

  app.get("/api/stock/suppliers", asyncRoute(async (_req: any, res: any) => {
    const { data, error } = await supabase.from("suppliers").select("id,name,email,contact_name,collection_method,parent_supplier_id").order("name");
    if (error) return res.status(500).json({ error: error.message });
    res.json({ suppliers: data || [], emailConfigured: smtpConfig().configured, emailFrom: smtpConfig().from || null });
  }));
}
