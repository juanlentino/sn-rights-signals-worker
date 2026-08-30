// Survey item A2 — the attribution licence, made machine-actionable.
//
// WHAT CHANGED. Until now the rights position was DECLARATORY: TDM-Reservation,
// TDM-Policy and Content-Signal ride every response (v1.5.0), addressed to a
// reader who may or may not exist and who cannot be identified either way. A1
// (v1.19.0) made identity checkable — Ed25519 HTTP Message Signatures verified
// in this Worker rather than rented from a plan tier. This file spends that: a
// VERIFIED agent is answered differently from an unverified one, with the terms
// returned beside the content they apply to, keyed to an identity that was
// actually proved.
//
// The decision to build it was taken on evidence, not on principle. In the week
// to 2026-08-30 the sensor recorded 311 verified reads against a pre-ship
// forecast of ~0, with the verified share rising across three readings
// (0.74% -> 1.66% -> 2.35%).
//
// A HANDSHAKE, NOT A PAYWALL. Cloudflare sells the paywall version (402 plus
// crawler-price, Stripe-backed). Building a homebrew charging mechanism here is
// out of scope and off-brand, and the test suite pins the absence of any price,
// payment or purchase signal in what this file emits.
//
// FAIL OPEN, like A1 itself. Every state that is not a proved identity — an
// agent that did not sign, one whose signature did not hold, one signing with a
// key nobody vouches for — receives EXACTLY the response it received before
// this file existed. An unverifiable signature means "unknown agent", never a
// blocked or degraded one. There is no branch here that removes anything.

import { POLICY_VERSION, TDM_POLICY_URL } from "./constants.mjs";
import { SIG_VALID } from "./web-bot-auth.mjs";

// The conditions of the §2 grant, by their stable ids, in document order.
//
// Held here as a LIST rather than parsed out of the policy prose, because the
// prose is a legal document with its own drafting rules and should not become
// load-bearing markup. The two are kept honest by a bidirectional drift test
// (test/licence-handshake.test.mjs): every id here must appear in §2, and every
// condition §2 states must appear here.
//
// That guard exists because this is the same failure constants.mjs already
// names for Content-Signal — a header and a file stating different terms is
// "worse than saying nothing, since a crawler reading both would get
// contradictory permissions". Here it would be worse still: advertising fewer
// conditions than the grant requires would describe a licence the rightsholder
// never offered.
export const LICENCE_CONDITION_IDS = ["C1", "C2", "C3", "C4", "C5"];

/**
 * The offer headers for one request's resolved signature state.
 *
 * Returns an EMPTY object for every state except a proved identity, so the
 * caller can spread it unconditionally and change nothing in the common case.
 *
 * Nothing here restates the terms. The operative text lives at one URL, under
 * one version, and these headers point at it — a header that paraphrased §2
 * would become a second, unversioned copy of a legal document, which is the
 * drift this whole stack exists to avoid.
 *
 * @param {string} state One of the SIG_* states from web-bot-auth.mjs.
 * @param {string} agentOrigin The Signature-Agent origin that was verified.
 * @returns {Record<string,string>}
 */
export function licenceOfferHeaders(state, agentOrigin) {
  if (state !== SIG_VALID) return {};

  const headers = {
    // "conditional", never "granted". The §2 conditions are conditions
    // PRECEDENT and this Worker cannot observe whether a requester will meet
    // them — it can only observe who is asking. Any word implying the licence
    // is held would be an assertion the edge is in no position to make.
    "TDM-Licence-Offer": "conditional",
    "TDM-Licence-Policy": TDM_POLICY_URL,
    // §2: "Any change to §2 changes what a licensee already accepted — bump
    // POLICY_VERSION." An offer that does not name its version cannot tell a
    // licensee WHICH text they met the conditions of.
    "TDM-Licence-Version": POLICY_VERSION,
    "TDM-Licence-Conditions": LICENCE_CONDITION_IDS.join(" "),
  };

  // The half that makes this a handshake rather than a broadcast: the offer is
  // addressed to the identity that was proved, echoed back from what the agent
  // itself presented. Omitted rather than faked if the origin is missing — an
  // offer keyed to nothing is a declaration, and we already have those.
  if (agentOrigin) headers["TDM-Licence-Agent"] = agentOrigin;

  return headers;
}
