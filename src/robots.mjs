import { fullRobotsTxt, originTail } from "./robots-block.mjs";

// GET /robots.txt. FULL OWNERSHIP — safe as of 2026-07-23: the owner
// disabled "Managed robots.txt" in the Cloudflare dashboard, so Cloudflare
// no longer wraps its own block around this Worker's response. This Worker
// now generates the entire content-signals block itself (see
// robots-block.mjs), including Content-Signal: ai-input=yes, and appends
// whatever WordPress's own origin file contributes below it.
//
// originTail() defensively strips a Cloudflare block if one is still
// present in the origin fetch — belt-and-suspenders in case the toggle gets
// re-enabled by mistake later; it costs nothing when the toggle stays off.
// If robots.txt output ever looks duplicated again, the toggle is back on —
// revert this file to appendLicenseOnly(body) (see git history, v1.1.1)
// before debugging anything else.
//
// 1.40.1: when the origin answers with its file, the served body is built
// from the FULL file (a 4xx still gets the owned block alone, below). The
// client's validators and Range are not forwarded (a 304 or a 206 has no
// complete file to append), and the origin's ETag and Last-Modified do not
// ride the rewritten body, which is a different entity that also changes with
// a Worker release. A crawler therefore always gets a full 200 here.
const PARTIAL_OR_CONDITIONAL = ["if-none-match", "if-modified-since", "if-match", "if-unmodified-since", "if-range", "range"];

export async function robotsResponse(request) {
  const asked = new Headers(request.headers);
  for (const h of PARTIAL_OR_CONDITIONAL) asked.delete(h);
  // redirect-ok: origin passthrough of the INCOMING request, which the Workers runtime defaults to redirect:"manual"; the copy keeps it.
  const origin = await fetch(new Request(request, { headers: asked }));

  // RFC 9309 §2.3.1 gives 4xx and 5xx OPPOSITE meanings, so "not ok" is not one
  // branch. 5xx is "unreachable" — crawlers MUST assume a complete disallow, so
  // passing it through is strictly more protective than anything we could
  // compose, and we must not convert it into a 200. 4xx is "unavailable" —
  // crawlers MAY then access ANY resource, which would silently discard the
  // Article 4 reservation, the Content-Signal line, every named-crawler block
  // and the License line. That is the failure mode worth closing: the origin
  // simply has no robots.txt of its own to contribute, and our block stands on
  // its own without it.
  if (origin.status >= 500 || origin.status === 429) return origin;
  // 1.40.1: a redirect (or any other 3xx) is the origin's answer, not a missing
  // file. It used to fall into the 4xx branch below and come back as a 200
  // holding the owned block alone.
  if (origin.status >= 300 && origin.status < 400) return origin;
  if (!origin.ok) {
    return new Response(fullRobotsTxt(""), {
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const body = await origin.text();
  const patched = fullRobotsTxt(originTail(body));

  const headers = new Headers(origin.headers);
  headers.delete("content-length");
  headers.delete("content-encoding");
  headers.delete("etag");
  headers.delete("last-modified");
  headers.set("content-type", "text/plain; charset=utf-8");
  return new Response(patched, { status: origin.status, headers });
}
