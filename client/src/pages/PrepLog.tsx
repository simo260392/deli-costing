import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/SearchableSelect";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, ClipboardList, BarChart3 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Link } from "wouter";

type SubRecipe = { id: number; name: string; yieldUnit: string; };
type Recipe = { id: number; name: string; };
type StaffMember = { id: number; name: string; };
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

const UNITS = ["kg", "g", "L", "ml", "each", "portion", "batch", "serve", "dozen", "pack"];

function formatDate(iso: string) {
  const d = new Date(iso);
  // Format in local time
  return d.toLocaleString("en-AU", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: true,
  });
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

export default function PrepLog() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    itemType: "sub_recipe" as "sub_recipe" | "recipe",
    itemId: "",
    itemName: "",
    quantity: "",
    unit: "kg",
    staffId: "",
    staffName: "",
    notes: "",
  });

  // Today's log for quick view
  const { data: todayLogs = [] } = useQuery<PrepLogEntry[]>({
    queryKey: ["/api/prep-log", "today"],
    queryFn: () => apiRequest("GET", `/api/prep-log?dateFrom=${today()}&dateTo=${today()}`).then((r) => r.json()),
    refetchInterval: 15000,
  });

  const { data: subRecipes = [] } = useQuery<SubRecipe[]>({
    queryKey: ["/api/sub-recipes"],
    queryFn: () => apiRequest("GET", "/api/sub-recipes").then((r) => r.json()),
  });

  const { data: recipes = [] } = useQuery<Recipe[]>({
    queryKey: ["/api/recipes"],
    queryFn: () => apiRequest("GET", "/api/recipes").then((r) => r.json()),
  });

  const { data: rosterData } = useQuery({
    queryKey: ["/api/deputy/roster", today()],
    queryFn: () => apiRequest("GET", `/api/deputy/roster?date=${today()}`).then((r) => r.json()),
    staleTime: 120_000,
  });
  const staffOnShift: StaffMember[] = rosterData?.employees || [];

  const logMutation = useMutation({
    mutationFn: () => {
      const sr = form.itemType === "sub_recipe"
        ? subRecipes.find((s) => String(s.id) === form.itemId)
        : null;
      const rec = form.itemType === "recipe"
        ? recipes.find((r) => String(r.id) === form.itemId)
        : null;
      const name = sr?.name || rec?.name || form.itemName;
      return apiRequest("POST", "/api/prep-log", {
        itemType: form.itemType,
        itemId: form.itemId ? parseInt(form.itemId) : null,
        itemName: name,
        quantity: parseFloat(form.quantity),
        unit: form.unit,
        staffId: form.staffId ? parseInt(form.staffId) : null,
        staffName: form.staffName,
        notes: form.notes,
      }).then((r) => r.json());
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/prep-log"] });
      toast({ title: "Prep logged" });
      setOpen(false);
      resetForm();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/prep-log/${id}`).then((r) => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/prep-log"] });
      toast({ title: "Entry removed" });
    },
  });

  const resetForm = () => {
    setForm({ itemType: "sub_recipe", itemId: "", itemName: "", quantity: "", unit: "kg", staffId: "", staffName: "", notes: "" });
  };

  // When item type changes, clear item selection
  const setItemType = (t: "sub_recipe" | "recipe") => {
    setForm((f) => ({ ...f, itemType: t, itemId: "", itemName: "" }));
  };

  // When staff dropdown changes, auto-fill staffName
  const setStaff = (val: string) => {
    const [idStr, ...nameParts] = val.split(":");
    const name = nameParts.join(":");
    setForm((f) => ({ ...f, staffId: idStr, staffName: name }));
  };

  // Detect unit from selected item
  const selectedSR = form.itemType === "sub_recipe" ? subRecipes.find((s) => String(s.id) === form.itemId) : null;
  const autoUnit = selectedSR?.yieldUnit || form.unit;

  const canSubmit = form.quantity && parseFloat(form.quantity) > 0 && form.staffName && (form.itemId || form.itemName);

  // Group today's logs by staff
  const grouped = todayLogs.reduce((acc, entry) => {
    const key = entry.staff_name;
    if (!acc[key]) acc[key] = [];
    acc[key].push(entry);
    return acc;
  }, {} as Record<string, PrepLogEntry[]>);

  return (
    <div className="p-6 space-y-6 max-w-screen-lg">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <ClipboardList size={20} />
            Prep Log
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Record what staff have made during the shift.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/prep-reports">
            <Button variant="outline" size="sm">
              <BarChart3 size={14} className="mr-1.5" /> View Reports
            </Button>
          </Link>
          <Button size="sm" onClick={() => { resetForm(); setOpen(true); }}>
            <Plus size={14} className="mr-1.5" /> Log Prep
          </Button>
        </div>
      </div>

      {/* Today summary */}
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Today's Prep</h2>
        {todayLogs.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-8 text-center text-muted-foreground">
            <ClipboardList size={28} className="mx-auto mb-2 opacity-40" />
            <p className="text-sm">No prep logged today yet.</p>
            <Button size="sm" className="mt-3" onClick={() => { resetForm(); setOpen(true); }}>
              <Plus size={13} className="mr-1" /> Log First Entry
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {Object.entries(grouped).map(([staffName, entries]) => (
              <div key={staffName} className="rounded-lg border border-border overflow-hidden">
                <div className="px-4 py-2 bg-muted/50 flex items-center gap-2">
                  <span className="font-semibold text-sm">{staffName}</span>
                  <Badge variant="outline" className="text-xs">{entries.length} item{entries.length !== 1 ? "s" : ""}</Badge>
                </div>
                <div className="divide-y divide-border">
                  {entries.map((e) => (
                    <div key={e.id} className="flex items-center justify-between px-4 py-2.5 hover:bg-muted/20">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{e.item_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {e.quantity} {e.unit}
                          {e.item_type === "sub_recipe" && <span className="ml-1.5 text-primary">· sub-recipe</span>}
                          {e.item_type === "recipe" && <span className="ml-1.5 text-primary">· recipe</span>}
                          <span className="ml-2 opacity-60">{formatDate(e.logged_at)}</span>
                        </p>
                        {e.notes && <p className="text-xs text-muted-foreground italic mt-0.5">{e.notes}</p>}
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
            ))}
          </div>
        )}
      </div>

      {/* Log Prep Dialog */}
      <Dialog open={open} onOpenChange={(v) => { if (!v) resetForm(); setOpen(v); }}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Log Prep</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-1">

            {/* Item Type */}
            <div className="space-y-1.5">
              <Label>Type</Label>
              <div className="flex gap-2">
                <Button
                  size="sm" variant={form.itemType === "sub_recipe" ? "default" : "outline"}
                  className="flex-1" onClick={() => setItemType("sub_recipe")}
                >Sub-Recipe</Button>
                <Button
                  size="sm" variant={form.itemType === "recipe" ? "default" : "outline"}
                  className="flex-1" onClick={() => setItemType("recipe")}
                >Recipe</Button>
              </div>
            </div>

            {/* Item selector */}
            <div className="space-y-1.5">
              <Label>{form.itemType === "sub_recipe" ? "Sub-Recipe" : "Recipe"} *</Label>
              {form.itemType === "sub_recipe" ? (
                <SearchableSelect
                  value={form.itemId}
                  onValueChange={(v) => {
                    const sr = subRecipes.find((s) => String(s.id) === v);
                    setForm((f) => ({ ...f, itemId: v, unit: sr?.yieldUnit || f.unit }));
                  }}
                  placeholder="Search sub-recipes…"
                  options={(subRecipes ?? []).map((s) => ({ value: String(s.id), label: `${s.name} (${s.yieldUnit})` }))}
                />
              ) : (
                <SearchableSelect
                  value={form.itemId}
                  onValueChange={(v) => setForm((f) => ({ ...f, itemId: v }))}
                  placeholder="Search recipes…"
                  options={(recipes ?? []).map((r) => ({ value: String(r.id), label: r.name }))}
                />
              )}
            </div>

            {/* Quantity + Unit */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Quantity *</Label>
                <Input
                  type="text"
                  inputMode="decimal"
                  value={form.quantity}
                  onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))}
                  placeholder="e.g. 2.5"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Unit *</Label>
                <Select value={form.unit} onValueChange={(v) => setForm((f) => ({ ...f, unit: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {UNITS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Staff */}
            <div className="space-y-1.5">
              <Label>Staff Member *</Label>
              {staffOnShift.length > 0 ? (
                <Select
                  value={form.staffId ? `${form.staffId}:${form.staffName}` : ""}
                  onValueChange={setStaff}
                >
                  <SelectTrigger><SelectValue placeholder="Select staff on shift…" /></SelectTrigger>
                  <SelectContent>
                    {staffOnShift.map((s) => (
                      <SelectItem key={s.id} value={`${s.id}:${s.name}`}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  value={form.staffName}
                  onChange={(e) => setForm((f) => ({ ...f, staffName: e.target.value, staffId: "" }))}
                  placeholder="Enter staff name…"
                />
              )}
              {staffOnShift.length > 0 && (
                <p className="text-xs text-muted-foreground">Showing staff on shift from Deputy.</p>
              )}
            </div>

            {/* Notes */}
            <div className="space-y-1.5">
              <Label>Notes <span className="text-muted-foreground">(optional)</span></Label>
              <Input
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="e.g. extra batch for catering event"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { resetForm(); setOpen(false); }}>Cancel</Button>
            <Button
              onClick={() => logMutation.mutate()}
              disabled={!canSubmit || logMutation.isPending}
            >
              {logMutation.isPending ? "Saving…" : "Log Prep"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
