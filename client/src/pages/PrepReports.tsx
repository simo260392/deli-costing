import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { BarChart3, Trash2, Download, ChevronDown, ChevronUp, List, Clock, Layers } from "lucide-react";
import { cn } from "@/lib/utils";

type PrepLogEntry = {
  id: number;
  loggedAt: string;
  itemType: string;
  itemId: number;
  itemName: string;
  itemSku: string | null;
  itemAttributesSummary: string | null;
  quantity: number;
  unit: string;
  staffId: number | null;
  staffName: string;
  notes: string;
};

type PrepRecipe   = { id: number; name: string; category: string; qty: number; unit: string };
type PrepSubRecipe = { id: number; name: string; qty: number; unit: string };
type PrepComputed  = { recipes: PrepRecipe[]; subRecipes: PrepSubRecipe[] };

// Combined view: one row per unique item name+unit
type CombinedRow = {
  itemName: string;
  itemType: string;
  itemSku: string | null;
  itemAttributesSummary: string | null;
  totalQty: number;
  unit: string;
  staffList: string[];        // unique staff who made it
  representativeEntry: PrepLogEntry;
};

// All dates in AWST (UTC+8) to match server-side date filtering
function toAwstDate(d: Date): string {
  const awst = new Date(d.getTime() + 8 * 60 * 60 * 1000);
  return awst.toISOString().slice(0, 10);
}
function today() { return toAwstDate(new Date()); }
function sevenDaysAgo() {
  const d = new Date(); d.setDate(d.getDate() - 6); return toAwstDate(d);
}
function formatDate(iso: string) {
  return new Date(iso).toLocaleString("en-AU", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: true,
  });
}
function formatDateShort(iso: string) {
  return new Date(iso).toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "numeric" });
}

