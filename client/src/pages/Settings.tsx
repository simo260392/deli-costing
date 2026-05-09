import { useQuery, useMutation } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Save, Percent, Clock, DollarSign, TrendingUp, AlertTriangle, FolderOpen,
  Lock, Users, ShieldCheck, Plus, Pencil, Trash2, UserX, CheckCircle, XCircle
} from "lucide-react";

const MASTER_PASSWORD = "Burnfletch123!";

const API_BASE = "__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__";

async function masterRequest(method: string, url: string, data?: unknown): Promise<Response> {
  const isFormData = data instanceof FormData;
  const res = await fetch(`${API_BASE}${url}`, {
    method,
    headers: {
      ...(data && !isFormData ? { "Content-Type": "application/json" } : {}),
      "x-master-password": MASTER_PASSWORD,
    },
    body: data ? (isFormData ? data : JSON.stringify(data)) : undefined,
  });
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
  return res;
}

const ALL_PAGES = [
  { slug: "dashboard", label: "Dashboard" },
  { slug: "prep", label: "Production" },
  { slug: "prep-reports", label: "Production Reports" },
  { slug: "products", label: "Products" },
  { slug: "recipe-book", label: "Recipe Book" },
  { slug: "ingredients", label: "Ingredients" },
  { slug: "suppliers", label: "Suppliers" },
  { slug: "sub-recipes", label: "Sub Recipes" },
  { slug: "recipes", label: "Recipes" },
  { slug: "xero-imports", label: "Xero Imports" },
  { slug: "custom-pricing", label: "Custom Pricing" },
  { slug: "settings", label: "Settings" },
];

// ─────────────────────────────────────────────────────────────────────────────
// Master Password Gate
// ─────────────────────────────────────────────────────────────────────────────
function MasterPasswordGate({ onUnlock }: { onUnlock: () => void }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (value === MASTER_PASSWORD) {
      onUnlock();
    } else {
      setError("Incorrect admin password");
      setValue("");
    }
  };

  return (
    <div className="p-6 max-w-sm mx-auto mt-16">
      <div className="flex flex-col items-center gap-3 mb-6">
        <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ backgroundColor: "#256984" }}>
          <Lock size={22} className="text-white" />
        </div>
        <h1 className="text-xl font-bold text-foreground">Admin Password Required</h1>
        <p className="text-sm text-muted-foreground text-center">Enter the admin password to access Settings.</p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="master-password">Admin Password</Label>
          <Input
            id="master-password"
            type="password"
            value={value}
            onChange={(e) => { setValue(e.target.value); setError(""); }}
            placeholder="Enter admin password"
            autoFocus
            data-testid="input-master-password"
          />
          {error && <p className="text-sm text-red-600 font-medium" data-testid="text-master-error">{error}</p>}
        </div>
        <Button type="submit" className="w-full" data-testid="button-unlock-settings">
          Unlock Settings
        </Button>
      </form>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Staff Management Tab
