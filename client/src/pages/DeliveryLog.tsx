import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  Truck, Thermometer, CheckCircle2, XCircle, Clock,
  RefreshCw, ChevronDown, ChevronUp, Download, History,
  AlertTriangle, Trash2, Flame, Snowflake
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────
interface OrderRow {
  order_id: number;
  client: string;
  delivery_time: string | null;
  dispatch_time: string | null;
  log: DeliveryLogEntry | null;
}

interface DeliveryLogEntry {
  id: number;
  order_id: number;
  client: string;
  delivery_date: string;
  delivery_time: string | null;
  dispatch_temp: number | null;
  delivery_temp: number | null;
  food_type: "hot" | "cold" | null;
  dispatch_compliant: boolean | null;
  delivery_compliant: boolean | null;
  driver: string | null;
  notes: string | null;
  logged_by: string | null;
  created_at: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtDate(iso: string) {
  return new Date(iso + "T12:00:00").toLocaleDateString("en-AU", {
    weekday: "short", day: "numeric", month: "short", year: "numeric"
  });
}

function todayAWST() {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function complianceBadge(compliant: boolean | null, temp: number | null, foodType: "hot" | "cold" | null) {
  if (temp === null || foodType === null) return null;
  if (compliant === true)  return <Badge className="bg-emerald-100 text-emerald-700 border-emerald-300 text-xs gap-1" variant="outline"><CheckCircle2 size={11} /> OK</Badge>;
  if (compliant === false) return <Badge className="bg-red-100 text-red-700 border-red-300 text-xs gap-1" variant="outline"><XCircle size={11} /> Non-compliant</Badge>;
  return null;
}

// ─── Log Temperature Dialog ───────────────────────────────────────────────────
function LogTempDialog({
  order,
  date,
  open,
  onClose,
  onSaved,
}: {
  order: OrderRow;
  date: string;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const existing = order.log;

  const [form, setForm] = useState({
    food_type: (existing?.food_type ?? "") as "hot" | "cold" | "",
    dispatch_temp: existing?.dispatch_temp != null ? String(existing.dispatch_temp) : "",
    delivery_temp: existing?.delivery_temp != null ? String(existing.delivery_temp) : "",
    driver: existing?.driver ?? "",
    notes: existing?.notes ?? "",
    logged_by: existing?.logged_by ?? "",
  });

  const save = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/delivery-log", {
        order_id: order.order_id,
        client: order.client,
        delivery_date: date,
        delivery_time: order.delivery_time,
        food_type: form.food_type || null,
        dispatch_temp: form.dispatch_temp !== "" ? Number(form.dispatch_temp) : null,
        delivery_temp: form.delivery_temp !== "" ? Number(form.delivery_temp) : null,
        driver: form.driver || null,
        notes: form.notes || null,
        logged_by: form.logged_by || null,
      }).then((r) => r.json()),
    onSuccess: (data) => {
      if (data.error) {
        toast({ title: "Error", description: data.error, variant: "destructive" });
        return;
      }
      toast({ title: "Temperature logged" });
      onSaved();
      onClose();
    },
    onError: () => toast({ title: "Failed to save", variant: "destructive" }),
  });

  // Compliance preview
  const dispatchCompliant = useMemo(() => {
    if (!form.food_type || form.dispatch_temp === "") return null;
    const t = Number(form.dispatch_temp);
    return form.food_type === "hot" ? t >= 60 : t <= 5;
  }, [form.food_type, form.dispatch_temp]);

  const deliveryCompliant = useMemo(() => {
    if (!form.food_type || form.delivery_temp === "") return null;
    const t = Number(form.delivery_temp);
    return form.food_type === "hot" ? t >= 60 : t <= 5;
  }, [form.food_type, form.delivery_temp]);

  const threshold = form.food_type === "hot" ? "must be ≥60°C" : form.food_type === "cold" ? "must be ≤5°C" : "";

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-base flex items-center gap-2">
            <Truck size={16} className="text-[#256984]" />
            <span className="truncate">{order.client} — #{order.order_id}</span>
          </DialogTitle>
          {order.delivery_time && (
            <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
              <Clock size={11} /> Delivery {order.delivery_time}
              {order.dispatch_time && <> · Dispatch {order.dispatch_time}</>}
            </p>
          )}
        </DialogHeader>

        <div className="space-y-4 py-1">
          {/* Food type */}
          <div className="space-y-1.5">
            <Label>Food type</Label>
            <div className="flex gap-2">
              {(["hot", "cold"] as const).map((ft) => (
                <button
                  key={ft}
                  onClick={() => setForm((f) => ({ ...f, food_type: ft }))}
                  className={cn(
                    "flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border text-sm font-medium transition-colors",
                    form.food_type === ft
                      ? ft === "hot"
                        ? "bg-orange-50 border-orange-400 text-orange-700"
                        : "bg-blue-50 border-blue-400 text-blue-700"
                      : "border-border text-muted-foreground hover:bg-muted/50"
                  )}
                >
                  {ft === "hot" ? <Flame size={14} /> : <Snowflake size={14} />}
                  {ft === "hot" ? "Hot food" : "Cold food"}
                </button>
              ))}
            </div>
            {threshold && (
              <p className="text-xs text-muted-foreground">Temperature {threshold}</p>
            )}
          </div>

          {/* Dispatch temp */}
          <div className="space-y-1.5">
            <Label className="flex items-center justify-between">
              <span>Dispatch temperature (°C)</span>
              {dispatchCompliant === true && <span className="text-emerald-600 text-xs flex items-center gap-1"><CheckCircle2 size={11} /> Compliant</span>}
              {dispatchCompliant === false && <span className="text-red-600 text-xs flex items-center gap-1"><XCircle size={11} /> Non-compliant</span>}
            </Label>
            <Input
              type="number"
              step="0.1"
              placeholder="e.g. 65.5"
              value={form.dispatch_temp}
              onChange={(e) => setForm((f) => ({ ...f, dispatch_temp: e.target.value }))}
              className={cn(
                dispatchCompliant === false && "border-red-400 focus-visible:ring-red-400",
                dispatchCompliant === true  && "border-emerald-400 focus-visible:ring-emerald-400"
              )}
            />
          </div>

          {/* Delivery temp */}
          <div className="space-y-1.5">
            <Label className="flex items-center justify-between">
              <span>Delivery temperature (°C)</span>
              {deliveryCompliant === true && <span className="text-emerald-600 text-xs flex items-center gap-1"><CheckCircle2 size={11} /> Compliant</span>}
              {deliveryCompliant === false && <span className="text-red-600 text-xs flex items-center gap-1"><XCircle size={11} /> Non-compliant</span>}
            </Label>
            <Input
              type="number"
              step="0.1"
              placeholder="e.g. 62.0"
              value={form.delivery_temp}
              onChange={(e) => setForm((f) => ({ ...f, delivery_temp: e.target.value }))}
              className={cn(
                deliveryCompliant === false && "border-red-400 focus-visible:ring-red-400",
                deliveryCompliant === true  && "border-emerald-400 focus-visible:ring-emerald-400"
              )}
            />
          </div>

          {/* Driver */}
          <div className="space-y-1.5">
            <Label>Driver (optional)</Label>
            <Input
              placeholder="Driver name"
              value={form.driver}
              onChange={(e) => setForm((f) => ({ ...f, driver: e.target.value }))}
            />
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <Label>Notes (optional)</Label>
            <Input
              placeholder="Any notes…"
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button
            size="sm"
            className="bg-[#256984] hover:bg-[#1e5570] text-white"
            disabled={save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? "Saving…" : existing ? "Update" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Order Card ───────────────────────────────────────────────────────────────
function OrderCard({
  order,
  date,
  onRefresh,
}: {
  order: OrderRow;
  date: string;
  onRefresh: () => void;
}) {
  const [open, setOpen] = useState(false);
  const log = order.log;
  const hasLog = !!log;
  const hasIssue = log && (log.dispatch_compliant === false || log.delivery_compliant === false);

  return (
    <>
      <div
        className={cn(
          "rounded-xl border p-4 flex items-center gap-3 cursor-pointer hover:bg-muted/30 transition-colors",
          hasIssue ? "border-red-300 bg-red-50/40" : hasLog ? "border-emerald-300 bg-emerald-50/30" : "border-border bg-background"
        )}
        onClick={() => setOpen(true)}
      >
        {/* Time */}
        <div className="text-center min-w-[52px]">
          <p className="text-lg font-bold text-[#256984] leading-none">{order.delivery_time ?? "—"}</p>
          {order.dispatch_time && (
            <p className="text-[10px] text-muted-foreground mt-0.5">disp {order.dispatch_time}</p>
          )}
        </div>

        {/* Client */}
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-foreground truncate text-sm">{order.client}</p>
          <p className="text-xs text-muted-foreground">#{order.order_id}</p>
        </div>

        {/* Status */}
        <div className="flex items-center gap-2 shrink-0">
          {!hasLog ? (
            <Badge className="bg-muted text-muted-foreground border-border text-xs" variant="outline">
              Not logged
            </Badge>
          ) : (
            <div className="flex flex-col items-end gap-1">
              {/* Food type */}
              {log.food_type && (
                <span className={cn(
                  "text-xs flex items-center gap-1 font-medium",
                  log.food_type === "hot" ? "text-orange-600" : "text-blue-600"
                )}>
                  {log.food_type === "hot" ? <Flame size={11} /> : <Snowflake size={11} />}
                  {log.food_type === "hot" ? "Hot" : "Cold"}
                </span>
              )}
              {/* Temps */}
              {log.dispatch_temp != null && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Thermometer size={11} />
                  {log.dispatch_temp}°C
                  {complianceBadge(log.dispatch_compliant, log.dispatch_temp, log.food_type)}
                </span>
              )}
              {log.delivery_temp != null && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Truck size={11} />
                  {log.delivery_temp}°C
                  {complianceBadge(log.delivery_compliant, log.delivery_temp, log.food_type)}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {open && (
        <LogTempDialog
          order={order}
          date={date}
          open={open}
          onClose={() => setOpen(false)}
          onSaved={onRefresh}
        />
      )}
    </>
  );
}

// ─── History Tab ─────────────────────────────────────────────────────────────
function HistoryTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [from, setFrom] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10);
  });
  const [to, setTo] = useState(() => todayAWST());

  const { data, isLoading, refetch } = useQuery<{ ok: boolean; logs: DeliveryLogEntry[] }>({
    queryKey: ["/api/delivery-log/history", from, to],
    queryFn: () => apiRequest("GET", `/api/delivery-log/history?from=${from}&to=${to}`).then((r) => r.json()),
    staleTime: 30000,
  });

  const del = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/delivery-log/${id}`).then((r) => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/delivery-log/history"] }); toast({ title: "Entry deleted" }); },
  });

  // Group by date
  const grouped = useMemo(() => {
    const map = new Map<string, DeliveryLogEntry[]>();
    for (const l of data?.logs ?? []) {
      if (!map.has(l.delivery_date)) map.set(l.delivery_date, []);
      map.get(l.delivery_date)!.push(l);
    }
    return map;
  }, [data?.logs]);

  // CSV export
  function exportCSV() {
    const logs = data?.logs ?? [];
    if (!logs.length) return;
    const headers = ["Date", "Time", "Order #", "Client", "Driver", "Food Type", "Dispatch Temp (°C)", "Dispatch Compliant", "Delivery Temp (°C)", "Delivery Compliant", "Notes"];
    const rows = logs.map((l) => [
      l.delivery_date,
      l.delivery_time ?? "",
      l.order_id,
      l.client,
      l.driver ?? "",
      l.food_type ?? "",
      l.dispatch_temp ?? "",
      l.dispatch_compliant == null ? "" : l.dispatch_compliant ? "Yes" : "No",
      l.delivery_temp ?? "",
      l.delivery_compliant == null ? "" : l.delivery_compliant ? "Yes" : "No",
      l.notes ?? "",
    ]);
    const csv = [headers, ...rows].map((r) => r.map((v) => `"${v}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `delivery-temps-${from}-to-${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-xs">From</Label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-36 text-sm" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">To</Label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-36 text-sm" />
        </div>
        <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => refetch()}>
          <RefreshCw size={12} /> Apply
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5 text-xs ml-auto"
          onClick={exportCSV}
          disabled={!data?.logs?.length}
        >
          <Download size={12} /> Export CSV
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}</div>
      ) : grouped.size === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground text-sm">
            No delivery temperature records in this date range.
          </CardContent>
        </Card>
      ) : (
        [...grouped.entries()].map(([date, logs]) => {
          const issues = logs.filter(l => l.dispatch_compliant === false || l.delivery_compliant === false);
          return (
            <Card key={date}>
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-sm font-semibold flex items-center justify-between">
                  <span>{fmtDate(date)}</span>
                  <div className="flex items-center gap-2">
                    {issues.length > 0 && (
                      <Badge className="bg-red-100 text-red-700 border-red-300 text-xs gap-1" variant="outline">
                        <AlertTriangle size={10} /> {issues.length} issue{issues.length > 1 ? "s" : ""}
                      </Badge>
                    )}
                    <span className="text-xs text-muted-foreground font-normal">{logs.length} deliveries</span>
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-1.5 font-medium text-muted-foreground">Time</th>
                      <th className="text-left py-1.5 font-medium text-muted-foreground">Client</th>
                      <th className="text-left py-1.5 font-medium text-muted-foreground">Driver</th>
                      <th className="text-left py-1.5 font-medium text-muted-foreground">Type</th>
                      <th className="text-center py-1.5 font-medium text-muted-foreground">Dispatch</th>
                      <th className="text-center py-1.5 font-medium text-muted-foreground">Delivery</th>
                      <th className="py-1.5 w-6"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((l) => (
                      <tr key={l.id} className="border-t border-border/40 hover:bg-muted/20">
                        <td className="py-2 text-muted-foreground">{l.delivery_time ?? "—"}</td>
                        <td className="py-2 font-medium text-foreground max-w-[140px] truncate">{l.client}</td>
                        <td className="py-2 text-muted-foreground">{l.driver ?? "—"}</td>
                        <td className="py-2">
                          {l.food_type ? (
                            <span className={cn("flex items-center gap-1", l.food_type === "hot" ? "text-orange-600" : "text-blue-600")}>
                              {l.food_type === "hot" ? <Flame size={11} /> : <Snowflake size={11} />}
                              {l.food_type === "hot" ? "Hot" : "Cold"}
                            </span>
                          ) : "—"}
                        </td>
                        <td className="py-2 text-center">
                          {l.dispatch_temp != null ? (
                            <span className={cn("font-medium", l.dispatch_compliant === false ? "text-red-600" : "text-emerald-700")}>
                              {l.dispatch_temp}°C
                            </span>
                          ) : "—"}
                        </td>
                        <td className="py-2 text-center">
                          {l.delivery_temp != null ? (
                            <span className={cn("font-medium", l.delivery_compliant === false ? "text-red-600" : "text-emerald-700")}>
                              {l.delivery_temp}°C
                            </span>
                          ) : "—"}
                        </td>
                        <td className="py-2">
                          <button
                            onClick={() => del.mutate(l.id)}
                            className="text-muted-foreground hover:text-red-500 transition-colors"
                            title="Delete"
                          >
                            <Trash2 size={12} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function DeliveryLog() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<"today" | "history">("today");
  const [date, setDate] = useState(todayAWST);

  const { data, isLoading, refetch } = useQuery<{ ok: boolean; date: string; orders: OrderRow[] }>({
    queryKey: ["/api/delivery-log", date],
    queryFn: () => apiRequest("GET", `/api/delivery-log?date=${date}`).then((r) => r.json()),
    staleTime: 30000,
  });

  const orders = data?.orders ?? [];
  const logged  = orders.filter((o) => o.log !== null).length;
  const issues  = orders.filter((o) => o.log && (o.log.dispatch_compliant === false || o.log.delivery_compliant === false)).length;

  function refresh() {
    qc.invalidateQueries({ queryKey: ["/api/delivery-log"] });
    refetch();
  }

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Truck size={20} className="text-[#256984]" />
            Deliveries
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">Temperature records for food safety compliance</p>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={refresh}>
          <RefreshCw size={13} /> Refresh
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-muted rounded-lg p-1 w-fit">
        {([
          { key: "today",   label: "Today's Deliveries", icon: Truck },
          { key: "history", label: "History",            icon: History },
        ] as { key: typeof tab; label: string; icon: any }[]).map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              "px-4 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5",
              tab === key
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Icon size={13} />
            {label}
          </button>
        ))}
      </div>

      {/* ── Today's Deliveries ── */}
      {tab === "today" && (
        <div className="space-y-4">
          {/* Date picker + stats */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground">Date</Label>
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-36 text-sm"
              />
            </div>
            {!isLoading && orders.length > 0 && (
              <div className="flex items-center gap-2 ml-auto">
                <Badge className="bg-[#256984]/10 text-[#256984] border-[#256984]/30 text-xs" variant="outline">
                  {logged}/{orders.length} logged
                </Badge>
                {issues > 0 && (
                  <Badge className="bg-red-100 text-red-700 border-red-300 text-xs gap-1" variant="outline">
                    <AlertTriangle size={10} /> {issues} issue{issues > 1 ? "s" : ""}
                  </Badge>
                )}
              </div>
            )}
          </div>

          {/* Compliance legend */}
          {!isLoading && orders.length > 0 && (
            <div className="flex items-center gap-4 text-xs text-muted-foreground bg-muted/30 rounded-lg px-3 py-2">
              <span className="flex items-center gap-1.5"><Flame size={11} className="text-orange-500" /> Hot food: ≥60°C</span>
              <span className="flex items-center gap-1.5"><Snowflake size={11} className="text-blue-500" /> Cold food: ≤5°C</span>
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-400 inline-block" /> Tap any card to log temps</span>
            </div>
          )}

          {/* Order list */}
          {isLoading ? (
            <div className="space-y-3">
              {[1,2,3,4,5].map(i => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}
            </div>
          ) : orders.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground text-sm">
                No deliveries found for {fmtDate(date)}.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {orders.map((order) => (
                <OrderCard key={order.order_id} order={order} date={date} onRefresh={refresh} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── History ── */}
      {tab === "history" && <HistoryTab />}
    </div>
  );
}
