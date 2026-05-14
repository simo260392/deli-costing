import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Plus, Pencil, Trash2, ShoppingBasket, AlertTriangle, CheckCircle } from "lucide-react";
import { cn } from "@/lib/utils";

type Ingredient = { id: number; name: string; unit: string; bestCostPerUnit: number; };
type Recipe = { id: number; name: string; totalCost: number; };
type Platter = {
  id: number; name: string; category: string; description?: string; servings?: number;
  itemsJson: string; packagingJson: string;
  itemsCost: number; packagingCost: number; labourCost: number; totalCost: number;
  rrp: number | null; targetRrp: number; marginPercent: number; isActive: boolean;
};

function fmt(n: number | null | undefined) { return n != null ? `$${n.toFixed(2)}` : "—"; }
function pct(n: number | null | undefined) { return n != null ? `${n.toFixed(1)}%` : "—"; }

export default function Platters() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Platter | null>(null);
  const [form, setForm] = useState({ name: "", category: "Sandwich Platter", description: "", servings: "", labourCost: "0", rrp: "" });
  const [itemLines, setItemLines] = useState<any[]>([]);
  const [pkgLines, setPkgLines] = useState<any[]>([]);
  const [tab, setTab] = useState("items");

  const { data: platters = [], isLoading } = useQuery<Platter[]>({
    queryKey: ["/api/platters"],
    queryFn: () => apiRequest("GET", "/api/platters").then((r) => r.json()),
  });
  const { data: recipes = [] } = useQuery<Recipe[]>({
    queryKey: ["/api/recipes"],
    queryFn: () => apiRequest("GET", "/api/recipes").then((r) => r.json()),
  });
  const { data: ingredients = [] } = useQuery<Ingredient[]>({
    queryKey: ["/api/ingredients"],
    queryFn: () => apiRequest("GET", "/api/ingredients").then((r) => r.json()),
  });
  const { data: settingsData = {} } = useQuery({
    queryKey: ["/api/settings"],
    queryFn: () => apiRequest("GET", "/api/settings").then((r) => r.json()),
  });

  const markupPct = parseFloat(settingsData.markup_percent || "65");
  const targetFoodCost = parseFloat(settingsData.target_food_cost_percent || "30");

  const getRecipe = (id: number) => recipes.find((r) => r.id === id);
  const getIng = (id: number) => ingredients.find((i) => i.id === id);

  const previewItemsCost = itemLines.reduce((sum, l) => {
    if (l.type === "recipe") return sum + (getRecipe(l.id)?.totalCost || 0) * l.quantity;
    return sum + (getIng(l.id)?.bestCostPerUnit || 0) * l.quantity;
  }, 0);
  const previewPkgCost = pkgLines.reduce((sum, l) => sum + (getIng(l.ingredientId)?.bestCostPerUnit || 0) * l.quantity, 0);
  const previewLabour = parseFloat(form.labourCost) || 0;
  const previewTotal = previewItemsCost + previewPkgCost + previewLabour;
  const previewTargetRrp = markupPct > 0 ? previewTotal / (1 - markupPct / 100) : previewTotal;

  const upsert = useMutation({
    mutationFn: () => {
      const payload = {
        ...form,
        servings: form.servings ? parseInt(form.servings) : null,
        labourCost: parseFloat(form.labourCost) || 0,
        rrp: form.rrp ? parseFloat(form.rrp) : null,
        itemsJson: JSON.stringify(itemLines.map(({ type, id, quantity }) => ({ type, id, quantity }))),
        packagingJson: JSON.stringify(pkgLines.map(({ ingredientId, quantity }) => ({ ingredientId, quantity }))),
      };
      return editing
        ? apiRequest("PUT", `/api/platters/${editing.id}`, payload).then((r) => r.json())
        : apiRequest("POST", "/api/platters", payload).then((r) => r.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/platters"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      setOpen(false); resetForm();
      toast({ title: editing ? "Platter updated" : "Platter created" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const del = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/platters/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/platters"] }); queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] }); },
  });

  const resetForm = () => {
    setEditing(null); setItemLines([]); setPkgLines([]);
    setForm({ name: "", category: "Sandwich Platter", description: "", servings: "", labourCost: "0", rrp: "" });
    setTab("items");
  };

  const openEdit = (p: Platter) => {
    setEditing(p);
    setForm({ name: p.name, category: p.category, description: p.description || "", servings: p.servings ? String(p.servings) : "", labourCost: String(p.labourCost || 0), rrp: p.rrp ? String(p.rrp) : "" });
    const items = (JSON.parse(p.itemsJson || "[]") as any[]).map((l, i) => ({ ...l, _key: `${i}-${Date.now()}` }));
    const pkgs = (JSON.parse(p.packagingJson || "[]") as any[]).map((l, i) => ({ ...l, _key: `pkg-${i}-${Date.now()}` }));
    setItemLines(items);
    setPkgLines(pkgs);
    setOpen(true);
  };

  const addItem = (type: "recipe" | "ingredient") => {
    const source = type === "recipe" ? recipes : ingredients;
    if (source.length === 0) { toast({ title: `No ${type}s yet` }); return; }
    setItemLines([...itemLines, { type, id: source[0].id, quantity: 1, _key: `item-${Date.now()}` }]);
  };

  const PLATTER_CATS = ["Sandwich Platter", "Wrap Platter", "Salad Platter", "Grazing Platter", "Morning Tea", "Afternoon Tea", "Breakfast Pack", "Catering Pack", "Other"];

  return (
    <div className="p-6 space-y-5 max-w-screen-xl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground">Platters</h1>
          <p className="text-sm text-muted-foreground mt-1">Multi-item catering packs built from recipes and individual items.</p>
        </div>
        <Button onClick={() => { resetForm(); setOpen(true); }} size="sm" data-testid="button-add-platter">
          <Plus size={15} className="mr-1" /> New Platter
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">{[1,2,3].map((i) => <div key={i} className="skeleton h-14 rounded-md" />)}</div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/60 sticky top-0 z-10">
                <tr className="border-b border-border">
                  <th className="text-left px-4 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wider">Name</th>
                  <th className="text-left px-4 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wider">Category</th>
                  <th className="text-right px-4 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wider">Items Cost</th>
                  <th className="text-right px-4 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wider">Packaging</th>
                  <th className="text-right px-4 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wider">Labour</th>
                  <th className="text-right px-4 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wider">Total Cost</th>
                  <th className="text-right px-4 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wider">Target RRP</th>
                  <th className="text-right px-4 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wider">Your RRP</th>
                  <th className="text-left px-4 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wider">Margin</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {platters.length === 0 ? (
                  <tr><td colSpan={10} className="text-center py-10">
                    <ShoppingBasket size={28} className="mx-auto mb-2 text-muted-foreground" />
                    <p className="font-medium">No platters yet</p>
                    <button className="text-primary text-sm underline mt-1" onClick={() => { resetForm(); setOpen(true); }}>Create your first platter</button>
                  </td></tr>
                ) : (platters ?? []).map((p) => {
                  const hasIssue = p.rrp && p.totalCost > 0 && (p.totalCost / p.rrp) * 100 > targetFoodCost;
                  const margin = p.rrp ? ((p.rrp - p.totalCost) / p.rrp) * 100 : null;
                  return (
                    <tr key={p.id} className={cn("border-b border-border last:border-0 hover:bg-muted/30", hasIssue ? "bg-red-50/30 dark:bg-red-950/10" : "")} data-testid={`row-platter-${p.id}`}>
                      <td className="px-4 py-3 font-medium">{p.name}</td>
                      <td className="px-4 py-3"><Badge variant="outline" className="text-xs">{p.category}</Badge></td>
                      <td className="px-4 py-3 text-right tabular-nums">{fmt(p.itemsCost)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{fmt(p.packagingCost)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{fmt(p.labourCost)}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-semibold">{fmt(p.totalCost)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-primary font-medium">{fmt(p.targetRrp)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{p.rrp ? fmt(p.rrp) : <span className="text-muted-foreground text-xs">Not set</span>}</td>
                      <td className="px-4 py-3">
                        {margin !== null ? (
                          <Badge className={cn("text-xs", margin >= 50 ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400" : margin >= 30 ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400" : "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400")}>
                            {hasIssue ? <AlertTriangle size={10} className="mr-1" /> : <CheckCircle size={10} className="mr-1" />}
                            {pct(margin)}
                          </Badge>
                        ) : <span className="text-xs text-muted-foreground">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(p)} data-testid={`button-edit-platter-${p.id}`}><Pencil size={13} /></Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => del.mutate(p.id)} data-testid={`button-delete-platter-${p.id}`}><Trash2 size={13} /></Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Platter Builder Dialog */}
      <Dialog open={open} onOpenChange={(v) => { if (!v) resetForm(); setOpen(v); }}>
        <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? `Edit: ${editing.name}` : "New Platter"}</DialogTitle></DialogHeader>
          <div className="space-y-5 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 space-y-1.5">
                <Label>Platter Name *</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Assorted Sandwich Platter (serves 10)" data-testid="input-platter-name" />
              </div>
              <div className="space-y-1.5">
                <Label>Category</Label>
                <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{PLATTER_CATS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Servings</Label>
                <Input type="number" value={form.servings} onChange={(e) => setForm({ ...form, servings: e.target.value })} placeholder="e.g. 10" />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label>Description</Label>
                <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Contents, notes…" rows={2} />
              </div>
            </div>

            <Tabs value={tab} onValueChange={setTab}>
              <TabsList className="w-full">
                <TabsTrigger value="items" className="flex-1">Items ({itemLines.length})</TabsTrigger>
                <TabsTrigger value="packaging" className="flex-1">Packaging ({pkgLines.length})</TabsTrigger>
              </TabsList>

              <TabsContent value="items" className="pt-3 space-y-3">
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => addItem("recipe")} className="h-7 text-xs" data-testid="button-add-recipe-item">
                    <Plus size={12} className="mr-1" /> Add Recipe
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => addItem("ingredient")} className="h-7 text-xs" data-testid="button-add-ingredient-item">
                    <Plus size={12} className="mr-1" /> Add Ingredient
                  </Button>
                </div>
                <div className="space-y-2">
                  {itemLines.map((line) => {
                    const source = line.type === "recipe" ? recipes : ingredients;
                    const selected = source.find((s: any) => s.id === line.id) as any;
                    const costPer = line.type === "recipe" ? (selected?.totalCost || 0) : (selected?.bestCostPerUnit || 0);
                    const unit = line.type === "recipe" ? "portion" : selected?.unit || "";
                    return (
                      <div key={line._key} className="flex gap-2 items-end">
                        <Badge variant="outline" className="text-xs shrink-0 h-8 flex items-center">{line.type === "recipe" ? "Recipe" : "Ingredient"}</Badge>
                        <div className="flex-1">
                          <Select value={String(line.id)} onValueChange={(v) => setItemLines(itemLines.map((l) => l._key === line._key ? { ...l, id: parseInt(v) } : l))}>
                            <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {(line.type === "recipe" ? recipes : ingredients).map((s: any) => (
                                <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="w-24">
                          <Input type="number" step="1" min="1" className="h-8 text-sm" value={line.quantity || ""} placeholder="Qty"
                            onChange={(e) => setItemLines(itemLines.map((l) => l._key === line._key ? { ...l, quantity: parseFloat(e.target.value) || 0 } : l))} />
                        </div>
                        <div className="w-20 text-right text-sm tabular-nums">
                          ${(costPer * line.quantity).toFixed(2)}
                        </div>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive shrink-0"
                          onClick={() => setItemLines(itemLines.filter((l) => l._key !== line._key))}><Trash2 size={13} /></Button>
                      </div>
                    );
                  })}
                  {itemLines.length === 0 && <p className="text-xs text-muted-foreground py-3">Add recipes or individual ingredients to build this platter.</p>}
                </div>
              </TabsContent>

              <TabsContent value="packaging" className="pt-3 space-y-3">
                <Button variant="outline" size="sm" onClick={() => {
                  if (ingredients.length === 0) { toast({ title: "No ingredients yet" }); return; }
                  setPkgLines([...pkgLines, { ingredientId: ingredients[0].id, quantity: 1, _key: `pkg-${Date.now()}` }]);
                }} className="h-7 text-xs" data-testid="button-add-packaging-line">
                  <Plus size={12} className="mr-1" /> Add Packaging
                </Button>
                <div className="space-y-2">
                  {pkgLines.map((line) => {
                    const ing = getIng(line.ingredientId);
                    return (
                      <div key={line._key} className="flex gap-2 items-end">
                        <div className="flex-1">
                          <Select value={String(line.ingredientId)} onValueChange={(v) => setPkgLines(pkgLines.map((l) => l._key === line._key ? { ...l, ingredientId: parseInt(v) } : l))}>
                            <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                            <SelectContent>{(ingredients ?? []).map((i) => <SelectItem key={i.id} value={String(i.id)}>{i.name}</SelectItem>)}</SelectContent>
                          </Select>
                        </div>
                        <div className="w-24">
                          <Input type="number" step="1" min="1" className="h-8 text-sm" value={line.quantity || ""} placeholder="Qty"
                            onChange={(e) => setPkgLines(pkgLines.map((l) => l._key === line._key ? { ...l, quantity: parseFloat(e.target.value) || 0 } : l))} />
                        </div>
                        <div className="w-20 text-right text-sm tabular-nums">${((ing?.bestCostPerUnit || 0) * line.quantity).toFixed(2)}</div>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive shrink-0"
                          onClick={() => setPkgLines(pkgLines.filter((l) => l._key !== line._key))}><Trash2 size={13} /></Button>
                      </div>
                    );
                  })}
                  {pkgLines.length === 0 && <p className="text-xs text-muted-foreground py-3">Add packaging items — catering box, greaseproof paper, thermal labels, etc.</p>}
                </div>
              </TabsContent>
            </Tabs>

            {/* Labour & RRP */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Labour Cost ($)</Label>
                <Input type="number" step="0.01" value={form.labourCost} onChange={(e) => setForm({ ...form, labourCost: e.target.value })} placeholder="0.00" />
              </div>
              <div className="space-y-1.5">
                <Label>Your Selling RRP ($)</Label>
                <Input type="number" step="0.01" value={form.rrp} onChange={(e) => setForm({ ...form, rrp: e.target.value })} placeholder="Leave blank if not set" />
              </div>
            </div>

            {/* Cost Preview */}
            <div className="bg-muted/40 rounded-lg p-4 space-y-1">
              <p className="text-sm font-semibold mb-2">Cost Preview</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <span className="text-muted-foreground">Items</span><span className="text-right tabular-nums">{fmt(previewItemsCost)}</span>
                <span className="text-muted-foreground">Packaging</span><span className="text-right tabular-nums">{fmt(previewPkgCost)}</span>
                <span className="text-muted-foreground">Labour</span><span className="text-right tabular-nums">{fmt(previewLabour)}</span>
                <span className="font-semibold border-t border-border pt-2 mt-1">Total Cost</span>
                <span className="font-bold text-right tabular-nums border-t border-border pt-2 mt-1">{fmt(previewTotal)}</span>
                <span className="text-primary font-medium">Target RRP ({pct(markupPct)} markup)</span>
                <span className="text-primary font-bold text-right tabular-nums">{fmt(previewTargetRrp)}</span>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { resetForm(); setOpen(false); }}>Cancel</Button>
            <Button onClick={() => upsert.mutate({})} disabled={!form.name || upsert.isPending} data-testid="button-save-platter">
              {upsert.isPending ? "Saving…" : editing ? "Update Platter" : "Create Platter"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
