// ─── Reports ──────────────────────────────────────────────────────────────────
// Markets Price Tracker: for every market produce item, the latest price from each market
// supplier, who is cheapest right now, the 12-month average paid (from approved invoices)
// and how much we usually order (from texted market orders, else from invoices).
//
// Prices are compared per ingredient unit (per kg / each / bunch), which is what invoices
// are converted to when they're approved, so a box from one supplier and a crate from
// another can be compared fairly.
import type { Express } from "express";
import supabase from "./supabase";
import { periodFor } from "../shared/kpiPeriods";
import { waSeason } from "../shared/waSeasons";
import { xeroConnected, xeroExpenseAccounts, cogsAccountCodes, xeroCostOfGoods } from "./xeroRoutes";

const asyncRoute = (fn: any) => (req: any, res: any, next: any) =>
  Promise.resolve(fn(req, res, next)).catch((e: any) => {
    console.error("[reports] route error:", e?.message || e);
    if (!res.headersSent) res.status(e?.status || 500).json({ error: e?.message || "Internal server error" });
  });

/** Logged-in staff with Reports in their access level. */
async function requireReportsAccess(req: any, res: any, next: any) {
  const staffId = req.session?.staffId;
  if (!staffId) return res.status(401).json({ error: "Please log in" });
  const { data: staff } = await supabase.from("staff").select("name, access_level_id, is_active").eq("id", staffId).single();
  if (!staff?.is_active) return res.status(401).json({ error: "Please log in" });
  const { data: level } = await supabase.from("access_levels").select("pages_json").eq("id", staff.access_level_id).single();
  let pages: string[] = [];
  try { pages = JSON.parse(level?.pages_json || "[]"); } catch {}
  const isAdmin = await supabase.from("access_levels").select("name").eq("id", staff.access_level_id).single().then((r: any) => r.data?.name === "Admin");
  if (!isAdmin && !pages.includes("reports") && !(req.needsWages && pages.includes("wages"))) return res.status(403).json({ error: "You don't have access to reports" });
  next();
}

const num = (v: any): number | null => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
const round = (n: number | null, dp = 4) => (n == null ? null : Math.round(n * 10 ** dp) / 10 ** dp);

/** Fetch every row of a query in pages of 1000 (Supabase's default cap). */
async function all<T = any>(build: (from: number, to: number) => any): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if (!data || data.length < 1000) return out;
  }
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** The cheapest 3-month stretch of the year from our own prices; needs prices in at least 6 different months. */
function cheapestSeason(rows: any[]): { label: string; months: number } | null {
  const byMonth: number[][] = Array.from({ length: 12 }, () => []);
  for (const r of rows) {
    const c = num(r.unit_cost);
    if (c == null || !r.invoice_date) continue;
    byMonth[Number(String(r.invoice_date).slice(5, 7)) - 1]?.push(c);
  }
  const avg = byMonth.map((l) => (l.length ? l.reduce((s, x) => s + x, 0) / l.length : null));
  const covered = avg.filter((a) => a != null).length;
  if (covered < 6) return null;
  let best: { start: number; cost: number } | null = null;
  for (let m = 0; m < 12; m++) {
    const w = [avg[m], avg[(m + 1) % 12], avg[(m + 2) % 12]];
    if (w.some((a) => a == null)) continue;
    const cost = (w as number[]).reduce((s, x) => s + x, 0) / 3;
    if (!best || cost < best.cost) best = { start: m, cost };
  }
  return best ? { label: `${MONTHS[best.start]}–${MONTHS[(best.start + 2) % 12]}`, months: covered } : null;
}

