import { useState, useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  TrendingUp, TrendingDown, Minus,
  RefreshCw, AlertTriangle, ChefHat,
  Car, Store, Clock, DollarSign,
  PlugZap, Calendar
} from "lucide-react";
import { RevenueChart } from "@/components/RevenueChart";

// ─── Types ────────────────────────────────────────────────────────────────────
interface AreaData {
  wages: number;
  oncost: number;
  hours: number;
  shifts: number;
  pendingWages?: number;
  pendingShifts?: number;
}

interface WagesDashboardData {
  period: { from: string; to: string };
  areas: {
    cbd_store?: AreaData;
    drivers?: AreaData;
    production?: AreaData;
  };
  flex?: {
    cateringGross: number;
    cateringExGst: number;
    cateringExGstInclWholesale: number;
    cateringGrossInclWholesale: number;
    orderCount: number;
  };
  xero?: {
    deliveryFee: number | null;
    note: string;
  };
  errors: string[];
  fetchedAt: string;
}

interface XeroDeliveryResult {
  deliveryFee: number;
  lineCount: number;
  invoiceCount: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function fmt$(n: number | null | undefined) {
  if (n == null || isNaN(n)) return "—";
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
}

function fmtPct(n: number | null | undefined) {
  if (n == null || isNaN(n) || !isFinite(n)) return "—";
  return `${n.toFixed(1)}%`;
}

function getWeekBounds(offsetWeeks = 0) {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0=Sun
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((dayOfWeek + 6) % 7) + offsetWeeks * 7);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  return {
    from: monday.toISOString().split("T")[0],
    to: sunday.toISOString().split("T")[0],
  };
}

function formatDateRange(from: string, to: string) {
  const f = new Date(from + "T12:00:00");
  const t = new Date(to + "T12:00:00");
  const opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };
  return `${f.toLocaleDateString("en-AU", opts)} – ${t.toLocaleDateString("en-AU", opts)}`;
}

// ─── KPI Status ──────────────────────────────────────────────────────────────
type KpiStatus = "green" | "amber" | "red" | "unknown";

function getKpiStatus(wagesPct: number | null, target: number): KpiStatus {
  if (wagesPct == null || isNaN(wagesPct) || !isFinite(wagesPct)) return "unknown";
  if (wagesPct <= target) return "green";
  if (wagesPct <= target + 5) return "amber";
  return "red";
}

const STATUS_COLORS: Record<KpiStatus, string> = {
  green: "bg-green-100 text-green-800 border-green-200",
  amber: "bg-amber-100 text-amber-800 border-amber-200",
  red: "bg-red-100 text-red-800 border-red-200",
  unknown: "bg-muted text-muted-foreground border-border",
};

const STATUS_BG: Record<KpiStatus, string> = {
  green: "border-green-200 bg-green-50/30",
  amber: "border-amber-200 bg-amber-50/30",
  red: "border-red-200 bg-red-50/30",
  unknown: "",
};

