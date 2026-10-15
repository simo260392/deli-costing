// Markets tab (inside Stock Ordering): order fruit, veg and eggs from the reps at the markets.
// Build the order → text each rep from your phone → swap reps when someone's out → send to the driver run.
// Setup (reps & produce) lives behind the "Reps & produce" button.
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import {
  ArrowLeft, Check, ChevronRight, MessageSquare, Phone, Plus, Search, Star, Truck, Users, X, AlertTriangle, Copy, Pencil, Store,
} from "lucide-react";

// ─── Brand (same as Stock Ordering) ────────────────────────────────────────────
const NAVY = "#256984";
const PINK = "#FCCDE2";
const GREEN = "#5AB693";
const DEEP_GREEN = "#2D5B4A";
const YELLOW = "#FBF2CE";

// ─── Types ─────────────────────────────────────────────────────────────────────
type Supplier = { id: number; name: string };
type Rep = { id: number; supplier_id: number; name: string; phone: string | null; notes: string | null; active: boolean };
type RepItem = { id: number; rep_id: number; ingredient_id: number; is_preferred: boolean };
type Produce = { id: number; name: string; unit: string; category: string | null; market_order_unit: string | null };
type Price = { supplier_id: number; ingredient_id: number; last_unit_cost: number; last_invoice_date: string | null };
type OrderItem = {
  id: number; order_id: number; ingredient_id: number | null; item_name: string; qty: number; unit: string | null; rep_id: number | null;
  status: "pending" | "texted" | "unavailable" | "cancelled"; notes: string | null; texted_by: string | null; texted_at: string | null;
};
type Order = { id: number; collect_by: string; status: string; created_by: string | null; created_at: string; items: OrderItem[] };
type MarketsData = { suppliers: Supplier[]; reps: Rep[]; repItems: RepItem[]; produce: Produce[]; prices: Price[]; order: Order | null; recent: any[] };

const UNITS = ["box", "tray", "kg", "each", "bag", "bunch", "punnet", "dozen", "case"];
const json = (method: string, url: string, body?: unknown) => apiRequest(method, url, body).then((r) => r.json());
const errText = (e: any) => String(e?.message || e).replace(/^\d+: /, "").replace(/^\{"error":"(.*)"\}$/, "$1");
const perthYmd = (offset = 0) => new Date(Date.now() + 8 * 3600000 + offset * 86400000).toISOString().slice(0, 10);
const dayText = (ymd: string) => (ymd === perthYmd(0) ? "Today" : ymd === perthYmd(1) ? "Tomorrow" : format(new Date(`${ymd}T12:00:00`), "EEE d MMM"));
const qtyText = (q: number, u: string | null) => `${Number.isInteger(Number(q)) ? Number(q) : Math.round(Number(q) * 100) / 100}${u ? ` ${u}` : ""}`;
const money = (n: number) => (n < 1 ? `$${n.toFixed(3)}` : `$${n.toFixed(2)}`);
const firstName = (n: string) => n.split(" ")[0];
const smsHref = (phone: string, body: string) => `sms:${phone}?&body=${encodeURIComponent(body)}`;

function buildMessage(rep: Rep, items: OrderItem[], collectBy: string, followUp: boolean) {
  return [
    `Hi ${firstName(rep.name)}, ${followUp ? "one more for" : "order from"} The Deli by Greenhorns for ${dayText(collectBy) === "Tomorrow" || dayText(collectBy) === "Today" ? dayText(collectBy).toLowerCase() : dayText(collectBy)}:`,
    "",
    ...items.map((i) => `${qtyText(i.qty, i.unit)} ${i.item_name}${i.notes ? ` (${i.notes})` : ""}`),
    "",
    "Thanks!",
  ].join("\n");
}

function useMarkets() {
  return useQuery<MarketsData>({ queryKey: ["/api/markets"], queryFn: () => json("GET", "/api/markets"), refetchInterval: 15000, staleTime: 0 });
}

/** Lookups shared by the views. */
function useLookups(d?: MarketsData) {
  return useMemo(() => {
    const supplierById = new Map((d?.suppliers || []).map((s) => [s.id, s]));
    const repById = new Map((d?.reps || []).map((r) => [r.id, r]));
    const repsFor = (ingredientId: number | null) => {
      if (!ingredientId || !d) return [] as { rep: Rep; preferred: boolean }[];
      return d.repItems.filter((ri) => ri.ingredient_id === ingredientId)
        .map((ri) => ({ rep: repById.get(ri.rep_id)!, preferred: ri.is_preferred }))
        .filter((x) => x.rep && x.rep.active)
        .sort((a, b) => Number(b.preferred) - Number(a.preferred) || a.rep.name.localeCompare(b.rep.name));
    };
    const priceFor = (supplierId: number | undefined, ingredientId: number | null) =>
      supplierId && ingredientId ? d?.prices.find((p) => p.supplier_id === supplierId && p.ingredient_id === ingredientId) : undefined;
    return { supplierById, repById, repsFor, priceFor };
  }, [d]);
}

