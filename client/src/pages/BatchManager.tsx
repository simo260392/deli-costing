import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  Package, Plus, QrCode, Printer, RefreshCw, Trash2, AlertTriangle,
  Snowflake, Flame, Droplets, ChevronDown, ChevronRight, Archive, Pencil
} from "lucide-react";
import { BatchTraceabilityTab } from "./BatchTraceability";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import QRCode from "qrcode";

// ─── Types ────────────────────────────────────────────────────────────────────
interface WeightBreakdown {
  total: number;
  frozen_kg: number;
  thawing_kg: number;
  fresh_kg: number;
  cooked_kg: number;
}

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
  arrival_state: "fresh" | "frozen";
  weight_breakdown?: WeightBreakdown;
  is_fully_cooked?: boolean;
}

interface Ingredient {
  id: number;
  name: string;
  category: string;
}

// ─── Weight Breakdown Bar ─────────────────────────────────────────────────────
function WeightBar({ wb, arrivalState }: { wb: WeightBreakdown; arrivalState: "fresh" | "frozen" }) {
  const total = wb.total || 1;
  const pct = (kg: number) => Math.max(0, Math.min(100, (kg / total) * 100));

  const segments = [
    { key: "frozen",  kg: wb.frozen_kg,  color: "bg-sky-400",    label: "Frozen" },
    { key: "thawing", kg: wb.thawing_kg, color: "bg-amber-400",  label: "Thawing" },
    { key: "fresh",   kg: wb.fresh_kg,   color: "bg-green-400",  label: "Fresh" },
    { key: "cooked",  kg: wb.cooked_kg,  color: "bg-[#256984]",  label: "Cooked" },
  ].filter(s => s.kg > 0 || (s.key === "fresh" && arrivalState === "fresh" && wb.frozen_kg === 0 && wb.thawing_kg === 0));

  return (
    <div className="space-y-1.5 w-full">
      {/* Stacked bar */}
      <div className="flex h-4 rounded-full overflow-hidden bg-gray-100 w-full">
        {segments.map(s => (
          <div
            key={s.key}
            className={cn("transition-all", s.color)}
            style={{ width: `${pct(s.kg)}%` }}
          />
        ))}
      </div>
      {/* Legend */}
      <div className="flex flex-wrap gap-x-3 gap-y-0.5">
        {[
          { key: "frozen",  kg: wb.frozen_kg,  color: "bg-sky-400",   icon: "❄️", label: "Frozen" },
          { key: "thawing", kg: wb.thawing_kg, color: "bg-amber-400", icon: "💧", label: "Thawing" },
          { key: "fresh",   kg: wb.fresh_kg,   color: "bg-green-400", icon: "✅", label: "Fresh" },
          { key: "cooked",  kg: wb.cooked_kg,  color: "bg-[#256984]", icon: "🍳", label: "Cooked" },
        ].filter(s => s.kg > 0 || (s.key === "fresh" && arrivalState === "fresh")).map(s => (
          <span key={s.key} className="flex items-center gap-1 text-xs text-muted-foreground">
            <span className={cn("w-2 h-2 rounded-full inline-block", s.color)} />
            {s.label}: <span className="font-semibold text-foreground">{s.kg.toFixed(1)}kg</span>
          </span>
        ))}
        <span className="flex items-center gap-1 text-xs text-muted-foreground ml-auto">
          Total: <span className="font-semibold text-foreground">{wb.total.toFixed(1)}kg</span>
        </span>
      </div>
    </div>
  );
}

// ─── Arrival State Badge ──────────────────────────────────────────────────────
function ArrivalBadge({ state }: { state: "fresh" | "frozen" }) {
  return state === "frozen" ? (
    <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-sky-100 text-sky-700">
      <Snowflake size={10} /> Arrived Frozen
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-green-100 text-green-700">
      <Flame size={10} /> Arrived Fresh
    </span>
  );
}

// ─── Label component ──────────────────────────────────────────────────────────
function BatchLabel({ batch, qrUrl }: { batch: Partial<Batch>; qrUrl: string }) {
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
        width: 189, height: 189,
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "space-between",
        padding: "6px 6px 5px", boxSizing: "border-box",
        border: "1px solid #000", borderRadius: 2, overflow: "hidden",
      }}
    >
      <div style={{ fontSize: 7, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: "'Courier New', monospace", textAlign: "center", lineHeight: 1.2, width: "100%", borderBottom: "0.5px solid #000", paddingBottom: 3 }}>
        The Deli · by Greenhorns
      </div>
      {qrUrl && <img src={qrUrl} alt="QR" style={{ width: 108, height: 108, display: "block", imageRendering: "pixelated" }} />}
      <div style={{ width: "100%", textAlign: "center", fontFamily: "'Courier New', monospace", borderTop: "0.5px solid #000", paddingTop: 3 }}>
        <div style={{ fontSize: 9, fontWeight: 700, lineHeight: 1.3 }}>
          {batch.product_name}{indivWeight ? ` · ${indivWeight}` : ""}
        </div>
        <div style={{ fontSize: 7.5, fontWeight: 600, letterSpacing: "0.03em", marginTop: 1, lineHeight: 1.2 }}>
          {batch.batch_id}
        </div>
      </div>
    </div>
  );
}

