import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetSensorStateForTests,
  classifyMachineReader,
  classifySurface,
  getSensorState,
  machineReadersResponse,
  observeMachineReader,
} from "../src/machine-readers.mjs";
import { TAXONOMY_VERSION } from "../src/taxonomy.mjs";

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

  it("writes one datapoint: family + surface + vendor/purpose blobs, count double, family index", () => {
    const writes = [];
    const env = { SN_MR: { writeDataPoint: (p) => writes.push(p) } };
    const out = observeMachineReader(req("GPTBot/1.0"), env, "/llms.txt");
    expect(out).toEqual({ family: "openai", surface: "llms", vendor: "openai", purpose: "train" });
    expect(writes).toHaveLength(1);
    // Pinned VALUE-level and positionally: blob order is the read query's
    // contract (blob3 AS vendor, blob4 AS purpose ...), so a reordering here
    // would silently relabel every column downstream while still "passing" any
    // test that only checked the array length or the set of values.
    expect(writes[0]).toEqual({
      blobs: ["openai", "llms", "openai", "train", TAXONOMY_VERSION, "1", "0", ""],
      doubles: [1],
      indexes: ["openai"],
    });
  });

  it("leaves blob1 (family) untouched where the frozen classifier and the taxonomy disagree", () => {
    // RULE 1, the load-bearing case. Claude-SearchBot has never matched the
    // frozen family regex, so it counts as other-bot and MUST GO ON counting as
    // other-bot — while still becoming visible as anthropic/search.
    const writes = [];
    const env = { SN_MR: { writeDataPoint: (p) => writes.push(p) } };
    observeMachineReader(req("Mozilla/5.0 (compatible; Claude-SearchBot/1.0)"), env, "/llms.txt");
    expect(writes[0].blobs[0]).toBe("other-bot");
    expect(writes[0].indexes).toEqual(["other-bot"]);
    expect(writes[0].blobs[2]).toBe("anthropic");
    expect(writes[0].blobs[3]).toBe("search");
  });

  it("records previously-invisible machines under the ADDITIVE family only", () => {
    // facebookexternalhit returns null from the frozen classifier, so before
    // v1.11.0 it wrote nothing at all and was indistinguishable from a human.
    const writes = [];
    const env = { SN_MR: { writeDataPoint: (p) => writes.push(p) } };
    observeMachineReader(req("facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)"), env, "/");
    expect(writes[0].blobs[0]).toBe("unclassified-machine");
    expect(writes[0].blobs[2]).toBe("meta");
    expect(writes[0].blobs[3]).toBe("social");
  });

  it("samples the UA only when the taxonomy did not match, and never otherwise", () => {
    const writes = [];
    const env = { SN_MR: { writeDataPoint: (p) => writes.push(p) } };
    // Known agent: nothing stored beyond the enums.
    observeMachineReader(req("GPTBot/1.0"), env, "/");
    expect(writes[0].blobs[7]).toBe("");
    // Unknown agent that the family regex still catches: sampled, sanitised.
    observeMachineReader(req("Mozilla/5.0 (compatible; NeverSeenBot/9.9; <script>x</script>)"), env, "/");
    expect(writes[1].blobs[3]).toBe("unknown");
    expect(writes[1].blobs[7]).toContain("NeverSeenBot/9.9");
    expect(writes[1].blobs[7]).not.toContain("<");
    expect(writes[1].blobs[7]).not.toContain(">");
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

describe("sensor-alive state — dead sensor and quiet dataset are different answers", () => {
  const req = (ua) => new Request("https://juanlentino.com/llms.txt", { headers: ua ? { "user-agent": ua } : {} });

  beforeEach(() => {
    _resetSensorStateForTests();
  });

  it("starts null across the board (never-attempted, not measured-dead)", () => {
    expect(getSensorState()).toEqual({ ae_bound: null, last_write_ok: null, last_write_at: null, last_error: null });
  });

  it("records a successful write: bound, ok, timestamped, no error", () => {
    const env = { SN_MR: { writeDataPoint: () => {} } };
    expect(observeMachineReader(req("GPTBot/1.0"), env, "/llms.txt")).toEqual({
      family: "openai",
      surface: "llms",
      vendor: "openai",
      purpose: "train",
    });
    const s = getSensorState();
    expect(s.ae_bound).toBe(true);
    expect(s.last_write_ok).toBe(true);
    expect(typeof s.last_write_at).toBe("string");
    expect(Number.isFinite(Date.parse(s.last_write_at))).toBe(true);
    expect(s.last_error).toBeNull();
  });

  it("records a throwing write: ok false, error captured, console.error fired, still returns null", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const env = { SN_MR: { writeDataPoint: () => { throw new Error("ae down"); } } };
    expect(observeMachineReader(req("GPTBot/1.0"), env, "/llms.txt")).toBeNull();
    const s = getSensorState();
    expect(s.ae_bound).toBe(true);
    expect(s.last_write_ok).toBe(false);
    expect(s.last_error).toBe("ae down");
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0][0]).toContain("ae down");
    spy.mockRestore();
  });

  it("records an unbound binding: ae_bound false, no throw, loud in the log", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(observeMachineReader(req("GPTBot/1.0"), {}, "/llms.txt")).toBeNull();
    const s = getSensorState();
    expect(s.ae_bound).toBe(false);
    expect(s.last_write_ok).toBeNull(); // no write was ever attempted
    expect(s.last_error).toContain("SN_MR binding missing");
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });

  it("a human UA is not a write attempt: state untouched beyond ae_bound", () => {
    const env = { SN_MR: { writeDataPoint: () => {} } };
    observeMachineReader(req("Mozilla/5.0 (Windows NT 10.0) Chrome/126.0 Safari/537.36"), env, "/");
    const s = getSensorState();
    expect(s.ae_bound).toBe(true);
    expect(s.last_write_ok).toBeNull();
    expect(s.last_write_at).toBeNull();
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
