import { describe, expect, it } from "vitest";
import {
  classifyMachineReader,
  classifySurface,
  machineReadersResponse,
  observeMachineReader,
} from "../src/machine-readers.mjs";

describe("classifyMachineReader — fixed enum, raw UA never escapes", () => {
  it("maps AI crawler UAs to their families", () => {
    expect(classifyMachineReader("Mozilla/5.0 (compatible; GPTBot/1.0)")).toBe("openai");
    expect(classifyMachineReader("Mozilla/5.0 (compatible; ClaudeBot/1.0)")).toBe("anthropic");
    expect(classifyMachineReader("Google-Extended")).toBe("google-ai");
    expect(classifyMachineReader("PerplexityBot/1.0")).toBe("perplexity");
    expect(classifyMachineReader("CCBot/2.0")).toBe("commoncrawl");
    expect(classifyMachineReader("Bytespider")).toBe("bytedance");
    expect(classifyMachineReader("Meta-ExternalAgent")).toBe("meta-ai");
  });

  it("orders specific before generic (applebot-extended vs applebot)", () => {
    expect(classifyMachineReader("Applebot-Extended/1.0")).toBe("apple-ai");
    expect(classifyMachineReader("Mozilla/5.0 (compatible; Applebot/0.1)")).toBe("search");
  });

  it("buckets generic automation as other-bot, never a raw string", () => {
    expect(classifyMachineReader("curl/8.4.0")).toBe("other-bot");
    expect(classifyMachineReader("python-requests/2.31")).toBe("other-bot");
    expect(classifyMachineReader("SomethingNewBot/9.9")).toBe("other-bot");
  });

  it("returns null for browsers and empty UAs (humans are the beacon pipeline's)", () => {
    expect(
      classifyMachineReader(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
      )
    ).toBeNull();
    expect(classifyMachineReader("")).toBeNull();
    expect(classifyMachineReader(null)).toBeNull();
  });
});

describe("classifySurface — fixed enum of surface classes", () => {
  it("classifies the machine surfaces", () => {
    expect(classifySurface("/robots.txt")).toBe("robots");
    expect(classifySurface("/.well-known/tdmrep.json")).toBe("rights");
    expect(classifySurface("/license.xml")).toBe("rights");
    expect(classifySurface("/tdm-policy/")).toBe("rights");
    expect(classifySurface("/llms.txt")).toBe("llms");
    expect(classifySurface("/llms-full.txt")).toBe("llms");
    expect(classifySurface("/.well-known/agents.json")).toBe("agents-manifest");
    expect(classifySurface("/.well-known/gpc.json")).toBe("well-known");
    expect(classifySurface("/feed/")).toBe("feed");
    expect(classifySurface("/feed/json/")).toBe("feed");
    expect(classifySurface("/wp-json/wp/v2/posts")).toBe("wp-json");
    expect(classifySurface("/wp-sitemap.xml")).toBe("sitemap");
    expect(classifySurface("/wp-content/themes/x/style.css")).toBe("asset");
    expect(classifySurface("/notes/some-note/")).toBe("html");
  });
});

describe("observeMachineReader — aggregate-only AE writes", () => {
  const req = (ua) => new Request("https://juanlentino.com/llms.txt", { headers: ua ? { "user-agent": ua } : {} });

  it("writes one datapoint: family + surface blobs, count double, family index", () => {
    const writes = [];
    const env = { SN_MR: { writeDataPoint: (p) => writes.push(p) } };
    const out = observeMachineReader(req("GPTBot/1.0"), env, "/llms.txt");
    expect(out).toEqual({ family: "openai", surface: "llms" });
    expect(writes).toHaveLength(1);
    expect(writes[0]).toEqual({ blobs: ["openai", "llms"], doubles: [1], indexes: ["openai"] });
  });

  it("records nothing for humans and never throws without a binding", () => {
    const writes = [];
    const env = { SN_MR: { writeDataPoint: (p) => writes.push(p) } };
    expect(observeMachineReader(req("Mozilla/5.0 (Windows NT 10.0) Chrome/126.0 Safari/537.36"), env, "/")).toBeNull();
    expect(writes).toHaveLength(0);
    expect(observeMachineReader(req("GPTBot/1.0"), {}, "/llms.txt")).toBeNull();
    const throwing = { SN_MR: { writeDataPoint: () => { throw new Error("ae down"); } } };
    expect(observeMachineReader(req("GPTBot/1.0"), throwing, "/llms.txt")).toBeNull();
  });
});

describe("machineReadersResponse — token-auth read path", () => {
  const mkReq = (token) =>
    new Request("https://juanlentino.com/_sn/rights-signals/machine-readers?days=7", {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });

  it("401s without or with a wrong bearer token", async () => {
    const env = { SN_MR_READ_TOKEN: "secret" };
    expect((await machineReadersResponse(mkReq(null), env)).status).toBe(401);
    expect((await machineReadersResponse(mkReq("wrong"), env)).status).toBe(401);
  });

  it("503s when the read path is not configured", async () => {
    expect((await machineReadersResponse(mkReq("x"), {})).status).toBe(503);
    const env = { SN_MR_READ_TOKEN: "secret" }; // no account id / SQL token
    expect((await machineReadersResponse(mkReq("secret"), env)).status).toBe(503);
  });
});
