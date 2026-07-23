import { LICENSE_URL } from "./constants.mjs";

// Full ownership of the managed-content-signals block — NOT currently wired
// into robots.mjs. Ready for a manual flip once the owner disables
// Cloudflare's "Managed robots.txt" dashboard feature (see robots.mjs for
// why this can't be automatic: the Worker has no way to detect, from its own
// code, whether Cloudflare will wrap its response). Until then this module
// is exercised only by its own tests.
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

User-agent: Amazonbot
Disallow: /

User-agent: Applebot-Extended
Disallow: /

User-agent: Bytespider
Disallow: /

User-agent: CCBot
Disallow: /

User-agent: ClaudeBot
Disallow: /

User-agent: CloudflareBrowserRenderingCrawler
Disallow: /

User-agent: Google-Extended
Disallow: /

User-agent: GPTBot
Disallow: /

User-agent: meta-externalagent
Disallow: /

# END Signal & Noise rights signals`;

// The marker Cloudflare's OWN managed block ends with, live as of
// 2026-07-23. For use ONCE full ownership is safe to enable: strips a
// leftover Cloudflare block out of the origin fetch (defensive only — by
// the time full ownership is safe, this marker should never appear again).
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

// The only mode currently wired into robots.mjs: touch nothing, append
// License:. Safe regardless of whether Cloudflare's managed block is active,
// because it never composes anything that could duplicate it.
export function appendLicenseOnly(fetchedText) {
  return `${fetchedText.trimEnd()}\nLicense: ${LICENSE_URL}\n`;
}
