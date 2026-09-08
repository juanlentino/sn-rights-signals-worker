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

import { verify } from "web-bot-auth";
import { helpers, verifierFromJWK } from "web-bot-auth/crypto";
import { jwkThumbprint } from "jsonwebkey-thumbprint";

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
    // redirect-ok: public HTTP-message-signatures key directory, no credential.
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

/**
 * Four states, never two.
 *
 * Collapsing these to signed/unsigned would erase the two populations that
 * would matter first if this ever became a gate: an agent signing incorrectly,
 * and an agent signing with a key nobody vouches for.
 *
 * An EMPTY or unreachable directory reads as `unsigned`, not `unknown-key` —
 * "the agent published nothing" and "we could not reach what it published" are
 * the same evidence, and neither says anything about the key itself.
 * `unknown-key` is reserved for a directory that answered, published keys, and
 * did not include this one.
 *
 * Anything unexpected resolves to SIG_UNSIGNED. This function has no failure
 * mode that reaches the caller.
 */
export async function resolveSignatureState(request) {
  try {
    if (!hasWebBotAuthHeaders(request)) return SIG_UNSIGNED;

    const origin = signatureAgentOrigin(request);
    const keyId = keyIdFromSignatureInput(request.headers.get("signature-input"));
    if (!origin || !keyId) return SIG_UNSIGNED;

    const keys = await fetchDirectoryKeys(origin);
    if (keys.length === 0) return SIG_UNSIGNED;

    let match = null;
    for (const jwk of keys) {
      if (jwk?.kty !== "OKP" || jwk?.crv !== "Ed25519" || typeof jwk?.x !== "string") continue;
      const tp = await jwkThumbprint(
        { kty: jwk.kty, crv: jwk.crv, x: jwk.x },
        helpers.WEBCRYPTO_SHA256,
        helpers.BASE64URL_DECODE
      );
      if (tp === keyId) { match = jwk; break; }
    }
    if (!match) return SIG_UNKNOWN_KEY;

    try {
      await verify(request, await verifierFromJWK({ ...match, kid: keyId }));
      return SIG_VALID;
    } catch {
      // verify() throws on a bad signature, an expired `expires`, or a
      // component mismatch. All three are the same finding: it signed, and the
      // signature does not hold.
      return SIG_INVALID;
    }
  } catch {
    return SIG_UNSIGNED;
  }
}
