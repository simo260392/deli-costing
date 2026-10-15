// Supplier invoice reader (Oct 2026).
//
// Two steps:
//   1. readInvoiceDocument(): Claude reads the PDF or photo and returns the
//      invoice exactly as printed (header + every line) through a forced tool call.
//   2. normaliseInvoice(): plain code turns that into what the app needs:
//      prices ex GST, discounts netted into their item, repeated lines combined,
//      base quantity (kg / L / each) and unit cost, and a totals check.
//
// Step 2 is deterministic and has no AI in it, so the maths can be tested and trusted.

import Anthropic from "@anthropic-ai/sdk";

export const INVOICE_READER_MODEL = process.env.INVOICE_READER_MODEL || "claude-sonnet-5-5";

// ─── Types ───────────────────────────────────────────────────────────────────

export type LineType = "product" | "freight" | "fee" | "deposit" | "discount" | "credit" | "personal";
export type BaseUom = "kg" | "L" | "each";

/** One line exactly as the reader saw it on the document. */
export interface RawInvoiceLine {
  line_no: number;
  line_type: LineType;
  supplier_code: string | null;
  description: string;
  brand: string | null;
  quantity: number | null;            // purchase units, or kg when priced_by_weight
  purchase_unit: string | null;       // CTN, BKT, BAG, PKT, EA, KG...
  units_per_purchase: number | null;  // inner units in one purchase unit (6 for "6 x 2L")
  unit_size: number | null;           // size of one inner unit (2 for 2L); 1 for "each"
  unit_size_uom: BaseUom | null;
  priced_by_weight: boolean;
  unit_price: number | null;          // as printed, per purchase unit (or per kg)
  discount: number | null;            // positive amount taken off this line, as printed
  line_total: number | null;          // as printed, after discount
  gst_applies: boolean | null;        // false for GST-free items
  applies_to_code: string | null;     // for a separate discount line: the item code it belongs to
  pack_size_from_description: boolean;
  notes: string | null;
  generic_name: string | null;        // plain name for matching ("Short cut bacon")
  item_type: "ingredient" | "packaging" | "cleaning" | "other" | null;
}

export interface RawInvoice {
  document_type: "invoice" | "receipt" | "credit_note" | "order_confirmation" | "statement" | "other";
  supplier_name: string | null;
  supplier_abn: string | null;
  our_account_number: string | null;
  invoice_number: string | null;
  invoice_date: string | null;        // YYYY-MM-DD
  prices_include_gst: boolean;
  subtotal_ex_gst: number | null;
  gst: number | null;
  total_inc_gst: number | null;
  lines: RawInvoiceLine[];
  reader_notes: string | null;
}

/** A line after normalisation, ready to match and save. */
export interface NormalisedLine {
  line_no: number;
  line_type: LineType;
  supplier_code: string | null;
  description: string;
  brand: string | null;
  quantity: number | null;
  purchase_unit: string | null;
  units_per_purchase: number | null;
  unit_size: number | null;
  unit_size_uom: BaseUom | null;
  priced_by_weight: boolean;
  unit_price_ex_gst: number | null;   // per purchase unit (or per kg), after discount
  discount_ex_gst: number;
  line_total_ex_gst: number | null;
  gst_amount: number;
  gst_applies: boolean | null;
  base_qty: number | null;            // total quantity in kg / L / each
  unit_cost: number | null;           // ex GST per kg / L / each
  needs_pack_size: boolean;           // the document doesn't say how much is in the pack
  merged_from: number[];              // original line numbers combined into this one
  notes: string | null;
  generic_name: string | null;
  item_type: "ingredient" | "packaging" | "cleaning" | "other" | null;
}

export interface NormalisedInvoice extends Omit<RawInvoice, "lines"> {
  lines: NormalisedLine[];
  computed_subtotal_ex_gst: number;
  totals_check_ok: boolean | null;
  totals_check_note: string | null;
}

// ─── Step 1: read the document with Claude ──────────────────────────────────

