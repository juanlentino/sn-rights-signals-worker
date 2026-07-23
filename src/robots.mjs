import { appendLicenseOnly } from "./robots-block.mjs";

// GET /robots.txt. SAFE MODE ONLY — appends the License: directive, touches
// nothing else. Full ownership (robots-block.mjs's fullRobotsTxt) is NOT
// wired in here, and cannot be made to self-detect when it's safe: this
// Worker's own fetch(request) call NEVER sees Cloudflare's managed block —
// confirmed live, twice — because that internal subrequest bypasses the
// injection entirely, regardless of whether "Managed robots.txt" is on or
// off. Meanwhile Cloudflare wraps its own block around whatever this Worker
// RETURNS to the client, unconditionally, as long as the dashboard toggle is
// on — including a response that already contains our own look-alike block,
// producing two conflicting Content-Signal lines (shipped briefly live,
// 2026-07-23, then reverted). There is no signal available to Worker code
// that distinguishes these two states. Full ownership can only go live
// AFTER the owner manually disables "Managed robots.txt" in the Cloudflare
// dashboard — at that point, swap appendLicenseOnly(body) below for
// fullRobotsTxt(originTail(body)) (both already exist in robots-block.mjs)
// and redeploy. Until then, this is the only version that's actually safe.
export async function robotsResponse(request) {
  const origin = await fetch(request);
  if (!origin.ok) return origin;

  const body = await origin.text();
  const patched = appendLicenseOnly(body);

  const headers = new Headers(origin.headers);
  headers.delete("content-length");
  headers.delete("content-encoding");
  headers.set("content-type", "text/plain; charset=utf-8");
  return new Response(patched, { status: origin.status, headers });
}
