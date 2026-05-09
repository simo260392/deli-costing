import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { BarChart3, Trash2, Download, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

type PrepLogEntry = {
  id: number;
  logged_at: string;
  item_type: string;
  item_id: number;
  item_name: string;
  quantity: number;
  unit: string;
  staff_id: number | null;
  staff_name: string;
  notes: string;
};

// All dates in AWST (UTC+8) to match server-side date filtering
function toAwstDate(d: Date): string {
  const awst = new Date(d.getTime() + 8 * 60 * 60 * 1000);
  return awst.toISOString().slice(0, 10);
}

function today() {
  return toAwstDate(new Date());
}

function sevenDaysAgo() {
  const d = new Date();
  d.setDate(d.getDate() - 6);
  return toAwstDate(d);
}

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("en-AU", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: true,
  });
}

function formatDateShort(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "numeric" });
}

export default function PrepReports() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [dateFrom, setDateFrom] = useState(sevenDaysAgo());
  const [dateTo, setDateTo] = useState(today());
  const [staffFilter, setStaffFilter] = useState("all");
  const [groupBy, setGroupBy] = useState<"staff" | "item" | "date">("staff");
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  // Fetch entries for the selected range (all staff — we filter client-side)
  const { data: entries = [], isLoading, refetch } = useQuery<PrepLogEntry[]>({
    queryKey: ["/api/prep-log/report", dateFrom, dateTo],
    queryFn: () => apiRequest("GET", `/api/prep-log?dateFrom=${dateFrom}&dateTo=${dateTo}`).then((r) => r.json()),
    enabled: !!dateFrom && !!dateTo,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/prep-log/${id}`).then((r) => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/prep-log"] });
      refetch();
      toast({ title: "Entry removed" });
    },
  });

  // Unique staff names in result set
  const allStaff = useMemo(() => {
    const names = [...new Set(entries.map((e) => e.staffName))].sort();
    return names;
  }, [entries]);

  // Filter by staff
  const filtered = useMemo(() => {
    if (staffFilter === "all") return entries;
    return entries.filter((e) => e.staffName === staffFilter);
  }, [entries, staffFilter]);

  // Group the filtered entries
  const grouped = useMemo(() => {
    const map: Record<string, PrepLogEntry[]> = {};
    for (const e of filtered) {
      let key: string;
      if (groupBy === "staff") key = e.staffName;
      else if (groupBy === "item") key = e.itemName;
      else key = e.loggedAt.slice(0, 10); // date
      if (!map[key]) map[key] = [];
      map[key].push(e);
    }
    // Sort keys
    const keys = Object.keys(map).sort();
    return keys.map((key) => ({ key, entries: map[key] }));
  }, [filtered, groupBy]);

  const toggleGroup = (key: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const exportCsv = () => {
    const header = "Date/Time,Item,Source,Quantity,Unit,Staff,Notes";
    const rows = filtered.map((e) =>
      [
        formatDate(e.loggedAt),
        `"${e.itemName.replace(/"/g, '""')}"`,
        e.itemType === "order" ? "Order" : "Prep",
        e.quantity,
        e.unit,
        `"${e.staffName.replace(/"/g, '""')}"`,
        `"${(e.notes || "").replace(/"/g, '""')}"`,
      ].join(",")
    );
    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const fname = `prep-report-${dateFrom}-to-${dateTo}${staffFilter !== "all" ? `-${staffFilter}` : ""}.csv`;
    a.download = fname;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Summary stats
  const totalEntries = filtered.length;
  const totalEach = filtered
    .filter((e) => e.unit === "each" || e.unit === "portion")
    .reduce((sum, e) => sum + e.quantity, 0);
  const uniqueStaff = new Set(filtered.map((e) => e.staffName)).size;

  return (
    <div className="p-6 space-y-6 max-w-screen-xl">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <BarChart3 size={20} />
            Production Reports
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Track what was made, by whom, and when.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={filtered.length === 0}>
            <Download size={14} className="mr-1.5" /> Export CSV
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="rounded-lg border border-border bg-card p-4 space-y-4">
        <p className="text-sm font-semibold">Filters</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">From</Label>
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="h-9 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">To</Label>
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="h-9 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Staff Member</Label>
            <Select value={staffFilter} onValueChange={setStaffFilter}>
              <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Staff</SelectItem>
                {allStaff.map((name) => (
                  <SelectItem key={name} value={name}>{name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Group By</Label>
            <Select value={groupBy} onValueChange={(v) => setGroupBy(v as any)}>
              <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="staff">Staff Member</SelectItem>
                <SelectItem value="item">Item / Recipe</SelectItem>
                <SelectItem value="date">Date</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        {/* Quick date presets */}
        <div className="flex gap-2 flex-wrap">
          <Button size="sm" variant="outline" className="h-7 text-xs"
            onClick={() => { setDateFrom(today()); setDateTo(today()); }}>Today</Button>
          <Button size="sm" variant="outline" className="h-7 text-xs"
            onClick={() => {
              const d = new Date(); d.setDate(d.getDate() - 1);
              const s = toAwstDate(d);
              setDateFrom(s); setDateTo(s);
            }}>Yesterday</Button>
          <Button size="sm" variant="outline" className="h-7 text-xs"
            onClick={() => { setDateFrom(sevenDaysAgo()); setDateTo(today()); }}>Last 7 days</Button>
          <Button size="sm" variant="outline" className="h-7 text-xs"
            onClick={() => {
              const d = new Date();
              const first = toAwstDate(new Date(d.getFullYear(), d.getMonth(), 1));
              setDateFrom(first); setDateTo(today());
            }}>This month</Button>
        </div>
      </div>

      {/* Summary stats */}
      {!isLoading && (
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg border border-border p-3 text-center">
            <p className="text-2xl font-bold text-primary">{totalEntries}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Log entries</p>
          </div>
          <div className="rounded-lg border border-border p-3 text-center">
            <p className="text-2xl font-bold text-primary">{totalEach % 1 === 0 ? totalEach : totalEach.toFixed(1)}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Individual items (each)</p>
          </div>
          <div className="rounded-lg border border-border p-3 text-center">
            <p className="text-2xl font-bold text-primary">{uniqueStaff}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Staff members</p>
          </div>
        </div>
      )}

      {/* Results */}
      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => <div key={i} className="h-14 rounded-lg bg-muted animate-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-10 text-center text-muted-foreground">
          <BarChart3 size={32} className="mx-auto mb-3 opacity-30" />
          <p className="font-medium">No production logged for this period</p>
          <p className="text-sm mt-1">Adjust the date range or check that staff have been logging their production.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {grouped.map(({ key, entries: groupEntries }) => {
            const isExpanded = expandedGroups.has(key);
            // Aggregate quantities by unit for summary
            const byUnit: Record<string, number> = {};
            for (const e of groupEntries) {
              const k = e.unit;
              byUnit[k] = (byUnit[k] || 0) + e.quantity;
            }

            return (
              <div key={key} className="rounded-lg border border-border overflow-hidden">
                {/* Group header — always visible, clickable */}
                <button
                  className="w-full flex items-center justify-between px-4 py-3 bg-muted/40 hover:bg-muted/60 transition-colors text-left"
                  onClick={() => toggleGroup(key)}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="font-semibold text-sm truncate">
                      {groupBy === "date" ? formatDateShort(key + "T00:00:00") : key || "Unknown"}
                    </span>
                    <Badge variant="outline" className="text-xs shrink-0">
                      {groupEntries.length} entr{groupEntries.length !== 1 ? "ies" : "y"}
                    </Badge>
                    {/* Unit summaries */}
                    <div className="flex gap-1.5 flex-wrap">
                      {Object.entries(byUnit).map(([unit, total]) => (
                        <span key={unit} className="text-xs font-medium px-2 py-0.5 rounded-full"
                          style={{ backgroundColor: "#256984", color: "#fff" }}>
                          {total % 1 === 0 ? total : total.toFixed(2)} {unit}
                        </span>
                      ))}
                    </div>
                  </div>
                  {isExpanded ? <ChevronUp size={16} className="shrink-0 text-muted-foreground" /> : <ChevronDown size={16} className="shrink-0 text-muted-foreground" />}
                </button>

                {/* Entries — shown when expanded, split into categories */}
                {isExpanded && (() => {
                  const prepEntries = groupEntries.filter(e => e.itemType !== "order" && e.itemType !== "boxed");
                  const productEntries = groupEntries.filter(e => e.itemType === "order");
                  const boxedEntries = groupEntries.filter(e => e.itemType === "boxed");

                  const renderCategory = (label: string, colour: string, items: PrepLogEntry[]) => {
                    if (items.length === 0) return null;
                    return (
                      <div>
                        <div className="px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide" style={{ backgroundColor: colour + "18", color: colour }}>
                          {label}
                        </div>
                        <div className="divide-y divide-border">
                          {items.map((e) => (
                            <div key={e.id} className="flex items-center justify-between px-4 py-2.5 hover:bg-muted/20">
                              <div className="flex-1 min-w-0 grid grid-cols-1 md:grid-cols-4 gap-1 md:gap-3 items-center">
                                <p className="text-sm font-medium truncate md:col-span-1">{e.itemName}</p>
                                <p className="text-sm tabular-nums font-semibold text-primary">
                                  {e.quantity % 1 === 0 ? e.quantity : e.quantity.toFixed(2)} {e.unit}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {groupBy !== "staff" ? e.staffName : formatDate(e.loggedAt)}
                                </p>
                                <p className="text-xs text-muted-foreground truncate">
                                  {groupBy === "staff" ? (
                                    e.notes || ""
                                  ) : (
                                    `${groupBy === "item" ? e.staffName + " · " : ""}${formatDate(e.loggedAt)}${e.notes ? " · " + e.notes : ""}`
                                  )}
                                </p>
                              </div>
                              <Button
                                variant="ghost" size="icon"
                                className="h-7 w-7 text-destructive shrink-0 ml-2"
                                onClick={() => deleteMutation.mutate(e.id)}
                              >
                                <Trash2 size={13} />
                              </Button>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  };

                  return (
                    <div className="divide-y divide-border">
                      {renderCategory("Prep", "#6d7c8a", prepEntries)}
                      {renderCategory("Products", "#256984", productEntries)}
                      {renderCategory("Items Boxed", "#7c3aed", boxedEntries)}
                    </div>
                  );
                })()}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