const lineSchema = {
  type: "object",
  properties: {
    line_no: { type: "integer", description: "Order on the document, starting at 1." },
    line_type: {
      type: "string",
      enum: ["product", "freight", "fee", "deposit", "discount", "credit", "personal"],
      description:
        "product = anything bought for the business (food, packaging, cleaning, equipment). " +
        "freight/fee/deposit = delivery charges, surcharges, card fees, crate or keg deposits. " +
        "discount = a discount you could NOT attach to a specific item. credit = a returned or credited item. " +
        "personal = clearly a household item: pet food (cat/dog food, e.g. Dine, Whiskas, Fancy Feast, Pedigree, Kirkland cat food), toys, clothing. Do not guess personal for anything a cafe could use.",
    },
    supplier_code: { type: ["string", "null"], description: "Supplier's product code / item number / SKU, exactly as printed. Null if none." },
    description: { type: "string", description: "Product description exactly as printed, including size text (e.g. 'MAYONNAISE WHOLE EGG FREE RANGE 10kg')." },
    brand: { type: ["string", "null"], description: "Brand if printed or obvious from the description (e.g. 'MENU MAKER', 'Bega', 'BioPak', 'Dorsogna'). Null if unknown. Not the supplier's name." },
    quantity: {
      type: ["number", "null"],
      description:
        "Number of purchase units supplied (use supplied, not ordered). When priced by weight, the kg supplied. " +
        "Must satisfy quantity × unit_price − discount ≈ line_total.",
    },
    purchase_unit: { type: ["string", "null"], description: "What one unit of quantity is: CTN, BKT, BAG, PKT, TRAY, EA, KG, SLV, BTL, ROLL..." },
    units_per_purchase: { type: ["number", "null"], description: "Inner units in one purchase unit. '6 x 2.5KG' = 6. 'PACK of 3' = 3. '15doz' = 180. '800s' = 800. Single item = 1." },
    unit_size: { type: ["number", "null"], description: "Size of ONE inner unit in unit_size_uom. '6 x 2L' = 2. '1.5kg' = 1.5. '400GM' = 0.4. Countable items = 1. Null if not stated." },
    unit_size_uom: { type: ["string", "null"], enum: ["kg", "L", "each", null], description: "kg for weight (convert g), L for volume (convert ml), each for countable items." },
    priced_by_weight: { type: "boolean", description: "True when the price is per kg and quantity is the weight (R/W meat, 'NET 0.836kg@$9.49/kg', cheese KG=1)." },
    unit_price: { type: ["number", "null"], description: "Price per purchase unit (or per kg) exactly as printed, before any discount." },
    discount: { type: ["number", "null"], description: "Positive amount taken off this item. Fold in discount lines that clearly belong to this item (Spud Shed line under the item, Costco 'TPD' line quoting this item's code)." },
    line_total: { type: ["number", "null"], description: "Line amount as printed, after discount. Use the ex-GST column when both are shown." },
    gst_applies: { type: ["boolean", "null"], description: "False for GST-free items (0%, N-T, Z code, GST Free section). True when GST is charged." },
    applies_to_code: { type: ["string", "null"], description: "Only for a separate discount line you could not fold in: the item code it refers to, if printed." },
    pack_size_from_description: { type: "boolean", description: "True if the pack size came from the description text rather than a pack column." },
    notes: { type: ["string", "null"], description: "Anything odd about this line (zero price, random weight with no kg shown, illegible)." },
    generic_name: { type: ["string", "null"], description: "Plain generic name a kitchen would use, without brand, pack size or supplier abbreviations: 'DRSGNA S/CUT BACON' -> 'Short cut bacon', 'NATURAL SWISS CHSE' -> 'Swiss cheese', 'Paper BioBowl Kraft 16oz/500ml' -> '500ml kraft bowl'. Null for freight/fees." },
    item_type: { type: ["string", "null"], enum: ["ingredient", "packaging", "cleaning", "other", null], description: "ingredient = food or drink; packaging = containers, cups, lids, bags, foil, cling film, napkins, cutlery, gloves; cleaning = chemicals, sponges, paper towel; other = anything else." },
  },
  required: [
    "line_no", "line_type", "supplier_code", "description", "brand", "quantity", "purchase_unit",
    "units_per_purchase", "unit_size", "unit_size_uom", "priced_by_weight", "unit_price", "discount",
    "line_total", "gst_applies", "applies_to_code", "pack_size_from_description", "notes", "generic_name", "item_type",
  ],
} as const;

