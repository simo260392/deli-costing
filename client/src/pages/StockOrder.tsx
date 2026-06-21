import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
  Package,
  ClipboardList,
  ArrowLeft,
  Send,
  Truck,
  Clock,
  CheckCircle2,
  AlertCircle,
  MoreHorizontal,
  Minus,
} from "lucide-react";

// ─── Supplier Data ────────────────────────────────────────────────────────────

const SUPPLIERS = [
  {
    key: "spudshed",
    name: "Spudshed",
    color: "#256984",       // Primary blue
    lightBg: "#EBF4F8",
    border: "#256984",
    textColor: "#256984",
    sections: {
      "Order": [
        "Grapes (Bag)", "Kiwi Fruit (Each)", "Avocados (Each)", "Carrots (5kg Bag)",
        "Potatoes (10kg Bag)", "Red Onion (kg)", "Ginger (fist sized)", "Blueberries (punnet)",
        "Dates (Bag)", "Green Beans Frozen (1kg bag)", "Frozen Blueberries (1kg bag)",
        "Frozen Strawberries (1kg bag)", "Frozen Mixed Berries (1kg bag)", "Sweet Potato (kg)",
        "Bacon (1kg)", "Kewpie Mayo", "Coconut Cream (carton of 24 tins)", "Curry Cubes",
        "Gnocchi", "Gochujang Paste", "Massaman Curry Paste", "Canola Oil Cooking Spray",
        "Oreos", "Rice (20kg Jasmine)", "Sushi Rice (5kg)", "Thai Green Curry Paste",
        "Yaki Nori Sushi Sheets", "Ham (1kg bag)", "Coke (carton of 30 cans)",
        "Coke No Sugar (carton of 30 cans)", "Fanta (carton of 24 cans)",
        "Sprite (carton of 24 cans)", "Raspberry Sparkling Mt Franklin (10 cans)",
        "Passionfruit Sparkling Mt Franklin (10 cans)",
      ],
    },
    freeText: true,
  },
  {
    key: "campbells",
    name: "Campbells",
    color: "#2D5B4A",       // Deep green
    lightBg: "#EAF2EE",
    border: "#2D5B4A",
    textColor: "#2D5B4A",
    sections: {
      "Food": [
        "Mozzarella Cheese (2kg Bag)", "Canola Oil (20L)", "Tasty Cheese Slices",
        "Cooking Salt", "Cous Cous (Carton of 8 packets)", "Greek Yoghurt (10L Tub)",
        "Beetroot Slices (1 x 2.5kg tin)", "Black Beans (1 x 2.5kg tin)", "Butter",
        "Butter Slices", "Caramel Slices", "Chick Peas (Carton of 6 x tins)",
        "Chocolate Cake Mix", "Icing Sugar Mix", "Jalapenos (1 x 2.5kg tin)", "Lentils",
        "Oats", "Olives", "Raw Sugar", "Roast Pepper Strips (Carton of 3 x 4.2kg tins)",
        "Tandoori Paste", "White Vinegar",
      ],
      "Syrups": [
        "Vanilla Syrup", "Caramel Syrup", "Hazelnut Syrup",
      ],
      "Packaging & Cleaning": [
        "Bin Bags", "Bamboo Skewers", "1000ml Round Healthy Bowl Containers (Sleeve of 50)",
        "1000ml Round Healthy Bowl Lids (Sleeve of 50)", "Catering Sauce Pots (Sleeve of 50)",
        "Catering Sauce Pot Lids (Sleeve of 50)", "Dishwizz", "Floor Cleaner",
        "Grill Cleaner", "Hand Dispenser Tissues", "Mop Head", "Sanitiser Spray & Wipe",
        "Sparkling Dishwashing Detergent", "Thermal Till Roll", "Top Rinse Aid",
        "Vinyl Gloves Medium", "Vinyl Gloves Large", "Vinyl Gloves XL",
      ],
      "Drinks": [
        "Coconut Water Cans", "Coconut Water Bottles 1L",
        "Red Bull 250ml Cans", "Red Bull Sugar Free 250ml Cans",
      ],
    },
    freeText: true,
  },
  {
    key: "markets",
    name: "Fruit & Veg Markets",
    color: "#5AB693",       // Bright green
    lightBg: "#EDF7F2",
    border: "#5AB693",
    textColor: "#2D5B4A",
    sections: {
      "Markets Order": [
        "Zucchini - 10kg crate", "Capsicum - 10kg crate", "Eggplant - 10kg crate",
        "Cucumber - 10kg crate", "Mushrooms - 5kg box", "Kiwi - 12kg", "Limes - 10kg",
        "Tomato (grade 2) - 10kg box", "Cherry Tomatoes - 10kg Box",
        "Beetroot (grade 2) - 10kg crate", "Japanese/Kent Pumpkin - 84L crate",
        "Mixed Leaves - 1kg", "Spinach - 1kg", "Cauliflower - 84L Crate",
        "Cos Lettuce - 12 heads", "Broccoli - Iced", "Green Cabbage - 84L Crate",
        "Red Cabbage - 84L Crate", "700g Eggs - 15 Dozen", "Lemons - Juicing",
        "Limes - Juicing", "Oranges - Juicing", "Bananas - 20kg",
        "Granny Smith Apples - Juicing", "Strawberries", "Rock Melon - 9 Count",
        "Carrots - Catering Carrots - 15kg", "Watermelon", "Honey Dew Melon",
        "Pickling Cucumber (grade 2)", "Pineapple",
      ],
    },
    freeText: true,
  },
  {
    key: "kakulas",
    name: "Kakulas",
    color: "#C9A227",       // Gold
    lightBg: "#FBF5E0",
    border: "#C9A227",
    textColor: "#7A6010",
    isKg: true,             // All items sold by kg — use decimal stepper
    sections: {
      "Herbs & Spices": [
        "Garlic herb seasoning (kg)", "Pea protein (kg)", "Pitted dates (kg)",
        "Cacao nibs (kg)", "Chia seeds (kg)", "Cinnamon powder (kg)",
        "Coconut flakes (kg)", "Cumin powder (kg)", "Dried parsley (kg)",
        "Oregano dried (kg)", "Lemon pepper (kg)", "Jerk seasoning (kg)",
        "Smoked paprika (kg)", "White pepper ground (kg)", "Peri peri seasoning (kg)",
        "Raw cacao powder (kg)", "Moroccan seasoning (kg)", "Acai (10kg tub)",
      ],
    },
    freeText: true,
  },
  {
    key: "costco",
    name: "Costco",
    color: "#D4789A",       // Pink
    lightBg: "#FDF0F5",
    border: "#D4789A",
    textColor: "#8B3A5A",
    sections: {
      "Costco Order": [
        "Swiss Cheese Slices", "Aluminium Foil", "Bake Paper", "Cling Wrap",
        "Lipton Iced Tea Lemon", "Lipton Iced Tea Peach", "Silverside Corned Beef",
        "Honey", "Plain Flour (25kg Bag)", "Muesli Gluten Free", "Vegetable Stock",
        "Canola Oil (20L)", "Vegetable Oil (20L)", "Peanut Butter",
        "Tinned Tomatoes Crushed (3x 2.5kg)", "Pickles", "Sriracha",
        "Sparkling Water - San Pellegrino (Carton of 24)", "Blue Chucks Roll",
        "Butter Spread (2kg)",
      ],
    },
    freeText: true,
  },
  {
    key: "additional",
    name: "Additional Items",
    color: "#8B8FA8",       // Neutral grey-blue
    lightBg: "#F4F5F8",
    border: "#C5C8D6",
    textColor: "#5A5E72",
    sections: {
      "Additional Order": [],
    },
    freeText: true,
    freeFormOnly: true,     // Only a free-text entry — no predefined items
  },
] as const;

