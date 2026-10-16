// 2026-10-16 security audit, 1.32.1. Each case below failed against 1.32.0.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { signatureAgentOrigin, resolveSignatureState, SIG_UNSIGNED, SIG_VALID } from "../src/web-bot-auth.mjs";
import { observeMachineReader } from "../src/machine-readers.mjs";
import { signWithFixture } from "./helpers/sign-fixture.mjs";

const agentHeader = (origin) => new Request("https://juanlentino.com/", { headers: { "signature-agent": `"${origin}"` } });

describe("L1: a Signature-Agent that names a non-public host is never fetched", () => {
  it.each([
    "https://127.0.0.1",
    "https://2130706433",   // decimal IPv4; the URL parser folds it to 127.0.0.1
    "https://0x7f.0.0.1",   // hex IPv4
    "https://169.254.169.254",
    "https://[::1]",
    "https://localhost",
    "https://LOCALHOST.",
    "https://agent.localhost",
  ])("rejects %s", (origin) => {
    expect(signatureAgentOrigin(agentHeader(origin))).toBe(null);
  });

  it("still accepts a public https host", () => {
    expect(signatureAgentOrigin(agentHeader("https://agent.example"))).toBe("https://agent.example");
  });
});

describe("L1: the directory fetch is per-IP rate-limited (WEBMCP_LIMITER, wba-dir: bucket)", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("over the limit: no fetch, unsigned", async () => {
    const { request, directory } = await signWithFixture("https://juanlentino.com/s/1", "https://agent-over.test");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(directory)));
    const keys = [];
    const env = { WEBMCP_LIMITER: { limit: async ({ key }) => { keys.push(key); return { success: false }; } } };
    expect(await resolveSignatureState(request, env)).toBe(SIG_UNSIGNED);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(keys).toEqual(["wba-dir:203.0.113.7"]);
  });

  it.each([
    ["unbound", {}],
    ["throwing", { WEBMCP_LIMITER: { limit: async () => { throw new Error("down"); } } }],
  ])("a %s limiter fails closed: no fetch", async (_n, env) => {
    const { request, directory } = await signWithFixture("https://juanlentino.com/s/2", `https://agent-${_n}.test`);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(directory)));
    expect(await resolveSignatureState(request, env)).toBe(SIG_UNSIGNED);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("a refusal caches nothing: the next admitted request fetches and verifies", async () => {
    const { request, directory } = await signWithFixture("https://juanlentino.com/s/3", "https://agent-retry.test");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(directory)));
    const no = { WEBMCP_LIMITER: { limit: async () => ({ success: false }) } };
    const yes = { WEBMCP_LIMITER: { limit: async () => ({ success: true }) } };
    expect(await resolveSignatureState(request, no)).toBe(SIG_UNSIGNED);
    expect(await resolveSignatureState(request, yes)).toBe(SIG_VALID);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe("L2: at most 30 rights-detail rows per IP per minute; the aggregate still counts", () => {
  // Fresh IPs, no reset seam: the cap is per isolate and per minute.
  const read = (ip, env) => observeMachineReader(
    new Request("https://juanlentino.com/license.xml", { headers: { "user-agent": "Mozilla/5.0 (compatible; GPTBot/1.0)", "cf-connecting-ip": ip } }),
    env, "/license.xml");

  it("caps one IP's detail rows and leaves another IP's alone", () => {
    const agg = [], detail = [];
    const env = { SN_MR: { writeDataPoint: (d) => agg.push(d) }, SN_MR_RIGHTS: { writeDataPoint: (d) => detail.push(d) } };
    for (let i = 0; i < 35; i++) read("198.51.100.1", env);
    expect(agg).toHaveLength(35);    // every read still counted
    expect(detail).toHaveLength(30); // detail capped
    read("198.51.100.2", env);
    expect(detail).toHaveLength(31);
  });
});
