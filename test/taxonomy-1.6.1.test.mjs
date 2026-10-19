import { describe, expect, it } from "vitest";
import { classifyVendorPurpose, withCfVerified, TAXONOMY_VERSION } from "../src/taxonomy.mjs";

// Taxonomy 1.6.1: four agents Cloudflare verified at the edge (2026-10-19,
// 30-day crosstab: 309 of 319, 308 of 310, 274 of 274 and 148 of 207 reads
// verified) that matched no entry and read as agent "". UAs are the samples
// the edge kept, with the punctuation the sanitizer strips put back.
const CASES = [
  ["Mozilla/5.0 (compatible; ExaSearchBot/1.0; +https://crawler.exa.ai/)", "exa-searchbot", "exa", "search", false],
  ["Mozilla/5.0 (compatible; Barkrowler/0.9; +https://babbar.tech/crawler)", "seo-babbar", "babbar", "seo", false],
  ["Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ShapBot/0.1.0", "parallel-shapbot", "parallel", "search", false],
  ["Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Reflectionbot/1.0; +https://reflection.ai/bot) Chrome/151.0.0.0 Safari/537.36", "reflection-bot", "reflection-ai", "train", true],
];

describe("taxonomy 1.6.1: four Cloudflare-verified agents are named", () => {
  it("is 1.6.1", () => expect(TAXONOMY_VERSION).toBe("1.6.1"));
  for (const [ua, id, vendor, purpose, training] of CASES) {
    it(`${id} classifies as ${vendor} / ${purpose}, cf_verified`, () => {
      const r = classifyVendorPurpose(ua);
      expect(r).toMatchObject({ id, vendor, purpose, training_corpus_source: training, first_party: false });
      expect(withCfVerified([{ agent: id }])[0].cf_verified).toBe("1");
    });
  }
  it("DuckAssistBot stays unmapped: none of its reads here were Cloudflare-verified", () => {
    expect(classifyVendorPurpose("DuckAssistBot/1.1; (+http://duckduckgo.com/duckassistbot.html)")).toBeNull();
  });
});
