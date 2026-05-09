import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/SearchableSelect";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, Pencil, Trash2, BookOpen, RefreshCw } from "lucide-react";
import { PhotoUpload } from "@/components/PhotoUpload";

// ─── Dietary / Allergen display (read-only, computed from ingredients) ────────
const DIETARY_LABELS: Record<string, { label: string; color: string; text: string }> = {
  V:   { label: "Vegetarian",         color: "#4CAF50", text: "#fff" },
  VG:  { label: "Vegan",              color: "#2E7D32", text: "#fff" },
  GF:  { label: "Gluten Free",        color: "#8D6E63", text: "#fff" },
  DF:  { label: "Dairy Free",         color: "#90CAF9", text: "#1a1a1a" },
  EF:  { label: "Egg Free",           color: "#FDD835", text: "#1a1a1a" },
  LF:  { label: "Lactose Free",       color: "#CE93D8", text: "#fff" },
  NF:  { label: "Nut Free",           color: "#A1887F", text: "#fff" },
  H:   { label: "Halal",              color: "#009688", text: "#fff" },
  KO:  { label: "Keto",               color: "#FF7043", text: "#fff" },
  PS:  { label: "Pescatarian",        color: "#29B6F6", text: "#fff" },
  K:   { label: "Kosher",             color: "#C8A45B", text: "#fff" },
  P:   { label: "Paleo",              color: "#8BC34A", text: "#fff" },
  HP:  { label: "High Protein",       color: "#1565C0", text: "#fff" },
  LC:  { label: "Low Carb",           color: "#26C6DA", text: "#1a1a1a" },
  RF:  { label: "Refined Sugar Free", color: "#AB47BC", text: "#fff" },
  CG:  { label: "Contains Gluten",    color: "#8D6E63", text: "#fff" },
  CD:  { label: "Contains Dairy",     color: "#90CAF9", text: "#1a1a1a" },
  CE:  { label: "Contains Eggs",      color: "#FDD835", text: "#1a1a1a" },
  CN:  { label: "Contains Nuts",      color: "#A1887F", text: "#fff" },
  CS:  { label: "Contains Seafood",   color: "#42A5F5", text: "#fff" },
  CX:  { label: "Contains Seeds",     color: "#FFD54F", text: "#1a1a1a" },
  CY:  { label: "Contains Soya",      color: "#AED581", text: "#1a1a1a" },
  CU:  { label: "Contains Sulphites", color: "#78909C", text: "#fff" },
};

function DietaryBadge({ code }: { code: string }) {
  const info = DIETARY_LABELS[code];
  if (!info) return null;
  return (
    <span
      className="text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap"
      style={{ backgroundColor: info.color, color: info.text }}
    >
      {info.label}
    </span>
  );
}

const ALLERGEN_CODES = new Set(["CN","CD","CE","CS","CG","CX","CY","CU"]);

function SubRecipeDietaries({ id }: { id: number }) {
  const { data, isLoading } = useQuery<{ allergens: string[]; dietaries: string[] }>({
    queryKey: ["/api/sub-recipes", id, "dietaries"],
    queryFn: () => apiRequest("GET", `/api/sub-recipes/${id}/dietaries`).then((r) => r.json()),
    staleTime: 60_000,
  });
  if (isLoading) return <p className="text-xs text-muted-foreground">Loading…</p>;
  if (!data) return null;
  const allergens = data.allergens.filter((c) => ALLERGEN_CODES.has(c));
  const dietaries = data.dietaries.filter((c) => !ALLERGEN_CODES.has(c));
  if (allergens.length === 0 && dietaries.length === 0) return <p className="text-xs text-muted-foreground italic">No allergens identified</p>;
  return (
    <div className="space-y-1.5">
      {dietaries.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {dietaries.map((c) => <DietaryBadge key={c} code={c} />)}
        </div>
      )}
      {allergens.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {allergens.map((c) => <DietaryBadge key={c} code={c} />)}
        </div>
      )}
    </div>
  );
}

