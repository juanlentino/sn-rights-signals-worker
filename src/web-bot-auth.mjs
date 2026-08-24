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
