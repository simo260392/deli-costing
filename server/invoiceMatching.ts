// Matching invoice lines to supplier products and ingredients (Oct 2026).
//
// For each product line, in order of trust:
//   1. same supplier + same product code            -> that supplier product (certain)
//   2. same supplier + same wording seen before      -> that supplier product
//   3. same wording matched before in the old Xero imports / invoice memory -> that ingredient
//   4. name similarity (reader's generic name and the description vs ingredient names
//      and other suppliers' wording)                 -> top suggestions, auto-picked only if very close
// Also fills in remembered pack sizes, price change vs last time, and brand warnings.
// No AI here: it's free and predictable.

export type Ingredient = { id: number; name: string; unit: string; category: string | null; avg_weight_per_unit: number | null; best_cost_per_unit: number | null };
export type SupplierProduct = {
  id: number; supplier_id: number; ingredient_id: number | null; supplier_code: string | null; supplier_description: string;
  brand: string | null; base_qty_per_purchase: number | null; pack_size_confirmed: boolean; unit_size_uom: string | null;
  units_per_purchase: number | null; unit_size: number | null; purchase_unit: string | null; priced_by_weight: boolean;
  last_unit_cost: number | null; last_invoice_date: string | null; is_preferred: boolean; ingredient_units_per_base: number | null; item_type: string;
};
export type HistoryMatch = { description: string; ingredient_id: number };

export type LineIn = {
  id: number; line_type: string; supplier_code: string | null; description: string; generic_name: string | null; brand: string | null;
  quantity: number | null; priced_by_weight: boolean; unit_size_uom: string | null; base_qty: number | null; unit_cost: number | null;
  line_total_ex_gst: number | null; needs_pack_size: boolean; item_type: string | null;
};
export type Suggestion = { ingredientId: number; name: string; unit: string; score: number; why: string };
export type LineMatch = {
  supplier_product_id: number | null; ingredient_id: number | null; match_method: string | null; match_confidence: number | null;
  suggestions: Suggestion[]; warnings: string[]; price_change_pct: number | null;
  base_qty: number | null; unit_cost: number | null; needs_pack_size: boolean; item_type: string | null;
  ingredient_units_per_base: number | null; // conversion from the line's base unit to the ingredient's unit, when known
  random_weight: boolean;                    // priced per kg but the invoice has no weight: ask for price/kg or weight each time
};

// ─── Text similarity ─────────────────────────────────────────────────────────
const ABBREV: Record<string, string> = {
  chse: "cheese", chs: "cheese", brkf: "breakfast", breakf: "breakfast", bkfst: "breakfast", saus: "sausage", sausages: "sausage",
  tom: "tomato", toms: "tomato", tomatoes: "tomato", pots: "potato", potatoes: "potato", onions: "onion", crshd: "crushed",
  slcd: "sliced", sli: "sliced", choc: "chocolate", chk: "chicken", chkn: "chicken", bf: "beef", brst: "breast", fil: "fillet",
  fillets: "fillet", mayo: "mayonnaise", veg: "vegetable", veges: "vegetable", frz: "frozen", fz: "frozen", ff: "frozen",
  pce: "piece", pcs: "piece", spr: "spread", strawberry: "strawberries", berry: "berries", lettuce: "lettuce", cos: "cos",
  wrap: "wrap", wraps: "wrap", tortillas: "tortilla", rolls: "roll", buns: "bun", eggs: "egg", olives: "olive",
  "s/cut": "short cut", "s/hurst": "sandhurst", gf: "gluten free", df: "dairy free", "w/meal": "wholemeal", blk: "black",
  plant: "vegan", based: "", grn: "green", wht: "white", rd: "red", lrg: "large", lge: "large", med: "medium", sml: "small", ctn: "", pkt: "", ea: "", eac: "", each: "",
};
const STOP = new Set(["the", "and", "of", "with", "in", "for", "a", "kg", "g", "gm", "gr", "ml", "l", "lt", "ltr", "x", "pk", "pack", "bulk", "caterers", "c", "ks", "fresh", "premium", "natural"]);

