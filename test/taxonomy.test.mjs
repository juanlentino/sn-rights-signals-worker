import { describe, expect, it } from "vitest";
import TAXONOMY from "../src/machine-reader-taxonomy.json";
import {
  classifyVendorPurpose,
  sanitizeUnknownUa,
  taxonomyResponse,
  PURPOSES,
  TAXONOMY_VERSION,
  TAXONOMY_EFFECTIVE_DATE,
} from "../src/taxonomy.mjs";
import { classifyMachineReader } from "../src/machine-readers.mjs";

// Realistic UAs, not bare tokens. A taxonomy tested only against its own match
// strings proves nothing: it would pass even if every entry matched the wrong
// half of a real header.
const UA = {
  gptbot: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot",
  oaiSearch: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot",
  chatgptUser: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot",
  claudeBot: "Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)",
  claudeSearch: "Mozilla/5.0 (compatible; Claude-SearchBot/1.0; +Claude-SearchBot@anthropic.com)",
  claudeUser: "Mozilla/5.0 (compatible; Claude-User/1.0; +Claude-User@anthropic.com)",
  googlebot: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  googleOther: "Mozilla/5.0 (compatible; GoogleOther)",
  vertex: "Mozilla/5.0 (compatible; Google-CloudVertexBot/1.0; +https://developers.google.com/)",
  perplexityBot: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)",
  perplexityUser: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Perplexity-User/1.0; +https://perplexity.ai/perplexity-user)",
  applebot: "Mozilla/5.0 (compatible; Applebot/0.1; +http://www.apple.com/go/applebot)",
  appleExtended: "Mozilla/5.0 (compatible; Applebot-Extended/0.1)",
  metaAgent: "meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)",
  fbHit: "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
  ccbot: "CCBot/2.0 (https://commoncrawl.org/faq/)",
  amazon: "Mozilla/5.0 (Linux; like Mac OS X) AppleWebKit/537.36 (compatible; Amazonbot/0.1; +https://developer.amazon.com/support/amazonbot)",
  mistralTrain: "Mozilla/5.0 (compatible; MistralAI-Training/1.0; +https://docs.mistral.ai/robots)",
  mistralIndex: "Mozilla/5.0 (compatible; MistralAI-Index/1.0; +https://docs.mistral.ai/robots)",
  betterstack: "Better Stack Better Uptime Bot Mozilla/5.0 (compatible; UptimeBot/1.0)",
  curl: "curl/8.7.1",
  chrome: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
};

const purposeOf = (ua) => classifyVendorPurpose(ua)?.purpose ?? null;
const vendorOf = (ua) => classifyVendorPurpose(ua)?.vendor ?? null;

describe("purpose vocabulary is closed", () => {
  it("declares exactly the thirteen agreed values", () => {
    expect(PURPOSES).toEqual([
      "train", "search", "retrieval", "user", "archive", "ops",
      "seo", "feed", "social", "security", "dev", "ads", "unknown",
    ]);
  });

  it("uses no purpose outside the vocabulary", () => {
    for (const e of TAXONOMY.entries) expect(PURPOSES).toContain(e.purpose);
  });
});

describe("the *-User agents are never train", () => {
  // The single most consequential rule in the whole file: vendors treat these
  // as outside their training-crawler rules, so counting them as training
  // would overstate the published claim.
  it.each([
    ["ChatGPT-User", UA.chatgptUser],
    ["Claude-User", UA.claudeUser],
    ["Perplexity-User", UA.perplexityUser],
  ])("%s is user, not train", (_name, ua) => {
    expect(purposeOf(ua)).toBe("user");
  });
});

describe("vendor and purpose are independent axes", () => {
  it("splits one vendor across three purposes", () => {
    expect(vendorOf(UA.gptbot)).toBe("openai");
    expect(vendorOf(UA.oaiSearch)).toBe("openai");
    expect(vendorOf(UA.chatgptUser)).toBe("openai");
    expect([purposeOf(UA.gptbot), purposeOf(UA.oaiSearch), purposeOf(UA.chatgptUser)])
      .toEqual(["train", "search", "user"]);
  });

  it("splits Anthropic across three purposes", () => {
    expect([purposeOf(UA.claudeBot), purposeOf(UA.claudeSearch), purposeOf(UA.claudeUser)])
      .toEqual(["train", "search", "user"]);
  });
});