const invoiceTool = {
  name: "record_invoice",
  description: "Record everything on this supplier document.",
  input_schema: {
    type: "object",
    properties: {
      document_type: {
        type: "string",
        enum: ["invoice", "receipt", "credit_note", "order_confirmation", "statement", "other"],
        description: "order_confirmation if it says it is not an invoice or is an order acknowledgement.",
      },
      supplier_name: { type: ["string", "null"], description: "The supplier's trading name (read the logo if the name is only in the logo)." },
      supplier_abn: { type: ["string", "null"], description: "Supplier's ABN, digits only. Not the customer's ABN." },
      our_account_number: { type: ["string", "null"], description: "The customer/account/member number the supplier uses for The Deli." },
      invoice_number: { type: ["string", "null"], description: "Invoice / document / slip / transaction number." },
      invoice_date: { type: ["string", "null"], description: "YYYY-MM-DD. Australian documents are day-first (07/10/2026 = 7 October)." },
      prices_include_gst: { type: "boolean", description: "True when item prices are printed GST-inclusive (supermarket and Costco receipts). False when the item column is ex GST." },
      subtotal_ex_gst: { type: ["number", "null"], description: "Total before GST as printed (Total Ex / Net / Sales Total). Include freight." },
      gst: { type: ["number", "null"] },
      total_inc_gst: { type: ["number", "null"] },
      lines: { type: "array", items: lineSchema, description: "Every line in order. Skip headings, carton counts, payment and balance sections." },
      reader_notes: { type: ["string", "null"], description: "Anything the reviewer should know about this document." },
    },
    required: [
      "document_type", "supplier_name", "supplier_abn", "our_account_number", "invoice_number", "invoice_date",
      "prices_include_gst", "subtotal_ex_gst", "gst", "total_inc_gst", "lines", "reader_notes",
    ],
  },
} as const;

const SYSTEM_PROMPT = `You read supplier invoices and receipts for The Deli by Greenhorns, a catering kitchen in Osborne Park, Perth, Western Australia.
Record the document exactly as printed using the record_invoice tool. Accuracy matters more than anything: these prices set recipe costs.

Rules:
- One entry per printed product line, in order. Do not combine repeated lines yourself.
- Use quantity SUPPLIED/SHIPPED, not ordered.
- Check every line: quantity × unit_price − discount should equal line_total (within a few cents). If the printed columns don't satisfy this, pick the quantity column that does (e.g. Bidfood "Total Units" × "Unit Price" = value).
- Weighed items: quantity = kg, unit_price = per kg, priced_by_weight = true.
- Pack sizes: read them from pack columns or the description ("6 X 2.5KG", "24x375ml", "120x42gr", "12's CTN=6", "PACK of 3", "4 pk", "15doz", "1.5KG", "A10" can = 3kg). Convert g to kg and ml to L.
- Discounts printed under an item, or a discount line that quotes an item's code, belong to that item: put them in that item's discount and do not create a separate line.
- Lines for $0.00 are still lines; record them and add a note.
- Ignore the payment section (card numbers, EFTPOS, change, balances, bank details). Never copy card or bank numbers anywhere.
- The Deli's own ABNs are 93 695 725 038 and 90 638 051 313; never return these as the supplier ABN.
- Read photos carefully even if rotated, creased or at an angle. If something is illegible, say so in notes rather than guessing.`;

/** An error with a message that's fine to show Scott as-is. */
export class ReaderError extends Error {}

/** Turn API and other errors into a plain-English line for the invoice page. */
export function friendlyReaderError(e: any): string {
  if (e instanceof ReaderError) return e.message;
  const status = e?.status ?? e?.statusCode;
  const msg = String(e?.error?.error?.message || e?.message || e || "");
  if (status === 401 || /api key|authentication/i.test(msg)) return "The Anthropic API key on Railway isn't working. Check ANTHROPIC_API_KEY.";
  if (/workspace/i.test(msg)) return "The Anthropic key needs a workspace. Set ANTHROPIC_WORKSPACE_ID on Railway.";
  if (/credit balance|billing|payment/i.test(msg)) return "The Anthropic account is out of credit. Top it up in the Claude Console, then press Read again.";
  if (status === 429 || status === 529 || /overloaded|rate limit/i.test(msg)) return "The reader is busy right now. Wait a minute and press Read again.";
  if (status === 413 || /too large|request size/i.test(msg)) return "This file is too large to read. Try a smaller scan or photo.";
  if (/password|encrypted/i.test(msg)) return "This PDF is password-protected, so it can't be read.";
  return `Couldn't read this document (${msg.slice(0, 160)}). Try Read again; if it keeps failing, tell Claude.`;
}

