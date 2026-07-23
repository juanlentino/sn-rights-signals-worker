import { robotsResponse } from "./robots.mjs";
import { tdmrepResponse } from "./tdmrep.mjs";
import { rslResponse } from "./rsl.mjs";
import { tdmPolicyHtml } from "./tdm-policy-page.mjs";
import { injectTdmMeta } from "./html-injector.mjs";
import { TDM_RESERVATION_HEADERS } from "./constants.mjs";
import { versionResponse } from "./version.mjs";

function withTdmHeaders(response) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(TDM_RESERVATION_HEADERS)) headers.set(name, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  // Bound to a single juanlentino.com/* route (more-specific routes on the
  // other three workers — /_sn/px*, /sn-login*, etc. — win over this wildcard
  // per Cloudflare's route precedence, so this never shadows them). Static
  // assets and every other unmatched path fall through the content-type
  // check below untouched: one extra edge-local Worker hop, zero bytes changed.
  async fetch(request, env) {
    const { pathname } = new URL(request.url);

    // Namespaced (not /_sn/version) because sn-analytics already owns that
    // exact path with its own more-specific Cloudflare route — bare
    // /_sn/version on this Worker's wildcard route would never be reached.
    if (pathname === "/_sn/rights-signals/version") return versionResponse(request, env);
    if (pathname === "/robots.txt") return robotsResponse(request);
    if (pathname === "/.well-known/tdmrep.json") return tdmrepResponse();
    if (pathname === "/license.xml") return rslResponse();
    if (pathname === "/tdm-policy" || pathname === "/tdm-policy/") {
      return withTdmHeaders(
        new Response(tdmPolicyHtml(), { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }),
      );
    }

    const origin = await fetch(request);
    if (pathname === "/wp-json" || pathname.startsWith("/wp-json/")) return withTdmHeaders(origin);

    const contentType = origin.headers.get("content-type") || "";
    if (!contentType.includes("text/html")) return origin;
    return withTdmHeaders(injectTdmMeta(origin));
  },
};
