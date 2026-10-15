// Supplier Invoices (v2): invoices from Xero or uploaded by hand, read by Claude.
// Phase 2: get invoices in and see what was read. Phase 3 adds line matching and approval.
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { apiRequest, queryClient, assetUrl } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Upload, RefreshCw, Link2, Unlink, FileText, AlertTriangle, CheckCircle2, Loader2, ExternalLink, Sparkles, Trash2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import InvoiceReview from "@/components/InvoiceReview";
import { cn } from "@/lib/utils";

type InvoiceRow = {
  id: number; source: "xero" | "upload"; supplier_id: number | null; detected_supplier_name: string | null;
  document_type: string | null; invoice_number: string | null; invoice_date: string | null;
  subtotal_ex_gst: number | null; gst: number | null; total_inc_gst: number | null;
  status: string; status_note: string | null; totals_check_ok: boolean | null; file_name: string | null;
  created_at: string; suppliers?: { name: string } | null; file_path: string | null; file_mime: string | null;
  xero_contact_name: string | null; xero_invoice_number: string | null; xero_date: string | null; xero_total: number | null;
};
type Line = {
  id: number; line_no: number; line_type: string; supplier_code: string | null; description: string; brand: string | null;
  quantity: number | null; purchase_unit: string | null; units_per_purchase: number | null; unit_size: number | null; unit_size_uom: string | null;
  priced_by_weight: boolean; unit_price_ex_gst: number | null; discount_ex_gst: number | null; line_total_ex_gst: number | null;
  gst_amount: number | null; base_qty: number | null; unit_cost: number | null; needs_pack_size: boolean; merged_from: number[] | null;
  status: string; notes: string | null;
};
type InvoiceDetail = InvoiceRow & { lines: Line[]; reader_notes: string | null; totals_check_note: string | null };
type XeroStatus = {
  configured: boolean; tokensStorable: boolean; redirectUri: string; connected: boolean; tenantName: string | null;
  lastSyncAt: string | null; lastSyncNote: string | null; syncFrom: string | null; syncing: boolean;
  otherBills: { xeroInvoiceId: string; contact: string; number: string | null; date: string | null; total: number | null }[];
};
type Summary = { counts: Record<string, number>; readerReady: boolean; filesStored: boolean; model: string };

const money = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `$${Number(n).toFixed(2)}`);
const dateLabel = (s: string | null) => (s ? new Date(`${s.slice(0, 10)}T12:00:00`).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" }) : "—");
const qty = (n: number | null) => (n === null ? "—" : Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000));

const STATUS: Record<string, { label: string; className: string }> = {
  new: { label: "Queued", className: "bg-slate-100 text-slate-700" },
  unread: { label: "Not read", className: "bg-violet-100 text-violet-800" },
  removed: { label: "Removed", className: "bg-slate-100 text-slate-400" },
  reading: { label: "Reading…", className: "bg-blue-100 text-blue-800" },
  needs_review: { label: "To review", className: "bg-amber-100 text-amber-900" },
  approved: { label: "Approved", className: "bg-emerald-100 text-emerald-800" },
  ignored: { label: "Ignored", className: "bg-slate-100 text-slate-500" },
  failed: { label: "Couldn't read", className: "bg-red-100 text-red-800" },
  duplicate: { label: "Duplicate", className: "bg-slate-100 text-slate-500" },
};

function packText(l: Line) {
  if (l.priced_by_weight) return "by weight";
  if (!l.unit_size_uom) return l.purchase_unit || "—";
  const size = l.unit_size && l.unit_size !== 1 ? `${qty(l.unit_size)}${l.unit_size_uom === "each" ? "" : l.unit_size_uom}` : l.unit_size_uom === "each" ? "" : `1${l.unit_size_uom}`;
  const per = l.units_per_purchase && l.units_per_purchase !== 1 ? `${qty(l.units_per_purchase)} × ` : "";
  return `${l.purchase_unit || ""} ${per}${size || (per ? "each" : "each")}`.trim();
}

