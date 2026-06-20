import { useState, useEffect, useRef } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { NumberPadModal } from "@/components/NumberPadModal";
import { StaffSearchPicker } from "@/components/StaffSearchPicker";
import { StatusPill } from "./Compliance";
import {
  ChevronRight, AlertCircle, CheckCircle2, Clock, Thermometer,
  Trash2, Plus, AlertTriangle, RotateCcw, Pencil, Check, Camera, ScanLine, Search
} from "lucide-react";
import { format, parseISO } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ComplianceLog {
  id: string;
  log_type: string;
  entry_date: string;
  log_time: string | null;
  recipe_id: number | null;
  batch_id: string | null;
  source: string;
  status: string;
  derivedStatus: string;
  signed_by_staff_id: number | null;
  signed_at: string | null;
  notes: string;
  supplier_id: number | null;
  delivery_datetime: string | null;
  thaw_item: string | null;
  thaw_weight_qty: string | null;
  thaw_location: string | null;
  thaw_start_time: string | null;
  thaw_target_completion: string | null;
  thaw_num_boxes: number | null;
  thaw_weight_kg: number | null;
  thaw_completed_at: string | null;
  cook_core_temp: number | null;
  cook_recorded_time: string | null;
  cook_recorded_by_staff_id: number | null;
  wastage_total_value: number | null;
  // cooling header fields
  item_name: string | null;
  batch_qty: string | null;
  thermometer_id: string | null;
  person_in_charge_name: string | null;
  person_in_charge_staff_id: number | null;
  corrective_action_batch: string | null;
  corrective_action_taken: string | null;
  corrective_action_reviewed_by: string | null;
  corrective_action_date: string | null;
  stages: CoolingStage[];
  invoice_number: string | null;
  invoice_photo_url: string | null;
  supplierLines: SupplierLine[];
  wastageLines: WastageLine[];
  reviewCategories: ReviewCategory[];
}

interface CoolingStage {
  id: string;
  log_id: string;
  stage_number: number;
  stage_label: string;
  target_time: string | null;
  target_rule: string | null;
  recorded_time: string | null;
  recorded_value: string | null;
  recorded_by_staff_id: number | null;
  recorded_by_name: string | null;
  within_target: boolean | null;
  missed: boolean | null;
  missed_reason: string | null;
}

interface SupplierLine {
  id: string;
  item: string;
  qty: string;
  num_boxes: number | null;
  weight_kg: number | null;
  temp_on_arrival: number | null;
  packaging_ok: boolean | null;
  use_by_ok: boolean | null;
  ingredient_id: number | null;
}

interface WastageLine {
  id: string;
  item: string;
  qty: string;
  reason: string;
  dollar_value: number | null;
}

interface ReviewCategory {
  id: string;
  category: string;
  status: string;
  note: string;
}

// ─── Missed reason options ────────────────────────────────────────────────────

const MISSED_REASONS = [
  "Batch binned",
  "Reading not taken in time",
  "Probe unavailable",
  "Other",
];

const WASTAGE_REASONS = [
  "Over-production",
  "Expired",
  "Damaged in prep",
  "Customer return",
  "Other",
];

const REVIEW_CATEGORIES_DEFAULT = [
  "Cooling logs",
  "Cooking logs",
  "Thawing logs",
  "Supplier deliveries",
  "Wastage records",
  "Cleaning",
  "Pest control",
  "Probe calibration",
];

// ─── Food item smartsearch ────────────────────────────────────────────────────

interface FoodItem { id: string; name: string; type: string; }

function FoodSearchPicker({
  value,
  onSelect,
  placeholder = "Search recipes, sub-recipes, ingredients…",
}: {
  value: string;
  onSelect: (item: FoodItem) => void;
  placeholder?: string;
}) {
  const [query, setQuery] = useState(value || "");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const { data: results = [] } = useQuery<FoodItem[]>({
    queryKey: ["/api/compliance/food-search", query],
    queryFn: () =>
      query.length >= 1
        ? apiRequest("GET", `/api/compliance/food-search?q=${encodeURIComponent(query)}`).then(r => r.json())
        : Promise.resolve([]),
    enabled: query.length >= 1,
  });

  useEffect(() => { setQuery(value || ""); }, [value]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={containerRef} className="relative">
      <Input
        value={query}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        className="h-10"
        autoComplete="off"
      />
      {open && results.length > 0 && (
        <div className="absolute z-50 top-full mt-1 left-0 right-0 bg-popover border border-border rounded-lg shadow-lg overflow-hidden max-h-52 overflow-y-auto">
          {results.map(item => (
            <button
              key={item.id}
              className="w-full flex items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-muted transition-colors border-b border-border last:border-0"
              onMouseDown={() => {
                setQuery(item.name);
                setOpen(false);
                onSelect(item);
              }}
            >
              <span className="text-sm font-medium">{item.name}</span>
              <span className="text-xs text-muted-foreground shrink-0">{item.type}</span>
            </button>
          ))}
        </div>
      )}
      {open && query.length >= 1 && results.length === 0 && (
        <div className="absolute z-50 top-full mt-1 left-0 right-0 bg-popover border border-border rounded-lg shadow-lg px-4 py-3 text-sm text-muted-foreground">
          No matches for "{query}"
        </div>
      )}
    </div>
  );
}

// ─── Batch ID Field (for Cooling Log) ────────────────────────────────────────

