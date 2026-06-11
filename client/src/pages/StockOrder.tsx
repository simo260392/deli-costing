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
  Package,
  Check,
  Edit2,
  FileText,
  X,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Ingredient {
  id: number;
  name: string;
  category: string;
  unit: string;
  bestSupplierId?: number;
}

interface Supplier {
  id: number;
  name: string;
  contactName?: string;
  email?: string;
  phone?: string;
}

interface SupplierIngredient {
  id: number;
  supplierId: number;
  ingredientId: number;
  packSize?: number;
  packCost?: number;
}

interface ParLevel {
  id: number;
  ingredient_id: number;
  par_level: number;
  unit: string;
}

interface DraftOrder {
  id: number;
  name: string;
  status: "draft" | "submitted";
  created_at: string;
  updated_at: string;
}

interface OrderItem {
  id: number;
  draft_id: number;
  ingredient_id: number;
  order_qty: number;
  notes: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function groupBy<T>(arr: T[], key: (item: T) => string): Record<string, T[]> {
  return arr.reduce((acc, item) => {
    const k = key(item);
    if (!acc[k]) acc[k] = [];
    acc[k].push(item);
    return acc;
  }, {} as Record<string, T[]>);
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function StockOrder() {
  const qc = useQueryClient();

  // Active draft
  const [activeDraftId, setActiveDraftId] = useState<number | null>(null);
  const [showDraftList, setShowDraftList] = useState(false);
  const [newDraftName, setNewDraftName] = useState("");
  const [editingDraftName, setEditingDraftName] = useState(false);
  const [draftNameValue, setDraftNameValue] = useState("");

  // Report modal
  const [showReport, setShowReport] = useState(false);

  // Collapsed categories
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  // Local order qty state (ingredientId → qty string for input)
  const [localQty, setLocalQty] = useState<Record<number, string>>({});
  const saveTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  // Par level editing
  const [editingPar, setEditingPar] = useState<number | null>(null);
  const [parValue, setParValue] = useState("");

  // ── Queries ────────────────────────────────────────────────────────────────

  const { data: ingredients = [] } = useQuery<Ingredient[]>({
    queryKey: ["/api/ingredients"],
  });

  const { data: suppliers = [] } = useQuery<Supplier[]>({
    queryKey: ["/api/suppliers"],
  });

  const { data: supplierIngredients = [] } = useQuery<SupplierIngredient[]>({
    queryKey: ["/api/supplier-ingredients"],
  });

  const { data: parLevels = [] } = useQuery<ParLevel[]>({
    queryKey: ["/api/stock-order/par-levels"],
  });

  const { data: drafts = [] } = useQuery<DraftOrder[]>({
    queryKey: ["/api/stock-order/drafts"],
  });

  const { data: draftItems = [] } = useQuery<OrderItem[]>({
    queryKey: ["/api/stock-order/drafts", activeDraftId, "items"],
    queryFn: () =>
      activeDraftId
        ? apiRequest("GET", `/api/stock-order/drafts/${activeDraftId}/items`).then((r) => r.json())
        : Promise.resolve([]),
    enabled: !!activeDraftId,
  });

  // ── Sync local qty from draft items ───────────────────────────────────────

  useEffect(() => {
    const map: Record<number, string> = {};
    draftItems.forEach((item) => {
      map[item.ingredient_id] = item.order_qty > 0 ? String(item.order_qty) : "";
    });
    setLocalQty(map);
  }, [draftItems]);

  // ── Auto-select or create draft on first load ──────────────────────────────

  useEffect(() => {
    if (drafts.length > 0 && activeDraftId === null) {
      const draft = drafts.find((d) => d.status === "draft") || drafts[0];
      setActiveDraftId(draft.id);
      setDraftNameValue(draft.name);
    }
  }, [drafts, activeDraftId]);

  // ── Mutations ──────────────────────────────────────────────────────────────

  const createDraft = useMutation({
    mutationFn: (name: string) =>
      apiRequest("POST", "/api/stock-order/drafts", { name }).then((r) => r.json()),
    onSuccess: (data: DraftOrder) => {
      qc.invalidateQueries({ queryKey: ["/api/stock-order/drafts"] });
      setActiveDraftId(data.id);
      setDraftNameValue(data.name);
      setShowDraftList(false);
      setLocalQty({});
    },
  });

  const renameDraft = useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) =>
      apiRequest("PATCH", `/api/stock-order/drafts/${id}`, { name }).then((r) => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/stock-order/drafts"] }),
  });

