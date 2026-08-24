import { signatureHeaders } from "web-bot-auth";
import { helpers, signerFromJWK } from "web-bot-auth/crypto";
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
  const headers = await signatureHeaders(
    unsigned,
    await signerFromJWK({ ...privateJwk, kid: thumbprint }),
    { created, expires }
  );

  return {
    thumbprint,
    request: new Request(url, {
      headers: {
        "signature-agent": `"${agent}"`,
        Signature: headers["Signature"],
        "Signature-Input": headers["Signature-Input"],
      },
    }),
    directory: { keys: [pub] },
  };
}
