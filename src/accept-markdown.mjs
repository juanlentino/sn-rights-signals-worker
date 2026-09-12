// Content negotiation for Markdown for Agents.
//
// SAFETY PROPERTY, and the only one that really matters: a browser must NEVER
// receive markdown. Every human visit to this site flows through the same
// wildcard route, so a predicate that is loose by one case turns the site into
// a text dump for real readers. It is written to fail toward HTML in every
// ambiguous case, and index.mjs consults nothing else.
//
// The semantics deliberately match Cloudflare's own Markdown for Agents, which
// is what the agents in the wild are written against (and what this site will
// switch to unchanged if the zone ever moves to a plan that includes it):
//
//   Accept: text/markdown                    -> markdown
//   Accept: text/markdown, text/html;q=0.9   -> markdown
//   Accept: text/*                           -> markdown
//   Accept: */*                              -> HTML   (browser default)
//
// The rule underneath those four rows: markdown must be named EXPLICITLY (or
// via text/*), and must not be outranked by an explicit text/html. `*/*` alone
// is not a preference for anything, so it keeps the default representation —
// the same reasoning prefersOdrl() in index.mjs uses to keep crawlers on the
// human page.

// One Accept entry -> { type, q }. A malformed q (missing, NaN, out of range)
// falls back to 1, matching RFC 9110's "absent qvalue means 1" rather than
// discarding the entry: dropping an entry we failed to parse would silently
// change which representation wins.
function parseEntry(raw) {
  const [type, ...params] = raw.trim().split(";");
  let q = 1;
  for (const p of params) {
    const m = /^\s*q\s*=\s*([0-9.]+)\s*$/i.exec(p);
    if (!m) continue;
    const parsed = Number.parseFloat(m[1]);
    if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) q = parsed;
  }
  return { type: type.trim().toLowerCase(), q };
}

export function parseAccept(accept) {
  if (!accept || typeof accept !== "string") return [];
  return accept
    .split(",")
    .filter((s) => s.trim() !== "")
    .map(parseEntry)
    .filter((e) => e.type !== "");
}

// Highest q across entries whose type is in `types`. 0 when none match, which
// is why `*/*` never lands in the markdown set: it is not listed.
export function best(entries, types) {
  let q = 0;
  for (const e of entries) if (types.includes(e.type) && e.q > q) q = e.q;
  return q;
}

export function prefersMarkdown(accept) {
  const entries = parseAccept(accept);
  if (entries.length === 0) return false;
  // An EXPLICIT text/markdown entry is the client's word on markdown, and it
  // outranks the text/* range either way: `text/markdown;q=0, text/*` is a
  // refusal, not a weak yes (#54). Only when markdown is unnamed does the
  // range speak for it.
  const explicit = entries.some((e) => e.type === "text/markdown");
  const md = explicit ? best(entries, ["text/markdown"]) : best(entries, ["text/*"]);
  if (md === 0) return false;
  // A zero qvalue is an explicit REFUSAL of that type, not a weak preference.
  const html = best(entries, ["text/html"]);
  // RFC 9110 §12.5.1: a specific type beats a range at equal q, so an
  // explicit text/html wins a tie against text/*, and an explicit
  // text/markdown wins a tie against text/html.
  return explicit ? md >= html : md > html;
}
