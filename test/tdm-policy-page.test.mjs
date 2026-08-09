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

  // v1.10.2. §6 used to claim "Each published version of this policy is
  // cryptographically timestamped", and that was false: anchoring runs on an
  // hourly sweep, so v1.0 was published and superseded inside one interval and
  // never got an anchor. These pin the corrected claim, because an
  // over-promise in the one section that talks about evidence is the worst
  // place in the document to carry one.
  describe("§6 does not over-promise the anchoring", () => {
    it("no longer claims EVERY published version is timestamped", () => {
      expect(html).not.toMatch(/Each published version of this policy is\s*cryptographically timestamped/i);
    });

    it("states the sweep-interval limit and what is still guaranteed", () => {
      expect(html).toMatch(/within a single sweep\s*interval<\/em> may therefore carry no anchor/i);
      expect(html).toMatch(/Every version that is in force across a\s*sweep is anchored/i);
      // The substantive promise must survive the correction — weakening the
      // over-claim must not quietly weaken the commitment underneath it.
      expect(html).toMatch(/no version is ever silently rewritten in place/i);
    });

    it("records the one instance rather than leaving it to be discovered", () => {
      expect(html).toMatch(/Known unanchored version: 1\.0/);
      // Naming WHAT differed is the point: an unexplained missing anchor
      // invites the reading that terms changed unrecorded.
      expect(html).toMatch(/did not yet list <code>\/ns\/tdm<\/code>/);
      expect(html).toMatch(/No term in[\s\S]{0,200}differed/);
    });
  });

  it("declares its status in the markup, in a comment, and in a banner that agrees", () => {
    expect(html).toContain(`<meta name="tdm-policy-status" content="${POLICY_STATUS}">`);
    expect(html).toContain(`STATUS: ${POLICY_STATUS.toUpperCase()}`);
    // Whatever the status, the page must never imply a legal review that has
    // not happened. This assertion holds in both branches on purpose.
    // \s+ because the source comment wraps; the words matter, the wrap does not.
    expect(html).toMatch(/NOT been\s+reviewed by a lawyer/);
    const draftBanner = html.includes("Draft — not final legal terms");
    expect(draftBanner).toBe(POLICY_STATUS === "draft");
  });

  // v1.9.0. The single most expensive mistake available in this document is
  // letting the CC BY reference read as a licence rather than as a definition.
  // CC BY 4.0 grants rights in the licensed MATERIAL, not in a USE, so a party
  // who accepted it would acquire reproduction, adaptation and commercial
  // redistribution of whole works. These assertions guard that boundary.
  describe("the CC BY 4.0 reference is a standard, not a grant", () => {
    it("incorporates §3(a) by link, as the definition of adequate attribution", () => {
      expect(html).toContain('href="https://creativecommons.org/licenses/by/4.0/legalcode#s3a"');
      expect(html).toMatch(/incorporated here as the standard of adequate attribution/i);
    });

    it("denies, in terms, that it grants CC BY 4.0 over the content", () => {
      expect(html).toMatch(/This is not a grant of CC BY 4\.0 over this content/i);
      expect(html).toMatch(/rights in the licensed <em>material<\/em> rather\s*than in a particular <em>use<\/em>/i);
    });

    it("names the reserved uses explicitly rather than leaving them to inference", () => {
      // "Everything not granted is reserved" is true but weak. Naming the
      // uses is what makes the boundary checkable by a reader in a hurry.
      for (const use of ["republication", "distribution", "translation", "adaptation"]) {
        expect(html.toLowerCase(), `${use} not named as reserved`).toContain(use);
      }
      expect(html).toMatch(/are\s*<strong>reserved<\/strong>/i);
    });

    it("keeps C2 stricter than §3(a), and says which governs on conflict", () => {
      // §3(a)'s "any reasonable manner" was written for republication and does
      // not settle placement for a generated answer. If C2 ever silently
      // collapsed into §3(a), the sharpest condition in the policy would go.
      expect(html).toMatch(/stricter than Creative Commons Attribution 4\.0 International, section 3\(a\)/i);
      expect(html).toMatch(/C2 governs/);
    });
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
