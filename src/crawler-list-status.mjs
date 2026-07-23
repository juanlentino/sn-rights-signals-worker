// Isolate-memory, best-effort — same convention as sn-provenance's
// /_sn/status lastCron: resets on eviction/deploy, "if available" data, not
// a durable log. The durable trail is Workers Logs (console.error on drift
// or failure, from the scheduled() handler).
let lastCheck = null;

export function recordCrawlerListCheck(result) {
  lastCheck = result;
}

export function crawlerListStatusResponse() {
  const body = JSON.stringify({ worker: "sn-rights-signals", last_check: lastCheck }, null, 2);
  return new Response(body, {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