function BatchIdField({ log, onRefresh }: { log: ComplianceLog; onRefresh: () => void }) {
  const { toast } = useToast();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [noIdReason, setNoIdReason] = useState("");
  const [noIdOpen, setNoIdOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const { data: childBatches = [] } = useQuery<any[]>({
    queryKey: ["/api/batches", { type: "child", status: "active" }],
    queryFn: () => apiRequest("GET", "/api/batches?type=child&status=active").then(r => r.json()),
    staleTime: 30000,
  });

  const filtered = (childBatches as any[]).filter((b: any) =>
    b.batch_id.toLowerCase().includes(query.toLowerCase()) ||
    (b.product_name || "").toLowerCase().includes(query.toLowerCase())
  );

  const updateLog = async (updates: Record<string, unknown>) => {
    await apiRequest("PUT", `/api/compliance/logs/${log.id}`, updates);
    onRefresh();
  };

  const handleSelect = async (batchId: string) => {
    setOpen(false);
    setQuery("");
    await updateLog({ batch_id: batchId });
    toast({ description: `Batch ID linked: ${batchId}` });
  };

  const handleSaveNoIdReason = async () => {
    if (!noIdReason.trim()) return;
    setSaving(true);
    try {
      const existingNotes = log.notes || "";
      const prefix = "No batch ID reason: ";
      const cleaned = existingNotes.replace(/No batch ID reason: [^\n]*/g, "").trim();
      const newNotes = [cleaned, `${prefix}${noIdReason}`].filter(Boolean).join("\n");
      await updateLog({ notes: newNotes });
      setNoIdOpen(false);
      setNoIdReason("");
      toast({ description: "Reason saved" });
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    await updateLog({ batch_id: null });
    toast({ description: "Batch ID cleared" });
  };

  return (
    <div className="space-y-1 mb-3">
      <label className="text-xs font-medium text-muted-foreground">Batch ID</label>
      {log.batch_id ? (
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-green-100 text-green-700 text-xs font-mono font-bold">
            <CheckCircle2 size={12} />
            {log.batch_id}
          </span>
          <button
            onClick={handleClear}
            className="text-xs text-muted-foreground hover:text-red-500 underline transition-colors"
          >
            Clear
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="relative">
            <Input
              value={query}
              onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
              onFocus={() => setOpen(true)}
              placeholder="Search child batch ID or product…"
              className="h-10"
            />
            {open && (
              <div className="absolute z-30 top-full mt-1 left-0 right-0 bg-white border rounded-lg shadow-lg max-h-40 overflow-y-auto">
                {filtered.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-muted-foreground">No active child batches found</div>
                ) : (
                  filtered.slice(0, 8).map((b: any) => (
                    <button
                      key={b.batch_id}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-[#256984]/10 transition-colors flex items-center gap-2"
                      onMouseDown={() => handleSelect(b.batch_id)}
                    >
                      <span className="font-mono text-xs font-bold text-[#256984]">{b.batch_id}</span>
                      <span className="text-muted-foreground text-xs">{b.product_name}</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>No batch ID?</span>
            <Popover open={noIdOpen} onOpenChange={setNoIdOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-6 text-xs px-2">Give reason</Button>
              </PopoverTrigger>
              <PopoverContent className="w-72 p-3 space-y-2">
                <p className="text-xs font-semibold">Reason for no batch ID</p>
                <Textarea
                  value={noIdReason}
                  onChange={(e) => setNoIdReason(e.target.value)}
                  placeholder="e.g. Batch not yet assigned, pre-existing stock…"
                  className="h-20 text-xs resize-none"
                />
                <Button
                  size="sm"
                  onClick={handleSaveNoIdReason}
                  disabled={saving || !noIdReason.trim()}
                  className="w-full bg-[#256984] hover:bg-[#256984]/90 text-white h-7 text-xs"
                >
                  {saving ? "Saving…" : "Save reason"}
                </Button>
              </PopoverContent>
            </Popover>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Cooling section ────────────────────────────────────────────────────────────

function CoolingFields({ log, onRefresh }: { log: ComplianceLog; onRefresh: () => void }) {
  const { toast } = useToast();

  // Header field state
  const [itemName, setItemName] = useState(log.item_name || "");
  const [batchQty, setBatchQty] = useState(log.batch_qty || "");
  const [thermometerId, setThermometerId] = useState(log.thermometer_id || "");
  // Stage state — per stage: which is open for entry, staff picker, time edits
  const [activeStage, setActiveStage] = useState<string | null>(null);
  const [stagePic, setStagePic] = useState<Record<string, { id: number; name: string } | null>>({});
  const [stageTimes, setStageTimes] = useState<Record<string, string>>({});
  const [padOpen, setPadOpen] = useState<string | null>(null);
  const [missedPopover, setMissedPopover] = useState<string | null>(null);
  const [missedReason, setMissedReason] = useState("");

  // Corrective action
  const [caBatch, setCaBatch] = useState(log.corrective_action_batch || "");
  const [caTaken, setCaTaken] = useState(log.corrective_action_taken || "");
  const [caReviewedBy, setCaReviewedBy] = useState(log.corrective_action_reviewed_by || "");
  const [caDate, setCaDate] = useState(log.corrective_action_date || "");
  const [caSaving, setCaSaving] = useState(false);

  const stages = log.stages || [];
  const now = new Date();

  const anyFailed = stages.some(s => s.within_target === false);
  const hasExistingCA = !!(log.corrective_action_batch || log.corrective_action_taken);

  // A stage is "unlocked" if all previous stages are recorded or missed
  const isUnlocked = (idx: number) => {
    if (idx === 0) return true;
    return stages.slice(0, idx).every(s => s.recorded_value || s.missed);
  };

  const updateLog = async (updates: Record<string, unknown>) => {
    await apiRequest("PUT", `/api/compliance/logs/${log.id}`, updates);
    onRefresh();
  };

  const updateStage = async (stageId: string, updates: Record<string, unknown>) => {
    await apiRequest("POST", `/api/compliance/logs/${log.id}/stages/${stageId}`, updates);
    onRefresh();
  };

  const saveHeader = async (field: string, value: string | number | null) => {
    if (value === (log as any)[field]) return;
    await updateLog({ [field]: value });
  };

  const handleTempConfirm = async (stage: CoolingStage, value: string) => {
    const temp = parseFloat(value);
    let withinTarget: boolean | null = null;
    if (stage.stage_number === 1) withinTarget = temp >= 60;
    if (stage.stage_number === 2) withinTarget = temp <= 21;
    if (stage.stage_number === 3) withinTarget = temp <= 5;

    const recTime = stageTimes[stage.id] || new Date().toISOString();
    const picEntry = stagePic[stage.id];
    const recByName = picEntry !== undefined ? (picEntry?.name ?? null) : (stage.recorded_by_name ?? null);
    const recByStaffId = picEntry !== undefined ? (picEntry?.id ?? null) : (stage.recorded_by_staff_id ?? null);

    await updateStage(stage.id, {
      recordedValue: value,
      recordedTime: recTime,
      withinTarget,
      missed: false,
      recorded_by_name: recByName,
      recorded_by_staff_id: recByStaffId,
    });
    setActiveStage(null);
    toast({ description: `Stage ${stage.stage_number} recorded: ${value}°C` });
  };

  const handleMarkMissed = async (stage: CoolingStage) => {
    if (!missedReason) {
      toast({ description: "Please select a reason", variant: "destructive" });
      return;
    }
    await updateStage(stage.id, { missed: true, missedReason: missedReason, withinTarget: false });
    setMissedPopover(null);
    setMissedReason("");
    setActiveStage(null);
    toast({ description: `Stage ${stage.stage_number} marked as missed` });
  };

  const saveCA = async () => {
    setCaSaving(true);
    try {
      await updateLog({
        corrective_action_batch: caBatch,
        corrective_action_taken: caTaken,
        corrective_action_reviewed_by: caReviewedBy,
        corrective_action_date: caDate,
      });
      toast({ description: "Corrective action saved" });
    } finally {
      setCaSaving(false);
    }
  };

  const toDatetimeLocal = (iso: string | null) => {
    if (!iso) return "";
    try {
      const d = new Date(iso);
      const pad = (n: number) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    } catch { return ""; }
  };

  const fmtTime = (iso: string | null) => {
    if (!iso) return "";
    try { return format(parseISO(iso), "HH:mm"); } catch { return ""; }
  };

  const fmtDue = (iso: string | null) => {
    if (!iso) return null;
    const diff = new Date(iso).getTime() - now.getTime();
    const mins = Math.round(diff / 60000);
    if (mins < 0) return { label: `${Math.abs(mins)}m overdue`, overdue: true };
    if (mins === 0) return { label: "Due now", overdue: true };
    if (mins < 60) return { label: `Due in ${mins}m`, overdue: false };
    const hrs = Math.floor(mins / 60);
    const rem = mins % 60;
    return { label: `Due in ${hrs}h${rem > 0 ? ` ${rem}m` : ""}`, overdue: false };
  };

  return (
    <div className="space-y-6">

      {/* FSANZ rule banner */}
      <div className="rounded-xl border border-[#256984]/20 bg-[#256984]/5 px-4 py-3 flex items-start gap-3">
        <Thermometer size={16} className="text-[#256984] mt-0.5 shrink-0" />
        <div className="text-xs text-[#256984] space-y-0.5">
          <div className="font-semibold mb-0.5">Two-stage cooling rule (FSANZ)</div>
          <div>Stage 1 — 60°C → 21°C <span className="font-semibold">within 2 hours</span></div>
          <div>Stage 2 — 21°C → 5°C within a <span className="font-semibold">further 4 hours</span></div>
        </div>
      </div>

      {/* Batch details */}
      <div className="space-y-3">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Batch details</p>
        {/* Batch ID field */}
        <BatchIdField log={log} onRefresh={onRefresh} />

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Food item</label>
            <FoodSearchPicker
              value={itemName}
              onSelect={async (item) => {
                setItemName(item.name);
                await saveHeader("item_name", item.name);
              }}
              placeholder="Search recipes, ingredients…"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Batch quantity</label>
            <Input value={batchQty} onChange={e => setBatchQty(e.target.value)} onBlur={() => saveHeader("batch_qty", batchQty)} placeholder="e.g. 10L" className="h-10" />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Thermometer ID</label>
            <Input value={thermometerId} onChange={e => setThermometerId(e.target.value)} onBlur={() => saveHeader("thermometer_id", thermometerId)} placeholder="e.g. TH-01" className="h-10" />
          </div>
        </div>
      </div>

      {/* Stage cards */}
      <div className="space-y-3">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Cooling stages</p>
        <div className="space-y-3">
          {stages.map((stage, idx) => {
            const unlocked = isUnlocked(idx);
            const isPass = !!(stage.recorded_value && stage.within_target === true);
            const isFail = !!(stage.recorded_value && stage.within_target === false);
            const isDone = !!(stage.recorded_value || stage.missed);
            const due = !isDone && unlocked ? fmtDue(stage.target_time) : null;
            const isActive = activeStage === stage.id;
            const defaultTime = stageTimes[stage.id] !== undefined
              ? stageTimes[stage.id]
              : toDatetimeLocal(stage.recorded_time || new Date().toISOString());

            // Card border/bg colour
            const cardCls = cn(
              "rounded-2xl border-2 transition-all duration-200",
              isPass && "border-green-400 bg-green-50",
              isFail && "border-red-400 bg-red-50",
              stage.missed && "border-gray-300 bg-gray-50",
              !isDone && unlocked && due?.overdue && "border-orange-400 bg-orange-50",
              !isDone && unlocked && !due?.overdue && "border-[#256984]/40 bg-[#256984]/5",
              !unlocked && "border-gray-200 bg-gray-50 opacity-60"
            );

            return (
              <div key={stage.id} className={cardCls}>
                {/* Stage top row */}
                <div className="flex items-center justify-between px-5 pt-4 pb-3">
                  <div className="flex items-center gap-2">
                    {/* Colour dot */}
                    <div className={cn(
                      "w-3 h-3 rounded-full shrink-0",
                      isPass && "bg-green-500",
                      isFail && "bg-red-500",
                      stage.missed && "bg-gray-400",
                      !isDone && unlocked && due?.overdue && "bg-orange-500 animate-pulse",
                      !isDone && unlocked && !due?.overdue && "bg-[#256984]",
                      !unlocked && "bg-gray-300"
                    )} />
                    <span className={cn(
                      "text-xs font-bold uppercase tracking-widest",
                      isPass && "text-green-700",
                      isFail && "text-red-700",
                      stage.missed && "text-gray-500",
                      !isDone && unlocked && due?.overdue && "text-orange-700",
                      !isDone && unlocked && !due?.overdue && "text-[#256984]",
                      !unlocked && "text-gray-400"
                    )}>
                      Stage {stage.stage_number} · {stage.stage_label}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {due && (
                      <span className={cn(
                        "text-xs font-semibold px-2.5 py-1 rounded-full",
                        due.overdue ? "bg-orange-500 text-white" : "bg-[#256984]/10 text-[#256984]"
                      )}>
                        {due.label}
                      </span>
                    )}
                    {isPass && <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-green-500 text-white">Pass</span>}
                    {isFail && <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-red-500 text-white">Fail</span>}
                    {stage.missed && <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-gray-400 text-white">Missed</span>}
                  </div>
                </div>

                {/* Stage body */}
                <div className="px-5 pb-4 space-y-3">
                  {/* Recorded — show big temp + metadata */}
                  {stage.recorded_value && (
                    <div className="space-y-2">
                      <div className="flex items-baseline gap-3">
                        <span className={cn("text-5xl font-bold tabular-nums", isPass ? "text-green-600" : "text-red-600")}>
                          {stage.recorded_value}°C
                        </span>
                        <div className="space-y-0.5">
                          <div className={cn("flex items-center gap-1 text-sm font-medium", isPass ? "text-green-700" : "text-red-700")}>
                            {isPass ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
                            {isPass ? "Within target" : "Outside target"}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Target: {stage.target_rule}
                          </div>
                        </div>
                      </div>

                      {/* Time + who */}
                      <div className="flex flex-wrap gap-4 text-sm">
                        <div className="space-y-0.5">
                          <p className="text-xs font-medium text-muted-foreground">Time recorded</p>
                          <Input
                            type="datetime-local"
                            className="h-8 text-xs w-48"
                            value={defaultTime}
                            onChange={e => {
                              const iso = e.target.value ? new Date(e.target.value).toISOString() : "";
                              setStageTimes(prev => ({ ...prev, [stage.id]: iso }));
                            }}
                            onBlur={async () => {
                              if (stageTimes[stage.id]) {
                                await updateStage(stage.id, { recorded_time: stageTimes[stage.id] });
                              }
                            }}
                          />
                        </div>
                        <div className="space-y-0.5">
                          <p className="text-xs font-medium text-muted-foreground">Probed by</p>
                          <StaffSearchPicker
                            value={stagePic[stage.id] !== undefined ? (stagePic[stage.id]?.name || "") : (stage.recorded_by_name || "")}
                            onSelect={async (staff) => {
                              setStagePic(prev => ({ ...prev, [stage.id]: staff }));
                              await updateStage(stage.id, { recorded_by_name: staff.name, recorded_by_staff_id: staff.id });
                            }}
                            placeholder="Search staff…"
                          />
                        </div>
                      </div>

                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs text-muted-foreground px-2 -ml-2"
                        onClick={() => { setActiveStage(stage.id); setPadOpen(stage.id); }}
                      >
                        <RotateCcw size={11} className="mr-1" /> Re-record
                      </Button>
                    </div>
                  )}

                  {/* Missed */}
                  {stage.missed && (
                    <div className="text-sm text-gray-600">
                      <span className="font-medium">Reason: </span>{stage.missed_reason || "Not specified"}
                    </div>
                  )}

                  {/* Not yet recorded + unlocked — show entry UI */}
                  {!stage.recorded_value && !stage.missed && unlocked && (
                    <div className="space-y-3">
                      {/* Due time line */}
                      {stage.target_time && (
                        <div className="flex items-center gap-1.5 text-sm">
                          <Clock size={13} className={due?.overdue ? "text-orange-500" : "text-muted-foreground"} />
                          <span className={due?.overdue ? "font-semibold text-orange-700" : "text-muted-foreground"}>
                            Target by {fmtTime(stage.target_time)} · {stage.target_rule}
                          </span>
                        </div>
                      )}

                      {!isActive ? (
                        // Collapsed — big Take reading button
                        <div className="flex gap-2">
                          <Button
                            className="flex-1 h-14 text-base font-semibold"
                            style={{ backgroundColor: "#256984" }}
                            onClick={() => {
                              setActiveStage(stage.id);
                              setPadOpen(stage.id);
                            }}
                          >
                            <Thermometer size={18} className="mr-2" />
                            + Take reading
                          </Button>
                          <Popover
                            open={missedPopover === stage.id}
                            onOpenChange={o => {
                              setMissedPopover(o ? stage.id : null);
                              if (!o) setMissedReason("");
                            }}
                          >
                            <PopoverTrigger asChild>
                              <Button variant="outline" className="h-14 px-4 text-xs text-muted-foreground">
                                Missed
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-72 space-y-3 p-4">
                              <p className="text-sm font-medium">Why was this reading missed?</p>
                              <Select value={missedReason} onValueChange={setMissedReason}>
                                <SelectTrigger className="h-10">
                                  <SelectValue placeholder="Select reason…" />
                                </SelectTrigger>
                                <SelectContent>
                                  {MISSED_REASONS.map(r => (
                                    <SelectItem key={r} value={r}>{r}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <Button
                                className="w-full h-10"
                                style={{ backgroundColor: "#256984" }}
                                onClick={() => handleMarkMissed(stage)}
                                disabled={!missedReason}
                              >
                                Confirm
                              </Button>
                            </PopoverContent>
                          </Popover>
                        </div>
                      ) : null}
                    </div>
                  )}

                  {/* Locked */}
                  {!isDone && !unlocked && (
                    <p className="text-xs text-gray-400 italic">
                      Will unlock once Stage {stage.stage_number - 1} is complete.
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Corrective action */}
      {(anyFailed || hasExistingCA) && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <AlertTriangle size={15} className="text-red-600" />
            <p className="text-xs font-semibold text-red-700 uppercase tracking-widest">Corrective action required</p>
          </div>
          <div className="rounded-2xl border-2 border-red-300 bg-red-50 p-5 space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Batch affected</label>
                <Input value={caBatch} onChange={e => setCaBatch(e.target.value)} placeholder="Batch name or ID" className="h-10 bg-white" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Reviewed by</label>
                <Input value={caReviewedBy} onChange={e => setCaReviewedBy(e.target.value)} placeholder="Name of reviewer" className="h-10 bg-white" />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <label className="text-xs font-medium text-muted-foreground">Action taken</label>
                <Textarea value={caTaken} onChange={e => setCaTaken(e.target.value)} placeholder="Describe the corrective action taken…" className="min-h-[80px] bg-white" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Date</label>
                <Input type="date" value={caDate} onChange={e => setCaDate(e.target.value)} className="h-10 bg-white" />
              </div>
            </div>
            <Button className="h-10 font-medium" style={{ backgroundColor: "#256984" }} onClick={saveCA} disabled={caSaving}>
              {caSaving ? "Saving…" : "Save corrective action"}
            </Button>
          </div>
        </div>
      )}

      {/* Number pad */}
      {padOpen && (
        <NumberPadModal
          open={!!padOpen}
          onClose={() => { setPadOpen(null); setActiveStage(null); }}
          unit="°C"
          title="Enter temperature"
          onConfirm={(v) => {
            const stage = stages.find(s => s.id === padOpen);
            if (stage) handleTempConfirm(stage, v);
            setPadOpen(null);
          }}
        />
      )}
    </div>
  );
}

// ─── Cooking section ──────────────────────────────────────────────────────────

function CookingFields({ log, onRefresh }: { log: ComplianceLog; onRefresh: () => void }) {
  const { toast } = useToast();
  const [padOpen, setPadOpen] = useState(false);
  const [recordedBy, setRecordedBy] = useState<{ id: number; name: string } | null>(null);

  const updateLog = async (updates: Record<string, unknown>) => {
    await apiRequest("PUT", `/api/compliance/logs/${log.id}`, updates);
    onRefresh();
  };

  const handleTempConfirm = async (value: string) => {
    await updateLog({
      cookCoreTemp: parseFloat(value),
      cookRecordedTime: new Date().toISOString(),
      cookRecordedByStaffId: recordedBy?.id || null,
      created_by_name: recordedBy?.name || null,
    });
    toast({ description: `Core temperature recorded: ${value}°C` });
  };

  const isSafe = log.cook_core_temp !== null && log.cook_core_temp >= 75;
  const isUnsafe = log.cook_core_temp !== null && log.cook_core_temp < 75;

  return (
    <div className="space-y-4">
      <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Core temperature</h3>
      <div className={cn(
        "border rounded-xl p-5 space-y-4",
        isSafe && "border-green-200 bg-green-50",
        isUnsafe && "border-red-200 bg-red-50",
        !isSafe && !isUnsafe && "border-border"
      )}>
        {log.cook_core_temp !== null ? (
          <div className="space-y-2">
            <div className={cn(
              "text-4xl font-bold tabular-nums",
              isSafe ? "text-green-700" : "text-red-700"
            )}>
              {log.cook_core_temp}°C
            </div>
            {isSafe ? (
              <div className="flex items-center gap-1.5 text-sm text-green-700">
                <CheckCircle2 size={16} /> Safe — above 75°C
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-sm text-red-700">
                <AlertCircle size={16} /> Below safe temperature (75°C required)
              </div>
            )}
            {log.cook_recorded_time && (
              <div className="text-xs text-muted-foreground">
                Recorded {format(parseISO(log.cook_recorded_time), "HH:mm d MMM yyyy")}
              </div>
            )}
            <Button
              variant="outline"
              size="sm"
              className="h-9 text-sm mt-2"
              onClick={() => setPadOpen(true)}
            >
              <RotateCcw size={14} className="mr-2" />
              Re-record
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Food must reach a core temperature of 75°C or above to be considered safe.
            </p>
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Recorded by</label>
              <StaffSearchPicker
                onSelect={(s) => setRecordedBy({ id: s.id, name: s.name })}
                value={recordedBy?.name}
                placeholder="Search staff name…"
              />
            </div>
            <Button
              className="w-full h-12 font-medium"
              style={{ backgroundColor: "#256984" }}
              onClick={() => setPadOpen(true)}
            >
              <Thermometer size={16} className="mr-2" />
              Take core temperature
            </Button>
          </div>
        )}
      </div>

      <NumberPadModal
        open={padOpen}
        onClose={() => setPadOpen(false)}
        unit="°C"
        title="Core temperature"
        onConfirm={handleTempConfirm}
      />
    </div>
  );
}

// ─── Thawing section ──────────────────────────────────────────────────────────

interface BatchInfo {
  id: number;
  batch_id: string;
  product_name: string;
  product_code: string;
  stage: string;
  total_weight_kg: number | null;
  num_boxes: number | null;
  weight_per_box_kg: number | null;
  created_at: string;
  status: string;
}

function toAwstLocal(isoStr: string): string {
  const d = new Date(isoStr);
  const parts = new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Perth",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d);
  const p: Record<string, string> = {};
  parts.forEach(x => { p[x.type] = x.value; });
  return `${p.year}-${p.month}-${p.day}T${p.hour === "24" ? "00" : p.hour}:${p.minute}`;
}

function fromAwstLocal(localStr: string): string {
  return new Date(localStr + ":00+08:00").toISOString();
}

function useCountdown(targetIso: string | null) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!targetIso) return null;
  const diff = new Date(targetIso).getTime() - now;
  const overdue = diff < 0;
  const abs = Math.abs(diff);
  const totalSecs = Math.floor(abs / 1000);
  const days  = Math.floor(totalSecs / 86400);
  const hours = Math.floor((totalSecs % 86400) / 3600);
  const mins  = Math.floor((totalSecs % 3600) / 60);
  const secs  = totalSecs % 60;
  return { days, hours, mins, secs, overdue, totalSecs };
}

// ── Batch search popup ──────────────────────────────────────────────────────
function BatchSearchPopup({ onSelect, onClose }: { onSelect: (b: BatchInfo) => void; onClose: () => void }) {
  const [search, setSearch] = useState("");
  const { data: batches = [], isLoading } = useQuery<BatchInfo[]>({
    queryKey: ["/api/batches", "parent", "active"],
    queryFn: () => apiRequest("GET", "/api/batches?type=parent&status=active").then(r => r.json()),
  });

  const filtered = batches.filter(b =>
    !search ||
    b.product_name.toLowerCase().includes(search.toLowerCase()) ||
    b.batch_id.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b">
          <span className="font-semibold text-[#256984]">Select parent batch</span>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-xl leading-none">&times;</button>
        </div>
        {/* Search */}
        <div className="px-4 py-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by product or batch ID…"
              className="h-10 pl-9"
              autoFocus
            />
          </div>
        </div>
        {/* List */}
        <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-2">
          {isLoading && <p className="text-sm text-muted-foreground py-4 text-center">Loading batches…</p>}
          {!isLoading && filtered.length === 0 && (
            <p className="text-sm text-muted-foreground py-4 text-center">No active batches found</p>
          )}
          {filtered.map(b => (
            <button
              key={b.batch_id}
              onClick={() => onSelect(b)}
              className="w-full text-left rounded-xl border p-3 hover:border-[#256984] hover:bg-blue-50 transition-colors space-y-1"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-sm">{b.product_name}</span>
                <span className="text-xs rounded-full bg-blue-100 text-blue-700 px-2 py-0.5 capitalize">{b.stage}</span>
              </div>
              <p className="text-xs font-mono text-muted-foreground">{b.batch_id}</p>
              <div className="flex gap-3 text-xs text-muted-foreground">
                {b.num_boxes != null && <span>{b.num_boxes} boxes</span>}
                {b.total_weight_kg != null && <span>{b.total_weight_kg} kg total</span>}
                {b.weight_per_box_kg != null && <span>{b.weight_per_box_kg} kg/box</span>}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function ThawingFields({ log, onRefresh }: { log: ComplianceLog; onRefresh: () => void }) {
  const { toast } = useToast();
  const [, navigate] = useLocation();

  // ── Batch linking ──
  const [linkedBatch, setLinkedBatch] = useState<BatchInfo | null>(null);
  const [manualBatchId, setManualBatchId] = useState("");
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchError, setBatchError] = useState("");
  const [scanMode, setScanMode] = useState(false);
  const [showBatchSearch, setShowBatchSearch] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const scanStreamRef = useRef<MediaStream | null>(null);
  const scanIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Weight / boxes being thawed ──
  // These are the *defrost quantity* fields — how much of the batch is being thawed
  // Either weight OR boxes must be entered. Both can be entered and they cross-calculate.
  const [thawWeightKg, setThawWeightKg] = useState(
    log.thaw_weight_kg != null ? String(log.thaw_weight_kg) : ""
  );
  const [thawBoxes, setThawBoxes] = useState(
    log.thaw_num_boxes != null ? String(log.thaw_num_boxes) : ""
  );

  // Derived: weight per box from linked batch (for cross-calc)
  const batchWpb = linkedBatch?.weight_per_box_kg ?? null;
  const batchHasBoxes = linkedBatch != null && linkedBatch.num_boxes != null;

  // Cross-calculate: when user enters boxes, fill weight (if wpb known); vice versa
  const handleThawBoxesChange = (val: string) => {
    setThawBoxes(val);
    if (batchWpb && val) {
      const computed = (parseFloat(val) * batchWpb).toFixed(2);
      setThawWeightKg(computed);
    }
  };
  const handleThawWeightChange = (val: string) => {
    setThawWeightKg(val);
    if (batchWpb && val) {
      const computed = Math.round(parseFloat(val) / batchWpb);
      setThawBoxes(computed > 0 ? String(computed) : "");
    }
  };

  // ── Log fields ──
  const [thawLocation, setThawLocation] = useState(log.thaw_location || "");
  const [startTime, setStartTime] = useState(() =>
    log.thaw_start_time ? toAwstLocal(log.thaw_start_time) : ""
  );
  const [thawDays, setThawDays] = useState<string>(() => {
    if (log.thaw_start_time && log.thaw_target_completion) {
      const diff = new Date(log.thaw_target_completion).getTime() - new Date(log.thaw_start_time).getTime();
      const d = Math.round(diff / 86400000);
      if (d >= 1 && d <= 7) return String(d);
    }
    return "";
  });
  const targetIso: string | null = (() => {
    if (!startTime || !thawDays) return null;
    try {
      const base = new Date(startTime + ":00+08:00");
      base.setDate(base.getDate() + parseInt(thawDays));
      return base.toISOString();
    } catch { return null; }
  })();

  // ── Completed ──
  const [completedAt, setCompletedAt] = useState<string | null>(log.thaw_completed_at || null);
  const alreadyCompleted = !!completedAt;

  // ── Saving states ──
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [markingComplete, setMarkingComplete] = useState(false);

  const countdown = alreadyCompleted ? null : useCountdown(targetIso);

  // Load linked batch on mount
  useEffect(() => {
    if (log.batch_id && !linkedBatch) fetchBatch(log.batch_id);
  }, [log.batch_id]);

  useEffect(() => { return () => stopScan(); }, []);

  // ── Batch helpers ──
  const fetchBatch = async (batchId: string) => {
    setBatchLoading(true); setBatchError("");
    try {
      const res = await apiRequest("GET", `/api/batches/${batchId}`);
      const data = await res.json();
      if (data.error) { setBatchError(`Batch "${batchId}" not found`); setLinkedBatch(null); }
      else { setLinkedBatch(data); setBatchError(""); }
    } catch { setBatchError("Could not load batch details"); }
    finally { setBatchLoading(false); }
  };

  const handleSelectBatch = async (b: BatchInfo) => {
    setShowBatchSearch(false);
    setLinkedBatch(b);
    setBatchError("");
    setManualBatchId(b.batch_id);
    // Pre-fill weight/boxes from batch totals if not yet set
    if (!thawWeightKg && b.total_weight_kg != null) setThawWeightKg(String(b.total_weight_kg));
    if (!thawBoxes && b.num_boxes != null) setThawBoxes(String(b.num_boxes));
  };

  const stopScan = () => {
    if (scanIntervalRef.current) { clearInterval(scanIntervalRef.current); scanIntervalRef.current = null; }
    if (scanStreamRef.current) { scanStreamRef.current.getTracks().forEach(t => t.stop()); scanStreamRef.current = null; }
    setScanMode(false);
  };

  const startScan = async () => {
    setBatchError("");
    if (!("BarcodeDetector" in window)) {
      setBatchError("QR scanning not supported on this browser — enter the Batch ID manually or use Search.");
      return;
    }
    setScanMode(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } } });
      scanStreamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.play(); }
      const detector = new (window as any).BarcodeDetector({ formats: ["qr_code"] });
      scanIntervalRef.current = setInterval(async () => {
        if (!videoRef.current) return;
        try {
          const codes = await detector.detect(videoRef.current);
          if (codes.length > 0) {
            stopScan();
            const id = (codes[0].rawValue as string).trim();
            setManualBatchId(id);
            await fetchBatch(id);
          }
        } catch { /* frame error */ }
      }, 300);
    } catch (e: any) { setScanMode(false); setBatchError("Camera error: " + e.message); }
  };

  const handleManualLookup = async () => {
    const id = manualBatchId.trim();
    if (id) await fetchBatch(id);
  };

  const unlinkBatch = async () => {
    setLinkedBatch(null); setManualBatchId(""); setBatchError("");
    setThawWeightKg(""); setThawBoxes("");
    await apiRequest("PUT", `/api/compliance/logs/${log.id}`, { batchId: null, thawNumBoxes: null, thawWeightKg: null });
    onRefresh();
  };

  const buildPayload = () => ({
    thawLocation,
    thawStartTime: startTime ? fromAwstLocal(startTime) : null,
    thawTargetCompletion: targetIso,
    batchId: linkedBatch?.batch_id || null,
    thawItem: linkedBatch?.product_name || null,
    thawNumBoxes: thawBoxes ? parseInt(thawBoxes) : null,
    thawWeightKg: thawWeightKg ? parseFloat(thawWeightKg) : null,
  });

  const handleSave = async () => {
    setSaving(true);
    try {
      await apiRequest("PUT", `/api/compliance/logs/${log.id}`, buildPayload());
      onRefresh(); toast({ description: "Details saved" });
    } catch { toast({ description: "Failed to save", variant: "destructive" }); }
    finally { setSaving(false); }
  };

  const handleMarkComplete = async () => {
    setMarkingComplete(true);
    try {
      const now = new Date().toISOString();
      await apiRequest("PUT", `/api/compliance/logs/${log.id}`, { ...buildPayload(), thawCompletedAt: now });
      setCompletedAt(now); onRefresh(); toast({ description: "Thawing marked as complete" });
    } catch { toast({ description: "Failed to mark complete", variant: "destructive" }); }
    finally { setMarkingComplete(false); }
  };

  const handleSubmit = async () => {
    if (!startTime) { toast({ description: "Please set a start time before submitting.", variant: "destructive" }); return; }
    if (!thawWeightKg && !thawBoxes) { toast({ description: "Please enter the weight or number of boxes being defrosted.", variant: "destructive" }); return; }
    setSubmitting(true);
    try {
      await apiRequest("PUT", `/api/compliance/logs/${log.id}`, {
        ...buildPayload(),
        status: "pass",
        thawCompletedAt: completedAt || new Date().toISOString(),
      });
      toast({ description: "Thawing log submitted" });
      navigate("/compliance");
    } catch { toast({ description: "Failed to submit log", variant: "destructive" }); }
    finally { setSubmitting(false); }
  };

  const CountdownDisplay = () => {
    if (!countdown) return null;
    const { days, hours, mins, secs, overdue } = countdown;
    const totalMs = targetIso && log.thaw_start_time
      ? new Date(targetIso).getTime() - new Date(log.thaw_start_time).getTime()
      : (targetIso ? parseInt(thawDays || "1") * 86400000 : 0);
    const elapsed = totalMs > 0 ? Math.max(0, Math.min(1, 1 - (countdown.totalSecs * 1000) / totalMs)) : 0;
    const pct = Math.round(elapsed * 100);
    const color = overdue ? "#ef4444" : pct > 80 ? "#f59e0b" : "#256984";
    const circumference = 2 * Math.PI * 54;
    const strokeDash = circumference * (1 - elapsed);
    return (
      <div className={`rounded-xl border p-4 ${overdue ? "bg-red-50 border-red-200" : "bg-blue-50 border-blue-200"}`}>
        <div className="flex items-center justify-between mb-3">
          <span className={`text-xs font-semibold uppercase tracking-wide ${overdue ? "text-red-700" : "text-[#256984]"}`}>
            {overdue ? "Overdue" : "Time remaining"}
          </span>
          {targetIso && (
            <span className="text-xs text-muted-foreground">
              Target: {new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Perth", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(targetIso))} AWST
            </span>
          )}
        </div>
        <div className="flex items-center gap-6">
          <div className="shrink-0">
            <svg width="120" height="120" viewBox="0 0 120 120">
              <circle cx="60" cy="60" r="54" fill="none" stroke={overdue ? "#fecaca" : "#dbeafe"} strokeWidth="10" />
              <circle cx="60" cy="60" r="54" fill="none" stroke={color} strokeWidth="10"
                strokeDasharray={circumference} strokeDashoffset={overdue ? 0 : strokeDash}
                strokeLinecap="round" transform="rotate(-90 60 60)"
                style={{ transition: "stroke-dashoffset 1s linear" }} />
              <text x="60" y="56" textAnchor="middle" fontSize="11" fill={color} fontWeight="600">{overdue ? "OVER" : `${pct}%`}</text>
              <text x="60" y="70" textAnchor="middle" fontSize="9" fill="#6b7280">elapsed</text>
            </svg>
          </div>
          <div className="flex gap-3">
            {[{ v: days, l: "days" }, { v: hours, l: "hrs" }, { v: mins, l: "min" }, { v: secs, l: "sec" }].map(({ v, l }) => (
              <div key={l} className="text-center">
                <div className={`text-2xl font-bold tabular-nums ${overdue ? "text-red-600" : "text-[#256984]"}`}>{String(v).padStart(2, "0")}</div>
                <div className="text-xs text-muted-foreground">{l}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Thawing details</h3>

      {showBatchSearch && (
        <BatchSearchPopup
          onSelect={handleSelectBatch}
          onClose={() => setShowBatchSearch(false)}
        />
      )}

      {/* ═══ 1. BATCH LINK ═══ */}
      <div className="border rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-[#256984]">Batch link</span>
          {linkedBatch && (
            <button onClick={unlinkBatch} className="text-xs text-muted-foreground hover:text-destructive underline">Unlink</button>
          )}
        </div>

        {linkedBatch ? (
          <div className="space-y-4">
            {/* Batch card */}
            <div className="rounded-lg bg-blue-50 border border-blue-200 p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-sm text-[#256984]">{linkedBatch.product_name}</p>
                  <p className="text-xs text-muted-foreground font-mono mt-0.5">{linkedBatch.batch_id}</p>
                </div>
                <span className="text-xs rounded-full bg-blue-100 text-blue-700 px-2 py-0.5 font-medium capitalize">{linkedBatch.stage}</span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                {[
                  { l: "Total boxes",  v: linkedBatch.num_boxes != null ? String(linkedBatch.num_boxes) : "—" },
                  { l: "Total weight", v: linkedBatch.total_weight_kg != null ? `${linkedBatch.total_weight_kg}kg` : "—" },
                  { l: "kg / box",     v: linkedBatch.weight_per_box_kg != null ? `${linkedBatch.weight_per_box_kg}kg` : "—" },
                ].map(({ l, v }) => (
                  <div key={l} className="bg-white rounded-lg p-2 text-center border border-blue-100">
                    <p className="text-muted-foreground">{l}</p>
                    <p className="font-semibold text-sm">{v}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Weight / boxes being defrosted */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Quantity being defrosted <span className="text-red-500">*</span>
                <span className="normal-case font-normal ml-1">(enter weight and/or boxes)</span>
              </p>
              <div className="grid grid-cols-2 gap-3">
                {/* Weight */}
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Weight (kg)</label>
                  <Input
                    type="number" step="0.1" min="0.1"
                    value={thawWeightKg}
                    onChange={e => handleThawWeightChange(e.target.value)}
                    className="h-11"
                    placeholder="e.g. 10"
                  />
                </div>
                {/* Boxes — only show if the batch has per-box data */}
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">
                    No. of boxes
                    {!batchHasBoxes && <span className="ml-1 text-muted-foreground/60">(bulk/no boxes)</span>}
                  </label>
                  <Input
                    type="number" min="1"
                    max={linkedBatch.num_boxes ?? undefined}
                    value={thawBoxes}
                    onChange={e => handleThawBoxesChange(e.target.value)}
                    className="h-11"
                    placeholder={batchHasBoxes ? `Max ${linkedBatch.num_boxes}` : "N/A"}
                    disabled={!batchHasBoxes && !thawBoxes}
                  />
                </div>
              </div>
              {/* Cross-calc hint */}
              {batchWpb && (
                <p className="text-xs text-muted-foreground">
                  {batchWpb}kg per box — entering one field auto-fills the other
                </p>
              )}
              {/* Validation warning */}
              {linkedBatch.num_boxes != null && thawBoxes && parseInt(thawBoxes) > linkedBatch.num_boxes && (
                <p className="text-xs text-amber-600">Warning: exceeds batch total of {linkedBatch.num_boxes} boxes</p>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Scan */}
            {scanMode ? (
              <div className="space-y-2">
                <div className="relative rounded-xl overflow-hidden bg-black aspect-square max-w-xs mx-auto">
                  <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="w-40 h-40 border-2 border-white rounded-lg opacity-70" />
                  </div>
                  <p className="absolute bottom-2 left-0 right-0 text-center text-white text-xs">Point at the QR code on the box</p>
                </div>
                <Button variant="outline" className="w-full h-10" onClick={stopScan}>Cancel scan</Button>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <Button className="h-11 gap-2 font-medium" style={{ backgroundColor: "#256984" }} onClick={startScan}>
                  <ScanLine className="w-4 h-4" />
                  Scan QR
                </Button>
                <Button variant="outline" className="h-11 gap-2 font-medium" onClick={() => setShowBatchSearch(true)}>
                  <Search className="w-4 h-4" />
                  Search batches
                </Button>
              </div>
            )}
            {/* Manual entry */}
            <div className="flex gap-2">
              <Input
                value={manualBatchId}
                onChange={e => setManualBatchId(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") handleManualLookup(); }}
                className="h-11 font-mono text-sm"
                placeholder="Or enter Batch ID manually"
              />
              <Button variant="outline" className="h-11 px-3" onClick={handleManualLookup} disabled={!manualBatchId.trim() || batchLoading}>
                <Search className="w-4 h-4" />
              </Button>
            </div>
            {batchLoading && <p className="text-xs text-muted-foreground">Looking up batch…</p>}
          </div>
        )}

        {batchError && (
          <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />{batchError}
          </div>
        )}
      </div>

      {/* ═══ 2. LOG DETAILS ═══ */}
      <div className="border rounded-xl p-5 space-y-4">
        <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Log details</h4>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Start time <span className="text-red-500">*</span></label>
            <Input type="datetime-local" value={startTime} onChange={e => setStartTime(e.target.value)} className="h-11" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Thaw duration</label>
            <Select value={thawDays} onValueChange={setThawDays}>
              <SelectTrigger className="h-11">
                <SelectValue placeholder="Select days" />
              </SelectTrigger>
              <SelectContent>
                {[1, 2, 3, 4, 5, 6, 7].map(d => (
                  <SelectItem key={d} value={String(d)}>{d === 1 ? "1 day" : `${d} days`}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {targetIso && (
              <p className="text-xs text-muted-foreground">
                Target: {new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Perth", weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(targetIso))} AWST
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Thaw location (fridge)</label>
            <Input value={thawLocation} onChange={e => setThawLocation(e.target.value)} className="h-11" placeholder="Fridge name or number" />
          </div>
        </div>
        <div className="rounded-lg bg-blue-50 border border-blue-100 px-4 py-3 text-xs text-blue-800 space-y-1">
          <p className="font-medium">Pass criteria</p>
          <p>Item must be kept at ≤5°C throughout the thaw. Thaw must be completed within the planned timeframe.</p>
          <p>Fridge temperature must remain at or below 5°C at all times.</p>
        </div>
        <Button className="h-11 px-5 font-medium" style={{ backgroundColor: "#256984" }} onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save details"}
        </Button>
      </div>

      {/* ═══ 3. COUNTDOWN ═══ */}
      {targetIso && !alreadyCompleted && <CountdownDisplay />}

      {/* ═══ 4. COMPLETE BUTTON / BANNER ═══ */}
      {alreadyCompleted ? (
        <div className="rounded-xl border border-green-200 bg-green-50 p-4 flex items-center gap-3">
          <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-green-800">Thawing completed</p>
            <p className="text-xs text-green-700 mt-0.5">
              {new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Perth", weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(completedAt!))} AWST
            </p>
          </div>
        </div>
      ) : (
        <Button variant="outline" className="w-full h-12 gap-2 font-medium border-green-300 text-green-700 hover:bg-green-50" onClick={handleMarkComplete} disabled={markingComplete}>
          <CheckCircle2 className="w-4 h-4" />
          {markingComplete ? "Saving…" : "Thawing completed"}
        </Button>
      )}

      {/* ═══ 5. SUBMIT ═══ */}
      <Button className="w-full h-12 font-semibold text-base gap-2" style={{ backgroundColor: "#256984" }} onClick={handleSubmit} disabled={submitting}>
        {submitting ? "Submitting…" : "Submit log"}
      </Button>
    </div>
  );
}

// ─── Ingredient smartsearch ──────────────────────────────────────────────────
function IngredientSearch({
  value, ingredientId, onChange
}: {
  value: string;
  ingredientId: number | null;
  onChange: (name: string, id: number | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => { setQuery(value); }, [value]);

  const { data: ingredients = [] } = useQuery<{ id: number; name: string; unit: string }[]>({
    queryKey: ["/api/ingredients"],
    queryFn: () => apiRequest("GET", "/api/ingredients").then(r => r.json()),
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const filtered = ingredients.filter(i =>
    i.name.toLowerCase().includes(query.toLowerCase())
  ).slice(0, 12);

  return (
    <div className="relative" ref={ref}>
      <div className="relative">
        <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search ingredients…"
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true); if (!e.target.value) onChange("", null); }}
          onFocus={() => setOpen(true)}
          onBlur={() => { setTimeout(() => setOpen(false), 150); if (!ingredientId && query) onChange(query, null); }}
          className="pl-8 h-10 text-sm"
        />
      </div>
      {open && filtered.length > 0 && (
        <div className="absolute z-50 top-full mt-1 w-full bg-popover border border-border rounded-lg shadow-lg max-h-48 overflow-y-auto">
          {filtered.map(i => (
            <button
              key={i.id}
              className="w-full text-left px-3 py-2 text-sm hover:bg-muted/60 flex items-center justify-between gap-2"
              onMouseDown={e => { e.preventDefault(); onChange(i.name, i.id); setQuery(i.name); setOpen(false); }}
            >
              <span>{i.name}</span>
              <span className="text-xs text-muted-foreground">{i.unit}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Supplier section ─────────────────────────────────────────────────────────

function SupplierFields({ log, onRefresh, onComplete, startedBy }: { log: ComplianceLog; onRefresh: () => void; onComplete: () => void; startedBy: string | null }) {
  const { toast } = useToast();

  // Auto-populate with current AWST datetime if not set
  const nowAWST = () => {
    // Format current time as AWST (UTC+8) for datetime-local input (YYYY-MM-DDTHH:MM)
    const now = new Date();
    const awstFormatter = new Intl.DateTimeFormat("en-AU", {
      timeZone: "Australia/Perth",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    });
    const parts = Object.fromEntries(awstFormatter.formatToParts(now).map(p => [p.type, p.value]));
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour === "24" ? "00" : parts.hour}:${parts.minute}`;
  };

  // Convert a stored UTC ISO string to AWST datetime-local format
  const toAWST = (iso: string) => {
    const d = new Date(iso);
    const awstFormatter = new Intl.DateTimeFormat("en-AU", {
      timeZone: "Australia/Perth",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    });
    const parts = Object.fromEntries(awstFormatter.formatToParts(d).map(p => [p.type, p.value]));
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour === "24" ? "00" : parts.hour}:${parts.minute}`;
  };

  const [deliveryDatetime, setDeliveryDatetime] = useState(
    log.delivery_datetime ? toAWST(log.delivery_datetime) : nowAWST()
  );
  const [invoiceNumber, setInvoiceNumber] = useState(log.invoice_number ?? "");
  const [padOpen, setPadOpen] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [batchModal, setBatchModal] = useState<{ batches: any[] } | null>(null);
  const invoicePhotoRef = useRef<HTMLInputElement>(null);

  // Auto-save delivery datetime on first load if it was empty
  useEffect(() => {
    if (!log.delivery_datetime) {
      // Parse the AWST datetime-local string as Perth time and convert to UTC ISO
      const awstStr = nowAWST();
      // datetime-local is already in AWST — append +08:00 offset before parsing
      const utcIso = new Date(awstStr + ":00+08:00").toISOString();
      apiRequest("PUT", `/api/compliance/logs/${log.id}`, {
        deliveryDatetime: utcIso,
      }).catch(() => {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { data: suppliers = [] } = useQuery<{ id: number; name: string }[]>({
    queryKey: ["/api/suppliers"],
    queryFn: () => apiRequest("GET", "/api/suppliers").then(r => r.json()),
  });

  const saveHeaderField = async (fields: Record<string, unknown>) => {
    try {
      await apiRequest("PUT", `/api/compliance/logs/${log.id}`, fields);
      onRefresh();
    } catch {
      // silent — fields will retry on next change
    }
  };

  const handleInvoiceScan = async (file: File) => {
    setScanning(true);
    try {
      const fd = new FormData();
      fd.append("photo", file);
      const res = await fetch("/api/compliance/scan-invoice", {
        method: "POST",
        headers: { Authorization: "Bearer d8ecc189f96774038e36112c5ed9f2bc557c3320" },
        body: fd,
      });
      const data = await res.json();
      if (data.invoiceNumber) {
        setInvoiceNumber(data.invoiceNumber);
        toast({ description: `Invoice #${data.invoiceNumber} detected` });
      } else {
        toast({ description: "Could not extract invoice number — enter manually", variant: "destructive" });
      }
    } catch {
      toast({ description: "Scan failed", variant: "destructive" });
    } finally {
      setScanning(false);
    }
  };

  const addLine = async () => {
    await apiRequest("POST", `/api/compliance/logs/${log.id}/supplier-lines`, {
      item: "",
      qty: "",
      temp_on_arrival: null,
      packaging_ok: null,
      use_by_ok: null,
    });
    onRefresh();
  };

  const updateLine = async (lineId: string, updates: Record<string, unknown>) => {
    await apiRequest("PUT", `/api/compliance/logs/${log.id}/supplier-lines/${lineId}`, updates);
    onRefresh();
  };

  const deleteLine = async (lineId: string) => {
    await apiRequest("DELETE", `/api/compliance/logs/${log.id}/supplier-lines/${lineId}`);
    onRefresh();
  };

  const lines = log.supplierLines || [];

  return (
    <div className="space-y-4">
      <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Delivery details</h3>

      {/* Header fields */}
      <div className="border rounded-xl p-5 space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Supplier</label>
            <Select
              value={log.supplier_id ? String(log.supplier_id) : ""}
              onValueChange={v => saveHeaderField({ supplierId: Number(v) })}
            >
              <SelectTrigger className="h-11">
                <SelectValue placeholder="Select supplier…" />
              </SelectTrigger>
              <SelectContent>
                {suppliers.map((s: any) => (
                  <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Delivery date / time</label>
            <Input
              type="datetime-local"
              value={deliveryDatetime}
              onChange={e => setDeliveryDatetime(e.target.value)}
              onBlur={e => saveHeaderField({ deliveryDatetime: e.target.value ? new Date(e.target.value + ":00+08:00").toISOString() : null })}
              className="h-11"
            />
          </div>
        </div>

        {/* Invoice number + scan */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Invoice number</label>
          <div className="flex gap-2">
            <Input
              value={invoiceNumber}
              onChange={e => setInvoiceNumber(e.target.value)}
              onBlur={e => saveHeaderField({ invoiceNumber: e.target.value || null })}
              placeholder="e.g. INV-00123"
              className="h-11 flex-1"
            />
            <input
              ref={invoicePhotoRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleInvoiceScan(f); }}
            />
            <Button
              variant="outline"
              className="h-11 gap-1.5 shrink-0"
              onClick={() => invoicePhotoRef.current?.click()}
              disabled={scanning}
            >
              {scanning ? (
                <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
              ) : (
                <><Camera size={14} /><span className="text-xs">Scan</span></>
              )}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">Take a photo of the invoice to auto-extract the number, or type it in.</p>
        </div>
      </div>

      {/* Line items */}
      <div className="space-y-3">
        <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Items received</h3>
        {lines.length === 0 && (
          <p className="text-sm text-muted-foreground">No items added yet.</p>
        )}
        {lines.map((line: SupplierLine) => (
          <div key={line.id} className="border rounded-xl p-4 space-y-3">
            <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
              <div className="space-y-1 col-span-2 md:col-span-1">
                <label className="text-xs text-muted-foreground">Ingredient</label>
                <IngredientSearch
                  value={line.item}
                  ingredientId={line.ingredient_id}
                  onChange={(name, id) => updateLine(line.id, { item: name, ingredientId: id })}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">No. of boxes</label>
                <Input
                  type="number"
                  min="1"
                  defaultValue={line.num_boxes ?? ""}
                  onBlur={e => updateLine(line.id, { numBoxes: e.target.value ? parseInt(e.target.value) : null })}
                  className="h-10"
                  placeholder="e.g. 4"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Weight (kg)</label>
                <Input
                  type="number"
                  step="0.1"
                  defaultValue={line.weight_kg ?? ""}
                  onBlur={e => updateLine(line.id, { weightKg: e.target.value ? parseFloat(e.target.value) : null })}
                  className="h-10"
                  placeholder="e.g. 20"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Temp on arrival</label>
                <Button
                  variant="outline"
                  className="w-full h-10 justify-start font-normal"
                  onClick={() => setPadOpen(line.id)}
                >
                  {line.temp_on_arrival !== null ? `${line.temp_on_arrival}°C` : "Tap to record"}
                </Button>
              </div>
            </div>

            <div className="flex items-center gap-6 flex-wrap">
              {/* Packaging OK toggle */}
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Packaging intact</label>
                <div className="flex gap-2">
                  {[true, false].map(val => (
                    <button
                      key={String(val)}
                      className={cn(
                        "h-9 px-4 rounded-lg text-sm font-medium border transition-colors",
                        line.packaging_ok === val
                          ? val ? "bg-green-100 border-green-400 text-green-800" : "bg-red-100 border-red-400 text-red-800"
                          : "border-border hover:bg-muted"
                      )}
                      onClick={() => updateLine(line.id, { packagingOk: val })}
                    >
                      {val ? "Yes" : "No"}
                    </button>
                  ))}
                </div>
              </div>

              {/* Use-by OK toggle */}
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Use-by date OK</label>
                <div className="flex gap-2">
                  {[true, false].map(val => (
                    <button
                      key={String(val)}
                      className={cn(
                        "h-9 px-4 rounded-lg text-sm font-medium border transition-colors",
                        line.use_by_ok === val
                          ? val ? "bg-green-100 border-green-400 text-green-800" : "bg-red-100 border-red-400 text-red-800"
                          : "border-border hover:bg-muted"
                      )}
                      onClick={() => updateLine(line.id, { useByOk: val })}
                    >
                      {val ? "Yes" : "No"}
                    </button>
                  ))}
                </div>
              </div>

              <button
                className="ml-auto text-muted-foreground hover:text-destructive transition-colors p-1"
                onClick={() => deleteLine(line.id)}
                title="Remove line"
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        ))}

        <Button
          variant="outline"
          className="h-11 gap-2 font-medium"
          onClick={addLine}
        >
          <Plus size={16} />
          Add item
        </Button>
      </div>

      {padOpen && (
        <NumberPadModal
          open={!!padOpen}
          onClose={() => setPadOpen(null)}
          unit="°C"
          title="Temperature on arrival"
          onConfirm={(v) => {
            if (padOpen) {
              updateLine(padOpen, { tempOnArrival: parseFloat(v) });
            }
            setPadOpen(null);
          }}
        />
      )}

      {/* Submit Delivery */}
      <div className="pt-2">
        <Button
          className="w-full h-12 text-base font-semibold gap-2"
          style={{ backgroundColor: "#256984" }}
          disabled={submitting}
          onClick={async () => {
            if (!startedBy) {
              toast({ description: "Please select who started this log before submitting.", variant: "destructive" });
              return;
            }
            if (!log.supplier_id) {
              toast({ description: "Please select a supplier before submitting.", variant: "destructive" });
              return;
            }
            if (!lines.length) {
              toast({ description: "Please add at least one item before submitting.", variant: "destructive" });
              return;
            }
            setSubmitting(true);
            try {
              await apiRequest("PUT", `/api/compliance/logs/${log.id}`, { status: "pass" });
              // Auto-create batches for meat-category ingredients
              const batchRes = await apiRequest("POST", `/api/compliance/logs/${log.id}/create-batches`, {
                created_by: startedBy,
              }).then(r => r.json());
              if (batchRes.batches && batchRes.batches.length > 0) {
                setBatchModal({ batches: batchRes.batches });
              } else {
                toast({ description: "Delivery logged successfully." });
                onComplete();
              }
            } finally {
              setSubmitting(false);
            }
          }}
        >
          {submitting ? (
            <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            <CheckCircle2 size={18} />
          )}
          Submit Delivery
        </Button>
      </div>

      {/* Batch labels modal */}
      {batchModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="bg-[#256984] px-6 py-4">
              <p className="text-xs font-semibold uppercase tracking-widest text-white/70">Batch Traceability</p>
              <h2 className="text-lg font-bold text-white mt-0.5">
                {batchModal.batches.length} Batch Label{batchModal.batches.length > 1 ? "s" : ""} Created
              </h2>
              <p className="text-xs text-white/70 mt-1">
                Meat ingredients detected — print and attach to each box
              </p>
            </div>

            {/* Batch list */}
            <div className="px-6 py-4 space-y-3 max-h-64 overflow-y-auto">
              {batchModal.batches.map((b: any) => (
                <div key={b.batch_id} className="border rounded-xl p-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold text-sm">{b.product_name}</p>
                    <p className="font-mono text-xs text-muted-foreground">{b.batch_id}</p>
                    {b.total_weight_kg && (
                      <p className="text-xs text-muted-foreground">{b.total_weight_kg} kg</p>
                    )}
                  </div>
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-orange-100 text-orange-800">
                    RAW
                  </span>
                </div>
              ))}
            </div>

            {/* Actions */}
            <div className="px-6 pb-6 pt-2 space-y-2">
              <Button
                className="w-full h-11 gap-2 font-semibold"
                style={{ backgroundColor: "#256984" }}
                onClick={() => {
                  // Open batch manager with these batch IDs for printing
                  const ids = batchModal.batches.map((b: any) => b.batch_id).join(",");
                  window.open(`/batch-manager?print=${encodeURIComponent(ids)}`, "_blank");
                }}
              >
                Print Labels
              </Button>
              <Button
                variant="outline"
                className="w-full h-11"
                onClick={() => {
                  setBatchModal(null);
                  toast({ description: "Delivery logged. Labels saved to Batch Manager." });
                  onComplete();
                }}
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

// ─── Wastage section ──────────────────────────────────────────────────────────

function WastageFields({ log, onRefresh }: { log: ComplianceLog; onRefresh: () => void }) {
  const { toast } = useToast();
  const lines = log.wastageLines || [];

  const addLine = async () => {
    await apiRequest("POST", `/api/compliance/logs/${log.id}/wastage-lines`, {
      item: "",
      qty: "",
      reason: "",
      dollar_value: null,
    });
    onRefresh();
  };

  const updateLine = async (lineId: string, updates: Record<string, unknown>) => {
    await apiRequest("PUT", `/api/compliance/logs/${log.id}/wastage-lines/${lineId}`, updates);
    onRefresh();
  };

  const deleteLine = async (lineId: string) => {
    await apiRequest("DELETE", `/api/compliance/logs/${log.id}/wastage-lines/${lineId}`);
    onRefresh();
  };

  const totalValue = lines.reduce((sum: number, l: WastageLine) => sum + (l.dollar_value || 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Wastage items</h3>
        {totalValue > 0 && (
          <span className="text-sm font-medium text-muted-foreground">
            Total: ${totalValue.toFixed(2)}
          </span>
        )}
      </div>

      {lines.length === 0 && (
        <p className="text-sm text-muted-foreground">No wastage items recorded yet.</p>
      )}

      {lines.map((line: WastageLine) => (
        <div key={line.id} className="border rounded-xl p-4 space-y-3">
          <div className="grid gap-3 md:grid-cols-4">
            <div className="space-y-1 md:col-span-2">
              <label className="text-xs text-muted-foreground">Item</label>
              <Input
                defaultValue={line.item}
                onBlur={e => updateLine(line.id, { item: e.target.value })}
                className="h-10"
                placeholder="Item name"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Qty</label>
              <Input
                defaultValue={line.qty}
                onBlur={e => updateLine(line.id, { qty: e.target.value })}
                className="h-10"
                placeholder="e.g. 500g"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Value ($)</label>
              <Input
                type="number"
                defaultValue={line.dollar_value ?? ""}
                onBlur={e => updateLine(line.id, { dollarValue: e.target.value ? parseFloat(e.target.value) : null })}
                className="h-10"
                placeholder="Optional"
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex-1 space-y-1">
              <label className="text-xs text-muted-foreground">Reason</label>
              <Select
                value={line.reason || ""}
                onValueChange={v => updateLine(line.id, { reason: v })}
              >
                <SelectTrigger className="h-10">
                  <SelectValue placeholder="Select reason…" />
                </SelectTrigger>
                <SelectContent>
                  {WASTAGE_REASONS.map(r => (
                    <SelectItem key={r} value={r}>{r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <button
              className="text-muted-foreground hover:text-destructive transition-colors p-1 mt-4"
              onClick={() => deleteLine(line.id)}
              title="Remove line"
            >
              <Trash2 size={16} />
            </button>
          </div>
        </div>
      ))}

      <Button
        variant="outline"
        className="h-11 gap-2 font-medium"
        onClick={addLine}
      >
        <Plus size={16} />
        Add item
      </Button>
    </div>
  );
}

// ─── Weekly review section ────────────────────────────────────────────────────

function ReviewFields({ log, onRefresh }: { log: ComplianceLog; onRefresh: () => void }) {
  const { toast } = useToast();
  const existing = log.reviewCategories || [];

  const [cats, setCats] = useState<{ category: string; status: string; note: string }[]>(() => {
    return REVIEW_CATEGORIES_DEFAULT.map(cat => {
      const found = existing.find((e: ReviewCategory) => e.category === cat);
      return {
        category: cat,
        status: found?.status || "",
        note: found?.note || "",
      };
    });
  });

  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await apiRequest("POST", `/api/compliance/logs/${log.id}/review-categories`, {
        categories: cats,
      });
      onRefresh();
      toast({ description: "Review categories saved" });
    } catch {
      toast({ description: "Failed to save", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const updateCat = (idx: number, field: string, value: string) => {
    setCats(prev => prev.map((c, i) => i === idx ? { ...c, [field]: value } : c));
  };

  return (
    <div className="space-y-4">
      <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Review categories</h3>
      <div className="border rounded-xl divide-y">
        {cats.map((cat, idx) => (
          <div key={cat.category} className="p-4 space-y-2">
            <div className="flex items-center justify-between gap-4">
              <span className="font-medium text-sm">{cat.category}</span>
              <div className="flex gap-2 shrink-0">
                {["All in order", "Issues noted"].map(opt => (
                  <button
                    key={opt}
                    className={cn(
                      "px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors",
                      cat.status === opt
                        ? opt === "All in order"
                          ? "bg-green-100 border-green-400 text-green-800"
                          : "bg-amber-100 border-amber-400 text-amber-800"
                        : "border-border hover:bg-muted"
                    )}
                    onClick={() => updateCat(idx, "status", opt)}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </div>
            {cat.status === "Issues noted" && (
              <Textarea
                value={cat.note}
                onChange={e => updateCat(idx, "note", e.target.value)}
                placeholder="Describe the issue…"
                className="min-h-[72px] text-sm"
              />
            )}
          </div>
        ))}
      </div>

      <Button
        className="h-11 px-5 font-medium"
        style={{ backgroundColor: "#256984" }}
        onClick={handleSave}
        disabled={saving}
      >
        Save review
      </Button>
    </div>
  );
}

// ─── Sign-off bar ─────────────────────────────────────────────────────────────

function SignOffBar({ log, onRefresh }: { log: ComplianceLog; onRefresh: () => void }) {
  const { toast } = useToast();
  const [selectedStaff, setSelectedStaff] = useState<{ id: number; name: string } | null>(null);
  const [signing, setSigning] = useState(false);

  const isSigned = !!log.signed_at && !!log.signed_by_staff_id;

  const canSignOff = !isSigned && (
    log.log_type === "review" ||
    log.log_type === "wastage" ||
    log.log_type === "thawing" ||
    (log.log_type === "cooking" && log.cook_core_temp !== null) ||
    (log.log_type === "supplier" && (log.supplierLines?.length || 0) > 0) ||
    (log.log_type === "cooling" && (log.stages || []).every((s: CoolingStage) => s.recorded_value || s.missed))
  );

  const handleSignOff = async () => {
    if (!selectedStaff) {
      toast({ description: "Please select a staff member to sign off", variant: "destructive" });
      return;
    }
    setSigning(true);
    try {
      await apiRequest("POST", `/api/compliance/logs/${log.id}/sign-off`, {
        staffId: selectedStaff.id,
      });
      onRefresh();
      toast({ description: `Signed off by ${selectedStaff.name}` });
    } catch {
      toast({ description: "Sign-off failed", variant: "destructive" });
    } finally {
      setSigning(false);
    }
  };

  if (isSigned) {
    return (
      <div className="sticky bottom-0 bg-card border-t border-border px-6 py-4 flex items-center gap-3">
        <CheckCircle2 size={20} className="text-green-600 shrink-0" />
        <div className="flex-1">
          <p className="text-sm font-medium text-green-700">Signed off</p>
          {log.signed_at && (
            <p className="text-xs text-muted-foreground">
              {format(parseISO(log.signed_at), "HH:mm, d MMM yyyy")}
            </p>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-9 text-muted-foreground"
          onClick={async () => {
            await apiRequest("PUT", `/api/compliance/logs/${log.id}`, {
              signedByStaffId: null,
              signedAt: null,
              status: "in_progress",
            });
            onRefresh();
          }}
        >
          Edit / clear sign-off
        </Button>
      </div>
    );
  }

  return (
    <div className="sticky bottom-0 bg-card border-t border-border px-6 py-4 space-y-3">
      {!canSignOff && (
        <p className="text-xs text-muted-foreground text-center">
          Available once all required fields are recorded
        </p>
      )}
      <div className="flex gap-3 items-end">
        <div className="flex-1 space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Sign off as</label>
          <StaffSearchPicker
            onSelect={setSelectedStaff}
            value={selectedStaff?.name}
            disabled={!canSignOff}
            placeholder="Type name to search…"
          />
        </div>
        <Button
          className="h-12 px-6 font-semibold shrink-0"
          style={{ backgroundColor: "#256984" }}
          disabled={!canSignOff || !selectedStaff || signing}
          onClick={handleSignOff}
        >
          {log.log_type === "supplier" ? "Log Delivery" : "Sign off"}
        </Button>
      </div>
    </div>
  );
}

// ─── Main entry page ──────────────────────────────────────────────────────────

const LOG_TYPE_LABELS: Record<string, string> = {
  cooling: "Cooling Log",
  cooking: "Cooking Log",
  thawing: "Thawing Log",
  supplier: "Supplier Delivery",
  wastage: "Wastage Sheet",
  review: "Weekly Review",
};

export default function ComplianceLogEntry() {
  const { logType, logId } = useParams() as { logType: string; logId: string };
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: log, isLoading, refetch } = useQuery<ComplianceLog>({
    queryKey: [`/api/compliance/logs/${logId}`],
    queryFn: () => apiRequest("GET", `/api/compliance/logs/${logId}`).then(r => r.json()),
    refetchOnWindowFocus: false,
  });

  const [notes, setNotes] = useState(log?.notes || "");
  const [notesChanged, setNotesChanged] = useState(false);
  const [startedByStaff, setStartedByStaff] = useState<{ id: number; name: string } | null>(null);


  // Suppliers list for status bar name lookup
  const { data: suppliersList = [] } = useQuery<{ id: number; name: string }[]>({
    queryKey: ["/api/suppliers"],
    queryFn: () => apiRequest("GET", "/api/suppliers").then(r => r.json()),
  });

  useEffect(() => {
    if (log) {
      setNotes(log.notes || "");
      if (log.created_by_name && !startedByStaff) {
        setStartedByStaff({ id: 0, name: log.created_by_name });
      }
    }
  }, [log?.id]);

  const saveNotes = async () => {
    await apiRequest("PUT", `/api/compliance/logs/${logId}`, { notes });
    setNotesChanged(false);
    toast({ description: "Notes saved" });
  };

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 rounded-xl" />
        <Skeleton className="h-40 rounded-xl" />
      </div>
    );
  }

  if (!log) {
    return (
      <div className="p-6 text-center text-muted-foreground">
        <AlertCircle className="mx-auto mb-2" size={32} />
        <p>Record not found.</p>
        <Button variant="link" onClick={() => navigate("/compliance")}>Back to compliance</Button>
      </div>
    );
  }

  const status = log.derivedStatus || log.status;
  const typeLabel = LOG_TYPE_LABELS[logType] || logType;

  return (
    <div className="flex flex-col min-h-full">
      {/* Header */}
      <div className="p-6 border-b">
        {/* Breadcrumb */}
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground mb-3">
          <button
            className="hover:text-foreground transition-colors"
            onClick={() => navigate("/compliance")}
          >
            Compliance
          </button>
          <ChevronRight size={14} />
          <span>{typeLabel}</span>
          {log.batch_id && (
            <>
              <ChevronRight size={14} />
              <span className="font-mono text-xs">{log.batch_id}</span>
            </>
          )}
        </div>

        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-bold">{typeLabel}</h1>
          <div className="flex items-center gap-2">
            <StatusPill status={status} />
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-red-600 hover:bg-red-50">
                  <Trash2 size={17} />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete this log?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete the {typeLabel.toLowerCase()} and all recorded data. This cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-red-600 hover:bg-red-700 text-white"
                    onClick={async () => {
                      await apiRequest("DELETE", `/api/compliance/logs/${logId}`);
                      await qc.invalidateQueries({ queryKey: ["/api/compliance/logs"] });
                      await qc.invalidateQueries({ queryKey: ["/api/compliance/audit-status"] });
                      navigate("/compliance");
                    }}
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-6 space-y-6 max-w-3xl">

          {/* ── Colour-coded status bar ──────────────────────────────────── */}
          {(() => {
            const s = log.derivedStatus || log.status || "in_progress";
            const supplierName = logType === "supplier" && log.supplier_id
              ? (suppliersList.find((x: any) => x.id === log.supplier_id)?.name ?? null)
              : null;

            type Scheme = { bar: string; text: string; sub: string; badge: string; label: string };
            const schemes: Record<string, Scheme> = {
              in_progress:   { bar: "bg-[#256984]",   text: "text-white",          sub: "text-white/70",  badge: "bg-white/20 text-white", label: "In Progress" },
              action_needed: { bar: "bg-amber-500",   text: "text-white",          sub: "text-amber-100", badge: "bg-white/20 text-white", label: "Needs Attention" },
              pass:          { bar: "bg-green-600",   text: "text-white",          sub: "text-green-100", badge: "bg-white/20 text-white", label: "Complete" },
              closed:        { bar: "bg-gray-500",    text: "text-white",          sub: "text-gray-200",  badge: "bg-white/20 text-white", label: "Closed" },
            };
            const c: Scheme = schemes[s] ?? schemes.in_progress;

            return (
              <div className={`rounded-xl px-5 py-4 ${c.bar}`}>
                <div className="flex items-start justify-between gap-3">

                  {/* Left column */}
                  <div className="flex-1 min-w-0 space-y-1.5">

                    {/* Log type label */}
                    <p className={`text-[11px] font-semibold uppercase tracking-widest ${c.sub}`}>
                      {typeLabel}
                    </p>

                    {/* Supplier name (supplier log only) */}
                    {supplierName && (
                      <p className={`text-base font-bold ${c.text}`}>{supplierName}</p>
                    )}

                    {log.batch_id && (
                      <span className={`font-mono text-xs px-2 py-0.5 rounded bg-white/15 ${c.text}`}>
                        {log.batch_id}
                      </span>
                    )}
                  </div>

                  {/* Right: status pill */}
                  <div className="flex-shrink-0 pt-1">
                    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${c.badge}`}>
                      <span className="w-1.5 h-1.5 rounded-full bg-white/80 inline-block" />
                      {c.label}
                    </span>
                  </div>

                </div>
              </div>
            );
          })()}

          <Separator />

          {/* Started by */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Started by <span className="text-red-500">*</span>
            </label>
            <StaffSearchPicker
              value={startedByStaff?.name || ""}
              onSelect={async (staff) => {
                setStartedByStaff(staff);
                await apiRequest("PUT", `/api/compliance/logs/${logId}`, {
                  created_by_name: staff.name,
                });
              }}
              placeholder="Search staff…"
            />
          </div>

          <Separator />

          {/* Log-type specific fields */}
          {logType === "cooling" && (
            <CoolingFields log={log} onRefresh={() => refetch()} />
          )}
          {logType === "cooking" && (
            <CookingFields log={log} onRefresh={() => refetch()} />
          )}
          {logType === "thawing" && (
            <ThawingFields log={log} onRefresh={() => refetch()} />
          )}
          {logType === "supplier" && (
            <SupplierFields log={log} onRefresh={() => refetch()} onComplete={() => navigate("/compliance")} startedBy={startedByStaff?.name ?? null} />
          )}
          {logType === "wastage" && (
            <WastageFields log={log} onRefresh={() => refetch()} />
          )}
          {logType === "review" && (
            <ReviewFields log={log} onRefresh={() => refetch()} />
          )}

          <Separator />

          {/* Notes */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Notes</label>
            <Textarea
              value={notes}
              onChange={e => {
                setNotes(e.target.value);
                setNotesChanged(true);
              }}
              placeholder="Any additional notes about this record…"
              className="min-h-[96px]"
            />
            {notesChanged && (
              <Button
                variant="outline"
                size="sm"
                className="h-9"
                onClick={saveNotes}
              >
                Save notes
              </Button>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
