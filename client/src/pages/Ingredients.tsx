import { useQuery, useMutation } from "@tanstack/react-query";
import { useState, useRef } from "react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Pencil, Trash2, Package, Check, RefreshCw, Download, Upload, Sparkles } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

const CATEGORIES = ["Baked Goods / Desserts", "Bread", "Cheese & Dairy", "Coffee", "Drinks", "Dry Goods", "Frozen Goods", "Fruit & Veg", "Kitchen & Cleaning Consumables", "Meat", "Other", "Packaging", "Sauces", "Spices"];
const UNITS = ["kg", "g", "L", "ml", "each", "pack", "dozen", "bunch", "slice", "sheet"];

const ALLERGENS = [
  { key: "Gluten",     label: "Gluten",      desc: "Wheat, Barley, Rye, Oats" },
  { key: "Tree Nuts",  label: "Tree Nuts",   desc: "Almond, Cashew, Walnut, etc." },
  { key: "Dairy",      label: "Dairy",       desc: "Milk, Cheese, Butter, Cream" },
  { key: "Eggs",       label: "Eggs",        desc: "Eggs, Mayonnaise" },
  { key: "Peanuts",    label: "Peanuts",     desc: "Peanut Butter, Satay" },
  { key: "Sesame",     label: "Sesame",      desc: "Tahini, Sesame Oil" },
  { key: "Soy",        label: "Soy",         desc: "Soy Sauce, Tofu, Miso" },
  { key: "Fish",       label: "Fish",        desc: "Any fish species, Fish Sauce" },
  { key: "Sulphites",  label: "Sulphites",   desc: "Wine, Vinegar, Dried Fruit" },
  { key: "Crustacea",  label: "Crustacea",   desc: "Prawns, Crab, Lobster" },
  { key: "Molluscs",   label: "Molluscs",    desc: "Squid, Mussels, Oysters" },
];

type Ingredient = {
  id: number; name: string; category: string; unit: string;
  bestCostPerUnit: number; bestSupplierId?: number; bestSupplierName?: string;
  avgWeightPerUnit?: number | null; notes?: string;
  dietariesJson?: string;
  pealLabel?: string;
  barcode?: string;
  shelfLife?: string;
  storageTemp?: string;
  categoriesJson?: string;
};

type SupplierPrice = {
  id: number; supplierId: number; ingredientId: number; costPerUnit: number;
  packSize?: number; packCost?: number; invoiceDate?: string; invoiceRef?: string; supplierName: string; brandName?: string;
};

const emptyIng = { name: "", category: "Bread", unit: "kg", bestCostPerUnit: "", avgWeightPerUnit: "", notes: "", dietariesJson: "[]", pealLabel: "", brandName: "", barcode: "", shelfLife: "", storageTemp: "", categoriesJson: "[]" };

