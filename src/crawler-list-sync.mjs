import { NAMED_CRAWLERS } from "./robots-block.mjs";

const DOCS_URL = "https://developers.cloudflare.com/bots/additional-configurations/managed-robots-txt/";
const FETCH_TIMEOUT_MS = 10000;

// Cloudflare's own docs page embeds the exact "managed robots.txt" example
// this feature serves — the same text NAMED_CRAWLERS was seeded from. The
// live page renders that example as a syntax-highlighted code block (each
// line wrapped in its own nested <span>s), so tags are stripped first —
// verified against the real page 2026-07-23: without this, tag noise
// between "User-agent: X" and "Disallow: /" on separate lines defeats a
// naive regex entirely (0 matches). Pull every "User-agent: X ... Disallow:
// /" pair out of the cleaned text (excluding the wildcard block) as the
// ground truth to diff our hand-maintained list against. Fragile by nature
// (scrapes prose docs, not an API — none exists).
export function parseCrawlersFromDocs(html) {
  const text = html.replace(/<[^>]+>/g, "");
  const matches = [...text.matchAll(/User-agent:\s*([A-Za-z0-9_.-]+)\s*\n\s*Disallow:\s*\//g)];
  return [...new Set(matches.map((m) => m[1]).filter((name) => name !== "*"))].sort();
}

// { checked_at, drift, missing[] (Cloudflare added, we don't have),
// Deliberate divergences from Cloudflare's docs example, each with its
// review verdict — subtracted from `extra` before drift is computed, so a
// RECONCILED delta stops warning while anything new still does. The check's
// job is "prompt a review"; once reviewed, the verdict lives here where the
// next reviewer sees it.
export const REVIEWED_EXTRAS = {
  CloudflareBrowserRenderingCrawler:
    "kept deliberately (reviewed 2026-07-28): Cloudflare dropped it from the managed-robots.txt docs example, but the Browser Rendering crawler still exists and blocking it matches the site's restrictive rights posture (ai-train=no, TDM reservation).",
};

//   extra[] (we have, Cloudflare no longer lists, UNREVIEWED),
//   reviewed_extra[] (we have, Cloudflare no longer lists, deliberate) }
export async function checkCrawlerListDrift() {
  const res = await fetch(DOCS_URL, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { "User-Agent": "sn-rights-signals/1.0 (crawler-list-sync; +https://juanlentino.com)" },
  });
  if (!res.ok) throw new Error(`docs fetch -> ${res.status}`);
  const live = parseCrawlersFromDocs(await res.text());
  // A near-empty parse is far more likely a docs-page redesign breaking the
  // scrape than Cloudflare actually removing every crawler — surface that
  // distinctly instead of reporting it as "extra: all 9 crawlers removed",
  // which would look like real drift and could prompt editing the wrong list.
  if (live.length < 3) {
    throw new Error(`parsed suspiciously few crawlers (${live.length}) — docs page likely changed shape, check parseCrawlersFromDocs`);
  }
  const known = [...NAMED_CRAWLERS].sort();
  const missing = live.filter((c) => !known.includes(c));
  const extra_all = known.filter((c) => !live.includes(c));
  const extra = extra_all.filter((c) => !(c in REVIEWED_EXTRAS));
  const reviewed_extra = extra_all.filter((c) => c in REVIEWED_EXTRAS);
  return {
    checked_at: new Date().toISOString(),
    live_count: live.length,
    known_count: known.length,
    missing,
    extra,
    reviewed_extra,
    drift: missing.length > 0 || extra.length > 0,
  };
}