export function normaliseText(s: string | null | undefined): string[] {
  const raw = String(s || "").toLowerCase()
    .replace(/s\/cut/g, " short cut ").replace(/s\/hurst/g, " sandhurst ").replace(/w\/meal/g, " wholemeal ")
    .replace(/\(.*?\)/g, " ")
    .replace(/\d+(\.\d+)?\s*(kg|g|gm|gr|ml|l|lt|ltr|oz|mm|cm|pk|'s|s)\b/g, " ")
    .replace(/[^a-z\s]/g, " ");
  return raw.split(/\s+/).map((w) => (w in ABBREV ? ABBREV[w] : w)).join(" ").split(/\s+/)
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map((w) => (w.length > 4 && w.endsWith("es") && !w.endsWith("ses") ? w.slice(0, -2) : w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w));
}

function trigrams(s: string): Set<string> {
  const t = new Set<string>();
  const p = `  ${s} `;
  for (let i = 0; i < p.length - 2; i++) t.add(p.slice(i, i + 3));
  return t;
}

/** 0..1: how alike two product names are (token overlap blended with character similarity). */
export function similarity(a: string | null | undefined, b: string | null | undefined): number {
  const ta = normaliseText(a), tb = normaliseText(b);
  if (!ta.length || !tb.length) return 0;
  const sa = new Set(ta), sb = new Set(tb);
  const shared = Array.from(sa).filter((w) => sb.has(w)).length;
  // How much of the shorter name is covered (an ingredient name is usually the shorter one)
  const coverage = shared / Math.min(sa.size, sb.size);
  const dice = (2 * shared) / (sa.size + sb.size);
  const ga = trigrams(ta.join(" ")), gb = trigrams(tb.join(" "));
  const gShared = Array.from(ga).filter((g) => gb.has(g)).length;
  const tri = (2 * gShared) / (ga.size + gb.size);
  return Math.min(1, 0.45 * coverage + 0.25 * dice + 0.3 * tri);
}

// Words that change what an item is for dietary purposes. If one side has them and the
// other doesn't, never auto-match ("mayonnaise plant based" is not "mayonnaise").
const DIETARY = ["vegan", "plant", "gluten", "gf", "dairy", "df", "halal", "lactose", "sugar", "decaf", "organic", "vegetarian", "keto", "lite", "light", "low"];
function dietaryMismatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const ta = new Set(normaliseText(a).flatMap((w) => w.split(" "))), tb = new Set(normaliseText(b).flatMap((w) => w.split(" ")));
  return DIETARY.some((k) => ta.has(k) !== tb.has(k));
}

const normDesc = (s: string | null | undefined) => String(s || "").toLowerCase().replace(/\s+/g, " ").replace(/\b(eac|each|ea)\b/g, "").trim();

// ─── Units ───────────────────────────────────────────────────────────────────
/** How many ingredient units one base unit (kg / L / each) of the line is. Null when it can't be worked out. */
export function unitFactor(lineUom: string | null, ing: Ingredient): number | null {
  const iu = (ing.unit || "").toLowerCase();
  const lu = (lineUom || "").toLowerCase();
  if (!lu) return null;
  if (iu === lu) return 1;
  if (iu === "g" && lu === "kg") return 1000;
  if (iu === "ml" && lu === "l") return 1000;
  if ((iu === "l" && lu === "kg") || (iu === "kg" && lu === "l")) return 1; // close enough for sauces and oils; editable in review
  if (iu === "each" && lu === "kg" && ing.avg_weight_per_unit) return 1000 / ing.avg_weight_per_unit;
  if (iu === "kg" && lu === "each" && ing.avg_weight_per_unit) return ing.avg_weight_per_unit / 1000;
  return null;
}

// ─── Matching ────────────────────────────────────────────────────────────────
export function matchLines(opts: {
  supplierId: number | null; lines: LineIn[]; ingredients: Ingredient[]; products: SupplierProduct[]; history: HistoryMatch[];
}): Map<number, LineMatch> {
  const { supplierId, lines, ingredients, products, history } = opts;
  const ingById = new Map(ingredients.map((i) => [i.id, i]));
  const ours = products.filter((p) => supplierId && p.supplier_id === supplierId);
  const historyByDesc = new Map<string, number>();
  for (const h of history) if (h.ingredient_id && ingById.has(h.ingredient_id)) historyByDesc.set(normDesc(h.description), h.ingredient_id);
  const result = new Map<number, LineMatch>();

  for (const l of lines) {
    const m: LineMatch = {
      supplier_product_id: null, ingredient_id: null, match_method: null, match_confidence: null, suggestions: [], warnings: [],
      price_change_pct: null, base_qty: l.base_qty, unit_cost: l.unit_cost, needs_pack_size: l.needs_pack_size, item_type: l.item_type,
      ingredient_units_per_base: null, random_weight: false,
    };
    if (l.line_type !== "product") { result.set(l.id, m); continue; }

    // 1 & 2: this supplier's own products
    let sp = l.supplier_code ? ours.find((p) => p.supplier_code && p.supplier_code.toLowerCase() === l.supplier_code!.toLowerCase()) : undefined;
    if (sp) { m.match_method = "code"; m.match_confidence = 1; }
    if (!sp) {
      sp = ours.find((p) => normDesc(p.supplier_description) === normDesc(l.description));
      if (sp) { m.match_method = "description"; m.match_confidence = 0.95; }
    }
    if (sp) {
      m.supplier_product_id = sp.id;
      m.ingredient_id = sp.ingredient_id;
      if (sp.item_type) m.item_type = sp.item_type;
      // Remembered pack size (e.g. Spud Shed bacon = 1kg) when the invoice doesn't say
      if (m.needs_pack_size && sp.priced_by_weight) m.random_weight = true;
      else if (m.needs_pack_size && sp.base_qty_per_purchase && l.quantity) {
        m.base_qty = Math.round(l.quantity * sp.base_qty_per_purchase * 10000) / 10000;
        m.unit_cost = l.line_total_ex_gst !== null ? Math.round((l.line_total_ex_gst / m.base_qty) * 10000) / 10000 : null;
        m.needs_pack_size = false;
      }
      if (sp.ingredient_units_per_base) m.ingredient_units_per_base = Number(sp.ingredient_units_per_base);
    }

    // 3: matched before in the old imports
    if (!m.ingredient_id) {
      const hid = historyByDesc.get(normDesc(l.description));
      if (hid) { m.ingredient_id = hid; m.match_method = "suggested"; m.match_confidence = 0.85; }
    }

    // 4: similarity suggestions (always worked out, so the reviewer can see alternatives)
    const scored: Suggestion[] = [];
    for (const ing of ingredients) {
      if (/delete me/i.test(ing.name)) continue;
      const byGeneric = similarity(l.generic_name, ing.name);
      const byDesc = similarity(l.description, ing.name);
      let score = Math.max(byGeneric, byDesc * 0.95);
      let why = byGeneric >= byDesc ? "name" : "description";
      if (dietaryMismatch(`${l.description} ${l.generic_name || ""}`, ing.name)) { score = Math.min(score, 0.7); why += ", dietary words differ"; }
      // Other suppliers' wording for this ingredient
      for (const p of products) {
        if (p.ingredient_id !== ing.id || p.supplier_id === supplierId) continue;
        const s2 = similarity(l.description, p.supplier_description) * 0.9;
        if (s2 > score) { score = s2; why = "other supplier"; }
      }
      if (score >= 0.35) scored.push({ ingredientId: ing.id, name: ing.name, unit: ing.unit, score: Math.round(score * 100) / 100, why });
    }
    scored.sort((a, b) => b.score - a.score);
    m.suggestions = scored.slice(0, 4);
    if (!m.ingredient_id && m.suggestions[0] && m.suggestions[0].score >= 0.8 && (!m.suggestions[1] || m.suggestions[0].score - m.suggestions[1].score >= 0.1)) {
      m.ingredient_id = m.suggestions[0].ingredientId; m.match_method = "suggested"; m.match_confidence = m.suggestions[0].score;
    }
    // The old imports page made some wrong matches. If its pick is clearly worse than the
    // closest name (e.g. "Croissant Chocolate Large" -> Hazelnut Choc instead of Chocolate Croissant),
    // go with the closest name.
    if (m.match_method === "suggested" && m.match_confidence === 0.85 && m.suggestions[0]) {
      const histIng = ingById.get(m.ingredient_id!);
      const histScore = histIng ? Math.max(similarity(l.generic_name, histIng.name), similarity(l.description, histIng.name) * 0.95) : 0; // same scale as suggestions
      if (m.suggestions[0].ingredientId !== m.ingredient_id && m.suggestions[0].score >= 0.8 && m.suggestions[0].score - histScore >= 0.2) {
        m.ingredient_id = m.suggestions[0].ingredientId; m.match_confidence = m.suggestions[0].score;
      }
    }

    // Units, price change and brand warnings once we know the ingredient
    const ing = m.ingredient_id ? ingById.get(m.ingredient_id) : undefined;
    if (ing) {
      const lineUom = l.priced_by_weight ? "kg" : (l.unit_size_uom || sp?.unit_size_uom || null);
      if (m.ingredient_units_per_base === null) m.ingredient_units_per_base = unitFactor(lineUom, ing);
      if (m.ingredient_units_per_base === null && !m.needs_pack_size) m.warnings.push(`Bought per ${lineUom || "unit"} but the ingredient is measured per ${ing.unit}; set the conversion.`);
      const costInIngUnits = m.unit_cost !== null && m.ingredient_units_per_base ? m.unit_cost / m.ingredient_units_per_base : null;
      const prev = sp?.last_unit_cost ?? null;
      if (costInIngUnits !== null && prev && prev > 0) m.price_change_pct = Math.round(((costInIngUnits - prev) / prev) * 1000) / 10;
      // Sanity check against what's on file: a 3x jump usually means the pack size or unit is wrong
      const onFile = prev || (ing.best_cost_per_unit && ing.best_cost_per_unit > 0 ? ing.best_cost_per_unit : null);
      if (costInIngUnits !== null && onFile && (costInIngUnits > onFile * 3 || costInIngUnits < onFile / 3)) {
        m.warnings.push(`Works out at $${costInIngUnits.toFixed(costInIngUnits < 1 ? 4 : 2)} per ${ing.unit} but $${onFile.toFixed(onFile < 1 ? 4 : 2)} is on file. Check the pack size and unit.`);
      }
      // Brand differs from what we usually buy for this ingredient
      const usual = products.find((p) => p.ingredient_id === ing.id && p.is_preferred) ;
      if (l.brand && usual?.brand && usual.brand.toLowerCase() !== l.brand.toLowerCase()) {
        m.warnings.push(`Usually ${usual.brand}; this is ${l.brand}. Check dietaries (gluten, halal, vegan) before approving.`);
      }
    }
    result.set(l.id, m);
  }
  return result;
}
