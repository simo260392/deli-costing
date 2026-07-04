import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Thermometer, Plus, Download, Trash2, RefreshCw, Building2, ChefHat, AlertTriangle, CheckCircle, Settings, Wifi, WifiOff, Activity } from "lucide-react";
import { StaffSearchPicker } from "@/components/StaffSearchPicker";

// ─── Constants ────────────────────────────────────────────────────────────────

const LOCATIONS = [
  { id: "osborne_park", label: "Osborne Park Production Kitchen", icon: ChefHat },
  { id: "cbd_store",    label: "CBD Store",                       icon: Building2 },
] as const;

type LocationId = typeof LOCATIONS[number]["id"];

const UNITS: Record<LocationId, string[]> = {
  osborne_park: ["Fridge 1", "Fridge 2", "Fridge 3", "Freezer 1", "Freezer 2", "Cool Room"],
  cbd_store:    ["Fridge 1", "Fridge 2", "Freezer 1", "Display Fridge"],
};

interface FridgeUnitSetting {
  id: string; location: string; unit_name: string;
  unit_type: string; min_temp: number; max_temp: number; active: boolean;
}

// Uses per-unit settings if available, falls back to sensible defaults
function tempStatus(unitName: string, temp: number, unitSettings?: FridgeUnitSetting): "ok" | "warning" | "danger" {
  if (unitSettings) {
    if (temp <= unitSettings.max_temp) return "ok";
    if (temp <= unitSettings.max_temp + 3) return "warning";
    return "danger";
  }
  // fallback defaults
  const isFreezer = unitName.toLowerCase().includes("freezer");
  if (isFreezer) { if (temp <= -15) return "ok"; if (temp <= -10) return "warning"; return "danger"; }
  if (temp <= 5) return "ok"; if (temp <= 8) return "warning"; return "danger";
}

const STATUS_STYLES = {
  ok:      "bg-green-100 text-green-800 border-green-200",
  warning: "bg-yellow-100 text-yellow-800 border-yellow-200",
  danger:  "bg-red-100 text-red-800 border-red-200",
};

const STATUS_LABELS = { ok: "OK", warning: "Borderline", danger: "Out of Range" };

// ─── Types ────────────────────────────────────────────────────────────────────

interface FridgeLog {
  id: string; log_date: string; log_time: string; location: string;
  unit_name: string; temperature: number; recorded_by: string;
  notes: string | null; source: string; created_at: string;
}

interface FridgeAlert {
  id: string; log_id: string; location: string; unit_name: string;
  temperature: number; max_temp: number; log_date: string; log_time: string;
  resolved: boolean; resolved_at: string | null; resolved_by: string | null;
  whatsapp_sent: boolean; created_at: string;
}

// ─── Add Log Dialog ───────────────────────────────────────────────────────────

