import { LICENSE_URL } from "./constants.mjs";

// GET /robots.txt is proxied through to the origin. Empirically verified
// (2026-07-23) that this Worker's own fetch(request) here reaches ONLY
// WordPress's bare origin file — currently just "Disallow: /tools/" — never
// Cloudflare's managed content-signals block. That block (the Article 4
// preamble, the Content-Signal line, and the named-crawler Disallow list) is
// injected by a layer that WRAPS AROUND whatever this Worker returns, after
// this Worker runs, not before. Two consequences:
//   1. Text appended here lands after the origin's own content, which is
//      exactly where the final composed file's tail ends up — confirmed live.
//   2. The managed Content-Signal line itself is NEVER visible to this
//      Worker and can never be edited here. ai-input=yes is not achievable
//      from this repo. See CHANGELOG / session notes for the owner-side
//      options (Cloudflare doesn't yet expose an ai-input toggle anywhere;
//      the existing custom-directive mechanism only inserts text ABOVE the
//      managed block, which can't override a field inside it).
export async function robotsResponse(request) {
  const origin = await fetch(request);
  if (!origin.ok) return origin;

  const body = await origin.text();
  const patched = `${body.trimEnd()}\nLicense: ${LICENSE_URL}\n`;

  const headers = new Headers(origin.headers);
  headers.delete("content-length");
  headers.set("content-type", "text/plain; charset=utf-8");
  return new Response(patched, { status: origin.status, headers });
}
