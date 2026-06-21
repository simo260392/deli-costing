import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { AlertTriangle, TrendingDown, Package, Clock, ChevronDown, ChevronUp, ArrowUpDown } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";

// ─── Helpers ──────────────────────────────────────────────────────────────────
function toAWST(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Perth" }).format(date);
}
function today() { return toAWST(new Date()); }
function yesterday() { const d = new Date(); d.setDate(d.getDate() - 1); return toAWST(d); }
function daysAgo(n: number) { const d = new Date(); d.setDate(d.getDate() - n); return toAWST(d); }
function fmtDate(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y.slice(2)}`;
}
function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-AU", { timeZone: "Australia/Perth", hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" });
}

const FILL_GREEN = "#5AB693";
const FILL_AMBER = "#F59E0B";
const FILL_RED   = "#EF4444";
const BRAND_BLUE = "#256984";

function fillColor(rate: number) {
  if (rate >= 100) return FILL_GREEN;
  if (rate >= 95)  return FILL_AMBER;
  return FILL_RED;
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface ReportKpis { totalMissing: number; totalUnits: number; ordersAffected: number; fillRate: number; totalRequired: number; totalMade: number; }
interface Ingredient  { name: string; occurrences: number; unitsLost: number; itemsAffected: string[]; }
interface Reason      { label: string; occurrences: number; unitsLost: number; }
interface MissedItem  { name: string; unitsLost: number; occurrences: number; }
interface TrendDay    { date: string; unitsLost: number; itemsMissing: number; fillRate: number; }
interface LogEntry    { id: number; date: string; item: string; orderId: number; required: number; made: number; missing: number; reasonType: string; reasonLabel: string; rawReason: string; staffName: string; loggedAt: string; }
interface ReportData  { ok: boolean; from: string; to: string; kpis: ReportKpis; ingredients: Ingredient[]; reasons: Reason[]; missedItems: MissedItem[]; trend: TrendDay[]; log: LogEntry[]; }

// ─── KPI Card ─────────────────────────────────────────────────────────────────
function KpiCard({ label, value, sub, accent }: { label: string; value: string | number; sub?: string; accent?: string }) {
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">{label}</p>
      <p className="text-2xl font-bold tabular-nums" style={{ color: accent || BRAND_BLUE }}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

// ─── Section Header ───────────────────────────────────────────────────────────
function SectionHeader({ icon: Icon, title, sub }: { icon: any; title: string; sub?: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <Icon size={16} className="text-[#256984] shrink-0" />
      <div>
        <h2 className="text-sm font-bold text-foreground">{title}</h2>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </div>
    </div>
  );
}

// ─── Horizontal bar row ───────────────────────────────────────────────────────
function BarRow({ label, value, max, sub, color = BRAND_BLUE }: { label: string; value: number; max: number; sub?: string; color?: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="py-2">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-foreground font-medium truncate mr-2 flex-1">{label}</span>
        <span className="text-xs font-bold tabular-nums shrink-0" style={{ color }}>{value}</span>
      </div>
      <div className="h-1.5 rounded-full bg-border overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

// ─── Expandable ingredient card ────────────────────────────────────────────────
function IngredientCard({ item, max }: { item: Ingredient; max: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full px-4 py-2.5 text-left hover:bg-muted/30 transition-colors"
      >
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-semibold text-foreground">{item.name}</span>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-red-500">{item.unitsLost} units lost</span>
            {open ? <ChevronUp size={14} className="text-muted-foreground" /> : <ChevronDown size={14} className="text-muted-foreground" />}
          </div>
        </div>
        <div className="h-1.5 rounded-full bg-border overflow-hidden">
          <div className="h-full rounded-full bg-red-400 transition-all" style={{ width: `${Math.round((item.unitsLost / max) * 100)}%` }} />
        </div>
        <p className="text-[10px] text-muted-foreground mt-0.5">{item.occurrences} occurrence{item.occurrences !== 1 ? "s" : ""}</p>
      </button>
      {open && (
        <div className="px-4 pb-3 border-t border-border/40 bg-muted/20">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mt-2 mb-1">Affected items</p>
          <div className="flex flex-wrap gap-1">
            {item.itemsAffected.map(i => (
              <span key={i} className="inline-block text-[10px] bg-red-50 text-red-700 rounded-full px-2 py-0.5 border border-red-100">{i}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────
export default function MissingItemsReport() {
  const t = today();
  const y = yesterday();

  const tmrw = useMemo(() => { const d = new Date(); d.setDate(d.getDate() + 1); return toAWST(d); }, []);

  const PRESETS = [
    { label: "Today",       from: t,           to: t      },
    { label: "Tomorrow",    from: tmrw,         to: tmrw   },
    { label: "Yesterday",   from: y,            to: y      },
    { label: "Last 7 days", from: daysAgo(6),   to: t      },
    { label: "Last 30 days",from: daysAgo(29),  to: t      },
    { label: "Custom",      from: "",           to: ""     },
  ];

  const [preset, setPreset]     = useState(0); // default today
  const [customFrom, setCustomFrom] = useState(t);
  const [customTo,   setCustomTo]   = useState(t);
  const [logSort, setLogSort]   = useState<"date" | "missing" | "item">("date");
  const [logFilter, setLogFilter] = useState<"all" | "ingredient" | "other">("all");
  const [expandMissed, setExpandMissed] = useState(false);

  const from = preset === 4 ? customFrom : PRESETS[preset].from;
  const to   = preset === 4 ? customTo   : PRESETS[preset].to;

  const { data, isFetching } = useQuery<ReportData>({
    queryKey: ["/api/missing-items/report", from, to],
    queryFn: () => apiRequest("GET", `/api/missing-items/report?from=${from}&to=${to}`).then(r => r.json()),
    enabled: !!from && !!to,
    staleTime: 30 * 1000,
  });

  const multiDay = from !== to;
  const kpis = data?.kpis;
  const fc = kpis ? fillColor(kpis.fillRate) : BRAND_BLUE;

  // Sorted / filtered log
  const filteredLog = useMemo(() => {
    if (!data?.log) return [];
    let rows = data.log;
    if (logFilter !== "all") rows = rows.filter(r => r.reasonType === logFilter);
    return [...rows].sort((a, b) => {
      if (logSort === "missing") return b.missing - a.missing;
      if (logSort === "item")    return a.item.localeCompare(b.item);
      return b.loggedAt.localeCompare(a.loggedAt);
    });
  }, [data, logSort, logFilter]);

  const maxIngUnits = data?.ingredients[0]?.unitsLost ?? 1;
  const maxReasonUnits = data?.reasons[0]?.unitsLost ?? 1;
  const maxItemUnits = data?.missedItems[0]?.unitsLost ?? 1;
  const visibleMissed = expandMissed ? data?.missedItems : data?.missedItems?.slice(0, 8);

  return (
    <div className="min-h-screen bg-background p-4 pb-20 max-w-4xl mx-auto">
      {/* ── Header ── */}
      <div className="mb-5">
        <h1 className="text-lg font-bold text-foreground">Missing Items Report</h1>
        <p className="text-xs text-muted-foreground mt-0.5">Identify what's going wrong and stop it from repeating</p>
      </div>

      {/* ── Date range ── */}
      <div className="bg-card border border-border rounded-xl p-3 mb-5">
        <div className="flex flex-wrap gap-2 mb-3">
          {PRESETS.map((p, i) => (
            <button
              key={p.label}
              onClick={() => setPreset(i)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                preset === i
                  ? "bg-[#256984] text-white"
                  : "bg-muted text-muted-foreground hover:bg-muted/70"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        {preset === 4 && (
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide block mb-1">From</label>
              <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
                className="w-full border border-border rounded-lg px-3 py-1.5 text-xs bg-background text-foreground" />
            </div>
            <div className="flex-1">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide block mb-1">To</label>
              <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)}
                className="w-full border border-border rounded-lg px-3 py-1.5 text-xs bg-background text-foreground" />
            </div>
          </div>
        )}
        {data && !isFetching && (
          <p className="text-[10px] text-muted-foreground mt-2">
            {fmtDate(from)}{from !== to ? ` – ${fmtDate(to)}` : ""} · {data.log.length} records
          </p>
        )}
      </div>

      {isFetching && (
        <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">Loading report…</div>
      )}

      {!isFetching && data && (
        <>
          {/* ── KPI Cards ── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            <KpiCard label="Fill Rate" value={`${kpis!.fillRate}%`} sub={`${kpis!.totalMade} of ${kpis!.totalRequired} made`} accent={fc} />
            <KpiCard label="Units Short" value={kpis!.totalUnits} sub="total items not delivered" accent={kpis!.totalUnits === 0 ? FILL_GREEN : FILL_RED} />
            <KpiCard label="Items Missing" value={kpis!.totalMissing} sub="unique line items" />
            <KpiCard label="Orders Affected" value={kpis!.ordersAffected} sub="customer orders impacted" />
          </div>

          {/* ── Fill rate banner ── */}
          {kpis!.fillRate < 100 && (
            <div className={`rounded-xl px-4 py-3 mb-6 border ${
              kpis!.fillRate >= 95
                ? "bg-amber-50 border-amber-200 text-amber-800"
                : "bg-red-50 border-red-200 text-red-800"
            }`}>
              <div className="flex items-center gap-2">
                <AlertTriangle size={16} />
                <span className="text-sm font-semibold">
                  {kpis!.fillRate >= 95
                    ? `${(100 - kpis!.fillRate).toFixed(1)}% below target — close but needs attention`
                    : `${(100 - kpis!.fillRate).toFixed(1)}% below target — significant gap`}
                </span>
              </div>
              <p className="text-xs mt-0.5 opacity-75">Target is 100% fill rate. {kpis!.totalUnits} units were not delivered to customers.</p>
            </div>
          )}
          {kpis!.fillRate >= 100 && (
            <div className="rounded-xl px-4 py-3 mb-6 border bg-green-50 border-green-200 text-green-800">
              <span className="text-sm font-semibold">✓ 100% fill rate — all items delivered</span>
            </div>
          )}

          {/* ── Day-by-day trend (multi-day only) ── */}
          {multiDay && data.trend.length > 1 && (
            <div className="bg-card border border-border rounded-xl p-4 mb-5">
              <SectionHeader icon={TrendingDown} title="Day-by-Day Trend" sub="Units missing per delivery date" />
              <div className="h-44">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.trend} margin={{ top: 4, right: 4, bottom: 4, left: -20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip
                      formatter={(v: any, name: string) => [v, name === "unitsLost" ? "Units missing" : name]}
                      labelFormatter={l => `Date: ${fmtDate(String(l))}`}
                      contentStyle={{ fontSize: 11, borderRadius: 8 }}
                    />
                    <Bar dataKey="unitsLost" radius={[3, 3, 0, 0]}>
                      {data.trend.map((entry, i) => (
                        <Cell key={i} fill={fillColor(entry.fillRate)} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="flex items-center gap-4 mt-2 text-[10px] text-muted-foreground">
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm inline-block bg-green-400" /> 100% fill</span>
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm inline-block bg-amber-400" /> 95–99%</span>
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm inline-block bg-red-400" /> Below 95%</span>
              </div>
            </div>
          )}

          {/* ── Repeat offenders: side by side ── */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">

            {/* Out of stock ingredients */}
            <div className="bg-card border border-border rounded-xl p-4">
              <SectionHeader icon={Package} title="Out-of-Stock Ingredients" sub="Ranked by units lost — order more of these" />
              {data.ingredients.length === 0 ? (
                <p className="text-xs text-muted-foreground py-4 text-center">No ingredient stockouts in this period</p>
              ) : (
                <div className="space-y-2">
                  {data.ingredients.map(ing => (
                    <IngredientCard key={ing.name} item={ing} max={maxIngUnits} />
                  ))}
                </div>
              )}
            </div>

            {/* Root cause reasons */}
            <div className="bg-card border border-border rounded-xl p-4">
              <SectionHeader icon={Clock} title="Root Causes" sub="Why items weren't made — all reasons combined" />
              {data.reasons.length === 0 ? (
                <p className="text-xs text-muted-foreground py-4 text-center">No data for this period</p>
              ) : (
                <div className="divide-y divide-border/40">
                  {data.reasons.map(r => {
                    const isTime = r.label.toLowerCase().includes("time");
                    const isStock = r.label.toLowerCase().startsWith("out of stock");
                    const color = isTime ? FILL_AMBER : isStock ? FILL_RED : BRAND_BLUE;
                    return (
                      <BarRow
                        key={r.label}
                        label={r.label}
                        value={r.unitsLost}
                        max={maxReasonUnits}
                        sub={`${r.occurrences} occurrence${r.occurrences !== 1 ? "s" : ""}`}
                        color={color}
                      />
                    );
                  })}
                </div>
              )}
              <div className="flex items-center gap-4 mt-3 text-[10px] text-muted-foreground border-t border-border/40 pt-3">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full inline-block bg-red-400" /> Out of stock</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full inline-block bg-amber-400" /> Time pressure</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: BRAND_BLUE }} /> Other</span>
              </div>
            </div>
          </div>

          {/* ── Most missed items ── */}
          <div className="bg-card border border-border rounded-xl p-4 mb-5">
            <SectionHeader icon={AlertTriangle} title="Most Missed Items" sub="Menu items with the highest unit shortfall — consider reviewing stock or prep scheduling" />
            {data.missedItems.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center">No missing items in this period</p>
            ) : (
              <>
                <div className="divide-y divide-border/40">
                  {visibleMissed!.map((item, i) => (
                    <div key={item.name} className="py-2">
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <span className="text-[10px] font-bold text-muted-foreground w-4 shrink-0">{i + 1}</span>
                          <span className="text-xs font-medium text-foreground truncate">{item.name}</span>
                        </div>
                        <div className="flex items-center gap-3 shrink-0 ml-2">
                          <span className="text-[10px] text-muted-foreground">{item.occurrences}×</span>
                          <span className="text-xs font-bold text-red-500">{item.unitsLost} units</span>
                        </div>
                      </div>
                      <div className="h-1.5 rounded-full bg-border overflow-hidden ml-6">
                        <div className="h-full rounded-full transition-all"
                          style={{ width: `${Math.round((item.unitsLost / maxItemUnits) * 100)}%`, backgroundColor: FILL_RED }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                {(data.missedItems.length > 8) && (
                  <button onClick={() => setExpandMissed(e => !e)} className="mt-2 text-xs text-[#256984] font-medium hover:underline w-full text-center">
                    {expandMissed ? "Show less" : `Show all ${data.missedItems.length} items`}
                  </button>
                )}
              </>
            )}
          </div>

          {/* ── Full log ── */}
          <div className="bg-card border border-border rounded-xl overflow-hidden mb-5">
            <div className="px-4 py-3 border-b border-border flex flex-col sm:flex-row sm:items-center gap-2 justify-between">
              <div>
                <h2 className="text-sm font-bold text-foreground">Full Log</h2>
                <p className="text-xs text-muted-foreground">{filteredLog.length} entries</p>
              </div>
              <div className="flex gap-2">
                {/* Filter */}
                <select
                  value={logFilter}
                  onChange={e => setLogFilter(e.target.value as any)}
                  className="text-xs border border-border rounded-lg px-2 py-1.5 bg-background text-foreground"
                >
                  <option value="all">All reasons</option>
                  <option value="ingredient">Out of stock</option>
                  <option value="other">Other</option>
                </select>
                {/* Sort */}
                <select
                  value={logSort}
                  onChange={e => setLogSort(e.target.value as any)}
                  className="text-xs border border-border rounded-lg px-2 py-1.5 bg-background text-foreground"
                >
                  <option value="date">Sort: Date</option>
                  <option value="missing">Sort: Most Missing</option>
                  <option value="item">Sort: Item Name</option>
                </select>
              </div>
            </div>

            {filteredLog.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">No entries for this filter</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Date</th>
                      <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Item</th>
                      <th className="text-center px-3 py-2 font-semibold text-muted-foreground">Req</th>
                      <th className="text-center px-3 py-2 font-semibold text-muted-foreground">Made</th>
                      <th className="text-center px-3 py-2 font-semibold text-muted-foreground text-red-500">Short</th>
                      <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Reason</th>
                      <th className="text-left px-3 py-2 font-semibold text-muted-foreground hidden sm:table-cell">Logged by</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {filteredLog.map(row => (
                      <tr key={row.id} className="hover:bg-muted/20 transition-colors">
                        <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{fmtDate(row.date)}</td>
                        <td className="px-3 py-2 font-medium text-foreground max-w-[140px] truncate">{row.item}</td>
                        <td className="px-3 py-2 text-center text-muted-foreground">{row.required}</td>
                        <td className="px-3 py-2 text-center text-muted-foreground">{row.made}</td>
                        <td className="px-3 py-2 text-center font-bold text-red-500">{row.missing}</td>
                        <td className="px-3 py-2 max-w-[180px]">
                          <span className={`inline-block text-[10px] font-medium rounded-full px-2 py-0.5 ${
                            row.reasonType === "ingredient"
                              ? "bg-red-50 text-red-700 border border-red-100"
                              : row.reasonLabel.toLowerCase().includes("time")
                              ? "bg-amber-50 text-amber-700 border border-amber-100"
                              : "bg-blue-50 text-blue-700 border border-blue-100"
                          }`}>
                            {row.reasonLabel}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground hidden sm:table-cell whitespace-nowrap">{row.staffName}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {!isFetching && !data && (
        <div className="text-center py-16 text-muted-foreground text-sm">Select a date range to load the report</div>
      )}
    </div>
  );
}
