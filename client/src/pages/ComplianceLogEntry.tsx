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
  Trash2, Plus, AlertTriangle, RotateCcw
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
  temp_on_arrival: number | null;
  packaging_ok: boolean | null;
  use_by_ok: boolean | null;
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

// ─── Cooling section ────────────────────────────────────────────────────────────

function CoolingFields({ log, onRefresh }: { log: ComplianceLog; onRefresh: () => void }) {
  const { toast } = useToast();

  // Header field state
  const [itemName, setItemName] = useState(log.item_name || "");
  const [batchQty, setBatchQty] = useState(log.batch_qty || "");
  const [thermometerId, setThermometerId] = useState(log.thermometer_id || "");
  const [picStaff, setPicStaff] = useState<{ id: number; name: string } | null>(
    log.person_in_charge_name ? { id: log.person_in_charge_staff_id ?? 0, name: log.person_in_charge_name } : null
  );

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
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Person in charge</label>
            <StaffSearchPicker
              value={picStaff?.name || ""}
              onSelect={async (staff) => {
                setPicStaff(staff);
                await updateLog({ person_in_charge_name: staff.name, person_in_charge_staff_id: staff.id });
              }}
              placeholder="Search staff…"
            />
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

function ThawingFields({ log, onRefresh }: { log: ComplianceLog; onRefresh: () => void }) {
  const { toast } = useToast();
  const [item, setItem] = useState(log.thaw_item || "");
  const [weightQty, setWeightQty] = useState(log.thaw_weight_qty || "");
  const [location, setLocation] = useState(log.thaw_location || "");
  const [startTime, setStartTime] = useState(
    log.thaw_start_time ? log.thaw_start_time.slice(0, 16) : ""
  );
  const [targetCompletion, setTargetCompletion] = useState(
    log.thaw_target_completion ? log.thaw_target_completion.slice(0, 16) : ""
  );
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await apiRequest("PUT", `/api/compliance/logs/${log.id}`, {
        thawItem: item,
        thawWeightQty: weightQty,
        thawLocation: location,
        thawStartTime: startTime ? new Date(startTime).toISOString() : null,
        thawTargetCompletion: targetCompletion ? new Date(targetCompletion).toISOString() : null,
      });
      onRefresh();
      toast({ description: "Thaw details saved" });
    } catch {
      toast({ description: "Failed to save", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Thawing details</h3>
      <div className="border rounded-xl p-5 space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Item</label>
            <Input value={item} onChange={e => setItem(e.target.value)} className="h-11" placeholder="Item being thawed" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Weight / quantity</label>
            <Input value={weightQty} onChange={e => setWeightQty(e.target.value)} className="h-11" placeholder="e.g. 2kg" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Location (fridge)</label>
            <Input value={location} onChange={e => setLocation(e.target.value)} className="h-11" placeholder="Fridge name or number" />
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Start time</label>
            <Input
              type="datetime-local"
              value={startTime}
              onChange={e => setStartTime(e.target.value)}
              className="h-11"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Target completion</label>
            <Input
              type="datetime-local"
              value={targetCompletion}
              onChange={e => setTargetCompletion(e.target.value)}
              className="h-11"
            />
          </div>
        </div>
        <div className="rounded-lg bg-blue-50 border border-blue-100 px-4 py-3 text-xs text-blue-800 space-y-1">
          <p className="font-medium">Pass criteria</p>
          <p>Item must be kept at ≤5°C throughout the thaw. Thaw must be completed within the planned timeframe.</p>
          <p>Fridge temperature must remain at or below 5°C at all times.</p>
        </div>
        <Button
          className="h-11 px-5 font-medium"
          style={{ backgroundColor: "#256984" }}
          onClick={handleSave}
          disabled={saving}
        >
          Save details
        </Button>
      </div>
    </div>
  );
}

// ─── Supplier section ─────────────────────────────────────────────────────────

function SupplierFields({ log, onRefresh }: { log: ComplianceLog; onRefresh: () => void }) {
  const { toast } = useToast();
  const [deliveryDatetime, setDeliveryDatetime] = useState(
    log.delivery_datetime ? log.delivery_datetime.slice(0, 16) : ""
  );
  const [padOpen, setPadOpen] = useState<string | null>(null);
  const [savingHeader, setSavingHeader] = useState(false);

  const { data: suppliers = [] } = useQuery<{ id: number; name: string }[]>({
    queryKey: ["/api/suppliers"],
    queryFn: () => apiRequest("GET", "/api/suppliers").then(r => r.json()),
  });

  const saveDelivery = async () => {
    setSavingHeader(true);
    try {
      await apiRequest("PUT", `/api/compliance/logs/${log.id}`, {
        deliveryDatetime: deliveryDatetime ? new Date(deliveryDatetime).toISOString() : null,
      });
      onRefresh();
      toast({ description: "Delivery details saved" });
    } catch {
      toast({ description: "Failed to save", variant: "destructive" });
    } finally {
      setSavingHeader(false);
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
              onValueChange={async (v) => {
                await apiRequest("PUT", `/api/compliance/logs/${log.id}`, { supplierId: Number(v) });
                onRefresh();
              }}
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
              className="h-11"
            />
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-9"
          onClick={saveDelivery}
          disabled={savingHeader}
        >
          Save delivery info
        </Button>
      </div>

      {/* Line items */}
      <div className="space-y-3">
        <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Items received</h3>
        {lines.length === 0 && (
          <p className="text-sm text-muted-foreground">No items added yet.</p>
        )}
        {lines.map((line: SupplierLine) => (
          <div key={line.id} className="border rounded-xl p-4 space-y-3">
            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-1">
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
                  placeholder="e.g. 5kg"
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
          Sign off
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

          {/* Summary card */}
          <div className="border rounded-xl p-4 bg-muted/30 space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              {log.entry_date && (
                <Badge variant="secondary">{format(parseISO(log.entry_date), "d MMM yyyy")}</Badge>
              )}
              {log.batch_id && (
                <Badge variant="outline" className="font-mono text-xs">{log.batch_id}</Badge>
              )}
              {log.source && (
                <Badge variant={log.source === "production_auto" ? "default" : "secondary"} className="text-xs">
                  {log.source === "production_auto" ? "Auto-created" : "Manual"}
                </Badge>
              )}
            </div>
            {/* Started by — required for all log types */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Started by</label>
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
            <SupplierFields log={log} onRefresh={() => refetch()} />
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
