export const SITE_ORIGIN = "https://juanlentino.com";
export const TDM_POLICY_URL = `${SITE_ORIGIN}/tdm-policy/`;
export const LICENSE_URL = `${SITE_ORIGIN}/license.xml`;
export const TDMREP_URL = `${SITE_ORIGIN}/.well-known/tdmrep.json`;
export const ROBOTS_URL = `${SITE_ORIGIN}/robots.txt`;
export const CONTACT_URL = `${SITE_ORIGIN}/contact/`;

// The rightsholder named in the attribution condition. Held here rather than
// inlined into the policy prose because /license.xml's <copyright> element and
// the policy page's §2 must name the SAME party — an attribution condition
// that names two different holders is not a testable condition.
export const RIGHTSHOLDER = "Juan Lentino";

// Policy version + effective date. ONE pair of constants, read by the policy
// page (§6), the RSL file's <terms> pointer and the deploy check. A version
// stated in one place and not the other is the failure this prevents: a
// licensee accepts "v0.1" and the file it accepted can no longer be identified.
//
// POLICY_STATUS is deliberately part of the data, not the prose. While it reads
// "draft" the page renders its review banner; flipping it to "final" is the one
// edit that promotes the document, and the check script asserts the page and
// this constant agree.
export const POLICY_VERSION = "0.1";
export const POLICY_DATE = "2026-08-09";
export const POLICY_STATUS = "draft";

// The one Content-Signal string. robots-block.mjs interpolates this same
// constant into the robots.txt block, so the header and the file can never
// state different terms — a drift that would be worse than saying nothing,
// since a crawler reading both would get contradictory permissions.
export const CONTENT_SIGNAL = "search=yes,ai-train=no,ai-input=yes,use=reference";

// Applied to every HTML and REST response (index.mjs withTdmHeaders).
//
// WHY ON EVERY RESPONSE: fetch ORDER cannot be enforced. HTTP is client-driven,
// and the only way to force a crawler to read the rights files first is to gate
// content until it has — which needs per-client state and serves crawlers
// something different from humans (cloaking). RFC 9309 already requires
// compliant crawlers to read robots.txt before crawling, and a crawler
// ignoring that would ignore a gate too. So rather than controlling WHEN the
// rights are read, make ordering IRRELEVANT: the reservation rides the same
// response as the content being taken.
export const TDM_RESERVATION_HEADERS = {
  "TDM-Reservation": "1",
  "TDM-Policy": TDM_POLICY_URL,
  // v1.5.0: previously REST-only. /wp-json is noindex and is not where a
  // scraper takes prose from; HTML is, and HTML was the surface missing the
  // granular signal that separates indexing from training.
  "Content-Signal": CONTENT_SIGNAL,
};

// RFC 8288 registered relation — machine-discoverable licensing straight off
// the content fetch, so a crawler learns the license URL without knowing to
// look for /license.xml. APPENDED, never set: WordPress emits its own Link
// headers (REST discovery, shortlink) and replacing them would break API
// autodiscovery.
export const LICENSE_LINK_HEADER = `<${LICENSE_URL}>; rel="license"`;

// Raw HTML fragment, reused verbatim by the generic <head> injector (for
// WordPress-rendered pages) and by the Worker-synthesized /tdm-policy/ page
// itself, so the two surfaces can never drift out of sync.
export const TDM_META_TAGS =
  `<meta name="tdm-reservation" content="1"><meta name="tdm-policy" content="${TDM_POLICY_URL}">`;
