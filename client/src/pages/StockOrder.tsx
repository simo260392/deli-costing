import { useState, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  ShoppingCart, Plus, Trash2, Printer, ChevronDown, ChevronRight,
  Check, X, ClipboardList, ArrowLeft, Send, Truck, Clock,
  CheckCircle2, AlertCircle, Search, Package, Tag, Copy,
  Phone, Mail, Globe, MessageSquare, Pencil, Store, Settings,
  UtensilsCrossed, ChefHat, Layers,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

// ─── Types ─────────────────────────────────────────────────────────────────────
interface Supplier {
  id: number; name: string; contact_name?: string; email?: string; phone?: string;
  how_to_order?: string; order_contact?: string; order_cutoff?: string;
  min_order_amount?: number; delivery_days?: string; notes?: string;
  parent_supplier_id?: number | null;
}
interface IngredientRaw {
  id: number; name: string; category?: string; unit?: string;
  best_supplier_id?: number; best_cost_per_unit?: number;
}
interface SubRecipe {
  id: number; name: string; unit?: string; yield_amount?: number;
}
interface Recipe {
  id: number; name: string; serves?: number;
}
interface SupplierIngredient {
  id: number; supplier_id: number; ingredient_id: number;
  cost_per_unit?: number; pack_size?: number; pack_cost?: number;
  invoice_date?: string; supplier_sku?: string; supplier_ingredient_name?: string;
  unit_size_qty?: number; unit_size_unit?: string;
  is_preferred?: boolean; has_gst?: boolean;
  suppliers?: { id: number; name: string; how_to_order?: string; order_contact?: string };
}
interface StockOrder {
  id: number; name: string; order_type: "supplier" | "category" | "cbd_internal";
  type_keys?: string; status: string; notes?: string;
  placed_at?: string; received_at?: string; created_at: string; updated_at?: string;
  order_date?: string;
  cbd_items?: CbdOrderItem[];
}
interface OrderItem {
  id: number; order_id: number; ingredient_id: number; supplier_id?: number;
  supplier_ingredient_id?: number; qty_ordered: number; qty_received?: number;
  unit_size_qty?: number; unit_size_unit?: string; supplier_sku?: string;
  supplier_ingredient_name?: string; pack_cost?: number; has_gst?: boolean;
  notes?: string; ingredient_name?: string; ingredient_unit?: string;
  ingredient_category?: string;
}
interface ParLevel { ingredient_id: number; par_level: number; unit: string; }
interface IngredientHistory { last_ordered: string | null; last_qty: number | null; avg_qty: number | null; }

// CBD-specific types
interface CbdConfigItem {
  id: number; item_type: "ingredient" | "sub_recipe" | "recipe";
  item_id: number; item_name: string; base_unit: string; sort_order: number;
  category: string;
}
interface CbdOrderItem {
  config_item_id: number; item_name: string; base_unit: string; qty_ordered: number;
  item_type: "ingredient" | "sub_recipe" | "recipe";
  category: string;
}

// ─── Constants ─────────────────────────────────────────────────────────────────
const BRAND = "#256984";
const BRAND_LIGHT = "#EBF4F8";
const CBD_COLOR = "#5AB693"; // green accent for CBD orders
const CBD_LIGHT = "#EBF9F3";

const STATUS: Record<string, { label: string; color: string; bg: string; Icon: any }> = {
  draft:     { label: "Draft",     color: "#92400E", bg: "#FEF3C7", Icon: Clock },
  placed:    { label: "Placed",    color: "#1E5470", bg: "#DBEAFE", Icon: Send },
  received:  { label: "Received",  color: "#166534", bg: "#DCFCE7", Icon: CheckCircle2 },
  partial:   { label: "Partial",   color: "#7C2D12", bg: "#FFEDD5", Icon: AlertCircle },
  cancelled: { label: "Cancelled", color: "#6B7280", bg: "#F3F4F6", Icon: X },
};

const ORDER_COLORS = [
  "#256984","#5AB693","#A84B2F","#7A39BB","#D19900",
  "#006494","#A13544","#848456","#1B474D","#6E522B",
];

const HOW_TO_ORDER_ICONS: Record<string, any> = {
  email: Mail, phone: Phone, online: Globe, text: MessageSquare,
};

const ITEM_TYPE_ICONS: Record<string, any> = {
  ingredient: Package, sub_recipe: Layers, recipe: ChefHat,
};
const ITEM_TYPE_LABELS: Record<string, string> = {
  ingredient: "Ingredient", sub_recipe: "Sub-Recipe", recipe: "Recipe",
};

// ─── Helpers ───────────────────────────────────────────────────────────────────
function fmtDate(iso?: string | null) {
  if (!iso) return "—";
  return format(new Date(iso), "d MMM yy");
}
function fmtDateTime(iso?: string | null) {
  if (!iso) return "—";
  return format(new Date(iso), "d MMM yy, HH:mm");
}
function supplierColor(supplierId: number) {
  return ORDER_COLORS[supplierId % ORDER_COLORS.length];
}
function autoOrderName(orderType: "supplier" | "category", keys: string[], suppliers: Supplier[], categories: string[]) {
  const today = format(new Date(), "d MMM yy");
  if (orderType === "supplier") {
    const names = keys.map(k => suppliers.find(s => String(s.id) === k)?.name || k);
    return `${names.join(" & ")} Order — ${today}`;
  }
  return `${keys.join(" & ")} Order — ${today}`;
}

// ─── Status Badge ──────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS[status] || STATUS.draft;
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold"
      style={{ color: cfg.color, background: cfg.bg }}>
      <cfg.Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  );
}

// ─── Copy Button ───────────────────────────────────────────────────────────────
function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button variant="outline" size="sm" className="gap-1.5"
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }}>
      {copied ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
      {copied ? "Copied!" : label}
    </Button>
  );
}

