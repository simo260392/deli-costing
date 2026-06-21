import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

const API_BASE = "__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import {
  ChefHat, RefreshCw, ChevronDown, ChevronUp, CheckCircle2,
  Clock, Timer, AlertCircle, SkipForward, RotateCcw, Play,
  CalendarDays, ShoppingCart, ListChecks, X, Check, Plus, User,
  ClipboardList, Trash2, Package, Pencil, Loader2, Store, AlertTriangle
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SearchableSelect, SearchableOption } from "@/components/SearchableSelect";

// ─── Types ────────────────────────────────────────────────────────────────────
interface StaffMember { id: number; name: string; }
interface StockItem { id: number; item_name: string; item_type: string; quantity: number; unit: string; updated_at: string; }

interface ComboOptionItem { name: string; }
interface ComboOption { name: string; items: ComboOptionItem[]; }
interface FlexOrderItem {
  uuid: string; name: string; quantity: number; sku: string;
  price_incl_tax: number; attributes_summary: string;
  notes: string;
  combo_options?: ComboOption[];
  checked?: boolean;
}

interface FlexOrder {
  id: number; uuid: string;
  company: string; first_name: string; last_name: string;
  delivery_datetime: string; dispatch_datetime: string | null; created_at: string; status: string;
  internal_notes: string;
  delivery_notes: string;
  notes: string;
  customer_uuid: string;
  is_wholesale: boolean;
  items: FlexOrderItem[];
}

interface PrepTask {
  id: number; sessionId: number;
  itemType: "sub_recipe" | "recipe" | "flex_product";
  itemId: number; itemName: string;
  quantityRequired: number; quantityActual: number | null;
  forOrders: string[];
  assignedTo: number | null; assignedName: string | null;
  expectedMinutes: number | null;
  startedAt: string | null; finishedAt: string | null; actualMinutes: number | null;
  status: "pending" | "in_progress" | "done" | "skipped";
}

interface PrepSession {
  id: number; date: string; dateFrom?: string; dateTo?: string;
  notes: string | null; orders: any[]; status: "active" | "completed";
  createdAt: string; completedAt: string | null; tasks: PrepTask[];
}

// Merge conflict: a new order came in for an item that's in-progress
interface MergeConflict {
  taskId: number;          // the NEW separate task added for the extra qty
  existingTaskId: number;  // the original in-progress task
  taskName: string;
  existingQty: number;   // what's already being made
  newQty: number;        // what just came in
  totalQty: number;      // existingQty + newQty
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function localDateStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function today() { return localDateStr(new Date()); }
function tomorrow() {
  const d = new Date(); d.setDate(d.getDate() + 1);
  return localDateStr(d);
}
function fmtDate(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" });
}
function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-AU", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
function fmtTimeOnly(iso: string) {
  return new Date(iso).toLocaleString("en-AU", { hour: "2-digit", minute: "2-digit" });
}
function fmtMins(mins: number | null | undefined) {
  if (!mins) return "—";
  const h = Math.floor(mins / 60), m = Math.round(mins % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
function fmtQty(qty: number) {
  return qty % 1 === 0 ? qty.toString() : qty.toFixed(2);
}

function useElapsed(startedAt: string | null, active: boolean) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!active || !startedAt) { setElapsed(0); return; }
    const update = () => setElapsed((Date.now() - new Date(startedAt).getTime()) / 60000);
    update();
    const id = setInterval(update, 10000);
    return () => clearInterval(id);
  }, [startedAt, active]);
  return elapsed;
}

// ─── Order status helpers ─────────────────────────────────────────────────────
interface CheckedItemState {
  checked: boolean;
  staffId?: number;
  staffName?: string;
  checkedAt?: string;
  // Missing item info (set when 'Items not made' is selected)
  isMissing?: boolean;          // true = partially or fully missing
  qtyMissing?: number;
  qtyMade?: number;
  totalRequired?: number;
  reasonType?: string;          // 'ingredient' | 'other'
  reasonIngredient?: string;
  reasonOther?: string;
}
type OrderState = { viewed: boolean; checkedItems: Record<string, CheckedItemState>; prepStatus: string; isComplete?: boolean; itemCount?: number; hasMissing?: boolean; };
const DEFAULT_ORDER_STATE: OrderState = { viewed: false, checkedItems: {}, prepStatus: "new", isComplete: false };

// Returns the flat list of all tickable entries for an order.
// All items are tickable in their own right.
// Items with combo_options also get sub-rows for each combo item (modifiers/components).
// The parent is always independently tickable — sub-items are additive.
interface TickableItem { uuid: string; name: string; parentUuid?: string; isSubItem?: boolean; comboLabel?: string; quantity?: number; }
function getTickableItems(order: FlexOrder): TickableItem[] {
  const result: TickableItem[] = [];
  for (const item of order.items) {
    const combos = (item.combo_options || []).filter(co => co.items.length > 0);
    // Parent item is always a tickable row
    result.push({ uuid: item.uuid, name: item.name, quantity: Number(item.quantity) || 1 });
    // Sub-items (combo options / modifiers) are additional tickable rows beneath the parent
    for (let oi = 0; oi < combos.length; oi++) {
      const co = combos[oi];
      for (let ii = 0; ii < co.items.length; ii++) {
        result.push({
          uuid: `${item.uuid}__sub__${oi}_${ii}`,
          name: co.items[ii].name,
          parentUuid: item.uuid,
          isSubItem: true,
          comboLabel: co.name,
          quantity: 1,
        });
      }
    }
  }
  return result;
}

function orderColour(status: string) {
  if (status === "edited") return { border: "border-purple-400", bg: "bg-purple-50", badge: "bg-purple-100 text-purple-700" };
  switch (status) {
    case "new":         return { border: "border-yellow-400",  bg: "bg-yellow-50 dark:bg-yellow-950/20",  badge: "bg-yellow-100 text-yellow-800 border-yellow-300", label: "New" };
    case "not_started": return { border: "border-red-400",     bg: "bg-red-50 dark:bg-red-950/20",        badge: "bg-red-100 text-red-700 border-red-300",           label: "Not Started" };
    case "in_progress": return { border: "border-orange-400",  bg: "bg-orange-50 dark:bg-orange-950/20",  badge: "bg-orange-100 text-orange-700 border-orange-300",  label: "In Progress" };
    case "done":        return { border: "border-green-400",   bg: "bg-green-50 dark:bg-green-950/20",    badge: "bg-green-100 text-green-700 border-green-300",     label: "Done" };
    case "complete":    return { border: "border-green-400",   bg: "bg-green-50 dark:bg-green-950/20",    badge: "bg-green-100 text-green-700 border-green-300",     label: "Complete" };
    default:            return { border: "border-border",       bg: "bg-card",                              badge: "bg-muted text-muted-foreground",                   label: status };
  }
}

