import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  ShieldCheck, Thermometer, Sparkles, ClipboardList, ShoppingCart,
  AlertTriangle, CheckCircle2, Clock, RefreshCw, ExternalLink,
  TrendingUp, TrendingDown, Minus, ChevronDown, ChevronRight
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────
interface InspectionSummary {
  templateId: string;
  templateName: string;
  group: string;
  totalCount: number;
  completedCount: number;
  incompleteCount: number;
  avgScore: number | null;
  lastCompletedAt: string | null;
  lastScore: number | null;
  lastAuditId: string | null;
  lastConductedBy: string | null;
  recentScores: { date: string; score: number; auditId: string }[];
}

interface InspectionsData {
  days: number;
  summaries: InspectionSummary[];
  groups: { key: string; label: string; scored: boolean }[];
  totalInspections: number;
}

interface Action {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueDate: string | null;
  createdAt: string;
  completedAt: string | null;
  creatorName: string;
  auditTitle: string;
  auditItemLabel: string;
  uniqueId: string;
}

interface ActionsData {
  actions: Action[];
  open: Action[];
  overdue: Action[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function scoreColor(score: number | null): string {
  if (score === null) return "text-muted-foreground";
  if (score >= 95) return "text-emerald-600";
  if (score >= 80) return "text-amber-500";
  return "text-red-500";
}

function scoreBg(score: number | null): string {
  if (score === null) return "bg-muted";
  if (score >= 95) return "bg-emerald-50 border-emerald-200";
  if (score >= 80) return "bg-amber-50 border-amber-200";
  return "bg-red-50 border-red-200";
}

function daysSince(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

function freshnessLabel(days: number | null): { label: string; color: string } {
  if (days === null) return { label: "Never", color: "text-red-500" };
  if (days === 0) return { label: "Today", color: "text-emerald-600" };
  if (days === 1) return { label: "Yesterday", color: "text-emerald-600" };
  if (days <= 7) return { label: `${days}d ago`, color: "text-amber-500" };
  return { label: `${days}d ago`, color: "text-red-500" };
}

function priorityBadge(priority: string) {
  const map: Record<string, string> = {
    HIGH: "bg-red-100 text-red-700 border-red-200",
    MEDIUM: "bg-amber-100 text-amber-700 border-amber-200",
    LOW: "bg-blue-100 text-blue-600 border-blue-200",
  };
  return map[priority] || "bg-muted text-muted-foreground";
}

function groupIcon(group: string) {
  const map: Record<string, any> = {
    fridge_logs: Thermometer,
    cleaning: Sparkles,
    food_safety: ShieldCheck,
    order_sheets: ShoppingCart,
    other: ClipboardList,
  };
  return map[group] || ClipboardList;
}

const GROUP_ORDER = ["fridge_logs", "cleaning", "food_safety", "order_sheets", "other"];
const GROUP_LABELS: Record<string, string> = {
  fridge_logs: "Fridge Logs",
  cleaning: "Cleaning",
  food_safety: "Food Safety",
  order_sheets: "Order Sheets",
  other: "Other",
};

// ─── Score sparkline (last 5) ─────────────────────────────────────────────────
function ScoreSparkline({ scores }: { scores: { date: string; score: number }[] }) {
  if (!scores.length) return null;
  const last5 = [...scores].slice(0, 5).reverse();
  const vals = last5.map(s => s.score);
  const min = Math.min(...vals, 0);
  const max = Math.max(...vals, 100);
  const range = max - min || 1;
  const W = 60, H = 20;
  const pts = last5.map((s, i) => {
    const x = (i / Math.max(last5.length - 1, 1)) * W;
    const y = H - ((s.score - min) / range) * H;
    return `${x},${y}`;
  }).join(" ");
  const last = vals[vals.length - 1];
  const prev = vals[vals.length - 2];
  const trend = prev === undefined ? null : last > prev ? "up" : last < prev ? "down" : "flat";
  return (
    <div className="flex items-center gap-1.5">
      <svg width={W} height={H} className="overflow-visible">
        <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.5" className={scoreColor(last)} />
        {last5.map((s, i) => {
          const x = (i / Math.max(last5.length - 1, 1)) * W;
          const y = H - ((s.score - min) / range) * H;
          return <circle key={i} cx={x} cy={y} r="2" fill="currentColor" className={scoreColor(last)} />;
        })}
      </svg>
      {trend === "up" && <TrendingUp size={12} className="text-emerald-500" />}
      {trend === "down" && <TrendingDown size={12} className="text-red-500" />}
      {trend === "flat" && <Minus size={12} className="text-muted-foreground" />}
    </div>
  );
}

// ─── Inspection Card ──────────────────────────────────────────────────────────
function InspectionCard({ summary }: { summary: InspectionSummary }) {
  const [open, setOpen] = useState(false);
  const days = daysSince(summary.lastCompletedAt);
  const fresh = freshnessLabel(days);

  return (
    <div className={cn("rounded-lg border p-4 space-y-3 transition-colors", scoreBg(summary.lastScore))}>
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground leading-tight truncate">{summary.templateName}</p>
          <p className={cn("text-xs mt-0.5", fresh.color)}>{fresh.label}</p>
        </div>
        {summary.lastScore !== null && (
          <div className={cn("text-lg font-bold tabular-nums shrink-0", scoreColor(summary.lastScore))}>
            {summary.lastScore.toFixed(0)}%
          </div>
        )}
      </div>

      {/* Stats row */}
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{summary.completedCount} completed · {summary.incompleteCount} incomplete</span>
        {summary.avgScore !== null && (
          <span className="tabular-nums">avg {summary.avgScore.toFixed(1)}%</span>
        )}
      </div>

      {/* Sparkline */}
      {summary.recentScores.length > 1 && (
        <ScoreSparkline scores={summary.recentScores} />
      )}

      {/* Expand for details */}
      {summary.lastCompletedAt && (
        <button
          onClick={() => setOpen(o => !o)}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {open ? "Hide" : "Last inspection details"}
        </button>
      )}
      {open && summary.lastCompletedAt && (
        <div className="text-xs space-y-1 pt-1 border-t border-border/50">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Date</span>
            <span>{formatDate(summary.lastCompletedAt)}</span>
          </div>
          {summary.lastConductedBy && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Conducted by</span>
              <span>{summary.lastConductedBy}</span>
            </div>
          )}
          {summary.lastAuditId && (
            <a
              href={`https://app.safetyculture.com/audit/${summary.lastAuditId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-primary hover:underline mt-1"
            >
              <ExternalLink size={11} />
              View in SafetyCulture
            </a>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Group Section ────────────────────────────────────────────────────────────
function GroupSection({ groupKey, summaries }: { groupKey: string; summaries: InspectionSummary[] }) {
  const [open, setOpen] = useState(true);
  const Icon = groupIcon(groupKey);
  const label = GROUP_LABELS[groupKey] || groupKey;
  const scoredItems = summaries.filter(s => s.lastScore !== null);
  const avgGroup = scoredItems.length
    ? Math.round(scoredItems.reduce((a, s) => a + s.lastScore!, 0) / scoredItems.length)
    : null;

  return (
    <div className="space-y-3">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between group"
      >
        <div className="flex items-center gap-2">
          <Icon size={15} className="text-primary" />
          <h3 className="text-sm font-semibold text-foreground">{label}</h3>
          <span className="text-xs text-muted-foreground">({summaries.length})</span>
        </div>
        <div className="flex items-center gap-3">
          {avgGroup !== null && (
            <span className={cn("text-xs font-medium tabular-nums", scoreColor(avgGroup))}>
              avg {avgGroup}%
            </span>
          )}
          <ChevronDown size={14} className={cn("text-muted-foreground transition-transform", !open && "-rotate-90")} />
        </div>
      </button>
      {open && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {summaries.map(s => <InspectionCard key={s.templateId} summary={s} />)}
        </div>
      )}
    </div>
  );
}

// ─── Actions Panel ────────────────────────────────────────────────────────────
function ActionsPanel({ data }: { data: ActionsData }) {
  const { open, overdue } = data;
  if (open.length === 0) {
    return (
      <div className="flex items-center gap-2 text-sm text-emerald-600 py-4">
        <CheckCircle2 size={16} />
        No open actions
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {open.map(action => {
        const isOverdue = overdue.some(o => o.id === action.id);
        return (
          <div key={action.id} className={cn(
            "rounded-lg border p-3 space-y-1.5",
            isOverdue ? "bg-red-50 border-red-200" : "bg-card border-border"
          )}>
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-medium text-foreground leading-snug flex-1">{action.title}</p>
              <div className="flex items-center gap-1.5 shrink-0">
                {isOverdue && <Badge variant="destructive" className="text-xs px-1.5 py-0">Overdue</Badge>}
                <span className={cn("text-xs font-medium px-1.5 py-0.5 rounded border", priorityBadge(action.priority))}>
                  {action.priority}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
              {action.uniqueId && <span className="font-mono">{action.uniqueId}</span>}
              {action.auditTitle && <span>From: {action.auditTitle}</span>}
              {action.dueDate && (
                <span className={cn("flex items-center gap-0.5", isOverdue && "text-red-600")}>
                  <Clock size={10} />
                  Due {formatDate(action.dueDate)}
                </span>
              )}
              {action.creatorName && <span>by {action.creatorName}</span>}
            </div>
            {action.auditItemLabel && (
              <p className="text-xs text-muted-foreground italic">"{action.auditItemLabel}"</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Day range selector ───────────────────────────────────────────────────────
const DAY_OPTIONS = [
  { label: "7 days", value: 7 },
  { label: "30 days", value: 30 },
  { label: "90 days", value: 90 },
];

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function SafetyDashboard() {
  const [days, setDays] = useState(30);

  const { data: inspData, isLoading: loadingInsp, refetch: refetchInsp } = useQuery<InspectionsData>({
    queryKey: ["/api/safety/inspections", days],
    queryFn: () => apiRequest("GET", `/api/safety/inspections?days=${days}`).then(r => r.json()),
    staleTime: 5 * 60 * 1000, // 5 min cache
  });

  const { data: actionsData, isLoading: loadingActions, refetch: refetchActions } = useQuery<ActionsData>({
    queryKey: ["/api/safety/actions"],
    queryFn: () => apiRequest("GET", "/api/safety/actions").then(r => r.json()),
    staleTime: 5 * 60 * 1000,
  });

  // Group summaries by group key
  const grouped = new Map<string, InspectionSummary[]>();
  for (const s of inspData?.summaries || []) {
    if (!grouped.has(s.group)) grouped.set(s.group, []);
    grouped.get(s.group)!.push(s);
  }

  const openCount = actionsData?.open.length ?? 0;
  const overdueCount = actionsData?.overdue.length ?? 0;

  return (
    <div className="p-6 space-y-6 max-w-screen-xl">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground" style={{ fontFamily: "'Cabinet Grotesk', sans-serif" }}>
            Safety & Compliance
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Inspection scores and open actions from SafetyCulture
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Day range picker */}
          <div className="flex rounded-md border border-border overflow-hidden text-xs">
            {DAY_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setDays(opt.value)}
                className={cn(
                  "px-3 py-1.5 font-medium transition-colors",
                  days === opt.value
                    ? "bg-primary text-primary-foreground"
                    : "bg-card text-muted-foreground hover:text-foreground hover:bg-muted"
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => { refetchInsp(); refetchActions(); }}
            className="p-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title="Refresh"
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* Summary KPI row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Inspections</p>
          {loadingInsp ? <Skeleton className="h-7 w-12 mt-1" /> : (
            <p className="text-2xl font-bold tabular-nums mt-1">{inspData?.totalInspections ?? 0}</p>
          )}
          <p className="text-xs text-muted-foreground mt-0.5">last {days} days</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Templates active</p>
          {loadingInsp ? <Skeleton className="h-7 w-12 mt-1" /> : (
            <p className="text-2xl font-bold tabular-nums mt-1">{inspData?.summaries.length ?? 0}</p>
          )}
        </Card>
        <Card className={cn("p-4", overdueCount > 0 ? "border-red-200 bg-red-50" : "")}>
          <p className="text-xs text-muted-foreground">Open actions</p>
          {loadingActions ? <Skeleton className="h-7 w-12 mt-1" /> : (
            <p className={cn("text-2xl font-bold tabular-nums mt-1", openCount > 0 ? "text-amber-600" : "text-emerald-600")}>
              {openCount}
            </p>
          )}
        </Card>
        <Card className={cn("p-4", overdueCount > 0 ? "border-red-200 bg-red-50" : "")}>
          <p className="text-xs text-muted-foreground">Overdue actions</p>
          {loadingActions ? <Skeleton className="h-7 w-12 mt-1" /> : (
            <p className={cn("text-2xl font-bold tabular-nums mt-1", overdueCount > 0 ? "text-red-600" : "text-emerald-600")}>
              {overdueCount}
            </p>
          )}
          {overdueCount > 0 && <p className="text-xs text-red-600 mt-0.5">Needs attention</p>}
        </Card>
      </div>

      {/* Inspections by group */}
      <div className="space-y-6">
        <h2 className="text-sm font-semibold text-foreground">Inspections</h2>

        {loadingInsp ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-28 rounded-lg" />)}
          </div>
        ) : grouped.size === 0 ? (
          <div className="text-sm text-muted-foreground py-8 text-center">
            No inspections found in the last {days} days.
          </div>
        ) : (
          <div className="space-y-6">
            {GROUP_ORDER.filter(g => grouped.has(g)).map(g => (
              <GroupSection key={g} groupKey={g} summaries={grouped.get(g)!} />
            ))}
          </div>
        )}
      </div>

      {/* Open Actions */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-foreground">Open Actions</h2>
          {!loadingActions && openCount > 0 && (
            <span className="text-xs bg-amber-100 text-amber-700 border border-amber-200 rounded-full px-2 py-0.5 font-medium">
              {openCount}
            </span>
          )}
          {!loadingActions && overdueCount > 0 && (
            <span className="text-xs bg-red-100 text-red-700 border border-red-200 rounded-full px-2 py-0.5 font-medium flex items-center gap-1">
              <AlertTriangle size={10} />
              {overdueCount} overdue
            </span>
          )}
        </div>

        {loadingActions ? (
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-16 rounded-lg" />)}
          </div>
        ) : (
          <ActionsPanel data={actionsData!} />
        )}
      </div>
    </div>
  );
}
