// Machine-readership sensor (v1.4.0) — the edge half of the plugin's v10.0.0
// Machine Readers surface. AI crawlers do not execute JavaScript, so the
// beacon-based analytics pipeline is structurally blind to them; this Worker
// already intercepts every zone request, so it is the observation point.
//
// Privacy/security contract (scope doc §2.5a, load-bearing):
//   - The raw User-Agent NEVER leaves this module: classification is into the
//     FIXED enum below, and anything unmatched-but-automated buckets as
//     "other-bot" (a name from the enum, never an attacker-controlled string).
//     That kills the stored-XSS-into-admin pipeline by construction.
//   - Aggregate-only writes: family + surface class, one count. No IPs, no
//     paths beyond the coarse surface class, no per-visitor anything.
//   - Humans (browser UAs) are never recorded here — human readership is the
//     beacon pipeline's; the two are separate and never summed.
//   - Observation must never affect a response: observeMachineReader() is
//     fully try/catch'd and returns null on any failure.

/**
 * Fixed classification enum, first match wins — SPECIFIC families before the
 * generic buckets (applebot-extended must precede the plain applebot in
 * "search"; google-extended/googleother are AI fetchers, googlebot is search).
 * Maintained by hand like NAMED_CRAWLERS; extend with a named family rather
 * than widening a regex.
 */
export const MACHINE_FAMILIES = [
  ["openai", /gptbot|oai-searchbot|chatgpt-user/i],
  ["anthropic", /claudebot|claude-web|claude-user/i],
  ["google-ai", /google-extended|googleother/i],
  ["perplexity", /perplexitybot|perplexity-user/i],
  ["commoncrawl", /ccbot/i],
  ["bytedance", /bytespider/i],
  ["amazon-ai", /amazonbot/i],
  ["apple-ai", /applebot-extended/i],
  ["meta-ai", /meta-external(agent|fetcher)|facebookbot/i],
  ["mistral", /mistralai/i],
  ["cohere", /cohere/i],
  ["allen-ai", /ai2bot/i],
  ["diffbot", /diffbot/i],
  ["search", /googlebot|bingbot|duckduckbot|applebot|yandex|baiduspider|seznambot/i],
  ["seo", /ahrefsbot|semrushbot|mj12bot|dotbot|petalbot/i],
  ["feed", /feedly|feedbin|inoreader|newsblur|feedfetcher|miniflux|freshrss|tiny tiny rss|rssowl/i],
  ["uptime", /uptimerobot|better\s?stack|betteruptime|pingdom|statuscake/i],
  [
    "other-bot",
    /bot[\s\/;)]|bot$|crawler|spider|scraper|curl\/|wget\/|python-requests|go-http-client|httpie|node-fetch|axios\/|http\.rb\/|java\//i,
  ],
];

/**
 * @param {string|null|undefined} ua Raw User-Agent header value.
 * @returns {string|null} Family name from the enum, or null for humans/empty
 *   (not recorded — the beacon pipeline owns human readership).
 */
export function classifyMachineReader(ua) {
  const s = typeof ua === "string" ? ua : "";
  if (s === "") return null;
  for (const [family, re] of MACHINE_FAMILIES) {
    if (re.test(s)) return family;
  }
  return null;
}

/** Fixed surface-class enum — coarse on purpose (no full paths stored). */
export function classifySurface(pathname) {
  const p = String(pathname || "/");
  if (p === "/robots.txt") return "robots";
  if (p === "/.well-known/tdmrep.json" || p === "/license.xml" || p === "/tdm-policy" || p === "/tdm-policy/") return "rights";
  if (p === "/llms.txt" || p === "/llms-full.txt") return "llms";
  if (p === "/.well-known/agents.json") return "agents-manifest";
  if (p.startsWith("/.well-known/")) return "well-known";
  if (p === "/feed" || p === "/feed/" || p.startsWith("/feed/") || p.endsWith("/feed/")) return "feed";
  if (p === "/wp-json" || p.startsWith("/wp-json/")) return "wp-json";
  if (p.includes("sitemap")) return "sitemap";
  if (p.startsWith("/wp-content/") || p.startsWith("/wp-includes/")) return "asset";
  return "html";
}

