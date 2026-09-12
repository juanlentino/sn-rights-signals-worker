import { describe, expect, it, vi, afterEach } from "vitest";
import worker from "../src/index.mjs";
import { prefersOdrl } from "../src/index.mjs";
import { tdmPolicyOdrl, tdmPolicyOdrlResponse } from "../src/tdm-policy-odrl.mjs";
import { POLICY_STATUS, POLICY_VERSION } from "../src/constants.mjs";

const doc = tdmPolicyOdrl();
const rules = doc.permission;
const purposeOf = (p) => p.constraint[0]["odrl:rightOperand"];
const ruleFor = (token) => rules.find((p) => purposeOf(p) === `sn:${token}`);

afterEach(() => vi.unstubAllGlobals());

describe("the ODRL / TDMRep representation of /tdm-policy/", () => {
  it("is an Offer in the TDMRep profile, versioned in its uid", () => {
    expect(doc["@type"]).toBe("Offer");
    expect(doc.profile).toBe("http://www.w3.org/ns/tdmrep");
    // Versioned like Springer's (.../tdmrep-policy/1): a licensee accepted a
    // specific document and it must stay identifiable after the terms move on.
    expect(doc.uid).toBe(`https://juanlentino.com/tdm-policy/${POLICY_VERSION}`);
    expect(doc["@context"][0]).toBe("http://www.w3.org/ns/odrl.jsonld");
  });

  it("names an assigner a machine can contact", () => {
    expect(doc.assigner["vcard:fn"]).toBe("Juan Lentino");
    expect(doc.assigner["vcard:hasURL"]).toBe("https://juanlentino.com/contact/");
  });

  it("permits search and ai-input with NO duty attached", () => {
    for (const token of ["search", "ai-input"]) {
      const rule = ruleFor(token);
      expect(rule, `no permission for ${token}`).toBeDefined();
      expect(rule.action).toBe("tdm:mine");
      // A duty here would silently make an unconditional permit conditional.
      expect(rule.duty).toBeUndefined();
    }
  });

  it("permits ai-train ONLY under an attribute duty naming the rightsholder", () => {
    const rule = ruleFor("ai-train");
    expect(rule.duty).toHaveLength(1);
    expect(rule.duty[0].action).toBe("attribute");
    expect(rule.duty[0].attributedParty["vcard:fn"]).toBe("Juan Lentino");
    expect(rule.duty[0]["sn:conditions"]).toBe("https://juanlentino.com/tdm-policy/#grant");
  });

  it("models no consequence — a failed condition precedent has no cure", () => {
    // A `consequence` would restate the grant as a covenant with a remedy,
    // which is the opposite of what section 2 says.
    expect(ruleFor("ai-train").duty[0].consequence).toBeUndefined();
  });

  it("namespaces its local purpose tokens instead of inventing bare ones", () => {
    // The use=reference lesson: a local term beside standard ones must be
    // resolvable to a documented URI, not passed off as vocabulary.
    expect(doc["@context"][2].sn).toBe("https://juanlentino.com/ns/tdm#");
    for (const rule of rules) expect(purposeOf(rule)).toMatch(/^sn:/);
  });

  it("carries the draft status into the machine document too", () => {
    expect(doc["sn:status"]).toBe(POLICY_STATUS);
    expect(doc["sn:version"]).toBe(POLICY_VERSION);
    if (POLICY_STATUS === "draft") expect(doc["sn:note"]).toMatch(/DRAFT/);
  });

  it("serves ld+json with Vary: Accept", () => {
    const res = tdmPolicyOdrlResponse();
    expect(res.headers.get("content-type")).toContain("application/ld+json");
    expect(res.headers.get("vary")).toBe("Accept");
  });
});

describe("content negotiation", () => {
  // The trap: crawlers send `*/*`. A naive "does Accept mention json" test
  // would be fine for browsers but would hand every crawler the machine
  // document and never the human terms.
  it.each([
    ["text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", false, "a browser"],
    ["*/*", false, "a crawler sending */*"],
    [null, false, "no Accept header at all"],
    ["application/ld+json", true, "an explicit ld+json request"],
    ["application/json", true, "an explicit json request"],
    ["application/ld+json,text/html", false, "html equally acceptable — prose wins the tie"],
    // #54: q was ignored, so an explicit preference for JSON over HTML lost.
    ["application/ld+json, text/html;q=0.5", true, "json outranks html"],
    ["application/json;q=0.5, text/html", false, "html outranks json"],
    ["application/ld+json;q=0", false, "json explicitly refused"],
  ])("Accept %j -> odrl=%s (%s)", (accept, expected) => {
    expect(prefersOdrl(accept)).toBe(expected);
  });

  async function policy(accept) {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("x", { headers: { "content-type": "text/html" } })));
    return worker.fetch(
      new Request("https://juanlentino.com/tdm-policy/", { headers: accept ? { accept } : {} }),
      {},
    );
  }

  it("serves the HTML terms by default, with Vary so caches do not mix them up", async () => {
    const res = await policy(null);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("vary")).toBe("Accept");
    expect(await res.text()).toContain("<h1>Text and Data Mining Policy</h1>");
  });

  // #55: the policy page skipped the markdown negotiation every origin page gets.
  it("serves the policy as markdown to an explicit text/markdown request", async () => {
    const res = await policy("text/markdown");
    expect(res.headers.get("content-type")).toContain("text/markdown");
    expect(res.headers.get("tdm-reservation")).toBe("1");
    const body = await res.text();
    expect(body).toContain("# Text and Data Mining Policy");
    expect(body).not.toContain("<h1>");
  });

  it("serves the ODRL policy to an explicit ld+json request, at the SAME url", async () => {
    const res = await policy("application/ld+json");
    expect(res.headers.get("content-type")).toContain("application/ld+json");
    expect((await res.json()).profile).toBe("http://www.w3.org/ns/tdmrep");
  });

  it("keeps the TDM reservation headers on both representations", async () => {
    for (const accept of [null, "application/ld+json"]) {
      const res = await policy(accept);
      expect(res.headers.get("tdm-reservation")).toBe("1");
      expect(res.headers.get("content-signal")).toContain("ai-train=no");
    }
  });
});
