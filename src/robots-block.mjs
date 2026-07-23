import { LICENSE_URL } from "./constants.mjs";

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
# use:      how AI systems may consume the content (immediate, reference, or full).

# ANY RESTRICTIONS EXPRESSED VIA CONTENT SIGNALS ARE EXPRESS RESERVATIONS OF
# RIGHTS UNDER ARTICLE 4 OF THE EUROPEAN UNION DIRECTIVE 2019/790 ON COPYRIGHT
# AND RELATED RIGHTS IN THE DIGITAL SINGLE MARKET.

# BEGIN Signal & Noise rights signals

User-agent: *
Content-Signal: search=yes,ai-train=no,ai-input=yes,use=reference
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

export function fullRobotsTxt(originTailText) {
  const tail = originTailText ? `\n\n${originTailText}` : "";
  return `${OWNED_ROBOTS_HEADER}${tail}\n\nLicense: ${LICENSE_URL}\n`;
}

// Kept for reference (git history, v1.1.1) as the documented revert path if
// Cloudflare's wrap ever comes back into play — not currently called.
export function appendLicenseOnly(fetchedText) {
  return `${fetchedText.trimEnd()}\nLicense: ${LICENSE_URL}\n`;
}
