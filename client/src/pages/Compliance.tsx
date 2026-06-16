import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  Plus, Edit2, AlertCircle, CheckCircle2, Clock, XCircle,
  ChevronDown, CalendarDays, AlertTriangle
} from "lucide-react";
import { format, subDays, parseISO } from "date-fns";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ComplianceLog {
  id: string;
  log_type: string;
  entry_date: string;
  recipe_id: number | null;
  batch_id: string | null;
  source: string;
  status: string;
  derivedStatus: string;
  signed_by_staff_id: number | null;
  signed_at: string | null;
  notes: string;
  supplier_id: number | null;
  delivery_datetime: string | null;
  thaw_item: string | null;
  thaw_weight_qty: string | null;
  cook_core_temp: number | null;
  cook_recorded_time: string | null;
  wastage_total_value: number | null;
  created_at: string;
  // display fields
  item_name: string | null;
  created_by_name: string | null;
  batch_qty: string | null;
  updated_at: string | null;
  stageCount: number;
  stagesCompleted: number;
}

interface AuditStatus {
  auditReady: boolean;
  actionCount: number;
}

type LogType = "cooling" | "cooking" | "thawing" | "supplier" | "wastage" | "review";

const LOG_TABS: { key: LogType; label: string }[] = [
  { key: "cooling",  label: "Cooling" },
  { key: "cooking",  label: "Cooking" },
  { key: "thawing",  label: "Thawing" },
  { key: "supplier", label: "Supplier Delivery" },
  { key: "wastage",  label: "Wastage" },
  { key: "review",   label: "Review" },
];

// ─── Status pill ──────────────────────────────────────────────────────────────

export function StatusPill({ status }: { status: string }) {
  switch (status) {
    case "pass":
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
          <CheckCircle2 size={12} />
          Pass
        </span>
      );
    case "action_needed":
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">
          <AlertCircle size={12} />
          Action needed
        </span>
      );
    case "closed":
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
          <XCircle size={12} />
          Closed
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
          <Clock size={12} />
          In progress
        </span>
      );
  }
}

// ─── Log row summary helpers ──────────────────────────────────────────────────

const LOG_TYPE_DISPLAY: Record<string, string> = {
  cooling: "Cooling",
  cooking: "Cooking",
  thawing: "Thawing",
  supplier: "Supplier Delivery",
  wastage: "Wastage",
  review: "Weekly Review",
};

function logItemName(log: ComplianceLog): string | null {
  if (log.item_name) return log.item_name;
  if (log.log_type === "thawing") return log.thaw_item || null;
  return null;
}

function logTitle(log: ComplianceLog): string {
  if (log.log_type === "supplier") return log.supplier_id ? `Supplier #${log.supplier_id}` : "Supplier Delivery";
  if (log.log_type === "thawing") return log.thaw_item || "Thaw record";
  if (log.log_type === "cooking") return log.recipe_id ? `Recipe #${log.recipe_id}` : "Cooking record";
  if (log.log_type === "cooling") return log.recipe_id ? `Recipe #${log.recipe_id}` : "Cooling record";
  if (log.log_type === "wastage") return "Wastage sheet";
  if (log.log_type === "review") return "Weekly review";
  return "Record";
}

function logKeyReadings(log: ComplianceLog): string {
  if (log.log_type === "cooking" && log.cook_core_temp !== null) {
    return `Core temp: ${log.cook_core_temp}°C`;
  }
  if (log.log_type === "supplier" && log.delivery_datetime) {
    return `Delivered: ${format(parseISO(log.delivery_datetime), "HH:mm")}`;
  }
  if (log.log_type === "wastage" && log.wastage_total_value !== null) {
    return `Total: $${Number(log.wastage_total_value).toFixed(2)}`;
  }
  if (log.log_type === "thawing" && log.thaw_weight_qty) {
    return log.thaw_weight_qty;
  }
  return "";
}

// ─── Date selector ────────────────────────────────────────────────────────────

type DateMode = "today" | "yesterday" | "range";

