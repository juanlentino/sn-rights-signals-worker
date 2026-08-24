import { describe, expect, it } from "vitest";
import { hasWebBotAuthHeaders } from "../src/web-bot-auth.mjs";

const req = (headers) => new Request("https://juanlentino.com/notes/x", { headers });

describe("hasWebBotAuthHeaders", () => {
  it("is false for an ordinary browser request", () => {
    expect(hasWebBotAuthHeaders(req({ "user-agent": "Mozilla/5.0" }))).toBe(false);
  });

  it("is false when only one of the two headers is present", () => {
    expect(hasWebBotAuthHeaders(req({ signature: "sig2=:abc:" }))).toBe(false);
    expect(hasWebBotAuthHeaders(req({ "signature-input": 'sig2=("@authority")' }))).toBe(false);
  });

  it("is true when both are present", () => {
    expect(
      hasWebBotAuthHeaders(req({ signature: "sig2=:abc:", "signature-input": 'sig2=("@authority")' }))
    ).toBe(true);
  });
});

import { keyIdFromSignatureInput, signatureAgentOrigin } from "../src/web-bot-auth.mjs";

describe("signatureAgentOrigin", () => {
  it("reads a structured string in double quotes", () => {
    expect(signatureAgentOrigin(req({ "signature-agent": '"https://signature-agent.test"' })))
      .toBe("https://signature-agent.test");
  });

  it("rejects an unquoted value (a dictionary, not a structured string)", () => {
    expect(signatureAgentOrigin(req({ "signature-agent": "https://signature-agent.test" }))).toBe(null);
  });

  it("rejects a non-https scheme", () => {
    expect(signatureAgentOrigin(req({ "signature-agent": '"http://insecure.test"' }))).toBe(null);
  });

  it("is null when the header is absent", () => {
    expect(signatureAgentOrigin(req({}))).toBe(null);
  });
});

describe("keyIdFromSignatureInput", () => {
  it("extracts the thumbprint keyid", () => {
    const h = 'sig2=("@authority" "signature-agent");created=1735689600;keyid="poqkLGiymh_W0uP6PZFw-dvez3QJT5SolqXBCW38r0U";alg="ed25519";expires=1735693200;tag="web-bot-auth"';
    expect(keyIdFromSignatureInput(h)).toBe("poqkLGiymh_W0uP6PZFw-dvez3QJT5SolqXBCW38r0U");
  });

  it("is null when no keyid parameter is present", () => {
    expect(keyIdFromSignatureInput('sig2=("@authority");alg="ed25519"')).toBe(null);
  });
});

import { beforeEach, vi } from "vitest";
import { fetchDirectoryKeys } from "../src/web-bot-auth.mjs";

const DIRECTORY = {
  keys: [{ kty: "OKP", crv: "Ed25519", x: "JrQLj5P_89iXES9-vFgrIy29clF9CC_oPPsw3c5D0bs" }],
};

describe("fetchDirectoryKeys", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("requests the well-known directory path and returns its keys", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(DIRECTORY), { headers: { "content-type": "application/json" } })
    );
    const keys = await fetchDirectoryKeys("https://agent-ok.test");
    expect(spy.mock.calls[0][0]).toBe(
      "https://agent-ok.test/.well-known/http-message-signatures-directory"
    );
    expect(keys).toHaveLength(1);
  });

  it("returns an empty array when the directory 404s, and does not throw", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 404 }));
    await expect(fetchDirectoryKeys("https://agent-404.test")).resolves.toEqual([]);
  });

  it("returns an empty array when the body is not JSON", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("<html>"));
    await expect(fetchDirectoryKeys("https://agent-notjson.test")).resolves.toEqual([]);
  });

  it("refuses a body larger than the cap", async () => {
    const huge = JSON.stringify({ keys: new Array(20000).fill(DIRECTORY.keys[0]) });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(huge));
    await expect(fetchDirectoryKeys("https://agent-huge.test")).resolves.toEqual([]);
  });
});

import { signWithFixture } from "./helpers/sign-fixture.mjs";
import {
  resolveSignatureState,
  SIG_INVALID,
  SIG_UNKNOWN_KEY,
  SIG_UNSIGNED,
  SIG_VALID,
} from "../src/web-bot-auth.mjs";

describe("resolveSignatureState", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("is unsigned, and performs NO fetch, when the headers are absent", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    expect(await resolveSignatureState(req({ "user-agent": "GPTBot" }))).toBe(SIG_UNSIGNED);
    expect(spy).not.toHaveBeenCalled();
  });

  it("is valid for a correctly signed request whose key is published", async () => {
    const { request, directory } = await signWithFixture("https://juanlentino.com/n/1", "https://agent-valid.test");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(directory)));
    expect(await resolveSignatureState(request)).toBe(SIG_VALID);
  });

  it("is invalid when the signature bytes are tampered with", async () => {
    const { request, directory } = await signWithFixture("https://juanlentino.com/n/2", "https://agent-tampered.test");
    const tampered = new Request("https://juanlentino.com/n/2", {
      headers: {
        "signature-agent": '"https://agent-tampered.test"',
        "signature-input": request.headers.get("signature-input"),
        signature: "sig1=:GhijKLmnOPqrSTuvWXyz0123456789abcdefGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789AB==:",
      },
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(directory)));
    expect(await resolveSignatureState(tampered)).toBe(SIG_INVALID);
  });

  it("is unknown-key when the directory publishes keys but not THIS one", async () => {
    const { request } = await signWithFixture("https://juanlentino.com/n/3", "https://agent-nokey.test");
    // A DIFFERENT signer's directory: well-formed, reachable, and simply does
    // not vouch for the key that signed this request.
    const other = await signWithFixture("https://juanlentino.com/n/3b", "https://agent-other.test");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(other.directory)));
    expect(await resolveSignatureState(request)).toBe(SIG_UNKNOWN_KEY);
  });

  it("degrades to unsigned when the directory is empty — indistinguishable from a failed fetch", async () => {
    const { request } = await signWithFixture("https://juanlentino.com/n/3c", "https://agent-empty.test");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ keys: [] })));
    expect(await resolveSignatureState(request)).toBe(SIG_UNSIGNED);
  });

  it("degrades to unsigned when the directory is unreachable", async () => {
    const { request } = await signWithFixture("https://juanlentino.com/n/4", "https://agent-down.test");
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network"));
    expect(await resolveSignatureState(request)).toBe(SIG_UNSIGNED);
  });
});
