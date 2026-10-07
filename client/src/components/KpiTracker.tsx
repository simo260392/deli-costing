import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight, RefreshCw, AlertTriangle, TrendingUp, ChefHat, Truck } from "lucide-react";
import { periodFor, previousPeriod, nextPeriod, todayPerth } from "@shared/kpiPeriods";

// ── Types (mirror GET /api/kpi/period) ───────────────────────────────────────
interface KpiFigures {
  turnover: number; deliveryFees: number; orders: number;
  productionWages: number; productionPct: number | null;
  driverWages: number; driverPct: number | null;
  pendingWages: number;
}
interface KpiWeekRow extends KpiFigures { number: number; start: string; end: string; future: boolean }
interface KpiResponse {
  fyLabel: string; period: number; start: string; end: string;
  isCurrent: boolean; currentWeek: number | null;
  weeks: KpiWeekRow[]; totals: KpiFigures;
  targets: { productionPct: number; driverPct: number };
  excludedStaff: { matched: string[]; unmatched: string[] };
  bookedAhead?: { turnover: number; orders: number };
  method: { superannuation: string };
  errors: string[]; fetchedAt: string;
}

// ── Formatting ───────────────────────────────────────────────────────────────
const money = (n: number | null | undefined) =>
  n == null ? "—" : `$${Math.round(n).toLocaleString("en-AU")}`;
const pct = (n: number | null | undefined) => (n == null ? "N/A" : `${n.toFixed(1)}%`);
const shortDate = (s: string) =>
  new Date(s + "T00:00:00Z").toLocaleDateString("en-AU", { day: "numeric", month: "short", timeZone: "UTC" });
const fullDate = (s: string) =>
  new Date(s + "T00:00:00Z").toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const weekEnding = (s: string) =>
  new Date(s + "T00:00:00Z").toLocaleDateString("en-AU", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });

function PctBadge({ value, target, size = "sm" }: { value: number | null; target: number; size?: "sm" | "lg" }) {
  const ok = value != null && value <= target;
  return (
    <span className={cn(
      "inline-flex items-baseline gap-1 rounded-full font-semibold tabular-nums",
      size === "lg" ? "text-base px-2.5 py-0.5" : "text-xs px-1.5 py-0.5",
      value == null ? "bg-gray-100 text-gray-500" : ok ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700",
    )}>
      {pct(value)}
      {size === "lg" && <span className="text-xs font-normal opacity-70">target ≤ {target}%</span>}
    </span>
  );
}