export async function marketPriceReport() {
  const since = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);

  const [{ data: produce }, { data: suppliers }] = await Promise.all([
    supabase.from("ingredients").select("id, name, market_name, unit, market_order_unit").eq("market_item", true).order("name"),
    supabase.from("suppliers").select("id, name").eq("is_market", true).order("name"),
  ]);
  const ingIds = (produce || []).map((p: any) => p.id);
  const supIds = (suppliers || []).map((s: any) => s.id);
  if (!ingIds.length || !supIds.length) return { since, suppliers: suppliers || [], items: [] };

  const products = await all((a, b) => supabase.from("supplier_products")
    .select("id, supplier_id, ingredient_id, purchase_unit, base_qty_per_purchase, last_price_ex_gst, last_unit_cost, last_invoice_date, active")
    .in("ingredient_id", ingIds).in("supplier_id", supIds).range(a, b));
  const live = products.filter((p: any) => p.active !== false);
  const productIds = live.map((p: any) => p.id);

  const history = productIds.length ? await all((a, b) => supabase.from("supplier_price_history")
    .select("supplier_product_id, invoice_date, quantity, price_ex_gst, unit_cost")
    .in("supplier_product_id", productIds).gte("invoice_date", since).order("invoice_date").range(a, b)) : [];

  // Texted market order lines in the last 12 months
  const orders = await all((a, b) => supabase.from("market_orders").select("id, collect_by, status")
    .gte("collect_by", since).neq("status", "cancelled").range(a, b));
  const orderIds = orders.map((o: any) => o.id);
  const orderLines = orderIds.length ? await all((a, b) => supabase.from("market_order_items")
    .select("order_id, ingredient_id, qty, unit, status").in("order_id", orderIds).eq("status", "texted").range(a, b)) : [];
  const collectBy = new Map(orders.map((o: any) => [o.id, o.collect_by]));

  const supplierName = new Map((suppliers || []).map((s: any) => [s.id, s.name]));
  const productById = new Map(live.map((p: any) => [p.id, p]));
  const histByProduct = new Map<number, any[]>();
  for (const h of history) {
    const list = histByProduct.get(h.supplier_product_id) || [];
    list.push(h);
    histByProduct.set(h.supplier_product_id, list);
  }

  /** Quantity-weighted average of unit_cost (falls back to a plain average). */
  const avgCost = (rows: any[]) => {
    const priced = rows.filter((r) => num(r.unit_cost) != null);
    if (!priced.length) return null;
    const w = priced.map((r) => Math.max(num(r.quantity) ?? 1, 0) || 1);
    const tw = w.reduce((s, x) => s + x, 0);
    return priced.reduce((s, r, i) => s + num(r.unit_cost)! * w[i], 0) / tw;
  };

  const items = (produce || []).map((ing: any) => {
    const mine = live.filter((p: any) => p.ingredient_id === ing.id);

    // One row per supplier: markets suppliers use a new product code for each lot or day
    // ("BROCCOLI ICED WEDNESDAY"), so several of their products can map to one ingredient.
    const bySupplier = new Map<number, any[]>();
    for (const p of mine) bySupplier.set(p.supplier_id, [...(bySupplier.get(p.supplier_id) || []), p]);
    const offers = Array.from(bySupplier.entries()).map(([supplierId, prods]) => {
      const rows = prods.flatMap((p: any) => (histByProduct.get(p.id) || []).map((h: any) => ({ ...h, _p: p })))
        .sort((a: any, b: any) => String(a.invoice_date || "").localeCompare(String(b.invoice_date || "")));
      const last = rows[rows.length - 1];
      // Without invoices yet, fall back to the most recently priced product
      const fallback = [...prods].sort((a: any, b: any) => String(b.last_invoice_date || "").localeCompare(String(a.last_invoice_date || "")))
        .find((p: any) => num(p.last_unit_cost) != null);
      const prod = last?._p || fallback;
      const unitCost = last ? num(last.unit_cost) : num(fallback?.last_unit_cost);
      const packPrice = last ? num(last.price_ex_gst) : num(fallback?.last_price_ex_gst);
      return {
        supplierId,
        supplier: supplierName.get(supplierId) || "Unknown",
        unitCost: round(unitCost),
        packPrice: round(packPrice, 2),
        packUnit: prod?.purchase_unit || null,
        lastDate: last?.invoice_date || fallback?.last_invoice_date || null,
        avg12: round(avgCost(rows)),
        invoices12: rows.length,
      };
    }).filter((o: any) => o.unitCost != null)
      .sort((a: any, b: any) => a.unitCost - b.unitCost);

    const allRows = mine.flatMap((p: any) => histByProduct.get(p.id) || []);
    const avg12 = avgCost(allRows);
    const cheapest = offers[0] || null;
    const latest = [...offers].sort((a: any, b: any) => String(b.lastDate || "").localeCompare(String(a.lastDate || "")))[0] || null;

    // Average order size: from texted market orders, grouped by the unit ordered in
    const lines = orderLines.filter((l: any) => l.ingredient_id === ing.id && num(l.qty) != null);
    const byUnit = new Map<string, { qty: number; orders: Set<number> }>();
    for (const l of lines) {
      const u = l.unit || ing.market_order_unit || "";
      const g = byUnit.get(u) || { qty: 0, orders: new Set<number>() };
      g.qty += num(l.qty)!;
      g.orders.add(l.order_id);
      byUnit.set(u, g);
    }
    const orderGroups = Array.from(byUnit.entries())
      .map(([unit, g]) => ({ unit: unit || null, avgQty: round(g.qty / g.orders.size, 2), orders: g.orders.size, totalQty: round(g.qty, 2) }))
      .sort((a, b) => b.orders - a.orders);
    const lastOrdered = lines.map((l: any) => collectBy.get(l.order_id)).filter(Boolean).sort().pop() || null;

    // No market orders yet: fall back to invoice quantities
    let invoiceQty: { avgQty: number | null; unit: string | null; invoices: number } | null = null;
    if (!orderGroups.length && allRows.length) {
      const q = allRows.map((r) => num(r.quantity)).filter((n): n is number => n != null);
      const unit = mine.find((p: any) => (histByProduct.get(p.id) || []).length)?.purchase_unit || null;
      if (q.length) invoiceQty = { avgQty: round(q.reduce((s, x) => s + x, 0) / q.length, 2), unit, invoices: q.length };
    }

    return {
      ingredientId: ing.id,
      name: ing.market_name || ing.name,
      appName: ing.name,
      unit: ing.unit || null,
      orderUnit: ing.market_order_unit || null,
      offers,
      cheapest: cheapest ? { supplier: cheapest.supplier, unitCost: cheapest.unitCost } : null,
      latest: latest ? { supplier: latest.supplier, unitCost: latest.unitCost, date: latest.lastDate } : null,
      avg12: round(avg12),
      invoices12: allRows.length,
      // Latest cheapest price compared with the 12-month average (positive = dearer than usual)
      // Latest price paid compared with the 12-month average (positive = dearer than usual)
      vsAvgPct: latest?.unitCost != null && avg12 ? round(((latest.unitCost - avg12) / avg12) * 100, 1) : null,
      season: { fromData: cheapestSeason(allRows), waGuide: waSeason(ing.name) },
      ordering: { groups: orderGroups, lastOrdered, fromInvoices: invoiceQty },
    };
  });

  return { since, suppliers: suppliers || [], items, generatedAt: new Date().toISOString() };
}

