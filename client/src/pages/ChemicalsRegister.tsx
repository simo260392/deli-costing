import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FlaskConical, Pencil, ExternalLink, Plus, FileDown } from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

type Chemical = {
  id: number;
  product_name: string;
  chemform_product_code: string | null;
  supplier: string | null;
  supplier_url: string | null;
  category: string;
  food_contact_safe: boolean;
  no_rinse: boolean;
  ghs_hazard_class: string | null;
  dilution_instructions: string | null;
  storage_location: string | null;
  areas_of_use: string | null;
  sds_url: string | null;
  info_sheet_url: string | null;
  sds_date: string | null;
  last_reviewed: string | null;
  notes: string | null;
  active: boolean;
};

type ChemicalFormData = Omit<Chemical, "id" | "active">;

// ─── Constants ───────────────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<string, string> = {
  sanitiser: "Sanitiser",
  disinfectant: "Disinfectant",
  surface_cleaner: "Surface Cleaner",
  floor_cleaner: "Floor Cleaner",
  glass_cleaner: "Glass & Chrome Cleaner",
  hand_hygiene: "Hand Hygiene",
  dishwashing_manual: "Manual Dishwashing",
  dishwashing_machine: "Machine Dishwashing",
  rinse_aid: "Rinse Aid",
  oven_grill_cleaner: "Oven & Grill Cleaner",
  powder_cleaner: "Powder Cleaner",
  other: "Other",
};

const CATEGORY_KEYS = Object.keys(CATEGORY_LABELS);

const EMPTY_FORM: ChemicalFormData = {
  product_name: "",
  chemform_product_code: null,
  supplier: null,
  supplier_url: null,
  category: "sanitiser",
  food_contact_safe: false,
  no_rinse: false,
  ghs_hazard_class: null,
  dilution_instructions: null,
  storage_location: null,
  areas_of_use: null,
  sds_url: null,
  info_sheet_url: null,
  sds_date: null,
  last_reviewed: null,
  notes: null,
};

// ─── Modal component ─────────────────────────────────────────────────────────