function Tile({ icon: Icon, label, value, sub, badge, loading }: {
  icon: any; label: string; value: string; sub?: React.ReactNode; badge?: React.ReactNode; loading: boolean;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
      <div className="flex items-center gap-2 mb-2">
        <div className="p-1.5 rounded-lg" style={{ backgroundColor: "#25698418" }}>
          <Icon size={15} style={{ color: "#256984" }} />
        </div>
        <p className="text-xs font-medium text-gray-500">{label}</p>
      </div>
      {loading ? (
        <div className="space-y-1.5">
          <div className="h-7 w-24 bg-gray-100 rounded animate-pulse" />
          <div className="h-4 w-32 bg-gray-100 rounded animate-pulse" />
        </div>
      ) : (
        <>
          <p className="text-2xl font-bold text-gray-900 tabular-nums">{value}</p>
          {badge && <div className="mt-1.5">{badge}</div>}
          {sub && <p className="text-xs text-gray-500 mt-1.5">{sub}</p>}
        </>
      )}
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────
export function KpiTracker() {
  const [anchor, setAnchor] = useState<string>(todayPerth());
  const local = periodFor(anchor);
  const today = todayPerth();
  const isCurrent = today >= local.start && today <= local.end;
  const canGoNext = nextPeriod(local).start <= today;

  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const { data, isLoading, isFetching } = useQuery<KpiResponse>({
    queryKey: ["/api/kpi/period", local.start],
    queryFn: () => apiRequest("GET", `/api/kpi/period?date=${local.start}`).then((r) => r.json()),
    staleTime: 5 * 60 * 1000,
  });

  // Refresh bypasses the server's 10-minute cache
  const refresh = async () => {
    setRefreshing(true);
    try {
      const fresh = await apiRequest("GET", `/api/kpi/period?date=${local.start}&refresh=true`).then((r) => r.json());
      qc.setQueryData(["/api/kpi/period", local.start], fresh);
    } finally {
      setRefreshing(false);
    }
  };

  const t = data?.totals;
  const targets = data?.targets ?? { productionPct: 30, driverPct: 100 };
  const currentWeek = isCurrent ? local.weeks.find((w) => today >= w.start && today <= w.end)?.number ?? null : null;

  return (
    <section id="kpis" className="space-y-3">
      {/* Period header */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Kitchen KPIs · {local.fyLabel}</p>
            <h2 className="text-xl font-bold text-[#256984] mt-0.5">
              Period {local.period}
              {currentWeek != null && (
                <span className="text-gray-800"> · Week {currentWeek} <span className="text-gray-400 font-medium">of {local.weeks.length}</span></span>
              )}
              {!isCurrent && <span className="text-gray-400 font-medium text-base"> · complete</span>}
            </h2>
            <p className="text-sm text-gray-500">{fullDate(local.start)} – {fullDate(local.end)}</p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => setAnchor(previousPeriod(local).start)}
              className="p-2 rounded-lg hover:bg-gray-100 text-gray-500"
              aria-label="Previous period"
              data-testid="button-kpi-prev"
            ><ChevronLeft size={18} /></button>
            {!isCurrent && (
              <button
                onClick={() => setAnchor(todayPerth())}
                className="text-xs font-medium text-[#256984] px-2 py-1 rounded-lg hover:bg-gray-100"
                data-testid="button-kpi-current"
              >Current</button>
            )}
            <button
              onClick={() => canGoNext && setAnchor(nextPeriod(local).start)}
              disabled={!canGoNext}
              className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 disabled:opacity-30 disabled:hover:bg-transparent"
              aria-label="Next period"
              data-testid="button-kpi-next"
            ><ChevronRight size={18} /></button>
          </div>
        </div>
        {/* Week progress */}
        <div className="flex gap-1.5 mt-3">
          {local.weeks.map((w) => {
            const done = w.end < today;
            const now = w.number === currentWeek;
            return (
              <div key={w.start} className="flex-1">
                <div className={cn("h-1.5 rounded-full", done ? "bg-[#256984]" : now ? "bg-[#256984]/50" : "bg-gray-100")} />
                <p className={cn("text-[11px] mt-1 tabular-nums", now ? "text-[#256984] font-semibold" : "text-gray-400")}>
                  Wk {w.number}<span className="hidden sm:inline"> · {shortDate(w.start)}</span>
                </p>
              </div>
            );
          })}
        </div>
      </div>

      {data?.errors?.length ? (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>Some figures couldn't be loaded: {data.errors.join(" · ")}</span>
        </div>
      ) : null}

      {/* Headline tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Tile
          icon={TrendingUp}
          label="Turnover to date (ex GST)"
          value={money(t?.turnover)}
          sub={t ? (
            <>
              {t.orders} orders delivered to date · incl. wholesale & {money(t.deliveryFees)} delivery
              {data?.bookedAhead && data.bookedAhead.orders > 0 && (
                <span className="block text-gray-400 mt-0.5">+ {money(data.bookedAhead.turnover)} booked for later this period ({data.bookedAhead.orders} orders)</span>
              )}
            </>
          ) : undefined}
          loading={isLoading}
        />
        <Tile
          icon={ChefHat}
          label="Production wages (incl. super)"
          value={money(t?.productionWages)}
          badge={<PctBadge value={t?.productionPct ?? null} target={targets.productionPct} size="lg" />}
          sub="of turnover (ex GST)"
          loading={isLoading}
        />
        <Tile
          icon={Truck}
          label="Driver wages (incl. super)"
          value={money(t?.driverWages)}
          badge={<PctBadge value={t?.driverPct ?? null} target={targets.driverPct} size="lg" />}
          sub={t ? `of ${money(t.deliveryFees)} delivery fees (ex GST)` : undefined}
          loading={isLoading}
        />
      </div>

      {/* Weekly breakdown — mirrors the paper tracker */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm tabular-nums">
            <thead>
              <tr className="text-xs text-gray-500 border-b border-gray-100">
                <th className="text-left font-medium px-4 py-2.5">Week ending</th>
                <th className="text-right font-medium px-3 py-2.5">Sales</th>
                <th className="text-right font-medium px-3 py-2.5">Prod. wages</th>
                <th className="text-right font-medium px-3 py-2.5">%</th>
                <th className="text-right font-medium px-3 py-2.5">Delivery fees</th>
                <th className="text-right font-medium px-3 py-2.5">Driver wages</th>
                <th className="text-right font-medium px-4 py-2.5">%</th>
              </tr>
            </thead>
            <tbody>
              {(data?.weeks ?? local.weeks.map((w) => ({ ...w, future: w.start > today } as Partial<KpiWeekRow> & typeof w))).map((w: any) => {
                const now = w.number === currentWeek;
                const empty = w.future || isLoading;
                return (
                  <tr key={w.start} className={cn("border-b border-gray-50", now && "bg-[#256984]/[0.04]")}>
                    <td className="px-4 py-2.5 text-gray-700 whitespace-nowrap">
                      {weekEnding(w.end)}
                      {now && <span className="ml-2 text-[11px] font-medium text-[#256984]">in progress</span>}
                    </td>
                    <td className="text-right px-3 py-2.5 text-gray-800">{empty ? "—" : money(w.turnover)}</td>
                    <td className="text-right px-3 py-2.5 text-gray-800">{empty ? "—" : money(w.productionWages)}</td>
                    <td className="text-right px-3 py-2.5">{empty ? <span className="text-gray-300">—</span> : <PctBadge value={w.productionPct} target={targets.productionPct} />}</td>
                    <td className="text-right px-3 py-2.5 text-gray-800">{empty ? "—" : money(w.deliveryFees)}</td>
                    <td className="text-right px-3 py-2.5 text-gray-800">{empty ? "—" : money(w.driverWages)}</td>
                    <td className="text-right px-4 py-2.5">{empty ? <span className="text-gray-300">—</span> : <PctBadge value={w.driverPct} target={targets.driverPct} />}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="font-semibold text-gray-900 bg-gray-50/70">
                <td className="px-4 py-2.5 rounded-bl-xl">Period total</td>
                <td className="text-right px-3 py-2.5">{isLoading ? "—" : money(t?.turnover)}</td>
                <td className="text-right px-3 py-2.5">{isLoading ? "—" : money(t?.productionWages)}</td>
                <td className="text-right px-3 py-2.5">{isLoading ? "—" : <PctBadge value={t?.productionPct ?? null} target={targets.productionPct} />}</td>
                <td className="text-right px-3 py-2.5">{isLoading ? "—" : money(t?.deliveryFees)}</td>
                <td className="text-right px-3 py-2.5">{isLoading ? "—" : money(t?.driverWages)}</td>
                <td className="text-right px-4 py-2.5 rounded-br-xl">{isLoading ? "—" : <PctBadge value={t?.driverPct ?? null} target={targets.driverPct} />}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <div className="flex items-start justify-between gap-3 px-4 py-2.5 border-t border-gray-100 text-[11px] text-gray-400">
          <div className="space-y-0.5">
            <p>
              Sales from Flex (ex GST) · wages from Deputy plus 12% super.
              Production excludes Drivers & Events areas
              {data?.excludedStaff?.matched?.length ? ` and ${data.excludedStaff.matched.join(", ")}` : ""}.
            </p>
            {t && t.pendingWages > 0 && (
              <p>Includes {money(t.pendingWages)} of timesheets not yet approved in Deputy.</p>
            )}
            {data?.excludedStaff?.unmatched?.length ? (
              <p className="text-amber-600">Couldn't find {data.excludedStaff.unmatched.join(", ")} in Deputy — check the spelling under Settings → Kitchen KPIs.</p>
            ) : null}
          </div>
          <button
            onClick={refresh}
            className="shrink-0 inline-flex items-center gap-1 text-[#256984] hover:underline"
            data-testid="button-kpi-refresh"
          >
            <RefreshCw size={11} className={isFetching || refreshing ? "animate-spin" : ""} /> Refresh
          </button>
        </div>
      </div>
    </section>
  );
}
