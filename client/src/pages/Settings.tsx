import { useQuery, useMutation } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Save, Percent, Clock, DollarSign, TrendingUp, AlertTriangle, FolderOpen } from "lucide-react";

export default function Settings() {
  const { toast } = useToast();
  const [form, setForm] = useState({
    markup_percent: "65",
    labour_rate_per_hour: "35",
    default_labour_minutes: "15",
    target_food_cost_percent: "30",
    gst_rate: "10",
    drive_receipts_folder_id: "",
    google_client_id: "",
  });

  const { data: settingsData = {}, isLoading } = useQuery({
    queryKey: ["/api/settings"],
    queryFn: () => apiRequest("GET", "/api/settings").then((r) => r.json()),
  });

  useEffect(() => {
    if (settingsData && Object.keys(settingsData).length > 0) {
      setForm({
        markup_percent: settingsData.markup_percent || "65",
        labour_rate_per_hour: settingsData.labour_rate_per_hour || "35",
        default_labour_minutes: settingsData.default_labour_minutes || "15",
        target_food_cost_percent: settingsData.target_food_cost_percent || "30",
        gst_rate: settingsData.gst_rate || "10",
        drive_receipts_folder_id: settingsData.drive_receipts_folder_id || "",
        google_client_id: settingsData.google_client_id || "",
      });
    }
  }, [settingsData]);

  const save = useMutation({
    mutationFn: async () => {
      for (const [key, value] of Object.entries(form)) {
        await apiRequest("POST", "/api/settings", { key, value });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recipes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/platters"] });
      toast({ title: "Settings saved", description: "All costs and RRPs have been recalculated." });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const markup = parseFloat(form.markup_percent) || 0;
  const foodCostTarget = parseFloat(form.target_food_cost_percent) || 0;
  const labourRate = parseFloat(form.labour_rate_per_hour) || 0;
  const labourMins = parseFloat(form.default_labour_minutes) || 0;
  const defaultLabourCost = (labourRate / 60) * labourMins;

  // Example RRP calc
  const exampleCost = 5.00;
  const exampleRrp = markup > 0 ? exampleCost / (1 - markup / 100) : exampleCost;
  const exampleFoodCostPct = exampleRrp > 0 ? (exampleCost / exampleRrp) * 100 : 0;

  return (
    <div className="p-6 space-y-6 max-w-screen-md">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Settings</h1>
          <p className="text-sm text-muted-foreground mt-1">Configure markup, labour rates, and profitability targets.</p>
        </div>
        <Button onClick={() => save.mutate()} disabled={save.isPending} data-testid="button-save-settings" size="sm">
          <Save size={15} className="mr-1" />
          {save.isPending ? "Saving…" : "Save Settings"}
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-4">{[1,2,3].map((i) => <div key={i} className="skeleton h-24 rounded-lg" />)}</div>
      ) : (
        <div className="space-y-5">
          {/* Markup */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2"><Percent size={16} className="text-primary" /> Markup & RRP Calculation</CardTitle>
              <CardDescription>Sets the target selling price from cost. RRP = Cost ÷ (1 − Markup%)</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>Markup %</Label>
                  <span className="text-lg font-bold text-primary tabular-nums">{markup.toFixed(1)}%</span>
                </div>
                <Slider
                  value={[markup]}
                  onValueChange={([v]) => setForm({ ...form, markup_percent: String(v) })}
                  min={10} max={90} step={0.5}
                  className="w-full"
                  data-testid="slider-markup"
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>10%</span><span>50%</span><span>90%</span>
                </div>
              </div>
              <div className="bg-primary/5 rounded-lg p-3 text-sm">
                <p className="font-medium mb-1">Example calculation</p>
                <div className="grid grid-cols-2 gap-1 text-muted-foreground">
                  <span>Cost of goods</span><span className="text-right tabular-nums font-medium text-foreground">$5.00</span>
                  <span>Markup ({markup.toFixed(1)}%)</span><span className="text-right tabular-nums font-medium text-primary">RRP = ${exampleRrp.toFixed(2)}</span>
                  <span>Food cost %</span><span className="text-right tabular-nums">{exampleFoodCostPct.toFixed(1)}%</span>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Or enter manually</Label>
                <Input
                  type="number" step="0.1" min="0" max="99"
                  value={form.markup_percent}
                  onChange={(e) => setForm({ ...form, markup_percent: e.target.value })}
                  className="max-w-xs" data-testid="input-markup-percent"
                />
              </div>
            </CardContent>
          </Card>

          {/* Target Food Cost */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <AlertTriangle size={16} className="text-primary" /> Target Food Cost %
              </CardTitle>
              <CardDescription>Items above this food cost % will be flagged on the dashboard.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>Target Food Cost %</Label>
                  <span className="text-lg font-bold text-primary tabular-nums">{foodCostTarget.toFixed(1)}%</span>
                </div>
                <Slider
                  value={[foodCostTarget]}
                  onValueChange={([v]) => setForm({ ...form, target_food_cost_percent: String(v) })}
                  min={10} max={60} step={0.5}
                  className="w-full"
                  data-testid="slider-food-cost"
                />
                <p className="text-xs text-muted-foreground">Industry standard for catering: 25–35%. Items above this are highlighted red.</p>
              </div>
              <Input
                type="number" step="0.1" min="0" max="100"
                value={form.target_food_cost_percent}
                onChange={(e) => setForm({ ...form, target_food_cost_percent: e.target.value })}
                className="max-w-xs" data-testid="input-food-cost-percent"
              />
            </CardContent>
          </Card>

          {/* Labour */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2"><Clock size={16} className="text-primary" /> Labour Costing</CardTitle>
              <CardDescription>Default labour cost applied to new recipes. Can be overridden per recipe.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Labour Rate ($/hr)</Label>
                  <div className="relative">
                    <DollarSign size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      type="number" step="0.50" min="0"
                      value={form.labour_rate_per_hour}
                      onChange={(e) => setForm({ ...form, labour_rate_per_hour: e.target.value })}
                      className="pl-7" data-testid="input-labour-rate"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Default Minutes per Item</Label>
                  <Input
                    type="number" step="1" min="0"
                    value={form.default_labour_minutes}
                    onChange={(e) => setForm({ ...form, default_labour_minutes: e.target.value })}
                    data-testid="input-labour-minutes"
                  />
                </div>
              </div>
              <div className="bg-muted/40 rounded-lg p-3 text-sm">
                <p className="text-muted-foreground">Default labour cost per item: <strong className="text-foreground">${defaultLabourCost.toFixed(2)}</strong></p>
                <p className="text-xs text-muted-foreground mt-1">({labourRate}/hr ÷ 60 × {labourMins} min)</p>
              </div>
            </CardContent>
          </Card>

          {/* GST */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2"><TrendingUp size={16} className="text-primary" /> GST Rate</CardTitle>
              <CardDescription>For reference display only — does not affect costing calculations.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-3">
                <Input
                  type="number" step="1" min="0" max="30"
                  value={form.gst_rate}
                  onChange={(e) => setForm({ ...form, gst_rate: e.target.value })}
                  className="max-w-xs" data-testid="input-gst-rate"
                />
                <span className="text-muted-foreground text-sm">%</span>
              </div>
            </CardContent>
          </Card>

          {/* Google Drive */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2"><FolderOpen size={16} className="text-primary" /> Google Drive — Receipts Folder</CardTitle>
              <CardDescription>Configure your Google Drive integration for automatic invoice syncing.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label>Receipts Folder ID</Label>
                <Input
                  type="text"
                  placeholder="e.g. 1AbcXYZ123..."
                  value={form.drive_receipts_folder_id}
                  onChange={(e) => setForm({ ...form, drive_receipts_folder_id: e.target.value })}
                  data-testid="input-drive-folder-id"
                />
                <p className="text-xs text-muted-foreground">Paste the folder ID from the URL when you open your Receipts folder in Drive: drive.google.com/drive/folders/<strong>THIS_PART</strong></p>
                {form.drive_receipts_folder_id && (
                  <p className="text-xs text-green-600 dark:text-green-400">✓ Folder ID configured</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Google OAuth Client ID</Label>
                <Input
                  type="text"
                  placeholder="xxxxxxxxxx-xxxx.apps.googleusercontent.com"
                  value={form.google_client_id}
                  onChange={(e) => setForm({ ...form, google_client_id: e.target.value })}
                  data-testid="input-google-client-id"
                />
                <p className="text-xs text-muted-foreground">
                  Required for the Sync with Drive button. 
                  <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer" className="text-primary underline ml-1">
                    Create one in Google Cloud Console
                  </a>
                  {" "}— enable the Drive API, create an OAuth 2.0 Client ID (Web application), and add your app URL to Authorized JavaScript Origins.
                </p>
                {form.google_client_id && (
                  <p className="text-xs text-green-600 dark:text-green-400">✓ Google Client ID configured</p>
                )}
                {!form.google_client_id && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">⚠ Without this, the Sync with Drive button will not work.</p>
                )}
              </div>
            </CardContent>
          </Card>

          <Button onClick={() => save.mutate()} disabled={save.isPending} className="w-full" data-testid="button-save-settings-bottom">
            <Save size={15} className="mr-2" />
            {save.isPending ? "Saving…" : "Save All Settings"}
          </Button>
        </div>
      )}
    </div>
  );
}