describe("RULE 1 — the taxonomy never reads or moves `family`", () => {
  it("gives Claude-SearchBot a vendor while its frozen family stays other-bot", () => {
    expect(classifyMachineReader(UA.claudeSearch)).toBe("other-bot");
    expect(vendorOf(UA.claudeSearch)).toBe("anthropic");
    expect(purposeOf(UA.claudeSearch)).toBe("search");
  });

  it("keeps GoogleOther in the google-ai family while calling its purpose unknown", () => {
    // The frozen family is WRONG here against Google's own docs and stays wrong
    // on purpose. This test exists so that fact is deliberate and visible
    // rather than an unnoticed inconsistency.
    expect(classifyMachineReader(UA.googleOther)).toBe("google-ai");
    expect(purposeOf(UA.googleOther)).toBe("unknown");
  });

  it("keeps MistralAI-Index in the mistral family while calling its purpose search", () => {
    expect(classifyMachineReader(UA.mistralIndex)).toBe("mistral");
    expect(purposeOf(UA.mistralIndex)).toBe("search");
    expect(purposeOf(UA.mistralTrain)).toBe("train");
  });
});

describe("ordering — specific tokens win over the generic ones containing them", () => {
  it("does not let applebot swallow applebot-extended", () => {
    expect(purposeOf(UA.appleExtended)).toBe("train");
    expect(purposeOf(UA.applebot)).toBe("search");
  });

  it("does not let googlebot swallow googlebot-image or googleother", () => {
    expect(purposeOf(UA.googlebot)).toBe("search");
    expect(vendorOf("Googlebot-Image/1.0")).toBe("google");
    expect(purposeOf(UA.googleOther)).toBe("unknown");
  });
});

describe("the two ambiguous cases are decided, not fudged", () => {
  it("CCBot is archive AND flagged as a training-corpus source", () => {
    const m = classifyVendorPurpose(UA.ccbot);
    expect(m.purpose).toBe("archive");
    expect(m.training_corpus_source).toBe(true);
  });

  it("Amazonbot is search AND flagged as a training-corpus source", () => {
    const m = classifyVendorPurpose(UA.amazon);
    expect(m.purpose).toBe("search");
    expect(m.training_corpus_source).toBe(true);
  });

  it("keeps the dual role queryable without any purpose meaning two things", () => {
    // If either of these ever became `train`, the boolean would be redundant
    // and `train` would silently mean two different claims.
    expect(purposeOf(UA.ccbot)).not.toBe("train");
    expect(purposeOf(UA.amazon)).not.toBe("train");
  });
});

describe("the evidence sets the confidence, not the other way round", () => {
  it("files cohere-ai as unknown because its purpose is unconfirmed", () => {
    // Regression on my own earlier filing: `train` asserted one of three
    // equally-live possibilities. An undocumented agent gets `unknown`.
    const e = TAXONOMY.entries.find((x) => x.id === "cohere-ai");
    expect(e.purpose).toBe("unknown");
    expect(e.declared).toBe(false);
    // false because UNKNOWN, not because ruled out — the note must say so.
    expect(e.training_corpus_source).toBe(false);
    expect(e.note).toMatch(/unconfirmed/i);
  });

  it("splits Diffbot's user agent out of its crawler, ahead of the bare token", () => {
    expect(purposeOf("Mozilla/5.0 (compatible; Diffbot-User/1.0)")).toBe("user");
    expect(purposeOf("Mozilla/5.0 (compatible; Diffbot/1.0)")).toBe("train");
  });

  it("gives the ad validators their own purpose rather than stretching security", () => {
    expect(purposeOf("Mozilla/5.0 (compatible; OAI-AdsBot/1.0; +https://openai.com/searchbot)")).toBe("ads");
    expect(purposeOf("meta-externalads/1.1")).toBe("ads");
  });
});