export default function SupplierInvoices() {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const [filter, setFilter] = useState<"open" | "all">("open");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const toggle = (id: number) => setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const { data: invoices = [], refetch } = useQuery<InvoiceRow[]>({ queryKey: ["/api/supplier-invoices"] });
  const { data: summary } = useQuery<Summary>({ queryKey: ["/api/supplier-invoices-summary"] });
  const { data: xero, refetch: refetchXero } = useQuery<XeroStatus>({ queryKey: ["/api/xero-connection/status"] });
  const { data: detail } = useQuery<InvoiceDetail>({ queryKey: ["/api/supplier-invoices", String(openId)], enabled: openId !== null });

  // Keep refreshing while anything is being read
  const busy = invoices.some((i) => i.status === "reading" || i.status === "new");
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => {
      refetch();
      if (openId !== null) queryClient.invalidateQueries({ queryKey: ["/api/supplier-invoices", String(openId)] });
    }, 4000);
    return () => clearInterval(t);
  }, [busy, openId, refetch]);

  // Message after coming back from Xero sign-in
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("xero") === "connected") toast({ title: "Xero connected", description: "Press Check Xero now to pull in recent bills." });
    if (q.get("xero") === "error") toast({ title: "Xero sign-in didn't work", description: q.get("message") || "", variant: "destructive" });
    if (q.get("xero")) window.history.replaceState(null, "", `${window.location.pathname}#/supplier-invoices`);
  }, [toast]);

  const uploadFiles = async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (!list.length) return;
    setUploading(true);
    try {
      const fd = new FormData();
      list.forEach((f) => fd.append("files", f));
      const resp = await apiRequest("POST", "/api/supplier-invoices/upload", fd);
      const data = await resp.json();
      const dupes = data.results.filter((r: any) => r.status === "duplicate");
      const rejected = data.results.filter((r: any) => r.status === "rejected");
      toast({
        title: `${list.length - dupes.length - rejected.length} uploaded`,
        description: [dupes.length ? `${dupes.length} already in the app` : "", rejected.length ? `${rejected.length} not a PDF or photo` : "", "Reading takes about 20 to 40 seconds each."].filter(Boolean).join(". "),
      });
      refetch();
      queryClient.invalidateQueries({ queryKey: ["/api/supplier-invoices-summary"] });
    } catch (e: any) {
      toast({ title: "Upload failed", description: e.message, variant: "destructive" });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const checkXero = async () => {
    setSyncing(true);
    try {
      const resp = await apiRequest("POST", "/api/xero-connection/sync", {});
      const r = await resp.json();
      toast({ title: "Xero checked", description: `${r.pulledIn.length} new bill${r.pulledIn.length === 1 ? "" : "s"} waiting to be read${r.noDocument.length ? `, ${r.noDocument.length} without a document` : ""}. Open one to preview it, then Read or Remove.` });
      refetch(); refetchXero();
    } catch (e: any) {
      toast({ title: "Xero check failed", description: e.message, variant: "destructive" });
    } finally {
      setSyncing(false);
    }
  };

  const action = async (method: string, url: string, body?: any, ok?: string) => {
    try {
      await apiRequest(method, url, body);
      if (ok) toast({ title: ok });
      refetch(); refetchXero();
      if (openId !== null) queryClient.invalidateQueries({ queryKey: ["/api/supplier-invoices", String(openId)] });
    } catch (e: any) {
      toast({ title: "Something went wrong", description: e.message, variant: "destructive" });
    }
  };

  const shown = filter === "open" ? invoices.filter((i) => ["new", "unread", "reading", "needs_review", "failed"].includes(i.status)) : invoices;
  const selectedIds = Array.from(selected).filter((id) => shown.some((i) => i.id === id));
  const readMany = async (ids: number[]) => {
    await action("POST", "/api/supplier-invoices/read-many", { ids }, `Reading ${ids.length} invoice${ids.length === 1 ? "" : "s"}`);
    setSelected(new Set());
  };
  const removeMany = async (ids: number[]) => {
    if (!confirm(`Remove ${ids.length} invoice${ids.length === 1 ? "" : "s"}? The stored file is deleted and Xero won't pull it in again.`)) return;
    await action("POST", "/api/supplier-invoices/0/remove", { ids }, `Removed ${ids.length}`);
    setSelected(new Set());
    if (openId !== null && ids.includes(openId)) setOpenId(null);
  };

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Supplier invoices</h1>
        <p className="text-sm text-muted-foreground mt-1">Bills come in from Xero automatically, or drop PDFs and photos here. Each one is read and its prices checked before anything changes.</p>
      </div>

      {summary && !summary.readerReady && (
        <div className="flex gap-2 items-start rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>Invoices can't be read yet: add <code>ANTHROPIC_API_KEY</code> in Railway. You can still upload; press <b>Read again</b> once it's set.</span>
        </div>
      )}
      {summary && !summary.filesStored && (
        <div className="flex gap-2 items-start rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>Original files aren't being kept yet: add <code>SUPABASE_SERVICE_ROLE_KEY</code> in Railway.</span>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {/* Upload */}
        <Card
          className={cn("border-dashed transition-colors", dragOver && "border-primary bg-primary/5")}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); uploadFiles(e.dataTransfer.files); }}
        >
          <CardContent className="p-5 flex flex-col items-center text-center gap-3">
            <Upload size={22} className="text-muted-foreground" />
            <div>
              <div className="font-semibold">Upload invoices or receipts</div>
              <div className="text-sm text-muted-foreground">PDFs or photos. Drag them here or choose files. Several at once is fine.</div>
            </div>
            <input ref={fileRef} type="file" multiple accept="application/pdf,image/*" className="hidden" onChange={(e) => e.target.files && uploadFiles(e.target.files)} data-testid="input-invoice-files" />
            <Button onClick={() => fileRef.current?.click()} disabled={uploading} data-testid="button-upload-invoices">
              {uploading ? <><Loader2 size={15} className="mr-1 animate-spin" />Uploading…</> : <><Upload size={15} className="mr-1" />Choose files</>}
            </Button>
          </CardContent>
        </Card>

        {/* Xero */}
        <Card>
          <CardContent className="p-5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="font-semibold">Xero</div>
              {xero?.connected ? <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">Connected{xero.tenantName ? ` to ${xero.tenantName}` : ""}</Badge> : <Badge variant="outline">Not connected</Badge>}
            </div>
            {!xero?.configured ? (
              <p className="text-sm text-muted-foreground">Needs a one-off setup: add <code>XERO_CLIENT_ID</code> and <code>XERO_CLIENT_SECRET</code> in Railway. Redirect URI to use in the Xero app: <code className="break-all">{xero?.redirectUri}</code></p>
            ) : !xero?.connected ? (
              <>
                <p className="text-sm text-muted-foreground">Sign in once and the app checks for new supplier bills every hour.</p>
                <Button asChild data-testid="button-connect-xero"><a href={assetUrl("/api/xero-connection/connect")}><Link2 size={15} className="mr-1" />Connect Xero</a></Button>
              </>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  Last checked {xero.lastSyncAt ? new Date(xero.lastSyncAt).toLocaleString("en-AU", { timeZone: "Australia/Perth", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "never"}
                  {xero.lastSyncNote ? `: ${xero.lastSyncNote}` : ""}. Pulling in bills dated from {dateLabel(xero.syncFrom)}.
                </p>
                <div className="flex gap-2 flex-wrap">
                  <Button onClick={checkXero} disabled={syncing || xero.syncing} data-testid="button-check-xero">
                    <RefreshCw size={15} className={cn("mr-1", (syncing || xero.syncing) && "animate-spin")} />{syncing || xero.syncing ? "Checking…" : "Check Xero now"}
                  </Button>
                  <Button variant="ghost" onClick={() => { if (confirm("Disconnect Xero? Bills will stop coming in until you connect again.")) action("POST", "/api/xero-connection/disconnect", {}, "Xero disconnected"); }}>
                    <Unlink size={15} className="mr-1" />Disconnect
                  </Button>
                </div>
                {xero.otherBills.length > 0 && (
                  <details className="text-sm">
                    <summary className="cursor-pointer text-muted-foreground">{xero.otherBills.length} bill{xero.otherBills.length === 1 ? "" : "s"} from contacts that aren't suppliers here (rent, power etc.)</summary>
                    <ul className="mt-2 space-y-1 max-h-48 overflow-auto">
                      {xero.otherBills.map((b) => (
                        <li key={b.xeroInvoiceId} className="flex items-center justify-between gap-2">
                          <span className="truncate">{b.contact} · {b.number || "no number"} · {dateLabel(b.date)} · {money(b.total)}</span>
                          <Button size="sm" variant="outline" className="h-7" onClick={() => action("POST", `/api/xero-connection/pull/${b.xeroInvoiceId}`, {}, "Pulled in")}>Pull in</Button>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* List */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1">
          <Button size="sm" variant={filter === "open" ? "default" : "ghost"} onClick={() => setFilter("open")}>To do{summary ? ` (${(summary.counts.needs_review || 0) + (summary.counts.failed || 0) + (summary.counts.reading || 0) + (summary.counts.new || 0) + (summary.counts.unread || 0)})` : ""}</Button>
          <Button size="sm" variant={filter === "all" ? "default" : "ghost"} onClick={() => setFilter("all")}>All</Button>
        </div>
        <div className="flex items-center gap-2">
          {busy && <span className="text-sm text-muted-foreground flex items-center gap-1"><Loader2 size={14} className="animate-spin" />Reading…</span>}
          {selectedIds.length > 0 && (
            <>
              <Button size="sm" onClick={() => readMany(selectedIds)} data-testid="button-read-selected"><Sparkles size={14} className="mr-1" />Read {selectedIds.length}</Button>
              <Button size="sm" variant="outline" onClick={() => removeMany(selectedIds)} data-testid="button-remove-selected"><Trash2 size={14} className="mr-1" />Remove {selectedIds.length}</Button>
            </>
          )}
        </div>
      </div>

      <div className="rounded-md border divide-y bg-card">
        {shown.length === 0 && <div className="p-6 text-center text-sm text-muted-foreground">{filter === "open" ? "Nothing to do. New invoices will appear here." : "No invoices yet."}</div>}
        {shown.map((inv) => {
          const st = STATUS[inv.status] || { label: inv.status, className: "" };
          return (
            <div key={inv.id} onClick={() => setOpenId(inv.id)} className="w-full text-left p-3 hover:bg-muted/50 flex items-center gap-3 cursor-pointer" data-testid={`row-invoice-${inv.id}`}>
              {inv.status !== "approved" && inv.status !== "removed" ? (
                <span onClick={(e) => e.stopPropagation()}><Checkbox checked={selected.has(inv.id)} onCheckedChange={() => toggle(inv.id)} aria-label="Select" /></span>
              ) : <FileText size={18} className="text-muted-foreground shrink-0" />}
              <div className="min-w-0 flex-1">
                <div className="font-medium truncate">
                  {inv.suppliers?.name || inv.detected_supplier_name || inv.xero_contact_name || inv.file_name || "Reading…"}
                  {(inv.invoice_number || inv.xero_invoice_number) && <span className="text-muted-foreground font-normal"> · {inv.invoice_number || inv.xero_invoice_number}</span>}
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  {dateLabel(inv.invoice_date || inv.xero_date)} · {inv.source === "xero" ? "from Xero" : "uploaded"}{inv.status_note ? ` · ${inv.status_note}` : ""}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="font-medium tabular-nums">{money(inv.total_inc_gst ?? inv.xero_total)}</div>
                {inv.totals_check_ok === false && <div className="text-xs text-red-700">totals don't add up</div>}
              </div>
              {inv.status === "unread" && (
                <div className="flex gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                  <Button size="sm" className="h-7" onClick={() => readMany([inv.id])}>Read</Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7" title="Remove" onClick={() => removeMany([inv.id])}><Trash2 size={14} /></Button>
                </div>
              )}
              <span className={cn("text-xs px-2 py-1 rounded-full shrink-0", st.className)}>{st.label}</span>
            </div>
          );
        })}
      </div>

      {/* Detail */}
      <Sheet open={openId !== null} onOpenChange={(o) => !o && setOpenId(null)}>
        <SheetContent side="right" className="w-full sm:max-w-3xl overflow-y-auto">
          {detail && (
            <>
              <SheetHeader>
                <SheetTitle>{detail.suppliers?.name || detail.detected_supplier_name || detail.xero_contact_name || "Unknown supplier"}{(detail.invoice_number || detail.xero_invoice_number) ? ` · ${detail.invoice_number || detail.xero_invoice_number}` : ""}</SheetTitle>
              </SheetHeader>
              <div className="mt-3 space-y-3 text-sm">
                {detail.status === "unread" && (
                  <div className="rounded-md border border-violet-200 bg-violet-50 p-3 flex flex-wrap items-center gap-2 justify-between">
                    <span className="text-violet-900">From Xero, not read yet. {dateLabel(detail.xero_date)} · {money(detail.xero_total)} inc GST. Is it worth pulling the prices from?</span>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => readMany([detail.id])} data-testid="button-read-invoice"><Sparkles size={14} className="mr-1" />Read this invoice</Button>
                      <Button size="sm" variant="outline" onClick={() => removeMany([detail.id])} data-testid="button-remove-invoice"><Trash2 size={14} className="mr-1" />Remove</Button>
                    </div>
                  </div>
                )}
                {detail.file_path && (
                  <div className="rounded-md border bg-muted/30 overflow-hidden">
                    {detail.file_mime === "application/pdf" ? (
                      <iframe title="Invoice" src={assetUrl(`/api/supplier-invoices/${detail.id}/file`)} className="w-full h-[60vh] bg-white" />
                    ) : (
                      <img alt="Invoice" src={assetUrl(`/api/supplier-invoices/${detail.id}/file`)} className="w-full max-h-[70vh] object-contain bg-white" />
                    )}
                  </div>
                )}
                {detail.status !== "unread" && (
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
                  <span>{dateLabel(detail.invoice_date)}</span>
                  <span>Ex GST {money(detail.subtotal_ex_gst)}</span>
                  <span>GST {money(detail.gst)}</span>
                  <span>Total {money(detail.total_inc_gst)}</span>
                  {detail.document_type && detail.document_type !== "invoice" && <span>{detail.document_type.replace("_", " ")}</span>}
                </div>
                )}

                {detail.totals_check_ok === true && <div className="flex items-center gap-1 text-emerald-700"><CheckCircle2 size={15} />Lines add up to the invoice total.</div>}
                {detail.totals_check_ok === false && <div className="flex items-center gap-1 text-red-700"><AlertTriangle size={15} />{detail.totals_check_note}</div>}
                {detail.status_note && detail.totals_check_ok !== false && <div className="text-muted-foreground">{detail.status_note}</div>}
                {detail.reader_notes && <div className="text-muted-foreground italic">Reader: {detail.reader_notes}</div>}

                <div className="flex gap-2 flex-wrap">
                  {detail.file_path && <Button size="sm" variant="outline" asChild><a href={assetUrl(`/api/supplier-invoices/${detail.id}/file`)} target="_blank" rel="noreferrer"><ExternalLink size={14} className="mr-1" />Open original</a></Button>}
                  {!["approved", "unread", "removed"].includes(detail.status) && detail.file_path && <Button size="sm" variant="outline" onClick={() => action("POST", `/api/supplier-invoices/${detail.id}/reread`, {}, "Reading again")}><RefreshCw size={14} className="mr-1" />Read again</Button>}
                  {!["approved", "unread", "removed"].includes(detail.status) && <Button size="sm" variant="ghost" onClick={() => removeMany([detail.id])}><Trash2 size={14} className="mr-1" />Remove</Button>}
                </div>

                {detail.status === "needs_review" ? (
                  <InvoiceReview
                    invoice={detail}
                    lines={detail.lines as any}
                    onChanged={() => { refetch(); queryClient.invalidateQueries({ queryKey: ["/api/supplier-invoices", String(detail.id)] }); queryClient.invalidateQueries({ queryKey: ["/api/supplier-invoices-summary"] }); queryClient.invalidateQueries({ queryKey: ["/api/ingredients"] }); }}
                  />
                ) : detail.status === "unread" ? null : detail.status === "reading" ? (
                  <div className="flex items-center gap-2 text-muted-foreground py-8 justify-center"><Loader2 size={16} className="animate-spin" />Reading this invoice…</div>
                ) : (
                  <div className="overflow-x-auto rounded-md border">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/50 text-muted-foreground">
                        <tr>
                          <th className="text-left p-2">Item</th>
                          <th className="text-right p-2">Qty</th>
                          <th className="text-left p-2">Pack</th>
                          <th className="text-right p-2">Total ex GST</th>
                          <th className="text-right p-2">Unit cost</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {detail.lines.map((l) => (
                          <tr key={l.id} className={cn(l.line_type !== "product" && "text-muted-foreground")}>
                            <td className="p-2">
                              <div className="font-medium">{l.description}</div>
                              <div className="text-muted-foreground">
                                {[l.supplier_code, l.brand, l.line_type !== "product" ? l.line_type : null, l.discount_ex_gst ? `less ${money(l.discount_ex_gst)} discount` : null, (l.merged_from?.length || 0) > 1 ? `${l.merged_from!.length} lines combined` : null].filter(Boolean).join(" · ")}
                              </div>
                              {l.notes && <div className="text-amber-800">{l.notes}</div>}
                            </td>
                            <td className="p-2 text-right tabular-nums">{qty(l.quantity)}{l.priced_by_weight ? " kg" : ""}</td>
                            <td className="p-2">{packText(l)}</td>
                            <td className="p-2 text-right tabular-nums">{money(l.line_total_ex_gst)}</td>
                            <td className="p-2 text-right tabular-nums">
                              {l.unit_cost !== null ? `${money(l.unit_cost)}/${l.priced_by_weight ? "kg" : l.unit_size_uom === "each" ? "ea" : l.unit_size_uom}` : l.needs_pack_size ? <span className="text-amber-800">pack size?</span> : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
