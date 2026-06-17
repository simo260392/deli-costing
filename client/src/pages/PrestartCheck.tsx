import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { StaffSearchPicker } from "@/components/StaffSearchPicker";
import {
  Truck, CheckCircle2, XCircle, Camera, AlertTriangle,
  ChevronDown, ChevronUp, Trash2, Plus, Thermometer,
} from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

const VEHICLES = ["Ford Transit", "Holden Combo", "Toyota Hiace", "Mitsubishi Express"];

const TODAY = (() => {
  const d = new Date();
  return d.toISOString().slice(0, 10);
})();

interface PrestartCheck {
  id: string;
  check_date: string;
  check_time: string;
  driver_name: string;
  vehicle: string;
  fit_to_drive: boolean;
  fit_to_drive_note: string | null;
  seatbelts_ok: boolean;
  lights_mirrors_ok: boolean;
  tyres_ok: boolean;
  existing_damage: string | null;
  fridge_at_temp: boolean | null;
  fridge_temp: string | null;
  cockpit_photo_url: string | null;
  storage_photo_url: string | null;
  created_at: string;
}

// ─── Yes/No Toggle ────────────────────────────────────────────────────────────
function YesNo({
  label, value, onChange, description,
}: {
  label: string; value: boolean; onChange: (v: boolean) => void; description?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5 border-b border-border/50 last:border-0">
      <div>
        <p className="text-sm font-medium">{label}</p>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      <div className="flex gap-1.5 shrink-0">
        <button
          onClick={() => onChange(true)}
          className={cn(
            "px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors border",
            value
              ? "bg-emerald-500 text-white border-emerald-500"
              : "bg-muted text-muted-foreground border-border hover:border-emerald-400"
          )}
        >
          Yes
        </button>
        <button
          onClick={() => onChange(false)}
          className={cn(
            "px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors border",
            !value
              ? "bg-red-500 text-white border-red-500"
              : "bg-muted text-muted-foreground border-border hover:border-red-400"
          )}
        >
          No
        </button>
      </div>
    </div>
  );
}

// ─── Camera Upload Button ─────────────────────────────────────────────────────
function CameraUpload({
  label, url, onUpload, uploading,
}: {
  label: string; url: string | null; onUpload: (file: File) => void; uploading: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) onUpload(f); }}
      />
      {url ? (
        <div className="relative rounded-xl overflow-hidden border border-border">
          <img src={url} alt={label} className="w-full h-40 object-cover" />
          <button
            className="absolute top-2 right-2 bg-black/60 hover:bg-black/80 text-white rounded-full p-1.5 transition-colors"
            onClick={() => inputRef.current?.click()}
          >
            <Camera size={14} />
          </button>
        </div>
      ) : (
        <button
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="w-full h-32 rounded-xl border-2 border-dashed border-border hover:border-[#256984] bg-muted/30 hover:bg-[#256984]/5 transition-colors flex flex-col items-center justify-center gap-2 text-muted-foreground hover:text-[#256984]"
        >
          {uploading ? (
            <div className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin" />
          ) : (
            <>
              <Camera size={22} />
              <span className="text-xs font-medium">Take photo</span>
            </>
          )}
        </button>
      )}
    </div>
  );
}