type SupplierKey = typeof SUPPLIERS[number]["key"];

// ─── Status Config ────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; icon: any }> = {
  draft:     { label: "Draft",     color: "#92400E", bg: "#FEF3C7", icon: Clock },
  submitted: { label: "Submitted", color: "#1E5470", bg: "#DBEAFE", icon: Send },
  received:  { label: "Received",  color: "#166534", bg: "#DCFCE7", icon: CheckCircle2 },
  partial:   { label: "Partial",   color: "#7C2D12", bg: "#FFEDD5", icon: AlertCircle },
  cancelled: { label: "Cancelled", color: "#6B7280", bg: "#F3F4F6", icon: X },
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface DraftOrder {
  id: number;
  name: string;
  status: string;
  supplier_key?: string;
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function itemKey(supplierKey: string, itemName: string) {
  return `${supplierKey}::${itemName}`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-AU", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleDateString("en-AU", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

function supplierFilledCount(supplierKey: string, items: SupplierItem[]) {
  return items.filter(i => i.supplier_key === supplierKey && (i.qty || 0) > 0).length;
}

function supplierTotalItems(sup: typeof SUPPLIERS[number]) {
  if ((sup as any).freeFormOnly) return 0;
  return Object.values(sup.sections).reduce((a, s) => a + s.length, 0);
}

// ─── Qty Stepper ──────────────────────────────────────────────────────────────

function QtyInput({
  value,
  onChange,
  isKg,
  accent,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  isKg?: boolean;
  accent: string;
  disabled?: boolean;
}) {
  const step = isKg ? 0.5 : 1;
  const num = parseFloat(value) || 0;
  const hasVal = num > 0;

  const decrement = () => {
    const next = Math.max(0, parseFloat((num - step).toFixed(2)));
    onChange(next === 0 ? "" : String(next));
  };
  const increment = () => {
    const next = parseFloat((num + step).toFixed(2));
    onChange(String(next));
  };

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        disabled={disabled || num === 0}
        onClick={decrement}
        className="w-9 h-9 flex items-center justify-center rounded-lg border text-gray-500 hover:bg-gray-100 active:bg-gray-200 disabled:opacity-30 transition-colors touch-manipulation"
        style={hasVal ? { borderColor: accent, color: accent } : {}}
      >
        <Minus className="w-3.5 h-3.5" />
      </button>
      <input
        type="number"
        min="0"
        step={step}
        value={value}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
        placeholder="0"
        className="w-14 h-9 text-center text-sm font-semibold rounded-lg border outline-none transition-all"
        style={hasVal
          ? { borderColor: accent, color: accent, backgroundColor: "white" }
          : { borderColor: "#E5E7EB", color: "#374151" }
        }
      />
      <button
        type="button"
        disabled={disabled}
        onClick={increment}
        className="w-9 h-9 flex items-center justify-center rounded-lg border transition-colors touch-manipulation"
        style={hasVal
          ? { borderColor: accent, backgroundColor: accent, color: "white" }
          : { borderColor: "#E5E7EB", color: "#374151", backgroundColor: "white" }
        }
        onMouseOver={e => {
          if (!disabled && !hasVal) {
            (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#F3F4F6";
          }
        }}
        onMouseOut={e => {
          if (!hasVal) (e.currentTarget as HTMLButtonElement).style.backgroundColor = "white";
        }}
      >
        <Plus className="w-3.5 h-3.5" />
      </button>
      {isKg && <span className="text-xs text-gray-400 ml-0.5">kg</span>}
    </div>
  );
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

// ─── Print View ───────────────────────────────────────────────────────────────

function PrintView({ draft, items }: { draft: DraftOrder; items: SupplierItem[] }) {
  const date = new Date().toLocaleDateString("en-AU", {
    weekday: "long", day: "2-digit", month: "long", year: "numeric",
  });

  // Group items by supplier
  const bySupplier = SUPPLIERS.map(sup => ({
    sup,
    items: items.filter(i => i.supplier_key === sup.key && (i.qty || 0) > 0),
  })).filter(g => g.items.length > 0);

  return (
    <div className="space-y-6">
      <div className="border-b pb-3">
        <h2 className="text-lg font-bold" style={{ color: "#256984" }}>{draft.name}</h2>
        <p className="text-sm text-gray-500">{date}</p>
        <StatusBadge status={draft.status} />
      </div>

      {bySupplier.map(({ sup, items: supItems }) => {
        // Group by section
        const bySec: Record<string, SupplierItem[]> = {};
        supItems.forEach(it => {
          const sec = it.section_key || "Order";
          if (!bySec[sec]) bySec[sec] = [];
          bySec[sec].push(it);
        });

        return (
          <div key={sup.key} className="border rounded-lg overflow-hidden" style={{ borderColor: sup.border }}>
            <div className="px-4 py-2.5 text-white font-semibold" style={{ backgroundColor: sup.color }}>
              {sup.name}
            </div>
            {Object.entries(bySec).map(([sec, secItems]) => (
              <div key={sec}>
                {Object.keys(bySec).length > 1 && (
                  <div className="px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-gray-500"
                    style={{ backgroundColor: sup.lightBg, borderLeft: `3px solid ${sup.color}` }}>
                    {sec}
                  </div>
                )}
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-gray-100">
                    {secItems.map((it, i) => (
                      <tr key={it.id} className={i % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                        <td className="px-4 py-2 text-gray-800 font-medium">{it.item_name}</td>
                        <td className="px-4 py-2 text-right font-bold" style={{ color: sup.color }}>
                          {it.qty}{(sup as any).isKg ? " kg" : ""}
                        </td>
                        <td className="px-4 py-2 text-right text-gray-400 text-xs w-24">
                          {it.notes || ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        );
      })}

      {bySupplier.length === 0 && (
        <p className="text-center text-gray-400 py-8">No items to print.</p>
      )}

      <div className="border-t pt-4 mt-6 text-xs text-gray-400 flex justify-between">
        <span>The Deli by Greenhorns — Stock Order</span>
        <span>Printed {date}</span>
      </div>
    </div>
  );
}

// ─── Supplier Order Form ───────────────────────────────────────────────────────

function SupplierForm({
  supplier,
  items,
  onSave,
  disabled,
  receivingMode,
}: {
  supplier: typeof SUPPLIERS[number];
  items: SupplierItem[];
  onSave: (supplierKey: string, itemName: string, sectionKey: string, qty: number | null, receivedQty?: number) => void;
  disabled?: boolean;
  receivingMode?: boolean;
}) {
  const [localQty, setLocalQty] = useState<Record<string, string>>({});
  const [freeText, setFreeText] = useState("");
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // Sync from server items
  useEffect(() => {
    const map: Record<string, string> = {};
    items.forEach(it => {
      if (it.supplier_key === supplier.key) {
        const field = receivingMode ? (it.received_qty ?? it.qty) : it.qty;
        map[it.item_key] = (field || 0) > 0 ? String(field) : "";
      }
    });
    setLocalQty(map);

    // Pre-fill free text from additional order items with no section match
    if ((supplier as any).freeFormOnly) {
      const freeItems = items.filter(i => i.supplier_key === supplier.key);
      if (freeItems.length > 0) {
        setFreeText(freeItems.map(i => `${i.item_name}: ${i.qty}`).join("\n"));
      }
    }
  }, [items, supplier.key, receivingMode]);

  const handleChange = useCallback((itemName: string, sectionKey: string, value: string) => {
    const key = itemKey(supplier.key, itemName);
    setLocalQty(prev => ({ ...prev, [key]: value }));
    clearTimeout(saveTimers.current[key]);
    saveTimers.current[key] = setTimeout(() => {
      const qty = parseFloat(value);
      const n = isNaN(qty) ? 0 : qty;
      if (receivingMode) {
        onSave(supplier.key, itemName, sectionKey, null, n);
      } else {
        onSave(supplier.key, itemName, sectionKey, n);
      }
    }, 600);
  }, [supplier.key, onSave, receivingMode]);

  const toggleSection = (sec: string) => {
    setCollapsedSections(p => ({ ...p, [sec]: !p[sec] }));
  };

  const totalItems = supplierTotalItems(supplier);
  const filledItems = items.filter(i => i.supplier_key === supplier.key && (i.qty || 0) > 0).length;

  if ((supplier as any).freeFormOnly) {
    return (
      <div className="p-4">
        <p className="text-sm text-gray-500 mb-3">
          Use this section for any items not covered by the above suppliers.
          Enter each item on a new line.
        </p>
        <textarea
          value={freeText}
          onChange={e => setFreeText(e.target.value)}
          disabled={disabled}
          rows={8}
          placeholder={"Item name: quantity\nAnother item: 2\n..."}
          className="w-full text-sm border border-gray-200 rounded-lg p-3 resize-none focus:outline-none focus:ring-2"
          style={{ "--tw-ring-color": supplier.color } as any}
        />
        <p className="text-xs text-gray-400 mt-2">This field is saved as a note on the order.</p>
      </div>
    );
  }

  return (
    <div>
      {/* Section progress header */}
      <div className="px-4 py-2 border-b flex items-center justify-between text-xs text-gray-500"
        style={{ backgroundColor: supplier.lightBg }}>
        <span>{filledItems} / {totalItems} items filled</span>
        <div className="w-32 h-1.5 rounded-full bg-gray-200 overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: totalItems > 0 ? `${(filledItems / totalItems) * 100}%` : "0%", backgroundColor: supplier.color }}
          />
        </div>
      </div>

      {/* Sections */}
      {Object.entries(supplier.sections).map(([sectionName, sectionItems]) => {
        if (sectionItems.length === 0) return null;
        const isCollapsed = collapsedSections[sectionName];
        const sectionFilled = sectionItems.filter(name => {
          const k = itemKey(supplier.key, name);
          return (parseFloat(localQty[k] || "0") || 0) > 0;
        }).length;
        const allDone = sectionFilled === sectionItems.length;

        return (
          <div key={sectionName} className="border-b last:border-b-0">
            {/* Section header */}
            <button
              className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-gray-50 transition-colors"
              onClick={() => toggleSection(sectionName)}
            >
              <div className="flex items-center gap-2">
                {isCollapsed
                  ? <ChevronRight className="w-4 h-4 text-gray-400" />
                  : <ChevronDown className="w-4 h-4 text-gray-400" />
                }
                <span className="text-sm font-semibold text-gray-700">{sectionName}</span>
                <span className="text-xs text-gray-400">({sectionItems.length})</span>
                {sectionFilled > 0 && (
                  <span
                    className="text-xs px-1.5 py-0.5 rounded-full font-medium"
                    style={{ color: supplier.color, backgroundColor: supplier.lightBg }}
                  >
                    {sectionFilled}
                  </span>
                )}
              </div>
              {allDone && (
                <span className="flex items-center gap-1 text-xs" style={{ color: supplier.color }}>
                  <CheckCircle2 className="w-3.5 h-3.5" /> Done
                </span>
              )}
            </button>

            {/* Items */}
            {!isCollapsed && (
              <div className="divide-y divide-gray-50">
                {sectionItems.map((itemName: string) => {
                  const key = itemKey(supplier.key, itemName);
                  const val = localQty[key] ?? "";
                  const hasVal = (parseFloat(val) || 0) > 0;
                  const serverItem = items.find(i => i.item_key === key);

                  return (
                    <div
                      key={itemName}
                      className="flex items-center justify-between px-4 py-2.5 transition-colors"
                      style={hasVal ? { backgroundColor: supplier.lightBg + "60" } : {}}
                    >
                      <div className="flex items-center gap-2 flex-1 min-w-0 mr-3">
                        {hasVal
                          ? <Check className="w-3.5 h-3.5 shrink-0" style={{ color: supplier.color }} />
                          : <div className="w-3.5 h-3.5 shrink-0" />
                        }
                        <span
                          className="text-sm truncate"
                          style={hasVal ? { color: supplier.color, fontWeight: 500 } : { color: "#374151" }}
                        >
                          {itemName}
                        </span>
                        {receivingMode && serverItem && (serverItem.qty || 0) > 0 && (
                          <span className="text-xs text-gray-400 ml-1 shrink-0">
                            ordered: {serverItem.qty}{(supplier as any).isKg ? " kg" : ""}
                          </span>
                        )}
                      </div>
                      <QtyInput
                        value={val}
                        onChange={v => handleChange(itemName, sectionName, v)}
                        isKg={(supplier as any).isKg}
                        accent={supplier.color}
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

      {/* Free text at bottom */}
      {supplier.freeText && (
        <div className="p-4 border-t">
          <p className="text-xs text-gray-500 font-medium mb-1.5">Anything else required?</p>
          <textarea
            rows={2}
            disabled={disabled}
            placeholder="Write any additional items..."
            className="w-full text-sm border border-gray-200 rounded-lg p-2 resize-none focus:outline-none focus:ring-1"
            style={{ "--tw-ring-color": supplier.color } as any}
          />
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function StockOrder() {
  const qc = useQueryClient();

  // View state
  const [view, setView] = useState<"list" | "order">("list");
  const [activeDraftId, setActiveDraftId] = useState<number | null>(null);
  const [activeSupplierIdx, setActiveSupplierIdx] = useState(0);
  const [listTab, setListTab] = useState<"active" | "history">("active");
  const [newOrderDialog, setNewOrderDialog] = useState(false);
  const [newOrderName, setNewOrderName] = useState("");
  const [printDialog, setPrintDialog] = useState(false);
  const [receivingMode, setReceivingMode] = useState(false);

  // ── Queries ────────────────────────────────────────────────────────────────

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
  const activeSupplier = SUPPLIERS[activeSupplierIdx];
  const isReadonly = activeDraft && !["draft"].includes(activeDraft.status) && !receivingMode;

  const activeOrders = drafts.filter(d => ["draft", "submitted"].includes(d.status));
  const historyOrders = drafts.filter(d => ["received", "partial", "cancelled"].includes(d.status));

  const totalFilledItems = supplierItems.filter(i => (i.qty || 0) > 0).length;
  const allSupplierProgress = SUPPLIERS.map(sup => ({
    sup,
    filled: supplierFilledCount(sup.key, supplierItems),
    total: supplierTotalItems(sup),
  }));

  // ── Mutations ──────────────────────────────────────────────────────────────

  const createDraft = useMutation({
    mutationFn: (name: string) =>
      apiRequest("POST", "/api/stock-order/drafts", { name }).then(r => r.json()),
    onSuccess: (data: DraftOrder) => {
      qc.invalidateQueries({ queryKey: ["/api/stock-order/drafts"] });
      setActiveDraftId(data.id);
      setView("order");
      setActiveSupplierIdx(0);
      setNewOrderDialog(false);
      setNewOrderName("");
    },
  });

  const deleteDraft = useMutation({
    mutationFn: (id: number) =>
      apiRequest("DELETE", `/api/stock-order/drafts/${id}`).then(r => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/stock-order/drafts"] });
    },
  });

  const updateStatus = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      apiRequest("PATCH", `/api/stock-order/drafts/${id}/status`, { status }).then(r => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/stock-order/drafts"] });
    },
  });

  const saveItem = useMutation({
    mutationFn: (payload: any) =>
      apiRequest("PUT", `/api/stock-order/drafts/${activeDraftId}/supplier-items`, payload).then(r => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/stock-order/drafts", activeDraftId, "supplier-items"] });
    },
  });

  const handleSaveItem = useCallback((
    supplierKey: string, itemName: string, sectionKey: string,
    qty: number | null, receivedQty?: number
  ) => {
    if (!activeDraftId) return;
    const key = itemKey(supplierKey, itemName);
    const payload: any = {
      supplierKey,
      itemKey: key,
      sectionKey,
      itemName,
    };
    if (qty !== null) payload.qty = qty;
    if (receivedQty !== undefined) payload.receivedQty = receivedQty;
    saveItem.mutate(payload);
  }, [activeDraftId, saveItem]);

  // ── Open order ─────────────────────────────────────────────────────────────

  const openOrder = (draft: DraftOrder) => {
    setActiveDraftId(draft.id);
    setActiveSupplierIdx(0);
    setReceivingMode(draft.status === "submitted");
    setView("order");
  };

  // ── Submit order ───────────────────────────────────────────────────────────

  const handleSubmit = () => {
    if (!activeDraftId || totalFilledItems === 0) return;
    updateStatus.mutate({ id: activeDraftId, status: "submitted" });
  };

  const handleMarkReceived = () => {
    if (!activeDraftId) return;
    updateStatus.mutate({ id: activeDraftId, status: "received" });
    setReceivingMode(false);
  };

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER — ORDER LIST VIEW
  // ─────────────────────────────────────────────────────────────────────────

  if (view === "list") {
    const displayDrafts = listTab === "active" ? activeOrders : historyOrders;

    return (
      <div className="p-4 max-w-2xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <ShoppingCart className="w-5 h-5" style={{ color: "#256984" }} />
            <h1 className="text-xl font-bold" style={{ color: "#256984" }}>Stock Ordering</h1>
          </div>
          <Button
            onClick={() => setNewOrderDialog(true)}
            className="gap-1.5 text-white"
            style={{ backgroundColor: "#256984" }}
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
                ? { backgroundColor: "white", color: "#256984", boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }
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

        {/* Order cards */}
        {displayDrafts.length === 0 ? (
          <div className="text-center py-16 bg-gray-50 rounded-xl border-2 border-dashed border-gray-200">
            <ClipboardList className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-400 text-sm">
              {listTab === "active" ? "No active orders. Create one to get started." : "No completed orders yet."}
            </p>
            {listTab === "active" && (
              <Button
                className="mt-4 gap-1.5 text-white"
                style={{ backgroundColor: "#256984" }}
                onClick={() => setNewOrderDialog(true)}
              >
                <Plus className="w-4 h-4" /> New Order
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {displayDrafts.map(draft => {
              // We don't have items loaded here — show basic card
              return (
                <div
                  key={draft.id}
                  className="bg-white rounded-xl border border-gray-200 overflow-hidden cursor-pointer hover:shadow-md transition-all"
                  style={{ borderLeft: `4px solid #256984` }}
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

                  {/* Supplier pills */}
                  <div className="px-4 pb-3 flex flex-wrap gap-1.5">
                    {SUPPLIERS.slice(0, 5).map(sup => (
                      <span
                        key={sup.key}
                        className="text-xs px-2 py-0.5 rounded-full font-medium"
                        style={{ color: sup.textColor, backgroundColor: sup.lightBg }}
                      >
                        {sup.name}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* New order dialog */}
        <Dialog open={newOrderDialog} onOpenChange={setNewOrderDialog}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle style={{ color: "#256984" }}>New Stock Order</DialogTitle>
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
                style={{ backgroundColor: "#256984" }}
                disabled={createDraft.isPending}
              >
                <Plus className="w-4 h-4 mr-1.5" />
                Create Order
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER — ORDER FORM VIEW
  // ─────────────────────────────────────────────────────────────────────────

  const sup = activeSupplier;
  const supProgress = allSupplierProgress[activeSupplierIdx];
  const isDraft = activeDraft?.status === "draft";

  return (
    <div className="flex flex-col h-full max-w-3xl mx-auto">
      {/* ── Top bar ── */}
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

      {/* ── Supplier tab strip ── */}
      <div className="overflow-x-auto border-b bg-white">
        <div className="flex min-w-max px-2 py-1 gap-1">
          {SUPPLIERS.map((s, idx) => {
            const prog = allSupplierProgress[idx];
            const isActive = idx === activeSupplierIdx;
            const filled = prog.filled;
            const total = prog.total;
            const done = total > 0 && filled === total;

            return (
              <button
                key={s.key}
                onClick={() => setActiveSupplierIdx(idx)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap"
                style={isActive
                  ? { backgroundColor: s.color, color: "white" }
                  : { color: "#6B7280", backgroundColor: "transparent" }
                }
              >
                {s.name}
                {done ? (
                  <CheckCircle2 className="w-3.5 h-3.5" />
                ) : filled > 0 ? (
                  <span
                    className="text-xs px-1.5 py-0 rounded-full font-semibold"
                    style={isActive
                      ? { backgroundColor: "rgba(255,255,255,0.25)", color: "white" }
                      : { backgroundColor: s.lightBg, color: s.color }
                    }
                  >
                    {filled}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Supplier form ── */}
      <div className="flex-1 overflow-y-auto bg-white">
        <div
          className="px-4 py-2.5 border-b flex items-center gap-2"
          style={{ backgroundColor: sup.lightBg }}
        >
          <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: sup.color }} />
          <span className="text-sm font-semibold" style={{ color: sup.textColor }}>{sup.name}</span>
        </div>

        {itemsLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-6 h-6 border-2 border-gray-200 border-t-gray-500 rounded-full animate-spin" />
          </div>
        ) : (
          <SupplierForm
            supplier={sup as any}
            items={supplierItems}
            onSave={handleSaveItem}
            disabled={!!isReadonly}
            receivingMode={receivingMode}
          />
        )}
      </div>

      {/* ── Sticky footer ── */}
      <div className="border-t bg-white px-4 py-3">
        {receivingMode ? (
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setReceivingMode(false)}
            >
              Cancel
            </Button>
            <Button
              className="flex-1 text-white gap-1.5"
              style={{ backgroundColor: "#5AB693" }}
              onClick={handleMarkReceived}
            >
              <CheckCircle2 className="w-4 h-4" />
              Mark Received
            </Button>
          </div>
        ) : isDraft ? (
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1 text-gray-600"
              onClick={() => setView("list")}
            >
              Save Draft
            </Button>
            <Button
              className="flex-1 text-white gap-1.5 transition-all"
              style={{
                backgroundColor: totalFilledItems > 0 ? "#256984" : "#D1D5DB",
                cursor: totalFilledItems > 0 ? "pointer" : "not-allowed",
              }}
              onClick={handleSubmit}
              disabled={totalFilledItems === 0 || updateStatus.isPending}
            >
              <Send className="w-4 h-4" />
              Submit Order ({totalFilledItems} items)
            </Button>
          </div>
        ) : activeDraft?.status === "submitted" ? (
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setView("list")}
            >
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
          <Button
            variant="outline"
            className="w-full"
            onClick={() => setView("list")}
          >
            Back to Orders
          </Button>
        )}
      </div>

      {/* ── Print dialog ── */}
      <Dialog open={printDialog} onOpenChange={setPrintDialog}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-center justify-between">
              <DialogTitle style={{ color: "#256984" }}>Order Summary</DialogTitle>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                style={{ borderColor: "#256984", color: "#256984" }}
                onClick={() => window.print()}
              >
                <Printer className="w-4 h-4" />
                Print / PDF
              </Button>
            </div>
          </DialogHeader>
          {activeDraft && (
            <PrintView draft={activeDraft} items={supplierItems} />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