// ─── CBD Order Form (inside Place New Order modal) ─────────────────────────────
function CbdOrderForm({ onClose, onCreate }: {
  onClose: () => void;
  onCreate: (order: StockOrder) => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [qtys, setQtys] = useState<Record<number, string>>({});
  const [notes, setNotes] = useState("");
  // Default to tomorrow in AWST
  const defaultOrderDate = (() => {
    const d = new Date(Date.now() + 8 * 60 * 60 * 1000); // UTC+8
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  })();
  const [orderDate, setOrderDate] = useState(defaultOrderDate);

  const { data: configItems = [], isLoading } = useQuery<CbdConfigItem[]>({
    queryKey: ["/api/cbd-config"],
    queryFn: () => apiRequest("GET", "/api/cbd-config").then(r => r.json()),
  });

  const itemsWithQty = configItems.filter(it => parseFloat(qtys[it.id] || "0") > 0);

  const createMutation = useMutation({
    mutationFn: async () => {
      const items: CbdOrderItem[] = itemsWithQty.map(it => ({
        config_item_id: it.id,
        item_name: it.item_name,
        base_unit: it.base_unit,
        qty_ordered: parseFloat(qtys[it.id]),
        item_type: it.item_type,
        category: it.category || "General",
      }));
      const res = await apiRequest("POST", "/api/orders/cbd", { items, notes: notes || null, order_date: orderDate });
      if (!res.ok) throw new Error("Failed to create CBD order");
      return res.json();
    },
    onSuccess: (order) => {
      qc.invalidateQueries({ queryKey: ["/api/orders"] });
      onCreate(order);
      onClose();
    },
    onError: (e: any) => toast({ description: e.message, variant: "destructive" }),
  });

  // Group by category
  const grouped = configItems.reduce((acc, it) => {
    const cat = it.category || "General";
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(it);
    return acc;
  }, {} as Record<string, CbdConfigItem[]>);
  const sortedCategories = Object.keys(grouped).sort();

  if (isLoading) {
    return (
      <div className="p-6 text-center py-12 text-muted-foreground text-sm">Loading order items…</div>
    );
  }

  if (configItems.length === 0) {
    return (
      <div className="p-6 space-y-4">
        <div className="text-center py-10 border-2 border-dashed rounded-xl text-muted-foreground">
          <Store size={36} className="mx-auto mb-3 opacity-20" />
          <p className="text-sm font-medium">No items configured yet</p>
          <p className="text-xs mt-1">Go to Manage CBD Items to add ingredients, sub-recipes, and recipes</p>
        </div>
        <Button variant="outline" className="w-full" onClick={onClose}>Close</Button>
      </div>
    );
  }

  return (
    <div className="p-5 space-y-4">
      {sortedCategories.map(cat => {
        const items = grouped[cat] || [];
        if (items.length === 0) return null;
        return (
          <div key={cat}>
            <div className="flex items-center gap-2 mb-2">
              <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: CBD_COLOR }} />
              <span className="text-xs font-bold uppercase tracking-wide" style={{ color: CBD_COLOR }}>
                {cat}
              </span>
            </div>
            <div className="space-y-1.5">
              {items.map(it => {
                const qty = qtys[it.id] || "";
                const hasQty = parseFloat(qty) > 0;
                return (
                  <div key={it.id}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-all"
                    style={hasQty ? { borderColor: CBD_COLOR, background: CBD_LIGHT } : { borderColor: "#E5E7EB" }}>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{it.item_name}</p>
                      <p className="text-xs text-muted-foreground">Unit: {it.base_unit}</p>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <button
                        onClick={() => setQtys(p => ({ ...p, [it.id]: String(Math.max(0, (parseFloat(p[it.id] || "0") - 1))) }))}
                        className="w-8 h-8 rounded-lg border flex items-center justify-center text-lg leading-none"
                        style={hasQty ? { borderColor: CBD_COLOR, color: CBD_COLOR } : { borderColor: "#E5E7EB", color: "#9CA3AF" }}>−</button>
                      <input type="number" min="0" value={qty} placeholder="0"
                        onChange={e => setQtys(p => ({ ...p, [it.id]: e.target.value }))}
                        className="w-14 h-8 text-center text-sm font-bold rounded-lg border outline-none"
                        style={hasQty ? { borderColor: CBD_COLOR, color: CBD_COLOR } : { borderColor: "#E5E7EB" }} />
                      <button
                        onClick={() => setQtys(p => ({ ...p, [it.id]: String((parseFloat(p[it.id] || "0") + 1)) }))}
                        className="w-8 h-8 rounded-lg border flex items-center justify-center text-sm"
                        style={hasQty ? { background: CBD_COLOR, borderColor: CBD_COLOR, color: "white" } : { borderColor: "#E5E7EB", color: "#374151" }}>+</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      <div>
        <p className="text-xs text-muted-foreground mb-1">Order Date <span className="text-muted-foreground/60">(date production kitchen should pack this)</span></p>
        <input
          type="date"
          value={orderDate}
          onChange={e => setOrderDate(e.target.value)}
          className="w-full h-9 rounded-lg border border-border px-3 text-sm outline-none focus:ring-2 focus:ring-[#5AB693]"
        />
      </div>

      <div>
        <p className="text-xs text-muted-foreground mb-1">Notes (optional)</p>
        <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Any special instructions…" rows={2} className="text-sm" />
      </div>

      <Button className="w-full h-12 font-semibold gap-2"
        style={{ background: itemsWithQty.length > 0 ? CBD_COLOR : undefined }}
        disabled={itemsWithQty.length === 0 || createMutation.isPending}
        onClick={() => createMutation.mutate()}>
        {createMutation.isPending ? "Submitting…" : `Submit Order (${itemsWithQty.length} item${itemsWithQty.length !== 1 ? "s" : ""}) →`}
      </Button>
    </div>
  );
}

// ─── Place New Order Modal ──────────────────────────────────────────────────────
function PlaceOrderModal({ suppliers, ingredients, onClose, onCreate, onOpenCbdConfig, initialMode }: {
  suppliers: Supplier[]; ingredients: IngredientRaw[];
  onClose: () => void; onCreate: (order: StockOrder) => void;
  onOpenCbdConfig: () => void;
  initialMode?: "standard" | "cbd" | null;
}) {
  const [orderMode, setOrderMode] = useState<"standard" | "cbd" | null>(initialMode ?? null);
  const [step, setStep] = useState<"type" | "select">("type");
  const [orderType, setOrderType] = useState<"supplier" | "category">("supplier");
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const { toast } = useToast();

  const categories = Array.from(new Set(ingredients.map(i => i.category || "General"))).sort();

  const createMutation = useMutation({
    mutationFn: async () => {
      const name = autoOrderName(orderType, selectedKeys, suppliers, categories);
      const res = await apiRequest("POST", "/api/orders", { name, order_type: orderType, type_keys: selectedKeys });
      if (!res.ok) throw new Error("Failed to create order");
      return res.json();
    },
    onSuccess: (order) => { onCreate(order); onClose(); },
    onError: (e: any) => toast({ description: e.message, variant: "destructive" }),
  });

  const topLevelSuppliers = suppliers.filter(s => !s.parent_supplier_id);

  const options = orderType === "supplier"
    ? topLevelSuppliers.map(s => {
        const children = suppliers.filter(c => c.parent_supplier_id === s.id);
        return { key: String(s.id), label: s.name, childCount: children.length };
      })
    : categories.map(c => ({ key: c, label: c, childCount: 0 }));

  const toggle = (key: string) =>
    setSelectedKeys(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);

  // ── Mode picker ──
  if (orderMode === null) {
    return (
      <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-4">
        <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
          <div className="px-6 py-4" style={{ background: BRAND }}>
            <p className="text-xs font-semibold uppercase tracking-widest text-white/70">Stock Ordering</p>
            <h2 className="text-lg font-bold text-white mt-0.5">Place New Order</h2>
          </div>
          <div className="p-6 space-y-4">
            <p className="text-sm text-muted-foreground">What type of order would you like to place?</p>
            <div className="space-y-3">
              <button onClick={() => setOrderMode("standard")}
                className="w-full flex items-start gap-4 p-4 rounded-xl border-2 transition-all text-left"
                style={{ borderColor: "#E5E7EB" }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = BRAND)}
                onMouseLeave={e => (e.currentTarget.style.borderColor = "#E5E7EB")}>
                <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: BRAND_LIGHT }}>
                  <ShoppingCart size={20} style={{ color: BRAND }} />
                </div>
                <div>
                  <p className="text-sm font-bold" style={{ color: BRAND }}>Supplier / Category Order</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Order ingredients from external suppliers, grouped by supplier or category</p>
                </div>
              </button>

              <button onClick={() => setOrderMode("cbd")}
                className="w-full flex items-start gap-4 p-4 rounded-xl border-2 transition-all text-left"
                style={{ borderColor: "#E5E7EB" }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = CBD_COLOR)}
                onMouseLeave={e => (e.currentTarget.style.borderColor = "#E5E7EB")}>
                <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: CBD_LIGHT }}>
                  <Store size={20} style={{ color: CBD_COLOR }} />
                </div>
                <div>
                  <p className="text-sm font-bold" style={{ color: CBD_COLOR }}>CBD Additional Stock Order</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Request additional stock from the Osborne Park Production Kitchen</p>
                </div>
              </button>
            </div>
            <Button variant="outline" className="w-full" onClick={onClose}>Cancel</Button>
          </div>
        </div>
      </div>
    );
  }

  // ── CBD order form ──
  if (orderMode === "cbd") {
    return (
      <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-4">
        <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
          <div className="px-6 py-4 flex items-center gap-3" style={{ background: CBD_COLOR }}>
            <button onClick={() => setOrderMode(null)} className="text-white/70 hover:text-white">
              <ArrowLeft size={18} />
            </button>
            <div className="flex-1">
              <p className="text-xs font-semibold uppercase tracking-widest text-white/70">Internal Order</p>
              <h2 className="text-base font-bold text-white">CBD Additional Stock Order</h2>
            </div>
            <button
              onClick={() => { onClose(); onOpenCbdConfig(); }}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/20 hover:bg-white/30 text-white text-xs font-semibold transition-colors"
              title="Configure CBD order items">
              <Settings size={13} /> Configure
            </button>
          </div>
          <div className="overflow-y-auto flex-1">
            <CbdOrderForm onClose={onClose} onCreate={onCreate} />
          </div>
        </div>
      </div>
    );
  }

  // ── Standard order flow ──
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
        <div className="px-6 py-4" style={{ background: BRAND }}>
          <div className="flex items-center gap-3">
            <button onClick={() => { setOrderMode(null); setStep("type"); setSelectedKeys([]); }} className="text-white/70 hover:text-white">
              <ArrowLeft size={18} />
            </button>
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-white/70">Stock Ordering</p>
              <h2 className="text-lg font-bold text-white mt-0.5">Supplier / Category Order</h2>
            </div>
          </div>
        </div>

        {step === "type" && (
          <div className="p-6 space-y-4">
            <p className="text-sm text-muted-foreground">How would you like to organise this order?</p>
            <div className="grid grid-cols-2 gap-3">
              {([["supplier", "By Supplier", Package, "Group items by who we buy from"],
                 ["category", "By Category", Tag, "Group items by ingredient type"]] as const).map(([val, label, Icon, desc]) => (
                <button key={val} onClick={() => setOrderType(val)}
                  className="flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all text-center"
                  style={orderType === val ? { borderColor: BRAND, background: BRAND_LIGHT } : { borderColor: "#E5E7EB" }}>
                  <Icon size={22} style={{ color: orderType === val ? BRAND : "#9CA3AF" }} />
                  <span className="text-sm font-semibold" style={{ color: orderType === val ? BRAND : "#374151" }}>{label}</span>
                  <span className="text-xs text-muted-foreground">{desc}</span>
                </button>
              ))}
            </div>
            <Button className="w-full h-11 font-semibold" style={{ background: BRAND }}
              onClick={() => setStep("select")}>
              Next — Select {orderType === "supplier" ? "Suppliers" : "Categories"}
            </Button>
          </div>
        )}

        {step === "select" && (
          <div className="p-6 space-y-4">
            <button onClick={() => setStep("type")} className="text-xs text-muted-foreground flex items-center gap-1 hover:underline">
              <ArrowLeft size={12} /> Back
            </button>
            <p className="text-sm font-medium">Select {orderType === "supplier" ? "supplier(s)" : "categor(ies)"} to order from:</p>
            <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
              {options.map(opt => (
                <button key={opt.key} onClick={() => toggle(opt.key)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border text-sm text-left transition-all"
                  style={selectedKeys.includes(opt.key)
                    ? { borderColor: BRAND, background: BRAND_LIGHT, color: BRAND, fontWeight: 600 }
                    : { borderColor: "#E5E7EB" }}>
                  <div className="w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0"
                    style={selectedKeys.includes(opt.key) ? { background: BRAND, borderColor: BRAND } : { borderColor: "#D1D5DB" }}>
                    {selectedKeys.includes(opt.key) && <Check size={10} className="text-white" />}
                  </div>
                  <span className="flex-1">{opt.label}</span>
                  {(opt as any).childCount > 0 && (
                    <span className="text-xs px-1.5 py-0.5 rounded-full font-medium"
                      style={{ background: selectedKeys.includes(opt.key) ? `${BRAND}30` : "#F3F4F6", color: selectedKeys.includes(opt.key) ? BRAND : "#6B7280" }}>
                      {(opt as any).childCount} vendor{(opt as any).childCount !== 1 ? "s" : ""}
                    </span>
                  )}
                </button>
              ))}
            </div>
            {selectedKeys.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Order will be named: <strong>{autoOrderName(orderType, selectedKeys, suppliers, categories)}</strong>
              </p>
            )}
            <Button className="w-full h-11 font-semibold" style={{ background: BRAND }}
              disabled={selectedKeys.length === 0 || createMutation.isPending}
              onClick={() => createMutation.mutate()}>
              {createMutation.isPending ? "Creating…" : "Generate Order Table →"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── CBD Config Manager ─────────────────────────────────────────────────────────
function CbdConfigManager({ onClose, ingredients, subRecipes, recipes }: {
  onClose: () => void;
  ingredients: IngredientRaw[];
  subRecipes: SubRecipe[];
  recipes: Recipe[];
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [addType, setAddType] = useState<"ingredient" | "sub_recipe" | "recipe">("ingredient");
  const [search, setSearch] = useState("");
  const [baseUnit, setBaseUnit] = useState("each");
  const [addCategory, setAddCategory] = useState("General");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editUnit, setEditUnit] = useState("");
  const [editCategory, setEditCategory] = useState("");

  const { data: configItems = [], isLoading } = useQuery<CbdConfigItem[]>({
    queryKey: ["/api/cbd-config"],
    queryFn: () => apiRequest("GET", "/api/cbd-config").then(r => r.json()),
  });

  // Group existing items by category
  const sortedCategories = Array.from(new Set(configItems.map(c => c.category || "General"))).sort();

  // Candidates to add — exclude already-added items of the same type+id
  const existingIds = new Set(configItems.filter(c => c.item_type === addType).map(c => c.item_id));
  const candidates = addType === "ingredient"
    ? ingredients.filter(i => !existingIds.has(i.id) && i.name.toLowerCase().includes(search.toLowerCase()))
    : addType === "sub_recipe"
    ? subRecipes.filter(s => !existingIds.has(s.id) && s.name.toLowerCase().includes(search.toLowerCase()))
    : recipes.filter(r => !existingIds.has(r.id) && r.name.toLowerCase().includes(search.toLowerCase()));

  const addMutation = useMutation({
    mutationFn: async (item: { id: number; name: string; unit?: string }) => {
      const res = await apiRequest("POST", "/api/cbd-config", {
        item_type: addType, item_id: item.id, item_name: item.name,
        base_unit: baseUnit || item.unit || "each",
        category: addCategory.trim() || "General",
      });
      if (!res.ok) throw new Error("Failed to add item");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/cbd-config"] });
      setSearch("");
      toast({ description: "Item added to CBD order list" });
    },
    onError: (e: any) => toast({ description: e.message, variant: "destructive" }),
  });

  const editMutation = useMutation({
    mutationFn: async ({ id, name, unit, category }: { id: number; name: string; unit: string; category: string }) => {
      const res = await apiRequest("PATCH", `/api/cbd-config/${id}`, { item_name: name, base_unit: unit, category: category.trim() || "General" });
      if (!res.ok) throw new Error("Failed to update");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/cbd-config"] });
      setEditingId(null);
      toast({ description: "Item updated" });
    },
    onError: (e: any) => toast({ description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/cbd-config/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/cbd-config"] }); toast({ description: "Item removed" }); },
    onError: (e: any) => toast({ description: e.message, variant: "destructive" }),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 flex items-center gap-3" style={{ background: CBD_COLOR }}>
          <button onClick={onClose} className="text-white/70 hover:text-white"><ArrowLeft size={18} /></button>
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-white/70">CBD Store</p>
            <h2 className="text-base font-bold text-white">Manage CBD Order Items</h2>
          </div>
        </div>

        <div className="overflow-y-auto flex-1 p-5 space-y-5">
          {/* Existing items — grouped by category */}
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2">Current Order List ({configItems.length} items)</p>
            {isLoading ? (
              <div className="text-sm text-muted-foreground text-center py-4">Loading…</div>
            ) : configItems.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-6 border-2 border-dashed rounded-xl">
                No items configured yet. Add items below.
              </div>
            ) : (
              <div className="space-y-1.5">
                {sortedCategories.map(cat => {
                  const catItems = configItems.filter(c => (c.category || "General") === cat);
                  if (catItems.length === 0) return null;
                  return (
                    <div key={cat}>
                      <div className="flex items-center gap-1.5 mb-1 mt-2">
                        <Tag size={12} style={{ color: CBD_COLOR }} />
                        <span className="text-xs font-semibold text-muted-foreground uppercase">{cat}</span>
                      </div>
                      {catItems.map(item => (
                        <div key={item.id}
                          className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-muted/20">
                          {editingId === item.id ? (
                            <>
                              <div className="flex-1 flex flex-col gap-1">
                                <Input value={editName} onChange={e => setEditName(e.target.value)} placeholder="Item name" className="h-7 text-sm" />
                                <div className="flex gap-1">
                                  <Input value={editUnit} onChange={e => setEditUnit(e.target.value)} placeholder="unit" className="h-7 text-sm w-20" />
                                  <Input value={editCategory} onChange={e => setEditCategory(e.target.value)} placeholder="category" className="h-7 text-sm flex-1" />
                                </div>
                              </div>
                              <button onClick={() => editMutation.mutate({ id: item.id, name: editName, unit: editUnit, category: editCategory })}
                                className="text-green-600 hover:text-green-700"><Check size={14} /></button>
                              <button onClick={() => setEditingId(null)} className="text-muted-foreground hover:text-foreground"><X size={14} /></button>
                            </>
                          ) : (
                            <>
                              <span className="flex-1 text-sm">{item.item_name}</span>
                              <span className="text-xs text-muted-foreground px-1.5 py-0.5 rounded bg-muted">{item.base_unit}</span>
                              <button onClick={() => { setEditingId(item.id); setEditName(item.item_name); setEditUnit(item.base_unit); setEditCategory(item.category || "General"); }}
                                className="text-muted-foreground hover:text-foreground p-1"><Pencil size={12} /></button>
                              <button onClick={() => deleteMutation.mutate(item.id)}
                                className="text-muted-foreground hover:text-red-500 p-1"><Trash2 size={12} /></button>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Add new item */}
          <div className="border-t pt-4">
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-3">Add Item</p>
            {/* Type selector */}
            <div className="flex gap-1.5 mb-3">
              {(["ingredient", "sub_recipe", "recipe"] as const).map(type => {
                const Icon = ITEM_TYPE_ICONS[type];
                return (
                  <button key={type} onClick={() => { setAddType(type); setSearch(""); }}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border text-xs font-semibold transition-all"
                    style={addType === type ? { borderColor: CBD_COLOR, background: CBD_LIGHT, color: CBD_COLOR } : { borderColor: "#E5E7EB", color: "#6B7280" }}>
                    <Icon size={12} /> {ITEM_TYPE_LABELS[type]}
                  </button>
                );
              })}
            </div>

            <div className="grid grid-cols-2 gap-2 mb-2">
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input value={search} onChange={e => setSearch(e.target.value)}
                  placeholder={`Search ${ITEM_TYPE_LABELS[addType]}s…`}
                  className="pl-8 h-9 text-sm" />
              </div>
              <Input value={addCategory} onChange={e => setAddCategory(e.target.value)}
                placeholder="Category (e.g. Sauces)" className="h-9 text-sm" />
            </div>
            <div className="flex items-center gap-1.5 mb-2">
              <span className="text-xs text-muted-foreground whitespace-nowrap">Base unit:</span>
              <Input value={baseUnit} onChange={e => setBaseUnit(e.target.value)}
                placeholder="each" className="w-24 h-8 text-sm" />
            </div>

            <div className="space-y-1 max-h-48 overflow-y-auto">
              {candidates.slice(0, 20).map((item: any) => (
                <button key={item.id}
                  onClick={() => addMutation.mutate({ id: item.id, name: item.name, unit: item.unit })}
                  disabled={addMutation.isPending}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border text-sm text-left hover:border-[#5AB693] hover:bg-[#EBF9F3] transition-all">
                  <Plus size={13} style={{ color: CBD_COLOR }} />
                  <span className="flex-1">{item.name}</span>
                  {item.unit && <span className="text-xs text-muted-foreground">{item.unit}</span>}
                </button>
              ))}
              {candidates.length === 0 && search && (
                <p className="text-xs text-muted-foreground text-center py-3">No matching {ITEM_TYPE_LABELS[addType]}s found</p>
              )}
              {candidates.length === 0 && !search && (
                <p className="text-xs text-muted-foreground text-center py-3">All {ITEM_TYPE_LABELS[addType]}s already added</p>
              )}
            </div>
          </div>
        </div>

        <div className="p-4 border-t">
          <Button className="w-full" style={{ background: CBD_COLOR }} onClick={onClose}>Done</Button>
        </div>
      </div>
    </div>
  );
}

// ─── CBD Order View (detail) ───────────────────────────────────────────────────
function CbdOrderDetailView({ order, onBack }: { order: StockOrder; onBack: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const items: CbdOrderItem[] = Array.isArray(order.cbd_items)
    ? order.cbd_items
    : (() => { try { return JSON.parse(order.cbd_items as any || '[]'); } catch { return []; } })();

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="p-2 rounded-lg hover:bg-muted/50"><ArrowLeft size={18} /></button>
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-bold truncate">{order.name}</h2>
          <p className="text-xs text-muted-foreground">
            {items.length} items · Placed {fmtDateTime(order.placed_at)}
            {order.order_date && ` · For ${new Date(order.order_date + 'T00:00:00').toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })}`}
          </p>
        </div>
        <StatusBadge status={order.status} />
      </div>

      <div className="rounded-xl border overflow-hidden" style={{ borderColor: CBD_COLOR }}>
        <div className="px-4 py-2.5 flex items-center gap-2" style={{ background: CBD_LIGHT, borderBottom: `2px solid ${CBD_COLOR}` }}>
          <Store size={14} style={{ color: CBD_COLOR }} />
          <span className="text-sm font-bold" style={{ color: CBD_COLOR }}>CBD → Production Kitchen</span>
        </div>
        <div>
          {Array.from(new Set(items.map(it => it.category || "General"))).sort().map(cat => {
            const catItems = items.filter(it => (it.category || "General") === cat);
            return (
              <div key={cat}>
                <div className="px-4 py-1.5 flex items-center gap-1.5 bg-muted/30 border-b border-t">
                  <Tag size={11} style={{ color: CBD_COLOR }} />
                  <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: CBD_COLOR }}>{cat}</span>
                </div>
                {catItems.map((it, i) => (
                  <div key={i} className="px-4 py-3 flex items-center gap-3 border-b last:border-b-0">
                    <div className="flex-1">
                      <p className="text-sm font-medium">{it.item_name}</p>
                    </div>
                    <div className="text-sm font-bold" style={{ color: CBD_COLOR }}>
                      {it.qty_ordered} <span className="text-xs font-normal text-muted-foreground">{it.base_unit}</span>
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>

      {order.notes && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-xs font-semibold text-amber-700 mb-1">Notes</p>
          <p className="text-sm">{order.notes}</p>
        </div>
      )}
    </div>
  );
}

// ─── Order Table (filling in qty to order) ─────────────────────────────────────
function OrderTableView({ order, suppliers, ingredients, parLevels, onBack, onPlaced }: {
  order: StockOrder; suppliers: Supplier[]; ingredients: IngredientRaw[];
  parLevels: ParLevel[]; onBack: () => void; onPlaced: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const typeKeys: string[] = (() => { try { return JSON.parse(order.type_keys || "[]"); } catch { return []; } })();

  const { data: allSupplierIngs = [], isLoading: siLoading } = useQuery<SupplierIngredient[]>({
    queryKey: ["/api/supplier-ingredients"],
    queryFn: () => apiRequest("GET", "/api/supplier-ingredients").then(r => r.json()),
    staleTime: 60000,
  });

  const { data: allSuppliers = [] } = useQuery<Supplier[]>({
    queryKey: ["/api/suppliers"],
    queryFn: () => apiRequest("GET", "/api/suppliers").then(r => r.json()),
    staleTime: 300000,
  });
  const expandedSupplierIds = new Set<string>(typeKeys);
  for (const key of typeKeys) {
    const children = allSuppliers.filter(s => String(s.parent_supplier_id) === key);
    children.forEach(c => expandedSupplierIds.add(String(c.id)));
  }

  const supplierIngredientIds = new Set(
    allSupplierIngs
      .filter(si => expandedSupplierIds.has(String(si.supplier_id)))
      .map(si => si.ingredient_id)
  );

  const scopedIngredients = ingredients.filter(ing => {
    if (order.order_type === "supplier") {
      return supplierIngredientIds.has(ing.id);
    }
    return typeKeys.includes(ing.category || "General");
  });

  const groups: Record<string, IngredientRaw[]> = {};
  for (const ing of scopedIngredients) {
    let key: string;
    if (order.order_type === "supplier") {
      const linkedSIs = allSupplierIngs.filter(si => si.ingredient_id === ing.id && expandedSupplierIds.has(String(si.supplier_id)));
      const preferred = linkedSIs.find(si => si.is_preferred) || linkedSIs[0];
      key = preferred ? String(preferred.supplier_id) : [...expandedSupplierIds][0];
    } else {
      key = ing.category || "General";
    }
    groups[key] = groups[key] || [];
    groups[key].push(ing);
  }

  const [qtys, setQtys] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [confirmedSent, setConfirmedSent] = useState(false);

  const { data: historyMap = {} } = useQuery<Record<number, IngredientHistory>>({
    queryKey: ["/api/orders/history-batch", scopedIngredients.map(i => i.id).join(",")],
    queryFn: async () => {
      const entries = await Promise.all(
        scopedIngredients.map(async (ing) => {
          const r = await apiRequest("GET", `/api/orders/ingredient-history/${ing.id}`);
          const d = await r.json();
          return [ing.id, d] as [number, IngredientHistory];
        })
      );
      return Object.fromEntries(entries);
    },
    enabled: scopedIngredients.length > 0,
    staleTime: 60000,
  });

  const getSI = (ingId: number, suppId?: number) => {
    if (suppId) {
      const exact = allSupplierIngs.find(si => si.ingredient_id === ingId && si.supplier_id === suppId);
      if (exact) return exact;
    }
    const all = allSupplierIngs.filter(si => si.ingredient_id === ingId);
    return all.find(si => si.is_preferred) || all[0];
  };

  const getParLevel = (ingId: number) =>
    parLevels.find(p => p.ingredient_id === ingId);

  const totalItems = Object.values(qtys).filter(v => parseFloat(v) > 0).length;

  if (siLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <div className="w-6 h-6 border-2 border-[#256984] border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-muted-foreground">Loading supplier items…</p>
      </div>
    );
  }

  if (scopedIngredients.length === 0) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="p-2 rounded-lg hover:bg-muted/50"><ArrowLeft size={18} /></button>
          <h2 className="text-base font-bold">{order.name}</h2>
        </div>
        <div className="text-center py-16 text-muted-foreground border-2 border-dashed rounded-xl">
          <Package size={36} className="mx-auto mb-3 opacity-20" />
          <p className="text-sm font-medium">No ingredients linked to this supplier</p>
          <p className="text-xs mt-1">Go to Ingredients → add pricing for this supplier to see items here</p>
        </div>
      </div>
    );
  }

  const saveItems = async () => {
    setSaving(true);
    const items = scopedIngredients
      .filter(ing => parseFloat(qtys[ing.id] || "0") > 0)
      .map(ing => {
        const si = getSI(ing.id);
        return {
          ingredient_id: ing.id,
          supplier_id: ing.best_supplier_id || null,
          supplier_ingredient_id: si?.id || null,
          qty_ordered: parseFloat(qtys[ing.id]),
          unit_size_qty: si?.unit_size_qty || si?.pack_size || null,
          unit_size_unit: si?.unit_size_unit || ing.unit || null,
          supplier_sku: si?.supplier_sku || null,
          supplier_ingredient_name: si?.supplier_ingredient_name || ing.name,
          pack_cost: si?.pack_cost || null,
          has_gst: si?.has_gst ?? true,
          ingredient_name: ing.name,
          ingredient_unit: ing.unit,
          ingredient_category: ing.category || "General",
        };
      });
    try {
      await apiRequest("PUT", `/api/orders/${order.id}/items`, { items });
      await apiRequest("PATCH", `/api/orders/${order.id}`, { status: "placed", placed_at: new Date().toISOString() });
      qc.invalidateQueries({ queryKey: ["/api/orders"] });
      setShowTemplates(true);
    } catch (e: any) {
      toast({ description: e.message || "Failed to save", variant: "destructive" });
    }
    setSaving(false);
  };

  const confirmSent = async () => {
    setConfirmedSent(true);
    onPlaced();
  };

  const buildTemplates = () => {
    const supplierGroups: Record<string, { supplier: Supplier; items: Array<{ name: string; sku?: string; qty: number; unit: string }> }> = {};
    for (const ing of scopedIngredients) {
      const qty = parseFloat(qtys[ing.id] || "0");
      if (qty <= 0) continue;
      const sid = String(ing.best_supplier_id || "0");
      const sup = allSuppliers.find(s => String(s.id) === sid) || suppliers.find(s => String(s.id) === sid);
      if (!sup) continue;
      if (!supplierGroups[sid]) supplierGroups[sid] = { supplier: sup, items: [] };
      const si = getSI(ing.id);
      supplierGroups[sid].items.push({ name: si?.supplier_ingredient_name || ing.name, sku: si?.supplier_sku, qty, unit: si?.unit_size_unit || ing.unit || "" });
    }
    return Object.values(supplierGroups);
  };

  const templates = buildTemplates();

  if (showTemplates) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="p-2 rounded-lg hover:bg-muted/50"><ArrowLeft size={18} /></button>
          <div>
            <h2 className="text-base font-bold">{order.name}</h2>
            <p className="text-xs text-muted-foreground">Order placed — send to suppliers</p>
          </div>
        </div>

        {templates.map(({ supplier, items }) => {
          const deliveryDays = (() => { try { return JSON.parse(supplier.delivery_days || "[]"); } catch { return []; } })();
          const HowIcon = HOW_TO_ORDER_ICONS[supplier.how_to_order || "email"] || Mail;

          const emailText = [
            `Hi ${supplier.contact_name || supplier.name},`,
            ``,
            `Please process the following order for The Deli by Greenhorns:`,
            ``,
            ...items.map(it => `  • ${it.name}${it.sku ? ` (SKU: ${it.sku})` : ""} — ${it.qty} ${it.unit}`),
            ``,
            `Please confirm receipt of this order.`,
            ``,
            `Thanks,`,
            `The Deli by Greenhorns`,
          ].join("\n");

          const smsText = [
            `Hi ${supplier.contact_name || supplier.name}, order from The Deli by Greenhorns:`,
            ...items.map(it => `${it.name}${it.sku ? ` (${it.sku})` : ""} x${it.qty}`),
            `Thanks`,
          ].join("\n");

          return (
            <div key={supplier.id} className="border border-border rounded-xl overflow-hidden">
              <div className="px-4 py-3 flex items-center justify-between" style={{ background: BRAND_LIGHT }}>
                <div>
                  <p className="text-sm font-bold" style={{ color: BRAND }}>{supplier.name}</p>
                  <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                    {supplier.how_to_order && (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground capitalize">
                        <HowIcon size={11} /> {supplier.how_to_order}
                      </span>
                    )}
                    {supplier.order_contact && (
                      <span className="text-xs text-muted-foreground">{supplier.order_contact}</span>
                    )}
                    {supplier.order_cutoff && (
                      <span className="text-xs text-amber-700 font-medium">Cut-off: {supplier.order_cutoff}</span>
                    )}
                    {supplier.min_order_amount && (
                      <span className="text-xs text-muted-foreground">Min: ${supplier.min_order_amount}</span>
                    )}
                    {deliveryDays.length > 0 && (
                      <span className="text-xs text-muted-foreground">Delivers: {deliveryDays.join(", ")}</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Email Template</span>
                  <CopyButton text={emailText} label="Copy email" />
                </div>
                <pre className="text-xs bg-muted/50 rounded-lg p-3 whitespace-pre-wrap font-mono leading-relaxed">{emailText}</pre>
              </div>

              <div className="px-4 pb-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Text/SMS Template</span>
                  <CopyButton text={smsText} label="Copy SMS" />
                </div>
                <pre className="text-xs bg-muted/50 rounded-lg p-3 whitespace-pre-wrap font-mono leading-relaxed">{smsText}</pre>
              </div>
            </div>
          );
        })}

        {!confirmedSent && (
          <Button className="w-full h-12 font-semibold gap-2" style={{ background: BRAND }} onClick={confirmSent}>
            <CheckCircle2 size={16} /> Confirm Order Has Been Sent
          </Button>
        )}
        {confirmedSent && (
          <div className="text-center py-3 text-sm text-green-700 font-medium flex items-center justify-center gap-2">
            <CheckCircle2 size={16} /> Order confirmed as sent
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="p-2 rounded-lg hover:bg-muted/50"><ArrowLeft size={18} /></button>
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-bold truncate">{order.name}</h2>
          <p className="text-xs text-muted-foreground">{scopedIngredients.length} ingredients · {totalItems} selected</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => window.print()} className="gap-1.5 hidden sm:flex">
          <Printer size={14} /> Print
        </Button>
      </div>

      {Object.entries(groups).map(([key, ings]) => {
        const groupLabel = order.order_type === "supplier"
          ? (allSuppliers.find(s => String(s.id) === key)?.name || suppliers.find(s => String(s.id) === key)?.name || "Unknown Supplier")
          : key;
        const suppId = order.order_type === "supplier" ? Number(key) : undefined;
        const color = suppId ? supplierColor(suppId) : BRAND;

        return (
          <div key={key} className="rounded-xl border border-border overflow-hidden">
            <div className="px-4 py-2.5 flex items-center gap-2" style={{ background: `${color}15`, borderBottom: `2px solid ${color}` }}>
              <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: color }} />
              <span className="text-sm font-bold" style={{ color }}>{groupLabel}</span>
              <span className="text-xs text-muted-foreground ml-auto">{ings.length} items</span>
            </div>

            <div className="hidden sm:grid grid-cols-[2fr,1fr,1fr,1fr,1fr,1fr] text-xs font-semibold text-muted-foreground uppercase tracking-wide px-4 py-2 bg-muted/30 border-b">
              <span>Ingredient</span>
              <span className="text-right">Last Ordered</span>
              <span className="text-right">Last Qty</span>
              <span className="text-right">Avg Qty</span>
              <span className="text-right">Pack Size</span>
              <span className="text-right">Qty to Order</span>
            </div>

            {ings.map(ing => {
              const si = getSI(ing.id, suppId);
              const par = getParLevel(ing.id);
              const hist = historyMap[ing.id];
              const qty = qtys[ing.id] || "";
              const hasQty = parseFloat(qty) > 0;
              const packDisplay = si?.unit_size_qty
                ? `${si.unit_size_qty}${si.unit_size_unit || ing.unit}`
                : (si?.pack_size ? `${si.pack_size}${ing.unit}` : "—");
              const priceDisplay = si?.pack_cost ? `$${si.pack_cost.toFixed(2)}` : "";

              return (
                <div key={ing.id}
                  className="px-4 py-3 border-b last:border-b-0 flex flex-col sm:grid sm:grid-cols-[2fr,1fr,1fr,1fr,1fr,1fr] sm:items-center gap-2 transition-colors"
                  style={hasQty ? { background: `${color}08` } : {}}>

                  <div>
                    <p className="text-sm font-semibold">{ing.name}</p>
                    {si?.supplier_ingredient_name && si.supplier_ingredient_name !== ing.name && (
                      <p className="text-xs text-muted-foreground">Supplier: {si.supplier_ingredient_name}</p>
                    )}
                    {si?.supplier_sku && <p className="text-xs text-muted-foreground">SKU: {si.supplier_sku}</p>}
                    {par && <p className="text-xs text-amber-700">Par: {par.par_level} {par.unit}</p>}
                    {priceDisplay && <p className="text-xs text-muted-foreground">{priceDisplay}/pack</p>}
                    <div className="sm:hidden flex flex-wrap gap-x-4 gap-y-0.5 mt-1 text-xs text-muted-foreground">
                      <span>Last: {hist?.last_ordered ? fmtDate(hist.last_ordered) : "—"} {hist?.last_qty != null ? `(${hist.last_qty})` : ""}</span>
                      <span>Avg: {hist?.avg_qty ?? "—"}</span>
                      <span>Pack: {packDisplay}</span>
                    </div>
                  </div>

                  <span className="hidden sm:block text-xs text-right">{hist?.last_ordered ? fmtDate(hist.last_ordered) : "—"}</span>
                  <span className="hidden sm:block text-xs text-right">{hist?.last_qty ?? "—"}</span>
                  <span className="hidden sm:block text-xs text-right">{hist?.avg_qty ?? "—"}</span>
                  <span className="hidden sm:block text-xs text-right">{packDisplay}</span>

                  <div className="flex items-center justify-end gap-1.5">
                    <button onClick={() => setQtys(p => ({ ...p, [ing.id]: String(Math.max(0, (parseFloat(p[ing.id] || "0") - 1))) }))}
                      className="w-8 h-8 rounded-lg border flex items-center justify-center text-muted-foreground hover:bg-muted/50 text-lg leading-none"
                      style={hasQty ? { borderColor: color, color } : {}}>−</button>
                    <input type="number" min="0" value={qty} placeholder="0"
                      onChange={e => setQtys(p => ({ ...p, [ing.id]: e.target.value }))}
                      className="w-14 h-8 text-center text-sm font-bold rounded-lg border outline-none"
                      style={hasQty ? { borderColor: color, color } : { borderColor: "#E5E7EB" }} />
                    <button onClick={() => setQtys(p => ({ ...p, [ing.id]: String((parseFloat(p[ing.id] || "0") + 1)) }))}
                      className="w-8 h-8 rounded-lg border flex items-center justify-center text-sm"
                      style={hasQty ? { background: color, borderColor: color, color: "white" } : { borderColor: "#E5E7EB", color: "#374151" }}>+</button>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}

      <Button className="w-full h-12 font-semibold gap-2" style={{ background: BRAND }}
        disabled={totalItems === 0 || saving}
        onClick={saveItems}>
        {saving ? "Saving…" : `Place Order (${totalItems} item${totalItems !== 1 ? "s" : ""}) →`}
      </Button>
    </div>
  );
}

// ─── Receive Order View ────────────────────────────────────────────────────────
function ReceiveOrderView({ order, onBack, onReceived }: {
  order: StockOrder; onBack: () => void; onReceived: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: items = [], isLoading } = useQuery<OrderItem[]>({
    queryKey: ["/api/orders", order.id, "items"],
    queryFn: () => apiRequest("GET", `/api/orders/${order.id}/items`).then(r => r.json()),
  });

  const [received, setReceived] = useState<Record<number, { qty: string; full: boolean }>>({});

  const patchItem = useMutation({
    mutationFn: ({ itemId, qty }: { itemId: number; qty: number }) =>
      apiRequest("PATCH", `/api/orders/${order.id}/items/${itemId}`, { qty_received: qty }),
  });

  const markReceived = async () => {
    for (const item of items) {
      const r = received[item.id];
      const qty = r?.full ? item.qty_ordered : parseFloat(r?.qty || "0");
      if (!isNaN(qty)) await patchItem.mutateAsync({ itemId: item.id, qty });
    }
    const allFull = items.every(item => {
      const r = received[item.id];
      return r?.full;
    });
    await apiRequest("PATCH", `/api/orders/${order.id}`, {
      status: allFull ? "received" : "partial",
      received_at: new Date().toISOString(),
    });
    qc.invalidateQueries({ queryKey: ["/api/orders"] });
    toast({ description: allFull ? "Order marked as received" : "Order marked as partially received" });
    onReceived();
  };

  const toggle = (itemId: number) =>
    setReceived(prev => ({
      ...prev,
      [itemId]: { qty: String(items.find(i => i.id === itemId)?.qty_ordered || 0), full: !prev[itemId]?.full },
    }));

  const setQty = (itemId: number, qty: string) =>
    setReceived(prev => ({ ...prev, [itemId]: { qty, full: false } }));

  const checkedCount = items.filter(i => received[i.id]?.full).length;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="p-2 rounded-lg hover:bg-muted/50"><ArrowLeft size={18} /></button>
        <div className="flex-1">
          <h2 className="text-base font-bold">{order.name}</h2>
          <p className="text-xs text-muted-foreground">Mark items as received</p>
        </div>
        <StatusBadge status={order.status} />
      </div>

      {isLoading ? (
        <div className="text-center py-8 text-muted-foreground text-sm">Loading…</div>
      ) : (
        <div className="space-y-2">
          {items.map(item => {
            const r = received[item.id];
            const isPartial = r && !r.full;
            return (
              <div key={item.id}
                className="rounded-xl border p-4 flex items-center gap-3 transition-all"
                style={r?.full ? { borderColor: "#5AB693", background: "#F0FDF4" } : { borderColor: "#E5E7EB" }}>
                <Checkbox checked={!!r?.full} onCheckedChange={() => toggle(item.id)}
                  className="w-5 h-5 flex-shrink-0" style={{ accentColor: "#5AB693" }} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold">{item.ingredient_name || `Ingredient #${item.ingredient_id}`}</p>
                  {item.supplier_ingredient_name && item.supplier_ingredient_name !== item.ingredient_name && (
                    <p className="text-xs text-muted-foreground">Supplier name: {item.supplier_ingredient_name}</p>
                  )}
                  {item.supplier_sku && <p className="text-xs text-muted-foreground">SKU: {item.supplier_sku}</p>}
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Ordered: <strong>{item.qty_ordered} {item.unit_size_unit || ""}</strong>
                    {item.pack_cost && ` · $${item.pack_cost.toFixed(2)}/pack`}
                  </p>
                </div>
                {!r?.full && (
                  <div className="flex-shrink-0">
                    <p className="text-xs text-muted-foreground mb-1 text-center">Received</p>
                    <input type="number" min="0" value={r?.qty || ""} placeholder={String(item.qty_ordered)}
                      onChange={e => setQty(item.id, e.target.value)}
                      className="w-20 h-8 text-center text-sm font-semibold rounded-lg border border-amber-300 bg-amber-50 outline-none focus:ring-2 focus:ring-amber-400" />
                  </div>
                )}
                {r?.full && (
                  <span className="text-green-600 flex-shrink-0"><CheckCircle2 size={20} /></span>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Button className="w-full h-12 font-semibold gap-2" style={{ background: BRAND }}
        onClick={markReceived} disabled={items.length === 0}>
        <Truck size={16} />
        {checkedCount === items.length && items.length > 0 ? "Confirm All Received" : "Confirm Receipt"}
      </Button>
    </div>
  );
}

// ─── Order List Row ────────────────────────────────────────────────────────────
function OrderRow({ order, suppliers, onClick, onDelete }: {
  order: StockOrder; suppliers: Supplier[];
  onClick: () => void; onDelete: () => void;
}) {
  const isCbd = order.order_type === "cbd_internal";
  const typeKeys: string[] = (() => { try { return JSON.parse(order.type_keys || "[]"); } catch { return []; } })();
  const colors = isCbd ? [CBD_COLOR] : (order.order_type === "supplier"
    ? typeKeys.map(k => supplierColor(Number(k)))
    : [BRAND]);
  const primaryColor = colors[0] || BRAND;

  return (
    <div className="rounded-xl border border-border bg-white hover:shadow-sm transition-shadow overflow-hidden">
      <div className="h-1 w-full" style={{ background: primaryColor }} />
      <button className="w-full text-left px-4 pt-3 pb-4" onClick={onClick}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              {isCbd && <Store size={13} style={{ color: CBD_COLOR }} className="flex-shrink-0" />}
              <p className="text-sm font-bold truncate">{order.name}</p>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">{fmtDateTime(order.created_at)}</p>
            {order.placed_at && (
              <p className="text-xs text-muted-foreground">Placed: {fmtDateTime(order.placed_at)}</p>
            )}
          </div>
          <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
            <StatusBadge status={order.status} />
          </div>
        </div>
        <div className="flex gap-1.5 mt-2">
          {colors.slice(0, 5).map((c, i) => (
            <div key={i} className="h-1.5 rounded-full flex-1" style={{ background: c }} />
          ))}
        </div>
      </button>
      <div className="px-4 pb-3 flex items-center justify-between">
        <div className="flex gap-1.5 flex-wrap">
          {isCbd ? (
            <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: CBD_LIGHT, color: CBD_COLOR }}>
              CBD → Production
            </span>
          ) : (
            typeKeys.slice(0, 3).map(k => {
              const label = order.order_type === "supplier"
                ? (suppliers.find(s => String(s.id) === k)?.name || k)
                : k;
              return (
                <span key={k} className="text-xs px-2 py-0.5 rounded-full font-medium"
                  style={{ background: `${primaryColor}15`, color: primaryColor }}>{label}</span>
              );
            })
          )}
          {!isCbd && typeKeys.length > 3 && <span className="text-xs text-muted-foreground">+{typeKeys.length - 3}</span>}
        </div>
        <button onClick={e => { e.stopPropagation(); onDelete(); }}
          className="p-1.5 rounded-lg hover:bg-red-50 text-muted-foreground hover:text-red-500 transition-colors">
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

// ─── Main StockOrder Page ──────────────────────────────────────────────────────
export default function StockOrder() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"active" | "completed">("active");
  const [showNewOrder, setShowNewOrder] = useState(false);
  const [showCbdOrder, setShowCbdOrder] = useState(false);
  const [showCbdConfig, setShowCbdConfig] = useState(false);
  const [activeOrder, setActiveOrder] = useState<StockOrder | null>(null);
  const [activeView, setActiveView] = useState<"table" | "receive" | "cbd_detail" | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<StockOrder | null>(null);

  const { data: orders = [], isLoading: ordersLoading } = useQuery<StockOrder[]>({
    queryKey: ["/api/orders"],
    queryFn: () => apiRequest("GET", "/api/orders").then(r => r.json()),
    refetchInterval: 30000,
  });

  const { data: suppliers = [] } = useQuery<Supplier[]>({
    queryKey: ["/api/suppliers"],
    queryFn: () => apiRequest("GET", "/api/suppliers").then(r => r.json()),
  });

  const { data: ingredients = [] } = useQuery<IngredientRaw[]>({
    queryKey: ["/api/ingredients"],
    queryFn: () => apiRequest("GET", "/api/ingredients").then(r => r.json()),
  });

  const { data: subRecipes = [] } = useQuery<SubRecipe[]>({
    queryKey: ["/api/sub-recipes"],
    queryFn: () => apiRequest("GET", "/api/sub-recipes").then(r => r.json()),
  });

  const { data: recipes = [] } = useQuery<Recipe[]>({
    queryKey: ["/api/recipes"],
    queryFn: () => apiRequest("GET", "/api/recipes").then(r => r.json()),
  });

  const { data: parLevels = [] } = useQuery<ParLevel[]>({
    queryKey: ["/api/stock-order/par-levels"],
    queryFn: () => apiRequest("GET", "/api/stock-order/par-levels").then(r => r.json()),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/orders/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/orders"] }); setDeleteConfirm(null); },
    onError: () => toast({ description: "Failed to delete order", variant: "destructive" }),
  });

  const activeOrders = orders.filter(o => !["received", "cancelled"].includes(o.status));
  const completedOrders = orders.filter(o => ["received", "cancelled"].includes(o.status));

  const openOrder = (order: StockOrder) => {
    setActiveOrder(order);
    if (order.order_type === "cbd_internal") {
      setActiveView("cbd_detail");
    } else {
      setActiveView(["placed", "partial"].includes(order.status) ? "receive" : "table");
    }
  };

  // ── Order detail view ──
  if (activeOrder) {
    return (
      <div className="p-4 max-w-3xl mx-auto pb-24">
        {activeView === "table" && (
          <OrderTableView
            order={activeOrder} suppliers={suppliers}
            ingredients={ingredients} parLevels={parLevels}
            onBack={() => { setActiveOrder(null); setActiveView(null); }}
            onPlaced={() => setActiveView("receive")}
          />
        )}
        {activeView === "receive" && (
          <ReceiveOrderView
            order={activeOrder}
            onBack={() => { setActiveOrder(null); setActiveView(null); }}
            onReceived={() => { setActiveOrder(null); setActiveView(null); }}
          />
        )}
        {activeView === "cbd_detail" && (
          <CbdOrderDetailView
            order={activeOrder}
            onBack={() => { setActiveOrder(null); setActiveView(null); }}
          />
        )}
      </div>
    );
  }

  return (
    <div className="p-4 max-w-2xl mx-auto pb-24">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold">Stock Orders</h1>
          <p className="text-xs text-muted-foreground mt-0.5">{activeOrders.length} in progress</p>
        </div>
        <Button onClick={() => setShowNewOrder(true)} className="gap-2 font-semibold h-10"
          style={{ background: BRAND }}>
          <Plus size={16} /> Place New Order
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-muted/40 rounded-xl p-1 mb-5">
        {([["active", "In Progress", activeOrders.length], ["completed", "Completed", completedOrders.length]] as const).map(([val, label, count]) => (
          <button key={val} onClick={() => setTab(val)}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all"
            style={tab === val ? { background: "white", color: BRAND, boxShadow: "0 1px 3px rgba(0,0,0,0.1)" } : { color: "#6B7280" }}>
            {label}
            <span className="text-xs rounded-full px-1.5 py-0.5 font-semibold"
              style={tab === val ? { background: BRAND_LIGHT, color: BRAND } : { background: "#E5E7EB", color: "#6B7280" }}>
              {count}
            </span>
          </button>
        ))}
      </div>

      {/* Order list */}
      {ordersLoading ? (
        <div className="text-center py-12 text-muted-foreground text-sm">Loading orders…</div>
      ) : (
        <div className="space-y-3">
          {(tab === "active" ? activeOrders : completedOrders).length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <ShoppingCart size={40} className="mx-auto mb-3 opacity-20" />
              <p className="text-sm font-medium">
                {tab === "active" ? "No orders in progress" : "No completed orders"}
              </p>
              {tab === "active" && (
                <Button onClick={() => setShowNewOrder(true)} className="mt-4 gap-2" style={{ background: BRAND }}>
                  <Plus size={15} /> Place First Order
                </Button>
              )}
            </div>
          ) : (
            (tab === "active" ? activeOrders : completedOrders).map(order => (
              <OrderRow key={order.id} order={order} suppliers={suppliers}
                onClick={() => openOrder(order)}
                onDelete={() => setDeleteConfirm(order)} />
            ))
          )}
        </div>
      )}

      {/* New order modal */}
      {showNewOrder && (
        <PlaceOrderModal
          suppliers={suppliers} ingredients={ingredients}
          onClose={() => setShowNewOrder(false)}
          onCreate={(order) => { qc.invalidateQueries({ queryKey: ["/api/orders"] }); openOrder(order); }}
          onOpenCbdConfig={() => { setShowNewOrder(false); setShowCbdConfig(true); }}
        />
      )}

      {/* CBD order direct modal */}
      {showCbdOrder && (
        <PlaceOrderModal
          suppliers={suppliers} ingredients={ingredients}
          onClose={() => setShowCbdOrder(false)}
          onCreate={(order) => { qc.invalidateQueries({ queryKey: ["/api/orders"] }); openOrder(order); }}
          onOpenCbdConfig={() => { setShowCbdOrder(false); setShowCbdConfig(true); }}
          initialMode="cbd"
        />
      )}

      {/* CBD Config Manager */}
      {showCbdConfig && (
        <CbdConfigManager
          onClose={() => setShowCbdConfig(false)}
          ingredients={ingredients}
          subRecipes={subRecipes}
          recipes={recipes}
        />
      )}

      {/* Delete confirm */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl space-y-4">
            <h3 className="text-base font-bold">Delete order?</h3>
            <p className="text-sm text-muted-foreground">
              "<strong>{deleteConfirm.name}</strong>" will be permanently deleted.
            </p>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
              <Button className="flex-1 bg-red-500 hover:bg-red-600 text-white"
                onClick={() => deleteMutation.mutate(deleteConfirm.id)}
                disabled={deleteMutation.isPending}>
                {deleteMutation.isPending ? "Deleting…" : "Delete"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
