import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Package, Plus, QrCode, Printer, ChevronDown, ChevronRight, RefreshCw, Search } from "lucide-react";
import { BatchTraceabilityTab } from "./BatchTraceability";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import QRCode from "qrcode";

// ─── Types ────────────────────────────────────────────────────────────────────
interface Batch {
  id: number;
  batch_id: string;
  batch_type: "parent" | "child";
  parent_batch_id: string | null;
  product_name: string;
  product_code: string;
  stage: "raw" | "cooked" | "frozen";
  total_weight_kg: number | null;
  num_boxes: number | null;
  weight_per_box_kg: number | null;
  notes: string;
  created_by: string;
  created_at: string;
  use_by_date: string | null;
  frozen_at: string | null;
  freezer_unit: string | null;
  status: "active" | "consumed" | "disposed";
  ingredient_id: number | null;
  delivery_log_id: number | null;
}

interface Ingredient {
  id: number;
  name: string;
  category: string;
}

// ─── Label component (print-friendly) ────────────────────────────────────────
// Layout: brand header · large QR · product name + individual weight · batch ID
function BatchLabel({ batch, qrUrl }: { batch: Partial<Batch>; qrUrl: string }) {
  // Individual weight: weight_per_box_kg if set, else total_weight_kg (bulk)
  const indivWeight = batch.weight_per_box_kg
    ? `${Number(batch.weight_per_box_kg).toFixed(2)}kg`
    : batch.total_weight_kg && !batch.num_boxes
    ? `${Number(batch.total_weight_kg).toFixed(2)}kg`
    : batch.total_weight_kg && batch.num_boxes
    ? `${(Number(batch.total_weight_kg) / Number(batch.num_boxes)).toFixed(2)}kg`
    : null;

  return (
    <div
      id="batch-label-print"
      className="bg-white text-black"
      style={{
        width: 189,      // 50mm @ 96dpi
        height: 189,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "6px 6px 5px",
        boxSizing: "border-box",
        border: "1px solid #000",
        borderRadius: 2,
        overflow: "hidden",
      }}
    >
      {/* Top: brand name */}
      <div style={{
        fontSize: 7,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        fontFamily: "'Courier New', monospace",
        textAlign: "center",
        lineHeight: 1.2,
        width: "100%",
        borderBottom: "0.5px solid #000",
        paddingBottom: 3,
      }}>
        The Deli · by Greenhorns
      </div>

      {/* Middle: QR code */}
      {qrUrl && (
        <img
          src={qrUrl}
          alt="QR"
          style={{ width: 108, height: 108, display: "block", imageRendering: "pixelated" }}
        />
      )}

      {/* Bottom: name + weight + batch ID */}
      <div style={{
        width: "100%",
        textAlign: "center",
        fontFamily: "'Courier New', monospace",
        borderTop: "0.5px solid #000",
        paddingTop: 3,
      }}>
        <div style={{ fontSize: 9, fontWeight: 700, lineHeight: 1.3 }}>
          {batch.product_name}
          {indivWeight ? ` · ${indivWeight}` : ""}
        </div>
        <div style={{ fontSize: 7.5, fontWeight: 600, letterSpacing: "0.03em", marginTop: 1, lineHeight: 1.2 }}>
          {batch.batch_id}
        </div>
      </div>
    </div>
  );
}

// ─── QR modal ─────────────────────────────────────────────────────────────────
function QRModal({
  batch,
  onClose,
}: {
  batch: Batch;
  onClose: () => void;
}) {
  const [qrUrl, setQrUrl] = useState("");

  useEffect(() => {
    QRCode.toDataURL(batch.batch_id, { width: 300, margin: 2 }).then(setQrUrl);
  }, [batch.batch_id]);

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full mx-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-lg">Batch QR Code</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-xl leading-none">&times;</button>
        </div>
        <div className="text-center space-y-3">
          {qrUrl && <img src={qrUrl} alt="QR Code" className="mx-auto rounded" />}
          <p className="text-sm font-mono font-bold">{batch.batch_id}</p>
          <p className="text-xs text-muted-foreground">{batch.product_name}</p>
        </div>
        <div className="mt-4 space-y-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Label preview (50×50mm)</p>
          <BatchLabel
            batch={batch}
            qrUrl={qrUrl}
          />
        </div>
        <div className="mt-4 flex gap-2">
          <Button onClick={handlePrint} className="flex-1 gap-2 bg-[#256984] hover:bg-[#256984]/90">
            <Printer size={15} /> Print Label
          </Button>
          <Button variant="outline" onClick={onClose} className="flex-1">
            Close
          </Button>
        </div>
      </div>

      {/* Print-only styles */}
      <style>{`
        @media print {
          body > * { display: none !important; }
          #batch-label-print {
            display: block !important;
            position: fixed;
            top: 0; left: 0;
            width: 50mm;
            height: 50mm;
            border: none;
            page-break-after: avoid;
          }
        }
      `}</style>
    </div>
  );
}

