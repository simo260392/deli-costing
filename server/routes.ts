import type { Express } from "express";
import type { Server } from "http";
import { randomUUID } from "crypto";
import multer from "multer";
import path from "path";
import fs from "fs";
import os from "os";
import PDFDocument from "pdfkit";
import Anthropic from "@anthropic-ai/sdk";
import { storage, supabase } from "./storage";

const anthropic = new Anthropic();

const upload = multer({ dest: "uploads/" });
const pdfUpload = multer({ dest: "uploads/pdf-cache/" });
const memoryUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// PDF cache directory
const PDF_CACHE_DIR = path.join(process.cwd(), "uploads", "pdf-cache");

// Helper: compute the effective cost for a quantity of an ingredient.
// For "each" ingredients: quantity is now a whole-number COUNT of units.
// For kg/g/l/ml ingredients: quantity is in kg or g as before.
async function ingredientLineCost(ingredientId: number, quantity: number): Promise<number> {
  const ing = await storage.getIngredient(ingredientId);
  if (!ing) return 0;
  // "each" ingredients: quantity = count of individual units
  // bestCostPerUnit is always stored as the true per-each price
  if (ing.unit === "each" || ing.unit === "Each") {
    return quantity * ing.bestCostPerUnit;
  }
  return ing.bestCostPerUnit * quantity;
}

// ── Nutrition helpers ───────────────────────────────────────────────────────
// Nutrition values are always stored as per-100g (or per-100ml) on the ingredient.
// All rollup happens in the same unit (grams = standard base).

export interface NutritionValues {
  energy: number;    // kJ
  protein: number;   // g
  fatTotal: number;  // g
  fatSat: number;    // g
  carbs: number;     // g
  sugars: number;    // g
  sodium: number;    // mg
}

const EMPTY_NUTRITION: NutritionValues = { energy: 0, protein: 0, fatTotal: 0, fatSat: 0, carbs: 0, sugars: 0, sodium: 0 };

function parseNutrition(json: string | null | undefined): NutritionValues | null {
  if (!json) return null;
  try {
    const p = JSON.parse(json);
    if (typeof p !== "object" || p === null) return null;
    return {
      energy:   typeof p.energy   === "number" ? p.energy   : 0,
      protein:  typeof p.protein  === "number" ? p.protein  : 0,
      fatTotal: typeof p.fatTotal === "number" ? p.fatTotal : 0,
      fatSat:   typeof p.fatSat   === "number" ? p.fatSat   : 0,
      carbs:    typeof p.carbs    === "number" ? p.carbs    : 0,
      sugars:   typeof p.sugars   === "number" ? p.sugars   : 0,
      sodium:   typeof p.sodium   === "number" ? p.sodium   : 0,
    };
  } catch { return null; }
}

function addNutrition(a: NutritionValues, b: NutritionValues, factor = 1): NutritionValues {
  return {
    energy:   a.energy   + b.energy   * factor,
    protein:  a.protein  + b.protein  * factor,
    fatTotal: a.fatTotal + b.fatTotal * factor,
    fatSat:   a.fatSat   + b.fatSat   * factor,
    carbs:    a.carbs    + b.carbs    * factor,
    sugars:   a.sugars   + b.sugars   * factor,
    sodium:   a.sodium   + b.sodium   * factor,
  };
}

function scaleNutrition(n: NutritionValues, factor: number): NutritionValues {
  return {
    energy:   n.energy   * factor,
    protein:  n.protein  * factor,
    fatTotal: n.fatTotal * factor,
    fatSat:   n.fatSat   * factor,
    carbs:    n.carbs    * factor,
    sugars:   n.sugars   * factor,
    sodium:   n.sodium   * factor,
  };
}

// Get how many grams an ingredient line represents.
// For kg/l: qty in kg → multiply by 1000.
// For g/ml: qty already in grams/ml.
// For each: qty is a count → count × avgWeightPerUnit(g).
// For each without avgWeight: cannot determine → return null.
async function ingredientQtyToGrams(ingredientId: number, quantity: number): Promise<number | null> {
  const ing = await storage.getIngredient(ingredientId);
  if (!ing) return null;
  const unit = (ing.unit || "").toLowerCase();
  if (unit === "kg" || unit === "l" || unit === "litre" || unit === "liter") return quantity * 1000;
  if (unit === "g" || unit === "ml") return quantity;
  if ((unit === "each" || unit === "") && ing.avgWeightPerUnit && ing.avgWeightPerUnit > 0) {
    // quantity is now a count of individual units; avgWeightPerUnit is in grams
    return quantity * ing.avgWeightPerUnit;
  }
  return null; // cannot determine
}

// Compute total batch weight in grams from ingredient lines
async function computeBatchWeightGrams(
  ingredientsJson: string,
  subRecipesJson: string,
  recipesJson?: string
): Promise<number | null> {
  const lines: { ingredientId: number; quantity: number }[] = JSON.parse(ingredientsJson || "[]");
  const srLines: { subRecipeId: number; quantity: number }[] = JSON.parse(subRecipesJson || "[]");
  const rLines: { recipeId: number; quantity: number }[] = JSON.parse(recipesJson || "[]");
  let totalGrams = 0;
  let hasAny = false;
  for (const line of lines) {
    const ing = await storage.getIngredient(line.ingredientId);
    if (!ing) continue;
    // Skip packaging items — they don't contribute to edible weight
    if ((ing as any).category === "Packaging") continue;
    const grams = await ingredientQtyToGrams(line.ingredientId, line.quantity);
    if (grams === null) continue;
    totalGrams += grams;
    hasAny = true;
  }
  // Sub-recipes: use their own batch weight × quantity
  for (const line of srLines) {
    const sr = await storage.getSubRecipe(line.subRecipeId);
    if (!sr) continue;
    const srWeight = await computeBatchWeightGrams(
      (sr as any).ingredientsJson || "[]",
      (sr as any).subRecipesJson || "[]"
    );
    if (srWeight === null) continue;
    // sr yieldAmount: divide total batch weight by yield to get per-unit weight, then × qty used
    const yieldAmt = (sr.yieldAmount && sr.yieldAmount > 0) ? sr.yieldAmount : 1;
    totalGrams += (srWeight / yieldAmt) * line.quantity;
    hasAny = true;
  }
  // Nested recipes
  for (const line of rLines) {
    const r = await storage.getRecipe(line.recipeId);
    if (!r) continue;
    const rWeight = await computeBatchWeightGrams(
      (r as any).ingredientsJson || "[]",
      (r as any).subRecipesJson || "[]",
      (r as any).recipesJson || "[]"
    );
    if (rWeight === null) continue;
    const portions = (r.portionCount && r.portionCount > 0) ? r.portionCount : 1;
    totalGrams += (rWeight / portions) * line.quantity;
    hasAny = true;
  }
  return hasAny ? totalGrams : null;
}

// Compute total nutrition for a set of ingredient lines (returns total, not per-serve)
async function computeIngredientLinesNutrition(ingredientsJson: string): Promise<NutritionValues> {
  const lines: { ingredientId: number; quantity: number }[] = JSON.parse(ingredientsJson || "[]");
  let total = { ...EMPTY_NUTRITION };
  for (const line of lines) {
    const ing = await storage.getIngredient(line.ingredientId);
    if (!ing) continue;
    const n = parseNutrition((ing as any).nutritionJson);
    if (!n) continue;
    const grams = await ingredientQtyToGrams(line.ingredientId, line.quantity);
    if (grams === null) continue;
    // n is per 100g — scale by grams/100
    total = addNutrition(total, n, grams / 100);
  }
  return total;
}

// Compute nutrition for sub-recipe lines (each sub-recipe has stored nutrition per yield unit)
async function computeSubRecipeLinesNutrition(subRecipesJson: string, quantities: { subRecipeId: number; quantity: number }[] | null = null): Promise<NutritionValues> {
  const lines: { subRecipeId: number; quantity: number }[] = quantities ?? JSON.parse(subRecipesJson || "[]");
  let total = { ...EMPTY_NUTRITION };
  for (const line of lines) {
    const sr = await storage.getSubRecipe(line.subRecipeId);
    if (!sr) continue;
    const n = parseNutrition((sr as any).nutritionJson);
    if (!n) continue;
    // sr.nutritionJson is per yield unit — multiply by quantity
    total = addNutrition(total, n, line.quantity);
  }
  return total;
}

// Compute sub-recipe total nutrition (per yield unit after dividing by yield)
async function computeSubRecipeNutrition(ingredientsJson: string, subRecipesJson: string, yieldAmount: number): Promise<NutritionValues> {
  const fromIngredients = await computeIngredientLinesNutrition(ingredientsJson);
  const fromSubRecipes = await computeSubRecipeLinesNutrition(subRecipesJson);
  const total = addNutrition(fromIngredients, fromSubRecipes);
  const yield_ = yieldAmount > 0 ? yieldAmount : 1;
  // Yield is typically in "each" or kg — for per-yield-unit we just divide by count
  return scaleNutrition(total, 1 / yield_);
}

// Compute recipe nutrition per serve
async function computeRecipeNutrition(
  ingredientsJson: string,
  subRecipesJson: string,
  recipesJson: string,
  portionCount: number
): Promise<NutritionValues> {
  const fromIngredients = await computeIngredientLinesNutrition(ingredientsJson);
  const fromSubRecipes = await computeSubRecipeLinesNutrition(subRecipesJson);
  // Nested recipes: use their per-serve nutrition × quantity
  const recipeLines: { recipeId: number; quantity: number }[] = JSON.parse(recipesJson || "[]");
  let fromRecipes = { ...EMPTY_NUTRITION };
  for (const line of recipeLines) {
    const r = await storage.getRecipe(line.recipeId);
    if (!r) continue;
    const n = parseNutrition((r as any).nutritionJson);
    if (!n) continue;
    fromRecipes = addNutrition(fromRecipes, n, line.quantity);
  }
  const totalBatch = addNutrition(addNutrition(fromIngredients, fromSubRecipes), fromRecipes);
  const serves = portionCount > 0 ? portionCount : 1;
  return scaleNutrition(totalBatch, 1 / serves);
}

// Compute platter nutrition per serve (platter servingsPerPackage used as divisor)
async function computePlatterNutrition(itemsJson: string, servingsPerPackage: number | null): Promise<NutritionValues> {
  const items: { type: "recipe" | "subrecipe" | "ingredient"; id: number; quantity: number }[] = JSON.parse(itemsJson || "[]");
  let total = { ...EMPTY_NUTRITION };
  for (const item of items) {
    if (item.type === "recipe") {
      const r = await storage.getRecipe(item.id);
      if (!r) continue;
      const n = parseNutrition((r as any).nutritionJson);
      if (!n) continue;
      total = addNutrition(total, n, item.quantity);
    } else if (item.type === "subrecipe") {
      const sr = await storage.getSubRecipe(item.id);
      if (!sr) continue;
      const n = parseNutrition((sr as any).nutritionJson);
      if (!n) continue;
      total = addNutrition(total, n, item.quantity);
    } else {
      // ingredient
      const ing = await storage.getIngredient(item.id);
      if (!ing) continue;
      const n = parseNutrition((ing as any).nutritionJson);
      if (!n) continue;
      const grams = await ingredientQtyToGrams(item.id, item.quantity);
      if (grams === null) continue;
      total = addNutrition(total, n, grams / 100);
    }
  }
  const serves = (servingsPerPackage && servingsPerPackage > 0) ? servingsPerPackage : 1;
  return scaleNutrition(total, 1 / serves);
}

// Helper: compute costs for a recipe given current ingredient/sub-recipe data
async function computeRecipeCosts(
  ingredientsJson: string,
  subRecipesJson: string,
  packagingJson: string,
  labourMinutes: number,
  markupPercent: number,
  hourlyRate: number,
  portionCount: number,
  rrp?: number | null,
  wholesaleMarkupPercent?: number,
  wholesaleRrp?: number | null,
  recipesJson?: string  // nested full recipes used as components
) {
  const ingredientLines: { ingredientId: number; quantity: number }[] = JSON.parse(ingredientsJson || "[]");
  const subRecipeLines: { subRecipeId: number; quantity: number }[] = JSON.parse(subRecipesJson || "[]");
  const recipeLines: { recipeId: number; quantity: number }[] = JSON.parse(recipesJson || "[]");
  const packagingLines: { ingredientId: number; quantity: number }[] = JSON.parse(packagingJson || "[]");

  let ingredientCost = 0;
  for (const line of ingredientLines) {
    ingredientCost += await ingredientLineCost(line.ingredientId, line.quantity);
  }

  let subRecipeCost = 0;
  for (const line of subRecipeLines) {
    const sr = await storage.getSubRecipe(line.subRecipeId);
    if (sr) subRecipeCost += sr.costPerUnit * line.quantity;
  }
  // Nested recipes: use costPerServe × quantity (1 unit = 1 serve)
  for (const line of recipeLines) {
    const r = await storage.getRecipe(line.recipeId);
    if (r) subRecipeCost += (r.costPerServe ?? r.totalCost) * line.quantity;
  }

  let packagingCost = 0;
  for (const line of packagingLines) {
    packagingCost += await ingredientLineCost(line.ingredientId, line.quantity);
  }

  // Labour cost = (minutes / 60) × hourly rate
  const labourCost = (labourMinutes / 60) * hourlyRate;

  // Food cost = ingredients + sub-recipes + packaging (NO labour)
  const foodCost = ingredientCost + subRecipeCost + packagingCost;
  const totalCost = foodCost + labourCost;

  // Per-serve costs
  const serves = portionCount > 0 ? portionCount : 1;
  const foodCostPerServe = foodCost / serves;   // used for food cost %
  const costPerServe = totalCost / serves;       // used for margin (includes labour)

  // Target RRP based on total cost per serve (including labour)
  const targetRrp = markupPercent > 0 ? costPerServe / (1 - markupPercent / 100) : costPerServe;
  const wMarkup = wholesaleMarkupPercent ?? 45;
  const wholesaleTargetRrp = wMarkup > 0 ? costPerServe / (1 - wMarkup / 100) : costPerServe;

  // Margin uses total cost per serve (labour included)
  const marginPercent = rrp && rrp > 0 ? ((rrp - costPerServe) / rrp) * 100 : 0;
  const wholesaleMarginPercent = wholesaleRrp && wholesaleRrp > 0 ? ((wholesaleRrp - costPerServe) / wholesaleRrp) * 100 : 0;

  // Nutrition rollup per serve
  const nutritionPerServe = await computeRecipeNutrition(ingredientsJson, subRecipesJson, recipesJson || "[]", portionCount);
  return { ingredientCost, subRecipeCost, packagingCost, labourCost, totalCost, foodCostPerServe, costPerServe, targetRrp, wholesaleTargetRrp, marginPercent, wholesaleMarginPercent, nutritionJson: JSON.stringify(nutritionPerServe) };
}

// ── Allergen helpers (module-level so cascadeFlexProductCostings can use them) ──
const ALLERGEN_LABEL_TO_CODE_MAP: Record<string, string> = {
  'Gluten': 'CG', 'Tree Nuts': 'CN', 'Nuts': 'CN', 'Nut': 'CN',
  'Dairy': 'CD', 'Milk': 'CD', 'Eggs': 'CE', 'Egg': 'CE',
  'Seafood': 'CS', 'Fish': 'CS', 'Shellfish': 'CS', 'Crustacea': 'CS', 'Molluscs': 'CS',
  'Seeds': 'CX', 'Sesame': 'CX', 'Soy': 'CY', 'Soya': 'CY',
  'Sulphites': 'CU', 'Sulphur Dioxide': 'CU',
};

async function collectSubRecipeIngredientIds(srId: number, visited = new Set<number>()): Promise<number[]> {
  if (visited.has(srId)) return [];
  visited.add(srId);
  const sr = await storage.getSubRecipe(srId);
  if (!sr) return [];
  const ids: number[] = [];
  const directIngs: any[] = JSON.parse(sr.ingredientsJson || "[]");
  for (const item of directIngs) { if (item?.ingredientId) ids.push(item.ingredientId); }
  const nestedSRs: any[] = JSON.parse(sr.subRecipesJson || "[]");
  for (const nested of nestedSRs) {
    if (nested?.subRecipeId) ids.push(...(await collectSubRecipeIngredientIds(nested.subRecipeId, visited)));
  }
  return ids;
}

async function computeAllergensForComponents(components: any[]): Promise<string[]> {
  const codeSet = new Set<string>();
  for (const comp of components) {
    let ingIds: number[] = [];
    if (comp.type === 'recipe') {
      const r = await storage.getRecipe(comp.id);
      if (!r) continue;
      const directIngs: any[] = JSON.parse(r.ingredientsJson || "[]");
      for (const item of directIngs) { if (item?.ingredientId) ingIds.push(item.ingredientId); }
      const subs: any[] = JSON.parse(r.subRecipesJson || "[]");
      for (const sub of subs) {
        if (sub?.subRecipeId) ingIds.push(...(await collectSubRecipeIngredientIds(sub.subRecipeId)));
      }
    } else if (comp.type === 'sub_recipe') {
      ingIds = await collectSubRecipeIngredientIds(comp.id);
    } else if (comp.type === 'ingredient') {
      ingIds = [comp.id];  // direct ingredient
    }
    for (const id of ingIds) {
      const ing = await storage.getIngredient(id);
      if (!ing) continue;
      const labels: string[] = JSON.parse(ing.dietariesJson || "[]");
      for (const label of labels) {
        const code = ALLERGEN_LABEL_TO_CODE_MAP[label];
        if (code) codeSet.add(code);
      }
    }
  }
  return [...codeSet];
}

// Module-level dietaries computation (needs to be accessible from cascadeFlexProductCostings)
// Strategy: derive dietary flags from allergen labels present on ingredients (inverse approach).
// A product is e.g. GF if NO ingredient contains Gluten; DF if none contain Dairy, etc.
// This is reliable because allergen labels (Gluten, Dairy, Eggs…) are already set on ingredients.
async function computeFlexDietaries(components: any[]): Promise<{ allergens: string[], dietaries: string[] }> {
  // Allergens: deep traverse, map labels → codes
  const allergens = await computeAllergensForComponents(components);

  // Collect all allergen labels present across all ingredients
  const allIngredientIds: number[] = [];
  for (const comp of components) {
    if (comp.type === 'recipe') {
      const r = await storage.getRecipe(comp.id);
      if (!r) continue;
      const directIngs: any[] = JSON.parse(r.ingredientsJson || "[]");
      for (const item of directIngs) { if (item?.ingredientId) allIngredientIds.push(item.ingredientId); }
      const subs: any[] = JSON.parse(r.subRecipesJson || "[]");
      for (const sub of subs) {
        if (sub?.subRecipeId) allIngredientIds.push(...(await collectSubRecipeIngredientIds(sub.subRecipeId)));
      }
    } else if (comp.type === 'sub_recipe') {
      allIngredientIds.push(...(await collectSubRecipeIngredientIds(comp.id)));
    } else if (comp.type === 'ingredient') {
      allIngredientIds.push(comp.id);
    }
  }

  if (allIngredientIds.length === 0) {
    return { allergens, dietaries: [] };
  }

  // Collect the set of all allergen labels across every ingredient
  const presentLabels = new Set<string>();
  // Also collect ingredient categories for V/VG detection
  const presentCategories = new Set<string>();
  for (const ingId of allIngredientIds) {
    const ing = await storage.getIngredient(ingId);
    if (!ing) continue;
    const labels: string[] = JSON.parse(ing.dietariesJson || "[]");
    for (const l of labels) presentLabels.add(l);
    if (ing.category) presentCategories.add(ing.category.toLowerCase());
  }

  // Helper: does ANY ingredient contain one of these allergen labels?
  const hasAny = (...labels: string[]) => labels.some(l => presentLabels.has(l));
  // Helper: does ANY ingredient have a category matching meat/fish?
  const MEAT_CATEGORIES = ['meat', 'poultry', 'chicken', 'beef', 'pork', 'lamb', 'seafood', 'fish', 'protein'];
  // 'Protein' category can contain meat (bacon, eggs etc.) — treat as non-vegetarian unless
  // we can tell otherwise. Eggs are actually vegetarian but handled via EF flag, so for V we
  // only care about meat-based proteins. We use category + allergen label 'Eggs' to distinguish.
  const hasMeatCategory = MEAT_CATEGORIES.some(c => presentCategories.has(c));
  // 'Eggs' in dietaries_json means the ingredient contains egg — eggs are V but not VG.
  // Egg ingredients with category 'Meat' (common mislabelling) should not block V flag;
  // instead check: if ALL 'Meat'/'Protein' category ingredients are egg-only, still V.
  // Simpler robust approach: category-based meat check EXCLUDING ingredients whose only
  // label is 'Eggs' (i.e. egg is vegetarian). Check if there's a non-egg meat ingredient.
  let hasActualMeat = false;
  for (const ingId of allIngredientIds) {
    const ing = await storage.getIngredient(ingId);
    if (!ing) continue;
    const cat = (ing.category || '').toLowerCase();
    if (!MEAT_CATEGORIES.includes(cat)) continue;
    const labels: string[] = JSON.parse(ing.dietariesJson || "[]");
    // If this ingredient's category is meat/protein but it ONLY has egg allergen labels,
    // it's likely an egg product (vegetarian). Otherwise it's actual meat.
    const isEggOnly = labels.length > 0 && labels.every(l => l === 'Eggs' || l === 'Egg');
    if (!isEggOnly) {
      hasActualMeat = true;
      break;
    }
  }

  // Derive dietary flags from what IS and ISN'T present:
  // GF  = no Gluten
  // DF  = no Dairy (and no Lactose)
  // LF  = no Dairy (lactose-intolerant safe — same as DF for our purposes)
  // EF  = no Eggs
  // NF  = no Tree Nuts, no Peanuts, no Nuts
  // V   = no actual meat/poultry/fish (eggs are OK for V; category-based detection)
  // VG  = V + no Dairy, no Eggs, no Honey
  // H   = no Pork, no Alcohol (can't fully determine from labels alone — omit if uncertain)
  const isGF  = !hasAny('Gluten');
  const isDF  = !hasAny('Dairy', 'Lactose');
  const isLF  = !hasAny('Dairy', 'Lactose');
  const isEF  = !hasAny('Eggs', 'Egg');
  const isNF  = !hasAny('Tree Nuts', 'Peanuts', 'Peanut', 'Nuts', 'Nut');
  const isV   = !hasActualMeat;
  const isVG  = isV && isDF && isEF && !hasAny('Honey');

  const dietaryList: string[] = [];
  if (isV)  dietaryList.push('V');
  if (isVG) dietaryList.push('VG');
  if (isGF) dietaryList.push('GF');
  if (isDF) dietaryList.push('DF');
  if (isEF) dietaryList.push('EF');
  if (isLF) dietaryList.push('LF');
  if (isNF) dietaryList.push('NF');
  return { allergens, dietaries: dietaryList };
}

// Topological sort + full cascade for sub-recipes → recipes → platters.
// Pass changedSubRecipeIds to limit scope (or empty to recalculate all sub-recipes).
async function cascadeFromSubRecipes(
  changedSubRecipeIds: Set<number>,
  markup: number,
  wholesaleMarkup: number,
  hourlyRate: number
) {
  // 1. Propagate through sub-recipe graph in dependency order
  const allSRs = await storage.getSubRecipes();

  // Build adjacency: srId → set of srIds that depend on it
  const dependents = new Map<number, Set<number>>();
  const inDegree = new Map<number, number>();
  for (const sr of allSRs) {
    inDegree.set(sr.id, 0);
    dependents.set(sr.id, new Set());
  }
  for (const sr of allSRs) {
    const deps: { subRecipeId: number }[] = JSON.parse(sr.subRecipesJson || "[]");
    for (const d of deps) {
      dependents.get(d.subRecipeId)?.add(sr.id);
      inDegree.set(sr.id, (inDegree.get(sr.id) || 0) + 1);
    }
  }

  // Kahn's algorithm — process in dependency order
  const queue: number[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }
  const orderedSRIds: number[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    orderedSRIds.push(id);
    for (const dep of dependents.get(id) || []) {
      const newDeg = (inDegree.get(dep) || 1) - 1;
      inDegree.set(dep, newDeg);
      if (newDeg === 0) queue.push(dep);
    }
  }
  // Any remaining (cycle) just append
  for (const sr of allSRs) {
    if (!orderedSRIds.includes(sr.id)) orderedSRIds.push(sr.id);
  }

  // Recompute sub-recipes in order — only those affected
  // A sub-recipe is affected if it's in changedSubRecipeIds OR uses a changed sub-recipe
  const updatedSRIds = new Set<number>(changedSubRecipeIds);
  for (const id of orderedSRIds) {
    const sr = await storage.getSubRecipe(id);
    if (!sr) continue;
    const deps: { subRecipeId: number }[] = JSON.parse(sr.subRecipesJson || "[]");
    const usesChanged = deps.some((d) => updatedSRIds.has(d.subRecipeId));
    if (updatedSRIds.has(id) || usesChanged) {
      const costs = await computeSubRecipeCosts(sr.ingredientsJson, sr.subRecipesJson || "[]", sr.yieldAmount || 1, (sr as any).labourMinutes || 0, hourlyRate);
      await storage.updateSubRecipe(id, costs);
      updatedSRIds.add(id);
    }
  }

  // 2. Cascade to recipes that use any updated sub-recipe
  const updatedRecipeIds = new Set<number>();
  for (const r of await storage.getRecipes()) {
    const usesSR = JSON.parse(r.subRecipesJson || "[]").some((l: any) => updatedSRIds.has(l.subRecipeId));
    if (usesSR) {
      const rcosts = await computeRecipeCosts(r.ingredientsJson, r.subRecipesJson, r.packagingJson, r.labourMinutes || 0, markup, hourlyRate, r.portionCount || 1, r.rrp, wholesaleMarkup, r.wholesaleRrp, (r as any).recipesJson);
      await storage.updateRecipe(r.id, rcosts);
      updatedRecipeIds.add(r.id);
    }
  }

  // 3. Cascade to ALL platters that contain any updated recipe OR sub-recipe directly
  for (const p of await storage.getPlatters()) {
    const itemLines: any[] = JSON.parse(p.itemsJson || "[]");
    const usesUpdatedRecipe = itemLines.some((l: any) => l.type === "recipe" && updatedRecipeIds.has(l.id));
    const usesUpdatedSubRecipe = itemLines.some((l: any) => l.type === "subrecipe" && changedSubRecipeIds.has(l.id));
    if (usesUpdatedRecipe || usesUpdatedSubRecipe) {
      const pcosts = await computePlatterCosts(p.itemsJson, p.packagingJson, (p as any).labourMinutes || 0, markup, wholesaleMarkup, p.wholesaleRrp, hourlyRate);
      const marginPercent = p.rrp && pcosts.totalCost > 0 ? ((p.rrp - pcosts.totalCost) / p.rrp) * 100 : 0;
      await storage.updatePlatter(p.id, { ...pcosts, marginPercent });
    }
  }

  // 4. Cascade to flex product costings that use any updated recipe OR sub-recipe
  await cascadeFlexProductCostings(updatedRecipeIds, updatedSRIds, hourlyRate);
}

async function cascadeFlexProductCostings(updatedRecipeIds: Set<number>, updatedSRIds: Set<number>, hourlyRate: number) {
  const allCostings = await storage.getAllFlexProductCostings();
  for (const costing of allCostings) {
    const components: any[] = JSON.parse(costing.componentsJson || "[]");
    const usesUpdated = components.some((c: any) =>
      (c.type === "recipe" && updatedRecipeIds.has(c.id)) ||
      (c.type === "sub_recipe" && updatedSRIds.has(c.id))
    );
    if (!usesUpdated) continue;

    // Recompute total cost
    let recipeCost = 0;
    for (const comp of components) {
      if (comp.type === "recipe") {
        const r = await storage.getRecipe(comp.id);
        if (r) recipeCost += (r.totalCost || 0) * (comp.quantity || 1);
      } else if (comp.type === "sub_recipe") {
        const sr = await storage.getSubRecipe(comp.id);
        if (sr) recipeCost += (sr.totalCost || 0) * (comp.quantity || 1);
      }
    }

    const packaging: any[] = JSON.parse(costing.packagingJson || "[]");
    let packagingCost = 0;
    const enrichedPackaging: any[] = [];
    for (const pkg of packaging) {
      const ing = await storage.getIngredient(pkg.ingredientId);
      const unitCost = ing ? (ing.bestCostPerUnit || 0) : 0;
      packagingCost += unitCost * (pkg.quantity || 1);
      enrichedPackaging.push({ ...pkg, costPerUnit: unitCost });
    }

    const labourCost = costing.labourCost || 0;
    const totalCost = recipeCost + packagingCost + labourCost;

    const product = await storage.getFlexProduct(costing.flexProductId);
    const flexPrice = product?.price || 0;
    const profitDollars = flexPrice - totalCost;
    const marginPercent = flexPrice > 0 ? (profitDollars / flexPrice) * 100 : 0;

    // Recompute allergens + dietaries from components
    const allergens = await computeAllergensForComponents(components);
    const { dietaries } = await computeFlexDietaries(components);

    await storage.upsertFlexProductCosting({
      ...costing,
      packagingJson: JSON.stringify(enrichedPackaging),
      recipeCost, packagingCost, totalCost, flexPrice, marginPercent, profitDollars,
      computedAllergensJson: JSON.stringify(allergens),
      computedDietariesJson: JSON.stringify(dietaries),
      updatedAt: new Date().toISOString(),
    });
  }
}

