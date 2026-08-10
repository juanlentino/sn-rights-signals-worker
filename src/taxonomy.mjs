// The vendor/purpose axes for the machine-readership sensor (v1.11.0).
//
// This module is a LOADER and a MATCHER. It contains no classification
// decisions: every one of those lives in machine-reader-taxonomy.json, which
// is versioned, diffable, and published verbatim at
// GET /_sn/rights-signals/taxonomy. A number derived from a definition nobody
// can read is an assertion, so the definition is served.
//
// RULE 1 (non-negotiable): this module NEVER touches `family`. Vendor and
// purpose are matched independently against the raw User-Agent, not derived
// from the family a request was already given. That is what lets
// Claude-SearchBot keep family=other-bot (frozen, unchanged, exactly as it has
// counted since v1.4.0) while gaining vendor=anthropic, purpose=search.

import TAXONOMY from "./machine-reader-taxonomy.json";

export const PURPOSES = Object.freeze(Object.keys(TAXONOMY.purpose_vocabulary));

/**
 * Load-time validation. This is a real second opinion, not a restatement of the
 * producer's assumption: it fails on a purpose the vocabulary does not define,
 * a duplicate id, and — the one that actually bites — an ordering bug where a
 * generic token shadows a specific one that appears later (e.g. "applebot"
 * placed before "applebot-extended" would silently make the Apple split
 * unreachable). Throwing here surfaces at deploy, not in a published number.
 */
function validate(entries) {
  const seen = new Set();
  entries.forEach((e, i) => {
    if (!e.id || seen.has(e.id)) throw new Error(`taxonomy: missing or duplicate id at index ${i}: ${e.id}`);
    seen.add(e.id);
    if (!e.match || e.match !== e.match.toLowerCase()) {
      throw new Error(`taxonomy: match must be a lowercase non-empty string (${e.id})`);
    }
    if (!PURPOSES.includes(e.purpose)) throw new Error(`taxonomy: unknown purpose "${e.purpose}" (${e.id})`);
    for (let j = i + 1; j < entries.length; j++) {
      if (entries[j].match.includes(e.match)) {
        throw new Error(`taxonomy: "${e.id}" (${e.match}) shadows later "${entries[j].id}" (${entries[j].match}) — reorder`);
      }
    }
  });
  return entries;
}

const ENTRIES = Object.freeze(validate(TAXONOMY.entries));

export const TAXONOMY_VERSION = TAXONOMY.taxonomy_version;
export const TAXONOMY_EFFECTIVE_DATE = TAXONOMY.effective_date;

/**
 * Match one User-Agent against the taxonomy. Ordered substring, first match
 * wins. Independent of classifyMachineReader() by design.
 *
 * @param {string|null|undefined} ua Raw User-Agent header value.
 * @returns {{id:string, vendor:string|null, purpose:string, training_corpus_source:boolean, first_party:boolean}|null}
 *   null when nothing matches — the caller decides what "unknown" means.
 */
export function classifyVendorPurpose(ua) {
  const s = (typeof ua === "string" ? ua : "").toLowerCase();
  if (s === "") return null;
  for (const e of ENTRIES) {
    if (s.includes(e.match)) {
      return {
        id: e.id,
        vendor: e.vendor ?? null,
        purpose: e.purpose,
        training_corpus_source: e.training_corpus_source === true,
        first_party: e.first_party === true,
      };
    }
  }
  return null;
}

// Unknown-UA retention (RULE 2), unmatched requests ONLY.
//
// This is a DELIBERATE, DOCUMENTED downgrade of the v1.4.0 privacy contract.
// That contract said the raw User-Agent never leaves this module, which closed
// the stored-XSS-into-admin pipeline BY CONSTRUCTION rather than by escaping.
// But an unknown bucket nobody can inspect is not a measurement, and other-bot
// is the second-largest bucket in the dataset. The compromise: a strict
// character ALLOWLIST (not a denylist) plus a hard length cap, so what reaches
// the dataset cannot carry markup, quotes, backslashes, or control bytes at
// all. The admin render lane escapes it again. Safe by sanitisation AND
// escaping, where it used to be safe by construction — a real, bounded loss.
const UA_MAX = 96;

/** @param {string|null|undefined} ua @returns {string} Safe to store; "" when nothing survives. */
export function sanitizeUnknownUa(ua) {
  const s = typeof ua === "string" ? ua : "";
  return s
    .replace(/[^A-Za-z0-9._/+ -]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, UA_MAX);
}

/**
 * GET /_sn/rights-signals/taxonomy — the stable, public, citable URL (RULE 4).
 * Public on purpose: this is the published cohort definition, and a definition
 * behind a token cannot be cited by a note that asks readers to check it.
 */
export function taxonomyResponse(request) {
  if (request.method !== "GET") return new Response(null, { status: 405, headers: { allow: "GET" } });
  return new Response(JSON.stringify(TAXONOMY, null, 2), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      // Cacheable, unlike the operational endpoints: it changes only when the
      // file changes, and a citable definition should be cheap to fetch.
      "cache-control": "public, max-age=3600",
      "x-sn-taxonomy-version": TAXONOMY_VERSION,
    },
  });
}
