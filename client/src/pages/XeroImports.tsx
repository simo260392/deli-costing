import { useState, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { SearchableSelect } from "@/components/SearchableSelect";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";
import {
  Link2, PlusCircle, EyeOff, RefreshCw, CheckCircle2, AlertCircle,
  Clock, ChevronDown, ChevronRight, Trash2, Receipt, FileText,
  Upload, X, ExternalLink, CloudDownload, Ban
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

// API_BASE for absolute URLs (PDF iframe needs this)
const API_BASE = "__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__";

// ── Types ─────────────────────────────────────────────────────────────────────
type XeroImport = {
  id: number;
  xeroInvoiceId: string;
  xeroInvoiceNumber: string | null;
  supplierName: string | null;
  invoiceDate: string | null;
  totalAmount: number | null;
  currency: string | null;
  hubdocUrl: string | null;
  lineDescription: string | null;
  source: "xero" | "drive" | null;
  driveFileId: string | null;
  driveFileUrl: string | null;
  status: "pending" | "matched" | "added" | "ignored";
  syncedAt: string;
  resolvedAt: string | null;
};

type XeroLineItem = {
  id: number;
  xeroImportId: number;
  description: string | null;
  status: "pending" | "matched" | "added" | "ignored";
  ingredientId: number | null;
  ingredientName: string | null;
  costPerUnit: number | null;
  quantity: number | null;
  unit: string | null;
  lineTotal: number | null;
  // Carton/pack breakdown
  cartonsSupplied: number | null;
  packsPerCarton: number | null;
  packSize: number | null;
  packUnit: string | null;
  brandName: string | null;
  notes: string | null;
  createdAt: string;
  resolvedAt: string | null;
};

type Ingredient = { id: number; name: string; unit: string };

// ── Status badge ──────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: "pending" | "matched" | "added" | "ignored" }) {
  if (status === "pending")
    return <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 gap-1 text-xs"><Clock size={9} /> Pending</Badge>;
  if (status === "matched")
    return <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 gap-1 text-xs"><CheckCircle2 size={9} /> Matched</Badge>;
  if (status === "added")
    return <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 gap-1 text-xs"><PlusCircle size={9} /> Added</Badge>;
  return <Badge variant="outline" className="gap-1 text-xs text-muted-foreground"><EyeOff size={9} /> Ignored</Badge>;
}

// ── PDF Upload / Viewer panel ─────────────────────────────────────────────────
function PdfPanel({ invoice }: { invoice: XeroImport }) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  const [showPdf, setShowPdf] = useState(false);

  const { data: pdfStatus, refetch: refetchStatus } = useQuery<{ hasPdf: boolean; url: string | null }>({
    queryKey: ["/api/xero/imports", invoice.id, "pdf-status"],
    queryFn: () => apiRequest("GET", `/api/xero/imports/${invoice.id}/pdf-status`).then(r => r.json()),
  });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => {
      const formData = new FormData();
      formData.append("pdf", file);
      return fetch(`${API_BASE}/api/xero/imports/${invoice.id}/upload-pdf`, {
        method: "POST",
        body: formData,
      }).then(r => r.json());
    },
    onSuccess: () => {
      refetchStatus();
      setShowPdf(true);
      toast({ title: "PDF uploaded", description: "Invoice PDF is now visible alongside your line items." });
    },
    onError: (e: any) => toast({ title: "Upload failed", description: e.message, variant: "destructive" }),
  });

  const ACCEPTED_TYPES = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'image/tiff', 'image/bmp', 'image/gif', 'image/webp'];
  const isAcceptedFile = (file: File) => {
    if (ACCEPTED_TYPES.includes(file.type)) return true;
    // Also check by extension (some drag-and-drop won't set MIME type)
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    return ['pdf','jpg','jpeg','png','tiff','tif','bmp','gif','webp'].includes(ext);
  };
  const handleFile = useCallback((file: File) => {
    if (!isAcceptedFile(file)) {
      toast({ title: "Unsupported file type", description: "Please upload a PDF, JPG, or PNG invoice.", variant: "destructive" });
      return;
    }
    uploadMutation.mutate(file);
  }, [uploadMutation]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const hasPdf = pdfStatus?.hasPdf;
  // Use absolute URL so the iframe always hits the backend correctly
  const serveUrl = `${API_BASE}/api/xero/imports/${invoice.id}/pdf`;

  // If PDF exists and panel is open, show iframe
  if ((hasPdf || pdfBlobUrl) && showPdf) {
    return (
      <div className="border border-border rounded-lg overflow-hidden bg-background">
        <div className="flex items-center justify-between px-3 py-2 bg-muted/40 border-b border-border">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <FileText size={12} />
            <span className="font-medium text-foreground">{invoice.supplierName} invoice</span>
          </div>
          <div className="flex items-center gap-1">
            <a href={serveUrl} target="_blank" rel="noopener noreferrer">
              <Button size="sm" variant="ghost" className="h-6 w-6 p-0" title="Open in new tab">
                <ExternalLink size={11} />
              </Button>
            </a>
            <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => setShowPdf(false)}>
              <X size={11} />
            </Button>
          </div>
        </div>
        <div className="h-[520px]">
          <iframe
            src={pdfBlobUrl || serveUrl}
            className="w-full h-full border-0"
            title="Invoice PDF"
          />
        </div>
      </div>
    );
  }

  // Show upload area + "view" button if PDF exists
  return (
    <div className="space-y-2">
      {/* Source document link */}
      {(invoice.hubdocUrl || invoice.driveFileUrl) && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/40 border border-border text-xs">
          <FileText size={12} className="text-muted-foreground shrink-0" />
          <span className="text-muted-foreground flex-1">
            {invoice.source === 'drive' ? 'Uploaded from Google Drive' : 'Original invoice scanned in Hubdoc'}
          </span>
          <a href={invoice.source === 'drive' ? (invoice.driveFileUrl ?? '#') : (invoice.hubdocUrl ?? '#')} target="_blank" rel="noopener noreferrer">
            <Button size="sm" variant="outline" className="h-6 px-2 text-xs gap-1">
              <ExternalLink size={10} /> {invoice.source === 'drive' ? 'Open in Drive' : 'Open in Hubdoc'}
            </Button>
          </a>
        </div>
      )}

      {hasPdf ? (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800/40 text-xs">
          <FileText size={12} className="text-green-600 dark:text-green-400 shrink-0" />
          <span className="text-green-700 dark:text-green-300 flex-1">Invoice PDF cached</span>
          <Button
            size="sm" variant="outline"
            className="h-6 px-2 text-xs gap-1 border-green-300 hover:bg-green-100 dark:border-green-700 dark:hover:bg-green-900/30"
            onClick={() => setShowPdf(true)}
            data-testid={`button-view-pdf-${invoice.id}`}
          >
            <FileText size={10} /> View PDF
          </Button>
          <label className="cursor-pointer">
            <Button size="sm" variant="ghost" className="h-6 px-2 text-xs gap-1 text-muted-foreground" asChild>
              <span><Upload size={10} /> Replace</span>
            </Button>
            <input
              type="file"
              accept=".pdf"
              className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
            />
          </label>
        </div>
      ) : (
        <div
          className={cn(
            "border-2 border-dashed rounded-lg px-4 py-5 text-center transition-colors cursor-pointer",
            dragging
              ? "border-primary bg-primary/5"
              : "border-border hover:border-primary/50 hover:bg-muted/30"
          )}
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
          data-testid={`pdf-upload-${invoice.id}`}
        >
          <Upload size={18} className="mx-auto mb-1.5 text-muted-foreground" />
          <p className="text-xs font-medium text-foreground">
            {uploadMutation.isPending ? "Uploading…" : "Upload invoice PDF"}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Drag & drop or click · PDF or image
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.tiff,.tif,.bmp,.gif,.webp"
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
          />
        </div>
      )}
    </div>
  );
}

