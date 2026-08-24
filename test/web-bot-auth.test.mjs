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
