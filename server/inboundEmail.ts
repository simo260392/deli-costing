// ─── Supplier invoices by email (markets inbox) ──────────────────────────────
// The markets inbox forwards everything to the app's Resend address. Resend posts an
// "email.received" webhook here; we check its signature, fetch the attachments and drop
// each PDF/photo into Supplier Invoices as "unread" (nothing is read, so nothing is charged,
// until Scott presses Read). Statements are kept but set aside. Emails whose invoice is
// written in the body are kept as the email itself.
//
// Railway variables: RESEND_API_KEY, RESEND_WEBHOOK_SECRET (the webhook's signing secret)
import type { Express } from "express";
import crypto from "crypto";
import supabase from "./supabase";
import { ingestInvoiceFile, matchSupplier, mimeFromName } from "./invoiceRoutes";

const API = "https://api.resend.com";
const READABLE = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"];
const STATEMENT = /\bstatement\b|\bstmt\b|account summary|remittance/i;

/** Svix-style signature check used by Resend webhooks. */
export function verifyResendSignature(rawBody: Buffer | string, headers: Record<string, any>, secret: string): boolean {
  const id = headers["svix-id"], ts = headers["svix-timestamp"], sigHeader = headers["svix-signature"];
  if (!id || !ts || !sigHeader || !secret) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 5 * 60) return false; // reject replays older than 5 minutes
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = crypto.createHmac("sha256", key).update(`${id}.${ts}.${rawBody.toString()}`).digest("base64");
  return String(sigHeader).split(" ").some((part) => {
    const sig = part.split(",")[1];
    return sig && sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  });
}