// ─── Staff Name Dialog ─────────────────────────────────────────────────────────
function StaffPickerDialog({ open, onClose, staff, onSelect, itemName, orderQty }: {
  open: boolean;
  onClose: () => void;
  staff: StaffMember[];
  onSelect: (staffId: number, staffName: string, useFromStock: boolean, stockItemId?: number, isMissing?: boolean) => void;
  itemName: string;
  orderQty: number;
}) {
  const [selectedId, setSelectedId] = useState<string>("");
  const [useFromStock, setUseFromStock] = useState(false);
  const [itemsNotMade, setItemsNotMade] = useState(false);
  const [stockMatch, setStockMatch] = useState<StockItem | null>(null);
  const [matchLoading, setMatchLoading] = useState(false);

  useEffect(() => {
    if (open) {
      setSelectedId("");
      setUseFromStock(false);
      setItemsNotMade(false);
      setStockMatch(null);
      if (itemName) {
        setMatchLoading(true);
        fetch(`${API_BASE}/api/stock-on-hand/match`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderItemName: itemName }),
        })
          .then(r => r.json())
          .then(d => setStockMatch(d.match || null))
          .catch(() => setStockMatch(null))
          .finally(() => setMatchLoading(false));
      }
    }
  }, [open, itemName]);

  const stockEnough = stockMatch && stockMatch.quantity >= orderQty;

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <User size={16} className="text-[#256984]" />
            Who prepared this?
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Marking <span className="font-semibold text-foreground">{itemName}</span> as done.
        </p>

        {/* Side-by-side: Made from prep on hand + Items not made */}
        <div className="grid grid-cols-2 gap-3">
          {/* Made from prep on hand */}
          <div className={cn(
            "rounded-lg border px-3 py-2.5 space-y-1.5 transition-colors cursor-pointer",
            useFromStock ? "border-[#256984] bg-[#256984]/8" : "border-border bg-muted/30"
          )} onClick={() => setUseFromStock(v => !v)}>
            <div className="flex items-center gap-2.5 text-sm font-medium">
              <div className={cn(
                "w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors",
                useFromStock ? "border-[#256984] bg-[#256984]" : "border-muted-foreground"
              )}>
                {useFromStock && <Check size={10} className="text-white" strokeWidth={3} />}
              </div>
              <span className={useFromStock ? "text-[#256984]" : ""}>Made from prep on hand?</span>
            </div>
            <div className="ml-6 text-xs">
              {matchLoading ? (
                <span className="flex items-center gap-1 text-muted-foreground"><Loader2 size={10} className="animate-spin" /> Checking...</span>
              ) : stockMatch ? (
                <span className={cn("flex items-center gap-1", stockEnough ? "text-green-700" : "text-amber-700")}>
                  <Package size={10} />
                  {stockMatch.quantity} {stockMatch.unit} in stock
                  {!stockEnough && <span className="text-amber-600"> (need {orderQty})</span>}
                </span>
              ) : (
                <span className="text-muted-foreground">No stock found</span>
              )}
            </div>
          </div>

          {/* Items not made */}
          <div className={cn(
            "rounded-lg border-2 px-3 py-2.5 transition-colors cursor-pointer",
            itemsNotMade ? "border-red-500 bg-red-50" : "border-red-300 bg-muted/30"
          )}
            onClick={() => setItemsNotMade(v => !v)}
          >
            <div className="flex items-center gap-2.5 text-sm font-medium">
              <div className={cn(
                "w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors",
                itemsNotMade ? "border-red-500 bg-red-500" : "border-red-400"
              )}>
                {itemsNotMade && <Check size={10} className="text-white" strokeWidth={3} />}
              </div>
              <span className={itemsNotMade ? "text-red-700 font-semibold" : "text-red-600"}>Items not made</span>
            </div>
            {itemsNotMade && (
              <p className="text-xs text-red-500 ml-6 mt-1">Log how many were missing next.</p>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Select staff member on shift:</p>
          {staff.length > 0 ? (
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {staff.map(s => (
                <button
                  key={s.id}
                  onClick={() => setSelectedId(s.id.toString())}
                  className={cn(
                    "w-full flex items-center gap-2 px-3 py-2 rounded-lg border text-sm text-left transition-all",
                    selectedId === s.id.toString()
                      ? "border-[#256984] bg-[#256984]/10 text-[#256984] font-medium"
                      : "border-border bg-card hover:bg-muted/40"
                  )}
                >
                  <div className={cn(
                    "w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0",
                    selectedId === s.id.toString() ? "border-[#256984] bg-[#256984]" : "border-muted-foreground"
                  )}>
                    {selectedId === s.id.toString() && <Check size={10} className="text-white" strokeWidth={3} />}
                  </div>
                  {s.name}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground italic">No staff on roster today</p>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button
            size="sm"
            className={itemsNotMade ? "bg-orange-500 hover:bg-orange-600 text-white" : "bg-[#256984] hover:bg-[#1e5570] text-white"}
            disabled={!selectedId && staff.length > 0}
            onClick={() => {
              if (selectedId) {
                const emp = staff.find(s => s.id.toString() === selectedId);
                if (emp) onSelect(emp.id, emp.name, useFromStock, stockMatch?.id, itemsNotMade);
              } else {
                onSelect(0, "Unknown", useFromStock, stockMatch?.id, itemsNotMade);
              }
            }}
          >
            {itemsNotMade ? "Next: Log Missing" : "Confirm"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Merge Conflict Dialog ─────────────────────────────────────────────────────
function MergeConflictDialog({ conflicts, onMakeNow, onAddToList, onDismiss }: {
  conflicts: MergeConflict[];
  onMakeNow: (taskId: number, totalQty: number) => void;
  onAddToList: (taskId: number, newQty: number) => void;
  onDismiss: () => void;
}) {
  if (conflicts.length === 0) return null;
  const c = conflicts[0]; // Show one at a time

  return (
    <Dialog open={true} onOpenChange={v => { if (!v) onDismiss(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base text-amber-700">
            <AlertCircle size={16} />
            New Order While Prepping
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            A new order just came in that needs{" "}
            <span className="font-semibold text-foreground">{fmtQty(c.newQty)}</span>{" "}
            more of <span className="font-semibold text-foreground">{c.taskName}</span>.
          </p>
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm">
            <p className="text-amber-800">
              Currently making: <span className="font-bold">{fmtQty(c.existingQty)}</span>
            </p>
            <p className="text-amber-800">
              Additional needed: <span className="font-bold">{fmtQty(c.newQty)}</span>
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <Button
              className="bg-[#256984] hover:bg-[#1e5570] text-white w-full gap-2"
              onClick={() => onMakeNow(c.taskId, c.totalQty)}
            >
              <ChefHat size={14} />
              Make {fmtQty(c.totalQty)} {c.taskName} now
            </Button>
            <Button
              variant="outline"
              className="w-full gap-2"
              onClick={() => onAddToList(c.taskId, c.newQty)}
            >
              <Plus size={14} />
              Add {fmtQty(c.newQty)} to prep list separately
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Mark Complete Dialog ─────────────────────────────────────────────────────
function MarkCompleteDialog({ open, customerName, onConfirm, onDismiss }: {
  open: boolean;
  customerName: string;
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onDismiss(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <CheckCircle2 size={16} className="text-[#256984]" />
            All items checked off
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          All products for <span className="font-semibold text-foreground">{customerName}</span> have been ticked off.
          Mark this order as complete?
        </p>
        <p className="text-xs text-muted-foreground bg-muted/50 rounded-lg px-3 py-2">
          The order will be hidden from the list. You can still view it by enabling "Show completed" in the status legend.
        </p>
        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={onDismiss}>Not yet</Button>
          <Button
            size="sm"
            className="bg-[#256984] hover:bg-[#1e5570] text-white gap-1.5"
            onClick={onConfirm}
          >
            <CheckCircle2 size={13} /> Mark as Complete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Grey Box Dialog ────────────────────────────────────────────────────────
function GreyBoxDialog({ open, customerName, deliveryDate, onConfirm, onDismiss }: {
  open: boolean;
  customerName: string;
  deliveryDate: string;
  onConfirm: (boxCount: number) => void;
  onDismiss: () => void;
}) {
  const [count, setCount] = useState(1);
  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onDismiss(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Package size={16} className="text-[#256984]" />
            Grey Box Log
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          How many grey boxes were packed for <span className="font-semibold text-foreground">{customerName}</span>?
        </p>
        <div className="flex items-center gap-3 py-1">
          <Button
            variant="outline"
            size="sm"
            className="h-9 w-9 p-0 text-lg"
            onClick={() => setCount(c => Math.max(0, c - 1))}
          >−</Button>
          <span className="text-2xl font-semibold w-10 text-center">{count}</span>
          <Button
            variant="outline"
            size="sm"
            className="h-9 w-9 p-0 text-lg"
            onClick={() => setCount(c => c + 1)}
          >+</Button>
          <input
            type="number"
            min={0}
            value={count}
            onChange={e => setCount(Math.max(0, parseInt(e.target.value) || 0))}
            className="ml-2 w-16 border rounded-md px-2 py-1 text-sm text-center"
          />
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={onDismiss}>Skip</Button>
          <Button
            size="sm"
            className="bg-[#256984] hover:bg-[#1e5570] text-white gap-1.5"
            onClick={() => { onConfirm(count); setCount(1); }}
          >
            <Package size={13} /> Log Boxes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Missing Items Dialog ───────────────────────────────────────────────────
interface MissingItemResult {
  qtyMissing: number;
  qtyMade: number;
  reasonType: "ingredient" | "other";
  reasonIngredient?: string;
  reasonOther?: string;
}
function MissingItemsDialog({ open, itemName, totalRequired, staffName, onConfirm, onDismiss }: {
  open: boolean;
  itemName: string;
  totalRequired: number;
  staffName: string;
  onConfirm: (result: MissingItemResult) => void;
  onDismiss: () => void;
}) {
  const [qtyMissing, setQtyMissing] = useState(1);
  const [reasonType, setReasonType] = useState<"ingredient" | "other">("ingredient");
  const [ingredientSearch, setIngredientSearch] = useState("");
  const [selectedIngredient, setSelectedIngredient] = useState("");
  const [otherReason, setOtherReason] = useState("");
  const [ingredients, setIngredients] = useState<{ id: number; name: string }[]>([]);
  const [ingOpen, setIngOpen] = useState(false);

  useEffect(() => {
    if (open) {
      setQtyMissing(Math.min(1, totalRequired));
      setReasonType("ingredient");
      setIngredientSearch("");
      setSelectedIngredient("");
      setOtherReason("");
      // Load ingredients list
      fetch(`${API_BASE}/api/ingredients`)
        .then(r => r.json())
        .then(d => setIngredients((d || []).map((i: any) => ({ id: i.id, name: i.name }))))
        .catch(() => {});
    }
  }, [open, totalRequired]);

  const qtyMade = Math.max(0, totalRequired - qtyMissing);
  const allMissing = qtyMissing >= totalRequired;
  const filteredIngs = ingredients.filter(i =>
    i.name.toLowerCase().includes(ingredientSearch.toLowerCase())
  ).slice(0, 20);

  const canConfirm = qtyMissing > 0 && (
    reasonType === "ingredient" ? selectedIngredient.length > 0 : otherReason.trim().length > 0
  );

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onDismiss(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <AlertTriangle size={16} className="text-orange-500" />
            Items Not Made
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">{itemName}</span> — logged by {staffName}
        </p>

        {/* Quantity missing input */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">How many were <span className="text-red-600 font-semibold">NOT made</span>? (required: {totalRequired})</p>
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" className="h-9 w-9 p-0 text-lg"
              onClick={() => setQtyMissing(q => Math.max(1, q - 1))}>−</Button>
            <span className="text-2xl font-semibold w-10 text-center text-red-600">{qtyMissing}</span>
            <Button variant="outline" size="sm" className="h-9 w-9 p-0 text-lg"
              onClick={() => setQtyMissing(q => Math.min(totalRequired, q + 1))}>+</Button>
            <input type="number" min={1} max={totalRequired} value={qtyMissing}
              onChange={e => setQtyMissing(Math.min(totalRequired, Math.max(1, parseInt(e.target.value) || 1)))}
              className="ml-1 w-14 border rounded-md px-2 py-1 text-sm text-center" />
          </div>
          <div className={cn(
            "text-xs font-medium px-2.5 py-1.5 rounded-md",
            allMissing ? "bg-red-50 text-red-700 border border-red-200" : "bg-orange-50 text-orange-700 border border-orange-200"
          )}>
            {allMissing
              ? `⚠️ All ${totalRequired} items missing — none made`
              : `✓ ${qtyMade} made · ${qtyMissing} missing`}
          </div>
        </div>

        {/* Reason */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Reason:</p>
          <div className="flex gap-2">
            <button onClick={() => setReasonType("ingredient")}
              className={cn("flex-1 text-xs py-2 px-3 rounded-lg border font-medium transition-all",
                reasonType === "ingredient" ? "border-[#256984] bg-[#256984]/10 text-[#256984]" : "border-border bg-card hover:bg-muted/40")}>
              Ingredient out of stock
            </button>
            <button onClick={() => setReasonType("other")}
              className={cn("flex-1 text-xs py-2 px-3 rounded-lg border font-medium transition-all",
                reasonType === "other" ? "border-[#256984] bg-[#256984]/10 text-[#256984]" : "border-border bg-card hover:bg-muted/40")}>
              Other
            </button>
          </div>

          {reasonType === "ingredient" && (
            <div className="relative">
              <input
                type="text"
                placeholder="Search ingredients..."
                value={selectedIngredient || ingredientSearch}
                onChange={e => { setIngredientSearch(e.target.value); setSelectedIngredient(""); setIngOpen(true); }}
                onFocus={() => setIngOpen(true)}
                className="w-full border rounded-md px-3 py-1.5 text-sm"
              />
              {ingOpen && filteredIngs.length > 0 && (
                <div className="absolute z-50 mt-1 w-full bg-white border rounded-lg shadow-lg max-h-40 overflow-y-auto">
                  {filteredIngs.map(i => (
                    <button key={i.id}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-muted/40"
                      onClick={() => { setSelectedIngredient(i.name); setIngredientSearch(""); setIngOpen(false); }}
                    >{i.name}</button>
                  ))}
                </div>
              )}
              {selectedIngredient && (
                <p className="text-xs text-[#256984] mt-1 font-medium">✓ {selectedIngredient}</p>
              )}
            </div>
          )}

          {reasonType === "other" && (
            <textarea
              rows={2}
              placeholder="Describe the reason..."
              value={otherReason}
              onChange={e => setOtherReason(e.target.value)}
              className="w-full border rounded-md px-3 py-1.5 text-sm resize-none"
            />
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={onDismiss}>Cancel</Button>
          <Button
            size="sm"
            disabled={!canConfirm}
            className="bg-orange-500 hover:bg-orange-600 text-white gap-1.5"
            onClick={() => onConfirm({
              qtyMissing,
              qtyMade,
              reasonType,
              reasonIngredient: reasonType === "ingredient" ? selectedIngredient : undefined,
              reasonOther: reasonType === "other" ? otherReason : undefined,
            })}
          >
            <AlertTriangle size={13} /> Log Missing Items
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Order Card ───────────────────────────────────────────────────────────────
function OrderCard({ order, state, staff, onStateChange, onMarkComplete, isComplete, onStockDeducted }: {
  order: FlexOrder;
  state: OrderState;
  staff: StaffMember[];
  onStateChange: (id: number, patch: Partial<OrderState>) => void;
  onMarkComplete: (id: number, itemCount: number) => void;
  isComplete: boolean;
  onStockDeducted?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [markCompleteOpen, setMarkCompleteOpen] = useState(false);
  const [greyBoxOpen, setGreyBoxOpen] = useState(false);
  // Staff picker state
  const [staffPickerOpen, setStaffPickerOpen] = useState(false);
  const [pendingItemUuid, setPendingItemUuid] = useState<string | null>(null);
  // Missing items flow
  const [missingItemsOpen, setMissingItemsOpen] = useState(false);
  const [pendingMissingStaff, setPendingMissingStaff] = useState<{ id: number; name: string } | null>(null);
  // Always-fresh ref to state prop — prevents stale closure reads in async handlers
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);

  const colour = isComplete ? orderColour("complete") : orderColour(state.prepStatus || "new");
  const customerName = order.company || `${order.first_name} ${order.last_name}`.trim();
  const tickableItems = getTickableItems(order);
  const checkedCount = tickableItems.filter(i => state.checkedItems[i.uuid]?.checked).length;

  const handleExpand = () => {
    if (!expanded) {
      const patch: Partial<OrderState> = {};
      if (!state.viewed) patch.viewed = true;
      if (state.prepStatus === "new") patch.prepStatus = "not_started";
      if (state.prepStatus === "edited") patch.prepStatus = "in_progress";
      if (Object.keys(patch).length > 0) onStateChange(order.id, patch);
    }
    setExpanded(e => !e);
  };

  const [unconfirmUuid, setUnconfirmUuid] = useState<string | null>(null);

  const doUncheck = (uuid: string) => {
    const newChecked: Record<string, CheckedItemState> = { ...stateRef.current.checkedItems, [uuid]: { checked: false } };
    const checkedQty = tickableItems.filter(i => newChecked[i.uuid]?.checked).length;
    const total = tickableItems.length;
    const newStatus = checkedQty === 0 ? "not_started" : checkedQty === total ? "done" : "in_progress";
    // If the order was marked complete, reset it back to in_progress
    const wasComplete = isComplete || state.isComplete;
    onStateChange(order.id, {
      checkedItems: newChecked,
      prepStatus: wasComplete ? "in_progress" : newStatus,
      ...(wasComplete ? { isComplete: false } : {}),
    });
    setUnconfirmUuid(null);
  };

  // When an item is clicked: if unchecked → open staff picker; if checked → confirm before unchecking
  const handleItemClick = (uuid: string) => {
    const currentlyChecked = !!state.checkedItems[uuid]?.checked;
    if (currentlyChecked) {
      setUnconfirmUuid(uuid);
    } else {
      setPendingItemUuid(uuid);
      setStaffPickerOpen(true);
    }
  };

  const handleStaffSelected = (staffId: number, staffName: string, useFromStock: boolean, stockItemId?: number, isMissing?: boolean) => {
    if (!pendingItemUuid) return;
    // For sub-items (combo), find the parent item for stock/log purposes
    const isSubItem = pendingItemUuid.includes('__sub__');
    const parentUuid = isSubItem ? pendingItemUuid.split('__sub__')[0] : pendingItemUuid;
    const pendingItemObj = order.items.find(i => i.uuid === parentUuid);
    // For sub-items look up the tickable item name
    const pendingTickable = tickableItems.find(t => t.uuid === pendingItemUuid);

    // If "Items not made" was checked, open the missing items dialog instead of completing
    if (isMissing) {
      setStaffPickerOpen(false);
      setPendingMissingStaff({ id: staffId, name: staffName });
      setTimeout(() => setMissingItemsOpen(true), 150);
      return;
    }

    const newChecked: Record<string, CheckedItemState> = {
      ...stateRef.current.checkedItems,
      [pendingItemUuid]: { checked: true, staffId, staffName, checkedAt: new Date().toISOString() }
    };
    const checkedQty = tickableItems.filter(i => newChecked[i.uuid]?.checked).length;
    const total = tickableItems.length;
    const allDone = checkedQty === total;
    const newStatus = checkedQty === 0 ? "not_started" : allDone ? "done" : "in_progress";
    onStateChange(order.id, { checkedItems: newChecked, prepStatus: newStatus });
    setStaffPickerOpen(false);
    setPendingItemUuid(null);
    // Log this tick-off to the production report
    if (pendingItemObj || pendingTickable) {
      const orderDate = order.delivery_datetime ? order.delivery_datetime.slice(0, 10) : new Date().toISOString().slice(0, 10);
      fetch(`${API_BASE}/api/order-tick-log`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemName: pendingTickable?.name ?? pendingItemObj?.name ?? '',
          quantity: pendingTickable?.quantity ?? pendingItemObj?.quantity ?? 1,
          staffName,
          staffId: staffId || null,
          orderId: order.id,
          orderDate,
          fromStock: useFromStock,
        }),
      }).catch(() => {});
    }
    // Deduct from stock on hand if requested
    if (useFromStock && stockItemId && pendingItemObj) {
      fetch(`${API_BASE}/api/stock-on-hand/deduct`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: stockItemId, quantity: pendingItemObj.quantity }),
      }).then(() => { onStockDeducted?.(); }).catch(() => { onStockDeducted?.(); });
    }
    // Trigger mark-complete popup when last item is checked off
    if (allDone) {
      setTimeout(() => setMarkCompleteOpen(true), 300);
    }
  };

  // For the staff picker dialog: use the tickable item name (handles sub-items)
  const pendingTickableItem = pendingItemUuid ? tickableItems.find(t => t.uuid === pendingItemUuid) : undefined;
  const pendingItem = pendingItemUuid ? order.items.find(i => i.uuid === (pendingItemUuid.includes('__sub__') ? pendingItemUuid.split('__sub__')[0] : pendingItemUuid)) : undefined;
  const pendingTotalRequired = pendingTickableItem?.quantity ?? Number(pendingItem?.quantity) ?? 1;
  const pendingItemName = pendingTickableItem?.name ?? pendingItem?.name ?? "item";

  const handleMissingConfirm = async (result: MissingItemResult) => {
    if (!pendingItemUuid || !pendingMissingStaff) return;
    setMissingItemsOpen(false);
    const deliveryDate = order.delivery_datetime ? order.delivery_datetime.slice(0, 10) : new Date().toISOString().slice(0, 10);
    // Mark the item as checked (partially) with missing info — use stateRef for freshest checkedItems
    const newChecked: Record<string, CheckedItemState> = {
      ...stateRef.current.checkedItems,
      [pendingItemUuid]: {
        checked: true,
        staffId: pendingMissingStaff.id,
        staffName: pendingMissingStaff.name,
        checkedAt: new Date().toISOString(),
        isMissing: true,
        qtyMissing: result.qtyMissing,
        qtyMade: result.qtyMade,
        totalRequired: pendingTotalRequired,
        reasonType: result.reasonType,
        reasonIngredient: result.reasonIngredient,
        reasonOther: result.reasonOther,
      },
    };
    const checkedQty = tickableItems.filter(i => newChecked[i.uuid]?.checked).length;
    const total = tickableItems.length;
    const newStatus = checkedQty === 0 ? "not_started" : checkedQty === total ? "done" : "in_progress";
    const hasMissing = Object.values(newChecked).some(c => c.isMissing);
    onStateChange(order.id, { checkedItems: newChecked, prepStatus: newStatus, hasMissing });
    setPendingItemUuid(null);
    setPendingMissingStaff(null);
    // Log to missing_items_log table
    try {
      await fetch(`${API_BASE}/api/missing-items/log`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          order_id: order.id,
          item_uuid: pendingItemUuid,
          item_name: pendingItemName,
          order_date: deliveryDate,
          total_required: pendingTotalRequired,
          qty_missing: result.qtyMissing,
          qty_made: result.qtyMade,
          staff_id: pendingMissingStaff.id,
          staff_name: pendingMissingStaff.name,
          reason_type: result.reasonType,
          reason_ingredient: result.reasonIngredient || null,
          reason_other: result.reasonOther || null,
        }),
      });
    } catch (_) {}
    // Log the made quantity to production report (as partial production)
    if (result.qtyMade > 0) {
      try {
        await fetch(`${API_BASE}/api/order-tick-log`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            itemName: pendingItemName,
            quantity: result.qtyMade,
            staffName: pendingMissingStaff.name,
            staffId: pendingMissingStaff.id,
            orderId: order.id,
            orderDate: deliveryDate,
          }),
        });
      } catch (_) {}
    }
    // Log the missing quantity as a separate 'missing' entry
    try {
      await fetch(`${API_BASE}/api/order-tick-log`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemName: pendingItemName,
          quantity: result.qtyMissing,
          staffName: "Items Missing",
          staffId: null,
          orderId: order.id,
          orderDate: deliveryDate,
          notes: result.reasonType === "ingredient"
            ? `Out of stock: ${result.reasonIngredient}`
            : result.reasonOther,
          item_type: "missing",
        }),
      });
    } catch (_) {}
    // Trigger mark-complete popup if this was the last item
    if (checkedQty === total) {
      setTimeout(() => setMarkCompleteOpen(true), 300);
    }
  };

  const handleConfirmComplete = () => {
    setMarkCompleteOpen(false);
    onMarkComplete(order.id, tickableItems.length);
    // Only show grey box dialog for wholesale orders
    if (order.is_wholesale) {
      setTimeout(() => setGreyBoxOpen(true), 200);
    }
  };

  const handleGreyBoxConfirm = async (boxCount: number) => {
    setGreyBoxOpen(false);
    const deliveryDate = order.delivery_datetime ? order.delivery_datetime.slice(0, 10) : new Date().toISOString().slice(0, 10);
    try {
      await fetch(`${API_BASE}/api/grey-box/log`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          order_id: order.id,
          customer_name: customerName,
          customer_uuid: order.customer_uuid || null,
          delivery_date: deliveryDate,
          boxes_out: boxCount,
          boxes_in: 0,
          logged_by: null,
        }),
      });
    } catch (_) {}
  };

  return (
    <>
      <StaffPickerDialog
        open={staffPickerOpen}
        onClose={() => { setStaffPickerOpen(false); setPendingItemUuid(null); }}
        staff={staff}
        onSelect={handleStaffSelected}
        itemName={pendingTickableItem?.name ?? pendingItem?.name ?? "item"}
        orderQty={pendingTickableItem?.quantity ?? Number(pendingItem?.quantity) ?? 1}
      />
      <MarkCompleteDialog
        open={markCompleteOpen}
        customerName={customerName}
        onConfirm={handleConfirmComplete}
        onDismiss={() => setMarkCompleteOpen(false)}
      />
      <GreyBoxDialog
        open={greyBoxOpen}
        customerName={customerName}
        deliveryDate={order.delivery_datetime ? order.delivery_datetime.slice(0, 10) : new Date().toISOString().slice(0, 10)}
        onConfirm={handleGreyBoxConfirm}
        onDismiss={() => setGreyBoxOpen(false)}
      />
      <MissingItemsDialog
        open={missingItemsOpen}
        itemName={pendingItemName}
        totalRequired={pendingTotalRequired}
        staffName={pendingMissingStaff?.name ?? ""}
        onConfirm={handleMissingConfirm}
        onDismiss={() => { setMissingItemsOpen(false); setPendingMissingStaff(null); setPendingItemUuid(null); }}
      />

      {/* Uncheck confirmation dialog */}
      <Dialog open={!!unconfirmUuid} onOpenChange={v => { if (!v) setUnconfirmUuid(null); }}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle className="text-base">Untick item?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Are you sure you want to mark <span className="font-semibold text-foreground">"{order.items.find(i => i.uuid === unconfirmUuid)?.name ?? "this item"}"</span> as not done?
          </p>
          <DialogFooter className="gap-2 mt-2">
            <Button variant="outline" size="sm" onClick={() => setUnconfirmUuid(null)}>Cancel</Button>
            <Button variant="destructive" size="sm" onClick={() => unconfirmUuid && doUncheck(unconfirmUuid)}>Yes, untick</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className={cn("rounded-xl border-2 overflow-hidden transition-all", colour.border, colour.bg)}>
        {/* Header */}
        <button
          className="w-full flex items-center gap-3 px-4 py-3 text-left"
          onClick={handleExpand}
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-foreground truncate">{customerName}</span>
              <span className="text-xs text-muted-foreground font-bold">#{order.id}</span>
              {order.is_wholesale && (
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-[#256984]/12 text-[#256984] border border-[#256984]/25">
                  <Store size={9} /> Wholesale
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Clock size={11} /> {order.delivery_datetime ? fmtDateTime(order.delivery_datetime) : "No delivery time"}
              </span>
              {order.dispatch_datetime && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  · Dispatch {fmtTimeOnly(order.dispatch_datetime)}
                </span>
              )}
              <span className="text-xs text-muted-foreground">
                {checkedCount}/{tickableItems.length} items
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {state.hasMissing && (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-red-100 text-red-700 border border-red-300">
                <AlertTriangle size={9} /> Missing
              </span>
            )}
            <Badge className={cn("text-xs", colour.badge)}>{colour.label}</Badge>
          </div>
          {expanded ? <ChevronUp size={16} className="shrink-0 text-muted-foreground" /> : <ChevronDown size={16} className="shrink-0 text-muted-foreground" />}
        </button>

        {/* Missing items warning banner — shown when expanded */}
        {expanded && state.hasMissing && (
          <div className="border-t border-red-200 bg-red-50 px-4 py-2 flex items-start gap-2">
            <AlertTriangle size={14} className="text-red-600 shrink-0 mt-0.5" />
            <div className="text-xs text-red-700">
              <span className="font-semibold">Items missing from this order — </span>
              {Object.entries(state.checkedItems)
                .filter(([, v]) => v.isMissing)
                .map(([, v]) => `${v.qtyMissing ?? 0}× ${tickableItems.find(t => t.uuid === Object.keys(state.checkedItems).find(k => state.checkedItems[k] === v))?.name ?? ''}`)
                .join(", ") || "see items below"}
            </div>
          </div>
        )}

        {/* Items */}
        {expanded && (
          <div className="border-t border-border/50 px-4 pb-3 pt-2 space-y-1.5 bg-white/60 dark:bg-black/10">
            {/* Order-level notes — internal, delivery, general */}
            {order.internal_notes && (
              <div className="flex gap-1.5 items-start text-xs text-blue-800 bg-blue-50 border border-blue-200 rounded-lg px-2.5 py-1.5">
                <span className="font-bold shrink-0 mt-0.5">Internal:</span>
                <span className="whitespace-pre-line">{order.internal_notes}</span>
              </div>
            )}
            {order.delivery_notes && (
              <div className="flex gap-1.5 items-start text-xs text-blue-800 bg-blue-50 border border-blue-200 rounded-lg px-2.5 py-1.5">
                <span className="font-bold shrink-0 mt-0.5">Delivery:</span>
                <span className="whitespace-pre-line">{order.delivery_notes}</span>
              </div>
            )}
            {order.notes && (
              <div className="flex gap-1.5 items-start text-xs text-blue-800 bg-blue-50 border border-blue-200 rounded-lg px-2.5 py-1.5">
                <span className="font-bold shrink-0 mt-0.5">Order note:</span>
                <span className="whitespace-pre-line">{order.notes}</span>
              </div>
            )}
            {(order.items ?? []).map(item => {
              const combos = (item.combo_options || []).filter(co => co.items.length > 0);
              const isCombo = combos.length > 0;

              if (isCombo) {
                // Parent item is now a clickable tick row (like a standard item)
                // Sub-items (combo options / modifiers) are indented below
                const parentState = state.checkedItems[item.uuid];
                const parentChecked = !!parentState?.checked;
                const parentMissing = parentChecked && !!parentState?.isMissing;
                const parentAllMissing = parentMissing && (parentState?.qtyMade ?? 0) === 0;
                return (
                  <div key={item.uuid} className="space-y-0.5">
                    {/* Parent row — fully tickable */}
                    <button
                      onClick={() => handleItemClick(item.uuid)}
                      className={cn(
                        "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-all border",
                        !parentChecked
                          ? "bg-white dark:bg-card border-border hover:bg-muted/40"
                          : parentAllMissing ? "bg-red-50 border-red-300"
                          : parentMissing ? "bg-orange-50 border-orange-300"
                          : "bg-green-100 border-green-300 dark:bg-green-950/30"
                      )}
                    >
                      <div className={cn(
                        "w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-all",
                        !parentChecked ? "border-muted-foreground"
                        : parentAllMissing ? "bg-red-600 border-red-600"
                        : parentMissing ? "bg-orange-500 border-orange-500"
                        : "bg-green-600 border-green-600"
                      )}>
                        {parentChecked && <Check size={12} className="text-white" strokeWidth={3} />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className={cn(
                          "text-sm font-semibold",
                          !parentChecked ? "text-[#256984]" : "line-through text-muted-foreground"
                        )}>
                          {item.name}
                        </span>
                        {item.attributes_summary && (
                          <span className="text-xs text-muted-foreground ml-1.5">({item.attributes_summary})</span>
                        )}
                        <span className="text-sm font-bold text-[#256984] ml-1.5">×{item.quantity}</span>
                        {parentChecked && parentState?.staffName && (
                          <span className="text-xs text-green-700 ml-1.5 font-medium">
                            ✓ {parentState.staffName}
                            {parentState.checkedAt && (
                              <span className="text-green-600 font-normal ml-1">
                                · {new Date(parentState.checkedAt).toLocaleString("en-AU", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short", hour12: true })}
                              </span>
                            )}
                          </span>
                        )}
                      </div>
                    </button>
                    {/* Sub-item rows (combo options / modifiers) — indented */}
                    {combos.map((co, oi) =>
                      co.items.map((ci, ii) => {
                        const subUuid = `${item.uuid}__sub__${oi}_${ii}`;
                        const subState = state.checkedItems[subUuid];
                        const subChecked = !!subState?.checked;
                        const subMissing = subChecked && !!subState?.isMissing;
                        const subAllMissing = subMissing && (subState?.qtyMade ?? 0) === 0;
                        return (
                          <button
                            key={subUuid}
                            onClick={() => handleItemClick(subUuid)}
                            className={cn(
                              "w-full flex items-center gap-3 pl-8 pr-3 py-1.5 rounded-lg text-left transition-all border",
                              !subChecked ? "bg-white dark:bg-card border-border hover:bg-muted/40"
                              : subAllMissing ? "bg-red-50 border-red-300"
                              : subMissing ? "bg-orange-50 border-orange-300"
                              : "bg-green-100 border-green-300 dark:bg-green-950/30"
                            )}
                          >
                            <div className={cn(
                              "w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-all",
                              !subChecked ? "border-muted-foreground"
                              : subAllMissing ? "bg-red-600 border-red-600"
                              : subMissing ? "bg-orange-500 border-orange-500"
                              : "bg-green-600 border-green-600"
                            )}>
                              {subChecked && <Check size={10} className="text-white" strokeWidth={3} />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <span className={cn("text-xs font-medium", subChecked && "line-through text-muted-foreground")}>
                                {ci.name}
                              </span>
                              <span className="text-xs text-muted-foreground ml-1.5 italic">{co.name}</span>
                              {subChecked && subState?.staffName && (
                                <span className="text-xs text-green-700 ml-1.5 font-medium">
                                  ✓ {subState.staffName}
                                  {subState.checkedAt && (
                                    <span className="text-green-600 font-normal ml-1">
                                      · {new Date(subState.checkedAt).toLocaleString("en-AU", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short", hour12: true })}
                                    </span>
                                  )}
                                </span>
                              )}
                            </div>
                          </button>
                        );
                      })
                    )}
                    {/* Item-level note */}
                    {item.notes && (
                      <p className="text-xs text-[#256984] bg-[#256984]/8 border border-[#256984]/20 rounded-md px-2.5 py-1 ml-8">
                        <span className="font-semibold">Item note:</span> {item.notes}
                      </p>
                    )}
                  </div>
                );
              }

              // Standard (non-combo) item
              const itemState = state.checkedItems[item.uuid];
              const checked = !!itemState?.checked;
              const isMissingItem = checked && !!itemState?.isMissing;
              const allMissingItem = isMissingItem && (itemState?.qtyMade ?? 0) === 0;
              return (
                <div key={item.uuid} className="space-y-0.5">
                  <button
                    onClick={() => handleItemClick(item.uuid)}
                    className={cn(
                      "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-all border",
                      !checked
                        ? "bg-white dark:bg-card border-border hover:bg-muted/40"
                        : allMissingItem
                        ? "bg-red-50 border-red-300"
                        : isMissingItem
                        ? "bg-orange-50 border-orange-300"
                        : "bg-green-100 border-green-300 dark:bg-green-950/30"
                    )}
                  >
                    <div className={cn(
                      "w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-all",
                      !checked ? "border-muted-foreground"
                      : allMissingItem ? "bg-red-600 border-red-600"
                      : isMissingItem ? "bg-orange-500 border-orange-500"
                      : "bg-green-600 border-green-600"
                    )}>
                      {checked && <Check size={12} className="text-white" strokeWidth={3} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className={cn("text-sm font-medium", checked && "line-through text-muted-foreground")}>
                        {item.name}
                      </span>
                      {item.attributes_summary && (
                        <span className="text-xs text-muted-foreground ml-1.5">({item.attributes_summary})</span>
                      )}
                      {checked && isMissingItem && (
                        <span className={cn("text-xs ml-1.5 font-semibold", allMissingItem ? "text-red-600" : "text-orange-600")}>
                          {allMissingItem ? `⚠️ All ${itemState.totalRequired} missing` : `⚠️ ${itemState.qtyMissing} of ${itemState.totalRequired} missing`}
                          {itemState.reasonIngredient && <span className="font-normal"> · {itemState.reasonIngredient}</span>}
                          {itemState.reasonOther && <span className="font-normal"> · {itemState.reasonOther}</span>}
                        </span>
                      )}
                      {checked && !isMissingItem && itemState?.staffName && (
                        <span className="text-xs text-green-700 ml-1.5 font-medium">
                          ✓ {itemState.staffName}
                          {itemState.checkedAt && (
                            <span className="text-green-600 font-normal ml-1">
                              · {new Date(itemState.checkedAt).toLocaleString("en-AU", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short", hour12: true })}
                            </span>
                          )}
                        </span>
                      )}
                      <span className="text-sm font-bold text-[#256984] ml-1.5">×{item.quantity}</span>
                    </div>
                  </button>
                  {/* Item-level note */}
                  {item.notes && (
                    <p className="text-xs text-[#256984] bg-[#256984]/8 border border-[#256984]/20 rounded-md px-2.5 py-1 ml-8">
                      <span className="font-semibold">Item note:</span> {item.notes}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

// ─── Prep Task Card ───────────────────────────────────────────────────────────
function PrepTaskCard({ task, staff, onAction }: {
  task: PrepTask;
  staff: StaffMember[];
  onAction: (id: number, action: string, extra?: any) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [qtyActual, setQtyActual] = useState("");
  const elapsed = useElapsed(task.startedAt, task.status === "in_progress");
  const isOver = task.status === "in_progress" && task.expectedMinutes && elapsed > task.expectedMinutes;

  const typeColour = {
    sub_recipe: "bg-[#FCCDE2] text-[#7a3050]",
    recipe:     "bg-[#256984]/15 text-[#256984]",
    flex_product: "bg-purple-100 text-purple-700",
  }[task.itemType];
  const typeLabel = { sub_recipe: "Prep", recipe: "Recipe", flex_product: "Product" }[task.itemType];

  const statusBg = {
    pending:     "border-border bg-card",
    in_progress: "border-orange-400 bg-orange-50 dark:bg-orange-950/20 shadow-md",
    done:        "border-green-300 bg-green-50/60 dark:bg-green-950/10 opacity-70",
    skipped:     "border-border opacity-40",
  }[task.status];

  return (
    <div className={cn("border-2 rounded-xl overflow-hidden transition-all", statusBg)}>
      <button className="w-full flex items-center gap-3 px-4 py-3 text-left" onClick={() => setExpanded(e => !e)}>
        <span className={cn("text-xs font-semibold px-2 py-0.5 rounded-full shrink-0", typeColour)}>{typeLabel}</span>
        <span className="font-semibold text-foreground flex-1 truncate">{task.itemName}</span>
        <span className="text-sm font-bold text-[#256984] shrink-0">×{fmtQty(task.quantityRequired)}</span>

        {task.status === "in_progress" && (
          <span className={cn("text-xs font-mono px-2 py-0.5 rounded-full shrink-0", isOver ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700")}>
            {fmtMins(elapsed)} / {fmtMins(task.expectedMinutes)}
          </span>
        )}
        {task.status === "done" && task.actualMinutes != null && (
          <span className="text-xs text-muted-foreground shrink-0">{fmtMins(task.actualMinutes)}</span>
        )}
        {task.status === "pending" && task.expectedMinutes != null && (
          <span className="text-xs text-muted-foreground shrink-0">{fmtMins(task.expectedMinutes)}</span>
        )}

        {task.assignedName && task.status !== "done" && (
          <span className="hidden sm:inline text-xs bg-muted px-2 py-0.5 rounded-full shrink-0 max-w-[90px] truncate">{task.assignedName.split(" ")[0]}</span>
        )}
        {expanded ? <ChevronUp size={15} className="shrink-0 text-muted-foreground" /> : <ChevronDown size={15} className="shrink-0 text-muted-foreground" />}
      </button>

      {expanded && (
        <div className="border-t border-border/50 px-4 pb-4 pt-3 bg-white/50 dark:bg-black/10 space-y-3">
          {/* For orders */}
          {task.forOrders?.length > 0 && (
            <div>
              <p className="text-xs text-muted-foreground mb-1 font-medium">Needed for:</p>
              <div className="flex flex-wrap gap-1">
                {task.forOrders.map((o, i) => (
                  <span key={i} className="text-xs bg-[#256984]/10 text-[#256984] px-2 py-0.5 rounded-full">{o}</span>
                ))}
              </div>
            </div>
          )}

          {/* Assign */}
          {task.status !== "done" && task.status !== "skipped" && (
            <div>
              <p className="text-xs text-muted-foreground mb-1 font-medium">Assigned to:</p>
              <Select
                value={task.assignedTo?.toString() ?? ""}
                onValueChange={val => {
                  const emp = staff.find(s => s.id.toString() === val);
                  onAction(task.id, "assign", { assignedTo: parseInt(val), assignedName: emp?.name ?? val });
                }}
              >
                <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Assign staff member" /></SelectTrigger>
                <SelectContent>
                  {staff.map(s => <SelectItem key={s.id} value={s.id.toString()}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Time summary */}
          {task.expectedMinutes != null && task.expectedMinutes > 0 && (
            <p className="text-xs text-muted-foreground">Max time: <span className="font-semibold text-foreground">{fmtMins(task.expectedMinutes)}</span></p>
          )}

          {/* Actions */}
          <div className="flex flex-wrap gap-2">
            {task.status === "pending" && (
              <>
                <Button size="sm" className="bg-[#256984] hover:bg-[#1e5570] text-white gap-1" onClick={() => onAction(task.id, "start")}>
                  <Play size={12} /> Start
                </Button>
                <Button size="sm" variant="outline" className="gap-1" onClick={() => onAction(task.id, "skip")}>
                  <SkipForward size={12} /> Skip
                </Button>
              </>
            )}
            {task.status === "in_progress" && !finishing && (
              <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white gap-1"
                onClick={() => { setFinishing(true); setQtyActual(task.quantityRequired.toString()); }}>
                <CheckCircle2 size={12} /> Finish
              </Button>
            )}
            {task.status === "in_progress" && finishing && (
              <div className="flex items-center gap-2 flex-wrap">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Qty made:</p>
                  <Input type="number" value={qtyActual} onChange={e => setQtyActual(e.target.value)} className="h-8 w-20 text-sm" />
                </div>
                <div className="flex gap-2 items-end pb-0.5">
                  <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white gap-1"
                    onClick={() => { onAction(task.id, "finish", { quantityActual: parseFloat(qtyActual) || task.quantityRequired }); setFinishing(false); }}>
                    <CheckCircle2 size={12} /> Confirm
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setFinishing(false)}><X size={12} /></Button>
                </div>
              </div>
            )}
            {(task.status === "done" || task.status === "skipped") && (
              <Button size="sm" variant="outline" className="gap-1 text-xs" onClick={() => onAction(task.id, "reset")}>
                <RotateCcw size={11} /> Undo
              </Button>
            )}
          </div>

          {/* Done summary */}
          {task.status === "done" && (
            <div className="text-xs text-muted-foreground space-y-0.5">
              {task.quantityActual != null && <p>Made: <span className="font-semibold text-foreground">{task.quantityActual}</span></p>}
              {task.actualMinutes != null && (
                <p>Time: <span className="font-semibold text-foreground">{fmtMins(task.actualMinutes)}</span>
                  {task.expectedMinutes && task.actualMinutes > task.expectedMinutes
                    ? <span className="text-red-500 ml-1">(+{fmtMins(task.actualMinutes - task.expectedMinutes)} over)</span>
                    : task.expectedMinutes
                      ? <span className="text-green-600 ml-1">({fmtMins(task.expectedMinutes - task.actualMinutes)} under)</span>
                      : null}
                </p>
              )}
              {task.assignedName && <p>By: <span className="font-semibold text-foreground">{task.assignedName}</span></p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Log Form Types ───────────────────────────────────────────────────────────
const PREP_LOG_UNITS = ["kg", "g", "L", "ml", "each", "portion", "batch", "serve", "dozen", "pack"];

interface PrepLogEntry {
  id: number;
  loggedAt: string;
  itemType: string;
  itemId: number | null;
  itemName: string;
  quantity: number;
  unit: string;
  staffId: number | null;
  staffName: string;
  notes: string | null;
}

interface LogForm {
  itemValue: string; // "sub_recipe:123" or "recipe:456"
  itemName: string;
  itemType: string;
  itemId: number | null;
  quantity: string;
  unit: string;
  staffId: string;
  staffName: string;
  notes: string;
}

const DEFAULT_LOG_FORM: LogForm = {
  itemValue: "",
  itemName: "",
  itemType: "",
  itemId: null,
  quantity: "",
  unit: "kg",
  staffId: "",
  staffName: "",
  notes: "",
};

// ─── Main Page ─────────────────────────────────────────────────────────────────
export default function Prep() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [tab, setTab] = useState<"orders" | "prep" | "stock">("orders");
  // Prep tab controls
  const [prepMode, setPrepMode] = useState<"total" | "remaining">("remaining");
  const [prepMobileTab, setPrepMobileTab] = useState<"subrecipes" | "recipes">("subrecipes");

  // Date range
  const [rangeMode, setRangeMode] = useState<"today" | "tomorrow" | "custom">("today");
  const [customFrom, setCustomFrom] = useState(today());
  const [customTo, setCustomTo]     = useState(today());

  const dateFrom = rangeMode === "today" ? today() : rangeMode === "tomorrow" ? tomorrow() : customFrom;
  const dateTo   = rangeMode === "today" ? today() : rangeMode === "tomorrow" ? tomorrow() : customTo;

  // Missing items banner state — auto-opens when date changes
  const [missingBannerOpen, setMissingBannerOpen] = useState(true);
  useEffect(() => { setMissingBannerOpen(true); }, [dateFrom]);
  const { data: missingItemsData } = useQuery<{ items: Array<{ id: number; order_id: number; item_name: string; reason_type: string; reason_ingredient?: string; reason_other?: string; qty_missing?: number; qty_made?: number; total_required?: number; staff_name?: string; }> }>({ 
    queryKey: ["/api/missing-items", dateFrom],
    queryFn: () => apiRequest("GET", `/api/missing-items?date=${dateFrom}`).then(r => r.json()),
    refetchInterval: 30000,
  });
  const missingItems = missingItemsData?.items ?? [];

  // Flex orders state
  const [flexOrders, setFlexOrders] = useState<FlexOrder[]>([]);
  const [fetchingOrders, setFetchingOrders] = useState(false);

  // Order states — DB-backed, synced across devices
  const [orderStates, setOrderStates] = useState<Record<number, OrderState>>({});
  const [showCompleted, setShowCompleted] = useState(false);
  const [orderSort, setOrderSort] = useState<"placed" | "delivery">("placed");
  // Track the last known server timestamp to detect remote changes
  const lastServerUpdate = useRef<string | null>(null);
  // Track known order IDs for auto-refresh new-order detection
  const knownOrderIds = useRef<Set<number>>(new Set());

  // Merge conflict queue
  const [mergeConflicts, setMergeConflicts] = useState<MergeConflict[]>([]);

  // Detect edited or auto-complete orders on load/refresh
  useEffect(() => {
    if (flexOrders.length === 0) return;
    setOrderStates(prev => {
      let changed = false;
      const next = { ...prev };
      for (const order of flexOrders) {
        const s = next[order.id];
        if (!s) continue;
        const tickables = getTickableItems(order);
        const allChecked = tickables.length > 0 && tickables.every(i => s.checkedItems[i.uuid]?.checked);
        // Auto-restore isComplete if all items are ticked but isComplete is false (e.g. save failed last session)
        if (allChecked && !s.isComplete) {
          next[order.id] = { ...s, isComplete: true, prepStatus: "done", itemCount: tickables.length };
          fetch(`${API_BASE}/api/order-states/${order.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ date: dateFrom, prepStatus: "done", checkedItems: s.checkedItems, isComplete: true, itemCount: tickables.length }),
          }).catch(() => {});
          changed = true;
        // Detect edited: marked complete but now has more items
        } else if (s.isComplete && s.itemCount > 0 && tickables.length > s.itemCount) {
          next[order.id] = { ...s, isComplete: false, prepStatus: "edited" };
          fetch(`${API_BASE}/api/order-states/${order.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ date: dateFrom, prepStatus: "edited", checkedItems: s.checkedItems, isComplete: false, itemCount: s.itemCount }),
          }).catch(() => {});
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [flexOrders, dateFrom]);

  // Load order states from server for a given date
  const loadOrderStates = useCallback(async (date: string) => {
    try {
      const resp = await fetch(`${API_BASE}/api/order-states?date=${date}`);
      if (!resp.ok) return;
      const data: Record<number, { prepStatus: string; checkedItems: Record<string, any>; isComplete: boolean; itemCount: number; updatedAt: string }> = await resp.json();
      setOrderStates(prev => {
        const next = { ...prev };
        for (const [idStr, state] of Object.entries(data)) {
          const id = Number(idStr);
          next[id] = {
            viewed: true,
            prepStatus: state.prepStatus,
            checkedItems: state.checkedItems,
            isComplete: state.isComplete,
            itemCount: state.itemCount ?? 0,
          };
        }
        return next;
      });
      // Update last known timestamp
      const latestUpdates = Object.values(data).map(s => s.updatedAt).filter(Boolean);
      if (latestUpdates.length > 0) {
        lastServerUpdate.current = latestUpdates.sort().reverse()[0];
      }
    } catch { /* silent */ }
  }, []);

  // Save a single order state to the server (fire-and-forget with failure toast)
  const saveOrderState = useCallback(async (id: number, state: OrderState, date: string) => {
    try {
      const resp = await fetch(`${API_BASE}/api/order-states/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          prepStatus: state.prepStatus,
          checkedItems: state.checkedItems,
          isComplete: state.isComplete ?? false,
          itemCount: state.itemCount ?? 0,
        }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      // Update our own timestamp so we don't re-fetch what we just wrote
      // Use full ISO format to match server timestamps
      lastServerUpdate.current = new Date().toISOString();
    } catch {
      toast({
        title: "Tick not saved",
        description: "Connection issue — please re-tap to confirm.",
        variant: "destructive",
      });
    }
  }, [toast]);

  const getOrderState = (id: number): OrderState => orderStates[id] ?? { ...DEFAULT_ORDER_STATE };

  // Pending saves: id → state queued to be saved
  const pendingSaveRef = useRef<Record<number, OrderState>>({});

  const setOrderState = useCallback((id: number, patch: Partial<OrderState>) => {
    setOrderStates(prev => {
      const current = prev[id] ?? { ...DEFAULT_ORDER_STATE };
      const updated = { ...current, ...patch };
      const next = { ...prev, [id]: updated };
      // Queue save outside setState to avoid race condition
      pendingSaveRef.current[id] = updated;
      return next;
    });
  }, []);

  // Drain pending saves after each render
  useEffect(() => {
    const pending = pendingSaveRef.current;
    if (Object.keys(pending).length === 0) return;
    pendingSaveRef.current = {};
    for (const [idStr, state] of Object.entries(pending)) {
      saveOrderState(Number(idStr), state, dateFrom);
    }
  });

  const markOrderComplete = useCallback((id: number, itemCount: number) => {
    setOrderStates(prev => {
      const current = prev[id] ?? { ...DEFAULT_ORDER_STATE };
      const updated = { ...current, isComplete: true, itemCount };
      const next = { ...prev, [id]: updated };
      pendingSaveRef.current[id] = updated;
      return next;
    });
  }, []);

  // Prep session
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const [generatingPrep, setGeneratingPrep] = useState(false);

  // Prep Log state
  const [logOpen, setLogOpen] = useState(false);
  const [logForm, setLogForm] = useState<LogForm>(DEFAULT_LOG_FORM);
  const logFormRef = useRef<LogForm>(DEFAULT_LOG_FORM);

  // Quick-log sheet (inline tick-off from prep list)
  const [quickLogOpen, setQuickLogOpen] = useState(false);
  const [quickLogItem, setQuickLogItem] = useState<{ type: 'sub_recipe' | 'recipe'; id: number; name: string; unit: string; remaining: number } | null>(null);
  const [quickLogQty, setQuickLogQty] = useState("");
  const [quickLogStaffId, setQuickLogStaffId] = useState("");
  const [quickLogStaffName, setQuickLogStaffName] = useState("");

  // Data
  const { data: rosterData } = useQuery<{ employees: StaffMember[]; source: string }>({
    queryKey: [`/api/deputy/roster?date=${today()}`],
    staleTime: 5 * 60 * 1000,
  });
  const { data: sessionDetail, refetch: refetchSession } = useQuery<PrepSession>({
    queryKey: [`/api/prep/sessions/${activeSessionId}`],
    enabled: !!activeSessionId,
    refetchInterval: 15000,
  });

  // Sub-recipes and recipes for log search
  const { data: subRecipesData } = useQuery<any[]>({
    queryKey: ["/api/sub-recipes"],
    staleTime: 5 * 60 * 1000,
  });
  const { data: recipesData } = useQuery<any[]>({
    queryKey: ["/api/recipes"],
    staleTime: 5 * 60 * 1000,
  });

  // Today's prep log entries (exclude order tick-offs and boxed items — those are not manual prep)
  const todayStr = today();
  const { data: todayLogEntries = [], refetch: refetchLog } = useQuery<PrepLogEntry[]>({
    queryKey: [`/api/prep-log?dateFrom=${todayStr}&dateTo=${todayStr}&excludeTypes=order,boxed`],
    staleTime: 30 * 1000,
  });

  const staff = rosterData?.employees ?? [];

  // Combined options for log search
  const logSearchOptions: SearchableOption[] = [
    ...(subRecipesData ?? []).map((sr: any) => ({
      value: `sub_recipe:${sr.id}`,
      label: sr.name,
      group: "Sub-Recipes",
    })),
    ...(recipesData ?? []).map((r: any) => ({
      value: `recipe:${r.id}`,
      label: r.name,
      group: "Recipes",
    })),
  ];

  // Log mutation
  const logMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/prep-log", data),
    onSuccess: (_res, data: any) => {
      refetchLog();
      setLogOpen(false);
      const name = logFormRef.current.itemName;
      // Auto-add to stock on hand for all units
      apiRequest("POST", "/api/stock-on-hand", {
        itemName: data.itemName,
        itemType: data.itemType || "recipe",
        quantity: data.quantity,
        unit: data.unit,
      }).then(() => refetchStock()).catch(() => {});
      setLogForm(DEFAULT_LOG_FORM);
      toast({ title: "Production logged", description: `${name} recorded successfully` });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteLogMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/prep-log/${id}`),
    onSuccess: () => { refetchLog(); toast({ title: "Entry removed" }); },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  // Stock on hand
  const { data: stockItems = [], refetch: refetchStock } = useQuery<StockItem[]>({
    queryKey: ["/api/stock-on-hand"],
    staleTime: 15 * 1000,
  });
  const [editingStockId, setEditingStockId] = useState<number | null>(null);
  const [editingStockQty, setEditingStockQty] = useState<string>("");
  const addStockMutation = useMutation({
    mutationFn: (data: { itemName: string; itemType: string; quantity: number; unit: string }) =>
      apiRequest("POST", "/api/stock-on-hand", data),
    onSuccess: () => { refetchStock(); },
  });
  const updateStockMutation = useMutation({
    mutationFn: ({ id, quantity }: { id: number; quantity: number }) =>
      apiRequest("PUT", `/api/stock-on-hand/${id}`, { quantity }),
    onSuccess: () => { refetchStock(); setEditingStockId(null); },
  });
  const deleteStockMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/stock-on-hand/${id}`),
    onSuccess: () => refetchStock(),
  });
  const clearStockMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", "/api/stock-on-hand"),
    onSuccess: () => { refetchStock(); toast({ title: "Stock cleared" }); },
  });
  // New stock form
  const [newStockForm, setNewStockForm] = useState({ itemName: "", quantity: "", unit: "each" });

  const handleLogSubmit = () => {
    logFormRef.current = logForm;
    if (!logForm.itemValue || !logForm.quantity || !logForm.staffId) {
      toast({ title: "Please fill all required fields", variant: "destructive" });
      return;
    }
    const qty = parseFloat(logForm.quantity);
    if (isNaN(qty) || qty <= 0) {
      toast({ title: "Enter a valid quantity", variant: "destructive" });
      return;
    }
    logMutation.mutate({
      itemType: logForm.itemType,
      itemId: logForm.itemId,
      itemName: logForm.itemName,
      quantity: qty,
      unit: logForm.unit,
      staffId: parseInt(logForm.staffId) || null,
      staffName: logForm.staffName,
      notes: logForm.notes || null,
      loggedAt: new Date().toISOString(),
    });
  };

  // Group today's log entries by staff
  const logByStaff: Record<string, PrepLogEntry[]> = {};
  for (const entry of todayLogEntries) {
    const key = entry.staffName || "Unknown";
    if (!logByStaff[key]) logByStaff[key] = [];
    logByStaff[key].push(entry);
  }

  // Count ticked-off order items by recipe/item name (for Remaining mode)
  // This maps normalised lowercase name → total quantity ticked across all orders
  const checkedQtyByName = useMemo(() => {
    const map: Record<string, number> = {};
    for (const order of flexOrders) {
      const state = orderStates[order.id];
      if (!state) continue;
      const tickables = getTickableItems(order);
      for (const t of tickables) {
        if (state.checkedItems[t.uuid]?.checked) {
          const key = (t.name || "").toLowerCase().trim();
          map[key] = (map[key] || 0) + (t.quantity || 1);
        }
      }
    }
    return map;
  }, [flexOrders, orderStates]);

  // ── Fetch Flex orders ──
  const fetchOrders = useCallback(async (isAutoRefresh = false) => {
    if (!isAutoRefresh) {
      setFetchingOrders(true);
      setFlexOrders([]);
    }
    try {
      const results: FlexOrder[] = [];
      const from = new Date(dateFrom + "T00:00:00");
      const to   = new Date(dateTo   + "T00:00:00");
      let cursor = new Date(from);
      while (cursor <= to) {
        const d = localDateStr(cursor);
        const resp = await fetch(`${API_BASE}/api/flex-orders?date=${d}&raw=true`);
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
          throw new Error(err.error || `HTTP ${resp.status}`);
        }
        const data = await resp.json();
        if (data.orders) results.push(...data.orders);
        cursor.setDate(cursor.getDate() + 1);
      }

      if (isAutoRefresh) {
        // Detect new orders
        const newOrders = results.filter(o => !knownOrderIds.current.has(o.id));
        if (newOrders.length > 0) {
          // Add them to state without clearing existing
          setFlexOrders(prev => {
            const existingIds = new Set(prev.map(o => o.id));
            const toAdd = newOrders.filter(o => !existingIds.has(o.id));
            if (toAdd.length === 0) return prev;
            return [...prev, ...toAdd].sort((a, b) => {
              const ta = a.delivery_datetime ? new Date(a.delivery_datetime).getTime() : 0;
              const tb = b.delivery_datetime ? new Date(b.delivery_datetime).getTime() : 0;
              return ta - tb;
            });
          });
          newOrders.forEach(o => knownOrderIds.current.add(o.id));

          toast({
            title: `${newOrders.length} new order${newOrders.length > 1 ? "s" : ""} received`,
            description: newOrders.map(o => o.company || `${o.first_name} ${o.last_name}`.trim()).join(", "),
          });

          // If there's an active prep session, merge these new orders in
          if (activeSessionId) {
            await mergeNewOrders(newOrders, activeSessionId);
          }
        }
      } else {
        // Initial load — sort by delivery_datetime ascending
        results.sort((a, b) => {
          const ta = a.delivery_datetime ? new Date(a.delivery_datetime).getTime() : 0;
          const tb = b.delivery_datetime ? new Date(b.delivery_datetime).getTime() : 0;
          return ta - tb;
        });
        setFlexOrders(results);
        knownOrderIds.current = new Set(results.map(o => o.id));
        if (results.length === 0) {
          toast({ title: "No orders found", description: `No delivery orders for ${dateFrom === dateTo ? fmtDate(dateFrom) : `${fmtDate(dateFrom)} \u2013 ${fmtDate(dateTo)}`}` });
        }
      }
    } catch (e: any) {
      if (!isAutoRefresh) {
        toast({ title: "Failed to fetch orders", description: e.message, variant: "destructive" });
      }
    } finally {
      if (!isAutoRefresh) setFetchingOrders(false);
    }
  }, [dateFrom, dateTo, activeSessionId]);

  // Merge new orders into active prep session
  const mergeNewOrders = async (newOrders: FlexOrder[], sessionId: number) => {
    try {
      const orderItems = newOrders.flatMap(o =>
        (o.items ?? []).map(i => ({
          type: "flex_product" as const,
          sku: i.sku,
          name: i.name,
          quantity: i.quantity,
          forOrder: o.company || `${o.first_name} ${o.last_name}`.trim(),
        }))
      );

      const resp = await fetch(`${API_BASE}/api/prep/sessions/${sessionId}/merge-orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newOrders: orderItems }),
      });
      if (!resp.ok) return;
      const result = await resp.json();

      // Refresh session
      qc.invalidateQueries({ queryKey: [`/api/prep/sessions/${sessionId}`] });

      // Check for in-progress conflicts
      if (result.merged && Array.isArray(result.merged)) {
        const conflicts: MergeConflict[] = result.merged
          .filter((m: any) => m.wasInProgress)
          .map((m: any) => ({
            taskId: m.taskId,             // new separate pending task
            existingTaskId: m.existingTaskId ?? m.taskId, // original in-progress task
            taskName: m.itemName,
            existingQty: m.existingQty,
            newQty: m.addedQty,
            totalQty: m.existingQty + m.addedQty,
          }));
        if (conflicts.length > 0) {
          setMergeConflicts(conflicts);
        }
      }
    } catch (e) {
      // Silently ignore merge errors on auto-refresh
    }
  };

  // Auto-fetch orders + load order states when date range changes
  useEffect(() => {
    fetchOrders(false);
    loadOrderStates(dateFrom);
  }, [dateFrom, dateTo]);

  // Poll every 10 seconds: check for remote order state changes, refresh orders every 60s
  const pollCountRef = useRef(0);
  useEffect(() => {
    const interval = setInterval(async () => {
      pollCountRef.current += 1;
      // Check if any remote device has updated order states
      try {
        const resp = await fetch(`${API_BASE}/api/order-states/latest-update?date=${dateFrom}`);
        if (resp.ok) {
          const { latest } = await resp.json();
          if (latest && latest !== lastServerUpdate.current) {
            // Remote change detected — reload all order states
            loadOrderStates(dateFrom);
          }
        }
      } catch { /* silent */ }
      // Still refresh orders from Flex every 60s (6 × 10s polls)
      if (pollCountRef.current % 6 === 0) {
        fetchOrders(true);
      }
    }, 10000);
    return () => clearInterval(interval);
  }, [fetchOrders, loadOrderStates, dateFrom]);

  // ── Generate prep list ──
  const generatePrepList = async () => {
    setGeneratingPrep(true);
    try {
      // Only include unchecked items — items that haven't been ticked off yet
      const uncheckedOrders = flexOrders.map(o => {
        const oState = orderStates[o.id] ?? DEFAULT_ORDER_STATE;
        // For prep list generation: only include non-combo items that haven't been ticked
        // (combo sub-items use synthetic UUIDs so we check all tickables)
        const tickables = getTickableItems(o);
        const uncheckedItems = (o.items ?? []).filter(i => {
          const combos = (i.combo_options || []).filter((co: ComboOption) => co.items.length > 0);
          if (combos.length > 0) {
            // Combo: include if any sub-item unchecked
            return combos.some((co, oi) =>
              co.items.some((_, ii) => !oState.checkedItems[`${i.uuid}__sub__${oi}_${ii}`]?.checked)
            );
          }
          return !oState.checkedItems[i.uuid]?.checked;
        });
        return { ...o, items: uncheckedItems ?? [] };
      }).filter(o => o.items.length > 0);

      if (uncheckedOrders.length === 0) {
        toast({ title: "All items checked off", description: "No unchecked items to prep" });
        setGeneratingPrep(false);
        return;
      }

      // Build individual line items with SKU for each unchecked order item
      const orderLineItems = uncheckedOrders.flatMap(o =>
        o.items.map(i => ({
          type: "flex_product" as const,
          sku: i.sku,
          name: i.name,
          quantity: i.quantity,
          forOrder: o.company || `${o.first_name} ${o.last_name}`.trim(),
        }))
      );

      const resp = await fetch(`${API_BASE}/api/prep/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: dateFrom,
          dateTo: dateTo !== dateFrom ? dateTo : undefined,
          notes: `${fmtDate(dateFrom)}${dateTo !== dateFrom ? ` – ${fmtDate(dateTo)}` : ""} • ${flexOrders.length} orders`,
          orders: orderLineItems,
          fromFlexOrders: true,
        }),
      });
      const session = await resp.json();
      if (!resp.ok) throw new Error(session.error || "Failed to create prep session");
      setActiveSessionId(session.id);
      qc.invalidateQueries({ queryKey: ["/api/prep/sessions"] });
      setTab("prep");
      toast({ title: "Prep list generated", description: `${session.tasks?.length ?? 0} tasks across sub-recipes and recipes` });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setGeneratingPrep(false);
    }
  };

  // ── Task action ──
  const taskAction = useMutation({
    mutationFn: ({ id, action, extra }: { id: number; action: string; extra?: any }) =>
      apiRequest("PATCH", `/api/prep/tasks/${id}`, { action, ...extra }),
    onSuccess: () => { if (activeSessionId) qc.invalidateQueries({ queryKey: [`/api/prep/sessions/${activeSessionId}`] }); },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });
  const handleTaskAction = useCallback((taskId: number, action: string, extra?: any) => {
    taskAction.mutate({ id: taskId, action, extra });
  }, [taskAction]);

  // ── Merge conflict handlers ──
  const handleMakeNow = async (taskId: number, totalQty: number) => {
    // taskId is the NEW separate pending task (we want to DELETE it)
    // existingTaskId is the original in-progress task (update its qty to totalQty)
    const c = mergeConflicts[0];
    if (!c) return;
    try {
      // Update the in-progress task to the combined total
      await apiRequest("PATCH", `/api/prep/tasks/${c.existingTaskId}`, {
        action: "update_qty",
        quantityRequired: totalQty,
      });
      // Delete the extra pending task that was created
      await fetch(`${API_BASE}/api/prep/tasks/${c.taskId}`, { method: "DELETE" });
    } catch (e) { /* ignore */ }
    qc.invalidateQueries({ queryKey: [`/api/prep/sessions/${activeSessionId}`] });
    setMergeConflicts(prev => prev.slice(1));
    toast({ title: `Making ${fmtQty(totalQty)} ${c.taskName} total` });
  };

  const handleAddToList = async (taskId: number, newQty: number) => {
    // The merge already added it as a separate task — just dismiss
    setMergeConflicts(prev => prev.slice(1));
    toast({ title: "Added to prep list", description: `${fmtQty(newQty)} added as separate prep task` });
  };

  // ── Summary stats for orders ──
  const visibleOrders = flexOrders
    .filter(o => showCompleted || !orderStates[o.id]?.isComplete)
    .slice()
    .sort((a, b) => {
      if (orderSort === "placed") {
        // Newest placed first
        const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
        const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
        return tb - ta;
      } else {
        // Earliest delivery first
        const ta = a.delivery_datetime ? new Date(a.delivery_datetime).getTime() : Infinity;
        const tb = b.delivery_datetime ? new Date(b.delivery_datetime).getTime() : Infinity;
        return ta - tb;
      }
    });
  const orderStats = {
    total: flexOrders.length,
    new: flexOrders.filter(o => (orderStates[o.id]?.prepStatus || "new") === "new" && !orderStates[o.id]?.isComplete).length,
    not_started: flexOrders.filter(o => orderStates[o.id]?.prepStatus === "not_started" && !orderStates[o.id]?.isComplete).length,
    in_progress: flexOrders.filter(o => orderStates[o.id]?.prepStatus === "in_progress" && !orderStates[o.id]?.isComplete).length,
    edited: flexOrders.filter(o => orderStates[o.id]?.prepStatus === "edited").length,
    done: flexOrders.filter(o => orderStates[o.id]?.prepStatus === "done" && !orderStates[o.id]?.isComplete).length,
    complete: flexOrders.filter(o => !!orderStates[o.id]?.isComplete).length,
  };

  const prepTasks = sessionDetail?.tasks ?? [];
  const prepDone = prepTasks.filter(t => t.status === "done" || t.status === "skipped").length;
  const prepPct = prepTasks.length > 0 ? Math.round((prepDone / prepTasks.length) * 100) : 0;
  const subRecipeTasks = prepTasks.filter(t => t.itemType === "sub_recipe");
  const recipeTasks    = prepTasks.filter(t => t.itemType === "recipe");

  // ── Auto-compute prep summary from current orders ──
  // Build the flat order line items from all loaded flex orders (all items, regardless of tick status)
  const prepComputeOrders = useMemo(() =>
    flexOrders.flatMap(o =>
      (o.items ?? []).map(i => ({
        type: "flex_product" as const,
        sku: i.sku,
        name: i.name,
        quantity: i.quantity,
        attributesSummary: (i as any).attributes_summary || "",
        forOrder: o.company || `${o.first_name} ${o.last_name}`.trim(),
        customerUuid: o.customer_uuid || null,
        isWholesale: o.is_wholesale || false,
        flexCategory: (i as any).category || "",
      }))
    ),
    [flexOrders]
  );

  interface PrepRecipeSize { label: string; qty: number; }
  interface PrepRecipePkg { label: string; qty: number; orders: string[]; }
  interface PrepRecipeOrder { customer: string; qty: number; }
  interface PrepRecipe { id: number; name: string; category: string; qty: number; unit: string; orderItemNames: string[]; sizes: PrepRecipeSize[]; packaging: PrepRecipePkg[]; orders: PrepRecipeOrder[]; }
  interface PrepSubRecipe { id: number; name: string; qty: number; unit: string; }
  interface PrepComputed { recipes: PrepRecipe[]; subRecipes: PrepSubRecipe[]; }

  const { data: prepComputed, isFetching: prepComputeFetching } = useQuery<PrepComputed>({
    queryKey: ["/api/prep/compute", prepComputeOrders],
    queryFn: async () => {
      if (prepComputeOrders.length === 0) return { recipes: [], subRecipes: [] };
      const resp = await fetch(`${API_BASE}/api/prep/compute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orders: prepComputeOrders }),
      });
      if (!resp.ok) throw new Error("Failed to compute prep");
      return resp.json();
    },
    enabled: tab === "prep" && prepComputeOrders.length > 0,
    staleTime: 30 * 1000,
  });

  // ── Date range label ──
  const dateLabel = rangeMode === "today" ? "Today" : rangeMode === "tomorrow" ? "Tomorrow"
    : dateFrom === dateTo ? fmtDate(dateFrom) : `${fmtDate(dateFrom)} – ${fmtDate(dateTo)}`;

  return (
    <div className="space-y-4 pb-8">
      {/* Merge conflict modal */}
      {mergeConflicts.length > 0 && (
        <MergeConflictDialog
          conflicts={mergeConflicts}
          onMakeNow={handleMakeNow}
          onAddToList={handleAddToList}
          onDismiss={() => setMergeConflicts(prev => prev.slice(1))}
        />
      )}

      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <ChefHat size={24} className="text-[#256984]" /> Production
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {staff.length > 0 ? `${staff.length} staff available today` : "Loading staff..."}
            {" · "}
            <span className="text-xs">Syncs every 10s across devices</span>
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => fetchOrders(false)}
          disabled={fetchingOrders}
        >
          <RefreshCw size={13} className={fetchingOrders ? "animate-spin" : ""} />
          Refresh
        </Button>
      </div>

      {/* ── Date Range Selector ── */}
      <div className="bg-card border border-border rounded-xl p-4 space-y-3">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Date Range</p>
        <div className="flex gap-2 flex-wrap">
          <Button
            size="sm"
            variant={rangeMode === "today" ? "default" : "outline"}
            className={rangeMode === "today" ? "bg-[#256984] hover:bg-[#1e5570] text-white" : ""}
            onClick={() => setRangeMode("today")}
          >
            Today's Orders
          </Button>
          <Button
            size="sm"
            variant={rangeMode === "tomorrow" ? "default" : "outline"}
            className={rangeMode === "tomorrow" ? "bg-[#256984] hover:bg-[#1e5570] text-white" : ""}
            onClick={() => setRangeMode("tomorrow")}
          >
            Tomorrow's Orders
          </Button>
          <Button
            size="sm"
            variant={rangeMode === "custom" ? "default" : "outline"}
            className={rangeMode === "custom" ? "bg-[#256984] hover:bg-[#1e5570] text-white" : ""}
            onClick={() => setRangeMode("custom")}
          >
            <CalendarDays size={13} className="mr-1" /> Custom Range
          </Button>
        </div>
        {rangeMode === "custom" && (
          <div className="flex gap-3 flex-wrap items-center">
            <div>
              <p className="text-xs text-muted-foreground mb-1">From</p>
              <Input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} className="h-8 w-40 text-sm" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">To</p>
              <Input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} className="h-8 w-40 text-sm" min={customFrom} />
            </div>
          </div>
        )}
      </div>

      {/* ── Missing Items Banner ── */}
      {missingItems.length > 0 && (
        <div className="border border-red-200 bg-red-50 rounded-xl overflow-hidden">
          <button
            className="w-full flex items-center justify-between px-4 py-3 text-left"
            onClick={() => setMissingBannerOpen(v => !v)}
          >
            <div className="flex items-center gap-2">
              <AlertTriangle size={16} className="text-red-600 shrink-0" />
              <span className="text-sm font-semibold text-red-700">
                {missingItems.length} missing item{missingItems.length !== 1 ? "s" : ""} for {rangeMode === "today" ? "today" : rangeMode === "tomorrow" ? "tomorrow" : dateFrom}
              </span>
              <span className="text-xs bg-red-100 text-red-700 border border-red-200 rounded-full px-2 py-0.5">
                Items not made
              </span>
            </div>
            {missingBannerOpen ? <ChevronUp size={15} className="text-red-500" /> : <ChevronDown size={15} className="text-red-500" />}
          </button>
          {missingBannerOpen && (
            <div className="px-4 pb-3 space-y-2">
              {(() => {
                // Group by order_id
                const byOrder: Record<number, typeof missingItems> = {};
                for (const item of missingItems) {
                  if (!byOrder[item.order_id]) byOrder[item.order_id] = [];
                  byOrder[item.order_id].push(item);
                }
                return Object.entries(byOrder).map(([orderId, items]) => {
                  const orderIdNum = Number(orderId);
                  const matchedOrder = flexOrders.find(o => o.id === orderIdNum);
                  const clientLabel = matchedOrder
                    ? (matchedOrder.company || `${matchedOrder.first_name} ${matchedOrder.last_name}`.trim())
                    : `Order #${orderId}`;
                  const deliveryTime = matchedOrder?.delivery_datetime
                    ? fmtTimeOnly(matchedOrder.delivery_datetime)
                    : null;
                  return (
                    <div key={orderId} className="bg-white border border-red-100 rounded-lg p-3">
                      <p className="text-xs font-semibold text-red-700 mb-1.5">
                        {clientLabel} — #{orderId}
                        {deliveryTime && (
                          <span className="ml-2 font-normal text-red-500">Delivery {deliveryTime}</span>
                        )}
                      </p>
                      <ul className="space-y-1">
                        {items.map(item => (
                          <li key={item.id} className="flex items-start gap-1.5 text-xs text-red-800">
                            <span className="mt-0.5 shrink-0">•</span>
                            <span>
                              <span className="font-medium">{item.item_name}</span>
                              {item.qty_missing != null && item.total_required != null && (
                                <span className="text-red-500 ml-1">({item.qty_missing} of {item.total_required} missing)</span>
                              )}
                              <span className="text-red-400 ml-1">
                                — {item.reason_type === "ingredient" && item.reason_ingredient
                                  ? `Out of stock: ${item.reason_ingredient}`
                                  : item.reason_other || "No reason given"}
                              </span>
                              {item.staff_name && (
                                <span className="text-red-400 ml-1">• <span className="italic">{item.staff_name}</span></span>
                              )}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                });
              })()}
            </div>
          )}
        </div>
      )}

      {/* ── Tabs ── */}
      <div className="flex gap-0 border border-border rounded-xl overflow-hidden">
        <button
          className={cn("flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-semibold transition-colors",
            tab === "orders" ? "bg-[#256984] text-white" : "bg-card text-muted-foreground hover:bg-muted/50")}
          onClick={() => setTab("orders")}
        >
          <ShoppingCart size={15} />
          Orders
          {flexOrders.length > 0 && (
            <span className={cn("text-xs px-1.5 py-0.5 rounded-full", tab === "orders" ? "bg-white/20 text-white" : "bg-muted text-muted-foreground")}>
              {flexOrders.length}
            </span>
          )}
        </button>
        <button
          className={cn("flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-semibold transition-colors border-l border-border",
            tab === "prep" ? "bg-[#256984] text-white" : "bg-card text-muted-foreground hover:bg-muted/50")}
          onClick={() => setTab("prep")}
        >
          <ListChecks size={15} />
          Prep
          {prepTasks.length > 0 && (
            <span className={cn("text-xs px-1.5 py-0.5 rounded-full", tab === "prep" ? "bg-white/20 text-white" : "bg-muted text-muted-foreground")}>
              {prepPct}%
            </span>
          )}
        </button>
        <button
          className={cn("flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-semibold transition-colors border-l border-border",
            tab === "stock" ? "bg-[#256984] text-white" : "bg-card text-muted-foreground hover:bg-muted/50")}
          onClick={() => setTab("stock")}
        >
          <Package size={15} />
          Stock
          {stockItems.length > 0 && (
            <span className={cn("text-xs px-1.5 py-0.5 rounded-full", tab === "stock" ? "bg-white/20 text-white" : "bg-muted text-muted-foreground")}>
              {stockItems.length}
            </span>
          )}
        </button>
      </div>

      {/* ─────────── ORDERS TAB ─────────── */}
      {tab === "orders" && (
        <div className="space-y-3">
          {/* Status legend + Show completed toggle */}
          {flexOrders.length > 0 && (
            <div className="flex gap-2 flex-wrap items-center justify-between">
              <div className="flex gap-2 flex-wrap items-center">
                <span className="text-xs text-muted-foreground font-medium">Status:</span>
                {[
                  { key: "new",         label: "New",         dot: "bg-yellow-400" },
                  { key: "not_started", label: "Not Started", dot: "bg-red-400" },
                  { key: "in_progress", label: "In Progress", dot: "bg-orange-400" },
                  { key: "edited",      label: "Edited",      dot: "bg-purple-400" },
                  { key: "complete",    label: "Complete",    dot: "bg-green-500" },
                ].map(s => (
                  <span key={s.key} className="flex items-center gap-1 text-xs text-muted-foreground">
                    <span className={cn("w-2.5 h-2.5 rounded-full inline-block", s.dot)} />
                    {s.label}
                    {(orderStats[s.key as keyof typeof orderStats] ?? 0) > 0 && (
                      <span className="font-semibold text-foreground">({orderStats[s.key as keyof typeof orderStats]})</span>
                    )}
                  </span>
                ))}
              </div>
              {/* Sort + Show completed controls */}
              <div className="flex items-center gap-3 flex-wrap">
                {/* Sort toggle */}
                <div className="flex items-center gap-1 rounded-lg border border-border bg-muted/40 p-0.5">
                  <button
                    onClick={() => setOrderSort("placed")}
                    className={cn(
                      "text-[11px] px-2 py-0.5 rounded-md font-medium transition-colors",
                      orderSort === "placed" ? "bg-white shadow text-foreground" : "text-muted-foreground hover:text-foreground"
                    )}
                  >Order placed</button>
                  <button
                    onClick={() => setOrderSort("delivery")}
                    className={cn(
                      "text-[11px] px-2 py-0.5 rounded-md font-medium transition-colors",
                      orderSort === "delivery" ? "bg-white shadow text-foreground" : "text-muted-foreground hover:text-foreground"
                    )}
                  >Delivery time</button>
                </div>
                {/* Show completed toggle — only shown when there are completed orders */}
                {orderStats.complete > 0 && (
                  <label className="flex items-center gap-1.5 cursor-pointer select-none">
                    <div
                      onClick={() => setShowCompleted(v => !v)}
                      className={cn(
                        "w-8 h-4 rounded-full transition-colors relative shrink-0",
                        showCompleted ? "bg-[#256984]" : "bg-muted-foreground/30"
                      )}
                    >
                      <div className={cn(
                        "absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform",
                        showCompleted ? "translate-x-4" : "translate-x-0.5"
                      )} />
                    </div>
                    <span className="text-xs text-muted-foreground">Show completed</span>
                  </label>
                )}
              </div>
            </div>
          )}

          {/* Loading */}
          {fetchingOrders && (
            <div className="flex items-center justify-center py-12 gap-3 text-muted-foreground">
              <RefreshCw size={20} className="animate-spin" />
              <span>Fetching {dateLabel} orders from Flex...</span>
            </div>
          )}

          {/* Orders list — sorted by delivery_datetime ascending */}
          {!fetchingOrders && flexOrders.length > 0 && (
            <>
              {visibleOrders.map(order => (
                <OrderCard
                  key={order.id}
                  order={order}
                  state={getOrderState(order.id)}
                  staff={staff}
                  onStateChange={setOrderState}
                  onMarkComplete={markOrderComplete}
                  isComplete={!!getOrderState(order.id).isComplete}
                  onStockDeducted={refetchStock}
                />
              ))}
              {/* All orders complete — empty state while completed are hidden */}
              {visibleOrders.length === 0 && !showCompleted && orderStats.complete > 0 && (
                <div className="text-center py-10 text-muted-foreground">
                  <CheckCircle2 className="mx-auto mb-3 text-[#256984] opacity-60" size={40} />
                  <p className="font-semibold text-foreground">All orders complete</p>
                  <p className="text-sm mt-1">
                    {orderStats.complete} order{orderStats.complete !== 1 ? "s" : ""} marked as complete
                  </p>
                  <button
                    onClick={() => setShowCompleted(true)}
                    className="text-xs text-[#256984] underline mt-2"
                  >
                    Show completed orders
                  </button>
                </div>
              )}


            </>
          )}

          {/* Empty */}
          {!fetchingOrders && flexOrders.length === 0 && (
            <div className="text-center py-14 text-muted-foreground">
              <ShoppingCart className="mx-auto mb-3 opacity-30" size={44} />
              <p className="font-semibold text-foreground">No orders for {dateLabel}</p>
              <p className="text-sm mt-1">Try selecting a different date range or refreshing</p>
            </div>
          )}
        </div>
      )}

      {/* ─────────── PREP TAB ─────────── */}
      {tab === "prep" && (
        <div className="space-y-4">
          {/* Loading state */}
          {prepComputeFetching && (
            <div className="flex items-center justify-center py-10 text-muted-foreground gap-2">
              <RefreshCw size={16} className="animate-spin text-[#256984]" />
              <span className="text-sm">Loading prep list&hellip;</span>
            </div>
          )}

          {/* No orders loaded yet */}
          {!prepComputeFetching && flexOrders.length === 0 && (
            <div className="text-center py-14 text-muted-foreground">
              <ListChecks className="mx-auto mb-3 opacity-30" size={44} />
              <p className="font-semibold text-foreground">No orders loaded</p>
              <p className="text-sm mt-1 mb-4">Switch to the Orders tab and load a date first</p>
              <Button variant="outline" onClick={() => setTab("orders")}>
                <ShoppingCart size={14} className="mr-1.5" /> View Orders
              </Button>
            </div>
          )}

          {/* Computed prep list — new 50/50 split layout */}
          {!prepComputeFetching && prepComputed && (
            <>
              {/* ── Controls bar: Total/Remaining toggle ── */}
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  {prepMode === "remaining" ? "Remaining = total minus logged prep" : "Total quantities across all orders"}
                </p>
                <div className="flex rounded-lg border border-border overflow-hidden text-xs font-semibold">
                  <button
                    onClick={() => setPrepMode("total")}
                    className={`px-3 py-1.5 transition-colors ${
                      prepMode === "total"
                        ? "bg-[#256984] text-white"
                        : "bg-card text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    Total
                  </button>
                  <button
                    onClick={() => setPrepMode("remaining")}
                    className={`px-3 py-1.5 border-l border-border transition-colors ${
                      prepMode === "remaining"
                        ? "bg-[#256984] text-white"
                        : "bg-card text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    Remaining
                  </button>
                </div>
              </div>

              {/* ── Mobile tab switcher (hidden on md+) ── */}
              <div className="flex rounded-lg border border-border overflow-hidden text-sm font-semibold md:hidden">
                <button
                  onClick={() => setPrepMobileTab("subrecipes")}
                  className={`flex-1 py-2 transition-colors ${
                    prepMobileTab === "subrecipes"
                      ? "bg-[#256984] text-white"
                      : "bg-card text-muted-foreground hover:bg-muted"
                  }`}
                >
                  Sub-recipes
                </button>
                <button
                  onClick={() => setPrepMobileTab("recipes")}
                  className={`flex-1 py-2 border-l border-border transition-colors ${
                    prepMobileTab === "recipes"
                      ? "bg-[#256984] text-white"
                      : "bg-card text-muted-foreground hover:bg-muted"
                  }`}
                >
                  Recipes
                </button>
              </div>

              {/* ── 50/50 grid: stacked mobile, side-by-side md+ ── */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

                {/* ── LEFT / TAB 1: Sub-recipes ── */}
                <div className={prepMobileTab === "subrecipes" ? "" : "hidden md:block"}>
                  <h3 className="text-sm font-bold text-foreground mb-2 flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-[#FCCDE2] inline-block" />
                    Sub-recipes
                    {(prepComputed.subRecipes?.length ?? 0) > 0 && (
                      <span className="text-xs font-normal text-muted-foreground">({prepComputed.subRecipes.length})</span>
                    )}
                  </h3>

                  {(prepComputed.subRecipes?.length ?? 0) === 0 ? (
                    <div className="bg-card border border-border rounded-xl px-4 py-6 text-center text-sm text-muted-foreground">
                      No sub-recipes for these orders
                    </div>
                  ) : (
                    <div className="bg-card border border-border rounded-xl overflow-hidden">
                      <div className="divide-y divide-border/50">
                        {prepComputed.subRecipes.map(item => {
                          const loggedPrep = todayLogEntries
                            .filter(e => e.itemType === "sub_recipe" && String(e.itemId) === String(item.id))
                            .reduce((s, e) => s + (Number(e.quantity) || 0), 0);
                          const logged = loggedPrep;
                          const remaining = Math.max(0, item.qty - logged);
                          const displayQty = prepMode === "remaining" ? remaining : item.qty;
                          const pct = item.qty > 0 ? Math.min(100, Math.round((logged / item.qty) * 100)) : 0;
                          const isDone = pct >= 100;
                          return (
                            <div key={item.id} className={`px-4 py-3 ${isDone ? "bg-green-50/50" : ""}`}>
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex-1 min-w-0">
                                  <span className={`text-sm leading-tight ${isDone ? "text-muted-foreground line-through" : "text-foreground"}`}>{item.name}</span>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  <span className={`text-sm font-bold tabular-nums ${isDone ? "text-green-600" : "text-[#256984]"}`}>
                                    {Number.isInteger(displayQty) ? displayQty : displayQty.toFixed(2)}
                                    <span className="text-xs font-normal text-muted-foreground ml-0.5">{item.unit || "each"}</span>
                                  </span>
                                  <button
                                    onClick={() => {
                                      setQuickLogItem({ type: "sub_recipe", id: item.id, name: item.name, unit: item.unit || "each", remaining });
                                      setQuickLogQty(remaining > 0 ? (Number.isInteger(remaining) ? String(remaining) : remaining.toFixed(2)) : "");
                                      setQuickLogOpen(true);
                                    }}
                                    className="w-7 h-7 rounded-full flex items-center justify-center bg-[#256984]/10 hover:bg-[#256984]/20 text-[#256984] transition-colors"
                                    title="Log prep"
                                  >
                                    <Check size={14} />
                                  </button>
                                </div>
                              </div>
                              <div className="mt-1.5">
                                <div className="h-1 rounded-full bg-border overflow-hidden">
                                  <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: isDone ? "#5AB693" : "#256984" }} />
                                </div>
                                <p className="text-[10px] text-muted-foreground mt-0.5">
                                  {Number.isInteger(logged) ? logged : logged.toFixed(2)} / {item.qty} {item.unit || "each"} done
                                </p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                {/* ── RIGHT / TAB 2: Recipes ── */}
                <div className={prepMobileTab === "recipes" ? "" : "hidden md:block"}>
                  <h3 className="text-sm font-bold text-foreground mb-2 flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-[#256984] inline-block" />
                    Recipes
                    {(prepComputed.recipes?.length ?? 0) > 0 && (
                      <span className="text-xs font-normal text-muted-foreground">({prepComputed.recipes.length})</span>
                    )}
                  </h3>

                  {(prepComputed.recipes?.length ?? 0) === 0 ? (
                    <div className="bg-card border border-border rounded-xl px-4 py-6 text-center text-sm text-muted-foreground">
                      No recipes linked to these orders
                    </div>
                  ) : (() => {
                    // Category grouping: Breakfast → Lunch Wraps & Sandwiches → Salads → Other
                    const CATEGORY_ORDER = ["Breakfast", "Lunch Wraps & Sandwiches", "Salads", "Other"];
                    const catLabel = (cat: string): string => {
                      const c = (cat || "").toLowerCase();
                      if (c.includes("breakfast")) return "Breakfast";
                      if (c.includes("wrap") || c.includes("sandwich") || c.includes("lunch")) return "Lunch Wraps & Sandwiches";
                      if (c.includes("salad")) return "Salads";
                      return "Other";
                    };
                    const grouped: Record<string, PrepRecipe[]> = {};
                    for (const item of prepComputed.recipes) {
                      const key = catLabel(item.category);
                      if (!grouped[key]) grouped[key] = [];
                      grouped[key].push(item);
                    }
                    const renderRecipeCard = (item: PrepRecipe) => {
                      const loggedPrep = todayLogEntries
                        .filter(e => e.itemType === "recipe" && String(e.itemId) === String(item.id))
                        .reduce((s, e) => s + (Number(e.quantity) || 0), 0);
                      // Sum ticked-off quantities across ALL order item names that map to this recipe
                      const tickedOff = (item.orderItemNames || [item.name])
                        .reduce((sum, n) => sum + (checkedQtyByName[(n || "").toLowerCase().trim()] || 0), 0);
                      const logged = loggedPrep + tickedOff;
                      const displayQty = prepMode === "remaining" ? Math.max(0, item.qty - logged) : item.qty;
                      const pct = item.qty > 0 ? Math.min(100, Math.round((logged / item.qty) * 100)) : 0;
                      const hasSizes = (item.sizes?.length ?? 0) > 1;
                      const hasPkg = (item.packaging?.length ?? 0) > 0 && item.packaging.some(p => p.label !== "No packaging");
                      const hasOrders = (item.orders?.length ?? 0) > 0;
                      const recipeRemaining = Math.max(0, item.qty - logged);
                      const isDoneRecipe = pct >= 100;
                      return (
                        <div key={item.id} className={`bg-card border border-border rounded-xl overflow-hidden ${isDoneRecipe ? "border-green-200" : ""}`}>
                          <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
                            <span className={`text-sm font-semibold leading-tight ${isDoneRecipe ? "text-muted-foreground line-through" : "text-foreground"}`}>{item.name}</span>
                            <div className="flex items-center gap-2 shrink-0 ml-2">
                              <span className={`text-sm font-bold tabular-nums ${isDoneRecipe ? "text-green-600" : "text-[#256984]"}`}>
                                {displayQty}
                                {item.unit ? <span className="text-xs font-normal text-muted-foreground ml-0.5">{item.unit}</span> : <span className="text-xs font-normal text-muted-foreground ml-0.5"> each</span>}
                              </span>
                              <button
                                onClick={() => {
                                  setQuickLogItem({ type: "recipe", id: item.id, name: item.name, unit: item.unit || "each", remaining: recipeRemaining });
                                  setQuickLogQty(recipeRemaining > 0 ? String(recipeRemaining) : "");
                                  setQuickLogOpen(true);
                                }}
                                className="w-7 h-7 rounded-full flex items-center justify-center bg-[#256984]/10 hover:bg-[#256984]/20 text-[#256984] transition-colors"
                                title="Log prep"
                              >
                                <Check size={14} />
                              </button>
                            </div>
                          </div>
                          {prepMode === "remaining" && item.qty > 0 && (
                            <div className="px-4 pt-2 pb-1">
                              <div className="h-1.5 rounded-full bg-border overflow-hidden">
                                <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: pct >= 100 ? "#5AB693" : "#256984" }} />
                              </div>
                              <p className="text-[10px] text-muted-foreground mt-0.5">{logged} / {item.qty} {item.unit} done</p>
                            </div>
                          )}
                          {hasSizes && (
                            <div className="px-4 py-2 border-t border-border/30">
                              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Sizes</p>
                              <div className="space-y-0.5">
                                {item.sizes.map(s => (
                                  <div key={s.label} className="flex items-center justify-between text-xs">
                                    <span className="text-muted-foreground truncate mr-2">{s.label}</span>
                                    <span className="font-semibold text-foreground tabular-nums shrink-0">{s.qty}&times;</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          {hasOrders && (
                            <div className="px-4 py-2 border-t border-border/30">
                              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Orders</p>
                              <div className="space-y-0.5">
                                {item.orders.map(o => (
                                  <div key={o.customer} className="flex items-center justify-between text-xs">
                                    <span className="text-muted-foreground truncate mr-2">{o.customer}</span>
                                    <span className="font-semibold text-foreground tabular-nums shrink-0">{o.qty}&times;</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          {hasPkg && (
                            <div className="px-4 py-2 border-t border-border/30">
                              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Packaging</p>
                              <div className="flex flex-wrap gap-1">
                                {item.packaging.map(p => (
                                  <span key={p.label} className="inline-flex items-center gap-1 text-[10px] font-medium bg-[#256984]/10 text-[#256984] rounded-full px-2 py-0.5">
                                    {p.label} &times;{p.qty}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    };
                    return (
                      <div className="space-y-4">
                        {CATEGORY_ORDER.filter(cat => grouped[cat]?.length).map(cat => (
                          <div key={cat}>
                            <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5 px-1">{cat}</p>
                            <div className="space-y-2">
                              {grouped[cat].map(renderRecipeCard)}
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              </div>

              {/* Empty state — no recipes or sub-recipes */}
              {(prepComputed.recipes?.length ?? 0) === 0 && (prepComputed.subRecipes?.length ?? 0) === 0 && (
                <div className="text-center py-12 text-muted-foreground">
                  <AlertCircle className="mx-auto mb-2 opacity-40" size={36} />
                  <p className="font-semibold">No recipes linked to these orders</p>
                  <p className="text-sm mt-1">Link recipes to products on the Products page first.</p>
                </div>
              )}
            </>
          )}

          {/* Log Prep section — always visible */}
          <div className="border-t border-border pt-4 mt-2">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                <ClipboardList size={15} className="text-[#256984]" />
                Today's Prep Log
              </h3>
              <Button
                size="sm"
                className="bg-[#256984] hover:bg-[#1e5570] text-white gap-1.5"
                onClick={() => { setLogForm(DEFAULT_LOG_FORM); setLogOpen(true); }}
              >
                <Plus size={13} /> Log Prep
              </Button>
            </div>

            {todayLogEntries.length === 0 ? (
              <p className="text-sm text-muted-foreground italic text-center py-4">No prep logged today yet</p>
            ) : (
              <div className="bg-card border border-border rounded-xl overflow-hidden">
                <div className="divide-y divide-border/50">
                  {todayLogEntries.map(entry => (
                    <div key={entry.id} className="flex items-center gap-3 px-3 py-2.5">
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-semibold text-foreground block truncate">{entry.itemName}</span>
                        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                          <span className="text-xs font-bold text-[#256984]">{entry.quantity} {entry.unit}</span>
                          <span className="text-xs text-muted-foreground">·</span>
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <User size={10} />{entry.staffName || "Unknown"}
                          </span>
                          <span className="text-xs text-muted-foreground">·</span>
                          <span className="text-xs text-muted-foreground">
                            {new Date(entry.loggedAt).toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" })}
                          </span>
                        </div>
                        {entry.notes && <span className="text-xs text-muted-foreground italic mt-0.5 block">{entry.notes}</span>}
                      </div>
                      <button
                        onClick={() => deleteLogMutation.mutate(entry.id)}
                        className="text-muted-foreground hover:text-red-500 transition-colors shrink-0 p-1"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─────────── STOCK ON HAND TAB ─────────── */}
      {tab === "stock" && (
        <div className="space-y-4">
          {/* Header with Log Prep button */}
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">Populated automatically from logged prep. Use Log Prep to add stock.</p>
            <Button
              size="sm"
              className="bg-[#256984] hover:bg-[#1e5570] text-white shrink-0"
              onClick={() => { setLogForm(DEFAULT_LOG_FORM); setLogOpen(true); }}
            >
              <Plus size={13} className="mr-1" /> Log Prep
            </Button>
          </div>

          {/* Stock list */}
          {stockItems.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Package className="mx-auto mb-3 opacity-30" size={40} />
              <p className="font-semibold text-foreground">No stock on hand</p>
              <p className="text-sm mt-1">Log prep above or use the Log Prep button — stock auto-populates from prep logs</p>
            </div>
          ) : (
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2.5 bg-muted/40 border-b border-border">
                <span className="text-xs font-semibold text-foreground">{stockItems.length} item{stockItems.length !== 1 ? "s" : ""} in stock</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs text-red-500 hover:text-red-600 hover:bg-red-50"
                  onClick={() => { if (confirm("Clear all stock on hand?")) clearStockMutation.mutate(); }}
                >
                  <Trash2 size={12} className="mr-1" /> Clear all
                </Button>
              </div>
              <div className="divide-y divide-border/50">
                {stockItems.map(item => (
                  <div key={item.id} className="flex items-center gap-3 px-4 py-2.5">
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-semibold text-foreground block truncate">{item.item_name}</span>
                      {editingStockId === item.id ? (
                        <div className="flex items-center gap-1.5 mt-1">
                          <Input
                            type="number"
                            value={editingStockQty}
                            onChange={e => setEditingStockQty(e.target.value)}
                            className="h-7 w-20 text-xs"
                            min="0"
                            autoFocus
                          />
                          <span className="text-xs text-muted-foreground">{item.unit}</span>
                          <Button size="sm" className="h-7 text-xs bg-[#256984] hover:bg-[#1e5570] text-white px-2"
                            onClick={() => {
                              const qty = parseFloat(editingStockQty);
                              if (!isNaN(qty)) updateStockMutation.mutate({ id: item.id, quantity: qty });
                            }}>Save</Button>
                          <Button size="sm" variant="ghost" className="h-7 text-xs px-2"
                            onClick={() => setEditingStockId(null)}>Cancel</Button>
                        </div>
                      ) : (
                        <span className="text-xs font-bold text-[#256984]">{item.quantity} {item.unit}</span>
                      )}
                    </div>
                    {editingStockId !== item.id && (
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          className="p-1.5 text-muted-foreground hover:text-[#256984] transition-colors"
                          onClick={() => { setEditingStockId(item.id); setEditingStockQty(item.quantity.toString()); }}
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          className="p-1.5 text-muted-foreground hover:text-red-500 transition-colors"
                          onClick={() => deleteStockMutation.mutate(item.id)}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─────────── LOG PREP DIALOG ─────────── */}
      {/* ── Quick-Log Sheet (inline tick-off from prep list) ── */}
      <Sheet open={quickLogOpen} onOpenChange={v => { if (!v) setQuickLogOpen(false); }}>
        <SheetContent side="bottom" className="rounded-t-2xl pb-8">
          <SheetHeader className="mb-4">
            <SheetTitle className="text-base">{quickLogItem?.name}</SheetTitle>
          </SheetHeader>
          <div className="space-y-4">
            {/* Staff picker */}
            <div>
              <Label className="text-xs font-semibold text-muted-foreground mb-1 block">Who made it?</Label>
              <Select value={quickLogStaffId} onValueChange={val => {
                const emp = staff.find((s: StaffMember) => String(s.id) === val);
                setQuickLogStaffId(val);
                setQuickLogStaffName(emp?.name ?? val);
              }}>
                <SelectTrigger>
                  <SelectValue placeholder="Select staff member" />
                </SelectTrigger>
                <SelectContent>
                  {staff.map((s: StaffMember) => (
                    <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {/* Quantity */}
            <div>
              <Label className="text-xs font-semibold text-muted-foreground mb-1 block">
                Quantity {quickLogItem?.unit ? `(${quickLogItem.unit})` : ""}
              </Label>
              <Input
                type="number"
                min="0"
                step="0.1"
                value={quickLogQty}
                onChange={e => setQuickLogQty(e.target.value)}
                placeholder={quickLogItem ? String(Math.max(0, quickLogItem.remaining).toFixed(quickLogItem.unit === 'each' ? 0 : 2)) : "0"}
                className="text-base"
                autoFocus
              />
            </div>
            <Button
              className="w-full bg-[#256984] hover:bg-[#1d5570] text-white"
              disabled={!quickLogStaffId || !quickLogQty || parseFloat(quickLogQty) <= 0 || logMutation.isPending}
              onClick={() => {
                if (!quickLogItem || !quickLogStaffId || !quickLogQty) return;
                logMutation.mutate({
                  itemType: quickLogItem.type,
                  itemId: quickLogItem.id,
                  itemName: quickLogItem.name,
                  quantity: parseFloat(quickLogQty),
                  unit: quickLogItem.unit || 'each',
                  staffId: parseInt(quickLogStaffId) || null,
                  staffName: quickLogStaffName,
                  notes: null,
                }, {
                  onSuccess: () => {
                    setQuickLogOpen(false);
                    setQuickLogQty("");
                    toast({ title: "Prep logged", description: `${quickLogItem.name} recorded` });
                  },
                });
              }}
            >
              {logMutation.isPending ? <Loader2 className="animate-spin mr-2" size={16} /> : <Check size={16} className="mr-2" />}
              Log Prep
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      <Dialog open={logOpen} onOpenChange={v => { if (!v) { setLogOpen(false); setLogForm(DEFAULT_LOG_FORM); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <ClipboardList size={16} className="text-[#256984]" />
              Log Prep
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* Smart search — sub-recipes + recipes combined */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Recipe / Sub-Recipe <span className="text-red-500">*</span></Label>
              <SearchableSelect
                value={logForm.itemValue}
                onValueChange={val => {
                  const [type, idStr] = val.split(":");
                  const id = parseInt(idStr);
                  const opt = logSearchOptions.find(o => o.value === val);
                  // For recipes: auto-set unit to "each" and qty to portion_count (default 1)
                  let autoUnit = logForm.unit;
                  let autoQty = logForm.quantity;
                  if (type === "recipe") {
                    const recipe = (recipesData ?? []).find((r: any) => r.id === id);
                    autoUnit = "each";
                    autoQty = String(recipe?.portion_count ?? 1);
                  }
                  setLogForm(f => ({
                    ...f,
                    itemValue: val,
                    itemType: type,
                    itemId: id,
                    itemName: opt?.label ?? "",
                    unit: autoUnit,
                    quantity: autoQty,
                  }));
                }}
                options={logSearchOptions}
                placeholder="Search sub-recipes & recipes…"
              />
            </div>

            {/* Quantity + Unit */}
            <div className="flex gap-2">
              <div className="flex-1 space-y-1.5">
                <Label className="text-xs font-medium">Quantity <span className="text-red-500">*</span></Label>
                <Input
                  type="number"
                  min="0"
                  step="any"
                  placeholder="0.00"
                  value={logForm.quantity}
                  onChange={e => setLogForm(f => ({ ...f, quantity: e.target.value }))}
                  className="h-9 text-sm"
                />
              </div>
              <div className="w-28 space-y-1.5">
                <Label className="text-xs font-medium">Unit</Label>
                <Select value={logForm.unit} onValueChange={val => setLogForm(f => ({ ...f, unit: val }))}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PREP_LOG_UNITS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Staff */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Staff Member <span className="text-red-500">*</span></Label>
              <Select
                value={logForm.staffId}
                onValueChange={val => {
                  const emp = staff.find(s => s.id.toString() === val);
                  setLogForm(f => ({ ...f, staffId: val, staffName: emp?.name ?? val }));
                }}
              >
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder={staff.length === 0 ? "No staff on roster" : "Select staff member"} />
                </SelectTrigger>
                <SelectContent>
                  {staff.map(s => <SelectItem key={s.id} value={s.id.toString()}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {/* Notes (optional) */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Notes <span className="text-muted-foreground">(optional)</span></Label>
              <Textarea
                placeholder="Any notes about this prep…"
                value={logForm.notes}
                onChange={e => setLogForm(f => ({ ...f, notes: e.target.value }))}
                className="text-sm resize-none h-16"
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => { setLogOpen(false); setLogForm(DEFAULT_LOG_FORM); }}>Cancel</Button>
            <Button
              size="sm"
              className="bg-[#256984] hover:bg-[#1e5570] text-white"
              disabled={logMutation.isPending}
              onClick={handleLogSubmit}
            >
              {logMutation.isPending ? <RefreshCw size={13} className="animate-spin mr-1" /> : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
