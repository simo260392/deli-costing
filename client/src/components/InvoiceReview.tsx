// Review a read invoice: pick the supplier, decide what each line is, confirm pack sizes,
// then approve. Approving saves the supplier's product (code, wording, brand, pack size),
// records the price, sets the ingredient to the latest price paid and refreshes recipe costs.
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, Check, ChevronsUpDown, Plus, Loader2, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

type Suggestion = { ingredientId: number; name: string; unit: string; score: number; why: string };
export type ReviewLine = {
  id: number; line_no: number; line_type: string; supplier_code: string | null; description: string; brand: string | null;
  generic_name: string | null; item_type: string | null;
  quantity: number | null; purchase_unit: string | null; units_per_purchase: number | null; unit_size: number | null; unit_size_uom: string | null;
  priced_by_weight: boolean; unit_price_ex_gst: number | null; discount_ex_gst: number | null; line_total_ex_gst: number | null;
  base_qty: number | null; unit_cost: number | null; needs_pack_size: boolean; merged_from: number[] | null;
  status: string; notes: string | null; ingredient_id: number | null; supplier_product_id: number | null;
  match_method: string | null; match_confidence: number | null; suggestions: Suggestion[] | null; warnings: string[] | null;
  price_change_pct: number | null; ingredient_units_per_base: number | null;
};
type Ingredient = { id: number; name: string; unit: string; category: string; bestCostPerUnit: number | null; avgWeightPerUnit: number | null };
type Supplier = { id: number; name: string };
type Uom = "kg" | "L" | "each";
type Decision = {
  action: "match" | "new" | "skip" | "personal" | null;
  ingredientId?: number;
  newName?: string; newUnit?: Uom; newCategory?: string;
  itemType?: string;
  brand?: string | null;
  packSize?: string; packUom?: Uom;      // only when the invoice doesn't give the pack size
  factor?: string;                       // ingredient units in one base unit, when units differ
};

const money = (n: number | null | undefined, dp = 2) => (n === null || n === undefined || !Number.isFinite(n) ? "—" : `$${n.toFixed(dp)}`);
const smart = (n: number) => money(n, n < 1 ? 4 : 2);
const num = (s: string | undefined) => { const n = Number(s); return s !== undefined && s !== "" && Number.isFinite(n) && n > 0 ? n : null; };
const titleCase = (s: string) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

/** Same rule as the server: how many ingredient units are in one base unit of the line. */
function defaultFactor(lineUom: string | null, ing: { unit: string; avgWeightPerUnit: number | null }): number | null {
  const iu = (ing.unit || "").toLowerCase(), lu = (lineUom || "").toLowerCase();
  if (!lu) return null;
  if (iu === lu) return 1;
  if (iu === "g" && lu === "kg") return 1000;
  if (iu === "ml" && lu === "l") return 1000;
  if ((iu === "l" && lu === "kg") || (iu === "kg" && lu === "l")) return 1;
  if (iu === "each" && lu === "kg" && ing.avgWeightPerUnit) return 1000 / ing.avgWeightPerUnit;
  if (iu === "kg" && lu === "each" && ing.avgWeightPerUnit) return ing.avgWeightPerUnit / 1000;
  return null;
}