// ─────────────────────────────────────────────────────────────────────────────
function StaffManagement() {
  const { toast } = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const [editStaff, setEditStaff] = useState<any>(null);
  const [newName, setNewName] = useState("");
  const [newAccessLevelId, setNewAccessLevelId] = useState("");


  const { data: staffList = [], isLoading: staffLoading } = useQuery({
    queryKey: ["/api/staff"],
    queryFn: () => masterRequest("GET", "/api/staff").then((r) => r.json()),
  });

  const { data: accessLevels = [] } = useQuery({
    queryKey: ["/api/access-levels"],
    queryFn: () => masterRequest("GET", "/api/access-levels").then((r) => r.json()),
  });

  const { data: activeSessions = [] } = useQuery({
    queryKey: ["/api/staff/active-sessions"],
    queryFn: () => masterRequest("GET", "/api/staff/active-sessions").then((r) => r.json()),
    refetchInterval: 30000,
  });

  const getLastSeen = (staffId: number) => {
    const session = activeSessions.find((s: any) => s.staff_id === staffId);
    if (!session) return null;
    const d = new Date(session.last_seen_at);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    if (diff < 60000) return "Just now";
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return d.toLocaleDateString();
  };

  const createStaff = useMutation({
    mutationFn: () => masterRequest("POST", "/api/staff", { name: newName, accessLevelId: parseInt(newAccessLevelId) }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/staff"] });
      setAddOpen(false);
      setNewName("");
      setNewAccessLevelId("");
      toast({ title: "Staff member added" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateStaff = useMutation({
    mutationFn: (data: any) => masterRequest("PATCH", `/api/staff/${data.id}`, data).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/staff"] });
      setEditStaff(null);
      toast({ title: "Staff updated" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const kickStaff = useMutation({
    mutationFn: (id: number) => masterRequest("DELETE", `/api/staff/${id}/sessions`).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/staff/active-sessions"] });
      toast({ title: "Staff logged out" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-foreground">Staff Members</h2>
        <Button size="sm" onClick={() => setAddOpen(true)} data-testid="button-add-staff">
          <Plus size={14} className="mr-1" /> Add Staff
        </Button>
      </div>

      {staffLoading ? (
        <div className="space-y-2">{[1,2,3].map((i) => <div key={i} className="h-12 bg-muted rounded animate-pulse" />)}</div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Name</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Access Level</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Status</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Last Seen</th>
                <th className="text-right px-3 py-2 font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {staffList.map((s: any) => {
                const lastSeen = getLastSeen(s.id);
                return (
                  <tr key={s.id} className="hover:bg-muted/20 transition-colors" data-testid={`row-staff-${s.id}`}>
                    <td className="px-3 py-2.5 font-medium">{s.name}</td>
                    <td className="px-3 py-2.5">
                      <Badge variant="secondary" className="text-xs">{s.access_levels?.name || "—"}</Badge>
                    </td>
                    <td className="px-3 py-2.5">
                      {s.is_active ? (
                        <span className="flex items-center gap-1 text-green-600"><CheckCircle size={13} /> Active</span>
                      ) : (
                        <span className="flex items-center gap-1 text-muted-foreground"><XCircle size={13} /> Inactive</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground text-xs">{lastSeen || "—"}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1 justify-end">
                        <Button
                          size="sm" variant="ghost" className="h-7 px-2"
                          onClick={() => {
                            setEditStaff({ ...s, newName: s.name, newAccessLevelId: String(s.access_level_id) });
                          }}
                          data-testid={`button-edit-staff-${s.id}`}
                        >
                          <Pencil size={12} />
                        </Button>
                        <Button
                          size="sm" variant="ghost" className="h-7 px-2"
                          onClick={() => updateStaff.mutate({ id: s.id, isActive: !s.is_active })}
                          title={s.is_active ? "Deactivate" : "Activate"}
                          data-testid={`button-toggle-staff-${s.id}`}
                        >
                          {s.is_active ? <XCircle size={12} className="text-amber-500" /> : <CheckCircle size={12} className="text-green-500" />}
                        </Button>
                        {lastSeen && (
                          <Button
                            size="sm" variant="ghost" className="h-7 px-2"
                            onClick={() => kickStaff.mutate(s.id)}
                            title="Kick (log out)"
                            data-testid={`button-kick-staff-${s.id}`}
                          >
                            <UserX size={12} className="text-red-500" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Add Staff Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Staff Member</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Staff member name"
                data-testid="input-new-staff-name"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Access Level</Label>
              <Select value={newAccessLevelId} onValueChange={setNewAccessLevelId}>
                <SelectTrigger data-testid="select-new-staff-level">
                  <SelectValue placeholder="Select level…" />
                </SelectTrigger>
                <SelectContent>
                  {accessLevels.map((al: any) => (
                    <SelectItem key={al.id} value={String(al.id)}>{al.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button
              onClick={() => createStaff.mutate()}
              disabled={!newName || !newAccessLevelId || createStaff.isPending}
              data-testid="button-confirm-add-staff"
            >
              Add Staff
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Staff Dialog */}
      <Dialog open={!!editStaff} onOpenChange={(o) => !o && setEditStaff(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Staff Member</DialogTitle>
          </DialogHeader>
          {editStaff && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>Name</Label>
                <Input
                  value={editStaff.newName}
                  onChange={(e) => setEditStaff({ ...editStaff, newName: e.target.value })}
                  data-testid="input-edit-staff-name"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Access Level</Label>
                <Select value={editStaff.newAccessLevelId} onValueChange={(v) => setEditStaff({ ...editStaff, newAccessLevelId: v })}>
                  <SelectTrigger data-testid="select-edit-staff-level">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {accessLevels.map((al: any) => (
                      <SelectItem key={al.id} value={String(al.id)}>{al.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditStaff(null)}>Cancel</Button>
            <Button
              onClick={() => updateStaff.mutate({
                id: editStaff.id,
                name: editStaff.newName,
                accessLevelId: parseInt(editStaff.newAccessLevelId),
              })}
              disabled={updateStaff.isPending}
              data-testid="button-confirm-edit-staff"
            >
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Access Levels Management Tab
// ─────────────────────────────────────────────────────────────────────────────
function AccessLevelsManagement() {
  const { toast } = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const [editLevel, setEditLevel] = useState<any>(null);
  const [newLevelName, setNewLevelName] = useState("");
  const [newLevelPages, setNewLevelPages] = useState<string[]>([]);


  const { data: accessLevels = [], isLoading } = useQuery({
    queryKey: ["/api/access-levels"],
    queryFn: () => masterRequest("GET", "/api/access-levels").then((r) => r.json()),
  });

  const createLevel = useMutation({
    mutationFn: () => masterRequest("POST", "/api/access-levels", { name: newLevelName, pagesJson: newLevelPages, sortOrder: 0 }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/access-levels"] });
      setAddOpen(false);
      setNewLevelName("");
      setNewLevelPages([]);
      toast({ title: "Access level created" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateLevel = useMutation({
    mutationFn: (data: any) => masterRequest("PATCH", `/api/access-levels/${data.id}`, data).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/access-levels"] });
      queryClient.invalidateQueries({ queryKey: ["/api/staff"] });
      setEditLevel(null);
      toast({ title: "Access level updated" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteLevel = useMutation({
    mutationFn: (id: number) => masterRequest("DELETE", `/api/access-levels/${id}`).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/access-levels"] });
      toast({ title: "Access level deleted" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const togglePage = (pages: string[], slug: string): string[] =>
    pages.includes(slug) ? pages.filter((p) => p !== slug) : [...pages, slug];

  const getPagesFromJson = (pagesJson: string): string[] => {
    try { return JSON.parse(pagesJson); } catch { return []; }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-foreground">Access Levels</h2>
        <Button size="sm" onClick={() => setAddOpen(true)} data-testid="button-add-level">
          <Plus size={14} className="mr-1" /> Add Level
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">{[1,2,3].map((i) => <div key={i} className="h-16 bg-muted rounded animate-pulse" />)}</div>
      ) : (
        <div className="space-y-3">
          {accessLevels.map((al: any) => {
            const pages: string[] = getPagesFromJson(al.pages_json);
            return (
              <div key={al.id} className="border rounded-lg p-4" data-testid={`card-access-level-${al.id}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <p className="font-medium text-sm text-foreground mb-2">{al.name}</p>
                    <div className="flex flex-wrap gap-1">
                      {pages.length > 0 ? pages.map((slug) => {
                        const page = ALL_PAGES.find((p) => p.slug === slug);
                        return (
                          <Badge key={slug} variant="secondary" className="text-xs">
                            {page?.label || slug}
                          </Badge>
                        );
                      }) : <span className="text-xs text-muted-foreground">No pages assigned</span>}
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button
                      size="sm" variant="ghost" className="h-7 px-2"
                      onClick={() => setEditLevel({ ...al, editPages: pages, editName: al.name })}
                      data-testid={`button-edit-level-${al.id}`}
                    >
                      <Pencil size={12} />
                    </Button>
                    <Button
                      size="sm" variant="ghost" className="h-7 px-2"
                      onClick={() => deleteLevel.mutate(al.id)}
                      data-testid={`button-delete-level-${al.id}`}
                    >
                      <Trash2 size={12} className="text-red-500" />
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add Level Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create Access Level</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Level Name</Label>
              <Input
                value={newLevelName}
                onChange={(e) => setNewLevelName(e.target.value)}
                placeholder="e.g. Supervisor"
                data-testid="input-new-level-name"
              />
            </div>
            <div className="space-y-2">
              <Label>Pages</Label>
              <div className="grid grid-cols-2 gap-2">
                {ALL_PAGES.map(({ slug, label }) => (
                  <div key={slug} className="flex items-center gap-2">
                    <Checkbox
                      id={`new-page-${slug}`}
                      checked={newLevelPages.includes(slug)}
                      onCheckedChange={() => setNewLevelPages(togglePage(newLevelPages, slug))}
                      data-testid={`checkbox-new-page-${slug}`}
                    />
                    <label htmlFor={`new-page-${slug}`} className="text-sm cursor-pointer">{label}</label>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button
              onClick={() => createLevel.mutate()}
              disabled={!newLevelName || createLevel.isPending}
              data-testid="button-confirm-add-level"
            >
              Create Level
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Level Dialog */}
      <Dialog open={!!editLevel} onOpenChange={(o) => !o && setEditLevel(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Access Level</DialogTitle>
          </DialogHeader>
          {editLevel && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>Level Name</Label>
                <Input
                  value={editLevel.editName}
                  onChange={(e) => setEditLevel({ ...editLevel, editName: e.target.value })}
                  data-testid="input-edit-level-name"
                />
              </div>
              <div className="space-y-2">
                <Label>Pages</Label>
                <div className="grid grid-cols-2 gap-2">
                  {ALL_PAGES.map(({ slug, label }) => (
                    <div key={slug} className="flex items-center gap-2">
                      <Checkbox
                        id={`edit-page-${slug}`}
                        checked={editLevel.editPages.includes(slug)}
                        onCheckedChange={() => setEditLevel({ ...editLevel, editPages: togglePage(editLevel.editPages, slug) })}
                        data-testid={`checkbox-edit-page-${slug}`}
                      />
                      <label htmlFor={`edit-page-${slug}`} className="text-sm cursor-pointer">{label}</label>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditLevel(null)}>Cancel</Button>
            <Button
              onClick={() => updateLevel.mutate({ id: editLevel.id, name: editLevel.editName, pagesJson: editLevel.editPages })}
              disabled={updateLevel.isPending}
              data-testid="button-confirm-edit-level"
            >
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Settings Page
// ─────────────────────────────────────────────────────────────────────────────
export default function Settings() {
  const { toast } = useToast();
  const [masterUnlocked, setMasterUnlocked] = useState(false);
  const [activeTab, setActiveTab] = useState("general");

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
  const exampleCost = 5.00;
  const exampleRrp = markup > 0 ? exampleCost / (1 - markup / 100) : exampleCost;
  const exampleFoodCostPct = exampleRrp > 0 ? (exampleCost / exampleRrp) * 100 : 0;

  if (!masterUnlocked) {
    return <MasterPasswordGate onUnlock={() => setMasterUnlocked(true)} />;
  }

  return (
    <div className="p-6 space-y-6 max-w-screen-md">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Settings</h1>
          <p className="text-sm text-muted-foreground mt-1">Configure markup, labour rates, and manage staff access.</p>
        </div>
        {activeTab === "general" && (
          <Button onClick={() => save.mutate()} disabled={save.isPending} data-testid="button-save-settings" size="sm">
            <Save size={15} className="mr-1" />
            {save.isPending ? "Saving…" : "Save Settings"}
          </Button>
        )}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="general" data-testid="tab-general">General</TabsTrigger>
          <TabsTrigger value="staff" data-testid="tab-staff">
            <Users size={13} className="mr-1" /> Staff & Access
          </TabsTrigger>
        </TabsList>

        {/* General Settings Tab */}
        <TabsContent value="general" className="mt-4">
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
                    <p className="text-xs text-muted-foreground">Paste the folder ID from the URL when you open your Receipts folder in Drive.</p>
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
        </TabsContent>

        {/* Staff & Access Tab */}
        <TabsContent value="staff" className="mt-4 space-y-8">
          <StaffManagement />
          <div className="border-t border-border pt-6">
            <AccessLevelsManagement />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
