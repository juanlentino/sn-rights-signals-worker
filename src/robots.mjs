import { fullRobotsTxt, originTail } from "./robots-block.mjs";

// GET /robots.txt: full ownership, not a patch. This Worker generates the
// entire managed-content-signals block itself (see robots-block.mjs for why
// — Cloudflare's own managed block can never be edited by a Worker, only
// wrapped around by one), then appends whatever WordPress's own origin file
// contributes below it (currently just "Disallow: /tools/"), then the
// License: directive. The origin fetch is defensive against BOTH states of
// Cloudflare's "Managed robots.txt" dashboard toggle — still on (its block
// gets detected and stripped out of the origin response before appending,
// so it's never duplicated) or already off (nothing to strip, the whole
// origin response is WordPress's own tail content).
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
