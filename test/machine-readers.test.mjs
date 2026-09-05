import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetSensorStateForTests,
  classifyMachineReader,
  classifySurface,
  getSensorState,
  buildQuery,
  machineReadersResponse,
  observeMachineReader,
} from "../src/machine-readers.mjs";
import { TAXONOMY_VERSION } from "../src/taxonomy.mjs";
import { prefersMarkdown } from "../src/accept-markdown.mjs";

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

describe("markdown adoption signal (v1.18.0)", () => {
  // v1.16.0 opened a markdown door and left it unmeasurable: a markdown request
  // lands on a content page, classifies as `html`, and Accept is only retained
  // for rights surfaces. This axis is the answer to "does anyone use it?".
  function writeFor(accept) {
    const written = [];
    const env = { SN_MR: { writeDataPoint: (d) => written.push(d) } };
    const headers = { "user-agent": "Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)" };
    if (accept !== null) headers.accept = accept;
    observeMachineReader(new Request("https://juanlentino.com/notes/x/", { headers }), env, "/notes/x/");
    return written[0];
  }

  it("records markdown_requested=1 when the reader asks for markdown", () => {
    expect(writeFor("text/markdown").blobs[9]).toBe("1");
  });

  it("records markdown_requested=0 for an ordinary crawler fetch", () => {
    expect(writeFor("*/*").blobs[9]).toBe("0");
    expect(writeFor(null).blobs[9]).toBe("0");
  });

  it("uses the SAME predicate the Worker serves markdown with", () => {
    // Not a reimplementation: if these two ever diverge, the metric would
    // report adoption of a door that was not actually opened for that request.
    expect(writeFor("text/markdown, text/html;q=0.9").blobs[9]).toBe(prefersMarkdown("text/markdown, text/html;q=0.9") ? "1" : "0");
    expect(writeFor("text/html,application/xhtml+xml,*/*;q=0.8").blobs[9]).toBe("0");
  });

  it("is ADDITIVE — the first ten blobs keep their meaning and position", () => {
    const d = writeFor("text/markdown");
    expect(d.blobs).toHaveLength(11);
    expect(d.blobs[1]).toBe("html");        // surface unchanged: NOT drained into a new class
    expect(d.doubles).toEqual([1]);
    expect(d.indexes).toEqual([d.blobs[0]]); // still exactly one index, still family
  });

  it("does not move a markdown read out of the html surface", () => {
    // The whole reason this is a dimension and not a surface class.
    expect(writeFor("text/markdown").blobs[1]).toBe("html");
    expect(writeFor("*/*").blobs[1]).toBe("html");
  });
});

