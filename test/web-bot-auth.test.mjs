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