  const deleteDraft = useMutation({
    mutationFn: (id: number) =>
      apiRequest("DELETE", `/api/stock-order/drafts/${id}`).then((r) => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/stock-order/drafts"] });
      setActiveDraftId(null);
      setLocalQty({});
    },
  });

  const saveItem = useMutation({
    mutationFn: ({ ingredientId, orderQty }: { ingredientId: number; orderQty: number }) =>
      apiRequest("PUT", `/api/stock-order/drafts/${activeDraftId}/items`, {
        ingredientId,
        orderQty,
      }).then((r) => r.json()),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["/api/stock-order/drafts", activeDraftId, "items"] }),
  });

  const upsertPar = useMutation({
    mutationFn: ({ ingredientId, parLevel, unit }: { ingredientId: number; parLevel: number; unit: string }) =>
      apiRequest("PUT", `/api/stock-order/par-levels/${ingredientId}`, { parLevel, unit }).then((r) => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/stock-order/par-levels"] }),
  });

  // ── Derived data ───────────────────────────────────────────────────────────

  const parMap = Object.fromEntries(parLevels.map((p) => [p.ingredient_id, p]));
  const itemMap = Object.fromEntries(draftItems.map((i) => [i.ingredient_id, i]));

  // Non-packaging ingredients, sorted by name within category
  const filteredIngredients = ingredients
    .filter((i) => i.category !== "Packaging")
    .sort((a, b) => a.name.localeCompare(b.name));

  const grouped = groupBy(filteredIngredients, (i) => i.category || "General");
  const categories = Object.keys(grouped).sort();

  // Items with a non-zero order qty
  const orderedItems = filteredIngredients.filter(
    (i) => (parseFloat(localQty[i.id] || "0") || 0) > 0
  );

  // ── Qty change handler with debounced save ────────────────────────────────

  const handleQtyChange = useCallback(
    (ingredientId: number, value: string) => {
      setLocalQty((prev) => ({ ...prev, [ingredientId]: value }));
      if (!activeDraftId) return;
      clearTimeout(saveTimers.current[ingredientId]);
      saveTimers.current[ingredientId] = setTimeout(() => {
        const qty = parseFloat(value);
        saveItem.mutate({ ingredientId, orderQty: isNaN(qty) ? 0 : qty });
      }, 800);
    },
    [activeDraftId, saveItem]
  );

  // ── Par level save ─────────────────────────────────────────────────────────

  const handleParSave = (ing: Ingredient) => {
    const val = parseFloat(parValue);
    if (isNaN(val) || val < 0) {
      setEditingPar(null);
      return;
    }
    upsertPar.mutate({ ingredientId: ing.id, parLevel: val, unit: ing.unit });
    setEditingPar(null);
  };

  // ── Report data grouped by supplier ───────────────────────────────────────

  const buildReport = () => {
    const bySupplier: Record<
      number,
      { supplier: Supplier; items: { ingredient: Ingredient; qty: number; unit: string; packSize?: number }[] }
    > = {};
    const noSupplier: { ingredient: Ingredient; qty: number; unit: string }[] = [];

    orderedItems.forEach((ing) => {
      const qty = parseFloat(localQty[ing.id] || "0") || 0;
      // Find best supplier
      const suppId = ing.bestSupplierId;
      if (!suppId) {
        noSupplier.push({ ingredient: ing, qty, unit: ing.unit });
        return;
      }
      const supplier = suppliers.find((s) => s.id === suppId);
      if (!supplier) {
        noSupplier.push({ ingredient: ing, qty, unit: ing.unit });
        return;
      }
      const si = supplierIngredients.find(
        (x) => x.supplierId === suppId && x.ingredientId === ing.id
      );
      if (!bySupplier[suppId]) bySupplier[suppId] = { supplier, items: [] };
      bySupplier[suppId].items.push({ ingredient: ing, qty, unit: ing.unit, packSize: si?.packSize });
    });

    return { bySupplier: Object.values(bySupplier), noSupplier };
  };

  // ── Print handler ──────────────────────────────────────────────────────────

  const handlePrint = () => {
    window.print();
  };

  // ── Active draft object ────────────────────────────────────────────────────

  const activeDraft = drafts.find((d) => d.id === activeDraftId);

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="p-4 max-w-5xl mx-auto print:p-0">
      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-6 print:hidden">
        <div className="flex items-center gap-3">
          <ShoppingCart className="w-6 h-6 text-[#256984]" />
          <h1 className="text-2xl font-bold text-[#256984]">Stock Ordering</h1>
        </div>
        <div className="flex items-center gap-2">
          {orderedItems.length > 0 && (
            <Button
              onClick={() => setShowReport(true)}
              className="bg-[#256984] hover:bg-[#1e5470] text-white gap-2"
            >
              <FileText className="w-4 h-4" />
              View Order Report
              <Badge className="bg-white text-[#256984] ml-1 px-1.5 py-0 text-xs">
                {orderedItems.length}
              </Badge>
            </Button>
          )}
          <Button
            variant="outline"
            onClick={() => setShowDraftList(true)}
            className="border-[#256984] text-[#256984] gap-2"
          >
            <Package className="w-4 h-4" />
            Orders
          </Button>
        </div>
      </div>

      {/* ── Draft selector bar ── */}
      {activeDraft && (
        <div className="flex items-center gap-3 mb-6 bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 print:hidden">
          <Package className="w-4 h-4 text-[#256984] shrink-0" />
          {editingDraftName ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                renameDraft.mutate({ id: activeDraft.id, name: draftNameValue });
                setEditingDraftName(false);
              }}
              className="flex items-center gap-2 flex-1"
            >
              <Input
                value={draftNameValue}
                onChange={(e) => setDraftNameValue(e.target.value)}
                className="h-8 text-sm flex-1 max-w-xs"
                autoFocus
              />
              <Button type="submit" size="sm" className="h-8 bg-[#256984] text-white">
                Save
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-8"
                onClick={() => {
                  setEditingDraftName(false);
                  setDraftNameValue(activeDraft.name);
                }}
              >
                Cancel
              </Button>
            </form>
          ) : (
            <>
              <div className="flex-1">
                <span className="font-medium text-[#256984]">{activeDraft.name}</span>
                <span className="ml-2 text-xs text-gray-400">
                  Updated {formatDate(activeDraft.updated_at)}
                </span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-gray-500 gap-1"
                onClick={() => {
                  setEditingDraftName(true);
                  setDraftNameValue(activeDraft.name);
                }}
              >
                <Edit2 className="w-3.5 h-3.5" />
                Rename
              </Button>
            </>
          )}
          <Badge
            variant={activeDraft.status === "draft" ? "outline" : "default"}
            className={
              activeDraft.status === "draft"
                ? "border-amber-400 text-amber-600"
                : "bg-green-600 text-white"
            }
          >
            {activeDraft.status === "draft" ? "Draft" : "Submitted"}
          </Badge>
        </div>
      )}

      {!activeDraft && (
        <div className="text-center py-16 bg-gray-50 rounded-xl border-2 border-dashed border-gray-200 print:hidden">
          <ShoppingCart className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 mb-4">No active order. Create one to get started.</p>
          <Button
            onClick={() => {
              createDraft.mutate(
                `Stock Order ${new Date().toLocaleDateString("en-AU", { day: "2-digit", month: "short" })}`
              );
            }}
            className="bg-[#256984] hover:bg-[#1e5470] text-white gap-2"
          >
            <Plus className="w-4 h-4" />
            New Stock Order
          </Button>
        </div>
      )}

      {/* ── Ingredient list by category ── */}
      {activeDraft && (
        <div className="space-y-3">
          {categories.map((cat) => {
            const ings = grouped[cat];
            const isCollapsed = collapsed[cat];
            const catOrderCount = ings.filter(
              (i) => (parseFloat(localQty[i.id] || "0") || 0) > 0
            ).length;

            return (
              <div key={cat} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                {/* Category header */}
                <button
                  className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors"
                  onClick={() => setCollapsed((p) => ({ ...p, [cat]: !p[cat] }))}
                >
                  <div className="flex items-center gap-2">
                    {isCollapsed ? (
                      <ChevronRight className="w-4 h-4 text-gray-400" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-gray-400" />
                    )}
                    <span className="font-semibold text-gray-700">{cat}</span>
                    <span className="text-xs text-gray-400">({ings.length} items)</span>
                    {catOrderCount > 0 && (
                      <Badge className="bg-[#256984] text-white text-xs px-2 py-0">
                        {catOrderCount} to order
                      </Badge>
                    )}
                  </div>
                </button>

                {/* Rows */}
                {!isCollapsed && (
                  <div className="divide-y divide-gray-100">
                    {/* Column headers */}
                    <div className="grid grid-cols-12 gap-2 px-4 py-2 bg-gray-50 text-xs text-gray-400 font-medium uppercase tracking-wide">
                      <div className="col-span-5">Ingredient</div>
                      <div className="col-span-2 text-center">Unit</div>
                      <div className="col-span-2 text-center">Par Level</div>
                      <div className="col-span-3 text-center">Order Qty</div>
                    </div>

                    {ings.map((ing) => {
                      const par = parMap[ing.id];
                      const hasQty = (parseFloat(localQty[ing.id] || "0") || 0) > 0;
                      const isEditingThisPar = editingPar === ing.id;

                      return (
                        <div
                          key={ing.id}
                          className={`grid grid-cols-12 gap-2 px-4 py-2.5 items-center transition-colors ${
                            hasQty ? "bg-blue-50" : "hover:bg-gray-50"
                          }`}
                        >
                          {/* Name */}
                          <div className="col-span-5 flex items-center gap-2">
                            {hasQty && <Check className="w-3.5 h-3.5 text-[#256984] shrink-0" />}
                            <span className={`text-sm ${hasQty ? "font-medium text-[#256984]" : "text-gray-700"}`}>
                              {ing.name}
                            </span>
                          </div>

                          {/* Unit */}
                          <div className="col-span-2 text-center text-xs text-gray-500">
                            {ing.unit}
                          </div>

                          {/* Par level */}
                          <div className="col-span-2 text-center">
                            {isEditingThisPar ? (
                              <form
                                onSubmit={(e) => {
                                  e.preventDefault();
                                  handleParSave(ing);
                                }}
                              >
                                <Input
                                  type="number"
                                  step="any"
                                  min="0"
                                  value={parValue}
                                  onChange={(e) => setParValue(e.target.value)}
                                  onBlur={() => handleParSave(ing)}
                                  className="h-7 text-xs text-center w-full"
                                  autoFocus
                                />
                              </form>
                            ) : (
                              <button
                                className="text-xs text-gray-500 hover:text-[#256984] hover:underline w-full text-center"
                                onClick={() => {
                                  setEditingPar(ing.id);
                                  setParValue(par ? String(par.par_level) : "");
                                }}
                              >
                                {par && par.par_level > 0 ? (
                                  <span className="font-medium text-gray-700">
                                    {par.par_level} {ing.unit}
                                  </span>
                                ) : (
                                  <span className="text-gray-300 hover:text-[#256984]">Set par</span>
                                )}
                              </button>
                            )}
                          </div>

                          {/* Order qty */}
                          <div className="col-span-3">
                            <div className="flex items-center gap-1">
                              <Input
                                type="number"
                                step="any"
                                min="0"
                                value={localQty[ing.id] ?? ""}
                                onChange={(e) => handleQtyChange(ing.id, e.target.value)}
                                placeholder={
                                  par && par.par_level > 0 ? `Par: ${par.par_level}` : "0"
                                }
                                className={`h-8 text-sm text-center ${
                                  hasQty
                                    ? "border-[#256984] bg-white font-medium text-[#256984]"
                                    : ""
                                }`}
                              />
                              <span className="text-xs text-gray-400 shrink-0">{ing.unit}</span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Drafts list dialog ── */}
      <Dialog open={showDraftList} onOpenChange={setShowDraftList}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-[#256984]">Stock Orders</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {/* New order form */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                createDraft.mutate(
                  newDraftName ||
                    `Stock Order ${new Date().toLocaleDateString("en-AU", { day: "2-digit", month: "short" })}`
                );
                setNewDraftName("");
              }}
              className="flex gap-2"
            >
              <Input
                value={newDraftName}
                onChange={(e) => setNewDraftName(e.target.value)}
                placeholder="New order name (optional)"
                className="flex-1"
              />
              <Button type="submit" className="bg-[#256984] text-white gap-1">
                <Plus className="w-4 h-4" />
                New
              </Button>
            </form>

            {/* Draft list */}
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {drafts.length === 0 && (
                <p className="text-center text-gray-400 py-6 text-sm">No saved orders yet.</p>
              )}
              {drafts.map((d) => (
                <div
                  key={d.id}
                  className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                    d.id === activeDraftId
                      ? "border-[#256984] bg-blue-50"
                      : "border-gray-200 hover:border-[#256984] hover:bg-blue-50/50"
                  }`}
                  onClick={() => {
                    setActiveDraftId(d.id);
                    setDraftNameValue(d.name);
                    setLocalQty({});
                    setShowDraftList(false);
                  }}
                >
                  <Package className="w-4 h-4 text-[#256984] shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{d.name}</p>
                    <p className="text-xs text-gray-400">{formatDate(d.updated_at)}</p>
                  </div>
                  <Badge
                    variant={d.status === "draft" ? "outline" : "default"}
                    className={
                      d.status === "draft"
                        ? "border-amber-400 text-amber-600 text-xs"
                        : "bg-green-600 text-white text-xs"
                    }
                  >
                    {d.status === "draft" ? "Draft" : "Submitted"}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-red-400 hover:text-red-600 hover:bg-red-50"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm("Delete this order?")) deleteDraft.mutate(d.id);
                    }}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Order Report dialog ── */}
      <Dialog open={showReport} onOpenChange={setShowReport}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-center justify-between">
              <DialogTitle className="text-[#256984]">
                {activeDraft?.name} — Order Report
              </DialogTitle>
              <Button
                variant="outline"
                size="sm"
                className="gap-2 border-[#256984] text-[#256984] print:hidden"
                onClick={handlePrint}
              >
                <Printer className="w-4 h-4" />
                Print / PDF
              </Button>
            </div>
          </DialogHeader>
          <ReportContent
            report={buildReport()}
            draftName={activeDraft?.name || ""}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Report Content ───────────────────────────────────────────────────────────

interface ReportData {
  bySupplier: { supplier: Supplier; items: { ingredient: Ingredient; qty: number; unit: string; packSize?: number }[] }[];
  noSupplier: { ingredient: Ingredient; qty: number; unit: string }[];
}

function ReportContent({
  report,
  draftName,
}: {
  report: ReportData;
  draftName: string;
}) {
  const date = new Date().toLocaleDateString("en-AU", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  return (
    <div className="space-y-6 print:space-y-4">
      {/* Header */}
      <div className="border-b pb-4">
        <h2 className="text-lg font-bold text-[#256984]">{draftName}</h2>
        <p className="text-sm text-gray-500">{date}</p>
      </div>

      {/* By supplier */}
      {report.bySupplier.map(
        ({
          supplier,
          items,
        }: {
          supplier: Supplier;
          items: { ingredient: Ingredient; qty: number; unit: string; packSize?: number }[];
        }) => (
          <div key={supplier.id} className="border rounded-lg overflow-hidden print:border-gray-300">
            {/* Supplier header */}
            <div className="bg-[#256984] text-white px-4 py-2.5">
              <div className="flex items-center justify-between">
                <span className="font-semibold">{supplier.name}</span>
                <div className="flex items-center gap-3 text-xs opacity-90">
                  {supplier.phone && <span>{supplier.phone}</span>}
                  {supplier.email && <span>{supplier.email}</span>}
                </div>
              </div>
            </div>
            {/* Items */}
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-xs text-gray-400 uppercase tracking-wide">
                  <th className="text-left px-4 py-2 font-medium">Item</th>
                  <th className="text-center px-4 py-2 font-medium">Order Qty</th>
                  <th className="text-center px-4 py-2 font-medium">Pack Size</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {items.map(({ ingredient, qty, unit, packSize }) => (
                  <tr key={ingredient.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 font-medium text-gray-800">{ingredient.name}</td>
                    <td className="px-4 py-2.5 text-center font-semibold text-[#256984]">
                      {qty} {unit}
                    </td>
                    <td className="px-4 py-2.5 text-center text-gray-500 text-xs">
                      {packSize ? `${packSize} ${unit}` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {/* No supplier */}
      {report.noSupplier.length > 0 && (
        <div className="border rounded-lg overflow-hidden border-amber-200 print:border-gray-300">
          <div className="bg-amber-50 border-b border-amber-200 px-4 py-2.5">
            <span className="font-semibold text-amber-800">No Supplier Assigned</span>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-xs text-gray-400 uppercase tracking-wide">
                <th className="text-left px-4 py-2 font-medium">Item</th>
                <th className="text-center px-4 py-2 font-medium">Order Qty</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {report.noSupplier.map(
                ({ ingredient, qty, unit }: { ingredient: Ingredient; qty: number; unit: string }) => (
                  <tr key={ingredient.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 font-medium text-gray-800">{ingredient.name}</td>
                    <td className="px-4 py-2.5 text-center font-semibold text-amber-700">
                      {qty} {unit}
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        </div>
      )}

      {report.bySupplier.length === 0 && report.noSupplier.length === 0 && (
        <p className="text-center text-gray-400 py-8">No items to order.</p>
      )}
    </div>
  );
}