// ─── Create Parent Batch Form ─────────────────────────────────────────────────
function CreateParentForm({ onSuccess }: { onSuccess: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const today = format(new Date(), "yyyy-MM-dd");

  const [productName, setProductName] = useState("");
  const [productCode, setProductCode] = useState("");
  const [totalWeight, setTotalWeight] = useState("");
  const [numBoxes, setNumBoxes] = useState("");
  const [deliveryDate, setDeliveryDate] = useState(today);
  const [createdBy, setCreatedBy] = useState("");
  const [notes, setNotes] = useState("");
  const [batchId, setBatchId] = useState("");
  const [loadingId, setLoadingId] = useState(false);
  const [autocompleteOpen, setAutocompleteOpen] = useState(false);
  const [autocompleteQuery, setAutocompleteQuery] = useState("");

  // Fetch meat ingredients for autocomplete
  const { data: ingredients = [] } = useQuery<Ingredient[]>({
    queryKey: ["/api/ingredients"],
    staleTime: 60000,
  });

  const meatIngredients = (ingredients as Ingredient[]).filter(
    (i) => i.category?.toLowerCase() === "meat"
  );

  const filteredIngredients = meatIngredients.filter((i) =>
    i.name.toLowerCase().includes(autocompleteQuery.toLowerCase())
  );

  const weightPerBox =
    totalWeight && numBoxes && Number(numBoxes) > 0
      ? (Number(totalWeight) / Number(numBoxes)).toFixed(2)
      : "";

  const generateBatchId = useCallback(
    async (code: string, date: string) => {
      if (!code || !date) return;
      const dateClean = date.replace(/-/g, "");
      setLoadingId(true);
      try {
        const res = await apiRequest(
          "GET",
          `/api/batches/next-id?product_code=${encodeURIComponent(code)}&stage=raw&date=${dateClean}`
        );
        const data = await res.json();
        setBatchId(data.batch_id);
      } catch {
        toast({ description: "Could not generate batch ID", variant: "destructive" });
      } finally {
        setLoadingId(false);
      }
    },
    [toast]
  );

  useEffect(() => {
    if (productCode && deliveryDate) {
      generateBatchId(productCode, deliveryDate);
    }
  }, [productCode, deliveryDate, generateBatchId]);

  const handleProductNameChange = (val: string) => {
    setProductName(val);
    setAutocompleteQuery(val);
    // Auto-generate product code from first 4 chars
    const code = val.replace(/\s+/g, "").slice(0, 4).toUpperCase();
    setProductCode(code);
  };

  const handleSelectIngredient = (ing: Ingredient) => {
    setProductName(ing.name);
    setAutocompleteQuery(ing.name);
    const code = ing.name.replace(/\s+/g, "").slice(0, 4).toUpperCase();
    setProductCode(code);
    setAutocompleteOpen(false);
  };

  const mutation = useMutation({
    mutationFn: async () => {
      if (!batchId || !productName || !createdBy) {
        throw new Error("Fill in all required fields");
      }
      return apiRequest("POST", "/api/batches", {
        batch_id: batchId,
        batch_type: "parent",
        product_name: productName,
        product_code: productCode,
        stage: "raw",
        total_weight_kg: totalWeight ? Number(totalWeight) : null,
        num_boxes: numBoxes ? Number(numBoxes) : null,
        weight_per_box_kg: weightPerBox ? Number(weightPerBox) : null,
        created_by: createdBy,
        notes,
        use_by_date: null,
      });
    },
    onSuccess: () => {
      toast({ description: `Parent batch ${batchId} created` });
      queryClient.invalidateQueries({ queryKey: ["/api/batches"] });
      onSuccess();
    },
    onError: (e: any) => {
      toast({ description: e.message || "Failed to create batch", variant: "destructive" });
    },
  });

  return (
    <div className="space-y-4 max-w-lg">
      <p className="text-sm text-muted-foreground">
        Create a parent batch when a Meat ingredient delivery arrives.
      </p>

      {/* Product name with autocomplete */}
      <div className="space-y-1 relative">
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Product Name *
        </label>
        <Input
          value={productName}
          onChange={(e) => {
            handleProductNameChange(e.target.value);
            setAutocompleteOpen(true);
          }}
          onFocus={() => setAutocompleteOpen(true)}
          placeholder="e.g. Chicken Breast"
          className="h-10"
        />
        {autocompleteOpen && filteredIngredients.length > 0 && (
          <div className="absolute z-20 top-full mt-1 left-0 right-0 bg-white border rounded-lg shadow-lg max-h-48 overflow-y-auto">
            {filteredIngredients.slice(0, 8).map((ing) => (
              <button
                key={ing.id}
                className="w-full text-left px-3 py-2 text-sm hover:bg-[#256984]/10 transition-colors"
                onMouseDown={() => handleSelectIngredient(ing)}
              >
                {ing.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Product code */}
      <div className="space-y-1">
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Product Code *
        </label>
        <Input
          value={productCode}
          onChange={(e) => setProductCode(e.target.value.toUpperCase())}
          placeholder="e.g. CHKN"
          maxLength={8}
          className="h-10 font-mono"
        />
      </div>

      {/* Weight and boxes */}
      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Total Weight (kg)
          </label>
          <Input
            type="number"
            value={totalWeight}
            onChange={(e) => setTotalWeight(e.target.value)}
            placeholder="e.g. 25"
            className="h-10"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Num Boxes
          </label>
          <Input
            type="number"
            value={numBoxes}
            onChange={(e) => setNumBoxes(e.target.value)}
            placeholder="e.g. 5"
            className="h-10"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Kg / Box
          </label>
          <Input
            value={weightPerBox ? `${weightPerBox} kg` : ""}
            readOnly
            placeholder="Auto"
            className="h-10 bg-muted/40"
          />
        </div>
      </div>

      {/* Delivery date */}
      <div className="space-y-1">
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Delivery Date *
        </label>
        <Input
          type="date"
          value={deliveryDate}
          onChange={(e) => setDeliveryDate(e.target.value)}
          className="h-10"
        />
      </div>

      {/* Created by */}
      <div className="space-y-1">
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Created By *
        </label>
        <Input
          value={createdBy}
          onChange={(e) => setCreatedBy(e.target.value)}
          placeholder="Staff name"
          className="h-10"
        />
      </div>

      {/* Notes */}
      <div className="space-y-1">
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Notes
        </label>
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Supplier, invoice number, etc."
          className="h-20 resize-none"
        />
      </div>

      {/* Batch ID (read-only) */}
      <div className="space-y-1">
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Generated Batch ID
        </label>
        <div className="flex gap-2 items-center">
          <Input
            value={loadingId ? "Generating…" : batchId}
            readOnly
            className="h-10 font-mono bg-muted/40"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => generateBatchId(productCode, deliveryDate)}
            disabled={!productCode || !deliveryDate}
          >
            <RefreshCw size={13} />
          </Button>
        </div>
      </div>

      <Button
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending || !batchId || !productName || !createdBy}
        className="w-full bg-[#256984] hover:bg-[#256984]/90 text-white"
      >
        {mutation.isPending ? "Creating…" : "Create Parent Batch"}
      </Button>
    </div>
  );
}

// ─── Create Child Batch Form ──────────────────────────────────────────────────
function CreateChildForm({ onSuccess }: { onSuccess: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const today = format(new Date(), "yyyy-MM-dd");

  const [selectedParent, setSelectedParent] = useState<Batch | null>(null);
  const [parentSearch, setParentSearch] = useState("");
  const [productName, setProductName] = useState("");
  const [cookWeight, setCookWeight] = useState("");
  const [cookDate, setCookDate] = useState(today);
  const [createdBy, setCreatedBy] = useState("");
  const [notes, setNotes] = useState("");
  const [batchId, setBatchId] = useState("");
  const [loadingId, setLoadingId] = useState(false);
  const [parentDropOpen, setParentDropOpen] = useState(false);

  const { data: parentBatches = [] } = useQuery<Batch[]>({
    queryKey: ["/api/batches", { type: "parent", status: "active" }],
    queryFn: () => apiRequest("GET", "/api/batches?type=parent&status=active").then(r => r.json()),
    staleTime: 30000,
  });

  const filteredParents = (parentBatches as Batch[]).filter(
    (b) =>
      b.batch_id.toLowerCase().includes(parentSearch.toLowerCase()) ||
      b.product_name.toLowerCase().includes(parentSearch.toLowerCase())
  );

  const generateChildId = useCallback(
    async (code: string, date: string) => {
      if (!code || !date) return;
      const dateClean = date.replace(/-/g, "");
      setLoadingId(true);
      try {
        const res = await apiRequest(
          "GET",
          `/api/batches/next-id?product_code=${encodeURIComponent(code)}&stage=cooked&date=${dateClean}`
        );
        const data = await res.json();
        setBatchId(data.batch_id);
      } catch {
        toast({ description: "Could not generate batch ID", variant: "destructive" });
      } finally {
        setLoadingId(false);
      }
    },
    [toast]
  );

  useEffect(() => {
    if (selectedParent && cookDate) {
      generateChildId(selectedParent.product_code || selectedParent.product_name.slice(0, 4), cookDate);
      setProductName(selectedParent.product_name);
    }
  }, [selectedParent, cookDate, generateChildId]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!batchId || !productName || !createdBy || !selectedParent) {
        throw new Error("Fill in all required fields");
      }
      return apiRequest("POST", "/api/batches", {
        batch_id: batchId,
        batch_type: "child",
        parent_batch_id: selectedParent.batch_id,
        product_name: productName,
        product_code: selectedParent.product_code,
        stage: "cooked",
        total_weight_kg: cookWeight ? Number(cookWeight) : null,
        created_by: createdBy,
        notes,
      });
    },
    onSuccess: () => {
      toast({ description: `Child batch ${batchId} created` });
      queryClient.invalidateQueries({ queryKey: ["/api/batches"] });
      onSuccess();
    },
    onError: (e: any) => {
      toast({ description: e.message || "Failed to create batch", variant: "destructive" });
    },
  });

  return (
    <div className="space-y-4 max-w-lg">
      <p className="text-sm text-muted-foreground">
        Create a child batch when cooking a Meat product from a parent batch.
      </p>

      {/* Parent batch selector */}
      <div className="space-y-1 relative">
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Select Parent Batch *
        </label>
        <Input
          value={selectedParent ? `${selectedParent.batch_id} — ${selectedParent.product_name}` : parentSearch}
          onChange={(e) => {
            setParentSearch(e.target.value);
            setSelectedParent(null);
            setParentDropOpen(true);
          }}
          onFocus={() => setParentDropOpen(true)}
          placeholder="Search parent batches…"
          className="h-10"
        />
        {parentDropOpen && filteredParents.length > 0 && (
          <div className="absolute z-20 top-full mt-1 left-0 right-0 bg-white border rounded-lg shadow-lg max-h-48 overflow-y-auto">
            {filteredParents.map((b) => (
              <button
                key={b.id}
                className="w-full text-left px-3 py-2 text-sm hover:bg-[#256984]/10 transition-colors"
                onMouseDown={() => {
                  setSelectedParent(b);
                  setParentDropOpen(false);
                }}
              >
                <span className="font-mono text-xs font-bold text-[#256984]">{b.batch_id}</span>
                <span className="ml-2 text-muted-foreground">{b.product_name}</span>
                {b.total_weight_kg && (
                  <span className="ml-2 text-xs text-muted-foreground">({b.total_weight_kg}kg)</span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Product name (auto-filled) */}
      <div className="space-y-1">
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Product Name *
        </label>
        <Input
          value={productName}
          onChange={(e) => setProductName(e.target.value)}
          placeholder="Auto-filled from parent"
          className="h-10"
        />
      </div>

      {/* Cook weight */}
      <div className="space-y-1">
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Cook Quantity (kg)
        </label>
        <Input
          type="number"
          value={cookWeight}
          onChange={(e) => setCookWeight(e.target.value)}
          placeholder="e.g. 50"
          className="h-10"
        />
      </div>

      {/* Cook date */}
      <div className="space-y-1">
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Cook Date *
        </label>
        <Input
          type="date"
          value={cookDate}
          onChange={(e) => setCookDate(e.target.value)}
          className="h-10"
        />
      </div>

      {/* Created by */}
      <div className="space-y-1">
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Created By *
        </label>
        <Input
          value={createdBy}
          onChange={(e) => setCreatedBy(e.target.value)}
          placeholder="Staff name"
          className="h-10"
        />
      </div>

      {/* Notes */}
      <div className="space-y-1">
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Notes
        </label>
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Cook method, temp etc."
          className="h-20 resize-none"
        />
      </div>

      {/* Batch ID */}
      <div className="space-y-1">
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Generated Batch ID
        </label>
        <div className="flex gap-2 items-center">
          <Input
            value={loadingId ? "Generating…" : batchId}
            readOnly
            className="h-10 font-mono bg-muted/40"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              selectedParent &&
              generateChildId(
                selectedParent.product_code || selectedParent.product_name.slice(0, 4),
                cookDate
              )
            }
            disabled={!selectedParent}
          >
            <RefreshCw size={13} />
          </Button>
        </div>
      </div>

      <Button
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending || !batchId || !productName || !createdBy || !selectedParent}
        className="w-full bg-[#256984] hover:bg-[#256984]/90 text-white"
      >
        {mutation.isPending ? "Creating…" : "Create Child Batch"}
      </Button>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function BatchManager() {
  const [tab, setTab] = useState<"list" | "create-parent" | "create-child" | "traceability">("list");
  const [qrBatch, setQrBatch] = useState<Batch | null>(null);
  const [createdBatch, setCreatedBatch] = useState<Batch | null>(null);
  const [printBatches, setPrintBatches] = useState<Batch[]>([]);
  const [, navigate] = useLocation();

  // Handle ?print=BATCH1,BATCH2 from supplier delivery submit
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const printParam = params.get("print");
    if (printParam) {
      const ids = printParam.split(",").map(s => s.trim()).filter(Boolean);
      // Fetch each batch and queue for printing
      Promise.all(ids.map(id =>
        fetch(`/api/batches/${encodeURIComponent(id)}`, {
          headers: { Authorization: "Bearer d8ecc189f96774038e36112c5ed9f2bc557c3320" }
        }).then(r => r.json()).catch(() => null)
      )).then(results => {
        const valid = results.filter(Boolean) as Batch[];
        if (valid.length > 0) setPrintBatches(valid);
      });
      // Clean up URL
      window.history.replaceState({}, "", "/batch-manager");
    }
  }, []);

  const { data: batches = [], isLoading, refetch } = useQuery<Batch[]>({
    queryKey: ["/api/batches", { type: "parent" }],
    queryFn: () => apiRequest("GET", "/api/batches?type=parent").then(r => r.json()),
    staleTime: 30000,
  });

  const statusBadge = (status: string) => {
    const map: Record<string, string> = {
      active: "bg-green-100 text-green-700",
      consumed: "bg-gray-100 text-gray-500",
      disposed: "bg-red-100 text-red-600",
    };
    return (
      <span className={cn("text-xs font-semibold px-2 py-0.5 rounded-full", map[status] || "bg-gray-100 text-gray-500")}>
        {status}
      </span>
    );
  };

  const stageBadge = (stage: string) => {
    const map: Record<string, string> = {
      raw: "bg-orange-100 text-orange-700",
      cooked: "bg-blue-100 text-blue-700",
      frozen: "bg-sky-100 text-sky-700",
    };
    return (
      <span className={cn("text-xs font-semibold px-2 py-0.5 rounded-full", map[stage] || "bg-gray-100 text-gray-500")}>
        {stage}
      </span>
    );
  };

  const handleCreateSuccess = () => {
    refetch();
    setTab("list");
  };

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-[#256984]/10 flex items-center justify-center">
            <Package size={18} className="text-[#256984]" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-[#256984]">Batch Manager</h1>
            <p className="text-xs text-muted-foreground">Track product batches from delivery to dispatch</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setTab("create-parent")}
            className="gap-1.5"
          >
            <Plus size={14} /> Parent Batch
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setTab("create-child")}
            className="gap-1.5"
          >
            <Plus size={14} /> Child Batch
          </Button>
        </div>
      </div>

      {/* Tab selector */}
      <div className="flex gap-1 border-b">
        {[
          { key: "list", label: "Parent Batches" },
          { key: "create-parent", label: "Create Parent" },
          { key: "create-child", label: "Create Child" },
          { key: "traceability", label: "Traceability" },
        ].map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key as typeof tab)}
            className={cn(
              "px-4 py-2 text-sm font-medium border-b-2 transition-colors",
              tab === key
                ? "border-[#256984] text-[#256984]"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "list" && (
        <div className="space-y-3">
          {isLoading ? (
            <div className="text-center py-12 text-muted-foreground text-sm">Loading batches…</div>
          ) : (batches as Batch[]).length === 0 ? (
            <div className="text-center py-12 space-y-3">
              <Package size={36} className="mx-auto text-muted-foreground/40" />
              <p className="text-muted-foreground text-sm">No parent batches yet.</p>
              <Button
                variant="outline"
                onClick={() => setTab("create-parent")}
                className="gap-2"
              >
                <Plus size={14} /> Create first batch
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/40 border-b text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    <th className="px-4 py-3 text-left">Batch ID</th>
                    <th className="px-4 py-3 text-left">Product</th>
                    <th className="px-4 py-3 text-left">Date</th>
                    <th className="px-4 py-3 text-right">Weight (kg)</th>
                    <th className="px-4 py-3 text-right">Boxes</th>
                    <th className="px-4 py-3 text-left">Stage</th>
                    <th className="px-4 py-3 text-left">Status</th>
                    <th className="px-4 py-3 text-center">QR</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {(batches as Batch[]).map((b) => (
                    <tr key={b.id} className="hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-3 font-mono text-xs font-bold text-[#256984]">
                        {b.batch_id}
                      </td>
                      <td className="px-4 py-3 font-medium">{b.product_name}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {format(new Date(b.created_at), "dd/MM/yy")}
                      </td>
                      <td className="px-4 py-3 text-right text-muted-foreground">
                        {b.total_weight_kg ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-right text-muted-foreground">
                        {b.num_boxes ?? "—"}
                      </td>
                      <td className="px-4 py-3">{stageBadge(b.stage)}</td>
                      <td className="px-4 py-3">{statusBadge(b.status)}</td>
                      <td className="px-4 py-3 text-center">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setQrBatch(b)}
                          className="h-7 w-7 p-0"
                        >
                          <QrCode size={15} className="text-[#256984]" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === "create-parent" && <CreateParentForm onSuccess={handleCreateSuccess} />}
      {tab === "create-child" && <CreateChildForm onSuccess={handleCreateSuccess} />}
      {tab === "traceability" && (
        <div className="-mx-4 sm:-mx-6">
          <BatchTraceabilityTab />
        </div>
      )}

      {/* QR Modal */}
      {qrBatch && <QRModal batch={qrBatch} onClose={() => setQrBatch(null)} />}

      {/* Auto-print modal — triggered from supplier delivery submit */}
      {printBatches.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
            <div className="bg-[#256984] px-6 py-4">
              <p className="text-xs font-semibold uppercase tracking-widest text-white/70">Batch Traceability</p>
              <h2 className="text-lg font-bold text-white mt-0.5">
                {printBatches.length} Batch Label{printBatches.length > 1 ? "s" : ""} Ready
              </h2>
              <p className="text-xs text-white/70 mt-1">Print and attach to each box</p>
            </div>
            <div className="px-6 py-4 space-y-3 max-h-64 overflow-y-auto">
              {printBatches.map(b => (
                <div key={b.batch_id} className="border rounded-xl p-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold text-sm">{b.product_name}</p>
                    <p className="font-mono text-xs text-muted-foreground">{b.batch_id}</p>
                    {b.total_weight_kg && <p className="text-xs text-muted-foreground">{b.total_weight_kg} kg</p>}
                  </div>
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-orange-100 text-orange-700">RAW</span>
                </div>
              ))}
            </div>
            <div className="px-6 pb-6 pt-2 space-y-2">
              <Button
                className="w-full h-11 gap-2 font-semibold"
                style={{ backgroundColor: "#256984" }}
                onClick={() => {
                  // Open each batch in QR modal for printing one by one
                  setQrBatch(printBatches[0]);
                  setPrintBatches(prev => prev.slice(1));
                }}
              >
                <Printer size={16} />
                Print Labels ({printBatches.length})
              </Button>
              <Button
                variant="outline"
                className="w-full h-11"
                onClick={() => setPrintBatches([])}
              >
                Skip — Print Later
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
