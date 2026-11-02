import { sign } from "web-bot-auth";
import { signerFromJWK } from "web-bot-auth/crypto";
const helpers = { WEBCRYPTO_SHA256: (b) => crypto.subtle.digest("SHA-256", b), BASE64URL_DECODE: (b) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") };
import { jwkThumbprint } from "jsonwebkey-thumbprint";

/**
 * Generate a keypair, sign a request with it, and return the request together
 * with the directory that publishes the matching public key.
 *
 * The fixture derives its own thumbprint rather than importing the module under
 * test, so a change in how that module derives one cannot silently agree with
 * itself. That is the whole point of a negative control.
 */
export async function signWithFixture(url, agent = "https://signature-agent.test") {
  const pair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const privateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const pub = { kty: publicJwk.kty, crv: publicJwk.crv, x: publicJwk.x };
  const thumbprint = await jwkThumbprint(pub, helpers.WEBCRYPTO_SHA256, helpers.BASE64URL_DECODE);

  const created = new Date();
  const expires = new Date(created.getTime() + 300_000);
  const unsigned = new Request(url, { headers: { "signature-agent": `"${agent}"` } });
  const f = await sign(unsigned, { signer: await signerFromJWK(privateJwk), created, expires });
  const headers = { Signature: f.signature, "Signature-Input": f.signatureInput };

  return {
    thumbprint,
    request: new Request(url, {
      headers: {
        "signature-agent": `"${agent}"`,
        // Cloudflare sets this on every real request; the directory-fetch
        // limiter (1.32.1) keys on it and refuses a request without it.
        "cf-connecting-ip": "203.0.113.7",
        Signature: headers["Signature"],
        "Signature-Input": headers["Signature-Input"],
      },
    }),
    directory: { keys: [pub] },
  };
}
