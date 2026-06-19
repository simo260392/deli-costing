import { useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  Package,
  ChefHat,
  Thermometer,
  Snowflake,
  QrCode,
  Search,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Clock,
  ArrowLeft,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import QRCode from "qrcode";
import { useEffect } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────
interface ComplianceLog {
  id: number;
  log_type: string;
  status: string;
  item_name: string | null;
  created_at: string;
  logged_by: string | null;
  batch_id: string | null;
}

interface BatchDetail {
  id: number;
  batch_id: string;
  batch_type: "parent" | "child";
  parent_batch_id: string | null;
  product_name: string;
  product_code: string;
  stage: "raw" | "cooked" | "frozen";
  total_weight_kg: number | null;
  num_boxes: number | null;
  weight_per_box_kg: number | null;
  notes: string;
  created_by: string;
  created_at: string;
  use_by_date: string | null;
  frozen_at: string | null;
  freezer_unit: string | null;
  status: "active" | "consumed" | "disposed";
  // Linked
  children: BatchDetail[];
  compliance_logs: ComplianceLog[];
  delivery_log: any | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtDate(iso: string | null, fmt = "dd/MM/yy HH:mm") {
  if (!iso) return "—";
  try {
    return format(parseISO(iso), fmt);
  } catch {
    return iso;
  }
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { cls: string; label: string }> = {
    active: { cls: "bg-green-100 text-green-700", label: "Active" },
    consumed: { cls: "bg-gray-100 text-gray-500", label: "Consumed" },
    disposed: { cls: "bg-red-100 text-red-600", label: "Disposed" },
    pass: { cls: "bg-green-100 text-green-700", label: "Pass" },
    fail: { cls: "bg-red-100 text-red-600", label: "Fail" },
    in_progress: { cls: "bg-yellow-100 text-yellow-700", label: "In Progress" },
  };
  const entry = map[status] || { cls: "bg-gray-100 text-gray-500", label: status };
  return (
    <span className={cn("text-xs font-semibold px-2.5 py-0.5 rounded-full", entry.cls)}>
      {entry.label}
    </span>
  );
}

function LogTypeIcon({ logType }: { logType: string }) {
  const map: Record<string, JSX.Element> = {
    cooking: <ChefHat size={15} className="text-orange-500" />,
    cooling: <Thermometer size={15} className="text-blue-500" />,
    freezing: <Snowflake size={15} className="text-sky-500" />,
  };
  return map[logType] || <Clock size={15} className="text-gray-400" />;
}

// ─── QR Display ───────────────────────────────────────────────────────────────
function QRDisplay({ batchId }: { batchId: string }) {
  const [qrUrl, setQrUrl] = useState("");
  useEffect(() => {
    QRCode.toDataURL(batchId, { width: 120, margin: 2 }).then(setQrUrl);
  }, [batchId]);
  if (!qrUrl) return null;
  return <img src={qrUrl} alt="QR" className="rounded" style={{ width: 80, height: 80 }} />;
}

// ─── Parent batch view ────────────────────────────────────────────────────────
function ParentBatchView({
  batch,
  onNavigate,
}: {
  batch: BatchDetail;
  onNavigate: (batchId: string) => void;
}) {
  const [expandedChild, setExpandedChild] = useState<string | null>(null);

  return (
    <div className="space-y-5">
      {/* Header card */}
      <div className="rounded-2xl border-2 border-[#256984]/30 bg-[#256984]/5 p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#256984]/15 flex items-center justify-center shrink-0 mt-0.5">
              <Package size={18} className="text-[#256984]" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-lg font-bold">{batch.product_name}</h2>
                <StatusBadge status={batch.status} />
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-orange-100 text-orange-700">
                  RAW
                </span>
              </div>
              <p className="text-xs font-mono text-[#256984] font-bold mt-0.5">{batch.batch_id}</p>
            </div>
          </div>
          <QRDisplay batchId={batch.batch_id} />
        </div>

        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">Delivery Date</p>
            <p className="font-medium">{fmtDate(batch.created_at, "dd/MM/yy")}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Total Weight</p>
            <p className="font-medium">{batch.total_weight_kg ? `${batch.total_weight_kg} kg` : "—"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Boxes</p>
            <p className="font-medium">{batch.num_boxes ?? "—"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Created By</p>
            <p className="font-medium">{batch.created_by || "—"}</p>
          </div>
        </div>

        {batch.delivery_log && (
          <div className="mt-3 pt-3 border-t border-[#256984]/20 text-sm">
            <p className="text-xs text-muted-foreground mb-1">Linked Delivery Log</p>
            <p className="font-medium">
              Order: {batch.delivery_log.order_id} · Driver: {batch.delivery_log.driver || "—"} ·{" "}
              {fmtDate(batch.delivery_log.delivery_date, "dd/MM/yy")}
            </p>
          </div>
        )}

        {batch.notes && (
          <div className="mt-3 pt-3 border-t border-[#256984]/20 text-xs text-muted-foreground">
            {batch.notes}
          </div>
        )}
      </div>

      {/* Child batches */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
          Child Batches ({batch.children.length})
        </p>
        {batch.children.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground text-sm border rounded-xl">
            No child batches created from this parent yet.
          </div>
        ) : (
          batch.children.map((child) => {
            const isExpanded = expandedChild === child.batch_id;
            return (
              <div key={child.batch_id} className="rounded-xl border">
                <button
                  className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-muted/30 transition-colors"
                  onClick={() =>
                    setExpandedChild(isExpanded ? null : child.batch_id)
                  }
                >
                  <div className="flex items-center gap-3">
                    <ChefHat size={15} className="text-blue-500 shrink-0" />
                    <div>
                      <p className="text-xs font-mono font-bold text-[#256984]">{child.batch_id}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {fmtDate(child.created_at, "dd/MM/yy HH:mm")} · {child.created_by}
                        {child.total_weight_kg ? ` · ${child.total_weight_kg}kg` : ""}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={child.status} />
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs text-[#256984] hover:text-[#256984]"
                      onClick={(e) => {
                        e.stopPropagation();
                        onNavigate(child.batch_id);
                      }}
                    >
                      View full
                    </Button>
                    {isExpanded ? (
                      <ChevronDown size={15} className="text-muted-foreground" />
                    ) : (
                      <ChevronRight size={15} className="text-muted-foreground" />
                    )}
                  </div>
                </button>

                {isExpanded && (
                  <div className="border-t px-4 py-3 space-y-2 bg-muted/10">
                    {child.notes && (
                      <p className="text-xs text-muted-foreground">{child.notes}</p>
                    )}
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
                      Compliance Logs
                    </p>
                    {(!child.compliance_logs || child.compliance_logs.length === 0) ? (
                      <p className="text-xs text-muted-foreground">No compliance logs linked.</p>
                    ) : (
                      <div className="space-y-1.5">
                        {child.compliance_logs?.map((log) => (
                          <div
                            key={log.id}
                            className="flex items-center gap-2 text-xs"
                          >
                            <LogTypeIcon logType={log.log_type} />
                            <span className="font-medium capitalize">{log.log_type}</span>
                            <span className="text-muted-foreground">{fmtDate(log.created_at)}</span>
                            <StatusBadge status={log.status} />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ─── Child batch view ─────────────────────────────────────────────────────────
function ChildBatchView({
  batch,
  onNavigate,
}: {
  batch: BatchDetail;
  onNavigate: (batchId: string) => void;
}) {
  const [parentExpanded, setParentExpanded] = useState(false);

  return (
    <div className="space-y-5">
      {/* Header card */}
      <div className="rounded-2xl border-2 border-blue-200 bg-blue-50 p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center shrink-0 mt-0.5">
              <ChefHat size={18} className="text-blue-600" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-lg font-bold">{batch.product_name}</h2>
                <StatusBadge status={batch.status} />
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                  COOKED
                </span>
              </div>
              <p className="text-xs font-mono text-[#256984] font-bold mt-0.5">{batch.batch_id}</p>
              {batch.parent_batch_id && (
                <button
                  className="text-xs text-[#256984] underline mt-0.5 hover:no-underline"
                  onClick={() => onNavigate(batch.parent_batch_id!)}
                >
                  ← Parent: {batch.parent_batch_id}
                </button>
              )}
            </div>
          </div>
          <QRDisplay batchId={batch.batch_id} />
        </div>

        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">Cook Date</p>
            <p className="font-medium">{fmtDate(batch.created_at, "dd/MM/yy")}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Weight</p>
            <p className="font-medium">{batch.total_weight_kg ? `${batch.total_weight_kg} kg` : "—"}</p>
          </div>
          {batch.frozen_at && (
            <div>
              <p className="text-xs text-muted-foreground">Frozen At</p>
              <p className="font-medium">{fmtDate(batch.frozen_at, "dd/MM/yy HH:mm")}</p>
            </div>
          )}
          {batch.freezer_unit && (
            <div>
              <p className="text-xs text-muted-foreground">Freezer Unit</p>
              <p className="font-medium">{batch.freezer_unit}</p>
            </div>
          )}
          <div>
            <p className="text-xs text-muted-foreground">Created By</p>
            <p className="font-medium">{batch.created_by || "—"}</p>
          </div>
        </div>

        {batch.notes && (
          <div className="mt-3 pt-3 border-t border-blue-200 text-xs text-muted-foreground">
            {batch.notes}
          </div>
        )}
      </div>

      {/* Parent batch summary */}
      {batch.parent_batch_id && (
        <div className="rounded-xl border">
          <button
            className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-muted/30 transition-colors"
            onClick={() => setParentExpanded(!parentExpanded)}
          >
            <div className="flex items-center gap-2">
              <Package size={14} className="text-[#256984]" />
              <span className="text-sm font-medium">
                Parent Batch: {batch.parent_batch_id}
              </span>
            </div>
            {parentExpanded ? (
              <ChevronDown size={15} className="text-muted-foreground" />
            ) : (
              <ChevronRight size={15} className="text-muted-foreground" />
            )}
          </button>
          {parentExpanded && (
            <div className="border-t px-4 py-3 bg-muted/10">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 text-[#256984] border-[#256984]/30"
                onClick={() => onNavigate(batch.parent_batch_id!)}
              >
                <ArrowLeft size={12} /> View full parent batch
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Compliance logs timeline */}
      <div className="space-y-3">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
          Compliance Timeline
        </p>
        {batch.compliance_logs.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground text-sm border rounded-xl">
            No compliance logs linked to this batch.
          </div>
        ) : (
          <div className="space-y-2">
            {batch.compliance_logs.map((log) => {
              const isPass = log.status === "pass" || log.status === "compliant";
              const isFail = log.status === "fail" || log.status === "non_compliant";
              return (
                <div
                  key={log.id}
                  className={cn(
                    "rounded-xl border-l-4 px-4 py-3 flex items-start gap-3",
                    isPass && "border-l-green-500 bg-green-50",
                    isFail && "border-l-red-500 bg-red-50",
                    !isPass && !isFail && "border-l-yellow-400 bg-yellow-50"
                  )}
                >
                  <div className="mt-0.5">
                    <LogTypeIcon logType={log.log_type} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold capitalize">{log.log_type} Log</span>
                      <StatusBadge status={log.status} />
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5 space-x-3">
                      <span>{fmtDate(log.created_at)}</span>
                      {log.logged_by && <span>Staff: {log.logged_by}</span>}
                      {log.item_name && <span>Item: {log.item_name}</span>}
                    </div>
                  </div>
                  {isPass && <CheckCircle2 size={16} className="text-green-500 shrink-0 mt-0.5" />}
                  {isFail && <XCircle size={16} className="text-red-500 shrink-0 mt-0.5" />}
                  {!isPass && !isFail && <Clock size={16} className="text-yellow-500 shrink-0 mt-0.5" />}
                </div>
              );
            })}
          </div>
        )}

        {/* Frozen info */}
        {batch.frozen_at && (
          <div className="rounded-xl border-l-4 border-l-sky-400 bg-sky-50 px-4 py-3 flex items-start gap-3">
            <Snowflake size={15} className="text-sky-500 mt-0.5" />
            <div>
              <p className="text-sm font-semibold">Frozen</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {fmtDate(batch.frozen_at)}
                {batch.freezer_unit && ` · Unit: ${batch.freezer_unit}`}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function BatchTraceability() {
  const { toast } = useToast();
  const [searchInput, setSearchInput] = useState("");
  const [searchedId, setSearchedId] = useState("");
  const [batch, setBatch] = useState<BatchDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [history, setHistory] = useState<string[]>([]);

  const doSearch = async (id: string) => {
    const trimmed = id.trim();
    if (!trimmed) return;
    setLoading(true);
    setNotFound(false);
    setBatch(null);
    setSearchedId(trimmed);
    try {
      const res = await apiRequest("GET", `/api/batches/${encodeURIComponent(trimmed)}`);
      const data = await res.json();
      setBatch(data);
      setHistory((h) => [trimmed, ...h.filter((x) => x !== trimmed)].slice(0, 5));
    } catch {
      setNotFound(true);
      toast({ description: `Batch "${trimmed}" not found`, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleNavigate = (batchId: string) => {
    setSearchInput(batchId);
    doSearch(batchId);
  };

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-[#256984]/10 flex items-center justify-center">
          <QrCode size={18} className="text-[#256984]" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-[#256984]">Batch Traceability</h1>
          <p className="text-xs text-muted-foreground">Scan or search a batch ID to view its full chain</p>
        </div>
      </div>

      {/* Search */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && doSearch(searchInput)}
            placeholder="Scan or type batch ID (e.g. CHKN-RAW-260619-001)"
            className="pl-9 h-11"
          />
        </div>
        <Button
          onClick={() => doSearch(searchInput)}
          disabled={loading || !searchInput.trim()}
          className="bg-[#256984] hover:bg-[#256984]/90 text-white h-11 px-5"
        >
          {loading ? "…" : "Search"}
        </Button>
      </div>

      {/* History pills */}
      {history.length > 0 && !batch && (
        <div className="flex flex-wrap gap-2">
          <span className="text-xs text-muted-foreground self-center">Recent:</span>
          {history.map((id) => (
            <button
              key={id}
              onClick={() => {
                setSearchInput(id);
                doSearch(id);
              }}
              className="text-xs font-mono font-semibold px-2.5 py-1 rounded-full bg-[#256984]/10 text-[#256984] hover:bg-[#256984]/20 transition-colors"
            >
              {id}
            </button>
          ))}
        </div>
      )}

      {/* Not found */}
      {notFound && (
        <div className="text-center py-8 space-y-2 border rounded-2xl">
          <QrCode size={32} className="mx-auto text-muted-foreground/40" />
          <p className="text-sm font-medium">Batch not found</p>
          <p className="text-xs text-muted-foreground">
            No batch with ID "{searchedId}" exists.
          </p>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="text-center py-8 text-muted-foreground text-sm">Searching…</div>
      )}

      {/* Results */}
      {batch && !loading && (
        <>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setBatch(null);
                setSearchInput("");
                setSearchedId("");
              }}
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
            >
              <ArrowLeft size={12} /> Clear
            </button>
          </div>
          {batch.batch_type === "parent" ? (
            <ParentBatchView batch={batch} onNavigate={handleNavigate} />
          ) : (
            <ChildBatchView batch={batch} onNavigate={handleNavigate} />
          )}
        </>
      )}
    </div>
  );
}