interface DateRange {
  from: Date | undefined;
  to: Date | undefined;
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function Compliance() {
  const [, navigate] = useLocation();
  const qc = useQueryClient();

  const today = new Date();
  const todayStr = format(today, "yyyy-MM-dd");
  const yesterdayStr = format(subDays(today, 1), "yyyy-MM-dd");

  const [dateMode, setDateMode] = useState<DateMode>("today");
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [rangeMode, setRangeMode] = useState<"single" | "range">("single");
  const [singleDate, setSingleDate] = useState<Date>(today);
  const [dateRange, setDateRange] = useState<DateRange>({ from: undefined, to: undefined });

  const [activeTab, setActiveTab] = useState<LogType>("cooling");

  // Compute the date params for API
  function getDateParams(): Record<string, string> {
    if (dateMode === "today") return { date: todayStr };
    if (dateMode === "yesterday") return { date: yesterdayStr };
    if (rangeMode === "single") return { date: format(singleDate, "yyyy-MM-dd") };
    if (dateRange.from && dateRange.to) {
      return {
        dateFrom: format(dateRange.from, "yyyy-MM-dd"),
        dateTo: format(dateRange.to, "yyyy-MM-dd"),
      };
    }
    if (dateRange.from) return { date: format(dateRange.from, "yyyy-MM-dd") };
    return { date: todayStr };
  }

  const dateParams = getDateParams();
  const dateParamStr = new URLSearchParams({ ...dateParams, logType: activeTab }).toString();

  const { data: logs = [], isLoading: logsLoading } = useQuery<ComplianceLog[]>({
    queryKey: [`/api/compliance/logs`, dateParamStr],
    queryFn: () =>
      apiRequest("GET", `/api/compliance/logs?${dateParamStr}`).then(r => r.json()),
  });

  const auditDateStr = new URLSearchParams(dateParams).toString();
  const { data: auditStatus } = useQuery<AuditStatus>({
    queryKey: ["/api/compliance/audit-status", auditDateStr],
    queryFn: () =>
      apiRequest("GET", `/api/compliance/audit-status?${auditDateStr}`).then(r => r.json()),
    refetchInterval: 30000,
  });

  const createMutation = useMutation({
    mutationFn: (logType: LogType) =>
      apiRequest("POST", "/api/compliance/logs", {
        log_type: logType,
        entry_date: dateParams.date || dateParams.dateFrom || todayStr,
        source: "manual",
        status: "in_progress",
      }).then(r => r.json()),
    onSuccess: (newLog: ComplianceLog) => {
      navigate(`/compliance/${newLog.log_type}/${newLog.id}`);
    },
  });

  const handleAddNew = () => {
    createMutation.mutate(activeTab);
  };

  const tabLogs = logs.filter(l => l.log_type === activeTab);

  // Date label for display
  function dateLabel(): string {
    if (dateMode === "today") return "Today";
    if (dateMode === "yesterday") return "Yesterday";
    if (rangeMode === "single") return format(singleDate, "d MMM yyyy");
    if (dateRange.from && dateRange.to) {
      return `${format(dateRange.from, "d MMM")} – ${format(dateRange.to, "d MMM")}`;
    }
    if (dateRange.from) return format(dateRange.from, "d MMM yyyy");
    return "Select date";
  }

  const isCustomDate = dateMode === "range";

  return (
    <div className="flex flex-col h-full">
      {/* Audit-ready strip */}
      {auditStatus && (
        <div
          className={cn(
            "px-4 py-2.5 flex items-center gap-3 text-sm font-medium text-white",
            auditStatus.auditReady ? "bg-green-500" : "bg-red-500"
          )}
        >
          {auditStatus.auditReady ? (
            <>
              <CheckCircle2 size={16} />
              <span>All records are in order — audit ready</span>
            </>
          ) : (
            <>
              <AlertTriangle size={16} />
              <span>
                {auditStatus.actionCount} record{auditStatus.actionCount !== 1 ? "s" : ""} need attention
              </span>
              <button
                className="ml-auto text-white/90 underline text-xs font-normal"
                onClick={() => {
                  const el = document.getElementById("compliance-issues");
                  if (el) el.scrollIntoView({ behavior: "smooth" });
                }}
              >
                Jump to issues
              </button>
            </>
          )}
        </div>
      )}

      {/* Header */}
      <div className="p-6 border-b flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Compliance Records</h1>
        <Button
          className="h-12 px-4 gap-2 font-medium"
          style={{ backgroundColor: "#256984" }}
          onClick={handleAddNew}
          disabled={createMutation.isPending}
        >
          <Plus size={18} />
          Add {LOG_TABS.find(t => t.key === activeTab)?.label}
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="p-6 space-y-5">

          {/* Date controls */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setDateMode("today")}
              className={cn(
                "px-4 py-2 rounded-full text-sm font-medium border transition-colors",
                dateMode === "today"
                  ? "bg-[#256984] text-white border-[#256984]"
                  : "bg-background border-border text-foreground hover:bg-muted"
              )}
            >
              Today
            </button>
            <button
              onClick={() => setDateMode("yesterday")}
              className={cn(
                "px-4 py-2 rounded-full text-sm font-medium border transition-colors",
                dateMode === "yesterday"
                  ? "bg-[#256984] text-white border-[#256984]"
                  : "bg-background border-border text-foreground hover:bg-muted"
              )}
            >
              Yesterday
            </button>

            <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
              <PopoverTrigger asChild>
                <button
                  className={cn(
                    "flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium border transition-colors",
                    isCustomDate
                      ? "bg-[#256984] text-white border-[#256984]"
                      : "bg-background border-border text-foreground hover:bg-muted"
                  )}
                  onClick={() => setDateMode("range")}
                >
                  <CalendarDays size={14} />
                  {isCustomDate ? dateLabel() : "Select date"}
                  <ChevronDown size={14} />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-4 space-y-3" align="start">
                {/* Mode toggle */}
                <div className="flex gap-2">
                  <button
                    className={cn(
                      "flex-1 py-2 rounded-lg text-sm font-medium border transition-colors",
                      rangeMode === "single"
                        ? "bg-[#256984] text-white border-[#256984]"
                        : "border-border hover:bg-muted"
                    )}
                    onClick={() => setRangeMode("single")}
                  >
                    Single day
                  </button>
                  <button
                    className={cn(
                      "flex-1 py-2 rounded-lg text-sm font-medium border transition-colors",
                      rangeMode === "range"
                        ? "bg-[#256984] text-white border-[#256984]"
                        : "border-border hover:bg-muted"
                    )}
                    onClick={() => setRangeMode("range")}
                  >
                    Date range
                  </button>
                </div>

                {rangeMode === "single" ? (
                  <Calendar
                    mode="single"
                    selected={singleDate}
                    onSelect={(d) => {
                      if (d) {
                        setSingleDate(d);
                        setDateMode("range");
                        setCalendarOpen(false);
                      }
                    }}
                    initialFocus
                  />
                ) : (
                  <Calendar
                    mode="range"
                    selected={dateRange}
                    onSelect={(r) => {
                      if (r) {
                        setDateRange(r as DateRange);
                        setDateMode("range");
                        if (r.from && r.to) setCalendarOpen(false);
                      }
                    }}
                    initialFocus
                  />
                )}
              </PopoverContent>
            </Popover>
          </div>

          {/* Tab strip */}
          <div className="flex gap-1 overflow-x-auto pb-1">
            {LOG_TABS.map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={cn(
                  "px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap border transition-colors",
                  activeTab === tab.key
                    ? "bg-[#256984] text-white border-[#256984]"
                    : "bg-background border-border text-foreground hover:bg-muted"
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Records list */}
          <div id="compliance-issues" className="space-y-2">
            {logsLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-20 rounded-xl" />
              ))
            ) : tabLogs.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <p className="text-sm">No {LOG_TABS.find(t => t.key === activeTab)?.label.toLowerCase()} records for this period.</p>
                <Button
                  variant="outline"
                  className="mt-4 h-10"
                  onClick={handleAddNew}
                  disabled={createMutation.isPending}
                >
                  <Plus size={16} className="mr-2" />
                  Add the first one
                </Button>
              </div>
            ) : (
              tabLogs.map(log => {
                const status = log.derivedStatus || log.status;
                const borderColor =
                  status === "pass"
                    ? "border-l-green-500"
                    : status === "action_needed"
                    ? "border-l-red-500"
                    : status === "closed"
                    ? "border-l-gray-400"
                    : "border-l-amber-400";

                return (
                  <div
                    key={log.id}
                    className={cn(
                      "bg-card border border-border rounded-xl border-l-4 overflow-hidden cursor-pointer hover:shadow-sm transition-shadow",
                      borderColor
                    )}
                    onClick={() => navigate(`/compliance/${log.log_type}/${log.id}`)}
                  >
                    <div className="p-4 flex items-start gap-4">
                      <div className="flex-1 min-w-0">
                        {/* Log type label + auto badge */}
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            {LOG_TYPE_DISPLAY[log.log_type] || log.log_type}
                          </span>
                          {log.source === "production_auto" && (
                            <Badge variant="secondary" className="text-xs py-0">Auto</Badge>
                          )}
                        </div>

                        {/* Item name — main identifier */}
                        <div className="mt-0.5">
                          {logItemName(log) ? (
                            <span className="font-semibold text-sm text-foreground">{logItemName(log)}</span>
                          ) : log.log_type === "wastage" ? (
                            <span className="font-semibold text-sm text-foreground">Wastage Sheet</span>
                          ) : log.log_type === "review" ? (
                            <span className="font-semibold text-sm text-foreground">Weekly Review</span>
                          ) : (
                            <span className="text-sm text-muted-foreground italic">No item specified</span>
                          )}
                        </div>

                        {/* Meta row */}
                        <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                          {log.created_by_name && (
                            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                              <span className="w-1.5 h-1.5 rounded-full bg-[#256984] inline-block" />
                              {log.created_by_name}
                            </span>
                          )}
                          {log.batch_qty && (
                            <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                              {log.batch_qty}
                            </span>
                          )}
                          {logKeyReadings(log) && (
                            <span className="text-xs text-muted-foreground">{logKeyReadings(log)}</span>
                          )}
                          {log.signed_at && (
                            <span className="text-xs text-muted-foreground">
                              Signed {format(parseISO(log.signed_at), "h:mm a")}
                            </span>
                          )}
                          {(log.updated_at || log.created_at) && (
                            <span className="text-xs text-muted-foreground">
                              Edited {format(parseISO(log.updated_at || log.created_at), "h:mm a")}
                            </span>
                          )}
                          {log.batch_id && log.source !== "production_auto" && (
                            <span className="text-xs text-muted-foreground font-mono bg-muted px-1.5 py-0.5 rounded">
                              {log.batch_id}
                            </span>
                          )}
                        </div>

                        {/* Stage progress — cooling/thawing only */}
                        {(log.log_type === "cooling" || log.log_type === "thawing") && (log.stageCount || 0) > 0 && (
                          <div className="mt-2 flex items-center gap-2">
                            <div className="flex gap-1">
                              {Array.from({ length: log.stageCount }).map((_, i) => (
                                <div
                                  key={i}
                                  className={cn(
                                    "h-1.5 w-6 rounded-full",
                                    i < (log.stagesCompleted || 0) ? "bg-[#256984]" : "bg-muted"
                                  )}
                                />
                              ))}
                            </div>
                            <span className="text-xs text-muted-foreground">
                              Stage {log.stagesCompleted || 0} of {log.stageCount}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Right: status + edit */}
                      <div className="flex items-center gap-2 shrink-0 mt-0.5">
                        <StatusPill status={status} />
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 px-3 gap-1.5"
                          onClick={(e) => { e.stopPropagation(); navigate(`/compliance/${log.log_type}/${log.id}`); }}
                        >
                          <Edit2 size={13} />
                          Edit
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
