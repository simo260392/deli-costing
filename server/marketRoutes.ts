// ─── Markets ordering ─────────────────────────────────────────────────────────
// At the markets each supplier has several sales reps, each selling different produce.
// Setup: produce list (ingredients.market_item), market suppliers (suppliers.is_market),
// reps (market_reps) and what each rep sells (market_rep_items, one preferred rep per item).
// Ordering: anyone builds the order; each item defaults to its preferred rep and can be
// switched. The app writes one text per rep (sent from the person's own phone). If a rep is
// out, the item is marked unavailable and re-sent to another rep. Finally the order goes onto
// the driver run as one stock list per supplier, with the rep's name on each line.
//
// Tables: market_reps, market_rep_items, market_orders, market_order_items
// Writes driver lists into stock_lists / stock_requests (see stockRoutes.ts).
import type { Express } from "express";
import supabase from "./supabase";
import { sendDriversWhatsApp } from "./stockRoutes";

const asyncRoute = (fn: any) => (req: any, res: any, next: any) =>
  Promise.resolve(fn(req, res, next)).catch((e: any) => {
    console.error("[markets] route error:", e?.message || e);
    if (!res.headersSent) res.status(e?.status || 500).json({ error: e?.message || "Internal server error" });
  });
const fail = (status: number, message: string) => Object.assign(new Error(message), { status });
const nowIso = () => new Date().toISOString();

/** Logged-in staff with Stock Ordering in their access level. */
async function requireStockAccess(req: any, res: any, next: any) {
  const staffId = req.session?.staffId;
  if (!staffId) return res.status(401).json({ error: "Please log in" });
  const { data: staff } = await supabase.from("staff").select("name, access_level_id, is_active").eq("id", staffId).single();
  if (!staff?.is_active) return res.status(401).json({ error: "Please log in" });
  const { data: level } = await supabase.from("access_levels").select("pages_json").eq("id", staff.access_level_id).single();
  let pages: string[] = [];
  try { pages = JSON.parse(level?.pages_json || "[]"); } catch {}
  if (!pages.includes("stock-order")) return res.status(403).json({ error: "You don't have access to stock ordering" });
  req.staffName = staff.name;
  next();
}

const dayLabel = (ymd: string) =>
  new Date(`${ymd}T12:00:00+08:00`).toLocaleDateString("en-AU", { timeZone: "Australia/Perth", weekday: "short", day: "numeric", month: "short" });

/** Australian mobile to +61 form for sms: links; leaves anything else as typed (digits and +). */
export function normalisePhone(p: string | null | undefined): string | null {
  const d = String(p || "").replace(/[^\d+]/g, "");
  if (!d) return null;
  if (/^04\d{8}$/.test(d)) return `+61${d.slice(1)}`;
  if (/^614\d{8}$/.test(d)) return `+${d}`;
  return d;
}

// ─── Loading ─────────────────────────────────────────────────────────────────
async function loadSetup() {
  const [{ data: suppliers }, { data: reps }, { data: repItems }, { data: produce }] = await Promise.all([
    supabase.from("suppliers").select("id, name, is_market").eq("is_market", true).order("name"),
    supabase.from("market_reps").select("*").order("name"),
    supabase.from("market_rep_items").select("*"),
    supabase.from("ingredients").select("id, name, unit, category, market_item, market_order_unit, market_name").eq("market_item", true).order("name"),
  ]);
  // Latest price each market supplier charged for each produce item (from approved invoices)
  const ids = (produce || []).map((p: any) => p.id);
  const { data: prices } = ids.length
    ? await supabase.from("supplier_products").select("supplier_id, ingredient_id, last_unit_cost, last_invoice_date").in("ingredient_id", ids).not("last_unit_cost", "is", null)
    : { data: [] as any[] };
  return { suppliers: suppliers || [], reps: reps || [], repItems: repItems || [], produce: produce || [], prices: prices || [] };
}

async function loadOrder(id: number) {
  const { data: order } = await supabase.from("market_orders").select("*").eq("id", id).single();
  if (!order) return null;
  const { data: items } = await supabase.from("market_order_items").select("*").eq("order_id", id).order("item_name");
  return { ...order, items: items || [] };
}

async function currentOrder() {
  const { data } = await supabase.from("market_orders").select("id").in("status", ["draft", "texting"]).order("created_at", { ascending: false }).limit(1).maybeSingle();
  return data ? loadOrder(data.id) : null;
}