const cogsReportCache = new Map<string, { at: number; data: any }>();

export function registerReportRoutes(app: Express) {
  // Cost of goods by supplier for a 4-week period (Xero bills on the cost of goods accounts)
  app.get("/api/reports/cost-of-goods", (req: any, _res: any, next: any) => { req.needsWages = true; next(); }, requireReportsAccess, asyncRoute(async (req: any, res: any) => {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date || "")) ? String(req.query.date) : undefined;
    const p = periodFor(date);
    const key = p.start;
    const hit = cogsReportCache.get(key);
    if (hit && Date.now() - hit.at < 5 * 60_000 && req.query.refresh !== "true") return res.json(hit.data);
    const base = { fyLabel: p.fyLabel, period: p.period, start: p.start, end: p.end, weeks: p.weeks };
    if (!(await xeroConnected())) return res.json({ ...base, available: false, note: "Connect Xero on the Supplier Invoices page to see cost of goods." });
    let codes: string[] = [], accounts: { code: string; name: string }[] = [];
    try { [codes, accounts] = await Promise.all([cogsAccountCodes(), xeroExpenseAccounts()]); }
    catch (e: any) { return res.json({ ...base, available: false, note: e?.reconnect ? "Reconnect Xero on the Supplier Invoices page (Disconnect, then Connect) so the app can read your account names." : `Xero: ${e.message}` }); }
    if (!codes.length) return res.json({ ...base, available: false, note: "Choose your cost of goods accounts in Reports → KPIs." });
    const r = await xeroCostOfGoods(p.start, p.end, codes);
    const data = {
      ...base, available: true,
      accounts: accounts.filter((a) => codes.includes(a.code)).map((a) => ({ code: a.code, name: a.name })),
      docs: r.docs.sort((a, b) => a.date.localeCompare(b.date)),
      fetchedAt: new Date().toISOString(),
    };
    cogsReportCache.set(key, { at: Date.now(), data });
    res.json(data);
  }));

  app.get("/api/reports/market-prices", requireReportsAccess, asyncRoute(async (_req: any, res: any) => {
    res.json(await marketPriceReport());
  }));
}
