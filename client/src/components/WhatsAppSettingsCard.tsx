import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { MessageCircle, CheckCircle2, AlertTriangle, Loader2, Send } from "lucide-react";

interface WaStatus {
  configured: boolean;
  instance: string;
  state: string | null;
  groupId: string;
  groupName: string | null;
  lastResult: { at: string; ok: boolean; error?: string } | null;
}

export function WhatsAppSettingsCard() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [choosing, setChoosing] = useState(false);
  const [sending, setSending] = useState(false);
  const [preview, setPreview] = useState<string | null | undefined>(undefined);

  const { data: status, isLoading } = useQuery<WaStatus>({
    queryKey: ["/api/whatsapp/status"],
    queryFn: () => apiRequest("GET", "/api/whatsapp/status").then((r) => r.json()),
  });
  const { data: groups, isFetching: loadingGroups } = useQuery<{ id: string; name: string }[]>({
    queryKey: ["/api/whatsapp/groups"],
    queryFn: () => apiRequest("GET", "/api/whatsapp/groups").then((r) => r.json()),
    enabled: choosing,
  });

  const authorised = status?.state === "authorized";

  const sendTest = async () => {
    setSending(true);
    try {
      const r = await apiRequest("POST", "/api/whatsapp/test");
      const j = await r.json();
      if (j.ok) toast({ title: "Test message sent", description: `Check the ${status?.groupName || "team"} group.` });
      else toast({ title: "Couldn't send", description: j.error, variant: "destructive" });
    } catch (e: any) {
      toast({ title: "Couldn't send", description: e.message, variant: "destructive" });
    } finally {
      setSending(false);
      qc.invalidateQueries({ queryKey: ["/api/whatsapp/status"] });
    }
  };

  const chooseGroup = async (g: { id: string; name: string }) => {
    await apiRequest("PUT", "/api/whatsapp/group", g);
    setChoosing(false);
    qc.invalidateQueries({ queryKey: ["/api/whatsapp/status"] });
    toast({ title: "Group saved", description: g.name });
  };

  const loadPreview = async () => {
    const r = await apiRequest("GET", "/api/whatsapp/missing-summary-preview");
    const j = await r.json();
    setPreview(j.message ?? null);
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <MessageCircle size={16} className="text-primary" /> WhatsApp team alerts
        </CardTitle>
        <CardDescription>
          Fridge temperature alerts (when a fridge stays too warm for 20 minutes) and a 7:30pm summary of the day's
          missing items — only sent if something was missing.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {isLoading ? (
          <div className="h-6 w-40 bg-muted animate-pulse rounded" />
        ) : !status?.configured ? (
          <p className="flex items-center gap-2 text-amber-700"><AlertTriangle size={14} /> Green API isn't set up yet.</p>
        ) : (
          <>
            <div className="flex items-center gap-2">
              {authorised
                ? <CheckCircle2 size={14} className="text-green-600" />
                : <AlertTriangle size={14} className="text-amber-600" />}
              <span>WhatsApp {authorised ? "connected" : `status: ${status.state || "unknown"}`}</span>
              <span className="text-muted-foreground">· instance {status.instance}</span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-muted-foreground">Sends to:</span>
              <span className="font-medium">{status.groupName || (status.groupId ? status.groupId : "No group chosen yet")}</span>
              <button className="text-xs text-primary underline" onClick={() => setChoosing((c) => !c)} data-testid="button-wa-change-group">
                {choosing ? "Cancel" : "Change"}
              </button>
            </div>
            {choosing && (
              <div className="rounded-md border border-border max-h-48 overflow-auto">
                {loadingGroups && <p className="p-3 text-muted-foreground flex items-center gap-2"><Loader2 size={13} className="animate-spin" /> Loading groups…</p>}
                {groups?.map((g) => (
                  <button key={g.id} onClick={() => chooseGroup(g)} className="block w-full text-left px-3 py-2 hover:bg-muted border-b border-border last:border-0">
                    {g.name}
                  </button>
                ))}
                {groups && groups.length === 0 && <p className="p-3 text-muted-foreground">No groups found for this WhatsApp number.</p>}
              </div>
            )}
            <div className="flex gap-2 flex-wrap pt-1">
              <Button size="sm" variant="outline" onClick={sendTest} disabled={sending || !status.groupId} data-testid="button-wa-test">
                {sending ? <Loader2 size={13} className="mr-1.5 animate-spin" /> : <Send size={13} className="mr-1.5" />} Send test message
              </Button>
              <Button size="sm" variant="outline" onClick={loadPreview} data-testid="button-wa-preview">
                Preview tonight's summary
              </Button>
            </div>
            {preview !== undefined && (
              <pre className="whitespace-pre-wrap rounded-md bg-muted/50 p-3 text-xs font-sans">
                {preview ?? "Nothing missing today — no message will be sent tonight."}
              </pre>
            )}
            {status.lastResult && !status.lastResult.ok && (
              <p className="text-xs text-red-600">Last send failed: {status.lastResult.error}</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