describe("agent-discovery is separate from well-known (v1.17.0)", () => {
  // The reason this class exists: "well-known" is inside the plugin's
  // snt_mr_rights_surfaces(), the set published as "a machine read the terms".
  // A server-card fetch is discovery, not terms, and was being counted as terms.
  it("does not classify a discovery document as a rights-bearing well-known file", () => {
    for (const p of ["/.well-known/mcp/server-card.json", "/.well-known/api-catalog", "/.well-known/ai-catalog.json"]) {
      expect(classifySurface(p)).not.toBe("well-known");
      expect(classifySurface(p)).not.toBe("rights");
    }
  });

  it("leaves the genuinely rights-bearing well-known files alone", () => {
    expect(classifySurface("/.well-known/tdmrep.json")).toBe("rights");
    expect(classifySurface("/.well-known/gpc.json")).toBe("well-known");
    expect(classifySurface("/.well-known/did.json")).toBe("well-known");
    expect(classifySurface("/.well-known/security.txt")).toBe("well-known");
  });

  // EXACT match, never a prefix: an unknown future file under /.well-known/mcp/
  // must land in "well-known" until someone classifies it deliberately.
  it("does not prefix-match its way into claiming unknown files", () => {
    expect(classifySurface("/.well-known/mcp/something-else.json")).toBe("well-known");
    expect(classifySurface("/.well-known/api-catalog-v2")).toBe("well-known");
    expect(classifySurface("/.well-known/ai-catalog.json.bak")).toBe("well-known");
  });

  // Task 4: the served WebMCP bridge script joins this bucket. Without it, a
  // crawler fetch of /webmcp/bridge.js falls into the "html" catch-all and
  // pollutes the surface-mix data the v1.5.0 per-response reservation
  // rationale rests on.
  it("classifies the served WebMCP bridge script as agent-discovery, not html", () => {
    expect(classifySurface("/webmcp/bridge.js")).toBe("agent-discovery");
    expect(classifySurface("/webmcp/bridge.js")).not.toBe("html");
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
    // v1.17.0: the standard agent-discovery documents are their OWN class.
    expect(classifySurface("/.well-known/mcp/server-card.json")).toBe("agent-discovery");
    expect(classifySurface("/.well-known/api-catalog")).toBe("agent-discovery");
    expect(classifySurface("/.well-known/ai-catalog.json")).toBe("agent-discovery");
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
      // v1.18.0 appends blob10 (markdown_requested). APPENDED, never inserted:
      // blob order IS the read query's contract, so a new axis may only ever go
      // on the end — inserting one would silently relabel every column after it.
      blobs: ["openai", "llms", "openai", "train", TAXONOMY_VERSION, "1", "0", "", "openai-gptbot", "0", "unsigned"],
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
    // v1.12.0: the exact agent, so nothing has to be inferred downstream.
    expect(writes[0].blobs[8]).toBe("anthropic-searchbot");
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
    expect(getSensorState()).toEqual({ ae_bound: null, last_write_ok: null, last_write_at: null, last_error: null, detail_last_write_ok: null });
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

import { SIG_VALID } from "../src/web-bot-auth.mjs";

describe("blob11 — signature state", () => {
  const envWith = (sink) => ({
    SN_MR: { writeDataPoint: (dp) => sink.push(dp) },
    SN_MR_RIGHTS: { writeDataPoint() {} },
  });

  it("appends the signature state as blob11 and leaves blobs 1-10 in place", () => {
    const written = [];
    const request = new Request("https://juanlentino.com/notes/x", {
      headers: { "user-agent": "Mozilla/5.0 (compatible; GPTBot/1.0)" },
    });

    observeMachineReader(request, envWith(written), "/notes/x", SIG_VALID);

    expect(written[0].blobs).toHaveLength(11);
    expect(written[0].blobs[0]).toBe("openai");
    expect(written[0].blobs[9]).toBe("0");
    expect(written[0].blobs[10]).toBe("valid");
  });

  it("defaults to unsigned when no state is passed, so old call sites keep working", () => {
    const written = [];
    observeMachineReader(
      new Request("https://juanlentino.com/notes/x", { headers: { "user-agent": "GPTBot/1.0" } }),
      envWith(written),
      "/notes/x"
    );
    expect(written[0].blobs[10]).toBe("unsigned");
  });
});

import { buildQuery } from "../src/machine-readers.mjs";

describe("read query exposes what the write path records (v1.20.0)", () => {
  const aggregate = () => buildQuery("aggregate", 30);

  it("selects blob11 as signed_agent", () => {
    expect(aggregate()).toContain("blob11 AS signed_agent");
  });

  it("groups by it, or the column collapses across signature states", () => {
    // Without this the aggregate sums valid and unsigned into one row and the
    // whole point of the dimension is lost.
    expect(aggregate()).toMatch(/GROUP BY[^F]*signed_agent/);
  });

  it("is ADDITIVE — every column v1.18.0 exposed is still exposed", () => {
    const q = aggregate();
    for (const col of [
      "blob1 AS family", "blob2 AS surface", "blob3 AS vendor", "blob4 AS purpose",
      "blob5 AS taxonomy_version", "blob6 AS training_corpus_source",
      "blob7 AS first_party", "blob9 AS agent", "blob10 AS markdown_requested",
    ]) {
      expect(q).toContain(col);
    }
  });

  it("still never selects blob8 — the raw UA sample does not escape the aggregate", () => {
    expect(aggregate()).not.toContain("blob8");
  });

  it("leaves the rights view alone — a different dataset with its own blob order", () => {
    expect(buildQuery("rights", 30)).not.toContain("signed_agent");
  });
});

describe("aggregate truncation (v1.23.0)", () => {
  it("the aggregate declares its OWN cap instead of inheriting the API's silently", () => {
    expect(buildQuery("aggregate", 30)).toMatch(/LIMIT 10000 FORMAT JSON$/);
  });

  it("EVERY view declares a LIMIT — the aggregate was the one that did not", () => {
    for (const view of ["aggregate", "unknown", "rights", "totals"]) {
      expect(buildQuery(view, 30)).toMatch(/LIMIT \d+/);
    }
  });

  it("totals groups by DAY ONLY, so its row count cannot scale with the window", () => {
    const q = buildQuery("totals", 90);
    expect(q).toContain("GROUP BY day ");
    // The eleven-dimension GROUP BY is what makes the aggregate truncate; the
    // totals query must carry none of it.
    for (const dim of ["family", "surface", "vendor", "purpose", "agent"]) {
      expect(q).not.toContain(`AS ${dim}`);
    }
  });

  it("totals is bounded by the DAY RANGE, so the bound can never bite", () => {
    expect(buildQuery("totals", 90)).toMatch(/LIMIT 90 FORMAT JSON$/);
  });

  it("a wider window changes the interval, never the shape", () => {
    expect(buildQuery("totals", 60)).toContain("INTERVAL '60' DAY");
    expect(buildQuery("aggregate", 60)).toContain("INTERVAL '60' DAY");
  });
});

// v1.24.1: the rights-detail stream had no bookkeeping of its own; its failure
// unwound through the aggregate's catch AFTER the aggregate row had landed, so
// /_sn/rights-signals/version read the sensor as dead for a stream that sees
// ~80 rows a month. Verified by mutation before the fix: aggregate ok + detail
// throwing on /.well-known/tdmrep.json -> last_write_ok false.
describe("v1.24.1: a detail-write failure is not the aggregate sensor dying", () => {
  const rightsReq = () => new Request("https://juanlentino.com/.well-known/tdmrep.json", { headers: { "user-agent": "GPTBot/1.0" } });

  it("aggregate lands, detail throws -> last_write_ok stays TRUE, detail_last_write_ok is false", () => {
    _resetSensorStateForTests();
    const written = [];
    const err = console.error; const logged = []; console.error = (m) => logged.push(String(m));
    try {
      const env = { SN_MR: { writeDataPoint: (dp) => written.push(dp) }, SN_MR_RIGHTS: { writeDataPoint() { throw new Error("detail quota"); } } };
      const out = observeMachineReader(rightsReq(), env, "/.well-known/tdmrep.json");
      expect(out).not.toBe(null); // the observation itself succeeded
      expect(written).toHaveLength(1);
      const s = getSensorState();
      expect(s.last_write_ok).toBe(true);
      expect(s.last_error).toBe(null);
      expect(s.detail_last_write_ok).toBe(false);
      expect(logged.some((l) => l.includes("rights-detail write failed"))).toBe(true);
    } finally { console.error = err; }
  });

  it("both streams land -> both true; a non-rights path leaves the detail outcome untouched (null)", () => {
    _resetSensorStateForTests();
    const env = { SN_MR: { writeDataPoint() {} }, SN_MR_RIGHTS: { writeDataPoint() {} } };
    observeMachineReader(rightsReq(), env, "/.well-known/tdmrep.json");
    expect(getSensorState().detail_last_write_ok).toBe(true);
    _resetSensorStateForTests();
    observeMachineReader(new Request("https://juanlentino.com/notes/x", { headers: { "user-agent": "GPTBot/1.0" } }), env, "/notes/x");
    expect(getSensorState().last_write_ok).toBe(true);
    expect(getSensorState().detail_last_write_ok).toBe(null);
  });

  it("the aggregate write failing is still the aggregate sensor dying", () => {
    _resetSensorStateForTests();
    const err = console.error; console.error = () => {};
    try {
      const env = { SN_MR: { writeDataPoint() { throw new Error("ae down"); } }, SN_MR_RIGHTS: { writeDataPoint() {} } };
      expect(observeMachineReader(rightsReq(), env, "/.well-known/tdmrep.json")).toBe(null);
      expect(getSensorState().last_write_ok).toBe(false);
    } finally { console.error = err; }
  });
});
