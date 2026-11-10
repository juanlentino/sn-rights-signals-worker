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

// THE ORIGIN'S OWN MARKDOWN. A page can name a Markdown file written for it,
// with `Link: <...md>; rel="alternate"; type="text/markdown"` on its HTML
// response (the plugin does this for the résumé: /resume.md). An agent that
// asked for Markdown then gets that file instead of the generic conversion.
// Same origin and a .md path only, so the header can never point the edge at
// another host or loop back into a negotiated page URL. Anything but a 200
// text/markdown answer falls back to the conversion, so a plugin that has not
// shipped the file yet costs one 404 and nothing else.
export function originMarkdownHref(link, base) {
  if (!link) return null;
  for (const part of link.split(/,(?=\s*<)/)) {
    const m = /^\s*<([^>]*)>(.*)$/.exec(part);
    if (!m) continue;
    const params = m[2].toLowerCase();
    const rel = (/;\s*rel\s*=\s*"?([^";]*)"?/.exec(params) || [])[1] || "";
    const type = (/;\s*type\s*=\s*"?([^";]*)"?/.exec(params) || [])[1] || "";
    if (!rel.split(/\s+/).includes("alternate") || type.trim() !== "text/markdown") continue;
    let url;
    try {
      url = new URL(m[1], base);
    } catch {
      continue;
    }
    // No query, or exactly `?lane=<letters>` (1.37.2): /resume's operations lane
    // names /resume.md?lane=operations. Any other query is refused.
    const queryOk = !url.search || /^\?lane=[a-z]+$/.test(url.search);
    if (url.origin === new URL(base).origin && url.pathname.endsWith(".md") && queryOk) return url.href;
  }
  return null;
}

async function originMarkdown(origin, requestUrl, userAgent) {
  const href = requestUrl ? originMarkdownHref(origin.headers.get("link"), requestUrl) : null;
  if (!href) return null;
  // Fresh headers, as note-markdown-url.mjs does: no cookie, no validators.
  // redirect-ok: a moved .md is not this page's Markdown; falls back below.
  const res = await fetch(new Request(href, { method: "GET", headers: { accept: "text/markdown", "user-agent": userAgent || "" }, redirect: "manual" }));
  if (res.status !== 200 || !(res.headers.get("content-type") || "").includes("text/markdown")) {
    if (res.body) res.body.cancel().catch(() => {});
    // The path only: no query value, no header. A 200 here means the type was not Markdown.
    console.warn(`origin markdown alternate ${new URL(href).pathname} answered ${res.status}; converting the HTML instead`);
    return null;
  }
  const headers = new Headers({ "content-type": "text/markdown; charset=utf-8", vary: "Accept", "cache-control": "public, max-age=300" });
  for (const name of ["content-type", "cache-control", "x-robots-tag", "content-language"]) {
    const value = res.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(res.body, { status: 200, headers });
}

// THE CANONICAL. The converted twin names its HTML page as canonical, as
// /notes/<slug>.md does (one helper, so the two cannot drift). The origin's own
// Link header rides along, so its other relations survive; when it already
// names a canonical, that one stands and none is added. Otherwise only a note
// URL (/notes/<slug>/) gets one, built from the path, so a query string never
// leaks into it. Any other page whose canonical the edge cannot know gets none.
// One spelling for both Markdown doors (/notes/<slug>.md and Accept
// negotiation), so the two canonical Link headers cannot drift (1.38.3).
export const canonicalLink = (href) => `<${href}>; rel="canonical"`;
const NOTE_PAGE = /^\/notes\/([^/]+)\/$/;

function withCanonical(markdown, originLink, requestUrl) {
  if (originLink) markdown.headers.append("Link", originLink);
  if (/rel\s*=\s*"?[^",;]*\bcanonical\b/i.test(originLink || "") || !requestUrl) return markdown;
  const url = new URL(requestUrl);
  if (NOTE_PAGE.test(url.pathname)) markdown.headers.append("Link", canonicalLink(`${url.origin}${url.pathname}`));
  return markdown;
}

// Convert when the client asked and the origin gave us a page to convert;
// otherwise hand back null and let the caller serve HTML unchanged.
//
// A conversion failure returns null rather than throwing: the alternative is a
// 500 on the live site because a markdown state machine hit an edge case, which
// is a strictly worse answer than the HTML the reader could have had. It is
// LOGGED, not swallowed — observability is on for this Worker, so a converter
// that starts failing is visible rather than quietly serving HTML forever.
export async function maybeMarkdown(origin, wantsMarkdown, requestUrl = null, userAgent = "") {
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
    markdown = await originMarkdown(origin, requestUrl, userAgent);
  } catch (err) {
    console.error("origin markdown fetch failed", err && err.message ? err.message : err);
  }
  if (markdown) {
    if (origin.body) origin.body.cancel().catch(() => {});
    return markdown;
  }
  try {
    markdown = await markdownResponse(origin.clone());
  } catch (err) {
    console.error("markdown conversion failed", err && err.message ? err.message : err);
    return null;
  }
  if (origin.body) origin.body.cancel().catch(() => {});
  return withCanonical(markdown, origin.headers.get("link"), requestUrl);
}
