import { useQuery } from "@tanstack/react-query";
import { useState, useRef } from "react";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Printer, BookOpen, ChevronDown, ChevronUp, FileDown, ShieldCheck, PlusCircle, X, Trash2 } from "lucide-react";
import { assetUrl } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

// ─── FSANZ Major Allergens ────────────────────────────────────────────────────
// Maps stored ingredient allergen key → FSANZ display label
const ALLERGEN_KEY_TO_FSANZ: Record<string, string> = {
  "Gluten":    "Gluten",
  "Crustacea": "Crustacean",
  "Eggs":      "Egg",
  "Fish":      "Fish",
  "Dairy":     "Milk / Dairy",
  "Tree Nuts": "Tree Nuts",
  "Peanuts":   "Peanuts",
  "Sesame":    "Sesame",
  "Soy":       "Soy",
  "Molluscs":  "Molluscs",
  "Sulphites": "Sulphites",
};
const FSANZ_ALLERGENS = [
  "Gluten", "Crustacean", "Egg", "Fish", "Milk / Dairy",
  "Tree Nuts", "Peanuts", "Sesame", "Soy", "Molluscs", "Sulphites",
];

type Ingredient = { id: number; name: string; category: string; unit: string; bestCostPerUnit: number; dietariesJson?: string; pealLabel?: string; };
type SubRecipe = { id: number; name: string; category: string; yieldAmount: number; yieldUnit: string; ingredientsJson: string; subRecipesJson: string; totalCost: number; costPerUnit: number; };
type Recipe = {
  id: number; name: string; category: string; description?: string; portionSize?: string;
  portionCount: number;
  ingredientsJson: string; subRecipesJson: string; packagingJson: string;
  ingredientCost: number; subRecipeCost: number; packagingCost: number;
  labourMinutes: number; labourCost: number; totalCost: number;
  costPerServe: number;
  rrp: number | null; wholesaleRrp: number | null;
  targetRrp: number; wholesaleTargetRrp: number;
  marginPercent: number; wholesaleMarginPercent: number;
  dietariesJson?: string; photoUrl?: string;
};

type Platter = {
  id: number; name: string; category: string; description?: string; servings?: number;
  itemsJson: string; packagingJson: string;
  itemsCost: number; packagingCost: number; labourCost: number; totalCost: number;
  photoUrl?: string | null;
  rrp: number | null; wholesaleRrp: number | null;
  targetRrp: number; wholesaleTargetRrp: number;
};

function fmt(n: number | null | undefined) { return n != null ? `$${n.toFixed(2)}` : "—"; }

// Bold any allergen-related terms in a PEAL label string.
// Bolds the entire parenthetical allergen group e.g. "(wheat, soy)" and standalone allergen words.
const ALLERGEN_BOLD_TERMS = [
  "gluten","wheat","rye","barley","oats","spelt","kamut",
  "milk","dairy","lactose","casein","whey",
  "egg","eggs",
  "fish","salmon","tuna","cod","anchov","sardine","basa",
  "soy","soya","soybean","tofu","miso","tempeh",
  "peanut","groundnut",
  "tree nut","almond","cashew","walnut","pecan","pistachio","hazelnut","macadamia","brazil nut","pine nut",
  "sesame","tahini",
  "sulphite","sulfite",
  "crustacean","crustacea","prawn","shrimp","crab","lobster",
  "mollusc","mussel","oyster","squid","scallop",
  "lupin",
];
function BoldAllergens({ text }: { text: string }) {
  if (!text) return <span>{text}</span>;
  // Build a single regex that matches any allergen term (word-boundary aware)
  const pattern = ALLERGEN_BOLD_TERMS.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const regex = new RegExp(`(${pattern})`, "gi");
  const parts = text.split(regex);
  return <>{parts.map((p, i) => regex.test(p) ? <strong key={i}>{p}</strong> : <span key={i}>{p}</span>)}</>;
}

const RECIPE_CATEGORIES = ["Sandwich", "Salad", "Breakfast Sandwich", "Breakfast Pot", "Baked Goods / Dessert", "Drink", "Coffee", "Hot Food", "Sub-Recipe", "Other"];
const PLATTER_CATS = ["Sandwich Platter", "Wrap Platter", "Salad Platter", "Grazing Platter", "Morning Tea", "Afternoon Tea", "Breakfast Pack", "Catering Pack", "Other"];

// Flex Catering colour palette for FSANZ allergen badges
const ALLERGEN_BADGE_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  "Gluten":       { bg: "#8D6E63", text: "#fff", label: "GL" },
  "Crustacean":   { bg: "#EF5350", text: "#fff", label: "CR" },
  "Egg":          { bg: "#FDD835", text: "#333", label: "EG" },
  "Fish":         { bg: "#42A5F5", text: "#fff", label: "FI" },
  "Milk / Dairy": { bg: "#90CAF9", text: "#333", label: "MD" },
  "Tree Nuts":    { bg: "#A1887F", text: "#fff", label: "TN" },
  "Peanuts":      { bg: "#FF8F00", text: "#fff", label: "PN" },
  "Sesame":       { bg: "#FFD54F", text: "#333", label: "SE" },
  "Soy":          { bg: "#AED581", text: "#333", label: "SO" },
  "Molluscs":     { bg: "#BA68C8", text: "#fff", label: "MO" },
  "Sulphites":    { bg: "#78909C", text: "#fff", label: "SU" },
};

