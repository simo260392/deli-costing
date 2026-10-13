import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Plus, Search, Truck, Send, Check, X, AlertTriangle, Settings, Trash2,
  PackageCheck, Mail, ShoppingBag, History, Car, RotateCcw, Pencil,
} from "lucide-react";
import { format } from "date-fns";

// ─── Types ─────────────────────────────────────────────────────────────────────
type Method = "driver" | "delivery";
type Status = "requested" | "ordered" | "collected" | "unavailable" | "received" | "cancelled";

interface CatalogueSupplier {
  supplierId: number; supplierName: string; method: Method;
  sku: string | null; supplierItemName: string | null; pack: string | null; preferred: boolean;
}
interface CatalogueItem {
  ingredientId: number; name: string; unit: string | null; category: string | null;
  suppliers: CatalogueSupplier[];
}
interface StockRequest {
  id: number; ingredient_id: number | null; item_name: string; qty: number; unit: string | null;
  supplier_id: number | null; supplier_name: string | null; method: Method; notes: string | null;
  status: Status; requested_by: string | null; requested_at: string;
  supplier_order_id: number | null; handled_by: string | null; handled_at: string | null;
  alerted_at: string | null; sku: string | null; supplier_item_name: string | null;
}
interface SupplierRow {
  id: number; name: string; email: string | null; contact_name: string | null;
  collection_method: Method; parent_supplier_id: number | null;
}
interface SupplierOrder {
  id: number; supplier_id: number; supplier_name: string; sent_to: string | null;
  sent_by: string | null; sent_via: string; sent_at: string; items: StockRequest[];
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
const groupBy = <T,>(list: T[], key: (t: T) => string) =>
  list.reduce((acc, t) => { (acc[key(t)] ||= []).push(t); return acc; }, {} as Record<string, T[]>);

function MethodBadge({ method }: { method: Method }) {
  const driver = method === "driver";
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold"
      style={driver ? { background: PINK, color: DEEP_GREEN } : { background: "#E3EEF3", color: NAVY }}>
      {driver ? <Car size={11} /> : <Truck size={11} />}
      {driver ? "Driver pickup" : "Delivered"}
    </span>
  );
}

function StatusPill({ status }: { status: Status }) {
  const map: Record<Status, [string, string, string]> = {
    requested: ["Needed", "#E3EEF3", NAVY],
    ordered: ["Ordered", "#E3EEF3", NAVY],
    collected: ["Collected", "#E3F4EC", DEEP_GREEN],
    received: ["Received", "#E3F4EC", DEEP_GREEN],
    unavailable: ["Couldn't get", YELLOW, "#7A5B00"],
    cancelled: ["Removed", "#F1F1F1", "#6B7280"],
  };
  const [label, bg, color] = map[status];
  return <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold" style={{ background: bg, color }}>{label}</span>;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] font-bold uppercase tracking-[0.12em] mb-2" style={{ color: GREEN }}>{children}</p>;
}

function useRefresh() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["/api/stock/requests"] });
    qc.invalidateQueries({ queryKey: ["/api/stock/supplier-orders"] });
  };
}

