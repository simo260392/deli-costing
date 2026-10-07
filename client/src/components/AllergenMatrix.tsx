import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Check, CheckCircle2, Loader2 } from "lucide-react";

// Labels stored in ingredients.dietaries_json — the "contains" list the
// product allergen / dietary calculations read. Keep in sync with the server.
const ALLERGEN_COLUMNS = [
  { key: "Gluten", label: "Gluten" },
  { key: "Dairy", label: "Dairy" },
  { key: "Eggs", label: "Eggs" },
  { key: "Tree Nuts", label: "Tree nuts" },
  { key: "Peanuts", label: "Peanuts" },
  { key: "Sesame", label: "Sesame" },
  { key: "Soy", label: "Soy" },
  { key: "Fish", label: "Fish" },
  { key: "Crustacea", label: "Crustacea" },
  { key: "Molluscs", label: "Molluscs" },
  { key: "Sulphites", label: "Sulphites" },
  { key: "Lupin", label: "Lupin" },
] as const;
const DIET_COLUMNS = [
  { key: "Meat", label: "Meat / poultry", hint: "Not vegetarian" },
  { key: "Honey", label: "Honey", hint: "Not vegan" },
] as const;
const ALL_KEYS = [...ALLERGEN_COLUMNS, ...DIET_COLUMNS].map((c) => c.key as string);

export interface MatrixIngredient {
  id: number;
  name: string;
  category: string;
  dietariesJson?: string;
  allergensReviewedAt?: string | null;
}

const isNonFood = (cat: string) => /packag|cleaning/i.test(cat || "");
const parse = (s?: string) => { try { const v = JSON.parse(s || "[]"); return Array.isArray(v) ? v.map(String) : []; } catch { return []; } };