// ─── Check Card (history view) ────────────────────────────────────────────────
function CheckCard({ check, onDelete }: { check: PrestartCheck; onDelete: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const allOk = check.fit_to_drive && check.seatbelts_ok && check.lights_mirrors_ok && check.tyres_ok
    && (check.fridge_at_temp !== false);

  return (
    <div className={cn(
      "rounded-xl border p-4 space-y-3 transition-colors",
      allOk ? "border-emerald-200 bg-emerald-50/30" : "border-red-200 bg-red-50/30"
    )}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          {allOk
            ? <CheckCircle2 size={16} className="text-emerald-500 shrink-0 mt-0.5" />
            : <AlertTriangle size={16} className="text-red-500 shrink-0 mt-0.5" />
          }
          <div>
            <p className="text-sm font-semibold">{check.driver_name}</p>
            <p className="text-xs text-muted-foreground">{check.vehicle} · {check.check_time}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={() => setExpanded(v => !v)}
            className="p-1.5 rounded-lg hover:bg-muted/60 text-muted-foreground transition-colors"
          >
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <button className="p-1.5 rounded-lg hover:bg-red-50 text-muted-foreground hover:text-red-500 transition-colors">
                <Trash2 size={14} />
              </button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete pre-start check?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently delete the pre-start check for {check.driver_name} — {check.vehicle} on {check.check_date}.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-red-500 hover:bg-red-600"
                  onClick={onDelete}
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {/* Quick badges */}
      <div className="flex flex-wrap gap-1.5">
        {[
          { label: "Fit to drive", ok: check.fit_to_drive },
          { label: "Seatbelts", ok: check.seatbelts_ok },
          { label: "Lights/mirrors", ok: check.lights_mirrors_ok },
          { label: "Tyres", ok: check.tyres_ok },
          ...(check.fridge_at_temp !== null ? [{ label: "Fridge temp", ok: check.fridge_at_temp }] : []),
        ].map(item => (
          <Badge
            key={item.label}
            variant="outline"
            className={cn(
              "text-xs",
              item.ok
                ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                : "border-red-300 bg-red-50 text-red-700"
            )}
          >
            {item.ok ? "✓" : "✗"} {item.label}
          </Badge>
        ))}
        {check.fridge_temp && (
          <Badge variant="outline" className="text-xs border-blue-200 bg-blue-50 text-blue-700">
            <Thermometer size={10} className="mr-1" />{check.fridge_temp}°C
          </Badge>
        )}
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="space-y-3 pt-1 border-t border-border/40">
          {check.fit_to_drive_note && (
            <p className="text-xs text-muted-foreground"><span className="font-medium">Fit to drive note:</span> {check.fit_to_drive_note}</p>
          )}
          {check.existing_damage && (
            <p className="text-xs text-muted-foreground"><span className="font-medium">Existing damage:</span> {check.existing_damage}</p>
          )}
          {(check.cockpit_photo_url || check.storage_photo_url) && (
            <div className="grid grid-cols-2 gap-2">
              {check.cockpit_photo_url && (
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground font-medium">Cockpit</p>
                  <img src={check.cockpit_photo_url} alt="Cockpit" className="w-full h-28 object-cover rounded-lg border" />
                </div>
              )}
              {check.storage_photo_url && (
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground font-medium">Storage area</p>
                  <img src={check.storage_photo_url} alt="Storage" className="w-full h-28 object-cover rounded-lg border" />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function PrestartCheck() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [date, setDate] = useState(TODAY);
  const [showForm, setShowForm] = useState(false);

  // Form state
  const [driverName, setDriverName] = useState("");
  const [vehicle, setVehicle] = useState("");
  const [fitToDrive, setFitToDrive] = useState(true);
  const [fitNote, setFitNote] = useState("");
  const [seatbelts, setSeatbelts] = useState(true);
  const [lightsMirrors, setLightsMirrors] = useState(true);
  const [tyres, setTyres] = useState(true);
  const [damage, setDamage] = useState("");
  const [fridgeAtTemp, setFridgeAtTemp] = useState(true);
  const [fridgeTemp, setFridgeTemp] = useState("");
  const [cockpitUrl, setCockpitUrl] = useState<string | null>(null);
  const [storageUrl, setStorageUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState<"cockpit" | "storage" | null>(null);

  const { data, isLoading } = useQuery<{ ok: boolean; checks: PrestartCheck[] }>({
    queryKey: ["/api/prestart-checks", date],
    queryFn: () => apiRequest("GET", `/api/prestart-checks?date=${date}`).then(r => r.json()),
    staleTime: 30 * 1000,
  });

  const checks = data?.checks ?? [];

  async function uploadPhoto(file: File, slot: "cockpit" | "storage") {
    setUploading(slot);
    try {
      const fd = new FormData();
      fd.append("photo", file);
      const res = await fetch("/api/upload-photo", {
        method: "POST",
        headers: { Authorization: "Bearer d8ecc189f96774038e36112c5ed9f2bc557c3320" },
        body: fd,
      });
      const data = await res.json();
      if (data.url) {
        if (slot === "cockpit") setCockpitUrl(data.url);
        else setStorageUrl(data.url);
      }
    } catch {
      toast({ title: "Photo upload failed", variant: "destructive" });
    } finally {
      setUploading(null);
    }
  }

  const submit = useMutation({
    mutationFn: () => apiRequest("POST", "/api/prestart-checks", {
      check_date: date,
      check_time: new Date().toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Australia/Perth" }),
      driver_name: driverName,
      vehicle,
      fit_to_drive: fitToDrive,
      fit_to_drive_note: fitNote || null,
      seatbelts_ok: seatbelts,
      lights_mirrors_ok: lightsMirrors,
      tyres_ok: tyres,
      existing_damage: damage || null,
      fridge_at_temp: fridgeAtTemp,
      fridge_temp: fridgeTemp || null,
      cockpit_photo_url: cockpitUrl,
      storage_photo_url: storageUrl,
    }).then(r => r.json()),
    onSuccess: (data) => {
      if (data.error) { toast({ title: "Error", description: data.error, variant: "destructive" }); return; }
      toast({ title: "Pre-start check submitted" });
      qc.invalidateQueries({ queryKey: ["/api/prestart-checks", date] });
      // Reset form
      setDriverName(""); setVehicle(""); setFitToDrive(true); setFitNote("");
      setSeatbelts(true); setLightsMirrors(true); setTyres(true); setDamage("");
      setFridgeAtTemp(true); setFridgeTemp(""); setCockpitUrl(null); setStorageUrl(null);
      setShowForm(false);
    },
    onError: () => toast({ title: "Failed to submit", variant: "destructive" }),
  });

  const deleteCheck = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/prestart-checks/${id}`).then(r => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/prestart-checks", date] });
      toast({ title: "Check deleted" });
    },
  });

  const canSubmit = !!driverName && !!vehicle && !submit.isPending;
  const hasIssues = !fitToDrive || !seatbelts || !lightsMirrors || !tyres || !fridgeAtTemp;

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Truck size={20} className="text-[#256984]" />
            Pre-Start Vehicle Check
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">Complete before each delivery run</p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            className="h-9 w-40 text-sm"
          />
          {!showForm && (
            <Button
              size="sm"
              className="gap-1.5 text-xs bg-[#256984] hover:bg-[#1e5570] text-white"
              onClick={() => setShowForm(true)}
            >
              <Plus size={13} /> New Check
            </Button>
          )}
        </div>
      </div>

      {/* Form */}
      {showForm && (
        <div className="rounded-xl border border-[#256984]/30 bg-[#256984]/5 p-5 space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[#256984]">New Pre-Start Check</h2>
            <button
              onClick={() => setShowForm(false)}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
          </div>

          {/* Driver + Vehicle */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Driver <span className="text-red-500">*</span></Label>
              <StaffSearchPicker
                value={driverName}
                onSelect={s => setDriverName(s.name)}
                placeholder="Search driver…"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Vehicle <span className="text-red-500">*</span></Label>
              <div className="grid grid-cols-2 gap-1.5">
                {VEHICLES.map(v => (
                  <button
                    key={v}
                    onClick={() => setVehicle(v)}
                    className={cn(
                      "px-2.5 py-2 rounded-lg text-xs font-medium border transition-colors text-left",
                      vehicle === v
                        ? "bg-[#256984] text-white border-[#256984]"
                        : "bg-background border-border hover:border-[#256984]/50 text-foreground"
                    )}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Checklist */}
          <div className="rounded-xl border border-border bg-background p-4 space-y-0">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Fitness & Vehicle</p>
            <YesNo
              label="Fit to drive?"
              description="No fatigue, illness or medication affecting driving"
              value={fitToDrive}
              onChange={setFitToDrive}
            />
            {!fitToDrive && (
              <div className="py-2">
                <Input
                  placeholder="Note reason…"
                  value={fitNote}
                  onChange={e => setFitNote(e.target.value)}
                  className="text-sm"
                />
              </div>
            )}
            <YesNo label="Seatbelts functional?" value={seatbelts} onChange={setSeatbelts} />
            <YesNo label="Lights and mirrors OK?" value={lightsMirrors} onChange={setLightsMirrors} />
            <YesNo label="Tyres OK?" description="No visible damage, adequate pressure" value={tyres} onChange={setTyres} />
          </div>

          {/* Existing damage */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Existing damage (optional)</Label>
            <Input
              placeholder="Describe any pre-existing damage…"
              value={damage}
              onChange={e => setDamage(e.target.value)}
              className="text-sm"
            />
          </div>

          {/* Fridge check */}
          <div className="rounded-xl border border-border bg-background p-4 space-y-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Cold Storage</p>
            <YesNo
              label="Fridge/cold area at temp before loading?"
              description="Must be ≤5°C"
              value={fridgeAtTemp}
              onChange={setFridgeAtTemp}
            />
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Fridge temp reading (optional)</Label>
              <Input
                type="number"
                placeholder="e.g. 3"
                value={fridgeTemp}
                onChange={e => setFridgeTemp(e.target.value)}
                className="text-sm w-32"
              />
            </div>
          </div>

          {/* Photos */}
          <div className="grid grid-cols-2 gap-3">
            <CameraUpload
              label="Cockpit photo"
              url={cockpitUrl}
              onUpload={f => uploadPhoto(f, "cockpit")}
              uploading={uploading === "cockpit"}
            />
            <CameraUpload
              label="Storage area photo"
              url={storageUrl}
              onUpload={f => uploadPhoto(f, "storage")}
              uploading={uploading === "storage"}
            />
          </div>

          {/* Issue warning */}
          {hasIssues && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3">
              <AlertTriangle size={15} className="text-amber-500 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-800">
                One or more checks have failed. This will be recorded and flagged for review.
              </p>
            </div>
          )}

          {/* Submit */}
          <Button
            className="w-full bg-[#256984] hover:bg-[#1e5570] text-white"
            disabled={!canSubmit}
            onClick={() => submit.mutate()}
          >
            {submit.isPending ? "Submitting…" : "Submit Pre-Start Check"}
          </Button>
        </div>
      )}

      {/* History */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Checks for {new Date(date + "T12:00:00").toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" })}
        </h2>

        {isLoading ? (
          <div className="space-y-3">
            {[1, 2].map(i => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}
          </div>
        ) : checks.length === 0 ? (
          <div className="rounded-xl border border-border bg-muted/20 py-10 text-center text-sm text-muted-foreground">
            No pre-start checks recorded for this date.
          </div>
        ) : (
          <div className="space-y-3">
            {checks.map(c => (
              <CheckCard
                key={c.id}
                check={c}
                onDelete={() => deleteCheck.mutate(c.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
