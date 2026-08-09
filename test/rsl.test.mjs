import { describe, expect, it } from "vitest";
import { RSL_XML, rslResponse } from "../src/rsl.mjs";
import { childrenNamed, parseXml, textOf } from "../scripts/mini-xml.mjs";

// v1.7.0: these assertions are STRUCTURAL, over a parsed tree, not substring
// matches against the template that produced the file. The old test asserted
// `RSL_XML.toContain('<permits type="usage">ai-train</permits>')` — which was
// green for the entire life of the defect it was supposed to guard, because a
// naked ai-train grant contains that string just as happily as a conditioned
// one does. A substring assertion over a literal you also wrote proves nothing.

const rsl = parseXml(RSL_XML);
const content = childrenNamed(rsl, "content")[0];
const licenses = childrenNamed(content, "license");

function usage(license) {
  return childrenNamed(license, "permits")
    .filter((p) => (p.attrs.type || "usage") === "usage")
    .flatMap((p) => textOf(p).split(/\s+/));
}

describe("license.xml (RSL 1.0)", () => {
  it("is a well-formed RSL document with one <content> for the whole site", () => {
    expect(rsl.name).toBe("rsl");
    expect(rsl.attrs.xmlns).toBe("https://rslstandard.org/rsl");
    expect(childrenNamed(rsl, "content")).toHaveLength(1);
    expect(content.attrs.url).toBe("/");
  });

  it("names the rightsholder and points at the human-readable terms", () => {
    const copyright = childrenNamed(content, "copyright")[0];
    expect(copyright.attrs.type).toBe("person");
    expect(textOf(copyright)).toBe("Juan Lentino");
    expect(textOf(childrenNamed(content, "terms")[0])).toBe("https://juanlentino.com/tdm-policy/");
  });

  it("expresses the two tiers as two distinct licences", () => {
    // The fix for issue 2. One licence cannot express "these are free and that
    // one costs attribution"; two can, and RSL 1.0 §3.4 allows exactly that.
    expect(licenses).toHaveLength(2);
  });

  it("grants search and ai-input free of any condition", () => {
    const free = licenses.filter((l) => (childrenNamed(l, "payment")[0]?.attrs.type ?? "free") === "free");
    expect(free).toHaveLength(1);
    expect(usage(free[0]).sort()).toEqual(["ai-input", "search"]);
  });

  it("grants ai-train ONLY under an attribution payment naming the policy", () => {
    const training = licenses.filter((l) => usage(l).includes("ai-train"));
    expect(training).toHaveLength(1);
    const payment = childrenNamed(training[0], "payment")[0];
    expect(payment.attrs.type).toBe("attribution");
    expect(textOf(childrenNamed(payment, "standard")[0])).toBe("https://juanlentino.com/tdm-policy/");
  });

  it("never re-grants training through a superset token", () => {
    // "all" or "ai-all" under the free licence would silently undo the split
    // while every other assertion here stayed green.
    expect(licenses.flatMap(usage)).not.toContain("all");
    expect(licenses.flatMap(usage)).not.toContain("ai-all");
  });

  it("declares no license server — the owner is not joining the RSL Collective", () => {
    expect(content.attrs).not.toHaveProperty("server");
  });

  it("serves application/xml", () => {
    expect(rslResponse().headers.get("content-type")).toContain("application/xml");
  });
});
