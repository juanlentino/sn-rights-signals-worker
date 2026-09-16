// POST /_sn/rights-signals/webmcp-call — the WebMCP bridge's beacon (v1.25.0,
// bridge v2 arc one; design: signal-and-noise-tools
// docs/webmcp-bridge-v2-design.md).
//
// One row per tool call, into the machine-readers dataset as family
// `webmcp`, surface = the tool, the outcome in the purpose slot, nothing else:
// no IP, no UA, no page URL. The plugin splits the family off the reads at
// its fetch (a call is not a page read) and paints it on AI › Agent tools.
//
// ABUSE. This is the bridge's only write, so it is shaped to write nothing
// unless everything is right, and to answer 204 either way (no 4xx to
// fingerprint against): POST only; body under 256 bytes; `tool` from the
// bridge's own list; `outcome` from ok|absent|error; `ms` an integer in
// [0, 60000]; Origin the site's; `Sec-Fetch-Site: same-origin`, which a page
// script cannot forge (a forbidden header) though curl can. Each row counts
// one, never a client-supplied count, so a forger's ceiling is the edge's
// per-IP rate-limiting rule on this path, and the admin figure is labelled
// "reported by browsers": a signal for a decision, never an audit.

import { TAXONOMY_VERSION } from "./taxonomy.mjs";

export const WEBMCP_CALL_PATH = "/_sn/rights-signals/webmcp-call";
export const WEBMCP_TOOLS = Object.freeze(["verify-page", "get-rights-terms", "related-notes", "get-site-map", "get-citation"]);
export const WEBMCP_OUTCOMES = Object.freeze(["ok", "absent", "error"]);
const BODY_MAX = 256;
const SITE_ORIGIN = "https://juanlentino.com";

/**
 * Validate a beacon body. Returns {tool, outcome, ms} or null.
 * @param {unknown} data
 */
export function parseWebmcpCall(data) {
  if (!data || typeof data !== "object") return null;
  const tool = typeof data.tool === "string" ? data.tool : "";
  const outcome = typeof data.outcome === "string" ? data.outcome : "";
  const ms = Number.isInteger(data.ms) ? data.ms : NaN;
  if (!WEBMCP_TOOLS.includes(tool) || !WEBMCP_OUTCOMES.includes(outcome)) return null;
  if (!(ms >= 0 && ms <= 60000)) return null;
  return { tool, outcome, ms };
}

/**
 * Is this a browser's same-origin beacon? Origin must be the site and the
 * fetch metadata must say same-origin (browsers send both on sendBeacon).
 * @param {Request} request
 */
export function isSameOriginBeacon(request) {
  const origin = request.headers.get("origin") || "";
  const site = request.headers.get("sec-fetch-site") || "";
  return origin === SITE_ORIGIN && site === "same-origin";
}

/**
 * The route. Always 204 with no body; writes only on a valid, same-origin,
 * well-shaped POST.
 * @param {Request} request
 * @param {{SN_MR?: {writeDataPoint: Function}}} env
 * @returns {Promise<Response>}
 */
export async function webmcpCallResponse(request, env) {
  const noContent = () => new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
  if (request.method !== "POST") return noContent();
  if (!isSameOriginBeacon(request)) return noContent();
  const len = Number(request.headers.get("content-length") || 0);
  if (len > BODY_MAX) return noContent();
  let text;
  try {
    text = await request.text();
  } catch {
    return noContent();
  }
  if (text.length > BODY_MAX) return noContent();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return noContent();
  }
  const call = parseWebmcpCall(data);
  if (!call) return noContent();
  const bound = !!(env && env.SN_MR && typeof env.SN_MR.writeDataPoint === "function");
  if (!bound) return noContent();
  // The aggregate row shape (src/machine-readers.mjs): blob1 family, blob2
  // surface, blob3 vendor, blob4 purpose, blob5 taxonomy version, the rest
  // empty or their "no" value. The outcome rides the purpose slot; the
  // plugin's split reads family/surface/purpose, nothing else.
  env.SN_MR.writeDataPoint({
    blobs: ["webmcp", call.tool, "", call.outcome, TAXONOMY_VERSION, "0", "1", "", "", "0", ""],
    doubles: [1],
    indexes: ["webmcp"],
  });
  return noContent();
}
