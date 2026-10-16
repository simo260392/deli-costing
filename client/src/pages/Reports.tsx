import { useMemo, useState } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/context/AuthContext";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  BarChart3, Apple, ShoppingCart, BookMarked, ChevronDown, ChevronRight, ChevronLeft, RefreshCw, Search, TrendingDown, TrendingUp, Award, AlertTriangle,
} from "lucide-react";
import { periodFor, nextPeriod, previousPeriod, todayPerth, fyStart } from "@shared/kpiPeriods";
import RecipeBook from "@/pages/RecipeBook";

const NAVY = "#256984";

// ── Formatting ───────────────────────────────────────────────────────────────
const money0 = (n: number | null | undefined) => (n == null ? "—" : `$${Math.round(n).toLocaleString("en-AU")}`);
const money2 = (n: number | null | undefined) =>
  n == null ? "—" : `$${n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (n: number | null | undefined) => (n == null ? "—" : `${n.toFixed(1)}%`);
const shortDate = (s: string | null | undefined) =>
  !s ? "" : new Date(s.slice(0, 10) + "T00:00:00Z").toLocaleDateString("en-AU", { day: "numeric", month: "short", timeZone: "UTC" });
const dateWithYear = (s: string | null | undefined) =>
  !s ? "" : new Date(s.slice(0, 10) + "T00:00:00Z").toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "2-digit", timeZone: "UTC" });
const perUnit = (u: string | null | undefined) => (u ? `/${u}` : "");

type Tab = "kpis" | "cost-of-goods" | "market-prices" | "product-info";

export default function Reports() {
  const [location, navigate] = useLocation();
  const { staff, hasAccess } = useAuth();
  const isAdmin = staff?.accessLevel?.name === "Admin";

  const tabs = [
    { id: "kpis" as Tab, label: "KPIs", icon: BarChart3, show: isAdmin || hasAccess("wages") },
    { id: "cost-of-goods" as Tab, label: "Cost of goods", icon: ShoppingCart, show: isAdmin || hasAccess("wages") || hasAccess("reports") },
    { id: "market-prices" as Tab, label: "Markets prices", icon: Apple, show: hasAccess("reports") },
    { id: "product-info" as Tab, label: "Product Info PDF", icon: BookMarked, show: hasAccess("recipe-book") },
  ].filter((t) => t.show);

  const fromPath = location.replace(/^\/reports\/?/, "") as Tab;
  const tab: Tab | undefined = tabs.find((t) => t.id === fromPath)?.id ?? tabs[0]?.id;

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-5">
      <div className="no-print">
        <h1 className="text-2xl font-bold">Reports</h1>
        <p className="text-sm text-muted-foreground">Look back at past periods, market prices and product information.</p>
      </div>

      {tabs.length > 1 && (
        <div className="flex gap-1 bg-muted rounded-lg p-1 w-full md:w-fit overflow-x-auto no-print">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => navigate(`/reports/${id}`)}
              className={cn(
                "flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium whitespace-nowrap flex-1 md:flex-none transition-colors",
                tab === id ? "bg-white text-[#256984] shadow-sm dark:bg-background" : "text-muted-foreground hover:text-foreground",
              )}
              data-testid={`tab-reports-${id}`}
            >
              <Icon size={15} /> {label}
            </button>
          ))}
        </div>
      )}

      {!tab && <p className="text-sm text-muted-foreground">You don't have access to any reports yet.</p>}
      {tab === "kpis" && <KpiHistory />}
      {tab === "cost-of-goods" && <CogsReport />}
      {tab === "market-prices" && <MarketPrices />}
      {tab === "product-info" && <div className="-mx-4 md:-mx-6 -mb-6"><RecipeBook /></div>}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// KPI history: every 4-week period of a financial year
// ═════════════════════════════════════════════════════════════════════════════
interface KpiFigures {
  turnover: number; deliveryFees: number; orders: number;
  productionWages: number; productionPct: number | null;
  driverWages: number; driverPct: number | null;
  pendingWages: number;
  cogs?: number | null; cogsPct?: number | null;
}
interface KpiWeekRow extends KpiFigures { number: number; start: string; end: string; future: boolean }
interface KpiResponse {
  fyLabel: string; period: number; start: string; end: string;
  isCurrent?: boolean; future?: boolean;
  weeks?: KpiWeekRow[]; totals?: KpiFigures;
  targets?: { productionPct: number; driverPct: number; cogsPct?: number };
  cogs?: { available: boolean; note: string | null; bills: number };
  errors?: string[];
}

const fyOf = (date: string) => {
  const y = Number(date.slice(0, 4));
  return date < fyStart(y) ? y - 1 : y;
};

function KpiHistory() {
  const today = todayPerth();
  const thisFy = fyOf(today);
  const [fy, setFy] = useState(thisFy);
  const [open, setOpen] = useState<string | null>(null);
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState<string | null>(null);

  // The 13 periods of the chosen financial year that have started
  const periods = useMemo(() => {
    const list = [];
    let p = periodFor(fyStart(fy));
    for (let i = 0; i < 13; i++) {
      if (p.start > today) break;
      list.push(p);
      p = nextPeriod(p);
    }
    return list.reverse(); // newest first
  }, [fy, today]);

  const results = useQueries({
    queries: periods.map((p) => ({
      queryKey: ["/api/kpi/period", p.start],
      queryFn: () => apiRequest("GET", `/api/kpi/period?date=${p.start}`).then((r) => r.json() as Promise<KpiResponse>),
      staleTime: 5 * 60 * 1000,
    })),
  });

  const refresh = async (start: string) => {
    setRefreshing(start);
    try {
      const fresh = await apiRequest("GET", `/api/kpi/period?date=${start}&refresh=true`).then((r) => r.json());
      qc.setQueryData(["/api/kpi/period", start], fresh);
    } finally {
      setRefreshing(null);
    }
  };

  const loaded = results.map((r) => r.data).filter((d): d is KpiResponse => !!d?.totals);
  const targets = loaded[0]?.targets ?? { productionPct: 30, driverPct: 100 };
  const cogsTarget = loaded[0]?.targets?.cogsPct ?? 30;
  const cogsLoaded = loaded.filter((d) => d.cogs?.available && d.totals!.cogs != null);
  const cogsNote = loaded.find((d) => !d.cogs?.available && d.cogs?.note)?.cogs?.note ?? null;
  const fyCogs = cogsLoaded.reduce((s, d) => s + (d.totals!.cogs || 0), 0);
  const fyCogsTurnover = cogsLoaded.reduce((s, d) => s + d.totals!.turnover, 0);
  const fyCogsPct = fyCogsTurnover > 0 ? (fyCogs / fyCogsTurnover) * 100 : null;
  const allLoaded = loaded.length === periods.length;
  const fyTotals = loaded.reduce(
    (s, d) => ({
      turnover: s.turnover + d.totals!.turnover,
      orders: s.orders + d.totals!.orders,
      productionWages: s.productionWages + d.totals!.productionWages,
      deliveryFees: s.deliveryFees + d.totals!.deliveryFees,
      driverWages: s.driverWages + d.totals!.driverWages,
    }),
    { turnover: 0, orders: 0, productionWages: 0, deliveryFees: 0, driverWages: 0 },
  );
  const fyProdPct = fyTotals.turnover > 0 ? (fyTotals.productionWages / fyTotals.turnover) * 100 : null;
  const fyDriverPct = fyTotals.deliveryFees > 0 ? (fyTotals.driverWages / fyTotals.deliveryFees) * 100 : null;
  const maxTurnover = Math.max(1, ...loaded.map((d) => d.totals!.turnover));
  const fyLabel = periodFor(fyStart(fy)).fyLabel;

  return (
    <div className="space-y-4">
      {/* Year picker */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1">
          <button onClick={() => setFy(fy - 1)} className="p-2 rounded-lg hover:bg-muted text-muted-foreground" aria-label="Previous year" data-testid="button-kpi-fy-prev">
            <ChevronLeft size={18} />
          </button>
          <span className="text-lg font-bold" style={{ color: NAVY }}>{fyLabel}</span>
          <button onClick={() => setFy(fy + 1)} disabled={fy >= thisFy} className="p-2 rounded-lg hover:bg-muted text-muted-foreground disabled:opacity-30" aria-label="Next year" data-testid="button-kpi-fy-next">
            <ChevronRight size={18} />
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          Turnover is Flex sales ex GST, excluding delivery fees. Production wages include super (target ≤ {targets.productionPct}%). Cost of goods is Xero bills on the chosen accounts, ex GST (target ≤ {cogsTarget}%).
        </p>
      </div>

      {/* Year to date */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Stat label={fy === thisFy ? "Turnover, year to date" : "Turnover, full year"} value={money0(fyTotals.turnover)} sub={`${fyTotals.orders.toLocaleString("en-AU")} orders`} loading={!loaded.length} />
        <Stat label="Production wages" value={money0(fyTotals.productionWages)} sub={<PctBadge value={fyProdPct} target={targets.productionPct} />} loading={!loaded.length} />
        <Stat label="Cost of goods" value={cogsLoaded.length ? money0(fyCogs) : "—"} sub={cogsLoaded.length ? <PctBadge value={fyCogsPct} target={cogsTarget} /> : cogsNote || undefined} loading={!loaded.length} />
        <Stat label="Delivery fees" value={money0(fyTotals.deliveryFees)} sub={`Driver wages ${money0(fyTotals.driverWages)}`} loading={!loaded.length} />
        <Stat label="Driver wages vs fees" value={pct(fyDriverPct)} sub={<PctBadge value={fyDriverPct} target={targets.driverPct} />} loading={!loaded.length} />
      </div>
      {!allLoaded && periods.length > 0 && (
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <RefreshCw size={12} className="animate-spin" /> Loading periods ({loaded.length} of {periods.length}). Older periods load faster once they've been opened once.
        </p>
      )}
      <CogsAccounts />
      {periods.length === 0 && <p className="text-sm text-muted-foreground">This financial year hasn't started yet.</p>}

      {/* Periods */}
      <div className="bg-white dark:bg-card rounded-xl border shadow-sm divide-y">
        {periods.map((p, i) => {
          const r = results[i];
          const d = r.data;
          const t = d?.totals;
          const isOpen = open === p.start;
          const current = today >= p.start && today <= p.end;
          return (
            <div key={p.start}>
              <button
                onClick={() => setOpen(isOpen ? null : p.start)}
                className="w-full text-left px-3 md:px-4 py-3 hover:bg-muted/40 transition-colors"
                data-testid={`row-kpi-period-${p.period}`}
              >
                <div className="flex items-center gap-3">
                  <ChevronDown size={15} className={cn("shrink-0 text-muted-foreground transition-transform", !isOpen && "-rotate-90")} />
                  <div className="w-28 md:w-40 shrink-0">
                    <p className="font-semibold text-sm">
                      Period {p.period}
                      {current && <span className="ml-1.5 text-[10px] uppercase tracking-wide font-bold text-[#5AB693]">Now</span>}
                    </p>
                    <p className="text-xs text-muted-foreground">{shortDate(p.start)} – {shortDate(p.end)}</p>
                  </div>
                  {r.isLoading ? (
                    <div className="flex-1 h-4 bg-muted rounded animate-pulse" />
                  ) : r.isError || !t ? (
                    <p className="flex-1 text-xs text-red-600">Couldn't load this period. Open it to try again.</p>
                  ) : (
                    <div className="flex-1 grid grid-cols-3 md:grid-cols-5 gap-x-4 gap-y-1 items-center text-sm tabular-nums">
                      <div>
                        <p className="font-semibold">{money0(t.turnover)}</p>
                        <div className="hidden md:block h-1.5 mt-1 rounded-full bg-muted overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${(t.turnover / maxTurnover) * 100}%`, backgroundColor: NAVY }} />
                        </div>
                      </div>
                      <div><p className="text-[10px] text-muted-foreground leading-none mb-0.5">Wages</p><PctBadge value={t.productionPct} target={targets.productionPct} /></div>
                      <div><p className="text-[10px] text-muted-foreground leading-none mb-0.5">Cost of goods</p>{t.cogs != null ? <PctBadge value={t.cogsPct} target={cogsTarget} /> : <span className="text-xs text-muted-foreground">—</span>}</div>
                      <div className="hidden md:block text-muted-foreground">{t.orders} orders</div>
                      <div className="hidden md:block text-muted-foreground">Driver {pct(t.driverPct)}</div>
                    </div>
                  )}
                </div>
              </button>

              {isOpen && (
                <div className="px-3 md:px-4 pb-4 space-y-3">
                  {d?.errors?.length ? (
                    <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 rounded-lg p-2">
                      <AlertTriangle size={14} className="shrink-0 mt-0.5" /> {d.errors.join(" · ")}
                    </div>
                  ) : null}
                  {t && t.pendingWages > 0 && (
                    <p className="text-xs text-amber-700">{money0(t.pendingWages)} of wages are on timesheets not yet approved in Deputy.</p>
                  )}
                  {d?.weeks && (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm tabular-nums">
                        <thead>
                          <tr className="text-xs text-muted-foreground text-left">
                            <th className="py-1.5 pr-3 font-medium">Week</th>
                            <th className="py-1.5 pr-3 font-medium text-right">Turnover</th>
                            <th className="py-1.5 pr-3 font-medium text-right">Orders</th>
                            <th className="py-1.5 pr-3 font-medium text-right">Prod. wages</th>
                            <th className="py-1.5 pr-3 font-medium text-right">Prod. %</th>
                            <th className="py-1.5 pr-3 font-medium text-right">Cost of goods</th>
                            <th className="py-1.5 pr-3 font-medium text-right">COGS %</th>
                            <th className="py-1.5 pr-3 font-medium text-right">Delivery fees</th>
                            <th className="py-1.5 pr-3 font-medium text-right">Driver wages</th>
                            <th className="py-1.5 font-medium text-right">Driver %</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {d.weeks.map((w) => (
                            <tr key={w.start} className={cn(w.future && "text-muted-foreground")}>
                              <td className="py-1.5 pr-3 whitespace-nowrap">{w.number} <span className="text-xs text-muted-foreground">({shortDate(w.start)})</span></td>
                              <td className="py-1.5 pr-3 text-right">{w.future ? "—" : money0(w.turnover)}</td>
                              <td className="py-1.5 pr-3 text-right">{w.future ? "—" : w.orders}</td>
                              <td className="py-1.5 pr-3 text-right">{w.future ? "—" : money0(w.productionWages)}</td>
                              <td className="py-1.5 pr-3 text-right">{w.future ? "—" : <PctBadge value={w.productionPct} target={targets.productionPct} />}</td>
                              <td className="py-1.5 pr-3 text-right">{w.future || w.cogs == null ? "—" : money0(w.cogs)}</td>
                              <td className="py-1.5 pr-3 text-right">{w.future || w.cogs == null ? "—" : <PctBadge value={w.cogsPct} target={cogsTarget} />}</td>
                              <td className="py-1.5 pr-3 text-right">{w.future ? "—" : money0(w.deliveryFees)}</td>
                              <td className="py-1.5 pr-3 text-right">{w.future ? "—" : money0(w.driverWages)}</td>
                              <td className="py-1.5 text-right">{w.future ? "—" : pct(w.driverPct)}</td>
                            </tr>
                          ))}
                          {t && (
                            <tr className="font-semibold">
                              <td className="py-1.5 pr-3">Period</td>
                              <td className="py-1.5 pr-3 text-right">{money0(t.turnover)}</td>
                              <td className="py-1.5 pr-3 text-right">{t.orders}</td>
                              <td className="py-1.5 pr-3 text-right">{money0(t.productionWages)}</td>
                              <td className="py-1.5 pr-3 text-right"><PctBadge value={t.productionPct} target={targets.productionPct} /></td>
                              <td className="py-1.5 pr-3 text-right">{t.cogs == null ? "—" : money0(t.cogs)}</td>
                              <td className="py-1.5 pr-3 text-right">{t.cogs == null ? "—" : <PctBadge value={t.cogsPct} target={cogsTarget} />}</td>
                              <td className="py-1.5 pr-3 text-right">{money0(t.deliveryFees)}</td>
                              <td className="py-1.5 pr-3 text-right">{money0(t.driverWages)}</td>
                              <td className="py-1.5 text-right">{pct(t.driverPct)}</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <Button variant="outline" size="sm" onClick={() => refresh(p.start)} disabled={refreshing === p.start} data-testid={`button-kpi-refresh-${p.period}`}>
                    <RefreshCw size={13} className={cn("mr-1.5", refreshing === p.start && "animate-spin")} />
                    {refreshing === p.start ? "Recalculating…" : "Recalculate from Flex and Deputy"}
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Which Xero expense accounts count as cost of goods
interface CogsAccountsResponse {
  connected: boolean; reconnect?: boolean; error?: string; saved?: boolean;
  accounts: { code: string; name: string; type: string; suggested: boolean }[];
  selected: string[];
}
function CogsAccounts() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string[] | null>(null);
  const [saving, setSaving] = useState(false);
  const { data } = useQuery<CogsAccountsResponse>({
    queryKey: ["/api/kpi/cogs-accounts"],
    queryFn: () => apiRequest("GET", "/api/kpi/cogs-accounts").then((r) => r.json()),
  });
  if (!data) return null;
  const chosen = picked ?? data.selected;
  const names = data.accounts.filter((a) => chosen.includes(a.code)).map((a) => a.name);
  const save = async () => {
    setSaving(true);
    try {
      await apiRequest("POST", "/api/settings", { key: "kpi_cogs_accounts", value: JSON.stringify(chosen) });
      setPicked(null);
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["/api/kpi/cogs-accounts"] });
      qc.invalidateQueries({ queryKey: ["/api/kpi/period"] });
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="rounded-xl border bg-white dark:bg-card px-3 md:px-4 py-2.5 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">Cost of goods accounts (Xero)</p>
          {!data.connected ? (
            <p className="text-xs">Connect Xero on the Supplier Invoices page to include cost of goods.</p>
          ) : data.reconnect ? (
            <p className="text-xs text-amber-700">Reconnect Xero on the Supplier Invoices page (Disconnect, then Connect) so the app can read your account names.</p>
          ) : data.error ? (
            <p className="text-xs text-red-600">{data.error}</p>
          ) : (
            <p className="text-xs truncate">{names.length ? names.join(", ") : "None chosen yet"}{!data.saved && names.length ? " (suggested)" : ""}</p>
          )}
        </div>
        {data.connected && data.accounts.length > 0 && (
          <button onClick={() => setOpen(!open)} className="shrink-0 text-xs font-medium text-[#256984] hover:underline" data-testid="button-cogs-accounts">
            {open ? "Close" : "Change"}
          </button>
        )}
      </div>
      {open && (
        <div className="mt-3 space-y-2">
          <div className="max-h-72 overflow-y-auto grid sm:grid-cols-2 gap-x-4 gap-y-1">
            {data.accounts.map((a) => (
              <label key={a.code} className="flex items-center gap-2 py-1 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={chosen.includes(a.code)}
                  onChange={(e) => setPicked(e.target.checked ? [...chosen, a.code] : chosen.filter((c) => c !== a.code))}
                />
                <span className="text-muted-foreground tabular-nums w-12 shrink-0">{a.code}</span>
                <span className="truncate">{a.name}</span>
              </label>
            ))}
          </div>
          <Button size="sm" onClick={save} disabled={saving || !chosen.length} data-testid="button-save-cogs-accounts">
            {saving ? "Saving…" : "Save accounts"}
          </Button>
        </div>
      )}
    </div>
  );
}

function PctBadge({ value, target }: { value: number | null | undefined; target: number }) {
  const ok = value != null && value <= target;
  return (
    <span className={cn(
      "inline-flex rounded-full text-xs font-semibold px-1.5 py-0.5 tabular-nums",
      value == null ? "bg-gray-100 text-gray-500" : ok ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700",
    )}>
      {pct(value)}
    </span>
  );
}

function Stat({ label, value, sub, loading }: { label: string; value: string; sub?: React.ReactNode; loading?: boolean }) {
  return (
    <div className="bg-white dark:bg-card rounded-xl border shadow-sm p-3 md:p-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      {loading ? (
        <div className="h-7 w-24 bg-muted rounded animate-pulse mt-1.5" />
      ) : (
        <>
          <p className="text-xl md:text-2xl font-bold tabular-nums mt-0.5">{value}</p>
          {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
        </>
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Markets Price Tracker
// ═════════════════════════════════════════════════════════════════════════════
interface Offer {
  supplierId: number; supplier: string; unitCost: number | null; packPrice: number | null; packUnit: string | null;
  lastDate: string | null; avg12: number | null; invoices12: number;
}
interface PriceItem {
  ingredientId: number; name: string; appName: string; unit: string | null; orderUnit: string | null;
  offers: Offer[];
  cheapest: { supplier: string; unitCost: number } | null;
  latest: { supplier: string; unitCost: number; date: string | null } | null;
  avg12: number | null; invoices12: number; vsAvgPct: number | null;
  ordering: {
    groups: { unit: string | null; avgQty: number; orders: number; totalQty: number }[];
    lastOrdered: string | null;
    fromInvoices: { avgQty: number | null; unit: string | null; invoices: number } | null;
  };
}
interface PriceReport { since: string; items: PriceItem[]; generatedAt: string }

const shortSupplier = (s: string) => s.replace(/\s*-\s*Markets$/i, "");
const qtyText = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

function MarketPrices() {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"name" | "dearer" | "ordered">("name");
  const [open, setOpen] = useState<number | null>(null);
  const { data, isLoading, isError, refetch, isFetching } = useQuery<PriceReport>({
    queryKey: ["/api/reports/market-prices"],
    queryFn: () => apiRequest("GET", "/api/reports/market-prices").then((r) => r.json()),
  });

  const items = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = (data?.items || []).filter((i) => !q || i.name.toLowerCase().includes(q) || i.appName.toLowerCase().includes(q));
    const orders = (i: PriceItem) => i.ordering.groups.reduce((s, g) => s + g.orders, 0);
    if (sort === "dearer") return [...list].sort((a, b) => (b.vsAvgPct ?? -999) - (a.vsAvgPct ?? -999));
    if (sort === "ordered") return [...list].sort((a, b) => orders(b) - orders(a));
    return list;
  }, [data, search, sort]);

  const withPrices = (data?.items || []).filter((i) => i.cheapest).length;
  const withHistory = (data?.items || []).filter((i) => i.invoices12 > 0).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row md:items-center gap-2 md:justify-between">
        <div className="relative md:w-72">
          <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search produce" className="pl-8" data-testid="input-market-price-search" />
        </div>
        <div className="flex items-center gap-2">
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as any)}
            className="h-9 rounded-md border bg-background px-2 text-sm"
            data-testid="select-market-price-sort"
          >
            <option value="name">A–Z</option>
            <option value="dearer">Dearer than usual first</option>
            <option value="ordered">Most ordered first</option>
          </select>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw size={13} className={cn("mr-1.5", isFetching && "animate-spin")} /> Refresh
          </Button>
        </div>
      </div>

      {data && (
        <p className="text-xs text-muted-foreground">
          Prices are ex GST, per kg / each (as costed in recipes), from approved market invoices. {withPrices} of {data.items.length} produce items have a price;
          {" "}{withHistory} have invoices in the last 12 months. Average order is from texted market orders.
        </p>
      )}

      {isLoading && <div className="space-y-2">{[0, 1, 2, 3].map((i) => <div key={i} className="h-16 bg-muted rounded-xl animate-pulse" />)}</div>}
      {isError && <p className="text-sm text-red-600">Couldn't load market prices. Try Refresh.</p>}

      {data && (
        <div className="bg-white dark:bg-card rounded-xl border shadow-sm divide-y">
          {/* Column headings (desktop) */}
          <div className="hidden md:grid grid-cols-[1.4fr_1.3fr_1.3fr_1fr_1.1fr] gap-3 px-4 py-2 text-xs font-medium text-muted-foreground">
            <span>Produce</span><span>Cheapest now</span><span>Latest paid</span><span>12-month average</span><span>Average order</span>
          </div>
          {items.length === 0 && <p className="p-4 text-sm text-muted-foreground">No produce found.</p>}
          {items.map((i) => {
            const isOpen = open === i.ingredientId;
            const top = i.ordering.groups[0];
            return (
              <div key={i.ingredientId}>
                <button
                  onClick={() => setOpen(isOpen ? null : i.ingredientId)}
                  className="w-full text-left px-3 md:px-4 py-3 hover:bg-muted/40 transition-colors"
                  data-testid={`row-market-price-${i.ingredientId}`}
                >
                  <div className="grid grid-cols-2 md:grid-cols-[1.4fr_1.3fr_1.3fr_1fr_1.1fr] gap-x-3 gap-y-1.5 items-start text-sm">
                    <div className="col-span-2 md:col-span-1 flex items-center gap-2">
                      <ChevronDown size={14} className={cn("shrink-0 text-muted-foreground transition-transform", !isOpen && "-rotate-90")} />
                      <div>
                        <p className="font-semibold">{i.name}</p>
                        {i.offers.length > 1 && <p className="text-xs text-muted-foreground">{i.offers.length} suppliers</p>}
                      </div>
                    </div>
                    <Cell label="Cheapest now">
                      {i.cheapest ? (
                        <>
                          <p className="font-semibold tabular-nums flex items-center gap-1">
                            {i.offers.length > 1 && <Award size={13} className="text-[#5AB693]" />}
                            {money2(i.cheapest.unitCost)}<span className="text-xs font-normal text-muted-foreground">{perUnit(i.unit)}</span>
                          </p>
                          <p className="text-xs text-muted-foreground">{shortSupplier(i.cheapest.supplier)}</p>
                        </>
                      ) : <p className="text-muted-foreground">No price yet</p>}
                    </Cell>
                    <Cell label="Latest paid">
                      {i.latest ? (
                        <>
                          <p className="tabular-nums">{money2(i.latest.unitCost)}<span className="text-xs text-muted-foreground">{perUnit(i.unit)}</span></p>
                          <p className="text-xs text-muted-foreground">{shortSupplier(i.latest.supplier)}{i.latest.date ? ` · ${dateWithYear(i.latest.date)}` : ""}</p>
                        </>
                      ) : <p className="text-muted-foreground">—</p>}
                    </Cell>
                    <Cell label="12-month average">
                      {i.avg12 != null ? (
                        <>
                          <p className="tabular-nums">{money2(i.avg12)}<span className="text-xs text-muted-foreground">{perUnit(i.unit)}</span></p>
                          <VsAvg pct={i.vsAvgPct} />
                        </>
                      ) : <p className="text-xs text-muted-foreground pt-0.5">No invoices yet</p>}
                    </Cell>
                    <Cell label="Average order">
                      {top ? (
                        <>
                          <p className="tabular-nums">{qtyText(top.avgQty)} {top.unit || ""}</p>
                          <p className="text-xs text-muted-foreground">over {top.orders} order{top.orders === 1 ? "" : "s"}</p>
                        </>
                      ) : i.ordering.fromInvoices?.avgQty != null ? (
                        <>
                          <p className="tabular-nums">{qtyText(i.ordering.fromInvoices.avgQty)} {i.ordering.fromInvoices.unit || ""}</p>
                          <p className="text-xs text-muted-foreground">from {i.ordering.fromInvoices.invoices} invoice{i.ordering.fromInvoices.invoices === 1 ? "" : "s"}</p>
                        </>
                      ) : <p className="text-xs text-muted-foreground pt-0.5">Not ordered yet</p>}
                    </Cell>
                  </div>
                </button>

                {isOpen && (
                  <div className="px-3 md:px-4 pb-4 md:pl-10 space-y-3">
                    {i.offers.length ? (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm tabular-nums">
                          <thead>
                            <tr className="text-xs text-muted-foreground text-left">
                              <th className="py-1.5 pr-3 font-medium">Supplier</th>
                              <th className="py-1.5 pr-3 font-medium text-right">Latest{perUnit(i.unit)}</th>
                              <th className="py-1.5 pr-3 font-medium text-right">Pack price</th>
                              <th className="py-1.5 pr-3 font-medium">Last invoice</th>
                              <th className="py-1.5 font-medium text-right">12-mo avg</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y">
                            {i.offers.map((o, idx) => (
                              <tr key={o.supplierId}>
                                <td className="py-1.5 pr-3">
                                  {shortSupplier(o.supplier)}
                                  {idx === 0 && i.offers.length > 1 && <span className="ml-1.5 text-[10px] font-bold uppercase text-[#5AB693]">Cheapest</span>}
                                </td>
                                <td className="py-1.5 pr-3 text-right">{money2(o.unitCost)}</td>
                                <td className="py-1.5 pr-3 text-right">{o.packPrice != null ? `${money2(o.packPrice)}${o.packUnit ? ` / ${o.packUnit}` : ""}` : "—"}</td>
                                <td className="py-1.5 pr-3 whitespace-nowrap">{o.lastDate ? dateWithYear(o.lastDate) : <span className="text-muted-foreground">Before invoices</span>}</td>
                                <td className="py-1.5 text-right">{o.avg12 != null ? `${money2(o.avg12)} (${o.invoices12})` : "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">No market supplier has a price for this yet. It will appear once a market invoice with it is approved in Supplier Invoices.</p>
                    )}
                    {i.ordering.groups.length > 1 && (
                      <p className="text-xs text-muted-foreground">
                        Also ordered as: {i.ordering.groups.slice(1).map((g) => `${qtyText(g.avgQty)} ${g.unit || ""} (${g.orders} order${g.orders === 1 ? "" : "s"})`).join(", ")}
                      </p>
                    )}
                    {i.ordering.lastOrdered && <p className="text-xs text-muted-foreground">Last ordered for {dateWithYear(i.ordering.lastOrdered)}.</p>}
                    {i.appName !== i.name && <p className="text-xs text-muted-foreground">In recipes as "{i.appName}".</p>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="md:hidden text-[10px] uppercase tracking-wide text-muted-foreground font-medium">{label}</p>
      {children}
    </div>
  );
}

function VsAvg({ pct: p }: { pct: number | null }) {
  if (p == null) return null;
  if (Math.abs(p) < 2) return <p className="text-xs text-muted-foreground">About usual</p>;
  const dearer = p > 0;
  return (
    <p className={cn("text-xs font-medium flex items-center gap-1", dearer ? "text-red-600" : "text-green-700")}>
      {dearer ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
      Cheapest now is {Math.abs(p).toFixed(0)}% {dearer ? "above" : "below"} average
    </p>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Cost of goods by supplier (Xero bills on the cost of goods accounts)
// ═════════════════════════════════════════════════════════════════════════════
interface CogsDoc {
  id: string; kind: "bill" | "credit"; date: string; contact: string; number: string | null; status: string;
  amount: number; byAccount: Record<string, number>;
}
interface CogsReportData {
  fyLabel: string; period: number; start: string; end: string;
  weeks: { number: number; start: string; end: string }[];
  available: boolean; note?: string;
  accounts?: { code: string; name: string }[];
  docs?: CogsDoc[];
}

const cogsQuery = (start: string) => ({
  queryKey: ["/api/reports/cost-of-goods", start],
  queryFn: () => apiRequest("GET", `/api/reports/cost-of-goods?date=${start}`).then((r) => r.json() as Promise<CogsReportData>),
  staleTime: 5 * 60 * 1000,
});

function CogsReport() {
  const today = todayPerth();
  const [anchor, setAnchor] = useState(today);
  const p = periodFor(anchor);
  const prev = previousPeriod(p);
  const isCurrent = today >= p.start && today <= p.end;
  const [week, setWeek] = useState<number | null>(null); // null = whole period
  const [open, setOpen] = useState<string | null>(null);
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, isError } = useQuery<CogsReportData>(cogsQuery(p.start));
  const { data: prevData } = useQuery<CogsReportData>({ ...cogsQuery(prev.start), enabled: week === null });
  const { data: kpi } = useQuery<KpiResponse>({
    queryKey: ["/api/kpi/period", p.start],
    queryFn: () => apiRequest("GET", `/api/kpi/period?date=${p.start}`).then((r) => r.json()),
    staleTime: 5 * 60 * 1000,
  });

  const goTo = (start: string) => { setAnchor(start); setWeek(null); setOpen(null); };
  const refresh = async () => {
    setRefreshing(true);
    try {
      const fresh = await apiRequest("GET", `/api/reports/cost-of-goods?date=${p.start}&refresh=true`).then((r) => r.json());
      qc.setQueryData(["/api/reports/cost-of-goods", p.start], fresh);
    } finally { setRefreshing(false); }
  };

  const wk = week ? p.weeks.find((w) => w.number === week) : null;
  const docs = (data?.docs || []).filter((d) => !wk || (d.date >= wk.start && d.date <= wk.end));
  const total = docs.reduce((s, d) => s + d.amount, 0);
  const turnover = wk ? kpi?.weeks?.find((w) => w.number === week)?.turnover : kpi?.totals?.turnover;
  const cogsPct = turnover && turnover > 0 ? (total / turnover) * 100 : null;
  const target = kpi?.targets?.cogsPct ?? 30;

  const prevBySupplier = new Map<string, number>();
  for (const d of prevData?.docs || []) prevBySupplier.set(d.contact, (prevBySupplier.get(d.contact) || 0) + d.amount);

  const suppliers = useMemo(() => {
    const m = new Map<string, { name: string; amount: number; docs: CogsDoc[] }>();
    for (const d of docs) {
      const g = m.get(d.contact) || { name: d.contact, amount: 0, docs: [] };
      g.amount += d.amount; g.docs.push(d); m.set(d.contact, g);
    }
    return Array.from(m.values()).sort((a, b) => b.amount - a.amount);
  }, [docs]);
  const maxAmount = Math.max(1, ...suppliers.map((s) => s.amount));

  const accountName = new Map((data?.accounts || []).map((a) => [a.code, a.name]));
  const byAccount = new Map<string, number>();
  for (const d of docs) for (const [code, amt] of Object.entries(d.byAccount)) byAccount.set(code, (byAccount.get(code) || 0) + amt);
  const accountRows = Array.from(byAccount.entries()).sort((a, b) => b[1] - a[1]);

  return (
    <div className="space-y-4">
      {/* Period picker */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{p.fyLabel}</p>
          <h2 className="text-xl font-bold" style={{ color: NAVY }}>Period {p.period}{!isCurrent && <span className="text-muted-foreground font-medium text-base"> · complete</span>}</h2>
          <p className="text-sm text-muted-foreground">{dateWithYear(p.start)} – {dateWithYear(p.end)}</p>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => goTo(previousPeriod(p).start)} className="p-2 rounded-lg hover:bg-muted text-muted-foreground" aria-label="Previous period" data-testid="button-cogs-prev"><ChevronLeft size={18} /></button>
          {!isCurrent && <button onClick={() => goTo(today)} className="text-xs font-medium text-[#256984] px-2 py-1 rounded-lg hover:bg-muted">Current</button>}
          <button onClick={() => !isCurrent && goTo(nextPeriod(p).start)} disabled={isCurrent} className="p-2 rounded-lg hover:bg-muted text-muted-foreground disabled:opacity-30" aria-label="Next period" data-testid="button-cogs-next"><ChevronRight size={18} /></button>
        </div>
      </div>

      {/* Week filter */}
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {[null, ...p.weeks.map((w) => w.number)].map((n) => {
          const w = n ? p.weeks.find((x) => x.number === n)! : null;
          const future = !!w && w.start > today;
          return (
            <button
              key={n ?? "all"}
              disabled={future}
              onClick={() => { setWeek(n); setOpen(null); }}
              className={cn(
                "px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap border transition-colors disabled:opacity-40",
                week === n ? "bg-[#256984] text-white border-[#256984]" : "bg-white dark:bg-card hover:bg-muted",
              )}
              data-testid={`button-cogs-week-${n ?? "all"}`}
            >
              {w ? `Week ${w.number} · ${shortDate(w.start)}` : "Whole period"}
            </button>
          );
        })}
      </div>

      {isLoading && <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-14 bg-muted rounded-xl animate-pulse" />)}</div>}
      {isError && <p className="text-sm text-red-600">Couldn't load cost of goods from Xero. Try again in a minute.</p>}
      {data && !data.available && (
        <div className="flex items-start gap-2 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl p-3">
          <AlertTriangle size={15} className="shrink-0 mt-0.5" /> {data.note}
        </div>
      )}

      {data?.available && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <Stat label={wk ? `Spent in week ${wk.number}` : "Spent this period"} value={money0(total)} sub={`${docs.length} bill${docs.length === 1 ? "" : "s"} · ${suppliers.length} supplier${suppliers.length === 1 ? "" : "s"}`} />
            <Stat label="Of turnover (ex GST)" value={pct(cogsPct)} sub={turnover != null ? <span><PctBadge value={cogsPct} target={target} /> of {money0(turnover)}</span> : "Loading turnover…"} />
            {week === null && prevData?.available && (
              <Stat
                label={`Period ${prev.period} (last period)`}
                value={money0((prevData.docs || []).reduce((s, d) => s + d.amount, 0))}
                sub={isCurrent ? "Full period, for comparison" : undefined}
              />
            )}
          </div>

          {accountRows.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {accountRows.map(([code, amt]) => (
                <span key={code} className="inline-flex items-center gap-1.5 rounded-full border bg-white dark:bg-card px-3 py-1 text-xs">
                  <span className="text-muted-foreground">{accountName.get(code) || code}</span>
                  <span className="font-semibold tabular-nums">{money0(amt)}</span>
                </span>
              ))}
            </div>
          )}

          <div className="bg-white dark:bg-card rounded-xl border shadow-sm divide-y">
            <div className="hidden md:grid grid-cols-[1.6fr_1fr_0.7fr_0.8fr] gap-3 px-4 py-2 text-xs font-medium text-muted-foreground">
              <span>Supplier</span><span>Spent (ex GST)</span><span>Share</span><span>{week === null ? "Last period" : "Bills"}</span>
            </div>
            {suppliers.length === 0 && <p className="p-4 text-sm text-muted-foreground">No cost of goods bills in Xero for {wk ? "this week" : "this period"} yet.</p>}
            {suppliers.map((s) => {
              const isOpen = open === s.name;
              const last = prevBySupplier.get(s.name);
              return (
                <div key={s.name}>
                  <button onClick={() => setOpen(isOpen ? null : s.name)} className="w-full text-left px-3 md:px-4 py-3 hover:bg-muted/40 transition-colors" data-testid={`row-cogs-supplier-${s.name}`}>
                    <div className="grid grid-cols-[1fr_auto] md:grid-cols-[1.6fr_1fr_0.7fr_0.8fr] gap-x-3 gap-y-1 items-center text-sm tabular-nums">
                      <div className="flex items-center gap-2 min-w-0">
                        <ChevronDown size={14} className={cn("shrink-0 text-muted-foreground transition-transform", !isOpen && "-rotate-90")} />
                        <span className="font-semibold truncate">{s.name}</span>
                      </div>
                      <div>
                        <p className="font-semibold text-right md:text-left">{money2(s.amount)}</p>
                        <div className="hidden md:block h-1.5 mt-1 rounded-full bg-muted overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${Math.max(0, (s.amount / maxAmount) * 100)}%`, backgroundColor: NAVY }} />
                        </div>
                      </div>
                      <div className="hidden md:block text-muted-foreground">{total > 0 ? `${((s.amount / total) * 100).toFixed(0)}%` : "—"}</div>
                      <div className="hidden md:block text-muted-foreground">
                        {week === null ? (last != null ? money0(last) : "—") : `${s.docs.length}`}
                      </div>
                      <p className="md:hidden col-span-2 pl-6 text-xs text-muted-foreground">
                        {total > 0 ? `${((s.amount / total) * 100).toFixed(0)}% of spend` : ""}
                        {week === null && last != null ? ` · last period ${money0(last)}` : ""}
                      </p>
                    </div>
                  </button>
                  {isOpen && (
                    <div className="px-3 md:px-4 pb-3 md:pl-10">
                      <table className="w-full text-sm tabular-nums">
                        <tbody className="divide-y">
                          {s.docs.map((d) => (
                            <tr key={d.id}>
                              <td className="py-1.5 pr-3 whitespace-nowrap">{shortDate(d.date)}</td>
                              <td className="py-1.5 pr-3">
                                {d.kind === "credit" ? "Credit note " : ""}{d.number || "No number"}
                                {d.status === "DRAFT" && <span className="ml-1.5 text-[10px] font-bold uppercase text-amber-600">Draft</span>}
                                <span className="block text-xs text-muted-foreground">{Object.keys(d.byAccount).map((c) => accountName.get(c) || c).join(", ")}</span>
                              </td>
                              <td className={cn("py-1.5 text-right", d.amount < 0 && "text-green-700")}>{money2(d.amount)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
            <p>From Xero: bills (including drafts) less supplier credit notes, by bill date, ex GST, on your cost of goods accounts only.</p>
            <button onClick={refresh} className="shrink-0 inline-flex items-center gap-1 text-[#256984] hover:underline" data-testid="button-cogs-refresh">
              <RefreshCw size={11} className={refreshing ? "animate-spin" : ""} /> Refresh
            </button>
          </div>
        </>
      )}
    </div>
  );
}
