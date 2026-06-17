import { useState, useMemo, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  Truck, Thermometer, CheckCircle2, XCircle, Clock,
  RefreshCw, Download, History, AlertTriangle, Trash2,
  Flame, Snowflake, Package, Search, User, Camera
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────
interface OrderRow {
  order_id: number;
  client: string;
  delivery_time: string | null;
  dispatch_time: string | null;
  is_wholesale: boolean;
  grey_box_balance: number | null;
  customer_uuid: string;
  log: DeliveryLogEntry | null;
}

interface DeliveryLogEntry {
  id: number;
  order_id: number;
  client: string;
  delivery_date: string;
  delivery_time: string | null;
  hot_dispatch_temp: number | null;
  hot_delivery_temp: number | null;
  cold_dispatch_temp: number | null;
  cold_delivery_temp: number | null;
  // legacy fields kept for history display
  dispatch_temp?: number | null;
  delivery_temp?: number | null;
  food_type?: string | null;
  dispatch_compliant: boolean | null;
  delivery_compliant: boolean | null;
  driver: string | null;
  notes: string | null;
  logged_by: string | null;
  is_wholesale: boolean;
  delivery_photo_url: string | null;
  grey_boxes_balance: number | null;
  grey_boxes_collected: number | null;
  created_at: string;
}

interface StaffMember { id: number; name: string; }

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtDate(iso: string) {
  return new Date(iso + "T12:00:00").toLocaleDateString("en-AU", {
    weekday: "short", day: "numeric", month: "short", year: "numeric"
  });
}
function todayAWST() {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function TempBox({
  label, value, onChange, threshold, compare, icon
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  threshold: number;
  compare: "gte" | "lte";
  icon: React.ReactNode;
}) {
  const num = value !== "" ? Number(value) : null;
  const compliant = num === null ? null : (compare === "gte" ? num >= threshold : num <= threshold);
  return (
    <div className={cn(
      "rounded-xl border p-3 flex flex-col gap-1.5 transition-colors",
      compliant === true  ? "border-emerald-300 bg-emerald-50/50" :
      compliant === false ? "border-red-300 bg-red-50/50" :
      "border-border bg-muted/20"
    )}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">
          {icon}{label}
        </span>
        {compliant === true  && <CheckCircle2 size={13} className="text-emerald-500" />}
        {compliant === false && <XCircle     size={13} className="text-red-500" />}
      </div>
      <Input
        type="number"
        step="0.1"
        placeholder={compare === "gte" ? "≥60°C" : "≤5°C"}
        value={value}
        onChange={e => onChange(e.target.value)}
        className={cn(
          "text-base font-semibold h-9 text-center border-0 bg-transparent p-0 focus-visible:ring-0 placeholder:text-muted-foreground/40",
          compliant === false ? "text-red-600" : compliant === true ? "text-emerald-700" : "text-foreground"
        )}
      />
      <p className="text-[10px] text-muted-foreground text-center">
        {compare === "gte" ? `Hot · must be ≥${threshold}°C` : `Cold · must be ≤${threshold}°C`}
      </p>
    </div>
  );
}

// ─── Driver Search ────────────────────────────────────────────────────────────
function DriverSearch({
  value, onChange, staff
}: {
  value: string;
  onChange: (v: string) => void;
  staff: StaffMember[];
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => { setQuery(value); }, [value]);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const filtered = staff.filter(s =>
    s.name.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div className="relative" ref={ref}>
      <div className="relative">
        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search staff…"
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true); onChange(""); }}
          onFocus={() => setOpen(true)}
          className="pl-8 text-sm"
        />
      </div>
      {open && filtered.length > 0 && (
        <div className="absolute z-50 top-full mt-1 w-full bg-popover border border-border rounded-lg shadow-lg max-h-44 overflow-y-auto">
          {filtered.map(s => (
            <button
              key={s.id}
              className="w-full text-left px-3 py-2 text-sm hover:bg-muted/60 flex items-center gap-2"
              onMouseDown={e => { e.preventDefault(); onChange(s.name); setQuery(s.name); setOpen(false); }}
            >
              <User size={12} className="text-muted-foreground" />
              {s.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Log Dialog ───────────────────────────────────────────────────────────────
function LogTempDialog({
  order, date, open, onClose, onSaved,
}: {
  order: OrderRow; date: string; open: boolean; onClose: () => void; onSaved: () => void;
}) {
  const { toast } = useToast();
  const existing = order.log;

  // Staff list
  const { data: staffData } = useQuery<{ employees: StaffMember[] }>({
    queryKey: ["/api/deputy/roster"],
    queryFn: () => apiRequest("GET", `/api/deputy/roster?date=${date}`).then(r => r.json()),
    staleTime: 5 * 60 * 1000,
  });
  const staff = staffData?.employees ?? [];

  const [form, setForm] = useState({
    hot_dispatch:  existing?.hot_dispatch_temp  != null ? String(existing.hot_dispatch_temp)  : "",
    hot_delivery:  existing?.hot_delivery_temp  != null ? String(existing.hot_delivery_temp)  : "",
    cold_dispatch: existing?.cold_dispatch_temp != null ? String(existing.cold_dispatch_temp) : "",
    cold_delivery: existing?.cold_delivery_temp != null ? String(existing.cold_delivery_temp) : "",
    driver:        existing?.driver ?? "",
    notes:         existing?.notes ?? "",
    grey_collected: existing?.grey_boxes_collected != null ? String(existing.grey_boxes_collected) : "",
  });

  const f = (key: keyof typeof form) => (v: string) => setForm(p => ({ ...p, [key]: v }));

  // Delivery photo
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(existing?.delivery_photo_url ?? null);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [showZeroBoxConfirm, setShowZeroBoxConfirm] = useState(false);

  async function handlePhotoUpload(file: File) {
    setPhotoUploading(true);
    try {
      const fd = new FormData();
      fd.append("photo", file);
      const res = await fetch("/api/upload-photo", {
        method: "POST",
        headers: { Authorization: "Bearer d8ecc189f96774038e36112c5ed9f2bc557c3320" },
        body: fd,
      });
      const data = await res.json();
      if (data.url) setPhotoUrl(data.url);
    } catch {
      toast({ title: "Photo upload failed", variant: "destructive" });
    } finally {
      setPhotoUploading(false);
    }
  }

  // Overall compliance: any non-null temp must be compliant
  const allTemps = [
    form.hot_dispatch  !== "" ? Number(form.hot_dispatch)  >= 60 : null,
    form.hot_delivery  !== "" ? Number(form.hot_delivery)  >= 60 : null,
    form.cold_dispatch !== "" ? Number(form.cold_dispatch) <= 5  : null,
    form.cold_delivery !== "" ? Number(form.cold_delivery) <= 5  : null,
  ].filter(x => x !== null) as boolean[];
  const overallCompliant = allTemps.length === 0 ? null : allTemps.every(Boolean);

  const save = useMutation({
    mutationFn: () => {
      const hasAnyTemp = form.hot_dispatch || form.hot_delivery || form.cold_dispatch || form.cold_delivery;
      // derive legacy food_type for history compat
      const food_type = (form.hot_dispatch || form.hot_delivery) && !(form.cold_dispatch || form.cold_delivery)
        ? "hot" : (form.cold_dispatch || form.cold_delivery) && !(form.hot_dispatch || form.hot_delivery)
        ? "cold" : null;
      return apiRequest("POST", "/api/delivery-log", {
        order_id: order.order_id,
        client: order.client,
        delivery_date: date,
        delivery_time: order.delivery_time,
        food_type,
        hot_dispatch_temp:  form.hot_dispatch  !== "" ? Number(form.hot_dispatch)  : null,
        hot_delivery_temp:  form.hot_delivery  !== "" ? Number(form.hot_delivery)  : null,
        cold_dispatch_temp: form.cold_dispatch !== "" ? Number(form.cold_dispatch) : null,
        cold_delivery_temp: form.cold_delivery !== "" ? Number(form.cold_delivery) : null,
        dispatch_compliant: overallCompliant,
        delivery_compliant: overallCompliant,
        driver: form.driver || null,
        notes:  form.notes  || null,
        is_wholesale: order.is_wholesale,
        grey_boxes_balance:   order.grey_box_balance ?? null,
        grey_boxes_collected: form.grey_collected !== "" ? Number(form.grey_collected) : null,
        delivery_photo_url: photoUrl,
      }).then(r => r.json());
    },
    onSuccess: (data) => {
      if (data.error) { toast({ title: "Error", description: data.error, variant: "destructive" }); return; }
      toast({ title: "Delivery logged" });
      onSaved(); onClose();
    },
    onError: () => toast({ title: "Failed to save", variant: "destructive" }),
  });

  // Wholesale orders require grey_collected to be filled (can be 0 but must be entered)
  const wholesaleBoxesFilled = !order.is_wholesale || form.grey_collected !== "";
  const canSave = !!form.driver && !!photoUrl && wholesaleBoxesFilled;

  return (
    <>
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base flex items-center gap-2">
            <Truck size={16} className="text-[#256984]" />
            <span className="truncate">{order.client} — #{order.order_id}</span>
            {order.is_wholesale && (
              <Badge className="bg-[#256984]/10 text-[#256984] border-[#256984]/30 text-xs ml-1">Wholesale</Badge>
            )}
          </DialogTitle>
          {order.delivery_time && (
            <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
              <Clock size={11} /> Delivery {order.delivery_time}
              {order.dispatch_time && <> · Dispatch {order.dispatch_time}</>}
            </p>
          )}
        </DialogHeader>

        <div className="space-y-5 py-1">

          {/* ── Temperature grid 2×2 ── */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Temperatures</p>
            <div className="grid grid-cols-2 gap-2">
              <TempBox label="Hot · Dispatch"  value={form.hot_dispatch}  onChange={f("hot_dispatch")}  threshold={60} compare="gte" icon={<Flame    size={11} className="text-orange-500" />} />
              <TempBox label="Cold · Dispatch" value={form.cold_dispatch} onChange={f("cold_dispatch")} threshold={5}  compare="lte" icon={<Snowflake size={11} className="text-blue-500"   />} />
              <TempBox label="Hot · Delivery"  value={form.hot_delivery}  onChange={f("hot_delivery")}  threshold={60} compare="gte" icon={<Flame    size={11} className="text-orange-500" />} />
              <TempBox label="Cold · Delivery" value={form.cold_delivery} onChange={f("cold_delivery")} threshold={5}  compare="lte" icon={<Snowflake size={11} className="text-blue-500"   />} />
            </div>
            <p className="text-[10px] text-muted-foreground mt-1.5">Fill in only the boxes that apply — leave unused ones blank.</p>
          </div>

          {/* ── Grey box section (wholesale only) ── */}
          {order.is_wholesale && (
            <div className="rounded-xl border border-[#256984]/20 bg-[#256984]/5 p-3 space-y-3">
              <p className="text-xs font-semibold text-[#256984] flex items-center gap-1.5">
                <Package size={13} /> Grey Boxes
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Client balance</Label>
                  <div className="h-9 rounded-md border border-border bg-muted/30 flex items-center justify-center font-bold text-lg text-[#256984]">
                    {order.grey_box_balance ?? 0}
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs flex items-center gap-1">
                    Collected today <span className="text-red-500">*</span>
                    {form.grey_collected === "" && <span className="text-red-500 font-normal ml-auto">Required</span>}
                  </Label>
                  <Input
                    type="number"
                    min={0}
                    step={1}
                    placeholder="Enter amount…"
                    value={form.grey_collected}
                    onChange={e => setForm(p => ({ ...p, grey_collected: e.target.value }))}
                    className={cn("h-9 text-center font-semibold text-base", form.grey_collected === "" && "border-red-300 focus-visible:ring-red-400")}
                  />
                </div>
              </div>
            </div>
          )}

          {/* ── Driver ── */}
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1">
              Driver <span className="text-red-500 ml-0.5">*</span>
              {!form.driver && <span className="text-xs text-red-500 font-normal ml-auto">Required</span>}
            </Label>
            <DriverSearch value={form.driver} onChange={v => setForm(p => ({ ...p, driver: v }))} staff={staff} />
          </div>

          {/* ── Notes ── */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Notes (optional)</Label>
            <Input
              placeholder="Any notes…"
              value={form.notes}
              onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
            />
          </div>

          {/* ── Delivery Photo (required) ── */}
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1 text-sm">
              <Camera size={13} className="text-[#256984]" />
              Delivery photo <span className="text-red-500 ml-0.5">*</span>
              {!photoUrl && <span className="text-xs text-red-500 font-normal ml-auto">Required to submit</span>}
            </Label>
            <input
              ref={photoInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handlePhotoUpload(f); }}
            />
            {photoUrl ? (
              <div className="relative rounded-xl overflow-hidden border border-emerald-300">
                <img src={photoUrl} alt="Delivery" className="w-full h-44 object-cover" />
                <button
                  className="absolute top-2 right-2 bg-black/60 hover:bg-black/80 text-white rounded-full p-1.5 transition-colors"
                  onClick={() => photoInputRef.current?.click()}
                >
                  <Camera size={13} />
                </button>
              </div>
            ) : (
              <button
                onClick={() => photoInputRef.current?.click()}
                disabled={photoUploading}
                className="w-full h-32 rounded-xl border-2 border-dashed border-border hover:border-[#256984] bg-muted/30 hover:bg-[#256984]/5 transition-colors flex flex-col items-center justify-center gap-2 text-muted-foreground hover:text-[#256984]"
              >
                {photoUploading ? (
                  <div className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                ) : (
                  <>
                    <Camera size={22} />
                    <span className="text-xs font-medium">Take photo of delivery at site</span>
                  </>
                )}
              </button>
            )}
          </div>

        </div>

        <DialogFooter className="gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button
            size="sm"
            className={cn("text-white", canSave ? "bg-[#256984] hover:bg-[#1e5570]" : "bg-muted text-muted-foreground cursor-not-allowed")}
            disabled={save.isPending || !canSave}
            onClick={() => {
              if (!canSave) return;
              // Wholesale: if driver entered 0 boxes, ask for confirmation
              if (order.is_wholesale && Number(form.grey_collected) === 0) {
                setShowZeroBoxConfirm(true);
              } else {
                save.mutate();
              }
            }}
          >
            {save.isPending ? "Saving…" : existing ? "Update" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* Zero boxes confirmation */}
    <AlertDialog open={showZeroBoxConfirm} onOpenChange={setShowZeroBoxConfirm}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>No grey boxes collected?</AlertDialogTitle>
          <AlertDialogDescription>
            You have entered 0 grey boxes collected for this wholesale customer. Are you sure no boxes were returned on this delivery?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Go back</AlertDialogCancel>
          <AlertDialogAction
            className="bg-[#256984] hover:bg-[#1e5570] text-white"
            onClick={() => { setShowZeroBoxConfirm(false); save.mutate(); }}
          >
            Yes, save with 0 boxes
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}

// ─── Order Card ───────────────────────────────────────────────────────────────
function OrderCard({ order, date, onRefresh }: { order: OrderRow; date: string; onRefresh: () => void; }) {
  const [open, setOpen] = useState(false);
  const log = order.log;
  const hasLog = !!log;
  const hasIssue = log && (log.dispatch_compliant === false || log.delivery_compliant === false);

  return (
    <>
      <div
        className={cn(
          "rounded-xl border p-3.5 flex items-center gap-3 cursor-pointer hover:bg-muted/20 transition-colors",
          hasIssue ? "border-red-300 bg-red-50/40" :
          hasLog   ? "border-emerald-300 bg-emerald-50/30" :
                     "border-border bg-background"
        )}
        onClick={() => setOpen(true)}
      >
        {/* Time column */}
        <div className="text-center min-w-[48px]">
          <p className="text-base font-bold text-[#256984] leading-none">{order.delivery_time ?? "—"}</p>
          {order.dispatch_time && (
            <p className="text-[10px] text-muted-foreground mt-0.5">→ {order.dispatch_time}</p>
          )}
        </div>

        {/* Client */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className="font-semibold text-sm text-foreground truncate">{order.client}</p>
            {order.is_wholesale && (
              <Badge className="bg-[#256984]/10 text-[#256984] border-[#256984]/20 text-[10px] py-0 h-4 shrink-0" variant="outline">
                Wholesale
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground">#{order.order_id}</p>
        </div>

        {/* Status */}
        <div className="shrink-0 flex flex-col items-end gap-1">
          {!hasLog ? (
            <Badge className="bg-muted text-muted-foreground border-border text-xs" variant="outline">Not logged</Badge>
          ) : (
            <>
              {log.driver && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <User size={10} />{log.driver}
                </span>
              )}
              {hasIssue
                ? <Badge className="bg-red-100 text-red-700 border-red-300 text-xs gap-1" variant="outline"><XCircle size={10} /> Issue</Badge>
                : <Badge className="bg-emerald-100 text-emerald-700 border-emerald-300 text-xs gap-1" variant="outline"><CheckCircle2 size={10} /> Logged</Badge>
              }
            </>
          )}
        </div>
      </div>

      {open && (
        <LogTempDialog order={order} date={date} open={open} onClose={() => setOpen(false)} onSaved={onRefresh} />
      )}
    </>
  );
}

// ─── History Tab ─────────────────────────────────────────────────────────────
function HistoryTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [from, setFrom] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10); });
  const [to, setTo] = useState(todayAWST);

  const { data, isLoading, refetch } = useQuery<{ ok: boolean; logs: DeliveryLogEntry[] }>({
    queryKey: ["/api/delivery-log/history", from, to],
    queryFn: () => apiRequest("GET", `/api/delivery-log/history?from=${from}&to=${to}`).then(r => r.json()),
    staleTime: 30000,
  });

  const del = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/delivery-log/${id}`).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/delivery-log/history"] }); toast({ title: "Entry deleted" }); },
  });

  const grouped = useMemo(() => {
    const map = new Map<string, DeliveryLogEntry[]>();
    for (const l of data?.logs ?? []) {
      if (!map.has(l.delivery_date)) map.set(l.delivery_date, []);
      map.get(l.delivery_date)!.push(l);
    }
    return map;
  }, [data?.logs]);

  function exportCSV() {
    const logs = data?.logs ?? [];
    if (!logs.length) return;
    const headers = ["Date","Time","Order #","Client","Driver","Hot Dispatch °C","Hot Delivery °C","Cold Dispatch °C","Cold Delivery °C","Compliant","Grey Boxes Balance","Grey Boxes Collected","Notes"];
    const rows = logs.map(l => [
      l.delivery_date, l.delivery_time ?? "", l.order_id, l.client, l.driver ?? "",
      l.hot_dispatch_temp ?? "", l.hot_delivery_temp ?? "",
      l.cold_dispatch_temp ?? "", l.cold_delivery_temp ?? "",
      l.dispatch_compliant == null ? "" : l.dispatch_compliant ? "Yes" : "No",
      l.grey_boxes_balance ?? "", l.grey_boxes_collected ?? "", l.notes ?? "",
    ]);
    const csv = [headers, ...rows].map(r => r.map(v => `"${v}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `delivery-temps-${from}-to-${to}.csv`;
    a.click();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1"><Label className="text-xs">From</Label><Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="w-36 text-sm" /></div>
        <div className="space-y-1"><Label className="text-xs">To</Label><Input type="date" value={to} onChange={e => setTo(e.target.value)} className="w-36 text-sm" /></div>
        <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => refetch()}><RefreshCw size={12} /> Apply</Button>
        <Button size="sm" variant="outline" className="gap-1.5 text-xs ml-auto" onClick={exportCSV} disabled={!data?.logs?.length}><Download size={12} /> Export CSV</Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}</div>
      ) : grouped.size === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground text-sm">No delivery records in this date range.</CardContent></Card>
      ) : (
        [...grouped.entries()].map(([date, logs]) => {
          const issues = logs.filter(l => l.dispatch_compliant === false || l.delivery_compliant === false);
          return (
            <Card key={date}>
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-sm font-semibold flex items-center justify-between">
                  <span>{fmtDate(date)}</span>
                  <div className="flex items-center gap-2">
                    {issues.length > 0 && <Badge className="bg-red-100 text-red-700 border-red-300 text-xs gap-1" variant="outline"><AlertTriangle size={10} /> {issues.length} issue{issues.length > 1 ? "s" : ""}</Badge>}
                    <span className="text-xs text-muted-foreground font-normal">{logs.length} deliveries</span>
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 overflow-x-auto">
                <table className="w-full text-xs min-w-[600px]">
                  <thead>
                    <tr className="border-b border-border">
                      {["Time","Client","Driver","Hot D°","Hot Arr°","Cold D°","Cold Arr°","Grey","OK",""].map(h => (
                        <th key={h} className="text-left py-1.5 font-medium text-muted-foreground pr-3">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map(l => (
                      <tr key={l.id} className="border-t border-border/40 hover:bg-muted/20">
                        <td className="py-2 pr-3 text-muted-foreground">{l.delivery_time ?? "—"}</td>
                        <td className="py-2 pr-3 font-medium text-foreground max-w-[140px] truncate">{l.client}</td>
                        <td className="py-2 pr-3 text-muted-foreground">{l.driver ?? "—"}</td>
                        <td className="py-2 pr-3 text-center">{l.hot_dispatch_temp != null ? <span className={cn("font-medium", l.hot_dispatch_temp >= 60 ? "text-emerald-700" : "text-red-600")}>{l.hot_dispatch_temp}°</span> : "—"}</td>
                        <td className="py-2 pr-3 text-center">{l.hot_delivery_temp != null ? <span className={cn("font-medium", l.hot_delivery_temp >= 60 ? "text-emerald-700" : "text-red-600")}>{l.hot_delivery_temp}°</span> : "—"}</td>
                        <td className="py-2 pr-3 text-center">{l.cold_dispatch_temp != null ? <span className={cn("font-medium", l.cold_dispatch_temp <= 5 ? "text-emerald-700" : "text-red-600")}>{l.cold_dispatch_temp}°</span> : "—"}</td>
                        <td className="py-2 pr-3 text-center">{l.cold_delivery_temp != null ? <span className={cn("font-medium", l.cold_delivery_temp <= 5 ? "text-emerald-700" : "text-red-600")}>{l.cold_delivery_temp}°</span> : "—"}</td>
                        <td className="py-2 pr-3 text-center text-muted-foreground">{l.grey_boxes_collected != null ? `${l.grey_boxes_collected}` : "—"}</td>
                        <td className="py-2 pr-3">{l.dispatch_compliant == null ? "—" : l.dispatch_compliant ? <CheckCircle2 size={13} className="text-emerald-500" /> : <XCircle size={13} className="text-red-500" />}</td>
                        <td className="py-2"><button onClick={() => del.mutate(l.id)} className="text-muted-foreground hover:text-red-500 transition-colors"><Trash2 size={12} /></button></td>
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
    queryFn: () => apiRequest("GET", `/api/delivery-log?date=${date}`).then(r => r.json()),
    staleTime: 30000,
  });

  const orders = data?.orders ?? [];
  const logged = orders.filter(o => o.log !== null).length;
  const issues = orders.filter(o => o.log && (o.log.dispatch_compliant === false || o.log.delivery_compliant === false)).length;

  function refresh() { qc.invalidateQueries({ queryKey: ["/api/delivery-log"] }); refetch(); }

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Truck size={20} className="text-[#256984]" /> Deliveries
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
              tab === key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Icon size={13} />{label}
          </button>
        ))}
      </div>

      {/* Today */}
      {tab === "today" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground">Date</Label>
              <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-36 text-sm" />
            </div>
            {!isLoading && orders.length > 0 && (
              <div className="flex items-center gap-2 ml-auto">
                <Badge className="bg-[#256984]/10 text-[#256984] border-[#256984]/30 text-xs" variant="outline">{logged}/{orders.length} logged</Badge>
                {issues > 0 && <Badge className="bg-red-100 text-red-700 border-red-300 text-xs gap-1" variant="outline"><AlertTriangle size={10} /> {issues} issue{issues > 1 ? "s" : ""}</Badge>}
              </div>
            )}
          </div>

          {isLoading ? (
            <div className="space-y-3">{[1,2,3,4,5].map(i => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}</div>
          ) : orders.length === 0 ? (
            <Card><CardContent className="py-12 text-center text-muted-foreground text-sm">No deliveries found for {fmtDate(date)}.</CardContent></Card>
          ) : (
            <div className="space-y-2">
              {orders.map(order => (
                <OrderCard key={order.order_id} order={order} date={date} onRefresh={refresh} />
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "history" && <HistoryTab />}
    </div>
  );
}