async function computeSubRecipeCosts(ingredientsJson: string, subRecipesJson: string, yieldAmount: number, labourMinutes?: number, hourlyRate?: number) {
  const ingLines: { ingredientId: number; quantity: number }[] = JSON.parse(ingredientsJson || "[]");
  const srLines: { subRecipeId: number; quantity: number }[] = JSON.parse(subRecipesJson || "[]");
  let ingredientCost = 0;
  for (const line of ingLines) {
    ingredientCost += await ingredientLineCost(line.ingredientId, line.quantity);
  }
  let subRecipeCost = 0;
  for (const line of srLines) {
    const sr = await storage.getSubRecipe(line.subRecipeId);
    if (sr) subRecipeCost += sr.costPerUnit * line.quantity;
  }
  const mins = labourMinutes ?? 0;
  const rate = hourlyRate ?? 35;
  const labourCost = (mins / 60) * rate;
  const totalCost = ingredientCost + subRecipeCost + labourCost;
  const costPerUnit = yieldAmount > 0 ? totalCost / yieldAmount : 0;
  // Nutrition rollup per yield unit
  const nutritionPerUnit = await computeSubRecipeNutrition(ingredientsJson, subRecipesJson, yieldAmount);
  return { totalCost, costPerUnit, labourCost, nutritionJson: JSON.stringify(nutritionPerUnit) };
}

async function computePlatterCosts(
  itemsJson: string,
  packagingJson: string,
  labourMinutes: number,
  markupPercent: number,
  wholesaleMarkupPercent?: number,
  wholesaleRrp?: number | null,
  hourlyRate?: number
) {
  const items: { type: "recipe" | "subrecipe" | "ingredient"; id: number; quantity: number }[] = JSON.parse(itemsJson || "[]");
  const packagingLines: { ingredientId: number; quantity: number }[] = JSON.parse(packagingJson || "[]");

  let itemsCost = 0;
  for (const item of items) {
    if (item.type === "recipe") {
      const r = await storage.getRecipe(item.id);
      if (r) itemsCost += (r.costPerServe ?? r.totalCost) * item.quantity;
    } else if (item.type === "subrecipe") {
      const sr = await storage.getSubRecipe(item.id);
      if (sr) itemsCost += (sr.totalCost ?? 0) * item.quantity;
    } else {
      itemsCost += await ingredientLineCost(item.id, item.quantity);
    }
  }

  let packagingCost = 0;
  for (const line of packagingLines) {
    packagingCost += await ingredientLineCost(line.ingredientId, line.quantity);
  }

  const rate = hourlyRate ?? 35;
  const labourCost = (labourMinutes / 60) * rate;
  const totalCost = itemsCost + packagingCost + labourCost;
  const targetRrp = markupPercent > 0 ? totalCost / (1 - markupPercent / 100) : totalCost;
  const wMarkup = wholesaleMarkupPercent ?? 45;
  const wholesaleTargetRrp = wMarkup > 0 ? totalCost / (1 - wMarkup / 100) : totalCost;
  const wholesaleMarginPercent = wholesaleRrp && wholesaleRrp > 0 ? ((wholesaleRrp - totalCost) / wholesaleRrp) * 100 : 0;
  // Nutrition rollup (servingsPerPackage comes from platter record, passed as extra arg if available)
  // We compute it here without servings — caller can pass servingsPerPackage to override
  const nutritionPerServe = await computePlatterNutrition(itemsJson, null);
  return { itemsCost, packagingCost, labourCost, labourMinutes, totalCost, targetRrp, wholesaleTargetRrp, wholesaleMarginPercent, nutritionJson: JSON.stringify(nutritionPerServe) };
}

