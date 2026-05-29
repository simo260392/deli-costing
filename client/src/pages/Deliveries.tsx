import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  Package, PackageCheck, TrendingDown, AlertTriangle, Trash2,
  Calendar, ChevronDown, ChevronUp, RefreshCw, Check
} from "lucide-react";

// ─── Smart Search Combobox ───────────────────────────────────────────────────
function SmartSearch({
  value,
  onChange,
  options,
  placeholder = "Search…",
  loading = false,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
  loading?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);

  // Sync display text when value changes externally (e.g. reset)
  useEffect(() => {
    if (!open) setQuery(value);
  }, [value, open]);

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        // If user typed something but didn't pick, revert to current value
        setQuery(value);
      }
    }
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, value]);

  const filtered = options.filter(o =>
    o.toLowerCase().includes(query.toLowerCase())
  ).slice(0, 20);

  function pick(opt: string) {
    onChange(opt);
    setQuery(opt);
    setOpen(false);
  }

  return (
    <div ref={wrapRef} className="relative">
      <Input
        value={query}
        placeholder={loading ? "Loading…" : placeholder}
        disabled={loading}
        autoComplete="off"
        onChange={e => {
          setQuery(e.target.value);
          setOpen(true);
          // Clear selection if user edits away from it
          if (e.target.value !== value) onChange("");
        }}
        onFocus={() => { setQuery(""); setOpen(true); }}
        onKeyDown={e => {
          if (e.key === "Escape") { setOpen(false); setQuery(value); }
          if (e.key === "Enter" && filtered.length === 1) pick(filtered[0]);
        }}
      />
      {open && filtered.length > 0 && (
        <div className="absolute z-50 mt-1 w-full bg-background border border-border rounded-lg shadow-lg max-h-52 overflow-y-auto">
          {filtered.map(opt => (
            <button
              key={opt}
              type="button"
              onMouseDown={e => { e.preventDefault(); pick(opt); }}
              className={cn(
                "w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors flex items-center gap-2",
                value === opt && "bg-[#256984]/10 text-[#256984] font-medium"
              )}
            >
              {value === opt && <Check size={12} className="shrink-0" />}
              {opt}
            </button>
          ))}
        </div>
      )}
      {open && !loading && filtered.length === 0 && query.length > 0 && (
        <div className="absolute z-50 mt-1 w-full bg-background border border-border rounded-lg shadow-sm px-3 py-2 text-sm text-muted-foreground">
          No matches found
        </div>
      )}
    </div>
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface BalanceRow {
  customer_name: string;
  customer_uuid: string | null;
  balance: number;
  total_out: number;
  total_in: number;
  last_activity: string;
}

interface LogRow {
  id: number;
  order_id: number;
  customer_name: string;
  delivery_date: string;
  boxes_out: number;
  boxes_in: number;
  logged_by: string | null;
  notes: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function fmtDate(iso: string) {
  return new Date(iso + "T12:00:00").toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" });
}

function getLast7Days(): string[] {
  const days: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

// ─── Manual Entry Dialog ──────────────────────────────────────────────────────
function ManualEntryDialog({ open, onClose, onSaved }: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const emptyForm = {
    customer_name: "",
    order_id: "",
    delivery_date: new Date().toISOString().slice(0, 10),
    boxes_out: "",
    boxes_in: "",
    logged_by: "",
    notes: "",
  };
  const [form, setForm] = useState(emptyForm);
  const { toast } = useToast();

  // Fetch wholesale customers (API returns array directly)
  const { data: customersData, isLoading: customersLoading } = useQuery<{ companyName: string }[]>({
    queryKey: ["/api/wholesale/customers"],
    queryFn: () => apiRequest("GET", "/api/wholesale/customers").then(r => r.json()),
    staleTime: 5 * 60 * 1000,
    enabled: open,
  });
  const customerOptions = (Array.isArray(customersData) ? customersData : []).map(c => c.companyName).sort();

  // Fetch all Deputy staff (roster endpoint returns all active employees as fallback)
  const today = new Date().toISOString().slice(0, 10);
  const { data: rosterData, isLoading: rosterLoading } = useQuery<{ employees: { id: number; name: string }[] }>({
    queryKey: ["/api/deputy/roster", today],
    queryFn: () => apiRequest("GET", `/api/deputy/roster?date=${today}`).then(r => r.json()),
    staleTime: 5 * 60 * 1000,
    enabled: open,
  });
  const staffOptions = (rosterData?.employees ?? []).map(s => s.name).sort();

  const save = useMutation({
    mutationFn: () => apiRequest("POST", "/api/grey-box/log", {
      order_id: Number(form.order_id) || 0,
      customer_name: form.customer_name.trim(),
      delivery_date: form.delivery_date,
      boxes_out: Number(form.boxes_out) || 0,
      boxes_in: Number(form.boxes_in) || 0,
      logged_by: form.logged_by || null,
      notes: form.notes || null,
    }).then(r => r.json()),
    onSuccess: (data) => {
      if (data.error) { toast({ title: "Error", description: data.error, variant: "destructive" }); return; }
      toast({ title: "Entry saved" });
      onSaved();
      onClose();
      setForm(emptyForm);
    },
    onError: () => toast({ title: "Failed to save", variant: "destructive" }),
  });

  const canSave = form.customer_name.trim().length > 0 && form.logged_by.trim().length > 0 && !save.isPending;

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-base flex items-center gap-2">
            <Package size={16} className="text-[#256984]" /> Manual Box Entry
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div className="space-y-1.5">
            <Label>Customer <span className="text-red-500">*</span></Label>
            <SmartSearch
              value={form.customer_name}
              onChange={v => setForm(f => ({ ...f, customer_name: v }))}
              options={customerOptions}
              placeholder="Search wholesale customers…"
              loading={customersLoading}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Order # (optional)</Label>
              <Input type="number" value={form.order_id} onChange={e => setForm(f => ({ ...f, order_id: e.target.value }))} placeholder="0" />
            </div>
            <div className="space-y-1.5">
              <Label>Date</Label>
              <Input type="date" value={form.delivery_date} onChange={e => setForm(f => ({ ...f, delivery_date: e.target.value }))} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Boxes out</Label>
              <Input type="number" min="0" value={form.boxes_out} onChange={e => setForm(f => ({ ...f, boxes_out: e.target.value }))} placeholder="0" />
            </div>
            <div className="space-y-1.5">
              <Label>Boxes in</Label>
              <Input type="number" min="0" value={form.boxes_in} onChange={e => setForm(f => ({ ...f, boxes_in: e.target.value }))} placeholder="0" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Logged by <span className="text-red-500">*</span></Label>
            <SmartSearch
              value={form.logged_by}
              onChange={v => setForm(f => ({ ...f, logged_by: v }))}
              options={staffOptions}
              placeholder="Search staff…"
              loading={rosterLoading}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Notes (optional)</Label>
            <Input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Any notes…" />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button
            size="sm"
            className="bg-[#256984] hover:bg-[#1e5570] text-white"
            disabled={!canSave}
            onClick={() => save.mutate()}
          >
            {save.isPending ? "Saving…" : "Save entry"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function Deliveries() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [tab, setTab] = useState<"report" | "balances">("balances");
  const [manualOpen, setManualOpen] = useState(false);
  const [expandedCustomers, setExpandedCustomers] = useState<Set<string>>(new Set());

  // Weekly report data
  const { data: weeklyData, isLoading: weeklyLoading, refetch: refetchWeekly } = useQuery<{
    ok: boolean; from: string; to: string; rows: LogRow[];
  }>({
    queryKey: ["/api/grey-box/weekly"],
    queryFn: () => apiRequest("GET", "/api/grey-box/weekly?days=7").then(r => r.json()),
    staleTime: 60 * 1000,
  });

  // Balance data
  const { data: balanceData, isLoading: balanceLoading, refetch: refetchBalances } = useQuery<{
    ok: boolean; balances: BalanceRow[];
  }>({
    queryKey: ["/api/grey-box/balances"],
    queryFn: () => apiRequest("GET", "/api/grey-box/balances").then(r => r.json()),
    staleTime: 60 * 1000,
  });

  // Delete log entry
  const deleteEntry = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/grey-box/log/${id}`).then(r => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/grey-box/weekly"] });
      qc.invalidateQueries({ queryKey: ["/api/grey-box/balances"] });
      toast({ title: "Entry deleted" });
    },
    onError: () => toast({ title: "Failed to delete", variant: "destructive" }),
  });

  const days7 = getLast7Days();

  // Group weekly rows by customer
  const rows = weeklyData?.rows ?? [];
  const customerSet = [...new Set(rows.map(r => r.customer_name))].sort();

  // Per-customer, per-day summary
  function getDayData(customer: string, date: string) {
    const matching = rows.filter(r => r.customer_name === customer && r.delivery_date === date);
    return {
      out: matching.reduce((s, r) => s + r.boxes_out, 0),
      in: matching.reduce((s, r) => s + r.boxes_in, 0),
      entries: matching,
    };
  }

  function toggleExpand(customer: string) {
    setExpandedCustomers(prev => {
      const next = new Set(prev);
      if (next.has(customer)) next.delete(customer); else next.add(customer);
      return next;
    });
  }

  const balances = balanceData?.balances ?? [];
  const totalBoxesOut = balances.reduce((s, b) => s + b.total_out, 0);
  const totalBoxesIn  = balances.reduce((s, b) => s + b.total_in, 0);
  const totalBalance  = balances.reduce((s, b) => s + b.balance, 0);

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["/api/grey-box/weekly"] });
    qc.invalidateQueries({ queryKey: ["/api/grey-box/balances"] });
  };

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-foreground">Grey Box Tracker</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Track grey boxes given to wholesale customers</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline" size="sm"
            className="gap-1.5 text-xs"
            onClick={() => { refetchWeekly(); refetchBalances(); }}
          >
            <RefreshCw size={13} /> Refresh
          </Button>
          <Button
            size="sm"
            className="bg-[#256984] hover:bg-[#1e5570] text-white gap-1.5 text-xs"
            onClick={() => setManualOpen(true)}
          >
            <Package size={13} /> Manual entry
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-muted rounded-lg p-1 w-fit">
        {([
          { key: "report",   label: "Weekly Report" },
          { key: "balances", label: "Box Balances" },
        ] as { key: typeof tab; label: string }[]).map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "px-4 py-1.5 rounded-md text-sm font-medium transition-colors",
              tab === t.key
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Tab: Weekly Report ── */}
      {tab === "report" && (
        <div className="space-y-4">
          {weeklyLoading ? (
            <div className="space-y-3">
              {[1,2,3].map(i => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}
            </div>
          ) : customerSet.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground text-sm">
                No grey box activity in the last 7 days.
                <br />
                <span className="text-xs">Entries are logged automatically when a wholesale order is completed on the Production page.</span>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Day headers */}
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr>
                      <th className="text-left py-2 pr-4 font-semibold text-foreground text-sm w-48">Customer</th>
                      {days7.map(day => (
                        <th key={day} className="text-center px-2 py-2 font-medium text-muted-foreground whitespace-nowrap min-w-[72px]">
                          {new Date(day + "T12:00:00").toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" })}
                        </th>
                      ))}
                      <th className="text-center px-2 py-2 font-semibold text-foreground whitespace-nowrap">7-day total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {customerSet.map(customer => {
                      const isExpanded = expandedCustomers.has(customer);
                      const weekOut = days7.reduce((s, d) => s + getDayData(customer, d).out, 0);
                      const weekIn  = days7.reduce((s, d) => s + getDayData(customer, d).in,  0);

                      return (
                        <>
                          {/* Summary row */}
                          <tr
                            key={customer + "-row"}
                            className="border-t border-border cursor-pointer hover:bg-muted/30 transition-colors"
                            onClick={() => toggleExpand(customer)}
                          >
                            <td className="py-2.5 pr-4">
                              <div className="flex items-center gap-1.5">
                                {isExpanded
                                  ? <ChevronUp size={13} className="text-muted-foreground shrink-0" />
                                  : <ChevronDown size={13} className="text-muted-foreground shrink-0" />
                                }
                                <span className="font-medium text-foreground truncate max-w-[160px]">{customer}</span>
                              </div>
                            </td>
                            {days7.map(day => {
                              const { out, in: inn } = getDayData(customer, day);
                              const hasActivity = out > 0 || inn > 0;
                              return (
                                <td key={day} className="text-center px-2 py-2.5">
                                  {hasActivity ? (
                                    <div className="flex flex-col items-center gap-0.5">
                                      {out > 0 && (
                                        <span className="text-[#256984] font-semibold">+{out}</span>
                                      )}
                                      {inn > 0 && (
                                        <span className="text-emerald-600 font-semibold">−{inn}</span>
                                      )}
                                    </div>
                                  ) : (
                                    <span className="text-muted-foreground/40">—</span>
                                  )}
                                </td>
                              );
                            })}
                            <td className="text-center px-2 py-2.5">
                              <div className="flex flex-col items-center gap-0.5">
                                {weekOut > 0 && <span className="text-[#256984] font-bold">+{weekOut}</span>}
                                {weekIn  > 0 && <span className="text-emerald-600 font-bold">−{weekIn}</span>}
                              </div>
                            </td>
                          </tr>

                          {/* Expanded detail rows */}
                          {isExpanded && days7.map(day => {
                            const { entries } = getDayData(customer, day);
                            return entries.map(entry => (
                              <tr key={entry.id} className="bg-muted/20">
                                <td className="py-1.5 pr-4 pl-6 text-muted-foreground text-xs">
                                  Order #{entry.order_id}
                                  {entry.logged_by && <span className="ml-1">· {entry.logged_by}</span>}
                                  {entry.notes && <span className="ml-1 italic">· {entry.notes}</span>}
                                </td>
                                {days7.map(d => (
                                  <td key={d} className="text-center px-2 py-1.5">
                                    {d === day ? (
                                      <div className="flex flex-col items-center gap-0.5">
                                        {entry.boxes_out > 0 && <span className="text-[#256984]">+{entry.boxes_out}</span>}
                                        {entry.boxes_in  > 0 && <span className="text-emerald-600">−{entry.boxes_in}</span>}
                                      </div>
                                    ) : null}
                                  </td>
                                ))}
                                <td className="text-center px-2 py-1.5">
                                  <button
                                    onClick={() => deleteEntry.mutate(entry.id)}
                                    className="text-muted-foreground hover:text-red-500 transition-colors"
                                    title="Delete entry"
                                  >
                                    <Trash2 size={12} />
                                  </button>
                                </td>
                              </tr>
                            ));
                          })}
                        </>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Legend */}
              <div className="flex items-center gap-4 text-xs text-muted-foreground pt-1 border-t border-border">
                <span className="flex items-center gap-1.5"><span className="text-[#256984] font-semibold">+n</span> = boxes dropped off</span>
                <span className="flex items-center gap-1.5"><span className="text-emerald-600 font-semibold">−n</span> = boxes collected back</span>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Tab: Box Balances ── */}
      {tab === "balances" && (
        <div className="space-y-4">
          {/* Summary cards */}
          {!balanceLoading && balances.length > 0 && (
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "Total boxes out", value: totalBoxesOut, icon: Package,     colour: "#256984" },
                { label: "Total boxes back", value: totalBoxesIn,  icon: PackageCheck, colour: "#10b981" },
                { label: "Currently with customers", value: totalBalance,  icon: TrendingDown, colour: "#f59e0b" },
              ].map(({ label, value, icon: Icon, colour }) => (
                <Card key={label}>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-1">
                      <Icon size={14} style={{ color: colour }} />
                      <span className="text-xs text-muted-foreground">{label}</span>
                    </div>
                    <p className="text-2xl font-bold" style={{ color: colour }}>{value}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* Balances table */}
          {balanceLoading ? (
            <div className="space-y-2">
              {[1,2,3,4,5].map(i => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}
            </div>
          ) : balances.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground text-sm">
                No grey box data yet.
                <br />
                <span className="text-xs">Balances are calculated from all recorded activity.</span>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Package size={14} className="text-[#256984]" />
                  Current box balance — all customers
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  Negative balances are automatically reset to 0. New boxes are added from 0, not from a negative number.
                </p>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-2 font-semibold text-foreground">Customer</th>
                      <th className="text-center py-2 font-semibold text-muted-foreground">Out</th>
                      <th className="text-center py-2 font-semibold text-muted-foreground">Back</th>
                      <th className="text-center py-2 font-semibold text-foreground">Balance</th>
                      <th className="text-right py-2 font-semibold text-muted-foreground text-xs">Last activity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {balances.map(row => (
                      <tr key={row.customer_name} className="border-t border-border/50 hover:bg-muted/20 transition-colors">
                        <td className="py-2.5 font-medium text-foreground">{row.customer_name}</td>
                        <td className="py-2.5 text-center text-[#256984]">{row.total_out}</td>
                        <td className="py-2.5 text-center text-emerald-600">{row.total_in}</td>
                        <td className="py-2.5 text-center">
                          <Badge
                            className={cn(
                              "font-bold text-sm px-2.5",
                              row.balance === 0
                                ? "bg-muted text-muted-foreground"
                                : row.balance <= 2
                                ? "bg-yellow-100 text-yellow-800 border-yellow-300"
                                : "bg-[#256984]/10 text-[#256984] border-[#256984]/30"
                            )}
                            variant="outline"
                          >
                            {row.balance}
                          </Badge>
                        </td>
                        <td className="py-2.5 text-right text-xs text-muted-foreground">{fmtDate(row.last_activity)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}

          {/* Warning note */}
          <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/30 rounded-lg px-3 py-2.5">
            <AlertTriangle size={13} className="text-amber-500 shrink-0 mt-0.5" />
            <span>If a customer shows a negative balance it is automatically treated as 0. The next delivery to them starts the count fresh from that number, not from the negative.</span>
          </div>
        </div>
      )}

      {/* Manual entry dialog */}
      <ManualEntryDialog
        open={manualOpen}
        onClose={() => setManualOpen(false)}
        onSaved={invalidateAll}
      />
    </div>
  );
}