function IngredientPicker({ value, suggestions, ingredients, onPick, onNew }: {
  value: number | undefined; suggestions: Suggestion[]; ingredients: Ingredient[]; onPick: (id: number) => void; onNew: () => void;
}) {
  const [open, setOpen] = useState(false);
  const current = ingredients.find((i) => i.id === value);
  const suggestedIds = new Set(suggestions.map((s) => s.ingredientId));
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" className="w-full justify-between font-normal h-9" data-testid="button-pick-ingredient">
          <span className={cn("truncate", !current && "text-muted-foreground")}>{current ? `${current.name} (${current.unit})` : "Choose ingredient…"}</span>
          <ChevronsUpDown size={14} className="opacity-50 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[min(420px,90vw)]" align="start">
        <Command filter={(v, search) => (v.toLowerCase().includes(search.toLowerCase()) ? 1 : 0)}>
          <CommandInput placeholder="Search ingredients…" />
          <CommandList className="max-h-72">
            <CommandEmpty>No ingredient found.</CommandEmpty>
            <CommandGroup>
              <CommandItem value="+ new ingredient" onSelect={() => { setOpen(false); onNew(); }}>
                <Plus size={14} className="mr-2" />New ingredient…
              </CommandItem>
            </CommandGroup>
            {suggestions.length > 0 && (
              <CommandGroup heading="Suggested">
                {suggestions.map((s) => (
                  <CommandItem key={`s${s.ingredientId}`} value={`suggested ${s.name} ${s.ingredientId}`} onSelect={() => { onPick(s.ingredientId); setOpen(false); }}>
                    <Check size={14} className={cn("mr-2", value === s.ingredientId ? "opacity-100" : "opacity-0")} />
                    <span className="flex-1">{s.name} <span className="text-muted-foreground">({s.unit})</span></span>
                    <span className="text-xs text-muted-foreground">{Math.round(s.score * 100)}%</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            <CommandGroup heading="All ingredients">
              {ingredients.filter((i) => !suggestedIds.has(i.id)).map((i) => (
                <CommandItem key={i.id} value={`${i.name} ${i.category} ${i.id}`} onSelect={() => { onPick(i.id); setOpen(false); }}>
                  <Check size={14} className={cn("mr-2", value === i.id ? "opacity-100" : "opacity-0")} />
                  {i.name} <span className="text-muted-foreground ml-1">({i.unit})</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export default function InvoiceReview({ invoice, lines, onChanged }: {
  invoice: { id: number; supplier_id: number | null; detected_supplier_name: string | null; xero_contact_name?: string | null };
  lines: ReviewLine[];
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const { data: ingredients = [] } = useQuery<Ingredient[]>({ queryKey: ["/api/ingredients"] });
  const { data: suppliers = [] } = useQuery<Supplier[]>({ queryKey: ["/api/suppliers"] });
  const categories = useMemo(() => Array.from(new Set(ingredients.map((i) => i.category).filter(Boolean))).sort(), [ingredients]);
  const ingById = useMemo(() => new Map(ingredients.map((i) => [i.id, i])), [ingredients]);
  const products = lines.filter((l) => l.line_type === "product" || l.line_type === "personal");
  const others = lines.filter((l) => !["product", "personal"].includes(l.line_type));

  const [decisions, setDecisions] = useState<Record<number, Decision>>({});
  const [newSupplierName, setNewSupplierName] = useState(invoice.detected_supplier_name || invoice.xero_contact_name || "");
  const [busy, setBusy] = useState(false);

  // Start each line from what the matcher found
  useEffect(() => {
    setDecisions((prev) => {
      const next: Record<number, Decision> = {};
      for (const l of products) {
        if (prev[l.id]) { next[l.id] = prev[l.id]; continue; }
        next[l.id] = l.line_type === "personal" || l.status === "skipped"
          ? { action: "personal" }
          : l.ingredient_id ? { action: "match", ingredientId: l.ingredient_id, itemType: l.item_type || undefined, brand: l.brand } : { action: null, itemType: l.item_type || undefined, brand: l.brand };
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines.map((l) => `${l.id}:${l.ingredient_id}:${l.status}`).join(",")]);

  // Invoices read before matching existed have no suggestions yet: work them out once.
  const needsMatching = !!invoice.supplier_id && products.some((l) => l.status === "pending" && l.suggestions === null);
  useEffect(() => {
    if (!needsMatching) return;
    apiRequest("POST", `/api/supplier-invoices/${invoice.id}/match`, {}).then(onChanged).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsMatching, invoice.id]);

  const set = (id: number, patch: Partial<Decision>) => setDecisions((d) => ({ ...d, [id]: { ...d[id], ...patch } }));

  // Work out the price per ingredient unit for a line with the current decision
  function costFor(l: ReviewLine, d: Decision) {
    const pack = num(d.packSize);
    const baseQty = pack && l.quantity ? l.quantity * pack : l.base_qty;
    const lineUom = d.packUom || (l.priced_by_weight ? "kg" : l.unit_size_uom);
    const ing = d.action === "match" && d.ingredientId ? ingById.get(d.ingredientId) : d.action === "new" ? { unit: d.newUnit || (lineUom as Uom) || "each", avgWeightPerUnit: null, bestCostPerUnit: null, name: d.newName || "" } : undefined;
    const fromMatcher = !d.packUom && l.ingredient_units_per_base && d.ingredientId === l.ingredient_id ? Number(l.ingredient_units_per_base) : null;
    const factor = num(d.factor) ?? fromMatcher ?? (ing ? defaultFactor(lineUom, ing as any) : null) ?? (d.action === "new" ? 1 : null);
    const unitCost = baseQty && l.line_total_ex_gst !== null ? l.line_total_ex_gst / baseQty : null;
    const ingCost = unitCost !== null && factor ? unitCost / factor : null;
    return { baseQty, lineUom, ing, factor, ingCost, needsPack: !baseQty, needsFactor: !!ing && !factor };
  }

  const problems = products.map((l) => {
    const d = decisions[l.id];
    if (!d?.action) return "choose what it is";
    if (d.action === "skip" || d.action === "personal") return null;
    if (d.action === "match" && !d.ingredientId) return "choose an ingredient";
    if (d.action === "new" && !d.newName?.trim()) return "name the new ingredient";
    const c = costFor(l, d);
    if (c.needsPack) return "enter the pack size";
    if (c.needsFactor) return "set the unit conversion";
    return null;
  });
  const outstanding = problems.filter(Boolean).length;

  const pickSupplier = async (supplierId: number) => {
    setBusy(true);
    try { await apiRequest("PATCH", `/api/supplier-invoices/${invoice.id}/supplier`, { supplierId }); onChanged(); }
    catch (e: any) { toast({ title: "Couldn't set supplier", description: e.message, variant: "destructive" }); }
    finally { setBusy(false); }
  };
  const addSupplier = async () => {
    if (!newSupplierName.trim()) return;
    setBusy(true);
    try { await apiRequest("POST", `/api/supplier-invoices/${invoice.id}/new-supplier`, { name: newSupplierName.trim() }); toast({ title: `${newSupplierName.trim()} added as a supplier` }); onChanged(); }
    catch (e: any) { toast({ title: "Couldn't add supplier", description: e.message, variant: "destructive" }); }
    finally { setBusy(false); }
  };

  const approve = async () => {
    setBusy(true);
    try {
      const payload = products.filter((l) => l.status === "pending" || l.line_type === "personal").map((l) => {
        const d = decisions[l.id];
        return {
          lineId: l.id, action: d.action,
          ingredientId: d.action === "match" ? d.ingredientId : undefined,
          newIngredient: d.action === "new" ? { name: d.newName!.trim(), unit: d.newUnit || (costFor(l, d).lineUom as Uom) || "each", category: d.newCategory || "General" } : undefined,
          itemType: d.itemType, brand: d.brand,
          basePerPurchase: num(d.packSize), packUom: num(d.packSize) ? (d.packUom || "each") : undefined,
          ingredientUnitsPerBase: num(d.factor),
        };
      });
      const resp = await apiRequest("POST", `/api/supplier-invoices/${invoice.id}/approve`, { decisions: payload });
      const r = await resp.json();
      const changes = (r.priceChanges || []).slice(0, 6).map((c: any) => `${c.name}: ${c.from === null ? "new" : smart(c.from)} → ${smart(c.to)}/${c.unit}`).join("; ");
      toast({ title: `Approved: ${r.updated} price${r.updated === 1 ? "" : "s"} saved${r.created ? `, ${r.created} new ingredient${r.created === 1 ? "" : "s"}` : ""}`, description: changes ? `${changes}. Recipe costs are updating.` : "Recipe costs are updating." });
      onChanged();
    } catch (e: any) {
      toast({ title: "Couldn't approve yet", description: e.message.replace(/^\d+: /, "").replace(/^\{"error":"(.*)"\}$/, "$1"), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  if (!invoice.supplier_id) {
    return (
      <div className="rounded-md border border-amber-300 bg-amber-50 p-3 space-y-3 text-sm">
        <div className="font-medium text-amber-900">Who is this invoice from?{invoice.detected_supplier_name ? ` The reader saw "${invoice.detected_supplier_name}".` : ""}</div>
        <div className="flex flex-wrap gap-2 items-center">
          <Select onValueChange={(v) => pickSupplier(Number(v))} disabled={busy}>
            <SelectTrigger className="w-64 bg-white"><SelectValue placeholder="Pick an existing supplier" /></SelectTrigger>
            <SelectContent>{suppliers.slice().sort((a, b) => a.name.localeCompare(b.name)).map((s) => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}</SelectContent>
          </Select>
          <span className="text-muted-foreground">or</span>
          <Input className="w-56 bg-white" value={newSupplierName} onChange={(e) => setNewSupplierName(e.target.value)} placeholder="New supplier name" />
          <Button size="sm" variant="outline" onClick={addSupplier} disabled={busy || !newSupplierName.trim()}><Plus size={14} className="mr-1" />Add supplier</Button>
        </div>
        <div className="text-xs text-amber-900/80">The app remembers this supplier's ABN and name so next time it's recognised automatically.</div>
      </div>
    );
  }

  return (
    <div className="space-y-3 text-sm">
      {products.map((l, idx) => {
        const d = decisions[l.id] || { action: null };
        const c = costFor(l, d);
        const done = l.status === "approved";
        const ingNow = d.action === "match" && d.ingredientId ? ingById.get(d.ingredientId) : undefined;
        const change = c.ingCost !== null && ingNow?.bestCostPerUnit ? ((c.ingCost - ingNow.bestCostPerUnit) / ingNow.bestCostPerUnit) * 100 : null;
        return (
          <div key={l.id} className={cn("rounded-md border p-3 space-y-2", problems[idx] ? "border-amber-300" : "border-border", (d.action === "skip" || d.action === "personal") && "opacity-60")}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-medium">{l.description}</div>
                <div className="text-xs text-muted-foreground">
                  {[l.supplier_code && `code ${l.supplier_code}`, l.brand, l.quantity !== null && `${l.quantity}${l.priced_by_weight ? " kg" : ` × ${l.purchase_unit || "item"}`}`,
                    l.discount_ex_gst ? `less ${money(l.discount_ex_gst)}` : null, (l.merged_from?.length || 0) > 1 ? `${l.merged_from!.length} lines combined` : null].filter(Boolean).join(" · ")}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="font-medium tabular-nums">{money(l.line_total_ex_gst)}</div>
                <div className="text-xs text-muted-foreground">ex GST</div>
              </div>
            </div>

            {done ? (
              <div className="flex items-center gap-1 text-emerald-700"><CheckCircle2 size={14} />Saved{l.ingredient_id && ingById.get(l.ingredient_id) ? ` to ${ingById.get(l.ingredient_id)!.name}` : ""}</div>
            ) : (
              <>
                <div className="grid gap-2 md:grid-cols-[1fr_auto]">
                  {d.action === "new" ? (
                    <div className="grid grid-cols-[1fr_90px_140px] gap-2">
                      <Input value={d.newName ?? ""} onChange={(e) => set(l.id, { newName: e.target.value })} placeholder="New ingredient name" data-testid="input-new-ingredient-name" />
                      <Select value={d.newUnit || (c.lineUom as Uom) || "each"} onValueChange={(v) => set(l.id, { newUnit: v as Uom })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="kg">per kg</SelectItem><SelectItem value="L">per L</SelectItem><SelectItem value="each">each</SelectItem></SelectContent>
                      </Select>
                      <Select value={d.newCategory || ""} onValueChange={(v) => set(l.id, { newCategory: v })}>
                        <SelectTrigger><SelectValue placeholder="Category" /></SelectTrigger>
                        <SelectContent>{categories.map((cat) => <SelectItem key={cat} value={cat}>{cat}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                  ) : (
                    <IngredientPicker
                      value={d.action === "match" ? d.ingredientId : undefined}
                      suggestions={l.suggestions || []}
                      ingredients={ingredients}
                      onPick={(id) => set(l.id, { action: "match", ingredientId: id, factor: undefined })}
                      onNew={() => set(l.id, { action: "new", newName: titleCase(l.generic_name || l.description), newUnit: (c.lineUom as Uom) || "each", newCategory: l.item_type === "packaging" ? "Packaging" : undefined })}
                    />
                  )}
                  <div className="flex gap-1">
                    {d.action === "new" && <Button size="sm" variant="ghost" onClick={() => set(l.id, { action: null })}>Back</Button>}
                    <Button size="sm" variant={d.action === "skip" ? "secondary" : "ghost"} onClick={() => set(l.id, { action: d.action === "skip" ? null : "skip" })} title="Don't track this item's price">Skip</Button>
                    <Button size="sm" variant={d.action === "personal" ? "secondary" : "ghost"} onClick={() => set(l.id, { action: d.action === "personal" ? null : "personal" })} title="Not for the business">Personal</Button>
                  </div>
                </div>

                {(d.action === "match" || d.action === "new") && (
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <Select value={d.itemType || "ingredient"} onValueChange={(v) => set(l.id, { itemType: v })}>
                      <SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="ingredient">Ingredient</SelectItem><SelectItem value="packaging">Packaging</SelectItem><SelectItem value="cleaning">Cleaning</SelectItem><SelectItem value="other">Other</SelectItem></SelectContent>
                    </Select>
                    <label className="flex items-center gap-1 text-xs text-muted-foreground">Brand
                      <Input className="h-8 w-40" value={d.brand ?? ""} onChange={(e) => set(l.id, { brand: e.target.value })} placeholder="—" />
                    </label>
                    {(l.needs_pack_size || d.packSize !== undefined) && (
                      <label className="flex items-center gap-1 text-xs">
                        <span className="text-amber-800 font-medium">Each {l.purchase_unit && l.purchase_unit !== "EA" ? l.purchase_unit.toLowerCase() : "pack"} is</span>
                        <Input className="h-8 w-20" inputMode="decimal" value={d.packSize ?? ""} onChange={(e) => set(l.id, { packSize: e.target.value })} placeholder="1" data-testid="input-pack-size" />
                        <Select value={d.packUom || (ingNow?.unit === "L" ? "L" : ingNow?.unit === "each" ? "each" : "kg")} onValueChange={(v) => set(l.id, { packUom: v as Uom })}>
                          <SelectTrigger className="h-8 w-20"><SelectValue /></SelectTrigger>
                          <SelectContent><SelectItem value="kg">kg</SelectItem><SelectItem value="L">L</SelectItem><SelectItem value="each">each</SelectItem></SelectContent>
                        </Select>
                        <span className="text-muted-foreground">(remembered for next time)</span>
                      </label>
                    )}
                    {c.ing && c.lineUom && (c.needsFactor || d.factor !== undefined || (c.factor !== 1 && c.factor !== null) || (l.warnings || []).some((w) => w.startsWith("Works out at"))) && (
                      <label className="flex items-center gap-1 text-xs">
                        <span className={cn(c.needsFactor && "text-amber-800 font-medium")}>1 {c.lineUom} =</span>
                        <Input className="h-8 w-20" inputMode="decimal" value={d.factor ?? (c.factor ? String(Math.round(c.factor * 1000) / 1000) : "")} onChange={(e) => set(l.id, { factor: e.target.value })} data-testid="input-unit-factor" />
                        <span>{c.ing.unit}</span>
                      </label>
                    )}
                  </div>
                )}

                {(d.action === "match" || d.action === "new") && (
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    {c.ingCost !== null ? (
                      <span className="font-medium">= {smart(c.ingCost)} per {c.ing?.unit}</span>
                    ) : (
                      <span className="text-amber-800">{problems[idx]}</span>
                    )}
                    {change !== null && Math.abs(change) >= 0.5 && (
                      <Badge variant="outline" className={cn(change > 10 ? "border-red-300 text-red-700" : change < -10 ? "border-emerald-300 text-emerald-700" : "")}>
                        {change > 0 ? "up" : "down"} {Math.abs(change).toFixed(1)}% vs {smart(ingNow!.bestCostPerUnit!)}
                      </Badge>
                    )}
                    {l.match_method && d.ingredientId === l.ingredient_id && (
                      <span className="text-muted-foreground">{l.match_method === "code" ? "matched by product code" : l.match_method === "description" ? "matched by supplier's wording" : `suggested (${Math.round((l.match_confidence || 0) * 100)}%)`}</span>
                    )}
                  </div>
                )}
                {(l.warnings || []).filter((w) => !w.startsWith("Bought per") || c.needsFactor).map((w, i) => (
                  <div key={i} className="flex items-start gap-1 text-xs text-amber-800"><AlertTriangle size={13} className="mt-0.5 shrink-0" />{w}</div>
                ))}
                {l.notes && <div className="text-xs text-muted-foreground">Reader: {l.notes}</div>}
              </>
            )}
          </div>
        );
      })}

      {others.length > 0 && (
        <div className="rounded-md border p-3 text-xs text-muted-foreground space-y-1">
          <div className="font-medium text-foreground">Not products (kept off ingredient prices)</div>
          {others.map((l) => <div key={l.id} className="flex justify-between"><span>{l.line_type}: {l.description}</span><span>{money(l.line_total_ex_gst)}</span></div>)}
        </div>
      )}

      <div className="sticky bottom-0 bg-background border-t pt-3 pb-1 flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{outstanding ? `${outstanding} line${outstanding === 1 ? "" : "s"} to sort out` : "All lines ready"}</span>
        <Button onClick={approve} disabled={busy || outstanding > 0} data-testid="button-approve-invoice">
          {busy ? <Loader2 size={15} className="mr-1 animate-spin" /> : <CheckCircle2 size={15} className="mr-1" />}Approve and save prices
        </Button>
      </div>
    </div>
  );
}