// ─── Add item ──────────────────────────────────────────────────────────────────
function AddItemCard({ catalogue, suppliers }: { catalogue: CatalogueItem[]; suppliers: SupplierRow[] }) {
  const { toast } = useToast();
  const refresh = useRefresh();
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<CatalogueItem | null>(null);
  const [qty, setQty] = useState("1");
  const [unit, setUnit] = useState("");
  const [supplierId, setSupplierId] = useState<string>("");
  const [method, setMethod] = useState<Method>("delivery");
  const [notes, setNotes] = useState("");

  const matches = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s || picked) return [];
    return catalogue.filter(c => c.name.toLowerCase().includes(s)).slice(0, 8);
  }, [search, catalogue, picked]);

  const supplierFor = (id: string) => suppliers.find(s => String(s.id) === id);

  const pick = (item: CatalogueItem) => {
    setPicked(item);
    setSearch(item.name);
    setUnit(item.unit || "");
    const first = item.suppliers[0];
    setSupplierId(first ? String(first.supplierId) : "");
    setMethod(first?.method || "delivery");
  };

  const chooseSupplier = (id: string) => {
    setSupplierId(id);
    const s = supplierFor(id);
    if (s) setMethod(s.collection_method);
  };

  const reset = () => {
    setSearch(""); setPicked(null); setQty("1"); setUnit(""); setSupplierId(""); setMethod("delivery"); setNotes("");
  };

  const add = useMutation({
    mutationFn: () => json("POST", "/api/stock/requests", {
      ingredientId: picked?.ingredientId ?? null,
      itemName: picked?.name ?? search.trim(),
      qty: Number(qty), unit: unit.trim(),
      supplierId: supplierId ? Number(supplierId) : null,
      method, notes: notes.trim() || null,
    }),
    onSuccess: (row: any) => {
      toast({ description: row.merged ? `Added to the ${row.item_name} already on the list` : `${row.item_name} added` });
      reset(); refresh();
    },
    onError: (e: any) => toast({ description: e.message, variant: "destructive" }),
  });

  // Suppliers that stock the picked item first, then everyone else
  const stockists = picked?.suppliers.map(s => s.supplierId) ?? [];
  const supplierOptions = [
    ...suppliers.filter(s => stockists.includes(s.id)),
    ...suppliers.filter(s => !stockists.includes(s.id)),
  ];
  const canAdd = (picked || search.trim()) && Number(qty) > 0 && !add.isPending;

  return (
    <div className="rounded-2xl border bg-white p-4 space-y-3 shadow-sm">
      <SectionLabel>Add to the list</SectionLabel>
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input value={search} placeholder="What do we need? e.g. rocket"
          onChange={e => { setSearch(e.target.value); setPicked(null); }}
          className="pl-9 h-11 text-base" data-testid="input-stock-search" />
        {matches.length > 0 && (
          <div className="absolute z-20 left-0 right-0 mt-1 bg-white border rounded-xl shadow-lg overflow-hidden">
            {matches.map(m => (
              <button key={m.ingredientId} onClick={() => pick(m)}
                className="w-full text-left px-3 py-2.5 hover:bg-muted/50 border-b last:border-b-0">
                <p className="text-sm font-medium">{m.name}</p>
                <p className="text-xs text-muted-foreground">
                  {m.suppliers.length ? m.suppliers.map(s => s.supplierName).slice(0, 3).join(", ") : "No supplier linked"}
                </p>
              </button>
            ))}
          </div>
        )}
      </div>
      {search.trim() && !picked && matches.length === 0 && (
        <p className="text-xs text-muted-foreground">Not in the ingredient list. That's fine, it'll be added as typed.</p>
      )}

      <div className="grid grid-cols-[1fr,1fr] gap-2">
        <div>
          <label className="text-xs text-muted-foreground">Quantity</label>
          <Input type="number" min="0" step="any" inputMode="decimal" value={qty}
            onChange={e => setQty(e.target.value)} className="h-11 text-base" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Unit</label>
          <Input value={unit} placeholder="kg, box, each" onChange={e => setUnit(e.target.value)} className="h-11 text-base" />
        </div>
      </div>

      <div>
        <label className="text-xs text-muted-foreground">Supplier</label>
        <select value={supplierId} onChange={e => chooseSupplier(e.target.value)}
          className="w-full h-11 rounded-md border px-3 text-base bg-white">
          <option value="">Not sure / anywhere</option>
          {supplierOptions.map(s => (
            <option key={s.id} value={s.id}>{s.name}{stockists.includes(s.id) ? " ✓" : ""}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {(["delivery", "driver"] as Method[]).map(m => (
          <button key={m} onClick={() => setMethod(m)}
            className="h-11 rounded-lg border-2 text-sm font-semibold flex items-center justify-center gap-2"
            style={method === m ? { borderColor: NAVY, background: "#E3EEF3", color: NAVY } : { borderColor: "#E5E7EB", color: "#6B7280" }}>
            {m === "driver" ? <Car size={15} /> : <Truck size={15} />}
            {m === "driver" ? "Driver picks up" : "Supplier delivers"}
          </button>
        ))}
      </div>

      <Input value={notes} placeholder="Note (optional), e.g. ripe ones" onChange={e => setNotes(e.target.value)} className="h-10" />

      <Button className="w-full h-12 text-base font-semibold gap-2" style={{ background: NAVY }}
        disabled={!canAdd} onClick={() => add.mutate()} data-testid="button-add-stock">
        <Plus size={18} /> {add.isPending ? "Adding…" : "Add to list"}
      </Button>
    </div>
  );
}

// ─── Re-route an item the driver or supplier couldn't get ──────────────────────
function RerouteDialog({ item, suppliers, onClose }: { item: StockRequest; suppliers: SupplierRow[]; onClose: () => void }) {
  const { toast } = useToast();
  const refresh = useRefresh();
  const [supplierId, setSupplierId] = useState(item.supplier_id ? String(item.supplier_id) : "");
  const [method, setMethod] = useState<Method>(item.method);
  const save = useMutation({
    mutationFn: () => json("PATCH", `/api/stock/requests/${item.id}`, {
      supplierId: supplierId ? Number(supplierId) : null, method, status: "requested",
    }),
    onSuccess: () => { toast({ description: `${item.item_name} is back on the list` }); refresh(); onClose(); },
    onError: (e: any) => toast({ description: e.message, variant: "destructive" }),
  });
  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Get {item.item_name} somewhere else</DialogTitle>
          <DialogDescription>{qtyText(item)}. Pick where to get it from and it goes back on the list.</DialogDescription>
        </DialogHeader>
        <select value={supplierId} onChange={e => {
            setSupplierId(e.target.value);
            const s = suppliers.find(x => String(x.id) === e.target.value);
            if (s) setMethod(s.collection_method);
          }}
          className="w-full h-11 rounded-md border px-3 text-base bg-white">
          <option value="">Not sure / anywhere</option>
          {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <div className="grid grid-cols-2 gap-2">
          {(["delivery", "driver"] as Method[]).map(m => (
            <button key={m} onClick={() => setMethod(m)}
              className="h-11 rounded-lg border-2 text-sm font-semibold"
              style={method === m ? { borderColor: NAVY, background: "#E3EEF3", color: NAVY } : { borderColor: "#E5E7EB", color: "#6B7280" }}>
              {m === "driver" ? "Driver picks up" : "Supplier delivers"}
            </button>
          ))}
        </div>
        <Button className="w-full h-11" style={{ background: NAVY }} disabled={save.isPending} onClick={() => save.mutate()}>
          Put back on the list
        </Button>
      </DialogContent>
    </Dialog>
  );
}

// ─── Edit qty / note ───────────────────────────────────────────────────────────
function EditDialog({ item, onClose }: { item: StockRequest; onClose: () => void }) {
  const { toast } = useToast();
  const refresh = useRefresh();
  const [qty, setQty] = useState(String(item.qty));
  const [unit, setUnit] = useState(item.unit || "");
  const [notes, setNotes] = useState(item.notes || "");
  const save = useMutation({
    mutationFn: () => json("PATCH", `/api/stock/requests/${item.id}`, { qty: Number(qty), unit, notes }),
    onSuccess: () => { refresh(); onClose(); },
    onError: (e: any) => toast({ description: e.message, variant: "destructive" }),
  });
  const remove = useMutation({
    mutationFn: () => json("DELETE", `/api/stock/requests/${item.id}`),
    onSuccess: () => { toast({ description: `${item.item_name} removed` }); refresh(); onClose(); },
    onError: (e: any) => toast({ description: e.message, variant: "destructive" }),
  });
  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{item.item_name}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-2">
          <Input type="number" min="0" step="any" inputMode="decimal" value={qty} onChange={e => setQty(e.target.value)} className="h-11" />
          <Input value={unit} onChange={e => setUnit(e.target.value)} placeholder="unit" className="h-11" />
        </div>
        <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Note" className="h-10" />
        <div className="flex gap-2">
          <Button variant="outline" className="gap-1.5 text-red-600" disabled={remove.isPending} onClick={() => remove.mutate()}>
            <Trash2 size={15} /> Remove
          </Button>
          <Button className="flex-1" style={{ background: NAVY }} disabled={!(Number(qty) > 0) || save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Tab 1: the list ───────────────────────────────────────────────────────────
function ListTab({ requests, catalogue, suppliers }: { requests: StockRequest[]; catalogue: CatalogueItem[]; suppliers: SupplierRow[] }) {
  const { toast } = useToast();
  const refresh = useRefresh();
  const [rerouting, setRerouting] = useState<StockRequest | null>(null);
  const [editing, setEditing] = useState<StockRequest | null>(null);

  const unavailable = requests.filter(r => r.status === "unavailable");
  const waiting = requests.filter(r => r.status === "requested");
  const ordered = requests.filter(r => r.status === "ordered");
  const groups = groupBy(waiting, r => r.supplier_name || "Not sure / anywhere");

  const sorted = useMutation({
    mutationFn: (id: number) => json("PATCH", `/api/stock/requests/${id}`, { status: "cancelled" }),
    onSuccess: () => { toast({ description: "Marked as sorted" }); refresh(); },
  });

  return (
    <div className="space-y-5">
      <AddItemCard catalogue={catalogue} suppliers={suppliers} />

      {unavailable.length > 0 && (
        <div className="rounded-2xl p-4 space-y-2" style={{ background: YELLOW }}>
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} style={{ color: DEEP_GREEN }} />
            <p className="text-sm font-bold" style={{ color: DEEP_GREEN }}>Couldn't get these. Order from somewhere else.</p>
          </div>
          {unavailable.map(r => (
            <div key={r.id} className="bg-white rounded-xl p-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold">{r.item_name} <span className="font-normal text-muted-foreground">· {qtyText(r)}</span></p>
                <p className="text-xs text-muted-foreground">
                  {r.supplier_name || "No supplier"}{r.handled_by ? ` · flagged by ${r.handled_by}` : ""}{r.handled_at ? `, ${when(r.handled_at)}` : ""}
                </p>
              </div>
              <Button size="sm" variant="outline" className="h-9" onClick={() => setRerouting(r)}>Reorder</Button>
              <Button size="sm" variant="ghost" className="h-9 px-2" title="Sorted, remove from list"
                onClick={() => sorted.mutate(r.id)}><Check size={16} /></Button>
            </div>
          ))}
        </div>
      )}

      <div>
        <SectionLabel>On the list ({waiting.length})</SectionLabel>
        {waiting.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center border-2 border-dashed rounded-2xl">Nothing needed right now.</p>
        ) : (
          <div className="space-y-3">
            {Object.entries(groups).sort(([a], [b]) => a.localeCompare(b)).map(([sup, items]) => (
              <div key={sup} className="rounded-2xl border bg-white overflow-hidden">
                <div className="px-4 py-2.5 flex items-center justify-between border-b" style={{ background: CREAM }}>
                  <p className="text-sm font-bold" style={{ color: NAVY }}>{sup}</p>
                  <MethodBadge method={items[0].method} />
                </div>
                {items.map(r => (
                  <button key={r.id} onClick={() => setEditing(r)}
                    className="w-full text-left px-4 py-3 border-b last:border-b-0 flex items-center gap-3 hover:bg-muted/30">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{r.item_name}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {r.requested_by ? `${r.requested_by} · ` : ""}{when(r.requested_at)}{r.notes ? ` · ${r.notes}` : ""}
                      </p>
                    </div>
                    {r.method !== items[0].method && <MethodBadge method={r.method} />}
                    <span className="text-sm font-bold" style={{ color: NAVY }}>{qtyText(r)}</span>
                    <Pencil size={13} className="text-muted-foreground" />
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      {ordered.length > 0 && (
        <div>
          <SectionLabel>Ordered, waiting on delivery ({ordered.length})</SectionLabel>
          <div className="rounded-2xl border bg-white divide-y">
            {ordered.map(r => (
              <div key={r.id} className="px-4 py-2.5 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm">{r.item_name}</p>
                  <p className="text-xs text-muted-foreground">{r.supplier_name}</p>
                </div>
                <span className="text-sm text-muted-foreground">{qtyText(r)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {rerouting && <RerouteDialog item={rerouting} suppliers={suppliers} onClose={() => setRerouting(null)} />}
      {editing && <EditDialog item={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

// ─── Tab 2: driver run ─────────────────────────────────────────────────────────
function DriverTab({ requests, history }: { requests: StockRequest[]; history: StockRequest[] }) {
  const { toast } = useToast();
  const refresh = useRefresh();
  const [confirmFinish, setConfirmFinish] = useState(false);

  const todo = requests.filter(r => r.method === "driver" && r.status === "requested");
  const groups = groupBy(todo, r => r.supplier_name || "Anywhere");
  const today = new Date().toDateString();
  const doneToday = history.filter(r => r.method === "driver" && r.status === "collected" &&
    r.handled_at && new Date(r.handled_at).toDateString() === today);

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: number; status: Status }) => json("PATCH", `/api/stock/requests/${id}`, { status }),
    onSuccess: (row: any, v) => {
      if (v.status === "unavailable") {
        toast({ description: row.alert?.ok ? "Chefs have been told on WhatsApp" : "Flagged. WhatsApp didn't send, so give the chefs a heads up." });
      }
      refresh();
    },
    onError: (e: any) => toast({ description: e.message, variant: "destructive" }),
  });

  const finish = useMutation({
    mutationFn: () => json("POST", "/api/stock/driver/finish", {}),
    onSuccess: (r: any) => {
      setConfirmFinish(false);
      if (!r.missed.length) toast({ description: "Run finished. Everything was collected." });
      else toast({ description: `${r.missed.length} item${r.missed.length > 1 ? "s" : ""} flagged. ${r.alert?.ok ? "Chefs told on WhatsApp." : "WhatsApp didn't send, let the chefs know."}` });
      refresh();
    },
    onError: (e: any) => toast({ description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-5">
      {todo.length === 0 ? (
        <div className="text-center py-14 text-muted-foreground border-2 border-dashed rounded-2xl">
          <Car size={36} className="mx-auto mb-2 opacity-30" />
          <p className="text-sm font-medium">No pickups on the list.</p>
        </div>
      ) : (
        Object.entries(groups).sort(([a], [b]) => a.localeCompare(b)).map(([sup, items]) => (
          <div key={sup} className="rounded-2xl border bg-white overflow-hidden">
            <div className="px-4 py-2.5 border-b flex items-center justify-between" style={{ background: CREAM }}>
              <p className="text-sm font-bold" style={{ color: NAVY }}>{sup}</p>
              <span className="text-xs text-muted-foreground">{items.length} to get</span>
            </div>
            {items.map(r => (
              <div key={r.id} className="px-4 py-3 border-b last:border-b-0 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-base font-semibold">{r.item_name}</p>
                  <p className="text-sm" style={{ color: NAVY }}>{qtyText(r)}{r.notes ? <span className="text-muted-foreground"> · {r.notes}</span> : null}</p>
                </div>
                <button aria-label="Couldn't get it" disabled={setStatus.isPending}
                  onClick={() => setStatus.mutate({ id: r.id, status: "unavailable" })}
                  className="w-12 h-12 rounded-xl border-2 flex items-center justify-center"
                  style={{ borderColor: "#E5E7EB", color: "#9CA3AF" }}><X size={22} /></button>
                <button aria-label="Got it" disabled={setStatus.isPending}
                  onClick={() => setStatus.mutate({ id: r.id, status: "collected" })}
                  className="w-12 h-12 rounded-xl flex items-center justify-center text-white"
                  style={{ background: GREEN }}><Check size={24} /></button>
              </div>
            ))}
          </div>
        ))
      )}

      {doneToday.length > 0 && (
        <div>
          <SectionLabel>Got today ({doneToday.length})</SectionLabel>
          <div className="rounded-2xl border bg-white divide-y">
            {doneToday.map(r => (
              <div key={r.id} className="px-4 py-2.5 flex items-center gap-3">
                <Check size={16} style={{ color: GREEN }} />
                <p className="flex-1 text-sm text-muted-foreground line-through">{r.item_name} · {qtyText(r)}</p>
                <button className="text-xs underline text-muted-foreground flex items-center gap-1"
                  onClick={() => setStatus.mutate({ id: r.id, status: "requested" })}><RotateCcw size={12} /> Undo</button>
              </div>
            ))}
          </div>
        </div>
      )}

      <Button className="w-full h-12 text-base font-semibold" style={{ background: NAVY }}
        disabled={todo.length === 0 && doneToday.length === 0} onClick={() => setConfirmFinish(true)}>
        Finish run
      </Button>

      <Dialog open={confirmFinish} onOpenChange={setConfirmFinish}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Finish the run?</DialogTitle>
            <DialogDescription>
              {todo.length
                ? `${todo.length} item${todo.length > 1 ? "s haven't" : " hasn't"} been ticked off. They'll be flagged and the chefs told on WhatsApp so they can order elsewhere.`
                : "Everything's been ticked off. Nice work."}
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setConfirmFinish(false)}>Not yet</Button>
            <Button className="flex-1" style={{ background: NAVY }} disabled={finish.isPending} onClick={() => finish.mutate()}>
              {finish.isPending ? "Finishing…" : "Finish run"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Send order to a supplier ──────────────────────────────────────────────────
function SendOrderDialog({ supplierId, onClose }: { supplierId: number; onClose: () => void }) {
  const { toast } = useToast();
  const refresh = useRefresh();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/stock/supplier-orders/preview", supplierId],
    queryFn: () => json("GET", `/api/stock/supplier-orders/preview/${supplierId}`),
    staleTime: 0,
  });
  const [to, setTo] = useState<string | null>(null);
  const [subject, setSubject] = useState<string | null>(null);
  const [body, setBody] = useState<string | null>(null);
  const [saveEmail, setSaveEmail] = useState(true);

  const toV = to ?? data?.to ?? "";
  const subjectV = subject ?? data?.subject ?? "";
  const bodyV = body ?? data?.body ?? "";
  const hasDash = /[–—]/.test(subjectV + bodyV);

  const send = useMutation({
    mutationFn: (mode: "email" | "manual") => json("POST", "/api/stock/supplier-orders", {
      supplierId, requestIds: (data?.items || []).map((i: any) => i.id),
      to: toV, subject: subjectV, body: bodyV, mode, saveEmail: saveEmail && !data?.supplier?.email,
    }),
    onSuccess: (_r, mode) => {
      toast({ description: mode === "email" ? `Order emailed to ${data.supplier.name}` : `${data.supplier.name} order marked as placed` });
      refresh(); qc.invalidateQueries({ queryKey: ["/api/stock/suppliers"] }); onClose();
    },
    onError: (e: any) => toast({ description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Order from {data?.supplier?.name ?? "…"}</DialogTitle>
          <DialogDescription>Check the email, tweak anything you need, then send.</DialogDescription>
        </DialogHeader>
        {isLoading || !data ? <p className="text-sm text-muted-foreground py-6 text-center">Loading…</p> : (
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground">To</label>
              <Input type="email" value={toV} onChange={e => setTo(e.target.value)} placeholder="orders@supplier.com.au" className="h-10" />
              {!data.supplier.email && toV && (
                <label className="flex items-center gap-2 text-xs text-muted-foreground mt-1.5">
                  <input type="checkbox" checked={saveEmail} onChange={e => setSaveEmail(e.target.checked)} />
                  Save this as {data.supplier.name}'s order email
                </label>
              )}
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Subject</label>
              <Input value={subjectV} onChange={e => setSubject(e.target.value)} className="h-10" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Email</label>
              <Textarea value={bodyV} onChange={e => setBody(e.target.value)} rows={14} className="text-sm font-mono leading-relaxed" />
            </div>
            {hasDash && <p className="text-xs text-red-600">There's a dash (– or —) in the email. Swap it for a comma or full stop before sending.</p>}
            {!data.emailConfigured && (
              <div className="rounded-xl p-3 text-sm" style={{ background: YELLOW, color: DEEP_GREEN }}>
                Sending from the app isn't switched on yet. You can still copy the email, send it yourself, then tap "Ordered another way".
              </div>
            )}
            <div className="flex flex-col gap-2">
              <Button className="h-11 gap-2" style={{ background: NAVY }}
                disabled={!data.emailConfigured || !toV || hasDash || send.isPending}
                onClick={() => send.mutate("email")}>
                <Send size={16} /> {send.isPending ? "Sending…" : `Send to ${data.supplier.name}`}
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
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Check a delivery in ───────────────────────────────────────────────────────
function ReceiveDialog({ order, onClose }: { order: SupplierOrder; onClose: () => void }) {
  const { toast } = useToast();
  const refresh = useRefresh();
  const [arrived, setArrived] = useState<Set<number>>(new Set(order.items.map(i => i.id)));
  const toggle = (id: number) => setArrived(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const short = order.items.length - arrived.size;
  const save = useMutation({
    mutationFn: () => json("POST", `/api/stock/supplier-orders/${order.id}/receive`, { arrivedIds: Array.from(arrived) }),
    onSuccess: (r: any) => {
      toast({ description: r.short ? `${r.short} short. ${r.alert?.ok ? "Chefs told on WhatsApp." : "WhatsApp didn't send, let the chefs know."}` : "Delivery checked in" });
      refresh(); onClose();
    },
    onError: (e: any) => toast({ description: e.message, variant: "destructive" }),
  });
  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{order.supplier_name} delivery</DialogTitle>
          <DialogDescription>Untick anything that didn't turn up.</DialogDescription>
        </DialogHeader>
        <div className="rounded-xl border divide-y">
          {order.items.map(i => {
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
          {short ? `Confirm (${short} short)` : "Everything arrived"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}

// ─── Tab 3: supplier orders ────────────────────────────────────────────────────
function SupplierTab({ requests, orders }: { requests: StockRequest[]; orders: SupplierOrder[] }) {
  const [sending, setSending] = useState<number | null>(null);
  const [receiving, setReceiving] = useState<SupplierOrder | null>(null);
  const toOrder = requests.filter(r => r.method === "delivery" && r.status === "requested");
  const noSupplier = toOrder.filter(r => !r.supplier_id);
  const bySupplier = groupBy(toOrder.filter(r => r.supplier_id), r => String(r.supplier_id));

  return (
    <div className="space-y-5">
      <div>
        <SectionLabel>Ready to order</SectionLabel>
        {Object.keys(bySupplier).length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center border-2 border-dashed rounded-2xl">No delivery items waiting.</p>
        ) : (
          <div className="space-y-3">
            {Object.values(bySupplier).sort((a, b) => (a[0].supplier_name || "").localeCompare(b[0].supplier_name || "")).map(items => (
              <div key={items[0].supplier_id} className="rounded-2xl border bg-white overflow-hidden">
                <div className="px-4 py-3 flex items-center justify-between border-b" style={{ background: CREAM }}>
                  <div>
                    <p className="text-sm font-bold" style={{ color: NAVY }}>{items[0].supplier_name}</p>
                    <p className="text-xs text-muted-foreground">{items.length} item{items.length > 1 ? "s" : ""}</p>
                  </div>
                  <Button size="sm" className="gap-1.5 h-9" style={{ background: NAVY }} onClick={() => setSending(items[0].supplier_id!)}>
                    <Mail size={14} /> Review and send
                  </Button>
                </div>
                <div className="divide-y">
                  {items.map(r => (
                    <div key={r.id} className="px-4 py-2 flex items-center gap-3 text-sm">
                      <span className="flex-1">{r.supplier_item_name || r.item_name}{r.sku && <span className="text-xs text-muted-foreground"> · {r.sku}</span>}</span>
                      <span className="font-semibold">{qtyText(r)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        {noSupplier.length > 0 && (
          <p className="text-xs text-muted-foreground mt-2">
            {noSupplier.length} delivery item{noSupplier.length > 1 ? "s have" : " has"} no supplier yet. Pick one on the List tab so it shows up here.
          </p>
        )}
      </div>

      <div>
        <SectionLabel>Waiting on delivery</SectionLabel>
        {orders.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing on the way.</p>
        ) : (
          <div className="space-y-2">
            {orders.map(o => (
              <div key={o.id} className="rounded-2xl border bg-white px-4 py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold">{o.supplier_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {o.items.length} items · {o.sent_via === "email" ? "emailed" : "ordered"} {when(o.sent_at)}{o.sent_by ? ` by ${o.sent_by}` : ""}
                  </p>
                </div>
                <Button size="sm" variant="outline" className="gap-1.5 h-9" onClick={() => setReceiving(o)}>
                  <PackageCheck size={15} /> Check in
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {sending != null && <SendOrderDialog supplierId={sending} onClose={() => setSending(null)} />}
      {receiving && <ReceiveDialog order={receiving} onClose={() => setReceiving(null)} />}
    </div>
  );
}

// ─── Tab 4: history ────────────────────────────────────────────────────────────
function HistoryTab({ history }: { history: StockRequest[] }) {
  if (!history.length) return <p className="text-sm text-muted-foreground text-center py-10">Nothing in the last 30 days.</p>;
  return (
    <div className="rounded-2xl border bg-white divide-y">
      {history.map(r => (
        <div key={r.id} className="px-4 py-2.5 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-sm">{r.item_name} <span className="text-muted-foreground">· {qtyText(r)}</span></p>
            <p className="text-xs text-muted-foreground truncate">
              {r.supplier_name || "No supplier"}{r.handled_by ? ` · ${r.handled_by}` : ""} · {when(r.handled_at || r.requested_at)}
            </p>
          </div>
          <StatusPill status={r.status} />
        </div>
      ))}
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/stock/suppliers"] }),
    onError: (e: any) => toast({ description: e.message, variant: "destructive" }),
  });
  const draft = (s: SupplierRow) => drafts[s.id] ?? { email: s.email || "", contactName: s.contact_name || "" };
  const setDraft = (s: SupplierRow, patch: Partial<{ email: string; contactName: string }>) =>
    setDrafts(p => ({ ...p, [s.id]: { ...draft(s), ...patch } }));
  const saveDraft = (s: SupplierRow) => {
    const d = drafts[s.id];
    if (!d) return;
    if ((d.email || "") === (s.email || "") && (d.contactName || "") === (s.contact_name || "")) return;
    update.mutate({ id: s.id, body: { email: d.email, contactName: d.contactName } }, {
      onSuccess: () => toast({ description: `${s.name} saved` }),
    });
  };

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Supplier ordering settings</DialogTitle>
          <DialogDescription>Choose who picks up and who delivers, and where order emails go.</DialogDescription>
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
                      className="px-2.5 py-1.5"
                      style={s.collection_method === m ? { background: NAVY, color: "white" } : { color: "#6B7280" }}>
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
type Tab = "list" | "driver" | "suppliers" | "history";

export default function StockOrder() {
  const [tab, setTab] = useState<Tab>("list");
  const [showSettings, setShowSettings] = useState(false);

  const { data: requests = [], isLoading } = useQuery<StockRequest[]>({
    queryKey: ["/api/stock/requests", "open"],
    queryFn: () => json("GET", "/api/stock/requests?scope=open"),
    refetchInterval: 20000, staleTime: 0,
  });
  const { data: history = [] } = useQuery<StockRequest[]>({
    queryKey: ["/api/stock/requests", "history"],
    queryFn: () => json("GET", "/api/stock/requests?scope=history"),
    refetchInterval: 60000, staleTime: 0,
  });
  const { data: orders = [] } = useQuery<SupplierOrder[]>({
    queryKey: ["/api/stock/supplier-orders"],
    queryFn: () => json("GET", "/api/stock/supplier-orders"),
    refetchInterval: 60000, staleTime: 0,
  });
  const { data: catalogue = [] } = useQuery<CatalogueItem[]>({
    queryKey: ["/api/stock/catalogue"],
    queryFn: () => json("GET", "/api/stock/catalogue"),
    staleTime: 5 * 60000,
  });
  const { data: supData } = useQuery<{ suppliers: SupplierRow[]; emailConfigured: boolean; emailFrom: string | null }>({
    queryKey: ["/api/stock/suppliers"],
    queryFn: () => json("GET", "/api/stock/suppliers"),
    staleTime: 0,
  });
  const suppliers = supData?.suppliers ?? [];

  const counts = {
    list: requests.filter(r => r.status === "requested" || r.status === "unavailable").length,
    driver: requests.filter(r => r.method === "driver" && r.status === "requested").length,
    suppliers: requests.filter(r => r.method === "delivery" && r.status === "requested" && r.supplier_id).length + orders.length,
    history: 0,
  };
  const unavailableCount = requests.filter(r => r.status === "unavailable").length;

  const tabs: [Tab, string, any][] = [
    ["list", "List", ShoppingBag],
    ["driver", "Driver run", Car],
    ["suppliers", "Suppliers", Truck],
    ["history", "History", History],
  ];

  return (
    <div className="min-h-full" style={{ background: CREAM }}>
      <div className="p-4 max-w-2xl mx-auto pb-24">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.12em]" style={{ color: GREEN }}>Stock ordering</p>
            <h1 className="text-xl font-extrabold" style={{ color: NAVY }}>What we need</h1>
          </div>
          <Button variant="outline" size="sm" className="gap-1.5 bg-white" onClick={() => setShowSettings(true)}>
            <Settings size={15} /> Suppliers
          </Button>
        </div>

        <div className="grid grid-cols-4 gap-1 bg-white border rounded-xl p-1 mb-5">
          {tabs.map(([key, label, Icon]) => (
            <button key={key} onClick={() => setTab(key)}
              className="relative flex flex-col sm:flex-row items-center justify-center gap-1 py-2 rounded-lg text-xs sm:text-sm font-semibold"
              style={tab === key ? { background: NAVY, color: "white" } : { color: "#6B7280" }}>
              <Icon size={16} />
              {label}
              {counts[key] > 0 && (
                <span className="absolute -top-1 -right-1 sm:static min-w-[18px] h-[18px] px-1 rounded-full text-[10px] flex items-center justify-center"
                  style={key === "list" && unavailableCount ? { background: YELLOW, color: DEEP_GREEN } : { background: PINK, color: DEEP_GREEN }}>
                  {counts[key]}
                </span>
              )}
            </button>
          ))}
        </div>

        {isLoading ? (
          <p className="text-center text-sm text-muted-foreground py-12">Loading…</p>
        ) : tab === "list" ? (
          <ListTab requests={requests} catalogue={catalogue} suppliers={suppliers} />
        ) : tab === "driver" ? (
          <DriverTab requests={requests} history={history} />
        ) : tab === "suppliers" ? (
          <SupplierTab requests={requests} orders={orders} />
        ) : (
          <HistoryTab history={history} />
        )}
      </div>

      {showSettings && (
        <SupplierSettings suppliers={suppliers} emailConfigured={!!supData?.emailConfigured}
          emailFrom={supData?.emailFrom ?? null} onClose={() => setShowSettings(false)} />
      )}
    </div>
  );
}