type Ingredient = { id: number; name: string; category: string; unit: string; bestCostPerUnit: number; avgWeightPerUnit?: number | null; };
type SubRecipe = {
  id: number; name: string; category: string; description?: string; yieldAmount: number; yieldUnit: string;
  ingredientsJson: string; subRecipesJson: string; totalCost: number; costPerUnit: number;
  photoUrl?: string | null;
  calculatedServingSize?: number | null;
};

const SR_CATEGORIES = ["Sauce", "Dressing", "Bread Product", "Pastry", "Marinade", "Spice Mix", "Stock / Broth", "Filling", "Base", "General", "Other"];

// Combined selector entry — either a real ingredient or a nested sub-recipe
type CombinedItem = {
  _kind: "ingredient" | "subrecipe";
  id: number;
  name: string;
  unit: string;
  costPerUnit: number;
};

type Line = {
  _kind: "ingredient" | "subrecipe";
  ingredientId?: number;
  subRecipeId?: number;
  quantity: number;
  _qtyStr: string;
  _key: string;
};

const UNITS = ["kg", "g", "L", "ml", "each", "pack", "dozen", "bunch", "slice", "sheet", "portion", "serve"];

export default function SubRecipes() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<SubRecipe | null>(null);
  const [form, setForm] = useState({ name: "", category: "General", description: "", yieldAmount: "1", yieldUnit: "each", photoUrl: "", labourMinutes: "0" });
  const [lines, setLines] = useState<Line[]>([]);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [convertTarget, setConvertTarget] = useState("");
  const [convertConfirm, setConvertConfirm] = useState(false);

  const { data: subRecipes = [], isLoading } = useQuery<SubRecipe[]>({
    queryKey: ["/api/sub-recipes"],
    queryFn: () => apiRequest("GET", "/api/sub-recipes").then((r) => r.json()),
  });

  const { data: ingredients = [] } = useQuery<Ingredient[]>({
    queryKey: ["/api/ingredients"],
    queryFn: () => apiRequest("GET", "/api/ingredients").then((r) => r.json()),
  });

  const { data: settingsData = {} as any } = useQuery({
    queryKey: ["/api/settings"],
    queryFn: () => apiRequest("GET", "/api/settings").then((r) => r.json()),
  });
  const hourlyRate = parseFloat(settingsData.labour_rate_per_hour || "35");

  // Build combined list — non-packaging ingredients first (sorted), then other sub-recipes (sorted), excluding the one being edited
  const combinedItems = (currentId?: number): CombinedItem[] => [
    ...ingredients.filter((i) => i.category !== "Packaging").sort((a, b) => a.name.localeCompare(b.name)).map((i) => ({ _kind: "ingredient" as const, id: i.id, name: i.name, unit: i.unit, costPerUnit: i.bestCostPerUnit })),
    ...subRecipes
      .filter((s) => s.id !== currentId) // can't nest a sub-recipe into itself
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((s) => ({ _kind: "subrecipe" as const, id: s.id, name: `${s.name} (sub-recipe)`, unit: s.yieldUnit, costPerUnit: s.costPerUnit })),
  ];

  const getItem = (line: Line, items: CombinedItem[]): CombinedItem | undefined => {
    if (line._kind === "subrecipe") return items.find((c) => c._kind === "subrecipe" && c.id === line.subRecipeId);
    return items.find((c) => c._kind === "ingredient" && c.id === line.ingredientId);
  };

  const lineSelectValue = (line: Line) =>
    line._kind === "subrecipe" ? `sr-${line.subRecipeId}` : `ing-${line.ingredientId}`;

  const upsert = useMutation({
    mutationFn: () => {
      const ingLines = lines.filter((l) => l._kind === "ingredient").map(({ ingredientId, quantity }) => ({ ingredientId, quantity }));
      const srLines = lines.filter((l) => l._kind === "subrecipe").map(({ subRecipeId, quantity }) => ({ subRecipeId, quantity }));
      const payload = {
        ...form,
        yieldAmount: parseFloat(form.yieldAmount) || 1,
        labourMinutes: parseFloat(form.labourMinutes) || 0,
        ingredientsJson: JSON.stringify(ingLines),
        subRecipesJson: JSON.stringify(srLines),
      };
      const fullPayload = { ...payload, photoUrl: form.photoUrl || null };
      return editing
        ? apiRequest("PUT", `/api/sub-recipes/${editing.id}`, fullPayload).then((r) => r.json())
        : apiRequest("POST", "/api/sub-recipes", fullPayload).then((r) => r.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sub-recipes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recipes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/platters"] });
      setOpen(false); resetForm();
      toast({ title: editing ? "Sub-recipe updated" : "Sub-recipe added" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const del = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/sub-recipes/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/sub-recipes"] }); toast({ title: "Sub-recipe removed" }); },
  });

  const convert = useMutation({
    mutationFn: (toType: string) =>
      apiRequest("POST", "/api/convert", { fromType: "sub-recipe", fromId: editing!.id, toType }).then((r) => r.json()),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/ingredients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sub-recipes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recipes"] });
      setOpen(false); resetForm(); setConvertTarget(""); setConvertConfirm(false);
      toast({ title: `Converted to ${convertTarget}`, description: data.name });
    },
    onError: (e: any) => toast({ title: "Conversion failed", description: e.message, variant: "destructive" }),
  });

  const resetForm = () => {
    setEditing(null); setLines([]);
    setForm({ name: "", category: "General", description: "", yieldAmount: "1", yieldUnit: "each", photoUrl: "", labourMinutes: "0" });
  };

  const openEdit = (sr: SubRecipe) => {
    setEditing(sr);
    setForm({ name: sr.name, category: sr.category || "General", description: sr.description || "", yieldAmount: String(sr.yieldAmount), yieldUnit: sr.yieldUnit, photoUrl: sr.photoUrl || "", labourMinutes: String((sr as any).labourMinutes ?? 0) });

    const ingLines: Line[] = (JSON.parse(sr.ingredientsJson || "[]") as any[]).map((l, i) => ({
      _kind: "ingredient",
      ingredientId: l.ingredientId,
      quantity: l.quantity,
      _qtyStr: String(l.quantity),
      _key: `ing-${i}-${Date.now()}`,
    }));
    const srLines: Line[] = (JSON.parse(sr.subRecipesJson || "[]") as any[]).map((l, i) => ({
      _kind: "subrecipe",
      subRecipeId: l.subRecipeId,
      quantity: l.quantity,
      _qtyStr: String(l.quantity),
      _key: `sr-${i}-${Date.now()}`,
    }));
    setLines([...ingLines, ...srLines]);
    setOpen(true);
  };

  const addLine = (items: CombinedItem[]) => {
    if (items.length === 0) { toast({ title: "No ingredients yet" }); return; }
    const first = items[0];
    const newLine: Line = first._kind === "subrecipe"
      ? { _kind: "subrecipe", subRecipeId: first.id, quantity: 0, _qtyStr: "", _key: `new-${Date.now()}` }
      : { _kind: "ingredient", ingredientId: first.id, quantity: 0, _qtyStr: "", _key: `new-${Date.now()}` };
    setLines((prev) => [...prev, newLine]);
  };

  const updateLineSelect = (key: string, value: string) => {
    const [kind, idStr] = value.split("-");
    const id = parseInt(idStr);
    setLines((prev) => prev.map((l) => l._key !== key ? l : kind === "sr"
      ? { ...l, _kind: "subrecipe", subRecipeId: id, ingredientId: undefined }
      : { ...l, _kind: "ingredient", ingredientId: id, subRecipeId: undefined }
    ));
  };

  const updateLineQty = (key: string, raw: string) => {
    const qty = parseFloat(raw);
    setLines((prev) => prev.map((l) => l._key === key ? { ...l, _qtyStr: raw, quantity: isNaN(qty) ? 0 : qty } : l));
  };

  const items = combinedItems(editing?.id);
  const previewIngredientCost = lines.reduce((sum, l) => {
    // For "each" ingredients: quantity is now a count → cost = count × bestCostPerUnit
    if (l._kind === "ingredient" && l.ingredientId) {
      const rawIng = ingredients.find((i: Ingredient) => i.id === l.ingredientId);
      if (rawIng && rawIng.unit === "each") {
        return sum + l.quantity * rawIng.bestCostPerUnit;
      }
    }
    const item = getItem(l, items);
    return sum + (item?.costPerUnit || 0) * l.quantity;
  }, 0);
  const previewLabourCost = ((parseFloat(form.labourMinutes) || 0) / 60) * hourlyRate;
  const previewCost = previewIngredientCost + previewLabourCost;
  const previewCpu = (parseFloat(form.yieldAmount) || 1) > 0 ? previewCost / (parseFloat(form.yieldAmount) || 1) : 0;

  const filtered = subRecipes.filter((sr) =>
    sr.name.toLowerCase().includes(search.toLowerCase()) &&
    (categoryFilter === "All" || sr.category === categoryFilter)
  );

  return (
    <div className="p-6 space-y-5 max-w-screen-lg">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Sub-Recipes</h1>
          <p className="text-sm text-muted-foreground mt-1">Reusable base preparations — batters, spice mixes, sauces.</p>
        </div>
        <Button onClick={() => { resetForm(); setOpen(true); }} size="sm" data-testid="button-add-subrecipe">
          <Plus size={15} className="mr-1" /> New Sub-Recipe
        </Button>
      </div>

      <div className="flex gap-2 flex-wrap items-center">
        <Input placeholder="Search sub-recipes…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-44 h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="All">All Categories</SelectItem>
            {SR_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="grid md:grid-cols-2 gap-4">{[1,2,3].map((i) => <div key={i} className="skeleton h-32 rounded-lg" />)}</div>
      ) : subRecipes.length === 0 ? (
        <Card className="p-10 text-center">
          <BookOpen size={36} className="mx-auto mb-3 text-muted-foreground" />
          <p className="font-medium">No sub-recipes yet</p>
          <p className="text-sm text-muted-foreground mt-1">Create batters, spice mixes, or sauces to use inside your main recipes.</p>
          <Button onClick={() => setOpen(true)} className="mt-4" size="sm"><Plus size={14} className="mr-1" /> New Sub-Recipe</Button>
        </Card>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((sr) => {
            const ingCount = (JSON.parse(sr.ingredientsJson || "[]") as any[]).length;
            const srCount = (JSON.parse(sr.subRecipesJson || "[]") as any[]).length;
            const totalLines = ingCount + srCount;
            return (
              <Card key={sr.id} data-testid={`card-subrecipe-${sr.id}`}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <CardTitle className="text-sm font-semibold">{sr.name}</CardTitle>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(sr)}><Pencil size={13} /></Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => del.mutate(sr.id)}><Trash2 size={13} /></Button>
                    </div>
                  </div>
                  <Badge variant="outline" className="text-xs w-fit">{sr.category || "General"}</Badge>
                  {sr.description && <p className="text-xs text-muted-foreground mt-1">{sr.description}</p>}
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex gap-2 flex-wrap">
                    <Badge variant="outline" className="text-xs">Yield: {sr.yieldAmount} {sr.yieldUnit}</Badge>
                    <Badge className="text-xs bg-primary/10 text-primary border-0">Cost: ${sr.totalCost.toFixed(2)}</Badge>
                    <Badge className="text-xs bg-primary/10 text-primary border-0">${sr.costPerUnit.toFixed(4)}/{sr.yieldUnit}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {totalLines} item{totalLines !== 1 ? "s" : ""}
                    {srCount > 0 && <span className="ml-1 text-primary">· {srCount} sub-recipe{srCount !== 1 ? "s" : ""}</span>}
                  </p>
                  <div className="border-t border-border/50 pt-2">
                    <p className="text-xs font-medium text-muted-foreground mb-1">Dietaries &amp; Allergens</p>
                    <SubRecipeDietaries id={sr.id} />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={open} onOpenChange={(v) => { if (!v) resetForm(); setOpen(v); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Sub-Recipe" : "New Sub-Recipe"}</DialogTitle>
            {editing && (
              <div className="flex gap-2 mt-2">
                <Button variant="outline" size="sm" className="text-xs" onClick={() => convert.mutate("recipe")}>
                  Convert to Recipe
                </Button>
                <Button variant="outline" size="sm" className="text-xs" onClick={() => convert.mutate("ingredient")}>
                  Convert to Ingredient
                </Button>
              </div>
            )}
          </DialogHeader>
          <div className="space-y-5 py-2">
            {/* Name — full width */}
            <div className="space-y-1.5">
              <Label>Name *</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Schnitzel Crumb Mix" data-testid="input-subrecipe-name" />
            </div>
            {/* 2-col: left = Category + Description, right = Photo */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label>Category</Label>
                  <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{SR_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Description</Label>
                  <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Method or notes…" rows={4} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Dish Photo</Label>
                <PhotoUpload square value={form.photoUrl || null} onChange={(url) => setForm({ ...form, photoUrl: url || "" })} />
              </div>
            </div>
            {/* Yield + Staff Hours */}
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label>Yield Amount</Label>
                <Input type="text" inputMode="decimal" value={form.yieldAmount} onChange={(e) => setForm({ ...form, yieldAmount: e.target.value })} placeholder="1" />
              </div>
              <div className="space-y-1.5">
                <Label>Yield Unit</Label>
                <Select value={form.yieldUnit} onValueChange={(v) => setForm({ ...form, yieldUnit: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{UNITS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Staff Time (min)</Label>
                <Input
                  type="text"
                  inputMode="decimal"
                  value={form.labourMinutes}
                  onChange={(e) => setForm({ ...form, labourMinutes: e.target.value })}
                  placeholder="0"
                />
                {previewLabourCost > 0 && (
                  <p className="text-xs text-muted-foreground">= ${previewLabourCost.toFixed(2)} labour</p>
                )}
              </div>
            </div>

            {/* Serving size display */}
            {editing?.calculatedServingSize != null && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-md border border-input bg-muted/40 text-sm">
                <span className="text-muted-foreground">Serving size (per yield unit):</span>
                <span className="font-medium">{Math.round(editing.calculatedServingSize)}g</span>
                <span className="text-xs text-muted-foreground">(total weight ÷ {form.yieldAmount || 1} yield)</span>
              </div>
            )}

            {/* Combined ingredients + nested sub-recipes */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Ingredients & Sub-Recipes</Label>
                <Button variant="outline" size="sm" onClick={() => addLine(items)} className="h-7 text-xs" data-testid="button-add-subrecipe-line">
                  <Plus size={12} className="mr-1" /> Add
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Add raw ingredients or other sub-recipes — sub-recipes are shown with "(sub-recipe)".
              </p>
              {lines.length === 0 ? (
                <p className="text-xs text-muted-foreground py-4 text-center">No ingredients added yet.</p>
              ) : (
                <div className="space-y-2">
                  {lines.map((line) => {
                    const selected = getItem(line, items);
                    const rawIng = line._kind === "ingredient" && line.ingredientId ? ingredients.find((i: Ingredient) => i.id === line.ingredientId) : null;
                    const isEach = rawIng && rawIng.unit === "each";
                    const lineCost = isEach
                      ? line.quantity * rawIng!.bestCostPerUnit
                      : (selected?.costPerUnit || 0) * line.quantity;
                    return (
                      <div key={line._key} className="space-y-0.5">
                        <div className="flex gap-2 items-center">
                          <div className="flex-1">
                            <SearchableSelect
                              value={lineSelectValue(line)}
                              onValueChange={(v) => updateLineSelect(line._key, v)}
                              placeholder="Search ingredient or sub-recipe…"
                              className="h-8 text-sm"
                              options={[
                                ...ingredients.filter((i) => i.category !== "Packaging").map((i) => ({ value: `ing-${i.id}`, label: `${i.name} (${i.unit})`, group: "Ingredients" })),
                                ...subRecipes.filter((s) => s.id !== editing?.id).map((s) => ({ value: `sr-${s.id}`, label: `${s.name} (${s.yieldUnit})`, group: "Sub-Recipes" })),
                              ]}
                            />
                          </div>
                          <div className="w-28 shrink-0">
                            <Input
                              type="text"
                              inputMode="decimal"
                              className="h-8 text-sm"
                              value={line._qtyStr}
                              placeholder={isEach ? "Qty (each)" : "Qty"}
                              onChange={(e) => updateLineQty(line._key, e.target.value)}
                            />
                          </div>
                          <div className="w-20 text-right shrink-0">
                            <p className="text-xs text-muted-foreground mb-1">{isEach ? "each" : (selected?.unit || "")}</p>
                            <p className="text-sm font-medium tabular-nums">${lineCost.toFixed(2)}</p>
                          </div>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive shrink-0"
                            onClick={() => setLines((prev) => prev.filter((l) => l._key !== line._key))}><Trash2 size={13} /></Button>
                        </div>
                        {isEach && rawIng?.avgWeightPerUnit && (
                          <p className="text-xs text-muted-foreground pl-0.5">
                            1 {rawIng!.name} ≈ {rawIng!.avgWeightPerUnit!}g — enter whole number count
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Cost preview */}
            <div className="bg-muted/40 rounded-lg p-3 space-y-1.5">
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium">Estimated Cost</span>
                <div className="text-right">
                  <p className="font-bold text-primary tabular-nums">${previewCost.toFixed(2)} total</p>
                  <p className="text-xs text-muted-foreground tabular-nums">${previewCpu.toFixed(4)} / {form.yieldUnit}</p>
                </div>
              </div>
              {previewLabourCost > 0 && (
                <div className="flex justify-between text-xs text-muted-foreground border-t border-border/50 pt-1.5">
                  <span>Ingredients</span><span className="tabular-nums">${previewIngredientCost.toFixed(2)}</span>
                </div>
              )}
              {previewLabourCost > 0 && (
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Labour ({form.labourMinutes} min @ ${hourlyRate}/hr)</span><span className="tabular-nums">${previewLabourCost.toFixed(2)}</span>
                </div>
              )}
            </div>
          </div>
          {editing && (
            <div className="border-t border-border pt-4">
              <p className="text-xs font-semibold text-muted-foreground mb-2">Convert to another type</p>
              {!convertConfirm ? (
                <div className="flex gap-2 items-center flex-wrap">
                  <Select value={convertTarget} onValueChange={setConvertTarget}>
                    <SelectTrigger className="w-40 h-8 text-xs"><SelectValue placeholder="Convert to…" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ingredient">Ingredient</SelectItem>
                      <SelectItem value="recipe">Recipe</SelectItem>
                    </SelectContent>
                  </Select>
                  {convertTarget && (
                    <Button size="sm" variant="outline" className="h-8 text-xs border-amber-400 text-amber-700 hover:bg-amber-50"
                      onClick={() => setConvertConfirm(true)}>
                      <RefreshCw size={12} className="mr-1" /> Convert
                    </Button>
                  )}
                </div>
              ) : (
                <div className="flex gap-2 items-center flex-wrap">
                  <p className="text-xs text-amber-700">Convert "{editing.name}" to {convertTarget}? This will delete the sub-recipe.</p>
                  <Button size="sm" variant="destructive" className="h-7 text-xs" onClick={() => convert.mutate(convertTarget)} disabled={convert.isPending}>
                    {convert.isPending ? "Converting…" : "Confirm"}
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setConvertConfirm(false); setConvertTarget(""); }}>Cancel</Button>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { resetForm(); setOpen(false); setConvertTarget(""); setConvertConfirm(false); }}>Cancel</Button>
            <Button onClick={() => upsert.mutate()} disabled={!form.name || upsert.isPending} data-testid="button-save-subrecipe">
              {upsert.isPending ? "Saving…" : editing ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
