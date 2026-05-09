import { useQuery, useMutation } from "@tanstack/react-query";
import { useState, useRef } from "react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Upload, FileText, Trash2, Eye, Calendar, Hash } from "lucide-react";

type Invoice = {
  id: number; supplierId?: number; supplierName?: string; filename: string;
  uploadedAt: string; invoiceDate?: string; invoiceRef?: string;
  lineItemsJson: string; notes?: string;
};

export default function Invoices() {
  const { toast } = useToast();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [viewOpen, setViewOpen] = useState(false);
  const [viewInvoice, setViewInvoice] = useState<Invoice | null>(null);
  const [uploadForm, setUploadForm] = useState({ supplierId: "", invoiceDate: "", invoiceRef: "", notes: "" });
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: invoices = [], isLoading } = useQuery<Invoice[]>({
    queryKey: ["/api/invoices"],
    queryFn: () => apiRequest("GET", "/api/invoices").then((r) => r.json()),
  });

  const { data: suppliers = [] } = useQuery<any[]>({
    queryKey: ["/api/suppliers"],
    queryFn: () => apiRequest("GET", "/api/suppliers").then((r) => r.json()),
  });

  const doUpload = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("No file selected");
      const fd = new FormData();
      fd.append("file", file);
      if (uploadForm.supplierId) fd.append("supplierId", uploadForm.supplierId);
      if (uploadForm.invoiceDate) fd.append("invoiceDate", uploadForm.invoiceDate);
      if (uploadForm.invoiceRef) fd.append("invoiceRef", uploadForm.invoiceRef);
      if (uploadForm.notes) fd.append("notes", uploadForm.notes);
      const API_BASE = "__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__";
      const res = await fetch(`${API_BASE}/api/invoices/upload`, { method: "POST", body: fd });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      setUploadOpen(false);
      setFile(null);
      setUploadForm({ supplierId: "", invoiceDate: "", invoiceRef: "", notes: "" });
      toast({ title: "Invoice uploaded" });
    },
    onError: (e: any) => toast({ title: "Upload failed", description: e.message, variant: "destructive" }),
  });

  const del = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/invoices/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/invoices"] }); toast({ title: "Invoice deleted" }); },
  });

  const formatDate = (d: string) => {
    try { return new Date(d).toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "numeric" }); } catch { return d; }
  };

  return (
    <div className="p-6 space-y-5 max-w-screen-lg">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Invoices</h1>
          <p className="text-sm text-muted-foreground mt-1">Upload supplier invoices and costing sheets to extract line item data.</p>
        </div>
        <Button onClick={() => setUploadOpen(true)} size="sm" data-testid="button-upload-invoice">
          <Upload size={15} className="mr-1" /> Upload Invoice
        </Button>
      </div>

      {/* Info card */}
      <Card className="bg-primary/5 border-primary/20">
        <CardContent className="pt-4 pb-4">
          <p className="text-sm text-foreground font-medium mb-1">How to use invoices</p>
          <p className="text-sm text-muted-foreground">
            Upload PDF or image invoices from suppliers. The system will attempt to extract line items automatically.
            You can then manually link line items to ingredients in the Ingredients page and update supplier pricing.
          </p>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="space-y-2">{[1,2,3].map((i) => <div key={i} className="skeleton h-16 rounded-lg" />)}</div>
      ) : invoices.length === 0 ? (
        <Card className="p-10 text-center">
          <FileText size={36} className="mx-auto mb-3 text-muted-foreground" />
          <p className="font-medium">No invoices uploaded</p>
          <p className="text-sm text-muted-foreground mt-1">Upload your first supplier invoice to get started.</p>
          <Button onClick={() => setUploadOpen(true)} className="mt-4" size="sm"><Upload size={14} className="mr-1" /> Upload Invoice</Button>
        </Card>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/60">
              <tr className="border-b border-border">
                <th className="text-left px-4 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wider">Filename</th>
                <th className="text-left px-4 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wider">Supplier</th>
                <th className="text-left px-4 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wider">Invoice Date</th>
                <th className="text-left px-4 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wider">Ref</th>
                <th className="text-left px-4 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wider">Uploaded</th>
                <th className="text-left px-4 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wider">Lines</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => {
                const lines = JSON.parse(inv.lineItemsJson || "[]");
                return (
                  <tr key={inv.id} className="border-b border-border last:border-0 hover:bg-muted/30" data-testid={`row-invoice-${inv.id}`}>
                    <td className="px-4 py-3 font-medium flex items-center gap-2">
                      <FileText size={14} className="text-muted-foreground shrink-0" />{inv.filename}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{inv.supplierName || "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">{inv.invoiceDate ? formatDate(inv.invoiceDate) : "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">{inv.invoiceRef || "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">{formatDate(inv.uploadedAt)}</td>
                    <td className="px-4 py-3">
                      <Badge variant="outline" className="text-xs">{lines.length} line{lines.length !== 1 ? "s" : ""}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        {lines.length > 0 && (
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setViewInvoice(inv); setViewOpen(true); }} data-testid={`button-view-invoice-${inv.id}`}>
                            <Eye size={13} />
                          </Button>
                        )}
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => del.mutate(inv.id)} data-testid={`button-delete-invoice-${inv.id}`}>
                          <Trash2 size={13} />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Upload Dialog */}
      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Upload Invoice</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>File (PDF, PNG, JPG)</Label>
              <div
                className="border-2 border-dashed border-border rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 transition-colors"
                onClick={() => fileRef.current?.click()}
                data-testid="dropzone-invoice"
              >
                <Upload size={24} className="mx-auto mb-2 text-muted-foreground" />
                {file ? (
                  <p className="text-sm font-medium text-foreground">{file.name}</p>
                ) : (
                  <p className="text-sm text-muted-foreground">Click to choose file</p>
                )}
                <input ref={fileRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.csv" className="hidden"
                  onChange={(e) => setFile(e.target.files?.[0] || null)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Supplier (optional)</Label>
              <Select value={uploadForm.supplierId} onValueChange={(v) => setUploadForm({ ...uploadForm, supplierId: v })}>
                <SelectTrigger><SelectValue placeholder="Select supplier…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Unknown / Not listed</SelectItem>
                  {suppliers.map((s: any) => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Invoice Date</Label>
                <Input type="date" value={uploadForm.invoiceDate} onChange={(e) => setUploadForm({ ...uploadForm, invoiceDate: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Invoice Ref</Label>
                <Input value={uploadForm.invoiceRef} onChange={(e) => setUploadForm({ ...uploadForm, invoiceRef: e.target.value })} placeholder="INV-0001" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUploadOpen(false)}>Cancel</Button>
            <Button onClick={() => doUpload.mutate()} disabled={!file || doUpload.isPending} data-testid="button-confirm-upload">
              {doUpload.isPending ? "Uploading…" : "Upload"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View Lines Dialog */}
      <Dialog open={viewOpen} onOpenChange={setViewOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Invoice Lines — {viewInvoice?.filename}</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <p className="text-xs text-muted-foreground mb-3">
              Raw lines extracted from the PDF. Use this data to manually enter ingredient prices in the Ingredients page.
            </p>
            <div className="rounded-lg border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/60">
                  <tr className="border-b border-border">
                    <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground uppercase">#</th>
                    <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground uppercase">Line Text</th>
                  </tr>
                </thead>
                <tbody>
                  {viewInvoice && (JSON.parse(viewInvoice.lineItemsJson || "[]") as any[]).map((line: any, i: number) => (
                    <tr key={i} className="border-b border-border last:border-0">
                      <td className="px-3 py-2 text-muted-foreground text-xs tabular-nums">{i + 1}</td>
                      <td className="px-3 py-2 font-mono text-xs">{line.rawText || JSON.stringify(line)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
