// Traffic Lanes Phase 1: the owner agent token (signal-and-noise-tools
// docs/plans/traffic-lanes-2026-10-15.md, "Phase 1 build contract").
//
//   SN-Owner-Agent: v1.<agent>.<exp>.<sig>
//   sig = base64url (no padding) of HMAC-SHA256(key, "v1|agent|<agent>|<exp>")
//
// The key is 32 raw bytes, held as 64 hex characters in SN_OWNER_KEY (and
// SN_OWNER_KEY_PREVIOUS during a rotation). It is the ONE owner key (owner
// decision 2026-10-15): the analytics Worker signs-checks the device marker
// with the same secret. The messages are domain-separated (`v1|agent|...`
// here, `v1|dev|...` there), so a marker can never pass as a token. Valid iff the signature
// matches either key AND now < exp AND exp - now <= 12h + 5m. The plugin mints
// tokens (`wp sn owner-token`); expiry and key rotation are the only revocation.
//
// Identity codes stored on this sensor: 2 owner_token, 3 owner_token_invalid,
// 0 otherwise. Codes 1, 4 and 5 are device and cookie facts this sensor never
// sees. The header value is never logged, stored or echoed; src/index.mjs
// strips it before anything reaches the origin.

export const OWNER_AGENT_HEADER = "sn-owner-agent";

export const IDENTITY_NONE = 0;
export const IDENTITY_OWNER_TOKEN = 2;
export const IDENTITY_OWNER_TOKEN_INVALID = 3;

/** Agent allowlist and its codes, shared with the plugin and the analytics Worker. */
export const AGENT_CODES = Object.freeze({
  browser: 1,
  "chrome-extension": 2,
  "claude-code": 3,
  playwright: 4,
  script: 5,
  "mcp-local": 6,
  other: 7,
});

const MAX_TTL_SECONDS = 43200 + 300;
// 32 bytes are 43 base64url characters; the last carries 2 unused bits, which
// must be zero, so one signature has exactly one spelling.
const TOKEN_RE = /^v1\.([a-z-]+)\.([1-9]\d{0,11})\.([A-Za-z0-9_-]{42}[AEIMQUYcgkosw048])$/;
const KEY_RE = /^[0-9a-fA-F]{64}$/;

const encoder = new TextEncoder();
const keyCache = new Map();
let keyUnsetLogged = false;
// Review round 1: invalid tokens are counted here, in isolate memory, and never
// in Analytics Engine, so a junk header cannot buy a row. Resets on eviction.
let invalidTokenCount = 0;

/** Test seam: module state persists across cases within a pool isolate. */
/** Code-3 requests seen by this isolate (best effort, resets on eviction). */
export function getInvalidTokenCount() {
  return invalidTokenCount;
}

export function _resetOwnerAgentForTests() {
  keyUnsetLogged = false;
  invalidTokenCount = 0;
  keyCache.clear();
}

function importKey(hex) {
  if (!keyCache.has(hex)) {
    const raw = Uint8Array.from(hex.match(/../g), (h) => parseInt(h, 16));
    keyCache.set(hex, crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["verify"]));
  }
  return keyCache.get(hex);
}

function b64urlDecode(s) {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=");
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/**
 * @returns {Promise<{identity:number, agent:number}|null>} null when the request
 *   carries no header or an empty one (review round 1: empty = absent); identity 0 when no key is configured (no verdict, so a
 *   missing secret never makes the owner's tools look forged).
 */
export async function verifyOwnerAgent(request, env, nowSeconds = Math.floor(Date.now() / 1000)) {
  const value = request.headers.get(OWNER_AGENT_HEADER);
  if (value === null || value === "") return null;

  const keys = [env?.SN_OWNER_KEY, env?.SN_OWNER_KEY_PREVIOUS].filter((k) => typeof k === "string" && KEY_RE.test(k));
  if (keys.length === 0) {
    if (!keyUnsetLogged) {
      keyUnsetLogged = true;
      console.warn("[owner-agent] owner_key_unset: SN_OWNER_KEY is unset or not 64 hex characters; tokens get no verdict");
    }
    return { identity: IDENTITY_NONE, agent: 0 };
  }

  const result = await check(value, keys, nowSeconds);
  if (result.identity === IDENTITY_OWNER_TOKEN_INVALID) invalidTokenCount += 1;
  return result;
}

async function check(value, keys, nowSeconds) {
  const invalid = { identity: IDENTITY_OWNER_TOKEN_INVALID, agent: 0 };
  const m = TOKEN_RE.exec(value);
  if (!m) return invalid;
  const [, agent, expRaw, sigRaw] = m;
  const exp = Number(expRaw);
  if (!Object.hasOwn(AGENT_CODES, agent) || !(nowSeconds < exp) || exp - nowSeconds > MAX_TTL_SECONDS) return invalid;

  const sig = b64urlDecode(sigRaw);
  const message = encoder.encode(`v1|agent|${agent}|${expRaw}`);
  for (const hex of keys) {
    // subtle.verify compares the MAC in constant time.
    if (await crypto.subtle.verify("HMAC", await importKey(hex), sig, message)) {
      return { identity: IDENTITY_OWNER_TOKEN, agent: AGENT_CODES[agent] };
    }
  }
  return invalid;
}
