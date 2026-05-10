import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  ChevronDown,
  Search,
  Package,
  Clipboard,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

// ─── Types ─────────────────────────────────────────────────────────────────

interface WholesaleCustomer {
  flexCustomerId: string;
  flexCustomerNumber: number | null;
  companyName: string;
  paper: "branded" | "plain_white" | null;
  wrapStyle: "open" | "burrito" | null;
  allItemsGreaseproof: boolean | null;
  barcodeLabels: boolean | null;
  specialNotes: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

interface LocalPrefs {
  paper: "branded" | "plain_white" | null;
  wrapStyle: "open" | "burrito" | null;
  allItemsGreaseproof: boolean | null;
  barcodeLabels: boolean | null;
  specialNotes: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function isFullySet(c: WholesaleCustomer | LocalPrefs): boolean {
  return (
    c.paper !== null &&
    c.wrapStyle !== null &&
    c.allItemsGreaseproof !== null &&
    c.barcodeLabels !== null
  );
}

function buildCopyLine(prefs: LocalPrefs): string {
  const paperLabel =
    prefs.paper === "branded"
      ? "Branded"
      : prefs.paper === "plain_white"
      ? "Plain White"
      : "Not set";
  const wrapLabel =
    prefs.wrapStyle === "open"
      ? "Open"
      : prefs.wrapStyle === "burrito"
      ? "Burrito"
      : "Not set";
  const greaseproofLabel =
    prefs.allItemsGreaseproof === true
      ? "Yes"
      : prefs.allItemsGreaseproof === false
      ? "No"
      : "Not set";
  const labelsLabel =
    prefs.barcodeLabels === true
      ? "Yes"
      : prefs.barcodeLabels === false
      ? "No"
      : "Not set";
  return `Paper: ${paperLabel}, Wrap Style: ${wrapLabel}, All Items in Greaseproof: ${greaseproofLabel}, Labels: ${labelsLabel}`;
}

function formatSavedAt(updatedAt: string | null, updatedBy: string | null): string | null {
  if (!updatedAt) return null;
  try {
    const date = format(new Date(updatedAt), "d MMM");
    return updatedBy ? `Saved ${date} by ${updatedBy}` : `Saved ${date}`;
  } catch {
    return null;
  }
}

function customerToLocal(c: WholesaleCustomer): LocalPrefs {
  return {
    paper: c.paper,
    wrapStyle: c.wrapStyle,
    allItemsGreaseproof: c.allItemsGreaseproof,
    barcodeLabels: c.barcodeLabels,
    specialNotes: c.specialNotes ?? "",
  };
}

function prefsEqual(a: LocalPrefs, b: LocalPrefs): boolean {
  return (
    a.paper === b.paper &&
    a.wrapStyle === b.wrapStyle &&
    a.allItemsGreaseproof === b.allItemsGreaseproof &&
    a.barcodeLabels === b.barcodeLabels &&
    a.specialNotes === b.specialNotes
  );
}

// ─── Customer Row ───────────────────────────────────────────────────────────

function CustomerRow({
  customer,
  onSaved,
}: {
  customer: WholesaleCustomer;
  onSaved: (updated: WholesaleCustomer) => void;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [prefs, setPrefs] = useState<LocalPrefs>(customerToLocal(customer));
  const savedPrefs = useRef<LocalPrefs>(customerToLocal(customer));
  const isDirty = !prefsEqual(prefs, savedPrefs.current);

  // Sync if customer prop changes (e.g. after save from parent)
  useEffect(() => {
    const fresh = customerToLocal(customer);
    savedPrefs.current = fresh;
    setPrefs(fresh);
  }, [customer]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/wholesale/prefs", {
        flexCustomerId: customer.flexCustomerId,
        flexCustomerNumber: customer.flexCustomerNumber,
        companyName: customer.companyName,
        paper: prefs.paper,
        wrapStyle: prefs.wrapStyle,
        allItemsGreaseproof: prefs.allItemsGreaseproof,
        barcodeLabels: prefs.barcodeLabels,
        specialNotes: prefs.specialNotes || null,
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Save failed");
      }
      return res.json() as Promise<WholesaleCustomer>;
    },
    onSuccess: (saved) => {
      savedPrefs.current = customerToLocal(saved);
      onSaved(saved);
      toast({ title: "Preferences saved", description: customer.companyName });
    },
    onError: (err: any) => {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    },
  });

  const copyLine = buildCopyLine(prefs);

  const handleCopy = () => {
    navigator.clipboard.writeText(copyLine).then(() => {
      toast({ title: "Copied to clipboard" });
    });
  };

  const setField = <K extends keyof LocalPrefs>(key: K, value: LocalPrefs[K]) => {
    setPrefs((p) => ({ ...p, [key]: value }));
  };

  const isSet = isFullySet(prefs);

