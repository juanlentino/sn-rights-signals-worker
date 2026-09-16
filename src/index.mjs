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
import { best, parseAccept, prefersMarkdown } from "./accept-markdown.mjs";
import { hasWebBotAuthHeaders, resolveSignatureState, signatureAgentOrigin } from "./web-bot-auth.mjs";
import { licenceOfferHeaders } from "./licence-handshake.mjs";
import { maybeMarkdown, withVaryAccept } from "./markdown-negotiation.mjs";
import { webmcpBridgeResponse } from "./webmcp-bridge.mjs";
import { webmcpCallResponse, WEBMCP_CALL_PATH } from "./webmcp-call.mjs";

// Content negotiation for /tdm-policy/, deliberately conservative: HTML is the
// default and only an explicit JSON preference switches representation.
//
// Browsers send `text/html,...,*/*;q=0.8`, so a naive "does Accept mention
// json" test would be fine — but crawlers send `*/*`, and a naive test that
// treated `*/*` as JSON-willing would hand every crawler the machine document
// and never the terms a human reviewer reads. Requiring the JSON type to be
// named EXPLICITLY, and to not be outranked by text/html, gets both right.
//
// Same parser as the markdown negotiation, so qvalues count (#54):
// `application/ld+json, text/html;q=0.5` is a JSON preference. A tie stays
// HTML — prose wins when the client is indifferent.
export function prefersOdrl(accept) {
  const entries = parseAccept(accept);
  const json = best(entries, ["application/ld+json", "application/json"]);
  if (json === 0) return false;
  return json > best(entries, ["text/html"]);
}

function withTdmHeaders(response, licenceOffer = {}) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(TDM_RESERVATION_HEADERS)) headers.set(name, value);
  // v1.24.0 (survey A2). EMPTY for every request that did not prove an
  // identity, which is almost all of them — so this loop changes nothing on the
  // hot path and the declaration above is what an unverified agent still gets.
  for (const [name, value] of Object.entries(licenceOffer)) headers.set(name, value);
  // An offer is keyed to the identity in Signature-Agent, so a shared cache
  // must not replay it to a different agent (or to nobody).
  if (Object.keys(licenceOffer).length > 0) headers.append("Vary", "Signature-Agent");
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
    // redirect-ok: origin passthrough of the INCOMING request, which the Workers runtime defaults to redirect:"manual".
    if (bypassesRightsSignals(pathname)) return fetch(request);

    // v1.24.0 (survey A2). Null until a signed request resolves it; the offer
    // stays {} for everything else, which is the fail-open path — an agent that
    // did not prove an identity receives exactly the response it received
    // before this feature existed.
    let signatureState = null;

    // v1.4.0: machine-readership sensor — aggregate-only AE write when the UA
    // classifies into the fixed crawler-family enum; humans and internal /_sn/
    // paths are never recorded, and observation can never affect the response.
    if (!pathname.startsWith("/_sn/")) {
      // TWO PATHS ON PURPOSE (v1.19.0). An unsigned request observes exactly as
      // it did before this feature existed: synchronous, no await, nothing
      // scheduled. A signed one defers the WHOLE observation, because
      // verification may fetch a key directory and no reader should wait on
      // our telemetry to get their bytes.
      if (hasWebBotAuthHeaders(request)) {
        // v1.24.0: THIS REQUEST NOW AWAITS VERIFICATION, and v1.19.0's comment
        // explaining why it did not is deliberately superseded. Then the state
        // was only telemetry, and no reader should wait on our telemetry to get
        // their bytes. Under A2 the state SHAPES THE RESPONSE, so it has to be
        // known before the response is composed — a licence offer computed
        // after the bytes have gone is not an offer.
        //
        // The cost falls only on requests that carry Web Bot Auth headers, and
        // key directories are Cache-API cached (6h positive, 15m negative), so
        // the common case is an edge-local lookup and an Ed25519 verify. No
        // unsigned request pays anything: that branch is untouched below.
        signatureState = await resolveSignatureState(request);
        // Resolved ONCE and reused. Calling resolveSignatureState again for the
        // headers would double every verification, and could report a different
        // state from the one recorded if a directory rotated between the two.
        observeMachineReader(request, env, pathname, signatureState);
      } else {
        observeMachineReader(request, env, pathname);
      }
    }

    // Keyed to the identity that was actually proved, and empty otherwise. Built
    // here so every branch below wraps the same object — a surface that forgot
    // it would answer a verified agent with the bare declaration, which is a
    // silent inconsistency rather than a visible failure.
    const licenceOffer = licenceOfferHeaders(signatureState, signatureAgentOrigin(request));

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
    // #55: the Worker-owned HTML pages go through the same markdown
    // negotiation every origin page gets (the JSON representations do not —
    // they are already the machine form).
    const accept = request.headers.get("accept");
    const wantsMarkdown = prefersMarkdown(accept);
    if (pathname === "/ns/tdm" || pathname === "/ns/tdm/") {
      const page = nsTdmResponse(prefersOdrl(accept));
      const md = await maybeMarkdown(page, wantsMarkdown);
      return withTdmHeaders(md || page, licenceOffer);
    }

    // The self-hosted WebMCP bridge (design: signal-and-noise-tools
    // docs/webmcp-native-design.md). Wrapped like every owned surface: content
    // taken in ANY representation is content taken (v1.5.0), a script included.
    if (pathname === "/webmcp/bridge.js") return withTdmHeaders(webmcpBridgeResponse(), licenceOffer);
    // v1.25.0: the bridge's beacon, one row per tool call; always 204.
    if (pathname === WEBMCP_CALL_PATH) return webmcpCallResponse(request, env);

    if (pathname === "/tdm-policy" || pathname === "/tdm-policy/") {
      if (prefersOdrl(accept)) return withTdmHeaders(tdmPolicyOdrlResponse(), licenceOffer);
      const page = new Response(tdmPolicyHtml(), {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8", vary: "Accept" },
      });
      const md = await maybeMarkdown(page, wantsMarkdown);
      return withTdmHeaders(md || page, licenceOffer);
    }

    // redirect-ok: origin passthrough of the INCOMING request, which the Workers runtime defaults to redirect:"manual".
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
    if (!contentType.includes("text/html")) return withTdmHeaders(origin, licenceOffer);

    // v1.16.0: Markdown for Agents, done here because the zone is not on a plan
    // that includes Cloudflare's own implementation. accept-markdown.mjs matches
    // its negotiation semantics exactly, so if the zone ever moves, this block
    // and its two modules delete cleanly and behaviour does not change.
    //
    // Ordering matters: the markdown branch consumes `origin` directly and
    // therefore must come BEFORE injectTdmMeta(), which would otherwise have
    // spent an HTMLRewriter pass injecting <head> tags into a document about to
    // be thrown away. The reservation still rides the markdown response —
    // withTdmHeaders() wraps both branches, per the v1.5.0 rule that content
    // taken in ANY representation is content taken.
    const markdown = await maybeMarkdown(origin, wantsMarkdown);
    if (markdown) return withTdmHeaders(markdown, licenceOffer);

    return withTdmHeaders(withVaryAccept(injectTdmMeta(origin)), licenceOffer);
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
