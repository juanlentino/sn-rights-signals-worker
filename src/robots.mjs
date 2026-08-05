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
export async function robotsResponse(request) {
  const origin = await fetch(request);

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
  headers.set("content-type", "text/plain; charset=utf-8");
  return new Response(patched, { status: origin.status, headers });
}