export function AllergenMatrix({ ingredients }: { ingredients: MatrixIngredient[] }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [onlyUnconfirmed, setOnlyUnconfirmed] = useState(false);
  const [saving, setSaving] = useState<Record<number, boolean>>({});

  const food = useMemo(
    () => ingredients.filter((i) => !isNonFood(i.category)).sort((a, b) => a.name.localeCompare(b.name)),
    [ingredients],
  );
  const rows = onlyUnconfirmed ? food.filter((i) => !i.allergensReviewedAt) : food;
  const confirmedCount = food.filter((i) => i.allergensReviewedAt).length;

  // Apply a saved row to the shared ingredients cache
  const applyToCache = (id: number, patch: Partial<MatrixIngredient>) => {
    qc.setQueryData<any[]>(["/api/ingredients"], (prev) =>
      (prev || []).map((i) => (i.id === id ? { ...i, ...patch } : i)),
    );
  };

  const save = async (ing: MatrixIngredient, body: { contains?: string[]; confirmed?: boolean }, optimistic: Partial<MatrixIngredient>) => {
    const before = { dietariesJson: ing.dietariesJson, allergensReviewedAt: ing.allergensReviewedAt };
    applyToCache(ing.id, optimistic);
    setSaving((s) => ({ ...s, [ing.id]: true }));
    try {
      const r = await apiRequest("PATCH", `/api/ingredients/${ing.id}/allergens`, body);
      const saved = await r.json();
      if (!r.ok) throw new Error(saved?.error || `HTTP ${r.status}`);
      applyToCache(ing.id, { dietariesJson: saved.dietariesJson, allergensReviewedAt: saved.allergensReviewedAt });
    } catch (e: any) {
      applyToCache(ing.id, before);
      toast({ title: `Couldn't save ${ing.name}`, description: e.message, variant: "destructive" });
    } finally {
      setSaving((s) => ({ ...s, [ing.id]: false }));
    }
  };

  const toggle = (ing: MatrixIngredient, key: string) => {
    const current = parse(ing.dietariesJson);
    const next = current.includes(key) ? current.filter((k) => k !== key) : [...current, key];
    const contains = next.filter((k) => ALL_KEYS.includes(k));
    save(ing, { contains }, { dietariesJson: JSON.stringify(next) });
  };

  const setConfirmed = (ing: MatrixIngredient, confirmed: boolean) =>
    save(ing, { confirmed }, { allergensReviewedAt: confirmed ? new Date().toISOString() : null });

  const columnCount = (key: string) => food.filter((i) => parse(i.dietariesJson).includes(key)).length;
  const pctDone = food.length ? Math.round((confirmedCount / food.length) * 100) : 0;

  return (
    <div className="space-y-3">
      {/* Progress + filter */}
      <div className="flex items-center gap-4 flex-wrap rounded-lg border border-border bg-card px-4 py-3">
        <div className="flex-1 min-w-[220px]">
          <div className="flex items-baseline justify-between text-sm">
            <span className="font-medium text-foreground">{confirmedCount} of {food.length} ingredients confirmed</span>
            <span className="text-xs text-muted-foreground tabular-nums">{pctDone}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-muted mt-1.5 overflow-hidden">
            <div className="h-full bg-green-600 rounded-full transition-all" style={{ width: `${pctDone}%` }} />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer select-none">
          <input
            type="checkbox"
            checked={onlyUnconfirmed}
            onChange={(e) => setOnlyUnconfirmed(e.target.checked)}
            className="h-4 w-4 accent-[#256984]"
            data-testid="checkbox-only-unconfirmed"
          />
          Only show unconfirmed
        </label>
      </div>

      <p className="text-xs text-muted-foreground">
        Tick what each ingredient <strong>contains</strong>. Changes save instantly and flow through to recipe and product
        allergens and dietaries (GF, DF, V, VG…). Press <strong>Confirm</strong> once a row is right — including rows with
        nothing ticked — so you can see what's been checked.
      </p>

      <div className="rounded-lg border border-border overflow-auto max-h-[calc(100vh-260px)]">
        <table className="text-sm border-separate border-spacing-0">
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-30 bg-muted text-left px-3 py-2 text-xs font-semibold text-muted-foreground border-b border-r border-border min-w-[140px] sm:min-w-[180px]">
                Ingredient
              </th>
              {ALLERGEN_COLUMNS.map((c) => (
                <th key={c.key} className="sticky top-0 z-20 bg-muted px-0.5 py-2 text-[10px] font-semibold text-muted-foreground border-b border-border w-[50px] min-w-[50px] align-bottom">
                  <div className="leading-tight">{c.label}</div>
                  <div className="text-[10px] font-normal text-muted-foreground/70 tabular-nums mt-0.5">{columnCount(c.key)}</div>
                </th>
              ))}
              {DIET_COLUMNS.map((c, i) => (
                <th key={c.key} title={c.hint} className={cn(
                  "sticky top-0 z-20 bg-amber-50 dark:bg-amber-950/30 px-0.5 py-2 text-[10px] font-semibold text-amber-800 dark:text-amber-300 border-b border-border w-[62px] min-w-[62px] align-bottom",
                  i === 0 && "border-l-2 border-l-amber-200",
                )}>
                  <div className="leading-tight">{c.label}</div>
                  <div className="text-[10px] font-normal opacity-70 mt-0.5">{c.hint}</div>
                </th>
              ))}
              <th className="sticky top-0 z-20 bg-muted px-3 py-2 text-[11px] font-semibold text-muted-foreground border-b border-l border-border min-w-[96px]">
                Checked
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={ALL_KEYS.length + 2} className="px-4 py-10 text-center text-muted-foreground">
                {onlyUnconfirmed ? "Every ingredient has been confirmed." : "No ingredients match your search."}
              </td></tr>
            )}
            {rows.map((ing) => {
              const contains = new Set(parse(ing.dietariesJson));
              const confirmed = !!ing.allergensReviewedAt;
              return (
                <tr key={ing.id} className="group">
                  <td className="sticky left-0 z-10 bg-background group-hover:bg-muted px-3 py-1.5 border-b border-r border-border">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium text-foreground truncate max-w-[120px] sm:max-w-[200px]" title={ing.name}>{ing.name}</span>
                      {saving[ing.id] && <Loader2 size={11} className="animate-spin text-muted-foreground shrink-0" />}
                    </div>
                    <div className="text-[11px] text-muted-foreground">{ing.category}</div>
                  </td>
                  {[...ALLERGEN_COLUMNS, ...DIET_COLUMNS].map((c, i) => {
                    const on = contains.has(c.key);
                    const diet = i >= ALLERGEN_COLUMNS.length;
                    return (
                      <td key={c.key} className={cn(
                        "border-b border-border text-center group-hover:bg-muted/40 p-0",
                        diet && "bg-amber-50/40 dark:bg-amber-950/10",
                        i === ALLERGEN_COLUMNS.length && "border-l-2 border-l-amber-200",
                      )}>
                        <button
                          onClick={() => toggle(ing, c.key)}
                          aria-pressed={on}
                          aria-label={`${ing.name} contains ${c.label}`}
                          className="w-full h-10 flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-[#256984] focus-visible:ring-inset"
                          data-testid={`cell-${ing.id}-${c.key}`}
                        >
                          <span className={cn(
                            "h-6 w-6 rounded-md border-2 flex items-center justify-center transition-colors",
                            on
                              ? diet ? "bg-amber-500 border-amber-500 text-white" : "bg-red-500 border-red-500 text-white"
                              : "border-gray-300 dark:border-gray-600 hover:border-gray-400",
                          )}>
                            {on && <Check size={14} strokeWidth={3} />}
                          </span>
                        </button>
                      </td>
                    );
                  })}
                  <td className="border-b border-l border-border px-2 group-hover:bg-muted/40">
                    {confirmed ? (
                      <button
                        onClick={() => setConfirmed(ing, false)}
                        title="Click to mark as not checked"
                        className="inline-flex items-center gap-1 text-xs font-medium text-green-700 dark:text-green-400 hover:opacity-70"
                        data-testid={`button-unconfirm-${ing.id}`}
                      >
                        <CheckCircle2 size={14} />
                        {new Date(ing.allergensReviewedAt!).toLocaleDateString("en-AU", { day: "numeric", month: "short", timeZone: "Australia/Perth" })}
                      </button>
                    ) : (
                      <button
                        onClick={() => setConfirmed(ing, true)}
                        className="text-xs font-medium rounded-md border border-[#256984]/40 text-[#256984] px-2.5 py-1 hover:bg-[#256984] hover:text-white transition-colors"
                        data-testid={`button-confirm-${ing.id}`}
                      >
                        Confirm
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