export default function Ingredients() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Ingredient | null>(null);
  const [form, setForm] = useState<any>(emptyIng);
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("All");
  const [convertTarget, setConvertTarget] = useState("");
  const [convertConfirm, setConvertConfirm] = useState(false);
  const [csvUploading, setCsvUploading] = useState(false);
  const [autoFilling, setAutoFilling] = useState(false);
  const [bulkFilling, setBulkFilling] = useState(false);
  const [autoFillingPeal, setAutoFillingPeal] = useState(false);
  const [autoFillingBrand, setAutoFillingBrand] = useState(false);
  const [bulkFillingPeal, setBulkFillingPeal] = useState(false);
  const [autoFillingNutrition, setAutoFillingNutrition] = useState(false);
  const [bulkFillingNutrition, setBulkFillingNutrition] = useState(false);
  const csvRef = useRef<HTMLInputElement>(null);
  const [priceOpen, setPriceOpen] = useState(false);
  const [priceIngredient, setPriceIngredient] = useState<Ingredient | null>(null);
  const [priceForm, setPriceForm] = useState({ supplierId: "", costPerUnit: "", packSize: "", packCost: "", invoiceDate: "", invoiceRef: "", brandName: "" });

  const { data: ingredients = [], isLoading } = useQuery<Ingredient[]>({
    queryKey: ["/api/ingredients"],
    queryFn: () => apiRequest("GET", "/api/ingredients").then((r) => r.json()),
  });

  const { data: suppliers = [] } = useQuery<any[]>({
    queryKey: ["/api/suppliers"],
    queryFn: () => apiRequest("GET", "/api/suppliers").then((r) => r.json()),
  });

  const { data: supplierPrices = [] } = useQuery<SupplierPrice[]>({
    queryKey: ["/api/supplier-ingredients", priceIngredient?.id],
    queryFn: () => priceIngredient
      ? apiRequest("GET", `/api/supplier-ingredients?ingredientId=${priceIngredient.id}`).then((r) => r.json())
      : Promise.resolve([]),
    enabled: !!priceIngredient,
  });

  const upsert = useMutation({
    mutationFn: (data: any) =>
      editing
        ? apiRequest("PUT", `/api/ingredients/${editing.id}`, { ...data, bestCostPerUnit: parseFloat(data.bestCostPerUnit) || 0, avgWeightPerUnit: data.avgWeightPerUnit ? parseFloat(data.avgWeightPerUnit) * 1000 : null }).then((r) => r.json())
        : apiRequest("POST", "/api/ingredients", { ...data, bestCostPerUnit: parseFloat(data.bestCostPerUnit) || 0, avgWeightPerUnit: data.avgWeightPerUnit ? parseFloat(data.avgWeightPerUnit) * 1000 : null }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ingredients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sub-recipes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recipes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/platters"] });
      setOpen(false); setEditing(null); setForm(emptyIng);
      toast({ title: editing ? "Ingredient updated" : "Ingredient added" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const del = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/ingredients/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/ingredients"] }); toast({ title: "Ingredient removed" }); },
  });

  const convert = useMutation({
    mutationFn: (toType: string) =>
      apiRequest("POST", "/api/convert", { fromType: "ingredient", fromId: editing!.id, toType }).then((r) => r.json()),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/ingredients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sub-recipes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recipes"] });
      setOpen(false); setEditing(null); setForm(emptyIng); setConvertTarget(""); setConvertConfirm(false);
      toast({ title: `Converted to ${convertTarget}`, description: data.name });
    },
    onError: (e: any) => toast({ title: "Conversion failed", description: e.message, variant: "destructive" }),
  });

  const handleDownloadCsv = () => {
    const header = "id,name,category,unit,best_cost_per_unit,avg_weight_per_unit,notes";
    const escape = (v: any) => { const s = String(v ?? ""); return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s; };
    const rows = (ingredients ?? []).map((i) => [i.id, i.name, i.category, i.unit, i.bestCostPerUnit ?? "", (i as any).avgWeightPerUnit ?? "", (i as any).notes ?? ""].map(escape).join(","));
    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "ingredients.csv"; a.click();
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
      const unitIdx = headers.indexOf("unit"), costIdx = headers.indexOf("best_cost_per_unit");
      const avgWtIdx = headers.indexOf("avg_weight_per_unit"), notesIdx = headers.indexOf("notes");
      let updated = 0;
      for (let i = 1; i < lines.length; i++) {
        const cols = parseRow(lines[i]);
        const id = idIdx >= 0 ? parseInt(cols[idIdx]) : NaN;
        if (isNaN(id)) continue;
        const patch: any = {};
        if (nameIdx >= 0 && cols[nameIdx]) patch.name = cols[nameIdx];
        if (catIdx >= 0 && cols[catIdx]) patch.category = cols[catIdx];
        if (unitIdx >= 0 && cols[unitIdx]) patch.unit = cols[unitIdx];
        if (costIdx >= 0 && cols[costIdx] !== "") patch.bestCostPerUnit = parseFloat(cols[costIdx]) || 0;
        if (avgWtIdx >= 0 && cols[avgWtIdx] !== "") patch.avgWeightPerUnit = cols[avgWtIdx] ? parseFloat(cols[avgWtIdx]) : null;
        if (notesIdx >= 0) patch.notes = cols[notesIdx];
        await apiRequest("PUT", `/api/ingredients/${id}`, patch);
        updated++;
      }
      queryClient.invalidateQueries({ queryKey: ["/api/ingredients"] });
      toast({ title: `CSV imported — ${updated} ingredients updated` });
    } catch (err: any) {
      toast({ title: "CSV import failed", description: err.message, variant: "destructive" });
    } finally {
      setCsvUploading(false);
      if (csvRef.current) csvRef.current.value = "";
    }
  };

  const addPrice = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/supplier-ingredients", data).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/supplier-ingredients", priceIngredient?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/ingredients"] });
      setPriceForm({ supplierId: "", costPerUnit: "", packSize: "", packCost: "", invoiceDate: "", invoiceRef: "", brandName: "" });
      toast({ title: "Price added" });
    },
  });

  const delPrice = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/supplier-ingredients/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/supplier-ingredients", priceIngredient?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/ingredients"] });
    },
  });

  // Dietary helpers
  const getDietaries = (ing: Ingredient): string[] => {
    try { return JSON.parse(ing.dietariesJson || "[]"); } catch { return []; }
  };
  const formDietaries: string[] = (() => { try { return JSON.parse(form.dietariesJson || "[]"); } catch { return []; } })();
  const toggleDietary = (key: string) => {
    const current = formDietaries;
    const next = current.includes(key) ? current.filter((k) => k !== key) : [...current, key];
    setForm({ ...form, dietariesJson: JSON.stringify(next) });
  };

  const autoFillDietaries = async () => {
    if (!editing) return;
    setAutoFilling(true);
    try {
      const resp = await apiRequest("POST", `/api/ingredients/${editing.id}/auto-dietaries`);
      const data = await resp.json();
      if (data.dietaries) {
        setForm((f: any) => ({ ...f, dietariesJson: JSON.stringify(data.dietaries) }));
        toast({ title: "AI Dietaries filled", description: `Found: ${data.dietaries.join(", ") || "None"}` });
      }
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setAutoFilling(false);
    }
  };

  const bulkAutoFill = async () => {
    setBulkFilling(true);
    try {
      const resp = await apiRequest("POST", "/api/ingredients/auto-dietaries-bulk");
      const data = await resp.json();
      queryClient.invalidateQueries({ queryKey: ["/api/ingredients"] });
      toast({ title: "AI Bulk Fill Complete", description: `Updated ${data.updated} ingredients. Review and adjust manually.` });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setBulkFilling(false);
    }
  };

  const autoFillPeal = async () => {
    if (!editing) return;
    setAutoFillingPeal(true);
    try {
      const resp = await apiRequest("POST", `/api/ingredients/${editing.id}/auto-peal`);
      const data = await resp.json();
      if (data.pealLabel !== undefined) {
        setForm((f: any) => ({ ...f, pealLabel: data.pealLabel }));
        toast({ title: "PEAL label generated", description: data.pealLabel || "(empty)" });
      }
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setAutoFillingPeal(false);
    }
  };

  const autoFillBrand = async () => {
    if (!editing) return;
    if (!form.brandName?.trim()) {
      toast({ title: "Brand name required", description: "Enter a brand name first, then click AI Fill.", variant: "destructive" });
      return;
    }
    setAutoFillingBrand(true);
    try {
      const resp = await apiRequest("POST", `/api/ingredients/${editing.id}/update-brand`, { brandName: form.brandName.trim() });
      const data = await resp.json();
      if (data.ok) {
        setForm((f: any) => ({
          ...f,
          brandName: data.brandName,
          dietariesJson: data.allergens ? JSON.stringify(data.allergens) : f.dietariesJson,
          pealLabel: data.pealLabel !== undefined ? data.pealLabel : f.pealLabel,
        }));
        toast({ title: "Brand updated", description: `Allergens and PEAL label refreshed for ${data.brandName}.` });
      }
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setAutoFillingBrand(false);
    }
  };

  const autoFillNutrition = async () => {
    if (!editing) return;
    setAutoFillingNutrition(true);
    try {
      const resp = await apiRequest("POST", `/api/ingredients/${editing.id}/auto-nutrition`);
      const data = await resp.json();
      if (data.ok && data.nutrition) {
        setForm((f: any) => ({ ...f, nutritionJson: JSON.stringify(data.nutrition) }));
        toast({ title: "Nutrition filled", description: "Per-100g values estimated by AI." });
        queryClient.invalidateQueries({ queryKey: ["/api/ingredients"] });
        queryClient.invalidateQueries({ queryKey: ["/api/recipes"] });
        queryClient.invalidateQueries({ queryKey: ["/api/platters"] });
      }
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setAutoFillingNutrition(false);
    }
  };

  const bulkAutoFillNutrition = async () => {
    setBulkFillingNutrition(true);
    try {
      const resp = await apiRequest("POST", "/api/ingredients/auto-nutrition-bulk");
      const data = await resp.json();
      queryClient.invalidateQueries({ queryKey: ["/api/ingredients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recipes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/platters"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      toast({ title: `Nutrition filled for ${data.updated} of ${data.total} ingredients` });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setBulkFillingNutrition(false);
    }
  };

  const bulkAutoFillPeal = async () => {
    setBulkFillingPeal(true);
    try {
      const resp = await apiRequest("POST", "/api/ingredients/auto-peal-bulk");
      const data = await resp.json();
      queryClient.invalidateQueries({ queryKey: ["/api/ingredients"] });
      toast({ title: "PEAL Bulk Fill Complete", description: `Generated labels for ${data.updated} ingredients.` });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setBulkFillingPeal(false);
    }
  };

  const cats = ["All", ...Array.from(new Set(ingredients.map((i) => i.category)))];
  const filtered = ingredients.filter((i) =>
    (catFilter === "All" || i.category === catFilter) &&
    i.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6 space-y-5 max-w-screen-xl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground">Ingredients</h1>
          <p className="text-sm text-muted-foreground mt-1">All raw ingredients with best supplier pricing.</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={handleDownloadCsv} data-testid="button-download-csv-ingredients">
            <Download size={14} className="mr-1" /> Download CSV
          </Button>
          <Button variant="outline" size="sm" onClick={() => csvRef.current?.click()} disabled={csvUploading} data-testid="button-upload-csv-ingredients">
            <Upload size={14} className="mr-1" /> {csvUploading ? "Importing…" : "Upload CSV"}
          </Button>
          <input ref={csvRef} type="file" accept=".csv" className="hidden" onChange={handleUploadCsv} />
          <Button variant="outline" size="sm" onClick={bulkAutoFill} disabled={bulkFilling} data-testid="button-bulk-auto-dietaries">
            <Sparkles size={14} className="mr-1" /> {bulkFilling ? "AI Filling…" : "AI Fill Dietaries"}
          </Button>
          <Button variant="outline" size="sm" onClick={bulkAutoFillPeal} disabled={bulkFillingPeal} data-testid="button-bulk-auto-peal">
            <Sparkles size={14} className="mr-1" /> {bulkFillingPeal ? "Generating…" : "AI Fill PEAL Labels"}
          </Button>
          <Button variant="outline" size="sm" onClick={bulkAutoFillNutrition} disabled={bulkFillingNutrition} data-testid="button-bulk-auto-nutrition">
            <Sparkles size={14} className="mr-1" /> {bulkFillingNutrition ? "Calculating…" : "AI Fill Nutrition"}
          </Button>
          <Button onClick={() => { setEditing(null); setForm(emptyIng); setOpen(true); }} size="sm" data-testid="button-add-ingredient">
            <Plus size={15} className="mr-1" /> Add Ingredient
          </Button>
        </div>
      </div>

      <div className="flex gap-3 flex-wrap">
        <Input placeholder="Search ingredients…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" data-testid="input-search-ingredients" />
        <Select value={catFilter} onValueChange={setCatFilter}>
          <SelectTrigger className="w-44" data-testid="select-category-filter"><SelectValue /></SelectTrigger>
          <SelectContent>{cats.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="space-y-2">{[1,2,3,4,5].map((i) => <div key={i} className="skeleton h-12 rounded-md" />)}</div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/60 sticky top-0 z-10">
                <tr className="border-b border-border">
                  <th className="text-left px-4 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wider">Name</th>
                  <th className="text-left px-4 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wider">Category</th>
                  <th className="text-left px-4 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wider">Unit</th>
                  <th className="text-right px-4 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wider">Best Price / Unit</th>
                  <th className="text-left px-4 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wider">Best Supplier</th>
                  <th className="text-left px-4 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wider w-32">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={6} className="text-center py-10 text-muted-foreground">
                    {ingredients.length === 0
                      ? <span>No ingredients yet — <button className="text-primary underline" onClick={() => { setEditing(null); setForm(emptyIng); setOpen(true); }}>add one</button></span>
                      : "No ingredients match your search"}
                  </td></tr>
                ) : filtered.map((ing) => (
                  <tr key={ing.id} className="border-b border-border last:border-0 hover:bg-muted/30" data-testid={`row-ingredient-${ing.id}`}>
                    <td className="px-4 py-3 font-medium">{ing.name}</td>
                    <td className="px-4 py-3"><Badge variant="outline" className="text-xs">{ing.category}</Badge></td>
                    <td className="px-4 py-3 text-muted-foreground">{ing.unit}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-semibold text-primary">
                      {ing.bestCostPerUnit > 0 ? `$${ing.bestCostPerUnit.toFixed(4)}` : <span className="text-muted-foreground font-normal">—</span>}
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">
                      <div className="flex flex-col gap-1">
                        <span>{ing.bestSupplierName || "—"}</span>
                        {getDietaries(ing).length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {getDietaries(ing).map((a) => (
                              <span key={a} className="inline-block text-[10px] leading-none px-1.5 py-0.5 rounded-full bg-pink-100 text-pink-700 font-medium border border-pink-200">{a}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        <Button variant="outline" size="sm" className="h-7 text-xs px-2"
                          onClick={() => { setPriceIngredient(ing); setPriceOpen(true); }}
                          data-testid={`button-prices-${ing.id}`}>
                          Prices
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7"
                          onClick={() => { setEditing(ing); setForm({ ...ing, bestCostPerUnit: String(ing.bestCostPerUnit), avgWeightPerUnit: ing.avgWeightPerUnit != null ? String(ing.avgWeightPerUnit / 1000) : "", dietariesJson: ing.dietariesJson || "[]", pealLabel: ing.pealLabel || "", brandName: (ing as any).brandName || "", barcode: ing.barcode || "", shelfLife: ing.shelfLife || "", storageTemp: ing.storageTemp || "", categoriesJson: ing.categoriesJson || "[]" }); setOpen(true); }}
                          data-testid={`button-edit-ingredient-${ing.id}`}>
                          <Pencil size={13} />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive"
                          onClick={() => del.mutate(ing.id)}
                          data-testid={`button-delete-ingredient-${ing.id}`}>
                          <Trash2 size={13} />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}


      {/* Add/Edit Ingredient Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Ingredient" : "Add Ingredient"}</DialogTitle>
            {editing && (
              <div className="flex gap-2 mt-2">
                <Button variant="outline" size="sm" className="text-xs" onClick={() => convert.mutate("recipe")}>
                  Convert to Recipe
                </Button>
                <Button variant="outline" size="sm" className="text-xs" onClick={() => convert.mutate("sub-recipe")}>
                  Convert to Sub-Recipe
                </Button>
              </div>
            )}
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Name *</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Chicken Breast" data-testid="input-ingredient-name" />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>Brand Name</Label>
                {editing && (
                  <Button type="button" variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={autoFillBrand} disabled={autoFillingBrand} data-testid="button-ai-fill-brand">
                    <Sparkles size={12} />{autoFillingBrand ? "Updating…" : "AI Fill"}
                  </Button>
                )}
              </div>
              <Input
                value={form.brandName || ""}
                onChange={(e) => setForm({ ...form, brandName: e.target.value })}
                placeholder="e.g. Fountain BBQ Sauce 2L"
                data-testid="input-brand-name"
              />
              <p className="text-xs text-muted-foreground">Enter the product brand name then click AI Fill to auto-update allergens and PEAL label.</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Category</Label>
                <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Unit</Label>
                <Select value={form.unit} onValueChange={(v) => setForm({ ...form, unit: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{UNITS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className={form.unit === "each" && !form.avgWeightPerUnit ? "text-destructive" : ""}>
                Avg Weight per Unit (kg/L){form.unit === "each" && <span className="text-destructive ml-1">*</span>}
              </Label>
              <Input
                type="number" step="0.001"
                value={form.avgWeightPerUnit}
                onChange={(e) => setForm({ ...form, avgWeightPerUnit: e.target.value })}
                placeholder="e.g. 0.4"
                className={form.unit === "each" && !form.avgWeightPerUnit ? "border-destructive ring-destructive" : ""}
              />
              {form.unit === "each" && !form.avgWeightPerUnit ? (
                <p className="text-xs text-destructive font-medium">Required when unit is ‘each’ — enter the average weight (e.g. a 12" wrap = 0.085kg)</p>
              ) : (
                <p className="text-xs text-muted-foreground">e.g. 1 head of Cos = 0.4kg, 1 can of Coconut Cream = 0.4L</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Default Cost / Unit ($)</Label>
              <Input type="number" step="0.0001" value={form.bestCostPerUnit} onChange={(e) => setForm({ ...form, bestCostPerUnit: e.target.value })} placeholder="0.00" data-testid="input-ingredient-cost" />
              <p className="text-xs text-muted-foreground">Will be auto-updated when you add supplier pricing.</p>
            </div>

            {/* Barcode, Shelf Life, Storage Temp */}
            <div className="space-y-1.5">
              <Label>Barcode</Label>
              <Input value={form.barcode || ""} onChange={(e) => setForm({ ...form, barcode: e.target.value })} placeholder="e.g. 9310015503453" data-testid="input-ingredient-barcode" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Shelf Life</Label>
                <Input value={form.shelfLife || ""} onChange={(e) => setForm({ ...form, shelfLife: e.target.value })} placeholder="e.g. 7 days, 3 months" data-testid="input-ingredient-shelf-life" />
              </div>
              <div className="space-y-1.5">
                <Label>Storage Temperature</Label>
                <Select value={form.storageTemp || ""} onValueChange={(v) => setForm({ ...form, storageTemp: v })}>
                  <SelectTrigger data-testid="select-ingredient-storage-temp"><SelectValue placeholder="Select…" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Ambient">Ambient (room temp)</SelectItem>
                    <SelectItem value="Chilled">Chilled (0–4°C)</SelectItem>
                    <SelectItem value="Frozen">Frozen (−18°C or below)</SelectItem>
                    <SelectItem value="Cool & Dry">Cool &amp; Dry</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Categories (ingredient tags) */}
            <div className="space-y-1.5">
              <Label>Categories</Label>
              <div className="flex flex-wrap gap-2">
                {["Gluten Free", "Dairy Free", "Vegan", "Vegetarian", "Raw", "Organic", "Seasonal"].map((cat) => {
                  const current: string[] = (() => { try { return JSON.parse(form.categoriesJson || "[]"); } catch { return []; } })();
                  const active = current.includes(cat);
                  return (
                    <button key={cat} type="button"
                      onClick={() => {
                        const next = active ? current.filter((c) => c !== cat) : [...current, cat];
                        setForm({ ...form, categoriesJson: JSON.stringify(next) });
                      }}
                      className={`px-3 py-1 rounded-full text-xs border transition-colors ${
                        active ? "bg-primary text-white border-primary" : "bg-background text-muted-foreground border-border hover:border-primary"
                      }`}>
                      {cat}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Dietaries, Nutrition, PEAL — not applicable for Packaging */}
            {form.category !== "Packaging" && (
              <>
            {/* Dietaries section */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-semibold">Allergens / Dietaries</Label>
                {editing && (
                  <Button type="button" variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={autoFillDietaries} disabled={autoFilling} data-testid="button-ai-fill-dietaries">
                    <Sparkles size={12} />{autoFilling ? "Filling…" : "AI Fill"}
                  </Button>
                )}
              </div>
              <div className="grid grid-cols-3 gap-x-4 gap-y-2">
                {ALLERGENS.map((a) => (
                  <label key={a.key} className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-border accent-primary cursor-pointer"
                      checked={formDietaries.includes(a.key)}
                      onChange={() => toggleDietary(a.key)}
                      data-testid={`checkbox-dietary-${a.key.toLowerCase().replace(/\s+/g, '-')}`}
                    />
                    <span className="text-xs">{a.label}</span>
                  </label>
                ))}
              </div>
            </div>
            {/* Nutritional Values (per 100g) */}
            {(() => {
              let n: any = {};
              try { n = JSON.parse(form.nutritionJson || "{}"); } catch {}
              const hasNutrition = !!(n.energy || n.protein || n.fatTotal || n.carbs);
              return (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm font-semibold">Nutritional Values <span className="text-xs font-normal text-muted-foreground">(per 100g)</span></Label>
                    {editing && (
                      <Button type="button" variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={autoFillNutrition} disabled={autoFillingNutrition} data-testid="button-ai-fill-nutrition">
                        <Sparkles size={12} />{autoFillingNutrition ? "Calculating…" : hasNutrition ? "Recalculate" : "AI Fill"}
                      </Button>
                    )}
                  </div>
                  {hasNutrition ? (
                    <div className="rounded border border-border bg-muted/30 p-2">
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                        {[
                          ["Energy", `${Math.round(n.energy ?? 0)} kJ (${Math.round((n.energy ?? 0) / 4.184)} Cal)`],
                          ["Protein", `${(n.protein ?? 0).toFixed(1)} g`],
                          ["Fat (total)", `${(n.fatTotal ?? 0).toFixed(1)} g`],
                          ["Fat (saturated)", `${(n.fatSat ?? 0).toFixed(1)} g`],
                          ["Carbohydrate", `${(n.carbs ?? 0).toFixed(1)} g`],
                          ["Sugars", `${(n.sugars ?? 0).toFixed(1)} g`],
                          ["Sodium", `${Math.round(n.sodium ?? 0)} mg`],
                        ].map(([label, val]) => (
                          <div key={label} className="flex justify-between gap-2">
                            <span className="text-muted-foreground">{label}</span>
                            <span className="font-medium tabular-nums">{val}</span>
                          </div>
                        ))}
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-1.5">AI-estimated. Click Recalculate or edit via JSON if needed.</p>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">No nutrition data. Click AI Fill to estimate per-100g values using the brand name.</p>
                  )}
                </div>
              );
            })()}

            {/* PEAL Label */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-semibold">PEAL Ingredient Label</Label>
                {editing && (
                  <Button type="button" variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={autoFillPeal} disabled={autoFillingPeal} data-testid="button-ai-fill-peal">
                    <Sparkles size={12} />{autoFillingPeal ? "Generating…" : "AI Fill"}
                  </Button>
                )}
              </div>
              <Input
                value={form.pealLabel || ""}
                onChange={(e) => setForm({ ...form, pealLabel: e.target.value })}
                placeholder='e.g. soy sauce (wheat, soy)'
                data-testid="input-peal-label"
              />
              <p className="text-xs text-muted-foreground">How this ingredient appears in a FSANZ ingredients list. Allergen sources in parentheses.</p>
            </div>
              </>
            )}
          </div>
          {editing && (
            <div className="border-t border-border pt-4 mt-2">
              <p className="text-xs font-semibold text-muted-foreground mb-2">Convert to another type</p>
              {!convertConfirm ? (
                <div className="flex gap-2 items-center flex-wrap">
                  <Select value={convertTarget} onValueChange={setConvertTarget}>
                    <SelectTrigger className="w-40 h-8 text-xs"><SelectValue placeholder="Convert to…" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="sub-recipe">Sub-Recipe</SelectItem>
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
                  <p className="text-xs text-amber-700">Convert "{editing.name}" to {convertTarget}? This will delete the ingredient.</p>
                  <Button size="sm" variant="destructive" className="h-7 text-xs" onClick={() => convert.mutate(convertTarget)} disabled={convert.isPending}>
                    {convert.isPending ? "Converting…" : "Confirm"}
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setConvertConfirm(false); setConvertTarget(""); }}>Cancel</Button>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setOpen(false); setConvertTarget(""); setConvertConfirm(false); }}>Cancel</Button>
            <Button onClick={() => upsert.mutate(form)} disabled={!form.name || upsert.isPending || (form.unit === "each" && !form.avgWeightPerUnit)} data-testid="button-save-ingredient">
              {upsert.isPending ? "Saving…" : editing ? "Update" : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Supplier Prices Dialog */}
      <Dialog open={priceOpen} onOpenChange={setPriceOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Supplier Pricing — {priceIngredient?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {/* Existing prices */}
            {supplierPrices.length > 0 && (
              <div className="rounded-lg border border-border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/60">
                    <tr className="border-b border-border">
                      <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground uppercase">Supplier</th>
                      <th className="text-right px-3 py-2 text-xs font-semibold text-muted-foreground uppercase">Cost/{priceIngredient?.unit}</th>
                      <th className="text-right px-3 py-2 text-xs font-semibold text-muted-foreground uppercase">Pack Size</th>
                      <th className="text-right px-3 py-2 text-xs font-semibold text-muted-foreground uppercase">Pack Cost</th>
                      <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground uppercase">Invoice Date</th>
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {(supplierPrices ?? []).map((sp) => {
                      const isBest = priceIngredient?.bestSupplierId === sp.supplierId;
                      return (
                        <tr key={sp.id} className={cn("border-b border-border last:border-0", isBest ? "bg-primary/5" : "")}>
                          <td className="px-3 py-2.5 font-medium">
                            <div className="flex items-center gap-1">{sp.supplierName}{isBest && <Check size={12} className="text-primary ml-1" />}</div>
                            {sp.brandName && <div className="text-xs text-muted-foreground">{sp.brandName}</div>}
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-primary">${sp.costPerUnit.toFixed(4)}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{sp.packSize ?? "—"}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{sp.packCost ? `$${sp.packCost.toFixed(2)}` : "—"}</td>
                          <td className="px-3 py-2.5 text-muted-foreground text-xs">{sp.invoiceDate ?? "—"}</td>
                          <td className="px-3 py-2.5">
                            <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => delPrice.mutate(sp.id)}>
                              <Trash2 size={12} />
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Add new price */}
            <div className="border border-border rounded-lg p-4 space-y-3 bg-muted/20">
              <p className="text-sm font-semibold">Add / Update Price</p>
              <div className="space-y-1.5">
                <Label className="text-xs">Brand Name (this supplier's product)</Label>
                <Input value={priceForm.brandName} onChange={(e) => setPriceForm({ ...priceForm, brandName: e.target.value })} placeholder="e.g. Bulla Thickened Cream 5L" />
                <p className="text-xs text-muted-foreground">If this is the cheapest supplier, this brand name will show on the ingredient and be used for AI allergen and nutrition lookups.</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Supplier *</Label>
                  <Select value={priceForm.supplierId} onValueChange={(v) => setPriceForm({ ...priceForm, supplierId: v })}>
                    <SelectTrigger><SelectValue placeholder="Select supplier" /></SelectTrigger>
                    <SelectContent>{(suppliers ?? []).map((s: any) => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Cost per {priceIngredient?.unit} ($) *</Label>
                  <Input type="number" step="0.0001" value={priceForm.costPerUnit} onChange={(e) => setPriceForm({ ...priceForm, costPerUnit: e.target.value })} placeholder="0.0000" data-testid="input-price-cost" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Pack Size ({priceIngredient?.unit})</Label>
                  <Input type="number" step="0.001" value={priceForm.packSize} onChange={(e) => setPriceForm({ ...priceForm, packSize: e.target.value })} placeholder="e.g. 5" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Pack Cost ($)</Label>
                  <Input type="number" step="0.01" value={priceForm.packCost} onChange={(e) => {
                    const pc = parseFloat(e.target.value);
                    const ps = parseFloat(priceForm.packSize);
                    const cpu = !isNaN(pc) && !isNaN(ps) && ps > 0 ? String((pc / ps).toFixed(4)) : priceForm.costPerUnit;
                    setPriceForm({ ...priceForm, packCost: e.target.value, costPerUnit: cpu });
                  }} placeholder="e.g. 25.00" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Invoice Date</Label>
                  <Input type="date" value={priceForm.invoiceDate} onChange={(e) => setPriceForm({ ...priceForm, invoiceDate: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Invoice Ref</Label>
                  <Input value={priceForm.invoiceRef} onChange={(e) => setPriceForm({ ...priceForm, invoiceRef: e.target.value })} placeholder="INV-12345" />
                </div>
              </div>
              <Button size="sm" disabled={!priceForm.supplierId || !priceForm.costPerUnit || addPrice.isPending}
                onClick={() => addPrice.mutate({
                  supplierId: parseInt(priceForm.supplierId),
                  ingredientId: priceIngredient!.id,
                  costPerUnit: parseFloat(priceForm.costPerUnit),
                  packSize: priceForm.packSize ? parseFloat(priceForm.packSize) : null,
                  packCost: priceForm.packCost ? parseFloat(priceForm.packCost) : null,
                  invoiceDate: priceForm.invoiceDate || null,
                  invoiceRef: priceForm.invoiceRef || null,
                  brandName: priceForm.brandName || null,
                })}
                data-testid="button-add-price">
                <Plus size={14} className="mr-1" /> Add Price
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setPriceOpen(false); setPriceIngredient(null); }}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
