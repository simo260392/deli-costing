import { useQuery, useMutation } from "@tanstack/react-query";
import { useState, useMemo, useCallback } from "react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { SearchableSelect } from "@/components/SearchableSelect";
import {
  RefreshCw, AlertTriangle, CheckCircle2, Package2, ExternalLink,
  Trash2, Plus, ChevronDown, ChevronUp, Loader2, Store, CloudOff, Upload, Layers
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ───────────────────────────────────────────────────────────────────

type FlexProduct = {
  id: number;
  flexUuid: string;
  flexId: number | null;
  name: string;
  sku: string;
  price: number;
  status: string;
  type: string;
  categoriesJson: string;
  flexDietariesJson: string;
  flexAllergensJson: string;
  imageUrl: string | null;
  lastSyncedAt: string;
  barcodesJson: string;
};

type FlexProductCosting = {
  id: number;
  flexProductId: number;
  componentsJson: string;
  packagingJson: string;
  recipeCost: number;
  packagingCost: number;
  labourCost: number;
  totalCost: number;
  flexPrice: number;
  marginPercent: number;
  profitDollars: number;
  computedAllergensJson: string;
  computedDietariesJson: string;
  updatedAt: string;
};

type Recipe = { id: number; name: string; totalCost: number; category?: string; portionSize?: string };
type SubRecipe = { id: number; name: string; totalCost: number; category?: string; yieldUnit?: string };
type Ingredient = { id: number; name: string; category: string; unit: string; costPerUnit: number; bestCostPerUnit?: number; isPackaging?: boolean };

type ComponentLine = {
  type: 'recipe' | 'sub_recipe' | 'ingredient';
  id: number;
  name: string;
  quantity: number;
  costPerUnit: number;
  unit?: string;
};

type SizeVariant = {
  id: number;
  productUuid: string;
  productName: string;
  sku: string;
  attributesSummary: string;
  attributesJson: string;
  componentsJson: string;
  packagingJson: string;
  totalCost: number;
  sellPrice: number | null;
  websitePrice: number | null;
  lastSeenAt: string;
};

type PackagingLine = {
  ingredientId: number;
  name: string;
  quantity: number;
  unit: string;
  costPerUnit: number;
};

// ─── Dietary display ─────────────────────────────────────────────────────────

const DIETARY_LABELS: Record<string, { label: string; color: string; text: string }> = {
  // Dietary Requirements (matching Flex Catering)
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
  // Allergen / contains codes
  CG:  { label: "Contains Gluten",    color: "#8D6E63", text: "#fff" },
  CD:  { label: "Contains Dairy",     color: "#90CAF9", text: "#1a1a1a" },
  CE:  { label: "Contains Eggs",      color: "#FDD835", text: "#1a1a1a" },
  CN:  { label: "Contains Nuts",      color: "#A1887F", text: "#fff" },
  CS:  { label: "Contains Seafood",   color: "#42A5F5", text: "#fff" },
  CX:  { label: "Contains Seeds",     color: "#FFD54F", text: "#1a1a1a" },
  CY:  { label: "Contains Soya",      color: "#AED581", text: "#1a1a1a" },
  CU:  { label: "Contains Sulphites", color: "#78909C", text: "#fff" },
};

// Flex allergen codes in display order
const FLEX_ALLERGEN_CODES = ["CN", "CD", "CE", "CS", "CG", "CX", "CY", "CU"] as const;

function DietaryBadge({ code }: { code: string }) {
  const info = DIETARY_LABELS[code];
  if (!info) return <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">{code}</span>;
  return (
    <span
      className="text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap"
      style={{ backgroundColor: info.color, color: info.text }}
    >
      {info.label}
    </span>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const safeNum = (n: number | null | undefined) => (n == null || isNaN(Number(n)) ? 0 : Number(n));
function fmt(n: number | null | undefined) { return `$${safeNum(n).toFixed(2)}`; }
function pct(n: number | null | undefined) { return `${safeNum(n).toFixed(1)}%`; }

function marginColor(m: number) {
  if (m >= 60) return "text-green-600 dark:text-green-400";
  if (m >= 40) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

function parseDietaries(json: string): string[] {
  try {
    const arr = JSON.parse(json || "[]");
    return arr.map((d: any) => typeof d === 'string' ? d : (d.code || d.short_code || ''));
  } catch { return []; }
}

function parseAllergens(json: string): string[] {
  try {
    const arr = JSON.parse(json || "[]");
    // Normalise — Flex stores codes like "CG", but computed may store labels like "Gluten"
    const LABEL_TO_CODE: Record<string, string> = {
      Gluten: "CG", Dairy: "CD", Eggs: "CE", "Tree Nuts": "CN", Nuts: "CN",
      Seafood: "CS", Seeds: "CX", Soy: "CY", Soya: "CY", Sulphites: "CU",
    };
    return arr.map((d: any) => {
      const s = typeof d === 'string' ? d : (d.code || d.short_code || '');
      return LABEL_TO_CODE[s] || s;
    }).filter((c: string) => DIETARY_LABELS[c]);
  } catch { return []; }
}

function dietaryMismatch(flexJson: string, computedJson: string): boolean {
  // Only compare pure dietary requirement codes (not allergen C-codes)
  const ALLERGEN_CODES = new Set(['CN','CD','CE','CS','CG','CX','CY','CU']);
  const flex = new Set(parseDietaries(flexJson).filter(c => !ALLERGEN_CODES.has(c)));
  const computed = new Set(parseDietaries(computedJson).filter(c => !ALLERGEN_CODES.has(c)));
  const TRACK = ['V','VG','GF','DF','EF','LF','NF','H','KO','PS','K','P','HP','LC','RF'];
  const flexTracked = TRACK.filter(d => flex.has(d));
  const compTracked = TRACK.filter(d => computed.has(d));
  return flexTracked.sort().join(',') !== compTracked.sort().join(',');
}

// ─── Size Variant Editor ─────────────────────────────────────────────────────

function SizeVariantRow({
  variant,
  recipes,
  subRecipes,
  ingredients,
}: {
  variant: SizeVariant;
  recipes: Recipe[];
  subRecipes: SubRecipe[];
  ingredients: Ingredient[];
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [components, setComponents] = useState<ComponentLine[]>(() => {
    try { return JSON.parse(variant.componentsJson || "[]"); } catch { return []; }
  });
  const [packaging, setPackaging] = useState<PackagingLine[]>(() => {
    try { return JSON.parse(variant.packagingJson || "[]"); } catch { return []; }
  });
  const [dirty, setDirty] = useState(false);

  // Add component — unified search for recipes/sub-recipes/ingredients
  const [addId, setAddId] = useState<string>(""); // prefixed: "recipe:1", "sub_recipe:2", "ingredient:3"
  const [addQty, setAddQty] = useState("1");
  // Add packaging
  const [addPkgId, setAddPkgId] = useState("");
  const [addPkgQty, setAddPkgQty] = useState("1");

  const saveMutation = useMutation({
    mutationFn: ({ comps, pkgs }: { comps: ComponentLine[]; pkgs: PackagingLine[] }) =>
      apiRequest("PATCH", `/api/product-size-variants/${variant.id}`, { components: comps, packaging: pkgs }).then(r => r.json()),
    onSuccess: () => {
      setDirty(false);
      // Invalidate so PricingTab auto-refreshes with new totalCost
      queryClient.invalidateQueries({ queryKey: ["/api/product-size-variants", variant.productUuid] });
    },
    onError: (e: any) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const totalCost = components.reduce((s, c) => s + (c.costPerUnit || 0) * (c.quantity || 0), 0)
    + packaging.reduce((s, p) => s + (p.costPerUnit || 0) * (p.quantity || 0), 0);

  // Combined options: recipes + sub-recipes + non-packaging ingredients, grouped
  const addOptions = useMemo(() => [
    ...recipes.map(r => ({ value: `recipe:${r.id}`, label: r.name, group: "Recipes" })),
    ...subRecipes.map(r => ({ value: `sub_recipe:${r.id}`, label: r.name, group: "Sub-Recipes" })),
    ...ingredients
      .filter(i => !i.category?.toLowerCase().includes('packag'))
      .map(i => ({ value: `ingredient:${i.id}`, label: i.name, group: "Ingredients" })),
  ], [recipes, subRecipes, ingredients]);

  // Packaging options — only packaging category ingredients
  const packagingOptions = useMemo(() =>
    ingredients
      .filter(i => i.category?.toLowerCase().includes('packag'))
      .map(i => ({ value: String(i.id), label: i.name }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  [ingredients]);

  function handleAdd() {
    if (!addId) return;
    const qty = parseFloat(addQty) || 1;
    const [type, rawId] = addId.split(':');
    const id = Number(rawId);
    let item: ComponentLine | null = null;
    if (type === 'recipe') {
      const r = recipes.find(x => x.id === id);
      if (!r) return;
      item = { type: 'recipe', id: r.id, name: r.name, quantity: qty, costPerUnit: r.totalCost || 0 };
    } else if (type === 'sub_recipe') {
      const r = subRecipes.find(x => x.id === id);
      if (!r) return;
      item = { type: 'sub_recipe', id: r.id, name: r.name, quantity: qty, costPerUnit: r.totalCost || 0 };
    } else {
      const ing = ingredients.find(x => x.id === id);
      if (!ing) return;
      item = { type: 'ingredient', id: ing.id, name: ing.name, quantity: qty, costPerUnit: ing.bestCostPerUnit ?? ing.costPerUnit ?? 0, unit: ing.unit };
    }
    const updated = [...components, item];
    setComponents(updated);
    setDirty(false);
    setAddId("");
    setAddQty("1");
    saveMutation.mutate({ comps: updated, pkgs: packaging });
  }

  function handleAddPackaging() {
    if (!addPkgId) return;
    const ing = ingredients.find(i => i.id === Number(addPkgId));
    if (!ing) return;
    const qty = parseFloat(addPkgQty) || 1;
    const unitCost = Number(ing.bestCostPerUnit ?? ing.costPerUnit) || 0;
    const updated = [...packaging, { ingredientId: ing.id, name: ing.name, quantity: qty, unit: ing.unit, costPerUnit: unitCost }];
    setPackaging(updated);
    setAddPkgId("");
    setAddPkgQty("1");
    saveMutation.mutate({ comps: components, pkgs: updated });
  }

  const displayAttrs = variant.attributesSummary || "(No size / individual)";
  const hasComponents = components.length > 0;

  // Margin calculations — sell price is GST-inclusive, show as-is
  // Strip GST only for margin calculations (cost is ex-GST)
  const sellPriceIncGst = variant.sellPrice ?? null;
  const sellPriceExGst = sellPriceIncGst ? sellPriceIncGst / 1.1 : null;
  const grossProfit = sellPriceExGst !== null ? sellPriceExGst - totalCost : null;
  const gpPercent = sellPriceExGst && sellPriceExGst > 0 ? (grossProfit! / sellPriceExGst) * 100 : null;
  const fcPercent = sellPriceExGst && sellPriceExGst > 0 ? (totalCost / sellPriceExGst) * 100 : null;

  return (
    <div className="border rounded-lg bg-background">
      {/* Row header */}
      <button
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/40 transition-colors rounded-lg"
        onClick={() => setOpen(o => !o)}
      >
        <Layers size={14} className="text-muted-foreground shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{displayAttrs}</p>
          <p className="text-xs text-muted-foreground font-mono">{variant.sku}</p>
        </div>
        <div className="flex items-center gap-3 shrink-0 text-xs">
          {sellPriceIncGst !== null && (
            <span className="text-muted-foreground">Sell ${sellPriceIncGst.toFixed(2)}</span>
          )}
          {hasComponents ? (
            <span className="font-medium text-[#256984]">
              Cost ${totalCost.toFixed(2)}
            </span>
          ) : (
            <span className="text-muted-foreground">No components set</span>
          )}
          {gpPercent !== null && (
            <span className={cn(
              "font-semibold px-1.5 py-0.5 rounded",
              gpPercent >= 65 ? "bg-green-100 text-green-700" :
              gpPercent >= 50 ? "bg-amber-100 text-amber-700" :
              "bg-red-100 text-red-700"
            )}>
              GP {gpPercent.toFixed(0)}%
            </span>
          )}
          {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </div>
      </button>

      {/* Expanded editor */}
      {open && (
        <div className="border-t px-4 pb-4 pt-3 space-y-4">

          {/* Component list */}
          {components.length > 0 && (
            <div className="space-y-1.5">
              {components.map((c, i) => (
                <div key={i} className="flex items-center gap-2 py-1.5 px-3 rounded-md bg-muted/50">
                  <span className={cn(
                    "text-xs px-1.5 py-0.5 rounded font-medium",
                    c.type === 'recipe' && "bg-blue-100 text-blue-700",
                    c.type === 'sub_recipe' && "bg-purple-100 text-purple-700",
                    c.type === 'ingredient' && "bg-green-100 text-green-700",
                  )}>
                    {c.type === 'recipe' ? 'Recipe' : c.type === 'sub_recipe' ? 'Sub-recipe' : 'Ingredient'}
                  </span>
                  <span className="flex-1 text-sm truncate">{c.name}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    ×{c.quantity} {c.unit || ''}
                  </span>
                  <span className="text-xs font-medium tabular-nums">
                    ${((c.costPerUnit || 0) * (c.quantity || 0)).toFixed(2)}
                  </span>
                  <button
                    className="text-muted-foreground hover:text-red-500 transition-colors"
                    onClick={() => { const u = components.filter((_, j) => j !== i); setComponents(u); setDirty(false); saveMutation.mutate({ comps: u, pkgs: packaging }); }}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
              <div className="flex justify-between items-center pt-1 px-3">
                <span className="text-xs text-muted-foreground">Total cost</span>
                <span className="text-sm font-bold tabular-nums">${totalCost.toFixed(2)}</span>
              </div>
            </div>
          )}

          {/* Add component row — unified search */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Add component</p>
            <div className="flex gap-2 items-end">
              <div className="flex-1">
                <SearchableSelect
                  options={addOptions}
                  value={addId}
                  onValueChange={v => setAddId(v || "")}
                  placeholder="Search recipes, sub-recipes & ingredients…"
                />
              </div>
              <div className="w-20">
                <Input
                  type="number"
                  min="1"
                  step="1"
                  value={addQty}
                  onChange={e => setAddQty(e.target.value)}
                  placeholder="Qty"
                  className="h-9 text-sm"
                />
              </div>
              <Button size="sm" onClick={handleAdd} disabled={!addId} className="h-9">
                <Plus size={14} className="mr-1" /> Add
              </Button>
            </div>
          </div>

          {/* Packaging */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Packaging</p>
            {packaging.length > 0 && (
              <div className="space-y-1">
                {packaging.map((p, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    <span className="flex-1 truncate">{p.name}</span>
                    <Input
                      type="number" min="1" step="1" value={p.quantity}
                      onChange={e => {
                        const updated = packaging.map((x, idx) => idx === i ? { ...x, quantity: parseFloat(e.target.value) || 1 } : x);
                        setPackaging(updated);
                        saveMutation.mutate({ comps: components, pkgs: updated });
                      }}
                      className="h-8 w-16 text-sm text-center"
                    />
                    <span className="text-xs text-muted-foreground w-16 text-right tabular-nums">
                      ${((p.costPerUnit || 0) * (p.quantity || 0)).toFixed(2)}
                    </span>
                    <button
                      onClick={() => {
                        const updated = packaging.filter((_, idx) => idx !== i);
                        setPackaging(updated);
                        saveMutation.mutate({ comps: components, pkgs: updated });
                      }}
                      className="text-destructive hover:opacity-70"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2 items-end">
              <div className="flex-1">
                <SearchableSelect
                  options={packagingOptions}
                  value={addPkgId}
                  onValueChange={v => setAddPkgId(v || "")}
                  placeholder="Add packaging…"
                />
              </div>
              <div className="w-20">
                <Input
                  type="number" min="1" step="1" value={addPkgQty}
                  onChange={e => setAddPkgQty(e.target.value)}
                  placeholder="Qty" className="h-9 text-sm"
                />
              </div>
              <Button size="sm" onClick={handleAddPackaging} disabled={!addPkgId} className="h-9">
                <Plus size={14} className="mr-1" /> Add
              </Button>
            </div>
          </div>

          {/* Saving indicator */}
          {saveMutation.isPending && (
            <div className="flex justify-end">
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Loader2 size={11} className="animate-spin" /> Saving…
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Costing Editor ──────────────────────────────────────────────────────────

function CostingEditor({
  product,
  costing,
  recipes,
  subRecipes,
  ingredients,
  settings,
  onSave,
  isSaving,
}: {
  product: FlexProduct;
  costing: FlexProductCosting | null;
  recipes: Recipe[];
  subRecipes: SubRecipe[];
  ingredients: Ingredient[];
  settings: Record<string, string>;
  onSave: (data: { components: ComponentLine[]; packaging: PackagingLine[]; labourMinutes: number }) => void;
  isSaving: boolean;
}) {
  const hourlyRate = parseFloat(settings?.labour_rate_per_hour || "35");

  const [components, setComponents] = useState<ComponentLine[]>(() => {
    if (!costing) return [];
    try { return JSON.parse(costing.componentsJson || "[]"); } catch { return []; }
  });
  const [packaging, setPackaging] = useState<PackagingLine[]>(() => {
    if (!costing) return [];
    try {
      const lines: PackagingLine[] = JSON.parse(costing.packagingJson || "[]");
      // Enrich with current ingredient price in case costPerUnit was not stored
      return lines.map(p => {
        if (p.costPerUnit) return p;
        const ing = ingredients.find(i => i.id === p.ingredientId);
        const unitCost = Number(ing?.bestCostPerUnit ?? ing?.costPerUnit) || 0;
        return { ...p, costPerUnit: unitCost };
      });
    } catch { return []; }
  });
  const [labourMinutes, setLabourMinutes] = useState(
    costing ? Math.round(((costing.labourCost || 0) / hourlyRate) * 60) : 0
  );
  const [newCompKey, setNewCompKey] = useState("");
  const [newCompQty, setNewCompQty] = useState("1");
  const [newPkgId, setNewPkgId] = useState("");
  const [newPkgQty, setNewPkgQty] = useState("1");

  // Build options for component selector (recipes + sub-recipes + ingredients)
  const componentOptions = useMemo(() => {
    const nonPackagingIngredients = ingredients.filter(
      i => !i.category?.toLowerCase().includes('packag')
    );
    const opts = [
      ...recipes.map(r => ({ value: `recipe:${r.id}`, label: r.name, group: "Recipes" })),
      ...subRecipes.map(sr => ({ value: `sub_recipe:${sr.id}`, label: sr.name, group: "Sub-Recipes" })),
      ...nonPackagingIngredients.map(i => ({ value: `ingredient:${i.id}`, label: i.name, group: "Ingredients" })),
    ];
    return opts.sort((a, b) => a.group.localeCompare(b.group) || a.label.localeCompare(b.label));
  }, [recipes, subRecipes, ingredients]);

  // Packaging options — only packaging category ingredients
  const packagingOptions = useMemo(() => {
    return ingredients
      .filter(i => i.category?.toLowerCase().includes('packag'))
      .map(i => ({ value: String(i.id), label: i.name }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [ingredients]);

  function addComponent() {
    if (!newCompKey) return;
    const [type, idStr] = newCompKey.split(":");
    const id = parseInt(idStr);
    const qty = parseFloat(newCompQty) || 1;

    let name = "";
    let costPerUnit = 0;
    let unit = "";
    if (type === "recipe") {
      const r = recipes.find(r => r.id === id);
      name = r?.name || "";
      costPerUnit = Number(r?.totalCost) || 0;
      unit = "serve";
    } else if (type === "sub_recipe") {
      const sr = subRecipes.find(sr => sr.id === id);
      name = sr?.name || "";
      costPerUnit = Number(sr?.totalCost) || 0;
      unit = sr?.yieldUnit || "unit";
    } else if (type === "ingredient") {
      const ing = ingredients.find(i => i.id === id);
      name = ing?.name || "";
      costPerUnit = Number(ing?.bestCostPerUnit ?? ing?.costPerUnit) || 0;
      unit = ing?.unit || "unit";
    }

    setComponents(prev => [...prev, { type: type as 'recipe' | 'sub_recipe' | 'ingredient', id, name, quantity: qty, costPerUnit, unit }]);
    setNewCompKey("");
    setNewCompQty("1");
  }

  function addPackaging() {
    if (!newPkgId) return;
    const id = parseInt(newPkgId);
    const ing = ingredients.find(i => i.id === id);
    if (!ing) return;
    const qty = parseFloat(newPkgQty) || 1;
    const unitCost = Number(ing.bestCostPerUnit ?? ing.costPerUnit) || 0;
    setPackaging(prev => [...prev, { ingredientId: id, name: ing.name, quantity: qty, unit: ing.unit, costPerUnit: unitCost }]);
    setNewPkgId("");
    setNewPkgQty("1");
  }

  // Live cost preview (NaN-safe)
  const recipeCost = components.reduce((sum, c) => sum + (isNaN(c.costPerUnit * c.quantity) ? 0 : c.costPerUnit * c.quantity), 0);
  const packCost = packaging.reduce((sum, p) => sum + (isNaN(p.costPerUnit * p.quantity) ? 0 : p.costPerUnit * p.quantity), 0);
  const labourCost = (Number(labourMinutes) / 60) * hourlyRate;
  const totalCost = recipeCost + packCost + labourCost;
  const flexPrice = Number(product.price) || 0;
  const profitDollars = flexPrice - totalCost;
  const marginPct = flexPrice > 0 ? (profitDollars / flexPrice) * 100 : 0;

  return (
    <div className="space-y-5">
      {/* Components */}
      <div>
        <Label className="text-sm font-semibold mb-2 block">Recipes / Sub-Recipes / Ingredients</Label>
        <div className="space-y-2">
          {components.map((c, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className="flex-1 text-sm font-medium truncate">
                {c.name}
                <span className="ml-1 text-xs text-muted-foreground">({c.type === 'recipe' ? 'Recipe' : c.type === 'sub_recipe' ? 'Sub-Recipe' : 'Ingredient'})</span>
              </div>
              <div className="flex items-center gap-1">
                <Input
                  type="number"
                  min="0.001"
                  step="0.001"
                  value={c.quantity}
                  onChange={e => {
                    const v = parseFloat(e.target.value) || 1;
                    setComponents(prev => prev.map((x, idx) => idx === i ? { ...x, quantity: v, costPerUnit: x.costPerUnit } : x));
                  }}
                  className="h-8 text-sm text-center w-20"
                />
                {c.unit && <span className="text-xs text-muted-foreground whitespace-nowrap">{c.unit}</span>}
              </div>
              <span className="text-xs text-muted-foreground w-16 text-right tabular-nums">
                {fmt(c.costPerUnit * c.quantity)}
              </span>
              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-destructive hover:text-destructive"
                onClick={() => setComponents(prev => prev.filter((_, idx) => idx !== i))}>
                <Trash2 size={14} />
              </Button>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2 mt-3">
          <div className="flex-1">
            <SearchableSelect
              value={newCompKey}
              onValueChange={setNewCompKey}
              options={componentOptions}
              placeholder="Add recipe or sub-recipe…"
              className="h-8 text-sm"
            />
          </div>
          <Input
            type="number" min="0.001" step="0.001" value={newCompQty}
            onChange={e => setNewCompQty(e.target.value)}
            className="h-8 text-sm w-20 text-center"
            placeholder="Qty"
          />
          <Button size="sm" onClick={addComponent} disabled={!newCompKey} className="h-8 px-2">
            <Plus size={14} />
          </Button>
        </div>
      </div>

      {/* Packaging */}
      <div>
        <Label className="text-sm font-semibold mb-2 block">Packaging</Label>
        <div className="space-y-2">
          {packaging.map((p, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className="flex-1 text-sm font-medium truncate">{p.name}</div>
              <div className="w-20">
                <Input
                  type="number" min="0" step="1" value={p.quantity}
                  onChange={e => {
                    const v = parseFloat(e.target.value) || 1;
                    setPackaging(prev => prev.map((x, idx) => idx === i ? { ...x, quantity: v } : x));
                  }}
                  className="h-8 text-sm text-center"
                />
              </div>
              <span className="text-xs text-muted-foreground w-16 text-right tabular-nums">
                {fmt(p.costPerUnit * p.quantity)}
              </span>
              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-destructive hover:text-destructive"
                onClick={() => setPackaging(prev => prev.filter((_, idx) => idx !== i))}>
                <Trash2 size={14} />
              </Button>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2 mt-3">
          <div className="flex-1">
            <SearchableSelect
              value={newPkgId}
              onValueChange={setNewPkgId}
              options={packagingOptions}
              placeholder="Add packaging…"
              className="h-8 text-sm"
            />
          </div>
          <Input
            type="number" min="1" step="1" value={newPkgQty}
            onChange={e => setNewPkgQty(e.target.value)}
            className="h-8 text-sm w-20 text-center"
            placeholder="Qty"
          />
          <Button size="sm" onClick={addPackaging} disabled={!newPkgId} className="h-8 px-2">
            <Plus size={14} />
          </Button>
        </div>
      </div>

      {/* Labour */}
      <div className="flex items-center gap-3">
        <Label className="text-sm font-semibold whitespace-nowrap">Labour (minutes)</Label>
        <Input
          type="number" min="0" step="1" value={labourMinutes}
          onChange={e => setLabourMinutes(parseInt(e.target.value) || 0)}
          className="h-8 text-sm w-24 text-center"
        />
        <span className="text-xs text-muted-foreground">{fmt(labourCost)} @ ${hourlyRate}/hr</span>
      </div>

      {/* Live cost summary */}
      <div className="rounded-lg border p-4 bg-muted/30 space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Recipe cost</span>
          <span className="tabular-nums font-medium">{fmt(recipeCost)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Packaging cost</span>
          <span className="tabular-nums font-medium">{fmt(packCost)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Labour cost</span>
          <span className="tabular-nums font-medium">{fmt(labourCost)}</span>
        </div>
        <div className="flex justify-between border-t pt-2 font-semibold">
          <span>Total cost</span>
          <span className="tabular-nums">{fmt(totalCost)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Flex price</span>
          <span className="tabular-nums font-medium">{fmt(flexPrice)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Profit</span>
          <span className={cn("tabular-nums font-semibold", profitDollars >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600")}>
            {fmt(profitDollars)}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Margin</span>
          <span className={cn("tabular-nums font-semibold", marginColor(marginPct))}>
            {pct(marginPct)}
          </span>
        </div>
      </div>

      <Button
        className="w-full"
        style={{ backgroundColor: "#256984" }}
        onClick={() => onSave({ components, packaging, labourMinutes })}
        disabled={isSaving}
        data-testid="btn-save-costing"
      >
        {isSaving ? <><Loader2 size={14} className="mr-2 animate-spin" />Saving…</> : "Save Costing"}
      </Button>
    </div>
  );
}

// ─── Product Card ─────────────────────────────────────────────────────────────

// ── Push to Flex Button ─────────────────────────────────────────────
function PushToFlexButton({
  productId, hasCosting, hasMismatch, computedDietaries, computedAllergens, onSuccess
}: {
  productId: number;
  hasCosting: boolean;
  hasMismatch: boolean;
  computedDietaries: string[];
  computedAllergens: string[];
  onSuccess: () => void;
}) {
  const { toast } = useToast();
  const [pushed, setPushed] = useState(false);

  const pushMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/flex-products/${productId}/push-dietaries`).then(r => r.json()),
    onSuccess: (data) => {
      setPushed(true);
      setTimeout(() => setPushed(false), 4000);
      onSuccess();
      toast({
        title: "Pushed to Flex",
        description: `Updated with ${data.flexDietaries?.length ?? 0} dietaries/allergens on your Flex website.`,
      });
    },
    onError: (e: any) => toast({ title: "Push failed", description: e.message, variant: "destructive" }),
  });

  if (!hasCosting) {
    return (
      <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground flex items-center gap-2">
        <Upload size={13} className="shrink-0" />
        <span>Add components to sizes first to enable pushing dietaries to Flex.</span>
      </div>
    );
  }

  const totalCount = computedDietaries.length + computedAllergens.length;

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 p-3 space-y-1.5">
      <p className="text-xs font-semibold text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
        <AlertTriangle size={12} />
        Push to Flex — Pending Flex API fix
      </p>
      <p className="text-xs text-amber-700 dark:text-amber-400 leading-relaxed">
        Flex Catering's API currently has a bug where their product update endpoint wipes product categories on every call, regardless of what's sent. We've confirmed this with testing and have paused the push to prevent data loss on your live website.
      </p>
      <p className="text-xs text-amber-700 dark:text-amber-400">
        Please contact Flex Catering support and report that <strong>PUT /api/v1/products/&#123;uuid&#125;</strong> clears <strong>product_categories</strong> and ignores <strong>dietaries_uuid</strong>. Once fixed, the push button will work.
      </p>
      {hasMismatch && totalCount > 0 && (
        <p className="text-xs font-medium text-amber-800 dark:text-amber-300 pt-0.5">
          Ready to push: {computedDietaries.length} dietar{computedDietaries.length === 1 ? 'y' : 'ies'} + {computedAllergens.length} allergen{computedAllergens.length === 1 ? '' : 's'}
        </p>
      )}
    </div>
  );
}

function DetailsTab({ product, onBarcodesUpdate }: { product: FlexProduct; onBarcodesUpdate: (barcodes: string[]) => void }) {
  const barcodes: string[] = (() => { try { return JSON.parse(product.barcodesJson || "[]"); } catch { return []; } })();
  const [editingBarcodes, setEditingBarcodes] = useState(false);
  const [barcodeInput, setBarcodeInput] = useState(barcodes.join("\n"));

  return (
    <div className="space-y-4 text-sm">
      {/* Barcodes */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Barcodes (GTINs)</p>
          {!editingBarcodes && (
            <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => { setBarcodeInput(barcodes.join("\n")); setEditingBarcodes(true); }}>
              Edit
            </Button>
          )}
        </div>
        {editingBarcodes ? (
          <div className="space-y-2">
            <textarea
              className="w-full border rounded-md p-2 text-xs font-mono resize-none bg-background"
              rows={Math.max(3, barcodeInput.split("\n").length + 1)}
              value={barcodeInput}
              onChange={e => setBarcodeInput(e.target.value)}
              placeholder="One barcode per line"
            />
            <p className="text-xs text-muted-foreground">Enter one GTIN per line. Blank lines are ignored.</p>
            <div className="flex gap-2">
              <Button size="sm" className="h-7 text-xs" onClick={() => {
                const parsed = barcodeInput.split("\n").map(s => s.trim()).filter(Boolean);
                onBarcodesUpdate(parsed);
                setEditingBarcodes(false);
              }}>Save</Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditingBarcodes(false)}>Cancel</Button>
            </div>
          </div>
        ) : barcodes.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {barcodes.map(b => (
              <span key={b} className="font-mono text-xs bg-muted px-2 py-1 rounded">{b}</span>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground italic">No barcodes assigned. Click Edit to add.</p>
        )}
      </div>

      {/* Product info */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-2 pt-2 border-t">
        <div><span className="text-xs text-muted-foreground">SKU</span><p className="font-mono text-xs mt-0.5">{product.sku || "—"}</p></div>
        <div><span className="text-xs text-muted-foreground">Status</span><p className="text-xs mt-0.5 capitalize">{product.status}</p></div>
        <div><span className="text-xs text-muted-foreground">Type</span><p className="text-xs mt-0.5 capitalize">{product.type}</p></div>
        <div><span className="text-xs text-muted-foreground">Last synced</span><p className="text-xs mt-0.5">{product.lastSyncedAt ? new Date(product.lastSyncedAt).toLocaleDateString() : "—"}</p></div>
      </div>
    </div>
  );
}

// ─── Pricing Tab ───────────────────────────────────────────────────────────────────

function PricingRow({ v, fcTarget, onWebsitePriceSaved }: { v: SizeVariant; fcTarget: number; onWebsitePriceSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  // Default input to override if set, else flex sell price
  const [wpInput, setWpInput] = useState(
    v.websitePrice != null ? String(v.websitePrice) : v.sellPrice != null ? String(v.sellPrice) : ''
  );
  const { toast } = useToast();

  const wpMutation = useMutation({
    mutationFn: (price: number | null) =>
      apiRequest('PATCH', `/api/product-size-variants/${v.id}`, { websitePrice: price }).then(r => r.json()),
    onSuccess: () => { setEditing(false); onWebsitePriceSaved(); },
    onError: (e: any) => toast({ title: 'Save failed', description: e.message, variant: 'destructive' }),
  });

  // Effective website price: manual override > Flex sell price
  const effectiveWp = v.websitePrice ?? v.sellPrice ?? null;
  const isFlexDefault = v.websitePrice == null && v.sellPrice != null;
  const wpExGst = effectiveWp !== null ? effectiveWp / 1.1 : null;

  const cost = v.totalCost > 0 ? v.totalCost : null;

  // RRP back-calculated from cost at target FC% (inc GST)
  const rrp = cost !== null && fcTarget > 0 ? (cost / (fcTarget / 100)) * 1.1 : null;

  // GP and FC% based on effective website price
  const gp = wpExGst !== null && cost !== null ? wpExGst - cost : null;
  const gpPct = wpExGst && wpExGst > 0 && gp !== null ? (gp / wpExGst) * 100 : null;
  const fcPct = wpExGst && wpExGst > 0 && cost !== null ? (cost / wpExGst) * 100 : null;
  const gpColor = gpPct === null ? '' : gpPct >= 65 ? 'text-green-600' : gpPct >= 50 ? 'text-amber-600' : 'text-red-600';
  const label = v.attributesSummary || '(Individual / no size)';

  return (
    <tr className="border-b last:border-0 hover:bg-muted/30">
      <td className="py-2 pr-2 text-xs font-medium max-w-[150px] truncate" title={label}>{label}</td>
      {/* Website Price — editable override, defaults to Flex sell price */}
      <td className="py-2 px-2 text-right tabular-nums text-xs">
        {editing ? (
          <div className="flex items-center gap-1 justify-end">
            <span className="text-muted-foreground">$</span>
            <input
              type="number" step="0.01" min="0"
              value={wpInput}
              onChange={e => setWpInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') wpMutation.mutate(wpInput ? parseFloat(wpInput) : null);
                if (e.key === 'Escape') setEditing(false);
              }}
              className="w-16 border rounded px-1 py-0.5 text-xs text-right"
              autoFocus
            />
            <button onClick={() => wpMutation.mutate(wpInput ? parseFloat(wpInput) : null)} className="text-[#256984] hover:opacity-70">
              <Check size={12} />
            </button>
          </div>
        ) : (
          <button
            onClick={() => {
              setWpInput(v.websitePrice != null ? String(v.websitePrice) : v.sellPrice != null ? String(v.sellPrice) : '');
              setEditing(true);
            }}
            className="tabular-nums hover:text-[#256984] hover:underline cursor-pointer"
          >
            {effectiveWp != null ? (
              <span className={isFlexDefault ? 'text-muted-foreground' : ''}>
                ${effectiveWp.toFixed(2)}{isFlexDefault && <span className="ml-0.5 text-[10px]">↗</span>}
              </span>
            ) : (
              <span className="text-muted-foreground text-xs">— add</span>
            )}
          </button>
        )}
      </td>
      {/* RRP — back-calculated from cost at target FC% */}
      <td className="py-2 px-2 text-right tabular-nums text-xs">
        {rrp !== null ? `$${rrp.toFixed(2)}` : <span className="text-muted-foreground">—</span>}
      </td>
      {/* Cost */}
      <td className="py-2 px-2 text-right tabular-nums text-xs">
        {cost ? `$${cost.toFixed(2)}` : <span className="text-muted-foreground">—</span>}
      </td>
      {/* GP$ */}
      <td className={cn('py-2 px-2 text-right tabular-nums text-xs font-medium', gpColor)}>
        {gp !== null ? `$${gp.toFixed(2)}` : <span className="text-muted-foreground">—</span>}
      </td>
      {/* GP% */}
      <td className={cn('py-2 px-2 text-right tabular-nums text-xs font-semibold', gpColor)}>
        {gpPct !== null ? `${gpPct.toFixed(1)}%` : <span className="text-muted-foreground font-normal">—</span>}
      </td>
      {/* FC% */}
      <td className="py-2 pl-2 text-right tabular-nums text-xs">
        {fcPct !== null ? `${fcPct.toFixed(1)}%` : <span className="text-muted-foreground">—</span>}
      </td>
    </tr>
  );
}

function PricingTab({ productUuid }: { productUuid: string }) {
  const { data: variants, isLoading, refetch } = useQuery<SizeVariant[]>({
    queryKey: ["/api/product-size-variants", productUuid],
    queryFn: () =>
      apiRequest("GET", `/api/product-size-variants?product_uuid=${encodeURIComponent(productUuid)}`)
        .then(r => r.json()),
    enabled: !!productUuid,
  });

  const { data: settingsData } = useQuery<Record<string, string>>({
    queryKey: ["/api/settings"],
    queryFn: () => apiRequest("GET", "/api/settings").then(r => r.json()),
  });
  const fcTarget = parseFloat(settingsData?.target_food_cost_percent || "25");

  if (isLoading) return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
      <Loader2 size={14} className="animate-spin" /> Loading pricing…
    </div>
  );

  if (!variants || variants.length === 0) return (
    <div className="rounded-md bg-muted/40 p-4 text-sm text-muted-foreground">
      No size variants found. Sizes and prices are auto-populated from order history.
    </div>
  );

  const hasCosts = variants.some(v => v.totalCost > 0);
  const hasPrices = variants.some(v => v.sellPrice !== null);

  const sorted = [...variants].sort((a, b) => {
    const score = (s: string) => {
      const l = s.toLowerCase();
      if (l.includes('individual')) return 0;
      const m = l.match(/(\d+)\s*(person|pax|sandwiches|muffins)/i) || l.match(/[-–]\s*(\d+)/i) || l.match(/(\d+)/i);
      return m ? parseInt(m[1], 10) : 9999;
    };
    return score(a.attributesSummary) - score(b.attributesSummary);
  });

  return (
    <div className="space-y-3">
      {(!hasPrices || !hasCosts) && (
        <div className="rounded-md bg-blue-50 border border-blue-200 p-3 text-xs text-blue-700">
          {!hasPrices && !hasCosts
            ? 'Set up components in the Sizes tab to see costs. Flex sell prices sync automatically.'
            : !hasPrices
            ? "Flex sell prices will appear after the next sync."
            : 'Set up components in the Sizes tab to see cost and margin calculations.'}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <th className="text-left text-xs font-semibold text-muted-foreground py-2 pr-2">Size</th>
              <th className="text-right text-xs font-semibold text-muted-foreground py-2 px-2">Website Price</th>
              <th className="text-right text-xs font-semibold text-muted-foreground py-2 px-2">RRP (inc GST)</th>
              <th className="text-right text-xs font-semibold text-muted-foreground py-2 px-2">Cost</th>
              <th className="text-right text-xs font-semibold text-muted-foreground py-2 px-2">GP $</th>
              <th className="text-right text-xs font-semibold text-muted-foreground py-2 px-2">GP%</th>
              <th className="text-right text-xs font-semibold text-muted-foreground py-2 pl-2">FC%</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(v => (
              <PricingRow key={v.id} v={v} fcTarget={fcTarget} onWebsitePriceSaved={refetch} />
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">Website Price defaults to Flex sell price (↗); click to override. RRP is back-calculated at {fcTarget}% food cost target (inc GST). GP% and FC% are actuals based on website price. Change the FC% target in Settings.</p>
    </div>
  );
}

// ─── Sizes Tab ──────────────────────────────────────────────────────────────────────

function SizesTab({
  productUuid,
  recipes,
  subRecipes,
  ingredients,
}: {
  productUuid: string;
  recipes: Recipe[];
  subRecipes: SubRecipe[];
  ingredients: Ingredient[];
}) {
  const { data: variants, isLoading } = useQuery<SizeVariant[]>({
    queryKey: ["/api/product-size-variants", productUuid],
    queryFn: () =>
      apiRequest("GET", `/api/product-size-variants?product_uuid=${encodeURIComponent(productUuid)}`)
        .then(r => r.json()),
    enabled: !!productUuid,
  });

  // Sort variants: Individual first (size 1), then by person/pax count ascending, unknown last
  const sortedVariants = variants ? [...variants].sort((a, b) => {
    const sizeScore = (s: string) => {
      const lower = s.toLowerCase();
      if (lower.includes('individual')) return 0;
      const m = lower.match(/(\d+)\s*(person|pax|sandwiches|muffins|piece|pcs)/i)
        || lower.match(/[-–]\s*(\d+)\s*(person|pax)?/i)
        || lower.match(/(\d+)/i);
      return m ? parseInt(m[1], 10) : 9999;
    };
    return sizeScore(a.attributesSummary) - sizeScore(b.attributesSummary);
  }) : [];

  if (isLoading) return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
      <Loader2 size={14} className="animate-spin" /> Loading sizes…
    </div>
  );

  if (!variants || variants.length === 0) return (
    <div className="rounded-md bg-muted/40 p-4 text-sm text-muted-foreground">
      No size variants found for this product. Sizes are auto-populated from order history.
    </div>
  );

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground mb-3">
        {variants.length} size variant{variants.length !== 1 ? 's' : ''} — click a size to set its components (recipes, sub-recipes, packaging).
      </p>
      {sortedVariants.map(v => (
        <SizeVariantRow
          key={v.id}
          variant={v}
          recipes={recipes}
          subRecipes={subRecipes}
          ingredients={ingredients}
        />
      ))}
    </div>
  );
}

function ProductCard({
  product,
  recipes,
  subRecipes,
  ingredients,
  settings,
  initialCosting,
}: {
  product: FlexProduct;
  recipes: Recipe[];
  subRecipes: SubRecipe[];
  ingredients: Ingredient[];
  settings: Record<string, string>;
  initialCosting: FlexProductCosting | null;
}) {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);

  // Use bulk-loaded costing as initial data so the card header shows
  // cost/margin/mismatch immediately without needing to expand first.
  // When expanded, refetch fresh data in case it was updated this session.
  const { data: queriedCosting, isLoading: costingLoading } = useQuery<FlexProductCosting | null>({
    queryKey: ["/api/flex-products", product.id, "costing"],
    queryFn: () => apiRequest("GET", `/api/flex-products/${product.id}/costing`).then(r => r.json()),
    enabled: expanded,
  });
  // When collapsed, use the bulk-loaded initialCosting prop directly so the header
  // always reflects current data (TanStack Query doesn't update initialData after first render).
  const costing = expanded ? (queriedCosting ?? initialCosting) : initialCosting;

  const saveMutation = useMutation({
    mutationFn: (data: any) =>
      apiRequest("PUT", `/api/flex-products/${product.id}/costing`, data).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/flex-products", product.id, "costing"] });
      queryClient.invalidateQueries({ queryKey: ["/api/flex-products/costing-inconsistencies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/flex-products/costings/all"] });
      toast({ title: "Costing saved", description: product.name });
    },
    onError: (e: any) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  // Allergen codes always start with 'C' (CN, CD, CE, CS, CG, CX, CY, CU)
  // flex_dietaries_json from Flex contains a mix of both — split them here
  const ALLERGEN_CODES = new Set(['CN','CD','CE','CS','CG','CX','CY','CU']);
  const allFlexCodes = parseDietaries(product.flexDietariesJson);
  const flexDietaries = allFlexCodes.filter(c => !ALLERGEN_CODES.has(c));
  const flexDietariesAllergens = allFlexCodes.filter(c => ALLERGEN_CODES.has(c));
  // Allergens: combine from flex_allergens_json + any allergen codes inside flex_dietaries_json
  const flexAllergens = [...new Set([...parseAllergens(product.flexAllergensJson), ...flexDietariesAllergens])];

  // Computed dietaries/allergens from size variants (replaces old costing-based approach)
  const { data: variantDietaries } = useQuery<{ allergens: string[]; dietaries: string[]; hasComponents: boolean }>({
    queryKey: ["/api/product-size-variants/dietaries", product.flexUuid],
    queryFn: () => apiRequest("GET", `/api/product-size-variants/dietaries?product_uuid=${encodeURIComponent(product.flexUuid)}`).then(r => r.json()),
    enabled: !!product.flexUuid,
  });
  const computedDietaries = variantDietaries?.dietaries?.filter(c => !ALLERGEN_CODES.has(c)) ?? [];
  const computedAllergens = variantDietaries?.allergens ?? [];
  const hasCosting = variantDietaries?.hasComponents ?? false;
  // Mismatch: compare computed dietaries against what's live on Flex
  const computedAllJson = JSON.stringify([...computedDietaries, ...computedAllergens].sort());
  const hasMismatch = hasCosting && dietaryMismatch(product.flexDietariesJson, computedAllJson);
  const categories: { uuid: string; name: string }[] = (() => {
    try { return JSON.parse(product.categoriesJson || "[]"); } catch { return []; }
  })();

  return (
    <Card className={cn(
      "transition-all",
      hasMismatch && "border-red-300 dark:border-red-800"
    )} data-testid={`card-product-${product.id}`}>
      <CardHeader
        className="pb-2 pt-4 px-4 cursor-pointer select-none"
        onClick={() => setExpanded(x => !x)}
      >
        <div className="flex items-start gap-3">
          {/* Product image */}
          {product.imageUrl ? (
            <img
              src={product.imageUrl}
              alt={product.name}
              className="w-12 h-12 rounded-md object-cover shrink-0 bg-muted"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
          ) : (
            <div className="w-12 h-12 rounded-md bg-muted flex items-center justify-center shrink-0">
              <Package2 size={20} className="text-muted-foreground" />
            </div>
          )}

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <CardTitle className="text-sm font-semibold leading-tight">{product.name}</CardTitle>
              {hasMismatch && (
                <Badge variant="destructive" className="text-xs px-1.5 py-0 h-4 gap-0.5">
                  <AlertTriangle size={10} /> Dietary mismatch
                </Badge>
              )}
              {hasCosting && !hasMismatch && (
                <Badge variant="secondary" className="text-xs px-1.5 py-0 h-4 gap-0.5 text-green-700 dark:text-green-400 bg-green-100 dark:bg-green-900/30">
                  <CheckCircle2 size={10} /> Costed
                </Badge>
              )}
              {!hasCosting && (
                <Badge variant="outline" className="text-xs px-1.5 py-0 h-4 text-muted-foreground">
                  Not yet costed
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              {product.sku && (
                <span className="text-xs text-muted-foreground">SKU: {product.sku}</span>
              )}
              {(() => {
                const barcodes: string[] = (() => { try { return JSON.parse(product.barcodesJson || "[]"); } catch { return []; } })();
                return barcodes.length > 0 ? (
                  <span className="text-xs text-muted-foreground font-mono">
                    {barcodes.length === 1 ? barcodes[0] : `${barcodes[0]} +${barcodes.length - 1}`}
                  </span>
                ) : null;
              })()}
              {categories.slice(0, 2).map(c => (
                <span key={c.uuid} className="text-xs px-1.5 py-0.5 rounded-full"
                  style={{ backgroundColor: "#FCCDE2", color: "#256984", fontWeight: 600 }}>
                  {c.name}
                </span>
              ))}
            </div>
          </div>

          {/* Price & margin */}
          <div className="text-right shrink-0">
            <div className="text-sm font-bold tabular-nums">{fmt(product.price)}</div>
            {hasCosting && (
              <div className={cn("text-xs font-medium tabular-nums", marginColor(costing!.marginPercent))}>
                {pct(costing!.marginPercent)} margin
              </div>
            )}
          </div>

          <div className="shrink-0 text-muted-foreground">
            {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </div>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="pt-0 px-4 pb-4">
          <div className="border-t pt-4 mt-1">
            <Tabs defaultValue="sizes">
              <TabsList className="mb-4 h-8">
                <TabsTrigger value="sizes" className="text-xs h-7">Sizes</TabsTrigger>
                <TabsTrigger value="pricing" className="text-xs h-7">Pricing</TabsTrigger>
                <TabsTrigger value="dietaries" className="text-xs h-7">Dietaries</TabsTrigger>
                <TabsTrigger value="details" className="text-xs h-7">Details</TabsTrigger>
              </TabsList>

              <TabsContent value="sizes">
                <SizesTab
                  productUuid={product.flexUuid}
                  recipes={recipes}
                  subRecipes={subRecipes}
                  ingredients={ingredients}
                />
              </TabsContent>

              <TabsContent value="pricing">
                <PricingTab productUuid={product.flexUuid} />
              </TabsContent>

              <TabsContent value="dietaries">
                <div className="space-y-5 text-sm">

                  {/* No components set on any size variant */}
                  {!hasCosting && (
                    <div className="rounded-md bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 p-3">
                      <p className="text-xs text-amber-800 dark:text-amber-300 font-medium">
                        No components set yet — go to the <strong>Sizes</strong> tab and add recipes or ingredients to auto-compute dietaries and allergens.
                      </p>
                    </div>
                  )}

                  {/* ── DIETARIES ────────────────────────────────── */}
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Dietaries</p>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                      {/* Flex dietaries */}
                      <div>
                        <Label className="text-xs text-muted-foreground mb-1.5 block">On Flex Catering</Label>
                        <div className="flex flex-wrap gap-1.5">
                          {flexDietaries.length === 0
                            ? <span className="text-xs text-muted-foreground">None listed</span>
                            : flexDietaries.map(d => <DietaryBadge key={d} code={d} />)
                          }
                        </div>
                      </div>
                      {/* Computed dietaries — only show col when variants have components */}
                      {hasCosting && (
                        <div>
                          <Label className="text-xs text-muted-foreground mb-1.5 block">Computed from sizes</Label>
                          <div className="flex flex-wrap gap-1.5">
                            {computedDietaries.length === 0
                              ? <span className="text-xs text-muted-foreground">None detected</span>
                              : computedDietaries.map(d => <DietaryBadge key={d} code={d} />)
                            }
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {hasMismatch && (
                    <div className="rounded-md bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 p-3">
                      <p className="text-xs text-amber-800 dark:text-amber-300 font-medium flex items-center gap-1.5">
                        <AlertTriangle size={12} />
                        Mismatch — computed dietaries differ from what's live on Flex. Push to sync.
                      </p>
                    </div>
                  )}

                  {/* ── ALLERGENS ────────────────────────────────── */}
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Allergens</p>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                      {/* Flex allergens */}
                      <div>
                        <Label className="text-xs text-muted-foreground mb-1.5 block">On Flex Catering</Label>
                        <div className="flex flex-wrap gap-1.5">
                          {flexAllergens.length === 0
                            ? <span className="text-xs text-muted-foreground">None listed</span>
                            : FLEX_ALLERGEN_CODES
                                .filter(c => flexAllergens.includes(c))
                                .map(c => <DietaryBadge key={c} code={c} />)
                          }
                        </div>
                      </div>
                      {/* Computed allergens — only show col when variants have components */}
                      {hasCosting && (
                        <div>
                          <Label className="text-xs text-muted-foreground mb-1.5 block">Computed from sizes</Label>
                          <div className="flex flex-wrap gap-1.5">
                            {computedAllergens.length === 0
                              ? <span className="text-xs text-muted-foreground">None detected</span>
                              : FLEX_ALLERGEN_CODES
                                  .filter(c => computedAllergens.includes(c))
                                  .map(c => <DietaryBadge key={c} code={c} />)
                            }
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* ── Push to Flex ─────────────────────────────── */}
                  <PushToFlexButton
                    productId={product.id}
                    hasCosting={hasCosting}
                    hasMismatch={hasMismatch}
                    computedDietaries={computedDietaries}
                    computedAllergens={computedAllergens}
                    onSuccess={() => {
                      queryClient.invalidateQueries({ queryKey: ["/api/flex-products"] });
                      queryClient.invalidateQueries({ queryKey: ["/api/flex-products/costings/all"] });
                    }}
                  />
                </div>
              </TabsContent>

              {/* ── DETAILS TAB ─────────────────────────────── */}
              <TabsContent value="details">
                <DetailsTab product={product} onBarcodesUpdate={(barcodes) => {
                  apiRequest("PATCH", `/api/flex-products/${product.id}/barcodes`, { barcodes }).then(() => {
                    queryClient.invalidateQueries({ queryKey: ["/api/flex-products"] });
                  });
                }} />
              </TabsContent>

            </Tabs>
          </div>
        </CardContent>
      )}
    </Card>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Products() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("active");
  const [costingFilter, setCostingFilter] = useState<"all" | "costed" | "uncosted" | "mismatch">("all");

  const { data: products = [], isLoading, refetch } = useQuery<FlexProduct[]>({
    queryKey: ["/api/flex-products"],
    queryFn: () => apiRequest("GET", "/api/flex-products").then(r => r.json()),
  });

  const { data: recipes = [] } = useQuery<Recipe[]>({
    queryKey: ["/api/recipes"],
    queryFn: () => apiRequest("GET", "/api/recipes").then(r => r.json()),
  });

  const { data: subRecipes = [] } = useQuery<SubRecipe[]>({
    queryKey: ["/api/sub-recipes"],
    queryFn: () => apiRequest("GET", "/api/sub-recipes").then(r => r.json()),
  });

  const { data: ingredients = [] } = useQuery<Ingredient[]>({
    queryKey: ["/api/ingredients"],
    queryFn: () => apiRequest("GET", "/api/ingredients").then(r => r.json()),
  });

  const { data: settingsData = {} } = useQuery<Record<string, string>>({
    queryKey: ["/api/settings"],
    queryFn: () => apiRequest("GET", "/api/settings").then(r => r.json()),
  });

  const { data: inconsistencies } = useQuery<{ count: number; items: any[] }>({
    queryKey: ["/api/flex-products/costing-inconsistencies"],
    queryFn: () => apiRequest("GET", "/api/flex-products/costing-inconsistencies").then(r => r.json()),
  });

  // Bulk fetch ALL costings in one request so cards don't need to lazy-load
  const { data: allCostingsMap = {} } = useQuery<Record<number, FlexProductCosting>>({
    queryKey: ["/api/flex-products/costings/all"],
    queryFn: () => apiRequest("GET", "/api/flex-products/costings/all").then(r => r.json()),
    staleTime: 30 * 1000,
  });

  const syncMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/flex-products/sync").then(r => r.json()),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/flex-products"] });
      toast({ title: "Sync complete", description: `${data.synced} products synced from Flex.` });
    },
    onError: (e: any) => toast({ title: "Sync failed", description: e.message, variant: "destructive" }),
  });

  // Derive category list
  const allCategories = useMemo(() => {
    const cats = new Set<string>();
    for (const p of products) {
      try {
        const arr: { name: string }[] = JSON.parse(p.categoriesJson || "[]");
        arr.forEach(c => cats.add(c.name));
      } catch {}
    }
    return ["All", ...Array.from(cats).sort()];
  }, [products]);

  // Filter products
  const filtered = useMemo(() => {
    return products.filter(p => {
      if (statusFilter !== "all" && p.status !== statusFilter) return false;
      if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false;
      if (categoryFilter !== "All") {
        const cats: { name: string }[] = (() => { try { return JSON.parse(p.categoriesJson); } catch { return []; } })();
        if (!cats.some(c => c.name === categoryFilter)) return false;
      }
      return true;
    });
  }, [products, search, categoryFilter, statusFilter]);

  const lastSync = products.length > 0
    ? new Date(products[0].lastSyncedAt).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })
    : null;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2" style={{ color: "#256984" }}>
            <Store size={22} /> Products
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {products.length} products synced from Flex Catering
            {lastSync && ` · Last sync ${lastSync}`}
          </p>
        </div>
        <Button
          onClick={() => syncMutation.mutate()}
          disabled={syncMutation.isPending}
          style={{ backgroundColor: "#256984" }}
          data-testid="btn-sync-flex"
        >
          {syncMutation.isPending
            ? <><Loader2 size={14} className="mr-2 animate-spin" />Syncing…</>
            : <><RefreshCw size={14} className="mr-2" />Sync with Flex</>
          }
        </Button>
      </div>

      {/* Dietary inconsistency alert */}
      {inconsistencies && inconsistencies.count > 0 && (
        <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50/40 dark:bg-red-950/10 p-4 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-red-700 dark:text-red-400">
              {inconsistencies.count} product{inconsistencies.count !== 1 ? "s" : ""} with dietary inconsistencies
            </p>
            <p className="text-xs text-red-600 dark:text-red-500 mt-0.5">
              The dietaries computed from your recipes don't match what's listed on Flex Catering.
              Open each product below to review and correct.
            </p>
          </div>
        </div>
      )}

      {/* No products — prompt sync */}
      {!isLoading && products.length === 0 && (
        <div className="text-center py-16 space-y-4">
          <Store size={48} className="mx-auto text-muted-foreground/40" />
          <div>
            <p className="font-semibold text-muted-foreground">No products yet</p>
            <p className="text-sm text-muted-foreground mt-1">Click "Sync with Flex" to pull your products from Flex Catering.</p>
          </div>
          <Button onClick={() => syncMutation.mutate()} disabled={syncMutation.isPending}
            style={{ backgroundColor: "#256984" }}>
            {syncMutation.isPending
              ? <><Loader2 size={14} className="mr-2 animate-spin" />Syncing…</>
              : <><RefreshCw size={14} className="mr-2" />Sync Now</>
            }
          </Button>
        </div>
      )}

      {/* Filters */}
      {products.length > 0 && (
        <div className="flex items-center gap-3 flex-wrap">
          <Input
            placeholder="Search products…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="h-8 text-sm w-56"
            data-testid="input-product-search"
          />
          <select
            value={categoryFilter}
            onChange={e => setCategoryFilter(e.target.value)}
            className="h-8 text-sm rounded-md border border-input bg-background px-3 py-1"
            data-testid="select-category-filter"
          >
            {allCategories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="h-8 text-sm rounded-md border border-input bg-background px-3 py-1"
            data-testid="select-status-filter"
          >
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
          <span className="text-xs text-muted-foreground ml-auto">{filtered.length} shown</span>
        </div>
      )}

      {/* Product list */}
      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground py-8 justify-center">
          <Loader2 size={18} className="animate-spin" /> Loading products…
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(product => (
            <ProductCard
              key={product.id}
              product={product}
              recipes={recipes}
              subRecipes={subRecipes}
              ingredients={ingredients}
              settings={settingsData}
              initialCosting={allCostingsMap[product.id] ?? null}
            />
          ))}
          {filtered.length === 0 && products.length > 0 && (
            <div className="text-center py-8 text-muted-foreground text-sm">
              No products match your filters.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
