import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// READ-ONLY relay from the Deli App to Flex Catering (Railway's IPs are blocked
// by Flex's Cloudflare, so requests go via this Supabase Edge Function).
// Only GET requests to /api/v1/... are forwarded; anything that could change
// data on Flex (POST/PUT/PATCH/DELETE) is refused.
//
// Secrets: set FLEX_PROXY_SECRET as a Supabase function secret. The Flex API
// key is sent by the Railway app in the x-flex-token header (or FLEX_API_TOKEN
// as a Supabase function secret). Never hard-code keys in this file.

const FLEX_BASE = "https://the-deli.com.au";
const INTERNAL_SECRET = Deno.env.get("FLEX_PROXY_SECRET") ?? "";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (!INTERNAL_SECRET || req.headers.get("x-proxy-secret") !== INTERNAL_SECRET) {
    return json(401, { error: "Unauthorized" });
  }
  if (req.method !== "GET") {
    return json(403, { error: "Flex Catering is read-only from the Deli App" });
  }

  const flexPath = new URL(req.url).searchParams.get("path") || "";
  if (!flexPath.startsWith("/api/v1/")) {
    return json(400, { error: "Invalid path" });
  }

  const token = req.headers.get("x-flex-token") || Deno.env.get("FLEX_API_TOKEN") || "";
  if (!token) return json(500, { error: "Flex API token not configured" });

  const flexRes = await fetch(`${FLEX_BASE}${flexPath}`, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${token}`,
      "X-API-KEY": token,
      "Accept": "application/json",
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Referer": "https://the-deli.com.au/",
      "Origin": "https://the-deli.com.au",
    },
  });

  return new Response(await flexRes.text(), {
    status: flexRes.status,
    headers: { "Content-Type": flexRes.headers.get("content-type") || "application/json" },
  });
});
