import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Plus, Search, Truck, Send, Check, X, AlertTriangle, Settings, Trash2, PackageCheck,
  Mail, ShoppingBag, History, Car, RotateCcw, Pencil, ArrowLeft, Layers, Tag, ChevronDown, ChevronRight, Apple,
} from "lucide-react";
import { format } from "date-fns";
import MarketsTab from "@/components/MarketsTab";

// ─── Types ─────────────────────────────────────────────────────────────────────
type Method = "driver" | "delivery";
type ItemStatus = "requested" | "ordered" | "collected" | "unavailable" | "received" | "cancelled";
type ListStatus = "draft" | "driver" | "ordered" | "completed" | "cancelled";

interface ListItem {
  id: number; list_id: number; ingredient_id: number | null; item_name: string; qty: number; unit: string | null;
  notes: string | null; status: ItemStatus; handled_by: string | null; handled_at: string | null;
  sku: string | null; supplier_item_name: string | null;
}
interface StockList {
  id: number; supplier_id: number | null; supplier_name: string; status: ListStatus; method: Method | null;
  supplier_method: Method; collect_by: string | null; created_by: string | null; created_at: string;
  sent_by: string | null; sent_at: string | null; sent_via: string | null; sent_to: string | null;
  completed_by: string | null; completed_at: string | null; items: ListItem[];
}
interface TemplateOption { supplierId: number; supplierName: string; method: Method; costPerUnit: number | null; pack: string | null; }
interface TemplateItem {
  ingredientId: number; name: string; unit: string; category: string;
  options: TemplateOption[]; defaultSupplierId: number | null; cheapestSupplierId: number | null;
}
interface SupplierRow {
  id: number; name: string; email: string | null; contact_name: string | null;
  collection_method: Method; parent_supplier_id: number | null;
}

// ─── Brand ─────────────────────────────────────────────────────────────────────
const NAVY = "#256984";
const CREAM = "#FEF9F5";
const YELLOW = "#FBF2CE";
const PINK = "#FCCDE2";
const GREEN = "#5AB693";
const DEEP_GREEN = "#2D5B4A";

// ─── Helpers ───────────────────────────────────────────────────────────────────
const json = (method: string, url: string, body?: unknown) => apiRequest(method, url, body).then(r => r.json());
const qtyText = (r: { qty: number; unit: string | null }) => {
  const q = Number(r.qty);
  return `${Number.isInteger(q) ? q : Math.round(q * 100) / 100}${r.unit ? ` ${r.unit}` : ""}`;
};
const when = (iso?: string | null) => (iso ? format(new Date(iso), "EEE d MMM, h:mma") : "");
const perthYmd = (offsetDays = 0) => {
  const d = new Date(Date.now() + 8 * 3600000 + offsetDays * 86400000);
  return d.toISOString().slice(0, 10);
};
const dayText = (ymd: string) => {
  if (ymd === perthYmd(0)) return "Today";
  if (ymd === perthYmd(1)) return "Tomorrow";
  return format(new Date(`${ymd}T12:00:00`), "EEE d MMM");
};
const money = (n: number | null) => (n == null ? "" : n < 1 ? `$${n.toFixed(3)}` : `$${n.toFixed(2)}`);
const groupBy = <T,>(list: T[], key: (t: T) => string) =>
  list.reduce((acc, t) => { (acc[key(t)] ||= []).push(t); return acc; }, {} as Record<string, T[]>);
const safeStorage = {
  get(k: string) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
  del(k: string) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

function MethodBadge({ method }: { method: Method }) {
  const driver = method === "driver";
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap"
      style={driver ? { background: PINK, color: DEEP_GREEN } : { background: "#E3EEF3", color: NAVY }}>
      {driver ? <Car size={11} /> : <Truck size={11} />}
      {driver ? "Driver pickup" : "Delivered"}
    </span>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] font-bold uppercase tracking-[0.12em] mb-2" style={{ color: GREEN }}>{children}</p>;
}

function useRefresh() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["/api/stock/lists"] });
    qc.invalidateQueries({ queryKey: ["/api/stock/unavailable"] });
  };
}

// ─── New shopping list: step 1, pick what to include ───────────────────────────
type Mode = "all" | "category" | "supplier";

function NewListScope({ suppliers, categories, onNext, onCancel }: {
  suppliers: SupplierRow[]; categories: string[];
  onNext: (mode: Mode, keys: string[]) => void; onCancel: () => void;
}) {
  const [mode, setMode] = useState<Mode>("supplier");
  const [keys, setKeys] = useState<string[]>([]);
  const toggle = (k: string) => setKeys(p => p.includes(k) ? p.filter(x => x !== k) : [...p, k]);
  const options = mode === "category"
    ? categories.map(c => ({ key: c, label: c, method: null as Method | null }))
    : suppliers.filter(s => !s.parent_supplier_id).map(s => ({ key: String(s.id), label: s.name, method: s.collection_method }));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <button onClick={onCancel} className="p-2 -ml-2 rounded-lg hover:bg-white"><ArrowLeft size={18} /></button>
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.12em]" style={{ color: GREEN }}>New shopping list</p>
          <h2 className="text-lg font-extrabold" style={{ color: NAVY }}>What are we ordering?</h2>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {([["supplier", "By supplier", Truck], ["category", "By category", Tag], ["all", "All items", Layers]] as const).map(([m, label, Icon]) => (
          <button key={m} onClick={() => { setMode(m); setKeys([]); }}
            className="flex flex-col items-center gap-1.5 py-3 rounded-xl border-2 bg-white text-sm font-semibold"
            style={mode === m ? { borderColor: NAVY, color: NAVY, background: "#E3EEF3" } : { borderColor: "#E5E7EB", color: "#6B7280" }}>
            <Icon size={20} /> {label}
          </button>
        ))}
      </div>

      {mode !== "all" && (
        <div className="rounded-2xl border bg-white p-2 max-h-[55vh] overflow-y-auto">
          {options.map(o => {
            const on = keys.includes(o.key);
            return (
              <button key={o.key} onClick={() => toggle(o.key)}
                className="w-full flex items-center gap-3 px-3 py-3 rounded-lg text-left"
                style={on ? { background: "#E3EEF3" } : {}}>
                <span className="w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0"
                  style={on ? { background: NAVY, borderColor: NAVY } : { borderColor: "#D1D5DB" }}>
                  {on && <Check size={12} className="text-white" />}
                </span>
                <span className="flex-1 text-sm font-medium">{o.label}</span>
                {o.method && <MethodBadge method={o.method} />}
              </button>
            );
          })}
        </div>
      )}

      <Button className="w-full h-12 text-base font-semibold" style={{ background: NAVY }}
        disabled={mode !== "all" && keys.length === 0} onClick={() => onNext(mode, keys)}>
        Make the list
      </Button>
    </div>
  );
}

