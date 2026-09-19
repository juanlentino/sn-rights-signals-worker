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
export const POLICY_VERSION = "1.3";
export const POLICY_DATE = "2026-09-19";
export const POLICY_STATUS = "published";

// SUPERSESSION IS THE REASON THIS IS 1.1 AND NOT AN EDIT TO 1.0.
//
// §6 promises that each published version is OpenTimestamps-anchored and that
// "a version is never silently rewritten in place." At the time §5 gained its
// /ns/tdm row, the only anchored tdm-policy record in the ledger was the OLD
// PLACEHOLDER page (rights-signals/tdm-policy/v1, Bitcoin block 960034) — 1.0
// itself had not yet been swept. So an in-place edit was technically available.
//
// It was declined. The sweep runs hourly on the hour and would anchor whatever
// happened to be live when it fired, so "edit in place" meant racing a cron for
// the right to rewrite a published version — which is the precise thing §6 was
// written to prevent, dressed up as a technicality. Bumping costs one constant
// and exercises the rule the policy states. 1.0 keeps whatever record it got.

// The attribution baseline the policy incorporates by reference (section 2,
// C1). Creative Commons Attribution 4.0 International, section 3(a) — the
// clause that defines what adequate attribution IS. It is drafted, translated,
// widely construed, and it is the reference RSL's own guide names for
// payment type="attribution".
//
// READ THIS BEFORE CHANGING ANYTHING NEAR IT: incorporating §3(a) as the
// DEFINITION of attribution is not the same as licensing this content under
// CC BY 4.0, and the difference is the whole position. CC BY 4.0 grants rights
// in the *Licensed Material*, not in a *use* — a party who accepts it acquires
// reproduction, adaptation and commercial redistribution of whole works, and
// the licence cannot be narrowed to "training only" while remaining CC BY.
// The policy therefore incorporates the clause and expressly reserves
// everything §2 does not grant. Loosening that wording gives away the corpus.
export const ATTRIBUTION_STANDARD_URL =
  "https://creativecommons.org/licenses/by/4.0/legalcode#s3a";
export const ATTRIBUTION_STANDARD_NAME =
  "Creative Commons Attribution 4.0 International, section 3(a)";

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
