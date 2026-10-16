// ─── Xero connection: pull supplier bills and their documents ────────────────
// Scott signs in to Xero once (OAuth). Every hour, and on demand, the app looks for
// bills (ACCPAY invoices) changed since the last check, downloads the attached
// document (emailed PDF or Hubdoc scan) and feeds it to the invoice reader.
//
// Only bills from contacts that match a supplier in the app are pulled in
// automatically, so rent, power and wages bills are left alone. Others are listed
// and can be pulled in by hand.
//
// Needs Railway variables: XERO_CLIENT_ID, XERO_CLIENT_SECRET, SUPABASE_SERVICE_ROLE_KEY
// (tokens are kept in xero_connection, which has row level security on).
// Scopes (granular, required for Xero apps created after 2 March 2026):
//   openid profile email offline_access accounting.invoices.read accounting.attachments.read
import type { Express } from "express";
import crypto from "crypto";
import supabase from "./supabase";
import { requireInvoiceAccess, ingestInvoiceFile, matchSupplier, mimeFromName } from "./invoiceRoutes";

const SCOPES = "openid profile email offline_access accounting.invoices.read accounting.attachments.read accounting.settings.read";
const AUTH_URL = "https://login.xero.com/identity/connect/authorize";
const TOKEN_URL = "https://identity.xero.com/connect/token";
const API = "https://api.xero.com/api.xro/2.0";
const READABLE = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/gif", "image/heic"];

const cfg = () => ({
  clientId: process.env.XERO_CLIENT_ID || "",
  clientSecret: process.env.XERO_CLIENT_SECRET || "",
  redirectUri: process.env.XERO_REDIRECT_URI || "https://the-deli.app/api/xero-connection/callback",
});
const configured = () => !!(cfg().clientId && cfg().clientSecret);
const canKeepTokens = () => !!process.env.SUPABASE_SERVICE_ROLE_KEY;

const asyncRoute = (fn: any) => (req: any, res: any, next: any) =>
  Promise.resolve(fn(req, res, next)).catch((e: any) => {
    console.error("[xero] route error:", e?.message || e);
    if (!res.headersSent) res.status(500).json({ error: e?.message || "Internal server error" });
  });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─── Tokens ──────────────────────────────────────────────────────────────────
async function tokenRequest(body: Record<string, string>) {
  const { clientId, clientSecret } = cfg();
  const resp = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body).toString(),
  });
  const json: any = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(`Xero sign-in failed: ${json.error_description || json.error || resp.status}`);
  return json as { access_token: string; refresh_token: string; expires_in: number; scope?: string };
}

async function getConnection() {
  const { data } = await supabase.from("xero_connection").select("*").eq("id", 1).maybeSingle();
  return data as any;
}

/** A valid access token, refreshing it if it is about to expire. */
async function accessToken(): Promise<{ token: string; tenantId: string }> {
  const conn = await getConnection();
  if (!conn?.refresh_token || !conn?.tenant_id) throw new Error("Xero isn't connected");
  if (conn.access_token && conn.expires_at && new Date(conn.expires_at).getTime() - Date.now() > 120_000) {
    return { token: conn.access_token, tenantId: conn.tenant_id };
  }
  const t = await tokenRequest({ grant_type: "refresh_token", refresh_token: conn.refresh_token });
  await supabase.from("xero_connection").update({
    access_token: t.access_token, refresh_token: t.refresh_token,
    expires_at: new Date(Date.now() + t.expires_in * 1000).toISOString(),
  }).eq("id", 1);
  return { token: t.access_token, tenantId: conn.tenant_id };
}

