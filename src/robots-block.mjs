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

const ROBOTS_PREAMBLE = `# As a condition of accessing this website, you agree to abide by the following
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

# BEGIN Signal & Noise rights signals`;

// Kept separate from the preamble so origin-contributed bare rules can be
// spliced INTO this group rather than stranded below the block — see
// splitOriginTail for why that placement is the whole ballgame.
const WILDCARD_GROUP = `User-agent: *
Content-Signal: ${CONTENT_SIGNAL}
Allow: /`;

const BLOCK_FOOTER = "# END Signal & Noise rights signals";

// A hoisted rule goes AFTER "Allow: /" and still wins: RFC 9309 §2.2.2 picks
// the most specific match by pattern length, not by order, so "/tools/" beats
// "/" regardless of which line came first.
function composeHeader(wildcardRules) {
  const wildcard = wildcardRules.length
    ? `${WILDCARD_GROUP}\n${wildcardRules.join("\n")}`
    : WILDCARD_GROUP;
  return `${ROBOTS_PREAMBLE}\n\n${wildcard}\n\n${CRAWLER_BLOCKS}\n\n${BLOCK_FOOTER}`;
}

export const OWNED_ROBOTS_HEADER = composeHeader([]);

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

const RULE_LINE = /^\s*(?:allow|disallow)\s*:/i;
const USER_AGENT_LINE = /^\s*user-agent\s*:/i;

// v1.15.0: bare origin rules are HOISTED into the User-agent: * group instead
// of being appended below the block. A rule belongs to the nearest PRECEDING
// user-agent line, and RFC 9309 §2.2.1 ends a group only at the next
// user-agent line — blank lines and comments do not close one, so
// "# END Signal & Noise rights signals" terminates nothing that a parser can
// see. Appended below the block, the origin's bare "Disallow: /tools/" bound
// to meta-externalagent (the last group opened, already under a blanket
// Disallow: /) and never applied to Googlebot at all. Search Console does not
// flag this: the line parses, so nothing is malformed — it simply governs an
// agent nobody meant it to govern.
//
// Only rules BEFORE the tail's first user-agent line are hoisted. Once the
// origin opens a group of its own, its rules belong to that group and moving
// them would change their meaning rather than restore it. Everything that is
// not a bare rule — comments, Sitemap:, the origin's own groups — stays in the
// tail untouched, since those are group-independent or already bound.
export function splitOriginTail(originTailText) {
  const hoisted = [];
  const rest = [];
  let groupOpened = false;

  for (const line of originTailText.split("\n")) {
    if (USER_AGENT_LINE.test(line)) groupOpened = true;
    if (!groupOpened && RULE_LINE.test(line)) {
      hoisted.push(line.trim());
      continue;
    }
    rest.push(line);
  }

  return { hoisted, rest: rest.join("\n").trim() };
}

export function fullRobotsTxt(originTailText) {
  const { hoisted, rest } = splitOriginTail(originTailText || "");
  const tail = rest ? `\n\n${rest}` : "";
  const composed = `${composeHeader(hoisted)}${tail}\n\nLicense: ${LICENSE_URL}\n`;
  if (composed.includes("Sitemap:")) return composed;
  return `${composed}Sitemap: ${SITEMAP_URL}\n`;
}

// Kept for reference (git history, v1.1.1) as the documented revert path if
// Cloudflare's wrap ever comes back into play — not currently called.
export function appendLicenseOnly(fetchedText) {
  return `${fetchedText.trimEnd()}\nLicense: ${LICENSE_URL}\n`;
}
