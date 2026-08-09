import { LICENSE_URL, CONTENT_SIGNAL, TDM_POLICY_URL } from "./constants.mjs";

// Full ownership of the managed-content-signals block. Wired into
// robots.mjs as of v1.2.0 (2026-07-23) — the owner disabled Cloudflare's
// "Managed robots.txt" dashboard feature, which is the only thing that made
// this safe (see robots.mjs for why a Worker can never detect that state
// itself). NAMED_CRAWLERS is a hand-maintained snapshot of Cloudflare's own
// managed default as of 2026-07-23 — crawler-list-sync.mjs periodically
// diffs it against Cloudflare's published docs and reports drift.
export const NAMED_CRAWLERS = [
  "Amazonbot",
  "Applebot-Extended",
  "Bytespider",
  "CCBot",
  "ClaudeBot",
  "CloudflareBrowserRenderingCrawler",
  "Google-Extended",
  "GPTBot",
  "meta-externalagent",
];

const CRAWLER_BLOCKS = NAMED_CRAWLERS.map((name) => `User-agent: ${name}\nDisallow: /`).join("\n\n");

export const OWNED_ROBOTS_HEADER = `# As a condition of accessing this website, you agree to abide by the following
# content signals:

# (a)  If a Content-Signal = yes, you may collect content for the corresponding
#      use.
# (b)  If a Content-Signal = no, you may not collect content for the
#      corresponding use.
# (c)  If the website operator does not include a Content-Signal for a
#      corresponding use, the website operator neither grants nor restricts
#      permission via Content-Signal with respect to the corresponding use.

# The content signals and their meanings are:

# search:   building a search index and providing search results (e.g., returning
#           hyperlinks and short excerpts from your website's contents). Search does not
#           include providing AI-generated search summaries.
# ai-input: inputting content into one or more AI models (e.g., retrieval
#           augmented generation, grounding, or other real-time taking of content for
#           generative AI search answers).
# ai-train: training or fine-tuning AI models.

# ANY RESTRICTIONS EXPRESSED VIA CONTENT SIGNALS ARE EXPRESS RESERVATIONS OF
# RIGHTS UNDER ARTICLE 4 OF THE EUROPEAN UNION DIRECTIVE 2019/790 ON COPYRIGHT
# AND RELATED RIGHTS IN THE DIGITAL SINGLE MARKET.

# ---------------------------------------------------------------------------
# NON-NORMATIVE LOCAL EXTENSION: use=reference
#
# The Content-Signal line below carries a fourth term, "use", after the three
# standard terms above. "use" is NOT part of the Cloudflare Content Signals
# vocabulary. It is a locally-defined hint, published by this site only, that
# content taken under ai-input is expected to be referenced and cited rather
# than reproduced whole.
#
# It is NOT load-bearing. No permission on this site is granted, withheld, or
# conditioned by it, and a parser that does not recognise "use" loses nothing
# by ignoring the term. Per signal (c) above, a use for which no recognised
# Content-Signal is expressed is neither granted nor restricted by this line.
#
# The operative statement of the same expectation is section 3 of the policy
# at ${TDM_POLICY_URL}
# ---------------------------------------------------------------------------

# BEGIN Signal & Noise rights signals

User-agent: *
Content-Signal: ${CONTENT_SIGNAL}
Allow: /

${CRAWLER_BLOCKS}

# END Signal & Noise rights signals`;

// The marker Cloudflare's OWN managed block ends with, live as of
// 2026-07-23. Defensive only: strips a leftover Cloudflare block out of the
// origin fetch in case the dashboard toggle is ever re-enabled by mistake
// (see robots.mjs for why that alone wouldn't be sufficient — revert to
// appendLicenseOnly if that ever happens).
const CLOUDFLARE_END_MARKER = "# END Cloudflare Managed Content";

export function originTail(fetchedText) {
  const idx = fetchedText.indexOf(CLOUDFLARE_END_MARKER);
  const tail = idx === -1 ? fetchedText : fetchedText.slice(idx + CLOUDFLARE_END_MARKER.length);
  return tail.trim();
}

// v1.6.1: the Worker owns /robots.txt, so it owns the Sitemap-pointer
// guarantee. The origin can't be trusted to provide one: a physical
// robots.txt on the host's disk bypasses WordPress's virtual robots
// entirely, so neither WP core's Sitemap line nor the plugin's idempotent
// pointer ever runs — which is exactly what happened live (origin
// contributed a bare "Disallow: /tools/" and the pointer vanished from the
// internet until Search Console dropped the sitemap). Idempotent: appended
// only when the composed output carries no Sitemap line from any source.
export const SITEMAP_URL = "https://juanlentino.com/wp-sitemap.xml";

export function fullRobotsTxt(originTailText) {
  const tail = originTailText ? `\n\n${originTailText}` : "";
  const composed = `${OWNED_ROBOTS_HEADER}${tail}\n\nLicense: ${LICENSE_URL}\n`;
  if (composed.includes("Sitemap:")) return composed;
  return `${composed}Sitemap: ${SITEMAP_URL}\n`;
}

// Kept for reference (git history, v1.1.1) as the documented revert path if
// Cloudflare's wrap ever comes back into play — not currently called.
export function appendLicenseOnly(fetchedText) {
  return `${fetchedText.trimEnd()}\nLicense: ${LICENSE_URL}\n`;
}
