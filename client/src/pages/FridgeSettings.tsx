import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Settings, Thermometer, Clock, Plus, Pencil, Trash2, Check, X, Building2, ChefHat, Snowflake, RefreshCw } from "lucide-react";

// ─── Constants ────────────────────────────────────────────────────────────────

const LOCATIONS = [
  { id: "osborne_park", label: "Osborne Park Production Kitchen", icon: ChefHat },
  { id: "cbd_store",    label: "CBD Store",                       icon: Building2 },
] as const;
type LocationId = typeof LOCATIONS[number]["id"];

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// ─── Types ────────────────────────────────────────────────────────────────────

interface FridgeUnit {
  id: string;
  location: string;
  unit_name: string;
  unit_type: "fridge" | "freezer";
  min_temp: number;
  max_temp: number;
  active: boolean;
  sort_order: number;
}

interface LocationHours {
  id: string;
  location: string;
  day_of_week: number;
  open_time: string | null;
  close_time: string | null;
  closed: boolean;
}

// ─── Unit Row (inline edit) ───────────────────────────────────────────────────

function UnitRow({ unit, onDelete }: { unit: FridgeUnit; onDelete: (id: string) => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    unit_name: unit.unit_name,
    unit_type: unit.unit_type,
    max_temp: String(unit.max_temp),
    active: unit.active,
  });

  const mutation = useMutation({
    mutationFn: () => apiRequest("PUT", `/api/fridge-units/${unit.id}`, {
      unit_name: form.unit_name,
      unit_type: form.unit_type,
      max_temp: parseFloat(form.max_temp),
      active: form.active,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fridge-units"] });
      setEditing(false);
      toast({ title: "Unit updated" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  if (editing) {
    return (
      <tr className="bg-blue-50/40 border-b border-blue-100">
        <td className="px-4 py-2">
          <Input
            value={form.unit_name}
            onChange={e => setForm(p => ({ ...p, unit_name: e.target.value }))}
            className="h-8 text-sm w-36"
          />
        </td>
        <td className="px-4 py-2">
          <Select value={form.unit_type} onValueChange={v => setForm(p => ({ ...p, unit_type: v as any }))}>
            <SelectTrigger className="h-8 text-sm w-28"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="fridge">Fridge</SelectItem>
              <SelectItem value="freezer">Freezer</SelectItem>
            </SelectContent>
          </Select>
        </td>
        <td className="px-4 py-2">
          <div className="flex items-center gap-1">
            <Input
              type="number"
              step="0.5"
              value={form.max_temp}
              onChange={e => setForm(p => ({ ...p, max_temp: e.target.value }))}
              className="h-8 text-sm w-20"
            />
            <span className="text-xs text-gray-400">°C max</span>
          </div>
        </td>
        <td className="px-4 py-2">
          <Switch checked={form.active} onCheckedChange={v => setForm(p => ({ ...p, active: v }))} />
        </td>
        <td className="px-4 py-2">
          <div className="flex items-center gap-1">
            <Button size="icon" variant="ghost" className="h-7 w-7 text-green-600" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
              <Check size={13} />
            </Button>
            <Button size="icon" variant="ghost" className="h-7 w-7 text-gray-400" onClick={() => setEditing(false)}>
              <X size={13} />
            </Button>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr className="border-b border-gray-50 hover:bg-gray-50/50">
      <td className="px-4 py-2.5 text-sm font-medium text-gray-800 flex items-center gap-2">
        {unit.unit_type === "freezer"
          ? <Snowflake size={13} className="text-blue-400" />
          : <Thermometer size={13} className="text-[#256984]" />}
        {unit.unit_name}
      </td>
      <td className="px-4 py-2.5">
        <Badge variant="outline" className="text-xs capitalize">{unit.unit_type}</Badge>
      </td>
      <td className="px-4 py-2.5 text-sm text-gray-600">
        Max <span className="font-semibold">{unit.max_temp}°C</span>
      </td>
      <td className="px-4 py-2.5">
        <Badge className={cn("text-xs", unit.active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500")}>
          {unit.active ? "Active" : "Inactive"}
        </Badge>
      </td>
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-1">
          <Button size="icon" variant="ghost" className="h-7 w-7 text-gray-400 hover:text-[#256984]" onClick={() => setEditing(true)}>
            <Pencil size={12} />
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7 text-gray-300 hover:text-red-500" onClick={() => onDelete(unit.id)}>
            <Trash2 size={12} />
          </Button>
        </div>
      </td>
    </tr>
  );
}

// ─── Hours Row (inline edit) ──────────────────────────────────────────────────

function HoursRow({ row }: { row: LocationHours }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    open_time: row.open_time || "06:00",
    close_time: row.close_time || "18:00",
    closed: row.closed,
  });

  const mutation = useMutation({
    mutationFn: () => apiRequest("PUT", `/api/fridge-location-hours/${row.id}`, form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fridge-hours"] });
      setEditing(false);
      toast({ title: "Hours updated" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <tr className={cn("border-b border-gray-50", editing && "bg-blue-50/40")}>
      <td className="px-4 py-2.5 text-sm font-medium text-gray-700 w-32">{DAYS[row.day_of_week]}</td>
      {editing ? (
        <>
          <td className="px-4 py-2 flex items-center gap-2">
            <Switch checked={!form.closed} onCheckedChange={v => setForm(p => ({ ...p, closed: !v }))} />
            <span className="text-xs text-gray-500">{form.closed ? "Closed" : "Open"}</span>
          </td>
          <td className="px-4 py-2">
            {!form.closed && (
              <div className="flex items-center gap-2">
                <Input type="time" value={form.open_time} onChange={e => setForm(p => ({ ...p, open_time: e.target.value }))} className="h-8 text-sm w-28" />
                <span className="text-xs text-gray-400">to</span>
                <Input type="time" value={form.close_time} onChange={e => setForm(p => ({ ...p, close_time: e.target.value }))} className="h-8 text-sm w-28" />
              </div>
            )}
          </td>
          <td className="px-4 py-2">
            <div className="flex items-center gap-1">
              <Button size="icon" variant="ghost" className="h-7 w-7 text-green-600" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
                <Check size={13} />
              </Button>
              <Button size="icon" variant="ghost" className="h-7 w-7 text-gray-400" onClick={() => setEditing(false)}>
                <X size={13} />
              </Button>
            </div>
          </td>
        </>
      ) : (
        <>
          <td className="px-4 py-2.5">
            <Badge className={cn("text-xs", row.closed ? "bg-gray-100 text-gray-500" : "bg-green-100 text-green-700")}>
              {row.closed ? "Closed" : "Open"}
            </Badge>
          </td>
          <td className="px-4 py-2.5 text-sm text-gray-600">
            {row.closed ? "—" : `${row.open_time} – ${row.close_time}`}
          </td>
          <td className="px-4 py-2.5">
            <Button size="icon" variant="ghost" className="h-7 w-7 text-gray-400 hover:text-[#256984]" onClick={() => setEditing(true)}>
              <Pencil size={12} />
            </Button>
          </td>
        </>
      )}
    </tr>
  );
}

// ─── Add Unit Dialog ──────────────────────────────────────────────────────────

function AddUnitForm({ location, onDone }: { location: LocationId; onDone: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState({ unit_name: "", unit_type: "fridge", max_temp: "5" });

  const mutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/fridge-units", {
      location,
      unit_name: form.unit_name,
      unit_type: form.unit_type,
      max_temp: parseFloat(form.max_temp),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fridge-units"] });
      toast({ title: "Unit added" });
      onDone();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <tr className="bg-green-50/40 border-b border-green-100">
      <td className="px-4 py-2">
        <Input placeholder="Unit name" value={form.unit_name} onChange={e => setForm(p => ({ ...p, unit_name: e.target.value }))} className="h-8 text-sm w-36" />
      </td>
      <td className="px-4 py-2">
        <Select value={form.unit_type} onValueChange={v => setForm(p => ({ ...p, unit_type: v }))}>
          <SelectTrigger className="h-8 text-sm w-28"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="fridge">Fridge</SelectItem>
            <SelectItem value="freezer">Freezer</SelectItem>
          </SelectContent>
        </Select>
      </td>
      <td className="px-4 py-2">
        <div className="flex items-center gap-1">
          <Input type="number" step="0.5" value={form.max_temp} onChange={e => setForm(p => ({ ...p, max_temp: e.target.value }))} className="h-8 text-sm w-20" />
          <span className="text-xs text-gray-400">°C max</span>
        </div>
      </td>
      <td className="px-4 py-2" />
      <td className="px-4 py-2">
        <div className="flex items-center gap-1">
          <Button size="icon" variant="ghost" className="h-7 w-7 text-green-600" onClick={() => mutation.mutate()} disabled={!form.unit_name || mutation.isPending}>
            <Check size={13} />
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7 text-gray-400" onClick={onDone}><X size={13} /></Button>
        </div>
      </td>
    </tr>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function FridgeSettings() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [location, setLocation] = useState<LocationId>("osborne_park");
  const [addingUnit, setAddingUnit] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data: unitsData, isLoading: unitsLoading } = useQuery({
    queryKey: ["fridge-units", location],
    queryFn: () => apiRequest("GET", `/api/fridge-units?location=${location}`),
  });
  const units: FridgeUnit[] = (unitsData as any)?.units ?? [];

  const { data: hoursData, isLoading: hoursLoading } = useQuery({
    queryKey: ["fridge-hours", location],
    queryFn: () => apiRequest("GET", `/api/fridge-location-hours?location=${location}`),
  });
  const hours: LocationHours[] = (hoursData as any)?.hours ?? [];

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/fridge-units/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fridge-units"] });
      setDeleteId(null);
      toast({ title: "Unit removed" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const locInfo = LOCATIONS.find(l => l.id === location)!;
  const LocIcon = locInfo.icon;

  return (
    <div className="p-4 max-w-3xl mx-auto space-y-6">

      {/* Header */}
      <div className="flex items-center gap-2">
        <Settings size={20} className="text-[#256984]" />
        <h1 className="text-lg font-semibold text-[#256984]">Fridge Settings</h1>
      </div>

      {/* Location toggle */}
      <div className="flex gap-2">
        {LOCATIONS.map(loc => {
          const Icon = loc.icon;
          const active = location === loc.id;
          return (
            <button key={loc.id} onClick={() => { setLocation(loc.id); setAddingUnit(false); }}
              className={cn("flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium transition-all",
                active ? "bg-[#256984] text-white border-[#256984] shadow-sm" : "bg-white text-gray-600 border-gray-200 hover:border-[#256984] hover:text-[#256984]")}>
              <Icon size={14} />{loc.label}
            </button>
          );
        })}
      </div>

      {/* Units section */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50">
          <div className="flex items-center gap-2">
            <Thermometer size={15} className="text-[#256984]" />
            <span className="font-semibold text-sm text-gray-800">Units & Alert Ranges</span>
          </div>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setAddingUnit(true)} disabled={addingUnit}>
            <Plus size={12} className="mr-1" /> Add Unit
          </Button>
        </div>
        {unitsLoading ? (
          <div className="py-8 text-center text-gray-400 text-sm">Loading…</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-400 border-b border-gray-100">
                <th className="text-left px-4 py-2 font-medium">Unit</th>
                <th className="text-left px-4 py-2 font-medium">Type</th>
                <th className="text-left px-4 py-2 font-medium">Alert Threshold</th>
                <th className="text-left px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {addingUnit && (
                <AddUnitForm location={location} onDone={() => setAddingUnit(false)} />
              )}
              {units.map(u => (
                <UnitRow key={u.id} unit={u} onDelete={setDeleteId} />
              ))}
              {units.length === 0 && !addingUnit && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400 text-sm">No units configured</td></tr>
              )}
            </tbody>
          </table>
        )}
        <div className="px-4 py-2.5 bg-gray-50 border-t border-gray-100">
          <p className="text-xs text-gray-400">An alert fires immediately when a reading exceeds the max temperature. WhatsApp is sent if the alert is unresolved after-hours.</p>
        </div>
      </div>

      {/* Hours section */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 bg-gray-50">
          <Clock size={15} className="text-[#256984]" />
          <span className="font-semibold text-sm text-gray-800">Business Hours</span>
          <span className="text-xs text-gray-400 ml-1">— alerts outside these hours trigger WhatsApp</span>
        </div>
        {hoursLoading ? (
          <div className="py-8 text-center text-gray-400 text-sm">Loading…</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-400 border-b border-gray-100">
                <th className="text-left px-4 py-2 font-medium w-32">Day</th>
                <th className="text-left px-4 py-2 font-medium">Status</th>
                <th className="text-left px-4 py-2 font-medium">Hours</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {hours.map(h => <HoursRow key={h.id} row={h} />)}
            </tbody>
          </table>
        )}
      </div>

      {/* Delete confirm */}
      <AlertDialog open={!!deleteId} onOpenChange={v => { if (!v) setDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this unit?</AlertDialogTitle>
            <AlertDialogDescription>This will permanently remove the unit and its alert settings. Temperature logs are not affected.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700 text-white" onClick={() => deleteId && deleteMutation.mutate(deleteId)}>
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
