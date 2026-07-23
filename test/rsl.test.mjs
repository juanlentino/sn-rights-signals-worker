import { describe, expect, it } from "vitest";
import { RSL_XML, rslResponse } from "../src/rsl.mjs";

describe("license.xml (RSL 1.0)", () => {
  it("declares the rsl namespace and required elements", () => {
    expect(RSL_XML).toContain('xmlns="https://rslstandard.org/rsl"');
    expect(RSL_XML).toContain('<content url="/">');
    expect(RSL_XML).toContain('<permits type="usage">ai-train</permits>');
    expect(RSL_XML).toContain('<payment type="attribution">');
    expect(RSL_XML).toContain("<standard>https://juanlentino.com/tdm-policy/</standard>");
  });

  it("is well-formed XML with balanced tags", () => {
    const opens = [...RSL_XML.matchAll(/<([a-z][\w-]*)[ >]/g)].map((m) => m[1]);
    const closes = [...RSL_XML.matchAll(/<\/([a-z][\w-]*)>/g)].map((m) => m[1]);
    expect(closes.sort()).toEqual(opens.filter((t) => RSL_XML.includes(`</${t}>`)).sort());
  });

  it("serves application/xml", () => {
    const res = rslResponse();
    expect(res.headers.get("content-type")).toContain("application/xml");
  });
});