function RepLabel({ rep, supplierName, price, unit }: { rep: Rep; supplierName?: string; price?: Price; unit?: string }) {
  return (
    <span>
      {rep.name}
      <span className="text-muted-foreground"> · {supplierName || "?"}{price ? ` · ${money(Number(price.last_unit_cost))}/${unit}` : ""}</span>
    </span>
  );
}

// ─── Order: quantities ─────────────────────────────────────────────────────────
function QtyRow({ p, line, data, lk, orderId, onSaved }: {
  p: Produce; line?: OrderItem; data: MarketsData; lk: ReturnType<typeof useLookups>; orderId: number; onSaved: (o: Order) => void;
}) {
  const { toast } = useToast();
  const [qty, setQty] = useState(line ? String(Number(line.qty)) : "");
  const [unit, setUnit] = useState(line?.unit || p.market_order_unit || p.unit);
  useEffect(() => { setQty(line ? String(Number(line.qty)) : ""); if (line?.unit) setUnit(line.unit); }, [line?.id, line?.qty, line?.unit]);
  const reps = lk.repsFor(p.id);
  const rep = line?.rep_id ? lk.repById.get(line.rep_id) : reps[0]?.rep;

  const save = async (patch?: { repId?: number | null }) => {
    const q = Number(qty) || 0;
    if (!line && q <= 0) return;
    if (line && q === Number(line.qty) && unit === line.unit && patch === undefined) return;
    try {
      const o = await json("PUT", `/api/markets/orders/${orderId}/items`, { items: [{ ingredientId: p.id, itemName: p.name, qty: q, unit, ...(patch || {}) }] });
      onSaved(o);
    } catch (e) { toast({ description: errText(e), variant: "destructive" }); }
  };

  return (
    <div className="px-3 py-2.5 border-b last:border-b-0">
      <div className="flex items-center gap-2">
        <p className="flex-1 min-w-0 font-semibold truncate">{p.name}</p>
        <Input className="w-16 h-9 text-center" inputMode="decimal" value={qty} placeholder="0"
          onChange={(e) => setQty(e.target.value)} onBlur={() => save()} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          data-testid={`input-market-qty-${p.id}`} />
        <Input className="w-20 h-9" value={unit} list="market-units" onChange={(e) => setUnit(e.target.value)} onBlur={() => line && save()} />
      </div>
      {line && (
        <div className="mt-1.5 flex items-center gap-2 text-xs">
          {reps.length === 0 ? (
            <span className="flex items-center gap-1" style={{ color: "#7A5B00" }}><AlertTriangle size={12} />No rep sells this yet. Add one in Reps &amp; produce.</span>
          ) : (
            <>
              <span className="text-muted-foreground">from</span>
              <select className="flex-1 min-w-0 h-8 rounded-md border bg-white px-2" value={line.rep_id ?? ""}
                onChange={(e) => save({ repId: e.target.value ? Number(e.target.value) : null })}>
                {!line.rep_id && <option value="">Choose a rep…</option>}
                {reps.map(({ rep: r, preferred }) => {
                  const pr = lk.priceFor(r.supplier_id, p.id);
                  return <option key={r.id} value={r.id}>{preferred ? "★ " : ""}{r.name} · {lk.supplierById.get(r.supplier_id)?.name ?? "?"}{pr ? ` · ${money(Number(pr.last_unit_cost))}/${p.unit}` : ""}</option>;
                })}
              </select>
            </>
          )}
          {rep && !reps.some((x) => x.rep.id === rep.id) && <span className="text-muted-foreground">({rep.name})</span>}
        </div>
      )}
    </div>
  );
}