/** Rough HTML to text that keeps table rows on their own lines. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(tr|p|div|h\d|li)>|<br\s*\/?>/gi, "\n")
    .replace(/<\/(td|th)>/gi, " | ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
}

export interface ReaderInput {
  data: Buffer;
  mediaType: string;          // application/pdf, image/jpeg, image/png, image/webp, image/gif
  fileName?: string;
  knownSuppliers?: string[];  // names to help with logo-only documents
}

export async function readInvoiceDocument(client: Anthropic, input: ReaderInput): Promise<{ raw: RawInvoice; usage: any; model: string }> {
  const isPdf = input.mediaType === "application/pdf";
  const isText = input.mediaType.startsWith("text/");
  const docBlock: any = isPdf
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: input.data.toString("base64") } }
    : isText
      // Invoice written in the body of an email (some market sellers do this)
      ? { type: "text", text: `Email body:\n\n${htmlToText(input.data.toString("utf8")).slice(0, 60000)}` }
      : { type: "image", source: { type: "base64", media_type: input.mediaType, data: input.data.toString("base64") } };

  const hint = input.knownSuppliers?.length
    ? `\nSuppliers The Deli already uses (for recognising logos; the document may be from someone else): ${input.knownSuppliers.join(", ")}.`
    : "";

  const msg = await client.messages.create({
    model: INVOICE_READER_MODEL,
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    tools: [invoiceTool as any],
    // Newer models don't accept a forced tool choice, so the prompt asks for the tool instead.
    tool_choice: { type: "auto" },
    messages: [{
      role: "user",
      content: [
        docBlock,
        { type: "text", text: `Record this document with the record_invoice tool${input.fileName ? ` (file: ${input.fileName})` : ""}. Call the tool once with everything; don't reply in text.${hint}` },
      ],
    }],
  });

  if (msg.stop_reason === "max_tokens") throw new ReaderError("This invoice was too long to read in one go.");
  if (msg.stop_reason === "refusal") throw new ReaderError("The reader declined to read this document.");
  const toolUse = msg.content.find((b: any) => b.type === "tool_use" && b.name === "record_invoice") as any;
  let raw: any = toolUse?.input;
  if (!raw) {
    // Fallback: the model answered in text. Accept a JSON object if there is one.
    const text = msg.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
    const m = text.match(/\{[\s\S]*\}/);
    try { raw = m ? JSON.parse(m[0]) : null; } catch { raw = null; }
  }
  if (!raw || !Array.isArray(raw.lines)) throw new ReaderError("The reader didn't return any invoice lines. Try Read again.");
  return { raw: raw as RawInvoice, usage: msg.usage, model: INVOICE_READER_MODEL };
}

// ─── Step 2: normalise (no AI) ───────────────────────────────────────────────

const round = (n: number, dp = 4) => Math.round(n * 10 ** dp) / 10 ** dp;
const num = (v: any): number | null => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

function normKey(s: string | null | undefined) {
  return (s || "").toLowerCase().replace(/\s+/g, " ").replace(/\b(each|eac|ea)\b/g, "").trim();
}

/** Ex-GST value of a printed amount. */
function exGst(amount: number | null, pricesIncludeGst: boolean, gstApplies: boolean | null): number | null {
  if (amount === null) return null;
  if (pricesIncludeGst && gstApplies) return amount / 1.1;
  return amount;
}

/** Total quantity in kg / L / each for a line, or null if the document doesn't say. */
export function baseQuantity(l: Pick<RawInvoiceLine, "quantity" | "priced_by_weight" | "units_per_purchase" | "unit_size" | "unit_size_uom">): number | null {
  const q = num(l.quantity);
  if (q === null) return null;
  if (l.priced_by_weight) return q;
  if (!l.unit_size_uom) return null;
  const per = num(l.units_per_purchase) ?? 1;
  const size = num(l.unit_size) ?? (l.unit_size_uom === "each" ? 1 : null);
  if (size === null) return null;
  return q * per * size;
}

