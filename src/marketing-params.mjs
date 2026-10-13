// 1.31.0: marketing params never reach the origin's cache key.
//
// The zone caches HTML by full URL, query string included, and Cloudflare's
// own ways to ignore a param (Cache Key query include/exclude, "Ignore query
// string") are not on the Free plan. So every RSS, JSON-feed, share and ad
// click was its own edge entry, and the first of each went to PHP (0.58 to
// 0.87 s measured, against 0.14 s on a hit). The page passthrough fetches the
// URL below instead, so a tracked copy reads the one cached page.
//
// NEVER A REDIRECT OF OUR OWN. The browser keeps its URL, and the analytics
// beacon reads utm_* from location.search; a redirect would lose that
// attribution. No PHP in the plugin or theme reads these params (grep,
// 2026-10-13). When the ORIGIN redirects a stripped request (redirect_canonical:
// a missing slash, ?p=N, a renamed slug), withRestoredParams() re-appends the
// stripped params to a same-origin Location, so the browser still lands tagged.
//
// The list is APO's baseline. Keys match exactly and case-sensitively: `ref`
// goes, `ref_src` and `referrer` stay. Other params keep their order and their
// bytes (no URLSearchParams, which would re-encode `%20` as `+`).

const EXACT = new Set(["fbclid", "gclid", "dclid", "msclkid", "mc_cid", "mc_eid", "ref"]);
const isMarketing = (key) => key.startsWith("utm_") || EXACT.has(key);

// A request whose response must not be the shared anonymous page, or whose
// path is not a page at all, passes through untouched.
const SKIP_KEYS = new Set([
  "preview", "preview_id", "preview_nonce", "rest_route",
  "customize_changeset_uuid", "customize_theme", "customize_messenger_channel",
]);
const SKIP_PATH = /^\/(?:wp-|xmlrpc\.php|_sn\/|sn-login(?:\/|$))/;
const HAS_EXTENSION = /\.[^/]*$/;

/** The URL the page passthrough should fetch, or null to forward the request as it came. */
export function strippedForwardUrl(request) {
  return stripMarketing(request)?.url ?? null;
}

/**
 * null, or { url, removed }: `url` is the request's URL without marketing
 * params, `removed` the stripped pairs joined by "&", in order and as sent.
 */
export function stripMarketing(request) {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  const url = new URL(request.url);
  if (url.search.length < 2) return null;
  if (SKIP_PATH.test(url.pathname) || HAS_EXTENSION.test(url.pathname)) return null;
  if ((request.headers.get("cookie") || "").includes("wordpress_logged_in_")) return null;

  const pairs = url.search.slice(1).split("&");
  const keys = pairs.map((p) => p.split("=", 1)[0]);
  if (keys.some((k) => SKIP_KEYS.has(k))) return null;
  const removed = pairs.filter((_, i) => isMarketing(keys[i]));
  if (removed.length === 0) return null;
  // Empty pairs (`?&a`, `a&`, `a&&b`) go too once the query is rebuilt.
  const kept = pairs.filter((p, i) => p !== "" && !isMarketing(keys[i]));
  url.search = kept.length ? `?${kept.join("&")}` : "";
  return { url: url.href, removed: removed.join("&") };
}

/**
 * An origin 3xx to a same-origin Location, with the stripped params appended
 * after whatever query that Location carries. Anything else comes back as is.
 */
export function withRestoredParams(response, requestUrl, removed) {
  if (!removed || response.status < 300 || response.status > 399) return response;
  const location = response.headers.get("location");
  if (!location) return response;
  let target;
  try {
    target = new URL(location, requestUrl);
  } catch {
    return response;
  }
  if (target.origin !== new URL(requestUrl).origin) return response;
  target.search = target.search.length > 1 ? `${target.search}&${removed}` : `?${removed}`;
  const headers = new Headers(response.headers);
  headers.set("location", target.href);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