function ChemicalModal({
  open,
  onClose,
  chemical,
}: {
  open: boolean;
  onClose: () => void;
  chemical: Chemical | null;
}) {
  const { toast } = useToast();
  const isEdit = !!chemical;

  const [form, setForm] = useState<ChemicalFormData>(() =>
    chemical
      ? {
          product_name: chemical.product_name,
          chemform_product_code: chemical.chemform_product_code,
          supplier: chemical.supplier,
          supplier_url: chemical.supplier_url,
          category: chemical.category,
          food_contact_safe: chemical.food_contact_safe,
          no_rinse: chemical.no_rinse,
          ghs_hazard_class: chemical.ghs_hazard_class,
          dilution_instructions: chemical.dilution_instructions,
          storage_location: chemical.storage_location,
          areas_of_use: chemical.areas_of_use,
          sds_url: chemical.sds_url,
          info_sheet_url: chemical.info_sheet_url,
          sds_date: chemical.sds_date,
          last_reviewed: chemical.last_reviewed,
          notes: chemical.notes,
        }
      : { ...EMPTY_FORM }
  );

  // Reset form whenever the chemical prop changes (covers switching between edit targets)
  useEffect(() => {
    if (open) {
      setForm(
        chemical
          ? {
              product_name: chemical.product_name,
              chemform_product_code: chemical.chemform_product_code ?? null,
              supplier: chemical.supplier,
              supplier_url: chemical.supplier_url ?? null,
              category: chemical.category,
              food_contact_safe: chemical.food_contact_safe,
              no_rinse: chemical.no_rinse,
              ghs_hazard_class: chemical.ghs_hazard_class ?? null,
              dilution_instructions: chemical.dilution_instructions ?? null,
              storage_location: chemical.storage_location ?? null,
              areas_of_use: chemical.areas_of_use ?? null,
              sds_url: chemical.sds_url ?? null,
              info_sheet_url: chemical.info_sheet_url ?? null,
              sds_date: chemical.sds_date ?? null,
              last_reviewed: chemical.last_reviewed ?? null,
              notes: chemical.notes ?? null,
            }
          : { ...EMPTY_FORM }
      );
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chemical, open]);

  // handleOpen kept for Dialog onOpenChange
  const handleOpen = (o: boolean) => {
    if (!o) onClose();
  };

  const setField = (key: keyof ChemicalFormData, value: any) =>
    setForm((f) => ({ ...f, [key]: value || null }));

  const setStr = (key: keyof ChemicalFormData) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setField(key, e.target.value || null);

  const saveMutation = useMutation({
    mutationFn: async (data: ChemicalFormData) => {
      if (isEdit && chemical) {
        return apiRequest("PUT", `/api/compliance/chemicals/${chemical.id}`, data).then((r) =>
          r.json()
        );
      }
      return apiRequest("POST", "/api/compliance/chemicals", data).then((r) => r.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chemicals"] });
      toast({ title: isEdit ? "Chemical updated" : "Chemical added" });
      onClose();
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!chemical) return;
      return apiRequest("DELETE", `/api/compliance/chemicals/${chemical.id}`).then((r) =>
        r.json()
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chemicals"] });
      toast({ title: "Chemical removed from register" });
      onClose();
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleDelete = () => {
    if (window.confirm(`Remove "${chemical?.product_name}" from the register?`)) {
      deleteMutation.mutate();
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.product_name?.trim()) {
      toast({ title: "Product name is required", variant: "destructive" });
      return;
    }
    saveMutation.mutate(form);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { handleOpen(o); if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Chemical" : "Add Chemical"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Product name */}
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="product_name">Product name *</Label>
              <Input
                id="product_name"
                value={form.product_name || ""}
                onChange={(e) => setForm((f) => ({ ...f, product_name: e.target.value }))}
                placeholder="e.g. Sanitiser Pro 500"
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="chemform_product_code">Chemform product code</Label>
              <Input
                id="chemform_product_code"
                value={form.chemform_product_code || ""}
                onChange={setStr("chemform_product_code")}
                placeholder="e.g. CF-1234"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="category">Category</Label>
              <Select
                value={form.category || "sanitiser"}
                onValueChange={(v) => setField("category", v)}
              >
                <SelectTrigger id="category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORY_KEYS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {CATEGORY_LABELS[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Booleans */}
          <div className="flex gap-6">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={!!form.food_contact_safe}
                onChange={(e) => setForm((f) => ({ ...f, food_contact_safe: e.target.checked }))}
                className="h-4 w-4 rounded border-gray-300"
              />
              <span className="text-sm font-medium">Food contact safe</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={!!form.no_rinse}
                onChange={(e) => setForm((f) => ({ ...f, no_rinse: e.target.checked }))}
                className="h-4 w-4 rounded border-gray-300"
              />
              <span className="text-sm font-medium">No rinse required</span>
            </label>
          </div>

          {/* GHS */}
          <div className="space-y-1.5">
            <Label htmlFor="ghs_hazard_class">GHS hazard class (optional)</Label>
            <Input
              id="ghs_hazard_class"
              value={form.ghs_hazard_class || ""}
              onChange={setStr("ghs_hazard_class")}
              placeholder="e.g. Flammable Liquid Cat. 3"
            />
          </div>

          {/* Areas of use */}
          <div className="space-y-1.5">
            <Label htmlFor="areas_of_use">Areas of use</Label>
            <Input
              id="areas_of_use"
              value={form.areas_of_use || ""}
              onChange={setStr("areas_of_use")}
              placeholder="e.g. Food prep surfaces, benchtops"
            />
          </div>

          {/* Storage location */}
          <div className="space-y-1.5">
            <Label htmlFor="storage_location">Storage location</Label>
            <Input
              id="storage_location"
              value={form.storage_location || ""}
              onChange={setStr("storage_location")}
              placeholder="e.g. Chemical store, shelf A"
            />
          </div>

          {/* Dilution instructions */}
          <div className="space-y-1.5">
            <Label htmlFor="dilution_instructions">Dilution instructions</Label>
            <Textarea
              id="dilution_instructions"
              value={form.dilution_instructions || ""}
              onChange={setStr("dilution_instructions")}
              rows={2}
              placeholder="e.g. 1:100 dilution with water"
            />
          </div>

          {/* URLs */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="sds_url">SDS URL</Label>
              <Input
                id="sds_url"
                type="url"
                value={form.sds_url || ""}
                onChange={setStr("sds_url")}
                placeholder="https://..."
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="info_sheet_url">Info sheet URL</Label>
              <Input
                id="info_sheet_url"
                type="url"
                value={form.info_sheet_url || ""}
                onChange={setStr("info_sheet_url")}
                placeholder="https://..."
              />
            </div>
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="sds_date">SDS date</Label>
              <Input
                id="sds_date"
                type="date"
                value={form.sds_date || ""}
                onChange={setStr("sds_date")}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="last_reviewed">Last reviewed</Label>
              <Input
                id="last_reviewed"
                type="date"
                value={form.last_reviewed || ""}
                onChange={setStr("last_reviewed")}
              />
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              value={form.notes || ""}
              onChange={setStr("notes")}
              rows={2}
              placeholder="Any additional notes"
            />
          </div>

          <DialogFooter className="flex items-center justify-between gap-2 pt-2">
            <div>
              {isEdit && (
                <Button
                  type="button"
                  variant="destructive"
                  onClick={handleDelete}
                  disabled={deleteMutation.isPending}
                  className="h-10"
                >
                  Remove from register
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={onClose} className="h-10">
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={saveMutation.isPending}
                className="h-10"
                style={{ backgroundColor: "#256984" }}
              >
                {saveMutation.isPending ? "Saving..." : isEdit ? "Save changes" : "Add chemical"}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ChemicalsRegister() {
  const { data: chemicals = [], isLoading } = useQuery<Chemical[]>({
    queryKey: ["chemicals"],
    queryFn: () =>
      apiRequest("GET", "/api/compliance/chemicals").then((r) => r.json()),
  });

  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [modalOpen, setModalOpen] = useState(false);
  const [editChemical, setEditChemical] = useState<Chemical | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);

  const handleDownloadPdf = async () => {
    setPdfLoading(true);
    try {
      const res = await apiRequest("GET", "/api/compliance/chemicals/pdf");
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(err.error || "Failed to generate PDF");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "Chemicals-Safety-Register.pdf";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e: any) {
      toast({ title: "PDF Error", description: e.message, variant: "destructive" });
    } finally {
      setPdfLoading(false);
    }
  };

  const filtered = useMemo(() => {
    let list = chemicals;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (c) =>
          c.product_name.toLowerCase().includes(q) ||
          (c.chemform_product_code || "").toLowerCase().includes(q) ||
          (c.areas_of_use || "").toLowerCase().includes(q)
      );
    }
    if (categoryFilter !== "all") {
      list = list.filter((c) => c.category === categoryFilter);
    }
    return list;
  }, [chemicals, search, categoryFilter]);

  // Group by category
  const grouped = useMemo(() => {
    const map = new Map<string, Chemical[]>();
    for (const c of filtered) {
      if (!map.has(c.category)) map.set(c.category, []);
      map.get(c.category)!.push(c);
    }
    return map;
  }, [filtered]);

  const openAdd = () => {
    setEditChemical(null);
    setModalOpen(true);
  };

  const openEdit = (c: Chemical) => {
    setEditChemical(c);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditChemical(null);
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <FlaskConical size={22} style={{ color: "#256984" }} />
            <h1 className="text-2xl font-semibold tracking-tight" style={{ color: "#256984" }}>
              Chemicals Register
            </h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Supplier:{" "}
            <a
              href="https://chemform.com.au"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#256984] hover:underline font-medium"
            >
              Chemform — chemform.com.au
            </a>
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={handleDownloadPdf}
            disabled={pdfLoading}
            variant="outline"
            className="h-12 px-4 gap-2 border-[#256984] text-[#256984] hover:bg-[#256984]/10"
          >
            <FileDown size={16} />
            {pdfLoading ? "Generating..." : "Print Safety Sheet"}
          </Button>
          <Button
            onClick={openAdd}
            className="h-12 px-5 gap-2"
            style={{ backgroundColor: "#256984" }}
          >
            <Plus size={16} />
            Add Chemical
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <Input
          placeholder="Search by name or area of use..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="max-w-[220px]">
            <SelectValue placeholder="All categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {CATEGORY_KEYS.map((k) => (
              <SelectItem key={k} value={k}>
                {CATEGORY_LABELS[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
          Loading chemicals...
        </div>
      )}

      {/* Empty state */}
      {!isLoading && filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground text-sm gap-2">
          <FlaskConical size={32} className="opacity-30" />
          <p>No chemicals found.</p>
        </div>
      )}

      {/* Grouped cards */}
      {!isLoading &&
        Array.from(grouped.entries()).map(([category, items]) => (
          <div key={category} className="mb-8">
            {/* Category header */}
            <div
              className="border-b pb-1 mb-3"
              style={{ borderColor: "#256984" }}
            >
              <span
                className="text-xs font-semibold uppercase tracking-widest"
                style={{ color: "#256984" }}
              >
                {CATEGORY_LABELS[category] || category}
              </span>
            </div>

            {/* Cards */}
            {items.map((chem) => (
              <ChemicalCard key={chem.id} chemical={chem} onEdit={openEdit} />
            ))}
          </div>
        ))}

      {/* WHS compliance note */}
      <div className="mt-8 rounded-lg bg-gray-50 border border-gray-200 px-5 py-4 text-sm text-gray-500 leading-relaxed">
        <strong className="text-gray-600 font-medium">WHS compliance note:</strong> Under the Work
        Health &amp; Safety Regulations 2011 (WA), a hazardous chemicals register and current
        Safety Data Sheets must be accessible to all workers. SDS documents must be no older than 5
        years.
      </div>

      {/* Modal */}
      <ChemicalModal open={modalOpen} onClose={closeModal} chemical={editChemical} />
    </div>
  );
}

// ─── Card sub-component ───────────────────────────────────────────────────────

function ChemicalCard({
  chemical,
  onEdit,
}: {
  chemical: Chemical;
  onEdit: (c: Chemical) => void;
}) {
  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-4 mb-3">
      <div className="flex items-start gap-3">
        {/* Left: name + badges */}
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <span className="font-semibold text-gray-900 text-sm">{chemical.product_name}</span>

            {chemical.chemform_product_code && (
              <span className="text-xs bg-gray-100 text-gray-500 rounded px-1.5 py-0.5 font-mono">
                {chemical.chemform_product_code}
              </span>
            )}

            {/* Food safe badge */}
            {chemical.food_contact_safe ? (
              <span className="text-xs bg-green-100 text-green-800 rounded-full px-2 py-0.5 font-medium">
                Food-safe
              </span>
            ) : (
              <span className="text-xs bg-gray-100 text-gray-600 rounded-full px-2 py-0.5 font-medium">
                Not food-safe
              </span>
            )}

            {/* No-rinse badge */}
            {chemical.no_rinse && (
              <span className="text-xs bg-blue-100 text-blue-800 rounded-full px-2 py-0.5 font-medium">
                No-rinse
              </span>
            )}

            {/* GHS badge */}
            {chemical.ghs_hazard_class && (
              <span className="text-xs bg-orange-100 text-orange-800 rounded-full px-2 py-0.5 font-medium">
                &#9888; GHS: {chemical.ghs_hazard_class}
              </span>
            )}
          </div>

          {/* Areas of use */}
          {chemical.areas_of_use && (
            <p className="text-xs text-gray-500 mt-0.5">{chemical.areas_of_use}</p>
          )}
        </div>

        {/* Right: action buttons */}
        <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
          {chemical.sds_url && (
            <a
              href={chemical.sds_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 h-8 px-3 text-xs font-medium rounded border border-gray-200 bg-gray-50 text-gray-700 hover:bg-gray-100 transition-colors"
            >
              SDS
              <ExternalLink size={11} />
            </a>
          )}
          {chemical.info_sheet_url && (
            <a
              href={chemical.info_sheet_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 h-8 px-3 text-xs font-medium rounded border border-gray-200 bg-gray-50 text-gray-700 hover:bg-gray-100 transition-colors"
            >
              Info Sheet
              <ExternalLink size={11} />
            </a>
          )}
          <button
            onClick={() => onEdit(chemical)}
            className="inline-flex items-center justify-center h-8 w-8 rounded border border-gray-200 bg-gray-50 text-gray-600 hover:bg-gray-100 transition-colors"
            aria-label={`Edit ${chemical.product_name}`}
          >
            <Pencil size={13} />
          </button>
        </div>
      </div>

      {/* Notes */}
      {chemical.notes && (
        <p className="mt-2 pt-2 border-t border-gray-100 text-xs text-gray-400 italic leading-relaxed">
          {chemical.notes}
        </p>
      )}
    </div>
  );
}
