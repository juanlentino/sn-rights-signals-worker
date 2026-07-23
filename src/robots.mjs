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
  if (!origin.ok) return origin;

  const body = await origin.text();
  const patched = fullRobotsTxt(originTail(body));

  const headers = new Headers(origin.headers);
  headers.delete("content-length");
  headers.delete("content-encoding");
  headers.set("content-type", "text/plain; charset=utf-8");
  return new Response(patched, { status: origin.status, headers });
}
