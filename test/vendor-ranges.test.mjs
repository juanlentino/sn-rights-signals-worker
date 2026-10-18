import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TAXONOMY from "../src/machine-reader-taxonomy.json";
import { validateEntries, TAXONOMY_VERSION, ipRangesUrlFor } from "../src/taxonomy.mjs";
import {
  ipInCidr,
  parseRanges,
  ensureVendorRanges,
  vendorVerified,
  _resetVendorRangesForTests,
  _setVendorRangesCacheForTests,
} from "../src/vendor-ranges.mjs";
import { observeMachineReader, buildQuery } from "../src/machine-readers.mjs";

// Taxonomy 1.6.0: a vendor that publishes its crawler's IP ranges gets
// `ip_ranges_url`; the sensor checks the CLIENT IP against that list and
// records ONLY the answer ('1' in range, '0' read and out of range, '' not
// measured). The IP itself is never stored or emitted.
const PPLX = "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)";
const CCBOT = "CCBot/2.0 (https://commoncrawl.org/faq/)";
const GPTBOT = "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.1; +https://openai.com/gptbot)";
const IN_V4 = "203.0.113.77";
const OUT_V4 = "198.51.100.9";
const IN_V6 = "2001:db8:abcd:12::5";
const FIXTURE = { creationTime: "2026-10-18", prefixes: [{ ipv4Prefix: "203.0.113.0/24" }, { ipv6Prefix: "2001:db8:abcd::/48" }] };

const entry = (id) => TAXONOMY.entries.find((e) => e.id === id);
const memCache = () => {
  const m = new Map();
  return { match: async (k) => (m.has(k) ? new Response(m.get(k)) : undefined), put: async (k, r) => m.set(k, await r.text()), m };
};
const ctxOf = () => {
  const jobs = [];
  return { waitUntil: (p) => jobs.push(p), settle: () => Promise.all(jobs), jobs };
};
const reqFrom = (ua, ip) => new Request("https://juanlentino.com/notes/x/", { headers: { "user-agent": ua, "cf-connecting-ip": ip } });
const load = async (agent, body) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(typeof body === "string" ? body : JSON.stringify(body), { headers: { "content-type": "application/json" } })));
  const ctx = ctxOf();
  ensureVendorRanges(ctx, agent);
  await ctx.settle();
};

beforeEach(() => {
  _resetVendorRangesForTests();
  _setVendorRangesCacheForTests(memCache());
});
afterEach(() => vi.unstubAllGlobals());

describe("taxonomy 1.6.0: ip_ranges_url and home_networks are data", () => {
  it("is 1.6.0 and documents both fields", () => {
    expect(TAXONOMY_VERSION).toBe("1.6.0");
    expect(TAXONOMY.field_contract.ip_ranges_url).toMatch(/published/);
    expect(TAXONOMY.field_contract.home_networks).toMatch(/asOrganization/);
  });

  it("names the vendors' own lists", () => {
    expect(entry("perplexity-bot").ip_ranges_url).toBe("https://www.perplexity.ai/perplexitybot.json");
    expect(entry("perplexity-user").ip_ranges_url).toBe("https://www.perplexity.ai/perplexity-user.json");
    expect(entry("commoncrawl-ccbot").ip_ranges_url).toBe("https://index.commoncrawl.org/ccbot.json");
    expect(ipRangesUrlFor("openai-gptbot")).toBe(null);
  });

  it("names home networks for Bytespider, Perplexity and CCBot", () => {
    expect(entry("bytedance-bytespider").home_networks).toEqual(["bytedance", "tiktok", "byteplus"]);
    for (const id of ["perplexity-bot", "perplexity-user", "commoncrawl-ccbot"]) expect(entry(id).home_networks, id).toEqual(["amazon"]);
  });

  it("the validator checks both fields", () => {
    const ok = { id: "x", match: "x", purpose: "train" };
    expect(() => validateEntries([{ ...ok, ip_ranges_url: "http://x/y.json" }])).toThrow(/ip_ranges_url/);
    expect(() => validateEntries([{ ...ok, home_networks: [] }])).toThrow(/home_networks/);
    expect(() => validateEntries([{ ...ok, home_networks: ["Amazon"] }])).toThrow(/home_networks/);
    expect(() => validateEntries([{ ...ok, observable: false, home_networks: ["x"] }])).toThrow(/observable/);
    expect(() => validateEntries([{ ...ok, ip_ranges_url: "https://x/y.json", home_networks: ["amazon"] }])).not.toThrow();
  });
});

