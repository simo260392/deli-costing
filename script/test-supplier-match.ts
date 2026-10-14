// Run: npx tsx script/test-supplier-match.ts
import { matchSupplier } from "../server/invoiceRoutes";
const suppliers = [
  { id: 2, name: "Campbells", abn: "57000226399", our_account_number: "0032660672", name_aliases: ["CAMPBELLS BALCATTA", "Campbells Wholesale"] },
  { id: 3, name: "Bidfood", abn: "45102255587", our_account_number: "445400", name_aliases: ["BIDFOOD MALAGA", "Bidfood WA Pty Limited"] },
  { id: 5, name: "Costco Wholesale Australia", abn: "57104012893", our_account_number: "80070100500", name_aliases: [] },
  { id: 7, name: "Il Granino", abn: null, our_account_number: "2375", name_aliases: ["Il Granino Bakery"] },
  { id: 8, name: "Kakulas Brothers", abn: "19218301310", our_account_number: null, name_aliases: [] },
  { id: 11, name: "Ward Packaging", abn: "33009250033", our_account_number: "DEL120", name_aliases: [] },
  { id: 13, name: "Little Home Bakery", abn: "89602042795", our_account_number: null, name_aliases: [] },
  { id: 27, name: "Spud Shed", abn: "31079441044", our_account_number: null, name_aliases: ["spudshed"] },
  { id: 31, name: "B&E Foods Perth Pty Ltd", abn: "45646542805", our_account_number: "C600000070", name_aliases: [] },
  { id: 20, name: "Key Produce - Markets", abn: null, our_account_number: null, name_aliases: [] },
  { id: 22, name: "Mercer Mooney - Markets", abn: null, our_account_number: null, name_aliases: [] },
  { id: 9, name: "Markets", abn: null, our_account_number: null, name_aliases: [] },
];
const cases: [string, any, number | null][] = [
  ["Bidfood by ABN", { supplier_name: "BIDFOOD MALAGA", supplier_abn: "45 102 255 587", our_account_number: "445400" }, 3],
  ["Campbells by name only", { supplier_name: "Campbells Balcatta", supplier_abn: null, our_account_number: null }, 2],
  ["Il Granino by account no", { supplier_name: null, supplier_abn: null, our_account_number: "2375" }, 7],
  ["Spudshed one word", { supplier_name: "spudshed Fresh Food Market", supplier_abn: "31 079 441 044", our_account_number: null }, 27],
  ["Deli's own ABN ignored", { supplier_name: "Unknown", supplier_abn: "93 695 725 038", our_account_number: null }, null],
  ["European Smallgoods is new", { supplier_name: "European Smallgoods Pty Ltd", supplier_abn: "87105023023", our_account_number: "THDEBYGR" }, null],
  ["B&E name variant", { supplier_name: "B & E Foods", supplier_abn: null, our_account_number: null }, 31],
  ["Mercer Mooney not 'Markets'", { supplier_name: "Mercer Mooney", supplier_abn: null, our_account_number: null }, 22],
  ["LHB by name", { supplier_name: "Little Home Bakery Pty Ltd", supplier_abn: null, our_account_number: null }, 13],
];
let fail = 0;
for (const [name, inv, want] of cases) {
  const m = matchSupplier(inv, suppliers);
  const ok = m.supplierId === want; if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}: ${m.supplierId} via ${m.method}${ok ? "" : ` (wanted ${want})`}`);
}
console.log(fail ? `${fail} FAILED` : "All passed"); process.exit(fail ? 1 : 0);
