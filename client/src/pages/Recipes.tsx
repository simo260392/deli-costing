import { useQuery, useMutation } from "@tanstack/react-query";
import { useState, useRef } from "react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/SearchableSelect";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Plus, Pencil, Trash2, UtensilsCrossed, AlertTriangle, CheckCircle, RefreshCw, Download, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
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

function RecipeDietaries({ id }: { id: number }) {
  const { data, isLoading } = useQuery<{ allergens: string[]; dietaries: string[] }>({
    queryKey: ["/api/recipes", id, "dietaries"],
    queryFn: () => apiRequest("GET", `/api/recipes/${id}/dietaries`).then((r) => r.json()),
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
        <div className="flex flex-wrap gap-1.5">
          {dietaries.map((c) => <DietaryBadge key={c} code={c} />)}
        </div>
      )}
      {allergens.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {allergens.map((c) => <DietaryBadge key={c} code={c} />)}
        </div>
      )}
    </div>
  );
}

type Ingredient = { id: number; name: string; category: string; unit: string; bestCostPerUnit: number; avgWeightPerUnit?: number | null; };
type SubRecipe = { id: number; name: string; yieldUnit: string; costPerUnit: number; };
type Recipe = {
  id: number; name: string; category: string; description?: string; portionSize?: string;
  portionCount: number;
  servingSize?: string | null; servingsPerPackage?: number | null;
  calculatedServingSize?: number | null;
  ingredientsJson: string; subRecipesJson: string; packagingJson: string;
  ingredientCost: number; subRecipeCost: number; packagingCost: number;
  labourMinutes: number; labourCost: number; totalCost: number;
  costPerServe: number;
  foodCostPerServe: number;
  photoUrl?: string | null;
  rrp: number | null; wholesaleRrp: number | null;
  targetRrp: number; wholesaleTargetRrp: number;
  marginPercent: number; wholesaleMarginPercent: number;
  isActive: boolean;
};

type CombinedIngredient = { _kind: "ingredient" | "subrecipe" | "recipe"; id: number; name: string; unit: string; costPerUnit: number; };
type IngLine = { ingredientId?: number; subRecipeId?: number; recipeId?: number; _isSubRecipe: boolean; _isRecipe: boolean; quantity: number; _qtyStr: string; _key: string; };
type PkgLine = { ingredientId: number; quantity: number; _qtyStr: string; _key: string; };

const CATEGORIES = ["Sandwich", "Salad", "Breakfast Sandwich", "Breakfast Pot", "Baked Goods / Dessert", "Drink", "Coffee", "Hot Food", "Sub-Recipe", "Other"];

function fmt(n: number | null | undefined) { return n != null ? `$${n.toFixed(2)}` : "—"; }
function pct(n: number | null | undefined) { return n != null ? `${n.toFixed(1)}%` : "—"; }

