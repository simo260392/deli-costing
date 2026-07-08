import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Plus, Pencil, Trash2, Truck, Phone, Mail, User, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

type Supplier = {
  id: number; name: string; contactName?: string; email?: string; phone?: string; notes?: string;
  how_to_order?: string; order_contact?: string; order_cutoff?: string;
  min_order_amount?: number; delivery_days?: string;
};

type CheapestItem = {
  ingredientId: number;
  ingredientName: string;
  unit: string;
  costPerUnit: number;
  invoiceDate: string | null;
  packSize: number | null;
};

const empty = { name: "", contactName: "", email: "", phone: "", notes: "", how_to_order: "email", order_contact: "", order_cutoff: "", min_order_amount: "" as any, delivery_days: "" };

export default function Suppliers() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [form, setForm] = useState(empty);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const { data: suppliers = [], isLoading } = useQuery<Supplier[]>({
    queryKey: ["/api/suppliers"],
    queryFn: () => apiRequest("GET", "/api/suppliers").then((r) => r.json()),
  });

  const { data: supplierIngredients = [] } = useQuery({
    queryKey: ["/api/supplier-ingredients"],
    queryFn: () => apiRequest("GET", "/api/supplier-ingredients").then((r) => r.json()),
  });

  const { data: cheapestItems = [], isLoading: cheapestLoading } = useQuery<CheapestItem[]>({
    queryKey: ["/api/suppliers", expandedId, "cheapest-items"],
    queryFn: () =>
      expandedId
        ? apiRequest("GET", `/api/suppliers/${expandedId}/cheapest-items`).then((r) => r.json())
        : Promise.resolve([]),
    enabled: expandedId !== null,
  });

  const ingCount = (supplierId: number) =>
    supplierIngredients.filter((si: any) => si.supplierId === supplierId).length;

  const upsert = useMutation({
    mutationFn: (data: typeof form) => {
      const payload = { ...data, min_order_amount: data.min_order_amount ? Number(data.min_order_amount) : null, delivery_days: JSON.stringify((data.delivery_days || '').split(',').map((d: string) => d.trim()).filter(Boolean)) };
      return editing
        ? apiRequest("PUT", `/api/suppliers/${editing.id}`, payload).then((r) => r.json())
        : apiRequest("POST", "/api/suppliers", payload).then((r) => r.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/suppliers"] });
      setOpen(false);
      setEditing(null);
      setForm(empty);
      toast({ title: editing ? "Supplier updated" : "Supplier added" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const del = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/suppliers/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/suppliers"] });
      toast({ title: "Supplier removed" });
    },
  });

  const openNew = () => { setEditing(null); setForm(empty); setOpen(true); };
  const openEdit = (s: Supplier) => { setEditing(s); setForm({ ...empty, ...s, min_order_amount: s.min_order_amount ?? '' as any, delivery_days: (() => { try { const d = JSON.parse(s.delivery_days || '[]'); return d.join(', '); } catch { return ''; } })() } as any); setOpen(true); };

  const toggleExpanded = (id: number) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  return (
    <div className="p-6 space-y-6 max-w-screen-lg">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Suppliers</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage your suppliers and view their ingredient pricing. Click a card to see cheapest items.</p>
        </div>
        <Button onClick={openNew} data-testid="button-add-supplier" size="sm">
          <Plus size={15} className="mr-1" /> Add Supplier
        </Button>
      </div>

      {isLoading ? (
        <div className="grid md:grid-cols-2 gap-4">{[1, 2, 3].map((i) => <div key={i} className="skeleton h-36 rounded-lg" />)}</div>
      ) : suppliers.length === 0 ? (
        <Card className="p-10 text-center">
          <Truck size={36} className="mx-auto mb-3 text-muted-foreground" />
          <p className="font-medium">No suppliers yet</p>
          <p className="text-sm text-muted-foreground mt-1">Add your first supplier to start tracking ingredient pricing.</p>
          <Button onClick={openNew} className="mt-4" size="sm"><Plus size={14} className="mr-1" /> Add Supplier</Button>
        </Card>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {suppliers.map((s) => {
            const isExpanded = expandedId === s.id;
            return (
              <div key={s.id} className="flex flex-col">
                <Card
                  className={cn("cursor-pointer transition-all", isExpanded ? "ring-2 ring-primary/30" : "hover:ring-1 hover:ring-primary/20")}
                  data-testid={`card-supplier-${s.id}`}
                  onClick={() => toggleExpanded(s.id)}
                >
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                          <Truck size={14} className="text-primary" />
                        </div>
                        <div>
                          <CardTitle className="text-base">{s.name}</CardTitle>
                          <Badge variant="outline" className="text-xs mt-1">{ingCount(s.id)} ingredient price{ingCount(s.id) !== 1 ? "s" : ""}</Badge>
                        </div>
                      </div>
                      <div className="flex gap-1 items-center">
                        <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); openEdit(s); }} className="h-7 w-7" data-testid={`button-edit-supplier-${s.id}`}>
                          <Pencil size={13} />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); del.mutate(s.id); }} className="h-7 w-7 text-destructive hover:text-destructive" data-testid={`button-delete-supplier-${s.id}`}>
                          <Trash2 size={13} />
                        </Button>
                        {isExpanded ? <ChevronUp size={14} className="text-muted-foreground ml-1" /> : <ChevronDown size={14} className="text-muted-foreground ml-1" />}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="text-sm space-y-1">
                    {s.contactName && <p className="flex items-center gap-2 text-muted-foreground"><User size={12} />{s.contactName}</p>}
                    {s.phone && <p className="flex items-center gap-2 text-muted-foreground"><Phone size={12} />{s.phone}</p>}
                    {s.email && <p className="flex items-center gap-2 text-muted-foreground"><Mail size={12} />{s.email}</p>}
                    {s.notes && <p className="text-muted-foreground text-xs mt-2">{s.notes}</p>}
                    {(s.how_to_order || s.order_contact || s.order_cutoff || s.min_order_amount) && (
                      <div className="mt-2 pt-2 border-t border-dashed flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                        {s.how_to_order && <span>Order via: <strong className="capitalize">{s.how_to_order}</strong></span>}
                        {s.order_contact && <span>{s.order_contact}</span>}
                        {s.order_cutoff && <span className="text-amber-700">Cut-off: {s.order_cutoff}</span>}
                        {s.min_order_amount && <span>Min: ${s.min_order_amount}</span>}
                        {s.delivery_days && (() => { try { const d = JSON.parse(s.delivery_days); return d.length > 0 ? <span>Delivers: {d.join(', ')}</span> : null; } catch { return null; } })()}
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Cheapest items panel */}
                {isExpanded && (
                  <div className="border border-t-0 border-primary/20 rounded-b-lg bg-primary/5 px-4 py-3">
                    <p className="text-xs font-semibold text-primary mb-2 uppercase tracking-wider">
                      Cheapest items from {s.name}
                    </p>
                    {cheapestLoading ? (
                      <p className="text-xs text-muted-foreground">Loading…</p>
                    ) : cheapestItems.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No cheapest items found. Add supplier prices to ingredients to see comparisons.</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b border-primary/10">
                              <th className="text-left py-1 pr-3 font-semibold text-muted-foreground">Ingredient</th>
                              <th className="text-left py-1 pr-3 font-semibold text-muted-foreground">Unit</th>
                              <th className="text-right py-1 pr-3 font-semibold text-muted-foreground">Cost/Unit</th>
                              <th className="text-right py-1 pr-3 font-semibold text-muted-foreground">Pack Size</th>
                              <th className="text-left py-1 font-semibold text-muted-foreground">Invoice Date</th>
                            </tr>
                          </thead>
                          <tbody>
                            {cheapestItems.map((item) => (
                              <tr key={item.ingredientId} className="border-b border-primary/10 last:border-0">
                                <td className="py-1 pr-3 font-medium">{item.ingredientName}</td>
                                <td className="py-1 pr-3 text-muted-foreground">{item.unit}</td>
                                <td className="py-1 pr-3 text-right tabular-nums font-semibold text-primary">${item.costPerUnit.toFixed(4)}</td>
                                <td className="py-1 pr-3 text-right tabular-nums text-muted-foreground">{item.packSize ?? "—"}</td>
                                <td className="py-1 text-muted-foreground">{item.invoiceDate ?? "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Supplier" : "Add Supplier"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Supplier Name *</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Bidvest Foodservice" data-testid="input-supplier-name" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Contact Name</Label>
                <Input value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} placeholder="John Smith" />
              </div>
              <div className="space-y-1.5">
                <Label>Phone</Label>
                <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="08 9000 0000" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="orders@supplier.com" />
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Order terms, minimums, etc." rows={2} />
            </div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mt-1">Ordering Details</p>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">How to order</label>
              <select value={form.how_to_order || "email"} onChange={e => setForm({ ...form, how_to_order: e.target.value })}
                className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#256984]">
                {["email","online","phone","text"].map(v => <option key={v} value={v} className="capitalize">{v.charAt(0).toUpperCase()+v.slice(1)}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Order contact (email / phone / URL)</label>
              <Input value={form.order_contact || ""} onChange={e => setForm({ ...form, order_contact: e.target.value })} placeholder="orders@supplier.com or 08 9000 0000" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Order cut-off time</label>
                <Input value={form.order_cutoff || ""} onChange={e => setForm({ ...form, order_cutoff: e.target.value })} placeholder="e.g. 3pm Tuesday" />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Min order ($)</label>
                <Input type="number" value={form.min_order_amount || ""} onChange={e => setForm({ ...form, min_order_amount: e.target.value as any })} placeholder="0" />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Delivery days (comma separated)</label>
              <Input value={form.delivery_days || ""} onChange={e => setForm({ ...form, delivery_days: e.target.value })} placeholder="Mon, Wed, Fri" />
            </div>
            <div className="hidden">
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => upsert.mutate(form)} disabled={!form.name || upsert.isPending} data-testid="button-save-supplier">
              {upsert.isPending ? "Saving…" : editing ? "Update" : "Add Supplier"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