describe("ipInCidr: IPv4 and IPv6", () => {
  it("matches inside, refuses outside, never crosses families", () => {
    expect(ipInCidr(IN_V4, "203.0.113.0/24")).toBe(true);
    expect(ipInCidr(OUT_V4, "203.0.113.0/24")).toBe(false);
    expect(ipInCidr("203.0.114.0", "203.0.113.0/24")).toBe(false);
    expect(ipInCidr(IN_V6, "2001:db8:abcd::/48")).toBe(true);
    expect(ipInCidr("2001:db8:abce::1", "2001:db8:abcd::/48")).toBe(false);
    expect(ipInCidr(IN_V4, "2001:db8:abcd::/48")).toBe(false);
    expect(ipInCidr("::ffff:203.0.113.5", "203.0.113.0/24")).toBe(true);
    expect(ipInCidr("1.2.3.4", "0.0.0.0/0")).toBe(true);
    expect(ipInCidr("garbage", "203.0.113.0/24")).toBe(false);
    expect(ipInCidr(IN_V4, "203.0.113.0/33")).toBe(false);
  });

  it("parseRanges keeps valid prefixes and returns null when none are", () => {
    expect(parseRanges(FIXTURE)).toHaveLength(2);
    expect(parseRanges({ prefixes: [{ ipv4Prefix: "nope" }] })).toBe(null);
    expect(parseRanges({ nothing: true })).toBe(null);
    expect(parseRanges(null)).toBe(null);
  });
});

describe("vendorVerified: '1' in range, '0' out of range, '' not measured", () => {
  it("v4 in, v6 in, v4 out", async () => {
    await load("perplexity-bot", FIXTURE);
    expect(vendorVerified(reqFrom(PPLX, IN_V4), "perplexity-bot")).toBe("1");
    expect(vendorVerified(reqFrom(PPLX, IN_V6), "perplexity-bot")).toBe("1");
    expect(vendorVerified(reqFrom(PPLX, OUT_V4), "perplexity-bot")).toBe("0");
  });

  it("'' for an agent without a list, before the list loads, and without a client IP", async () => {
    expect(vendorVerified(reqFrom(GPTBOT, IN_V4), "openai-gptbot")).toBe("");
    expect(vendorVerified(reqFrom(PPLX, IN_V4), "perplexity-bot")).toBe("");
    await load("perplexity-bot", FIXTURE);
    expect(vendorVerified(new Request("https://juanlentino.com/", { headers: { "user-agent": PPLX } }), "perplexity-bot")).toBe("");
  });

  it("a fetch failure, a non-200, junk JSON or an empty list all mean '' (fail closed), never '0'", async () => {
    for (const bad of [() => Promise.reject(new Error("boom")), () => Promise.resolve(new Response("x", { status: 503 })), () => Promise.resolve(new Response(null, { status: 302, headers: { location: "https://elsewhere.example/x.json" } })), () => Promise.resolve(new Response("<html>")), () => Promise.resolve(new Response(JSON.stringify({ prefixes: [] })))]) {
      _resetVendorRangesForTests();
      _setVendorRangesCacheForTests(memCache());
      vi.stubGlobal("fetch", vi.fn().mockImplementation(bad));
      const ctx = ctxOf();
      ensureVendorRanges(ctx, "commoncrawl-ccbot");
      await ctx.settle();
      expect(vendorVerified(reqFrom(CCBOT, OUT_V4), "commoncrawl-ccbot")).toBe("");
      expect(vendorVerified(reqFrom(CCBOT, IN_V4), "commoncrawl-ccbot")).toBe("");
    }
  });

  it("one list failing does not blank another", async () => {
    await load("perplexity-bot", FIXTURE);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    const ctx = ctxOf();
    ensureVendorRanges(ctx, "commoncrawl-ccbot");
    await ctx.settle();
    expect(vendorVerified(reqFrom(PPLX, OUT_V4), "perplexity-bot")).toBe("0");
    expect(vendorVerified(reqFrom(CCBOT, OUT_V4), "commoncrawl-ccbot")).toBe("");
  });

  it("fetches at most once a day per list, and only for an agent that has one (no colo cache to lean on)", async () => {
    _setVendorRangesCacheForTests(null);
    const f = vi.fn().mockResolvedValue(new Response(JSON.stringify(FIXTURE)));
    vi.stubGlobal("fetch", f);
    const ctx = ctxOf();
    ensureVendorRanges(ctx, "perplexity-bot");
    ensureVendorRanges(ctx, "perplexity-bot");
    await ctx.settle();
    ensureVendorRanges(ctx, "perplexity-bot");
    ensureVendorRanges(ctx, "openai-gptbot");
    ensureVendorRanges(ctx, undefined);
    await ctx.settle();
    expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0][0]).toBe("https://www.perplexity.ai/perplexitybot.json");
    expect(f.mock.calls[0][1].signal).toBeDefined();
    expect(f.mock.calls[0][1].redirect).toBe("manual");
  });

  it("a fresh isolate reads the colo cache instead of fetching again", async () => {
    const cache = memCache();
    _setVendorRangesCacheForTests(cache);
    await load("perplexity-bot", FIXTURE);
    _resetVendorRangesForTests();
    _setVendorRangesCacheForTests(cache);
    const f = vi.fn().mockRejectedValue(new Error("should not fetch"));
    vi.stubGlobal("fetch", f);
    const ctx = ctxOf();
    ensureVendorRanges(ctx, "perplexity-bot");
    await ctx.settle();
    expect(f).not.toHaveBeenCalled();
    expect(vendorVerified(reqFrom(PPLX, IN_V4), "perplexity-bot")).toBe("1");
  });

  it("no ctx.waitUntil: schedules nothing, stays ''", () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    ensureVendorRanges({}, "perplexity-bot");
    expect(f).not.toHaveBeenCalled();
    expect(vendorVerified(reqFrom(PPLX, IN_V4), "perplexity-bot")).toBe("");
  });
});