async function preferredRepFor(ingredientId: number | null): Promise<number | null> {
  if (!ingredientId) return null;
  const { data } = await supabase.from("market_rep_items").select("rep_id, is_preferred, market_reps!inner(active)").eq("ingredient_id", ingredientId).eq("market_reps.active", true);
  const rows = data || [];
  return (rows.find((r: any) => r.is_preferred) || rows[0])?.rep_id ?? null;
}

// ─── Routes ──────────────────────────────────────────────────────────────────
export function registerMarketRoutes(app: Express) {
  // Everything the Markets tab needs in one go
  app.get("/api/markets", requireStockAccess, asyncRoute(async (_req: any, res: any) => {
    const [setup, order] = await Promise.all([loadSetup(), currentOrder()]);
    const { data: recent } = await supabase.from("market_orders").select("id, collect_by, status, created_by, sent_to_driver_at").in("status", ["driver", "done"]).order("created_at", { ascending: false }).limit(5);
    res.json({ ...setup, order, recent: recent || [] });
  }));

  // ── Setup: produce list
  app.patch("/api/markets/produce/:id", requireStockAccess, asyncRoute(async (req: any, res: any) => {
    const update: any = {};
    if (typeof req.body?.marketItem === "boolean") update.market_item = req.body.marketItem;
    if (req.body?.orderUnit !== undefined) update.market_order_unit = String(req.body.orderUnit || "").trim() || null;
    if (req.body?.marketName !== undefined) update.market_name = String(req.body.marketName || "").trim() || null;
    const { error } = await supabase.from("ingredients").update(update).eq("id", Number(req.params.id));
    if (error) throw error;
    res.json({ ok: true });
  }));
  // Create a brand-new produce item straight onto the markets list. { name, orderUnit, unit }
  app.post("/api/markets/produce", requireStockAccess, asyncRoute(async (req: any, res: any) => {
    const name = String(req.body?.name || "").trim();
    if (!name) throw fail(400, "Enter the produce name");
    const unit = ["kg", "each", "L"].includes(req.body?.unit) ? req.body.unit : "kg";
    const orderUnit = String(req.body?.orderUnit || "").trim() || null;
    const { data: existing } = await supabase.from("ingredients").select("id").ilike("name", name).maybeSingle();
    if (existing) {
      await supabase.from("ingredients").update({ market_item: true, ...(orderUnit ? { market_order_unit: orderUnit } : {}) }).eq("id", existing.id);
      return res.json({ id: existing.id, existed: true });
    }
    const { data, error } = await supabase.from("ingredients").insert({
      name, unit, category: "Fruit & Veg", market_item: true, market_order_unit: orderUnit, dietaries_json: "[]",
    }).select("id").single();
    if (error) throw error;
    res.json({ id: data.id });
  }));

  // Ingredients not on the market list yet (to add)
  app.get("/api/markets/produce-candidates", requireStockAccess, asyncRoute(async (_req: any, res: any) => {
    const { data } = await supabase.from("ingredients").select("id, name, unit, category").eq("market_item", false).not("category", "in", "(Packaging)").order("name");
    res.json(data || []);
  }));

  // ── Setup: market suppliers
  app.post("/api/markets/suppliers", requireStockAccess, asyncRoute(async (req: any, res: any) => {
    const name = String(req.body?.name || "").trim();
    if (!name) throw fail(400, "Supplier name is required");
    const { data: existing } = await supabase.from("suppliers").select("id").ilike("name", name).maybeSingle();
    if (existing) {
      await supabase.from("suppliers").update({ is_market: true, collection_method: "driver" }).eq("id", existing.id);
      return res.json({ id: existing.id });
    }
    const { data, error } = await supabase.from("suppliers").insert({ name, is_market: true, collection_method: "driver" }).select("id").single();
    if (error) throw error;
    res.json({ id: data.id });
  }));
  app.patch("/api/markets/suppliers/:id", requireStockAccess, asyncRoute(async (req: any, res: any) => {
    const update: any = {};
    if (typeof req.body?.isMarket === "boolean") update.is_market = req.body.isMarket;
    if (req.body?.name) update.name = String(req.body.name).trim();
    const { error } = await supabase.from("suppliers").update(update).eq("id", Number(req.params.id));
    if (error) throw error;
    res.json({ ok: true });
  }));

  // ── Setup: reps
  app.post("/api/markets/reps", requireStockAccess, asyncRoute(async (req: any, res: any) => {
    const b = req.body || {};
    if (!String(b.name || "").trim()) throw fail(400, "Rep name is required");
    if (!Number(b.supplierId)) throw fail(400, "Pick the supplier this rep works for");
    const { data, error } = await supabase.from("market_reps").insert({
      name: String(b.name).trim(), supplier_id: Number(b.supplierId), phone: normalisePhone(b.phone), notes: b.notes || null,
    }).select("id").single();
    if (error) throw error;
    res.json({ id: data.id });
  }));
  app.patch("/api/markets/reps/:id", requireStockAccess, asyncRoute(async (req: any, res: any) => {
    const b = req.body || {};
    const update: any = {};
    if (b.name !== undefined) update.name = String(b.name).trim();
    if (b.supplierId !== undefined) update.supplier_id = Number(b.supplierId);
    if (b.phone !== undefined) update.phone = normalisePhone(b.phone);
    if (b.notes !== undefined) update.notes = b.notes || null;
    if (typeof b.active === "boolean") update.active = b.active;
    const { error } = await supabase.from("market_reps").update(update).eq("id", Number(req.params.id));
    if (error) throw error;
    // A rep who leaves stops being anyone's preferred rep
    if (b.active === false) await supabase.from("market_rep_items").update({ is_preferred: false }).eq("rep_id", Number(req.params.id));
    res.json({ ok: true });
  }));

  // What a rep sells: replace the whole list. { ingredientIds: [] }
  app.put("/api/markets/reps/:id/items", requireStockAccess, asyncRoute(async (req: any, res: any) => {
    const repId = Number(req.params.id);
    const want = new Set<number>((req.body?.ingredientIds || []).map(Number).filter(Boolean));
    const { data: have } = await supabase.from("market_rep_items").select("id, ingredient_id").eq("rep_id", repId);
    const remove = (have || []).filter((h: any) => !want.has(h.ingredient_id)).map((h: any) => h.id);
    const add = Array.from(want).filter((iid) => !(have || []).some((h: any) => h.ingredient_id === iid));
    if (remove.length) await supabase.from("market_rep_items").delete().in("id", remove);
    if (add.length) {
      // First rep for an item becomes its preferred rep
      const { data: taken } = await supabase.from("market_rep_items").select("ingredient_id").in("ingredient_id", add).eq("is_preferred", true);
      const hasPref = new Set((taken || []).map((t: any) => t.ingredient_id));
      const { error } = await supabase.from("market_rep_items").insert(add.map((iid) => ({ rep_id: repId, ingredient_id: iid, is_preferred: !hasPref.has(iid) })));
      if (error) throw error;
    }
    res.json({ ok: true, added: add.length, removed: remove.length });
  }));

  // Make a rep the preferred one for an item. { ingredientId, repId }
  app.post("/api/markets/preferred", requireStockAccess, asyncRoute(async (req: any, res: any) => {
    const ingredientId = Number(req.body?.ingredientId), repId = Number(req.body?.repId);
    if (!ingredientId || !repId) throw fail(400, "ingredientId and repId are required");
    await supabase.from("market_rep_items").update({ is_preferred: false }).eq("ingredient_id", ingredientId);
    const { data: row } = await supabase.from("market_rep_items").select("id").eq("ingredient_id", ingredientId).eq("rep_id", repId).maybeSingle();
    if (row) await supabase.from("market_rep_items").update({ is_preferred: true }).eq("id", row.id);
    else await supabase.from("market_rep_items").insert({ ingredient_id: ingredientId, rep_id: repId, is_preferred: true });
    res.json({ ok: true });
  }));

  // ── Ordering
  // Start (or reuse) the open order. { collectBy }
  app.post("/api/markets/orders", requireStockAccess, asyncRoute(async (req: any, res: any) => {
    const existing = await currentOrder();
    if (existing) return res.json(existing);
    const collectBy = String(req.body?.collectBy || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(collectBy)) throw fail(400, "Pick the collection date");
    const { data, error } = await supabase.from("market_orders").insert({ collect_by: collectBy, created_by: req.staffName }).select("id").single();
    if (error) throw error;
    res.json(await loadOrder(data.id));
  }));

  app.patch("/api/markets/orders/:id", requireStockAccess, asyncRoute(async (req: any, res: any) => {
    const update: any = { updated_at: nowIso() };
    if (req.body?.collectBy && /^\d{4}-\d{2}-\d{2}$/.test(req.body.collectBy)) update.collect_by = req.body.collectBy;
    if (req.body?.notes !== undefined) update.notes = req.body.notes || null;
    if (req.body?.cancel === true) update.status = "cancelled";
    const { error } = await supabase.from("market_orders").update(update).eq("id", Number(req.params.id)).in("status", ["draft", "texting"]);
    if (error) throw error;
    res.json(await loadOrder(Number(req.params.id)));
  }));

  // Set quantities: [{ ingredientId?, itemName, qty, unit, repId? }] — qty 0 removes an untexted line
  app.put("/api/markets/orders/:id/items", requireStockAccess, asyncRoute(async (req: any, res: any) => {
    const orderId = Number(req.params.id);
    const order = await loadOrder(orderId);
    if (!order || !["draft", "texting"].includes(order.status)) throw fail(400, "This order is closed");
    const rows: any[] = Array.isArray(req.body?.items) ? req.body.items : [];
    const now = nowIso();
    for (const r of rows) {
      const ingredientId = r.ingredientId ? Number(r.ingredientId) : null;
      const name = String(r.itemName || "").trim();
      if (!name) continue;
      const qty = Number(r.qty) || 0;
      // The editable line for this item: the one not yet texted
      const line = order.items.find((i: any) => (ingredientId ? i.ingredient_id === ingredientId : !i.ingredient_id && i.item_name.toLowerCase() === name.toLowerCase()) && i.status === "pending");
      if (qty <= 0) { if (line) await supabase.from("market_order_items").delete().eq("id", line.id); continue; }
      const repId = r.repId !== undefined ? (r.repId ? Number(r.repId) : null) : line?.rep_id ?? (await preferredRepFor(ingredientId));
      if (line) {
        await supabase.from("market_order_items").update({ qty, unit: r.unit ?? line.unit, rep_id: repId, notes: r.notes ?? line.notes, updated_at: now }).eq("id", line.id);
      } else {
        await supabase.from("market_order_items").insert({ order_id: orderId, ingredient_id: ingredientId, item_name: name, qty, unit: r.unit || null, rep_id: repId, notes: r.notes || null, added_by: req.staffName });
      }
    }
    await supabase.from("market_orders").update({ updated_at: now }).eq("id", orderId);
    res.json(await loadOrder(orderId));
  }));

  // Change one line's rep (before texting). { repId }
  app.patch("/api/markets/items/:id", requireStockAccess, asyncRoute(async (req: any, res: any) => {
    const id = Number(req.params.id);
    const { data: item } = await supabase.from("market_order_items").select("*").eq("id", id).single();
    if (!item) throw fail(404, "Item not found");
    const update: any = { updated_at: nowIso() };
    if (req.body?.repId !== undefined) {
      if (item.status !== "pending") throw fail(400, "This item has already been texted. Mark it out of stock to send it to another rep.");
      update.rep_id = req.body.repId ? Number(req.body.repId) : null;
    }
    if (req.body?.qty !== undefined && item.status === "pending") update.qty = Number(req.body.qty);
    if (req.body?.unit !== undefined && item.status === "pending") update.unit = req.body.unit || null;
    if (req.body?.cancel === true) update.status = "cancelled";
    await supabase.from("market_order_items").update(update).eq("id", id);
    res.json(await loadOrder(item.order_id));
  }));

  // Mark a rep's items as texted. { itemIds: [] }
  app.post("/api/markets/orders/:id/texted", requireStockAccess, asyncRoute(async (req: any, res: any) => {
    const orderId = Number(req.params.id);
    const ids: number[] = (req.body?.itemIds || []).map(Number).filter(Boolean);
    if (!ids.length) throw fail(400, "Nothing to mark as texted");
    const now = nowIso();
    await supabase.from("market_order_items").update({ status: "texted", texted_by: req.staffName, texted_at: now, updated_at: now }).in("id", ids).eq("order_id", orderId).eq("status", "pending");
    await supabase.from("market_orders").update({ status: "texting", updated_at: now }).eq("id", orderId).eq("status", "draft");
    res.json(await loadOrder(orderId));
  }));

  // Rep is out: mark unavailable and (optionally) send to another rep. { repId? }
  app.post("/api/markets/items/:id/unavailable", requireStockAccess, asyncRoute(async (req: any, res: any) => {
    const id = Number(req.params.id);
    const { data: item } = await supabase.from("market_order_items").select("*").eq("id", id).single();
    if (!item) throw fail(404, "Item not found");
    const now = nowIso();
    let replacement: any = null;
    if (req.body?.repId) {
      const { data } = await supabase.from("market_order_items").insert({
        order_id: item.order_id, ingredient_id: item.ingredient_id, item_name: item.item_name, qty: item.qty, unit: item.unit,
        rep_id: Number(req.body.repId), notes: item.notes, added_by: req.staffName,
      }).select("id").single();
      replacement = data;
    }
    await supabase.from("market_order_items").update({ status: "unavailable", replaced_by_item_id: replacement?.id ?? null, updated_at: now }).eq("id", id);
    res.json(await loadOrder(item.order_id));
  }));

  // Put the texted items on the driver run: one stock list per supplier
  app.post("/api/markets/orders/:id/to-driver", requireStockAccess, asyncRoute(async (req: any, res: any) => {
    const orderId = Number(req.params.id);
    const order = await loadOrder(orderId);
    if (!order || !["draft", "texting"].includes(order.status)) throw fail(400, "This order is closed");
    const texted = order.items.filter((i: any) => i.status === "texted");
    const notTexted = order.items.filter((i: any) => i.status === "pending");
    if (!texted.length) throw fail(400, "Text the reps first. Nothing has been sent yet.");
    if (notTexted.length && !req.body?.skipUntexted) throw fail(409, `${notTexted.length} item${notTexted.length > 1 ? "s haven't" : " hasn't"} been texted yet`);

    const repIds = Array.from(new Set(texted.map((i: any) => i.rep_id).filter(Boolean)));
    const { data: reps } = await supabase.from("market_reps").select("id, name, supplier_id, suppliers(name)").in("id", repIds);
    const repById = new Map((reps || []).map((r: any) => [r.id, r]));
    const bySupplier = new Map<number, any[]>();
    for (const i of texted) {
      const rep: any = repById.get(i.rep_id);
      if (!rep) continue;
      (bySupplier.get(rep.supplier_id) || bySupplier.set(rep.supplier_id, []).get(rep.supplier_id)!).push({ ...i, rep });
    }
    const now = nowIso();
    const listNames: string[] = [];
    for (const [supplierId, items] of Array.from(bySupplier.entries())) {
      const supplierName = items[0].rep.suppliers?.name || "Markets";
      const { data: list, error } = await supabase.from("stock_lists").insert({
        supplier_id: supplierId, supplier_name: supplierName, status: "driver", method: "driver", collect_by: order.collect_by,
        created_by: order.created_by, sent_by: req.staffName, sent_at: now, sent_via: "driver", updated_at: now,
      }).select("id").single();
      if (error || !list) throw new Error(error?.message || "Couldn't create the driver list");
      for (const i of items) {
        const { data: sr } = await supabase.from("stock_requests").insert({
          list_id: list.id, ingredient_id: i.ingredient_id, item_name: i.item_name, qty: i.qty, unit: i.unit, supplier_id: supplierId,
          method: "driver", status: "requested", requested_by: i.added_by || order.created_by,
          notes: [`from ${i.rep.name}`, i.notes].filter(Boolean).join(" · "), updated_at: now,
        }).select("id").single();
        if (sr) await supabase.from("market_order_items").update({ stock_request_id: sr.id }).eq("id", i.id);
      }
      listNames.push(`${supplierName} (${items.length})`);
    }
    if (notTexted.length) await supabase.from("market_order_items").update({ status: "cancelled", updated_at: now }).in("id", notTexted.map((i: any) => i.id));
    await supabase.from("market_orders").update({ status: "driver", sent_to_driver_by: req.staffName, sent_to_driver_at: now, updated_at: now }).eq("id", orderId);
    const alert = await sendDriversWhatsApp(
      `Markets order is on the driver run for *${dayLabel(order.collect_by)}*.\n\n${listNames.join("\n")}\n\nOpen the Deli App and go to Stock Ordering, Driver run.`);
    res.json({ ok: true, lists: listNames.length, alert });
  }));
}