async function xeroGet(path: string, accept = "application/json", extraHeaders: Record<string, string> = {}): Promise<Response> {
  const { token, tenantId } = await accessToken();
  for (let attempt = 0; attempt < 3; attempt++) {
    const resp = await fetch(path.startsWith("http") ? path : `${API}${path}`, {
      headers: { Authorization: `Bearer ${token}`, "xero-tenant-id": tenantId, Accept: accept, ...extraHeaders },
    });
    if (resp.status === 429) { // rate limited: wait as asked
      await sleep((Number(resp.headers.get("retry-after")) || 5) * 1000);
      continue;
    }
    return resp;
  }
  throw new Error("Xero is rate limiting requests; try again in a minute");
}

// ─── Cost of goods (KPI) ─────────────────────────────────────────────────────
// Cost of goods = bill lines (ex GST) coded to the chosen expense accounts, by bill date,
// less supplier credit notes. Draft bills count too, since Hubdoc and email bills can sit
// as drafts for a day or two. Setting kpi_cogs_accounts = JSON array of account codes; until
// it's set, accounts whose names look like food/drinks/coffee/packaging/consumables are used.
export interface XeroAccount { code: string; name: string; type: string; suggested: boolean }
const COGS_NAME = /food|drink|beverage|coffee|packag|consumable|cost of (goods|sales)|purchases/i;
let accountsCache: { at: number; list: XeroAccount[] } | null = null;

export async function xeroConnected(): Promise<boolean> {
  if (!configured() || !canKeepTokens()) return false;
  const conn = await getConnection();
  return !!conn?.refresh_token && !!conn?.tenant_id;
}

/** Expense / direct cost accounts. Throws "reconnect" when the connection lacks the settings permission. */
export async function xeroExpenseAccounts(): Promise<XeroAccount[]> {
  if (accountsCache && Date.now() - accountsCache.at < 30 * 60_000) return accountsCache.list;
  const resp = await xeroGet(`/Accounts`);
  if (resp.status === 401 || resp.status === 403) throw Object.assign(new Error("Reconnect Xero so the app can read your account names"), { reconnect: true });
  if (!resp.ok) throw new Error(`Xero accounts returned ${resp.status}`);
  const body: any = await resp.json();
  const list: XeroAccount[] = (body.Accounts || [])
    .filter((a: any) => a.Status !== "ARCHIVED" && a.Code && (a.Class === "EXPENSE" || a.Type === "DIRECTCOSTS"))
    .map((a: any) => ({ code: String(a.Code), name: String(a.Name || ""), type: String(a.Type || ""), suggested: COGS_NAME.test(String(a.Name || "")) }))
    .sort((a: XeroAccount, b: XeroAccount) => a.code.localeCompare(b.code, undefined, { numeric: true }));
  accountsCache = { at: Date.now(), list };
  return list;
}

/** The account codes that count as cost of goods. */
export async function cogsAccountCodes(): Promise<string[]> {
  const { data } = await supabase.from("settings").select("value").eq("key", "kpi_cogs_accounts").maybeSingle();
  try {
    const saved = JSON.parse(data?.value || "null");
    if (Array.isArray(saved) && saved.length) return saved.map(String);
  } catch {}
  return (await xeroExpenseAccounts()).filter((a) => a.suggested).map((a) => a.code);
}

