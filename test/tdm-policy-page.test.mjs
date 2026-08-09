import { describe, expect, it } from "vitest";
import { tdmPolicyHtml } from "../src/tdm-policy-page.mjs";
import { POLICY_DATE, POLICY_STATUS, POLICY_VERSION } from "../src/constants.mjs";
import { POLICY_SECTIONS } from "../src/tdm-policy-terms.mjs";

// v1.7.0 REPLACED THIS FILE'S SUBJECT. It used to assert the page was a
// placeholder — which it was, and which was the defect: every rights layer
// pointed at a page offering nothing to accept. The assertions now pin the
// operative document.

describe("tdmPolicyHtml", () => {
  const html = tdmPolicyHtml();

  it("renders every declared section, with a matching contents entry", () => {
    for (const s of POLICY_SECTIONS) {
      expect(html).toContain(`<section id="${s.id}">`);
      expect(html).toContain(`<a href="#${s.id}">`);
    }
  });

  it("states the reservation, the conditional grant, and what it does not claim", () => {
    expect(html).toMatch(/expressly reserves the right to reproduce and extract/i);
    expect(html).toContain("Article 4(3)");
    expect(html).toMatch(/conditions precedent/i);
    // The overclaim guard. Deleting §7 is a legal change, not an editorial one.
    expect(html).toMatch(/does not settle and cannot/i);
  });

  it("states the attribution condition in testable terms, C1 through C5", () => {
    for (const id of ["C1", "C2", "C3", "C4", "C5"]) {
      expect(html).toContain(`${id} &mdash;`);
    }
    // Each condition carries its own verification test — that is what makes it
    // operative rather than aspirational.
    expect(html.match(/<em>Test:<\/em>/g)).toHaveLength(5);
  });

  it("names the acceptance routes and the contact", () => {
    expect(html).toMatch(/By performance/);
    expect(html).toMatch(/By notice/);
    expect(html).toContain("https://juanlentino.com/contact/");
  });

  it("links every machine-readable pointer so a reviewer can trace the stack", () => {
    for (const href of [
      "https://juanlentino.com/license.xml",
      "https://juanlentino.com/.well-known/tdmrep.json",
      "https://juanlentino.com/robots.txt",
    ]) {
      expect(html).toContain(`href="${href}"`);
    }
  });

  it("carries the version, the effective date, and the supersession note", () => {
    expect(html).toContain(`<meta name="tdm-policy-version" content="${POLICY_VERSION}">`);
    expect(html).toContain(POLICY_DATE);
    expect(html).toMatch(/OpenTimestamps/);
  });

  it("declares its draft status in the markup, in a comment, and in a banner", () => {
    expect(html).toContain(`<meta name="tdm-policy-status" content="${POLICY_STATUS}">`);
    expect(html).toContain(`STATUS: ${POLICY_STATUS.toUpperCase()}`);
    expect(html).toMatch(/NOT been reviewed by IP counsel/);
    if (POLICY_STATUS === "draft") {
      expect(html).toContain("Draft — not final legal terms");
    }
  });

  it("marks use=reference as non-normative where a human reader will meet it", () => {
    expect(html).toMatch(/not part of the Cloudflare Content Signals vocabulary/i);
    expect(html).toMatch(/not load-bearing/i);
  });

  it("keeps the canonical link and the TDM meta tags", () => {
    expect(html).toContain('<meta name="tdm-reservation" content="1">');
    expect(html).toContain('<link rel="canonical" href="https://juanlentino.com/tdm-policy/">');
  });
});
