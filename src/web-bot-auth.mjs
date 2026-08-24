/**
 * Web Bot Auth signature verification — a SENSOR, never a gate.
 *
 * Web Bot Auth (RFC 9421 HTTP Message Signatures, carried in Signature,
 * Signature-Input and Signature-Agent) lets an agent prove its identity
 * cryptographically instead of asserting it in a user-agent string anyone can
 * type. Cloudflare exposes the verdict as cf.bot_management.signed_agent, which
 * needs Enterprise with Bot Management; this zone does not have it, so the
 * check happens here — the same reasoning that put markdown negotiation in this
 * worker rather than renting it from a plan tier.
 *
 * NOTHING IN THIS MODULE MAY ALTER A RESPONSE. Every failure path resolves to
 * SIG_UNSIGNED, because "we could not tell" and "it did not sign" are the same
 * fact from the dataset's point of view, and neither is grounds for treating a
 * reader differently.
 *
 * @since 1.19.0
 */

export const SIG_UNSIGNED = "unsigned";
export const SIG_VALID = "valid";
export const SIG_INVALID = "invalid";
export const SIG_UNKNOWN_KEY = "unknown-key";

/**
 * Cheap synchronous gate. No network, no parsing, no crypto.
 *
 * This is the cost design of the whole feature: this worker runs on every
 * request to the zone, so a request that returns false here must cost two
 * header reads and nothing else. A test asserts that an unsigned request
 * performs no fetch at all.
 */
export function hasWebBotAuthHeaders(request) {
  return !!(request.headers.get("signature-input") && request.headers.get("signature"));
}

/**
 * The Signature-Agent header is a structured STRING — double-quoted — not a
 * dictionary. Cloudflare's own troubleshooting list names the unquoted form as
 * the most common integration error, so an unquoted value is treated as ABSENT
 * rather than repaired: guessing what a malformed header meant is how a sensor
 * starts reporting things that were never sent.
 */
export function signatureAgentOrigin(request) {
  const raw = request.headers.get("signature-agent");
  if (!raw) return null;
  const m = /^"([^"]+)"$/.exec(raw.trim());
  if (!m) return null;
  try {
    const url = new URL(m[1]);
    return url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

/** The keyid is the JWK thumbprint of the signing key, not a free-form name. */
export function keyIdFromSignatureInput(header) {
  if (typeof header !== "string") return null;
  const m = /;keyid="([^"]+)"/.exec(header);
  return m ? m[1] : null;
}

const DIRECTORY_PATH = "/.well-known/http-message-signatures-directory";
const DIRECTORY_TTL_S = 21600;       // 6 hours, positive
const DIRECTORY_FAIL_TTL_S = 900;    // 15 minutes, negative
const MAX_DIRECTORY_BYTES = 64 * 1024;
const FETCH_TIMEOUT_MS = 2000;

/**
 * Resolve an agent's published Ed25519 keys.
 *
 * Cached in the Cache API keyed by directory URL — a directory IS an HTTP
 * response, and colo-local caching is sufficient for a key set that rotates on
 * the order of months. FAILURES ARE CACHED TOO, on a shorter TTL: without that,
 * one broken or hostile directory means one outbound fetch per request, which
 * is the cost failure this whole design exists to avoid.
 *
 * Every failure returns [] rather than throwing. A caller cannot distinguish
 * "no keys" from "fetch failed", and must not: both mean the signature cannot
 * be checked, and both resolve to unsigned.
 */
export async function fetchDirectoryKeys(origin) {
  const url = origin + DIRECTORY_PATH;
  const cache = caches.default;
  const cacheKey = new Request(url, { method: "GET" });

  const hit = await cache.match(cacheKey);
  if (hit) {
    try {
      const body = await hit.json();
      return Array.isArray(body?.keys) ? body.keys : [];
    } catch {
      return [];
    }
  }

  let res;
  try {
    res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { accept: "application/http-message-signatures-directory+json, application/json" },
    });
  } catch {
    await cache.put(cacheKey, emptyDirectory(DIRECTORY_FAIL_TTL_S));
    return [];
  }

  if (!res.ok) {
    await cache.put(cacheKey, emptyDirectory(DIRECTORY_FAIL_TTL_S));
    return [];
  }

  const text = await res.text();
  if (text.length > MAX_DIRECTORY_BYTES) {
    await cache.put(cacheKey, emptyDirectory(DIRECTORY_FAIL_TTL_S));
    return [];
  }

  let keys = [];
  try {
    const body = JSON.parse(text);
    keys = Array.isArray(body?.keys) ? body.keys : [];
  } catch {
    await cache.put(cacheKey, emptyDirectory(DIRECTORY_FAIL_TTL_S));
    return [];
  }

  await cache.put(
    cacheKey,
    new Response(JSON.stringify({ keys }), {
      headers: {
        "content-type": "application/json",
        "cache-control": `public, max-age=${DIRECTORY_TTL_S}`,
      },
    })
  );
  return keys;
}

function emptyDirectory(ttl) {
  return new Response(JSON.stringify({ keys: [] }), {
    headers: { "content-type": "application/json", "cache-control": `public, max-age=${ttl}` },
  });
}
