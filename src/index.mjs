import { robotsResponse } from "./robots.mjs";
import { tdmrepResponse } from "./tdmrep.mjs";
import { rslResponse } from "./rsl.mjs";
import { tdmPolicyHtml } from "./tdm-policy-page.mjs";
import { tdmPolicyOdrlResponse } from "./tdm-policy-odrl.mjs";
import { nsTdmResponse } from "./ns-tdm.mjs";
import { injectTdmMeta } from "./html-injector.mjs";
import { TDM_RESERVATION_HEADERS, LICENSE_LINK_HEADER } from "./constants.mjs";
import { versionResponse } from "./version.mjs";
import { bypassesRightsSignals } from "./admin-bypass.mjs";
import { crawlerListStatusResponse, runAndRecordCrawlerListCheck } from "./crawler-list-status.mjs";
import { machineReadersResponse, observeMachineReader } from "./machine-readers.mjs";
import { taxonomyResponse } from "./taxonomy.mjs";

// Content negotiation for /tdm-policy/, deliberately conservative: HTML is the
// default and only an explicit JSON preference switches representation.
//
// Browsers send `text/html,...,*/*;q=0.8`, so a naive "does Accept mention
// json" test would be fine — but crawlers send `*/*`, and a naive test that
// treated `*/*` as JSON-willing would hand every crawler the machine document
// and never the terms a human reviewer reads. Requiring the JSON type to be
// named EXPLICITLY, and to not be outranked by text/html, gets both right.
export function prefersOdrl(accept) {
  if (!accept) return false;
  const wantsJson = /\bapplication\/(ld\+)?json\b/i.test(accept);
  if (!wantsJson) return false;
  return !/\btext\/html\b/i.test(accept);
}

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
    // v1.11.0 (RULE 4): the published cohort definition, at a stable URL, with
    // a version and an effective date — same discipline as the TDM policy.
    // PUBLIC and unauthenticated on purpose: a definition behind a token cannot
    // be cited by a note that asks the reader to go and check it.
    if (pathname === "/_sn/rights-signals/taxonomy") return taxonomyResponse(request);
    if (pathname === "/robots.txt") return robotsResponse(request);
    if (pathname === "/.well-known/tdmrep.json") return tdmrepResponse();
    if (pathname === "/license.xml") return rslResponse();
    // v1.8.0: ONE URL, two representations. TDMRep treats a policy as
    // machine-readable only when it is served as application/(ld+)json, and
    // every layer already points at this exact URL — so the JSON is negotiated
    // here rather than published at a second address nobody references.
    // `Vary: Accept` rides BOTH representations; without it a shared cache
    // hands the JSON to a browser.
    // v1.10.0: the sn: namespace the ODRL document declares now resolves.
    // JSON-LD never required it to, but publishing a URI that 404s is a poor
    // argument on a site whose whole claim is that assertions should be
    // checkable. Negotiated identically to /tdm-policy/ — same clients, same
    // reason, and behaving differently between the two would be a trap.
    if (pathname === "/ns/tdm" || pathname === "/ns/tdm/") {
      return withTdmHeaders(nsTdmResponse(prefersOdrl(request.headers.get("accept"))));
    }

    if (pathname === "/tdm-policy" || pathname === "/tdm-policy/") {
      if (prefersOdrl(request.headers.get("accept"))) return withTdmHeaders(tdmPolicyOdrlResponse());
      return withTdmHeaders(
        new Response(tdmPolicyHtml(), {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8", vary: "Accept" },
        }),
      );
    }

    const origin = await fetch(request);

    // v1.5.0: the reservation rides EVERY response, not just HTML and REST.
    //
    // Driven by the live machine-readership sensor: across 30 days the
    // declared AI-training crawlers made 172 reads — 110 html, 27 robots,
    // 18 asset, 15 wp-json, 1 sitemap, 1 feed, and ZERO of the rights files.
    // Every response the Worker used to pass through untouched was content
    // taken with no reservation attached, and two of those buckets are prime
    // training material: the feed carries full prose, and images are
    // copyrighted works in their own right.
    //
    // Only the <head> meta injection stays HTML-gated — HTMLRewriter has
    // nothing to rewrite in a PNG, and running it on non-HTML would be a
    // pointless transform on the hot path.
    const contentType = origin.headers.get("content-type") || "";
    if (!contentType.includes("text/html")) return withTdmHeaders(origin);
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
