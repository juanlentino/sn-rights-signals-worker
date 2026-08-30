import { describe, expect, it } from "vitest";
import { licenceOfferHeaders, LICENCE_CONDITION_IDS } from "../src/licence-handshake.mjs";
import { POLICY_SECTIONS } from "../src/tdm-policy-terms.mjs";
import { POLICY_VERSION, TDM_POLICY_URL } from "../src/constants.mjs";
import { SIG_INVALID, SIG_UNKNOWN_KEY, SIG_UNSIGNED, SIG_VALID } from "../src/web-bot-auth.mjs";

// Survey item A2 — make the attribution licence machine-actionable.
//
// Today the rights position DECLARES: TDM-Reservation, TDM-Policy and
// Content-Signal ride every response, addressed to a reader who may or may not
// exist. With A1 deployed and verifying (311 verified reads in the week to
// 2026-08-30, against a pre-ship forecast of ~0), a VERIFIED agent can be
// answered differently from an unverified one: the terms returned beside the
// content they apply to, keyed to a proven identity.
//
// This is a LICENSING HANDSHAKE, NOT A PAYWALL. Cloudflare sells the paywall
// version (402 + crawler-price, Stripe-backed); a homebrew charging mechanism
// is out of scope and off-brand. The last test in this file pins that.

describe("licence handshake — who gets the offer", () => {
  it("says nothing at all to an unsigned agent", () => {
    expect(licenceOfferHeaders(SIG_UNSIGNED, "https://bot.example")).toEqual({});
  });

  // FAIL OPEN, the same discipline A1 itself follows. A failed signature is an
  // UNKNOWN agent, never a punished one: it gets exactly the response it got
  // before this feature existed — the declaration, and nothing keyed to it.
  it("says nothing to an agent whose signature did not hold", () => {
    expect(licenceOfferHeaders(SIG_INVALID, "https://bot.example")).toEqual({});
  });

  it("says nothing to an agent signing with a key nobody vouches for", () => {
    expect(licenceOfferHeaders(SIG_UNKNOWN_KEY, "https://bot.example")).toEqual({});
  });

  it("makes the offer only to an agent that proved who it is", () => {
    const h = licenceOfferHeaders(SIG_VALID, "https://bot.example");
    expect(Object.keys(h).length).toBeGreaterThan(0);
  });
});

describe("licence handshake — what the offer says", () => {
  const h = licenceOfferHeaders(SIG_VALID, "https://bot.example");

  it("points at the operative text rather than restating it", () => {
    expect(h["TDM-Licence-Policy"]).toBe(TDM_POLICY_URL);
  });

  // §2 of the policy: "Any change to §2 changes what a licensee already
  // accepted — bump POLICY_VERSION." An offer that does not name its version
  // cannot tell a licensee WHICH terms they met.
  it("names the policy version, so a licensee knows which text they accepted", () => {
    expect(h["TDM-Licence-Version"]).toBe(POLICY_VERSION);
  });

  // This is the half that makes it a HANDSHAKE and not a broadcast: the offer
  // is addressed to the identity that was actually proved.
  it("echoes the verified agent the offer is keyed to", () => {
    expect(h["TDM-Licence-Agent"]).toBe("https://bot.example");
  });

  it("names every condition of the grant", () => {
    expect(h["TDM-Licence-Conditions"]).toBe(LICENCE_CONDITION_IDS.join(" "));
  });

  it("never asserts the licence is held — only that it is offered", () => {
    // The conditions are conditions PRECEDENT; the Worker cannot know whether a
    // requester will meet them. "offered" is the only honest word here.
    expect(h["TDM-Licence-Offer"]).toBe("conditional");
  });
});

// THE DRIFT GUARD. constants.mjs already carries this rule for Content-Signal:
// the header and the file must never state different terms, "a drift that would
// be worse than saying nothing, since a crawler reading both would get
// contradictory permissions." A header advertising C1-C3 while §2 requires
// C1-C5 is exactly that failure, and it is a LEGAL drift, not a cosmetic one.
describe("licence handshake — header and policy cannot drift apart", () => {
  const grant = POLICY_SECTIONS.find((s) => s.id === "grant");
  const inProse = [...grant.html.matchAll(/\b(C\d+)\s*&mdash;/g)].map((m) => m[1]);

  it("advertises every condition the policy actually states", () => {
    for (const id of inProse) expect(LICENCE_CONDITION_IDS).toContain(id);
  });

  it("advertises no condition the policy does not state", () => {
    for (const id of LICENCE_CONDITION_IDS) expect(inProse).toContain(id);
  });

  it("found conditions in the prose at all (guards the regex, not the terms)", () => {
    // Without this the two assertions above pass vacuously if the prose markup
    // ever changes shape — a green that would mean the guard stopped looking.
    expect(inProse.length).toBeGreaterThanOrEqual(5);
  });
});

describe("licence handshake — a handshake, never a paywall", () => {
  const h = licenceOfferHeaders(SIG_VALID, "https://bot.example");
  const serialized = JSON.stringify(h).toLowerCase();

  it("carries no price, payment, or purchase signal of any kind", () => {
    for (const word of ["price", "payment", "pay", "crawler-price", "402", "stripe", "purchase", "invoice"]) {
      expect(serialized).not.toContain(word);
    }
  });
});
