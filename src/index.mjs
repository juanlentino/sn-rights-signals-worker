import { robotsResponse } from "./robots.mjs";
import { tdmrepResponse } from "./tdmrep.mjs";
import { rslResponse } from "./rsl.mjs";
import { tdmPolicyHtml } from "./tdm-policy-page.mjs";
import { injectTdmMeta } from "./html-injector.mjs";
import { TDM_RESERVATION_HEADERS, LICENSE_LINK_HEADER } from "./constants.mjs";
import { versionResponse } from "./version.mjs";
import { bypassesRightsSignals } from "./admin-bypass.mjs";
import { crawlerListStatusResponse, runAndRecordCrawlerListCheck } from "./crawler-list-status.mjs";
import { machineReadersResponse, observeMachineReader } from "./machine-readers.mjs";

function withTdmHeaders(response) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(TDM_RESERVATION_HEADERS)) headers.set(name, value);
  // APPEND, never set. Link is a list header and WordPress emits its own
  // entries (REST discovery, shortlink); set() would clobber them and break
  // API autodiscovery. rel="license" is one more entry, not a replacement for
  // whatever the origin already said.
  headers.append("Link", LICENSE_LINK_HEADER);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  // Bound to a single juanlentino.com/* route (more-specific routes on the
  // other three workers — /_sn/px*, /sn-login*, etc. — win over this wildcard
  // per Cloudflare's route precedence, so this never shadows them). Auth-
  // critical WP surfaces (wp-admin, login, xmlrpc, cron) bypass everything
  // below immediately — see admin-bypass.mjs. Static assets and every other
  // unmatched path fall through the content-type check below untouched: one
  // extra edge-local Worker hop, zero bytes changed.
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (bypassesRightsSignals(pathname)) return fetch(request);

    // v1.4.0: machine-readership sensor — aggregate-only AE write when the UA
    // classifies into the fixed crawler-family enum; humans and internal /_sn/
    // paths are never recorded, and observation can never affect the response.
    if (!pathname.startsWith("/_sn/")) observeMachineReader(request, env, pathname);

    // Namespaced (not /_sn/version) because sn-analytics already owns that
    // exact path with its own more-specific Cloudflare route — bare
    // /_sn/version on this Worker's wildcard route would never be reached.
    if (pathname === "/_sn/rights-signals/version") return versionResponse(request, env);
    // ctx enables the v1.4.1 lazy self-heal (throttled background re-check
    // when the isolate-memory result is missing, failed, or stale).
    if (pathname === "/_sn/rights-signals/crawler-list-status") return crawlerListStatusResponse(ctx);
    if (pathname === "/_sn/rights-signals/machine-readers") return machineReadersResponse(request, env);
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

  // Weekly: diff robots-block.mjs's hand-maintained NAMED_CRAWLERS against
  // Cloudflare's published managed-robots-txt docs (the source it was
  // seeded from), and log loudly on drift or a failed check — the only
  // signal that this list needs a manual update. GET
  // /_sn/rights-signals/crawler-list-status surfaces the last result.
  async scheduled(controller, env, ctx) {
    // v1.4.1: one shared run-and-record path with the status endpoint's lazy
    // self-heal — the drift/failure console.error trail lives with it in
    // crawler-list-status.mjs.
    ctx.waitUntil(runAndRecordCrawlerListCheck());
  },
};