function AddLogDialog({
  open, onClose, location, date,
}: {
  open: boolean; onClose: () => void; location: LocationId; date: string;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const units = UNITS[location];
  const nowTime = new Date(Date.now() + 8 * 60 * 60 * 1000)
    .toISOString().slice(11, 16);

  const [form, setForm] = useState({
    unit_name: units[0],
    temperature: "",
    recorded_by: "",
    log_time: nowTime,
    notes: "",
  });

  const mutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/fridge-logs", {
      log_date: date,
      log_time: form.log_time,
      location,
      unit_name: form.unit_name,
      temperature: parseFloat(form.temperature),
      recorded_by: form.recorded_by,
      notes: form.notes || null,
      source: "manual",
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fridge-logs", date, location] });
      toast({ title: "Temperature logged" });
      onClose();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const canSave = !!form.unit_name && form.temperature !== "" && !isNaN(parseFloat(form.temperature)) && !!form.recorded_by && !!form.log_time;

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-base flex items-center gap-2">
            <Thermometer size={16} className="text-[#256984]" />
            Log Temperature
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-1">
          {/* Unit */}
          <div className="space-y-1">
            <Label className="text-xs">Unit</Label>
            <Select value={form.unit_name} onValueChange={v => setForm(p => ({ ...p, unit_name: v }))}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {units.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* Temperature */}
          <div className="space-y-1">
            <Label className="text-xs">Temperature (°C) <span className="text-red-500">*</span></Label>
            <Input
              type="number"
              step="0.1"
              placeholder="e.g. 3.5"
              value={form.temperature}
              onChange={e => setForm(p => ({ ...p, temperature: e.target.value }))}
              className="h-9"
            />
            {form.temperature !== "" && !isNaN(parseFloat(form.temperature)) && (
              <p className={cn("text-xs font-medium mt-1", {
                "text-green-700": tempStatus(form.unit_name, parseFloat(form.temperature)) === "ok",
                "text-yellow-700": tempStatus(form.unit_name, parseFloat(form.temperature)) === "warning",
                "text-red-700":    tempStatus(form.unit_name, parseFloat(form.temperature)) === "danger",
              })}>
                {STATUS_LABELS[tempStatus(form.unit_name, parseFloat(form.temperature))]}
                {tempStatus(form.unit_name, parseFloat(form.temperature)) === "danger" && " — take corrective action"}
              </p>
            )}
          </div>

          {/* Time */}
          <div className="space-y-1">
            <Label className="text-xs">Time <span className="text-red-500">*</span></Label>
            <Input
              type="time"
              value={form.log_time}
              onChange={e => setForm(p => ({ ...p, log_time: e.target.value }))}
              className="h-9"
            />
          </div>

          {/* Recorded by */}
          <div className="space-y-1">
            <Label className="text-xs">Recorded by <span className="text-red-500">*</span></Label>
            <StaffSearchPicker
              value={form.recorded_by}
              onSelect={s => setForm(p => ({ ...p, recorded_by: s.displayName }))}
            />
          </div>

          {/* Notes */}
          <div className="space-y-1">
            <Label className="text-xs">Notes (optional)</Label>
            <Textarea
              placeholder="Corrective action taken, anomalies…"
              rows={2}
              value={form.notes}
              onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
              className="text-sm resize-none"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button
            size="sm"
            className="bg-[#256984] hover:bg-[#1e5570] text-white"
            disabled={!canSave || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? "Saving…" : "Save Reading"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── SensorPush Live Panel ──────────────────────────────────────────────────

type SensorReading = {
  id: string; name: string; location: string;
  temp_min: number; temp_max: number;
  latest_reading: { temperature: number; humidity: number; observed_at: string } | null;
  in_range: boolean | null;
};

function SensorLivePanel({ location }: { location: string }) {
  // Map FridgeLogs location ID to sensorpush location
  const spLocation = location === 'cbd_store' ? 'cbd' : 'osborne_park';

  const { data: sensors = [], isLoading, refetch, isRefetching, dataUpdatedAt } = useQuery<SensorReading[]>({
    queryKey: ['/api/sensorpush/latest', spLocation],
    queryFn: () => apiRequest('GET', `/api/sensorpush/latest?location=${spLocation}`).then(r => r.json()),
    refetchInterval: 5 * 60 * 1000, // refresh every 5 min client-side
    staleTime: 4 * 60 * 1000,
  });

  const outOfRange = sensors.filter(s => s.in_range === false);
  const noReading  = sensors.filter(s => s.in_range === null);
  const allOk      = sensors.length > 0 && outOfRange.length === 0 && noReading.length === 0;

  function formatObserved(iso: string) {
    return new Date(iso).toLocaleTimeString('en-AU', {
      hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Australia/Perth'
    });
  }

  function tempColour(s: SensorReading) {
    if (s.in_range === null) return 'text-gray-400';
    if (s.in_range) return 'text-green-600';
    const t = s.latest_reading!.temperature;
    // slightly over = amber, far over = red
    const margin = s.temp_max - s.temp_min;
    const diff = Math.abs(t > s.temp_max ? t - s.temp_max : s.temp_min - t);
    return diff > margin ? 'text-red-600' : 'text-amber-600';
  }

  if (isLoading) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex items-center gap-2 mb-3">
          <Activity size={15} className="text-[#256984]" />
          <span className="text-sm font-semibold text-[#256984]">Live Sensor Readings</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {[1,2,3,4,5,6].map(i => (
            <div key={i} className="h-16 rounded-lg bg-gray-100 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (sensors.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex items-center gap-2">
          <WifiOff size={15} className="text-gray-400" />
          <span className="text-sm text-gray-500">No sensor data available — polling every 2 hours</span>
        </div>
      </div>
    );
  }

  return (
    <div className={cn(
      "rounded-xl border p-4 space-y-3",
      outOfRange.length > 0 ? "border-red-200 bg-red-50" : "border-gray-200 bg-white"
    )}>
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Activity size={15} className="text-[#256984]" />
          <span className="text-sm font-semibold text-[#256984]">Live Sensor Readings</span>
          {allOk && (
            <Badge className="bg-green-100 text-green-700 border-green-200 text-xs px-2 py-0">
              <CheckCircle size={10} className="mr-1" /> All in range
            </Badge>
          )}
          {outOfRange.length > 0 && (
            <Badge className="bg-red-100 text-red-700 border-red-200 text-xs px-2 py-0">
              <AlertTriangle size={10} className="mr-1" /> {outOfRange.length} out of range
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {dataUpdatedAt > 0 && (
            <span className="text-xs text-gray-400">
              Updated {new Date(dataUpdatedAt).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Australia/Perth' })}
            </span>
          )}
          <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isRefetching} className="h-7 px-2">
            <RefreshCw size={12} className={cn(isRefetching && "animate-spin")} />
          </Button>
        </div>
      </div>

      {/* Sensor grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {sensors.map(s => (
          <div key={s.id} className={cn(
            "rounded-lg border p-3 space-y-0.5 transition-colors",
            s.in_range === false ? "border-red-200 bg-red-50" :
            s.in_range === null  ? "border-gray-100 bg-gray-50" :
            "border-green-100 bg-green-50"
          )}>
            <p className="text-[11px] font-medium text-gray-600 leading-tight truncate" title={s.name}>
              {/* Strip location suffix for cleaner display */}
              {s.name.replace(/ - (CBD|Osborne Park)$/i, '')}
            </p>
            {s.latest_reading ? (
              <>
                <p className={cn("text-xl font-bold tabular-nums leading-none", tempColour(s))}>
                  {s.latest_reading.temperature.toFixed(1)}°C
                </p>
                <div className="flex items-center justify-between">
                  <p className="text-[10px] text-gray-400">
                    {formatObserved(s.latest_reading.observed_at)}
                  </p>
                  <p className="text-[10px] text-gray-400">
                    {s.latest_reading.humidity?.toFixed(0)}% RH
                  </p>
                </div>
                <p className="text-[10px] text-gray-400">
                  Range: {s.temp_min}° to {s.temp_max}°C
                </p>
              </>
            ) : (
              <div className="flex items-center gap-1 mt-1">
                <WifiOff size={12} className="text-gray-300" />
                <span className="text-xs text-gray-400">No data yet</span>
              </div>
            )}
          </div>
        ))}
      </div>

      {outOfRange.length > 0 && (
        <div className="text-xs text-red-700 font-medium flex items-start gap-1.5">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          <span>
            {outOfRange.map(s => `${s.name.replace(/ - (CBD|Osborne Park)$/i, '')} (${s.latest_reading!.temperature.toFixed(1)}°C)`).join(', ')} {outOfRange.length === 1 ? 'is' : 'are'} out of range.
            {' '}A WhatsApp alert is sent outside business hours.
          </span>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function FridgeLogs() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const todayAWST = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const [location, setLocation] = useState<LocationId>("osborne_park");
  const [date, setDate]         = useState(todayAWST);
  const [addOpen, setAddOpen]   = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const locationInfo = LOCATIONS.find(l => l.id === location)!;

  // ── Fetch logs ──
  const { data, isLoading, isRefetching, refetch } = useQuery({
    queryKey: ["fridge-logs", date, location],
    queryFn: () => apiRequest("GET", `/api/fridge-logs?date=${date}&location=${location}`),
  });
  const logs: FridgeLog[] = (data as any)?.logs ?? [];

  // ── Fetch unit settings (for per-unit alert ranges) ──
  const { data: unitsData } = useQuery({
    queryKey: ["fridge-units", location],
    queryFn: () => apiRequest("GET", `/api/fridge-units?location=${location}`),
  });
  const unitSettings: FridgeUnitSetting[] = (unitsData as any)?.units ?? [];
  const unitMap = new Map<string, FridgeUnitSetting>(unitSettings.map(u => [u.unit_name, u]));

  // ── Fetch unresolved alerts for today ──
  const { data: alertsData, refetch: refetchAlerts } = useQuery({
    queryKey: ["fridge-alerts", date],
    queryFn: () => apiRequest("GET", `/api/fridge-alerts?resolved=false`),
    refetchInterval: 60000,
  });
  const allAlerts: FridgeAlert[] = (alertsData as any)?.alerts ?? [];
  const activeAlerts = allAlerts.filter(a => a.location === location && a.log_date === date);

  // ── Delete ──
  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/fridge-logs/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fridge-logs", date, location] });
      setDeleteId(null);
      toast({ title: "Reading deleted" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  // ── Resolve alert ──
  const resolveMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      apiRequest("PUT", `/api/fridge-alerts/${id}/resolve`, { resolved_by: name }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fridge-alerts"] });
      toast({ title: "Alert resolved" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  // ── Export CSV ──
  const handleExport = () => {
    const url = `/api/fridge-logs/export?date=${date}&location=${location}`;
    const a = document.createElement("a");
    a.href = url;
    a.download = `fridge-log-${date}-${location}.csv`;
    // Add auth header via fetch then create blob URL
    fetch(url, { headers: { Authorization: `Bearer ${localStorage.getItem("auth_token") || ""}` } })
      .then(r => r.blob())
      .then(blob => {
        const blobUrl = URL.createObjectURL(blob);
        a.href = blobUrl;
        a.click();
        URL.revokeObjectURL(blobUrl);
      })
      .catch(() => {
        window.open(url, "_blank");
      });
  };

  // ── Summary stats ──
  const stats = useMemo(() => {
    const outOfRange = logs.filter(l => tempStatus(l.unit_name, l.temperature) === "danger").length;
    const borderline = logs.filter(l => tempStatus(l.unit_name, l.temperature) === "warning").length;
    return { total: logs.length, outOfRange, borderline };
  }, [logs]);

  // ── Group by unit ──
  const byUnit = useMemo(() => {
    const map = new Map<string, FridgeLog[]>();
    for (const l of logs) {
      const arr = map.get(l.unit_name) || [];
      arr.push(l);
      map.set(l.unit_name, arr);
    }
    return map;
  }, [logs]);

  return (
    <div className="p-4 max-w-4xl mx-auto space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Thermometer size={20} className="text-[#256984]" />
          <h1 className="text-lg font-semibold text-[#256984]">Fridge Logs</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isRefetching}
          >
            <RefreshCw size={13} className={cn("mr-1", isRefetching && "animate-spin")} />
            Refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
            disabled={logs.length === 0}
          >
            <Download size={13} className="mr-1" />
            Export CSV
          </Button>
          <Button
            size="sm"
            className="bg-[#256984] hover:bg-[#1e5570] text-white"
            onClick={() => setAddOpen(true)}
          >
            <Plus size={13} className="mr-1" />
            Log Reading
          </Button>
          <Button variant="ghost" size="sm" onClick={() => window.location.href = "/compliance/fridge-settings"} className="text-gray-400 hover:text-[#256984]">
            <Settings size={14} />
          </Button>
        </div>
      </div>

      {/* Location toggle */}
      <div className="flex gap-2">
        {LOCATIONS.map(loc => {
          const Icon = loc.icon;
          const active = location === loc.id;
          return (
            <button
              key={loc.id}
              onClick={() => setLocation(loc.id)}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium transition-all",
                active
                  ? "bg-[#256984] text-white border-[#256984] shadow-sm"
                  : "bg-white text-gray-600 border-gray-200 hover:border-[#256984] hover:text-[#256984]"
              )}
            >
              <Icon size={14} />
              {loc.label}
            </button>
          );
        })}
      </div>

      {/* SensorPush live readings */}
      <SensorLivePanel location={location} />

      {/* Date + summary bar */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <Label className="text-xs text-gray-500 whitespace-nowrap">Date</Label>
          <Input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            className="h-8 text-sm w-40"
          />
        </div>
        {!isLoading && logs.length > 0 && (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-gray-500">{stats.total} reading{stats.total !== 1 ? "s" : ""}</span>
            {stats.outOfRange > 0 && (
              <Badge className="bg-red-100 text-red-700 border-red-200 text-xs px-2 py-0">
                {stats.outOfRange} out of range
              </Badge>
            )}
            {stats.borderline > 0 && (
              <Badge className="bg-yellow-100 text-yellow-700 border-yellow-200 text-xs px-2 py-0">
                {stats.borderline} borderline
              </Badge>
            )}
            {stats.outOfRange === 0 && stats.borderline === 0 && (
              <Badge className="bg-green-100 text-green-700 border-green-200 text-xs px-2 py-0">
                All OK
              </Badge>
            )}
          </div>
        )}
      </div>

      {/* Active alerts banner */}
      {activeAlerts.length > 0 && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 space-y-2">
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle size={15} className="text-red-600" />
            <span className="font-semibold text-red-700 text-sm">
              {activeAlerts.length} unresolved temperature alert{activeAlerts.length !== 1 ? "s" : ""}
            </span>
          </div>
          {activeAlerts.map(alert => (
            <div key={alert.id} className="flex items-center justify-between bg-white rounded-lg border border-red-100 px-3 py-2">
              <div className="flex items-center gap-3">
                <Thermometer size={14} className="text-red-500" />
                <div>
                  <span className="font-semibold text-sm text-gray-800">{alert.unit_name}</span>
                  <span className="text-red-600 font-bold text-sm ml-2">{alert.temperature > 0 ? "+" : ""}{alert.temperature}°C</span>
                  <span className="text-gray-400 text-xs ml-2">(max {alert.max_temp}°C)</span>
                  <span className="text-gray-400 text-xs ml-2">at {alert.log_time}</span>
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs border-green-300 text-green-700 hover:bg-green-50"
                onClick={() => resolveMutation.mutate({ id: alert.id, name: "Manager" })}
                disabled={resolveMutation.isPending}
              >
                <CheckCircle size={11} className="mr-1" /> Resolve
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Content */}
      {isLoading ? (
        <div className="text-center py-12 text-gray-400 text-sm">Loading…</div>
      ) : logs.length === 0 ? (
        <div className="text-center py-16 border-2 border-dashed border-gray-200 rounded-xl">
          <Thermometer size={32} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500 text-sm font-medium">No readings for {date}</p>
          <p className="text-gray-400 text-xs mt-1">Tap "Log Reading" to add the first entry</p>
        </div>
      ) : (
        <div className="space-y-4">
          {UNITS[location].filter(u => byUnit.has(u)).map(unitName => {
            const unitLogs = byUnit.get(unitName)!;
            const latestTemp = unitLogs[unitLogs.length - 1].temperature;
            const latestStatus = tempStatus(unitName, latestTemp, unitMap.get(unitName));
            return (
              <div key={unitName} className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
                {/* Unit header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50">
                  <div className="flex items-center gap-2">
                    <Thermometer size={15} className="text-[#256984]" />
                    <span className="font-semibold text-sm text-gray-800">{unitName}</span>
                    <Badge className={cn("text-xs px-2 py-0 border", STATUS_STYLES[latestStatus])}>
                      {STATUS_LABELS[latestStatus]}
                    </Badge>
                  </div>
                  <span className="text-xs text-gray-400">{unitLogs.length} reading{unitLogs.length !== 1 ? "s" : ""}</span>
                </div>

                {/* Readings table */}
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-400 border-b border-gray-100">
                      <th className="text-left px-4 py-2 font-medium">Time</th>
                      <th className="text-left px-4 py-2 font-medium">Temp</th>
                      <th className="text-left px-4 py-2 font-medium">Status</th>
                      <th className="text-left px-4 py-2 font-medium">Recorded By</th>
                      <th className="text-left px-4 py-2 font-medium">Source</th>
                      <th className="text-left px-4 py-2 font-medium">Notes</th>
                      <th className="px-4 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {unitLogs.map((log, idx) => {
                      const status = tempStatus(log.unit_name, log.temperature, unitMap.get(log.unit_name));
                      return (
                        <tr
                          key={log.id}
                          className={cn(
                            "border-b border-gray-50 last:border-0",
                            idx % 2 === 0 ? "bg-white" : "bg-gray-50/40"
                          )}
                        >
                          <td className="px-4 py-2.5 font-mono text-xs text-gray-700">{log.log_time}</td>
                          <td className="px-4 py-2.5">
                            <span className={cn(
                              "font-semibold text-sm",
                              status === "ok"      ? "text-green-700" :
                              status === "warning" ? "text-yellow-700" : "text-red-700"
                            )}>
                              {log.temperature > 0 ? "+" : ""}{log.temperature}°C
                            </span>
                          </td>
                          <td className="px-4 py-2.5">
                            <Badge className={cn("text-xs px-2 py-0 border", STATUS_STYLES[status])}>
                              {STATUS_LABELS[status]}
                            </Badge>
                          </td>
                          <td className="px-4 py-2.5 text-xs text-gray-600">{log.recorded_by}</td>
                          <td className="px-4 py-2.5">
                            <Badge variant="outline" className="text-xs px-2 py-0 capitalize text-gray-500">
                              {log.source}
                            </Badge>
                          </td>
                          <td className="px-4 py-2.5 text-xs text-gray-500 max-w-[180px] truncate">
                            {log.notes || <span className="text-gray-300">—</span>}
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <button
                              onClick={() => setDeleteId(log.id)}
                              className="text-gray-300 hover:text-red-500 transition-colors"
                            >
                              <Trash2 size={13} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      )}

      {/* Add dialog */}
      <AddLogDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        location={location}
        date={date}
      />

      {/* Delete confirm */}
      <AlertDialog open={!!deleteId} onOpenChange={v => { if (!v) setDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this reading?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the temperature reading. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={() => deleteId && deleteMutation.mutate(deleteId)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
