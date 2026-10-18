// Taxonomy 1.6.0: vendor-published IP ranges (Perplexity, Common Crawl).
//
// A vendor that publishes the ranges its crawler uses lets a reader check a
// claimed agent the way Cloudflare's verified-bot directory does for the
// agents it lists. The sensor records ONLY the answer, as blob16
// vendor_verified: '1' the client IP is in the list, '0' the list was read and
// the IP is outside it, '' not measured. The IP is never stored, logged or
// emitted: it is read from cf-connecting-ip, compared, and dropped.
//
// FAIL CLOSED. Nothing here can make a hit look worse than unmeasured: a fetch
// failure, a non-200, junk JSON or a list with no valid prefix leaves the
// agent at '' until a later refresh succeeds. Observation stays synchronous
// (index.mjs's contract): ensureVendorRanges() schedules a refresh through
// ctx.waitUntil, and vendorVerified() only reads what is already loaded, so
// the first hits in a fresh isolate are '' rather than a wait.

import { ipRangesUrlFor } from "./taxonomy.mjs";
import { ipInCidr, parseIp } from "./cidr.mjs";

export { ipInCidr } from "./cidr.mjs";

const REFRESH_MS = 24 * 60 * 60 * 1000; // at most one fetch per list per day
const USABLE_MS = 2 * REFRESH_MS; // a list older than this is not used
const RETRY_MS = 15 * 60 * 1000; // after a failure, wait before trying again
const FETCH_TIMEOUT_MS = 3000;
const MAX_PREFIXES = 5000;

// url -> { cidrs: string[]|null, at: ms of last success, tried: ms of last attempt, busy: bool }
let lists = new Map();

// Injectable seam, as in crawler-list-status.mjs: the colo Cache API keeps a
// list across isolate churn; tests inject a fake (the pool cannot host real
// Cache API writes).
let cacheProvider = () => (typeof caches !== "undefined" && caches.default ? caches.default : null);

export function _setVendorRangesCacheForTests(cache) {
  cacheProvider = () => cache;
}

export function _resetVendorRangesForTests() {
  lists = new Map();
}

/**
 * The valid CIDR strings of a vendor list ({prefixes:[{ipv4Prefix|ipv6Prefix}]}),
 * or null when it holds none.
 *
 * @param {unknown} body Parsed JSON.
 * @returns {string[]|null}
 */
export function parseRanges(body) {
  const prefixes = Array.isArray(body?.prefixes) ? body.prefixes.slice(0, MAX_PREFIXES) : [];
  const out = prefixes.map((p) => String(p?.ipv4Prefix ?? p?.ipv6Prefix ?? "")).filter((c) => ipInCidr(c.split("/")[0], c));
  return out.length ? out : null;
}

async function refresh(url, now) {
  const cache = cacheProvider();
  const key = `https://juanlentino.com/_sn/rights-signals/__vendor-ranges?u=${encodeURIComponent(url)}`;
  try {
    const hit = cache ? await cache.match(key) : null;
    const cached = hit ? await hit.json() : null;
    if (cached && Array.isArray(cached.cidrs) && now - cached.at < REFRESH_MS) {
      lists.set(url, { cidrs: cached.cidrs, at: cached.at, tried: now, busy: false });
      return;
    }
  } catch {
    // A cache failure falls through to the fetch.
  }
  let cidrs = null;
  try {
    // Follow: this URL is the taxonomy's, never requester-chosen.
    const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    cidrs = res.ok ? parseRanges(await res.json()) : null;
  } catch {
    cidrs = null;
  }
  const prev = lists.get(url);
  if (!cidrs) {
    console.error(`[vendor-ranges] could not read ${url}; vendor_verified stays not measured`);
    lists.set(url, { cidrs: prev?.cidrs ?? null, at: prev?.at ?? 0, tried: now, busy: false });
    return;
  }
  lists.set(url, { cidrs, at: now, tried: now, busy: false });
  try {
    if (cache) {
      await cache.put(key, new Response(JSON.stringify({ cidrs, at: now }), { headers: { "content-type": "application/json", "cache-control": `max-age=${REFRESH_MS / 1000}` } }));
    }
  } catch {
    // Best-effort: memory still holds it for this isolate.
  }
}

/**
 * Schedule a refresh of the agent's list when it is absent or a day old, at
 * most one in flight per list, never sooner than RETRY_MS after a failure.
 * Does nothing for an agent with no list, or without ctx.waitUntil.
 *
 * @param {{waitUntil?:Function}} ctx Worker execution context.
 * @param {string|undefined} agentId Taxonomy entry id.
 */
export function ensureVendorRanges(ctx, agentId, now = Date.now()) {
  const url = ipRangesUrlFor(agentId);
  if (!url || typeof ctx?.waitUntil !== "function") return;
  const s = lists.get(url);
  if (s && (s.busy || now - s.at < REFRESH_MS || now - s.tried < RETRY_MS)) return;
  lists.set(url, { cidrs: s?.cidrs ?? null, at: s?.at ?? 0, tried: now, busy: true });
  ctx.waitUntil(refresh(url, now));
}

/**
 * vendor_verified for one request: '1' in range, '0' out of range, '' not
 * measured (no list for the agent, list not loaded or too old, no client IP).
 *
 * @param {Request} request
 * @param {string|undefined} agentId Taxonomy entry id.
 * @returns {"1"|"0"|""}
 */
export function vendorVerified(request, agentId, now = Date.now()) {
  const url = ipRangesUrlFor(agentId);
  const s = url ? lists.get(url) : null;
  if (!s?.cidrs || now - s.at >= USABLE_MS) return "";
  const ip = (request.headers.get("cf-connecting-ip") ?? "").trim();
  if (parseIp(ip) === null) return "";
  return s.cidrs.some((c) => ipInCidr(ip, c)) ? "1" : "0";
}