// ── Breakdown row: fetches prep/compute for a single log entry by SKU ──────────
function EntryBreakdown({ entry, quantity }: { entry: PrepLogEntry; quantity: number }) {
  const [open, setOpen] = useState(false);

  // Only show breakdown button if we have a SKU
  if (!entry.itemSku) return null;

  const orderPayload = [{
    type: "flex_product",
    sku: entry.itemSku,
    name: entry.itemName,
    quantity,
    attributesSummary: entry.itemAttributesSummary || "",
    isWholesale: false,
    flexCategory: "",
    forOrder: entry.staffName,
  }];

  return (
    <div>
      <button
        className="flex items-center gap-1 text-xs text-[#256984] hover:underline mt-0.5"
        onClick={() => setOpen(o => !o)}
      >
        <List size={11} />
        {open ? "Hide breakdown" : "Show breakdown"}
        {open ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
      </button>
      {open && <BreakdownPanel orderPayload={orderPayload} />}
    </div>
  );
}

function BreakdownPanel({ orderPayload }: { orderPayload: any[] }) {
  const { data, isLoading, isError } = useQuery<PrepComputed>({
    queryKey: ["/api/prep/compute/breakdown", orderPayload],
    queryFn: () =>
      apiRequest("POST", "/api/prep/compute", { orders: orderPayload }).then(r => r.json()),
    staleTime: 60 * 1000,
  });

  if (isLoading) return <p className="text-xs text-muted-foreground mt-1 ml-4">Loading...</p>;
  if (isError) return <p className="text-xs text-destructive mt-1 ml-4">Could not load breakdown</p>;

  const recipes    = data?.recipes    || [];
  const subRecipes = data?.subRecipes || [];

  if (recipes.length === 0 && subRecipes.length === 0) {
    return <p className="text-xs text-muted-foreground mt-1 ml-4 italic">No components found for this item</p>;
  }

  return (
    <div className="mt-1.5 ml-4 space-y-0.5 border-l-2 border-[#256984]/30 pl-3">
      {recipes.map(r => (
        <div key={`r-${r.id}`} className="flex items-center gap-2">
          <span className="text-xs font-medium text-foreground">{r.name}</span>
          <span className="text-xs text-[#256984] font-semibold tabular-nums">
            {r.qty % 1 === 0 ? r.qty : r.qty.toFixed(1)} {r.unit}
          </span>
          {r.category && (
            <span className="text-[10px] text-muted-foreground">({r.category})</span>
          )}
        </div>
      ))}
      {subRecipes.map(sr => (
        <div key={`sr-${sr.id}`} className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{sr.name}</span>
          <span className="text-xs font-semibold tabular-nums text-muted-foreground">
            {sr.qty % 1 === 0 ? sr.qty : sr.qty.toFixed(2)} {sr.unit}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Combined category: aggregated view ─────────────────────────────────────────
function CombinedCategory({
  label,
  colour,
  rows,
  onDelete,
}: {
  label: string;
  colour: string;
  rows: CombinedRow[];
  onDelete: (id: number) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <div>
      <div className="px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide"
        style={{ backgroundColor: colour + "18", color: colour }}>
        {label}
      </div>
      <div className="divide-y divide-border">
        {rows.map(row => (
          <div key={`${row.itemName}-${row.unit}`} className="px-4 py-2.5 hover:bg-muted/20">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0 grid grid-cols-1 md:grid-cols-3 gap-1 md:gap-3 items-start">
                <div className="md:col-span-1">
                  <p className="text-sm font-medium">{row.itemName}</p>
                  {row.itemType === "order" && (
                    <EntryBreakdown
                      entry={row.representativeEntry}
                      quantity={row.totalQty}
                    />
                  )}
                </div>
                <p className="text-sm tabular-nums font-semibold text-primary">
                  {row.totalQty % 1 === 0 ? row.totalQty : row.totalQty.toFixed(2)} {row.unit}
                </p>
                <p className="text-xs text-muted-foreground">
                  {row.staffList.join(", ")}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function PrepReports() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [dateFrom, setDateFrom] = useState(sevenDaysAgo());
  const [dateTo,   setDateTo]   = useState(today());
  const [timeFrom, setTimeFrom] = useState("");   // "" = no filter, else "HH:MM"
  const [timeTo,   setTimeTo]   = useState("");
  const [staffFilter, setStaffFilter] = useState("all");
  const [groupBy, setGroupBy] = useState<"staff" | "item" | "date">("staff");
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  // Per-group view mode: "timeline" | "combined"
  const [groupViewMode, setGroupViewMode] = useState<Record<string, "timeline" | "combined">>({});

  // Convert a logged_at ISO string to AWST HH:MM for time comparison
  const toAwstTime = (iso: string) => {
    const awst = new Date(new Date(iso).getTime() + 8 * 60 * 60 * 1000);
    return awst.toISOString().slice(11, 16); // "HH:MM"
  };

  const applyShift = (from: string, to: string) => {
    setTimeFrom(from); setTimeTo(to);
  };

  const { data: entries = [], isLoading, refetch } = useQuery<PrepLogEntry[]>({
    queryKey: ["/api/prep-log/report", dateFrom, dateTo],
    queryFn: () =>
      apiRequest("GET", `/api/prep-log?dateFrom=${dateFrom}&dateTo=${dateTo}`).then(r => r.json()),
    enabled: !!dateFrom && !!dateTo,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/prep-log/${id}`).then(r => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/prep-log"] });
      refetch();
      toast({ title: "Entry removed" });
    },
  });

  const allStaff = useMemo(() => {
    return [...new Set(entries.map(e => e.staffName))].sort();
  }, [entries]);

  const filtered = useMemo(() => {
    return entries.filter(e => {
      if (staffFilter !== "all" && e.staffName !== staffFilter) return false;
      if (timeFrom || timeTo) {
        const t = toAwstTime(e.loggedAt);
        if (timeFrom && t < timeFrom) return false;
        if (timeTo   && t > timeTo)   return false;
      }
      return true;
    });
  }, [entries, staffFilter, timeFrom, timeTo]);

  const grouped = useMemo(() => {
    const map: Record<string, PrepLogEntry[]> = {};
    for (const e of filtered) {
      const key =
        groupBy === "staff" ? e.staffName :
        groupBy === "item"  ? e.itemName  :
        e.loggedAt.slice(0, 10);
      if (!map[key]) map[key] = [];
      map[key].push(e);
    }
    return Object.keys(map).sort().map(key => ({ key, entries: map[key] }));
  }, [filtered, groupBy]);

  const toggleGroup = (key: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const getGroupViewMode = (key: string): "timeline" | "combined" =>
    groupViewMode[key] ?? "timeline";

  const setGroupMode = (key: string, mode: "timeline" | "combined") => {
    setGroupViewMode(prev => ({ ...prev, [key]: mode }));
  };

  // Build combined rows for a set of entries
  const buildCombinedRows = (items: PrepLogEntry[]): CombinedRow[] => {
    const map: Record<string, CombinedRow> = {};
    for (const e of items) {
      const rowKey = `${e.itemName}|||${e.unit}`;
      if (!map[rowKey]) {
        map[rowKey] = {
          itemName: e.itemName,
          itemType: e.itemType,
          itemSku: e.itemSku,
          itemAttributesSummary: e.itemAttributesSummary,
          totalQty: 0,
          unit: e.unit,
          staffList: [],
          representativeEntry: e,
        };
      }
      map[rowKey].totalQty += e.quantity;
      if (!map[rowKey].staffList.includes(e.staffName)) {
        map[rowKey].staffList.push(e.staffName);
      }
    }
    // Sort alphabetically by item name
    return Object.values(map).sort((a, b) => a.itemName.localeCompare(b.itemName));
  };

  const exportCsv = () => {
    const header = "Date/Time,Item,SKU,Source,Quantity,Unit,Staff,Notes";
    const rows = filtered.map(e =>
      [
        formatDate(e.loggedAt),
        `"${e.itemName.replace(/"/g, '""')}"`,
        e.itemSku || "",
        e.itemType === "order" ? "Order" : "Prep",
        e.quantity,
        e.unit,
        `"${e.staffName.replace(/"/g, '""')}"`,
        `"${(e.notes || "").replace(/"/g, '""')}"`,
      ].join(",")
    );
    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url;
    a.download = `prep-report-${dateFrom}-to-${dateTo}${staffFilter !== "all" ? `-${staffFilter}` : ""}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const totalEntries  = filtered.length;
  const totalEach     = filtered.filter(e => e.unit === "each" || e.unit === "portion").reduce((s, e) => s + e.quantity, 0);
  const uniqueStaff   = new Set(filtered.map(e => e.staffName)).size;

  return (
    <div className="p-6 space-y-6 max-w-screen-xl">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <BarChart3 size={20} /> Production Reports
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Track what was made, by whom, and when.</p>
        </div>
        <Button variant="outline" size="sm" onClick={exportCsv} disabled={filtered.length === 0}>
          <Download size={14} className="mr-1.5" /> Export CSV
        </Button>
      </div>

      {/* Filters */}
      <div className="rounded-lg border border-border bg-card p-4 space-y-4">
        <p className="text-sm font-semibold">Filters</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">From</Label>
            <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="h-9 text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">To</Label>
            <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="h-9 text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Staff Member</Label>
            <Select value={staffFilter} onValueChange={setStaffFilter}>
              <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Staff</SelectItem>
                {allStaff.map(name => <SelectItem key={name} value={name}>{name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Group By</Label>
            <Select value={groupBy} onValueChange={v => setGroupBy(v as any)}>
              <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="staff">Staff Member</SelectItem>
                <SelectItem value="item">Item / Recipe</SelectItem>
                <SelectItem value="date">Date</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        {/* Time of day filter */}
        <div className="flex items-end gap-3 flex-wrap">
          <div className="space-y-1.5">
            <Label className="text-xs">Time from (AWST)</Label>
            <Input type="time" value={timeFrom} onChange={e => setTimeFrom(e.target.value)} className="h-9 text-sm w-32" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Time to (AWST)</Label>
            <Input type="time" value={timeTo} onChange={e => setTimeTo(e.target.value)} className="h-9 text-sm w-32" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Shift presets</Label>
            <div className="flex gap-1.5 flex-wrap">
              <Button size="sm" variant={timeFrom==="05:00"&&timeTo==="12:00"?"default":"outline"} className="h-9 text-xs" onClick={() => applyShift("05:00","12:00")}>Morning (5am–12pm)</Button>
              <Button size="sm" variant={timeFrom==="12:00"&&timeTo==="17:00"?"default":"outline"} className="h-9 text-xs" onClick={() => applyShift("12:00","17:00")}>Afternoon (12pm–5pm)</Button>
              <Button size="sm" variant={timeFrom===""&&timeTo===""?"default":"outline"} className="h-9 text-xs" onClick={() => applyShift("","")}>All day</Button>
            </div>
          </div>
        </div>
        {/* Date presets */}
        <div className="flex gap-2 flex-wrap">
          <Button size="sm" variant="outline" className="h-7 text-xs"
            onClick={() => { setDateFrom(today()); setDateTo(today()); }}>Today</Button>
          <Button size="sm" variant="outline" className="h-7 text-xs"
            onClick={() => { const d = new Date(); d.setDate(d.getDate()-1); const s = toAwstDate(d); setDateFrom(s); setDateTo(s); }}>Yesterday</Button>
          <Button size="sm" variant="outline" className="h-7 text-xs"
            onClick={() => { setDateFrom(sevenDaysAgo()); setDateTo(today()); }}>Last 7 days</Button>
          <Button size="sm" variant="outline" className="h-7 text-xs"
            onClick={() => { const d = new Date(); setDateFrom(toAwstDate(new Date(d.getFullYear(), d.getMonth(), 1))); setDateTo(today()); }}>This month</Button>
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
        <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-14 rounded-lg bg-muted animate-pulse" />)}</div>
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
            const viewMode = getGroupViewMode(key);
            const byUnit: Record<string, number> = {};
            for (const e of groupEntries) {
              byUnit[e.unit] = (byUnit[e.unit] || 0) + e.quantity;
            }

            const prepEntries    = groupEntries.filter(e => e.itemType !== "order" && e.itemType !== "boxed");
            const productEntries = groupEntries.filter(e => e.itemType === "order");
            const boxedEntries   = groupEntries.filter(e => e.itemType === "boxed");

            // Timeline (original) render
            const renderCategory = (label: string, colour: string, items: PrepLogEntry[]) => {
              if (items.length === 0) return null;
              return (
                <div>
                  <div className="px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide"
                    style={{ backgroundColor: colour + "18", color: colour }}>
                    {label}
                  </div>
                  <div className="divide-y divide-border">
                    {items.map(e => (
                      <div key={e.id} className="px-4 py-2.5 hover:bg-muted/20">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0 grid grid-cols-1 md:grid-cols-4 gap-1 md:gap-3 items-start">
                            <div className="md:col-span-1">
                              <p className="text-sm font-medium truncate">{e.itemName}</p>
                              {/* Component breakdown — only for order items with a SKU */}
                              {e.itemType === "order" && (
                                <EntryBreakdown entry={e} quantity={e.quantity} />
                              )}
                            </div>
                            <p className="text-sm tabular-nums font-semibold text-primary">
                              {e.quantity % 1 === 0 ? e.quantity : e.quantity.toFixed(2)} {e.unit}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {groupBy !== "staff" ? e.staffName : formatDate(e.loggedAt)}
                            </p>
                            <p className="text-xs text-muted-foreground truncate">
                              {groupBy === "staff"
                                ? (e.notes || "")
                                : `${groupBy === "item" ? e.staffName + " · " : ""}${formatDate(e.loggedAt)}${e.notes ? " · " + e.notes : ""}`
                              }
                            </p>
                          </div>
                          <Button
                            variant="ghost" size="icon"
                            className="h-7 w-7 text-destructive shrink-0"
                            onClick={() => deleteMutation.mutate(e.id)}
                          >
                            <Trash2 size={13} />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            };

            // Combined render
            const combinedPrepRows    = buildCombinedRows(prepEntries);
            const combinedProductRows = buildCombinedRows(productEntries);
            const combinedBoxedRows   = buildCombinedRows(boxedEntries);

            return (
              <div key={key} className="rounded-lg border border-border overflow-hidden">
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

                {isExpanded && (
                  <div>
                    {/* View mode tabs */}
                    <div className="flex border-b border-border bg-muted/20">
                      <button
                        className={cn(
                          "flex items-center gap-1.5 px-4 py-2 text-xs font-medium transition-colors border-b-2",
                          viewMode === "timeline"
                            ? "border-[#256984] text-[#256984]"
                            : "border-transparent text-muted-foreground hover:text-foreground"
                        )}
                        onClick={() => setGroupMode(key, "timeline")}
                      >
                        <Clock size={12} /> By Time
                      </button>
                      <button
                        className={cn(
                          "flex items-center gap-1.5 px-4 py-2 text-xs font-medium transition-colors border-b-2",
                          viewMode === "combined"
                            ? "border-[#256984] text-[#256984]"
                            : "border-transparent text-muted-foreground hover:text-foreground"
                        )}
                        onClick={() => setGroupMode(key, "combined")}
                      >
                        <Layers size={12} /> Combined
                      </button>
                    </div>

                    <div className="divide-y divide-border">
                      {viewMode === "timeline" ? (
                        <>
                          {renderCategory("Prep", "#6d7c8a", prepEntries)}
                          {renderCategory("Products", "#256984", productEntries)}
                          {renderCategory("Items Boxed", "#7c3aed", boxedEntries)}
                        </>
                      ) : (
                        <>
                          <CombinedCategory
                            label="Prep"
                            colour="#6d7c8a"
                            rows={combinedPrepRows}
                            onDelete={deleteMutation.mutate}
                          />
                          <CombinedCategory
                            label="Products"
                            colour="#256984"
                            rows={combinedProductRows}
                            onDelete={deleteMutation.mutate}
                          />
                          <CombinedCategory
                            label="Items Boxed"
                            colour="#7c3aed"
                            rows={combinedBoxedRows}
                            onDelete={deleteMutation.mutate}
                          />
                        </>
                      )}
                    </div>
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
