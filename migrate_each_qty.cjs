/**
 * Migration: convert "each" ingredient quantities in recipes & sub-recipes
 * from kg-based storage to whole-number counts.
 *
 * Old storage: quantity was in kg (e.g. 0.17 for ~2 wraps at 85g each)
 * New storage: quantity is a count (e.g. 2)
 *
 * Formula: new_count = round(old_qty_kg * 1000 / avgWeightPerUnit_g)
 *
 * Only converts if:
 *   1. Ingredient has unit === "each"
 *   2. Ingredient has avgWeightPerUnit > 0
 *   3. The calculated count is reasonable (> 0)
 */

const Database = require("better-sqlite3");
const path = require("path");

const DB_PATH = path.join(__dirname, "deli.db");
const db = new Database(DB_PATH);

let totalConverted = 0;
let totalSkipped = 0;

// ── Helper ──────────────────────────────────────────────────────────────────

function convertIngredientLines(ingredientsJson, contextName) {
  if (!ingredientsJson) return { json: ingredientsJson, changed: false };
  
  let lines;
  try {
    lines = JSON.parse(ingredientsJson);
  } catch {
    console.log(`  [SKIP] Could not parse ingredientsJson for: ${contextName}`);
    return { json: ingredientsJson, changed: false };
  }

  if (!Array.isArray(lines) || lines.length === 0) {
    return { json: ingredientsJson, changed: false };
  }

  let changed = false;

  lines = lines.map((line) => {
    if (!line.ingredientId || typeof line.quantity !== "number") return line;

    const ing = db.prepare("SELECT * FROM ingredients WHERE id = ?").get(line.ingredientId);
    if (!ing) return line;

    const unit = (ing.unit || "").toLowerCase();
    if (unit !== "each") return line;

    const avgWeight = ing.avg_weight_per_unit;
    if (!avgWeight || avgWeight <= 0) {
      console.log(`  [SKIP] ${contextName} → ingredient #${ing.id} "${ing.name}" has unit=each but no avgWeightPerUnit`);
      totalSkipped++;
      return line;
    }

    // Convert: old qty is in kg, new qty is count
    const oldQty = line.quantity;
    const newQty = Math.round(oldQty * 1000 / avgWeight);

    if (newQty <= 0) {
      console.log(`  [SKIP] ${contextName} → ingredient "${ing.name}" qty=${oldQty}kg → count=${newQty} (zero/negative, skipping)`);
      totalSkipped++;
      return line;
    }

    console.log(`  [CONVERT] ${contextName} → "${ing.name}": ${oldQty}kg × 1000 / ${avgWeight}g = ${newQty} each`);
    changed = true;
    totalConverted++;
    return { ...line, quantity: newQty };
  });

  return { json: JSON.stringify(lines), changed };
}

// ── Process Sub-Recipes ──────────────────────────────────────────────────────

console.log("\n=== Processing Sub-Recipes ===\n");

const subRecipes = db.prepare("SELECT * FROM sub_recipes").all();
const updateSubRecipe = db.prepare("UPDATE sub_recipes SET ingredients_json = ? WHERE id = ?");

for (const sr of subRecipes) {
  const { json, changed } = convertIngredientLines(sr.ingredients_json, `SubRecipe#${sr.id} "${sr.name}"`);
  if (changed) {
    updateSubRecipe.run(json, sr.id);
  }
}

// ── Process Recipes ──────────────────────────────────────────────────────────

console.log("\n=== Processing Recipes ===\n");

const recipes = db.prepare("SELECT * FROM recipes").all();
const updateRecipe = db.prepare("UPDATE recipes SET ingredients_json = ? WHERE id = ?");

for (const r of recipes) {
  const { json, changed } = convertIngredientLines(r.ingredients_json, `Recipe#${r.id} "${r.name}"`);
  if (changed) {
    updateRecipe.run(json, r.id);
  }
}

// ── Process Products/Platters (if they have ingredientsJson) ─────────────────

console.log("\n=== Processing Products/Platters ===\n");

// Check if products table has an ingredients_json column
const productTableInfo = db.prepare("PRAGMA table_info(products)").all();
const hasIngredientsJson = productTableInfo.some(col => col.name === "ingredients_json");

if (hasIngredientsJson) {
  const products = db.prepare("SELECT * FROM products").all();
  const updateProduct = db.prepare("UPDATE products SET ingredients_json = ? WHERE id = ?");

  for (const p of products) {
    const { json, changed } = convertIngredientLines(p.ingredients_json, `Product#${p.id} "${p.name}"`);
    if (changed) {
      updateProduct.run(json, p.id);
    }
  }
} else {
  console.log("  (products table has no ingredients_json column, skipping)");
}

// ── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n=== Migration Complete ===`);
console.log(`  Converted: ${totalConverted} ingredient lines`);
console.log(`  Skipped:   ${totalSkipped} ingredient lines (no avgWeightPerUnit or zero count)\n`);

db.close();