describe("sn_machine_readers blob16 vendor_verified (append only), and no IP anywhere", () => {
  const sensor = () => {
    const agg = [];
    return { agg, env: { SN_MR: { writeDataPoint: (p) => agg.push(p) } } };
  };

  it("blob16 is appended after blob15; blobs 1-15 unchanged", async () => {
    await load("perplexity-bot", FIXTURE);
    const { agg, env } = sensor();
    observeMachineReader(reqFrom(PPLX, IN_V4), env, "/notes/x/");
    observeMachineReader(reqFrom(PPLX, OUT_V4), env, "/notes/x/");
    observeMachineReader(reqFrom(GPTBOT, IN_V4), env, "/notes/x/");
    expect(agg.map((p) => p.blobs.length)).toEqual([16, 16, 16]);
    expect(agg.map((p) => p.blobs[15])).toEqual(["1", "0", ""]);
    expect(agg[0].blobs.slice(0, 15)).toEqual(agg[1].blobs.slice(0, 15));
    expect(agg[0].blobs[8]).toBe("perplexity-bot");
  });

  it("no emitted blob, index or log line carries the client IP", async () => {
    const logs = [];
    for (const m of ["log", "warn", "error"]) vi.spyOn(console, m).mockImplementation((...a) => logs.push(a.join(" ")));
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    const ctx = ctxOf();
    ensureVendorRanges(ctx, "perplexity-bot");
    await ctx.settle();
    await load("perplexity-bot", FIXTURE);
    const { agg, env } = sensor();
    for (const ip of [IN_V4, OUT_V4, IN_V6, "not-an-ip"]) observeMachineReader(reqFrom(PPLX, ip), env, "/notes/x/");
    const out = JSON.stringify(agg) + logs.join("\n");
    for (const ip of [IN_V4, OUT_V4, IN_V6, "2001:db8:abcd:12", "not-an-ip"]) expect(out).not.toContain(ip);
    vi.restoreAllMocks();
  });

  it("the aggregate read selects and groups blob16 AS vendor_verified, after owner_agent", () => {
    const q = buildQuery("aggregate", 30);
    expect(q).toContain("blob15 AS owner_agent, blob16 AS vendor_verified, toDate(timestamp)");
    expect(q).toContain("owner_identity, owner_agent, vendor_verified, day ORDER BY");
    for (const v of ["totals", "unknown", "rights"]) expect(buildQuery(v, 30)).not.toMatch(/blob16|vendor_verified/);
  });
});

describe("home_network is stamped on aggregate rows at read time, like cf_verified", () => {
  it("'1' on a home network, '0' off it, '' when not measured or the agent has none", async () => {
    const { withCfVerified } = await import("../src/taxonomy.mjs");
    const rows = [
      { agent: "bytedance-bytespider", network: "Bytedance Inc.", hits: 1 },
      { agent: "bytedance-bytespider", network: "Google LLC", hits: 1 },
      { agent: "perplexity-bot", network: "Amazon Data Services Northern Virginia", hits: 1 },
      { agent: "commoncrawl-ccbot", network: "", hits: 1 },
      { agent: "commoncrawl-ccbot", hits: 1 },
      { agent: "cohere-ai", network: "Google LLC", hits: 1 },
    ];
    expect(withCfVerified(rows).map((r) => r.home_network)).toEqual(["1", "0", "1", "", "", ""]);
    expect(rows[0].home_network).toBeUndefined();
  });
});