// ─── QR Modal ─────────────────────────────────────────────────────────────────
function QRModal({ batch, onClose }: { batch: Batch; onClose: () => void }) {
  const [qrUrl, setQrUrl] = useState("");
  useEffect(() => { QRCode.toDataURL(batch.batch_id, { width: 300, margin: 2 }).then(setQrUrl); }, [batch.batch_id]);
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
          <BatchLabel batch={batch} qrUrl={qrUrl} />
        </div>
        <div className="mt-4 flex gap-2">
          <Button onClick={() => window.print()} className="flex-1 gap-2 bg-[#256984] hover:bg-[#256984]/90">
            <Printer size={15} /> Print Label
          </Button>
          <Button variant="outline" onClick={onClose} className="flex-1">Close</Button>
        </div>
      </div>
      <style>{`
        @media print {
          body > * { display: none !important; }
          #batch-label-print { display: block !important; position: fixed; top: 0; left: 0; width: 50mm; height: 50mm; border: none; page-break-after: avoid; }
        }
      `}</style>
    </div>
  );
}

// ─── Delete Confirm Modal ──────────────────────────────────────────────────────
function DeleteConfirmModal({ batch, onConfirm, onCancel, isPending }: { batch: Batch; onConfirm: () => void; onCancel: () => void; isPending: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full mx-4">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
            <AlertTriangle size={20} className="text-red-600" />
          </div>
          <div>
            <h3 className="font-semibold text-base">Delete Raw Batch?</h3>
            <p className="text-xs text-muted-foreground mt-0.5">This cannot be undone</p>
          </div>
        </div>
        <div className="bg-muted/40 rounded-xl p-3 mb-4 space-y-1">
          <p className="font-mono text-sm font-bold text-[#256984]">{batch.batch_id}</p>
          <p className="text-sm">{batch.product_name}</p>
          {batch.total_weight_kg && <p className="text-xs text-muted-foreground">{batch.total_weight_kg} kg · {batch.num_boxes ?? "—"} boxes</p>}
        </div>
        <p className="text-sm text-muted-foreground mb-5">
          This will permanently delete this Raw Batch ID and all associated Cooked Batch IDs.
        </p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onCancel} className="flex-1" disabled={isPending}>Cancel</Button>
          <Button onClick={onConfirm} disabled={isPending} className="flex-1 bg-red-600 hover:bg-red-700 text-white">
            {isPending ? "Deleting…" : "Delete Batch"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Raw Batch Row (expandable) ───────────────────────────────────────────────
function RawBatchRow({ batch, onQr, onDelete, onEdit }: { batch: Batch; onQr: (b: Batch) => void; onDelete: (b: Batch) => void; onEdit: (b: Batch) => void }) {
  const [expanded, setExpanded] = useState(false);
  const wb = batch.weight_breakdown;

  // Dominant state label for the collapsed row
  const dominantState = (): { label: string; cls: string } => {
    if (!wb) return { label: "—", cls: "bg-gray-100 text-gray-500" };
    if (wb.total === 0) return { label: "—", cls: "bg-gray-100 text-gray-500" };
    const parts = [
      { key: "frozen",  kg: wb.frozen_kg,  label: "Frozen",  cls: "bg-sky-100 text-sky-700" },
      { key: "thawing", kg: wb.thawing_kg, label: "Thawing", cls: "bg-amber-100 text-amber-700" },
      { key: "fresh",   kg: wb.fresh_kg,   label: "Fresh",   cls: "bg-green-100 text-green-700" },
      { key: "cooked",  kg: wb.cooked_kg,  label: "Cooked",  cls: "bg-blue-100 text-blue-700" },
    ].filter(p => p.kg > 0);
    if (parts.length === 0) return { label: batch.arrival_state === "fresh" ? "Fresh" : "Frozen", cls: batch.arrival_state === "fresh" ? "bg-green-100 text-green-700" : "bg-sky-100 text-sky-700" };
    if (parts.length === 1) return { label: parts[0].label, cls: parts[0].cls };
    return { label: "Mixed", cls: "bg-purple-100 text-purple-700" };
  };

  const ds = dominantState();

  return (
    <>
      <tr
        className={cn("hover:bg-muted/20 transition-colors cursor-pointer", expanded && "bg-muted/10")}
        onClick={() => setExpanded(e => !e)}
      >
        <td className="px-3 py-3 w-6">
          {expanded ? <ChevronDown size={14} className="text-muted-foreground" /> : <ChevronRight size={14} className="text-muted-foreground" />}
        </td>
        <td className="px-3 py-3 font-mono text-xs font-bold text-[#256984]">{batch.batch_id}</td>
        <td className="px-3 py-3 font-medium text-sm">{batch.product_name}</td>
        <td className="px-3 py-3 text-xs text-muted-foreground">{format(new Date(batch.created_at), "dd/MM/yy")}</td>
        <td className="px-3 py-3 text-right text-sm text-muted-foreground">{batch.total_weight_kg ?? "—"}</td>
        <td className="px-3 py-3">
          <ArrivalBadge state={batch.arrival_state || "fresh"} />
        </td>
        <td className="px-3 py-3">
          <span className={cn("text-xs font-semibold px-2 py-0.5 rounded-full", ds.cls)}>{ds.label}</span>
        </td>
        <td className="px-3 py-3 text-center" onClick={e => e.stopPropagation()}>
          <Button variant="ghost" size="sm" onClick={() => onQr(batch)} className="h-7 w-7 p-0">
            <QrCode size={15} className="text-[#256984]" />
          </Button>
        </td>
        <td className="px-3 py-3 text-center" onClick={e => e.stopPropagation()}>
          <Button variant="ghost" size="sm" onClick={() => onEdit(batch)} className="h-7 w-7 p-0 hover:bg-blue-50">
            <Pencil size={13} className="text-[#256984]" />
          </Button>
        </td>
        <td className="px-3 py-3 text-center" onClick={e => e.stopPropagation()}>
          <Button variant="ghost" size="sm" onClick={() => onDelete(batch)} className="h-7 w-7 p-0 hover:bg-red-50">
            <Trash2 size={14} className="text-red-500" />
          </Button>
        </td>
      </tr>
      {expanded && wb && (
        <tr className="bg-muted/5">
          <td colSpan={9} className="px-6 pb-4 pt-2">
            <div className="max-w-lg space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Weight Breakdown</p>
              <WeightBar wb={wb} arrivalState={batch.arrival_state || "fresh"} />

              {/* Detail grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-1">
                {batch.arrival_state === "frozen" && (
                  <div className="rounded-xl border p-3 space-y-0.5 bg-sky-50/60">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-sky-700">
                      <Snowflake size={12} /> Frozen
                    </div>
                    <p className="text-lg font-bold text-sky-700">{wb.frozen_kg.toFixed(1)}<span className="text-xs font-normal ml-0.5">kg</span></p>
                    <p className="text-[10px] text-muted-foreground">Still in freezer</p>
                  </div>
                )}
                {wb.thawing_kg > 0 && (
                  <div className="rounded-xl border p-3 space-y-0.5 bg-amber-50/60">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-700">
                      <Droplets size={12} /> Thawing
                    </div>
                    <p className="text-lg font-bold text-amber-700">{wb.thawing_kg.toFixed(1)}<span className="text-xs font-normal ml-0.5">kg</span></p>
                    <p className="text-[10px] text-muted-foreground">In thawing log</p>
                  </div>
                )}
                <div className="rounded-xl border p-3 space-y-0.5 bg-green-50/60">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-green-700">
                    <Flame size={12} /> Fresh
                  </div>
                  <p className="text-lg font-bold text-green-700">{wb.fresh_kg.toFixed(1)}<span className="text-xs font-normal ml-0.5">kg</span></p>
                  <p className="text-[10px] text-muted-foreground">
                    {batch.arrival_state === "fresh" ? "Arrived fresh" : "Thaw complete"}
                  </p>
                </div>
                <div className="rounded-xl border p-3 space-y-0.5 bg-[#256984]/5">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-[#256984]">
                    <Package size={12} /> Cooked
                  </div>
                  <p className="text-lg font-bold text-[#256984]">{wb.cooked_kg.toFixed(1)}<span className="text-xs font-normal ml-0.5">kg</span></p>
                  <p className="text-[10px] text-muted-foreground">From cooked batches</p>
                </div>
              </div>

              {batch.is_fully_cooked && (
                <div className="flex items-center gap-2 p-3 rounded-xl bg-green-50 border border-green-200">
                  <span className="text-green-700 text-sm font-semibold">All weight accounted for — this batch is fully cooked.</span>
                </div>
              )}

              {batch.notes && (
                <p className="text-xs text-muted-foreground italic">{batch.notes}</p>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}


// ─── Edit Raw Batch Modal ──────────────────────────────────────────────────────
function EditRawBatchModal({ batch, onClose, onSaved }: { batch: Batch; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [productName, setProductName] = useState(batch.product_name);
  const [totalWeight, setTotalWeight] = useState(batch.total_weight_kg != null ? String(batch.total_weight_kg) : "");
  const [arrivalState, setArrivalState] = useState<"fresh" | "frozen">(batch.arrival_state || "fresh");
  const [notes, setNotes] = useState(batch.notes || "");
  const [useByDate, setUseByDate] = useState(batch.use_by_date ? batch.use_by_date.slice(0, 10) : "");

  const mutation = useMutation({
    mutationFn: async () => {
      const body: any = {
        product_name: productName,
        arrival_state: arrivalState,
        notes,
        use_by_date: useByDate || null,
      };
      if (totalWeight !== "") body.total_weight_kg = Number(totalWeight);
      const res = await apiRequest("PUT", `/api/batches/${encodeURIComponent(batch.batch_id)}`, body);
      if (!res.ok) throw new Error("Save failed");
    },
    onSuccess: () => {
      toast({ description: "Raw batch updated" });
      onSaved();
      onClose();
    },
    onError: (e: any) => toast({ description: e.message || "Failed to save", variant: "destructive" }),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
        <div className="bg-[#256984] px-6 py-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-white/70">Edit</p>
          <h2 className="text-lg font-bold text-white mt-0.5">Raw Batch ID</h2>
          <p className="text-xs text-white/70 font-mono mt-0.5">{batch.batch_id}</p>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Product / Ingredient Name</label>
            <Input value={productName} onChange={e => setProductName(e.target.value)} className="h-10" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Total Weight (kg)</label>
            <Input type="number" value={totalWeight} onChange={e => setTotalWeight(e.target.value)} className="h-10" placeholder="e.g. 25" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Arrival State</label>
            <div className="flex gap-2">
              {(["fresh", "frozen"] as const).map(s => (
                <button
                  key={s}
                  onClick={() => setArrivalState(s)}
                  className={cn(
                    "flex-1 h-10 rounded-lg border text-sm font-semibold transition-colors",
                    arrivalState === s
                      ? s === "fresh" ? "bg-green-500 text-white border-green-500" : "bg-sky-500 text-white border-sky-500"
                      : "border-border text-muted-foreground hover:bg-muted/50"
                  )}
                >
                  {s === "fresh" ? "✅ Fresh" : "❄️ Frozen"}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Use By Date</label>
            <Input type="date" value={useByDate} onChange={e => setUseByDate(e.target.value)} className="h-10" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Notes</label>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Optional notes" />
          </div>
        </div>
        <div className="px-6 pb-6 flex gap-2">
          <Button variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
          <Button
            className="flex-1 bg-[#256984] hover:bg-[#256984]/90 text-white"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !productName}
          >
            {mutation.isPending ? "Saving…" : "Save Changes"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Edit Cooked Batch Modal ───────────────────────────────────────────────────
function EditCookedBatchModal({ batch, rawBatches, onClose, onSaved }: {
  batch: Batch; rawBatches: Batch[]; onClose: () => void; onSaved: () => void;
}) {
  const { toast } = useToast();
  const [productName, setProductName] = useState(batch.product_name);
  const [totalWeight, setTotalWeight] = useState(batch.total_weight_kg != null ? String(batch.total_weight_kg) : "");
  const [parentBatchId, setParentBatchId] = useState(batch.parent_batch_id || "");
  const [useByDate, setUseByDate] = useState(batch.use_by_date ? batch.use_by_date.slice(0, 10) : "");
  const [notes, setNotes] = useState(batch.notes || "");

  const mutation = useMutation({
    mutationFn: async () => {
      const body: any = {
        product_name: productName,
        parent_batch_id: parentBatchId || null,
        use_by_date: useByDate || null,
        notes,
      };
      if (totalWeight !== "") body.total_weight_kg = Number(totalWeight);
      const res = await apiRequest("PUT", `/api/batches/${encodeURIComponent(batch.batch_id)}`, body);
      if (!res.ok) throw new Error("Save failed");
    },
    onSuccess: () => {
      toast({ description: "Cooked batch updated" });
      onSaved();
      onClose();
    },
    onError: (e: any) => toast({ description: e.message || "Failed to save", variant: "destructive" }),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
        <div className="bg-[#256984] px-6 py-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-white/70">Edit</p>
          <h2 className="text-lg font-bold text-white mt-0.5">Cooked Batch ID</h2>
          <p className="text-xs text-white/70 font-mono mt-0.5">{batch.batch_id}</p>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Product Name</label>
            <Input value={productName} onChange={e => setProductName(e.target.value)} className="h-10" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Cooked Weight (kg)</label>
            <Input type="number" value={totalWeight} onChange={e => setTotalWeight(e.target.value)} className="h-10" placeholder="e.g. 8.5" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Linked Raw Batch ID</label>
            <select
              value={parentBatchId}
              onChange={e => setParentBatchId(e.target.value)}
              className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#256984]"
            >
              <option value="">— None —</option>
              {rawBatches.map(rb => (
                <option key={rb.batch_id} value={rb.batch_id}>{rb.batch_id} — {rb.product_name}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Use By Date</label>
            <Input type="date" value={useByDate} onChange={e => setUseByDate(e.target.value)} className="h-10" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Notes</label>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Optional notes" />
          </div>
        </div>
        <div className="px-6 pb-6 flex gap-2">
          <Button variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
          <Button
            className="flex-1 bg-[#256984] hover:bg-[#256984]/90 text-white"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !productName}
          >
            {mutation.isPending ? "Saving…" : "Save Changes"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Create Raw Batch Form ────────────────────────────────────────────────────
function CreateRawBatchForm({ onSuccess }: { onSuccess: () => void }) {
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
  const [arrivalState, setArrivalState] = useState<"fresh" | "frozen">("frozen");

  const { data: ingredients = [] } = useQuery<Ingredient[]>({ queryKey: ["/api/ingredients"], staleTime: 60000 });
  const meatIngredients = (ingredients as Ingredient[]).filter(i => i.category?.toLowerCase() === "meat");
  const filteredIngredients = meatIngredients.filter(i => i.name.toLowerCase().includes(autocompleteQuery.toLowerCase()));

  const weightPerBox = totalWeight && numBoxes && Number(numBoxes) > 0
    ? (Number(totalWeight) / Number(numBoxes)).toFixed(2) : "";

  const generateBatchId = useCallback(async (code: string, date: string) => {
    if (!code || !date) return;
    setLoadingId(true);
    try {
      const res = await apiRequest("GET", `/api/batches/next-id?product_code=${encodeURIComponent(code)}&stage=raw&date=${date.replace(/-/g, "")}`);
      const data = await res.json();
      setBatchId(data.batch_id);
    } catch { toast({ description: "Could not generate batch ID", variant: "destructive" }); }
    finally { setLoadingId(false); }
  }, [toast]);

  useEffect(() => { if (productCode && deliveryDate) generateBatchId(productCode, deliveryDate); }, [productCode, deliveryDate, generateBatchId]);

  const handleProductNameChange = (val: string) => {
    setProductName(val);
    setAutocompleteQuery(val);
    setProductCode(val.replace(/\s+/g, "").slice(0, 4).toUpperCase());
  };

  const mutation = useMutation({
    mutationFn: async () => {
      if (!batchId || !productName || !createdBy) throw new Error("Fill in all required fields");
      return apiRequest("POST", "/api/batches", {
        batch_id: batchId, batch_type: "parent", product_name: productName, product_code: productCode,
        stage: "raw", total_weight_kg: totalWeight ? Number(totalWeight) : null,
        num_boxes: numBoxes ? Number(numBoxes) : null,
        weight_per_box_kg: weightPerBox ? Number(weightPerBox) : null,
        created_by: createdBy, notes, use_by_date: null, arrival_state: arrivalState,
      });
    },
    onSuccess: () => {
      toast({ description: `Raw Batch ${batchId} created` });
      queryClient.invalidateQueries({ queryKey: ["/api/batches"] });
      onSuccess();
    },
    onError: (e: any) => toast({ description: e.message || "Failed to create batch", variant: "destructive" }),
  });

  return (
    <div className="space-y-4 max-w-lg">
      <p className="text-sm text-muted-foreground">Create a Raw Batch ID when a meat ingredient delivery arrives.</p>

      {/* Arrival state toggle */}
      <div className="space-y-1">
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Arrived as *</label>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setArrivalState("fresh")}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 h-11 rounded-xl border-2 text-sm font-semibold transition-all",
              arrivalState === "fresh"
                ? "border-green-500 bg-green-50 text-green-700"
                : "border-border bg-white text-muted-foreground hover:border-green-300"
            )}
          >
            <Flame size={16} /> Fresh
          </button>
          <button
            type="button"
            onClick={() => setArrivalState("frozen")}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 h-11 rounded-xl border-2 text-sm font-semibold transition-all",
              arrivalState === "frozen"
                ? "border-sky-500 bg-sky-50 text-sky-700"
                : "border-border bg-white text-muted-foreground hover:border-sky-300"
            )}
          >
            <Snowflake size={16} /> Frozen
          </button>
        </div>
      </div>

      {/* Product name */}
      <div className="space-y-1 relative">
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Product Name *</label>
        <Input value={productName} onChange={e => { handleProductNameChange(e.target.value); setAutocompleteOpen(true); }} onFocus={() => setAutocompleteOpen(true)} placeholder="e.g. Chicken Breast" className="h-10" />
        {autocompleteOpen && filteredIngredients.length > 0 && (
          <div className="absolute z-20 top-full mt-1 left-0 right-0 bg-white border rounded-lg shadow-lg max-h-48 overflow-y-auto">
            {filteredIngredients.slice(0, 8).map(ing => (
              <button key={ing.id} className="w-full text-left px-3 py-2 text-sm hover:bg-[#256984]/10 transition-colors"
                onMouseDown={() => { setProductName(ing.name); setAutocompleteQuery(ing.name); setProductCode(ing.name.replace(/\s+/g, "").slice(0, 4).toUpperCase()); setAutocompleteOpen(false); }}>
                {ing.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-1">
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Product Code *</label>
        <Input value={productCode} onChange={e => setProductCode(e.target.value.toUpperCase())} placeholder="e.g. CHKN" maxLength={8} className="h-10 font-mono" />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Total Weight (kg)</label>
          <Input type="number" value={totalWeight} onChange={e => setTotalWeight(e.target.value)} placeholder="e.g. 100" className="h-10" />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Num Boxes</label>
          <Input type="number" value={numBoxes} onChange={e => setNumBoxes(e.target.value)} placeholder="e.g. 5" className="h-10" />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Kg / Box</label>
          <Input value={weightPerBox ? `${weightPerBox} kg` : ""} readOnly placeholder="Auto" className="h-10 bg-muted/40" />
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Delivery Date *</label>
        <Input type="date" value={deliveryDate} onChange={e => setDeliveryDate(e.target.value)} className="h-10" />
      </div>

      <div className="space-y-1">
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Created By *</label>
        <Input value={createdBy} onChange={e => setCreatedBy(e.target.value)} placeholder="Staff name" className="h-10" />
      </div>

      <div className="space-y-1">
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Notes</label>
        <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Supplier, invoice number, etc." className="h-20 resize-none" />
      </div>

      <div className="space-y-1">
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Generated Raw Batch ID</label>
        <div className="flex gap-2 items-center">
          <Input value={loadingId ? "Generating…" : batchId} readOnly className="h-10 font-mono bg-muted/40" />
          <Button variant="outline" size="sm" onClick={() => generateBatchId(productCode, deliveryDate)} disabled={!productCode || !deliveryDate}>
            <RefreshCw size={13} />
          </Button>
        </div>
      </div>

      <Button onClick={() => mutation.mutate()} disabled={mutation.isPending || !batchId || !productName || !createdBy} className="w-full bg-[#256984] hover:bg-[#256984]/90 text-white">
        {mutation.isPending ? "Creating…" : "Create Raw Batch ID"}
      </Button>
    </div>
  );
}

// ─── Create Cooked Batch Form ─────────────────────────────────────────────────
function CreateCookedBatchForm({ onSuccess }: { onSuccess: () => void }) {
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

  const { data: rawBatches = [] } = useQuery<Batch[]>({
    queryKey: ["/api/batches", { type: "parent", status: "active" }],
    queryFn: () => apiRequest("GET", "/api/batches?type=parent&status=active").then(r => r.json()),
    staleTime: 30000,
  });

  const filteredParents = (rawBatches as Batch[]).filter(b =>
    b.batch_id.toLowerCase().includes(parentSearch.toLowerCase()) ||
    b.product_name.toLowerCase().includes(parentSearch.toLowerCase())
  );

  const generateCookedId = useCallback(async (code: string, date: string) => {
    if (!code || !date) return;
    setLoadingId(true);
    try {
      const res = await apiRequest("GET", `/api/batches/next-id?product_code=${encodeURIComponent(code)}&stage=cooked&date=${date.replace(/-/g, "")}`);
      const data = await res.json();
      setBatchId(data.batch_id);
    } catch { toast({ description: "Could not generate batch ID", variant: "destructive" }); }
    finally { setLoadingId(false); }
  }, [toast]);

  useEffect(() => {
    if (selectedParent && cookDate) {
      generateCookedId(selectedParent.product_code || selectedParent.product_name.slice(0, 4), cookDate);
      setProductName(selectedParent.product_name);
    }
  }, [selectedParent, cookDate, generateCookedId]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!batchId || !productName || !createdBy || !selectedParent) throw new Error("Fill in all required fields");
      return apiRequest("POST", "/api/batches", {
        batch_id: batchId, batch_type: "child", parent_batch_id: selectedParent.batch_id,
        product_name: productName, product_code: selectedParent.product_code, stage: "cooked",
        total_weight_kg: cookWeight ? Number(cookWeight) : null, created_by: createdBy, notes,
      });
    },
    onSuccess: () => {
      toast({ description: `Cooked Batch ${batchId} created` });
      queryClient.invalidateQueries({ queryKey: ["/api/batches"] });
      onSuccess();
    },
    onError: (e: any) => toast({ description: e.message || "Failed to create batch", variant: "destructive" }),
  });

  return (
    <div className="space-y-4 max-w-lg">
      <p className="text-sm text-muted-foreground">Create a Cooked Batch ID when cooking a meat product from a Raw Batch.</p>

      <div className="space-y-1 relative">
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Select Raw Batch ID *</label>
        <Input
          value={selectedParent ? `${selectedParent.batch_id} — ${selectedParent.product_name}` : parentSearch}
          onChange={e => { setParentSearch(e.target.value); setSelectedParent(null); setParentDropOpen(true); }}
          onFocus={() => setParentDropOpen(true)}
          placeholder="Search raw batches…"
          className="h-10"
        />
        {parentDropOpen && filteredParents.length > 0 && (
          <div className="absolute z-20 top-full mt-1 left-0 right-0 bg-white border rounded-lg shadow-lg max-h-48 overflow-y-auto">
            {filteredParents.map(b => (
              <button key={b.id} className="w-full text-left px-3 py-2 text-sm hover:bg-[#256984]/10 transition-colors"
                onMouseDown={() => { setSelectedParent(b); setParentDropOpen(false); }}>
                <span className="font-mono text-xs font-bold text-[#256984]">{b.batch_id}</span>
                <span className="ml-2 text-muted-foreground">{b.product_name}</span>
                {b.total_weight_kg && <span className="ml-2 text-xs text-muted-foreground">({b.total_weight_kg}kg)</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-1">
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Product Name *</label>
        <Input value={productName} onChange={e => setProductName(e.target.value)} placeholder="Auto-filled from raw batch" className="h-10" />
      </div>

      <div className="space-y-1">
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Cooked Weight (kg)</label>
        <Input type="number" value={cookWeight} onChange={e => setCookWeight(e.target.value)} placeholder="e.g. 20" className="h-10" />
      </div>

      <div className="space-y-1">
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Cook Date *</label>
        <Input type="date" value={cookDate} onChange={e => setCookDate(e.target.value)} className="h-10" />
      </div>

      <div className="space-y-1">
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Created By *</label>
        <Input value={createdBy} onChange={e => setCreatedBy(e.target.value)} placeholder="Staff name" className="h-10" />
      </div>

      <div className="space-y-1">
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Notes</label>
        <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Cook method, temp etc." className="h-20 resize-none" />
      </div>

      <div className="space-y-1">
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Generated Cooked Batch ID</label>
        <div className="flex gap-2 items-center">
          <Input value={loadingId ? "Generating…" : batchId} readOnly className="h-10 font-mono bg-muted/40" />
          <Button variant="outline" size="sm" onClick={() => selectedParent && generateCookedId(selectedParent.product_code || selectedParent.product_name.slice(0, 4), cookDate)} disabled={!selectedParent}>
            <RefreshCw size={13} />
          </Button>
        </div>
      </div>

      <Button onClick={() => mutation.mutate()} disabled={mutation.isPending || !batchId || !productName || !createdBy || !selectedParent} className="w-full bg-[#256984] hover:bg-[#256984]/90 text-white">
        {mutation.isPending ? "Creating…" : "Create Cooked Batch ID"}
      </Button>
    </div>
  );
}

// ─── Cooked Batch Table (simple, no breakdown) ────────────────────────────────
function CookedBatchTable({ batches, isLoading, onEmpty, onQr, onDelete, onEdit, rawBatches }: {
  batches: Batch[]; isLoading: boolean; onEmpty: () => void;
  onQr: (b: Batch) => void; onDelete: (b: Batch) => void; onEdit: (b: Batch) => void; rawBatches: Batch[];
}) {
  if (isLoading) return <div className="text-center py-12 text-muted-foreground text-sm">Loading…</div>;
  if (batches.length === 0) return (
    <div className="text-center py-12 space-y-3">
      <Package size={36} className="mx-auto text-muted-foreground/40" />
      <p className="text-muted-foreground text-sm">No Cooked Batch IDs yet.</p>
      <Button variant="outline" onClick={onEmpty} className="gap-2"><Plus size={14} /> Create first cooked batch</Button>
    </div>
  );
  return (
    <div className="overflow-x-auto rounded-xl border">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-muted/40 border-b text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            <th className="px-4 py-3 text-left">Cooked Batch ID</th>
            <th className="px-4 py-3 text-left">Product</th>
            <th className="px-4 py-3 text-left">Raw Batch</th>
            <th className="px-4 py-3 text-left">Date</th>
            <th className="px-4 py-3 text-right">Weight (kg)</th>
            <th className="px-4 py-3 text-left">Status</th>
            <th className="px-4 py-3 text-center">QR</th>
            <th className="px-4 py-3 text-center">Edit</th>
            <th className="px-4 py-3 text-center">Del</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {batches.map(b => (
            <tr key={b.id} className="hover:bg-muted/20 transition-colors">
              <td className="px-4 py-3 font-mono text-xs font-bold text-[#256984]">{b.batch_id}</td>
              <td className="px-4 py-3 font-medium">{b.product_name}</td>
              <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{b.parent_batch_id ?? "—"}</td>
              <td className="px-4 py-3 text-muted-foreground">{format(new Date(b.created_at), "dd/MM/yy")}</td>
              <td className="px-4 py-3 text-right text-muted-foreground">{b.total_weight_kg ?? "—"}</td>
              <td className="px-4 py-3">
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">Cooked</span>
              </td>
              <td className="px-4 py-3 text-center">
                <Button variant="ghost" size="sm" onClick={() => onQr(b)} className="h-7 w-7 p-0">
                  <QrCode size={15} className="text-[#256984]" />
                </Button>
              </td>
              <td className="px-4 py-3 text-center">
                <Button variant="ghost" size="sm" onClick={() => onEdit(b)} className="h-7 w-7 p-0 hover:bg-blue-50">
                  <Pencil size={13} className="text-[#256984]" />
                </Button>
              </td>
              <td className="px-4 py-3 text-center">
                <Button variant="ghost" size="sm" onClick={() => onDelete(b)} className="h-7 w-7 p-0 hover:bg-red-50">
                  <Trash2 size={14} className="text-red-500" />
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function BatchManager() {
  const [tab, setTab] = useState<"raw" | "cooked" | "archive" | "create-raw" | "create-cooked" | "traceability">("raw");
  const [qrBatch, setQrBatch] = useState<Batch | null>(null);
  const [deleteBatch, setDeleteBatch] = useState<Batch | null>(null);
  const [editBatch, setEditBatch] = useState<Batch | null>(null);
  const [printBatches, setPrintBatches] = useState<Batch[]>([]);
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const printParam = params.get("print");
    if (printParam) {
      const ids = printParam.split(",").map(s => s.trim()).filter(Boolean);
      const _base = "__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__";
      Promise.all(ids.map(id =>
        fetch(`${_base}/api/batches/${encodeURIComponent(id)}`, {
          headers: { Authorization: "Bearer d8ecc189f96774038e36112c5ed9f2bc557c3320" }
        }).then(r => r.json()).catch(() => null)
      )).then(results => {
        const valid = results.filter(Boolean) as Batch[];
        if (valid.length > 0) setPrintBatches(valid);
      });
      window.history.replaceState({}, "", "/batch-manager");
    }
  }, []);

  const { data: allRawBatches = [], isLoading: rawLoading, refetch: refetchRaw } = useQuery<Batch[]>({
    queryKey: ["/api/batches", { type: "parent" }],
    queryFn: () => apiRequest("GET", "/api/batches?type=parent").then(r => r.json()),
    staleTime: 30000,
  });

  const { data: cookedBatches = [], isLoading: cookedLoading, refetch: refetchCooked } = useQuery<Batch[]>({
    queryKey: ["/api/batches", { type: "child" }],
    queryFn: () => apiRequest("GET", "/api/batches?type=child").then(r => r.json()),
    staleTime: 30000,
  });

  // Split raw batches: active (not fully cooked) vs archived (fully cooked)
  const activeBatches = (allRawBatches as Batch[]).filter(b => !b.is_fully_cooked);
  const archivedBatches = (allRawBatches as Batch[]).filter(b => b.is_fully_cooked);

  const deleteMutation = useMutation({
    mutationFn: async (batchId: string) => {
      const res = await apiRequest("DELETE", `/api/batches/${encodeURIComponent(batchId)}`);
      if (!res.ok) throw new Error("Delete failed");
    },
    onSuccess: () => {
      toast({ description: "Batch deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/batches"] });
      setDeleteBatch(null);
    },
    onError: () => toast({ description: "Failed to delete batch", variant: "destructive" }),
  });

  const handleCreateSuccess = () => {
    refetchRaw();
    refetchCooked();
    setTab("raw");
  };

  const tabs = [
    { key: "raw",           label: `Raw Batch IDs${activeBatches.length ? ` (${activeBatches.length})` : ""}` },
    { key: "cooked",        label: "Cooked Batch IDs" },
    { key: "archive",       label: `Archive${archivedBatches.length ? ` (${archivedBatches.length})` : ""}` },
    { key: "create-raw",    label: "Create Raw" },
    { key: "create-cooked", label: "Create Cooked" },
    { key: "traceability",  label: "Traceability" },
  ];

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
          <Button variant="outline" size="sm" onClick={() => setTab("create-raw")} className="gap-1.5">
            <Plus size={14} /> Raw Batch
          </Button>
          <Button variant="outline" size="sm" onClick={() => setTab("create-cooked")} className="gap-1.5">
            <Plus size={14} /> Cooked Batch
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b overflow-x-auto">
        {tabs.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key as typeof tab)}
            className={cn(
              "px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap",
              tab === key ? "border-[#256984] text-[#256984]" : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Raw Batch IDs — active */}
      {tab === "raw" && (
        <div className="space-y-3">
          {rawLoading ? (
            <div className="text-center py-12 text-muted-foreground text-sm">Loading batches…</div>
          ) : activeBatches.length === 0 ? (
            <div className="text-center py-12 space-y-3">
              <Package size={36} className="mx-auto text-muted-foreground/40" />
              <p className="text-muted-foreground text-sm">No active raw batches.</p>
              <Button variant="outline" onClick={() => setTab("create-raw")} className="gap-2"><Plus size={14} /> Create first batch</Button>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/40 border-b text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    <th className="w-8 px-3 py-3" />
                    <th className="px-3 py-3 text-left">Raw Batch ID</th>
                    <th className="px-3 py-3 text-left">Product</th>
                    <th className="px-3 py-3 text-left">Date</th>
                    <th className="px-3 py-3 text-right">Total (kg)</th>
                    <th className="px-3 py-3 text-left">Arrived</th>
                    <th className="px-3 py-3 text-left">State</th>
                    <th className="px-3 py-3 text-center">QR</th>
                    <th className="px-3 py-3 text-center">Edit</th>
                    <th className="px-3 py-3 text-center">Del</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {activeBatches.map(b => (
                    <RawBatchRow key={b.id} batch={b} onQr={setQrBatch} onDelete={setDeleteBatch} onEdit={setEditBatch} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Cooked Batch IDs */}
      {tab === "cooked" && (
        <CookedBatchTable
          batches={cookedBatches as Batch[]}
          isLoading={cookedLoading}
          onEmpty={() => setTab("create-cooked")}
          onQr={setQrBatch}
          onDelete={setDeleteBatch}
          onEdit={setEditBatch}
          rawBatches={allRawBatches as Batch[]}
        />
      )}

      {/* Archive — fully cooked raw batches */}
      {tab === "archive" && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 p-3 rounded-xl bg-muted/40 border">
            <Archive size={16} className="text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Raw batches move here automatically once all weight is accounted for as cooked.</p>
          </div>
          {archivedBatches.length === 0 ? (
            <div className="text-center py-12">
              <Archive size={36} className="mx-auto text-muted-foreground/40 mb-3" />
              <p className="text-muted-foreground text-sm">No archived batches yet.</p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/40 border-b text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    <th className="w-8 px-3 py-3" />
                    <th className="px-3 py-3 text-left">Raw Batch ID</th>
                    <th className="px-3 py-3 text-left">Product</th>
                    <th className="px-3 py-3 text-left">Date</th>
                    <th className="px-3 py-3 text-right">Total (kg)</th>
                    <th className="px-3 py-3 text-left">Arrived</th>
                    <th className="px-3 py-3 text-left">State</th>
                    <th className="px-3 py-3 text-center">QR</th>
                    <th className="px-3 py-3 text-center">Edit</th>
                    <th className="px-3 py-3 text-center">Del</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {archivedBatches.map(b => (
                    <RawBatchRow key={b.id} batch={b} onQr={setQrBatch} onDelete={setDeleteBatch} onEdit={setEditBatch} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === "create-raw" && <CreateRawBatchForm onSuccess={handleCreateSuccess} />}
      {tab === "create-cooked" && <CreateCookedBatchForm onSuccess={handleCreateSuccess} />}
      {tab === "traceability" && (
        <div className="-mx-4 sm:-mx-6">
          <BatchTraceabilityTab />
        </div>
      )}

      {/* Edit Modals */}
      {editBatch && editBatch.batch_type === "parent" && (
        <EditRawBatchModal
          batch={editBatch}
          onClose={() => setEditBatch(null)}
          onSaved={() => { queryClient.invalidateQueries({ queryKey: ["/api/batches"] }); }}
        />
      )}
      {editBatch && editBatch.batch_type === "child" && (
        <EditCookedBatchModal
          batch={editBatch}
          rawBatches={allRawBatches as Batch[]}
          onClose={() => setEditBatch(null)}
          onSaved={() => { queryClient.invalidateQueries({ queryKey: ["/api/batches"] }); }}
        />
      )}

      {/* QR Modal */}
      {qrBatch && <QRModal batch={qrBatch} onClose={() => setQrBatch(null)} />}

      {/* Delete Confirm */}
      {deleteBatch && (
        <DeleteConfirmModal
          batch={deleteBatch}
          onConfirm={() => deleteMutation.mutate(deleteBatch.batch_id)}
          onCancel={() => setDeleteBatch(null)}
          isPending={deleteMutation.isPending}
        />
      )}

      {/* Auto-print modal */}
      {printBatches.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
            <div className="bg-[#256984] px-6 py-4">
              <p className="text-xs font-semibold uppercase tracking-widest text-white/70">Batch Traceability</p>
              <h2 className="text-lg font-bold text-white mt-0.5">{printBatches.length} Raw Batch Label{printBatches.length > 1 ? "s" : ""} Ready</h2>
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
              <Button className="w-full h-11 gap-2 font-semibold" style={{ backgroundColor: "#256984" }}
                onClick={() => { setQrBatch(printBatches[0]); setPrintBatches(prev => prev.slice(1)); }}>
                <Printer size={16} /> Print Labels ({printBatches.length})
              </Button>
              <Button variant="outline" className="w-full h-11" onClick={() => setPrintBatches([])}>Skip — Print Later</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
