const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'deli.db'));

const updates = [
  { id: 161, name: 'Napkins', price: 2.04, qty: 100 },
  { id: 67, name: '12oz Bowl', price: 8.47, qty: 50 },
  { id: 68, name: '12oz Bowl Lid', price: 6.83, qty: 25 },
  { id: 165, name: '12oz Coffee Cups', price: 98.40, qty: 1000 },
  { id: 169, name: 'Coffee Sleeve Large', price: 40.49, qty: 1000 },
  { id: 168, name: 'Coffee Sleeve Small', price: 36.56, qty: 1000 },
  { id: 167, name: 'Coffee Lids', price: 64.64, qty: 1000 },
  { id: 171, name: 'Cold Cup 16oz', price: 7.53, qty: 50 },
  { id: 172, name: 'Cold Cup Lid', price: 3.91, qty: 50 },
  { id: 173, name: '500ml Bowl Medium Salad', price: 8.45, qty: 50 },
  { id: 174, name: '750ml Bowl Large Salad', price: 9.43, qty: 50 },
  { id: 177, name: 'Clear Lids for Salad Bowls', price: 5.98, qty: 50 },
  { id: 176, name: 'Paper Lids for Salad Bowls', price: 17.16, qty: 50 },
  { id: 170, name: 'Drinks Tray', price: 23.55, qty: 100 },
  { id: 181, name: 'Forks', price: 38.80, qty: 1000 },
  { id: 183, name: 'Spoons', price: 42.53, qty: 1000 },
  { id: 207, name: 'Catering Box Small', price: 28.25, qty: 50 },
  { id: 208, name: 'Catering Box Medium', price: 39.90, qty: 50 },
  { id: 209, name: 'Catering Box Large', price: 62.00, qty: 50 },
  { id: 187, name: 'Snack Box', price: 42.20, qty: 200 },
  { id: 188, name: 'Plate', price: 57.92, qty: 500 },
  { id: 189, name: 'Foil Tray for Catering', price: 58.58, qty: 100 },
  { id: 190, name: 'Foil Tray Lid', price: 23.30, qty: 100 },
  { id: 304, name: 'White Greaseproof Paper', price: 22.16, qty: 500 },
  { id: 191, name: '6mm Straw', price: 4.60, qty: 250 },
  { id: 192, name: '10mm Jumbo Straw', price: 3.56, qty: 100 },
  { id: 162, name: 'Sandwich Bags', price: 15.33, qty: 500 },
  { id: 163, name: 'Takeaway Bags', price: 55.60, qty: 250 },
  { id: 180, name: 'Yoghurt Pot Lid', price: 56.78, qty: 500 },
];

// Check columns
const cols = db.pragma('table_info(ingredients)').map(c => c.name);
console.log('Ingredients table columns:', cols.join(', '));

const stmt = db.prepare('UPDATE ingredients SET best_cost_per_unit = ? WHERE id = ?');

let updated = 0;
let notFound = 0;
const results = [];

for (const item of updates) {
  const perUnit = item.price / item.qty;
  
  const existing = db.prepare('SELECT id, name, best_cost_per_unit FROM ingredients WHERE id = ?').get(item.id);
  
  if (!existing) {
    console.log(`NOT FOUND: id=${item.id} (${item.name})`);
    notFound++;
    continue;
  }
  
  const result = stmt.run(perUnit, item.id);
  updated += result.changes;
  results.push({ id: item.id, name: item.name, oldPrice: existing.best_cost_per_unit, newPrice: perUnit });
}

console.log(`\nUpdated ${updated} ingredients, ${notFound} not found\n`);
results.forEach(r => {
  const oldP = r.oldPrice != null ? `$${Number(r.oldPrice).toFixed(4)}` : 'N/A';
  const newP = `$${r.newPrice.toFixed(4)}`;
  const diff = r.oldPrice ? ((r.newPrice - r.oldPrice) / r.oldPrice * 100).toFixed(1) + '%' : 'new';
  console.log(`  [${r.id}] ${r.name}: ${oldP} → ${newP} (${diff})`);
});

db.close();
console.log('\nDone. Now triggering cascade via API...');
