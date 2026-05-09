// Migrate flex_allergens_json from label strings to Flex codes
// e.g. ["Tree Nuts","Gluten","Dairy"] → ["CN","CG","CD"]
const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'deli.db'));

const LABEL_TO_CODE = {
  'Gluten': 'CG', 'Tree Nuts': 'CN', 'Nuts': 'CN', 'Nut': 'CN',
  'Dairy': 'CD', 'Milk': 'CD', 'Eggs': 'CE', 'Egg': 'CE',
  'Seafood': 'CS', 'Fish': 'CS', 'Shellfish': 'CS', 'Crustacea': 'CS', 'Molluscs': 'CS',
  'Seeds': 'CX', 'Sesame': 'CX', 'Soy': 'CY', 'Soya': 'CY',
  'Sulphites': 'CU', 'Sulphur Dioxide': 'CU',
};

// Valid Flex codes
const VALID_CODES = new Set(['CG','CN','CD','CE','CS','CX','CY','CU']);

const products = db.prepare("SELECT id, name, flex_allergens_json FROM flex_products WHERE flex_allergens_json != '[]' AND flex_allergens_json IS NOT NULL").all();

console.log(`Processing ${products.length} products with allergen data...`);

let updated = 0;
const stmt = db.prepare('UPDATE flex_products SET flex_allergens_json = ? WHERE id = ?');

for (const p of products) {
  let current;
  try { current = JSON.parse(p.flex_allergens_json); } catch { continue; }
  if (!Array.isArray(current) || current.length === 0) continue;

  // Normalise: if already codes, skip; if labels, convert
  const normalised = [...new Set(current.map(v => {
    if (VALID_CODES.has(v)) return v;         // already a code
    return LABEL_TO_CODE[v] || null;           // convert label → code
  }).filter(Boolean))];

  const before = JSON.stringify(current);
  const after = JSON.stringify(normalised);
  
  if (before !== after) {
    stmt.run(after, p.id);
    console.log(`  [${p.id}] ${p.name}: ${before} → ${after}`);
    updated++;
  }
}

console.log(`\nMigrated ${updated} products. All allergens now stored as codes.`);

// Verify
const check = db.prepare("SELECT id, name, flex_allergens_json FROM flex_products WHERE flex_allergens_json != '[]' LIMIT 5").all();
console.log('\nSample after migration:');
check.forEach(p => console.log(' ', p.id, p.name, '->', p.flex_allergens_json));

db.close();