describe("newly visible machines", () => {
  it("classifies facebookexternalhit as meta/social though the family classifier drops it", () => {
    expect(classifyMachineReader(UA.fbHit)).toBeNull();
    expect(vendorOf(UA.fbHit)).toBe("meta");
    expect(purposeOf(UA.fbHit)).toBe("social");
  });

  it("flags the owner's own monitor as first-party so totals can exclude it", () => {
    const m = classifyVendorPurpose(UA.betterstack);
    expect(m.purpose).toBe("ops");
    expect(m.first_party).toBe(true);
  });
});

describe("humans and non-matches", () => {
  it("returns null for a browser and for an empty UA", () => {
    expect(classifyVendorPurpose(UA.chrome)).toBeNull();
    expect(classifyVendorPurpose("")).toBeNull();
    expect(classifyVendorPurpose(null)).toBeNull();
  });

  it("returns null rather than guessing for an unrecognised bot", () => {
    expect(classifyVendorPurpose("Mozilla/5.0 (compatible; SomeNewBot/1.0)")).toBeNull();
  });

  it("classifies scripted clients as dev", () => {
    expect(purposeOf(UA.curl)).toBe("dev");
    expect(purposeOf("python-requests/2.32.3")).toBe("dev");
  });
});

describe("sanitizeUnknownUa — allowlist, not denylist", () => {
  it("strips everything outside the allowlist", () => {
    expect(sanitizeUnknownUa('<script>alert("x")</script>')).not.toMatch(/[<>"']/);
    expect(sanitizeUnknownUa("a b")).not.toContain(" ");
    expect(sanitizeUnknownUa("bad\\slash")).not.toContain("\\");
  });

  it("keeps a real UA readable", () => {
    expect(sanitizeUnknownUa("Mozilla/5.0 (compatible; NewBot/1.0; +https://x.example)"))
      .toBe("Mozilla/5.0 compatible NewBot/1.0 +https //x.example");
  });

  it("caps length so no single UA can dominate the blob budget", () => {
    expect(sanitizeUnknownUa("A".repeat(500)).length).toBe(96);
  });

  it("returns empty for empty input", () => {
    expect(sanitizeUnknownUa(null)).toBe("");
    expect(sanitizeUnknownUa("")).toBe("");
  });
});

describe("the definition is published (RULE 4)", () => {
  it("serves the whole file with its version and effective date", async () => {
    const res = taxonomyResponse(new Request("https://juanlentino.com/_sn/rights-signals/taxonomy"));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-sn-taxonomy-version")).toBe(TAXONOMY_VERSION);
    const body = await res.json();
    expect(body.taxonomy_version).toBe(TAXONOMY_VERSION);
    expect(body.effective_date).toBe(TAXONOMY_EFFECTIVE_DATE);
    // The whole point is that a reader can check every call, so the served
    // document must carry the entries and their sources, not just a summary.
    expect(body.entries.length).toBe(TAXONOMY.entries.length);
    expect(body.entries.find((e) => e.id === "commoncrawl-ccbot").note).toMatch(/archive/i);
  });

  it("rejects non-GET", () => {
    const res = taxonomyResponse(new Request("https://juanlentino.com/_sn/rights-signals/taxonomy", { method: "POST" }));
    expect(res.status).toBe(405);
  });
});

describe("provenance of every call is recorded", () => {
  it("carries a first-party source URL wherever it claims the vendor declared it", () => {
    for (const e of TAXONOMY.entries) {
      if (e.declared === true && e.source === null) {
        // Allowed only for long-tail agents with no vendor doc page; the AI
        // vendors whose declarations the published claim rests on must cite.
        expect(["train", "retrieval"]).not.toContain(e.purpose);
      }
    }
  });

  it("marks inferred purposes as undeclared", () => {
    for (const id of ["bytedance-bytespider", "cohere-ai"]) {
      const e = TAXONOMY.entries.find((x) => x.id === id);
      expect(e.declared).toBe(false);
      expect(e.note).toBeTruthy();
    }
  });

  it("marks non-crawling control tokens as unobservable", () => {
    for (const id of ["apple-bot-extended", "google-extended"]) {
      expect(TAXONOMY.entries.find((x) => x.id === id).observable).toBe(false);
    }
  });
});
