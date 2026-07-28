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
}

export function crawlerListStatusResponse(ctx) {
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
}
