import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ShoppingCart,
  Plus,
  Trash2,
  Printer,
  ChevronDown,
  ChevronRight,
  Check,
  X,
  ClipboardList,
  ArrowLeft,
  Send,
  Truck,
  Clock,
  CheckCircle2,
  AlertCircle,
  Search,
  Minus,
  Package,
  Tag,
  List,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Ingredient {
  id: number;
  name: string;
  category?: string;
  unit?: string;
  bestSupplierId?: number;
  bestSupplierName?: string;
}

interface Supplier {
  id: number;
  name: string;
}

interface DraftOrder {
  id: number;
  name: string;
  status: string;
  notes?: string;
  created_at: string;
  updated_at: string;
}

interface SupplierItem {
  id: number;
  draft_id: number;
  supplier_key: string;
  item_key: string;
  section_key: string;
  item_name: string;
  qty: number;
  received_qty?: number;
  notes?: string;
}

// ─── Status Config ────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; icon: any }> = {
  draft:     { label: "Draft",     color: "#92400E", bg: "#FEF3C7", icon: Clock },
  submitted: { label: "Submitted", color: "#1E5470", bg: "#DBEAFE", icon: Send },
  received:  { label: "Received",  color: "#166534", bg: "#DCFCE7", icon: CheckCircle2 },
  partial:   { label: "Partial",   color: "#7C2D12", bg: "#FFEDD5", icon: AlertCircle },
  cancelled: { label: "Cancelled", color: "#6B7280", bg: "#F3F4F6", icon: X },
};

// Brand blue for primary actions
const BRAND = "#256984";
const BRAND_LIGHT = "#EBF4F8";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleDateString("en-AU", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

function itemKey(ingredientId: number) {
  return `ingredient::${ingredientId}`;
}

// ─── Status Badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.draft;
  const Icon = cfg.icon;
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
      style={{ color: cfg.color, backgroundColor: cfg.bg }}
    >
      <Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  );
}

// ─── Qty Stepper ──────────────────────────────────────────────────────────────

function QtyInput({
  value,
  onChange,
  unit,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  unit?: string;
  disabled?: boolean;
}) {
  const num = parseFloat(value) || 0;
  const hasVal = num > 0;

  const decrement = () => {
    const next = Math.max(0, num - 1);
    onChange(next === 0 ? "" : String(next));
  };
  const increment = () => onChange(String(num + 1));

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        disabled={disabled || num === 0}
        onClick={decrement}
        className="w-9 h-9 flex items-center justify-center rounded-lg border transition-colors touch-manipulation disabled:opacity-30"
        style={hasVal ? { borderColor: BRAND, color: BRAND } : { borderColor: "#E5E7EB", color: "#9CA3AF" }}
      >
        <Minus className="w-3.5 h-3.5" />
      </button>
      <input
        type="number"
        min="0"
        step="1"
        value={value}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
        placeholder="0"
        className="w-14 h-9 text-center text-sm font-semibold rounded-lg border outline-none transition-all"
        style={hasVal
          ? { borderColor: BRAND, color: BRAND, backgroundColor: "white" }
          : { borderColor: "#E5E7EB", color: "#374151" }
        }
      />
      <button
        type="button"
        disabled={disabled}
        onClick={increment}
        className="w-9 h-9 flex items-center justify-center rounded-lg border transition-colors touch-manipulation"
        style={hasVal
          ? { borderColor: BRAND, backgroundColor: BRAND, color: "white" }
          : { borderColor: "#E5E7EB", color: "#374151", backgroundColor: "white" }
        }
      >
        <Plus className="w-3.5 h-3.5" />
      </button>
      {unit && <span className="text-xs text-gray-400 ml-0.5">{unit}</span>}
    </div>
  );
}

// ─── Ingredient Selection Dialog ───────────────────────────────────────────────

type FilterTab = "all" | "supplier" | "category";

type FilterMode = "all" | "supplier" | "category";

