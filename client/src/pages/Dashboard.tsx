import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/context/AuthContext";
import { cn } from "@/lib/utils";
import { KpiTracker } from "@/components/KpiTracker";
import {
  CheckCircle, Thermometer, Package,
  ClipboardCheck, FileText, ChevronRight,
  Sparkles
} from "lucide-react";

// ── helpers ──────────────────────────────────────────────────────────────────
function todayAWST() {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
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

function Card({ children, className, id }: { children: React.ReactNode; className?: string; id?: string }) {
  return (
    <div id={id} className={cn("bg-white rounded-xl border border-gray-100 shadow-sm p-4", className)}>
      {children}
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
  // Fast summary (alerts only — no external API calls)
  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ["/api/dashboard-summary"],
    queryFn: () => apiRequest("GET", "/api/dashboard-summary").then(r => r.json()),
    staleTime: 2 * 60 * 1000,
  });

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

  // Always show Perth's date/time, whatever time zone the device is set to
  const now = new Date();
  const dayLabel = now.toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long", timeZone: "Australia/Perth" });
  const perthHour = Number(now.toLocaleString("en-AU", { hour: "numeric", hourCycle: "h23", timeZone: "Australia/Perth" }));
  const greeting = perthHour < 12 ? "Good morning" : perthHour < 17 ? "Good afternoon" : "Good evening";

  return (
    <div className="p-4 max-w-5xl mx-auto space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-[#256984]">{greeting}{staff?.name ? `, ${staff.name.split(' ')[0]}` : ""}</h1>
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

      {/* ── Kitchen KPI tracker (period / week) ─────────────────────── */}
      {showSales && <KpiTracker />}

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