export function normaliseInvoice(raw: RawInvoice): NormalisedInvoice {
  const incGst = !!raw.prices_include_gst;

  // 1. Fold separate discount lines into their item where the code matches.
  const lines = raw.lines.map((l) => ({ ...l }));
  for (const d of lines) {
    if (d.line_type !== "discount" || !d.applies_to_code) continue;
    const target = lines.find((t) => t.line_type === "product" && t.supplier_code && t.supplier_code === d.applies_to_code);
    if (!target) continue;
    const amt = Math.abs(num(d.line_total) ?? num(d.discount) ?? 0);
    target.discount = (num(target.discount) ?? 0) + amt;
    if (num(target.line_total) !== null) target.line_total = round((num(target.line_total) as number) - amt, 2);
    d.line_type = "ignore" as any; // folded
  }

  // 2. Convert to ex GST and work out base quantities.
  const converted: NormalisedLine[] = lines
    .filter((l: any) => l.line_type !== "ignore")
    .map((l) => {
      const total = exGst(num(l.line_total), incGst, l.gst_applies);
      const disc = exGst(Math.abs(num(l.discount) ?? 0), incGst, l.gst_applies) ?? 0;
      const qty = num(l.quantity);
      const base = baseQuantity(l);
      const gstAmount = l.gst_applies && num(l.line_total) !== null
        ? (incGst ? (num(l.line_total) as number) - (total as number) : (total as number) * 0.1)
        : 0;
      return {
        line_no: l.line_no,
        line_type: l.line_type,
        supplier_code: l.supplier_code || null,
        description: (l.description || "").trim(),
        brand: l.brand || null,
        quantity: qty,
        purchase_unit: l.purchase_unit || null,
        units_per_purchase: num(l.units_per_purchase),
        unit_size: num(l.unit_size),
        unit_size_uom: l.unit_size_uom || null,
        priced_by_weight: !!l.priced_by_weight,
        unit_price_ex_gst: total !== null && qty ? round(total / qty) : exGst(num(l.unit_price), incGst, l.gst_applies),
        discount_ex_gst: round(disc, 2),
        line_total_ex_gst: total === null ? null : round(total, 2),
        gst_amount: round(gstAmount, 2),
        gst_applies: l.gst_applies,
        base_qty: base === null ? null : round(base, 4),
        unit_cost: base && total !== null ? round(total / base) : null,
        needs_pack_size: l.line_type === "product" && base === null,
        merged_from: [l.line_no],
        notes: l.notes || null,
        generic_name: l.generic_name || null,
        item_type: l.item_type || null,
      };
    });

  // 3. Combine repeated product lines (Spud Shed lists every bacon pack separately;
  //    Campbells lists each piece of R/W beef). Same code (or description) and same pack.
  const merged: NormalisedLine[] = [];
  for (const l of converted) {
    if (l.line_type !== "product") { merged.push(l); continue; }
    const key = (x: NormalisedLine) =>
      [x.supplier_code ? `c:${x.supplier_code.toLowerCase()}` : `d:${normKey(x.description)}`,
       x.priced_by_weight, x.units_per_purchase ?? "", x.unit_size ?? "", x.unit_size_uom ?? "", x.gst_applies].join("|");
    const existing = merged.find((m) => m.line_type === "product" && key(m) === key(l));
    if (!existing) { merged.push({ ...l }); continue; }
    existing.quantity = existing.quantity !== null && l.quantity !== null ? round(existing.quantity + l.quantity) : null;
    existing.line_total_ex_gst = existing.line_total_ex_gst !== null && l.line_total_ex_gst !== null ? round(existing.line_total_ex_gst + l.line_total_ex_gst, 2) : null;
    existing.discount_ex_gst = round(existing.discount_ex_gst + l.discount_ex_gst, 2);
    existing.gst_amount = round(existing.gst_amount + l.gst_amount, 2);
    existing.base_qty = existing.base_qty !== null && l.base_qty !== null ? round(existing.base_qty + l.base_qty) : null;
    existing.unit_price_ex_gst = existing.line_total_ex_gst !== null && existing.quantity ? round(existing.line_total_ex_gst / existing.quantity) : existing.unit_price_ex_gst;
    existing.unit_cost = existing.base_qty && existing.line_total_ex_gst !== null ? round(existing.line_total_ex_gst / existing.base_qty) : null;
    existing.merged_from.push(...l.merged_from);
    if (l.notes) existing.notes = [existing.notes, l.notes].filter(Boolean).join("; ");
  }

  // 4. Totals check against the document.
  const computed = round(merged.reduce((s, l) => s + (l.line_total_ex_gst ?? 0), 0), 2);
  let ok: boolean | null = null;
  let note: string | null = null;
  const printedEx = num(raw.subtotal_ex_gst) ?? (num(raw.total_inc_gst) !== null && num(raw.gst) !== null ? (num(raw.total_inc_gst) as number) - (num(raw.gst) as number) : null);
  if (printedEx !== null) {
    const diff = Math.abs(printedEx - computed);
    // Receipts that round GST per line can drift by a few cents per GST line.
    const tolerance = 0.05 + (incGst ? 0.01 * merged.filter((l) => l.gst_applies).length : 0);
    ok = diff <= tolerance;
    if (!ok) note = `Lines add up to $${computed.toFixed(2)} ex GST but the document says $${printedEx.toFixed(2)} (difference $${diff.toFixed(2)}).`;
  } else {
    note = "The document has no subtotal to check against.";
  }

  const { lines: _drop, ...header } = raw;
  return { ...header, lines: merged, computed_subtotal_ex_gst: computed, totals_check_ok: ok, totals_check_note: note };
}