  return (
    <div className="border border-border rounded-lg overflow-hidden bg-card" data-testid={`customer-row-${customer.flexCustomerId}`}>
      {/* Header / collapsed row */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/40 transition-colors"
        data-testid={`customer-toggle-${customer.flexCustomerId}`}
      >
        {/* Customer number chip */}
        {customer.flexCustomerNumber != null && (
          <span className="shrink-0 text-xs font-mono bg-muted text-muted-foreground rounded px-1.5 py-0.5">
            #{customer.flexCustomerNumber}
          </span>
        )}
        {/* Name */}
        <span className="flex-1 font-medium text-sm text-foreground truncate">
          {customer.companyName}
        </span>
        {/* Status badge */}
        <span
          className={cn(
            "shrink-0 inline-flex items-center gap-1 text-xs font-medium rounded-full px-2 py-0.5",
            isSet
              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
              : "bg-muted text-muted-foreground"
          )}
          data-testid={`status-${customer.flexCustomerId}`}
        >
          {isSet ? (
            <>
              <CheckCircle2 size={11} />
              Set
            </>
          ) : (
            "Not set"
          )}
        </span>
        {isDirty && (
          <span className="shrink-0 w-2 h-2 rounded-full bg-amber-500" title="Unsaved changes" />
        )}
        <ChevronDown
          size={16}
          className={cn(
            "shrink-0 text-muted-foreground transition-transform duration-200",
            open && "rotate-180"
          )}
        />
      </button>

      {/* Expanded content */}
      {open && (
        <div className="border-t border-border px-4 py-4 space-y-5">
          {/* 4 preference groups */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {/* Paper */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Paper</p>
              <RadioGroup
                value={prefs.paper ?? ""}
                onValueChange={(v) => setField("paper", v as LocalPrefs["paper"])}
                data-testid={`radio-paper-${customer.flexCustomerId}`}
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="branded" id={`paper-branded-${customer.flexCustomerId}`} />
                  <Label htmlFor={`paper-branded-${customer.flexCustomerId}`} className="font-normal cursor-pointer">
                    Branded
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="plain_white" id={`paper-plain-${customer.flexCustomerId}`} />
                  <Label htmlFor={`paper-plain-${customer.flexCustomerId}`} className="font-normal cursor-pointer">
                    Plain White
                  </Label>
                </div>
              </RadioGroup>
            </div>

            {/* Wrap Style */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Wrap Style</p>
              <RadioGroup
                value={prefs.wrapStyle ?? ""}
                onValueChange={(v) => setField("wrapStyle", v as LocalPrefs["wrapStyle"])}
                data-testid={`radio-wrapstyle-${customer.flexCustomerId}`}
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="open" id={`wrap-open-${customer.flexCustomerId}`} />
                  <Label htmlFor={`wrap-open-${customer.flexCustomerId}`} className="font-normal cursor-pointer">
                    Open
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="burrito" id={`wrap-burrito-${customer.flexCustomerId}`} />
                  <Label htmlFor={`wrap-burrito-${customer.flexCustomerId}`} className="font-normal cursor-pointer">
                    Burrito
                  </Label>
                </div>
              </RadioGroup>
            </div>

            {/* All Items in Greaseproof */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">All Items in Greaseproof?</p>
              <RadioGroup
                value={prefs.allItemsGreaseproof === null ? "" : String(prefs.allItemsGreaseproof)}
                onValueChange={(v) => setField("allItemsGreaseproof", v === "true" ? true : false)}
                data-testid={`radio-greaseproof-${customer.flexCustomerId}`}
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="true" id={`grease-yes-${customer.flexCustomerId}`} />
                  <Label htmlFor={`grease-yes-${customer.flexCustomerId}`} className="font-normal cursor-pointer">
                    Yes
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="false" id={`grease-no-${customer.flexCustomerId}`} />
                  <Label htmlFor={`grease-no-${customer.flexCustomerId}`} className="font-normal cursor-pointer">
                    No
                  </Label>
                </div>
              </RadioGroup>
            </div>

            {/* Barcode Labels */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Barcode Labels?</p>
              <RadioGroup
                value={prefs.barcodeLabels === null ? "" : String(prefs.barcodeLabels)}
                onValueChange={(v) => setField("barcodeLabels", v === "true" ? true : false)}
                data-testid={`radio-barcodelabels-${customer.flexCustomerId}`}
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="true" id={`labels-yes-${customer.flexCustomerId}`} />
                  <Label htmlFor={`labels-yes-${customer.flexCustomerId}`} className="font-normal cursor-pointer">
                    Yes
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="false" id={`labels-no-${customer.flexCustomerId}`} />
                  <Label htmlFor={`labels-no-${customer.flexCustomerId}`} className="font-normal cursor-pointer">
                    No
                  </Label>
                </div>
              </RadioGroup>
            </div>
          </div>

          {/* Special Notes */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Special Notes
            </Label>
            <Textarea
              rows={3}
              placeholder="Delivery instructions, allergies, special requests..."
              value={prefs.specialNotes}
              onChange={(e) => setField("specialNotes", e.target.value)}
              className="resize-none text-sm"
              data-testid={`textarea-notes-${customer.flexCustomerId}`}
            />
          </div>

          {/* Auto-generated copy line */}
          <div className="flex items-start gap-2 p-3 bg-muted/50 rounded-md">
            <code className="flex-1 text-xs font-mono text-foreground break-all leading-relaxed">
              {copyLine}
            </code>
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0 h-7 w-7"
              onClick={handleCopy}
              title="Copy to clipboard"
              data-testid={`button-copy-${customer.flexCustomerId}`}
            >
              <Clipboard size={14} />
            </Button>
          </div>

          {/* Save row */}
          <div className="flex items-center justify-between gap-3 pt-1">
            <span className="text-xs text-muted-foreground">
              {formatSavedAt(customer.updatedAt, customer.updatedBy)}
            </span>
            <Button
              size="sm"
              style={{ backgroundColor: "#256984" }}
              className="text-white hover:opacity-90 transition-opacity"
              disabled={!isDirty || saveMutation.isPending}
              onClick={() => saveMutation.mutate()}
              data-testid={`button-save-${customer.flexCustomerId}`}
            >
              {saveMutation.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────────

export default function WholesalePackaging() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [activeOnly, setActiveOnly] = useState(true);
  const [customers, setCustomers] = useState<WholesaleCustomer[]>([]);
  const dirtyRef = useRef(false);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 150);
    return () => clearTimeout(t);
  }, [search]);

  // Warn on navigation if dirty
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  const customersQuery = useQuery<WholesaleCustomer[]>({
    queryKey: ["/api/wholesale/customers"],
    queryFn: () =>
      apiRequest("GET", "/api/wholesale/customers").then((r) => {
        if (!r.ok) throw new Error("Failed to load customers");
        return r.json();
      }),
  });

  const activeQuery = useQuery<string[]>({
    queryKey: ["/api/wholesale/active-customers"],
    queryFn: () =>
      apiRequest("GET", "/api/wholesale/active-customers").then((r) => r.json().catch(() => [])),
  });

  useEffect(() => {
    if (customersQuery.data) setCustomers(customersQuery.data);
  }, [customersQuery.data]);

  useEffect(() => {
    if (customersQuery.isError) {
      toast({ title: "Error loading customers", variant: "destructive" });
    }
  }, [customersQuery.isError]);

  const activeIds = new Set<string>(activeQuery.data ?? []);

  const handleSaved = useCallback((updated: WholesaleCustomer) => {
    setCustomers((prev) =>
      prev.map((c) => (c.flexCustomerId === updated.flexCustomerId ? { ...c, ...updated } : c))
    );
  }, []);

  const filtered = customers
    .filter((c) => {
      if (activeOnly && activeIds.size > 0 && !activeIds.has(c.flexCustomerId)) return false;
      if (debouncedSearch.trim()) {
        const q = debouncedSearch.toLowerCase();
        return (
          c.companyName.toLowerCase().includes(q) ||
          String(c.flexCustomerNumber ?? "").includes(q)
        );
      }
      return true;
    });

  const isLoading = customersQuery.isLoading;

  return (
    <div className="flex flex-col h-full">
      {/* Page header */}
      <div className="px-6 py-5 border-b border-border bg-background">
        <div className="flex items-center gap-3">
          <div
            className="p-2 rounded-md"
            style={{ backgroundColor: "#256984" }}
          >
            <Package size={18} className="text-white" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-foreground">Wholesale Packaging Preferences</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Set how each wholesale customer wants their items packed
            </p>
          </div>
        </div>
      </div>

      {/* Sticky search + filter bar */}
      <div className="sticky top-0 z-10 bg-background border-b border-border px-6 py-3 flex flex-col sm:flex-row gap-3 items-start sm:items-center">
        <div className="relative flex-1 w-full">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search customers…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-8 text-sm"
            data-testid="input-search"
          />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Switch
            id="active-toggle"
            checked={activeOnly}
            onCheckedChange={setActiveOnly}
            data-testid="switch-active-only"
          />
          <Label htmlFor="active-toggle" className="text-sm cursor-pointer text-muted-foreground">
            Active in last 90 days
          </Label>
        </div>
      </div>

      {/* Customer list */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-12 rounded-lg" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-20 text-muted-foreground">
            <AlertCircle size={32} strokeWidth={1.5} />
            <p className="text-sm">No matching customers</p>
            {activeOnly && activeIds.size === 0 && (
              <p className="text-xs text-muted-foreground/60">
                Active filter is on but no recent orders were found — try toggling it off
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((c) => (
              <CustomerRow key={c.flexCustomerId} customer={c} onSaved={handleSaved} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
