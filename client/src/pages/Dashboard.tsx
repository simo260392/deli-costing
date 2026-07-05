import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/context/AuthContext";
import { cn } from "@/lib/utils";
import {
  AlertTriangle, CheckCircle, Thermometer, Package, TrendingUp,
  ClipboardCheck, DollarSign, ShoppingBag, FileText, ChevronRight,
  Sparkles, Clock, Users
} from "lucide-react";

// ── helpers ──────────────────────────────────────────────────────────────────
function currency(n: number | null | undefined) {
  if (n == null) return "—";
  return `$${n.toLocaleString("en-AU", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}
function pct(n: number | null | undefined) {
  if (n == null) return "—";
  return `${n.toFixed(1)}%`;
}
function todayAWST() {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
function thisWeekRange() {
  const now = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const day = now.getUTCDay();
  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() - ((day + 6) % 7));
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return {
    from: monday.toISOString().slice(0, 10),
    to: sunday.toISOString().slice(0, 10),
  };
}
function lastWeekRange() {
  const { from } = thisWeekRange();
  const lastMon = new Date(from);
  lastMon.setUTCDate(lastMon.getUTCDate() - 7);
  const lastSun = new Date(lastMon);
  lastSun.setUTCDate(lastMon.getUTCDate() + 6);
  return {
    from: lastMon.toISOString().slice(0, 10),
    to: lastSun.toISOString().slice(0, 10),
  };
}

function delta(curr: number | null, prev: number | null) {
  if (!curr || !prev || prev === 0) return null;
  return ((curr - prev) / prev) * 100;
}

// ── sub-components ───────────────────────────────────────────────────────────

function SectionHeader({ icon: Icon, label, count, color = "#256984" }: {
  icon: any; label: string; count?: number; color?: string;
}) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <Icon size={16} style={{ color }} />
      <h2 className="text-sm font-semibold text-gray-800">{label}</h2>
      {count != null && count > 0 && (
        <span className="ml-auto text-xs font-medium px-2 py-0.5 rounded-full bg-red-100 text-red-700">
          {count}
        </span>
      )}
      {count === 0 && (
        <span className="ml-auto">
          <CheckCircle size={14} className="text-green-500" />
        </span>
      )}
    </div>
  );
}

function AlertRow({ label, sub, href }: { label: string; sub?: string; href: string }) {
  return (
    <Link href={href}>
      <div className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-gray-50 cursor-pointer group transition-colors">
        <div>
          <p className="text-sm text-gray-800 font-medium">{label}</p>
          {sub && <p className="text-xs text-gray-500">{sub}</p>}
        </div>
        <ChevronRight size={14} className="text-gray-300 group-hover:text-[#256984] transition-colors" />
      </div>
    </Link>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 py-3 px-3 text-sm text-green-600">
      <CheckCircle size={14} />
      <span>{label}</span>
    </div>
  );
}

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("bg-white rounded-xl border border-gray-100 shadow-sm p-4", className)}>
      {children}
    </div>
  );
}

// ── Sales KPI card ────────────────────────────────────────────────────────────
function KpiCard({ label, value, prev, icon: Icon, href, loading }: {
  label: string; value: number | null; prev: number | null; icon: any; href: string; loading?: boolean;
}) {
  const d = delta(value, prev);
  return (
    <Link href={href}>
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 cursor-pointer hover:border-[#256984]/40 hover:shadow-md transition-all group">
        <div className="flex items-start justify-between mb-2">
          <div className="p-1.5 rounded-lg" style={{ backgroundColor: "#256984" + "18" }}>
            <Icon size={15} style={{ color: "#256984" }} />
          </div>
          {d != null && (
            <span className={cn(
              "text-xs font-medium px-1.5 py-0.5 rounded-full",
              d >= 0 ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
            )}>
              {d >= 0 ? "↑" : "↓"} {Math.abs(d).toFixed(0)}%
            </span>
          )}
        </div>
        {loading ? (
          <div className="space-y-1">
            <div className="h-6 w-20 bg-gray-100 rounded animate-pulse" />
            <div className="h-3 w-16 bg-gray-100 rounded animate-pulse" />
          </div>
        ) : (
          <>
            <p className="text-xl font-bold text-gray-900 tabular-nums">{currency(value)}</p>
            <p className="text-xs text-gray-500 mt-0.5">{label}</p>
            {prev != null && (
              <p className="text-xs text-gray-400 mt-0.5">Last week: {currency(prev)}</p>
            )}
          </>
        )}
      </div>
    </Link>
  );
}

// ── Wages row ────────────────────────────────────────────────────────────────
function WagesRow({ label, wages, sales, target, loading }: {
  label: string; wages: number | null; sales: number | null; target: number; loading: boolean;
}) {
  const actualPct = wages && sales ? (wages / sales) * 100 : null;
  const ok = actualPct != null && actualPct <= target;
  return (
    <div className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
      <span className="text-sm text-gray-700">{label}</span>
      {loading ? (
        <div className="h-4 w-28 bg-gray-100 rounded animate-pulse" />
      ) : (
        <div className="flex items-center gap-3">
          <span className="text-sm tabular-nums text-gray-600">{currency(wages)}</span>
          <span className={cn(
            "text-xs font-medium px-1.5 py-0.5 rounded-full tabular-nums",
            actualPct == null ? "bg-gray-100 text-gray-500" :
            ok ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
          )}>
            {pct(actualPct)} <span className="opacity-60">/ {target}%</span>
          </span>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Dashboard
// ─────────────────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const { staff, hasAccess } = useAuth();
  const isAdmin = staff?.accessLevel?.name === "Admin";

  const today = todayAWST();
  const thisWeek = thisWeekRange();
  const lastWeek = lastWeekRange();

  // Fast summary (alerts only — no external API calls)
  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ["/api/dashboard-summary"],
    queryFn: () => apiRequest("GET", "/api/dashboard-summary").then(r => r.json()),
    staleTime: 2 * 60 * 1000,
  });

  // Wages + catering sales this week
  const { data: wagesThis, isLoading: wagesThisLoading } = useQuery({
    queryKey: ["/api/wages-dashboard", thisWeek.from, thisWeek.to],
    queryFn: () => apiRequest("GET", `/api/wages-dashboard?from=${thisWeek.from}&to=${thisWeek.to}`).then(r => r.json()),
    staleTime: 5 * 60 * 1000,
    enabled: hasAccess("wages") || isAdmin,
  });

  // Wages + catering sales last week
  const { data: wagesLast, isLoading: wagesLastLoading } = useQuery({
    queryKey: ["/api/wages-dashboard", lastWeek.from, lastWeek.to],
    queryFn: () => apiRequest("GET", `/api/wages-dashboard?from=${lastWeek.from}&to=${lastWeek.to}`).then(r => r.json()),
    staleTime: 30 * 60 * 1000,
    enabled: hasAccess("wages") || isAdmin,
  });

  // CBD store sales (Lightspeed — monthly, we'll use current month)
  const { data: cbdData } = useQuery({
    queryKey: ["/api/lightspeed/turnover"],
    queryFn: () => apiRequest("GET", "/api/lightspeed/turnover").then(r => r.json()),
    staleTime: 30 * 60 * 1000,
    enabled: hasAccess("wages") || isAdmin,
  });

  const wagesLoading = wagesThisLoading || wagesLastLoading;

  // Extract values
  const cateringThis = wagesThis?.flex?.cateringExGstInclWholesale ?? null;
  const cateringLast = wagesLast?.flex?.cateringExGstInclWholesale ?? null;

  const cbdRows: any[] = cbdData?.rows || [];
  const currentMonthStr = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 7);
  const lastMonthStr = new Date(Date.now() + 8 * 60 * 60 * 1000 - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 7);
  const cbdThis = cbdRows.find((r: any) => r.month_start?.startsWith(currentMonthStr))?.net_amount ?? null;
  const cbdLast = cbdRows.find((r: any) => r.month_start?.startsWith(lastMonthStr))?.net_amount ?? null;

  const totalWagesThis = wagesThis?.areas
    ? Object.values(wagesThis.areas).reduce((sum: number, a: any) => sum + (a.totalWages || 0), 0)
    : null;
  const totalWagesLast = wagesLast?.areas
    ? Object.values(wagesLast.areas).reduce((sum: number, a: any) => sum + (a.totalWages || 0), 0)
    : null;

  const cbdWagesThis = (wagesThis?.areas as any)?.cbd_store?.totalWages ?? null;
  const productionWagesThis = (wagesThis?.areas as any)?.production?.totalWages ?? null;
  const driverWagesThis = (wagesThis?.areas as any)?.drivers?.totalWages ?? null;

  // Alert counts from summary
  const missingCount = summary?.missingItems?.length ?? 0;
  const fridgeCount = summary?.fridgeAlerts?.length ?? 0;
  const fcCount = summary?.fcIssues?.length ?? 0;
  const complianceCount = summary?.pendingComplianceLogs?.length ?? 0;
  const xeroCount = summary?.pendingXeroInvoices ?? 0;

  const showSales = hasAccess("wages") || isAdmin;
  const showCompliance = hasAccess("compliance") || isAdmin;
  const showProducts = hasAccess("products") || isAdmin;
  const showProduction = hasAccess("prep") || isAdmin;

  const dayLabel = new Date(Date.now() + 8 * 60 * 60 * 1000)
    .toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" });

  return (
    <div className="p-4 max-w-5xl mx-auto space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-[#256984]">Good morning{staff?.name ? `, ${staff.name.split(' ')[0]}` : ""}</h1>
          <p className="text-sm text-gray-500">{dayLabel}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-gray-400">The Deli by Greenhorns</p>
          {(missingCount + fridgeCount + complianceCount) > 0 && (
            <p className="text-xs font-semibold text-red-500 mt-0.5">
              {missingCount + fridgeCount + complianceCount} alert{missingCount + fridgeCount + complianceCount !== 1 ? "s" : ""} need attention
            </p>
          )}
        </div>
      </div>

      {/* ── Sales KPIs ───────────────────────────────────────────────────── */}
      {showSales && (
        <section id="sales">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">This Week vs Last Week</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <KpiCard
              label="Catering sales (ex GST)"
              value={cateringThis}
              prev={cateringLast}
              icon={TrendingUp}
              href="/wages"
              loading={wagesLoading}
            />
            <KpiCard
              label="CBD store (this month)"
              value={cbdThis}
              prev={cbdLast}
              icon={ShoppingBag}
              href="/wages"
              loading={false}
            />
            <KpiCard
              label="Total wages"
              value={totalWagesThis}
              prev={totalWagesLast}
              icon={Users}
              href="/wages"
              loading={wagesLoading}
            />
          </div>
        </section>
      )}

      {/* ── Wages breakdown ─────────────────────────────────────────────── */}
      {showSales && (
        <Card>
          <SectionHeader icon={DollarSign} label="Wages vs Sales Targets" />
          <WagesRow label="CBD Store" wages={cbdWagesThis} sales={cateringThis} target={26} loading={wagesLoading} />
          <WagesRow label="Production Kitchen" wages={productionWagesThis} sales={cateringThis} target={16} loading={wagesLoading} />
          <WagesRow label="Drivers" wages={driverWagesThis} sales={cateringThis} target={88} loading={wagesLoading} />
          <div className="mt-3 pt-2">
            <Link href="/wages">
              <span className="text-xs text-[#256984] font-medium hover:underline cursor-pointer">
                View full wages dashboard →
              </span>
            </Link>
          </div>
        </Card>
      )}

      {/* ── Alerts grid ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

        {/* Missing items today */}
        {showProduction && (
          <Card id="missing-items">
            <SectionHeader icon={Package} label="Missing Items Today" count={missingCount} />
            {summaryLoading ? (
              <div className="space-y-1">{[1,2].map(i => <div key={i} className="h-10 bg-gray-100 rounded-lg animate-pulse" />)}</div>
            ) : missingCount === 0 ? (
              <EmptyState label="No missing items today" />
            ) : (
              <div className="-mx-1">
                {summary.missingItems.slice(0, 5).map((item: any) => (
                  <AlertRow
                    key={item.id}
                    label={item.item_name}
                    sub={item.reason_ingredient ? `Out of stock: ${item.reason_ingredient}` : item.reason_other || undefined}
                    href="/prep"
                  />
                ))}
                {missingCount > 5 && (
                  <Link href="/prep">
                    <p className="text-xs text-[#256984] font-medium px-3 py-1 hover:underline cursor-pointer">
                      +{missingCount - 5} more →
                    </p>
                  </Link>
                )}
              </div>
            )}
          </Card>
        )}

        {/* Fridge alerts */}
        {showCompliance && (
          <Card id="fridge-alerts">
            <SectionHeader icon={Thermometer} label="Fridge Readings" count={fridgeCount} />
            {summaryLoading ? (
              <div className="space-y-1">{[1,2].map(i => <div key={i} className="h-10 bg-gray-100 rounded-lg animate-pulse" />)}</div>
            ) : fridgeCount === 0 ? (
              <EmptyState label="All fridges in range" />
            ) : (
              <div className="-mx-1">
                {summary.fridgeAlerts.map((a: any, i: number) => (
                  <AlertRow
                    key={i}
                    label={a.name.replace(/ - (CBD|Osborne Park)$/i, "")}
                    sub={`${a.temperature.toFixed(1)}°C — range ${a.temp_min} to ${a.temp_max}°C`}
                    href="/compliance/fridge-logs"
                  />
                ))}
              </div>
            )}
          </Card>
        )}

        {/* Compliance in-progress */}
        {showCompliance && (
          <Card id="compliance">
            <SectionHeader icon={ClipboardCheck} label="Compliance In Progress" count={complianceCount} />
            {summaryLoading ? (
              <div className="space-y-1">{[1,2].map(i => <div key={i} className="h-10 bg-gray-100 rounded-lg animate-pulse" />)}</div>
            ) : complianceCount === 0 ? (
              <EmptyState label="No open compliance logs" />
            ) : (
              <div className="-mx-1">
                {summary.pendingComplianceLogs.slice(0, 5).map((log: any) => {
                  const typeLabel: Record<string, string> = {
                    supplier_delivery: "Supplier Delivery",
                    thawing: "Thawing",
                    cooking: "Cooking",
                    cooling: "Cooling",
                    fridge_monitoring: "Fridge Monitoring",
                    chemical: "Chemical",
                  };
                  return (
                    <AlertRow
                      key={log.id}
                      label={log.entity_name || typeLabel[log.log_type] || log.log_type}
                      sub={`${typeLabel[log.log_type] || log.log_type} — started ${new Date(log.created_at).toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit", hour12: true })}`}
                      href="/compliance"
                    />
                  );
                })}
              </div>
            )}
          </Card>
        )}

        {/* FC issues */}
        {showProducts && (
          <Card id="fc-issues">
            <SectionHeader icon={Sparkles} label={`Products Over FC Target`} count={fcCount} />
            {summaryLoading ? (
              <div className="space-y-1">{[1,2].map(i => <div key={i} className="h-10 bg-gray-100 rounded-lg animate-pulse" />)}</div>
            ) : fcCount === 0 ? (
              <EmptyState label="All products on target" />
            ) : (
              <div className="-mx-1">
                {summary.fcIssues.slice(0, 5).map((item: any) => (
                  <AlertRow
                    key={item.id}
                    label={item.name}
                    sub={`FC: ${item.fc}%`}
                    href="/products"
                  />
                ))}
                {fcCount > 5 && (
                  <Link href="/products">
                    <p className="text-xs text-[#256984] font-medium px-3 py-1 hover:underline cursor-pointer">
                      +{fcCount - 5} more →
                    </p>
                  </Link>
                )}
              </div>
            )}
          </Card>
        )}

      </div>

      {/* ── Invoice imports pending ──────────────────────────────────────── */}
      {(hasAccess("xero-imports") || isAdmin) && xeroCount > 0 && (
        <Link href="/xero-imports">
          <div className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 cursor-pointer hover:bg-amber-100 transition-colors group">
            <div className="flex items-center gap-3">
              <FileText size={16} className="text-amber-600" />
              <div>
                <p className="text-sm font-semibold text-amber-900">{xeroCount} invoice{xeroCount !== 1 ? "s" : ""} pending review</p>
                <p className="text-xs text-amber-700">Tap to open Invoice Imports</p>
              </div>
            </div>
            <ChevronRight size={16} className="text-amber-400 group-hover:text-amber-600 transition-colors" />
          </div>
        </Link>
      )}

    </div>
  );
}