// Sensor-alive state — isolate-memory, best-effort, same convention as
// crawler-list-status's lastCheck: resets on eviction/deploy, "if available"
// data, not a durable log. Exists because the fail-open contract above cuts
// both ways: a dropped SN_MR binding used to make the dataset simply go
// quiet, indistinguishable from "no crawlers came". The state (surfaced on
// /_sn/rights-signals/version) plus the console.error trail below make
// "sensor dead" and "site unvisited" different answers.
//   ae_bound      — whether SN_MR was usable on the LAST observe attempt
//                   (null until the first attempt; the version endpoint also
//                   reflects the binding live from env, so it never waits).
//   last_write_ok — outcome of the last actual write attempt.
//   last_write_at — timestamp of the last SUCCESSFUL write.
//   last_error    — last failure message, LOG/MEMORY ONLY: never serialized
//                   into a response (the getter's copy is for callers that
//                   know the contract; version.mjs deliberately omits it).
const sensorState = { ae_bound: null, last_write_ok: null, last_write_at: null, last_error: null };

/** @returns {{ae_bound:boolean|null, last_write_ok:boolean|null, last_write_at:string|null, last_error:string|null}} */
export function getSensorState() {
  return { ...sensorState };
}

// Injectable seam for tests only — module state persists across cases within
// a pool isolate (same reason crawler-list-status exposes _setCrawlerCacheForTests).
export function _resetSensorStateForTests() {
  sensorState.ae_bound = null;
  sensorState.last_write_ok = null;
  sensorState.last_write_at = null;
  sensorState.last_error = null;
}

/**
 * Observe one request. Aggregate-only, fire-and-forget, never throws, never
 * blocks or alters the response path. Failures stay fail-open (return null)
 * but are no longer silent: they update sensorState and console.error.
 *
 * @returns {{family:string, surface:string}|null} What was recorded, or null.
 */
export function observeMachineReader(request, env, pathname) {
  try {
    const bound = !!(env && env.SN_MR && typeof env.SN_MR.writeDataPoint === "function");
    sensorState.ae_bound = bound;
    if (!bound) {
      sensorState.last_error = "SN_MR binding missing or unusable";
      console.error(`[machine-readers] observe skipped: ${sensorState.last_error}`);
      return null;
    }
    const family = classifyMachineReader(request.headers.get("user-agent"));
    if (family === null) return null; // human/empty UA — not a write attempt
    const surface = classifySurface(pathname);
    env.SN_MR.writeDataPoint({ blobs: [family, surface], doubles: [1], indexes: [family] });
    sensorState.last_write_ok = true;
    sensorState.last_write_at = new Date().toISOString();
    sensorState.last_error = null;
    return { family, surface };
  } catch (err) {
    sensorState.last_write_ok = false;
    sensorState.last_error = err && err.message ? err.message : String(err);
    console.error(`[machine-readers] AE write failed: ${sensorState.last_error}`);
    return null;
  }
}

const DAYS_MIN = 1;
const DAYS_MAX = 90;
const DAYS_DEFAULT = 30;

/**
 * Token-auth read path for the plugin (analytics-worker pattern): Bearer token
 * gate, then the Analytics Engine SQL API, sampled counts read via
 * sum(_sample_interval). Secrets (set at deploy, never in repo):
 *   SN_MR_READ_TOKEN — the bearer the plugin presents.
 *   SN_MR_SQL_TOKEN  — a Cloudflare API token with Analytics Engine read.
 *   CF_ACCOUNT_ID    — account id for the SQL API URL (a var, not a secret).
 */
export async function machineReadersResponse(request, env) {
  const json = (status, body) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });

  const expected = env && env.SN_MR_READ_TOKEN;
  if (!expected) return json(503, { error: "not_configured" });
  const auth = request.headers.get("authorization") || "";
  if (auth !== `Bearer ${expected}`) return json(401, { error: "unauthorized" });

  if (!env.CF_ACCOUNT_ID || !env.SN_MR_SQL_TOKEN) return json(503, { error: "not_configured" });

  const url = new URL(request.url);
  const raw = parseInt(url.searchParams.get("days") || "", 10);
  const days = Number.isFinite(raw) ? Math.min(DAYS_MAX, Math.max(DAYS_MIN, raw)) : DAYS_DEFAULT;

  // days is clamped to a small integer above — never string-interpolated user input.
  const query =
    "SELECT blob1 AS family, blob2 AS surface, toDate(timestamp) AS day, " +
    "sum(_sample_interval) AS hits FROM sn_machine_readers " +
    `WHERE timestamp > NOW() - INTERVAL '${days}' DAY ` +
    "GROUP BY family, surface, day ORDER BY day ASC FORMAT JSON";

  try {
    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/analytics_engine/sql`, {
      method: "POST",
      headers: { authorization: `Bearer ${env.SN_MR_SQL_TOKEN}` },
      body: query,
    });
    if (!res.ok) return json(502, { error: "upstream", status: res.status });
    const data = await res.json();
    return json(200, { worker: "sn-rights-signals", days, data: data.data || [] });
  } catch {
    return json(502, { error: "upstream" });
  }
}