// ── Resolve line item dialog ──────────────────────────────────────────────────
function ResolveLineDialog({
  line,
  invoice,
  ingredients,
  onClose,
}: {
  line: XeroLineItem;
  invoice: XeroImport;
  ingredients: Ingredient[];
  onClose: () => void;
}) {
  const { toast } = useToast();

  // ── Tab: "match" or "create" ──
  const [tab, setTab] = useState<"match" | "create">("match");

  // ── Match tab state ──
  const [ingredientId, setIngredientId] = useState<string>("");
  const [memorySuggestion, setMemorySuggestion] = useState<string | null>(null);

  // ── Brand name (pre-populated from invoice line first, then selected ingredient, editable) ──
  const [brandName, setBrandName] = useState<string>(line.brandName?.trim() || "");
  const [avgWeightKg, setAvgWeightKg] = useState<string>("");

  // Auto-suggest ingredient from memory when dialog opens
  useState(() => {
    if (!line.description) return;
    fetch(`${API_BASE}/api/invoice-memory/suggest-ingredient?description=${encodeURIComponent(line.description)}`)
      .then(r => r.json())
      .then(data => {
        if (data.ingredientId) {
          setIngredientId(String(data.ingredientId));
          const ing = ingredients.find(i => i.id === data.ingredientId);
          if (ing) {
            setMatchUnit(ing.unit?.toLowerCase() || "");
            setMemorySuggestion(ing.name);
            // Only pre-populate brand from ingredient if invoice line has no brand
            if (!line.brandName?.trim()) setBrandName((ing as any).brandName || "");
          }
        }
      })
      .catch(() => {});
  });

  // ── Create tab state ──
  const [name, setName] = useState(line.description || "");
  const [category, setCategory] = useState("Dry Goods");
  const [createUnit, setCreateUnit] = useState(line.packUnit?.toLowerCase() || line.unit?.toLowerCase() || "each");

  // ── Detect if invoice has carton-level data ──
  const hasCartonData = line.cartonsSupplied != null || line.packsPerCarton != null || line.packSize != null;

  // ── Carton / pack breakdown state ──
  // Cartons: how many cartons were bought (from invoice)
  const [cartons, setCartons] = useState<string>(
    line.cartonsSupplied != null ? String(line.cartonsSupplied) : (line.quantity != null ? String(line.quantity) : "1")
  );
  // Packs per carton (from invoice, e.g. CTN=6 → 6)
  const [packsPerCarton, setPacksPerCarton] = useState<string>(
    line.packsPerCarton != null ? String(line.packsPerCarton) : "1"
  );
  // Pack size (e.g. 12 wraps, 4.2 kg)
  const [packSizeVal, setPackSizeVal] = useState<string>(
    line.packSize != null ? String(line.packSize) : ""
  );
  // Pack unit (e.g. each, kg, L)
  const [matchUnit, setMatchUnit] = useState<string>(
    line.packUnit?.toLowerCase() || line.unit?.toLowerCase() || "each"
  );

  // ── Total cost from invoice ──
  const [totalCost, setTotalCost] = useState(
    line.lineTotal != null ? String(line.lineTotal) : ""
  );

  // ── Add GST checkbox (multiply total cost by 1.1) ──
  const [addGst, setAddGst] = useState(false);

  // ── Notes ──
  const [notes, setNotes] = useState("");

  // ── Derived calculations ──
  const cartonsNum = parseFloat(cartons) || 0;
  const packsPerCartonNum = parseFloat(packsPerCarton) || 1;
  const packSizeNum = parseFloat(packSizeVal) || 0;
  const totalCostNum = parseFloat(totalCost) || 0;
  const effectiveTotalCost = addGst ? totalCostNum * 1.1 : totalCostNum;

  // Total packs = cartons × packs per carton
  const totalPacks = cartonsNum * packsPerCartonNum;
  // Total units = total packs × pack size (if pack size is a count like "each")
  // Cost per pack = total cost / total packs
  const costPerPack = totalPacks > 0 ? effectiveTotalCost / totalPacks : 0;
  // Cost per unit (smallest unit) = cost per pack / pack size (if packSize is a count)
  // If pack unit is kg/L (weight/volume), cost per unit = cost per pack / pack size
  const isWeightUnit = ["kg", "g", "l", "lt", "ltr", "ml"].includes(matchUnit.toLowerCase());
  const isCountUnit = ["each", "pack", "dozen", "box", ""].includes(matchUnit.toLowerCase());
  const costPerUnit = packSizeNum > 0 && isCountUnit
    ? costPerPack / packSizeNum
    : packSizeNum > 0 && isWeightUnit
      ? costPerPack / packSizeNum
      : costPerPack;

  // ── Manual CPU override ──
  const [costPerUnitOverride, setCostPerUnitOverride] = useState<string | null>(null);
  const displayCpu = costPerUnitOverride !== null
    ? costPerUnitOverride
    : (costPerUnit > 0 ? costPerUnit.toFixed(4) : "");

  // Quantity to store = total packs (what we bought, at pack level)
  // For ingredients measured in kg/L, total quantity = total packs × pack size
  const storedQuantity = isWeightUnit && packSizeNum > 0 ? totalPacks * packSizeNum : totalPacks;

  const CATEGORIES = ["Baked Goods / Desserts", "Bread", "Cheese & Dairy", "Coffee", "Drinks", "Dry Goods", "Frozen Goods", "Fruit & Veg", "Kitchen & Cleaning Consumables", "Meat", "Other", "Packaging", "Sauces", "Spices"];
  const UNITS = ["each", "kg", "g", "L", "ml", "pack", "dozen", "box"];

  const selectedIng = ingredients.find(i => i.id === Number(ingredientId));
  const unitLabel = tab === "match" ? (matchUnit || selectedIng?.unit || "unit") : (createUnit || "unit");

  const mutation = useMutation({
    mutationFn: () => {
      const cpuVal = parseFloat(displayCpu) || undefined;
      const avgWtVal = avgWeightKg ? parseFloat(avgWeightKg) * 1000 : undefined; // store in grams
      const body = tab === "match"
        ? {
            status: "matched",
            ingredientId: Number(ingredientId),
            costPerUnit: cpuVal,
            quantity: storedQuantity || undefined,
            unit: unitLabel || undefined,
            totalCost: effectiveTotalCost || undefined,
            notes: notes || undefined,
            brandName: brandName.trim() || undefined,
            avgWeightPerUnit: avgWtVal,  // update weight on matched ingredient
          }
        : {
            status: "added",
            costPerUnit: cpuVal,
            quantity: storedQuantity || undefined,
            unit: createUnit,
            totalCost: effectiveTotalCost || undefined,
            notes: notes || undefined,
            newIngredient: { name, category, unit: createUnit, avgWeightPerUnit: avgWtVal },
            brandName: brandName.trim() || undefined,
          };
      return apiRequest("PUT", `/api/xero/line-items/${line.id}/resolve`, body).then(r => r.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/xero/imports"] });
      queryClient.invalidateQueries({ queryKey: ["/api/xero/imports", invoice.id, "line-items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ingredients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      toast({ title: tab === "match" ? "Matched" : "Ingredient created & matched" });
      onClose();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const activeUnit = tab === "match" ? matchUnit : createUnit;
  const needsWeight = activeUnit === "each" && !avgWeightKg;
  const isValid = tab === "match" ? !!ingredientId : (!!name && !needsWeight);

  // ── Pricing Fields ──
  const PricingFields = (
    <div className="rounded-md border bg-muted/30 p-3 space-y-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pricing Breakdown</p>

      {/* Total cost from invoice */}
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Total Cost (from invoice)</Label>
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
            <Input
              type="text" inputMode="decimal" placeholder="0.00"
              value={totalCost}
              onChange={e => { setTotalCost(e.target.value); setCostPerUnitOverride(null); }}
              className="pl-7 font-medium"
              data-testid="input-total-cost"
            />
          </div>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer whitespace-nowrap select-none">
            <input
              type="checkbox"
              checked={addGst}
              onChange={e => { setAddGst(e.target.checked); setCostPerUnitOverride(null); }}
              className="rounded border-border w-3.5 h-3.5 accent-primary"
              data-testid="checkbox-add-gst"
            />
            Add GST (+10%)
          </label>
        </div>
        {addGst && totalCostNum > 0 && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            ${totalCostNum.toFixed(2)} × 1.1 = <span className="font-semibold">${effectiveTotalCost.toFixed(2)}</span> inc. GST
          </p>
        )}
      </div>

      {/* Carton → Pack → Unit breakdown */}
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">Quantity breakdown</p>
        <div className="grid grid-cols-3 gap-2">
          {/* Cartons */}
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Cartons</Label>
            <Input
              type="text" inputMode="decimal" placeholder="1"
              value={cartons}
              onChange={e => { setCartons(e.target.value); setCostPerUnitOverride(null); }}
              data-testid="input-cartons"
            />
          </div>
          {/* Packs per carton */}
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Packs / carton</Label>
            <Input
              type="text" inputMode="decimal" placeholder="1"
              value={packsPerCarton}
              onChange={e => { setPacksPerCarton(e.target.value); setCostPerUnitOverride(null); }}
              data-testid="input-packs-per-carton"
            />
          </div>
          {/* Pack size */}
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Pack size</Label>
            <Input
              type="text" inputMode="decimal" placeholder="e.g. 12"
              value={packSizeVal}
              onChange={e => { setPackSizeVal(e.target.value); setCostPerUnitOverride(null); }}
              data-testid="input-pack-size"
            />
          </div>
        </div>

        {/* Unit selector */}
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Unit</Label>
          {tab === "match" ? (
            <Select value={matchUnit} onValueChange={v => { setMatchUnit(v); setCostPerUnitOverride(null); }}>
              <SelectTrigger data-testid="select-unit-pricing" className="h-8 text-sm">
                <SelectValue placeholder="e.g. each" />
              </SelectTrigger>
              <SelectContent>{UNITS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
            </Select>
          ) : (
            <Select value={createUnit} onValueChange={v => { setCreateUnit(v); setCostPerUnitOverride(null); }}>
              <SelectTrigger data-testid="select-unit-create" className="h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>{UNITS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
            </Select>
          )}
        </div>
        {/* Weight per unit — required when unit is 'each' */}
        {activeUnit === "each" && (
          <div className="space-y-1">
            <Label className={`text-xs ${needsWeight ? "text-destructive" : "text-muted-foreground"}`}>
              Avg weight per unit (kg/L){needsWeight && <span className="ml-1">*</span>}
            </Label>
            <Input
              type="text" inputMode="decimal"
              placeholder="e.g. 0.085 for a 12&quot; wrap"
              value={avgWeightKg}
              onChange={e => setAvgWeightKg(e.target.value)}
              className={needsWeight ? "border-destructive" : ""}
              data-testid="input-avg-weight"
            />
            {needsWeight && (
              <p className="text-xs text-destructive">Required — enter the item’s average weight so nutrition and serving size can be calculated</p>
            )}
          </div>
        )}
      </div>

      {/* Calculated breakdown */}
      {(cartonsNum > 0 || totalCostNum > 0) && (
        <div className="rounded bg-primary/5 border border-primary/20 p-2.5 space-y-1 text-xs">
          {cartonsNum > 0 && packsPerCartonNum > 0 && (
            <div className="flex justify-between text-muted-foreground">
              <span>Total packs</span>
              <span className="font-medium text-foreground tabular-nums">
                {cartonsNum} × {packsPerCartonNum} = <span className="text-primary">{totalPacks}</span>
              </span>
            </div>
          )}
          {costPerPack > 0 && (
            <div className="flex justify-between text-muted-foreground">
              <span>Cost per pack</span>
              <span className="font-medium text-foreground tabular-nums">${costPerPack.toFixed(4)}</span>
            </div>
          )}
          {packSizeNum > 0 && costPerUnit > 0 && (
            <div className="flex justify-between text-muted-foreground">
              <span>Pack size</span>
              <span className="font-medium text-foreground tabular-nums">{packSizeNum} {unitLabel}</span>
            </div>
          )}
          {costPerUnit > 0 && (
            <div className="flex justify-between font-semibold text-foreground border-t border-primary/20 pt-1 mt-1">
              <span>Cost per {unitLabel}</span>
              <span className="text-primary tabular-nums">${costPerUnit.toFixed(4)}</span>
            </div>
          )}
        </div>
      )}

      {/* Manual CPU override */}
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
          Cost per {unitLabel} — override
          {costPerUnitOverride === null && displayCpu && (
            <span className="text-primary text-xs font-normal">auto-calculated</span>
          )}
        </Label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
          <Input
            type="text" inputMode="decimal" placeholder="auto"
            value={displayCpu}
            onChange={e => setCostPerUnitOverride(e.target.value)}
            className={`pl-7 ${costPerUnitOverride === null && displayCpu ? "text-primary font-medium" : ""}`}
            data-testid="input-cost"
          />
        </div>
      </div>
    </div>
  );

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" data-testid="dialog-resolve">
        <DialogHeader>
          <DialogTitle>Match Line Item</DialogTitle>
        </DialogHeader>

        {/* Invoice line summary */}
        <div className="rounded-md bg-muted/60 p-3 text-sm space-y-0.5">
          <p className="font-medium">{invoice.supplierName || "Unknown supplier"}</p>
          <p className="text-xs text-muted-foreground">
            {invoice.invoiceDate?.split("T")[0]} · Invoice total ${invoice.totalAmount?.toFixed(2) ?? "—"}
          </p>
          {line.description && (
            <p className="text-xs text-muted-foreground mt-1">Line: <span className="font-medium text-foreground">{line.description}</span></p>
          )}
          {hasCartonData && (
            <p className="text-xs text-primary mt-1">
              {line.cartonsSupplied != null && `${line.cartonsSupplied} carton${line.cartonsSupplied !== 1 ? "s" : ""}`}
              {line.packsPerCarton != null && ` × ${line.packsPerCarton} packs`}
              {line.packSize != null && ` × ${line.packSize}${line.packUnit ? " " + line.packUnit : ""}/pack`}
            </p>
          )}
        </div>

        {/* Tab switcher */}
        <div className="flex rounded-lg border border-border overflow-hidden text-sm">
          <button
            className={cn(
              "flex-1 py-2 px-3 font-medium transition-colors",
              tab === "match"
                ? "bg-primary text-primary-foreground"
                : "bg-muted/40 text-muted-foreground hover:bg-muted"
            )}
            onClick={() => setTab("match")}
            data-testid="tab-match"
          >
            Match Existing
          </button>
          <button
            className={cn(
              "flex-1 py-2 px-3 font-medium transition-colors border-l border-border",
              tab === "create"
                ? "bg-primary text-primary-foreground"
                : "bg-muted/40 text-muted-foreground hover:bg-muted"
            )}
            onClick={() => setTab("create")}
            data-testid="tab-create"
          >
            Create New
          </button>
        </div>

        <div className="space-y-4">
          {tab === "match" ? (
            <div className="space-y-2">
              <Label>Choose ingredient</Label>
              {memorySuggestion && (
                <div className="flex items-center gap-1.5 text-xs bg-primary/10 text-primary rounded px-2 py-1">
                  <span>Remembered from previous invoice:</span>
                  <span className="font-semibold">{memorySuggestion}</span>
                </div>
              )}
              <SearchableSelect
                value={ingredientId}
                onValueChange={v => {
                  setIngredientId(v);
                  setMemorySuggestion(null);
                  const ing = ingredients.find(i => i.id === Number(v));
                  if (ing && !line.packUnit) setMatchUnit(ing.unit?.toLowerCase() || "each");
                  // Only pre-populate brand from ingredient if invoice line has no brand
                  if (ing && !line.brandName?.trim()) setBrandName((ing as any).brandName || "");
                }}
                options={ingredients.map(i => ({ value: String(i.id), label: `${i.name} (${i.unit})` }))}
                placeholder="Search ingredients…"
                data-testid="searchable-select-ingredient"
              />
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <Label>Ingredient name</Label>
                <Input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="e.g. Smoked Salmon"
                  data-testid="input-new-name"
                />
              </div>
              <div className="space-y-2">
                <Label>Category</Label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger data-testid="select-category"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </>
          )}

          {PricingFields}

          {/* Brand Name */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>Brand Name</Label>
              <span className="text-xs text-muted-foreground">Auto-updates allergens &amp; PEAL</span>
            </div>
            <Input
              placeholder="e.g. Fountain BBQ Sauce 2L"
              value={brandName}
              onChange={e => setBrandName(e.target.value)}
              data-testid="input-brand-name"
            />
            <p className="text-xs text-muted-foreground">Auto-filled from invoice. For produce suppliers (no brand), the supplier name is used automatically.</p>
          </div>

          <div className="space-y-2">
            <Label>Notes (optional)</Label>
            <Input placeholder="Optional notes" value={notes} onChange={e => setNotes(e.target.value)} data-testid="input-notes" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={!isValid || mutation.isPending}
            data-testid="button-confirm"
          >
            {mutation.isPending ? "Saving…" : tab === "match" ? "Confirm Match" : "Create & Match"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Line item row ─────────────────────────────────────────────────────────────
function LineItemRow({
  line,
  invoice,
  ingredients,
}: {
  line: XeroLineItem;
  invoice: XeroImport;
  ingredients: Ingredient[];
}) {
  const { toast } = useToast();
  const [resolveMode, setResolveMode] = useState(false);

  const ignoreMutation = useMutation({
    mutationFn: () => apiRequest("PUT", `/api/xero/line-items/${line.id}/resolve`, { status: "ignored" }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/xero/imports"] });
      queryClient.invalidateQueries({ queryKey: ["/api/xero/imports", invoice.id, "line-items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      toast({ title: "Line ignored" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/xero/line-items/${line.id}`).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/xero/imports", invoice.id, "line-items"] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const isPending = line.status === "pending";

  return (
    <>
      <div
        className={cn(
          "flex items-center gap-3 px-4 py-2.5 text-sm border-t border-border/50",
          isPending ? "bg-amber-50/20 dark:bg-amber-950/10" : "opacity-70"
        )}
        data-testid={`line-item-${line.id}`}
      >
        <div className="flex-1 min-w-0">
          <p className="text-xs text-foreground font-medium truncate">
            {line.description || <span className="italic text-muted-foreground">No description</span>}
          </p>
          {line.ingredientName && (
            <p className="text-xs text-primary mt-0.5">{line.ingredientName}</p>
          )}
        </div>

        {/* Show invoice data even when pending */}
        {line.costPerUnit != null && (
          <div className="text-xs text-muted-foreground whitespace-nowrap tabular-nums">
            ${line.costPerUnit.toFixed(2)}/{line.unit || "unit"}
            {line.quantity != null && <span> × {line.quantity}</span>}
            {line.lineTotal != null && <span className="text-foreground font-medium ml-1">= ${line.lineTotal.toFixed(2)}</span>}
          </div>
        )}

        <StatusBadge status={line.status} />

        {isPending ? (
          <div className="flex items-center gap-1 shrink-0">
            <Button
              size="sm" variant="outline"
              className="h-6 px-2 text-xs gap-1 hover:bg-primary hover:text-primary-foreground hover:border-primary"
              onClick={() => setResolveMode(true)}
              data-testid={`button-line-match-${line.id}`}
            >
              <Link2 size={10} /> Match
            </Button>
            <Button
              size="sm" variant="ghost"
              className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => ignoreMutation.mutate()}
              disabled={ignoreMutation.isPending}
              data-testid={`button-line-ignore-${line.id}`}
            >
              <EyeOff size={10} />
            </Button>
            <Button
              size="sm" variant="ghost"
              className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
              data-testid={`button-line-delete-${line.id}`}
            >
              <Trash2 size={10} />
            </Button>
          </div>
        ) : (
          <Button
            size="sm" variant="ghost"
            className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
            onClick={() => deleteMutation.mutate()}
            disabled={deleteMutation.isPending}
            data-testid={`button-line-delete-${line.id}`}
          >
            <Trash2 size={10} />
          </Button>
        )}
      </div>

      {resolveMode && (
        <ResolveLineDialog
          line={line}
          invoice={invoice}
          ingredients={ingredients}
          onClose={() => setResolveMode(false)}
        />
      )}
    </>
  );
}

// ── Invoice accordion card ────────────────────────────────────────────────────
function InvoiceCard({
  invoice,
  ingredients,
  defaultOpen,
}: {
  invoice: XeroImport;
  ingredients: Ingredient[];
  defaultOpen?: boolean;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(defaultOpen ?? false);
  const [descInput, setDescInput] = useState("");

  const { data: lineItems = [], isLoading: linesLoading } = useQuery<XeroLineItem[]>({
    queryKey: ["/api/xero/imports", invoice.id, "line-items"],
    queryFn: () => apiRequest("GET", `/api/xero/imports/${invoice.id}/line-items`).then(r => r.json()),
    enabled: open,
  });

  const addLineMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/xero/imports/${invoice.id}/line-items`, { description: descInput || null }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/xero/imports", invoice.id, "line-items"] });
      setDescInput("");
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const ignoreMutation = useMutation({
    mutationFn: () => apiRequest("PUT", `/api/xero/imports/${invoice.id}/ignore`).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/xero/imports"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      toast({ title: "Invoice ignored" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const pendingLineCount = lineItems.filter(l => l.status === "pending").length;
  const allocatedTotal = lineItems.reduce((sum, l) => sum + (l.lineTotal ?? 0), 0);
  const remaining = (invoice.totalAmount ?? 0) - allocatedTotal;

  return (
    <div
      className={cn(
        "rounded-lg border overflow-hidden transition-all",
        invoice.status === "pending" ? "border-amber-200 dark:border-amber-800/50" : "border-border opacity-75"
      )}
      data-testid={`invoice-card-${invoice.id}`}
    >
      {/* Invoice header row */}
      <div
        className={cn(
          "w-full flex items-center gap-3 px-4 py-3 text-left transition-colors",
          invoice.status === "pending"
            ? "bg-amber-50/40 dark:bg-amber-950/20 hover:bg-amber-50/70 dark:hover:bg-amber-950/30"
            : "bg-muted/30 hover:bg-muted/50"
        )}
      >
        {/* clickable chevron + title area */}
        <button
          className="flex items-center gap-3 flex-1 min-w-0 text-left"
          onClick={() => setOpen(!open)}
          data-testid={`invoice-toggle-${invoice.id}`}
        >
          <span className="text-muted-foreground shrink-0">
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </span>
          <Receipt size={14} className="text-muted-foreground shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm text-foreground truncate">
                {invoice.supplierName || "Unknown supplier"}
              </span>
              {invoice.xeroInvoiceNumber && (
                <span className="text-xs text-muted-foreground">#{invoice.xeroInvoiceNumber}</span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {invoice.invoiceDate?.split("T")[0] ?? "—"}
              {open && lineItems.length > 0 && ` · ${lineItems.length} line${lineItems.length !== 1 ? "s" : ""}`}
              {open && pendingLineCount > 0 && ` · ${pendingLineCount} pending`}
            </p>
          </div>
        </button>

        {/* Right side: amount + badge + ignore button */}
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-sm font-semibold tabular-nums">
            ${invoice.totalAmount?.toFixed(2) ?? "—"}
          </span>
          <StatusBadge status={invoice.status} />
          {/* Ignore invoice button — always visible on pending invoices */}
          {invoice.status === "pending" && (
            <Button
              size="sm" variant="ghost"
              className="h-7 px-2 text-xs gap-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
              onClick={e => { e.stopPropagation(); ignoreMutation.mutate(); }}
              disabled={ignoreMutation.isPending}
              title="Ignore this invoice"
              data-testid={`button-ignore-invoice-header-${invoice.id}`}
            >
              <Ban size={12} /> Ignore
            </Button>
          )}
        </div>
      </div>

      {/* Expanded content */}
      {open && (
        <div className="bg-background">
          {/* PDF panel */}
          <div className="px-4 pt-3 pb-2 border-t border-border/50">
            <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">Invoice PDF</p>
            <PdfPanel invoice={invoice} />
          </div>

          {/* Allocation progress */}
          {invoice.totalAmount != null && lineItems.length > 0 && (
            <div className="px-4 py-2 border-t border-border/50 bg-muted/20">
              <div className="flex items-center justify-between text-xs text-muted-foreground mb-1.5">
                <span>Allocated: <span className="font-medium text-foreground">${allocatedTotal.toFixed(2)}</span> of ${invoice.totalAmount.toFixed(2)}</span>
                <span className={cn("font-medium", Math.abs(remaining) < 0.01 ? "text-green-600" : remaining > 0 ? "text-amber-600" : "text-red-500")}>
                  {Math.abs(remaining) < 0.01 ? "Fully allocated ✓" : remaining > 0 ? `$${remaining.toFixed(2)} unallocated` : `$${Math.abs(remaining).toFixed(2)} over`}
                </span>
              </div>
              <div className="w-full h-1.5 rounded-full bg-border overflow-hidden">
                <div
                  className={cn("h-full rounded-full transition-all", Math.abs(remaining) < 0.01 ? "bg-green-500" : "bg-primary")}
                  style={{ width: `${Math.min(100, invoice.totalAmount > 0 ? (allocatedTotal / invoice.totalAmount) * 100 : 0)}%` }}
                />
              </div>
            </div>
          )}

          {/* Line items */}
          {linesLoading ? (
            <div className="px-4 py-3 text-xs text-muted-foreground border-t border-border/50">Loading…</div>
          ) : lineItems.length === 0 ? (
            <div className="px-4 py-3 border-t border-border/50 text-center">
              <p className="text-xs text-muted-foreground">
                No line items yet. Add one for each product on this invoice.
              </p>
            </div>
          ) : (
            lineItems.map(line => (
              <LineItemRow
                key={line.id}
                line={line}
                invoice={invoice}
                ingredients={ingredients}
              />
            ))
          )}

          {/* Add line item row */}
          {invoice.status === "pending" && (
            <div className="px-4 py-3 border-t border-border/50 flex items-center gap-2 bg-muted/10">
              <Input
                placeholder="Line description (e.g. Chicken Breast 5kg)…"
                value={descInput}
                onChange={e => setDescInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") addLineMutation.mutate(); }}
                className="h-7 text-xs flex-1"
                data-testid={`input-line-desc-${invoice.id}`}
              />
              <Button
                size="sm" variant="outline"
                className="h-7 px-2 text-xs gap-1 shrink-0"
                onClick={() => addLineMutation.mutate()}
                disabled={addLineMutation.isPending}
                data-testid={`button-add-line-${invoice.id}`}
              >
                <PlusCircle size={10} /> Add line
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Upload Invoice dialog ─────────────────────────────────────────────────────
function UploadInvoiceDialog({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  // step: 'upload' | 'supplier' | 'done'
  const [step, setStep] = useState<'upload' | 'supplier' | 'done'>('upload');
  const [parsed, setParsed] = useState<any>(null); // raw upload result
  const [finalResult, setFinalResult] = useState<any>(null);

  // Supplier step state
  const [supplierMode, setSupplierMode] = useState<'confirm' | 'link' | 'create'>('confirm');
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>("");
  const [newSupplierName, setNewSupplierName] = useState("");
  const [supplierSaving, setSupplierSaving] = useState(false);

  const { data: suppliers = [] } = useQuery<any[]>({
    queryKey: ["/api/suppliers"],
    queryFn: () => apiRequest("GET", "/api/suppliers").then(r => r.json()),
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("pdf", file);
      const res = await fetch(`${API_BASE}/api/drive/upload`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || "Upload failed");
      }
      return res.json();
    },
    onSuccess: (data) => {
      setParsed(data);
      queryClient.invalidateQueries({ queryKey: ["/api/xero/imports"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      // Pre-fill supplier step using detected name + memory suggestion
      if (data.supplierName) {
        setNewSupplierName(data.supplierName);
        // Exact name match
        const exactMatch = suppliers.find(
          (s: any) => s.name.toLowerCase() === data.supplierName.toLowerCase()
        );
        if (exactMatch) {
          setSelectedSupplierId(String(exactMatch.id));
          setSupplierMode('confirm');
        } else if (data.suggestedSupplierId) {
          // Memory knows this invoice — pre-select the remembered supplier
          setSelectedSupplierId(String(data.suggestedSupplierId));
          setSupplierMode('link'); // show as link so user can confirm/change
        } else {
          setSupplierMode('create'); // unknown — default to create new
        }
      } else {
        setSupplierMode('link'); // no name detected — must pick
      }
      setStep('supplier');
    },
    onError: (e: any) => toast({ title: "Upload failed", description: e.message, variant: "destructive" }),
  });

  const isAcceptedInvoiceFile = (file: File) => {
    const accepted = ['application/pdf','image/jpeg','image/jpg','image/png','image/tiff','image/bmp','image/gif','image/webp'];
    if (accepted.includes(file.type)) return true;
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    return ['pdf','jpg','jpeg','png','tiff','tif','bmp','gif','webp'].includes(ext);
  };
  const handleFile = (file: File) => {
    if (!isAcceptedInvoiceFile(file)) {
      toast({ title: "Unsupported file type", description: "Please upload a PDF, JPG, or PNG invoice.", variant: "destructive" });
      return;
    }
    uploadMutation.mutate(file);
  };

  const handleConfirmSupplier = async () => {
    if (!parsed?.importId) return;
    setSupplierSaving(true);
    try {
      let body: any = {};
      if (supplierMode === 'confirm') {
        // Already matched — use existing supplier
        const match = suppliers.find(
          (s: any) => s.name.toLowerCase() === (parsed.supplierName || "").toLowerCase()
        );
        body = match
          ? { supplierId: match.id, supplierName: match.name }
          : { createNew: true, supplierName: parsed.supplierName };
      } else if (supplierMode === 'link') {
        if (!selectedSupplierId) { toast({ title: "Please select a supplier" }); setSupplierSaving(false); return; }
        body = { supplierId: Number(selectedSupplierId) };
      } else {
        // create
        const name = newSupplierName.trim();
        if (!name) { toast({ title: "Please enter a supplier name" }); setSupplierSaving(false); return; }
        body = { createNew: true, supplierName: name };
      }
      const res = await fetch(`${API_BASE}/api/xero/imports/${parsed.importId}/supplier`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save supplier");
      queryClient.invalidateQueries({ queryKey: ["/api/xero/imports"] });
      queryClient.invalidateQueries({ queryKey: ["/api/suppliers"] });
      setFinalResult({ ...parsed, supplierName: data.supplierName });
      setStep('done');
    } catch (e: any) {
      toast({ title: "Failed to save supplier", description: e.message, variant: "destructive" });
    } finally {
      setSupplierSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {step === 'upload' && "Upload Invoice"}
            {step === 'supplier' && "Confirm Supplier"}
            {step === 'done' && "Invoice Imported"}
          </DialogTitle>
        </DialogHeader>

        {step === 'done' ? (
          // Success state
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
              <CheckCircle2 size={18} />
              <span className="font-medium text-sm">Invoice imported successfully</span>
            </div>
            <div className="rounded-lg bg-muted/60 p-3 space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Supplier</span>
                <span className="font-medium">{finalResult?.supplierName || "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Invoice #</span>
                <span className="font-medium">{finalResult?.invoiceNumber || "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Date</span>
                <span className="font-medium">{finalResult?.invoiceDate || "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total</span>
                <span className="font-medium">{finalResult?.totalAmount != null ? `$${finalResult.totalAmount.toFixed(2)}` : "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Line items</span>
                <span className="font-medium">{finalResult?.lineItemsCreated} extracted</span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">Expand the invoice in the list to match each line item to an ingredient.</p>
          </div>

        ) : step === 'supplier' ? (
          // Supplier confirmation step
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {parsed?.supplierName
                ? <>We detected <span className="font-semibold text-foreground">{parsed.supplierName}</span> as the supplier. Please confirm, link to an existing supplier, or create a new one.</>  
                : "We couldn't detect a supplier name from this invoice. Please link it to an existing supplier or create a new one."
              }
            </p>

            {/* Mode tabs */}
            <div className="flex rounded-md border border-border overflow-hidden text-xs font-medium">
              {parsed?.supplierName && (
                <button
                  className={cn("flex-1 py-2 px-3 transition-colors", supplierMode === 'confirm' ? "bg-primary text-primary-foreground" : "hover:bg-muted/50")}
                  onClick={() => setSupplierMode('confirm')}
                >Use Detected</button>
              )}
              <button
                className={cn("flex-1 py-2 px-3 transition-colors", supplierMode === 'link' ? "bg-primary text-primary-foreground" : "hover:bg-muted/50")}
                onClick={() => setSupplierMode('link')}
              >Link Existing</button>
              <button
                className={cn("flex-1 py-2 px-3 transition-colors", supplierMode === 'create' ? "bg-primary text-primary-foreground" : "hover:bg-muted/50")}
                onClick={() => setSupplierMode('create')}
              >Create New</button>
            </div>

            {supplierMode === 'confirm' && (
              <div className="rounded-lg bg-muted/50 p-3 text-sm">
                <p className="text-muted-foreground text-xs mb-1">Detected supplier</p>
                <p className="font-semibold text-foreground">{parsed?.supplierName}</p>
                {suppliers.find((s: any) => s.name.toLowerCase() === (parsed?.supplierName || "").toLowerCase()) ? (
                  <p className="text-xs text-green-600 dark:text-green-400 mt-1">Matched to existing supplier</p>
                ) : (
                  <p className="text-xs text-primary mt-1">Will be created as a new supplier</p>
                )}
              </div>
            )}

            {supplierMode === 'link' && (
              <div className="space-y-1.5">
                {parsed?.suggestedSupplierId && selectedSupplierId === String(parsed.suggestedSupplierId) && (
                  <div className="flex items-center gap-1.5 text-xs bg-primary/10 text-primary rounded px-2 py-1 mb-1">
                    <span>Remembered from previous invoice — please confirm or change:</span>
                    <span className="font-semibold">{suppliers.find((s: any) => s.id === parsed.suggestedSupplierId)?.name || ""}</span>
                  </div>
                )}
                <Label className="text-xs">Select existing supplier</Label>
                <Select value={selectedSupplierId} onValueChange={setSelectedSupplierId}>
                  <SelectTrigger><SelectValue placeholder="Choose supplier…" /></SelectTrigger>
                  <SelectContent>
                    {[...suppliers].sort((a: any, b: any) => a.name.localeCompare(b.name)).map((s: any) => (
                      <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {supplierMode === 'create' && (
              <div className="space-y-1.5">
                <Label className="text-xs">New supplier name</Label>
                <Input
                  value={newSupplierName}
                  onChange={e => setNewSupplierName(e.target.value)}
                  placeholder="e.g. B&E Foods Perth Pty Ltd"
                />
                <p className="text-xs text-muted-foreground">You can add contact details on the Suppliers page later.</p>
              </div>
            )}
          </div>

        ) : uploadMutation.isPending ? (
          // Loading state
          <div className="py-8 text-center space-y-3">
            <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-sm font-medium">Reading invoice…</p>
            <p className="text-xs text-muted-foreground">Extracting supplier, line items and totals automatically</p>
          </div>
        ) : (
          // Drop zone
          <div
            className={cn(
              "border-2 border-dashed rounded-xl px-6 py-12 text-center transition-colors cursor-pointer",
              dragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/30"
            )}
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload size={32} className="mx-auto mb-3 text-muted-foreground" />
            <p className="text-sm font-semibold">Drop your invoice here</p>
            <p className="text-xs text-muted-foreground mt-1">or click to browse</p>
            <p className="text-xs text-muted-foreground mt-3 opacity-70">Supplier name, invoice number, date, total and line items will be extracted automatically</p>
            <input ref={fileInputRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.tiff,.tif,.bmp,.gif,.webp" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
          </div>
        )}

        <DialogFooter>
          {step === 'done' ? (
            <Button onClick={onClose}>Done</Button>
          ) : step === 'supplier' ? (
            <div className="flex gap-2 w-full justify-end">
              <Button variant="outline" onClick={onClose} disabled={supplierSaving}>Cancel</Button>
              <Button onClick={handleConfirmSupplier} disabled={supplierSaving}>
                {supplierSaving ? "Saving…" : "Confirm Supplier"}
              </Button>
            </div>
          ) : (
            <Button variant="outline" onClick={onClose} disabled={uploadMutation.isPending}>Cancel</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function XeroImports() {
  const { toast } = useToast();
  const [filter, setFilter] = useState<"all" | "pending" | "resolved">("pending");
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  const { data: imports = [], isLoading, refetch: refetchImports } = useQuery<XeroImport[]>({
    queryKey: ["/api/xero/imports"],
    queryFn: () => apiRequest("GET", "/api/xero/imports").then(r => r.json()),
    refetchInterval: 30000,
  });

  const { data: ingredients = [] } = useQuery<Ingredient[]>({
    queryKey: ["/api/ingredients"],
    queryFn: () => apiRequest("GET", "/api/ingredients").then(r => r.json()),
  });

  const { data: appSettings } = useQuery<Record<string, string>>({
    queryKey: ["/api/settings"],
    queryFn: () => apiRequest("GET", "/api/settings").then(r => r.json()),
  });

  const filtered = imports.filter(xi => {
    if (filter === "pending") return xi.status === "pending";
    if (filter === "resolved") return xi.status !== "pending";
    return true;
  });

  const pendingCount = imports.filter(xi => xi.status === "pending").length;

  // Drive folder ID — from settings (fallback to known Receipts folder)
  const DRIVE_FOLDER_ID = appSettings?.drive_receipts_folder_id || "1sOleWNmsDK4g5BV6fL7MRK_qVKr5Vjj1";

  // Google OAuth client ID — read from app settings (configured in Settings page)
  const GOOGLE_CLIENT_ID = appSettings?.google_client_id || "";

  // Sync with Drive using Google Identity Services OAuth2 token flow
  const handleDriveSync = async () => {
    if (!GOOGLE_CLIENT_ID) {
      toast({
        title: "Google Client ID not configured",
        description: "Add VITE_GOOGLE_CLIENT_ID to your .env file to enable Drive sync. See Settings for instructions.",
        variant: "destructive",
      });
      return;
    }

    setIsSyncing(true);
    try {
      // Request an OAuth2 access token via Google Identity Services popup
      const accessToken = await new Promise<string>((resolve, reject) => {
        const tokenClient = (window as any).google?.accounts?.oauth2?.initTokenClient({
          client_id: GOOGLE_CLIENT_ID,
          scope: "https://www.googleapis.com/auth/drive.readonly",
          callback: (response: any) => {
            if (response.error) reject(new Error(response.error));
            else resolve(response.access_token);
          },
        });
        if (!tokenClient) {
          reject(new Error("Google Identity Services not loaded. Please refresh the page."));
          return;
        }
        tokenClient.requestAccessToken({ prompt: "none" });
      });

      // Call the server to scan the Drive folder
      const res = await apiRequest("POST", "/api/drive/scan-folder", {
        accessToken,
        folderId: DRIVE_FOLDER_ID,
        deleteAfterImport: false,
      });
      const data = await res.json();

      if (!data.ok) {
        throw new Error(data.error || "Sync failed");
      }

      await refetchImports();
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });

      toast({
        title: `Drive sync complete`,
        description: `${data.imported} new invoice${data.imported !== 1 ? "s" : ""} imported, ${data.skipped} already imported${data.errors > 0 ? `, ${data.errors} failed` : ""}.`,
      });

    } catch (err: any) {
      // If "consent required" error, re-try with consent prompt
      if (err.message?.includes("consent") || err.message?.includes("interaction_required")) {
        try {
          const accessToken = await new Promise<string>((resolve, reject) => {
            const tokenClient = (window as any).google?.accounts?.oauth2?.initTokenClient({
              client_id: GOOGLE_CLIENT_ID,
              scope: "https://www.googleapis.com/auth/drive.readonly",
              callback: (response: any) => {
                if (response.error) reject(new Error(response.error));
                else resolve(response.access_token);
              },
            });
            tokenClient.requestAccessToken({ prompt: "consent" });
          });
          const res = await apiRequest("POST", "/api/drive/scan-folder", {
            accessToken,
            folderId: DRIVE_FOLDER_ID,
            deleteAfterImport: false,
          });
          const data = await res.json();
          await refetchImports();
          queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
          toast({ title: "Drive sync complete", description: `${data.imported || 0} invoice(s) imported.` });
        } catch (e2: any) {
          toast({ title: "Drive sync failed", description: e2.message, variant: "destructive" });
        }
      } else {
        toast({ title: "Drive sync failed", description: err.message, variant: "destructive" });
      }
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-screen-xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-foreground" style={{ fontFamily: "'Cabinet Grotesk', sans-serif" }}>
            Invoice Imports
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Invoices synced from your Google Drive Receipts folder. Expand each one to view the PDF and match line items to ingredients.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {pendingCount > 0 && (
            <div className="flex items-center gap-2 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-400 px-3 py-1.5 text-sm font-medium shrink-0">
              <AlertCircle size={14} />
              {pendingCount} pending
            </div>
          )}
          <Button
            variant="outline"
            className="gap-2 h-9"
            onClick={() => setShowUploadDialog(true)}
          >
            <Upload size={14} /> Upload Invoice
          </Button>
          <Button
            className="gap-2 h-9 bg-primary text-primary-foreground hover:bg-primary/90"
            onClick={handleDriveSync}
            disabled={isSyncing}
          >
            <CloudDownload size={14} /> {isSyncing ? "Refreshing…" : "Sync with Drive"}
          </Button>
        </div>
      </div>

      {/* How it works */}
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="py-3 px-4 space-y-1">
          <p className="text-sm text-foreground font-medium">How it works</p>
          <ol className="text-sm text-muted-foreground space-y-0.5 list-decimal list-inside">
            <li>Drop invoices/receipts into your <strong className="text-foreground">Google Drive "Receipts" folder</strong> — click <strong className="text-foreground">Sync with Drive</strong> or ask the agent to pull new ones</li>
            <li>Expand an invoice — line items are pre-filled from the PDF and the PDF is viewable right here</li>
            <li><strong className="text-foreground">Match</strong> each line to an existing ingredient or <strong className="text-foreground">Add</strong> a new one — cost and quantity are pre-populated from the invoice</li>
            <li>The progress bar shows how much of the invoice total you've allocated</li>
          </ol>
        </CardContent>
      </Card>

      {/* Filter tabs */}
      <div className="flex gap-2">
        {(["pending", "all", "resolved"] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              "px-3 py-1.5 rounded-md text-sm font-medium transition-colors capitalize",
              filter === f
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            )}
            data-testid={`filter-${f}`}
          >
            {f === "all" ? `All (${imports.length})` : f === "pending" ? `Pending (${pendingCount})` : `Resolved (${imports.length - pendingCount})`}
          </button>
        ))}
      </div>

      {/* Invoice list */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="h-14 rounded-lg bg-muted animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card className="p-12 text-center">
          <RefreshCw size={36} className="mx-auto mb-3 text-muted-foreground" />
          <p className="font-medium text-foreground">
            {filter === "pending" ? "No pending invoices" : "No imports yet"}
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            Drop invoices into your Google Drive "Receipts" folder and click Sync with Drive, or upload one directly.
          </p>
          <div className="flex gap-2 justify-center mt-4">
            <Button variant="outline" className="gap-2" onClick={() => setShowUploadDialog(true)}>
              <Upload size={14} /> Upload Invoice
            </Button>
            <Button className="gap-2" onClick={handleDriveSync} disabled={isSyncing}>
              <CloudDownload size={14} /> Sync with Drive
            </Button>
          </div>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map(xi => (
            <InvoiceCard
              key={xi.id}
              invoice={xi}
              ingredients={ingredients}
              defaultOpen={false}
            />
          ))}
        </div>
      )}

      {showUploadDialog && <UploadInvoiceDialog onClose={() => setShowUploadDialog(false)} />}
    </div>
  );
}