function OrderScopeDialog({
  open,
  onClose,
  ingredients,
  suppliers,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  ingredients: Ingredient[];
  suppliers: Supplier[];
  onConfirm: (selected: Ingredient[]) => void;
}) {
  const [mode, setMode] = useState<FilterMode>("all");
  const [selectedSuppliers, setSelectedSuppliers] = useState<number[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);

  const allCategories = Array.from(
    new Set(ingredients.map(i => i.category || "Uncategorised"))
  ).sort();

  const toggleSupplier = (id: number) =>
    setSelectedSuppliers(prev => prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]);

  const toggleCategory = (cat: string) =>
    setSelectedCategories(prev => prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]);

  const previewCount = (() => {
    if (mode === "all") return ingredients.length;
    if (mode === "supplier") {
      if (selectedSuppliers.length === 0) return 0;
      return ingredients.filter(i => selectedSuppliers.includes(i.bestSupplierId || -1)).length;
    }
    if (selectedCategories.length === 0) return 0;
    return ingredients.filter(i => selectedCategories.includes(i.category || "Uncategorised")).length;
  })();

  const canConfirm =
    mode === "all" ||
    (mode === "supplier" && selectedSuppliers.length > 0) ||
    (mode === "category" && selectedCategories.length > 0);

  const handleConfirm = () => {
    let selected: Ingredient[];
    if (mode === "all") {
      selected = ingredients;
    } else if (mode === "supplier") {
      selected = ingredients.filter(i => selectedSuppliers.includes(i.bestSupplierId || -1));
    } else {
      selected = ingredients.filter(i => selectedCategories.includes(i.category || "Uncategorised"));
    }
    onConfirm(selected);
    onClose();
  };

  const modes: { key: FilterMode; label: string; icon: any }[] = [
    { key: "all",      label: "All Ingredients", icon: List },
    { key: "supplier", label: "By Supplier",     icon: Package },
    { key: "category", label: "By Category",     icon: Tag },
  ];

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle style={{ color: BRAND }}>What would you like to order?</DialogTitle>
        </DialogHeader>

        {/* Mode toggle */}
        <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
          {modes.map(m => {
            const Icon = m.icon;
            return (
              <button
                key={m.key}
                onClick={() => setMode(m.key)}
                className="flex-1 flex flex-col items-center gap-1 py-2 px-1 rounded-md transition-all text-xs font-medium"
                style={mode === m.key
                  ? { backgroundColor: "white", color: BRAND, boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }
                  : { color: "#6B7280" }
                }
              >
                <Icon className="w-4 h-4" />
                {m.label}
              </button>
            );
          })}
        </div>

        {/* All — no extra UI needed */}
        {mode === "all" && (
          <p className="text-sm text-gray-500 text-center py-2">
            An order sheet will be generated for all {ingredients.length} ingredients.
          </p>
        )}

        {/* Supplier checkboxes */}
        {mode === "supplier" && (
          <div className="space-y-2 mt-1">
            <p className="text-xs text-gray-500 font-medium">Select suppliers to include:</p>
            {suppliers.map(sup => {
              const ingCount = ingredients.filter(i => i.bestSupplierId === sup.id).length;
              if (ingCount === 0) return null;
              const checked = selectedSuppliers.includes(sup.id);
              return (
                <label
                  key={sup.id}
                  className="flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer hover:bg-gray-50 transition-colors"
                  style={checked ? { borderColor: BRAND, backgroundColor: BRAND_LIGHT } : { borderColor: "#E5E7EB" }}
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={() => toggleSupplier(sup.id)}
                  />
                  <span className="flex-1 text-sm font-medium text-gray-800">{sup.name}</span>
                  <span className="text-xs text-gray-400">{ingCount} items</span>
                </label>
              );
            })}
          </div>
        )}

        {/* Category checkboxes */}
        {mode === "category" && (
          <div className="space-y-2 mt-1 max-h-64 overflow-y-auto pr-1">
            <p className="text-xs text-gray-500 font-medium">Select categories to include:</p>
            {allCategories.map(cat => {
              const ingCount = ingredients.filter(i => (i.category || "Uncategorised") === cat).length;
              const checked = selectedCategories.includes(cat);
              return (
                <label
                  key={cat}
                  className="flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer hover:bg-gray-50 transition-colors"
                  style={checked ? { borderColor: BRAND, backgroundColor: BRAND_LIGHT } : { borderColor: "#E5E7EB" }}
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={() => toggleCategory(cat)}
                  />
                  <span className="flex-1 text-sm font-medium text-gray-800">{cat}</span>
                  <span className="text-xs text-gray-400">{ingCount} items</span>
                </label>
              );
            })}
          </div>
        )}

        {/* Preview count */}
        {canConfirm && previewCount > 0 && (
          <p className="text-xs text-center" style={{ color: BRAND }}>
            {previewCount} ingredient{previewCount !== 1 ? "s" : ""} will be added to the order sheet
          </p>
        )}

        {/* Footer */}
        <div className="flex gap-2 pt-1">
          <Button variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
          <Button
            className="flex-1 text-white gap-1.5"
            style={{ backgroundColor: canConfirm ? BRAND : "#D1D5DB" }}
            disabled={!canConfirm}
            onClick={handleConfirm}
          >
            <Check className="w-4 h-4" />
            Generate Order
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function OrderForm({
  draft,
  items,
  ingredients,
  onSaveItem,
  onAddIngredients,
  disabled,
  receivingMode,
}: {
  draft: DraftOrder;
  items: SupplierItem[];
  ingredients: Ingredient[];
  onSaveItem: (item: SupplierItem, qty: number | null, receivedQty?: number) => void;
  onAddIngredients: () => void;
  disabled?: boolean;
  receivingMode?: boolean;
}) {
  const [localQty, setLocalQty] = useState<Record<string, string>>({});
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const ingMap: Record<number, Ingredient> = {};
  ingredients.forEach(i => { ingMap[i.id] = i; });

  // Sync from server items
  useEffect(() => {
    const map: Record<string, string> = {};
    items.forEach(it => {
      const field = receivingMode ? (it.received_qty ?? it.qty) : it.qty;
      map[it.item_key] = (field || 0) > 0 ? String(field) : "";
    });
    setLocalQty(map);
  }, [items, receivingMode]);

  // Group items by supplier (using bestSupplierName from ingredient)
  const grouped: Record<string, { item: SupplierItem; ing?: Ingredient }[]> = {};
  items.forEach(serverItem => {
    const match = serverItem.item_key.match(/^ingredient::(\d+)$/);
    const ing = match ? ingMap[Number(match[1])] : undefined;
    const group = ing?.bestSupplierName || serverItem.section_key || "Other";
    if (!grouped[group]) grouped[group] = [];
    grouped[group].push({ item: serverItem, ing });
  });

  const handleChange = useCallback((item: SupplierItem, value: string) => {
    setLocalQty(prev => ({ ...prev, [item.item_key]: value }));
    clearTimeout(saveTimers.current[item.item_key]);
    saveTimers.current[item.item_key] = setTimeout(() => {
      const qty = parseFloat(value);
      const n = isNaN(qty) ? 0 : qty;
      if (receivingMode) {
        onSaveItem(item, null, n);
      } else {
        onSaveItem(item, n);
      }
    }, 600);
  }, [onSaveItem, receivingMode]);

  const toggleGroup = (grp: string) => {
    setCollapsedGroups(p => ({ ...p, [grp]: !p[grp] }));
  };

  const filledCount = items.filter(i => (i.qty || 0) > 0).length;

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
        <Package className="w-12 h-12 text-gray-200 mb-4" />
        <p className="text-gray-500 font-medium mb-1">No items added yet</p>
        <p className="text-sm text-gray-400 mb-5">
          Tap below to choose ingredients to include in this order
        </p>
        {!disabled && (
          <Button
            onClick={onAddIngredients}
            className="text-white gap-1.5"
            style={{ backgroundColor: BRAND }}
          >
            <Plus className="w-4 h-4" />
            Add Ingredients
          </Button>
        )}
      </div>
    );
  }

  return (
    <div>
      {/* Progress */}
      <div
        className="px-4 py-2 border-b flex items-center justify-between text-xs text-gray-500"
        style={{ backgroundColor: BRAND_LIGHT }}
      >
        <span>{filledCount} / {items.length} items with quantities</span>
        <div className="w-28 h-1.5 rounded-full bg-gray-200 overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: items.length > 0 ? `${(filledCount / items.length) * 100}%` : "0%",
              backgroundColor: BRAND,
            }}
          />
        </div>
      </div>

      {/* Add more button */}
      {!disabled && (
        <div className="px-4 py-2 border-b">
          <button
            onClick={onAddIngredients}
            className="flex items-center gap-1.5 text-sm font-medium"
            style={{ color: BRAND }}
          >
            <Plus className="w-3.5 h-3.5" />
            Add / edit ingredients
          </button>
        </div>
      )}

      {/* Grouped items */}
      {Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)).map(([group, groupItems]) => {
        const isCollapsed = collapsedGroups[group];
        const groupFilled = groupItems.filter(({ item }) => (parseFloat(localQty[item.item_key] || "0") || 0) > 0).length;
        const allDone = groupFilled === groupItems.length;

        return (
          <div key={group} className="border-b last:border-b-0">
            <button
              className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-gray-50 transition-colors"
              onClick={() => toggleGroup(group)}
            >
              <div className="flex items-center gap-2">
                {isCollapsed
                  ? <ChevronRight className="w-4 h-4 text-gray-400" />
                  : <ChevronDown className="w-4 h-4 text-gray-400" />
                }
                <span className="text-sm font-semibold text-gray-700">{group}</span>
                <span className="text-xs text-gray-400">({groupItems.length})</span>
                {groupFilled > 0 && (
                  <span
                    className="text-xs px-1.5 py-0.5 rounded-full font-medium"
                    style={{ color: BRAND, backgroundColor: BRAND_LIGHT }}
                  >
                    {groupFilled}
                  </span>
                )}
              </div>
              {allDone && (
                <span className="flex items-center gap-1 text-xs" style={{ color: BRAND }}>
                  <CheckCircle2 className="w-3.5 h-3.5" /> Done
                </span>
              )}
            </button>

            {!isCollapsed && (
              <div className="divide-y divide-gray-50">
                {groupItems.map(({ item, ing }) => {
                  const val = localQty[item.item_key] ?? "";
                  const hasVal = (parseFloat(val) || 0) > 0;

                  return (
                    <div
                      key={item.item_key}
                      className="flex items-center justify-between px-4 py-2.5 transition-colors"
                      style={hasVal ? { backgroundColor: BRAND_LIGHT + "60" } : {}}
                    >
                      <div className="flex items-center gap-2 flex-1 min-w-0 mr-3">
                        {hasVal
                          ? <Check className="w-3.5 h-3.5 shrink-0" style={{ color: BRAND }} />
                          : <div className="w-3.5 h-3.5 shrink-0" />
                        }
                        <div className="min-w-0">
                          <span
                            className="text-sm block truncate"
                            style={hasVal ? { color: BRAND, fontWeight: 500 } : { color: "#374151" }}
                          >
                            {item.item_name}
                          </span>
                          {receivingMode && (item.qty || 0) > 0 && (
                            <span className="text-xs text-gray-400">
                              ordered: {item.qty} {ing?.unit || ""}
                            </span>
                          )}
                        </div>
                      </div>
                      <QtyInput
                        value={val}
                        onChange={v => handleChange(item, v)}
                        unit={ing?.unit}
                        disabled={disabled}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Print View ───────────────────────────────────────────────────────────────

function PrintView({ draft, items, ingredients }: { draft: DraftOrder; items: SupplierItem[]; ingredients: Ingredient[] }) {
  const ingMap: Record<number, Ingredient> = {};
  ingredients.forEach(i => { ingMap[i.id] = i; });

  const date = new Date().toLocaleDateString("en-AU", {
    weekday: "long", day: "2-digit", month: "long", year: "numeric",
  });

  const filledItems = items.filter(i => (i.qty || 0) > 0);

  // Group by supplier
  const grouped: Record<string, typeof filledItems> = {};
  filledItems.forEach(it => {
    const match = it.item_key.match(/^ingredient::(\d+)$/);
    const ing = match ? ingMap[Number(match[1])] : undefined;
    const group = ing?.bestSupplierName || it.section_key || "Other";
    if (!grouped[group]) grouped[group] = [];
    grouped[group].push(it);
  });

  return (
    <div className="space-y-5">
      <div className="border-b pb-3">
        <h2 className="text-lg font-bold" style={{ color: BRAND }}>{draft.name}</h2>
        <p className="text-sm text-gray-500">{date}</p>
        <StatusBadge status={draft.status} />
      </div>

      {Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)).map(([group, groupItems]) => (
        <div key={group} className="border rounded-lg overflow-hidden" style={{ borderColor: BRAND }}>
          <div className="px-4 py-2 text-white font-semibold" style={{ backgroundColor: BRAND }}>
            {group}
          </div>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-gray-100">
              {groupItems.map((it, i) => {
                const match = it.item_key.match(/^ingredient::(\d+)$/);
                const ing = match ? ingMap[Number(match[1])] : undefined;
                return (
                  <tr key={it.id} className={i % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                    <td className="px-4 py-2 text-gray-800 font-medium">{it.item_name}</td>
                    <td className="px-4 py-2 text-right font-bold" style={{ color: BRAND }}>
                      {it.qty} {ing?.unit || ""}
                    </td>
                    <td className="px-4 py-2 w-16 text-right">
                      {/* received qty box for printing */}
                      <span className="inline-block border border-gray-300 rounded w-12 h-6" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}

      {filledItems.length === 0 && (
        <p className="text-center text-gray-400 py-8">No items with quantities to print.</p>
      )}

      <div className="border-t pt-4 text-xs text-gray-400 flex justify-between">
        <span>The Deli by Greenhorns — Stock Order</span>
        <span>Printed {date}</span>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function StockOrder() {
  const qc = useQueryClient();

  const [view, setView] = useState<"list" | "order">("list");
  const [activeDraftId, setActiveDraftId] = useState<number | null>(null);
  const [listTab, setListTab] = useState<"active" | "history">("active");
  const [newOrderDialog, setNewOrderDialog] = useState(false);
  const [newOrderName, setNewOrderName] = useState("");
  const [printDialog, setPrintDialog] = useState(false);
  const [selectDialog, setSelectDialog] = useState(false);
  const [receivingMode, setReceivingMode] = useState(false);

  // ── Data ───────────────────────────────────────────────────────────────────

  const { data: ingredients = [] } = useQuery<Ingredient[]>({
    queryKey: ["/api/ingredients"],
  });

  const { data: suppliers = [] } = useQuery<Supplier[]>({
    queryKey: ["/api/suppliers"],
  });

  const { data: drafts = [] } = useQuery<DraftOrder[]>({
    queryKey: ["/api/stock-order/drafts"],
  });

  const { data: supplierItems = [], isLoading: itemsLoading } = useQuery<SupplierItem[]>({
    queryKey: ["/api/stock-order/drafts", activeDraftId, "supplier-items"],
    queryFn: () =>
      activeDraftId
        ? apiRequest("GET", `/api/stock-order/drafts/${activeDraftId}/supplier-items`).then(r => r.json())
        : Promise.resolve([]),
    enabled: !!activeDraftId,
  });

  // ── Derived ────────────────────────────────────────────────────────────────

  const activeDraft = drafts.find(d => d.id === activeDraftId);
  const isDraft = activeDraft?.status === "draft";
  const isReadonly = activeDraft && !["draft"].includes(activeDraft.status) && !receivingMode;

  const activeOrders = drafts.filter(d => ["draft", "submitted"].includes(d.status));
  const historyOrders = drafts.filter(d => ["received", "partial", "cancelled"].includes(d.status));

  const totalFilledItems = supplierItems.filter(i => (i.qty || 0) > 0).length;

  // ── Mutations ──────────────────────────────────────────────────────────────

  const createDraft = useMutation({
    mutationFn: (name: string) =>
      apiRequest("POST", "/api/stock-order/drafts", { name }).then(r => r.json()),
    onSuccess: (data: DraftOrder) => {
      qc.invalidateQueries({ queryKey: ["/api/stock-order/drafts"] });
      setActiveDraftId(data.id);
      setView("order");
      setNewOrderDialog(false);
      setNewOrderName("");
      // Immediately open the ingredient picker
      setTimeout(() => setSelectDialog(true), 300);
    },
  });

  const deleteDraft = useMutation({
    mutationFn: (id: number) =>
      apiRequest("DELETE", `/api/stock-order/drafts/${id}`).then(r => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/stock-order/drafts"] }),
  });

  const updateStatus = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      apiRequest("PATCH", `/api/stock-order/drafts/${id}/status`, { status }).then(r => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/stock-order/drafts"] }),
  });

  const saveItem = useMutation({
    mutationFn: (payload: any) =>
      apiRequest("PUT", `/api/stock-order/drafts/${activeDraftId}/supplier-items`, payload).then(r => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/stock-order/drafts", activeDraftId, "supplier-items"] });
    },
  });

  const handleSaveItem = useCallback((item: SupplierItem, qty: number | null, receivedQty?: number) => {
    if (!activeDraftId) return;
    const payload: any = {
      supplierKey: item.supplier_key || "ingredient",
      itemKey: item.item_key,
      sectionKey: item.section_key,
      itemName: item.item_name,
    };
    if (qty !== null) payload.qty = qty;
    if (receivedQty !== undefined) payload.receivedQty = receivedQty;
    saveItem.mutate(payload);
  }, [activeDraftId, saveItem]);

  // When ingredients are confirmed from the selector, upsert them all
  const handleIngredientsConfirmed = useCallback((selected: Ingredient[]) => {
    if (!activeDraftId) return;

    // Add new ones (don't remove existing)
    selected.forEach(ing => {
      const key = `ingredient::${ing.id}`;
      const existing = supplierItems.find(i => i.item_key === key);
      if (!existing) {
        saveItem.mutate({
          supplierKey: ing.bestSupplierName || "other",
          itemKey: key,
          sectionKey: ing.bestSupplierName || "other",
          itemName: ing.name,
          qty: 0,
        });
      }
    });

    // Remove deselected ones (set qty to 0 to delete)
    supplierItems.forEach(existing => {
      const match = existing.item_key.match(/^ingredient::(\d+)$/);
      if (!match) return;
      const ingId = Number(match[1]);
      const stillSelected = selected.some(s => s.id === ingId);
      if (!stillSelected) {
        saveItem.mutate({
          supplierKey: existing.supplier_key,
          itemKey: existing.item_key,
          sectionKey: existing.section_key,
          itemName: existing.item_name,
          qty: 0,
        });
      }
    });
  }, [activeDraftId, supplierItems, saveItem]);

  // ── Open order ─────────────────────────────────────────────────────────────

  const openOrder = (draft: DraftOrder) => {
    setActiveDraftId(draft.id);
    setReceivingMode(draft.status === "submitted");
    setView("order");
  };

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER — ORDER LIST
  // ─────────────────────────────────────────────────────────────────────────

  if (view === "list") {
    const displayDrafts = listTab === "active" ? activeOrders : historyOrders;

    return (
      <div className="p-4 max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <ShoppingCart className="w-5 h-5" style={{ color: BRAND }} />
            <h1 className="text-xl font-bold" style={{ color: BRAND }}>Stock Ordering</h1>
          </div>
          <Button
            onClick={() => setNewOrderDialog(true)}
            className="gap-1.5 text-white"
            style={{ backgroundColor: BRAND }}
          >
            <Plus className="w-4 h-4" />
            New Order
          </Button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-gray-100 p-1 rounded-lg mb-4">
          {(["active", "history"] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setListTab(tab)}
              className="flex-1 py-1.5 text-sm font-medium rounded-md transition-all capitalize"
              style={listTab === tab
                ? { backgroundColor: "white", color: BRAND, boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }
                : { color: "#6B7280" }
              }
            >
              {tab}
              {tab === "active" && activeOrders.length > 0 && (
                <span className="ml-1.5 text-xs px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700">
                  {activeOrders.length}
                </span>
              )}
            </button>
          ))}
        </div>

        {displayDrafts.length === 0 ? (
          <div className="text-center py-16 bg-gray-50 rounded-xl border-2 border-dashed border-gray-200">
            <ClipboardList className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-400 text-sm">
              {listTab === "active" ? "No active orders. Create one to get started." : "No completed orders yet."}
            </p>
            {listTab === "active" && (
              <Button
                className="mt-4 gap-1.5 text-white"
                style={{ backgroundColor: BRAND }}
                onClick={() => setNewOrderDialog(true)}
              >
                <Plus className="w-4 h-4" /> New Order
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {displayDrafts.map(draft => (
              <div
                key={draft.id}
                className="bg-white rounded-xl border border-gray-200 overflow-hidden cursor-pointer hover:shadow-md transition-all"
                style={{ borderLeft: `4px solid ${BRAND}` }}
                onClick={() => openOrder(draft)}
              >
                <div className="px-4 py-3 flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="font-semibold text-gray-800 truncate">{draft.name}</span>
                      <StatusBadge status={draft.status} />
                    </div>
                    <p className="text-xs text-gray-400">{formatDateTime(draft.updated_at)}</p>
                  </div>
                  <div className="flex items-center gap-2 ml-3">
                    <ChevronRight className="w-4 h-4 text-gray-400" />
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        if (confirm("Delete this order?")) deleteDraft.mutate(draft.id);
                      }}
                      className="w-7 h-7 flex items-center justify-center rounded-lg text-red-400 hover:bg-red-50 hover:text-red-600 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* New order dialog */}
        <Dialog open={newOrderDialog} onOpenChange={setNewOrderDialog}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle style={{ color: BRAND }}>New Stock Order</DialogTitle>
            </DialogHeader>
            <form
              onSubmit={e => {
                e.preventDefault();
                const name = newOrderName.trim() ||
                  `Stock Order ${new Date().toLocaleDateString("en-AU", { day: "2-digit", month: "short" })}`;
                createDraft.mutate(name);
              }}
              className="space-y-4"
            >
              <div>
                <label className="text-sm font-medium text-gray-700 block mb-1">Order name</label>
                <Input
                  value={newOrderName}
                  onChange={e => setNewOrderName(e.target.value)}
                  placeholder={`Stock Order ${new Date().toLocaleDateString("en-AU", { day: "2-digit", month: "short" })}`}
                  autoFocus
                />
              </div>
              <Button
                type="submit"
                className="w-full text-white"
                style={{ backgroundColor: BRAND }}
                disabled={createDraft.isPending}
              >
                <Plus className="w-4 h-4 mr-1.5" />
                Create & Select Ingredients
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER — ORDER FORM
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full max-w-3xl mx-auto">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-3 border-b bg-white sticky top-0 z-10">
        <button
          onClick={() => setView("list")}
          className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 transition-colors"
        >
          <ArrowLeft className="w-4 h-4 text-gray-600" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-bold text-gray-800 truncate">{activeDraft?.name}</h1>
          <div className="flex items-center gap-2">
            {activeDraft && <StatusBadge status={activeDraft.status} />}
            {totalFilledItems > 0 && (
              <span className="text-xs text-gray-400">{totalFilledItems} items</span>
            )}
            {receivingMode && (
              <span className="text-xs font-medium text-orange-600 bg-orange-50 px-2 py-0.5 rounded-full">
                Recording Delivery
              </span>
            )}
          </div>
        </div>
        <button
          onClick={() => setPrintDialog(true)}
          className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 transition-colors text-gray-500"
        >
          <Printer className="w-4 h-4" />
        </button>
      </div>

      {/* Order form */}
      <div className="flex-1 overflow-y-auto bg-white">
        {itemsLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-6 h-6 border-2 border-gray-200 border-t-gray-500 rounded-full animate-spin" />
          </div>
        ) : activeDraft ? (
          <OrderForm
            draft={activeDraft}
            items={supplierItems}
            ingredients={ingredients}
            onSaveItem={handleSaveItem}
            onAddIngredients={() => setSelectDialog(true)}
            disabled={!!isReadonly}
            receivingMode={receivingMode}
          />
        ) : null}
      </div>

      {/* Sticky footer */}
      <div className="border-t bg-white px-4 py-3">
        {receivingMode ? (
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setReceivingMode(false)}>
              Cancel
            </Button>
            <Button
              className="flex-1 text-white gap-1.5"
              style={{ backgroundColor: "#5AB693" }}
              onClick={() => {
                if (activeDraftId) {
                  updateStatus.mutate({ id: activeDraftId, status: "received" });
                  setReceivingMode(false);
                }
              }}
            >
              <CheckCircle2 className="w-4 h-4" />
              Mark Received
            </Button>
          </div>
        ) : isDraft ? (
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1 text-gray-600" onClick={() => setView("list")}>
              Save Draft
            </Button>
            <Button
              className="flex-1 text-white gap-1.5 transition-all"
              style={{
                backgroundColor: totalFilledItems > 0 ? BRAND : "#D1D5DB",
                cursor: totalFilledItems > 0 ? "pointer" : "not-allowed",
              }}
              onClick={() => {
                if (activeDraftId && totalFilledItems > 0) {
                  updateStatus.mutate({ id: activeDraftId, status: "submitted" });
                }
              }}
              disabled={totalFilledItems === 0 || updateStatus.isPending}
            >
              <Send className="w-4 h-4" />
              Submit Order ({totalFilledItems} items)
            </Button>
          </div>
        ) : activeDraft?.status === "submitted" ? (
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setView("list")}>
              Back
            </Button>
            <Button
              className="flex-1 text-white gap-1.5"
              style={{ backgroundColor: "#5AB693" }}
              onClick={() => setReceivingMode(true)}
            >
              <Truck className="w-4 h-4" />
              Record Delivery
            </Button>
          </div>
        ) : (
          <Button variant="outline" className="w-full" onClick={() => setView("list")}>
            Back to Orders
          </Button>
        )}
      </div>

      {/* Ingredient selection dialog */}
      <OrderScopeDialog
        open={selectDialog}
        onClose={() => setSelectDialog(false)}
        ingredients={ingredients}
        suppliers={suppliers}
        
        onConfirm={handleIngredientsConfirmed}
      />

      {/* Print dialog */}
      <Dialog open={printDialog} onOpenChange={setPrintDialog}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-center justify-between">
              <DialogTitle style={{ color: BRAND }}>Order Summary</DialogTitle>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                style={{ borderColor: BRAND, color: BRAND }}
                onClick={() => window.print()}
              >
                <Printer className="w-4 h-4" />
                Print / PDF
              </Button>
            </div>
          </DialogHeader>
          {activeDraft && (
            <PrintView draft={activeDraft} items={supplierItems} ingredients={ingredients} />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