// ─── Order: send by rep ────────────────────────────────────────────────────────
function SendView({ order, data, lk, onSaved }: { order: Order; data: MarketsData; lk: ReturnType<typeof useLookups>; onSaved: (o: Order) => void }) {
  const { toast } = useToast();
  const [opened, setOpened] = useState<Record<number, number[]>>({}); // repId -> item ids just opened in Messages
  const [outOf, setOutOf] = useState<OrderItem | null>(null);
  const [copied, setCopied] = useState<number | null>(null);
  const live = order.items.filter((i) => i.status === "pending" || i.status === "texted");
  const unassigned = live.filter((i) => i.status === "pending" && !i.rep_id);
  const byRep = new Map<number, OrderItem[]>();
  for (const i of live) if (i.rep_id) (byRep.get(i.rep_id) || byRep.set(i.rep_id, []).get(i.rep_id)!).push(i);
  const groups = Array.from(byRep.entries()).map(([repId, items]) => ({ rep: lk.repById.get(repId)!, items })).filter((g) => g.rep)
    .sort((a, b) => Number(b.items.some((i) => i.status === "pending")) - Number(a.items.some((i) => i.status === "pending")) || a.rep.name.localeCompare(b.rep.name));

  const markTexted = async (itemIds: number[]) => {
    try { onSaved(await json("POST", `/api/markets/orders/${order.id}/texted`, { itemIds })); }
    catch (e) { toast({ description: errText(e), variant: "destructive" }); }
  };
  const swap = async (item: OrderItem, repId: number | null) => {
    try { onSaved(await json("POST", `/api/markets/items/${item.id}/unavailable`, { repId })); setOutOf(null); }
    catch (e) { toast({ description: errText(e), variant: "destructive" }); }
  };

  return (
    <div className="space-y-3">
      {unassigned.length > 0 && (
        <div className="rounded-2xl border p-3 text-sm" style={{ background: YELLOW, borderColor: "#E8D9A0" }}>
          <p className="font-semibold">No rep chosen for {unassigned.length} item{unassigned.length > 1 ? "s" : ""}</p>
          <p className="text-xs mt-0.5">{unassigned.map((i) => i.item_name).join(", ")}. Pick a rep on the Items tab, or add one in Reps &amp; produce.</p>
        </div>
      )}
      {groups.length === 0 && unassigned.length === 0 && <p className="text-center text-sm text-muted-foreground py-8">Add quantities on the Items tab first.</p>}

      {groups.map(({ rep, items }) => {
        const pending = items.filter((i) => i.status === "pending");
        const texted = items.filter((i) => i.status === "texted");
        const supplier = lk.supplierById.get(rep.supplier_id);
        const msg = buildMessage(rep, pending, order.collect_by, texted.length > 0);
        const justOpened = opened[rep.id];
        return (
          <div key={rep.id} className="rounded-2xl border bg-white overflow-hidden">
            <div className="px-4 py-3 flex items-center gap-3 border-b">
              <div className="flex-1 min-w-0">
                <p className="font-bold truncate" style={{ color: NAVY }}>{rep.name}</p>
                <p className="text-xs text-muted-foreground truncate">{supplier?.name}{rep.phone ? ` · ${rep.phone}` : ""}</p>
              </div>
              {pending.length === 0 ? (
                <span className="text-xs font-semibold flex items-center gap-1" style={{ color: DEEP_GREEN }}><Check size={14} />Texted</span>
              ) : justOpened ? (
                <Button size="sm" style={{ background: GREEN }} onClick={() => { markTexted(justOpened); setOpened((o) => { const n = { ...o }; delete n[rep.id]; return n; }); }}>
                  <Check size={15} className="mr-1" />Sent it
                </Button>
              ) : rep.phone ? (
                <Button size="sm" asChild style={{ background: NAVY }}>
                  <a href={smsHref(rep.phone, msg)} onClick={() => setOpened((o) => ({ ...o, [rep.id]: pending.map((i) => i.id) }))} data-testid={`button-text-rep-${rep.id}`}>
                    <MessageSquare size={15} className="mr-1" />Text {firstName(rep.name)}
                  </a>
                </Button>
              ) : (
                <span className="text-xs" style={{ color: "#7A5B00" }}>No mobile saved</span>
              )}
            </div>
            <div className="divide-y">
              {items.map((i) => (
                <div key={i.id} className="px-4 py-2 flex items-center gap-2 text-sm">
                  <span className="flex-1 min-w-0">
                    <span className="font-medium">{i.item_name}</span> <span style={{ color: NAVY }}>{qtyText(i.qty, i.unit)}</span>
                    {i.status === "pending" && texted.length > 0 && <span className="ml-1 text-[11px] px-1.5 py-0.5 rounded-full" style={{ background: PINK, color: DEEP_GREEN }}>new</span>}
                  </span>
                  {i.status === "texted" && (
                    <button className="text-xs underline text-muted-foreground" onClick={() => setOutOf(i)} data-testid={`button-out-of-stock-${i.id}`}>Out of stock?</button>
                  )}
                </div>
              ))}
            </div>
            {pending.length > 0 && (
              <div className="px-4 py-2 border-t bg-muted/30 flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">{justOpened ? "Opened in Messages. Tap Sent it once it's gone." : "Opens Messages on this phone with the order filled in."}</span>
                <button className="text-xs underline text-muted-foreground flex items-center gap-1 shrink-0"
                  onClick={() => { navigator.clipboard?.writeText(msg).then(() => { setCopied(rep.id); setTimeout(() => setCopied(null), 1500); }).catch(() => {}); setOpened((o) => ({ ...o, [rep.id]: pending.map((x) => x.id) })); }}>
                  <Copy size={12} />{copied === rep.id ? "Copied" : "Copy text"}
                </button>
              </div>
            )}
          </div>
        );
      })}

      {order.items.some((i) => i.status === "unavailable") && (
        <div className="rounded-2xl border bg-white px-4 py-3 text-sm">
          <p className="font-semibold mb-1">Out of stock</p>
          {order.items.filter((i) => i.status === "unavailable").map((i) => (
            <p key={i.id} className="text-muted-foreground">{i.item_name} {qtyText(i.qty, i.unit)} · {i.rep_id ? lk.repById.get(i.rep_id)?.name : "?"} was out</p>
          ))}
        </div>
      )}

      <Dialog open={!!outOf} onOpenChange={(o) => !o && setOutOf(null)}>
        <DialogContent className="max-w-sm">
          {outOf && (() => {
            const others = lk.repsFor(outOf.ingredient_id).filter((x) => x.rep.id !== outOf.rep_id);
            const ing = data.produce.find((p) => p.id === outOf.ingredient_id);
            return (
              <>
                <DialogHeader>
                  <DialogTitle>{outOf.item_name}: who else has it?</DialogTitle>
                  <DialogDescription>{outOf.rep_id ? lk.repById.get(outOf.rep_id)?.name : "This rep"} is out. Pick another rep and it'll be added to their text.</DialogDescription>
                </DialogHeader>
                <div className="space-y-2">
                  {others.length === 0 && <p className="text-sm text-muted-foreground">No other reps sell this yet. Add them in Reps &amp; produce.</p>}
                  {others.map(({ rep: r, preferred }) => (
                    <button key={r.id} className="w-full text-left rounded-xl border px-3 py-2.5 hover:bg-muted/50 text-sm flex items-center gap-2" onClick={() => swap(outOf, r.id)}>
                      {preferred && <Star size={13} fill={GREEN} color={GREEN} />}
                      <RepLabel rep={r} supplierName={lk.supplierById.get(r.supplier_id)?.name} price={lk.priceFor(r.supplier_id, outOf.ingredient_id)} unit={ing?.unit} />
                      <ChevronRight size={15} className="ml-auto text-muted-foreground" />
                    </button>
                  ))}
                  <Button variant="outline" className="w-full" onClick={() => swap(outOf, null)}>Nobody has it, leave it off</Button>
                </div>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Order screen ──────────────────────────────────────────────────────────────
function OrderView({ order, data, onSetup }: { order: Order; data: MarketsData; onSetup: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const lk = useLookups(data);
  const [view, setView] = useState<"items" | "send">(order.items.some((i) => i.status !== "pending") ? "send" : "items");
  const [search, setSearch] = useState("");
  const [onlyOrdered, setOnlyOrdered] = useState(false);
  const [confirmDriver, setConfirmDriver] = useState(false);
  const [busy, setBusy] = useState(false);
  const onSaved = (o: Order) => qc.setQueryData<MarketsData>(["/api/markets"], (d) => (d ? { ...d, order: o } : d));

  const lineFor = (p: Produce) => order.items.find((i) => i.ingredient_id === p.id && i.status === "pending")
    || order.items.find((i) => i.ingredient_id === p.id && i.status === "texted");
  const shown = data.produce.filter((p) => (!search || p.name.toLowerCase().includes(search.toLowerCase())) && (!onlyOrdered || lineFor(p)));
  const texted = order.items.filter((i) => i.status === "texted").length;
  const pending = order.items.filter((i) => i.status === "pending").length;

  const toDriver = async (skipUntexted: boolean) => {
    setBusy(true);
    try {
      const r = await json("POST", `/api/markets/orders/${order.id}/to-driver`, { skipUntexted });
      toast({ description: `On the driver run: ${r.lists} supplier list${r.lists === 1 ? "" : "s"}. ${r.alert?.ok ? "Drivers told on WhatsApp." : "WhatsApp didn't send, so let the drivers know."}` });
      setConfirmDriver(false);
      qc.invalidateQueries({ queryKey: ["/api/markets"] });
      qc.invalidateQueries({ queryKey: ["/api/stock/lists", "active"] });
    } catch (e: any) {
      if (String(e?.message).startsWith("409")) setConfirmDriver(true);
      else toast({ description: errText(e), variant: "destructive" });
    } finally { setBusy(false); }
  };
  const changeDate = async (ymd: string) => {
    try { onSaved(await json("PATCH", `/api/markets/orders/${order.id}`, { collectBy: ymd })); } catch (e) { toast({ description: errText(e), variant: "destructive" }); }
  };
  const cancel = async () => {
    if (!confirm("Cancel this markets order? Anything already texted to reps isn't unsent.")) return;
    await json("PATCH", `/api/markets/orders/${order.id}`, { cancel: true }).catch(() => {});
    qc.invalidateQueries({ queryKey: ["/api/markets"] });
  };

  return (
    <div className="space-y-3">
      <datalist id="market-units">{UNITS.map((u) => <option key={u} value={u} />)}</datalist>
      <div className="rounded-2xl border bg-white px-4 py-3 flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <p className="font-bold" style={{ color: NAVY }}>Markets order</p>
          <p className="text-xs text-muted-foreground">Started by {order.created_by || "?"} · {order.items.filter((i) => i.status !== "cancelled" && i.status !== "unavailable").length} items</p>
        </div>
        <label className="text-xs text-muted-foreground flex items-center gap-1">Collect
          <Input type="date" className="h-8 w-[140px]" value={order.collect_by} onChange={(e) => e.target.value && changeDate(e.target.value)} />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-1 bg-white border rounded-xl p-1">
        {(["items", "send"] as const).map((v) => (
          <button key={v} onClick={() => setView(v)} className="py-2 rounded-lg text-sm font-semibold"
            style={view === v ? { background: NAVY, color: "white" } : { color: "#6B7280" }}>
            {v === "items" ? "1. Items" : `2. Text reps${pending ? ` (${new Set(order.items.filter((i) => i.status === "pending" && i.rep_id).map((i) => i.rep_id)).size} to text)` : ""}`}
          </button>
        ))}
      </div>

      {view === "items" ? (
        <>
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-9 bg-white" placeholder="Search produce" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <Button size="sm" variant={onlyOrdered ? "default" : "outline"} className={onlyOrdered ? "" : "bg-white"} style={onlyOrdered ? { background: NAVY } : undefined} onClick={() => setOnlyOrdered((v) => !v)}>
              Ordered only
            </Button>
          </div>
          <div className="rounded-2xl border bg-white overflow-hidden">
            {shown.length === 0 && <p className="text-sm text-center text-muted-foreground py-6">{data.produce.length ? "Nothing matches." : "No produce on the markets list yet. Add it in Reps & produce."}</p>}
            {shown.map((p) => {
              const line = lineFor(p);
              return line && line.status === "texted" ? (
                <div key={p.id} className="px-3 py-2.5 border-b last:border-b-0 flex items-center gap-2 text-sm">
                  <p className="flex-1 font-semibold">{p.name}</p>
                  <span style={{ color: NAVY }}>{qtyText(line.qty, line.unit)}</span>
                  <span className="text-xs flex items-center gap-1" style={{ color: DEEP_GREEN }}><Check size={13} />texted to {line.rep_id ? firstName(lk.repById.get(line.rep_id)?.name || "") : "?"}</span>
                </div>
              ) : (
                <QtyRow key={p.id} p={p} line={line} data={data} lk={lk} orderId={order.id} onSaved={onSaved} />
              );
            })}
          </div>
          <Button className="w-full h-11 font-semibold" style={{ background: NAVY }} disabled={!pending} onClick={() => setView("send")}>
            Next: text the reps
          </Button>
        </>
      ) : (
        <SendView order={order} data={data} lk={lk} onSaved={onSaved} />
      )}

      <Button className="w-full h-12 text-base font-semibold" style={{ background: GREEN }} disabled={!texted || busy} onClick={() => toDriver(false)} data-testid="button-markets-to-driver">
        <Truck size={18} className="mr-2" />Send to driver run
      </Button>
      <div className="flex justify-between text-xs">
        <button className="underline text-muted-foreground" onClick={onSetup}>Reps &amp; produce</button>
        <button className="underline text-muted-foreground" onClick={cancel}>Cancel order</button>
      </div>

      <Dialog open={confirmDriver} onOpenChange={setConfirmDriver}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Some items haven't been texted</DialogTitle>
            <DialogDescription>{pending} item{pending === 1 ? " hasn't" : "s haven't"} been sent to a rep. Send the rest to the driver run and drop {pending === 1 ? "it" : "them"}?</DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => { setConfirmDriver(false); setView("send"); }}>Text them first</Button>
            <Button className="flex-1" style={{ background: NAVY }} disabled={busy} onClick={() => toDriver(true)}>Send anyway</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Setup: reps ───────────────────────────────────────────────────────────────
function RepDialog({ rep, data, onClose }: { rep: Rep | "new"; data: MarketsData; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const isNew = rep === "new";
  const [name, setName] = useState(isNew ? "" : rep.name);
  const [phone, setPhone] = useState(isNew ? "" : rep.phone || "");
  const [supplierId, setSupplierId] = useState<number | "">(isNew ? "" : rep.supplier_id);
  const [newSupplier, setNewSupplier] = useState("");
  const [items, setItems] = useState<Set<number>>(new Set(isNew ? [] : data.repItems.filter((ri) => ri.rep_id === rep.id).map((ri) => ri.ingredient_id)));
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const invoiced = useMemo(() => new Set(data.prices.filter((p) => p.supplier_id === supplierId).map((p) => p.ingredient_id)), [data.prices, supplierId]);

  const save = async () => {
    if (!name.trim()) return toast({ description: "Enter the rep's name", variant: "destructive" });
    setBusy(true);
    try {
      let sid = supplierId;
      if (supplierId === -1) {
        if (!newSupplier.trim()) throw new Error("Enter the new supplier's name");
        sid = (await json("POST", "/api/markets/suppliers", { name: newSupplier.trim() })).id;
      }
      if (!sid) throw new Error("Pick the supplier this rep works for");
      let id = isNew ? null : rep.id;
      if (isNew) id = (await json("POST", "/api/markets/reps", { name, phone, supplierId: sid })).id;
      else await json("PATCH", `/api/markets/reps/${id}`, { name, phone, supplierId: sid });
      await json("PUT", `/api/markets/reps/${id}/items`, { ingredientIds: Array.from(items) });
      qc.invalidateQueries({ queryKey: ["/api/markets"] });
      toast({ description: `${name} saved` });
      onClose();
    } catch (e) { toast({ description: errText(e), variant: "destructive" }); }
    finally { setBusy(false); }
  };
  const archive = async () => {
    if (isNew || !confirm(`Remove ${rep.name}? They'll stop showing on orders.`)) return;
    await json("PATCH", `/api/markets/reps/${rep.id}`, { active: false }).catch(() => {});
    qc.invalidateQueries({ queryKey: ["/api/markets"] });
    onClose();
  };
  const toggle = (id: number) => setItems((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const list = data.produce.filter((p) => !search || p.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{isNew ? "Add a rep" : `Edit ${rep.name}`}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} data-testid="input-rep-name" />
          <Input placeholder="Mobile, e.g. 0412 345 678" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} data-testid="input-rep-phone" />
          <select className="w-full h-10 rounded-md border bg-white px-3 text-sm" value={supplierId} onChange={(e) => setSupplierId(e.target.value === "" ? "" : Number(e.target.value))}>
            <option value="">Which supplier?</option>
            {data.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            <option value={-1}>+ New market supplier…</option>
          </select>
          {supplierId === -1 && <Input placeholder="New supplier name" value={newSupplier} onChange={(e) => setNewSupplier(e.target.value)} />}

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-sm font-semibold">Sells ({items.size})</p>
              {invoiced.size > 0 && (
                <button className="text-xs underline" style={{ color: NAVY }} onClick={() => setItems((s) => new Set([...Array.from(s), ...Array.from(invoiced)]))}>
                  Tick what this supplier has invoiced
                </button>
              )}
            </div>
            <Input className="mb-2" placeholder="Search produce" value={search} onChange={(e) => setSearch(e.target.value)} />
            <div className="rounded-xl border max-h-64 overflow-y-auto divide-y">
              {list.map((p) => (
                <label key={p.id} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={items.has(p.id)} onChange={() => toggle(p.id)} />
                  <span className="flex-1">{p.name}</span>
                  {invoiced.has(p.id) && <span className="text-[11px] text-muted-foreground">invoiced</span>}
                </label>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            {!isNew && <Button variant="ghost" className="text-red-600" onClick={archive}>Remove rep</Button>}
            <Button className="flex-1" style={{ background: NAVY }} disabled={busy} onClick={save}>Save</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SetupView({ data, onBack }: { data: MarketsData; onBack: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const lk = useLookups(data);
  const [tab, setTab] = useState<"reps" | "produce">("reps");
  const [editing, setEditing] = useState<Rep | "new" | null>(null);
  const [adding, setAdding] = useState(false);
  const [newSupplier, setNewSupplier] = useState("");
  const { data: candidates = [] } = useQuery<Produce[]>({ queryKey: ["/api/markets/produce-candidates"], queryFn: () => json("GET", "/api/markets/produce-candidates"), enabled: adding });
  const [candSearch, setCandSearch] = useState("");
  const refresh = () => qc.invalidateQueries({ queryKey: ["/api/markets"] });
  const act = async (fn: () => Promise<any>) => { try { await fn(); refresh(); } catch (e) { toast({ description: errText(e), variant: "destructive" }); } };
  const activeReps = data.reps.filter((r) => r.active);
  const noRep = data.produce.filter((p) => lk.repsFor(p.id).length === 0);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <button onClick={onBack} className="p-2 -ml-2 rounded-lg hover:bg-white"><ArrowLeft size={18} /></button>
        <h2 className="text-lg font-extrabold" style={{ color: NAVY }}>Reps &amp; produce</h2>
      </div>
      <div className="grid grid-cols-2 gap-1 bg-white border rounded-xl p-1">
        {(["reps", "produce"] as const).map((v) => (
          <button key={v} onClick={() => setTab(v)} className="py-2 rounded-lg text-sm font-semibold" style={tab === v ? { background: NAVY, color: "white" } : { color: "#6B7280" }}>
            {v === "reps" ? `Reps (${activeReps.length})` : `Produce (${data.produce.length})`}
          </button>
        ))}
      </div>

      {tab === "reps" ? (
        <>
          <Button className="w-full" style={{ background: NAVY }} onClick={() => setEditing("new")} data-testid="button-add-rep"><Plus size={16} className="mr-1" />Add a rep</Button>
          {data.suppliers.map((s) => {
            const reps = activeReps.filter((r) => r.supplier_id === s.id);
            return (
              <div key={s.id} className="rounded-2xl border bg-white overflow-hidden">
                <div className="px-4 py-2.5 border-b flex items-center gap-2" style={{ background: "#F8FAFB" }}>
                  <Store size={15} style={{ color: NAVY }} />
                  <p className="font-bold text-sm flex-1">{s.name}</p>
                  {reps.length === 0 && (
                    <button className="text-xs underline text-muted-foreground" onClick={() => act(() => json("PATCH", `/api/markets/suppliers/${s.id}`, { isMarket: false }))}>Not a market supplier</button>
                  )}
                </div>
                {reps.length === 0 && <p className="px-4 py-2.5 text-xs text-muted-foreground">No reps yet.</p>}
                {reps.map((r) => {
                  const n = data.repItems.filter((ri) => ri.rep_id === r.id).length;
                  return (
                    <button key={r.id} className="w-full text-left px-4 py-2.5 border-b last:border-b-0 flex items-center gap-3 hover:bg-muted/40" onClick={() => setEditing(r)}>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm">{r.name}</p>
                        <p className="text-xs text-muted-foreground flex items-center gap-1">{r.phone ? <><Phone size={11} />{r.phone}</> : <span style={{ color: "#7A5B00" }}>No mobile</span>} · {n} item{n === 1 ? "" : "s"}</p>
                      </div>
                      <Pencil size={14} className="text-muted-foreground" />
                    </button>
                  );
                })}
              </div>
            );
          })}
          <div className="flex gap-2">
            <Input className="bg-white" placeholder="Add a market supplier" value={newSupplier} onChange={(e) => setNewSupplier(e.target.value)} />
            <Button variant="outline" className="bg-white" disabled={!newSupplier.trim()} onClick={() => act(async () => { await json("POST", "/api/markets/suppliers", { name: newSupplier.trim() }); setNewSupplier(""); })}>Add</Button>
          </div>
        </>
      ) : (
        <>
          {noRep.length > 0 && (
            <div className="rounded-2xl border p-3 text-xs" style={{ background: YELLOW, borderColor: "#E8D9A0" }}>
              <b>{noRep.length} item{noRep.length > 1 ? "s have" : " has"} no rep yet:</b> {noRep.map((p) => p.name).join(", ")}
            </div>
          )}
          <p className="text-xs text-muted-foreground px-1">Tap a rep to make them the preferred one (★) for that item. New orders use the preferred rep.</p>
          <div className="rounded-2xl border bg-white overflow-hidden">
            {data.produce.map((p) => {
              const reps = lk.repsFor(p.id);
              return (
                <div key={p.id} className="px-3 py-2.5 border-b last:border-b-0">
                  <div className="flex items-center gap-2">
                    <p className="flex-1 font-semibold text-sm">{p.name}</p>
                    <Input className="w-20 h-8 text-xs" placeholder={p.unit} list="market-units-setup" defaultValue={p.market_order_unit || ""}
                      title="Usual order unit" onBlur={(e) => e.target.value !== (p.market_order_unit || "") && act(() => json("PATCH", `/api/markets/produce/${p.id}`, { orderUnit: e.target.value }))} />
                    <button title="Take off the markets list" className="p-1 text-muted-foreground" onClick={() => act(() => json("PATCH", `/api/markets/produce/${p.id}`, { marketItem: false }))}><X size={15} /></button>
                  </div>
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {reps.length === 0 && <span className="text-xs" style={{ color: "#7A5B00" }}>No rep yet</span>}
                    {reps.map(({ rep: r, preferred }) => {
                      const pr = lk.priceFor(r.supplier_id, p.id);
                      return (
                        <button key={r.id} onClick={() => !preferred && act(() => json("POST", "/api/markets/preferred", { ingredientId: p.id, repId: r.id }))}
                          className="text-xs rounded-full border px-2.5 py-1 flex items-center gap-1"
                          style={preferred ? { background: GREEN, color: "white", borderColor: GREEN } : undefined}>
                          {preferred && <Star size={11} fill="white" />}{r.name}
                          <span className={preferred ? "opacity-80" : "text-muted-foreground"}>· {lk.supplierById.get(r.supplier_id)?.name.replace(/ - Markets$/i, "")}{pr ? ` ${money(Number(pr.last_unit_cost))}` : ""}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
          <datalist id="market-units-setup">{UNITS.map((u) => <option key={u} value={u} />)}</datalist>
          {!adding ? (
            <Button variant="outline" className="w-full bg-white" onClick={() => setAdding(true)}><Plus size={16} className="mr-1" />Add produce to the markets list</Button>
          ) : (
            <div className="rounded-2xl border bg-white p-3 space-y-2">
              <Input placeholder="Search ingredients" value={candSearch} onChange={(e) => setCandSearch(e.target.value)} autoFocus />
              <div className="max-h-60 overflow-y-auto divide-y">
                {candidates.filter((c) => !candSearch || c.name.toLowerCase().includes(candSearch.toLowerCase())).slice(0, 60).map((c) => (
                  <button key={c.id} className="w-full text-left px-2 py-2 text-sm flex items-center gap-2 hover:bg-muted/40"
                    onClick={() => act(async () => { await json("PATCH", `/api/markets/produce/${c.id}`, { marketItem: true }); qc.invalidateQueries({ queryKey: ["/api/markets/produce-candidates"] }); })}>
                    <Plus size={14} /> {c.name} <span className="text-xs text-muted-foreground">{c.category}</span>
                  </button>
                ))}
              </div>
              <Button variant="ghost" className="w-full" onClick={() => setAdding(false)}>Done</Button>
            </div>
          )}
        </>
      )}

      {editing && <RepDialog rep={editing} data={data} onClose={() => setEditing(null)} />}
    </div>
  );
}

// ─── Tab ───────────────────────────────────────────────────────────────────────
export default function MarketsTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useMarkets();
  const [setup, setSetup] = useState(false);
  const [collectBy, setCollectBy] = useState(perthYmd(1));

  if (isLoading || !data) return <p className="text-center text-sm text-muted-foreground py-12">Loading…</p>;
  if (setup) return <SetupView data={data} onBack={() => setSetup(false)} />;
  if (data.order) return <OrderView order={data.order} data={data} onSetup={() => setSetup(true)} />;

  const start = async () => {
    try { const o = await json("POST", "/api/markets/orders", { collectBy }); qc.setQueryData<MarketsData>(["/api/markets"], (d) => (d ? { ...d, order: o } : d)); }
    catch (e) { toast({ description: errText(e), variant: "destructive" }); }
  };
  const repCount = data.reps.filter((r) => r.active).length;

  return (
    <div className="space-y-3">
      {repCount === 0 && (
        <div className="rounded-2xl border p-4 text-sm" style={{ background: YELLOW, borderColor: "#E8D9A0" }}>
          <p className="font-semibold">Set up your market reps first</p>
          <p className="text-xs mt-1">Add each rep, their mobile, their supplier and what they sell. Then orders fill in the right rep automatically.</p>
          <Button size="sm" className="mt-3" style={{ background: NAVY }} onClick={() => setSetup(true)}><Users size={15} className="mr-1" />Reps &amp; produce</Button>
        </div>
      )}
      <div className="rounded-2xl border bg-white p-4 space-y-3">
        <div>
          <p className="font-bold" style={{ color: NAVY }}>New markets order</p>
          <p className="text-xs text-muted-foreground">Fruit, veg and eggs. Each item goes to its preferred rep, and you text each rep from your phone.</p>
        </div>
        <label className="text-sm flex items-center gap-2">Collect on
          <Input type="date" className="w-[160px]" value={collectBy} onChange={(e) => setCollectBy(e.target.value)} />
          <span className="text-muted-foreground text-xs">{dayText(collectBy)}</span>
        </label>
        <Button className="w-full h-11 font-semibold" style={{ background: NAVY }} onClick={start} data-testid="button-start-markets-order"><Plus size={16} className="mr-1" />Start order</Button>
      </div>
      {data.recent.length > 0 && (
        <div className="rounded-2xl border bg-white divide-y">
          <p className="px-4 py-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">Recent</p>
          {data.recent.map((o: any) => (
            <p key={o.id} className="px-4 py-2 text-sm flex justify-between"><span>{dayText(o.collect_by)}</span><span className="text-muted-foreground text-xs">{o.status === "driver" ? "on the driver run" : o.status}{o.created_by ? ` · ${o.created_by}` : ""}</span></p>
          ))}
        </div>
      )}
      {repCount > 0 && <button className="w-full text-center text-xs underline text-muted-foreground" onClick={() => setSetup(true)}>Reps &amp; produce</button>}
    </div>
  );
}