function CostBreakdown({ recipe, targetFoodCost }: { recipe: Recipe; targetFoodCost: number }) {
  if (!recipe.rrp) return <span className="text-xs text-muted-foreground">Set RRP to see margin</span>;
  // Food cost % uses ingredients+packaging only (no labour)
  const foodCostPerServe = recipe.foodCostPerServe ?? (recipe.costPerServe ?? recipe.totalCost);
  const fc = (foodCostPerServe / recipe.rrp) * 100;
  const ok = fc <= targetFoodCost;
  return (
    <div className="flex items-center gap-2">
      <Badge className={cn("text-xs", ok ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400" : "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400")}>
        {ok ? <CheckCircle size={10} className="mr-1" /> : <AlertTriangle size={10} className="mr-1" />}
        {fc.toFixed(1)}% FC
      </Badge>
      <span className={cn("text-sm font-medium tabular-nums", (recipe.marginPercent || 0) >= 50 ? "success-text" : (recipe.marginPercent || 0) >= 30 ? "warning-text" : "error-text")}>
        {pct(recipe.marginPercent)} margin
      </span>
    </div>
  );
}

export default function Recipes() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Recipe | null>(null);
  const [form, setForm] = useState({ name: "", category: "Sandwich", description: "", portionSize: "", portionCount: "1", servingSize: "", servingsPerPackage: "", labourMinutes: "0", rrp: "", wholesaleRrp: "", photoUrl: "" });
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [ingLines, setIngLines] = useState<IngLine[]>([]);
  const [pkgLines, setPkgLines] = useState<PkgLine[]>([]);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("ingredients");
  const [convertTarget, setConvertTarget] = useState("");
  const [convertConfirm, setConvertConfirm] = useState(false);
  const [csvUploading, setCsvUploading] = useState(false);
  const csvRef = useRef<HTMLInputElement>(null);

  const { data: recipes = [], isLoading } = useQuery<Recipe[]>({
    queryKey: ["/api/recipes"],
    queryFn: () => apiRequest("GET", "/api/recipes").then((r) => r.json()),
  });
  const { data: ingredients = [] } = useQuery<Ingredient[]>({
    queryKey: ["/api/ingredients"],
    queryFn: () => apiRequest("GET", "/api/ingredients").then((r) => r.json()),
  });
  const { data: subRecipes = [] } = useQuery<SubRecipe[]>({
    queryKey: ["/api/sub-recipes"],
    queryFn: () => apiRequest("GET", "/api/sub-recipes").then((r) => r.json()),
  });
  const { data: settingsData = {} } = useQuery({
    queryKey: ["/api/settings"],
    queryFn: () => apiRequest("GET", "/api/settings").then((r) => r.json()),
  });

  const targetFoodCost = parseFloat(settingsData.target_food_cost_percent || "30");
  const markupPct = parseFloat(settingsData.markup_percent || "65");
  const wholesaleMarkupPct = parseFloat(settingsData.wholesale_markup_percent || "45");

  const nonPackagingIngredients = ingredients.filter((i) => i.category !== "Packaging").sort((a, b) => a.name.localeCompare(b.name));
  const packagingIngredients = ingredients.filter((i) => i.category === "Packaging").sort((a, b) => a.name.localeCompare(b.name));

  const combinedIngredients: CombinedIngredient[] = [
    ...nonPackagingIngredients.map((i) => ({ _kind: "ingredient" as const, id: i.id, name: i.name, unit: i.unit, costPerUnit: i.bestCostPerUnit })),
    ...subRecipes.slice().sort((a, b) => a.name.localeCompare(b.name)).map((s) => ({ _kind: "subrecipe" as const, id: s.id, name: `${s.name} (sub-recipe)`, unit: s.yieldUnit, costPerUnit: s.costPerUnit })),
    // Other recipes (exclude the one currently being edited to avoid circular refs)
    ...recipes.slice().sort((a, b) => a.name.localeCompare(b.name)).filter((r) => r.id !== editing?.id).map((r) => ({ _kind: "recipe" as const, id: r.id, name: `${r.name} (recipe)`, unit: "serve", costPerUnit: r.costPerServe ?? r.totalCost })),
  ];

  const getCombined = (line: IngLine): CombinedIngredient | undefined => {
    if (line._isRecipe) return combinedIngredients.find((c) => c._kind === "recipe" && c.id === line.recipeId);
    if (line._isSubRecipe) return combinedIngredients.find((c) => c._kind === "subrecipe" && c.id === line.subRecipeId);
    return combinedIngredients.find((c) => c._kind === "ingredient" && c.id === line.ingredientId);
  };
  const combinedKey = (line: IngLine) => line._isRecipe ? `rec-${line.recipeId}` : line._isSubRecipe ? `sr-${line.subRecipeId}` : `ing-${line.ingredientId}`;

  const labourRatePerHour = parseFloat(settingsData.labour_rate_per_hour || "35");
  const previewIngCost = ingLines.reduce((sum, l) => {
    // For "each" ingredients: quantity is a count → cost = count × bestCostPerUnit
    const rawIng = !l._isSubRecipe && !l._isRecipe ? ingredients.find((i) => i.id === l.ingredientId) : null;
    if (rawIng && rawIng.unit === "each") {
      return sum + l.quantity * rawIng.bestCostPerUnit;
    }
    const c = getCombined(l);
    return sum + (c?.costPerUnit || 0) * l.quantity;
  }, 0); // includes sub-recipes and nested recipes
  const previewPkgCost = pkgLines.reduce((sum, l) => { const ing = packagingIngredients.find((i) => i.id === l.ingredientId); return sum + (ing?.bestCostPerUnit || 0) * l.quantity; }, 0);
  const previewLabourMins = parseFloat(form.labourMinutes) || 0;
  const previewLabourCost = (previewLabourMins / 60) * labourRatePerHour;
  const previewPortions = Math.max(parseFloat(form.portionCount) || 1, 1);
  const previewTotal = previewIngCost + previewPkgCost + previewLabourCost;
  const previewCostPerServe = previewTotal / previewPortions;
  const previewTargetRrp = markupPct > 0 ? previewCostPerServe / (1 - markupPct / 100) : previewCostPerServe;
  const previewWholesaleTargetRrp = wholesaleMarkupPct > 0 ? previewCostPerServe / (1 - wholesaleMarkupPct / 100) : previewCostPerServe;

  const upsert = useMutation({
    mutationFn: () => {
      const realIngLines = ingLines.filter((l) => !l._isSubRecipe && !l._isRecipe).map(({ ingredientId, quantity }) => ({ ingredientId, quantity }));
      const srLines = ingLines.filter((l) => l._isSubRecipe).map(({ subRecipeId, quantity }) => ({ subRecipeId, quantity }));
      const recipeLines = ingLines.filter((l) => l._isRecipe).map(({ recipeId, quantity }) => ({ recipeId, quantity }));
      const payload = { ...form, photoUrl: form.photoUrl || null, labourMinutes: parseFloat(form.labourMinutes) || 0, portionCount: parseFloat(form.portionCount) || 1, servingSize: form.servingSize || "", servingsPerPackage: form.servingsPerPackage ? parseFloat(form.servingsPerPackage) : null, rrp: form.rrp ? parseFloat(form.rrp) : null, wholesaleRrp: form.wholesaleRrp ? parseFloat(form.wholesaleRrp) : null,
        ingredientsJson: JSON.stringify(realIngLines), subRecipesJson: JSON.stringify(srLines), recipesJson: JSON.stringify(recipeLines),
        packagingJson: JSON.stringify(pkgLines.map(({ ingredientId, quantity }) => ({ ingredientId, quantity }))),
      };
      return editing ? apiRequest("PUT", `/api/recipes/${editing.id}`, payload).then((r) => r.json())
        : apiRequest("POST", "/api/recipes", payload).then((r) => r.json());
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/recipes"] }); queryClient.invalidateQueries({ queryKey: ["/api/platters"] }); queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] }); setOpen(false); resetForm(); toast({ title: editing ? "Recipe updated" : "Recipe created" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const del = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/recipes/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/recipes"] }); queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] }); },
  });

  const convert = useMutation({
    mutationFn: (toType: string) => apiRequest("POST", "/api/convert", { fromType: "recipe", fromId: editing!.id, toType }).then((r) => r.json()),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/ingredients"] }); queryClient.invalidateQueries({ queryKey: ["/api/sub-recipes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recipes"] }); queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      setOpen(false); resetForm(); setConvertTarget(""); setConvertConfirm(false);
      toast({ title: `Converted to ${convertTarget}`, description: data.name });
    },
    onError: (e: any) => toast({ title: "Conversion failed", description: e.message, variant: "destructive" }),
  });

  const resetForm = () => {
    setEditing(null); setIngLines([]); setPkgLines([]);
    setForm({ name: "", category: "Sandwich", description: "", portionSize: "", portionCount: "1", servingSize: "", servingsPerPackage: "", labourMinutes: "0", rrp: "", wholesaleRrp: "", photoUrl: "" });
    setTab("ingredients"); setConvertTarget(""); setConvertConfirm(false);
  };

  const openEdit = (r: Recipe) => {
    setEditing(r);
    setForm({ name: r.name, category: r.category, description: r.description || "", portionSize: r.portionSize || "", portionCount: String(r.portionCount || 1), servingSize: r.servingSize || "", servingsPerPackage: r.servingsPerPackage ? String(r.servingsPerPackage) : "", labourMinutes: String(r.labourMinutes || 0), rrp: r.rrp ? String(r.rrp) : "", wholesaleRrp: r.wholesaleRrp ? String(r.wholesaleRrp) : "", photoUrl: r.photoUrl || "" });
    const rawIng = (JSON.parse(r.ingredientsJson || "[]") as any[]).map((l, i) => ({ ingredientId: l.ingredientId, subRecipeId: undefined as number | undefined, recipeId: undefined as number | undefined, _isSubRecipe: false, _isRecipe: false, quantity: l.quantity, _qtyStr: String(l.quantity), _key: `ing-${i}-${Date.now()}` }));
    const rawSr = (JSON.parse(r.subRecipesJson || "[]") as any[]).map((l, i) => ({ ingredientId: undefined as number | undefined, subRecipeId: l.subRecipeId, recipeId: undefined as number | undefined, _isSubRecipe: true, _isRecipe: false, quantity: l.quantity, _qtyStr: String(l.quantity), _key: `sr-${i}-${Date.now()}` }));
    const rawRec = (JSON.parse((r as any).recipesJson || "[]") as any[]).map((l, i) => ({ ingredientId: undefined as number | undefined, subRecipeId: undefined as number | undefined, recipeId: l.recipeId, _isSubRecipe: false, _isRecipe: true, quantity: l.quantity, _qtyStr: String(l.quantity), _key: `rec-${i}-${Date.now()}` }));
    setIngLines([...rawIng, ...rawSr, ...rawRec]);
    setPkgLines((JSON.parse(r.packagingJson || "[]") as any[]).map((l, i) => ({ ingredientId: l.ingredientId, quantity: l.quantity, _qtyStr: String(l.quantity), _key: `pkg-${i}-${Date.now()}` })));
    setOpen(true);
  };

  const filtered = recipes.filter((r) =>
    r.name.toLowerCase().includes(search.toLowerCase()) &&
    (categoryFilter === "All" || r.category === categoryFilter)
  );

  const addIngLine = () => {
    if (combinedIngredients.length === 0) { toast({ title: "No ingredients yet" }); return; }
    const first = combinedIngredients[0];
    let newLine: IngLine;
    if (first._kind === "recipe") {
      newLine = { recipeId: first.id, _isSubRecipe: false, _isRecipe: true, quantity: 0, _qtyStr: "", _key: `new-${Date.now()}` };
    } else if (first._kind === "subrecipe") {
      newLine = { subRecipeId: first.id, _isSubRecipe: true, _isRecipe: false, quantity: 0, _qtyStr: "", _key: `new-${Date.now()}` };
    } else {
      newLine = { ingredientId: first.id, _isSubRecipe: false, _isRecipe: false, quantity: 0, _qtyStr: "", _key: `new-${Date.now()}` };
    }
    setIngLines([...ingLines, newLine]);
  };

  const updateIngLine = (key: string, updates: Partial<IngLine>) => setIngLines(ingLines.map((l) => l._key === key ? { ...l, ...updates } : l));
  const updateIngLineSelect = (key: string, ck: string) => {
    const [kind, idStr] = ck.split("-");
    const id = parseInt(idStr);
    if (kind === "sr") updateIngLine(key, { subRecipeId: id, ingredientId: undefined, recipeId: undefined, _isSubRecipe: true, _isRecipe: false });
    else if (kind === "rec") updateIngLine(key, { recipeId: id, ingredientId: undefined, subRecipeId: undefined, _isSubRecipe: false, _isRecipe: true });
    else updateIngLine(key, { ingredientId: id, subRecipeId: undefined, recipeId: undefined, _isSubRecipe: false, _isRecipe: false });
  };
  const updateIngLineQty = (key: string, raw: string) => { const qty = parseFloat(raw); updateIngLine(key, { _qtyStr: raw, quantity: isNaN(qty) ? 0 : qty }); };

  // CSV handlers
  const handleDownloadCsv = () => {
    const header = "id,name,category,description,portion_size,labour_cost,rrp";
    const escape = (v: any) => { const s = String(v ?? ""); return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s; };
    const rows = (recipes ?? []).map((r) => [r.id, r.name, r.category, r.description ?? "", r.portionSize ?? "", r.labourCost ?? "", r.rrp ?? ""].map(escape).join(","));
    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "recipes.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  const handleUploadCsv = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvUploading(true);
    try {
      const text = await file.text();
      const parseRow = (line: string): string[] => {
        const result: string[] = []; let cur = ""; let inQ = false;
        for (let i = 0; i < line.length; i++) {
          const c = line[i];
          if (c === '"') { if (inQ && line[i+1] === '"') { cur += '"'; i++; } else inQ = !inQ; }
          else if (c === ',' && !inQ) { result.push(cur); cur = ""; }
          else cur += c;
        }
        result.push(cur); return result;
      };
      const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
      if (lines.length < 2) throw new Error("Empty CSV");
      const headers = parseRow(lines[0]);
      const idIdx = headers.indexOf("id"), nameIdx = headers.indexOf("name"), catIdx = headers.indexOf("category");
      const descIdx = headers.indexOf("description"), portIdx = headers.indexOf("portion_size");
      const labourIdx = headers.indexOf("labour_cost"), rrpIdx = headers.indexOf("rrp");
      let updated = 0;
      for (let i = 1; i < lines.length; i++) {
        const cols = parseRow(lines[i]);
        const id = idIdx >= 0 ? parseInt(cols[idIdx]) : NaN;
        if (isNaN(id)) continue;
        const patch: any = {};
        if (nameIdx >= 0 && cols[nameIdx]) patch.name = cols[nameIdx];
        if (catIdx >= 0 && cols[catIdx]) patch.category = cols[catIdx];
        if (descIdx >= 0) patch.description = cols[descIdx];
        if (portIdx >= 0) patch.portionSize = cols[portIdx];
        if (labourIdx >= 0 && cols[labourIdx] !== "") patch.labourCost = parseFloat(cols[labourIdx]) || 0;
        if (rrpIdx >= 0 && cols[rrpIdx] !== "") patch.rrp = parseFloat(cols[rrpIdx]) || null;
        await apiRequest("PUT", `/api/recipes/${id}`, patch);
        updated++;
      }
      queryClient.invalidateQueries({ queryKey: ["/api/recipes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      toast({ title: `CSV imported — ${updated} recipes updated` });
    } catch (err: any) {
      toast({ title: "CSV import failed", description: err.message, variant: "destructive" });
    } finally {
      setCsvUploading(false);
      if (csvRef.current) csvRef.current.value = "";
    }
  };

  return (
    <div className="p-6 space-y-5 max-w-screen-xl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground">Recipes</h1>
          <p className="text-sm text-muted-foreground mt-1">Menu items with full ingredient, sub-recipe, and packaging costs.</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={handleDownloadCsv} data-testid="button-download-csv-recipes">
            <Download size={14} className="mr-1" /> Download CSV
          </Button>
          <Button variant="outline" size="sm" onClick={() => csvRef.current?.click()} disabled={csvUploading} data-testid="button-upload-csv-recipes">
            <Upload size={14} className="mr-1" /> {csvUploading ? "Importing…" : "Upload CSV"}
          </Button>
          <input ref={csvRef} type="file" accept=".csv" className="hidden" onChange={handleUploadCsv} />
          <Button onClick={() => { resetForm(); setOpen(true); }} size="sm" data-testid="button-add-recipe">
            <Plus size={15} className="mr-1" /> New Recipe
          </Button>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap items-center">
        <Input placeholder="Search recipes…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-44 h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="All">All Categories</SelectItem>
            {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="space-y-2">{[1,2,3].map((i) => <div key={i} className="skeleton h-14 rounded-md" />)}</div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/60 sticky top-0 z-10">
                <tr className="border-b border-border">
                  <th className="text-left px-3 py-2 font-semibold text-muted-foreground text-xs uppercase tracking-wider">Name</th>
                  <th className="text-left px-2 py-2 font-semibold text-muted-foreground text-xs uppercase tracking-wider">Category</th>
                  <th className="text-center px-2 py-2 font-semibold text-muted-foreground text-xs uppercase tracking-wider">Total $</th>
                  <th className="text-center px-2 py-2 font-semibold text-muted-foreground text-xs uppercase tracking-wider">Cost /<br/>Serve</th>
                  <th className="text-center px-2 py-2 font-semibold text-muted-foreground text-xs uppercase tracking-wider">Target<br/>RRP</th>
                  <th className="text-center px-2 py-2 font-semibold text-muted-foreground text-xs uppercase tracking-wider">Target<br/>W/S</th>
                  <th className="text-center px-2 py-2 font-semibold text-muted-foreground text-xs uppercase tracking-wider">Your<br/>RRP</th>
                  <th className="text-center px-2 py-2 font-semibold text-muted-foreground text-xs uppercase tracking-wider">W/S<br/>RRP</th>
                  <th className="text-left px-2 py-2 font-semibold text-muted-foreground text-xs uppercase tracking-wider">Status</th>
                  <th className="text-left px-2 py-2 font-semibold text-muted-foreground text-xs uppercase tracking-wider">Dietaries &amp; Allergens</th>
                  <th className="px-2 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={11} className="text-center py-10">
                    {recipes.length === 0 ? (
                      <div>
                        <UtensilsCrossed size={28} className="mx-auto mb-2 text-muted-foreground" />
                        <p className="font-medium">No recipes yet</p>
                        <button className="text-primary text-sm underline mt-1" onClick={() => { resetForm(); setOpen(true); }}>Create your first recipe</button>
                      </div>
                    ) : "No results"}
                  </td></tr>
                ) : filtered.map((r) => (
                  <tr key={r.id} className="border-b border-border last:border-0 hover:bg-muted/30" data-testid={`row-recipe-${r.id}`}>
                    <td className="px-3 py-2 font-medium max-w-[10rem]"><span className="block truncate" title={r.name}>{r.name}</span></td>
                    <td className="px-2 py-2"><Badge variant="outline" className="text-xs whitespace-nowrap">{r.category}</Badge></td>
                    <td className="px-2 py-2 text-center tabular-nums font-semibold">{fmt(r.totalCost)}</td>
                    <td className="px-2 py-2 text-center tabular-nums font-semibold text-primary">{fmt(r.costPerServe)}</td>
                    <td className="px-2 py-2 text-center tabular-nums text-primary font-medium">{fmt(r.targetRrp)}</td>
                    <td className="px-2 py-2 text-center tabular-nums" style={{color:'#256984'}}>{fmt(r.wholesaleTargetRrp)}</td>
                    <td className="px-2 py-2 text-center tabular-nums">{r.rrp ? fmt(r.rrp) : <span className="text-muted-foreground text-xs">—</span>}</td>
                    <td className="px-2 py-2 text-center tabular-nums">{r.wholesaleRrp ? fmt(r.wholesaleRrp) : <span className="text-muted-foreground text-xs">—</span>}</td>
                    <td className="px-2 py-2"><CostBreakdown recipe={r} targetFoodCost={targetFoodCost} /></td>
                    <td className="px-2 py-2 max-w-[14rem]">
                      <RecipeDietaries id={r.id} />
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(r)} data-testid={`button-edit-recipe-${r.id}`}><Pencil size={13} /></Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => del.mutate(r.id)} data-testid={`button-delete-recipe-${r.id}`}><Trash2 size={13} /></Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Recipe Builder Dialog */}
      <Dialog open={open} onOpenChange={(v) => { if (!v) resetForm(); setOpen(v); }}>
        <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit: ${editing.name}` : "New Recipe"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-5 py-2">
            {/* Name full-width */}
            <div className="space-y-1.5">
              <Label>Recipe Name *</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Buffalo Chicken Wrap" data-testid="input-recipe-name" />
            </div>
            {/* Two-column: details left, photo right */}
            <div className="grid grid-cols-2 gap-4">
              {/* Left: Category, Portion Size, Description */}
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label>Category</Label>
                  <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Portion Size</Label>
                  <Input value={form.portionSize} onChange={(e) => setForm({ ...form, portionSize: e.target.value })} placeholder="e.g. 200g, 1 each" />
                </div>
                <div className="space-y-1.5">
                  <Label>Description</Label>
                  <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Method notes…" rows={3} />
                </div>
              </div>
              {/* Right: square dish photo */}
              <div className="space-y-1.5">
                <Label>Dish Photo</Label>
                <PhotoUpload value={form.photoUrl || null} onChange={(url) => setForm({ ...form, photoUrl: url || "" })} square />
              </div>
            </div>

            <Tabs value={tab} onValueChange={setTab}>
              <TabsList className="w-full">
                <TabsTrigger value="ingredients" className="flex-1">Ingredients ({ingLines.length})</TabsTrigger>
                <TabsTrigger value="packaging" className="flex-1">Packaging ({pkgLines.length})</TabsTrigger>
              </TabsList>

              <TabsContent value="ingredients" className="pt-3">
                <p className="text-xs text-muted-foreground mb-2">Ingredients, sub-recipes, and other recipes — each labelled by type.</p>
                <div className="space-y-2">
                  <Button variant="outline" size="sm" onClick={addIngLine} className="h-7 text-xs" data-testid="button-add-ingredient-line">
                    <Plus size={12} className="mr-1" /> Add Ingredient / Sub-Recipe / Recipe
                  </Button>
                  {ingLines.map((line) => {
                    const sel = getCombined(line);
                    // For "each" ingredients: quantity is a count → cost = count × bestCostPerUnit
                    const rawIng = !line._isSubRecipe && !line._isRecipe ? ingredients.find((i) => i.id === line.ingredientId) : null;
                    const isEach = rawIng && rawIng.unit === "each";
                    const lineCost = isEach
                      ? line.quantity * rawIng!.bestCostPerUnit
                      : (sel?.costPerUnit || 0) * line.quantity;
                    return (
                      <div key={line._key} className="space-y-0.5">
                        <div className="flex gap-2 items-center">
                          <div className="flex-1">
                            <SearchableSelect
                              value={combinedKey(line)}
                              onValueChange={(v) => updateIngLineSelect(line._key, v)}
                              placeholder="Search ingredient or sub-recipe…"
                              className="h-8 text-sm"
                              options={[
                                ...combinedIngredients.filter((c) => c._kind === "ingredient").map((c) => ({ value: `ing-${c.id}`, label: `${c.name} (${c.unit})`, group: "Ingredients" })),
                                ...combinedIngredients.filter((c) => c._kind === "subrecipe").map((c) => ({ value: `sr-${c.id}`, label: `${c.name} (${c.unit})`, group: "Sub-Recipes" })),
                                ...combinedIngredients.filter((c) => c._kind === "recipe").map((c) => ({ value: `rec-${c.id}`, label: c.name, group: "Recipes" })),
                              ]}
                            />
                          </div>
                          <div className="w-28 shrink-0">
                            <Input type="text" inputMode="decimal" className="h-8 text-sm" value={line._qtyStr}
                              placeholder={isEach ? "Qty (each)" : "Qty"}
                              onChange={(e) => updateIngLineQty(line._key, e.target.value)} />
                          </div>
                          <div className="w-20 text-right text-sm shrink-0">
                            <p className="text-xs text-muted-foreground mb-0.5">{isEach ? "each" : (sel?.unit || "")}</p>
                            <p className="tabular-nums">${lineCost.toFixed(3)}</p>
                          </div>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive shrink-0" onClick={() => setIngLines(ingLines.filter((l) => l._key !== line._key))}><Trash2 size={13} /></Button>
                        </div>
                        {isEach && rawIng?.avgWeightPerUnit && (
                          <p className="text-xs text-muted-foreground pl-0.5">
                            1 {rawIng!.name} ≈ {rawIng!.avgWeightPerUnit!}g — enter whole number count
                          </p>
                        )}
                      </div>
                    );
                  })}
                  {ingLines.length === 0 && <p className="text-xs text-muted-foreground py-2">None added.</p>}
                </div>
              </TabsContent>

              <TabsContent value="packaging" className="pt-3">
                <p className="text-xs text-muted-foreground mb-2">Packaging items (boxes, labels, paper) — ingredients with "Packaging" category.</p>
                <div className="space-y-2">
                  <Button variant="outline" size="sm" onClick={() => {
                    if (packagingIngredients.length === 0) { toast({ title: "No packaging ingredients — add ingredients with category 'Packaging'" }); return; }
                    setPkgLines([...pkgLines, { ingredientId: packagingIngredients[0].id, quantity: 0, _qtyStr: "", _key: `pkg-${Date.now()}` }]);
                  }} className="h-7 text-xs" data-testid="button-add-packaging-line">
                    <Plus size={12} className="mr-1" /> Add Packaging
                  </Button>
                  {pkgLines.map((line) => {
                    const ing = packagingIngredients.find((i) => i.id === line.ingredientId);
                    const lineCost = (ing?.bestCostPerUnit || 0) * line.quantity;
                    return (
                      <div key={line._key} className="flex gap-2 items-end">
                        <div className="flex-1">
                          <SearchableSelect
                            value={String(line.ingredientId)}
                            onValueChange={(v) => setPkgLines(pkgLines.map((l) => l._key === line._key ? { ...l, ingredientId: parseInt(v) } : l))}
                            placeholder="Search packaging…"
                            className="h-8 text-sm"
                            options={packagingIngredients.map((i) => ({ value: String(i.id), label: `${i.name} (${i.unit})` }))}
                          />
                        </div>
                        <div className="w-28"><Input type="text" inputMode="decimal" className="h-8 text-sm" value={line._qtyStr} placeholder="Qty" onChange={(e) => { const raw = e.target.value; const qty = parseFloat(raw); setPkgLines(pkgLines.map((l) => l._key === line._key ? { ...l, _qtyStr: raw, quantity: isNaN(qty) ? 0 : qty } : l)); }} /></div>
                        <div className="w-20 text-right text-sm tabular-nums">${lineCost.toFixed(2)}</div>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive shrink-0" onClick={() => setPkgLines(pkgLines.filter((l) => l._key !== line._key))}><Trash2 size={13} /></Button>
                      </div>
                    );
                  })}
                  {pkgLines.length === 0 && <p className="text-xs text-muted-foreground py-2">None added.</p>}
                </div>
              </TabsContent>
            </Tabs>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Number of Serves (portions per batch)</Label>
                <Input type="text" inputMode="decimal" value={form.portionCount} onChange={(e) => setForm({ ...form, portionCount: e.target.value })} placeholder="e.g. 1" data-testid="input-portion-count" />
                <p className="text-xs text-muted-foreground">How many individual serves does this recipe make?</p>
              </div>
              <div className="space-y-1.5">
                <Label>Serving Size (for nutrition label)</Label>
                <div className="flex items-center gap-2 h-9 px-3 rounded-md border border-input bg-muted/40 text-sm">
                  {editing?.calculatedServingSize != null
                    ? <><span className="font-medium">{Math.round(editing.calculatedServingSize)}g</span><span className="text-muted-foreground ml-1">(auto-calculated)</span></>
                    : <span className="text-muted-foreground">Calculated after save</span>}
                </div>
                <p className="text-xs text-muted-foreground">Total ingredient weight ÷ number of serves</p>
              </div>
              <div className="space-y-1.5">
                <Label>Servings Per Package</Label>
                <Input type="text" inputMode="decimal" value={form.servingsPerPackage} onChange={(e) => setForm({ ...form, servingsPerPackage: e.target.value })} placeholder="e.g. 4" data-testid="input-servings-per-package" />
                <p className="text-xs text-muted-foreground">Number of serves in the finished package</p>
              </div>
              <div className="space-y-1.5">
                <Label>Time to Make (minutes)</Label>
                <div className="flex items-center gap-2">
                  <Input type="text" inputMode="decimal" value={form.labourMinutes} onChange={(e) => setForm({ ...form, labourMinutes: e.target.value })} placeholder="e.g. 10" data-testid="input-labour-minutes" className="flex-1" />
                  {previewLabourMins > 0 && (
                    <span className="text-xs text-muted-foreground whitespace-nowrap">= ${previewLabourCost.toFixed(2)} labour</span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">Based on staff rate of ${labourRatePerHour.toFixed(2)}/hr (set in Settings)</p>
              </div>
              <div className="space-y-1.5">
                <Label>Your Selling RRP ($)</Label>
                <Input type="number" step="0.01" value={form.rrp} onChange={(e) => setForm({ ...form, rrp: e.target.value })} placeholder="Leave blank if not set" data-testid="input-recipe-rrp" />
              </div>
              <div className="space-y-1.5">
                <Label>Wholesale RRP ($)</Label>
                <Input type="number" step="0.01" value={form.wholesaleRrp} onChange={(e) => setForm({ ...form, wholesaleRrp: e.target.value })} placeholder="Bulk/discounted price" data-testid="input-recipe-wholesale-rrp" />
                <p className="text-xs text-muted-foreground">Target: {fmt(previewWholesaleTargetRrp)} ({wholesaleMarkupPct}% markup)</p>
              </div>
            </div>

            {/* Dietaries & Allergens — read-only, computed from ingredients */}
            {editing && (
              <div className="bg-muted/30 rounded-lg p-3 space-y-2">
                <p className="text-sm font-semibold">Dietaries &amp; Allergens</p>
                <p className="text-xs text-muted-foreground">Automatically computed from all ingredients — cannot be manually edited.</p>
                <RecipeDietaries id={editing.id} />
              </div>
            )}

            <div className="bg-muted/40 rounded-lg p-4 space-y-2">
              <p className="text-sm font-semibold mb-2">Cost Preview</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <span className="text-muted-foreground">Ingredients & Sub-Recipes</span><span className="text-right tabular-nums">{fmt(previewIngCost)}</span>
                <span className="text-muted-foreground">Packaging</span><span className="text-right tabular-nums">{fmt(previewPkgCost)}</span>
                <span className="text-muted-foreground">Labour ({previewLabourMins > 0 ? `${previewLabourMins} min @ $${labourRatePerHour}/hr` : "0 min"})</span>
                <span className="text-right tabular-nums">{fmt(previewLabourCost)}</span>
                <span className="text-muted-foreground border-t border-border pt-2 mt-1">Total Batch Cost</span>
                <span className="text-right tabular-nums border-t border-border pt-2 mt-1 font-medium">{fmt(previewTotal)}</span>
                <span className="text-muted-foreground">÷ {previewPortions} serve{previewPortions !== 1 ? "s" : ""}</span>
                <span className="text-right tabular-nums"></span>
                <span className="font-semibold text-foreground">Cost Per Serve</span>
                <span className="font-bold text-right tabular-nums">{fmt(previewCostPerServe)}</span>
                <span className="text-primary font-medium">Target RRP ({pct(markupPct)} markup)</span>
                <span className="text-primary font-bold text-right tabular-nums">{fmt(previewTargetRrp)}</span>
                <span className="font-medium" style={{color:'#256984'}}>Wholesale Target ({pct(wholesaleMarkupPct)} markup)</span>
                <span className="font-bold text-right tabular-nums" style={{color:'#256984'}}>{fmt(previewWholesaleTargetRrp)}</span>
                {form.rrp && parseFloat(form.rrp) > 0 && (
                  <>
                    <span className="text-muted-foreground">Your RRP</span>
                    <span className="text-right tabular-nums">{fmt(parseFloat(form.rrp))}</span>
                    <span className="text-muted-foreground">Retail Margin</span>
                    <span className={cn("text-right tabular-nums font-medium",
                      (((parseFloat(form.rrp) - previewCostPerServe) / parseFloat(form.rrp)) * 100) >= 50 ? "success-text" :
                      (((parseFloat(form.rrp) - previewCostPerServe) / parseFloat(form.rrp)) * 100) >= 30 ? "warning-text" : "error-text"
                    )}>
                      {pct(((parseFloat(form.rrp) - previewCostPerServe) / parseFloat(form.rrp)) * 100)}
                    </span>
                  </>
                )}
                {form.wholesaleRrp && parseFloat(form.wholesaleRrp) > 0 && (
                  <>
                    <span className="text-muted-foreground">Wholesale RRP</span>
                    <span className="text-right tabular-nums">{fmt(parseFloat(form.wholesaleRrp))}</span>
                    <span className="text-muted-foreground">Wholesale Margin</span>
                    <span className={cn("text-right tabular-nums font-medium",
                      (((parseFloat(form.wholesaleRrp) - previewCostPerServe) / parseFloat(form.wholesaleRrp)) * 100) >= 40 ? "success-text" :
                      (((parseFloat(form.wholesaleRrp) - previewCostPerServe) / parseFloat(form.wholesaleRrp)) * 100) >= 25 ? "warning-text" : "error-text"
                    )}>
                      {pct(((parseFloat(form.wholesaleRrp) - previewCostPerServe) / parseFloat(form.wholesaleRrp)) * 100)}
                    </span>
                  </>
                )}
              </div>
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
                      <SelectItem value="sub-recipe">Sub-Recipe</SelectItem>
                    </SelectContent>
                  </Select>
                  {convertTarget && (
                    <Button size="sm" variant="outline" className="h-8 text-xs border-amber-400 text-amber-700 hover:bg-amber-50" onClick={() => setConvertConfirm(true)}>
                      <RefreshCw size={12} className="mr-1" /> Convert
                    </Button>
                  )}
                </div>
              ) : (
                <div className="flex gap-2 items-center flex-wrap">
                  <p className="text-xs text-amber-700">Convert "{editing.name}" to {convertTarget}? This will delete the recipe.</p>
                  <Button size="sm" variant="destructive" className="h-7 text-xs" onClick={() => convert.mutate(convertTarget)} disabled={convert.isPending}>{convert.isPending ? "Converting…" : "Confirm"}</Button>
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setConvertConfirm(false); setConvertTarget(""); }}>Cancel</Button>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { resetForm(); setOpen(false); }}>Cancel</Button>
            <Button onClick={() => upsert.mutate({})} disabled={!form.name || upsert.isPending} data-testid="button-save-recipe">
              {upsert.isPending ? "Saving…" : editing ? "Update Recipe" : "Create Recipe"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
