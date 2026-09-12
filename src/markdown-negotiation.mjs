import { htmlToMarkdown } from "./html-to-markdown.mjs";

// Vary is a LIST header and the origin already sets Accept-Encoding on it.
// append(), never set() — the same rule the Link header follows in index.mjs,
// and for the same reason: clobbering a list header breaks whatever the origin
// was already using it for (here, compressed-variant caching).
export function withVaryAccept(response) {
  const headers = new Headers(response.headers);
  // Token comparison, not a substring match: `Accept-Language` is not
  // `Accept` (#54).
  const tokens = (headers.get("vary") || "").toLowerCase().split(",").map((t) => t.trim());
  if (!tokens.includes("accept")) headers.append("Vary", "Accept");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

// WHY Vary RIDES THE HTML TOO: this URL now has two representations, and a
// downstream cache that stored the HTML without Vary: Accept would happily
// replay it to an agent asking for markdown — and, far worse, replay a cached
// markdown body to a browser. The header is only correct if BOTH
// representations carry it; putting it on one is the bug, not half the fix.
//
// Cloudflare's own edge cache is not the exposure here: it stores the object
// from this Worker's origin subrequest, which is always the HTML, and the
// conversion happens after that lookup. Downstream caches are the ones that
// need telling.
//
// The twin keeps the origin's cache and robots directives: a page the origin
// marked private/no-store or noindex must not become a publicly cacheable,
// indexable markdown document. The cache-control default applies only when
// the origin sent none.
export async function markdownResponse(origin) {
  const markdown = await htmlToMarkdown(origin);
  const headers = new Headers({
    "content-type": "text/markdown; charset=utf-8",
    vary: "Accept",
    "cache-control": "public, max-age=300",
  });
  for (const name of ["cache-control", "x-robots-tag", "content-language"]) {
    const value = origin.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(markdown, { status: 200, headers });
}

// Convert when the client asked and the origin gave us a page to convert;
// otherwise hand back null and let the caller serve HTML unchanged.
//
// A conversion failure returns null rather than throwing: the alternative is a
// 500 on the live site because a markdown state machine hit an edge case, which
// is a strictly worse answer than the HTML the reader could have had. It is
// LOGGED, not swallowed — observability is on for this Worker, so a converter
// that starts failing is visible rather than quietly serving HTML forever.
export async function maybeMarkdown(origin, wantsMarkdown) {
  if (!wantsMarkdown) return null;
  // 200 only. Error pages are chrome, and a Cloudflare 1xxx interstitial
  // rendered as markdown would be a confident-looking document about nothing.
  if (origin.status !== 200) return null;
  // Only an HTML page converts; a JSON-LD representation negotiated on the
  // same URL is already the machine form.
  if (!(origin.headers.get("content-type") || "").includes("text/html")) return null;
  // The converter LOCKS the body it reads, so a failure mid-stream used to
  // leave the caller's fallback with nothing to serve — a rejected fetch
  // (1101) instead of the HTML promised above (#49). Convert a clone (a tee
  // underneath) and keep `origin` untouched for the fallback; on success the
  // unread branch is cancelled so the tee does not buffer the whole page.
  let markdown;
  try {
    markdown = await markdownResponse(origin.clone());
  } catch (err) {
    console.error("markdown conversion failed", err && err.message ? err.message : err);
    return null;
  }
  if (origin.body) origin.body.cancel().catch(() => {});
  return markdown;
}
