import { beforeEach, describe, expect, it, vi } from "vitest";
import { handSign, keyPair } from "./helpers/hand-sign.mjs";
import {
  resolveSignatureState,
  SIG_INVALID,
  SIG_UNKNOWN_KEY,
  SIG_UNSIGNED,
  SIG_VALID,
} from "../src/web-bot-auth.mjs";

// What resolveSignatureState answers today, pinned against a signer that does
// not use the library under test. A library upgrade must leave every row as it
// is; a row that moves is a behavior change and needs the owner, not a port.
const env = { WEBMCP_LIMITER: { limit: async () => ({ success: true }) } };
const URL_ = "https://juanlentino.com/notes/x";
const nowS = () => Math.floor(Date.now() / 1000);
let n = 0;
const agent = () => `https://agent-eq-${++n}.test`; // a fresh origin: the directory cache is per origin

function publish(...keys) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ keys })));
}

async function state(opts = {}, { published, dirKey } = {}) {
  const key = await keyPair();
  const a = agent();
  const spy = publish(...(published ?? [dirKey ?? key.pub]));
  const result = await resolveSignatureState(await handSign(URL_, a, key, opts), env);
  return { result, spy, key };
}

describe("web-bot-auth equivalence: the four states", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("valid: a conforming signature over @authority and signature-agent", async () => {
    expect((await state()).result).toBe(SIG_VALID);
  });

  it("invalid: expired", async () => {
    expect((await state({ created: nowS() - 600, expires: nowS() - 60 })).result).toBe(SIG_INVALID);
  });

  it("invalid: created in the future", async () => {
    expect((await state({ created: nowS() + 120, expires: nowS() + 600 })).result).toBe(SIG_INVALID);
  });

  it("invalid: tag is not web-bot-auth", async () => {
    expect((await state({ tag: "something-else" })).result).toBe(SIG_INVALID);
  });

  it("invalid: no expires parameter", async () => {
    expect((await state({ expires: null })).result).toBe(SIG_INVALID);
  });

  it("invalid: the wrong key signed under a published keyid", async () => {
    const published = await keyPair();
    const { result } = await state({ keyid: published.kid }, { published: [published.pub] });
    expect(result).toBe(SIG_INVALID);
  });

  it("invalid: signature bytes do not verify", async () => {
    const bogus = `sig1=:${btoa("x".repeat(64))}:`;
    expect((await state({ signature: bogus })).result).toBe(SIG_INVALID);
  });

  it("invalid: malformed Signature header", async () => {
    expect((await state({ signature: "sig1=not-a-byte-sequence" })).result).toBe(SIG_INVALID);
  });

  it("invalid: Signature label differs from Signature-Input's", async () => {
    expect((await state({ signature: `sig9=:${btoa("x".repeat(64))}:` })).result).toBe(SIG_INVALID);
  });

  it("unknown-key: the directory answers without this key", async () => {
    const other = await keyPair();
    expect((await state({}, { published: [other.pub] })).result).toBe(SIG_UNKNOWN_KEY);
  });

  it("unsigned, with no fetch: no Signature-Agent header", async () => {
    const { result, spy } = await state({ sendAgent: false });
    expect(result).toBe(SIG_UNSIGNED);
    expect(spy).not.toHaveBeenCalled();
  });

  it("unsigned, with no fetch: no keyid", async () => {
    const { result, spy } = await state({ keyid: null });
    expect(result).toBe(SIG_UNSIGNED);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("web-bot-auth equivalence: key resolution", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("a directory JWK's own alg and kid fields do not change the verdict", async () => {
    const key = await keyPair();
    const a = agent();
    publish({ ...key.pub, alg: "Ed25519", kid: "not-the-thumbprint", use: "sig" });
    expect(await resolveSignatureState(await handSign(URL_, a, key), env)).toBe(SIG_VALID);
  });

  it("an Ed25519 key is found among non-Ed25519 entries", async () => {
    const key = await keyPair();
    const a = agent();
    publish({ kty: "RSA", n: "AQAB", e: "AQAB" }, { kty: "OKP", crv: "X25519", x: key.pub.x }, key.pub);
    expect(await resolveSignatureState(await handSign(URL_, a, key), env)).toBe(SIG_VALID);
  });
});

// Today's verifier accepts each of these. web-bot-auth 0.2.0 refuses the first
// five, and no VerifyOptions field turns those checks off.
describe("web-bot-auth equivalence: lenient today", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("valid: no alg parameter", async () => {
    expect((await state({ alg: null })).result).toBe(SIG_VALID);
  });

  it("valid: an alg parameter that does not name the key's algorithm", async () => {
    expect((await state({ alg: "rsa-pss-sha512" })).result).toBe(SIG_VALID);
  });

  it("valid: @authority not covered", async () => {
    expect((await state({ components: ["signature-agent"] })).result).toBe(SIG_VALID);
  });

  it("valid: the Signature-Agent header sent but not covered", async () => {
    expect((await state({ components: ["@authority"] })).result).toBe(SIG_VALID);
  });

  it("valid: a nonce that is not 64 base64 bytes", async () => {
    expect((await state({ nonce: "abc" })).result).toBe(SIG_VALID);
  });

  it("valid: created two days ago, not yet expired", async () => {
    expect((await state({ created: nowS() - 172800 })).result).toBe(SIG_VALID);
  });
});
