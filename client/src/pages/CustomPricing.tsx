import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem,
} from "@/components/ui/command";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import {
  Calculator, Plus, Trash2, ChevronDown, Check, Package, Tag,
  TrendingUp, DollarSign, Users, RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Ingredient = {
  id: number;
  name: string;
  category: string;
  unit: string;
  bestCostPerUnit: number;
};

type SubRecipe = {
  id: number;
  name: string;
  yieldUnit: string;
  costPerUnit: number;
};

type LineItem = {
  id: string;            // local uuid
  type: "ingredient" | "subrecipe";
  refId: number;
  name: string;
  unit: string;
  costPerUnit: number;
  qty: string;           // string so input stays editable
  isPackaging: boolean;
};

function uid() {
  return Math.random().toString(36).slice(2);
}

// ─── Ingredient / Sub-Recipe Picker ───────────────────────────────────────────
function ItemPicker({
  ingredients,
  subRecipes,
  onSelect,
  placeholder = "Search ingredient or sub-recipe…",
}: {
  ingredients: Ingredient[];
  subRecipes: SubRecipe[];
  onSelect: (item: { type: "ingredient" | "subrecipe"; refId: number; name: string; unit: string; costPerUnit: number }) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const filteredIngredients = ingredients.filter((i) =>
    i.name.toLowerCase().includes(search.toLowerCase())
  );
  const filteredSubRecipes = subRecipes.filter((s) =>
    s.name.toLowerCase().includes(search.toLowerCase())
  );

  const handleSelect = (type: "ingredient" | "subrecipe", id: number) => {
    if (type === "ingredient") {
      const ing = ingredients.find((i) => i.id === id);
      if (ing) onSelect({ type: "ingredient", refId: id, name: ing.name, unit: ing.unit, costPerUnit: ing.bestCostPerUnit });
    } else {
      const sr = subRecipes.find((s) => s.id === id);
      if (sr) onSelect({ type: "subrecipe", refId: id, name: sr.name, unit: sr.yieldUnit, costPerUnit: sr.costPerUnit });
    }
    setSearch("");
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className="w-full justify-between font-normal text-muted-foreground"
          data-testid="button-add-item"
        >
          <span className="flex items-center gap-2">
            <Plus size={14} />
            {placeholder}
          </span>
          <ChevronDown size={14} />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[380px] p-0" align="start">
        <Command>
          <CommandInput
            placeholder="Search…"
            value={search}
            onValueChange={setSearch}
          />
          {filteredIngredients.length === 0 && filteredSubRecipes.length === 0 && (
            <CommandEmpty>No results found.</CommandEmpty>
          )}
          {filteredIngredients.length > 0 && (
            <CommandGroup heading="Ingredients">
              {filteredIngredients.map((ing) => (
                <CommandItem
                  key={`ing-${ing.id}`}
                  value={`ing-${ing.id}-${ing.name}`}
                  onSelect={() => handleSelect("ingredient", ing.id)}
                  className="flex items-center justify-between"
                  data-testid={`picker-ing-${ing.id}`}
                >
                  <span>{ing.name}</span>
                  <span className="text-xs text-muted-foreground ml-2">
                    ${ing.bestCostPerUnit.toFixed(2)}/{ing.unit}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {filteredSubRecipes.length > 0 && (
            <CommandGroup heading="Sub-Recipes">
              {filteredSubRecipes.map((sr) => (
                <CommandItem
                  key={`sr-${sr.id}`}
                  value={`sr-${sr.id}-${sr.name}`}
                  onSelect={() => handleSelect("subrecipe", sr.id)}
                  className="flex items-center justify-between"
                  data-testid={`picker-sr-${sr.id}`}
                >
                  <span>{sr.name}</span>
                  <span className="text-xs text-muted-foreground ml-2">
                    ${sr.costPerUnit.toFixed(2)}/{sr.yieldUnit}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ─── Cost Summary Card ─────────────────────────────────────────────────────────
function SummaryCard({
  label, value, sub, highlight, icon: Icon, color,
}: {
  label: string;
  value: string;
  sub?: string;
  highlight?: boolean;
  icon: React.ElementType;
  color?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border p-4 flex flex-col gap-1 transition-all",
        highlight ? "border-primary bg-primary/5" : "bg-card"
      )}
    >
      <div className="flex items-center gap-2 text-xs text-muted-foreground font-medium uppercase tracking-wide">
        <Icon size={13} style={color ? { color } : undefined} />
        {label}
      </div>
      <div className={cn("text-2xl font-bold", highlight ? "text-primary" : "")}>
        {value}
      </div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────
export default function CustomPricing() {
  const [productName, setProductName] = useState("");
  const [servings, setServings] = useState("1");
  const [labourCost, setLabourCost] = useState("0");
  const [items, setItems] = useState<LineItem[]>([]);

  // Settings for markup/food cost %
  const { data: rawSettings } = useQuery<{ key: string; value: string }[]>({
    queryKey: ["/api/settings"],
    queryFn: () => apiRequest("GET", "/api/settings").then((r) => r.json()),
  });
  const settingsData = Array.isArray(rawSettings) ? rawSettings : [];

  const getSetting = (key: string, fallback: number) => {
    const s = settingsData.find((x) => x.key === key);
    return s ? parseFloat(s.value) || fallback : fallback;
  };

  const foodCostPct = getSetting("foodCostPercent", 30);   // target food cost %
  const markupPct   = getSetting("markupPercent", 65);     // markup %

  const { data: rawIngredients } = useQuery<Ingredient[]>({
    queryKey: ["/api/ingredients"],
    queryFn: () => apiRequest("GET", "/api/ingredients").then((r) => r.json()),
  });
  const ingredients = Array.isArray(rawIngredients) ? rawIngredients : [];

  const { data: rawSubRecipes } = useQuery<SubRecipe[]>({
    queryKey: ["/api/sub-recipes"],
    queryFn: () => apiRequest("GET", "/api/sub-recipes").then((r) => r.json()),
  });
  const subRecipes = Array.isArray(rawSubRecipes) ? rawSubRecipes : [];

  // ── Derived calculations ──────────────────────────────────────────────────
  const numServings = Math.max(1, parseFloat(servings) || 1);
  const numLabour   = parseFloat(labourCost) || 0;

  const ingredientLines  = items.filter((i) => !i.isPackaging);
  const packagingLines   = items.filter((i) => i.isPackaging);

  const ingredientCost = useMemo(() =>
    ingredientLines.reduce((sum, item) => {
      const qty = parseFloat(item.qty) || 0;
      return sum + qty * item.costPerUnit;
    }, 0),
    [ingredientLines]
  );

  const packagingCost = useMemo(() =>
    packagingLines.reduce((sum, item) => {
      const qty = parseFloat(item.qty) || 0;
      return sum + qty * item.costPerUnit;
    }, 0),
    [packagingLines]
  );

  const totalCost       = ingredientCost + packagingCost + numLabour;
  const costPerServing  = totalCost / numServings;

  // RRP using food cost % (cost-of-goods method):  RRP = (ingredients + packaging) / foodCostPct%
  // Then add labour on top (labour is not part of COGS for RRP calculation)
  const cogsForRrp      = ingredientCost + packagingCost;
  const rrpFromFoodCost = foodCostPct > 0 ? (cogsForRrp / (foodCostPct / 100)) : 0;

  // RRP using markup %: RRP = totalCost * (1 + markupPct%)
  const rrpFromMarkup   = totalCost * (1 + markupPct / 100);

  // Use the higher of the two (to ensure both thresholds are met)
  const suggestedRrp    = Math.max(rrpFromFoodCost, rrpFromMarkup);
  const rrpPerServing   = suggestedRrp / numServings;

  // Margin at suggested RRP
  const marginAtRrp     = suggestedRrp > 0 ? ((suggestedRrp - totalCost) / suggestedRrp) * 100 : 0;
  const actualFoodCostPct = suggestedRrp > 0 ? (cogsForRrp / suggestedRrp) * 100 : 0;

  // ── Handlers ──────────────────────────────────────────────────────────────
  const addItem = (
    selected: { type: "ingredient" | "subrecipe"; refId: number; name: string; unit: string; costPerUnit: number },
    isPackaging = false
  ) => {
    setItems((prev) => [
      ...prev,
      {
        id: uid(),
        type: selected.type,
        refId: selected.refId,
        name: selected.name,
        unit: selected.unit,
        costPerUnit: selected.costPerUnit,
        qty: "1",
        isPackaging,
      },
    ]);
  };

  const updateQty = (id: string, qty: string) => {
    setItems((prev) => prev.map((item) => item.id === id ? { ...item, qty } : item));
  };

  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  };

  const reset = () => {
    setProductName("");
    setServings("1");
    setLabourCost("0");
    setItems([]);
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Calculator size={20} className="text-primary" />
            Custom Product Pricing
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Build a one-off product cost and get instant RRP recommendations.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={reset}
          className="shrink-0"
          data-testid="button-reset"
        >
          <RefreshCw size={14} className="mr-1.5" />
          Reset
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-6">
        {/* ── Left column: inputs ── */}
        <div className="space-y-5">

          {/* Product details */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">Product Details</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="sm:col-span-1 space-y-1.5">
                <Label htmlFor="product-name">Product name (optional)</Label>
                <Input
                  id="product-name"
                  placeholder="e.g. Charcuterie Board"
                  value={productName}
                  onChange={(e) => setProductName(e.target.value)}
                  data-testid="input-product-name"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="servings">Number of servings</Label>
                <Input
                  id="servings"
                  type="text"
                  inputMode="decimal"
                  placeholder="1"
                  value={servings}
                  onChange={(e) => setServings(e.target.value)}
                  data-testid="input-servings"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="labour">Labour cost ($)</Label>
                <Input
                  id="labour"
                  type="text"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={labourCost}
                  onChange={(e) => setLabourCost(e.target.value)}
                  data-testid="input-labour"
                />
              </div>
            </CardContent>
          </Card>

          {/* Ingredients */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Package size={14} />
                Ingredients & Sub-Recipes
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {ingredientLines.length > 0 && (
                <div className="space-y-2">
                  {/* Header row */}
                  <div className="grid grid-cols-[1fr_90px_80px_70px_28px] gap-2 text-xs text-muted-foreground px-1">
                    <span>Item</span>
                    <span>Qty</span>
                    <span>Unit cost</span>
                    <span className="text-right">Line total</span>
                    <span />
                  </div>
                  {ingredientLines.map((item) => {
                    const qty = parseFloat(item.qty) || 0;
                    const lineTotal = qty * item.costPerUnit;
                    return (
                      <div
                        key={item.id}
                        className="grid grid-cols-[1fr_90px_80px_70px_28px] gap-2 items-center"
                        data-testid={`row-ingredient-${item.id}`}
                      >
                        <div className="min-w-0">
                          <span className="text-sm truncate block">{item.name}</span>
                          <span className="text-xs text-muted-foreground">
                            {item.type === "subrecipe" ? (
                              <Badge variant="outline" className="text-[10px] px-1 py-0 mr-1">sub-recipe</Badge>
                            ) : null}
                            {item.unit}
                          </span>
                        </div>
                        <Input
                          type="text"
                          inputMode="decimal"
                          className="h-8 text-sm"
                          value={item.qty}
                          onChange={(e) => updateQty(item.id, e.target.value)}
                          data-testid={`input-qty-${item.id}`}
                        />
                        <div className="text-sm text-muted-foreground text-right">
                          ${item.costPerUnit.toFixed(2)}
                        </div>
                        <div className="text-sm font-medium text-right">
                          ${lineTotal.toFixed(2)}
                        </div>
                        <button
                          onClick={() => removeItem(item.id)}
                          className="text-muted-foreground hover:text-destructive transition-colors"
                          data-testid={`button-remove-${item.id}`}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    );
                  })}
                  <Separator className="my-1" />
                  <div className="flex justify-end text-sm font-semibold pr-[38px]">
                    Subtotal: ${ingredientCost.toFixed(2)}
                  </div>
                </div>
              )}

              <ItemPicker
                ingredients={ingredients}
                subRecipes={subRecipes}
                onSelect={(sel) => addItem(sel, false)}
                placeholder="Add ingredient or sub-recipe…"
              />
            </CardContent>
          </Card>

          {/* Packaging */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Tag size={14} />
                Packaging
                <Badge variant="secondary" className="text-[10px] font-normal">included in COGS</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {packagingLines.length > 0 && (
                <div className="space-y-2">
                  <div className="grid grid-cols-[1fr_90px_80px_70px_28px] gap-2 text-xs text-muted-foreground px-1">
                    <span>Item</span>
                    <span>Qty</span>
                    <span>Unit cost</span>
                    <span className="text-right">Line total</span>
                    <span />
                  </div>
                  {packagingLines.map((item) => {
                    const qty = parseFloat(item.qty) || 0;
                    const lineTotal = qty * item.costPerUnit;
                    return (
                      <div
                        key={item.id}
                        className="grid grid-cols-[1fr_90px_80px_70px_28px] gap-2 items-center"
                        data-testid={`row-packaging-${item.id}`}
                      >
                        <div className="min-w-0">
                          <span className="text-sm truncate block">{item.name}</span>
                          <span className="text-xs text-muted-foreground">{item.unit}</span>
                        </div>
                        <Input
                          type="text"
                          inputMode="decimal"
                          className="h-8 text-sm"
                          value={item.qty}
                          onChange={(e) => updateQty(item.id, e.target.value)}
                          data-testid={`input-qty-pkg-${item.id}`}
                        />
                        <div className="text-sm text-muted-foreground text-right">
                          ${item.costPerUnit.toFixed(2)}
                        </div>
                        <div className="text-sm font-medium text-right">
                          ${lineTotal.toFixed(2)}
                        </div>
                        <button
                          onClick={() => removeItem(item.id)}
                          className="text-muted-foreground hover:text-destructive transition-colors"
                          data-testid={`button-remove-pkg-${item.id}`}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    );
                  })}
                  <Separator className="my-1" />
                  <div className="flex justify-end text-sm font-semibold pr-[38px]">
                    Subtotal: ${packagingCost.toFixed(2)}
                  </div>
                </div>
              )}

              <ItemPicker
                ingredients={ingredients.filter((i) => i.category === "Packaging")}
                subRecipes={[]}
                onSelect={(sel) => addItem(sel, true)}
                placeholder="Add packaging item…"
              />
            </CardContent>
          </Card>
        </div>

        {/* ── Right column: summary ── */}
        <div className="space-y-4">
          <Card className="sticky top-4">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Calculator size={14} />
                {productName ? `"${productName}" — ` : ""}Cost Summary
              </CardTitle>
              {numServings > 1 && (
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Users size={11} />
                  {numServings} serving{numServings !== 1 ? "s" : ""}
                </div>
              )}
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Cost breakdown */}
              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Ingredients</span>
                  <span className="font-medium">${ingredientCost.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Packaging</span>
                  <span className="font-medium">${packagingCost.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Labour</span>
                  <span className="font-medium">${numLabour.toFixed(2)}</span>
                </div>
                <Separator />
                <div className="flex justify-between font-semibold">
                  <span>Total cost</span>
                  <span>${totalCost.toFixed(2)}</span>
                </div>
                {numServings > 1 && (
                  <div className="flex justify-between text-muted-foreground text-xs">
                    <span>Cost per serving</span>
                    <span>${costPerServing.toFixed(2)}</span>
                  </div>
                )}
              </div>

              <Separator />

              {/* RRP recommendation */}
              <div className="space-y-3">
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  RRP Recommendation
                </div>

                <SummaryCard
                  label="Suggested RRP (total)"
                  value={`$${suggestedRrp.toFixed(2)}`}
                  sub={`Based on ${foodCostPct}% COGS / ${markupPct}% markup — whichever is higher`}
                  highlight
                  icon={DollarSign}
                />

                {numServings > 1 && (
                  <SummaryCard
                    label="RRP per serving"
                    value={`$${rrpPerServing.toFixed(2)}`}
                    sub={`÷ ${numServings} servings`}
                    icon={Users}
                  />
                )}

                <SummaryCard
                  label="Gross margin"
                  value={`${marginAtRrp.toFixed(1)}%`}
                  sub={`COGS is ${actualFoodCostPct.toFixed(1)}% of RRP (target: ≤${foodCostPct}%)`}
                  icon={TrendingUp}
                  color={actualFoodCostPct <= foodCostPct ? "#22c55e" : "#f59e0b"}
                />
              </div>

              {/* Explanation */}
              <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground space-y-1.5 mt-2">
                <p className="font-medium text-foreground">How RRP is calculated</p>
                <p>
                  <span className="font-medium">COGS method:</span> (Ingredients + Packaging) ÷ {foodCostPct}%
                  = ${rrpFromFoodCost.toFixed(2)}
                </p>
                <p>
                  <span className="font-medium">Markup method:</span> Total cost × (1 + {markupPct}%)
                  = ${rrpFromMarkup.toFixed(2)}
                </p>
                <p>The higher of the two is used as the suggested RRP.</p>
              </div>

              {/* Round up helper */}
              {suggestedRrp > 0 && (
                <div className="pt-1 space-y-1">
                  <div className="text-xs font-medium text-muted-foreground">Round up to</div>
                  <div className="flex flex-wrap gap-2">
                    {[0.5, 1, 2, 5].map((step) => {
                      const rounded = Math.ceil(rrpPerServing > 0 ? rrpPerServing / step : suggestedRrp / step) * step;
                      const label = rrpPerServing > 0 ? `$${rounded.toFixed(2)}/serve` : `$${rounded.toFixed(2)}`;
                      return (
                        <Badge
                          key={step}
                          variant="outline"
                          className="cursor-default text-xs"
                          data-testid={`badge-rounded-${step}`}
                        >
                          {label}
                        </Badge>
                      );
                    })}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