const xeroDateTime = (s: string) => { const [y, m, d] = s.split("-").map(Number); return `DateTime(${y},${m},${d})`; };
/** Xero dates come as "/Date(1697328000000+0000)/" or "2026-10-14T00:00:00". */
const ymdOf = (v: any): string | null => {
  const ms = String(v || "").match(/\/Date\((\d+)/)?.[1];
  if (ms) return new Date(Number(ms)).toISOString().slice(0, 10);
  const iso = String(v || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : null;
};
const lineExGst = (doc: any, l: any) => {
  const amt = Number(l.LineAmount) || 0;
  return doc.LineAmountTypes === "Inclusive" ? amt - (Number(l.TaxAmount) || 0) : amt;
};

/** Cost of goods per day (ex GST) between two dates, inclusive. */
export interface CogsDoc {
  id: string; kind: "bill" | "credit"; date: string; contact: string; number: string | null; status: string;
  amount: number;                         // cost-of-goods part, ex GST (negative for credits)
  byAccount: Record<string, number>;
}
export interface CogsResult { byDay: Record<string, number>; bills: number; docs: CogsDoc[] }

// One at a time: Reports can ask for 13 periods at once and Xero allows 5 calls in parallel
let cogsQueue: Promise<any> = Promise.resolve();
export function xeroCostOfGoods(from: string, to: string, codes: string[]): Promise<CogsResult> {
  const run = cogsQueue.then(() => costOfGoodsNow(from, to, codes));
  cogsQueue = run.catch(() => {});
  return run;
}
async function costOfGoodsNow(from: string, to: string, codes: string[]): Promise<CogsResult> {
  const want = new Set(codes);
  const byDay: Record<string, number> = {};
  let bills = 0;
  const docs: CogsDoc[] = [];
  const add = (doc: any, sign: number) => {
    const day = ymdOf(doc.DateString || doc.Date);
    if (!day) return;
    let total = 0;
    const byAccount: Record<string, number> = {};
    for (const l of doc.LineItems || []) {
      if (!l.AccountCode || !want.has(String(l.AccountCode))) continue;
      const amt = lineExGst(doc, l);
      total += amt;
      byAccount[String(l.AccountCode)] = (byAccount[String(l.AccountCode)] || 0) + sign * amt;
    }
    if (!total) return;
    byDay[day] = (byDay[day] || 0) + sign * total;
    bills++;
    docs.push({
      id: String(doc.InvoiceID || doc.CreditNoteID || ""), kind: sign > 0 ? "bill" : "credit", date: day,
      contact: String(doc.Contact?.Name || "Unknown"), number: doc.InvoiceNumber || doc.CreditNoteNumber || null,
      status: String(doc.Status || ""), amount: Math.round(sign * total * 100) / 100, byAccount,
    });
  };
  const range = `Date>=${xeroDateTime(from)}&&Date<=${xeroDateTime(to)}`;
  for (let page = 1; page <= 50; page++) {
    const where = encodeURIComponent(`Type=="ACCPAY"&&${range}`);
    const resp = await xeroGet(`/Invoices?where=${where}&Statuses=DRAFT,SUBMITTED,AUTHORISED,PAID&page=${page}`);
    if (!resp.ok) throw new Error(`Xero bills returned ${resp.status}`);
    const list: any[] = ((await resp.json()) as any).Invoices || [];
    for (const b of list) add(b, 1);
    if (list.length < 100) break;
  }
  for (let page = 1; page <= 20; page++) {
    const where = encodeURIComponent(`Type=="ACCPAYCREDIT"&&${range}&&(Status=="AUTHORISED"||Status=="PAID"||Status=="SUBMITTED"||Status=="DRAFT")`);
    const resp = await xeroGet(`/CreditNotes?where=${where}&page=${page}`);
    if (!resp.ok) throw new Error(`Xero credit notes returned ${resp.status}`);
    const list: any[] = ((await resp.json()) as any).CreditNotes || [];
    for (const c of list) add(c, -1);
    if (list.length < 100) break;
  }
  return { byDay, bills, docs };
}

// ─── Sync ────────────────────────────────────────────────────────────────────
let syncRunning = false;

export interface SyncResult {
  checked: number;
  pulledIn: { xeroInvoiceId: string; supplier: string; number: string | null; invoiceId: number }[];
  noDocument: { supplier: string; number: string | null }[];
  otherContacts: { xeroInvoiceId: string; contact: string; number: string | null; date: string | null; total: number | null }[];
}

const xeroDate = (s: any): string | null => {
  if (!s) return null;
  const m = String(s).match(/\/Date\((\d+)/);
  if (m) return new Date(Number(m[1])).toISOString().slice(0, 10);
  return String(s).slice(0, 10);
};

/** Download a bill's first readable attachment and send it to the reader. */
async function pullInBill(bill: any, supplierId: number | null): Promise<{ invoiceId: number } | { noDocument: true }> {
  const listResp = await xeroGet(`/Invoices/${bill.InvoiceID}/Attachments`);
  const list: any = await listResp.json().catch(() => ({}));
  const att = (list.Attachments || []).find((a: any) => READABLE.includes(mimeFromName(a.FileName || "", a.MimeType)));
  if (!att) return { noDocument: true };
  const fileResp = await xeroGet(att.Url, att.MimeType || "application/octet-stream");
  if (!fileResp.ok) throw new Error(`Couldn't download ${att.FileName} from Xero (${fileResp.status})`);
  const data = Buffer.from(await fileResp.arrayBuffer());
  const r = await ingestInvoiceFile({
    data, fileName: att.FileName || `${bill.InvoiceNumber || bill.InvoiceID}.pdf`, mime: mimeFromName(att.FileName || "", att.MimeType),
    source: "xero", xeroInvoiceId: bill.InvoiceID, uploadedBy: "Xero",
    autoRead: false, // stored unread; Scott previews it and presses Read if it matters
    supplierId,
    xero: { contactName: bill.Contact?.Name ?? null, number: bill.InvoiceNumber || null, date: xeroDate(bill.DateString || bill.Date), total: bill.Total ?? null },
  });
  return { invoiceId: r.id };
}

export async function syncXero(opts: { since?: string } = {}): Promise<SyncResult> {
  if (syncRunning) throw new Error("A Xero check is already running");
  syncRunning = true;
  const result: SyncResult = { checked: 0, pulledIn: [], noDocument: [], otherContacts: [] };
  try {
    const conn = await getConnection();
    if (!conn?.tenant_id) throw new Error("Xero isn't connected");
    const fromDate = opts.since || conn.sync_from || new Date(Date.now() - 14 * 86400_000).toISOString().slice(0, 10);
    // Changed since the last check (a day of overlap), or everything since the start date on the first run.
    const modifiedSince = conn.last_sync_at ? new Date(new Date(conn.last_sync_at).getTime() - 86400_000) : new Date(`${fromDate}T00:00:00Z`);

    const { data: suppliers } = await supabase.from("suppliers").select("id, name, abn, our_account_number, name_aliases, xero_contact_id");
    const { data: known } = await supabase.from("supplier_invoices").select("xero_invoice_id").not("xero_invoice_id", "is", null);
    const seen = new Set((known || []).map((k: any) => k.xero_invoice_id));

    const where = encodeURIComponent(`Type=="ACCPAY" AND Status!="DELETED" AND Status!="VOIDED"`);
    for (let page = 1; page <= 20; page++) {
      const resp = await xeroGet(`/Invoices?where=${where}&order=UpdatedDateUTC&page=${page}`, "application/json", { "If-Modified-Since": modifiedSince.toUTCString() });
      if (resp.status === 304) break;
      if (!resp.ok) throw new Error(`Xero returned ${resp.status} when listing bills`);
      const json: any = await resp.json();
      const bills: any[] = json.Invoices || [];
      for (const bill of bills) {
        result.checked++;
        const date = xeroDate(bill.DateString || bill.Date);
        if (seen.has(bill.InvoiceID) || (date && date < fromDate)) continue;
        const contact = bill.Contact?.Name || "";
        const byContactId = (suppliers || []).find((s: any) => s.xero_contact_id && s.xero_contact_id === bill.Contact?.ContactID);
        const supplierId = byContactId?.id ?? matchSupplier({ supplier_name: contact, supplier_abn: null, our_account_number: null }, suppliers || []).supplierId;
        if (!supplierId) {
          result.otherContacts.push({ xeroInvoiceId: bill.InvoiceID, contact, number: bill.InvoiceNumber || null, date, total: bill.Total ?? null });
          continue;
        }
        if (!byContactId && bill.Contact?.ContactID) {
          await supabase.from("suppliers").update({ xero_contact_id: bill.Contact.ContactID }).eq("id", supplierId).is("xero_contact_id", null);
        }
        if (!bill.HasAttachments) { result.noDocument.push({ supplier: contact, number: bill.InvoiceNumber || null }); continue; }
        const r = await pullInBill(bill, supplierId);
        if ("noDocument" in r) result.noDocument.push({ supplier: contact, number: bill.InvoiceNumber || null });
        else result.pulledIn.push({ xeroInvoiceId: bill.InvoiceID, supplier: contact, number: bill.InvoiceNumber || null, invoiceId: r.invoiceId });
        seen.add(bill.InvoiceID);
        await sleep(1100); // stay well under Xero's 60 calls a minute
      }
      if (bills.length < 100) break;
    }

    const note = `${result.pulledIn.length} pulled in, ${result.noDocument.length} without a document, ${result.otherContacts.length} from other contacts`;
    await supabase.from("xero_connection").update({ last_sync_at: new Date().toISOString(), last_sync_note: note, sync_from: fromDate }).eq("id", 1);
    // Keep the "other contacts" list for the page (small, replaced each run)
    await supabase.from("settings").upsert({ key: "xero_other_bills", value: JSON.stringify(result.otherContacts.slice(0, 200)) }, { onConflict: "key" });
    return result;
  } finally {
    syncRunning = false;
  }
}

// ─── Routes ──────────────────────────────────────────────────────────────────
export function registerXeroRoutes(app: Express) {
  app.get("/api/xero-connection/status", requireInvoiceAccess, asyncRoute(async (_req: any, res: any) => {
    const conn = canKeepTokens() ? await getConnection() : null;
    const { data: other } = await supabase.from("settings").select("value").eq("key", "xero_other_bills").maybeSingle();
    let otherBills: any[] = [];
    try { otherBills = JSON.parse(other?.value || "[]"); } catch {}
    res.json({
      configured: configured(), tokensStorable: canKeepTokens(), redirectUri: cfg().redirectUri,
      connected: !!conn?.refresh_token, tenantName: conn?.tenant_name ?? null, connectedBy: conn?.connected_by ?? null,
      lastSyncAt: conn?.last_sync_at ?? null, lastSyncNote: conn?.last_sync_note ?? null, syncFrom: conn?.sync_from ?? null,
      syncing: syncRunning, otherBills,
    });
  }));

  // Start sign-in: send the browser to Xero
  app.get("/api/xero-connection/connect", requireInvoiceAccess, asyncRoute(async (req: any, res: any) => {
    if (!configured()) return res.status(400).send("Xero isn't set up yet: add XERO_CLIENT_ID and XERO_CLIENT_SECRET on Railway.");
    if (!canKeepTokens()) return res.status(400).send("Add SUPABASE_SERVICE_ROLE_KEY on Railway first so the Xero sign-in can be stored securely.");
    const state = crypto.randomBytes(16).toString("hex");
    req.session.xeroState = state;
    const url = `${AUTH_URL}?${new URLSearchParams({ response_type: "code", client_id: cfg().clientId, redirect_uri: cfg().redirectUri, scope: SCOPES, state })}`;
    res.redirect(url);
  }));

  // Xero sends the browser back here
  app.get("/api/xero-connection/callback", requireInvoiceAccess, asyncRoute(async (req: any, res: any) => {
    // Query goes before the # so the page route still matches (the app uses hash routing)
    const back = (q: string) => res.redirect(`/?${q}#/supplier-invoices`);
    if (req.query.error) return back(`xero=error&message=${encodeURIComponent(String(req.query.error_description || req.query.error))}`);
    if (!req.query.state || req.query.state !== req.session.xeroState) return back("xero=error&message=Sign-in%20expired%2C%20please%20try%20again");
    delete req.session.xeroState;
    const t = await tokenRequest({ grant_type: "authorization_code", code: String(req.query.code || ""), redirect_uri: cfg().redirectUri });
    const connResp = await fetch("https://api.xero.com/connections", { headers: { Authorization: `Bearer ${t.access_token}`, Accept: "application/json" } });
    const tenants: any[] = await connResp.json().catch(() => []);
    const org = tenants.find((x) => x.tenantType === "ORGANISATION") || tenants[0];
    if (!org) return back("xero=error&message=No%20Xero%20organisation%20was%20shared");
    const existing = await getConnection();
    const { error } = await supabase.from("xero_connection").upsert({
      id: 1, tenant_id: org.tenantId, tenant_name: org.tenantName, access_token: t.access_token, refresh_token: t.refresh_token,
      expires_at: new Date(Date.now() + t.expires_in * 1000).toISOString(), scopes: t.scope || SCOPES,
      connected_by: req.staffName || null, connected_at: new Date().toISOString(),
      sync_from: existing?.sync_from || new Date(Date.now() - 14 * 86400_000).toISOString().slice(0, 10),
    });
    if (error) return back(`xero=error&message=${encodeURIComponent(error.message)}`);
    back("xero=connected");
  }));

  app.post("/api/xero-connection/disconnect", requireInvoiceAccess, asyncRoute(async (_req: any, res: any) => {
    const conn = await getConnection();
    if (conn?.refresh_token && configured()) {
      // Tell Xero to drop the sign-in too (best effort)
      fetch("https://identity.xero.com/connect/revocation", {
        method: "POST",
        headers: { Authorization: "Basic " + Buffer.from(`${cfg().clientId}:${cfg().clientSecret}`).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: conn.refresh_token }).toString(),
      }).catch(() => {});
    }
    await supabase.from("xero_connection").update({ access_token: null, refresh_token: null, expires_at: null, tenant_id: null }).eq("id", 1);
    res.json({ ok: true });
  }));

  // Check Xero now. Optional body { since: "YYYY-MM-DD" } to go further back.
  app.post("/api/xero-connection/sync", requireInvoiceAccess, asyncRoute(async (req: any, res: any) => {
    const since = typeof req.body?.since === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.body.since) ? req.body.since : undefined;
    if (since) await supabase.from("xero_connection").update({ sync_from: since, last_sync_at: null }).eq("id", 1);
    res.json(await syncXero({ since }));
  }));

  // Pull in one bill from a contact that isn't a known supplier
  app.post("/api/xero-connection/pull/:xeroInvoiceId", requireInvoiceAccess, asyncRoute(async (req: any, res: any) => {
    const id = String(req.params.xeroInvoiceId);
    const { data: exists } = await supabase.from("supplier_invoices").select("id").eq("xero_invoice_id", id).maybeSingle();
    if (exists) return res.json({ invoiceId: exists.id, already: true });
    const resp = await xeroGet(`/Invoices/${encodeURIComponent(id)}`);
    if (!resp.ok) return res.status(404).json({ error: "Bill not found in Xero" });
    const bill = ((await resp.json()) as any).Invoices?.[0];
    const r = await pullInBill(bill, null);
    if ("noDocument" in r) return res.status(400).json({ error: "This bill has no document attached in Xero. Upload it by hand instead." });
    res.json(r);
  }));

  // Hourly background check while connected
  setInterval(async () => {
    try {
      if (!configured() || !canKeepTokens()) return;
      const conn = await getConnection();
      if (!conn?.refresh_token) return;
      const r = await syncXero();
      if (r.pulledIn.length) console.log(`[xero] hourly check pulled in ${r.pulledIn.length} bill(s)`);
    } catch (e: any) {
      console.error("[xero] hourly check failed:", e?.message || e);
      await supabase.from("xero_connection").update({ last_sync_note: `Last check failed: ${e?.message || e}` }).eq("id", 1);
    }
  }, 60 * 60 * 1000);
}