// ─── KPI Card ────────────────────────────────────────────────────────────────
function KpiCard({
  title,
  icon: Icon,
  wages,
  sales,
  salesLabel,
  target,
  hours,
  shifts,
  pendingWages,
  salesNote,
  isLoading,
}: {
  title: string;
  icon: React.ElementType;
  wages: number | null;
  sales: number | null;
  salesLabel: string;
  target: number;
  hours?: number;
  shifts?: number;
  pendingWages?: number;
  salesNote?: string;
  isLoading?: boolean;
}) {
  const wagesPct = wages != null && sales != null && sales > 0
    ? (wages / sales) * 100
    : null;
  const status = getKpiStatus(wagesPct, target);

  const StatusIcon = status === "green" ? TrendingDown
    : status === "amber" ? Minus
    : status === "red" ? TrendingUp
    : Minus;

  return (
    <Card className={cn("transition-all", STATUS_BG[status])}>
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Icon size={15} className="text-primary" />
            {title}
          </CardTitle>
          {!isLoading && (
            <Badge className={cn("text-xs border font-semibold tabular-nums", STATUS_COLORS[status])}>
              <StatusIcon size={11} className="mr-1" />
              {status === "unknown" ? "No data" : fmtPct(wagesPct)}
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Target: <strong>{target}%</strong> of {salesLabel}
          {salesNote && <span className="ml-1 opacity-70">{salesNote}</span>}
        </p>
      </CardHeader>
      <CardContent className="pb-4 px-4 space-y-3">
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ) : (
          <>
            {/* Main metrics row */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-background rounded-lg border border-border p-2.5">
                <p className="text-xs text-muted-foreground mb-0.5">Wages + Super</p>
                <p className="text-lg font-bold tabular-nums text-foreground">
                  {fmt$(wages)}
                </p>
                {pendingWages != null && pendingWages > 0 && (
                  <p className="text-xs text-amber-600 mt-0.5">
                    +{fmt$(pendingWages)} pending
                  </p>
                )}
              </div>
              <div className="bg-background rounded-lg border border-border p-2.5">
                <p className="text-xs text-muted-foreground mb-0.5">{salesLabel}</p>
                <p className="text-lg font-bold tabular-nums text-foreground">
                  {fmt$(sales)}
                </p>
                {salesNote && (
                  <p className="text-xs text-muted-foreground mt-0.5">{salesNote}</p>
                )}
              </div>
            </div>

            {/* Wage % bar */}
            {wagesPct != null && sales != null && sales > 0 && (
              <div>
                <div className="flex justify-between text-xs text-muted-foreground mb-1">
                  <span>Wages %</span>
                  <span className={cn("font-semibold tabular-nums",
                    status === "green" ? "text-green-700" :
                    status === "amber" ? "text-amber-700" : "text-red-700"
                  )}>
                    {fmtPct(wagesPct)} / {fmtPct(target)} target
                  </span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  {/* Target marker */}
                  <div
                    className={cn("h-full rounded-full transition-all duration-500",
                      status === "green" ? "bg-green-500" :
                      status === "amber" ? "bg-amber-500" : "bg-red-500"
                    )}
                    style={{ width: `${Math.min(wagesPct, 100)}%` }}
                  />
                </div>
                {/* Target line */}
                <div className="relative h-1">
                  <div
                    className="absolute top-0 w-0.5 h-3 -mt-2 bg-foreground/30 rounded"
                    style={{ left: `${Math.min(target, 100)}%` }}
                    title={`Target: ${target}%`}
                  />
                </div>
              </div>
            )}

            {/* Hours/shifts */}
            {(hours != null || shifts != null) && (
              <div className="flex gap-3 text-xs text-muted-foreground">
                {hours != null && (
                  <span className="flex items-center gap-1">
                    <Clock size={11} /> {hours.toFixed(1)}h
                  </span>
                )}
                {shifts != null && (
                  <span className="flex items-center gap-1">
                    {shifts} shift{shifts !== 1 ? "s" : ""}
                  </span>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Week Picker ─────────────────────────────────────────────────────────────
function WeekPicker({
  from, to, onWeekChange
}: {
  from: string;
  to: string;
  onWeekChange: (from: string, to: string) => void;
}) {
  const [offset, setOffset] = useState(0);
  const currentWeek = getWeekBounds(0);
  const isCurrentWeek = from === currentWeek.from;

  function shift(delta: number) {
    const next = getWeekBounds(offset + delta);
    setOffset(o => o + delta);
    onWeekChange(next.from, next.to);
  }

  return (
    <div className="flex items-center gap-2 text-sm">
      <Button variant="outline" size="sm" className="h-7 w-7 p-0" onClick={() => shift(-1)}>
        ‹
      </Button>
      <div className="flex items-center gap-1.5 text-sm font-medium min-w-[160px] justify-center">
        <Calendar size={13} className="text-muted-foreground" />
        {isCurrentWeek ? "This week" : formatDateRange(from, to)}
      </div>
      <Button variant="outline" size="sm" className="h-7 w-7 p-0" onClick={() => shift(1)} disabled={isCurrentWeek}>
        ›
      </Button>
      {!isCurrentWeek && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs text-muted-foreground hover:text-foreground"
          onClick={() => { setOffset(0); onWeekChange(currentWeek.from, currentWeek.to); }}
        >
          Current week
        </Button>
      )}
    </div>
  );
}

// ─── Xero Fetch Hook ─────────────────────────────────────────────────────────
// Since Xero OAuth is only available on the server via Pipedream connector (not
// directly accessible from our Express server), we expose a lightweight approach:
// the frontend fetches Xero data via our proxy endpoint and sends results to backend.
// For now we show a "Connect" state for Xero until credentials are server-side.

// ─── Main Component ───────────────────────────────────────────────────────────
export default function WagesDashboard({ embedded = false }: { embedded?: boolean }) {
  const currentWeek = getWeekBounds(0);
  const [period, setPeriod] = useState(currentWeek);
  const [xeroDeliveryFee, setXeroDeliveryFee] = useState<number | null>(null);
  const [xeroLoading, setXeroLoading] = useState(false);
  const [xeroError, setXeroError] = useState<string | null>(null);
  const [xeroLastUpdated, setXeroLastUpdated] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const [forceRefresh, setForceRefresh] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery<WagesDashboardData>({
    queryKey: ["/api/wages-dashboard", period.from, period.to, forceRefresh],
    queryFn: () =>
      apiRequest("GET", `/api/wages-dashboard?from=${period.from}&to=${period.to}${forceRefresh ? '&refresh=true' : ''}`)
        .then(r => { setForceRefresh(false); return r.json(); }),
    staleTime: 14 * 60 * 1000, // matches server 15min TTL
    refetchOnWindowFocus: false,
  });

  const { data: settings = {} as any } = useQuery({
    queryKey: ["/api/settings"],
    queryFn: () => apiRequest("GET", "/api/settings").then(r => r.json()),
  });

  // Fetch Xero delivery fee via our backend proxy endpoint
  // We call our own backend which has stored the Pipedream Xero token
  const fetchXeroDelivery = useCallback(async () => {
    setXeroLoading(true);
    setXeroError(null);
    try {
      const res = await apiRequest("GET", `/api/wages-dashboard/xero?from=${period.from}&to=${period.to}`);
      if (res.ok) {
        const json = await res.json();
        setXeroDeliveryFee(json.deliveryFee ?? null);
        setXeroLastUpdated(json.lastUpdated ?? null);
      } else {
        setXeroError("Xero fetch failed");
      }
    } catch (e: any) {
      setXeroError(e.message);
    } finally {
      setXeroLoading(false);
    }
  }, [period]);

  useEffect(() => {
    fetchXeroDelivery();
  }, [fetchXeroDelivery]);

  function handleWeekChange(from: string, to: string) {
    setPeriod({ from, to });
    setXeroDeliveryFee(null);
    setXeroLastUpdated(null);
  }

  function handleRefresh() {
    setLastRefresh(new Date());
    setForceRefresh(true); // bust server-side cache
    fetchXeroDelivery();
  }

  const cbdArea = data?.areas?.cbd_store;
  const productionArea = data?.areas?.production;
  const driversArea = data?.areas?.drivers;
  const cateringExGst = data?.flex?.cateringExGst ?? null;
  const cateringGross = data?.flex?.cateringGross ?? null;
  const cateringExGstInclWholesale = data?.flex?.cateringExGstInclWholesale ?? null;

  // Total wages summary
  const totalWages = (cbdArea?.wages ?? 0) + (productionArea?.wages ?? 0) + (driversArea?.wages ?? 0);
  const totalHours = (cbdArea?.hours ?? 0) + (productionArea?.hours ?? 0) + (driversArea?.hours ?? 0);

  const hasErrors = data?.errors && data.errors.length > 0;

  return (
    <div className={embedded ? "p-6 space-y-6 border-b border-border pb-8 mb-2" : "p-6 space-y-6 max-w-screen-xl"}>
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          {!embedded && (
            <h1 className="text-xl font-bold text-foreground" style={{ fontFamily: "'Cabinet Grotesk', sans-serif" }}>
              Wages Dashboard
            </h1>
          )}
          <p className={embedded ? "text-sm font-semibold text-foreground" : "text-sm text-muted-foreground mt-1"}>
            {embedded ? "Wages & Revenue" : "Wages vs sales by area — "} {embedded ? `· week of ${formatDateRange(period.from, period.to)}` : `week of ${formatDateRange(period.from, period.to)}`}
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <WeekPicker from={period.from} to={period.to} onWeekChange={handleWeekChange} />
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={handleRefresh}
            disabled={isLoading}
            data-testid="button-refresh-wages"
          >
            <RefreshCw size={13} className={isLoading ? "animate-spin" : ""} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Error banner */}
      {hasErrors && (
        <Card className="border-amber-200 bg-amber-50/40">
          <CardContent className="py-3 px-4">
            <div className="flex items-start gap-2">
              <AlertTriangle size={15} className="text-amber-600 mt-0.5 shrink-0" />
              <div className="text-sm">
                <p className="font-semibold text-amber-800 mb-1">Some data could not be fetched</p>
                {data?.errors.map((e, i) => (
                  <p key={i} className="text-xs text-amber-700">{e}</p>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Summary KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-1">Total Wages + Super</p>
            {isLoading ? <Skeleton className="h-8 w-24" /> : (
              <p className="text-2xl font-bold tabular-nums text-foreground">{fmt$(totalWages)}</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-1">Catering Sales (ex GST)</p>
            {isLoading ? <Skeleton className="h-8 w-24" /> : (
              <>
                <p className="text-2xl font-bold tabular-nums text-foreground">{fmt$(cateringExGst)}</p>
                {data?.flex?.orderCount != null && (
                  <p className="text-xs text-muted-foreground">{data.flex.orderCount} orders</p>
                )}
              </>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-1">Total Hours Worked</p>
            {isLoading ? <Skeleton className="h-8 w-24" /> : (
              <p className="text-2xl font-bold tabular-nums text-foreground">
                {totalHours > 0 ? `${totalHours.toFixed(1)}h` : "—"}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Area KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* CBD Store */}
        <KpiCard
          title="CBD Store"
          icon={Store}
          wages={cbdArea?.wages ?? null}
          sales={null}
          salesLabel="Lightspeed Turnover"
          target={26}
          hours={cbdArea?.hours}
          shifts={cbdArea?.shifts}
          pendingWages={cbdArea?.pendingWages}
          salesNote="(credentials pending)"
          isLoading={isLoading}
        />

        {/* Production Kitchen */}
        <KpiCard
          title="Production Kitchen"
          icon={ChefHat}
          wages={productionArea?.wages ?? null}
          sales={cateringExGstInclWholesale}
          salesLabel="Catering Sales (incl. wholesale)"
          target={16}
          hours={productionArea?.hours}
          shifts={productionArea?.shifts}
          pendingWages={productionArea?.pendingWages}
          salesNote="ex GST, incl. wholesale"
          isLoading={isLoading}
        />

        {/* Drivers */}
        <KpiCard
          title="Drivers"
          icon={Car}
          wages={driversArea?.wages ?? null}
          sales={xeroDeliveryFee}
          salesLabel="Delivery Fee"
          target={88}
          hours={driversArea?.hours}
          shifts={driversArea?.shifts}
          pendingWages={driversArea?.pendingWages}
          salesNote="Xero acct 202, inc GST"
          isLoading={isLoading || xeroLoading}
        />
      </div>

      {/* Revenue Line Chart */}
      <RevenueChart />

      {/* Xero status / connect block */}
      <Card className={cn("border-dashed", xeroDeliveryFee == null && !xeroLoading ? "border-muted" : "border-transparent")}>
        <CardContent className="py-4 px-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <div className="rounded-full bg-muted p-2">
                <DollarSign size={15} className="text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">
                  Xero – Delivery Fee (Account 202)
                </p>
                <p className="text-xs text-muted-foreground">
                  {xeroLoading
                    ? "Loading cached Xero data…"
                    : xeroError
                    ? `Error: ${xeroError}`
                    : xeroDeliveryFee != null
                    ? `${fmt$(xeroDeliveryFee)} delivery fee for this period (inc GST)${
                        xeroLastUpdated
                          ? ` · synced ${new Date(xeroLastUpdated).toLocaleString("en-AU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`
                          : ""
                      }`
                    : "Not yet synced for this period — Computer syncs Xero weekly"}
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1.5"
              onClick={fetchXeroDelivery}
              disabled={xeroLoading}
              data-testid="button-refresh-xero"
            >
              <RefreshCw size={12} className={xeroLoading ? "animate-spin" : ""} />
              {xeroLoading ? "Loading…" : "Check Cache"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Lightspeed connect block */}
      <Card className="border-dashed border-muted">
        <CardContent className="py-4 px-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <div className="rounded-full bg-muted p-2">
                <PlugZap size={15} className="text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">
                  Lightspeed O-Series — CBD Store Turnover
                </p>
                <p className="text-xs text-muted-foreground">
                  Awaiting API credentials. Once connected, CBD Store wages % will calculate automatically.
                </p>
              </div>
            </div>
            <Badge variant="outline" className="text-xs text-muted-foreground">
              Pending credentials
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Deputy data note */}
      {data && !isLoading && (
        <p className="text-xs text-muted-foreground text-right">
          Deputy data: approved timesheets only · last fetched {new Date(data.fetchedAt).toLocaleTimeString("en-AU")}{(data as any)._cached ? ' · cached (tap Refresh for live data)' : ''}
        </p>
      )}
    </div>
  );
}