export function registerRoutes(httpServer: Server, app: Express) {
  const getMarkup = async () => parseFloat(await storage.getSetting("markup_percent") || "65");
  const getWholesaleMarkup = async () => parseFloat(await storage.getSetting("wholesale_markup_percent") || "45");

  // ─── Settings ───────────────────────────────────────────────────────────────
  app.get("/api/settings", async (req, res) => {
    try {
      const all = await storage.getSettings();
      const obj: Record<string, string> = {};
      all.forEach((s) => (obj[s.key] = s.value));
      res.json(obj);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/settings", async (req, res) => {
    try {
      const { key, value } = req.body;
      if (!key || value === undefined) return res.status(400).json({ error: "key and value required" });
      await storage.setSetting(key, String(value));
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Suppliers ──────────────────────────────────────────────────────────────
  app.get("/api/suppliers", async (req, res) => res.json(await storage.getSuppliers()));

  app.post("/api/suppliers", async (req, res) => {
    try {
      const s = await storage.createSupplier(req.body);
      res.json(s);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.put("/api/suppliers/:id", async (req, res) => {
    const s = await storage.updateSupplier(Number(req.params.id), req.body);
    if (!s) return res.status(404).json({ error: "Not found" });
    res.json(s);
  });

  app.delete("/api/suppliers/:id", async (req, res) => {
    await storage.deleteSupplier(Number(req.params.id));
    res.json({ ok: true });
  });

  // ─── Ingredients ────────────────────────────────────────────────────────────
  app.get("/api/ingredients", async (req, res) => {
    try {
      const list = (await storage.getIngredients()).sort((a, b) => a.name.localeCompare(b.name));
      // Enrich with best supplier name
      const sups = await storage.getSuppliers();
      const supMap: Record<number, string> = {};
      sups.forEach((s) => (supMap[s.id] = s.name));
      const enriched = list.map((i) => ({
        ...i,
        bestSupplierName: i.bestSupplierId ? supMap[i.bestSupplierId] : null,
      }));
      res.json(enriched);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/ingredients", async (req, res) => {
    try {
      const i = await storage.createIngredient(req.body);
      res.json(i);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.put("/api/ingredients/:id", async (req, res) => {
    const i = await storage.updateIngredient(Number(req.params.id), req.body);
    if (!i) return res.status(404).json({ error: "Not found" });
    // Cascade: ingredient → sub-recipes (full chain) → recipes → platters
    try {
      const markup = await getMarkup();
      const wholesaleMarkup = await getWholesaleMarkup();
      const hourlyRate = parseFloat(await storage.getSetting("labour_rate_per_hour") || "35");
      const ingId = Number(req.params.id);

      // Find sub-recipes that directly use this ingredient, then cascade through the whole graph
      const directlySRs = (await storage.getSubRecipes())
        .filter((sr) => JSON.parse(sr.ingredientsJson || "[]").some((l: any) => l.ingredientId === ingId))
        .map((sr) => sr.id);

      if (directlySRs.length > 0) {
        await cascadeFromSubRecipes(new Set(directlySRs), markup, wholesaleMarkup, hourlyRate);
      }

      // Also recalculate recipes/platters that use this ingredient DIRECTLY (not via sub-recipe)
      const updatedRecipeIds = new Set<number>(
        // include recipes already updated via the sub-recipe cascade above
        (await storage.getRecipes())
          .filter((r) => JSON.parse(r.subRecipesJson || "[]").some((l: any) => directlySRs.includes(l.subRecipeId)))
          .map((r) => r.id)
      );
      for (const r of await storage.getRecipes()) {
        const usesIng = JSON.parse(r.ingredientsJson || "[]").some((l: any) => l.ingredientId === ingId);
        const usesPkg = JSON.parse(r.packagingJson || "[]").some((l: any) => l.ingredientId === ingId);
        if (usesIng || usesPkg) {
          const costs = await computeRecipeCosts(r.ingredientsJson, r.subRecipesJson, r.packagingJson, r.labourMinutes || 0, markup, hourlyRate, r.portionCount || 1, r.rrp, wholesaleMarkup, r.wholesaleRrp, (r as any).recipesJson);
          await storage.updateRecipe(r.id, costs);
          updatedRecipeIds.add(r.id);
        }
      }
      // Recalculate ALL platters that use any updated recipe or the ingredient directly
      for (const p of await storage.getPlatters()) {
        const usesIng = JSON.parse(p.itemsJson || "[]").some((l: any) => l.id === ingId && l.type === "ingredient");
        const usesPkg = JSON.parse(p.packagingJson || "[]").some((l: any) => l.ingredientId === ingId);
        const usesUpdatedRecipe = JSON.parse(p.itemsJson || "[]").some((l: any) => l.type === "recipe" && updatedRecipeIds.has(l.id));
        if (usesIng || usesPkg || usesUpdatedRecipe) {
          const costs = await computePlatterCosts(p.itemsJson, p.packagingJson, (p as any).labourMinutes || 0, markup, wholesaleMarkup, p.wholesaleRrp, hourlyRate);
          const marginPercent = p.rrp && costs.totalCost > 0 ? ((p.rrp - costs.totalCost) / p.rrp) * 100 : 0;
          await storage.updatePlatter(p.id, { ...costs, marginPercent });
        }
      }
      // Also cascade to flex product costings
      const directSRSet = new Set(directlySRs);
      cascadeFlexProductCostings(updatedRecipeIds, directSRSet, hourlyRate);

      // If this ingredient is used as packaging in any flex product costing, recompute those too
      const allCostings = await storage.getAllFlexProductCostings();
      for (const fc of allCostings) {
        const pkgLines: any[] = JSON.parse(fc.packagingJson || '[]');
        const usedAsPackaging = pkgLines.some((p: any) => p.ingredientId === ingId);
        const alreadyUpdated = (() => {
          const comps: any[] = JSON.parse(fc.componentsJson || '[]');
          return comps.some((c: any) =>
            (c.type === 'recipe' && updatedRecipeIds.has(c.id)) ||
            (c.type === 'sub_recipe' && directSRSet.has(c.id))
          );
        })();
        if (usedAsPackaging && !alreadyUpdated) {
          // Recompute only packaging cost for this costing
          let newPackagingCost = 0;
          for (const pkg of pkgLines) {
            const pkgIng = await storage.getIngredient(pkg.ingredientId);
            if (pkgIng) newPackagingCost += (pkgIng.bestCostPerUnit || 0) * (pkg.quantity || 1);
          }
          const components: any[] = JSON.parse(fc.componentsJson || '[]');
          let newRecipeCost = 0;
          for (const comp of components) {
            if (comp.type === 'recipe') {
              const r = await storage.getRecipe(comp.id);
              if (r) newRecipeCost += (r.totalCost || 0) * (comp.quantity || 1);
            } else if (comp.type === 'sub_recipe') {
              const sr = await storage.getSubRecipe(comp.id);
              if (sr) newRecipeCost += (sr.totalCost || 0) * (comp.quantity || 1);
            } else if (comp.type === 'ingredient') {
              const ci = await storage.getIngredient(comp.id);
              if (ci) newRecipeCost += (ci.bestCostPerUnit || 0) * (comp.quantity || 1);
            }
          }
          const newLabourCost = fc.labourCost || 0;
          const newTotalCost = newRecipeCost + newPackagingCost + newLabourCost;
          const fpProduct = await storage.getFlexProduct(fc.flexProductId);
          const flexPrice = fpProduct?.price || 0;
          const profitDollars = flexPrice - newTotalCost;
          const marginPercent = flexPrice > 0 ? (profitDollars / flexPrice) * 100 : 0;
          const allergens = await computeAllergensForComponents(components);
          const { dietaries } = await computeFlexDietaries(components);
          await storage.upsertFlexProductCosting({
            ...fc,
            recipeCost: newRecipeCost,
            packagingCost: newPackagingCost,
            totalCost: newTotalCost,
            flexPrice,
            marginPercent,
            profitDollars,
            computedAllergensJson: JSON.stringify(allergens),
            computedDietariesJson: JSON.stringify(dietaries),
            updatedAt: new Date().toISOString(),
          });
        }
      }
    } catch (_) {}
    res.json(i);
  });

  app.delete("/api/ingredients/:id", async (req, res) => {
    try {
      await storage.deleteIngredient(Number(req.params.id));
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Auto-classify dietaries for a single ingredient via LLM
  app.post("/api/ingredients/:id/auto-dietaries", async (req, res) => {
    const ing = await storage.getIngredient(Number(req.params.id));
    if (!ing) return res.status(404).json({ error: "Not found" });
    const ALLERGENS = ["Gluten","Tree Nuts","Dairy","Eggs","Peanuts","Sesame","Soy","Fish","Sulphites","Crustacea","Molluscs"];
    const prompt = `You are a food allergen expert. Given this ingredient name and category, return ONLY a JSON array of allergen keys that this ingredient DEFINITELY contains.

Ingredient: "${ing.name}"
Category: "${ing.category}"

Allowed keys (only return keys from this list): ${ALLERGENS.join(", ")}

Rules:
- Be conservative — only include an allergen if it is clearly present in this ingredient
- Gluten: contains wheat, barley, rye, oats, or their derivatives (bread, pasta, flour, soy sauce, etc.)
- Tree Nuts: almonds, cashews, walnuts, pecans, pistachios, macadamia, hazelnut, brazil nuts, pine nuts
- Dairy: milk, cheese, butter, cream, yogurt, whey, lactose, casein
- Eggs: egg, mayonnaise, aioli (unless explicitly vegan)
- Peanuts: peanut butter, satay sauce
- Sesame: tahini, sesame oil, hummus
- Soy: soy sauce, tofu, tempeh, edamame, miso
- Fish: any fish species, fish sauce, worcestershire sauce, anchovies
- Sulphites: wine, vinegar, dried fruit, processed meats, some sauces
- Crustacea: prawns, crab, lobster, shrimp
- Molluscs: squid, mussels, oysters, scallops

Return ONLY a JSON array, e.g. ["Gluten","Dairy"] or [] for no allergens.`;
    try {
      const msg = await anthropic.messages.create({
        model: "claude_haiku_4_5",
        max_tokens: 200,
        messages: [{ role: "user", content: prompt }],
      });
      const text = (msg.content?.[0] as any)?.text?.trim() || "[]";
      // Extract JSON array from response
      const match = text.match(/\[.*?\]/s);
      const allergens: string[] = match ? JSON.parse(match[0]) : [];
      const valid = allergens.filter((a: string) => ALLERGENS.includes(a));
      await storage.updateIngredient(Number(req.params.id), { dietariesJson: JSON.stringify(valid) });
      res.json({ dietaries: valid });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Bulk auto-classify all ingredients
  app.post("/api/ingredients/auto-dietaries-bulk", async (req, res) => {
    const allIngs = (await storage.getIngredients()).filter(i => i.category !== "Packaging");
    const ALLERGENS = ["Gluten","Tree Nuts","Dairy","Eggs","Peanuts","Sesame","Soy","Fish","Sulphites","Crustacea","Molluscs"];
    // Build one big batch request
    const lines = allIngs.map((i) => `${i.id}|${i.name}|${i.category}`).join("\n");
    const prompt = `You are a food allergen expert. For each ingredient below, identify which allergens it DEFINITELY contains.

Ingredient list (id|name|category):
${lines}

Allowed allergen keys: ${ALLERGENS.join(", ")}

Return a JSON object where each key is the ingredient id (as a string) and the value is an array of allergen keys.
Be conservative — only include allergens clearly present. Return ONLY valid JSON, no explanation.
Example: {"1":["Dairy"],"2":["Gluten","Eggs"],"3":[]}`;
    try {
      const msg = await anthropic.messages.create({
        model: "claude_haiku_4_5",
        max_tokens: 4096,
        messages: [{ role: "user", content: prompt }],
      });
      const text = (msg.content?.[0] as any)?.text?.trim() || "{}";
      const match = text.match(/\{[\s\S]*\}/);
      const result: Record<string, string[]> = match ? JSON.parse(match[0]) : {};
      let updated = 0;
      for (const [idStr, allergens] of Object.entries(result)) {
        const valid = (allergens as string[]).filter((a) => ALLERGENS.includes(a));
        await storage.updateIngredient(Number(idStr), { dietariesJson: JSON.stringify(valid) });
        updated++;
      }
      res.json({ ok: true, updated });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── PEAL Label Generation ────────────────────────────────────────────────
  // Single ingredient: generate PEAL label via LLM
  app.post("/api/ingredients/:id/auto-peal", async (req, res) => {
    const ing = await storage.getIngredient(Number(req.params.id));
    if (!ing) return res.status(404).json({ error: "Not found" });
    const allergens: string[] = (() => { try { return JSON.parse((ing as any).dietariesJson || "[]"); } catch { return []; } })();
    const prompt = `You are a food labelling expert specialising in FSANZ Standard 1.2.3 Plain English Allergen Labelling (PEAL) for Australian and New Zealand food products.

Ingredient name: "${ing.name}"
Category: "${ing.category}"
Known allergens present: ${allergens.length > 0 ? allergens.join(", ") : "none"}

Generate a full FSANZ-compliant ingredient declaration as it would appear in a composite product's ingredients list, using your knowledge of the typical commercial formulation of this ingredient.

Rules:
- Use Title Case for the ingredient name
- List the ingredient's own sub-ingredients in square brackets [ ] after the name, based on typical commercial formulation (e.g. milk, salt, cultures, enzymes, food additives with code numbers)
- Include food additive names AND code numbers where applicable (e.g. "Preservative (200)", "Emulsifier (471)", "Anti-caking Agent (460)")
- Allergens within sub-ingredients must appear in plain English (e.g. "Milk" not "dairy", "Wheat" not "gluten")
- If the ingredient is a simple single-component food (e.g. fresh chicken breast, carrot, olive oil), return just the name with no brackets
- Do NOT include a "Contains:" statement
- Do NOT add a full stop
- Return ONLY the ingredient declaration string, nothing else

Examples:
- Tasty Cheese → "Tasty Cheese [Milk, Salt, Cultures, Enzyme (Non-Animal Rennet)], Anti-caking Agent (460), Preservative (200)"
- Mayonnaise → "Mayonnaise [Canola Oil, Water, Egg Yolk, White Wine Vinegar, Sugar, Salt, Mustard Flour, Lemon Juice, Thickener (1442)]"
- Soy Sauce → "Soy Sauce [Water, Soybeans, Wheat, Salt, Alcohol]"
- Butter → "Butter [Cream (Milk), Salt]"
- Chicken Breast → "Chicken Breast"
- White Sugar → "White Sugar"
- Bread → "Bread [Wheat Flour (Gluten), Water, Yeast, Salt, Improver (Ascorbic Acid (300))]"`;
    try {
      const msg = await anthropic.messages.create({
        model: "claude_haiku_4_5",
        max_tokens: 400,
        messages: [{ role: "user", content: prompt }],
      });
      const label = ((msg.content?.[0] as any)?.text || "").trim().replace(/^"|"$/g, "");
      await storage.updateIngredient(Number(req.params.id), { pealLabel: label });
      res.json({ pealLabel: label });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Bulk: generate PEAL labels for all ingredients in one LLM call
  app.post("/api/ingredients/auto-peal-bulk", async (req, res) => {
    const allIngs = (await storage.getIngredients()).filter(i => i.category !== "Packaging");
    // Build batches of 60 to stay within token limits
    const BATCH = 60;
    let updated = 0;
    for (let i = 0; i < allIngs.length; i += BATCH) {
      const batch = allIngs.slice(i, i + BATCH);
      const lines = batch.map((ing) => {
        const allergens: string[] = (() => { try { return JSON.parse((ing as any).dietariesJson || "[]"); } catch { return []; } })();
        return `${ing.id}|${ing.name}|${ing.category}|${allergens.join(",") || "none"}`;
      }).join("\n");
      const prompt = `You are a food labelling expert specialising in FSANZ Standard 1.2.3 Plain English Allergen Labelling (PEAL) for Australian and New Zealand food products.

For each ingredient below (format: id|name|category|known_allergens), generate a full FSANZ-compliant ingredient declaration as it would appear in a composite product's ingredients list — using your knowledge of typical commercial formulations.

Rules:
- Use Title Case for ingredient names
- List sub-ingredients in square brackets [ ] based on typical commercial formulation, including food additives with code numbers (e.g. "Preservative (200)", "Emulsifier (471)")
- Allergens must appear in plain English (e.g. "Milk", "Wheat", "Egg")
- Single-component foods (fresh produce, pure oils, plain meats) just get the name, no brackets
- Do NOT include "Contains:" statements
- Do NOT add full stops
- Return a JSON object mapping id to declaration string: {"id": "declaration", ...}

Examples:
- Tasty Cheese → "Tasty Cheese [Milk, Salt, Cultures, Enzyme (Non-Animal Rennet)], Anti-caking Agent (460), Preservative (200)"
- Mayonnaise → "Mayonnaise [Canola Oil, Water, Egg Yolk, White Wine Vinegar, Sugar, Salt, Mustard Flour, Thickener (1442)]"
- Chicken Breast → "Chicken Breast"
- Soy Sauce → "Soy Sauce [Water, Soybeans, Wheat, Salt, Alcohol]"

${lines}

Return ONLY valid JSON, no explanation.`;
      try {
        const msg = await anthropic.messages.create({
          model: "claude_haiku_4_5",
          max_tokens: 2048,
          messages: [{ role: "user", content: prompt }],
        });
        const text = ((msg.content?.[0] as any)?.text || "").trim();
        const match = text.match(/\{[\s\S]*\}/);
        if (match) {
          const result: Record<string, string> = JSON.parse(match[0]);
          for (const [idStr, label] of Object.entries(result)) {
            await storage.updateIngredient(Number(idStr), { pealLabel: String(label).trim().replace(/^"|"$/g, "") });
            updated++;
          }
        }
      } catch (_) { /* continue with next batch */ }
    }
    res.json({ ok: true, updated });
  });

  // ─── Brand Name Update → Auto-refresh Allergens + PEAL ────────────────────
  // POST /api/ingredients/:id/update-brand
  // Body: { brandName: string }
  // Sets brand_name, then uses AI with brand context to regenerate accurate allergens + PEAL label
  app.post("/api/ingredients/:id/update-brand", async (req, res) => {
    try {
      const id = Number(req.params.id);
      const ing = await storage.getIngredient(id);
      if (!ing) return res.status(404).json({ error: "Not found" });

      const brandName: string = (req.body.brandName || "").trim();
      if (!brandName) return res.status(400).json({ error: "brandName is required" });

      // Save brand name
      await storage.updateIngredient(id, { brandName });

      const ALLERGENS = ["Gluten","Tree Nuts","Dairy","Eggs","Peanuts","Sesame","Soy","Fish","Sulphites","Crustacea","Molluscs"];

      // Step 1 — allergen classification with brand context
      const allergenPrompt = `You are a food allergen expert for the Australian/NZ market.

Product: "${brandName}" (generic name: "${ing.name}", category: "${ing.category}")

Using your knowledge of this specific branded product as sold in Australia, identify which allergens it DEFINITELY contains.
Allowed keys: ${ALLERGENS.join(", ")}

Rules:
- Be precise — use the brand name to identify the specific product formulation
- BBQ Sauce typically does NOT contain Fish unless it specifically lists Worcestershire sauce or anchovies
- Only include allergens actually present in this branded product
- Return ONLY a JSON array, e.g. ["Gluten","Soy"] or []`;

      const allergenMsg = await anthropic.messages.create({
        model: "claude_haiku_4_5",
        max_tokens: 200,
        messages: [{ role: "user", content: allergenPrompt }],
      });
      const allergenText = ((allergenMsg.content?.[0] as any)?.text || "").trim();
      const allergenMatch = allergenText.match(/\[[\s\S]*?\]/);
      const allergens: string[] = allergenMatch ? (JSON.parse(allergenMatch[0]) as string[]).filter(a => ALLERGENS.includes(a)) : [];
      await storage.updateIngredient(id, { dietariesJson: JSON.stringify(allergens) });

      // Step 2 — PEAL label with brand context
      const pealPrompt = `You are a food labelling expert specialising in FSANZ Standard 1.2.3 Plain English Allergen Labelling (PEAL) for Australia and New Zealand.

Product: "${brandName}" (generic name: "${ing.name}", category: "${ing.category}")
Known allergens: ${allergens.length > 0 ? allergens.join(", ") : "none"}

Using your knowledge of this specific branded product as sold in Australia, generate the full FSANZ-compliant ingredient declaration as it would appear in a composite product's ingredients list.

Rules:
- Use Title Case for the ingredient name
- List the brand's actual sub-ingredients in square brackets [ ], including food additives with code numbers
- Allergens must appear in plain English (e.g. "Wheat", "Milk", "Egg")
- If it's a simple single-component food, just return the name
- Do NOT include "Contains:", no full stop
- Return ONLY the declaration string

Examples:
- Fountain BBQ Sauce → "BBQ Sauce [Tomato Paste, Sugar, Vinegar, Maize Starch, Salt, Caramel (150c), Spices, Flavours]"
- Bega Tasty Cheese → "Tasty Cheese [Milk, Salt, Cultures, Enzyme (Non-Animal Rennet)], Anti-caking Agent (460)"
- Coles Free Range Eggs → "Free Range Eggs"`;

      const pealMsg = await anthropic.messages.create({
        model: "claude_haiku_4_5",
        max_tokens: 400,
        messages: [{ role: "user", content: pealPrompt }],
      });
      const pealLabel = ((pealMsg.content?.[0] as any)?.text || "").trim().replace(/^"|"$/g, "");
      await storage.updateIngredient(id, { pealLabel });

      res.json({ ok: true, brandName, allergens, pealLabel });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Nutrition cascade helper: after an ingredient's nutritionJson changes,
  //    re-compute nutritionJson for all sub-recipes → recipes → platters that use it.
  async function cascadeNutritionFromIngredient(ingredientId: number) {
    const markup = await getMarkup();
    const wholesaleMarkup = await getWholesaleMarkup();
    const hourlyRate = parseFloat(await storage.getSetting("hourly_rate") || "35");
    // 1. Sub-recipes that directly use this ingredient
    const changedSRIds = new Set<number>();
    for (const sr of await storage.getSubRecipes()) {
      const lines: { ingredientId: number }[] = JSON.parse(sr.ingredientsJson || "[]");
      if (lines.some(l => l.ingredientId === ingredientId)) {
        const costs = await computeSubRecipeCosts(sr.ingredientsJson, sr.subRecipesJson || "[]", sr.yieldAmount || 1, (sr as any).labourMinutes || 0, hourlyRate);
        await storage.updateSubRecipe(sr.id, costs);
        changedSRIds.add(sr.id);
      }
    }
    // 2. Cascade sub-recipe changes to recipes
    const changedRecipeIds = new Set<number>();
    for (const r of await storage.getRecipes()) {
      const usesSR = JSON.parse(r.subRecipesJson || "[]").some((l: any) => changedSRIds.has(l.subRecipeId));
      const usesIng = JSON.parse(r.ingredientsJson || "[]").some((l: any) => l.ingredientId === ingredientId);
      if (usesSR || usesIng) {
        const rcosts = await computeRecipeCosts(r.ingredientsJson, r.subRecipesJson, r.packagingJson, r.labourMinutes || 0, markup, hourlyRate, r.portionCount || 1, r.rrp, wholesaleMarkup, r.wholesaleRrp, (r as any).recipesJson);
        await storage.updateRecipe(r.id, rcosts);
        changedRecipeIds.add(r.id);
      }
    }
    // 3. Cascade to platters
    for (const p of await storage.getPlatters()) {
      const items: any[] = JSON.parse(p.itemsJson || "[]");
      const usesRecipe = items.some(i => i.type === "recipe" && changedRecipeIds.has(i.id));
      const usesSR = items.some(i => i.type === "subrecipe" && changedSRIds.has(i.id));
      const usesIng = items.some(i => i.type === "ingredient" && i.id === ingredientId);
      if (usesRecipe || usesSR || usesIng) {
        const nutritionPerServe = await computePlatterNutrition(p.itemsJson, (p as any).servingsPerPackage ?? null);
        await storage.updatePlatter(p.id, { nutritionJson: JSON.stringify(nutritionPerServe) } as any);
      }
    }
  }

  // POST /api/ingredients/:id/auto-nutrition
  // Uses AI to estimate per-100g nutritional values for an ingredient based on its brand name + name.
  app.post("/api/ingredients/:id/auto-nutrition", async (req, res) => {
    try {
      const id = Number(req.params.id);
      const ing = await storage.getIngredient(id);
      if (!ing) return res.status(404).json({ error: "Not found" });

      const brand = ((ing as any).brandName || "").trim();
      const name = ing.name.trim();
      const productDesc = brand ? `"${brand}" (known as "${name}" in this kitchen)` : `"${name}"`;

      const prompt = `You are a food nutrition expert. Provide the FSANZ-compliant average nutritional values per 100g for the following Australian food ingredient.

Product: ${productDesc}
Category: ${ing.category}

Return ONLY a JSON object with these exact keys (all numbers, no strings):
{
  "energy": <kJ per 100g>,
  "protein": <g per 100g>,
  "fatTotal": <g per 100g>,
  "fatSat": <g per 100g>,
  "carbs": <g per 100g>,
  "sugars": <g per 100g>,
  "sodium": <mg per 100g>
}

Use typical Australian product values. If the product is a liquid, base it on per 100ml (same numeric values — treat ml = g for labelling purposes).
Return ONLY the JSON object, no explanation.`;

      const msg = await anthropic.messages.create({
        model: "claude_haiku_4_5",
        max_tokens: 300,
        messages: [{ role: "user", content: prompt }],
      });
      const text = ((msg.content?.[0] as any)?.text || "").trim();
      const match = text.match(/\{[\s\S]*?\}/);
      if (!match) return res.status(422).json({ error: "AI returned no valid JSON", raw: text });

      const parsed = JSON.parse(match[0]);
      const n: NutritionValues = {
        energy:   typeof parsed.energy   === "number" ? Math.round(parsed.energy)   : 0,
        protein:  typeof parsed.protein  === "number" ? parseFloat(parsed.protein.toFixed(1))  : 0,
        fatTotal: typeof parsed.fatTotal === "number" ? parseFloat(parsed.fatTotal.toFixed(1)) : 0,
        fatSat:   typeof parsed.fatSat   === "number" ? parseFloat(parsed.fatSat.toFixed(1))   : 0,
        carbs:    typeof parsed.carbs    === "number" ? parseFloat(parsed.carbs.toFixed(1))    : 0,
        sugars:   typeof parsed.sugars   === "number" ? parseFloat(parsed.sugars.toFixed(1))   : 0,
        sodium:   typeof parsed.sodium   === "number" ? Math.round(parsed.sodium)   : 0,
      };

      await storage.updateIngredient(id, { nutritionJson: JSON.stringify(n) });
      // Cascade to sub-recipes, recipes, platters that use this ingredient
      await cascadeNutritionFromIngredient(id);

      res.json({ ok: true, nutrition: n });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/ingredients/:id/nutrition — manually set nutrition values
  app.post("/api/ingredients/:id/nutrition", async (req, res) => {
    try {
      const id = Number(req.params.id);
      const ing = await storage.getIngredient(id);
      if (!ing) return res.status(404).json({ error: "Not found" });
      const n = req.body as NutritionValues;
      await storage.updateIngredient(id, { nutritionJson: JSON.stringify(n) });
      await cascadeNutritionFromIngredient(id);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/ingredients/auto-nutrition-bulk — run AI nutrition for all ingredients missing it
  app.post("/api/ingredients/auto-nutrition-bulk", async (req, res) => {
    try {
      const all = await storage.getIngredients();
      const missing = all.filter(i => !(i as any).nutritionJson && i.category !== "Packaging");
      let updated = 0;
      // Run in small batches to avoid rate limiting
      for (const ing of missing) {
        try {
          const brand = ((ing as any).brandName || "").trim();
          const name = ing.name.trim();
          const productDesc = brand ? `"${brand}" (known as "${name}")` : `"${name}"`;
          const prompt = `Nutritional values per 100g for Australian food product ${productDesc} (category: ${ing.category}). Return ONLY JSON: {"energy":<kJ>,"protein":<g>,"fatTotal":<g>,"fatSat":<g>,"carbs":<g>,"sugars":<g>,"sodium":<mg>}`;
          const msg = await anthropic.messages.create({ model: "claude_haiku_4_5", max_tokens: 200, messages: [{ role: "user", content: prompt }] });
          const text = ((msg.content?.[0] as any)?.text || "").trim();
          const match = text.match(/\{[\s\S]*?\}/);
          if (match) {
            const p = JSON.parse(match[0]);
            const n: NutritionValues = {
              energy: Math.round(p.energy || 0), protein: parseFloat((p.protein || 0).toFixed(1)),
              fatTotal: parseFloat((p.fatTotal || 0).toFixed(1)), fatSat: parseFloat((p.fatSat || 0).toFixed(1)),
              carbs: parseFloat((p.carbs || 0).toFixed(1)), sugars: parseFloat((p.sugars || 0).toFixed(1)),
              sodium: Math.round(p.sodium || 0),
            };
            await storage.updateIngredient(ing.id, { nutritionJson: JSON.stringify(n) });
            updated++;
          }
        } catch (_) { /* skip individual failures */ }
      }
      // After all ingredients updated, cascade all sub-recipes, recipes, platters
      const markup = await getMarkup();
      const wholesaleMarkup = await getWholesaleMarkup();
      const hourlyRate = parseFloat(await storage.getSetting("hourly_rate") || "35");
      for (const sr of await storage.getSubRecipes()) {
        const costs = await computeSubRecipeCosts(sr.ingredientsJson, sr.subRecipesJson || "[]", sr.yieldAmount || 1, (sr as any).labourMinutes || 0, hourlyRate);
        await storage.updateSubRecipe(sr.id, costs);
      }
      for (const r of await storage.getRecipes()) {
        const rcosts = await computeRecipeCosts(r.ingredientsJson, r.subRecipesJson, r.packagingJson, r.labourMinutes || 0, markup, hourlyRate, r.portionCount || 1, r.rrp, wholesaleMarkup, r.wholesaleRrp, (r as any).recipesJson);
        await storage.updateRecipe(r.id, rcosts);
      }
      for (const p of await storage.getPlatters()) {
        const nutritionPerServe = await computePlatterNutrition(p.itemsJson, (p as any).servingsPerPackage ?? null);
        await storage.updatePlatter(p.id, { nutritionJson: JSON.stringify(nutritionPerServe) } as any);
      }
      res.json({ ok: true, updated, total: missing.length });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Supplier Ingredients ───────────────────────────────────────────────────
  app.get("/api/supplier-ingredients", async (req, res) => {
    try {
      const ingredientId = req.query.ingredientId ? Number(req.query.ingredientId) : undefined;
      const supplierId = req.query.supplierId ? Number(req.query.supplierId) : undefined;
      const list = await storage.getSupplierIngredients(ingredientId, supplierId);
      const sups = await storage.getSuppliers();
      const supMap: Record<number, string> = {};
      sups.forEach((s) => (supMap[s.id] = s.name));
      const enriched = list.map((si) => ({
        ...si,
        supplierName: supMap[si.supplierId] || "Unknown",
      }));
      res.json(enriched);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/supplier-ingredients", async (req, res) => {
    try {
      const si = await storage.createSupplierIngredient(req.body);
      res.json(si);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.put("/api/supplier-ingredients/:id", async (req, res) => {
    try {
      const si = await storage.updateSupplierIngredient(Number(req.params.id), req.body);
      if (!si) return res.status(404).json({ error: "Not found" });
      res.json(si);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/supplier-ingredients/:id", async (req, res) => {
    try {
      await storage.deleteSupplierIngredient(Number(req.params.id));
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Sub-Recipes ────────────────────────────────────────────────────────────
  app.get("/api/sub-recipes", async (req, res) => {
    try {
      const srList = await storage.getSubRecipes();
      const srs = await Promise.all(srList.map(async (sr) => {
        const batchWeight = await computeBatchWeightGrams(
          (sr as any).ingredientsJson || "[]",
          (sr as any).subRecipesJson || "[]"
        );
        const yield_ = (sr.yieldAmount && sr.yieldAmount > 0) ? sr.yieldAmount : 1;
        const calculatedServingSize = batchWeight !== null ? Math.round(batchWeight / yield_) : null;
        return { ...sr, calculatedServingSize };
      }));
      res.json(srs);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/sub-recipes", async (req, res) => {
    try {
      const { yieldAmount, ingredientsJson, subRecipesJson, labourMinutes } = req.body;
      const hourlyRate = parseFloat(await storage.getSetting("labour_rate_per_hour") || "35");
      const costs = await computeSubRecipeCosts(ingredientsJson || "[]", subRecipesJson || "[]", yieldAmount || 1, labourMinutes || 0, hourlyRate);
      const sr = await storage.createSubRecipe({ ...req.body, ...costs });
      res.json(sr);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.put("/api/sub-recipes/:id", async (req, res) => {
    try {
      const existing = await storage.getSubRecipe(Number(req.params.id));
      if (!existing) return res.status(404).json({ error: "Not found" });
      const merged = { ...existing, ...req.body };
      const hourlyRate = parseFloat(await storage.getSetting("labour_rate_per_hour") || "35");
      const costs = await computeSubRecipeCosts(merged.ingredientsJson || "[]", merged.subRecipesJson || "[]", merged.yieldAmount || 1, merged.labourMinutes || 0, hourlyRate);
      const sr = await storage.updateSubRecipe(Number(req.params.id), { ...req.body, ...costs });
      // Cascade: propagate through sub-recipe graph → recipes → platters
      try {
        const markup = await getMarkup();
        const wholesaleMarkup = await getWholesaleMarkup();
        const hrRate = parseFloat(await storage.getSetting("labour_rate_per_hour") || "35");
        await cascadeFromSubRecipes(new Set([Number(req.params.id)]), markup, wholesaleMarkup, hrRate);
      } catch (_) {}
      res.json(sr);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.delete("/api/sub-recipes/:id", async (req, res) => {
    try {
      await storage.deleteSubRecipe(Number(req.params.id));
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/sub-recipes/:id/dietaries — compute allergens + dietaries from ingredient labels
  app.get("/api/sub-recipes/:id/dietaries", async (req, res) => {
    try {
      const sr = await storage.getSubRecipe(Number(req.params.id));
      if (!sr) return res.status(404).json({ error: "Not found" });
      // Build a synthetic "components" array that points to this sub-recipe
      const components = [{ type: 'sub_recipe', id: sr.id }];
      const { allergens, dietaries } = await computeFlexDietaries(components);
      res.json({ allergens, dietaries });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Recipes ────────────────────────────────────────────────────────────────
  function enrichRecipeWithServingSize(r: any) {
    const batchWeight = computeBatchWeightGrams(
      r.ingredientsJson || "[]",
      r.subRecipesJson || "[]",
      r.recipesJson || "[]"
    );
    const portions = (r.portionCount && r.portionCount > 0) ? r.portionCount : 1;
    const calculatedServingSize = batchWeight !== null ? Math.round(batchWeight / portions) : null;
    return { ...r, calculatedServingSize };
  }

  app.get("/api/recipes", async (req, res) => {
    const all = await storage.getRecipes();
    const enriched = await Promise.all(all.map(enrichRecipeWithServingSize));
    res.json(enriched);
  });
  app.get("/api/recipes/:id", async (req, res) => {
    const r = await storage.getRecipe(Number(req.params.id));
    if (!r) return res.status(404).json({ error: "Not found" });
    res.json(await enrichRecipeWithServingSize(r));
  });

  // GET /api/recipes/:id/dietaries — compute allergens + dietaries from all components
  app.get("/api/recipes/:id/dietaries", async (req, res) => {
    try {
      const r = await storage.getRecipe(Number(req.params.id));
      if (!r) return res.status(404).json({ error: "Not found" });
      // Build components from all ingredient lines, sub-recipe lines, and nested recipe lines
      const ingLines: any[] = JSON.parse(r.ingredientsJson || "[]");
      const srLines: any[] = JSON.parse(r.subRecipesJson || "[]");
      const recLines: any[] = JSON.parse((r as any).recipesJson || "[]");
      const components = [
        ...ingLines.map((l: any) => ({ type: 'ingredient', id: l.ingredientId })),
        ...srLines.map((l: any) => ({ type: 'sub_recipe', id: l.subRecipeId })),
        ...recLines.map((l: any) => ({ type: 'recipe', id: l.recipeId })),
      ];
      const { allergens, dietaries } = await computeFlexDietaries(components);
      res.json({ allergens, dietaries });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/recipes", async (req, res) => {
    try {
      const markup = await getMarkup();
      const wholesaleMarkup = await getWholesaleMarkup();
      const hourlyRate = parseFloat(await storage.getSetting("labour_rate_per_hour") || "35");
      const { ingredientsJson, subRecipesJson, recipesJson, packagingJson, labourMinutes, portionCount, rrp, wholesaleRrp } = req.body;
      const costs = await computeRecipeCosts(
        ingredientsJson || "[]", subRecipesJson || "[]", packagingJson || "[]",
        labourMinutes || 0, markup, hourlyRate, portionCount || 1, rrp, wholesaleMarkup, wholesaleRrp, recipesJson || "[]"
      );
      const r = await storage.createRecipe({ ...req.body, recipesJson: recipesJson || "[]", ...costs });
      res.json(r);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.put("/api/recipes/:id", async (req, res) => {
    try {
      const existing = await storage.getRecipe(Number(req.params.id));
      if (!existing) return res.status(404).json({ error: "Not found" });
      const markup = await getMarkup();
      const wholesaleMarkup = await getWholesaleMarkup();
      const hourlyRate = parseFloat(await storage.getSetting("labour_rate_per_hour") || "35");
      const merged = { ...existing, ...req.body };
      const rrp = req.body.rrp !== undefined ? req.body.rrp : existing.rrp;
      const wholesaleRrp = req.body.wholesaleRrp !== undefined ? req.body.wholesaleRrp : existing.wholesaleRrp;
      const recipesJsonVal = merged.recipesJson || "[]";
      const costs = await computeRecipeCosts(
        merged.ingredientsJson, merged.subRecipesJson, merged.packagingJson,
        merged.labourMinutes || 0, markup, hourlyRate, merged.portionCount || 1, rrp, wholesaleMarkup, wholesaleRrp, recipesJsonVal
      );
      const r = await storage.updateRecipe(Number(req.params.id), { ...req.body, recipesJson: req.body.recipesJson ?? existing.recipesJson ?? "[]", ...costs });
      // Cascade: recalculate other recipes that use this recipe, then platters
      try {
        const wMarkup = await getWholesaleMarkup();
        const mMarkup = await getMarkup();
        const hrRate = parseFloat(await storage.getSetting("labour_rate_per_hour") || "35");
        const recipeId = Number(req.params.id);
        // Other recipes that reference this recipe
        for (const depR of await storage.getRecipes()) {
          if (depR.id === recipeId) continue;
          const usesRecipe = JSON.parse((depR as any).recipesJson || "[]").some((l: any) => l.recipeId === recipeId);
          if (usesRecipe) {
            const dc = await computeRecipeCosts(depR.ingredientsJson, depR.subRecipesJson, depR.packagingJson, depR.labourMinutes || 0, mMarkup, hrRate, depR.portionCount || 1, depR.rrp, wMarkup, depR.wholesaleRrp, (depR as any).recipesJson);
            await storage.updateRecipe(depR.id, dc);
          }
        }
        for (const p of await storage.getPlatters()) {
          const usesRecipe = JSON.parse(p.itemsJson || "[]").some((l: any) => l.type === "recipe" && l.id === recipeId);
          if (usesRecipe) {
            const pcosts = await computePlatterCosts(p.itemsJson, p.packagingJson, (p as any).labourMinutes || 0, mMarkup, wMarkup, p.wholesaleRrp, hrRate);
            const marginPercent = p.rrp && pcosts.totalCost > 0 ? ((p.rrp - pcosts.totalCost) / p.rrp) * 100 : 0;
            await storage.updatePlatter(p.id, { ...pcosts, marginPercent });
          }
        }
      } catch (_) {}
      res.json(r);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.delete("/api/recipes/:id", async (req, res) => {
    try {
      await storage.deleteRecipe(Number(req.params.id));
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Platters ───────────────────────────────────────────────────────────────
  app.get("/api/platters", async (req, res) => res.json(await storage.getPlatters()));
  app.get("/api/platters/:id", async (req, res) => {
    const p = await storage.getPlatter(Number(req.params.id));
    if (!p) return res.status(404).json({ error: "Not found" });
    res.json(p);
  });

  app.post("/api/platters", async (req, res) => {
    try {
      const markup = await getMarkup();
      const wholesaleMarkup = await getWholesaleMarkup();
      const { itemsJson, packagingJson, labourMinutes, wholesaleRrp } = req.body;
      const hourlyRate = parseFloat(await storage.getSetting("labour_rate_per_hour") || "35");
      const costs = await computePlatterCosts(itemsJson || "[]", packagingJson || "[]", labourMinutes || 0, markup, wholesaleMarkup, wholesaleRrp, hourlyRate);
      const rrp = req.body.rrp;
      const marginPercent = rrp && costs.totalCost > 0 ? ((rrp - costs.totalCost) / rrp) * 100 : 0;
      const p = await storage.createPlatter({ ...req.body, ...costs, marginPercent });
      res.json(p);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.put("/api/platters/:id", async (req, res) => {
    try {
      const existing = await storage.getPlatter(Number(req.params.id));
      if (!existing) return res.status(404).json({ error: "Not found" });
      const markup = await getMarkup();
      const wholesaleMarkup = await getWholesaleMarkup();
      const merged = { ...existing, ...req.body };
      const rrp = req.body.rrp !== undefined ? req.body.rrp : existing.rrp;
      const wholesaleRrp = req.body.wholesaleRrp !== undefined ? req.body.wholesaleRrp : existing.wholesaleRrp;
      const hourlyRate = parseFloat(await storage.getSetting("labour_rate_per_hour") || "35");
      const costs = await computePlatterCosts(
        merged.itemsJson, merged.packagingJson, (merged as any).labourMinutes || 0, markup, wholesaleMarkup, wholesaleRrp, hourlyRate
      );
      const marginPercent = rrp && costs.totalCost > 0 ? ((rrp - costs.totalCost) / rrp) * 100 : 0;
      const p = await storage.updatePlatter(Number(req.params.id), { ...req.body, ...costs, marginPercent });
      res.json(p);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.delete("/api/platters/:id", async (req, res) => {
    try {
      await storage.deletePlatter(Number(req.params.id));
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Flex Products ─────────────────────────────────────────────────────────────────────────────

  const FLEX_BASE = "https://the-deli.com.au";
  const FLEX_TOKEN = "d8ecc189f96774038e36112c5ed9f2bc557c3320";
  const FLEX_HEADERS = {
    'Authorization': `Bearer ${FLEX_TOKEN}`,
    'X-API-KEY': FLEX_TOKEN,
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Referer': 'https://the-deli.com.au/',
    'Origin': 'https://the-deli.com.au',
  };

  // Proxy Flex API calls through Supabase Edge Function to bypass Cloudflare block on Railway IPs
  const FLEX_PROXY_URL = "https://dxtbuiicrdkjxkwdjdwq.supabase.co/functions/v1/flex-proxy";
  const FLEX_PROXY_SECRET = "deli-flex-proxy-2026";
  async function flexFetch(path: string, options: { method?: string; body?: string } = {}): Promise<Response> {
    const url = `${FLEX_PROXY_URL}?path=${encodeURIComponent(path)}`;
    return fetch(url, {
      method: options.method || "GET",
      headers: {
        "x-proxy-secret": FLEX_PROXY_SECRET,
        "Content-Type": "application/json",
      },
      body: options.body,
    });
  }

  // GET /api/flex-products — list all synced products
  app.get("/api/flex-products", async (req, res) => {
    try {
      const products = await storage.getFlexProducts();
      res.json(products);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/flex-products/costings/all — bulk fetch all costings (productId -> costing)
  app.get("/api/flex-products/costings/all", async (req, res) => {
    try {
      const { data: rows, error } = await supabase.from('flex_product_costings').select('*');
      if (error) throw error;
      const map: Record<number, any> = {};
      for (const row of (rows ?? [])) {
        map[row.flex_product_id] = {
          id: row.id,
          flexProductId: row.flex_product_id,
          componentsJson: row.components_json,
          packagingJson: row.packaging_json,
          labourCost: row.labour_cost,
          labourMinutes: row.labour_minutes,
          rrp: row.rrp,
          wholesaleRrp: row.wholesale_rrp,
          serves: row.serves,
          portionSize: row.portion_size,
          totalCost: row.total_cost,
          foodCostPercent: row.food_cost_percent,
          marginPercent: row.margin_percent,
          costPerServe: row.cost_per_serve,
          foodCostPerServe: row.food_cost_per_serve,
          computedDietariesJson: row.computed_dietaries_json,
          computedAllergensJson: row.computed_allergens_json,
          nutritionJson: row.nutrition_json,
          servingSize: row.serving_size,
          updatedAt: row.updated_at,
        };
      }
      res.json(map);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/flex-products/costing-inconsistencies — for dashboard alert
  app.get("/api/flex-products/costing-inconsistencies", async (req, res) => {
    try {
      const products = await storage.getFlexProducts();
      const inconsistencies: any[] = [];
      for (const p of products) {
        const costing = await storage.getFlexProductCosting(p.id);
      if (!costing) continue;
      const flexDietaries: string[] = JSON.parse(p.flexDietariesJson || "[]");
      const computedDietaries: string[] = JSON.parse(costing.computedDietariesJson || "[]");
      // Compare sets
      const flexSet = new Set(flexDietaries.map((d: any) => typeof d === 'string' ? d : d.code));
      const computedSet = new Set(computedDietaries);
      const hasInconsistency = [...flexSet].some(d => !computedSet.has(d)) ||
        [...computedSet].some(d => !flexSet.has(d));
      if (hasInconsistency) {
        inconsistencies.push({
          id: p.id,
          name: p.name,
          flexDietaries,
          computedDietaries,
        });
      }
      }
      res.json({ count: inconsistencies.length, items: inconsistencies });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/flex-products/:id/costing — get costing for a product
  app.get("/api/flex-products/:id/costing", async (req, res) => {
    try {
      const costing = await storage.getFlexProductCosting(Number(req.params.id));
      res.json(costing || null);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Helper: compute dietaries from components (recipes + sub-recipes)
  // Helper: compute dietaries + allergens from components — uses module-level helpers
  // PUT /api/flex-products/:id/costing — save costing for a product
  app.put("/api/flex-products/:id/costing", async (req, res) => {
    try {
      const flexProductId = Number(req.params.id);
      const product = await storage.getFlexProduct(flexProductId);
      if (!product) return res.status(404).json({ error: "Product not found" });

      const { components = [], packaging = [], labourMinutes = 0 } = req.body;

      // Get settings for labour rate
      const hourlyRate = parseFloat(await storage.getSetting('labour_rate_per_hour') || await storage.getSetting('hourlyRate') || '35');

      // Compute recipe cost: sum component costs * quantity (recipe, sub_recipe, or ingredient)
      let recipeCost = 0;
      for (const comp of components) {
        if (comp.type === 'recipe') {
          const r = await storage.getRecipe(comp.id);
          if (r) recipeCost += (Number(r.totalCost) || 0) * (Number(comp.quantity) || 1);
        } else if (comp.type === 'sub_recipe') {
          const sr = await storage.getSubRecipe(comp.id);
          if (sr) recipeCost += (Number(sr.totalCost) || 0) * (Number(comp.quantity) || 1);
        } else if (comp.type === 'ingredient') {
          const ing = await storage.getIngredient(comp.id);
          if (ing) recipeCost += (Number(ing.bestCostPerUnit) || 0) * (Number(comp.quantity) || 1);
        }
      }

      // Compute packaging cost + enrich each line with current costPerUnit
      let packagingCost = 0;
      const enrichedPackaging: any[] = [];
      for (const pkg of packaging) {
        const ing = await storage.getIngredient(pkg.ingredientId);
        const unitCost = ing ? Number(ing.bestCostPerUnit) || 0 : 0;
        packagingCost += unitCost * (Number(pkg.quantity) || 1);
        enrichedPackaging.push({ ...pkg, costPerUnit: unitCost });
      }

      // Labour cost
      const labourCost = (Number(labourMinutes) / 60) * hourlyRate;

      const safeAdd = (...vals: number[]) => vals.reduce((a, b) => (isNaN(b) ? a : a + b), 0);
      const totalCost = safeAdd(recipeCost, packagingCost, labourCost);
      const flexPrice = Number(product.price) || 0;
      const profitDollars = flexPrice - totalCost;
      const marginPercent = flexPrice > 0 ? (profitDollars / flexPrice) * 100 : 0;

      // Compute dietaries from all components
      const { allergens, dietaries } = await computeFlexDietaries(components);

      const saved = await storage.upsertFlexProductCosting({
        flexProductId,
        componentsJson: JSON.stringify(components),
        packagingJson: JSON.stringify(enrichedPackaging),
        recipeCost,
        packagingCost,
        labourCost,
        totalCost,
        flexPrice,
        marginPercent,
        profitDollars,
        computedAllergensJson: JSON.stringify(allergens),
        computedDietariesJson: JSON.stringify(dietaries),
        updatedAt: new Date().toISOString(),
      });

      res.json(saved);
    } catch (e: any) {
      console.error('Flex costing error:', e);
      res.status(500).json({ error: e.message });
    }
  });

  // DELETE /api/flex-products/:id/costing
  app.delete("/api/flex-products/:id/costing", async (req, res) => {
    try {
      await storage.deleteFlexProductCosting(Number(req.params.id));
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // PATCH /api/flex-products/:id/barcodes — update barcode list for a product
  app.patch("/api/flex-products/:id/barcodes", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { barcodes } = req.body as { barcodes: string[] };
      if (!Array.isArray(barcodes)) return res.status(400).json({ error: "barcodes must be an array" });
      await supabase.from('flex_products').update({ barcodes_json: JSON.stringify(barcodes) }).eq('id', id);
      res.json({ ok: true, barcodes });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/flex-products/:id/push-dietaries — push computed dietaries+allergens to Flex Catering via API
  app.post("/api/flex-products/:id/push-dietaries", async (req, res) => {
    try {
      const productId = Number(req.params.id);
      const product = await storage.getFlexProduct(productId);
      if (!product) return res.status(404).json({ error: "Product not found" });
      const costing = await storage.getFlexProductCosting(productId);
      if (!costing) return res.status(400).json({ error: "No costing found — compute dietaries first" });

      // Map of dietary/allergen code -> Flex UUID (fetched once from /api/v1/dietaries)
      const DIETARY_UUID_MAP: Record<string, string> = {
        CD: "17d24a71-0fd6-4666-8660-576d51104739",
        CE: "792a0b1f-54ca-4c89-954c-b59d8e275f74",
        CG: "ab3e3670-854b-4d55-af67-4933418dd8b3",
        CN: "0ee7d685-8988-4a0d-823e-f9e495affb28",
        CS: "f23eeb8a-29fb-4acc-9b81-916e9394d1c7",
        CX: "c6934f19-3b28-46f8-92c2-89dbc26a24fa",
        CY: "c9e9befd-0977-4e67-a546-50a87d3d15db",
        CU: "00caae35-0ba2-4542-aa3e-88a0dc779867",
        DF: "bf99e6c5-b895-4ab0-8b5a-a9b2fcc200b2",
        EF: "a7a01f14-6ab1-424e-91dd-71376cc23dee",
        GF: "6570200b-7d09-45f8-a087-4d199187ed56",
        H:  "5f386b21-bf9b-4230-becf-96455cd628b5",
        HP: "2801dab9-0f90-4a74-9462-ab7ed553b913",
        KO: "136b234a-7875-44fe-831c-15fe025c9b29",
        K:  "fd8422b6-ffdf-41b6-b841-7e7a13ff52b5",
        LF: "bd0ffad0-371d-4950-842d-c5dcdb3372a6",
        LC: "8a9ea2df-dc49-41d0-8997-13f63f1fc80c",
        NF: "bafcc6b0-5817-4a4a-9741-e4cfe39f0560",
        P:  "a5aa22b8-783b-4d1e-8044-9c2f60cbf2ba",
        PS: "6c4b41c6-0cb3-47f0-817a-8a5fb88363fc",
        RF: "5fc46dec-16ab-4e9f-ad23-ba9d58cb2c3f",
        VG: "95aa546e-7f7f-4c9c-85b8-f85ac32d2107",
        V:  "08f8b9e7-4ae5-4aef-a7c1-1c5f195e541f",
      };

      // Combine computed dietaries + computed allergens into one set of codes
      const computedDietaries: string[] = JSON.parse(costing.computedDietariesJson || "[]");
      const computedAllergens: string[] = JSON.parse(costing.computedAllergensJson || "[]");
      const allCodes = [...new Set([...computedDietaries, ...computedAllergens])];

      // Convert codes to Flex UUIDs, skipping any unknown codes
      const dietariesUuids = allCodes
        .map(code => DIETARY_UUID_MAP[code])
        .filter(Boolean);

      // Fetch current product from Flex to get required fields for the PUT
      const flexToken = "d8ecc189f96774038e36112c5ed9f2bc557c3320";
      const flexBase = "https://the-deli.com.au";
      const flexUuid = product.flexUuid;

      // ALWAYS fetch live categories from Flex immediately before PUT
      // so we echo back exactly what's there — Flex's PUT wipes categories
      // if they don't match, so we must use the live state, not our cached copy.
      const flexGetResp = await flexFetch(`/api/v1/products/${flexUuid}`);
      if (!flexGetResp.ok) throw new Error(`Failed to fetch product from Flex: ${flexGetResp.status}`);
      const flexLive = await flexGetResp.json();

      // Get live category UUIDs to echo back unchanged
      let categoryUuids: string[] = (flexLive.product_categories || [])
        .map((c: any) => c.uuid)
        .filter(Boolean);

      // Also update our local DB with the live categories
      if (categoryUuids.length > 0) {
        const liveCatObjs = (flexLive.product_categories || []).map((c: any) => ({ uuid: c.uuid, name: c.name }));
        await supabase.from('flex_products').update({ categories_json: JSON.stringify(liveCatObjs) }).eq('id', productId);
      }

      if (categoryUuids.length === 0) {
        return res.status(400).json({ 
          error: `"${product.name}" has no product categories assigned in Flex Catering. Please open Flex, assign this product to at least one category, then try pushing again.` 
        });
      }

      // Build PUT body — echo back name/sku/type/status/categories unchanged,
      // only update dietaries_uuid with our computed values
      const putBody: any = {
        name: flexLive.name,
        sku: flexLive.sku,
        type: flexLive.type || "simple",
        status: flexLive.status || "active",
        product_categories_uuid: categoryUuids,
        dietaries_uuid: dietariesUuids,
      };
      // Preserve other fields Flex might care about
      if (flexLive.price != null) putBody.price = flexLive.price;
      if (flexLive.description) putBody.description = flexLive.description;
      if (flexLive.minimum_order_quantity != null) putBody.minimum_order_quantity = flexLive.minimum_order_quantity;
      if (flexLive.kitchen_department?.uuid) putBody.kitchen_department = flexLive.kitchen_department.uuid;

      const putResp = await flexFetch(`/api/v1/products/${flexUuid}`, {
        method: "PUT",
        body: JSON.stringify(putBody),
      });

      const putData = await putResp.json();
      if (!putResp.ok) {
        return res.status(putResp.status).json({ error: putData.message || "Flex API error", details: putData });
      }

      // Return the updated dietary codes from Flex's response
      const updatedCodes = (putData.dietaries || []).map((d: any) => d.code);
      return res.json({ ok: true, pushed: allCodes, flexDietaries: updatedCodes });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // POST /api/flex-products/recompute-allergens — full recompute of cost + allergens + dietaries for all costings
  app.post("/api/flex-products/recompute-allergens", async (req, res) => {
    try {
      const allCostings = await storage.getAllFlexProductCostings();
      let updated = 0;
      for (const costing of allCostings) {
        const components: any[] = JSON.parse(costing.componentsJson || "[]");
        const packaging: any[] = JSON.parse(costing.packagingJson || "[]");
        const { allergens, dietaries } = await computeFlexDietaries(components);

        // Recompute recipe cost from live data
        let recipeCost = 0;
        for (const comp of components) {
          if (comp.type === 'recipe') {
            const r = await storage.getRecipe(comp.id);
            if (r) recipeCost += (Number(r.totalCost) || 0) * (Number(comp.quantity) || 1);
          } else if (comp.type === 'sub_recipe') {
            const sr = await storage.getSubRecipe(comp.id);
            if (sr) recipeCost += (Number(sr.totalCost) || 0) * (Number(comp.quantity) || 1);
          } else if (comp.type === 'ingredient') {
            const ing = await storage.getIngredient(comp.id);
            if (ing) recipeCost += (Number(ing.bestCostPerUnit) || 0) * (Number(comp.quantity) || 1);
          }
        }

        // Recompute packaging cost from live ingredient prices + enrich with costPerUnit
        let packagingCost = 0;
        const enrichedPackaging: any[] = [];
        for (const pkg of packaging) {
          const ing = await storage.getIngredient(pkg.ingredientId);
          const unitCost = ing ? Number(ing.bestCostPerUnit) || 0 : 0;
          packagingCost += unitCost * (Number(pkg.quantity) || 1);
          enrichedPackaging.push({ ...pkg, costPerUnit: unitCost });
        }

        const labourCost = costing.labourCost || 0;
        const totalCost = recipeCost + packagingCost + labourCost;
        const product = await storage.getFlexProduct(costing.flexProductId);
        const flexPrice = Number(product?.price) || 0;
        const profitDollars = flexPrice - totalCost;
        const marginPercent = flexPrice > 0 ? (profitDollars / flexPrice) * 100 : 0;

        await storage.upsertFlexProductCosting({
          ...costing,
          packagingJson: JSON.stringify(enrichedPackaging),
          recipeCost,
          packagingCost,
          totalCost,
          flexPrice,
          marginPercent,
          profitDollars,
          computedAllergensJson: JSON.stringify(allergens),
          computedDietariesJson: JSON.stringify(dietaries),
          updatedAt: new Date().toISOString(),
        });
        updated++;
      }
      res.json({ ok: true, updated });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/flex-products/sync — fetch all products from Flex API and upsert
  app.post("/api/flex-products/sync", async (req, res) => {
    try {
      let nextPath: string | null = `/api/v1/products?per_page=100&page=1`;
      let totalSynced = 0;

      const allergenMap: Record<string, string> = {
        'CG': 'Gluten', 'CD': 'Dairy', 'CE': 'Eggs', 'CN': 'Tree Nuts',
        'CS': 'Seafood', 'CX': 'Seeds', 'CY': 'Soy', 'CU': 'Sulphites',
      };

      while (nextPath) {
        const response = await flexFetch(nextPath);

        if (!response.ok) {
          const text = await response.text();
          throw new Error(`Flex API error ${response.status}: ${text.slice(0, 200)}`);
        }

        const body = await response.json() as any;
        // Flex response shape: { total_items, current_items, current_page, per_page, items: [...], next_page }
        const items: any[] = Array.isArray(body.items) ? body.items : [];

        for (const item of items) {
          // product_categories is the field name in Flex API
          const categories = (item.product_categories || item.categories || []).map((c: any) => ({
            uuid: c.uuid || c.id,
            name: c.name,
          }));

          // dietaries use { code, name } directly
          const flexDietaries = (item.dietaries || []).map((d: any) => ({
            code: d.code || d.short_code || '',
            name: d.name || '',
          }));

          // Allergens: store as Flex codes (CG, CD, CE, etc.) directly — not labels
          const flexAllergens = flexDietaries
            .filter((d: any) => allergenMap[d.code])
            .map((d: any) => d.code);  // store code directly e.g. "CG", not "Gluten"

          // Image: product_images[0].file_url
          const imageUrl = (
            (item.product_images && item.product_images[0]?.file_url) ||
            item.image ||
            item.image_url ||
            null
          );

          await storage.upsertFlexProduct({
            flexUuid: item.uuid || String(item.product_id || ''),
            flexId: item.product_id || null,
            name: item.name || '',
            sku: item.sku || '',
            price: parseFloat(item.price) || 0,
            status: item.status || 'active',
            type: item.type || 'simple',
            categoriesJson: JSON.stringify(categories),
            flexDietariesJson: JSON.stringify(flexDietaries),
            flexAllergensJson: JSON.stringify(flexAllergens),
            imageUrl,
            lastSyncedAt: new Date().toISOString(),
          });
          totalSynced++;
        }

        // next_page is a full URL — extract just the path+query for flexFetch
        if (body.next_page) {
          try { nextPath = new URL(body.next_page).pathname + new URL(body.next_page).search; } catch { nextPath = null; }
        } else { nextPath = null; }
      }

      res.json({ ok: true, synced: totalSynced });
    } catch (e: any) {
      console.error('Flex sync error:', e);
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Product Size Variants ──────────────────────────────────────────────────

  // GET /api/product-size-variants — all variants, optionally filtered by product_uuid
  app.get("/api/product-size-variants", async (req: any, res: any) => {
    try {
      const productUuid = req.query.product_uuid as string | undefined;
      let query = supabase.from("product_size_variants").select("*").order("product_name").order("attributes_summary");
      if (productUuid) query = query.eq("product_uuid", productUuid);
      const { data, error } = await query;
      if (error) throw error;
      return res.json(data?.map((r: any) => ({
        id: r.id,
        productUuid: r.product_uuid,
        productName: r.product_name,
        sku: r.sku,
        attributesSummary: r.attributes_summary,
        attributesJson: r.attributes_json,
        componentsJson: r.components_json,
        totalCost: r.total_cost,
        sellPrice: r.sell_price,
        lastSeenAt: r.last_seen_at,
        createdAt: r.created_at,
      })) || []);
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // PATCH /api/product-size-variants/:id — save components for a variant
  app.patch("/api/product-size-variants/:id", async (req: any, res: any) => {
    try {
      const { id } = req.params;
      const { components } = req.body as { components: any[] };
      // Compute total cost from components
      const totalCost = components.reduce((sum: number, c: any) => sum + (Number(c.costPerUnit || 0) * Number(c.quantity || 0)), 0);
      const { error } = await supabase
        .from("product_size_variants")
        .update({ components_json: JSON.stringify(components), total_cost: totalCost })
        .eq("id", id);
      if (error) throw error;
      return res.json({ ok: true, totalCost });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // POST /api/product-size-variants/sync — scan recent orders and upsert any new variants
  app.post("/api/product-size-variants/sync", async (req: any, res: any) => {
    try {
      const daysBack = Number(req.query.days || 90);
      // Use AWST +08:00 format — Flex ignores UTC 'Z' datetimes in range queries
      const toAwst = (d: Date) => {
        const awst = new Date(d.getTime() + 8 * 60 * 60 * 1000);
        return awst.toISOString().replace('Z', '+08:00');
      };
      const fromDt = toAwst(new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000));
      const toDt = toAwst(new Date());
      const seen = new Map<string, any>(); // key: uuid|attrs_summary
      // Normalise wording inconsistencies from Flex (e.g. "pax" → "person")
      const normaliseAttrs = (s: string) => s.replace(/ pax\b/gi, ' person');
      let page = 1;
      while (true) {
        const r = await flexFetch(`/api/v1/orders?per_page=200&page=${page}&delivery_datetime_from=${encodeURIComponent(fromDt)}&delivery_datetime_to=${encodeURIComponent(toDt)}`);
        if (!r.ok) break;
        const data = await r.json();
        const orders: any[] = data.items || [];
        if (!orders.length) break;
        for (const order of orders) {
          for (const item of (order.items || [])) {
            const normSummary = normaliseAttrs(item.attributes_summary || '');
            const normAttrs = JSON.stringify((item.attributes || []).map((a: any) => ({
              ...a,
              value: typeof a.value === 'string' ? normaliseAttrs(a.value) : a.value,
            })));
            const key = `${item.product_uuid}|${normSummary}`;
            // price_incl_tax is GST-inclusive — store as-is, display ex-GST in frontend
            const priceInclTax = item.price_incl_tax ? Number(item.price_incl_tax) : null;
            if (!seen.has(key)) {
              seen.set(key, {
                product_uuid: item.product_uuid || '',
                product_name: item.name,
                sku: item.sku,
                attributes_summary: normSummary,
                attributes_json: normAttrs,
                components_json: '[]',
                total_cost: 0,
                sell_price: priceInclTax,
                last_seen_at: new Date().toISOString(),
              });
            } else if (priceInclTax !== null) {
              // Always update to most recently seen price
              seen.get(key).sell_price = priceInclTax;
            }
          }
        }
        if (!data.next_page) break;
        page++;
      }
      // For each variant: if it already exists just update sell_price + last_seen_at,
      // otherwise insert as new. This preserves components_json on existing rows.
      const rows = [...seen.values()];
      let synced = 0;

      // Fetch existing (product_uuid, attributes_summary) pairs to decide insert vs update
      const { data: existing } = await supabase
        .from('product_size_variants')
        .select('id, product_uuid, attributes_summary, sell_price');
      const existingMap = new Map<string, { id: number; sell_price: number | null }>(
        (existing || []).map((r: any) => [`${r.product_uuid}|${r.attributes_summary}`, { id: r.id, sell_price: r.sell_price }])
      );

      const toInsert: any[] = [];
      const toUpdate: Array<{ id: number; sell_price: number | null }> = [];

      for (const row of rows) {
        const key = `${row.product_uuid}|${row.attributes_summary}`;
        const ex = existingMap.get(key);
        if (ex) {
          // Only update if price has changed or was null
          if (row.sell_price !== null && ex.sell_price !== row.sell_price) {
            toUpdate.push({ id: ex.id, sell_price: row.sell_price });
          }
        } else {
          toInsert.push(row);
        }
      }

      // Insert new variants
      for (let i = 0; i < toInsert.length; i += 100) {
        const { error } = await supabase.from('product_size_variants').insert(toInsert.slice(i, i + 100));
        if (error) throw error;
        synced += Math.min(100, toInsert.length - i);
      }

      // Update sell_price on existing variants
      for (const u of toUpdate) {
        await supabase.from('product_size_variants')
          .update({ sell_price: u.sell_price, last_seen_at: new Date().toISOString() })
          .eq('id', u.id);
        synced++;
      }

      return res.json({ ok: true, synced, newVariants: toInsert.length, priceUpdates: toUpdate.length, total: rows.length });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // GET /api/flex-orders?date=YYYY-MM-DD[&raw=true]
  // raw=false (default): consolidated product map
  // raw=true: full per-order detail for the Prep page Orders tab
  app.get("/api/flex-orders", async (req, res) => {
    try {
      const date = (req.query.date as string) || new Date().toISOString().split("T")[0];
      const raw  = req.query.raw === "true";
      const from = `${date}T00:00:00+08:00`;
      const to   = `${date}T23:59:59+08:00`;

      let allOrders: any[] = [];
      let page = 1;
      let hasMore = true;

      while (hasMore) {
        const flexPath = `/api/v1/orders?per_page=100&page=${page}&delivery_datetime_from=${encodeURIComponent(from)}&delivery_datetime_to=${encodeURIComponent(to)}`;
        const resp = await flexFetch(flexPath);
        if (!resp.ok) {
          const err = await resp.text();
          return res.status(resp.status).json({ error: err });
        }
        const body: any = await resp.json();
        const items: any[] = body.items || [];
        allOrders = allOrders.concat(items);
        hasMore = !!body.next_page && items.length > 0;
        page++;
        if (page > 20) break;
      }

      // Filter out only cancelled orders
      const activeOrders = allOrders.filter(o => o.status !== 'cancelled');

      if (raw) {
        // Return full per-order objects (trimmed for payload size)
        const orders = activeOrders.map(o => ({
          id: o.id,
          uuid: o.uuid,
          company: o.company || '',
          first_name: o.first_name || '',
          last_name: o.last_name || '',
          delivery_datetime: o.delivery_datetime,
          created_at: o.created_at || '',
          status: o.status,
          internal_notes: o.internal_notes || '',
          delivery_notes: o.delivery_notes || '',
          notes: o.notes || '',
          items: (o.items || []).map((i: any) => ({
            uuid: i.uuid,
            name: i.name,
            quantity: i.quantity,
            sku: i.sku || '',
            price_incl_tax: i.price_incl_tax || 0,
            attributes_summary: i.attributes_summary || '',
            notes: i.notes || '',
          })),
        }));
        return res.json({ date, totalOrders: orders.length, orders });
      }

      // Consolidated product map (legacy / used by old import)
      const productMap = new Map<string, any>();
      for (const order of activeOrders) {
        const orderRef = `#${order.id} — ${order.company || order.first_name + ' ' + order.last_name}`.trim();
        for (const item of (order.items || [])) {
          const key = item.product_uuid || item.product_id?.toString() || item.name;
          if (productMap.has(key)) {
            const e = productMap.get(key)!;
            e.quantity += item.quantity || 1;
            if (!e.orders.includes(orderRef)) e.orders.push(orderRef);
          } else {
            productMap.set(key, { productId: item.product_id, productUuid: item.product_uuid, name: item.name, sku: item.sku || '', quantity: item.quantity || 1, orders: [orderRef] });
          }
        }
      }
      res.json({ date, totalOrders: activeOrders.length, items: [...productMap.values()] });
    } catch (e: any) {
      console.error("Flex orders error:", e);
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Photo Upload ────────────────────────────────────────────────────────────
  // Ensure photos directory exists
  const PHOTOS_DIR = path.join(process.cwd(), "uploads", "photos");
  if (!fs.existsSync(PHOTOS_DIR)) fs.mkdirSync(PHOTOS_DIR, { recursive: true });

  const photoUpload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, PHOTOS_DIR),
      filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname) || ".jpg";
        cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
      },
    }),
    limits: { fileSize: 8 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      cb(null, /image\//.test(file.mimetype));
    },
  });

  app.post("/api/upload-photo", photoUpload.single("photo"), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No image uploaded" });
    // Serve under /uploads/photos/<filename>
    res.json({ url: `/uploads/photos/${req.file.filename}` });
  });

  // Serve uploaded photos as static files
  app.use("/uploads/photos", (req, res, next) => {
    const filePath = path.join(PHOTOS_DIR, path.basename(req.url));
    if (fs.existsSync(filePath)) {
      res.sendFile(filePath);
    } else {
      next();
    }
  });

  // ─── Cascade Recalculate ─────────────────────────────────────────────────────
  // Re-computes costs for all sub-recipes, recipes, and platters in dependency order.
  app.post("/api/cascade-recalculate", async (req, res) => {
    try {
      const markup = await getMarkup();
      const wholesaleMarkup = await getWholesaleMarkup();
      const hourlyRate = parseFloat(await storage.getSetting("labour_rate_per_hour") || "35");

      // Pass ALL sub-recipe ids — cascadeFromSubRecipes uses topological sort
      const allSRIds = new Set((await storage.getSubRecipes()).map((s) => s.id));
      await cascadeFromSubRecipes(allSRIds, markup, wholesaleMarkup, hourlyRate);

      // Also recalculate any recipes/platters that don’t use sub-recipes
      const allRecipes = await storage.getRecipes();
      for (const r of allRecipes) {
        const costs = await computeRecipeCosts(
          r.ingredientsJson, r.subRecipesJson, r.packagingJson,
          r.labourMinutes || 0, markup, hourlyRate, r.portionCount || 1, r.rrp, wholesaleMarkup, r.wholesaleRrp
        );
        await storage.updateRecipe(r.id, costs);
      }
      const allPlatters = await storage.getPlatters();
      for (const p of allPlatters) {
        const costs = await computePlatterCosts(
          p.itemsJson, p.packagingJson, (p as any).labourMinutes || 0, markup, wholesaleMarkup, p.wholesaleRrp, hourlyRate
        );
        const marginPercent = p.rrp && costs.totalCost > 0 ? ((p.rrp - costs.totalCost) / p.rrp) * 100 : 0;
        await storage.updatePlatter(p.id, { ...costs, marginPercent });
      }

      res.json({ ok: true, subRecipes: allSRIds.size, recipes: allRecipes.length, platters: allPlatters.length });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Invoices ───────────────────────────────────────────────────────────────
  app.get("/api/invoices", async (req, res) => {
    try {
      const list = await storage.getInvoices();
      const sups = await storage.getSuppliers();
      const supMap: Record<number, string> = {};
      sups.forEach((s) => (supMap[s.id] = s.name));
      res.json(list.map((inv) => ({
        ...inv,
        supplierName: inv.supplierId ? supMap[inv.supplierId] : null,
      })));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/invoices/upload", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });
      const supplierId = req.body.supplierId ? Number(req.body.supplierId) : undefined;
      const invoiceDate = req.body.invoiceDate || null;
      const invoiceRef = req.body.invoiceRef || null;

      // Try to parse PDF line items
      let lineItems: any[] = [];
      if (req.file.mimetype === "application/pdf") {
        try {
          const pdfParse = (await import("pdf-parse")).default;
          const buffer = fs.readFileSync(req.file.path);
          const data = await pdfParse(buffer);
          // Simple heuristic: look for lines with numbers that could be prices
          const lines = data.text.split("\n").filter((l: string) => l.trim());
          lineItems = lines
            .filter((l: string) => /\$?\d+\.?\d*/.test(l))
            .slice(0, 50)
            .map((l: string) => ({ rawText: l.trim() }));
        } catch {}
      }

      const invoice = await storage.createInvoice({
        supplierId: supplierId || null,
        filename: req.file.originalname,
        uploadedAt: new Date().toISOString(),
        invoiceDate,
        invoiceRef,
        lineItemsJson: JSON.stringify(lineItems),
        notes: req.body.notes || null,
      });

      // Clean up temp file
      fs.unlink(req.file.path, () => {});
      res.json(invoice);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/invoices/:id/line-items", async (req, res) => {
    try {
      const invoice = await storage.getInvoice(Number(req.params.id));
      if (!invoice) return res.status(404).json({ error: "Not found" });
      await storage.createInvoice({ ...invoice, lineItemsJson: JSON.stringify(req.body.lineItems) });
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/invoices/:id", async (req, res) => {
    try {
      await storage.deleteInvoice(Number(req.params.id));
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Xero Imports ────────────────────────────────────────────────────────────

  // POST /api/xero/sync — agent calls this after fetching bills from Xero
  // Body: array of bill objects from Xero API
  app.post("/api/xero/sync", async (req, res) => {
    try {
      const bills: any[] = Array.isArray(req.body) ? req.body : req.body.bills || [];
      const now = new Date().toISOString();
      let upserted = 0;
      for (const bill of bills) {
        // Extract supplier name from Contact
        const supplierName = bill.Contact?.Name || bill.contact?.name || null;
        // Extract description from line items (join first few)
        const lineItems: any[] = bill.LineItems || bill.lineItems || [];
        const lineDescription = lineItems
          .map((li: any) => li.Description || li.description || '')
          .filter(Boolean)
          .slice(0, 5)
          .join(' | ') || null;
        const totalAmount = bill.Total ?? bill.total ?? bill.AmountDue ?? null;
        const invoiceDate = bill.DateString || bill.date || bill.Date || null;
        const xeroInvoiceNumber = bill.InvoiceNumber || bill.invoiceNumber || null;
        const hubdocUrl = bill.Url || bill.url || null;
        const currency = bill.CurrencyCode || bill.currencyCode || 'AUD';
        await storage.upsertXeroImport({
          xeroInvoiceId: bill.InvoiceID || bill.invoiceID || bill.id,
          xeroInvoiceNumber,
          supplierName,
          supplierId: null,
          invoiceDate,
          totalAmount,
          currency,
          lineDescription,
          hubdocUrl,
          status: 'pending',
          ingredientId: null,
          costPerUnit: null,
          quantity: null,
          unit: null,
          notes: null,
          syncedAt: now,
          resolvedAt: null,
        });
        upserted++;
      }
      res.json({ ok: true, upserted });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Helper: find supplier id by name
  async function findSupplierId(supplierName: string | null): Promise<number | null> {
    if (!supplierName) return null;
    const allSuppliers = await storage.getSuppliers();
    return allSuppliers.find(
      (s) => s.name.toLowerCase() === supplierName.toLowerCase()
    )?.id ?? null;
  }

  // GET /api/invoice-memory/suggest-supplier?name=... — suggest supplier from memory
  app.get("/api/invoice-memory/suggest-supplier", async (req, res) => {
    try {
      const name = String(req.query.name || "");
      if (!name) return res.json({ supplierId: null });
      const supplierId = await storage.suggestSupplierForName(name);
      res.json({ supplierId });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/invoice-memory/suggest-ingredient?description=... — suggest ingredient from memory
  app.get("/api/invoice-memory/suggest-ingredient", async (req, res) => {
    try {
      const description = String(req.query.description || "");
      if (!description) return res.json({ ingredientId: null });
      const ingredientId = await storage.suggestIngredientForLine(description);
      res.json({ ingredientId });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/invoice-memory/line-items — all learned line item mappings
  app.get("/api/invoice-memory/line-items", async (req, res) => {
    try {
      res.json(await storage.getLineItemSuggestions());
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/xero/imports — all imports with line item counts
  app.get("/api/xero/imports", async (req, res) => {
    try {
      const list = await storage.getXeroImports();
      res.json(list);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/xero/imports/pending-count
  app.get("/api/xero/imports/pending-count", async (req, res) => {
    try {
      res.json({ count: await storage.getXeroPendingCount() });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/xero/imports/:id/line-items — get line items for one invoice
  app.get("/api/xero/imports/:id/line-items", async (req, res) => {
    try {
      const id = Number(req.params.id);
      const lines = await storage.getXeroLineItems(id);
      res.json(lines);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/xero/imports/:id/line-items — add a new blank line item
  app.post("/api/xero/imports/:id/line-items", async (req, res) => {
    try {
      const xeroImportId = Number(req.params.id);
      const { description } = req.body;
      const line = await storage.createXeroLineItem({
        xeroImportId,
        description: description || null,
        status: 'pending',
        ingredientId: null,
        ingredientName: null,
        costPerUnit: null,
        quantity: null,
        unit: null,
        lineTotal: null,
        notes: null,
        createdAt: new Date().toISOString(),
        resolvedAt: null,
      });
      res.json(line);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // PUT /api/xero/line-items/:id/resolve — match / add / ignore a single line item
  app.put("/api/xero/line-items/:id/resolve", async (req, res) => {
    try {
      const lineId = Number(req.params.id);
      const { status, ingredientId, costPerUnit, quantity, unit, notes, newIngredient, totalCost, brandName: bodyBrandName, avgWeightPerUnit } = req.body;

      if (!['matched', 'added', 'ignored'].includes(status)) {
        return res.status(400).json({ error: 'status must be matched | added | ignored' });
      }

      let resolvedIngredientId = ingredientId;
      let resolvedIngredientName: string | null = null;
      const effectiveUnit = unit || newIngredient?.unit || 'kg';

      // If 'added', create a new ingredient first
      if (status === 'added' && newIngredient) {
        const created = await storage.createIngredient({
          name: newIngredient.name,
          category: newIngredient.category || 'General',
          unit: effectiveUnit,
          bestCostPerUnit: costPerUnit || 0,
          bestSupplierId: null,
          notes: newIngredient.notes || null,
          avgWeightPerUnit: newIngredient.avgWeightPerUnit ?? avgWeightPerUnit ?? null,
        });
        resolvedIngredientId = created.id;
        resolvedIngredientName = created.name;
      } else if (status === 'matched' && ingredientId) {
        const ing = await storage.getIngredient(ingredientId);
        resolvedIngredientName = ing?.name ?? null;
        // If user provided a weight and the ingredient doesn't have one, save it
        if (avgWeightPerUnit != null) {
          await storage.updateIngredient(ingredientId, { avgWeightPerUnit });
        }
      }

      // Use totalCost (inc. GST) from request if provided, else fall back to costPerUnit * quantity
      const lineTotal: number | null =
        totalCost != null ? Number(totalCost) :
        (costPerUnit && quantity) ? costPerUnit * quantity : null;

      const resolved = await storage.resolveXeroLineItem(lineId, {
        status,
        ingredientId: resolvedIngredientId || undefined,
        ingredientName: resolvedIngredientName || undefined,
        costPerUnit: costPerUnit || undefined,
        quantity: quantity || undefined,
        unit: effectiveUnit || undefined,
        lineTotal: lineTotal ?? undefined,
        notes: notes || undefined,
      });
      if (!resolved) return res.status(404).json({ error: 'Line item not found' });

      // Create supplier ingredient price record if matched/added
      if ((status === 'matched' || status === 'added') && resolvedIngredientId && costPerUnit) {
        const xeroImport = await storage.getXeroImport(resolved.xeroImportId);
        const supplierId = xeroImport?.supplierId || await findSupplierId(xeroImport?.supplierName ?? null);
        await storage.createSupplierIngredient({
          ingredientId: resolvedIngredientId,
          supplierId: supplierId || 1,
          costPerUnit,
          packSize: quantity || null,
          packCost: lineTotal,
          invoiceDate: xeroImport?.invoiceDate || null,
          invoiceRef: xeroImport?.xeroInvoiceNumber || null,
          notes: notes || null,
        });
        // Learn: line item description → ingredient
        if (resolved.description) {
          await storage.learnLineItemMapping(resolved.description, resolvedIngredientId);
        }

        // Cascade: ingredient price change → sub-recipes → recipes → platters
        try {
          const markup = await getMarkup();
          const wholesaleMarkup = await getWholesaleMarkup();
          const hourlyRate = parseFloat(await storage.getSetting("labour_rate_per_hour") || "35");
          const ingId = resolvedIngredientId!;
          const directSRs = (await storage.getSubRecipes())
            .filter((sr) => JSON.parse(sr.ingredientsJson || "[]").some((l: any) => l.ingredientId === ingId))
            .map((sr) => sr.id);
          if (directSRs.length > 0) {
            await cascadeFromSubRecipes(new Set(directSRs), markup, wholesaleMarkup, hourlyRate);
          }
          // Recipes that directly use this ingredient
          for (const r of await storage.getRecipes()) {
            const usesIng = JSON.parse(r.ingredientsJson || "[]").some((l: any) => l.ingredientId === ingId);
            const usesPkg = JSON.parse(r.packagingJson || "[]").some((l: any) => l.ingredientId === ingId);
            if (usesIng || usesPkg) {
              const costs = await computeRecipeCosts(r.ingredientsJson, r.subRecipesJson, r.packagingJson, r.labourMinutes || 0, markup, hourlyRate, r.portionCount || 1, r.rrp, wholesaleMarkup, r.wholesaleRrp, (r as any).recipesJson);
              await storage.updateRecipe(r.id, costs);
            }
          }
        } catch (_) { /* silent — don't block the response */ }

        // Update brand name + allergens + PEAL asynchronously
        // Priority: 1) user-provided brand from request body, 2) stored brand from parsed invoice line,
        // 3) AI extraction from description.
        const ingForBrand = await storage.getIngredient(resolvedIngredientId);
        const existingBrand = (ingForBrand as any)?.brandName || "";
        const userProvidedBrand = (bodyBrandName || "").trim();
        // Get the stored brandName from the invoice line item (set during parse_invoice.py extraction)
        const parsedLineBrand = (((await storage.getXeroLineItem(lineId)) as any)?.brandName || "").trim();

        (async () => {
          try {
            const ALLERGENS = ["Gluten","Tree Nuts","Dairy","Eggs","Peanuts","Sesame","Soy","Fish","Sulphites","Crustacea","Molluscs"];
            let newBrand = "";

            if (userProvidedBrand) {
              // User explicitly provided a brand — use it
              newBrand = userProvidedBrand;
            } else if (parsedLineBrand) {
              // Use the brand extracted directly from the invoice by parse_invoice.py
              newBrand = parsedLineBrand;
            } else if (resolved.description) {
              // Fall back to AI extraction from description
              const brandExtractPrompt = `Extract the brand name from this supplier invoice line item description for an Australian food supplier.
Description: "${resolved.description}"
Generic ingredient name: "${ingForBrand?.name || ""}"
Supplier: "${(await storage.getXeroImport(resolved.xeroImportId))?.supplierName || ""}"

Return ONLY a JSON object: { "brandName": "...", "found": true/false }
- If a specific brand name is clearly present (e.g. "Fountain", "Bega", "Praise", "Heinz"), return it
- Include the product descriptor with the brand (e.g. "Fountain BBQ Sauce 2L", "Bega Tasty Cheese 2kg")
- If no brand is identifiable, return { "brandName": "", "found": false }
- Return ONLY JSON`;
              const brandMsg = await anthropic.messages.create({
                model: "claude_haiku_4_5",
                max_tokens: 100,
                messages: [{ role: "user", content: brandExtractPrompt }],
              });
              const brandText = ((brandMsg.content?.[0] as any)?.text || "").trim();
              const brandJsonMatch = brandText.match(/\{[\s\S]*?\}/);
              if (brandJsonMatch) {
                const parsed = JSON.parse(brandJsonMatch[0]);
                if (parsed.found) newBrand = (parsed.brandName || "").trim();
              }
            }

            // Supplier-as-brand fallback: for suppliers that ARE the brand
            // (small local producers, fresh produce suppliers, artisan bakers, etc.)
            // use the supplier name itself when no other brand is found.
            if (!newBrand) {
              const xeroImpData = await storage.getXeroImport(resolved.xeroImportId);
              const supplierForBrand = xeroImpData?.supplierName || "";
              // Heuristic: if it's a small/local/produce supplier (not a major distributor like Bidfood/Campbells/Costco)
              const majorDistributors = ['bidfood', 'campbells', 'costco', 'iga', 'coles', 'woolworths', 'metcash', 'sysco', 'bidvest'];
              const isDistributor = majorDistributors.some(d => supplierForBrand.toLowerCase().includes(d));
              if (supplierForBrand && !isDistributor) {
                newBrand = supplierForBrand;
              }
            }

            // Only refresh allergens + PEAL if brand has changed
            if (newBrand && newBrand !== existingBrand) {
              await storage.updateIngredient(resolvedIngredientId, { brandName: newBrand });

              const allergenPrompt = `You are a food allergen expert for the Australian/NZ market.
Product: "${newBrand}" (generic: "${ingForBrand?.name || ""}", category: "${ingForBrand?.category || ""}")\nUsing your knowledge of this specific branded product sold in Australia, identify which allergens it DEFINITELY contains.\nAllowed keys: ${ALLERGENS.join(", ")}\nBe precise — use the brand name. Return ONLY a JSON array, e.g. ["Gluten","Soy"] or []`;
              const allergenMsg = await anthropic.messages.create({ model: "claude_haiku_4_5", max_tokens: 200, messages: [{ role: "user", content: allergenPrompt }] });
              const at = ((allergenMsg.content?.[0] as any)?.text || "").trim();
              const am = at.match(/\[[\s\S]*?\]/);
              const allergens: string[] = am ? (JSON.parse(am[0]) as string[]).filter((a: string) => ALLERGENS.includes(a)) : [];
              await storage.updateIngredient(resolvedIngredientId, { dietariesJson: JSON.stringify(allergens) });

              const pealPrompt = `You are a food labelling expert for FSANZ PEAL (Australia/NZ).\nProduct: "${newBrand}" (generic: "${ingForBrand?.name || ""}", category: "${ingForBrand?.category || ""}")\nKnown allergens: ${allergens.length > 0 ? allergens.join(", ") : "none"}\nGenerate the full FSANZ ingredient declaration for use inside a composite product's ingredient list. Use square brackets for sub-ingredients. Include additive code numbers. No "Contains:". No full stop. Return ONLY the declaration string.`;
              const pealMsg = await anthropic.messages.create({ model: "claude_haiku_4_5", max_tokens: 400, messages: [{ role: "user", content: pealPrompt }] });
              const pealLabel = ((pealMsg.content?.[0] as any)?.text || "").trim().replace(/^"|"$/g, "");
              await storage.updateIngredient(resolvedIngredientId, { pealLabel });
            } else if (userProvidedBrand && userProvidedBrand === existingBrand) {
              // Brand unchanged but user confirmed it — no allergen refresh needed
            }
          } catch (_) { /* silent — don't break the resolve response */ }
        })();
      }

      // Update parent invoice status
      await storage.updateXeroImportStatus(resolved.xeroImportId);

      res.json(resolved);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // DELETE /api/xero/line-items/:id — remove a line item
  app.delete("/api/xero/line-items/:id", async (req, res) => {
    try {
      const lineId = Number(req.params.id);
      await storage.deleteXeroLineItem(lineId);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // PUT /api/xero/imports/:id/ignore — ignore entire invoice
  app.put("/api/xero/imports/:id/ignore", async (req, res) => {
    try {
      const id = Number(req.params.id);
      const resolved = await storage.resolveXeroImport(id, { status: 'ignored' });
      if (!resolved) return res.status(404).json({ error: 'Not found' });
      res.json(resolved);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });


  // PATCH /api/xero/imports/:id/supplier — update supplier on an existing import
  // Body: { supplierId?: number, supplierName?: string, createNew?: boolean }
  app.patch("/api/xero/imports/:id/supplier", async (req, res) => {
    try {
      const id = Number(req.params.id);
      const { supplierId, supplierName, createNew } = req.body;
      let resolvedSupplierId: number | null = supplierId ? Number(supplierId) : null;
      let resolvedName: string | null = supplierName || null;

      if (createNew && supplierName) {
        // Check not already existing
        const existing = (await storage.getSuppliers()).find(
          (s) => s.name.toLowerCase() === supplierName.toLowerCase()
        );
        if (existing) {
          resolvedSupplierId = existing.id;
        } else {
          const newSup = await storage.createSupplier({
            name: supplierName,
            contactName: null,
            email: null,
            phone: null,
            notes: `Auto-created from invoice upload`,
          });
          resolvedSupplierId = newSup.id;
        }
        resolvedName = supplierName;
      } else if (resolvedSupplierId) {
        const sup = await storage.getSupplier(resolvedSupplierId);
        resolvedName = sup?.name || supplierName || null;
      }

      const updated = await storage.patchXeroImportSupplier(id, resolvedSupplierId, resolvedName);
      if (!updated) return res.status(404).json({ error: "Not found" });
      // Learn: detected invoice name → confirmed supplier
      const imp = await storage.getXeroImport(id);
      const detectedName = imp?.supplierName || resolvedName;
      if (detectedName && resolvedSupplierId) {
        await storage.learnSupplierMapping(detectedName, resolvedSupplierId);
      }
      res.json({ ok: true, supplierId: resolvedSupplierId, supplierName: resolvedName });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Invoice PDF routes ──────────────────────────────────────────────────────

  // GET /api/xero/imports/:id/pdf-status — check if a cached PDF exists
  app.get("/api/xero/imports/:id/pdf-status", async (req, res) => {
    const id = Number(req.params.id);
    const xeroImport = await storage.getXeroImport(id);
    if (!xeroImport) return res.status(404).json({ hasPdf: false });
    const pdfPath = path.join(PDF_CACHE_DIR, `${xeroImport.xeroInvoiceId}.pdf`);
    const hasPdf = fs.existsSync(pdfPath);
    res.json({ hasPdf, url: hasPdf ? `/api/xero/imports/${id}/pdf` : null });
  });

  // GET /api/xero/imports/:id/pdf — serve the cached PDF inline
  app.get("/api/xero/imports/:id/pdf", async (req, res) => {
    const id = Number(req.params.id);
    const xeroImport = await storage.getXeroImport(id);
    if (!xeroImport) return res.status(404).send("Invoice not found");
    const pdfPath = path.join(PDF_CACHE_DIR, `${xeroImport.xeroInvoiceId}.pdf`);
    if (!fs.existsSync(pdfPath)) return res.status(404).send("PDF not yet uploaded");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${xeroImport.supplierName || "invoice"}.pdf"`);
    fs.createReadStream(pdfPath).pipe(res);
  });

  // POST /api/xero/imports/:id/upload-pdf — manually upload a PDF
  app.post("/api/xero/imports/:id/upload-pdf", pdfUpload.single("pdf"), async (req: any, res) => {
    try {
      const id = Number(req.params.id);
      const xeroImport = await storage.getXeroImport(id);
      if (!xeroImport) return res.status(404).json({ error: "Invoice not found" });
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });
      const destPath = path.join(PDF_CACHE_DIR, `${xeroImport.xeroInvoiceId}.pdf`);
      fs.renameSync(req.file.path, destPath);
      res.json({ ok: true, url: `/api/xero/imports/${id}/pdf` });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/xero/imports/:id/save-pdf — agent posts base64 PDF to save to disk
  app.post("/api/xero/imports/:id/save-pdf", async (req, res) => {
    try {
      const id = Number(req.params.id);
      const xeroImport = await storage.getXeroImport(id);
      if (!xeroImport) return res.status(404).json({ error: "Invoice not found" });
      const { base64 } = req.body;
      if (!base64) return res.status(400).json({ error: "No base64 data" });
      const buf = Buffer.from(base64, "base64");
      const destPath = path.join(PDF_CACHE_DIR, `${xeroImport.xeroInvoiceId}.pdf`);
      fs.writeFileSync(destPath, buf);
      res.json({ ok: true, size: buf.length });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Manual Upload (multipart) with AI extraction ────────────────────────────
  // POST /api/drive/upload — accepts PDF or image, runs parse_invoice.py, creates import
  // multer is configured to accept any file (type validation done after upload)
  const anyFileUpload = multer({ dest: "uploads/pdf-cache/" });
  app.post("/api/drive/upload", anyFileUpload.single("pdf"), async (req: any, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });

      const originalName = (req.file.originalname || req.file.filename || "invoice");
      const uploadedPath = req.file.path;

      // Run Python parser — it handles PDF and images, always returns valid JSON
      const { execFile } = await import("child_process");
      const parsePath = path.join(process.cwd(), "server", "parse_invoice.py");
      const parsed: any = await new Promise((resolve) => {
        execFile(
          "python3", [parsePath, uploadedPath, originalName],
          { maxBuffer: 10 * 1024 * 1024, env: { ...process.env } },
          (_err, stdout, _stderr) => {
            // parse_invoice.py always outputs valid JSON — extract it robustly
            // (strip any Python warnings/notices that may appear before the JSON)
            let jsonStr = stdout;
            const jsonStart = stdout.indexOf('{');
            const jsonEnd = stdout.lastIndexOf('}');
            if (jsonStart !== -1 && jsonEnd !== -1) {
              jsonStr = stdout.slice(jsonStart, jsonEnd + 1);
            }
            try {
              resolve(JSON.parse(jsonStr));
            } catch {
              // Absolute fallback — return empty parsed result
              resolve({
                supplierName: null,
                invoiceNumber: null,
                invoiceDate: null,
                totalAmount: null,
                lineItems: [],
                error: `Could not parse output: ${stdout.slice(0, 300)}`,
              });
            }
          }
        );
      });

      // Build a unique ID from filename + size
      const fakeId = `manual_${Date.now()}_${req.file.size}`;
      const invoiceId = `drive_${fakeId}`;

      // The file is already saved in pdf-cache/ by multer — just rename it
      const destPath = path.join(PDF_CACHE_DIR, `${invoiceId}.pdf`);
      try {
        fs.renameSync(uploadedPath, destPath);
      } catch {
        // If rename fails across devices, copy then delete
        fs.copyFileSync(uploadedPath, destPath);
        fs.unlinkSync(uploadedPath);
      }

      // Strip file extension from name for display
      const cleanName = originalName.replace(/\.(pdf|jpg|jpeg|png|tiff?|bmp|gif|webp)$/i, "");

      // Only match to existing supplier — do NOT auto-create here.
      // Supplier creation happens in the confirm step (PATCH /api/xero/imports/:id/supplier).
      const allSuppliers = await storage.getSuppliers();
      let supplierId: number | null = null;
      if (parsed.supplierName) {
        const match = allSuppliers.find(
          (s: any) => s.name.toLowerCase() === parsed.supplierName.toLowerCase()
        );
        if (match) supplierId = match.id;
      }

      // Create import record
      const imported = await storage.upsertXeroImport({
        xeroInvoiceId: invoiceId,
        xeroInvoiceNumber: parsed.invoiceNumber || cleanName,
        supplierName: parsed.supplierName || null,
        supplierId,
        invoiceDate: parsed.invoiceDate || null,
        totalAmount: parsed.totalAmount || null,
        currency: "AUD",
        lineDescription: originalName,
        hubdocUrl: null,
        source: "drive",
        driveFileId: fakeId,
        driveFileUrl: null,
        status: "pending",
        syncedAt: new Date().toISOString(),
      } as any);

      // Create line items
      let lineItemsCreated = 0;
      for (const li of (parsed.lineItems || [])) {
        await storage.createXeroLineItem({
          xeroImportId: imported.id,
          description: li.description,
          status: "pending",
          quantity: li.quantity || null,
          costPerUnit: li.unitPrice || null,
          lineTotal: li.lineTotal || null,
          unit: li.unit || null,
          // Carton/pack breakdown (Bidfood, Campbells, etc.)
          cartonsSupplied: li.cartonsSupplied || null,
          packsPerCarton: li.packsPerCarton || null,
          packSize: li.packSize || null,
          packUnit: li.packUnit || null,
          brandName: (li.brandName || "").trim(),
          createdAt: new Date().toISOString(),
        } as any);
        lineItemsCreated++;
      }

      // Use memory to suggest supplier if not already matched
      let suggestedSupplierId = supplierId;
      if (!suggestedSupplierId && parsed.supplierName) {
        suggestedSupplierId = await storage.suggestSupplierForName(parsed.supplierName);
      }

      res.json({
        ok: true,
        importId: imported.id,
        supplierName: parsed.supplierName,
        suggestedSupplierId,   // memory suggestion (null if unknown)
        invoiceNumber: parsed.invoiceNumber,
        invoiceDate: parsed.invoiceDate,
        totalAmount: parsed.totalAmount,
        lineItemsCreated,
        parseWarning: parsed.error || null,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Google Drive Folder Scan ─────────────────────────────────────────────────
  // POST /api/drive/scan-folder
  // Body: { accessToken: string, folderId: string }
  // Lists all PDFs/images in the folder, downloads each, runs parse_invoice.py,
  // then posts the parsed data to /api/drive/sync internally.
  // The accessToken must be a valid Google OAuth2 access token with Drive read scope.
  app.post("/api/drive/scan-folder", async (req: any, res) => {
    const { accessToken, folderId } = req.body as { accessToken: string; folderId: string };
    if (!accessToken || !folderId) {
      return res.status(400).json({ error: "accessToken and folderId are required" });
    }

    try {
      const { google } = await import("googleapis");
      const auth = new google.auth.OAuth2();
      auth.setCredentials({ access_token: accessToken });
      const drive = google.drive({ version: "v3", auth });

      // List files in folder (PDFs and images only)
      const listRes = await drive.files.list({
        q: `'${folderId}' in parents and mimeType != 'application/vnd.google-apps.folder' and trashed = false`,
        fields: "files(id, name, mimeType, webViewLink, createdTime)",
        pageSize: 50,
        orderBy: "createdTime desc",
      });

      const files = listRes.data.files || [];
      const SUPPORTED_MIME = [
        "application/pdf",
        "image/jpeg", "image/jpg", "image/png",
        "image/tiff", "image/bmp", "image/gif", "image/webp",
      ];
      const invoiceFiles = files.filter((f: any) => {
        if (SUPPORTED_MIME.includes(f.mimeType)) return true;
        const ext = (f.name || "").split(".").pop()?.toLowerCase() || "";
        return ["pdf","jpg","jpeg","png","tiff","tif","bmp","gif","webp"].includes(ext);
      });

      if (invoiceFiles.length === 0) {
        return res.json({ ok: true, found: 0, imported: 0, skipped: 0, results: [] });
      }

      const parseResults: any[] = [];
      const tmpDir = os.tmpdir();

      for (const file of invoiceFiles) {
        const fileId = file.id!;
        const fileName = file.name || fileId;

        // Check if already imported
        const invoiceId = `drive_${fileId}`;
        const existing = (await storage.getXeroImports()).find(
          (i: any) => i.xeroInvoiceId === invoiceId
        );
        if (existing) {
          parseResults.push({ fileName, skipped: true, importId: existing.id });
          continue;
        }

        try {
          // Download the file
          const dlRes = await drive.files.get(
            { fileId, alt: "media" },
            { responseType: "arraybuffer" }
          );
          const buf = Buffer.from(dlRes.data as ArrayBuffer);
          const tmpPath = path.join(tmpDir, `drive_${fileId}_${Date.now()}_${fileName.replace(/[^a-zA-Z0-9._-]/g, "_")}`);
          fs.writeFileSync(tmpPath, buf);

          // Parse with parse_invoice.py
          const parsed = await new Promise<any>((resolve, reject) => {
            const scriptPath = path.join(__dirname, "parse_invoice.py");
            execFile("python3", [scriptPath, tmpPath, fileName], {
              maxBuffer: 10 * 1024 * 1024,
              env: { ...process.env },
            }, (err: any, stdout: string, stderr: string) => {
              try { fs.unlinkSync(tmpPath); } catch (_) {}
              if (err && !stdout) return reject(new Error(stderr || err.message));
              try { resolve(JSON.parse(stdout)); }
              catch (_) { reject(new Error("Invalid JSON from parser: " + stdout.slice(0, 200))); }
            });
          });

          // Find or create supplier
          const allSuppliers = await storage.getSuppliers();
          let supplierId: number | null = null;
          const supplierName = parsed.supplierName || fileName.replace(/[_-]/g, " ").replace(/\.pdf$/i, "");
          const matchedSupplier = allSuppliers.find(
            (s: any) => s.name.toLowerCase() === supplierName.toLowerCase()
          );
          if (matchedSupplier) {
            supplierId = matchedSupplier.id;
          } else if (supplierName) {
            const newSupplier = await storage.createSupplier({
              name: supplierName,
              contactName: null, email: null, phone: null,
              notes: "Auto-created from Google Drive invoice",
            });
            supplierId = newSupplier.id;
          }

          // Save PDF to cache
          const pdfCachePath = path.join(PDF_CACHE_DIR, `${invoiceId}.pdf`);
          try { fs.writeFileSync(pdfCachePath, buf); } catch (_) {}

          // Create xero_import record
          const imported = await storage.upsertXeroImport({
            xeroInvoiceId: invoiceId,
            xeroInvoiceNumber: parsed.invoiceNumber || fileName,
            supplierName,
            supplierId,
            invoiceDate: parsed.invoiceDate || file.createdTime?.split("T")[0] || null,
            totalAmount: parsed.totalAmount || null,
            currency: "AUD",
            lineDescription: fileName,
            hubdocUrl: null,
            source: "drive",
            driveFileId: fileId,
            driveFileUrl: file.webViewLink || null,
            status: "pending",
            syncedAt: new Date().toISOString(),
          } as any);

          // Create line items
          let lineItemsCreated = 0;
          for (const li of (parsed.lineItems || [])) {
            await storage.createXeroLineItem({
              xeroImportId: imported.id,
              description: li.description,
              status: "pending",
              quantity: li.quantity || null,
              costPerUnit: li.unitPrice || null,
              lineTotal: li.lineTotal || null,
              unit: li.unit || null,
              cartonsSupplied: li.cartonsSupplied || null,
              packsPerCarton: li.packsPerCarton || null,
              packSize: li.packSize || null,
              packUnit: li.packUnit || null,
              createdAt: new Date().toISOString(),
            } as any);
            lineItemsCreated++;
          }

          parseResults.push({ fileName, imported: true, importId: imported.id, lineItemsCreated, parseWarning: parsed.error || null });

        } catch (fileErr: any) {
          parseResults.push({ fileName, error: fileErr.message });
        }
      }

      // Optionally delete processed files from Drive (if requested)
      if (req.body.deleteAfterImport) {
        for (const r of parseResults) {
          if (r.imported) {
            const file = invoiceFiles.find((f: any) => `${f.name}` === r.fileName);
            if (file?.id) {
              try { await drive.files.delete({ fileId: file.id }); } catch (_) {}
            }
          }
        }
      }

      const imported = parseResults.filter(r => r.imported).length;
      const skipped = parseResults.filter(r => r.skipped).length;
      const errors = parseResults.filter(r => r.error).length;

      res.json({ ok: true, found: invoiceFiles.length, imported, skipped, errors, results: parseResults });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Google Drive Invoice Sync ──────────────────────────────────────────────
  // POST /api/drive/sync — agent posts pre-parsed invoice data from Google Drive PDFs
  // Body: { invoices: [{ fileName, supplierName, invoiceNumber, invoiceDate, totalAmount,
  //   driveFileId, driveFileUrl, pdfBase64?, lineItems: [{description, quantity, unitPrice, lineTotal, unit?}] }] }
  app.post("/api/drive/sync", async (req, res) => {
    try {
      const { invoices: driveInvoices } = req.body as {
        invoices: Array<{
          fileName: string;
          supplierName: string;
          invoiceNumber?: string;
          invoiceDate?: string;
          totalAmount?: number;
          driveFileId: string;
          driveFileUrl?: string;
          pdfBase64?: string;
          lineItems: Array<{
            description: string;
            quantity?: number;
            unitPrice?: number;
            lineTotal?: number;
            unit?: string;
          }>;
        }>;
      };

      if (!driveInvoices || !Array.isArray(driveInvoices)) {
        return res.status(400).json({ error: "invoices array required" });
      }

      const results: Array<{ fileName: string; importId: number; lineItemsCreated: number; skipped?: boolean }> = [];

      for (const inv of driveInvoices) {
        // Use driveFileId as the unique invoice identifier
        const invoiceId = `drive_${inv.driveFileId}`;

        // Check if already imported
        const existing = (await storage.getXeroImports()).find(
          (i: any) => i.xeroInvoiceId === invoiceId
        );
        if (existing) {
          results.push({ fileName: inv.fileName, importId: existing.id, lineItemsCreated: 0, skipped: true });
          continue;
        }

        // Save PDF to cache if provided
        if (inv.pdfBase64) {
          try {
            const pdfBuf = Buffer.from(inv.pdfBase64, "base64");
            const pdfPath = path.join(PDF_CACHE_DIR, `${invoiceId}.pdf`);
            fs.writeFileSync(pdfPath, pdfBuf);
          } catch (_) {}
        }

        // Find or auto-create supplier
        const allSuppliers = await storage.getSuppliers();
        let supplierId: number | null = null;
        if (inv.supplierName) {
          const match = allSuppliers.find(
            (s: any) => s.name.toLowerCase() === inv.supplierName.toLowerCase()
          );
          if (match) {
            supplierId = match.id;
          } else {
            // Auto-create new supplier from invoice data
            const newSupplier = await storage.createSupplier({
              name: inv.supplierName,
              contactName: null,
              email: null,
              phone: null,
              notes: `Auto-created from invoice upload`,
            });
            supplierId = newSupplier.id;
          }
        }

        // Create the xero_import record (source = 'drive')
        const imported = await storage.upsertXeroImport({
          xeroInvoiceId: invoiceId,
          xeroInvoiceNumber: inv.invoiceNumber || inv.fileName,
          supplierName: inv.supplierName,
          supplierId,
          invoiceDate: inv.invoiceDate || null,
          totalAmount: inv.totalAmount || null,
          currency: "AUD",
          lineDescription: inv.fileName,
          hubdocUrl: null,
          source: "drive",
          driveFileId: inv.driveFileId,
          driveFileUrl: inv.driveFileUrl || null,
          status: "pending",
          syncedAt: new Date().toISOString(),
        } as any);

        // Create line items
        let lineItemsCreated = 0;
        for (const li of inv.lineItems) {
          await storage.createXeroLineItem({
            xeroImportId: imported.id,
            description: li.description,
            status: "pending",
            quantity: li.quantity || null,
            costPerUnit: li.unitPrice || null,
            lineTotal: li.lineTotal || null,
            unit: li.unit || null,
            cartonsSupplied: li.cartonsSupplied || null,
            packsPerCarton: li.packsPerCarton || null,
            packSize: li.packSize || null,
            packUnit: li.packUnit || null,
            createdAt: new Date().toISOString(),
          } as any);
          lineItemsCreated++;
        }

        results.push({ fileName: inv.fileName, importId: imported.id, lineItemsCreated });
      }

      res.json({ ok: true, results });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Cheapest Items per Supplier ────────────────────────────────────────────
  app.get("/api/suppliers/:id/cheapest-items", async (req, res) => {
    const supplierId = Number(req.params.id);
    const allSI = await storage.getSupplierIngredients();
    const allIngredients = await storage.getIngredients();

    // For each ingredient, find the most recent record per supplier
    const ingIds = [...new Set(allSI.map((si) => si.ingredientId))];
    const result: any[] = [];

    for (const ingId of ingIds) {
      const records = allSI.filter((si) => si.ingredientId === ingId);
      // Group by supplier, take the most recent invoice_date record per supplier
      const bySupplier: Record<number, typeof records[0]> = {};
      for (const r of records) {
        const existing = bySupplier[r.supplierId];
        if (!existing) {
          bySupplier[r.supplierId] = r;
        } else {
          // Compare invoice dates — treat null as very old
          const existingDate = existing.invoiceDate || "0000-00-00";
          const rDate = r.invoiceDate || "0000-00-00";
          if (rDate > existingDate) bySupplier[r.supplierId] = r;
        }
      }

      const thisSupplierRecord = bySupplier[supplierId];
      if (!thisSupplierRecord) continue;

      // Check if this supplier is cheapest
      const allMostRecent = Object.values(bySupplier);
      const minCost = Math.min(...allMostRecent.map((r) => r.costPerUnit));
      if (thisSupplierRecord.costPerUnit !== minCost) continue;
      // Also skip if another supplier ties with a lower id (to avoid duplicates)
      // Actually just include if this supplier is at or tied for cheapest

      const ing = allIngredients.find((i) => i.id === ingId);
      if (!ing) continue;

      result.push({
        ingredientId: ing.id,
        ingredientName: ing.name,
        unit: ing.unit,
        costPerUnit: thisSupplierRecord.costPerUnit,
        invoiceDate: thisSupplierRecord.invoiceDate,
        packSize: thisSupplierRecord.packSize,
      });
    }

    // Sort by ingredient name
    result.sort((a, b) => a.ingredientName.localeCompare(b.ingredientName));
    res.json(result);
  });

  // ─── Convert between types ──────────────────────────────────────────────────
  app.post("/api/convert", async (req, res) => {
    try {
      const { fromType, fromId, toType } = req.body;
      // fromType / toType: "ingredient" | "sub-recipe" | "recipe"

      let sourceName = "";
      let sourceIngredientsJson = "[]";
      let sourceSubRecipesJson = "[]";

      // Fetch source
      if (fromType === "ingredient") {
        const ing = await storage.getIngredient(Number(fromId));
        if (!ing) return res.status(404).json({ error: "Ingredient not found" });
        sourceName = ing.name;
      } else if (fromType === "sub-recipe") {
        const sr = await storage.getSubRecipe(Number(fromId));
        if (!sr) return res.status(404).json({ error: "Sub-recipe not found" });
        sourceName = sr.name;
        sourceIngredientsJson = sr.ingredientsJson;
        sourceSubRecipesJson = sr.subRecipesJson || "[]";
      } else if (fromType === "recipe") {
        const r = await storage.getRecipe(Number(fromId));
        if (!r) return res.status(404).json({ error: "Recipe not found" });
        sourceName = r.name;
        sourceIngredientsJson = r.ingredientsJson;
        sourceSubRecipesJson = r.subRecipesJson;
      } else {
        return res.status(400).json({ error: "Invalid fromType" });
      }

      let newId: number | undefined;

      // Create target
      if (toType === "ingredient") {
        const created = await storage.createIngredient({ name: sourceName, category: "Other", unit: "each", bestCostPerUnit: 0 });
        newId = created.id;
      } else if (toType === "sub-recipe") {
        const { totalCost, costPerUnit } = await computeSubRecipeCosts(sourceIngredientsJson, sourceSubRecipesJson, 1);
        const created = await storage.createSubRecipe({
          name: sourceName, yieldAmount: 1, yieldUnit: "each",
          ingredientsJson: sourceIngredientsJson, subRecipesJson: sourceSubRecipesJson,
          totalCost, costPerUnit,
        });
        newId = created.id;
      } else if (toType === "recipe") {
        const markup = await getMarkup();
        const hourlyRate = parseFloat(await storage.getSetting("labour_rate_per_hour") || "35");
        const costs = await computeRecipeCosts(sourceIngredientsJson, sourceSubRecipesJson, "[]", 0, markup, hourlyRate, 1, null);
        const created = await storage.createRecipe({
          name: sourceName, category: "Other",
          ingredientsJson: sourceIngredientsJson, subRecipesJson: sourceSubRecipesJson,
          packagingJson: "[]", labourCost: 0, ...costs, isActive: true,
        });
        newId = created.id;
      } else {
        return res.status(400).json({ error: "Invalid toType" });
      }

      // Delete source
      if (fromType === "ingredient") await storage.deleteIngredient(Number(fromId));
      else if (fromType === "sub-recipe") await storage.deleteSubRecipe(Number(fromId));
      else if (fromType === "recipe") await storage.deleteRecipe(Number(fromId));

      res.json({ ok: true, newId, name: sourceName });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Dashboard Summary ──────────────────────────────────────────────────────
  app.get("/api/dashboard", async (req, res) => {
    const allRecipes = await storage.getRecipes();
    const allPlatters = await storage.getPlatters();
    const allIngredients = await storage.getIngredients();
    const allSuppliers = await storage.getSuppliers();
    const markup = await getMarkup();
    const targetFoodCostPct = parseFloat(await storage.getSetting("target_food_cost_percent") || "30");

    const activeRecipes = allRecipes.filter((r) => r.isActive);
    const activePlatters = allPlatters.filter((p) => p.isActive);

    const itemsOnTarget = [...activeRecipes, ...activePlatters].filter((item) => {
      if (!item.rrp || item.totalCost === 0) return false;
      const foodCostPct = (item.totalCost / item.rrp) * 100;
      return foodCostPct <= targetFoodCostPct;
    });

    const itemsBelowTarget = [...activeRecipes, ...activePlatters].filter((item) => {
      if (!item.rrp || item.totalCost === 0) return false;
      const foodCostPct = (item.totalCost / item.rrp) * 100;
      return foodCostPct > targetFoodCostPct;
    });

    // ── Nutrition issues: find ingredients used in active recipes/platters with no nutrition data ──
    // Build a set of ingredient IDs used in active recipes and platters
    const ingIdsInActiveItems = new Set<number>();
    const ingToItemsMap = new Map<number, { type: string; name: string; id: number }[]>();

    async function collectIngIds(ingJson: string, srJson: string, itemName: string, itemType: string, itemId: number) {
      const ings: { ingredientId: number }[] = JSON.parse(ingJson || "[]");
      for (const l of ings) {
        ingIdsInActiveItems.add(l.ingredientId);
        if (!ingToItemsMap.has(l.ingredientId)) ingToItemsMap.set(l.ingredientId, []);
        ingToItemsMap.get(l.ingredientId)!.push({ type: itemType, name: itemName, id: itemId });
      }
      const srs: { subRecipeId: number }[] = JSON.parse(srJson || "[]");
      for (const sr of srs) {
        const subRecipe = await storage.getSubRecipe(sr.subRecipeId);
        if (!subRecipe) continue;
        const srIngs: { ingredientId: number }[] = JSON.parse(subRecipe.ingredientsJson || "[]");
        for (const l of srIngs) {
          ingIdsInActiveItems.add(l.ingredientId);
          if (!ingToItemsMap.has(l.ingredientId)) ingToItemsMap.set(l.ingredientId, []);
          const entry = ingToItemsMap.get(l.ingredientId)!;
          if (!entry.some(e => e.id === itemId && e.type === itemType)) {
            entry.push({ type: itemType, name: itemName, id: itemId });
          }
        }
      }
    }

    for (const r of activeRecipes) {
      await collectIngIds(r.ingredientsJson, r.subRecipesJson, r.name, "recipe", r.id);
    }
    for (const p of activePlatters) {
      // Platters use itemsJson instead of ingredientsJson
      const items: any[] = JSON.parse(p.itemsJson || "[]");
      for (const item of items) {
        if (item.type === "ingredient") {
          ingIdsInActiveItems.add(item.id);
          if (!ingToItemsMap.has(item.id)) ingToItemsMap.set(item.id, []);
          ingToItemsMap.get(item.id)!.push({ type: "platter", name: p.name, id: p.id });
        } else if (item.type === "recipe") {
          const r = await storage.getRecipe(item.id);
          if (r) await collectIngIds(r.ingredientsJson, r.subRecipesJson, p.name, "platter", p.id);
        } else if (item.type === "subrecipe") {
          const sr = await storage.getSubRecipe(item.id);
          if (sr) {
            const srIngs: { ingredientId: number }[] = JSON.parse(sr.ingredientsJson || "[]");
            for (const l of srIngs) {
              ingIdsInActiveItems.add(l.ingredientId);
              if (!ingToItemsMap.has(l.ingredientId)) ingToItemsMap.set(l.ingredientId, []);
              const entry = ingToItemsMap.get(l.ingredientId)!;
              if (!entry.some(e => e.id === p.id && e.type === "platter")) {
                entry.push({ type: "platter", name: p.name, id: p.id });
              }
            }
          }
        }
      }
    }

    // Find ingredients missing nutrition data
    const nutritionIssues: { ingredientId: number; ingredientName: string; usedIn: { type: string; name: string; id: number }[] }[] = [];
    for (const ingId of ingIdsInActiveItems) {
      const ing = await storage.getIngredient(ingId);
      if (!ing) continue;
      const hasNutrition = !!(ing as any).nutritionJson;
      if (!hasNutrition) {
        nutritionIssues.push({
          ingredientId: ingId,
          ingredientName: ing.name,
          usedIn: ingToItemsMap.get(ingId) || [],
        });
      }
    }

    res.json({
      totalRecipes: activeRecipes.length,
      totalPlatters: activePlatters.length,
      totalIngredients: allIngredients.length,
      totalSuppliers: allSuppliers.length,
      markupPercent: markup,
      targetFoodCostPercent: targetFoodCostPct,
      itemsOnTarget: itemsOnTarget.length,
      itemsBelowTarget: itemsBelowTarget.length,
      pendingXeroCount: await storage.getXeroPendingCount(),
      recentRecipes: allRecipes.slice(-5),
      nutritionIssues,
    });
  });

// ─── CSV Export/Import ───────────────────────────────────────────────────────

  // Ingredients CSV export
  app.get("/api/ingredients/export-csv", async (req, res) => {
    const ings = await storage.getIngredients();
    const header = "id,name,category,unit,best_cost_per_unit,avg_weight_per_unit,notes";
    const rows = ings.map((i) =>
      [i.id, `"${(i.name||"").replace(/"/g,'""')}"`, `"${(i.category||"").replace(/"/g,'""')}"`, i.unit,
       i.bestCostPerUnit ?? 0, i.avgWeightPerUnit ?? "", `"${(i.notes||"").replace(/"/g,'""')}"`].join(",")
    );
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=ingredients.csv");
    res.send([header, ...rows].join("\n"));
  });

  // Ingredients CSV import
  app.post("/api/ingredients/import-csv", memoryUpload.single("file"), async (req, res) => {
    try {
      const lines = ((req as any).file?.buffer?.toString("utf8") || "").split("\n").map((l) => l.trim()).filter(Boolean);
      if (lines.length < 2) return res.status(400).json({ error: "Empty CSV" });
      // Parse CSV row respecting quoted fields
      const parseRow = (line: string): string[] => {
        const result: string[] = [];
        let cur = ""; let inQ = false;
        for (let i = 0; i < line.length; i++) {
          const c = line[i];
          if (c === '"') { if (inQ && line[i+1] === '"') { cur += '"'; i++; } else inQ = !inQ; }
          else if (c === ',' && !inQ) { result.push(cur); cur = ""; }
          else cur += c;
        }
        result.push(cur);
        return result;
      };
      const headers = parseRow(lines[0]);
      const idIdx = headers.indexOf("id");
      const nameIdx = headers.indexOf("name");
      const catIdx = headers.indexOf("category");
      const unitIdx = headers.indexOf("unit");
      const costIdx = headers.indexOf("best_cost_per_unit");
      const avgWtIdx = headers.indexOf("avg_weight_per_unit");
      const notesIdx = headers.indexOf("notes");
      let updated = 0; let skipped = 0;
      for (let i = 1; i < lines.length; i++) {
        const cols = parseRow(lines[i]);
        const id = idIdx >= 0 ? parseInt(cols[idIdx]) : NaN;
        if (isNaN(id)) { skipped++; continue; }
        const existing = await storage.getIngredient(id);
        if (!existing) { skipped++; continue; }
        const patch: any = {};
        if (nameIdx >= 0 && cols[nameIdx]) patch.name = cols[nameIdx];
        if (catIdx >= 0 && cols[catIdx]) patch.category = cols[catIdx];
        if (unitIdx >= 0 && cols[unitIdx]) patch.unit = cols[unitIdx];
        if (costIdx >= 0 && cols[costIdx] !== "") patch.bestCostPerUnit = parseFloat(cols[costIdx]) || 0;
        if (avgWtIdx >= 0 && cols[avgWtIdx] !== "") patch.avgWeightPerUnit = cols[avgWtIdx] ? parseFloat(cols[avgWtIdx]) : null;
        if (notesIdx >= 0) patch.notes = cols[notesIdx];
        await storage.updateIngredient(id, patch);
        updated++;
      }
      res.json({ ok: true, updated, skipped });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // Recipes CSV export
  app.get("/api/recipes/export-csv", async (req, res) => {
    const items = await storage.getRecipes();
    const header = "id,name,category,description,portion_size,portion_count,labour_minutes,rrp";
    const rows = items.map((r) =>
      [r.id, `"${(r.name||"").replace(/"/g,'""')}"`, `"${(r.category||"").replace(/"/g,'""')}"`,
       `"${(r.description||"").replace(/"/g,'""')}"`, `"${(r.portionSize||"").replace(/"/g,'""')}"`,
       r.portionCount ?? 1, r.labourMinutes ?? 0, r.rrp ?? ""].join(",")
    );
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=recipes.csv");
    res.send([header, ...rows].join("\n"));
  });

  // Recipes CSV import
  app.post("/api/recipes/import-csv", memoryUpload.single("file"), async (req, res) => {
    try {
      const lines = ((req as any).file?.buffer?.toString("utf8") || "").split("\n").map((l) => l.trim()).filter(Boolean);
      if (lines.length < 2) return res.status(400).json({ error: "Empty CSV" });
      const parseRow = (line: string): string[] => {
        const result: string[] = []; let cur = ""; let inQ = false;
        for (let i = 0; i < line.length; i++) {
          const c = line[i];
          if (c === '"') { if (inQ && line[i+1] === '"') { cur += '"'; i++; } else inQ = !inQ; }
          else if (c === ',' && !inQ) { result.push(cur); cur = ""; }
          else cur += c;
        }
        result.push(cur); return result;
      };
      const headers = parseRow(lines[0]);
      const idIdx = headers.indexOf("id");
      const nameIdx = headers.indexOf("name");
      const catIdx = headers.indexOf("category");
      const descIdx = headers.indexOf("description");
      const portIdx = headers.indexOf("portion_size");
      const labourIdx = headers.indexOf("labour_minutes");
      const portionIdx = headers.indexOf("portion_count");
      const rrpIdx = headers.indexOf("rrp");
      const markup = await getMarkup();
      let updated = 0; let skipped = 0;
      for (let i = 1; i < lines.length; i++) {
        const cols = parseRow(lines[i]);
        const id = idIdx >= 0 ? parseInt(cols[idIdx]) : NaN;
        if (isNaN(id)) { skipped++; continue; }
        const existing = await storage.getRecipe(id);
        if (!existing) { skipped++; continue; }
        const patch: any = {};
        if (nameIdx >= 0 && cols[nameIdx]) patch.name = cols[nameIdx];
        if (catIdx >= 0 && cols[catIdx]) patch.category = cols[catIdx];
        if (descIdx >= 0) patch.description = cols[descIdx];
        if (portIdx >= 0) patch.portionSize = cols[portIdx];
        if (labourIdx >= 0 && cols[labourIdx] !== "") patch.labourMinutes = parseFloat(cols[labourIdx]) || 0;
        if (portionIdx >= 0 && cols[portionIdx] !== "") patch.portionCount = parseFloat(cols[portionIdx]) || 1;
        if (rrpIdx >= 0 && cols[rrpIdx] !== "") patch.rrp = parseFloat(cols[rrpIdx]) || null;
        // Recompute costs with updated labour/rrp
        const merged = { ...existing, ...patch };
        const hrRate = parseFloat(await storage.getSetting("labour_rate_per_hour") || "35");
        const costs = computeRecipeCosts(merged.ingredientsJson, merged.subRecipesJson, merged.packagingJson, merged.labourMinutes || 0, markup, hrRate, merged.portionCount || 1, merged.rrp);
        await storage.updateRecipe(id, { ...patch, ...costs });
        updated++;
      }
      res.json({ ok: true, updated, skipped });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // Products CSV export
  app.get("/api/platters/export-csv", async (req, res) => {
    const items = await storage.getPlatters();
    const header = "id,name,category,description,servings,labour_cost,rrp";
    const rows = items.map((p) =>
      [p.id, `"${(p.name||"").replace(/"/g,'""')}"`, `"${(p.category||"").replace(/"/g,'""')}"`,
       `"${(p.description||"").replace(/"/g,'""')}"`, p.servings ?? "",
       p.labourCost ?? 0, p.rrp ?? ""].join(",")
    );
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=products.csv");
    res.send([header, ...rows].join("\n"));
  });

  // Products CSV import
  app.post("/api/platters/import-csv", memoryUpload.single("file"), async (req, res) => {
    try {
      const lines = ((req as any).file?.buffer?.toString("utf8") || "").split("\n").map((l) => l.trim()).filter(Boolean);
      if (lines.length < 2) return res.status(400).json({ error: "Empty CSV" });
      const parseRow = (line: string): string[] => {
        const result: string[] = []; let cur = ""; let inQ = false;
        for (let i = 0; i < line.length; i++) {
          const c = line[i];
          if (c === '"') { if (inQ && line[i+1] === '"') { cur += '"'; i++; } else inQ = !inQ; }
          else if (c === ',' && !inQ) { result.push(cur); cur = ""; }
          else cur += c;
        }
        result.push(cur); return result;
      };
      const headers = parseRow(lines[0]);
      const idIdx = headers.indexOf("id");
      const nameIdx = headers.indexOf("name");
      const catIdx = headers.indexOf("category");
      const descIdx = headers.indexOf("description");
      const srvIdx = headers.indexOf("servings");
      const labourIdx = headers.indexOf("labour_cost");
      const rrpIdx = headers.indexOf("rrp");
      const markup = await getMarkup();
      let updated = 0; let skipped = 0;
      for (let i = 1; i < lines.length; i++) {
        const cols = parseRow(lines[i]);
        const id = idIdx >= 0 ? parseInt(cols[idIdx]) : NaN;
        if (isNaN(id)) { skipped++; continue; }
        const existing = await storage.getPlatter(id);
        if (!existing) { skipped++; continue; }
        const patch: any = {};
        if (nameIdx >= 0 && cols[nameIdx]) patch.name = cols[nameIdx];
        if (catIdx >= 0 && cols[catIdx]) patch.category = cols[catIdx];
        if (descIdx >= 0) patch.description = cols[descIdx];
        if (srvIdx >= 0 && cols[srvIdx] !== "") patch.servings = parseInt(cols[srvIdx]) || null;
        if (labourIdx >= 0 && cols[labourIdx] !== "") patch.labourCost = parseFloat(cols[labourIdx]) || 0;
        if (rrpIdx >= 0 && cols[rrpIdx] !== "") patch.rrp = parseFloat(cols[rrpIdx]) || null;
        await storage.updatePlatter(id, patch);
        updated++;
      }
      res.json({ ok: true, updated, skipped });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ─── Recipe Book PDF Export ────────────────────────────────────────────────
  app.post("/api/recipe-book/pdf", async (req, res) => {
    try {
      const { itemType = "recipe", itemIds = [], columns = [], customerSafe = false } = req.body as {
        itemType: "recipe" | "platter";
        itemIds: number[];
        columns: string[];
        customerSafe?: boolean;
      };

      const BRAND = "#256984";
      const ACCENT = "#FCCDE2";
      const BLACK = "#1a1a1a";
      const GREY = "#666666";
      const LIGHT = "#f4f8fa";
      const WHITE = "#ffffff";

      // Dietary & allergen badge colours matching Flex Catering UI
      // Dietary preferences
      const DIETARY_STYLES: Record<string, { bg: string; label: string }> = {
        "Vegetarian":        { bg: "#4DB6AC", label: "V"  },
        "Vegan":             { bg: "#26A69A", label: "VG" },
        "Keto":              { bg: "#EF5350", label: "KO" },
        "Pescatarian":       { bg: "#FF7043", label: "PS" },
        "Halal":             { bg: "#64B5F6", label: "H"  },
        "Kosher":            { bg: "#C8A96E", label: "K"  },
        "Paleo":             { bg: "#81C784", label: "P"  },
        "High Protein":      { bg: "#388E3C", label: "HP" },
        "Low Carb":          { bg: "#AED581", label: "LC" },
        "Dairy Free":        { bg: "#F48FB1", label: "DF" },
        "Egg Free":          { bg: "#FDD835", label: "EF" },
        "Gluten Free":       { bg: "#546E7A", label: "GF" },
        "Lactose Free":      { bg: "#37474F", label: "LF" },
        "Nut Free":          { bg: "#B0BEC5", label: "NF" },
        "Refined Sugar Free":{ bg: "#9575CD", label: "RF" },
        // FSANZ allergens
        "Gluten":            { bg: "#8D6E63", label: "GL" },
        "Crustacean":        { bg: "#EF5350", label: "CR" },
        "Egg":               { bg: "#FDD835", label: "EG" },
        "Fish":              { bg: "#42A5F5", label: "FI" },
        "Milk / Dairy":      { bg: "#90CAF9", label: "MD" },
        "Tree Nuts":         { bg: "#A1887F", label: "TN" },
        "Peanuts":           { bg: "#FF8F00", label: "PN" },
        "Sesame":            { bg: "#FFD54F", label: "SE" },
        "Soy":               { bg: "#AED581", label: "SO" },
        "Molluscs":          { bg: "#BA68C8", label: "MO" },
        "Sulphites":         { bg: "#78909C", label: "SU" },
      };

      const doc = new PDFDocument({ size: "A4", margin: 40, bufferPages: true, autoFirstPage: false });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="recipe-book-${Date.now()}.pdf"`);
      doc.pipe(res);

      const PW = 595.28;   // A4 width pt
      const PH = 841.89;   // A4 height pt
      const PM = 36; // page margin
      const CONTENT_W = PW - PM * 2;
      const FOOTER_H = 24; // checkerboard footer height (2 squares × 12px)
      const USABLE_H = PH - PM - FOOTER_H - PM; // usable content area per page (top margin + bottom margin + footer)

      // ── helpers ──────────────────────────────────────────────────────────
      const fmt = (n: number | null | undefined) => n != null ? `$${n.toFixed(2)}` : "—";

      const allIngredients = await storage.getIngredients();
      const allSubRecipes = await storage.getSubRecipes();
      const allRecipes = await storage.getRecipes();

      const ingById = new Map(allIngredients.map((i) => [i.id, i]));
      const srById = new Map(allSubRecipes.map((s) => [s.id, s]));
      const recById = new Map(allRecipes.map((r) => [r.id, r]));

      // Register brand font
      const fontPath = path.join(process.cwd(), "uploads", "Reuben-Extended-3.otf");
      const hasBrandFont = fs.existsSync(fontPath);
      if (hasBrandFont) doc.registerFont("Reuben", fontPath);
      const BRAND_FONT = hasBrandFont ? "Reuben" : "Helvetica-Bold";

      const logoPath = path.join(process.cwd(), "uploads", "logo-white.png");
      const hasLogo = fs.existsSync(logoPath);

      // ── Draw checkerboard footer ──────────────────────────────────────────
      const drawFooter = () => {
        const SQ = 12; // square size px
        const rows = 2;
        const cols = Math.ceil(PW / SQ);
        const footerY = PH - rows * SQ;
        for (let row = 0; row < rows; row++) {
          for (let col = 0; col < cols; col++) {
            const isPink = (row + col) % 2 === 0;
            doc.rect(col * SQ, footerY + row * SQ, SQ, SQ).fill(isPink ? ACCENT : BRAND);
          }
        }
      };

      // ── Build PEAL label string (mirrors RecipeBook.tsx logic) ────────────
      function buildPealLabel(r: any): string {
        const pealParts: string[] = [];
        // direct ingredients
        (JSON.parse(r.ingredientsJson || "[]") as { ingredientId: number }[]).forEach((l) => {
          const ing = ingById.get(l.ingredientId);
          if (ing) pealParts.push(((ing as any).pealLabel || "").trim() || (ing.name || "").toLowerCase());
        });
        // sub-recipes
        (JSON.parse(r.subRecipesJson || "[]") as { subRecipeId?: number; id?: number }[]).forEach((s) => {
          const sr = srById.get(s.subRecipeId ?? s.id ?? 0);
          if (sr) {
            const srParts: string[] = [];
            (JSON.parse(sr.ingredientsJson || "[]") as { ingredientId: number }[]).forEach((l) => {
              const ing = ingById.get(l.ingredientId);
              if (ing) srParts.push(((ing as any).pealLabel || "").trim() || (ing.name || "").toLowerCase());
            });
            // nested sub-recipes
            (JSON.parse((sr as any).subRecipesJson || "[]") as { subRecipeId?: number; id?: number }[]).forEach((ss) => {
              const nestedSr = srById.get(ss.subRecipeId ?? ss.id ?? 0);
              if (nestedSr) {
                (JSON.parse(nestedSr.ingredientsJson || "[]") as { ingredientId: number }[]).forEach((l) => {
                  const ing = ingById.get(l.ingredientId);
                  if (ing) srParts.push(((ing as any).pealLabel || "").trim() || (ing.name || "").toLowerCase());
                });
              }
            });
            if (srParts.length > 0) pealParts.push(`${sr.name.toLowerCase()} (${srParts.join(", ")})`);
            else pealParts.push(sr.name.toLowerCase());
          }
        });
        return pealParts.join(", ");
      }

      function buildIngLines(r: any): { name: string; qty: number; unit: string; cost: number }[] {
        const lines: { name: string; qty: number; unit: string; cost: number }[] = [];
        (JSON.parse(r.ingredientsJson || "[]") as { ingredientId: number; quantity: number }[]).forEach((l) => {
          const ing = ingById.get(l.ingredientId);
          if (ing) lines.push({ name: ing.name, qty: l.quantity, unit: ing.unit, cost: ing.bestCostPerUnit * l.quantity });
        });
        (JSON.parse(r.subRecipesJson || "[]") as { subRecipeId?: number; id?: number; quantity: number }[]).forEach((l) => {
          const sr = srById.get(l.subRecipeId ?? l.id ?? 0);
          if (sr) lines.push({ name: `${sr.name} (sub-recipe)`, qty: l.quantity, unit: (sr as any).yieldUnit, cost: (sr as any).costPerUnit * l.quantity });
        });
        return lines;
      }

      function buildPlatterLines(p: any): { name: string; qty: number; cost: number }[] {
        const lines: { name: string; qty: number; cost: number }[] = [];
        (JSON.parse(p.itemsJson || "[]") as { type: string; id: number; quantity: number }[]).forEach((l) => {
          if (l.type === "recipe") {
            const rec = recById.get(l.id);
            if (rec) lines.push({ name: rec.name, qty: l.quantity, cost: rec.totalCost * l.quantity });
          } else {
            const ing = ingById.get(l.id);
            if (ing) lines.push({ name: ing.name, qty: l.quantity, cost: ing.bestCostPerUnit * l.quantity });
          }
        });
        return lines;
      }

      const FSANZ_ALLERGENS = [
        "Gluten","Crustacean","Egg","Fish","Milk / Dairy","Tree Nuts","Peanuts","Sesame","Soy","Molluscs","Sulphites",
      ];
      const ALLERGEN_KEY_TO_FSANZ: Record<string,string> = {
        "Gluten":"Gluten","Crustacea":"Crustacean","Eggs":"Egg","Fish":"Fish",
        "Dairy":"Milk / Dairy","Tree Nuts":"Tree Nuts","Peanuts":"Peanuts",
        "Sesame":"Sesame","Soy":"Soy","Molluscs":"Molluscs","Sulphites":"Sulphites",
      };
      const addIng = (allergenSet: Set<string>, ingId: number) => {
        const ing = ingById.get(ingId);
        if (ing) try { (JSON.parse((ing as any).dietariesJson || "[]") as string[]).forEach((k) => allergenSet.add(k)); } catch {}
      };
      function getDietaries(r: any): string[] {
        const keys = new Set<string>();
        (JSON.parse(r.ingredientsJson || "[]") as { ingredientId: number }[]).forEach((l) => addIng(keys, l.ingredientId));
        (JSON.parse(r.subRecipesJson || "[]") as { subRecipeId?: number; id?: number }[]).forEach((s) => {
          const sr = allSubRecipes.find((sr) => sr.id === (s.subRecipeId ?? s.id));
          if (sr) {
            (JSON.parse(sr.ingredientsJson || "[]") as { ingredientId: number }[]).forEach((l) => addIng(keys, l.ingredientId));
            (JSON.parse((sr as any).subRecipesJson || "[]") as { subRecipeId?: number; id?: number }[]).forEach((ss) => {
              const nestedSr = allSubRecipes.find((nr) => nr.id === (ss.subRecipeId ?? ss.id));
              if (nestedSr) (JSON.parse(nestedSr.ingredientsJson || "[]") as { ingredientId: number }[]).forEach((l) => addIng(keys, l.ingredientId));
            });
          }
        });
        const fsanzSet = new Set<string>();
        keys.forEach((k) => { const label = ALLERGEN_KEY_TO_FSANZ[k]; if (label) fsanzSet.add(label); });
        return FSANZ_ALLERGENS.filter((a) => fsanzSet.has(a));
      }

      // ── Get dietaries stored on the item itself (from dietariesJson field) ─
      function getStoredDietaries(item: any): string[] {
        try {
          const arr = JSON.parse(item.dietariesJson || "[]") as string[];
          return arr.filter((d) => d && typeof d === "string");
        } catch { return []; }
      }

      // ── Half-width table helper ────────────────────────────────────────────
      // Draws a titled 2-col table occupying half the page width starting at (x, y)
      // Returns the bottom y of the table.
      function drawHalfTable(title: string, rows: [string, string][], x: number, y: number, w: number): number {
        doc.fill(BLACK).font("Helvetica-Bold").fontSize(7.5).text(title, x, y, { width: w }); let ty = y + 11;
        doc.rect(x, ty, w, 11).fill(LIGHT);
        doc.fill(GREY).font("Helvetica-Bold").fontSize(6).text("Item", x + 3, ty + 3, { width: w * 0.6 });
        doc.fill(GREY).font("Helvetica-Bold").fontSize(6).text("Value", x + w * 0.6, ty + 3, { width: w * 0.38, align: "right" });
        ty += 11;
        for (let i = 0; i < rows.length; i++) {
          if (i % 2 !== 0) doc.rect(x, ty, w, 11).fill(LIGHT);
          doc.fill(BLACK).font("Helvetica").fontSize(6.5).text(rows[i][0], x + 3, ty + 2, { width: w * 0.58, ellipsis: true });
          doc.fill(BLACK).font("Helvetica-Bold").fontSize(6.5).text(rows[i][1], x + w * 0.6, ty + 2, { width: w * 0.38, align: "right" });
          ty += 11;
        }
        return ty + 4;
      }

      // ── Estimate rendered height of one item card ─────────────────────────
      function estimateItemHeight(item: any): number {
        let h = 0;
        const HEADER_H = 40;
        h += HEADER_H + 4;
        if (item.description) h += 14;

        const showPhoto = columns.includes("photo") && item.photoUrl;
        const PHOTO_SIZE = 160;
        const HALF_W = CONTENT_W / 2 - 4;

        // 1. Dietaries — pill layout
        if (columns.includes("dietaries") && itemType === "recipe") {
          const diets = getDietaries(item);
          // Estimate rows: assume ~80pt average pill width, CONTENT_W fits ~6 per row
          const PILL_H = 16; const PILL_GAP_Y = 5;
          const estRows = diets.length === 0 ? 0 : Math.ceil(diets.length / 6);
          h += 11 + (diets.length === 0 ? 14 : estRows * (PILL_H + PILL_GAP_Y)) + 10;
        }

        // 2+3+4+5: RRP / Wholesale RRP / Ingredients + Photo block
        const showRrp = !customerSafe && columns.includes("rrp");
        const showWholesale = !customerSafe && columns.includes("wholesalePrice");
        const showIngredients = columns.includes("ingredients");

        if (showRrp || showWholesale || showIngredients || showPhoto) {
          let leftH = 0;
          if (showRrp) leftH += 11 + 11 + 3 * 11 + 4 + 6;
          if (showWholesale) leftH += 11 + 11 + 3 * 11 + 4 + 6;
          if (showIngredients) {
            const lines = itemType === "recipe" ? buildIngLines(item) : buildPlatterLines(item);
            leftH += 11 + 11 + lines.length * 11 + (!customerSafe ? 12 : 0) + 4 + 6;
          }
          h += Math.max(leftH, showPhoto ? PHOTO_SIZE : 0) + 8;
        }

        // 6+7. Food costing & Labour (side by side — height is the taller of the two)
        const _showFC = !customerSafe && columns.includes("foodCosting") && itemType === "recipe";
        const _showLC = !customerSafe && columns.includes("labourCost") && itemType === "recipe";
        if (_showFC || _showLC) {
          const fcH = _showFC ? (11 + 11 + 5 * 11 + 4) : 0;
          const lcH = _showLC ? (11 + 11 + 2 * 11 + 4) : 0;
          h += Math.max(fcH, lcH) + 8;
        }
        // 8. PEAL label
        if (columns.includes("ingredientsLabel") && itemType === "recipe") {
          const pealText = buildPealLabel(item);
          h += 11 + doc.heightOfString(`INGREDIENTS: ${pealText}`, { width: CONTENT_W - 8, fontSize: 7.5, lineGap: 2 }) + 20;
        }

        return h + 16;
      }

      // ── Draw one item card starting at y, returns new y ───────────────────
      function drawItem(item: any, y: number): number {
        const HEADER_H = 40;
        const showPhoto = columns.includes("photo") && item.photoUrl;
        const PHOTO_SIZE = 160;
        const HALF_W = CONTENT_W / 2 - 4;
        const LEFT_X = PM;
        const RIGHT_X = PM + HALF_W + 8;

        // ── Name header bar ───────────────────────────────────────────────
        doc.rect(PM, y, CONTENT_W, HEADER_H).fill(BRAND);
        const nameFontSize = 13;
        const nameMaxW = CONTENT_W - (hasLogo ? 82 : 20);
        doc.fill(WHITE).font(BRAND_FONT).fontSize(nameFontSize)
          .text(item.name, PM + 12, y + (HEADER_H - nameFontSize) / 2, { width: nameMaxW, ellipsis: true });
        // Logo top-right (PNG with transparent background — sits directly on blue)
        if (hasLogo) {
          try { doc.image(logoPath, PM + CONTENT_W - 74, y + 6, { fit: [70, HEADER_H - 12] }); } catch (_) {}
        }
        y += HEADER_H + 4;

        // description
        if (item.description) {
          doc.fill(GREY).font("Helvetica-Oblique").fontSize(8)
            .text(item.description, LEFT_X, y, { width: CONTENT_W });
          y += doc.heightOfString(item.description, { width: CONTENT_W, fontSize: 8 }) + 6;
        }

        // ── 1. Dietaries — Flex-style circular badges ─────────────────────
        if (columns.includes("dietaries") && itemType === "recipe") {
          doc.fill(BLACK).font("Helvetica-Bold").fontSize(7.5).text("DIETARIES", LEFT_X, y, { width: CONTENT_W }); y += 11;
          const displayDiets = getDietaries(item); // derived from ingredient allergen keys
          if (displayDiets.length === 0) {
            doc.fill(GREY).font("Helvetica-Oblique").fontSize(7).text("None detected", PM + 3, y); y += 14;
          } else {
            const PILL_H = 16;       // pill height
            const PILL_PAD_X = 6;    // horizontal text padding inside pill
            const PILL_GAP_X = 5;    // gap between pills horizontally
            const PILL_GAP_Y = 5;    // gap between rows
            const PILL_FONT_SIZE = 7;
            const PILL_R = 3;        // corner radius
            // Measure pill widths and flow into rows
            let px = PM;
            let rowY = y;
            displayDiets.forEach((d: string) => {
              const style = DIETARY_STYLES[d] || { bg: BRAND };
              const textW = doc.widthOfString(d, { fontSize: PILL_FONT_SIZE });
              const pillW = textW + PILL_PAD_X * 2;
              // Wrap to next row if overflows
              if (px + pillW > PM + CONTENT_W) {
                px = PM;
                rowY += PILL_H + PILL_GAP_Y;
              }
              doc.roundedRect(px, rowY, pillW, PILL_H, PILL_R).fill(style.bg);
              // Determine text colour — use white for dark bg, dark for light bg
              const textColor = style.bg === "#FDD835" || style.bg === "#FFD54F" || style.bg === "#AED581" || style.bg === "#90CAF9" ? BLACK : WHITE;
              doc.fill(textColor).font("Helvetica-Bold").fontSize(PILL_FONT_SIZE)
                .text(d, px + PILL_PAD_X, rowY + (PILL_H - PILL_FONT_SIZE) / 2 + 1, { width: textW, lineBreak: false });
              px += pillW + PILL_GAP_X;
            });
            y = rowY + PILL_H + 4;
          }
          y += 6;
        }

        // ── 2+3+4+5: RRP / Wholesale RRP / Ingredients + Photo block ─────
        // Left half: RRP table (optional) + Wholesale table (optional) + Ingredients table (optional)
        // Right half: Photo
        const showRrp = !customerSafe && columns.includes("rrp");
        const showWholesale = !customerSafe && columns.includes("wholesalePrice");
        const showIngredients = columns.includes("ingredients");

        if (showRrp || showWholesale || showIngredients || showPhoto) {
          const blockStartY = y;
          let ly = y; // left column cursor

          // Photo on right side
          if (showPhoto && item.photoUrl) {
            const photoFile = path.join(process.cwd(), "uploads", "photos", path.basename(item.photoUrl));
            if (fs.existsSync(photoFile)) {
              try { doc.image(photoFile, RIGHT_X + HALF_W - PHOTO_SIZE, blockStartY, { width: PHOTO_SIZE, height: PHOTO_SIZE, cover: [PHOTO_SIZE, PHOTO_SIZE] }); } catch (_) {}
            }
          }

          // 2. RRP table (left half)
          if (showRrp) {
            const rrpRows: [string, string][] = [
              ["Target RRP", fmt(item.targetRrp)],
              ["Actual RRP", fmt(item.rrp)],
              ["Margin %", item.marginPercent != null ? `${item.marginPercent.toFixed(1)}%` : "—"],
            ];
            ly = drawHalfTable("RRP", rrpRows, LEFT_X, ly, HALF_W) + 6;
          }

          // 3. Wholesale RRP table (left half)
          if (showWholesale) {
            const wsRows: [string, string][] = [
              ["Target Wholesale RRP", fmt(item.wholesaleTargetRrp)],
              ["Actual Wholesale RRP", fmt(item.wholesaleRrp)],
              ["Wholesale Margin %", item.wholesaleMarginPercent != null ? `${item.wholesaleMarginPercent.toFixed(1)}%` : "—"],
            ];
            ly = drawHalfTable("WHOLESALE RRP", wsRows, LEFT_X, ly, HALF_W) + 6;
          }

          // 4. Ingredients table (left half)
          if (showIngredients) {
            const lines = itemType === "recipe" ? buildIngLines(item) : buildPlatterLines(item);
            const ING_W = HALF_W;
            doc.fill(BLACK).font("Helvetica-Bold").fontSize(7.5).text("INGREDIENTS", LEFT_X, ly, { width: ING_W }); ly += 11;
            doc.rect(LEFT_X, ly, ING_W, 11).fill(LIGHT);
            doc.fill(GREY).font("Helvetica-Bold").fontSize(6).text("Item", LEFT_X + 3, ly + 3, { width: ING_W * 0.5 });
            if (!customerSafe) {
              doc.fill(GREY).font("Helvetica-Bold").fontSize(6).text("Qty", LEFT_X + ING_W * 0.5, ly + 3, { width: ING_W * 0.25, align: "right" });
              doc.fill(GREY).font("Helvetica-Bold").fontSize(6).text("Cost", LEFT_X + ING_W * 0.76, ly + 3, { width: ING_W * 0.24, align: "right" });
            }
            ly += 11;
            for (let i = 0; i < lines.length; i++) {
              const l = lines[i] as any;
              if (i % 2 !== 0) doc.rect(LEFT_X, ly, ING_W, 11).fill(LIGHT);
              doc.fill(BLACK).font("Helvetica").fontSize(6.5).text(l.name, LEFT_X + 3, ly + 2, { width: customerSafe ? ING_W - 6 : ING_W * 0.48, ellipsis: true });
              if (!customerSafe) {
                doc.fill(GREY).font("Helvetica").fontSize(6.5).text(`${l.qty}${l.unit ? ` ${l.unit}` : ""}`, LEFT_X + ING_W * 0.5, ly + 2, { width: ING_W * 0.25, align: "right" });
                doc.fill(GREY).font("Helvetica").fontSize(6.5).text(fmt(l.cost), LEFT_X + ING_W * 0.76, ly + 2, { width: ING_W * 0.24, align: "right" });
              }
              ly += 11;
            }
            if (!customerSafe) {
              const totalCost = lines.reduce((s: number, l: any) => s + (l.cost || 0), 0);
              doc.rect(LEFT_X, ly, ING_W, 12).fill(BRAND);
              doc.fill(WHITE).font("Helvetica-Bold").fontSize(6.5).text("TOTAL", LEFT_X + 3, ly + 3, { width: ING_W * 0.5 });
              doc.fill(WHITE).font("Helvetica-Bold").fontSize(6.5).text(fmt(totalCost), LEFT_X + ING_W * 0.76, ly + 3, { width: ING_W * 0.24, align: "right" });
              ly += 16;
            } else { ly += 4; }
            ly += 4;
          }

          // Advance y past the tallest of left column and photo
          const rightH = showPhoto && item.photoUrl ? PHOTO_SIZE : 0;
          y = Math.max(ly, blockStartY + rightH) + 8;
        }

        // ── 6+7. Food Costing & Labour Cost — side by side, half width each ─────
        const showFC = !customerSafe && columns.includes("foodCosting") && itemType === "recipe";
        const showLC = !customerSafe && columns.includes("labourCost") && itemType === "recipe";
        if (showFC || showLC) {
          y += 4;
          const blockY = y;
          let fcBottomY = blockY;
          let lcBottomY = blockY;

          if (showFC) {
            const fcRows: [string, string][] = [
              ["Ingredient Cost", fmt(item.ingredientCost)], ["Sub-Recipe Cost", fmt(item.subRecipeCost)],
              ["Packaging Cost", fmt(item.packagingCost)], ["Total Cost", fmt(item.totalCost)], ["Cost per Serve", fmt(item.costPerServe)],
            ];
            // If both sections showing, use left half; otherwise full width
            const fcW = showLC ? HALF_W : CONTENT_W;
            const fcX = LEFT_X;
            fcBottomY = drawHalfTable("FOOD COSTING", fcRows, fcX, blockY, fcW);
          }

          if (showLC) {
            const labRows: [string, string][] = [
              ["Time to Make", `${item.labourMinutes ?? 0} min`], ["Labour Cost", fmt(item.labourCost)],
            ];
            // If both sections showing, use right half; otherwise full width
            const lcW = showFC ? HALF_W : CONTENT_W;
            const lcX = showFC ? RIGHT_X : LEFT_X;
            lcBottomY = drawHalfTable("LABOUR COST", labRows, lcX, blockY, lcW);
          }

          y = Math.max(fcBottomY, lcBottomY) + 4;
        }

        // ── 8. Ingredients Label (PEAL) ───────────────────────────────────
        if (columns.includes("ingredientsLabel") && itemType === "recipe") {
          y += 4;
          doc.fill(BLACK).font("Helvetica-Bold").fontSize(7.5).text("INGREDIENTS LABEL", LEFT_X, y, { width: CONTENT_W }); y += 11;
          const pealText = buildPealLabel(item);
          const containsList = getDietaries(item);
          const pealLine = `INGREDIENTS: ${pealText || "—"}`;
          const containsLine = containsList.length > 0 ? `CONTAINS: ${containsList.join(", ")}` : "";
          const boxH = doc.heightOfString(pealLine, { width: CONTENT_W - 8, fontSize: 7.5, lineGap: 2 })
            + (containsLine ? doc.heightOfString(containsLine, { width: CONTENT_W - 8, fontSize: 7.5 }) + 4 : 0) + 10;
          doc.rect(PM, y, CONTENT_W, boxH).fill(LIGHT);
          doc.fill(BLACK).font("Helvetica-Bold").fontSize(7.5).text("INGREDIENTS: ", PM + 4, y + 4, { continued: true })
            .font("Helvetica").text(pealText || "—", { width: CONTENT_W - 8, lineGap: 2 });
          if (containsLine) {
            y += doc.heightOfString(pealLine, { width: CONTENT_W - 8, fontSize: 7.5, lineGap: 2 }) + 4;
            doc.fill(BLACK).font("Helvetica-Bold").fontSize(7.5).text(containsLine, PM + 4, y + 4, { width: CONTENT_W - 8 });
            y += doc.heightOfString(containsLine, { width: CONTENT_W - 8, fontSize: 7.5 }) + 8;
          } else {
            y += doc.heightOfString(pealLine, { width: CONTENT_W - 8, fontSize: 7.5, lineGap: 2 }) + 10;
          }
        }

        // ── 9. FSANZ Nutrition Panel ───────────────────────────────────────────
        if (columns.includes("nutrition")) {
          let nutri: NutritionValues | null = null;
          try { nutri = JSON.parse((item as any).nutritionJson || "null"); } catch {}

          if (nutri && (nutri.energy || nutri.protein || nutri.carbs)) {
            y += 6;

            // Section heading
            doc.fill(BLACK).font("Helvetica-Bold").fontSize(7.5).text("NUTRITION INFORMATION", LEFT_X, y, { width: CONTENT_W }); y += 11;

            // Use auto-calculated serving size (total batch weight / number of serves)
            // Fall back to manually entered servingSize for backward compat
            const calcSS: number | null = (item as any).calculatedServingSize ?? null;
            const manualSS: string = (item as any).servingSize || "";
            const servingSizeGrams: number | null = calcSS ?? (manualSS ? parseFloat(manualSS) : null);
            const servingSizeLabel: string = servingSizeGrams !== null ? `${Math.round(servingSizeGrams)}g` : (manualSS || "");
            const spp: number | null = (item as any).servingsPerPackage ?? null;
            const serveScale = servingSizeGrams !== null ? (servingSizeGrams / 100) : 1;

            // Serving header box
            if (servingSizeLabel || spp) {
              const headerBoxH = 20;
              doc.rect(PM, y, CONTENT_W, headerBoxH).fill(LIGHT);
              let headerText = "";
              if (spp) headerText += `Servings per package: ${spp}    `;
              if (servingSizeLabel) headerText += `Serving size: ${servingSizeLabel}`;
              doc.fill(GREY).font("Helvetica").fontSize(7)
                .text(headerText.trim(), PM + 4, y + 6, { width: CONTENT_W - 8 });
              y += headerBoxH;
            }

            // Column header row
            const COL1 = CONTENT_W * 0.44;  // nutrient label
            const COL2 = CONTENT_W * 0.28;  // per serve
            const COL3 = CONTENT_W * 0.28;  // per 100g
            const headerRowH = 14;
            doc.rect(PM, y, CONTENT_W, headerRowH).fill(BRAND);
            doc.fill(WHITE).font("Helvetica-Bold").fontSize(6.5).text("NUTRIENT", PM + 4, y + 4, { width: COL1 });
            doc.fill(WHITE).font("Helvetica-Bold").fontSize(6.5).text(servingSizeLabel ? `Per serve (${servingSizeLabel})` : "Per serve", PM + COL1, y + 4, { width: COL2, align: "center" });
            doc.fill(WHITE).font("Helvetica-Bold").fontSize(6.5).text("Per 100g", PM + COL1 + COL2, y + 4, { width: COL3, align: "center" });
            y += headerRowH;

            // Rounding helper — FSANZ: energy & sodium no decimals, others 3 sig figs
            const fmtN = (v: number, isInt = false) => {
              if (isInt) return Math.round(v).toString();
              if (v < 1) return parseFloat(v.toFixed(2)).toString();
              if (v < 10) return parseFloat(v.toFixed(1)).toString();
              return Math.round(v).toString();
            };

            const nutRows: { label: string; per100: string; perServe: string; indent?: boolean }[] = [
              { label: "Energy", per100: `${fmtN(nutri.energy, true)} kJ`, perServe: `${fmtN(nutri.energy * serveScale, true)} kJ (${fmtN(nutri.energy * serveScale / 4.184, true)} Cal)` },
              { label: "Protein", per100: `${fmtN(nutri.protein)} g`, perServe: `${fmtN(nutri.protein * serveScale)} g` },
              { label: "Fat, total", per100: `${fmtN(nutri.fatTotal)} g`, perServe: `${fmtN(nutri.fatTotal * serveScale)} g` },
              { label: "  - Saturated", per100: `${fmtN(nutri.fatSat)} g`, perServe: `${fmtN(nutri.fatSat * serveScale)} g`, indent: true },
              { label: "Carbohydrate", per100: `${fmtN(nutri.carbs)} g`, perServe: `${fmtN(nutri.carbs * serveScale)} g` },
              { label: "  - Sugars", per100: `${fmtN(nutri.sugars)} g`, perServe: `${fmtN(nutri.sugars * serveScale)} g`, indent: true },
              { label: "Sodium", per100: `${fmtN(nutri.sodium, true)} mg`, perServe: `${fmtN(nutri.sodium * serveScale, true)} mg` },
            ];

            const ROW_H = 11;
            for (let i = 0; i < nutRows.length; i++) {
              const row = nutRows[i];
              if (i % 2 !== 0) doc.rect(PM, y, CONTENT_W, ROW_H).fill(LIGHT);
              // Left border accent for saturated / sugars
              const labelFont = row.indent ? "Helvetica-Oblique" : "Helvetica-Bold";
              doc.fill(BLACK).font(labelFont).fontSize(6.5).text(row.label, PM + 4, y + 2, { width: COL1 - 4 });
              doc.fill(GREY).font("Helvetica").fontSize(6.5)
                .text(servingSizeLabel ? row.perServe : "—", PM + COL1, y + 2, { width: COL2, align: "center" });
              doc.fill(GREY).font("Helvetica").fontSize(6.5)
                .text(row.per100, PM + COL1 + COL2, y + 2, { width: COL3, align: "center" });
              y += ROW_H;
            }

            // Bottom border
            doc.rect(PM, y, CONTENT_W, 1).fill(BRAND);
            y += 5;
          }
        }

        return y + 12; // bottom gap between items
      }

      // ── Get items to render ────────────────────────────────────────────────
      const items = itemType === "recipe"
        ? (itemIds.length ? (await Promise.all(itemIds.map((id) => storage.getRecipe(id)))).filter(Boolean) : allRecipes)
        : (itemIds.length ? (await Promise.all(itemIds.map((id) => storage.getPlatter(id)))).filter(Boolean) : await storage.getPlatters());

      // Group items by category (preserving original order within each category)
      const categorySeen = new Set<string>();
      const categoryOrder: string[] = [];
      for (const item of items as any[]) {
        if (item && !categorySeen.has(item.category)) { categorySeen.add(item.category); categoryOrder.push(item.category); }
      }
      const groupedItems: Record<string, any[]> = {};
      for (const item of items as any[]) {
        if (!item) continue;
        if (!groupedItems[item.category]) groupedItems[item.category] = [];
        groupedItems[item.category].push(item);
      }

      // ── Cover page ────────────────────────────────────────────────────────
      doc.addPage();
      doc.rect(0, 0, PW, PH).fill(BRAND);
      // Pink diagonal accent block
      doc.save().translate(0, 0);
      // Large diagonal stripe
      doc.moveTo(0, PH * 0.55).lineTo(PW * 0.6, PH * 0.35).lineTo(PW, PH * 0.5).lineTo(PW, PH * 0.75).lineTo(0, PH * 0.85).closePath().fill("#1f5570");
      doc.restore();

      // Pink accent blocks
      doc.rect(0, PH - 80, PW, 80).fill(ACCENT);

      // Logo centred
      if (hasLogo) {
        try { doc.image(logoPath, PW / 2 - 100, 180, { width: 200, fit: [200, 120] }); } catch (_) {}
      }
      // "Recipe Book" in brand font
      doc.fill(WHITE).font(BRAND_FONT).fontSize(36).text("PRODUCT INFORMATION", PM, 340, { width: CONTENT_W, align: "center" });
      doc.fill(WHITE).font("Helvetica").fontSize(12).text("The Deli by Greenhorns", PM, 385, { width: CONTENT_W, align: "center" });
      doc.fill(WHITE).font("Helvetica").fontSize(10)
        .text(new Date().toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" }), PM, 404, { width: CONTENT_W, align: "center" });
      // Pink footer text
      doc.fill(BRAND).font("Helvetica-Bold").fontSize(10)
        .text(`${itemIds.length} ${itemIds.length === 1 ? "product" : "products"} selected`, PM, PH - 60, { width: CONTENT_W, align: "center" });
      drawFooter();

      // ── Category section pages ─────────────────────────────────────────────
      for (const category of categoryOrder) {
        const catItems = groupedItems[category] || [];
        if (catItems.length === 0) continue;

        // Category title page/header — draw pink category header between sections
        // Start fresh page for each category
        doc.addPage();
        // Category title bar — full width pink
        doc.rect(0, PM - 6, PW, 44).fill(ACCENT);
        doc.fill(BRAND).font(BRAND_FONT).fontSize(22)
          .text(category.toUpperCase(), PM, PM + 4, { width: CONTENT_W });
        doc.fill(BRAND).font("Helvetica").fontSize(9)
          .text(`${catItems.length} item${catItems.length !== 1 ? "s" : ""}`, PM, PM + 28, { width: CONTENT_W });
        drawFooter();

        let y = PM + 50; // below category bar

        for (const item of catItems) {
          const itemH = estimateItemHeight(item);
          const remaining = USABLE_H - (y - PM);

          // If not enough space for this item AND we've already placed at least one item on this page
          if (remaining < itemH && y > PM + 60) {
            drawFooter();
            doc.addPage();
            y = PM;
          }

          y = drawItem(item, y);
          y += 8; // gap between items
        }

        // Ensure footer on last page of category
        drawFooter();
      }

      doc.end();
    } catch (e: any) {
      console.error("PDF export error:", e);
      if (!res.headersSent) res.status(500).json({ error: e.message });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // DEPUTY ROSTER
  // ─────────────────────────────────────────────────────────────────────────────

  // GET /api/deputy/roster?date=YYYY-MM-DD  — fetch staff on shift for a given date
  app.get("/api/deputy/roster", async (req, res) => {
    try {
      const deputyToken = await storage.getSetting("deputy_token");
      const deputySubdomain = await storage.getSetting("deputy_subdomain");
      if (!deputyToken || !deputySubdomain) {
        return res.json({ employees: [], source: "no_config" });
      }
      const date = (req.query.date as string) || new Date().toISOString().split("T")[0];

      // Fetch all active employees
      const empResp = await fetch(`https://${deputySubdomain}/api/v1/resource/Employee?max=200`, {
        headers: { Authorization: `Bearer ${deputyToken}` },
      });
      const employees: any[] = await empResp.json();
      const activeEmployees = employees.filter((e: any) => e.Active);

      // Fetch published roster shifts for date (Deputy returns next 36h / prev 12h)
      const rosterResp = await fetch(
        `https://${deputySubdomain}/api/v1/resource/Roster?max=200`,
        { headers: { Authorization: `Bearer ${deputyToken}` } }
      );
      const allRosters: any[] = await rosterResp.json();

      // Filter to shifts on the requested date with a real employee assigned
      const onShift = allRosters
        .filter((r: any) => {
          if (!r.Employee || r.Employee === 0) return false;
          const shiftDate = r.StartTimeLocalized
            ? r.StartTimeLocalized.split("T")[0]
            : r.Date?.split("T")[0];
          return shiftDate === date;
        })
        .map((r: any) => r.Employee);

      const uniqueOnShift = [...new Set(onShift)] as number[];

      // If no roster for date, fall back to all active employees
      const staffList = uniqueOnShift.length > 0
        ? activeEmployees.filter((e: any) => uniqueOnShift.includes(e.Id))
        : activeEmployees;

      res.json({
        employees: staffList.map((e: any) => ({
          id: e.Id,
          name: `${e.FirstName} ${e.LastName}`.trim(),
          firstName: e.FirstName,
          lastName: e.LastName,
        })),
        source: uniqueOnShift.length > 0 ? "roster" : "all_active",
        date,
      });
    } catch (err: any) {
      console.error("Deputy roster error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // PREP SESSIONS
  // ─────────────────────────────────────────────────────────────────────────────

  // GET /api/prep/sessions — list all sessions (most recent first)
  app.get("/api/prep/sessions", async (_req, res) => {
    try {
      const { data: sessions, error } = await supabase
        .from('prep_sessions')
        .select('*')
        .order('date', { ascending: false })
        .order('created_at', { ascending: false });
      if (error) throw error;
      res.json((sessions ?? []).map((s: any) => ({ ...s, orders: JSON.parse(s.orders_json || "[]") })));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/prep/sessions/:id — get session with tasks
  app.get("/api/prep/sessions/:id", async (req, res) => {
    try {
      const { data: session, error: sErr } = await supabase.from('prep_sessions').select('*').eq('id', req.params.id).single();
      if (sErr || !session) return res.status(404).json({ error: "Not found" });
      const { data: tasks } = await supabase.from('prep_tasks').select('*').eq('session_id', req.params.id).order('sort_order').order('id');
      res.json({
        ...session,
        orders: JSON.parse(session.orders_json || "[]"),
        tasks: (tasks ?? []).map((t: any) => ({ ...t, forOrders: JSON.parse(t.for_orders_json || "[]") })),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/prep/sessions — create new session and explode orders into tasks
  app.post("/api/prep/sessions", async (req, res) => {
    try {
      const { date, notes, orders } = req.body;
      // orders: [{type:'flex_product'|'recipe', id, name, quantity}]
      const now = new Date().toISOString();
      const { data: sessionRow, error: sErr } = await supabase
        .from('prep_sessions')
        .insert({ date, notes: notes || null, orders_json: JSON.stringify(orders || []), status: 'active', created_at: now })
        .select().single();
      if (sErr) throw sErr;
      const sessionId = sessionRow.id;

      // Explode orders into tasks
      const tasks = await explodePrepTasks(orders || [], supabase);
      let sortOrder = 0;
      for (const task of tasks) {
        await supabase.from('prep_tasks').insert({
          session_id: sessionId, item_type: task.itemType, item_id: task.itemId, item_name: task.itemName,
          quantity_required: task.quantityRequired, for_orders_json: JSON.stringify(task.forOrders),
          expected_minutes: task.expectedMinutes, status: 'pending', sort_order: sortOrder++
        });
      }

      const { data: session } = await supabase.from('prep_sessions').select('*').eq('id', sessionId).single();
      const { data: savedTasks } = await supabase.from('prep_tasks').select('*').eq('session_id', sessionId).order('sort_order');
      res.json({
        ...session,
        orders: JSON.parse(session.orders_json),
        tasks: (savedTasks ?? []).map((t: any) => ({ ...t, forOrders: JSON.parse(t.for_orders_json || "[]") })),
      });
    } catch (err: any) {
      console.error("Create prep session error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/prep/sessions/:id
  app.delete("/api/prep/sessions/:id", async (req, res) => {
    try {
      await supabase.from('prep_tasks').delete().eq('session_id', req.params.id);
      await supabase.from('prep_sessions').delete().eq('id', req.params.id);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/prep/sessions/:id/merge-orders — merge new orders into existing session
  // Returns: { merged: [{taskId, itemName, addedQty, newTotal, wasInProgress}], newTasks: [...] }
  app.post("/api/prep/sessions/:id/merge-orders", async (req, res) => {
    try {
      const sessionId = Number(req.params.id);
      const { data: session } = await supabase.from('prep_sessions').select('*').eq('id', sessionId).single();
      if (!session) return res.status(404).json({ error: "Session not found" });

      const { newOrders } = req.body; // [{type, id, sku, name, quantity, flexProductId}]
      if (!newOrders?.length) return res.json({ merged: [], newTasks: [] });

      // Explode new orders into tasks
      const newTaskDefs = await explodePrepTasks(newOrders, supabase);
      const { data: existingTasksRaw } = await supabase.from('prep_tasks').select('*').eq('session_id', sessionId);
      const existingTasks = existingTasksRaw ?? [];

      const merged: any[] = [];
      const addedTasks: any[] = [];

      for (const newTask of newTaskDefs) {
        const existing = existingTasks.find((t: any) => t.item_type === newTask.itemType && t.item_id === newTask.itemId);

        if (existing) {
          const wasInProgress = existing.status === "in_progress";
          const newTotal = (existing.quantity_required || 0) + newTask.quantityRequired;

          if (!wasInProgress) {
            // Merge into existing task
            await supabase.from('prep_tasks').update({
              quantity_required: newTotal,
              for_orders_json: JSON.stringify([...JSON.parse(existing.for_orders_json || "[]"), ...newTask.forOrders]),
              expected_minutes: (existing.expected_minutes || 0) + (newTask.expectedMinutes || 0),
            }).eq('id', existing.id);
            merged.push({ taskId: existing.id, itemName: existing.item_name, addedQty: newTask.quantityRequired, newTotal, wasInProgress: false });
          } else {
            // In progress — add as separate task and flag as notification
            const { data: maxRow } = await supabase.from('prep_tasks').select('sort_order').eq('session_id', sessionId).order('sort_order', { ascending: false }).limit(1).single();
            const sortOrder = ((maxRow as any)?.sort_order ?? 0) + 1;
            const { data: newRow } = await supabase.from('prep_tasks').insert({
              session_id: sessionId, item_type: newTask.itemType, item_id: newTask.itemId, item_name: newTask.itemName,
              quantity_required: newTask.quantityRequired, for_orders_json: JSON.stringify(newTask.forOrders),
              expected_minutes: newTask.expectedMinutes || 0, status: 'pending', sort_order: sortOrder
            }).select().single();
            merged.push({ taskId: (newRow as any).id, itemName: newTask.itemName, addedQty: newTask.quantityRequired, existingQty: existing.quantity_required, newTotal, wasInProgress: true, existingTaskId: existing.id });
            addedTasks.push({ id: (newRow as any).id, ...newTask });
          }
        } else {
          // Brand new task
          const { data: maxRow } = await supabase.from('prep_tasks').select('sort_order').eq('session_id', sessionId).order('sort_order', { ascending: false }).limit(1).single();
          const sortOrder = ((maxRow as any)?.sort_order ?? 0) + 1;
          const { data: newRow } = await supabase.from('prep_tasks').insert({
            session_id: sessionId, item_type: newTask.itemType, item_id: newTask.itemId, item_name: newTask.itemName,
            quantity_required: newTask.quantityRequired, for_orders_json: JSON.stringify(newTask.forOrders),
            expected_minutes: newTask.expectedMinutes || 0, status: 'pending', sort_order: sortOrder
          }).select().single();
          addedTasks.push({ id: (newRow as any).id, ...newTask });
        }
      }

      res.json({ merged, newTasks: addedTasks });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // PREP TASKS
  // ─────────────────────────────────────────────────────────────────────────────

  // PATCH /api/prep/tasks/:id — update task (assign, start, finish, skip)
  app.patch("/api/prep/tasks/:id", async (req, res) => {
    try {
      const { data: task, error: tErr } = await supabase.from('prep_tasks').select('*').eq('id', req.params.id).single();
      if (tErr || !task) return res.status(404).json({ error: "Not found" });

      const { action, assignedTo, assignedName, quantityActual, notes } = req.body;
      const now = new Date().toISOString();

      if (action === "assign") {
        await supabase.from('prep_tasks').update({ assigned_to: assignedTo, assigned_name: assignedName }).eq('id', req.params.id);
      } else if (action === "start") {
        await supabase.from('prep_tasks').update({ status: 'in_progress', started_at: now }).eq('id', req.params.id);
      } else if (action === "finish") {
        const startedAt = task.started_at ? new Date(task.started_at) : new Date();
        const actualMinutes = (new Date().getTime() - startedAt.getTime()) / 60000;
        await supabase.from('prep_tasks').update({
          status: 'done', finished_at: now, actual_minutes: Math.round(actualMinutes * 10) / 10,
          quantity_actual: quantityActual ?? task.quantity_required, notes: notes ?? task.notes
        }).eq('id', req.params.id);
      } else if (action === "skip") {
        await supabase.from('prep_tasks').update({ status: 'skipped' }).eq('id', req.params.id);
      } else if (action === "reset") {
        await supabase.from('prep_tasks').update({ status: 'pending', started_at: null, finished_at: null, actual_minutes: null }).eq('id', req.params.id);
      } else if (action === "update_qty") {
        const { quantityRequired } = req.body;
        if (quantityRequired !== undefined) {
          await supabase.from('prep_tasks').update({ quantity_required: quantityRequired }).eq('id', req.params.id);
        }
      } else {
        // Generic field update
        if (assignedTo !== undefined) await supabase.from('prep_tasks').update({ assigned_to: assignedTo, assigned_name: assignedName }).eq('id', req.params.id);
        if (notes !== undefined) await supabase.from('prep_tasks').update({ notes }).eq('id', req.params.id);
      }

      const { data: updated } = await supabase.from('prep_tasks').select('*').eq('id', req.params.id).single();
      res.json({ ...updated, forOrders: JSON.parse((updated as any).for_orders_json || "[]") });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/prep/tasks/:id — remove a prep task
  app.delete("/api/prep/tasks/:id", async (req, res) => {
    try {
      await supabase.from('prep_tasks').delete().eq('id', req.params.id);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // PATCH /api/prep/sessions/:id/complete — mark session complete
  app.patch("/api/prep/sessions/:id/complete", async (req, res) => {
    try {
      await supabase.from('prep_sessions').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', req.params.id);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── PREP LOG (manual staff entries) ───────────────────────────────────────────

  // POST /api/prep-log — log a manual prep entry
  app.post("/api/prep-log", async (req, res) => {
    try {
      const { itemType, itemId, itemName, quantity, unit, staffId, staffName, notes, loggedAt } = req.body;
      if (!itemName || !quantity || !unit || !staffName) {
        return res.status(400).json({ error: "itemName, quantity, unit and staffName are required" });
      }
      // loggedAt can be overridden (for backdating), defaults to now (UTC ISO)
      const ts = loggedAt || new Date().toISOString();
      const { data: row, error } = await supabase.from('prep_log').insert({
        logged_at: ts, item_type: itemType || 'manual', item_id: itemId || null,
        item_name: itemName, quantity, unit, staff_id: staffId || null, staff_name: staffName, notes: notes || ''
      }).select().single();
      if (error) throw error;
      res.json({ ok: true, id: (row as any).id });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/prep-log — query log entries
  // Query params: dateFrom, dateTo, staffName, staffId, excludeTypes (comma-separated item_types to exclude)
  // Returns entries sorted by logged_at DESC
  app.get("/api/prep-log", async (req, res) => {
    try {
      const { dateFrom, dateTo, staffName, staffId, excludeTypes } = req.query as Record<string, string>;
      let query = supabase.from('prep_log').select('*').order('logged_at', { ascending: false });

      // Date filtering: Supabase doesn't support SQLite's date(datetime(col, '+8 hours')) directly,
      // so we compute the AWST day boundary in UTC and filter by logged_at range.
      if (dateFrom) {
        // AWST = UTC+8: dateFrom 00:00 AWST = dateFrom-1T16:00Z
        const fromUtc = new Date(dateFrom + 'T00:00:00+08:00').toISOString();
        query = query.gte('logged_at', fromUtc);
      }
      if (dateTo) {
        // dateTo 23:59:59 AWST = dateToT15:59:59Z
        const toUtc = new Date(dateTo + 'T23:59:59+08:00').toISOString();
        query = query.lte('logged_at', toUtc);
      }
      if (staffId) {
        query = query.eq('staff_id', Number(staffId));
      } else if (staffName && staffName !== 'all') {
        query = query.eq('staff_name', staffName);
      }
      if (excludeTypes) {
        const types = excludeTypes.split(',').map((t: string) => t.trim()).filter(Boolean);
        if (types.length > 0) {
          query = query.not('item_type', 'in', `(${types.join(',')})`);
        }
      }
      const { data: rows, error } = await query;
      if (error) throw error;
      res.json((rows ?? []).map((r: any) => ({
        id: r.id,
        loggedAt: r.logged_at,
        itemType: r.item_type,
        itemId: r.item_id,
        itemName: r.item_name,
        quantity: r.quantity,
        unit: r.unit,
        staffId: r.staff_id,
        staffName: r.staff_name,
        notes: r.notes,
      })));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/prep-log/:id — remove a log entry (admin correction)
  app.delete("/api/prep-log/:id", async (req, res) => {
    try {
      await supabase.from('prep_log').delete().eq('id', Number(req.params.id));
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/order-tick-log — log when an order item is ticked off on the production page
  // Body: { itemName, quantity, staffName, staffId?, orderId?, orderDate?, fromStock? }
  // item_type: 'order' = fulfilled from production, 'boxed' = boxed from stock on hand
  app.post("/api/order-tick-log", async (req, res) => {
    try {
      const { itemName, quantity, staffName, staffId, orderId, fromStock } = req.body;
      if (!itemName || !staffName) return res.status(400).json({ error: "itemName and staffName required" });
      const ts = new Date().toISOString(); // always use actual tick-off time, not order delivery date
      const itemType = fromStock ? 'boxed' : 'order';
      const { data: row, error } = await supabase.from('prep_log').insert({
        logged_at: ts, item_type: itemType, item_id: orderId || null,
        item_name: itemName, quantity: quantity || 1, unit: 'each',
        staff_id: staffId || null, staff_name: staffName, notes: ''
      }).select().single();
      if (error) throw error;
      res.json({ ok: true, id: (row as any).id });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Order States API ────────────────────────────────────────────────────────
  // Persists production page check-off state across devices via DB.

  // GET /api/order-states?date=YYYY-MM-DD
  // Returns all order states for a given date as a map keyed by order_id
  app.get("/api/order-states", async (req, res) => {
    try {
      const date = (req.query.date as string) || new Date().toISOString().split("T")[0];
      const { data: rows, error } = await supabase.from('order_states').select('*').eq('date', date);
      if (error) throw error;
      // Return as object keyed by order_id for easy lookup on the frontend
      const result: Record<number, any> = {};
      for (const row of (rows ?? [])) {
        result[row.order_id] = {
          prepStatus: row.prep_status,
          checkedItems: JSON.parse(row.checked_items_json || "{}"),
          isComplete: row.is_complete === true || row.is_complete === 1,
          itemCount: row.item_count || 0,
          updatedAt: row.updated_at,
        };
      }
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/order-states/:orderId
  // Upserts the state for a single order. Body: { date, prepStatus, checkedItems, isComplete, itemCount? }
  app.put("/api/order-states/:orderId", async (req, res) => {
    try {
      const orderId = Number(req.params.orderId);
      const { date, prepStatus, checkedItems, isComplete, itemCount } = req.body;
      if (!date) return res.status(400).json({ error: "date required" });
      const now = new Date().toISOString();
      // First check if a record exists to handle itemCount merge
      const { data: existing } = await supabase.from('order_states').select('item_count').eq('order_id', orderId).eq('date', date).single();
      const effectiveItemCount = (itemCount != null && itemCount > 0) ? itemCount : (existing?.item_count || 0);
      await supabase.from('order_states').upsert({
        order_id: orderId,
        date,
        prep_status: prepStatus || "new",
        checked_items_json: JSON.stringify(checkedItems || {}),
        is_complete: isComplete ? true : false,
        item_count: effectiveItemCount,
        updated_at: now,
      }, { onConflict: 'order_id,date' });
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/order-states/latest-update?date=YYYY-MM-DD
  // Returns the most recent updated_at timestamp for the date — used by clients
  // to detect changes from other devices without fetching the full payload.
  app.get("/api/order-states/latest-update", async (req, res) => {
    try {
      const date = (req.query.date as string) || new Date().toISOString().split("T")[0];
      const { data: latestRow } = await supabase.from('order_states').select('updated_at').eq('date', date).order('updated_at', { ascending: false }).limit(1).single();
      const row = latestRow ? { latest: (latestRow as any).updated_at } : null;
      res.json({ latest: row?.latest || null });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── STOCK ON HAND API ────────────────────────────────────────────────────────

  // GET /api/stock-on-hand — list all stock items (quantity > 0)
  app.get("/api/stock-on-hand", async (req, res) => {
    try {
      const { data: rows, error } = await supabase.from('stock_on_hand').select('*').gt('quantity', 0).order('item_name');
      if (error) throw error;
      res.json(rows ?? []);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/stock-on-hand — add or increment stock item
  // If item_name already exists (case-insensitive), increments quantity
  app.post("/api/stock-on-hand", async (req, res) => {
    try {
      const { itemName, itemType, quantity, unit } = req.body as { itemName: string; itemType: string; quantity: number; unit: string };
      if (!itemName || !quantity || !unit) return res.status(400).json({ error: "itemName, quantity and unit required" });
      const { data: existingRows } = await supabase.from('stock_on_hand').select('*').ilike('item_name', itemName).limit(1);
      const existing = existingRows?.[0];
      if (existing) {
        const { data: updated } = await supabase.from('stock_on_hand').update({
          quantity: (existing.quantity || 0) + quantity,
          updated_at: new Date().toISOString()
        }).eq('id', existing.id).select().single();
        res.json(updated);
      } else {
        const { data: row } = await supabase.from('stock_on_hand').insert({
          item_name: itemName, item_type: itemType || 'recipe', quantity, unit
        }).select().single();
        res.json(row);
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/stock-on-hand/:id — set quantity directly (for manual edits)
  app.put("/api/stock-on-hand/:id", async (req, res) => {
    try {
      const { quantity } = req.body as { quantity: number };
      const id = Number(req.params.id);
      // Auto-delete if 0 or below
      if (quantity <= 0) {
        await supabase.from('stock_on_hand').delete().eq('id', id);
        return res.json({ ok: true, deleted: true });
      }
      const { data: row } = await supabase.from('stock_on_hand').update({
        quantity, updated_at: new Date().toISOString()
      }).eq('id', id).select().single();
      res.json(row);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/stock-on-hand/:id — remove a stock item
  app.delete("/api/stock-on-hand/:id", async (req, res) => {
    try {
      await supabase.from('stock_on_hand').delete().eq('id', Number(req.params.id));
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/stock-on-hand — clear all stock
  app.delete("/api/stock-on-hand", async (req, res) => {
    try {
      await supabase.from('stock_on_hand').delete().neq('id', 0);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/stock-on-hand/deduct — deduct quantity from a stock item (by id)
  // Auto-deletes if quantity reaches 0
  app.post("/api/stock-on-hand/deduct", async (req, res) => {
    try {
      const { id, quantity } = req.body as { id: number; quantity: number };
      const { data: row } = await supabase.from('stock_on_hand').select('*').eq('id', id).single();
      if (!row) return res.status(404).json({ error: "Stock item not found" });
      const newQty = Math.max(0, (row as any).quantity - quantity);
      if (newQty <= 0) {
        await supabase.from('stock_on_hand').delete().eq('id', id);
        return res.json({ ok: true, deleted: true, remaining: 0 });
      }
      await supabase.from('stock_on_hand').update({ quantity: newQty, updated_at: new Date().toISOString() }).eq('id', id);
      res.json({ ok: true, deleted: false, remaining: newQty });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/stock-on-hand/match — AI fuzzy-match an order item name to stock on hand
  // Returns the best matching stock item (if any), or null
  app.post("/api/stock-on-hand/match", async (req, res) => {
    try {
      const { orderItemName } = req.body as { orderItemName: string };
      if (!orderItemName) return res.status(400).json({ error: "orderItemName required" });
      const { data: stockItemsRaw } = await supabase.from('stock_on_hand').select('*').gt('quantity', 0).order('item_name');
      const stockItems = (stockItemsRaw ?? []) as any[];
      if (stockItems.length === 0) return res.json({ match: null });

      const stockList = stockItems.map((s: any) => `ID:${s.id} "${s.item_name}" (${s.quantity} ${s.unit})`).join("\n");
      const prompt = `You are matching an order item name to a list of prep stock on hand items.
Order item: "${orderItemName}"

Stock on hand:
${stockList}

If any stock item is clearly the same product as the order item (accounting for minor name variations, punctuation, abbreviations), respond with just the ID number of the best match.
If there is no reasonable match, respond with "null".
Respond with ONLY the ID number or the word null. Nothing else.`;

      const msg = await anthropic.messages.create({
        model: "claude-haiku-4-5",
        max_tokens: 10,
        messages: [{ role: "user", content: prompt }],
      });
      const raw = (msg.content[0] as any).text?.trim();
      const matchId = raw === "null" ? null : parseInt(raw);
      if (!matchId || isNaN(matchId)) return res.json({ match: null });
      const matched = stockItems.find((s: any) => s.id === matchId) || null;
      res.json({ match: matched });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // AUTH ROUTES
  // ─────────────────────────────────────────────────────────────────────────

  const AUTH_PASSWORD = process.env.AUTH_PASSWORD || "Greenhorns2016!";
  const MASTER_PASSWORD = process.env.MASTER_PASSWORD || "Burnfletch123!";

  function requireMaster(req: any, res: any, next: any) {
    const header = req.headers["x-master-password"];
    if (header !== MASTER_PASSWORD) {
      return res.status(401).json({ ok: false, error: "Master password required" });
    }
    next();
  }

  // POST /api/auth/login
  app.post("/api/auth/login", async (req: any, res: any) => {
    try {
      const { name, password } = req.body || {};
      if (!name || !password) return res.status(400).json({ ok: false, error: "Name and password required" });
      if (password !== AUTH_PASSWORD) return res.status(401).json({ ok: false, error: "Invalid name or password" });

      // Find staff by name (case-insensitive)
      const { data: staffList } = await supabase
        .from("staff")
        .select("id, name, access_level_id, is_active")
        .ilike("name", name)
        .eq("is_active", true)
        .limit(1);

      const staffMember = staffList?.[0];
      if (!staffMember) return res.status(401).json({ ok: false, error: "Invalid name or password" });

      // Get access level
      const { data: accessLevel } = await supabase
        .from("access_levels")
        .select("id, name, pages_json")
        .eq("id", staffMember.access_level_id)
        .single();

      if (!accessLevel) return res.status(500).json({ ok: false, error: "Access level not found" });

      // Create session token
      const token = randomUUID();
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

      await supabase.from("staff_sessions").insert({
        staff_id: staffMember.id,
        token,
        created_at: now.toISOString(),
        last_seen_at: now.toISOString(),
        expires_at: expiresAt.toISOString(),
      });

      // Store in server-side session
      req.session.staffId = staffMember.id;

      const pagesJson: string[] = JSON.parse(accessLevel.pages_json || "[]");

      return res.json({
        ok: true,
        staff: {
          id: staffMember.id,
          name: staffMember.name,
          accessLevel: {
            id: accessLevel.id,
            name: accessLevel.name,
            pagesJson,
          },
        },
      });
    } catch (err: any) {
      console.error("Login error:", err);
      return res.status(500).json({ ok: false, error: "Server error" });
    }
  });

  // POST /api/auth/logout
  app.post("/api/auth/logout", async (req: any, res: any) => {
    try {
      const staffId = req.session?.staffId;
      if (staffId) {
        // Delete all sessions for this staff member from this browser session
        await supabase.from("staff_sessions").delete().eq("staff_id", staffId);
      }
      req.session.destroy(() => {});
      return res.json({ ok: true });
    } catch (err: any) {
      return res.json({ ok: true });
    }
  });

  // GET /api/auth/me
  app.get("/api/auth/me", async (req: any, res: any) => {
    try {
      const staffId = req.session?.staffId;
      if (!staffId) return res.json({ ok: false });

      const { data: staffMember } = await supabase
        .from("staff")
        .select("id, name, access_level_id, is_active")
        .eq("id", staffId)
        .eq("is_active", true)
        .single();

      if (!staffMember) return res.json({ ok: false });

      const { data: accessLevel } = await supabase
        .from("access_levels")
        .select("id, name, pages_json")
        .eq("id", staffMember.access_level_id)
        .single();

      if (!accessLevel) return res.json({ ok: false });

      // Update last_seen_at
      await supabase
        .from("staff_sessions")
        .update({ last_seen_at: new Date().toISOString() })
        .eq("staff_id", staffId);

      const pagesJson: string[] = JSON.parse(accessLevel.pages_json || "[]");

      return res.json({
        ok: true,
        staff: {
          id: staffMember.id,
          name: staffMember.name,
          accessLevel: {
            id: accessLevel.id,
            name: accessLevel.name,
            pagesJson,
          },
        },
      });
    } catch (err: any) {
      return res.json({ ok: false });
    }
  });

  // GET /api/staff
  app.get("/api/staff", requireMaster, async (req: any, res: any) => {
    try {
      const { data: staffList } = await supabase
        .from("staff")
        .select("id, name, access_level_id, is_active, created_at, access_levels(id, name)")
        .order("name");
      return res.json(staffList || []);
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // POST /api/staff
  app.post("/api/staff", requireMaster, async (req: any, res: any) => {
    try {
      const { name, accessLevelId } = req.body || {};
      if (!name || !accessLevelId) return res.status(400).json({ error: "Name and accessLevelId required" });
      const { data, error } = await supabase
        .from("staff")
        .insert({ name, access_level_id: accessLevelId, is_active: true, created_at: new Date().toISOString() })
        .select()
        .single();
      if (error) return res.status(400).json({ error: error.message });
      return res.json(data);
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // PATCH /api/staff/:id
  app.patch("/api/staff/:id", requireMaster, async (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id);
      const { name, accessLevelId, isActive } = req.body || {};
      const updates: any = {};
      if (name !== undefined) updates.name = name;
      if (accessLevelId !== undefined) updates.access_level_id = accessLevelId;
      if (isActive !== undefined) updates.is_active = isActive;
      const { data, error } = await supabase.from("staff").update(updates).eq("id", id).select().single();
      if (error) return res.status(400).json({ error: error.message });
      return res.json(data);
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/staff/:id/sessions
  app.delete("/api/staff/:id/sessions", requireMaster, async (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id);
      await supabase.from("staff_sessions").delete().eq("staff_id", id);
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // GET /api/access-levels
  app.get("/api/access-levels", requireMaster, async (req: any, res: any) => {
    try {
      const { data } = await supabase.from("access_levels").select("*").order("sort_order");
      return res.json(data || []);
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // POST /api/access-levels
  app.post("/api/access-levels", requireMaster, async (req: any, res: any) => {
    try {
      const { name, pagesJson, sortOrder } = req.body || {};
      const { data, error } = await supabase
        .from("access_levels")
        .insert({ name, pages_json: JSON.stringify(pagesJson || []), sort_order: sortOrder || 0 })
        .select()
        .single();
      if (error) return res.status(400).json({ error: error.message });
      return res.json(data);
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // PATCH /api/access-levels/:id
  app.patch("/api/access-levels/:id", requireMaster, async (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id);
      const { name, pagesJson } = req.body || {};
      const updates: any = {};
      if (name !== undefined) updates.name = name;
      if (pagesJson !== undefined) updates.pages_json = JSON.stringify(pagesJson);
      const { data, error } = await supabase.from("access_levels").update(updates).eq("id", id).select().single();
      if (error) return res.status(400).json({ error: error.message });
      return res.json(data);
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/access-levels/:id
  app.delete("/api/access-levels/:id", requireMaster, async (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id);
      // Check if any staff are assigned
      const { data: staffWithLevel } = await supabase.from("staff").select("id").eq("access_level_id", id);
      if (staffWithLevel && staffWithLevel.length > 0) {
        return res.status(400).json({ error: "Cannot delete: staff members are assigned to this access level" });
      }
      await supabase.from("access_levels").delete().eq("id", id);
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // GET /api/staff/active-sessions
  app.get("/api/staff/active-sessions", requireMaster, async (req: any, res: any) => {
    try {
      const { data } = await supabase
        .from("staff_sessions")
        .select("id, staff_id, last_seen_at, expires_at, staff(name)")
        .gt("expires_at", new Date().toISOString())
        .order("last_seen_at", { ascending: false });
      return res.json(data || []);
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ─── Wholesale Packaging Preferences ──────────────────────────────────────────

  // GET /api/wholesale/customers — read from Supabase flex_customers cache, merged with saved prefs
  app.get("/api/wholesale/customers", async (req: any, res: any) => {
    try {
      // Read all customers from Supabase cache (populated via /api/wholesale/sync-customers)
      const { data: cachedCustomers, error: custError } = await supabase
        .from("flex_customers")
        .select("uuid, customer_number, company_name, status, first_name, last_name")
        .eq("status", "active")
        .eq("is_wholesale", true);

      if (custError) throw custError;
      if (!cachedCustomers || cachedCustomers.length === 0) {
        return res.status(503).json({ error: "Customer list not yet synced. Please use the Sync Customers button." });
      }

      // Fetch all saved prefs
      const { data: prefs } = await supabase.from("wholesale_packaging_prefs").select("*");
      const prefsMap = new Map<string, any>();
      for (const p of (prefs || [])) {
        prefsMap.set(p.flex_customer_id, p);
      }

      const merged = cachedCustomers.map((c: any) => {
        const pref = prefsMap.get(c.uuid) || {};
        const displayName = c.company_name || `${c.first_name || ''} ${c.last_name || ''}`.trim();
        return {
          flexCustomerId: c.uuid,
          flexCustomerNumber: c.customer_number ?? null,
          companyName: displayName,
          paper: pref.paper ?? null,
          wrapStyle: pref.wrap_style ?? null,
          allItemsGreaseproof: pref.all_items_greaseproof ?? null,
          barcodeLabels: pref.barcode_labels ?? null,
          specialNotes: pref.special_notes ?? null,
          updatedAt: pref.updated_at ?? null,
          updatedBy: pref.updated_by ?? null,
        };
      });

      merged.sort((a: any, b: any) => (a.companyName || "").localeCompare(b.companyName || ""));
      return res.json(merged);
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // POST /api/wholesale/sync-customers — fetch all customers from Flex and cache in Supabase
  app.post("/api/wholesale/sync-customers", async (req: any, res: any) => {
    try {
      let allCustomers: any[] = [];
      // Note: Flex API ignores customer_group_id filter — fetch all and filter by group_uuid client-side
      const WHOLESALE_GROUP_UUID = '13f392c3-fa06-417e-870a-47912a3afc78';
      let nextCustPath: string | null = `/api/v1/customers?per_page=200&page=1`;
      while (nextCustPath) {
        const flexRes = await flexFetch(nextCustPath);
        if (!flexRes.ok) throw new Error(`Flex API error: ${flexRes.status}`);
        const flexData = await flexRes.json();
        const items: any[] = (flexData.items || []).filter((c: any) => c.group_uuid === WHOLESALE_GROUP_UUID);
        allCustomers = allCustomers.concat(items);
        if (flexData.next_page) {
          try { nextCustPath = new URL(flexData.next_page).pathname + new URL(flexData.next_page).search; } catch { nextCustPath = null; }
        } else { nextCustPath = null; }
      }
      // Upsert into flex_customers in batches of 200
      let synced = 0;
      const batchSize = 200;
      for (let i = 0; i < allCustomers.length; i += batchSize) {
        const batch = allCustomers.slice(i, i + batchSize).map((c: any) => ({
          uuid: c.uuid,
          customer_number: c.id ?? null,
          company_name: c.company || `${c.first_name || ''} ${c.last_name || ''}`.trim(),
          status: c.status || 'active',
          email: c.email || '',
          first_name: c.first_name || '',
          last_name: c.last_name || '',
          is_wholesale: true,
          synced_at: new Date().toISOString(),
        }));
        const { error } = await supabase.from("flex_customers").upsert(batch, { onConflict: "uuid" });
        if (error) throw error;
        synced += batch.length;
      }
      return res.json({ ok: true, synced });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // GET /api/wholesale/active-customers — return UUIDs of customers from Supabase order_states in last 90 days
  // Falls back to empty array if Flex is unreachable
  app.get("/api/wholesale/active-customers", async (req: any, res: any) => {
    try {
      // Try Flex first
      const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
      const flexRes = await flexFetch(`/api/v1/orders?per_page=200&page=1&created_after=${encodeURIComponent(ninetyDaysAgo)}&customer_group_id=13f392c3-fa06-417e-870a-47912a3afc78`);
      if (!flexRes.ok) return res.json([]);
      const flexData = await flexRes.json();
      const orders: any[] = flexData.items || flexData.data || flexData.orders || [];
      const ids = [...new Set(orders.map((o: any) => o.customer_uuid || o.customer?.uuid || o.customer_id || o.customer?.id).filter(Boolean))];
      return res.json(ids);
    } catch {
      return res.json([]);
    }
  });

  // POST /api/wholesale/prefs — upsert packaging prefs for a customer
  app.post("/api/wholesale/prefs", async (req: any, res: any) => {
    try {
      const { flexCustomerId, flexCustomerNumber, companyName, paper, wrapStyle, allItemsGreaseproof, barcodeLabels, specialNotes } = req.body;
      if (!flexCustomerId) return res.status(400).json({ error: "flexCustomerId required" });

      // Get staff name from session
      let updatedBy: string | null = null;
      if (req.session?.staffId) {
        const { data: staffRow } = await supabase.from("staff").select("name").eq("id", req.session.staffId).single();
        updatedBy = staffRow?.name ?? null;
      }

      const now = new Date().toISOString();
      const { data, error } = await supabase
        .from("wholesale_packaging_prefs")
        .upsert({
          flex_customer_id: flexCustomerId,
          flex_customer_number: flexCustomerNumber ?? null,
          company_name: companyName ?? null,
          paper: paper ?? null,
          wrap_style: wrapStyle ?? null,
          all_items_greaseproof: allItemsGreaseproof ?? null,
          barcode_labels: barcodeLabels ?? null,
          special_notes: specialNotes ?? null,
          updated_at: now,
          updated_by: updatedBy,
        }, { onConflict: "flex_customer_id" })
        .select()
        .single();

      if (error) throw error;

      return res.json({
        flexCustomerId: data.flex_customer_id,
        flexCustomerNumber: data.flex_customer_number,
        companyName: data.company_name,
        paper: data.paper,
        wrapStyle: data.wrap_style,
        allItemsGreaseproof: data.all_items_greaseproof,
        barcodeLabels: data.barcode_labels,
        specialNotes: data.special_notes,
        updatedAt: data.updated_at,
        updatedBy: data.updated_by,
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: Explode orders into consolidated prep tasks
// ─────────────────────────────────────────────────────────────────────────────
async function explodePrepTasks(orders: any[], supabase: any): Promise<any[]> {
  // Map: key → {itemType, itemId, itemName, quantityRequired, forOrders, expectedMinutes}
  const taskMap = new Map<string, any>();

  function addTask(itemType: string, itemId: number, itemName: string, qty: number, forOrder: string, labourMinutes: number) {
    const key = `${itemType}:${itemId}`;
    if (taskMap.has(key)) {
      const existing = taskMap.get(key);
      existing.quantityRequired += qty;
      existing.expectedMinutes = (existing.expectedMinutes || 0) + labourMinutes * qty;
      if (!existing.forOrders.includes(forOrder)) existing.forOrders.push(forOrder);
    } else {
      taskMap.set(key, {
        itemType, itemId, itemName,
        quantityRequired: qty,
        expectedMinutes: labourMinutes * qty,
        forOrders: [forOrder],
      });
    }
  }

  for (const order of orders) {
    const orderRef = `${order.name} ×${order.quantity}`;

    if (order.type === "recipe") {
      // Look up the recipe
      const { data: recipe } = await supabase.from('recipes').select('*').eq('id', order.id).single();
      if (!recipe) continue;
      const qty = order.quantity || 1;

      // Add the recipe itself as a task
      addTask("recipe", recipe.id, recipe.name, qty, orderRef, recipe.labour_minutes || 0);

      // Explode sub-recipes used in this recipe
      const subRecipesUsed: any[] = JSON.parse(recipe.sub_recipes_json || "[]");
      for (const sr of subRecipesUsed) {
        const { data: subRecipe } = await supabase.from('sub_recipes').select('*').eq('id', sr.subRecipeId).single();
        if (!subRecipe) continue;
        // Labour minutes per batch of sub-recipe (stored in sub_recipes if available)
        const srLabour = (subRecipe as any).labour_minutes || 0;
        addTask("sub_recipe", subRecipe.id, subRecipe.name, sr.quantity * qty, orderRef, srLabour);
      }
    } else if (order.type === "flex_product") {
      // Look up Flex product by SKU first (order.sku), then by id
      let flexProduct: any = null;
      if (order.sku) {
        const { data } = await supabase.from('flex_products').select('*').eq('sku', order.sku).single();
        flexProduct = data;
      }
      if (!flexProduct && order.flexProductId) {
        const { data } = await supabase.from('flex_products').select('*').eq('id', order.flexProductId).single();
        flexProduct = data;
      }
      const flexProductId = flexProduct?.id || order.id;
      const { data: costing } = await supabase.from('flex_product_costings').select('*').eq('flex_product_id', flexProductId).single();
      if (!costing) continue; // No costing set up — skip (can't determine what to prep)
      const components: any[] = JSON.parse(costing.components_json || "[]");
      const qty = order.quantity || 1;

      for (const comp of components) {
        if (comp.type === "recipe") {
          const { data: recipe } = await supabase.from('recipes').select('*').eq('id', comp.id).single();
          if (!recipe) continue;
          addTask("recipe", recipe.id, recipe.name, comp.quantity * qty, orderRef, recipe.labour_minutes || 0);
          // Explode sub-recipes in this recipe
          const subRecipesUsed: any[] = JSON.parse(recipe.sub_recipes_json || "[]");
          for (const sr of subRecipesUsed) {
            const { data: subRecipe } = await supabase.from('sub_recipes').select('*').eq('id', sr.subRecipeId).single();
            if (!subRecipe) continue;
            const srLabour = (subRecipe as any).labour_minutes || 0;
            addTask("sub_recipe", subRecipe.id, subRecipe.name, sr.quantity * comp.quantity * qty, orderRef, srLabour);
          }
        } else if (comp.type === "sub_recipe") {
          const { data: subRecipe } = await supabase.from('sub_recipes').select('*').eq('id', comp.id).single();
          if (!subRecipe) continue;
          const srLabour = (subRecipe as any).labour_minutes || 0;
          addTask("sub_recipe", subRecipe.id, subRecipe.name, comp.quantity * qty, orderRef, srLabour);
        }
      }
    }
  }

  // Sort: sub_recipes first (prep), then recipes, then flex_products
  const sortOrder = ["sub_recipe", "recipe", "flex_product"];
  return [...taskMap.values()].sort((a, b) => sortOrder.indexOf(a.itemType) - sortOrder.indexOf(b.itemType));
}
