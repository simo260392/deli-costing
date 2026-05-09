import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  UtensilsCrossed, Package, Truck, TrendingUp,
  AlertTriangle, CheckCircle, ArrowRight, RefreshCw, FlaskConical, Sparkles
} from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

function fmt(n: number | null | undefined) {
  if (n == null) return "—";
  return `$${n.toFixed(2)}`;
}

function pct(n: number | null | undefined) {
  if (n == null) return "—";
  return `${n.toFixed(1)}%`;
}

function FoodCostBadge({ totalCost, rrp, target }: { totalCost: number; rrp: number | null; target: number }) {
  if (!rrp) return <Badge variant="outline" className="text-xs">No RRP set</Badge>;
  const fc = (totalCost / rrp) * 100;
  const ok = fc <= target;
  return (
    <Badge className={cn("text-xs tabular-nums", ok ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400" : "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400")}>
      {ok ? <CheckCircle size={10} className="mr-1" /> : <AlertTriangle size={10} className="mr-1" />}
      {pct(fc)} FC
    </Badge>
  );
}

function MarginBadge({ rrp, totalCost }: { rrp: number | null; totalCost: number }) {
  if (!rrp) return <span className="text-muted-foreground text-sm">—</span>;
  const margin = ((rrp - totalCost) / rrp) * 100;
  return (
    <span className={cn("tabular-nums text-sm font-medium", margin >= 50 ? "success-text" : margin >= 30 ? "warning-text" : "error-text")}>
      {pct(margin)}
    </span>
  );
}

type NutritionIssue = {
  ingredientId: number;
  ingredientName: string;
  usedIn: { type: string; name: string; id: number }[];
};

function NutritionIssuesPanel({ issues }: { issues: NutritionIssue[] }) {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [resolving, setResolving] = useState<number | null>(null);

  const autoFillOne = useMutation({
    mutationFn: (id: number) => {
      setResolving(id);
      return apiRequest("POST", `/api/ingredients/${id}/auto-nutrition`).then(r => r.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ingredients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recipes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/platters"] });
      setResolving(null);
    },
    onError: (e: any) => {
      toast({ title: "Error", description: e.message, variant: "destructive" });
      setResolving(null);
    },
  });

  const autoFillAll = useMutation({
    mutationFn: () => apiRequest("POST", "/api/ingredients/auto-nutrition-bulk").then(r => r.json()),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ingredients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recipes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/platters"] });
      toast({ title: `Nutrition filled`, description: `${data.updated} of ${data.total} ingredients updated.` });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const visible = expanded ? issues : issues.slice(0, 5);

  return (
    <Card className="border-blue-200 dark:border-blue-800 bg-blue-50/40 dark:bg-blue-950/10">
      <CardHeader className="pb-2 pt-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-sm font-semibold text-primary flex items-center gap-2">
            <FlaskConical size={16} />
            {issues.length} ingredient{issues.length !== 1 ? "s" : ""} missing nutrition data
          </CardTitle>
          <Button
            size="sm" variant="outline"
            className="h-7 text-xs gap-1 border-primary text-primary hover:bg-primary/10"
            onClick={() => autoFillAll.mutate()}
            disabled={autoFillAll.isPending}
            data-testid="button-fill-all-nutrition"
          >
            <Sparkles size={12} />{autoFillAll.isPending ? "Calculating…" : "AI Fill All"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          Nutrition panels in the Product Info PDF need per-100g values for each ingredient. Click AI Fill to estimate automatically.
        </p>
      </CardHeader>
      <CardContent className="pb-4">
        <div className="space-y-1.5">
          {visible.map((issue) => (
            <div key={issue.ingredientId} className="flex items-center justify-between gap-3 text-sm rounded px-2 py-1.5 bg-background border border-border">
              <div className="min-w-0">
                <p className="font-medium truncate">{issue.ingredientName}</p>
                <p className="text-xs text-muted-foreground truncate">
                  Used in: {issue.usedIn.map(u => u.name).join(", ")}
                </p>
              </div>
              <Button
                size="sm" variant="outline"
                className="h-7 text-xs gap-1 shrink-0"
                onClick={() => autoFillOne.mutate(issue.ingredientId)}
                disabled={resolving === issue.ingredientId || autoFillOne.isPending}
                data-testid={`button-fill-nutrition-${issue.ingredientId}`}
              >
                <Sparkles size={11} />{resolving === issue.ingredientId ? "…" : "AI Fill"}
              </Button>
            </div>
          ))}
        </div>
        {issues.length > 5 && (
          <button
            className="text-xs text-primary mt-2 hover:underline"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? "Show less" : `Show ${issues.length - 5} more…`}
          </button>
        )}
      </CardContent>
    </Card>
  );
}

export default function Dashboard() {
  const { data: summary, isLoading: loadingSummary } = useQuery({
    queryKey: ["/api/dashboard"],
    queryFn: () => apiRequest("GET", "/api/dashboard").then((r) => r.json()),
  });

  const { data: recipes = [], isLoading: loadingRecipes } = useQuery({
    queryKey: ["/api/recipes"],
    queryFn: () => apiRequest("GET", "/api/recipes").then((r) => r.json()),
  });

  const { data: platters = [], isLoading: loadingPlatters } = useQuery({
    queryKey: ["/api/platters"],
    queryFn: () => apiRequest("GET", "/api/platters").then((r) => r.json()),
  });

  const { data: settingsData = {} } = useQuery({
    queryKey: ["/api/settings"],
    queryFn: () => apiRequest("GET", "/api/settings").then((r) => r.json()),
  });

  const { data: dietaryInconsistencies } = useQuery<{ count: number; items: any[] }>({
    queryKey: ["/api/flex-products/costing-inconsistencies"],
    queryFn: () => apiRequest("GET", "/api/flex-products/costing-inconsistencies").then((r) => r.json()),
    refetchInterval: 5 * 60 * 1000,
  });

  const targetFoodCost = parseFloat(settingsData.target_food_cost_percent || "30");
  const markupPct = parseFloat(settingsData.markup_percent || "65");

  const allItems = [
    // Recipes: use foodCostPerServe (ingredients/sub-recipes/packaging only, no labour) — same as Recipes page FC% badge
    ...recipes.filter((r: any) => r.isActive).map((r: any) => ({ ...r, _type: "Recipe", _displayCost: r.foodCostPerServe ?? r.costPerServe ?? r.totalCost })),
    // Platters: totalCost is already per-platter (1 platter = 1 RRP unit)
    ...platters.filter((p: any) => p.isActive).map((p: any) => ({ ...p, _type: "Product", _displayCost: p.totalCost })),
  ];

  const underperforming = allItems.filter((item: any) => {
    if (!item.rrp || item._displayCost === 0) return false;
    return (item._displayCost / item.rrp) * 100 > targetFoodCost;
  });

  const loading = loadingSummary || loadingRecipes || loadingPlatters;

  return (
    <div className="p-6 space-y-6 max-w-screen-xl">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-foreground" style={{ fontFamily: "'Cabinet Grotesk', sans-serif" }}>
          Product Costing Dashboard
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Live costing & RRP across all menu items — target food cost: <strong>{pct(targetFoodCost)}</strong> · markup: <strong>{pct(markupPct)}</strong>
        </p>
      </div>

      {/* KPI Cards — clickable shortcuts */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          {
            label: "Ingredients", value: loading ? "—" : summary?.totalIngredients ?? 0,
            icon: Package, href: "/ingredients", color: "text-primary"
          },
          {
            label: "Suppliers", value: loading ? "—" : summary?.totalSuppliers ?? 0,
            icon: Truck, href: "/suppliers", color: "text-primary"
          },
          {
            label: "Recipes", value: loading ? "—" : summary?.totalRecipes ?? 0,
            icon: UtensilsCrossed, href: "/recipes", color: "text-primary"
          },
          {
            label: "Below Target", value: loading ? "—" : underperforming.length,
            icon: AlertTriangle, href: "scroll:items-table",
            color: underperforming.length > 0 ? "text-destructive" : "text-primary"
          },
        ].map(({ label, value, icon: Icon, href, color }) => {
          const isScroll = href.startsWith("scroll:");
          const scrollId = isScroll ? href.replace("scroll:", "") : null;

          const cardInner = (
            <CardContent className="pt-4 pb-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">{label}</p>
                  <p className={cn("text-2xl font-bold tabular-nums mt-1", color)}>{value}</p>
                </div>
                <Icon size={20} className={cn("mt-1", color)} />
              </div>
            </CardContent>
          );

          return (
            <Card
              key={label}
              className="cursor-pointer hover:shadow-md transition-shadow hover:border-primary/40"
              data-testid={`kpi-${label.toLowerCase().replace(/\s+/g, "-")}`}
            >
              {isScroll ? (
                <div onClick={() => document.getElementById(scrollId!)?.scrollIntoView({ behavior: "smooth" })}>
                  {cardInner}
                </div>
              ) : (
                <Link href={href}>
                  {cardInner}
                </Link>
              )}
            </Card>
          );
        })}
      </div>

      {/* Invoice Pending Matches */}
      {summary?.pendingXeroCount > 0 && (
        <Link href="/xero-imports">
          <Card className="border-amber-200 dark:border-amber-800 bg-amber-50/40 dark:bg-amber-950/10 cursor-pointer hover:shadow-md transition-shadow hover:border-amber-400">
            <CardContent className="py-4 px-5">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="rounded-full bg-amber-100 dark:bg-amber-900/40 p-2">
                    <RefreshCw size={16} className="text-amber-600 dark:text-amber-400" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">
                      {summary.pendingXeroCount} invoice{summary.pendingXeroCount !== 1 ? "s" : ""} awaiting review
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Match bills to ingredients, add new ingredients, or ignore — click to review
                    </p>
                  </div>
                </div>
                <ArrowRight size={16} className="text-muted-foreground shrink-0" />
              </div>
            </CardContent>
          </Card>
        </Link>
      )}

      {/* Dietary Inconsistency Alert */}
      {dietaryInconsistencies && dietaryInconsistencies.count > 0 && (
        <Link href="/products">
          <Card className="border-red-200 dark:border-red-800 bg-red-50/40 dark:bg-red-950/10 cursor-pointer hover:shadow-md transition-shadow hover:border-red-400">
            <CardContent className="py-4 px-5">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="rounded-full bg-red-100 dark:bg-red-900/40 p-2">
                    <AlertTriangle size={16} className="text-red-600 dark:text-red-400" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">
                      {dietaryInconsistencies.count} product{dietaryInconsistencies.count !== 1 ? "s" : ""} with dietary inconsistencies
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Computed dietaries don't match Flex Catering — click to review
                    </p>
                  </div>
                </div>
                <ArrowRight size={16} className="text-muted-foreground shrink-0" />
              </div>
            </CardContent>
          </Card>
        </Link>
      )}

      {/* Nutrition Issues Panel */}
      {summary?.nutritionIssues?.length > 0 && (
        <NutritionIssuesPanel issues={summary.nutritionIssues} />
      )}

      {/* Underperforming alert */}
      {underperforming.length > 0 && (
        <Card className="border-red-200 dark:border-red-900 bg-red-50/40 dark:bg-red-950/10">
          <CardHeader className="pb-2 pt-4">
            <CardTitle className="text-sm font-semibold text-destructive flex items-center gap-2">
              <AlertTriangle size={16} /> {underperforming.length} item{underperforming.length > 1 ? "s" : ""} not meeting target food cost
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            <ul className="space-y-1">
              {underperforming.map((item: any) => {
                const fc = ((item._displayCost / item.rrp) * 100).toFixed(1);
                return (
                  <li key={`${item._type}-${item.id}`} className="flex justify-between text-sm">
                    <span className="text-foreground">{item.name} <span className="text-muted-foreground text-xs">({item._type})</span></span>
                    <span className="error-text font-medium tabular-nums">{fc}% FC (target: {pct(targetFoodCost)})</span>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
