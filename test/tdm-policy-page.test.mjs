import { describe, expect, it } from "vitest";
import { tdmPolicyHtml } from "../src/tdm-policy-page.mjs";

describe("tdmPolicyHtml", () => {
  const html = tdmPolicyHtml();

  it("is clearly marked as a placeholder, not legal terms", () => {
    expect(html.toLowerCase()).toContain("placeholder");
    expect(html.toLowerCase()).toContain("counsel");
  });

  it("carries the tdm meta tags and links to the RSL licence", () => {
    expect(html).toContain('<meta name="tdm-reservation" content="1">');
    expect(html).toContain('href="https://juanlentino.com/license.xml"');
    expect(html).toContain('<link rel="canonical" href="https://juanlentino.com/tdm-policy/">');
  });
});