type ColKey = "ingredients" | "foodCosting" | "labourCost" | "dietaries" | "ingredientsLabel" | "photo" | "rrp" | "wholesalePrice" | "nutrition";
const COLUMNS: { key: ColKey; label: string }[] = [
  { key: "ingredients", label: "Ingredients" },
  { key: "foodCosting", label: "Food Costing" },
  { key: "labourCost", label: "Labour Cost" },
  { key: "dietaries", label: "Dietaries" },
  { key: "ingredientsLabel", label: "Ingredients Label" },
  { key: "photo", label: "Photo" },
  { key: "rrp", label: "RRP" },
  { key: "wholesalePrice", label: "Wholesale RRP" },
  { key: "nutrition", label: "Nutrition Panel" },
];

type ItemType = "recipe" | "platter";

export default function RecipeBook() {
  const [selectedCategory, setSelectedCategory] = useState<string>("All");
  const [itemType, setItemType] = useState<ItemType>("recipe");
  const [columns, setColumns] = useState<Set<ColKey>>(new Set(["ingredients", "rrp"]));
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [isPdfLoading, setIsPdfLoading] = useState(false);
  const [customerSafe, setCustomerSafe] = useState(false);
  // checkedIds: items ticked in the current browse view (staging area)
  const [checkedIds, setCheckedIds] = useState<Set<number>>(new Set());
  // basketIds: items committed to the report via "Add to Report"
  const [basketIds, setBasketIds] = useState<Set<number>>(new Set());
  const printRef = useRef<HTMLDivElement>(null);

  const { data: recipes = [] } = useQuery<Recipe[]>({
    queryKey: ["/api/recipes"],
    queryFn: () => apiRequest("GET", "/api/recipes").then((r) => r.json()),
  });
  const { data: platters = [] } = useQuery<Platter[]>({
    queryKey: ["/api/platters"],
    queryFn: () => apiRequest("GET", "/api/platters").then((r) => r.json()),
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

  const markupPct = parseFloat(settingsData.markup_percent || "65");
  const wholesaleMarkupPct = parseFloat(settingsData.wholesale_markup_percent || "45");

  const items = itemType === "recipe" ? recipes : platters;
  const allItems = items; // all items regardless of category
  const categories = itemType === "recipe" ? RECIPE_CATEGORIES : PLATTER_CATS;

  // Category filter — controls what's visible in the browse list
  const filteredItems = selectedCategory === "All"
    ? items
    : items.filter((r) => r.category === selectedCategory);

  // Basket: resolved item objects, sorted by category then name
  const basketItems = allItems
    .filter((i) => basketIds.has(i.id))
    .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));

  // Group basket by category
  const basketByCategory = basketItems.reduce<Record<string, typeof basketItems>>((acc, item) => {
    if (!acc[item.category]) acc[item.category] = [];
    acc[item.category].push(item);
    return acc;
  }, {});

  const toggleCheck = (id: number) => {
    const next = new Set(checkedIds);
    next.has(id) ? next.delete(id) : next.add(id);
    setCheckedIds(next);
  };

  const tickAllVisible = () => setCheckedIds(new Set(filteredItems.map((i) => i.id)));
  const untickAllVisible = () => setCheckedIds(new Set());

  const addToReport = () => {
    if (checkedIds.size === 0) return;
    setBasketIds((prev) => new Set([...prev, ...checkedIds]));
    setCheckedIds(new Set()); // clear staging after adding
  };

  const removeFromBasket = (id: number) => {
    setBasketIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
  };

  const clearBasket = () => setBasketIds(new Set());

  const toggleCol = (k: ColKey) => {
    const next = new Set(columns);
    next.has(k) ? next.delete(k) : next.add(k);
    setColumns(next);
  };

  const toggleExpand = (id: number) => {
    const next = new Set(expanded);
    next.has(id) ? next.delete(id) : next.add(id);
    setExpanded(next);
  };

  const expandAll = () => setExpanded(new Set(filteredItems.map((r) => r.id)));
  const collapseAll = () => setExpanded(new Set());

  const handlePrint = () => {
    setExpanded(new Set(filteredItems.map((r) => r.id)));
    setTimeout(() => window.print(), 300);
  };

  const handleExportPdf = async () => {
    if (basketIds.size === 0) return;
    setIsPdfLoading(true);
    try {
      const itemIds = basketItems.map((i) => i.id);
      const resp = await apiRequest("POST", "/api/recipe-book/pdf", {
        itemType,
        itemIds,
        columns: Array.from(columns),
        customerSafe,
      });
      if (!resp.ok) throw new Error("PDF generation failed");
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `recipe-book-${new Date().toISOString().slice(0, 10)}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
    } finally {
      setIsPdfLoading(false);
    }
  };

  // Get ingredient name by id
  const ingName = (id: number) => ingredients.find((i) => i.id === id)?.name || `Ingredient #${id}`;
  const ingUnit = (id: number) => ingredients.find((i) => i.id === id)?.unit || "";
  const srName = (id: number) => subRecipes.find((s) => s.id === id)?.name || `Sub-recipe #${id}`;

  // Build ingredient list for a recipe
  const buildIngredientLines = (recipe: Recipe): { name: string; qty: number; unit: string; cost: number }[] => {
    const ings: { name: string; qty: number; unit: string; cost: number }[] = [];
    (JSON.parse(recipe.ingredientsJson || "[]") as { ingredientId: number; quantity: number }[]).forEach((l) => {
      const ing = ingredients.find((i) => i.id === l.ingredientId);
      if (ing) ings.push({ name: ing.name, qty: l.quantity, unit: ing.unit, cost: ing.bestCostPerUnit * l.quantity });
    });
    (JSON.parse(recipe.subRecipesJson || "[]") as { subRecipeId: number; quantity: number }[]).forEach((l) => {
      const sr = subRecipes.find((s) => s.id === l.subRecipeId);
      if (sr) ings.push({ name: `${sr.name} (sub-recipe)`, qty: l.quantity, unit: sr.yieldUnit, cost: sr.costPerUnit * l.quantity });
    });
    return ings;
  };

  // Build platter items list
  const buildPlatterLines = (platter: Platter): { name: string; qty: number; cost: number }[] => {
    const lines: { name: string; qty: number; cost: number }[] = [];
    (JSON.parse(platter.itemsJson || "[]") as { type: string; id: number; quantity: number }[]).forEach((l) => {
      if (l.type === "recipe") {
        const r = recipes.find((r) => r.id === l.id);
        if (r) lines.push({ name: r.name, qty: l.quantity, cost: r.totalCost * l.quantity });
      } else {
        const ing = ingredients.find((i) => i.id === l.id);
        if (ing) lines.push({ name: ing.name, qty: l.quantity, cost: ing.bestCostPerUnit * l.quantity });
      }
    });
    return lines;
  };

  // Collect all raw allergen keys across all ingredients in this recipe (direct + sub-recipe)
  const collectAllergenKeys = (recipe: Recipe): Set<string> => {
    const ingById = new Map(ingredients.map((i) => [i.id, i]));
    const keys = new Set<string>();
    const addIngredient = (id: number) => {
      const ing = ingById.get(id);
      if (ing) {
        try { (JSON.parse(ing.dietariesJson || "[]") as string[]).forEach((k) => keys.add(k)); } catch {}
      }
    };
    (JSON.parse(recipe.ingredientsJson || "[]") as { ingredientId: number }[]).forEach((l) => addIngredient(l.ingredientId));
    (JSON.parse(recipe.subRecipesJson || "[]") as { id: number }[]).forEach((s) => {
      const sr = subRecipes.find((r) => r.id === s.id);
      if (sr) {
        (JSON.parse(sr.ingredientsJson || "[]") as { ingredientId: number }[]).forEach((l) => addIngredient(l.ingredientId));
        // nested sub-recipes one more level
        (JSON.parse(sr.subRecipesJson || "[]") as { subRecipeId?: number; id?: number }[]).forEach((ss) => {
          const nestedSr = subRecipes.find((r) => r.id === (ss.subRecipeId ?? ss.id));
          if (nestedSr) {
            (JSON.parse(nestedSr.ingredientsJson || "[]") as { ingredientId: number }[]).forEach((l) => addIngredient(l.ingredientId));
          }
        });
      }
    });
    return keys;
  };
  // Derive dietaries — map raw keys to FSANZ display labels, preserve FSANZ order
  const getDietaries = (recipe: Recipe): string[] => {
    const keys = collectAllergenKeys(recipe);
    const fsanzSet = new Set<string>();
    keys.forEach((k) => { const label = ALLERGEN_KEY_TO_FSANZ[k]; if (label) fsanzSet.add(label); });
    return FSANZ_ALLERGENS.filter((a) => fsanzSet.has(a));
  };

  return (
    <div className="p-6 space-y-5 max-w-screen-xl">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3 no-print">
        <div>
          <h1 className="text-xl font-bold text-foreground">Product Info PDF</h1>
          <p className="text-sm text-muted-foreground mt-1">View, filter, and print your recipes, sub-recipes, and platters.</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={handlePrint} size="sm" variant="outline" data-testid="button-print-recipe-book">
            <Printer size={14} className="mr-1" /> Print
          </Button>
          <Button onClick={handleExportPdf} size="sm" disabled={isPdfLoading || basketIds.size === 0} data-testid="button-export-pdf">
            <FileDown size={14} className="mr-1" />
            {isPdfLoading ? "Generating…" : basketIds.size > 0 ? `Export PDF (${basketIds.size})` : "Export PDF"}
          </Button>
        </div>
      </div>

      {/* Controls */}
      <div className="no-print bg-card border border-border rounded-lg p-4 space-y-4">
        {/* Type + Category + Selection */}
        <div className="flex gap-4 flex-wrap items-end">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Item Type</Label>
            <div className="flex gap-2">
              <Button size="sm" variant={itemType === "recipe" ? "default" : "outline"} onClick={() => { setItemType("recipe"); setSelectedCategory("All"); setCheckedIds(new Set()); }}>
                Recipes
              </Button>
              <Button size="sm" variant={itemType === "platter" ? "default" : "outline"} onClick={() => { setItemType("platter"); setSelectedCategory("All"); setCheckedIds(new Set()); }}>
                Platters
              </Button>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Filter by Category</Label>
            <Select value={selectedCategory} onValueChange={(v) => { setSelectedCategory(v); setCheckedIds(new Set()); }}>
              <SelectTrigger className="w-52 h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="All">All Categories</SelectItem>
                {categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Quick Select</Label>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="h-9 text-xs" onClick={tickAllVisible}>Tick All</Button>
              <Button size="sm" variant="outline" className="h-9 text-xs" onClick={untickAllVisible}>Untick All</Button>
            </div>
          </div>
          {/* Add to Report CTA */}
          <div className="self-end">
            <Button
              size="sm"
              className="h-9 gap-1.5"
              onClick={addToReport}
              disabled={checkedIds.size === 0}
              data-testid="button-add-to-report"
            >
              <PlusCircle size={14} />
              Add to Report {checkedIds.size > 0 && `(${checkedIds.size})`}
            </Button>
          </div>
        </div>

        {/* Report Basket */}
        <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Report</span>
              {basketIds.size > 0 && (
                <Badge variant="secondary" className="text-xs h-5 px-1.5">{basketIds.size} item{basketIds.size !== 1 ? "s" : ""}</Badge>
              )}
            </div>
            {basketIds.size > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-xs text-destructive hover:text-destructive px-2 gap-1"
                onClick={clearBasket}
                data-testid="button-clear-basket"
              >
                <Trash2 size={11} /> Clear All
              </Button>
            )}
          </div>

          {basketIds.size === 0 ? (
            <p className="text-xs text-muted-foreground py-1">
              Tick items above and press <span className="font-medium text-foreground">Add to Report</span> to build your export list. Mix items from different categories.
            </p>
          ) : (
            <div className="space-y-2">
              {Object.entries(basketByCategory).map(([category, catItems]) => (
                <div key={category}>
                  <p className="text-xs font-semibold text-muted-foreground mb-1">{category}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {catItems.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center gap-1 bg-background border border-border rounded-full pl-2.5 pr-1 py-0.5 text-xs"
                      >
                        <span>{item.name}</span>
                        <button
                          type="button"
                          onClick={() => removeFromBasket(item.id)}
                          className="ml-0.5 rounded-full hover:bg-muted p-0.5 text-muted-foreground hover:text-foreground transition-colors"
                          data-testid={`button-remove-basket-${item.id}`}
                          title="Remove from report"
                        >
                          <X size={10} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <Separator />

        {/* Column toggles */}
        <div className="space-y-2">
          <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Show Columns</Label>
          <div className="flex gap-4 flex-wrap">
            {COLUMNS.map(({ key, label }) => (
              <div key={key} className="flex items-center gap-1.5">
                <Checkbox
                  id={`col-${key}`}
                  checked={columns.has(key)}
                  onCheckedChange={() => toggleCol(key)}
                />
                <label htmlFor={`col-${key}`} className="text-sm cursor-pointer select-none">{label}</label>
              </div>
            ))}
          </div>
        </div>

        <Separator />

        {/* Customer Safe toggle */}
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => setCustomerSafe((v) => !v)}
            className={cn(
              "flex items-center gap-3 px-4 py-2.5 rounded-lg border-2 transition-all text-sm font-medium select-none",
              customerSafe
                ? "border-[#256984] bg-[#256984]/10 text-[#256984]"
                : "border-border bg-transparent text-muted-foreground hover:border-[#256984]/50 hover:text-foreground"
            )}
            data-testid="toggle-customer-safe"
          >
            <ShieldCheck size={16} className={customerSafe ? "text-[#256984]" : "text-muted-foreground"} />
            <span>Make safe for customers</span>
            <span className={cn(
              "ml-1 text-xs px-1.5 py-0.5 rounded-full font-semibold",
              customerSafe ? "bg-[#256984] text-white" : "bg-muted text-muted-foreground"
            )}>{customerSafe ? "ON" : "OFF"}</span>
          </button>
          {customerSafe && (
            <p className="text-xs text-muted-foreground italic ml-4">
              Quantities, weights, and all cost / margin data will be hidden in this view and in any exported PDF.
            </p>
          )}
        </div>

        {/* Expand / Collapse */}
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={expandAll} className="h-7 text-xs">Expand All</Button>
          <Button variant="outline" size="sm" onClick={collapseAll} className="h-7 text-xs">Collapse All</Button>
          <span className="text-xs text-muted-foreground ml-1 self-center">{filteredItems.length} item{filteredItems.length !== 1 ? "s" : ""}</span>
        </div>
      </div>

      {/* Recipe Book Content */}
      <div ref={printRef} className="space-y-4 print-area">
        {/* Print header */}
        <div className="hidden print:block mb-6">
          <h1 className="text-2xl font-bold">The Deli by Greenhorns — Product Info PDF</h1>
          <p className="text-sm text-gray-500 mt-1">
            {itemType === "recipe" ? "Recipes" : "Platters"} · {basketItems.length} item{basketItems.length !== 1 ? "s" : ""}
          </p>
        </div>

        {filteredItems.length === 0 && (
          <div className="text-center py-16 text-muted-foreground">
            <BookOpen size={40} className="mx-auto mb-3 opacity-40" />
            <p className="font-medium">No items to display</p>
            <p className="text-sm mt-1">Adjust your filters above.</p>
          </div>
        )}

        {filteredItems.map((item) => {
          const isOpen = expanded.has(item.id);
          const isChecked = checkedIds.has(item.id);
          const inBasket = basketIds.has(item.id);
          const recipe = itemType === "recipe" ? (item as Recipe) : null;
          const platter = itemType === "platter" ? (item as Platter) : null;
          const ingLines = recipe ? buildIngredientLines(recipe) : [];
          const platterLines = platter ? buildPlatterLines(platter) : [];
          const dietaries = recipe ? getDietaries(recipe) : [];

          return (
            <div
              key={item.id}
              className={cn(
                "border rounded-lg overflow-hidden print:break-inside-avoid transition-all",
                isChecked ? "border-[#256984] ring-1 ring-[#256984]/30" : inBasket ? "border-border/60 bg-muted/10" : "border-border"
              )}
              data-testid={`card-rb-${item.id}`}
            >
              {/* Header row */}
              <div className="flex items-center no-print">
                {/* Checkbox — staging tick */}
                <div
                  className="flex items-center justify-center px-3 py-3 shrink-0 cursor-pointer"
                  onClick={(e) => { e.stopPropagation(); toggleCheck(item.id); }}
                  title={isChecked ? "Untick to deselect" : "Tick to stage for report"}
                >
                  <Checkbox
                    checked={isChecked}
                    onCheckedChange={() => toggleCheck(item.id)}
                    className="h-4 w-4"
                    data-testid={`checkbox-rb-${item.id}`}
                  />
                </div>
                <button
                  className="flex-1 flex items-center justify-between px-3 py-3 bg-card hover:bg-muted/40 transition-colors text-left"
                  onClick={() => toggleExpand(item.id)}
                >
                  <div className="flex items-center gap-3">
                    <span className="font-semibold text-sm text-foreground">{item.name}</span>
                    <Badge variant="outline" className="text-xs">{item.category}</Badge>
                    {inBasket && !isChecked && (
                      <span className="text-xs text-[#256984] font-medium">In report</span>
                    )}
                    {recipe?.portionSize && <span className="text-xs text-muted-foreground">{recipe.portionSize}</span>}
                    {platter?.servings && <span className="text-xs text-muted-foreground">Serves {platter.servings}</span>}
                  </div>
                  <div className="flex items-center gap-3">
                    {!customerSafe && columns.has("rrp") && <span className="text-sm font-medium text-primary">{fmt(item.rrp)}</span>}
                    {!customerSafe && columns.has("wholesalePrice") && <span className="text-sm font-medium" style={{color:'#256984'}}>{fmt(item.wholesaleRrp)}</span>}
                    {isOpen ? <ChevronUp size={14} className="text-muted-foreground" /> : <ChevronDown size={14} className="text-muted-foreground" />}
                  </div>
                </button>
              </div>

              {/* Print: always show header */}
              <div className="hidden print:flex px-4 py-3 bg-gray-50 items-center justify-between">
                <div>
                  <span className="font-bold text-sm">{item.name}</span>
                  <span className="ml-2 text-xs text-gray-500">{item.category}</span>
                  {recipe?.portionSize && <span className="ml-2 text-xs text-gray-500">· {recipe.portionSize}</span>}
                </div>
                <div className="flex gap-4 text-sm">
                  {columns.has("rrp") && item.rrp && <span>RRP: {fmt(item.rrp)}</span>}
                  {columns.has("wholesalePrice") && item.wholesaleRrp && <span>Wholesale: {fmt(item.wholesaleRrp)}</span>}
                </div>
              </div>

              {/* Expanded content */}
              {(isOpen || false) && (
                <div className={cn("px-4 pb-4 pt-2 border-t border-border bg-background space-y-4 no-print", isOpen ? "block" : "hidden")}>
                  {recipe?.description && (
                    <p className="text-sm text-muted-foreground italic">{recipe.description}</p>
                  )}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Ingredients */}
                    {columns.has("ingredients") && (
                      <div>
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Ingredients</p>
                        {recipe && ingLines.length > 0 ? (
                          <table className="w-full text-sm">
                            <thead><tr className="text-xs text-muted-foreground border-b border-border">
                              <th className="text-left pb-1 font-medium">Item</th>
                              {!customerSafe && <th className="text-right pb-1 font-medium">Qty</th>}
                              {!customerSafe && <th className="text-right pb-1 font-medium">Unit</th>}
                            </tr></thead>
                            <tbody>
                              {ingLines.map((l, i) => (
                                <tr key={i} className="border-b border-border/40 last:border-0">
                                  <td className="py-1">{l.name}</td>
                                  {!customerSafe && <td className="text-right py-1 tabular-nums">{l.qty}</td>}
                                  {!customerSafe && <td className="text-right py-1 text-muted-foreground">{l.unit}</td>}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        ) : platter && platterLines.length > 0 ? (
                          <table className="w-full text-sm">
                            <thead><tr className="text-xs text-muted-foreground border-b border-border">
                              <th className="text-left pb-1 font-medium">Item</th>
                              {!customerSafe && <th className="text-right pb-1 font-medium">Qty</th>}
                            </tr></thead>
                            <tbody>
                              {platterLines.map((l, i) => (
                                <tr key={i} className="border-b border-border/40 last:border-0">
                                  <td className="py-1">{l.name}</td>
                                  {!customerSafe && <td className="text-right py-1 tabular-nums">{l.qty}</td>}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        ) : (
                          <p className="text-xs text-muted-foreground">No ingredients listed.</p>
                        )}
                      </div>
                    )}

                    {/* Food Costing */}
                    {!customerSafe && columns.has("foodCosting") && recipe && (
                      <div>
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Food Costing</p>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-sm">
                          <span className="text-muted-foreground">Ingredients</span><span className="text-right tabular-nums">{fmt(recipe.ingredientCost)}</span>
                          <span className="text-muted-foreground">Sub-Recipes</span><span className="text-right tabular-nums">{fmt(recipe.subRecipeCost)}</span>
                          <span className="text-muted-foreground">Packaging</span><span className="text-right tabular-nums">{fmt(recipe.packagingCost)}</span>
                          <span className="text-muted-foreground border-t border-border pt-1 mt-1">Total Batch</span>
                          <span className="text-right tabular-nums border-t border-border pt-1 mt-1 font-medium">{fmt(recipe.totalCost)}</span>
                          <span className="text-muted-foreground">÷ {recipe.portionCount} serves</span><span></span>
                          <span className="font-semibold">Cost/Serve</span><span className="text-right tabular-nums font-bold">{fmt(recipe.costPerServe)}</span>
                          <span className="text-primary">Target RRP</span><span className="text-right tabular-nums text-primary">{fmt(recipe.targetRrp)}</span>
                        </div>
                      </div>
                    )}
                    {!customerSafe && columns.has("foodCosting") && platter && (
                      <div>
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Food Costing</p>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-sm">
                          <span className="text-muted-foreground">Items</span><span className="text-right tabular-nums">{fmt(platter.itemsCost)}</span>
                          <span className="text-muted-foreground">Packaging</span><span className="text-right tabular-nums">{fmt(platter.packagingCost)}</span>
                          <span className="text-muted-foreground">Labour</span><span className="text-right tabular-nums">{fmt(platter.labourCost)}</span>
                          <span className="font-semibold border-t border-border pt-1 mt-1">Total Cost</span>
                          <span className="text-right tabular-nums border-t border-border pt-1 mt-1 font-bold">{fmt(platter.totalCost)}</span>
                          <span className="text-primary">Target RRP</span><span className="text-right tabular-nums text-primary">{fmt(platter.targetRrp)}</span>
                        </div>
                      </div>
                    )}

                    {/* Labour Cost */}
                    {!customerSafe && columns.has("labourCost") && recipe && (
                      <div>
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Labour Cost</p>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-sm">
                          <span className="text-muted-foreground">Time to make</span><span className="text-right">{recipe.labourMinutes > 0 ? `${recipe.labourMinutes} min` : "—"}</span>
                          <span className="text-muted-foreground">Labour cost</span><span className="text-right tabular-nums">{fmt(recipe.labourCost)}</span>
                        </div>
                      </div>
                    )}

                    {/* Dietaries */}
                    {columns.has("dietaries") && recipe && (
                      <div>
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Dietaries</p>
                        {dietaries.length > 0 ? (
                          <div className="flex flex-wrap gap-1.5">
                            {dietaries.map((d) => {
                              const style = ALLERGEN_BADGE_STYLES[d];
                              return (
                                <span
                                  key={d}
                                  className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold"
                                  style={{ backgroundColor: style?.bg ?? "#256984", color: style?.text ?? "#fff" }}
                                >
                                  {d}
                                </span>
                              );
                            })}
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground">No allergens detected.</p>
                        )}
                        <p className="text-xs text-muted-foreground mt-2 italic">* Auto-detected from ingredient allergen data.</p>
                      </div>
                    )}

                    {/* Ingredients Label (FSANZ PEAL) */}
                    {columns.has("ingredientsLabel") && recipe && (() => {
                      const ingById = new Map(ingredients.map((i) => [i.id, i]));
                      // Build the full PEAL ingredient list: direct ingredients + sub-recipe ingredient names
                      const pealParts: string[] = [];
                      // Direct ingredient lines
                      (JSON.parse(recipe.ingredientsJson || "[]") as { ingredientId: number }[]).forEach((l) => {
                        const ing = ingById.get(l.ingredientId);
                        if (ing) pealParts.push(ing.pealLabel?.trim() || ing.name.toLowerCase());
                      });
                      // Sub-recipe lines: use sub-recipe name + its own ingredients in parens
                      (JSON.parse(recipe.subRecipesJson || "[]") as { id: number }[]).forEach((s) => {
                        const sr = subRecipes.find((r) => r.id === s.id);
                        if (sr) {
                          const srIngParts: string[] = [];
                          (JSON.parse(sr.ingredientsJson || "[]") as { ingredientId: number }[]).forEach((l) => {
                            const ing = ingById.get(l.ingredientId);
                            if (ing) srIngParts.push(ing.pealLabel?.trim() || ing.name.toLowerCase());
                          });
                          // nested sub-recipes
                          (JSON.parse(sr.subRecipesJson || "[]") as { subRecipeId?: number; id?: number }[]).forEach((ss) => {
                            const nestedSr = subRecipes.find((r) => r.id === (ss.subRecipeId ?? ss.id));
                            if (nestedSr) {
                              (JSON.parse(nestedSr.ingredientsJson || "[]") as { ingredientId: number }[]).forEach((l) => {
                                const ing = ingById.get(l.ingredientId);
                                if (ing) srIngParts.push(ing.pealLabel?.trim() || ing.name.toLowerCase());
                              });
                            }
                          });
                          if (srIngParts.length > 0) pealParts.push(`${sr.name.toLowerCase()} (${srIngParts.join(", ")})`);
                          else pealParts.push(sr.name.toLowerCase());
                        }
                      });
                      const fullLabel = pealParts.join(", ");
                      const containsList = getDietaries(recipe);
                      return (
                        <div className="md:col-span-2">
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Ingredients Label (FSANZ PEAL)</p>
                          <div className="border border-border rounded p-3 text-sm bg-muted/20 leading-relaxed">
                            <span className="font-bold">INGREDIENTS: </span>
                            {fullLabel ? <BoldAllergens text={fullLabel} /> : <span className="text-muted-foreground">No ingredients listed.</span>}
                            {containsList.length > 0 && (
                              <><br /><span className="font-bold mt-1 block">CONTAINS: {containsList.join(", ")}</span></>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground mt-1 italic">* Allergen terms are bolded per FSANZ Standard 1.2.3. Always verify before use.</p>
                        </div>
                      );
                    })()}

                    {/* RRP */}
                    {!customerSafe && columns.has("rrp") && (
                      <div>
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Retail RRP</p>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-sm">
                          <span className="text-muted-foreground">Target RRP</span><span className="text-right tabular-nums text-primary font-medium">{fmt(item.targetRrp)}</span>
                          <span className="text-muted-foreground">Your RRP</span><span className="text-right tabular-nums font-semibold">{item.rrp ? fmt(item.rrp) : <span className="text-muted-foreground">Not set</span>}</span>
                          {item.rrp && recipe && (
                            <>
                              <span className="text-muted-foreground">Retail Margin</span>
                              <span className="text-right tabular-nums">{((item.rrp - recipe.costPerServe) / item.rrp * 100).toFixed(1)}%</span>
                            </>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Wholesale Price */}
                    {!customerSafe && columns.has("wholesalePrice") && (
                      <div>
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Wholesale Price</p>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-sm">
                          <span className="text-muted-foreground">Wholesale Target</span><span className="text-right tabular-nums font-medium" style={{color:'#256984'}}>{fmt(item.wholesaleTargetRrp)}</span>
                          <span className="text-muted-foreground">Wholesale RRP</span><span className="text-right tabular-nums font-semibold">{item.wholesaleRrp ? fmt(item.wholesaleRrp) : <span className="text-muted-foreground">Not set</span>}</span>
                          {item.wholesaleRrp && recipe && (
                            <>
                              <span className="text-muted-foreground">Wholesale Margin</span>
                              <span className="text-right tabular-nums">{((item.wholesaleRrp - recipe.costPerServe) / item.wholesaleRrp * 100).toFixed(1)}%</span>
                            </>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Photo */}
                    {columns.has("photo") && (
                      <div>
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Photo</p>
                        {(item as any).photoUrl ? (
                          <img
                            src={assetUrl((item as any).photoUrl)}
                            alt={item.name}
                            className="w-full rounded-lg object-cover max-h-48 border border-border"
                          />
                        ) : (
                          <div className="h-28 w-full border-2 border-dashed border-border rounded-lg flex items-center justify-center text-muted-foreground text-xs">
                            No photo uploaded
                          </div>
                        )}
                      </div>
                    )}
                    {columns.has("nutrition") && (() => {
                      let n: any = null;
                      try { n = JSON.parse((item as any).nutritionJson || "null"); } catch {}
                      // Use auto-calculated serving size (batch weight / serves); fall back to manual entry
                      const calcSS: number | null = (item as any).calculatedServingSize ?? null;
                      const manualSS: string = (item as any).servingSize || "";
                      const servingSizeGrams: number | null = calcSS ?? (manualSS ? parseFloat(manualSS) : null);
                      const ssLabel: string = servingSizeGrams !== null ? `${Math.round(servingSizeGrams)}g` : manualSS;
                      const spp = (item as any).servingsPerPackage;
                      if (!n || (!n.energy && !n.protein && !n.carbs)) {
                        return (
                          <div>
                            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Nutrition Panel</p>
                            <p className="text-xs text-muted-foreground">No nutrition data — fill ingredient nutrition from the Dashboard or Ingredients page.</p>
                          </div>
                        );
                      }
                      const serveScale = servingSizeGrams !== null ? (servingSizeGrams / 100) : 1;
                      const fmt3 = (v: number) => v < 1 ? parseFloat(v.toFixed(2)).toString() : v < 10 ? parseFloat(v.toFixed(1)).toString() : Math.round(v).toString();
                      const rows = [
                        { label: "Energy", per100: `${Math.round(n.energy)} kJ`, perServe: `${Math.round(n.energy * serveScale)} kJ (${Math.round(n.energy * serveScale / 4.184)} Cal)` },
                        { label: "Protein", per100: `${fmt3(n.protein)} g`, perServe: `${fmt3(n.protein * serveScale)} g` },
                        { label: "Fat, total", per100: `${fmt3(n.fatTotal)} g`, perServe: `${fmt3(n.fatTotal * serveScale)} g` },
                        { label: "- Saturated", per100: `${fmt3(n.fatSat)} g`, perServe: `${fmt3(n.fatSat * serveScale)} g`, indent: true },
                        { label: "Carbohydrate", per100: `${fmt3(n.carbs)} g`, perServe: `${fmt3(n.carbs * serveScale)} g` },
                        { label: "- Sugars", per100: `${fmt3(n.sugars)} g`, perServe: `${fmt3(n.sugars * serveScale)} g`, indent: true },
                        { label: "Sodium", per100: `${Math.round(n.sodium)} mg`, perServe: `${Math.round(n.sodium * serveScale)} mg` },
                      ];
                      return (
                        <div>
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Nutrition Panel (FSANZ)</p>
                          <div className="border border-border rounded text-xs overflow-hidden">
                            {(spp || ssLabel) && (
                              <div className="bg-muted/40 px-2 py-1 text-xs space-y-0.5 border-b border-border">
                                {spp && <p><span className="font-medium">Servings per package:</span> {spp}</p>}
                                {ssLabel && <p><span className="font-medium">Serving size:</span> {ssLabel}{calcSS !== null && <span className="text-muted-foreground ml-1">(auto)</span>}</p>}
                              </div>
                            )}
                            <table className="w-full">
                              <thead>
                                <tr className="bg-primary text-primary-foreground">
                                  <th className="text-left px-2 py-1 font-semibold">Nutrient</th>
                                  <th className="text-right px-2 py-1 font-semibold">Per serve{ssLabel ? ` (${ssLabel})` : ""}</th>
                                  <th className="text-right px-2 py-1 font-semibold">Per 100g</th>
                                </tr>
                              </thead>
                              <tbody>
                                {rows.map((r, i) => (
                                  <tr key={r.label} className={i % 2 === 0 ? "bg-background" : "bg-muted/30"}>
                                    <td className={`px-2 py-1 ${(r as any).indent ? "pl-4 text-muted-foreground" : "font-medium"}`}>{r.label}</td>
                                    <td className="text-right px-2 py-1 tabular-nums">{ssLabel ? r.perServe : <span className="text-muted-foreground">—</span>}</td>
                                    <td className="text-right px-2 py-1 tabular-nums text-muted-foreground">{r.per100}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </div>
              )}

              {/* Print expanded content — always visible in print */}
              <div className="hidden print:block px-4 pb-4 pt-2 border-t border-gray-200 bg-white space-y-3">
                {recipe?.description && <p className="text-xs text-gray-500 italic">{recipe.description}</p>}
                <div className="grid grid-cols-2 gap-4 text-xs">
                  {columns.has("ingredients") && recipe && ingLines.length > 0 && (
                    <div>
                      <p className="font-bold uppercase mb-1 text-gray-700">Ingredients</p>
                      <table className="w-full">
                        <tbody>
                          {ingLines.map((l, i) => (
                            <tr key={i}>
                              <td>{l.name}</td>
                              {!customerSafe && <td className="text-right">{l.qty} {l.unit}</td>}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {!customerSafe && columns.has("foodCosting") && recipe && (
                    <div>
                      <p className="font-bold uppercase mb-1 text-gray-700">Food Costing</p>
                      <table className="w-full">
                        <tbody>
                          <tr><td>Total Batch Cost</td><td className="text-right">{fmt(recipe.totalCost)}</td></tr>
                          <tr><td>Cost/Serve ({recipe.portionCount} serves)</td><td className="text-right">{fmt(recipe.costPerServe)}</td></tr>
                          <tr><td>Target RRP</td><td className="text-right">{fmt(recipe.targetRrp)}</td></tr>
                        </tbody>
                      </table>
                    </div>
                  )}
                  {columns.has("dietaries") && recipe && dietaries.length > 0 && (
                    <div>
                      <p className="font-bold uppercase mb-1 text-gray-700">Contains (FSANZ)</p>
                      <p>{dietaries.join(", ")}</p>
                    </div>
                  )}
                  {columns.has("ingredientsLabel") && recipe && (() => {
                    const ingById2 = new Map(ingredients.map((i) => [i.id, i]));
                    const pealParts2: string[] = [];
                    (JSON.parse(recipe.ingredientsJson || "[]") as { ingredientId: number }[]).forEach((l) => {
                      const ing = ingById2.get(l.ingredientId);
                      if (ing) pealParts2.push(ing.pealLabel?.trim() || ing.name.toLowerCase());
                    });
                    (JSON.parse(recipe.subRecipesJson || "[]") as { id: number }[]).forEach((s) => {
                      const sr = subRecipes.find((r) => r.id === s.id);
                      if (sr) {
                        const srP: string[] = [];
                        (JSON.parse(sr.ingredientsJson || "[]") as { ingredientId: number }[]).forEach((l) => { const ing = ingById2.get(l.ingredientId); if (ing) srP.push(ing.pealLabel?.trim() || ing.name.toLowerCase()); });
                        (JSON.parse(sr.subRecipesJson || "[]") as { subRecipeId?: number; id?: number }[]).forEach((ss) => { const n = subRecipes.find((r) => r.id === (ss.subRecipeId ?? ss.id)); if (n) (JSON.parse(n.ingredientsJson || "[]") as { ingredientId: number }[]).forEach((l) => { const ing = ingById2.get(l.ingredientId); if (ing) srP.push(ing.pealLabel?.trim() || ing.name.toLowerCase()); }); });
                        pealParts2.push(srP.length > 0 ? `${sr.name.toLowerCase()} (${srP.join(", ")})` : sr.name.toLowerCase());
                      }
                    });
                    const fullLabelPrint = pealParts2.join(", ");
                    const containsPrint = getDietaries(recipe);
                    return (
                      <div className="col-span-2">
                        <p className="font-bold uppercase mb-1 text-gray-700">Ingredients Label (FSANZ PEAL)</p>
                        <p className="border border-gray-300 p-2 rounded text-xs leading-relaxed">
                          <strong>INGREDIENTS: </strong><BoldAllergens text={fullLabelPrint} />
                          {containsPrint.length > 0 && <><br /><strong>CONTAINS: {containsPrint.join(", ")}</strong></>}
                        </p>
                      </div>
                    );
                  })()}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <style>{`
        @media print {
          .no-print { display: none !important; }
          .print\\:block { display: block !important; }
          .print\\:flex { display: flex !important; }
          .print\\:break-inside-avoid { break-inside: avoid; }
          body { font-size: 12px; }
        }
      `}</style>
    </div>
  );
}
