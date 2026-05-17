import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { TrendingUp, RefreshCw } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────
type RangeKey = "this_month" | "last_month" | "ytd" | "all_time";

interface DataPoint {
  date: string;
  catering: number;
  delivery: number;
  cbd: number;
  total: number;
}

interface RevenueChartData {
  range: string;
  groupBy: "day" | "week";
  from: string;
  to: string;
  dataPoints: DataPoint[];
  totalOrders: number;
  error?: string;
}

// ─── Config ───────────────────────────────────────────────────────────────────
const RANGES: { key: RangeKey; label: string }[] = [
  { key: "this_month", label: "This month" },
  { key: "last_month", label: "Last month" },
  { key: "ytd", label: "Year to date" },
  { key: "all_time", label: "All time" },
];

// Line colours matching app palette
const LINES = [
  { key: "total",    label: "Total",      colour: "#256984", dash: false,   width: 2.5 },
  { key: "catering", label: "Catering",   colour: "#10b981", dash: false,   width: 1.5 },
  { key: "delivery", label: "Drivers",    colour: "#f59e0b", dash: false,   width: 1.5 },
  { key: "cbd",      label: "CBD Store",  colour: "#8b5cf6", dash: true,    width: 1.5 },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────
function fmt$(n: number) {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${Math.round(n)}`;
}

function formatXAxis(dateStr: string, groupBy: "day" | "week"): string {
  const d = new Date(dateStr + "T12:00:00");
  if (groupBy === "day") {
    return d.toLocaleDateString("en-AU", { day: "numeric", month: "short" });
  }
  // Week: show "12 May" for the Monday
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}

function formatTooltipDate(dateStr: string, groupBy: "day" | "week"): string {
  const d = new Date(dateStr + "T12:00:00");
  if (groupBy === "day") {
    return d.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" });
  }
  // Week ending Sunday
  const monday = new Date(d);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };
  return `Week ${monday.toLocaleDateString("en-AU", opts)} – ${sunday.toLocaleDateString("en-AU", opts)}`;
}

// Custom tooltip
function CustomTooltip({ active, payload, label, groupBy }: any) {
  if (!active || !payload?.length) return null;
  const dateLabel = formatTooltipDate(label, groupBy);
  return (
    <div className="bg-background border border-border rounded-lg shadow-lg p-3 text-sm min-w-[180px]">
      <p className="font-semibold text-foreground mb-2 text-xs">{dateLabel}</p>
      {payload
        .filter((p: any) => p.value > 0 || p.dataKey !== "cbd")
        .map((p: any) => (
          <div key={p.dataKey} className="flex justify-between gap-4 text-xs">
            <span style={{ color: p.color }}>{p.name}</span>
            <span className="font-semibold tabular-nums" style={{ color: p.color }}>
              ${p.value.toLocaleString("en-AU", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
            </span>
          </div>
        ))}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export function RevenueChart() {
  const [range, setRange] = useState<RangeKey>("this_month");
  const [hiddenLines, setHiddenLines] = useState<Set<string>>(new Set(["cbd"])); // CBD hidden by default (no data)

  const { data, isLoading, isError, refetch } = useQuery<RevenueChartData>({
    queryKey: ["/api/revenue-chart", range],
    queryFn: () =>
      apiRequest("GET", `/api/revenue-chart?range=${range}`).then(r => r.json()),
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const groupBy = data?.groupBy ?? "day";

  // Compute x-axis tick density — show every Nth label to avoid crowding
  const pointCount = data?.dataPoints?.length ?? 0;
  const tickInterval = pointCount > 60 ? 7 : pointCount > 30 ? 3 : pointCount > 14 ? 1 : 0;

  // Summary totals for the period
  const totals = data?.dataPoints?.reduce(
    (acc, d) => ({
      catering: acc.catering + d.catering,
      delivery: acc.delivery + d.delivery,
      total: acc.total + d.total,
    }),
    { catering: 0, delivery: 0, total: 0 }
  ) ?? { catering: 0, delivery: 0, total: 0 };

  function toggleLine(key: string) {
    setHiddenLines(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  return (
    <Card>
      <CardHeader className="pb-3 pt-4 px-4">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
              <TrendingUp size={15} className="text-primary" />
              Revenue — Money In
            </CardTitle>
            {!isLoading && data && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {data.totalOrders} orders · {groupBy === "day" ? "Daily" : "Weekly"} view
              </p>
            )}
          </div>

          {/* Range selector */}
          <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
            {RANGES.map(r => (
              <button
                key={r.key}
                className={cn(
                  "px-3 py-1 rounded-md text-xs font-medium transition-colors",
                  range === r.key
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
                onClick={() => setRange(r.key)}
                data-testid={`range-${r.key}`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        {/* Period totals */}
        {!isLoading && data && (
          <div className="flex gap-4 mt-2 flex-wrap">
            {[
              { label: "Total", value: totals.total, colour: "#256984" },
              { label: "Catering", value: totals.catering, colour: "#10b981" },
              { label: "Drivers", value: totals.delivery, colour: "#f59e0b" },
            ].map(({ label, value, colour }) => (
              <div key={label} className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: colour }} />
                <span className="text-xs text-muted-foreground">{label}:</span>
                <span className="text-xs font-semibold tabular-nums text-foreground">
                  ${value.toLocaleString("en-AU", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardHeader>

      <CardContent className="pb-4 px-2">
        {isLoading ? (
          <div className="h-64 flex items-center justify-center">
            <div className="space-y-3 w-full px-4">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-48 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          </div>
        ) : isError || data?.error ? (
          <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">
            Could not load revenue data
          </div>
        ) : !data?.dataPoints?.length ? (
          <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">
            No orders found for this period
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <LineChart
              data={data.dataPoints}
              margin={{ top: 8, right: 16, left: 0, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={d => formatXAxis(d, groupBy)}
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                tickLine={false}
                axisLine={false}
                interval={tickInterval}
              />
              <YAxis
                tickFormatter={fmt$}
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                tickLine={false}
                axisLine={false}
                width={48}
              />
              <Tooltip
                content={<CustomTooltip groupBy={groupBy} />}
                cursor={{ stroke: "hsl(var(--border))", strokeWidth: 1 }}
              />
              {LINES.map(line => (
                !hiddenLines.has(line.key) && (
                  <Line
                    key={line.key}
                    type="monotone"
                    dataKey={line.key}
                    name={line.label}
                    stroke={line.colour}
                    strokeWidth={line.width}
                    strokeDasharray={line.dash ? "4 4" : undefined}
                    dot={false}
                    activeDot={{ r: 4, strokeWidth: 0 }}
                  />
                )
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}

        {/* Custom legend with toggle */}
        <div className="flex items-center justify-center gap-4 mt-2 flex-wrap px-4">
          {LINES.map(line => {
            const isHidden = hiddenLines.has(line.key);
            const isCbd = line.key === "cbd";
            return (
              <button
                key={line.key}
                onClick={() => toggleLine(line.key)}
                className={cn(
                  "flex items-center gap-1.5 text-xs transition-opacity",
                  isHidden ? "opacity-30" : "opacity-100",
                  isCbd && "cursor-default"
                )}
                title={isCbd ? "CBD Store — Lightspeed credentials pending" : undefined}
                data-testid={`legend-${line.key}`}
              >
                <div
                  className="rounded-full"
                  style={{
                    width: 20,
                    height: 2.5,
                    backgroundColor: line.colour,
                    borderTop: line.dash ? `2px dashed ${line.colour}` : undefined,
                    backgroundColor: line.dash ? "transparent" : line.colour,
                  } as any}
                />
                <span className="text-muted-foreground">
                  {line.label}
                  {isCbd && <span className="ml-1 text-[10px] opacity-60">(pending)</span>}
                </span>
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
