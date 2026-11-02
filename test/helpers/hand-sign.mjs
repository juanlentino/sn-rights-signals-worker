/**
 * An RFC 9421 signer written against WebCrypto alone, with no web-bot-auth and
 * no jsonwebkey-thumbprint. The equivalence tests sign through this so the
 * fixture stays the same whichever library version src/web-bot-auth.mjs uses:
 * a fixture built on the library would move with it and agree with itself.
 */
const b64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const b64url = (bytes) => b64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** RFC 7638 thumbprint of an Ed25519 public JWK: members in lexical order. */
export async function thumbprint({ crv, kty, x }) {
  const json = JSON.stringify({ crv, kty, x });
  return b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(json)));
}

export async function keyPair() {
  const pair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const pub = { kty: jwk.kty, crv: jwk.crv, x: jwk.x };
  return { privateKey: pair.privateKey, pub, kid: await thumbprint(pub) };
}

const nowS = () => Math.floor(Date.now() / 1000);

/**
 * Sign a GET to `url` as `agent`. Every field is overridable, and `null` drops
 * a parameter, so a test can build exactly the non-conforming input it names.
 */
export async function handSign(url, agent, key, opts = {}) {
  const {
    components = ["@authority", "signature-agent"],
    created = nowS() - 5,
    expires = nowS() + 300,
    keyid = key.kid,
    alg = "ed25519",
    tag = "web-bot-auth",
    nonce,
    sendAgent = true,
    signature,
  } = opts;
  const agentHeader = `"${agent}"`;
  const host = new URL(url).host;
  const params = [
    `(${components.map((c) => `"${c}"`).join(" ")})`,
    created !== null && `created=${created}`,
    keyid !== null && `keyid="${keyid}"`,
    alg !== null && `alg="${alg}"`,
    expires !== null && `expires=${expires}`,
    nonce !== undefined && `nonce="${nonce}"`,
    tag !== null && `tag="${tag}"`,
  ].filter(Boolean);
  const input = params[0] + (params.length > 1 ? ";" + params.slice(1).join(";") : "");
  const lines = components.map((c) => `"${c}": ${c === "@authority" ? host : agentHeader}`);
  lines.push(`"@signature-params": ${input}`);
  const sig = await crypto.subtle.sign("Ed25519", key.privateKey, new TextEncoder().encode(lines.join("\n")));
  const headers = {
    "cf-connecting-ip": "203.0.113.7",
    "signature-input": `sig1=${input}`,
    signature: signature ?? `sig1=:${b64(sig)}:`,
  };
  if (sendAgent) headers["signature-agent"] = agentHeader;
  return new Request(url, { headers });
}
