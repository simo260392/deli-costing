// Tests for normaliseInvoice() using lines from real Deli invoices.
// Run: npx tsx script/test-invoice-normalise.ts
import { normaliseInvoice, type RawInvoice, type RawInvoiceLine } from "../server/invoiceReader";

let failures = 0;
function check(name: string, actual: any, expected: any, tol = 0.01) {
  const ok = typeof expected === "number" ? Math.abs(Number(actual) - expected) <= tol : JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}: got ${JSON.stringify(actual)}${ok ? "" : `, expected ${JSON.stringify(expected)}`}`);
}

const L = (p: Partial<RawInvoiceLine>): RawInvoiceLine => ({
  line_no: 1, line_type: "product", supplier_code: null, description: "", brand: null, quantity: 1, purchase_unit: "EA",
  units_per_purchase: 1, unit_size: 1, unit_size_uom: "each", priced_by_weight: false, unit_price: null, discount: null,
  line_total: null, gst_applies: false, applies_to_code: null, pack_size_from_description: false, notes: null, ...p,
});
const H = (p: Partial<RawInvoice>): RawInvoice => ({
  document_type: "invoice", supplier_name: null, supplier_abn: null, our_account_number: null, invoice_number: "1",
  invoice_date: "2026-10-01", prices_include_gst: false, subtotal_ex_gst: null, gst: null, total_inc_gst: null, lines: [], reader_notes: null, ...p,
});

// Costco 8 Oct: bacon 10 x 15.99 with a separate TPD line of -35.00 quoting code 216280
{
  const n = normaliseInvoice(H({
    prices_include_gst: true, subtotal_ex_gst: 124.90 + 0,
    lines: [
      L({ line_no: 1, supplier_code: "216280", description: "DRSGNA S/CUT BACON", quantity: 10, unit_price: 15.99, line_total: 159.90, unit_size: 1.5, unit_size_uom: "kg" }),
      L({ line_no: 2, line_type: "discount", supplier_code: "282978", description: "TPD DGNA S/C BACON", quantity: 10, unit_price: -3.5, line_total: -35.0, applies_to_code: "216280", unit_size_uom: null }),
    ],
  }));
  const bacon = n.lines[0];
  check("Costco: discount folded, one line left", n.lines.length, 1);
  check("Costco: bacon net per pack", bacon.unit_price_ex_gst, 12.49);
  check("Costco: bacon per kg (1.5kg packs)", bacon.unit_cost, 8.3267);
  check("Costco: totals check", n.totals_check_ok, true);
}

// Spud Shed 29 Sep: 13 separate Tibaldi bacon lines at $12.79 (GST free, 1kg packs once confirmed)
{
  const lines = Array.from({ length: 13 }, (_, i) => L({ line_no: i + 1, description: "TIBALDI BACON BREAKF eac", quantity: 1, unit_price: 12.79, line_total: 12.79, unit_size: null, unit_size_uom: null }));
  const n = normaliseInvoice(H({ prices_include_gst: true, subtotal_ex_gst: 166.27, lines }));
  check("Spud Shed: 13 bacon lines combined", n.lines.length, 1);
  check("Spud Shed: bacon quantity", n.lines[0].quantity, 13);
  check("Spud Shed: bacon flagged as needing pack size", n.lines[0].needs_pack_size, true);
  check("Spud Shed: totals check", n.totals_check_ok, true);
}

// Spud Shed 14 Oct: weighed kiwi (GST free), iced coffee with GST (inc-GST price), discounted sausages
{
  const n = normaliseInvoice(H({
    prices_include_gst: true, subtotal_ex_gst: 7.93 + 4.49 / 1.1 + 17.0,
    lines: [
      L({ line_no: 1, description: "KIWI FRUIT GOLD KG", quantity: 0.836, priced_by_weight: true, unit_price: 9.49, line_total: 7.93, unit_size: null, unit_size_uom: "kg" }),
      L({ line_no: 2, description: "FULL ICED COFFEE 480 eac", quantity: 1, unit_price: 4.49, line_total: 4.49, gst_applies: true, unit_size: 0.48, unit_size_uom: "L" }),
      L({ line_no: 3, description: "G/BROS SAUS BOEREWOR eac", quantity: 1, unit_price: 8.99, discount: 0.49, line_total: 8.50 }),
      L({ line_no: 4, description: "G/BROS SAUS BOEREWOR eac", quantity: 1, unit_price: 8.99, discount: 0.49, line_total: 8.50 }),
    ],
  }));
  check("Spud Shed: kiwi per kg", n.lines[0].unit_cost, 9.4856, 0.01);
  check("Spud Shed: iced coffee ex GST", n.lines[1].line_total_ex_gst, 4.08);
  check("Spud Shed: iced coffee GST", n.lines[1].gst_amount, 0.41);
  check("Spud Shed: sausages combined", n.lines[2].quantity, 2);
  check("Spud Shed: sausage net price each", n.lines[2].unit_cost, 8.50);
  check("Spud Shed: sausage discount kept", n.lines[2].discount_ex_gst, 0.98);
  check("Spud Shed: totals check", n.totals_check_ok, true);
}

// Campbells 16 Sep: Yearling outside flats invoiced on four lines by weight
{
  const w = [[4.922, 72.35], [5.032, 73.97], [5.280, 77.62], [4.892, 71.91]];
  const n = normaliseInvoice(H({
    subtotal_ex_gst: 295.85,
    lines: w.map(([kg, tot], i) => L({ line_no: i + 1, supplier_code: "945213", description: "YEARLING OUTSIDE FLATS R/W", quantity: kg, priced_by_weight: true, unit_price: 14.70, line_total: tot, purchase_unit: "KG", unit_size: null, unit_size_uom: "kg" })),
  }));
  check("Campbells: four beef lines combined", n.lines.length, 1);
  check("Campbells: total kg", n.lines[0].base_qty, 20.126);
  check("Campbells: price per kg", n.lines[0].unit_cost, 14.70, 0.005);
  check("Campbells: totals check", n.totals_check_ok, true);
}

// Bidfood 7 Oct: tortillas 24 packs of 12, eggs 3 cartons of 180, greaseproof with GST, freight-free
{
  const n = normaliseInvoice(H({
    subtotal_ex_gst: 143.76 + 164.31 + 118.40,
    lines: [
      L({ line_no: 1, supplier_code: "156647", description: 'TORTILLAS FLOUR 12" CATERERS C', quantity: 24, purchase_unit: "PKT", units_per_purchase: 12, unit_size: 1, unit_size_uom: "each", unit_price: 5.99, line_total: 143.76 }),
      L({ line_no: 2, supplier_code: "81480", description: "EGGS MEDIUM BULK (180 EGGS)", quantity: 3, purchase_unit: "CTN", units_per_purchase: 180, unit_size: 1, unit_size_uom: "each", unit_price: 54.77, line_total: 164.31 }),
      L({ line_no: 3, supplier_code: "107532", description: "PAPER GREASEPROOF HALF 800's", quantity: 5, purchase_unit: "PKT", units_per_purchase: 800, unit_size: 1, unit_size_uom: "each", unit_price: 23.68, line_total: 118.40, gst_applies: true }),
    ],
  }));
  check("Bidfood: tortilla each", n.lines[0].unit_cost, 0.4992, 0.0001);
  check("Bidfood: egg each", n.lines[1].unit_cost, 0.3043, 0.0001);
  check("Bidfood: greaseproof GST", n.lines[2].gst_amount, 11.84);
  check("Bidfood: totals check", n.totals_check_ok, true);
}

// Il Granino: freight counted in the subtotal but not a product
{
  const n = normaliseInvoice(H({
    subtotal_ex_gst: 431.70,
    lines: [
      L({ line_no: 1, supplier_code: "CT", description: "Ciabatta Loaf Sliced Thick Sliced", quantity: 60, unit_price: 6.72, line_total: 403.20 }),
      L({ line_no: 2, supplier_code: "FOC", description: "Itallian Foccacia Slab 550gm", quantity: 6, unit_price: 4.5, line_total: 27.0 }),
      L({ line_no: 3, line_type: "freight", description: "Freight", quantity: 1, unit_price: 1.5, line_total: 1.5, gst_applies: true, unit_size_uom: null }),
    ],
  }));
  check("Il Granino: totals include freight", n.totals_check_ok, true);
  check("Il Granino: freight kept as freight", n.lines[2].line_type, "freight");
  check("Il Granino: freight has no unit cost", n.lines[2].needs_pack_size, false);
}

// Mismatched totals are flagged
{
  const n = normaliseInvoice(H({ subtotal_ex_gst: 100, lines: [L({ quantity: 1, unit_price: 90, line_total: 90 })] }));
  check("Mismatch flagged", n.totals_check_ok, false);
}

console.log(failures ? `\n${failures} FAILED` : "\nAll passed");
process.exit(failures ? 1 : 0);