async function resendGet(path: string) {
  const resp = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` } });
  if (!resp.ok) throw new Error(`Resend ${path} returned ${resp.status}`);
  return resp.json() as Promise<any>;
}

const emailAddress = (s: any) => String(Array.isArray(s) ? s[0] : s || "").match(/<([^>]+)>/)?.[1] || String(Array.isArray(s) ? s[0] : s || "").trim();
const displayName = (s: any) => String(Array.isArray(s) ? s[0] : s || "").replace(/<[^>]+>/, "").replace(/"/g, "").trim();

/** Work out which supplier sent it: their email address/domain, then the sender's name. */
async function supplierForSender(from: string): Promise<number | null> {
  const addr = emailAddress(from).toLowerCase();
  const domain = addr.split("@")[1] || "";
  const { data: suppliers } = await supabase.from("suppliers").select("id, name, email, order_contact, abn, our_account_number, name_aliases");
  const generic = ["gmail.com", "outlook.com", "hotmail.com", "bigpond.com", "yahoo.com", "icloud.com", "live.com"];
  for (const s of suppliers || []) {
    const emails = `${s.email || ""} ${s.order_contact || ""}`.toLowerCase();
    if (addr && emails.includes(addr)) return s.id;
    if (domain && !generic.includes(domain) && emails.includes(`@${domain}`)) return s.id;
  }
  return matchSupplier({ supplier_name: displayName(from), supplier_abn: null, our_account_number: null }, suppliers || []).supplierId;
}

/** For a forwarded email ("FW: ..."), the original sender from the forwarded header in the body. */
export function forwardedSender(html: string | null, text: string | null): string | null {
  const plain = (text || (html || "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|tr|li)>/gi, "\n").replace(/<[^>]+>/g, " "))
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&nbsp;/g, " ");
  // Outlook: "From: Name <a@b>" / "From: Name [mailto:a@b]"; Gmail: "From: Name <a@b>"
  const m = plain.match(/(?:^|\n)\s*\*?From:\*?\s*([^\n]{2,200})/i);
  if (!m) return null;
  const line = m[1].replace(/\[mailto:([^\]]+)\]/i, "<$1>").trim();
  return line || null;
}

export async function handleReceivedEmail(emailId: string, hint: { from?: string; subject?: string }) {
  const email = await resendGet(`/emails/receiving/${emailId}`).catch(() => null);
  const from = email?.from || hint.from || "";
  const subject = email?.subject || hint.subject || "";
  let supplierId = await supplierForSender(from);
  // Forwarded from the markets inbox: work out the supplier from the original sender
  if (!supplierId) {
    const original = forwardedSender(email?.html || null, email?.text || null);
    if (original) supplierId = await supplierForSender(original);
  }
  const meta = { from, subject, id: emailId };
  const subjectIsStatement = STATEMENT.test(subject);

  const list = await resendGet(`/emails/receiving/${emailId}/attachments`);
  const attachments: any[] = (list?.data || []).filter((a: any) => {
    const mime = mimeFromName(a.filename || "", a.content_type);
    if (!READABLE.includes(mime)) return false;
    // Skip logos and signature images
    if (mime.startsWith("image/") && (a.content_disposition === "inline" || (a.size && a.size < 20_000))) return false;
    return true;
  });

  const results: any[] = [];
  for (const a of attachments) {
    const fileResp = await fetch(a.download_url);
    if (!fileResp.ok) { results.push({ file: a.filename, error: `download ${fileResp.status}` }); continue; }
    const data = Buffer.from(await fileResp.arrayBuffer());
    const isStatement = subjectIsStatement || STATEMENT.test(a.filename || "");
    const r = await ingestInvoiceFile({
      data, fileName: a.filename || `${emailId}.pdf`, mime: mimeFromName(a.filename || "", a.content_type),
      source: "email", autoRead: false, uploadedBy: "Email", supplierId, supplierMatchMethod: "email_sender", email: meta,
      setAside: isStatement ? { status: "ignored", documentType: "statement", note: "Statement (set aside, not read)" } : undefined,
    });
    results.push({ file: a.filename, ...r });
  }

  // No attachment: keep the email itself in case the invoice is written in the body
  if (!attachments.length) {
    const html: string | null = email?.html || null;
    const text: string | null = email?.text || null;
    if (html || text) {
      const r = await ingestInvoiceFile({
        data: Buffer.from(html || text || "", "utf8"), fileName: `${(subject || "email").replace(/[^\w\- ]+/g, "").slice(0, 60) || "email"}.html`,
        mime: html ? "text/html" : "text/plain", source: "email", autoRead: false, uploadedBy: "Email", supplierId,
        supplierMatchMethod: "email_sender", email: meta,
        setAside: subjectIsStatement ? { status: "ignored", documentType: "statement", note: "Statement (set aside, not read)" } : undefined,
      });
      results.push({ file: "email body", ...r });
    }
  }
  return results;
}

/** Process one received email and record the outcome; failures are retried by the timer below. */
async function processLogged(emailId: string, hint: { from?: string; subject?: string }) {
  const { data: row } = await supabase.from("inbound_emails").select("attempts, status").eq("email_id", emailId).maybeSingle();
  if (row?.status === "done") return;
  const attempts = (row?.attempts || 0) + 1;
  await supabase.from("inbound_emails").upsert({ email_id: emailId, email_from: hint.from ?? null, subject: hint.subject ?? null, status: "pending", attempts });
  try {
    const r = await handleReceivedEmail(emailId, hint);
    await supabase.from("inbound_emails").update({ status: "done", items_saved: r.length, last_error: null, processed_at: new Date().toISOString() }).eq("email_id", emailId);
    console.log(`[email] ${emailId}: ${r.length} item(s) saved`);
  } catch (e: any) {
    const msg = e?.message || String(e);
    await supabase.from("inbound_emails").update({ status: attempts >= 30 ? "gave_up" : "failed", last_error: msg }).eq("email_id", emailId);
    console.error(`[email] ${emailId} failed (attempt ${attempts}):`, msg);
  }
}

export function registerInboundEmailRoutes(app: Express) {
  app.post("/api/inbound-email/resend", async (req: any, res: any) => {
    const secret = process.env.RESEND_WEBHOOK_SECRET || "";
    if (!process.env.RESEND_API_KEY || !secret) return res.status(503).json({ error: "Email intake isn't set up" });
    if (!verifyResendSignature(req.rawBody || JSON.stringify(req.body), req.headers, secret)) return res.status(401).json({ error: "Bad signature" });
    const event = req.body || {};
    // Answer straight away; Resend retries if we're slow
    res.json({ ok: true });
    if (event.type !== "email.received") return;
    const emailId = event.data?.email_id || event.data?.id;
    if (!emailId) return;
    await processLogged(emailId, { from: event.data?.from, subject: event.data?.subject });
  });

  // Retry emails that failed (e.g. Resend unreachable, or the API key was wrong) every 10 minutes
  const retry = async () => {
    if (!process.env.RESEND_API_KEY) return;
    const { data: failed } = await supabase.from("inbound_emails").select("email_id, email_from, subject").in("status", ["failed", "pending"])
      .lt("received_at", new Date(Date.now() - 2 * 60_000).toISOString()).order("received_at").limit(20);
    for (const f of failed || []) await processLogged(f.email_id, { from: f.email_from || undefined, subject: f.subject || undefined });
  };
  setTimeout(() => retry().catch(() => {}), 60_000);
  setInterval(() => retry().catch((e) => console.error("[email] retry failed:", e?.message || e)), 10 * 60_000);
}
