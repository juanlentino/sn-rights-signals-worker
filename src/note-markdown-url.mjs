import { markdownResponse } from "./markdown-negotiation.mjs";

// /notes/<slug>.md: a note's Markdown at its own URL, for readers that cannot
// send `Accept: text/markdown`. ONE converter: the bytes are what the Accept
// negotiation produces for /notes/<slug>/, from the same markdownResponse().
//
// CACHING. The HTML is read from /notes/<slug>/, so Cloudflare's edge cache
// serves and stores the very object a browser gets, under the HTML URL, and the
// plugin's per-post purge of that URL refreshes this twin with it. Nothing here
// stores the converted body (no Cache API), so there is no .md object at the edge
// to go stale; downstream caches get the origin's cache-control, as the
// negotiated twin does.
//
// SCOPE GATE. The theme advertises this URL in the note's <head> only on a
// published, unprotected note. Converting only when the origin page names this
// exact URL keeps the theme the one authority on what a note is: /notes/tags.md
// and a password-protected note answer 404, and so does every note until the
// theme ships its link.
//
// NOT part of the deletable negotiation unit (accept-markdown, html-to-markdown,
// markdown-negotiation): Cloudflare's own Markdown for Agents negotiates on
// Accept and has no suffix URL, so this route would need a converter of its own
// if that unit were ever deleted.

const NOTE_MD = /^\/notes\/([^/]+)\.md$/;

export function noteMarkdownSlug(pathname) {
  const m = NOTE_MD.exec(pathname);
  return m && m[1] !== "" ? m[1] : null;
}

// Does any <link> in the page say rel=alternate, type=text/markdown, href=<href>?
export function advertisesMarkdown(html, href) {
  for (const tag of html.match(/<link\b[^>]*>/gi) || []) {
    const attr = (name) => (new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i").exec(tag) || [])[1];
    if ((attr("rel") || "").toLowerCase().split(/\s+/).includes("alternate")
      && (attr("type") || "").toLowerCase() === "text/markdown"
      && attr("href") === href) return true;
  }
  return false;
}

const plain = (status, text) =>
  new Response(`${text}\n`, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });

export async function noteMarkdownResponse(request, slug) {
  const url = new URL(request.url);
  const canonical = `${url.origin}/notes/${slug}/`;
  // Fresh headers on purpose: a forwarded session cookie would let the origin
  // answer with a draft or a private note, and a forwarded If-None-Match or
  // If-Modified-Since would draw a 304 for the HTML, which is not this body.
  const headers = new Headers({ accept: "text/html", "user-agent": request.headers.get("user-agent") || "" });
  // redirect-ok: a redirected note (old slug) is not this URL's note; 404 below.
  const origin = await fetch(new Request(canonical, { method: "GET", headers, redirect: "manual" }));
  if (origin.status !== 200) {
    // An outage is not a missing note: pass 5xx and 429 through.
    return origin.status >= 500 || origin.status === 429 ? plain(origin.status, "Unavailable") : plain(404, "Not found");
  }
  if (!(origin.headers.get("content-type") || "").includes("text/html")) return plain(404, "Not found");
  const html = await origin.text();
  if (!advertisesMarkdown(html, `${url.origin}/notes/${slug}.md`)) return plain(404, "Not found");
  let md;
  try {
    md = await markdownResponse(new Response(html, { headers: origin.headers }));
  } catch (err) {
    // Logged, and never HTML: a .md URL that answered HTML would be a lie.
    console.error("note markdown conversion failed", err && err.message ? err.message : err);
    return plain(500, "Conversion failed");
  }
  md.headers.append("Link", `<${canonical}>; rel="canonical"`);
  return request.method === "HEAD" ? new Response(null, { status: md.status, headers: md.headers }) : md;
}
