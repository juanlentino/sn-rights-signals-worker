import { afterEach, describe, expect, it, vi } from "vitest";
import TAXONOMY from "../src/machine-reader-taxonomy.json";
import { validateEntries, withCfVerified, TAXONOMY_VERSION } from "../src/taxonomy.mjs";
import { machineReadersResponse } from "../src/machine-readers.mjs";

// Taxonomy 1.5.0: cf_verified marks an agent Cloudflare verifies when genuine
// (listed in Cloudflare's verified-bots directory). A reader uses it to call an
// unverified hit claiming that agent an impostor; false never reclassifies.
const entry = (id) => TAXONOMY.entries.find((e) => e.id === id);

describe("cf_verified in the taxonomy data (1.5.0)", () => {
  it("is taxonomy 1.5.0 and documents the field", () => {
    expect(["1.5.0", "1.6.0"]).toContain(TAXONOMY_VERSION); // 1.6.0: see vendor-ranges.test.mjs
    expect(TAXONOMY.field_contract.cf_verified).toMatch(/verified-bots directory/);
  });

  it("marks the directory-listed agents", () => {
    for (const id of ["anthropic-claudebot", "anthropic-claude-user", "openai-gptbot", "google-bot", "microsoft-bingbot", "apple-bot", "amazon-bot", "meta-externalagent", "baidu", "you-com"]) {
      expect(entry(id).cf_verified, id).toBe(true);
    }
  });

  it("leaves agents absent from the directory unmarked, so they are never reclassified", () => {
    for (const id of ["perplexity-bot", "perplexity-user", "commoncrawl-ccbot", "bytedance-bytespider", "cohere-ai", "google-bot-news", "ops-uptimekuma", "dev-curl"]) {
      expect(entry(id).cf_verified, id).toBeUndefined();
    }
  });

  it("is never on a control token (observable false)", () => {
    expect(TAXONOMY.entries.filter((e) => e.observable === false && e.cf_verified)).toEqual([]);
  });

  it("the validator requires a boolean, and refuses it beside observable false", () => {
    expect(() => validateEntries([{ id: "x", match: "x", purpose: "train", cf_verified: "yes" }])).toThrow(/cf_verified must be a boolean/);
    expect(() => validateEntries([{ id: "x", match: "x", purpose: "train", observable: false, cf_verified: true }])).toThrow(/cf_verified cannot/);
    expect(() => validateEntries([{ id: "x", match: "x", purpose: "train", cf_verified: true }])).not.toThrow();
  });
});

describe("withCfVerified stamps aggregate rows from their agent id", () => {
  it("stamps '1' or '0', and '0' for no agent or an unknown id", () => {
    const rows = [{ agent: "anthropic-claudebot", hits: 3 }, { agent: "cohere-ai", hits: 2 }, { agent: "", hits: 1 }, { agent: "google-extended", hits: 1 }, { hits: 1 }];
    expect(withCfVerified(rows).map((r) => r.cf_verified)).toEqual(["1", "0", "0", "0", "0"]);
  });

  it("returns new rows and leaves the input untouched", () => {
    const rows = [{ agent: "openai-gptbot", hits: 1 }];
    const out = withCfVerified(rows);
    expect(out[0]).not.toBe(rows[0]);
    expect(rows[0].cf_verified).toBeUndefined();
    expect(out[0]).toEqual({ agent: "openai-gptbot", hits: 1, cf_verified: "1", home_network: "" });
  });
});

describe("the aggregate read carries cf_verified; other views do not", () => {
  const env = { SN_MR_READ_TOKEN: "secret", CF_ACCOUNT_ID: "acct", SN_MR_SQL_TOKEN: "sql" };
  const read = (qs) => machineReadersResponse(new Request(`https://juanlentino.com/_sn/rights-signals/machine-readers?${qs}`, { headers: { authorization: "Bearer secret" } }), env);
  afterEach(() => vi.unstubAllGlobals());

  it("aggregate rows gain the field", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ agent: "anthropic-claudebot", verified_bot: "", network: "Google LLC", hits: 9 }], rows: 1 }))));
    const body = await (await read("days=14")).json();
    expect(body.data[0]).toEqual({ agent: "anthropic-claudebot", verified_bot: "", network: "Google LLC", hits: 9, cf_verified: "1", home_network: "" });
  });

  it("the totals view passes through untouched", async () => {
    const rows = [{ day: "2026-10-01", hits: 4 }];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: rows, rows: 1 }))));
    expect((await (await read("days=14&view=totals")).json()).data).toEqual(rows);
  });
});
