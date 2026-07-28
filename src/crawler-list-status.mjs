// Isolate-memory, best-effort — same convention as sn-provenance's
// /_sn/status lastCron: resets on eviction/deploy, "if available" data, not
// a durable log. The durable trail is Workers Logs (console.error on drift
// or failure, from runAndRecordCrawlerListCheck()).
//
// v1.4.1: because the store is isolate memory, a deploy or eviction used to
// leave the plugin's "Crawler list" pill on "unchecked" until the next
// Monday cron. The status endpoint now LAZILY SELF-HEALS: when its stored
// result is missing, failed, or stale, it kicks one background re-check via
// ctx.waitUntil (throttled per isolate — the URL is public, so the outbound
// docs fetch must be rate-bound) and still answers immediately with the
// current state. The caller's next poll sees the healed result.
import { checkCrawlerListDrift } from "./crawler-list-sync.mjs";

let lastCheck = null;
let lastAttemptMs = 0;

// A successful check older than this is stale enough to redo — 8 days
// tolerates one missed Monday cron without churning between them.
const STALE_MS = 8 * 24 * 60 * 60 * 1000;
// Per-isolate floor between attempts, whatever the outcome.
const ATTEMPT_MIN_MS = 10 * 60 * 1000;

export function recordCrawlerListCheck(result) {
  lastCheck = result;
}

// Pure decision: heal when there is no result, the last one failed, its
// timestamp is unparseable, or it is stale — never inside the throttle
// window. ok:false is deliberately heal-eligible: a transient docs blip
// must not pin "check failed" for a week.
export function shouldSelfHeal(check, nowMs, attemptMs) {
  if (nowMs - attemptMs < ATTEMPT_MIN_MS) return false;
  if (!check || !check.checked_at || check.ok === false) return true;
  const age = nowMs - Date.parse(check.checked_at);
  return !(age >= 0 && age < STALE_MS); // NaN or stale → heal
}

// v1.4.3: the verdict also persists in the COLO-LOCAL Cache API, because
// isolate memory alone was not enough — the plugin polls once per 15
// minutes, long enough for the isolate to be evicted between polls, so the
// healed result could evaporate before its one consumer ever read it. The
// cache survives isolate churn; per-colo scope is fine because the plugin
// always polls from the same origin egress. Every layer is try/caught: a
// cache failure degrades to the v1.4.1 behavior, never a fatal.
const CACHE_KEY = "https://juanlentino.com/_sn/rights-signals/__crawler-check-verdict";
const CACHE_TTL_S = 14 * 24 * 60 * 60; // two cron cycles; staleness is judged by checked_at, not this

// Injectable seam: production resolves the real colo cache; tests inject a
// fake (the pool's isolated storage cannot host real Cache API writes —
// its sqlite WAL files break frame popping, observed 2026-07-28).
let cacheProvider = () => (typeof caches !== "undefined" && caches.default ? caches.default : null);

export function _setCrawlerCacheForTests(cache) {
  cacheProvider = () => cache;
}

async function readCachedCheck() {
  const cache = cacheProvider();
  if (!cache) return null;
  try {
    const hit = await cache.match(CACHE_KEY);
    return hit ? await hit.json() : null;
  } catch {
    return null;
  }
}

async function writeCachedCheck(result) {
  const cache = cacheProvider();
  if (!cache) return;
  try {
    await cache.put(CACHE_KEY, new Response(JSON.stringify(result), {
      headers: { "content-type": "application/json", "cache-control": `max-age=${CACHE_TTL_S}` },
    }));
  } catch {
    // Best-effort: memory still holds it for this isolate's lifetime.
  }
}

// The one run-and-record path, shared by the Monday cron (index.mjs
// scheduled()) and the lazy self-heal below — drift and failure keep their
// loud console.error trail either way.
export async function runAndRecordCrawlerListCheck() {
  try {
    const result = await checkCrawlerListDrift();
    if (result.drift) {
      console.error(`crawler-list-sync: DRIFT — missing=[${result.missing.join(",")}] extra=[${result.extra.join(",")}]`);
    }
    recordCrawlerListCheck({ ok: true, ...result });
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    console.error(`crawler-list-sync: check failed: ${reason}`);
    recordCrawlerListCheck({ ok: false, checked_at: new Date().toISOString(), error: reason });
  }
  await writeCachedCheck(lastCheck);
}

export async function crawlerListStatusResponse(ctx) {
  // Cold isolate: adopt the colo-cached verdict before deciding anything.
  if (null === lastCheck) {
    const cached = await readCachedCheck();
    if (cached) {
      lastCheck = cached;
    }
  }
  if (ctx && typeof ctx.waitUntil === "function" && shouldSelfHeal(lastCheck, Date.now(), lastAttemptMs)) {
    lastAttemptMs = Date.now();
    ctx.waitUntil(runAndRecordCrawlerListCheck());
  }
  const body = JSON.stringify({ worker: "sn-rights-signals", last_check: lastCheck }, null, 2);
  return new Response(body, {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export function _resetCrawlerListStateForTests() {
  lastCheck = null;
  lastAttemptMs = 0;
  cacheProvider = () => (typeof caches !== "undefined" && caches.default ? caches.default : null);
}