// ─── New shopping list: step 2, fill in quantities ─────────────────────────────
interface RowState { qty: string; unit: string; supplierId: string }
interface ExtraRow { name: string; qty: string; unit: string; supplierId: string }

function NewListTemplate({ mode, keys, suppliers, onBack, onDone }: {
  mode: Mode; keys: string[]; suppliers: SupplierRow[]; onBack: () => void; onDone: () => void;
}) {
  const { toast } = useToast();
  const refresh = useRefresh();
  const draftKey = `stock-template:${mode}:${keys.join(",")}`;
  const { data, isLoading } = useQuery<{ items: TemplateItem[] }>({
    queryKey: ["/api/stock/template", mode, keys.join(",")],
    queryFn: () => json("GET", `/api/stock/template?mode=${mode}&keys=${encodeURIComponent(keys.join(","))}`),
    staleTime: 0,
  });
  const items = data?.items ?? [];

  const saved = useMemo(() => {
    try { return JSON.parse(safeStorage.get(draftKey) || "null"); } catch { return null; }
  }, [draftKey]);
  const [rows, setRows] = useState<Record<number, RowState>>(saved?.rows || {});
  const [extras, setExtras] = useState<ExtraRow[]>(saved?.extras || []);
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  useEffect(() => { safeStorage.set(draftKey, JSON.stringify({ rows, extras })); }, [rows, extras, draftKey]);

  const row = (it: TemplateItem): RowState => rows[it.ingredientId] || { qty: "", unit: it.unit, supplierId: "" };
  const setRow = (it: TemplateItem, patch: Partial<RowState>) =>
    setRows(p => ({ ...p, [it.ingredientId]: { ...row(it), ...patch } }));
  const chosenSupplier = (it: TemplateItem) => {
    const r = row(it);
    return r.supplierId ? Number(r.supplierId) : it.defaultSupplierId;
  };

  const filtered = items.filter(it => it.name.toLowerCase().includes(search.trim().toLowerCase()));
  const groups = groupBy(filtered, it => it.category);
  const filled = items.filter(it => Number(row(it).qty) > 0);
  const filledExtras = extras.filter(e => e.name.trim() && Number(e.qty) > 0);
  const missingSupplier = filled.filter(it => !chosenSupplier(it)).length + filledExtras.filter(e => !e.supplierId).length;
  const supplierCount = new Set([
    ...filled.map(it => chosenSupplier(it)).filter(Boolean),
    ...filledExtras.map(e => Number(e.supplierId)).filter(Boolean),
  ]).size;

  const submit = useMutation({
    mutationFn: () => json("POST", "/api/stock/lists", {
      items: [
        ...filled.map(it => ({ ingredientId: it.ingredientId, itemName: it.name, qty: Number(row(it).qty), unit: row(it).unit, supplierId: chosenSupplier(it) })),
        ...filledExtras.map(e => ({ itemName: e.name.trim(), qty: Number(e.qty), unit: e.unit, supplierId: Number(e.supplierId) })),
      ],
    }),
    onSuccess: (r: any) => {
      safeStorage.del(draftKey);
      toast({ description: `${r.listIds.length} shopping list${r.listIds.length > 1 ? "s" : ""} ready to check and send` });
      refresh(); onDone();
    },
    onError: (e: any) => toast({ description: e.message, variant: "destructive" }),
  });

  const supplierName = (id: number | null) => suppliers.find(s => s.id === id)?.name || "";

  return (
    <div className="space-y-4 pb-28">
      <div className="flex items-center gap-2">
        <button onClick={onBack} className="p-2 -ml-2 rounded-lg hover:bg-white"><ArrowLeft size={18} /></button>
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.12em]" style={{ color: GREEN }}>New shopping list</p>
          <h2 className="text-lg font-extrabold truncate" style={{ color: NAVY }}>
            {mode === "all" ? "All items" : mode === "category" ? keys.join(", ") : keys.map(k => supplierName(Number(k))).join(", ")}
          </h2>
        </div>
      </div>

      <div className="rounded-xl p-3 text-sm" style={{ background: YELLOW, color: DEEP_GREEN }}>
        Pop a quantity next to anything on the fridge list. Supplier is set to the cheapest we have on file unless you change it.
      </div>

      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Find an item" className="pl-9 h-11 bg-white text-base" />
      </div>

      {isLoading ? <p className="text-center text-sm text-muted-foreground py-10">Loading items…</p> : (
        Object.entries(groups).map(([cat, list]) => {
          const isCollapsed = collapsed[cat] && !search;
          const catFilled = list.filter(it => Number(row(it).qty) > 0).length;
          return (
            <div key={cat} className="rounded-2xl border bg-white overflow-hidden">
              <button onClick={() => setCollapsed(p => ({ ...p, [cat]: !p[cat] }))}
                className="w-full px-4 py-2.5 flex items-center gap-2 border-b text-left" style={{ background: CREAM }}>
                {isCollapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
                <span className="text-sm font-bold flex-1" style={{ color: NAVY }}>{cat}</span>
                <span className="text-xs text-muted-foreground">{catFilled ? `${catFilled} added · ` : ""}{list.length} items</span>
              </button>
              {!isCollapsed && list.map(it => {
                const r = row(it);
                const has = Number(r.qty) > 0;
                const sid = chosenSupplier(it);
                const def = it.options.find(o => o.supplierId === it.defaultSupplierId);
                const stockistIds = new Set(it.options.map(o => o.supplierId));
                return (
                  <div key={it.ingredientId} className="px-4 py-3 border-b last:border-b-0 space-y-2" style={has ? { background: "#F3F8FA" } : {}}>
                    <div className="flex items-center gap-2">
                      <p className="flex-1 text-sm font-semibold">{it.name}</p>
                      <Input type="number" min="0" step="any" inputMode="decimal" placeholder="0" value={r.qty}
                        onChange={e => setRow(it, { qty: e.target.value })}
                        className="w-16 h-10 text-center text-base font-bold" style={has ? { borderColor: NAVY, color: NAVY } : {}} />
                      <Input value={r.unit} onChange={e => setRow(it, { unit: e.target.value })} placeholder="unit"
                        className="w-20 h-10 text-sm" />
                    </div>
                    <select value={r.supplierId} onChange={e => setRow(it, { supplierId: e.target.value })}
                      className="w-full h-9 rounded-md border px-2 text-xs bg-white"
                      style={has && !sid ? { borderColor: "#DC2626" } : {}}>
                      <option value="">
                        {def ? `Default: ${def.supplierName}${def.costPerUnit != null ? ` (${money(def.costPerUnit)}/${it.unit || "unit"})` : ""}` : "Default: no supplier on file, pick one"}
                      </option>
                      {it.options.length > 0 && (
                        <optgroup label="Suppliers with this item">
                          {it.options.map(o => (
                            <option key={o.supplierId} value={o.supplierId}>
                              {o.supplierName}{o.costPerUnit != null ? ` (${money(o.costPerUnit)}/${it.unit || "unit"})` : ""}
                            </option>
                          ))}
                        </optgroup>
                      )}
                      <optgroup label="Other suppliers">
                        {suppliers.filter(s => !stockistIds.has(s.id)).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </optgroup>
                    </select>
                  </div>
                );
              })}
            </div>
          );
        })
      )}

      <div className="rounded-2xl border bg-white p-4 space-y-3">
        <SectionLabel>Something not on the list?</SectionLabel>
        {extras.map((e, i) => {
          const upd = (patch: Partial<ExtraRow>) => setExtras(p => p.map((x, j) => (j === i ? { ...x, ...patch } : x)));
          return (
            <div key={i} className="space-y-2 pb-3 border-b last:border-b-0">
              <div className="flex gap-2">
                <Input value={e.name} onChange={ev => upd({ name: ev.target.value })} placeholder="Item name" className="flex-1 h-10" />
                <button onClick={() => setExtras(p => p.filter((_, j) => j !== i))} className="px-2 text-muted-foreground"><X size={16} /></button>
              </div>
              <div className="flex gap-2">
                <Input type="number" min="0" step="any" inputMode="decimal" value={e.qty} onChange={ev => upd({ qty: ev.target.value })} placeholder="Qty" className="w-20 h-10" />
                <Input value={e.unit} onChange={ev => upd({ unit: ev.target.value })} placeholder="unit" className="w-20 h-10" />
                <select value={e.supplierId} onChange={ev => upd({ supplierId: ev.target.value })}
                  className="flex-1 h-10 rounded-md border px-2 text-sm bg-white">
                  <option value="">Pick supplier</option>
                  {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            </div>
          );
        })}
        <Button variant="outline" className="w-full gap-1.5" onClick={() => setExtras(p => [...p, { name: "", qty: "", unit: "", supplierId: "" }])}>
          <Plus size={15} /> Add an item
        </Button>
      </div>

      <div className="fixed bottom-0 left-0 right-0 z-30 border-t bg-white/95 backdrop-blur px-4 py-3">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <div className="flex-1 text-sm">
            <p className="font-semibold">{filled.length + filledExtras.length} item{filled.length + filledExtras.length !== 1 ? "s" : ""}</p>
            <p className="text-xs" style={missingSupplier ? { color: "#DC2626" } : { color: "#6B7280" }}>
              {missingSupplier ? `${missingSupplier} need a supplier` : supplierCount ? `${supplierCount} supplier list${supplierCount > 1 ? "s" : ""}` : "Add some quantities"}
            </p>
          </div>
          <Button className="h-11 px-6 font-semibold" style={{ background: NAVY }}
            disabled={!(filled.length + filledExtras.length) || missingSupplier > 0 || submit.isPending}
            onClick={() => submit.mutate()}>
            {submit.isPending ? "Saving…" : "Submit"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Edit a draft list ─────────────────────────────────────────────────────────
function EditListDialog({ list, onClose }: { list: StockList; onClose: () => void }) {
  const { toast } = useToast();
  const refresh = useRefresh();
  const [edits, setEdits] = useState<Record<number, { qty: string; unit: string }>>({});
  const [name, setName] = useState("");
  const [qty, setQty] = useState("");
  const [unit, setUnit] = useState("");
  const [busy, setBusy] = useState(false);

  const { data: tmpl } = useQuery<{ items: TemplateItem[] }>({
    queryKey: ["/api/stock/template", "supplier", String(list.supplier_id)],
    queryFn: () => json("GET", `/api/stock/template?mode=supplier&keys=${list.supplier_id}`),
    enabled: !!list.supplier_id, staleTime: 60000,
  });
  const suggestions = tmpl?.items ?? [];

  const saveAll = async () => {
    setBusy(true);
    try {
      for (const [id, e] of Object.entries(edits)) {
        const orig = list.items.find(i => i.id === Number(id));
        if (!orig || (String(orig.qty) === e.qty && (orig.unit || "") === e.unit)) continue;
        await json("PATCH", `/api/stock/items/${id}`, { qty: Number(e.qty), unit: e.unit });
      }
      refresh(); onClose();
    } catch (e: any) { toast({ description: e.message, variant: "destructive" }); }
    setBusy(false);
  };

  const remove = async (id: number) => {
    try { await json("DELETE", `/api/stock/items/${id}`); refresh(); }
    catch (e: any) { toast({ description: e.message, variant: "destructive" }); }
  };

  const add = async () => {
    const match = suggestions.find(s => s.name.toLowerCase() === name.trim().toLowerCase());
    try {
      await json("POST", `/api/stock/lists/${list.id}/items`, {
        ingredientId: match?.ingredientId ?? null, itemName: match?.name ?? name.trim(),
        qty: Number(qty), unit: unit || match?.unit || "",
      });
      setName(""); setQty(""); setUnit(""); refresh();
    } catch (e: any) { toast({ description: e.message, variant: "destructive" }); }
  };

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-md max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{list.supplier_name}</DialogTitle>
          <DialogDescription>Change quantities, take things off or add more.</DialogDescription>
        </DialogHeader>
        <div className="rounded-xl border divide-y">
          {list.items.map(it => {
            const e = edits[it.id] || { qty: String(it.qty), unit: it.unit || "" };
            const set = (patch: Partial<{ qty: string; unit: string }>) => setEdits(p => ({ ...p, [it.id]: { ...e, ...patch } }));
            return (
              <div key={it.id} className="px-3 py-2.5 flex items-center gap-2">
                <p className="flex-1 text-sm">{it.item_name}</p>
                <Input type="number" min="0" step="any" inputMode="decimal" value={e.qty} onChange={ev => set({ qty: ev.target.value })} className="w-16 h-9 text-center" />
                <Input value={e.unit} onChange={ev => set({ unit: ev.target.value })} className="w-16 h-9 text-sm" placeholder="unit" />
                <button onClick={() => remove(it.id)} className="p-1.5 text-muted-foreground hover:text-red-600"><Trash2 size={15} /></button>
              </div>
            );
          })}
        </div>
        <div className="space-y-2">
          <SectionLabel>Add an item</SectionLabel>
          <Input list={`stock-sugg-${list.id}`} value={name} onChange={e => setName(e.target.value)} placeholder="Item name" className="h-10" />
          <datalist id={`stock-sugg-${list.id}`}>
            {suggestions.map(s => <option key={s.ingredientId} value={s.name} />)}
          </datalist>
          <div className="flex gap-2">
            <Input type="number" min="0" step="any" inputMode="decimal" value={qty} onChange={e => setQty(e.target.value)} placeholder="Qty" className="w-20 h-10" />
            <Input value={unit} onChange={e => setUnit(e.target.value)} placeholder="unit" className="w-20 h-10" />
            <Button variant="outline" className="flex-1 h-10 gap-1.5" disabled={!name.trim() || !(Number(qty) > 0)} onClick={add}>
              <Plus size={15} /> Add
            </Button>
          </div>
        </div>
        <Button className="w-full h-11" style={{ background: NAVY }} disabled={busy} onClick={saveAll}>
          {busy ? "Saving…" : "Done"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}

// ─── Send a draft list ─────────────────────────────────────────────────────────
function SendListDialog({ list, onClose }: { list: StockList; onClose: () => void }) {
  const { toast } = useToast();
  const refresh = useRefresh();
  const qc = useQueryClient();
  const [method, setMethod] = useState<Method>(list.supplier_method);
  const [collectBy, setCollectBy] = useState(perthYmd(1));
  const [to, setTo] = useState<string | null>(null);
  const [subject, setSubject] = useState<string | null>(null);
  const [body, setBody] = useState<string | null>(null);
  const [saveEmail, setSaveEmail] = useState(true);

  const { data: email } = useQuery<any>({
    queryKey: ["/api/stock/lists/email", list.id],
    queryFn: () => json("GET", `/api/stock/lists/${list.id}/email`),
    enabled: method === "delivery", staleTime: 0,
  });
  const toV = to ?? email?.to ?? "";
  const subjectV = subject ?? email?.subject ?? "";
  const bodyV = body ?? email?.body ?? "";
  const hasDash = /[–—]/.test(subjectV + bodyV);

  const send = useMutation({
    mutationFn: (mode?: "email" | "manual") => json("POST", `/api/stock/lists/${list.id}/send`,
      method === "driver"
        ? { method, collectBy }
        : { method, mode, to: toV, subject: subjectV, body: bodyV, saveEmail: saveEmail && !email?.supplier?.email }),
    onSuccess: (r: any, mode) => {
      if (method === "driver") {
        toast({ description: r.alert?.ok ? "On the driver run. Drivers told on WhatsApp." : `On the driver run. WhatsApp didn't send (${r.alert?.error || "unknown"}), so let the drivers know.` });
      } else {
        toast({ description: mode === "email" ? `Order emailed to ${list.supplier_name}` : `${list.supplier_name} marked as ordered` });
      }
      refresh(); qc.invalidateQueries({ queryKey: ["/api/stock/suppliers"] }); onClose();
    },
    onError: (e: any) => toast({ description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Send {list.supplier_name} list</DialogTitle>
          <DialogDescription>{list.items.length} item{list.items.length > 1 ? "s" : ""}. Is a driver collecting, or is the supplier delivering?</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-2">
          {(["driver", "delivery"] as Method[]).map(m => (
            <button key={m} onClick={() => setMethod(m)}
              className="h-12 rounded-lg border-2 text-sm font-semibold flex items-center justify-center gap-2"
              style={method === m ? { borderColor: NAVY, background: "#E3EEF3", color: NAVY } : { borderColor: "#E5E7EB", color: "#6B7280" }}>
              {m === "driver" ? <Car size={16} /> : <Truck size={16} />}
              {m === "driver" ? "Driver run" : "Supplier delivers"}
            </button>
          ))}
        </div>

        {method === "driver" ? (
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground">Collect by</label>
              <Input type="date" value={collectBy} min={perthYmd(0)} onChange={e => setCollectBy(e.target.value)} className="h-11 text-base" />
            </div>
            <div className="rounded-xl p-3 text-sm" style={{ background: YELLOW, color: DEEP_GREEN }}>
              The Deli Drivers group gets: "Shopping List has been created for {list.supplier_name} for collection by {collectBy ? dayText(collectBy) : "…"}."
            </div>
            <Button className="w-full h-11 gap-2" style={{ background: NAVY }} disabled={!collectBy || send.isPending} onClick={() => send.mutate(undefined)}>
              <Car size={16} /> {send.isPending ? "Sending…" : "Put on the driver run"}
            </Button>
          </div>
        ) : !email ? (
          <p className="text-sm text-muted-foreground py-6 text-center">Loading the email…</p>
        ) : (
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground">To</label>
              <Input type="email" value={toV} onChange={e => setTo(e.target.value)} placeholder="orders@supplier.com.au" className="h-10" />
              {!email.supplier?.email && toV && (
                <label className="flex items-center gap-2 text-xs text-muted-foreground mt-1.5">
                  <input type="checkbox" checked={saveEmail} onChange={e => setSaveEmail(e.target.checked)} />
                  Save this as {list.supplier_name}'s order email
                </label>
              )}
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Subject</label>
              <Input value={subjectV} onChange={e => setSubject(e.target.value)} className="h-10" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Email</label>
              <Textarea value={bodyV} onChange={e => setBody(e.target.value)} rows={12} className="text-sm font-mono leading-relaxed" />
            </div>
            {hasDash && <p className="text-xs text-red-600">There's a dash (– or —) in the email. Swap it for a comma or full stop before sending.</p>}
            {!email.emailConfigured && (
              <div className="rounded-xl p-3 text-sm" style={{ background: YELLOW, color: DEEP_GREEN }}>
                Sending from the app isn't switched on yet. Copy the email, send it yourself, then tap "Ordered another way".
              </div>
            )}
            <Button className="w-full h-11 gap-2" style={{ background: NAVY }}
              disabled={!email.emailConfigured || !toV || hasDash || send.isPending} onClick={() => send.mutate("email")}>
              <Send size={16} /> {send.isPending ? "Sending…" : `Email ${list.supplier_name}`}
            </Button>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" className="h-10 gap-1.5"
                onClick={() => { navigator.clipboard.writeText(bodyV); toast({ description: "Email copied" }); }}>
                <Mail size={15} /> Copy email
              </Button>
              <Button variant="outline" className="h-10" disabled={send.isPending} onClick={() => send.mutate("manual")}>
                Ordered another way
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Tab: Lists ────────────────────────────────────────────────────────────────
function ListsTab({ lists, unavailable, onNew }: { lists: StockList[]; unavailable: ListItem[]; onNew: () => void }) {
  const { toast } = useToast();
  const refresh = useRefresh();
  const [editing, setEditing] = useState<StockList | null>(null);
  const [sending, setSending] = useState<StockList | null>(null);
  const [deleting, setDeleting] = useState<StockList | null>(null);
  const drafts = lists.filter(l => l.status === "draft");
  const sent = lists.filter(l => l.status !== "draft");
  // keep dialogs pointed at fresh data
  const fresh = (l: StockList | null) => (l ? lists.find(x => x.id === l.id) || null : null);

  const dismiss = useMutation({
    mutationFn: (id: number) => json("PATCH", `/api/stock/items/${id}`, { status: "cancelled" }),
    onSuccess: () => refresh(),
  });
  const del = useMutation({
    mutationFn: (id: number) => json("DELETE", `/api/stock/lists/${id}`),
    onSuccess: () => { toast({ description: "List deleted" }); setDeleting(null); refresh(); },
    onError: (e: any) => toast({ description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-5">
      <Button className="w-full h-12 text-base font-semibold gap-2" style={{ background: NAVY }} onClick={onNew}>
        <Plus size={18} /> New shopping list
      </Button>

      {unavailable.length > 0 && (
        <div className="rounded-2xl p-4 space-y-2" style={{ background: YELLOW }}>
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} style={{ color: DEEP_GREEN }} />
            <p className="text-sm font-bold" style={{ color: DEEP_GREEN }}>Couldn't get these. Order from somewhere else.</p>
          </div>
          {unavailable.map(r => (
            <div key={r.id} className="bg-white rounded-xl px-3 py-2.5 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold">{r.item_name} <span className="font-normal text-muted-foreground">· {qtyText(r)}</span></p>
                <p className="text-xs text-muted-foreground">{r.handled_by ? `Flagged by ${r.handled_by}, ` : ""}{when(r.handled_at)}</p>
              </div>
              <Button size="sm" variant="outline" className="h-9" onClick={() => dismiss.mutate(r.id)}>Sorted</Button>
            </div>
          ))}
        </div>
      )}

      <div>
        <SectionLabel>Ready to send ({drafts.length})</SectionLabel>
        {drafts.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center border-2 border-dashed rounded-2xl bg-white/50">No lists waiting. Start one from the fridge list.</p>
        ) : (
          <div className="space-y-3">
            {drafts.map(l => (
              <div key={l.id} className="rounded-2xl border bg-white overflow-hidden">
                <div className="h-1" style={{ background: l.supplier_method === "driver" ? PINK : NAVY }} />
                <div className="px-4 pt-3 pb-2 flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-base font-bold" style={{ color: NAVY }}>{l.supplier_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {l.items.length} item{l.items.length !== 1 ? "s" : ""} · {l.created_by ? `${l.created_by}, ` : ""}{when(l.created_at)}
                    </p>
                  </div>
                  <MethodBadge method={l.supplier_method} />
                </div>
                <p className="px-4 pb-3 text-sm text-muted-foreground line-clamp-2">
                  {l.items.map(i => `${i.item_name} ${qtyText(i)}`).join(" · ")}
                </p>
                <div className="px-4 pb-4 flex gap-2">
                  <Button variant="outline" className="flex-1 h-10 gap-1.5" onClick={() => setEditing(l)}><Pencil size={15} /> Edit</Button>
                  <Button className="flex-1 h-10 gap-1.5" style={{ background: NAVY }} onClick={() => setSending(l)}><Send size={15} /> Send</Button>
                  <Button variant="ghost" className="h-10 px-2.5 text-muted-foreground" onClick={() => setDeleting(l)} aria-label="Delete list"><Trash2 size={16} /></Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {sent.length > 0 && (
        <div>
          <SectionLabel>Sent, not finished ({sent.length})</SectionLabel>
          <div className="rounded-2xl border bg-white divide-y">
            {sent.map(l => (
              <div key={l.id} className="px-4 py-2.5 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{l.supplier_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {l.status === "driver" ? `Driver run, collect by ${l.collect_by ? dayText(l.collect_by) : "?"}` : `Awaiting delivery, ordered ${when(l.sent_at)}`}
                  </p>
                </div>
                <span className="text-xs text-muted-foreground">{l.items.length} items</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {fresh(editing) && <EditListDialog list={fresh(editing)!} onClose={() => setEditing(null)} />}
      {fresh(sending) && <SendListDialog list={fresh(sending)!} onClose={() => setSending(null)} />}
      <Dialog open={!!deleting} onOpenChange={o => !o && setDeleting(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete the {deleting?.supplier_name} list?</DialogTitle>
            <DialogDescription>{deleting?.items.length} items will come off. This can't be undone.</DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setDeleting(null)}>Keep it</Button>
            <Button className="flex-1 bg-red-600 hover:bg-red-700 text-white" disabled={del.isPending} onClick={() => deleting && del.mutate(deleting.id)}>Delete</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Tab: Driver run ───────────────────────────────────────────────────────────
function runState(l: StockList) {
  const done = l.items.filter(i => i.status !== "requested").length;
  const overdue = !!l.collect_by && l.collect_by < perthYmd(0);
  if (done === 0) return { label: "To be completed", bg: PINK, fg: DEEP_GREEN, bar: PINK, done, overdue };
  return { label: `In progress, ${done}/${l.items.length}`, bg: YELLOW, fg: DEEP_GREEN, bar: "#E9C84A", done, overdue };
}

function DriverListView({ list, onBack }: { list: StockList; onBack: () => void }) {
  const { toast } = useToast();
  const refresh = useRefresh();
  const [confirm, setConfirm] = useState(false);
  const todo = list.items.filter(i => i.status === "requested");
  const done = list.items.filter(i => i.status !== "requested");

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: number; status: ItemStatus }) => json("PATCH", `/api/stock/items/${id}`, { status }),
    onSuccess: (r: any, v) => {
      if (v.status === "unavailable") toast({ description: r.alert?.ok ? "Chefs told on WhatsApp" : "Flagged. WhatsApp didn't send, so give the chefs a heads up." });
      refresh();
    },
    onError: (e: any) => toast({ description: e.message, variant: "destructive" }),
  });
  const finish = useMutation({
    mutationFn: () => json("POST", `/api/stock/lists/${list.id}/finish`, {}),
    onSuccess: (r: any) => {
      toast({ description: r.missed ? `${r.missed} not collected. ${r.alert?.ok ? "Chefs told on WhatsApp." : "WhatsApp didn't send, let the chefs know."}` : "List complete. Nice work." });
      refresh(); onBack();
    },
    onError: (e: any) => toast({ description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <button onClick={onBack} className="p-2 -ml-2 rounded-lg hover:bg-white"><ArrowLeft size={18} /></button>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-extrabold truncate" style={{ color: NAVY }}>{list.supplier_name}</h2>
          <p className="text-xs text-muted-foreground">Collect by {list.collect_by ? dayText(list.collect_by) : "?"} · {done.length}/{list.items.length} done</p>
        </div>
      </div>

      <div className="rounded-2xl border bg-white overflow-hidden">
        {todo.length === 0 && <p className="text-sm text-center text-muted-foreground py-6">All items ticked off.</p>}
        {todo.map(r => (
          <div key={r.id} className="px-4 py-3 border-b last:border-b-0 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-base font-semibold">{r.item_name}</p>
              <p className="text-sm" style={{ color: NAVY }}>{qtyText(r)}{r.notes ? <span className="text-muted-foreground"> · {r.notes}</span> : null}</p>
            </div>
            <button aria-label="Couldn't get it" disabled={setStatus.isPending}
              onClick={() => setStatus.mutate({ id: r.id, status: "unavailable" })}
              className="w-12 h-12 rounded-xl border-2 flex items-center justify-center" style={{ borderColor: "#E5E7EB", color: "#9CA3AF" }}>
              <X size={22} />
            </button>
            <button aria-label="Got it" disabled={setStatus.isPending}
              onClick={() => setStatus.mutate({ id: r.id, status: "collected" })}
              className="w-12 h-12 rounded-xl flex items-center justify-center text-white" style={{ background: GREEN }}>
              <Check size={24} />
            </button>
          </div>
        ))}
      </div>

      {done.length > 0 && (
        <div className="rounded-2xl border bg-white divide-y">
          {done.map(r => (
            <div key={r.id} className="px-4 py-2.5 flex items-center gap-3">
              {r.status === "collected" ? <Check size={16} style={{ color: GREEN }} /> : <X size={16} className="text-red-500" />}
              <p className="flex-1 text-sm text-muted-foreground">
                <span className={r.status === "collected" ? "line-through" : ""}>{r.item_name} · {qtyText(r)}</span>
                {r.status === "unavailable" && <span className="ml-1 text-xs" style={{ color: "#7A5B00" }}>(couldn't get)</span>}
              </p>
              <button className="text-xs underline text-muted-foreground flex items-center gap-1"
                onClick={() => setStatus.mutate({ id: r.id, status: "requested" })}><RotateCcw size={12} /> Undo</button>
            </div>
          ))}
        </div>
      )}

      <Button className="w-full h-12 text-base font-semibold" style={{ background: NAVY }} onClick={() => setConfirm(true)}>
        Finish list
      </Button>

      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Finish the {list.supplier_name} list?</DialogTitle>
            <DialogDescription>
              {todo.length ? `${todo.length} item${todo.length > 1 ? "s haven't" : " hasn't"} been ticked off. They'll be flagged and the chefs told on WhatsApp.` : "Everything's ticked off."}
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setConfirm(false)}>Not yet</Button>
            <Button className="flex-1" style={{ background: NAVY }} disabled={finish.isPending} onClick={() => finish.mutate()}>Finish</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DriverTab({ lists }: { lists: StockList[] }) {
  const [openId, setOpenId] = useState<number | null>(null);
  const runs = lists.filter(l => l.status === "driver")
    .sort((a, b) => (a.collect_by || "").localeCompare(b.collect_by || "") || a.supplier_name.localeCompare(b.supplier_name));
  const open = runs.find(l => l.id === openId);
  if (open) return <DriverListView list={open} onBack={() => setOpenId(null)} />;

  if (!runs.length) {
    return (
      <div className="text-center py-14 text-muted-foreground border-2 border-dashed rounded-2xl bg-white/50">
        <Car size={36} className="mx-auto mb-2 opacity-30" />
        <p className="text-sm font-medium">No shopping lists for the drivers.</p>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full" style={{ background: PINK }} /> To be completed</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full" style={{ background: "#E9C84A" }} /> In progress</span>
      </div>
      {runs.map(l => {
        const s = runState(l);
        return (
          <button key={l.id} onClick={() => setOpenId(l.id)}
            className="w-full text-left rounded-2xl border bg-white overflow-hidden flex">
            <div className="w-2 flex-shrink-0" style={{ background: s.bar }} />
            <div className="flex-1 px-4 py-3">
              <div className="flex items-start justify-between gap-2">
                <p className="text-base font-bold" style={{ color: NAVY }}>{l.supplier_name}</p>
                <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap" style={{ background: s.bg, color: s.fg }}>{s.label}</span>
              </div>
              <p className="text-sm mt-0.5">
                <span className="font-semibold" style={s.overdue ? { color: "#B91C1C" } : { color: DEEP_GREEN }}>
                  {s.overdue ? "Overdue, was due " : "Collect by "}{l.collect_by ? dayText(l.collect_by) : "?"}
                </span>
                <span className="text-muted-foreground"> · {l.items.length} items</span>
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">Sent by {l.sent_by || "someone"}, {when(l.sent_at)}</p>
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ─── Tab: Suppliers (awaiting delivery) ────────────────────────────────────────
function DeliveredDialog({ list, onClose }: { list: StockList; onClose: () => void }) {
  const { toast } = useToast();
  const refresh = useRefresh();
  const open = list.items.filter(i => i.status === "ordered");
  const [arrived, setArrived] = useState<Set<number>>(new Set(open.map(i => i.id)));
  const toggle = (id: number) => setArrived(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const short = open.length - arrived.size;
  const save = useMutation({
    mutationFn: () => json("POST", `/api/stock/lists/${list.id}/delivered`, { arrivedIds: Array.from(arrived) }),
    onSuccess: (r: any) => {
      toast({ description: r.short ? `${r.short} short. ${r.alert?.ok ? "Chefs told on WhatsApp." : "WhatsApp didn't send, let the chefs know."}` : "Delivery complete" });
      refresh(); onClose();
    },
    onError: (e: any) => toast({ description: e.message, variant: "destructive" }),
  });
  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-md max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{list.supplier_name} delivery</DialogTitle>
          <DialogDescription>Untick anything that didn't turn up.</DialogDescription>
        </DialogHeader>
        <div className="rounded-xl border divide-y">
          {open.map(i => {
            const on = arrived.has(i.id);
            return (
              <button key={i.id} onClick={() => toggle(i.id)} className="w-full px-3 py-3 flex items-center gap-3 text-left">
                <span className="w-6 h-6 rounded-md border-2 flex items-center justify-center"
                  style={on ? { background: GREEN, borderColor: GREEN } : { borderColor: "#D1D5DB" }}>
                  {on && <Check size={14} className="text-white" />}
                </span>
                <span className="flex-1 text-sm" style={on ? {} : { color: "#9CA3AF", textDecoration: "line-through" }}>{i.item_name}</span>
                <span className="text-sm text-muted-foreground">{qtyText(i)}</span>
              </button>
            );
          })}
        </div>
        <Button className="w-full h-11" style={{ background: NAVY }} disabled={save.isPending} onClick={() => save.mutate()}>
          {short ? `Delivery complete (${short} short)` : "Delivery complete"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}

function SuppliersTab({ lists }: { lists: StockList[] }) {
  const [receiving, setReceiving] = useState<StockList | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const waiting = lists.filter(l => l.status === "ordered");
  if (!waiting.length) {
    return (
      <div className="text-center py-14 text-muted-foreground border-2 border-dashed rounded-2xl bg-white/50">
        <Truck size={36} className="mx-auto mb-2 opacity-30" />
        <p className="text-sm font-medium">Nothing waiting on delivery.</p>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <SectionLabel>Awaiting delivery ({waiting.length})</SectionLabel>
      {waiting.map(l => (
        <div key={l.id} className="rounded-2xl border bg-white overflow-hidden">
          <div className="h-1" style={{ background: NAVY }} />
          <button className="w-full text-left px-4 pt-3 pb-2" onClick={() => setExpanded(expanded === l.id ? null : l.id)}>
            <div className="flex items-start justify-between gap-2">
              <p className="text-base font-bold" style={{ color: NAVY }}>{l.supplier_name}</p>
              <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold" style={{ background: "#E3EEF3", color: NAVY }}>Awaiting delivery</span>
            </div>
            <p className="text-xs text-muted-foreground">
              {l.items.length} items · {l.sent_via === "email" ? `emailed to ${l.sent_to}` : "ordered"} {when(l.sent_at)}{l.sent_by ? ` by ${l.sent_by}` : ""}
            </p>
          </button>
          {expanded === l.id && (
            <div className="mx-4 mb-2 rounded-xl border divide-y">
              {l.items.map(i => (
                <div key={i.id} className="px-3 py-2 flex text-sm"><span className="flex-1">{i.item_name}</span><span className="text-muted-foreground">{qtyText(i)}</span></div>
              ))}
            </div>
          )}
          <div className="px-4 pb-4">
            <Button className="w-full h-11 gap-2" style={{ background: GREEN }} onClick={() => setReceiving(l)}>
              <PackageCheck size={17} /> Delivery complete
            </Button>
          </div>
        </div>
      ))}
      {receiving && <DeliveredDialog list={receiving} onClose={() => setReceiving(null)} />}
    </div>
  );
}

// ─── Tab: History ──────────────────────────────────────────────────────────────
function HistoryTab() {
  const [expanded, setExpanded] = useState<number | null>(null);
  const { data: lists = [], isLoading } = useQuery<StockList[]>({
    queryKey: ["/api/stock/lists", "history"],
    queryFn: () => json("GET", "/api/stock/lists?view=history"),
    staleTime: 0,
  });
  if (isLoading) return <p className="text-center text-sm text-muted-foreground py-10">Loading…</p>;
  if (!lists.length) return <p className="text-sm text-muted-foreground text-center py-10">Nothing finished in the last 30 days.</p>;
  return (
    <div className="space-y-2">
      {lists.map(l => {
        const got = l.items.filter(i => i.status === "collected" || i.status === "received").length;
        return (
          <div key={l.id} className="rounded-2xl border bg-white overflow-hidden">
            <button className="w-full text-left px-4 py-3 flex items-center gap-3" onClick={() => setExpanded(expanded === l.id ? null : l.id)}>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold">{l.supplier_name}</p>
                <p className="text-xs text-muted-foreground">
                  {l.status === "cancelled" ? "Cancelled" : `${got}/${l.items.length} ${l.method === "driver" ? "collected" : "delivered"}`}
                  {" · "}{when(l.completed_at)}{l.completed_by ? ` · ${l.completed_by}` : ""}
                </p>
              </div>
              {l.method && <MethodBadge method={l.method} />}
            </button>
            {expanded === l.id && (
              <div className="mx-4 mb-3 rounded-xl border divide-y">
                {l.items.map(i => (
                  <div key={i.id} className="px-3 py-2 flex items-center gap-2 text-sm">
                    {(i.status === "collected" || i.status === "received") ? <Check size={14} style={{ color: GREEN }} /> : <X size={14} className="text-red-500" />}
                    <span className="flex-1">{i.item_name}</span><span className="text-muted-foreground">{qtyText(i)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Supplier settings ─────────────────────────────────────────────────────────
function SupplierSettings({ suppliers, emailConfigured, emailFrom, onClose }: {
  suppliers: SupplierRow[]; emailConfigured: boolean; emailFrom: string | null; onClose: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [drafts, setDrafts] = useState<Record<number, { email: string; contactName: string }>>({});
  const update = useMutation({
    mutationFn: ({ id, body }: { id: number; body: any }) => json("PATCH", `/api/stock/suppliers/${id}`, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/stock/suppliers"] }); qc.invalidateQueries({ queryKey: ["/api/stock/lists"] }); },
    onError: (e: any) => toast({ description: e.message, variant: "destructive" }),
  });
  const draft = (s: SupplierRow) => drafts[s.id] ?? { email: s.email || "", contactName: s.contact_name || "" };
  const setDraft = (s: SupplierRow, patch: Partial<{ email: string; contactName: string }>) =>
    setDrafts(p => ({ ...p, [s.id]: { ...draft(s), ...patch } }));
  const saveDraft = (s: SupplierRow) => {
    const d = drafts[s.id];
    if (!d || ((d.email || "") === (s.email || "") && (d.contactName || "") === (s.contact_name || ""))) return;
    update.mutate({ id: s.id, body: { email: d.email, contactName: d.contactName } }, { onSuccess: () => toast({ description: `${s.name} saved` }) });
  };

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Supplier ordering settings</DialogTitle>
          <DialogDescription>Who's usually collected by a driver, who delivers, and where order emails go.</DialogDescription>
        </DialogHeader>
        <div className="rounded-xl p-3 text-xs" style={{ background: YELLOW, color: DEEP_GREEN }}>
          {emailConfigured ? `Order emails send from ${emailFrom}.` : "Sending emails from the app isn't switched on yet. It needs the email settings added in Railway first."}
        </div>
        <div className="space-y-2">
          {suppliers.map(s => (
            <div key={s.id} className="rounded-xl border p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold">{s.name}</p>
                <div className="flex rounded-lg border overflow-hidden text-xs font-semibold">
                  {(["delivery", "driver"] as Method[]).map(m => (
                    <button key={m} onClick={() => update.mutate({ id: s.id, body: { collectionMethod: m } })}
                      className="px-2.5 py-1.5" style={s.collection_method === m ? { background: NAVY, color: "white" } : { color: "#6B7280" }}>
                      {m === "driver" ? "Pickup" : "Delivers"}
                    </button>
                  ))}
                </div>
              </div>
              {s.collection_method === "delivery" && (
                <div className="grid grid-cols-2 gap-2">
                  <Input value={draft(s).contactName} placeholder="Contact name" className="h-9 text-sm"
                    onChange={e => setDraft(s, { contactName: e.target.value })} onBlur={() => saveDraft(s)} />
                  <Input type="email" value={draft(s).email} placeholder="Order email" className="h-9 text-sm"
                    onChange={e => setDraft(s, { email: e.target.value })} onBlur={() => saveDraft(s)} />
                </div>
              )}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────
type Tab = "lists" | "markets" | "driver" | "suppliers" | "history";

export default function StockOrder() {
  const [tab, setTab] = useState<Tab>("lists");
  const [newList, setNewList] = useState<null | { step: "scope" } | { step: "template"; mode: Mode; keys: string[] }>(null);
  const [showSettings, setShowSettings] = useState(false);

  const { data: lists = [], isLoading } = useQuery<StockList[]>({
    queryKey: ["/api/stock/lists", "active"],
    queryFn: () => json("GET", "/api/stock/lists?view=active"),
    refetchInterval: 20000, staleTime: 0,
  });
  const { data: unavailable = [] } = useQuery<ListItem[]>({
    queryKey: ["/api/stock/unavailable"],
    queryFn: () => json("GET", "/api/stock/unavailable"),
    refetchInterval: 30000, staleTime: 0,
  });
  const { data: supData } = useQuery<{ suppliers: SupplierRow[]; emailConfigured: boolean; emailFrom: string | null }>({
    queryKey: ["/api/stock/suppliers"],
    queryFn: () => json("GET", "/api/stock/suppliers"),
    staleTime: 0,
  });
  const { data: tmplMeta } = useQuery<{ categories: string[] }>({
    queryKey: ["/api/stock/template", "meta"],
    queryFn: () => json("GET", "/api/stock/template?mode=category&keys="),
    staleTime: 5 * 60000,
  });
  const suppliers = supData?.suppliers ?? [];

  const counts: Record<Tab, number> = {
    lists: lists.filter(l => l.status === "draft").length + unavailable.length,
    markets: 0,
    driver: lists.filter(l => l.status === "driver").length,
    suppliers: lists.filter(l => l.status === "ordered").length,
    history: 0,
  };
  const tabs: [Tab, string, any][] = [
    ["lists", "Lists", ShoppingBag],
    ["markets", "Markets", Apple],
    ["driver", "Driver run", Car],
    ["suppliers", "Suppliers", Truck],
    ["history", "History", History],
  ];

  if (newList) {
    return (
      <div className="min-h-full" style={{ background: CREAM }}>
        <div className="p-4 max-w-2xl mx-auto">
          {newList.step === "scope" ? (
            <NewListScope suppliers={suppliers} categories={tmplMeta?.categories ?? []}
              onCancel={() => setNewList(null)}
              onNext={(mode, keys) => setNewList({ step: "template", mode, keys })} />
          ) : (
            <NewListTemplate mode={newList.mode} keys={newList.keys} suppliers={suppliers}
              onBack={() => setNewList({ step: "scope" })}
              onDone={() => { setNewList(null); setTab("lists"); }} />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full" style={{ background: CREAM }}>
      <div className="p-4 max-w-2xl mx-auto pb-24">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.12em]" style={{ color: GREEN }}>Stock ordering</p>
            <h1 className="text-xl font-extrabold" style={{ color: NAVY }}>Shopping lists</h1>
          </div>
          <Button variant="outline" size="sm" className="gap-1.5 bg-white" onClick={() => setShowSettings(true)}>
            <Settings size={15} /> Suppliers
          </Button>
        </div>

        <div className="grid grid-cols-5 gap-1 bg-white border rounded-xl p-1 mb-5">
          {tabs.map(([key, label, Icon]) => (
            <button key={key} onClick={() => setTab(key)}
              className="relative flex flex-col sm:flex-row items-center justify-center gap-1 py-2 rounded-lg text-xs sm:text-sm font-semibold"
              style={tab === key ? { background: NAVY, color: "white" } : { color: "#6B7280" }}>
              <Icon size={16} />
              {label}
              {counts[key] > 0 && (
                <span className="absolute -top-1 -right-1 sm:static min-w-[18px] h-[18px] px-1 rounded-full text-[10px] flex items-center justify-center"
                  style={{ background: PINK, color: DEEP_GREEN }}>
                  {counts[key]}
                </span>
              )}
            </button>
          ))}
        </div>

        {isLoading ? (
          <p className="text-center text-sm text-muted-foreground py-12">Loading…</p>
        ) : tab === "lists" ? (
          <ListsTab lists={lists} unavailable={unavailable} onNew={() => setNewList({ step: "scope" })} />
        ) : tab === "markets" ? (
          <MarketsTab />
        ) : tab === "driver" ? (
          <DriverTab lists={lists} />
        ) : tab === "suppliers" ? (
          <SuppliersTab lists={lists} />
        ) : (
          <HistoryTab />
        )}
      </div>

      {showSettings && (
        <SupplierSettings suppliers={suppliers} emailConfigured={!!supData?.emailConfigured}
          emailFrom={supData?.emailFrom ?? null} onClose={() => setShowSettings(false)} />
      )}
    </div>
  );
}
