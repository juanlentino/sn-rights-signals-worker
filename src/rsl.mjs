import {
  CONTACT_URL,
  POLICY_DATE,
  RIGHTSHOLDER,
  TDM_POLICY_URL,
} from "./constants.mjs";

// /license.xml — RSL 1.0 (https://rslstandard.org/rsl).
//
// v1.7.0: SPLIT INTO TWO <license> ELEMENTS. Before this, the file carried a
// single licence permitting ai-train with an attribution payment, and nothing
// else. A parser that read only this file — which is the normal case, since
// robots.txt points at it with a License: line and a crawler may well fetch it
// alone — saw a bare grant to train. The ai-train=no reservation that the
// grant is an exception TO was in robots.txt, in the headers, and on the policy
// page, but not here. The file was correct as one layer of a stack and wrong as
// a standalone document, which is the only way most machines will read it.
//
// The fix uses RSL's own grammar rather than prose. §3.4: "Multiple <license>
// elements MAY appear within the same <content> to express distinct term sets."
// So the two tiers are two licences:
//
//   licence 1 — search, ai-input      payment type="free"          (§3 of the policy)
//   licence 2 — ai-train              payment type="attribution"   (§2 of the policy)
//
// Read in isolation the file now says what the rest of the stack says: two of
// the three uses are unconditional, the third costs attribution. And per §3's
// conservative-interpretation rule, a usage listed in NEITHER licence (e.g.
// ai-index, or any future token) is not licensed — so the file fails closed on
// vocabulary it does not know about.
//
// Element ORDER below is documentary only; §3 states order "MUST NOT affect
// their interpretation." No <content server=...> attribute: the owner is not
// joining the RSL Collective, so there is no license server to point at, and an
// unreachable one would be worse than none.
//
// Still true, and stated on the policy page: no major model provider is known
// to honour RSL today. This is forward-positioning, not enforcement.
export const RSL_XML = `<?xml version="1.0" encoding="UTF-8"?>
<rsl xmlns="https://rslstandard.org/rsl">
  <content url="/" lastmod="${POLICY_DATE}">

    <copyright type="person" contactUrl="${CONTACT_URL}">${RIGHTSHOLDER}</copyright>
    <terms>${TDM_POLICY_URL}</terms>

    <!-- Unconditional. Mirrors Content-Signal search=yes, ai-input=yes and
         section 3 of the policy: free, no acceptance, no attribution owed.

         "search ai-input" IS ONE ELEMENT ON PURPOSE, AND MUST STAY THAT WAY.
         Raised in the 2026-08-09 audit as possibly non-conforming, with a
         proposed split into two <permits type="usage"> elements. Checked
         against RSL 1.0 section 3.5, which settles it both ways:

           "the listed values, separated by one or more spaces, are allowed"

         so space separation conforms — and, in the same section:

           "A <license> element MAY contain at most one <permits> element for
            each distinct value of the type attribute"

         so the proposed remedy would itself have been NON-CONFORMING. Two
         <permits type="usage"> siblings inside one <license> is the thing the
         spec forbids. Splitting the grant means splitting the <license>, which
         would say something different: two separate term sets rather than one
         licence covering both uses.

         The worry behind the audit item was real — a strict parser reading only
         the first token would silently drop the ai-input grant — but the fix
         for that is a conforming document plus a test that asserts both tokens
         survive parsing, which test/rsl.test.mjs does. Do not "fix" this. -->
    <license>
      <permits type="usage">search ai-input</permits>
      <payment type="free"/>
      <legal type="contact">${TDM_POLICY_URL}</legal>
    </license>

    <!-- Conditional. Content-Signal says ai-train=no; that is the default and
         it is an Article 4(3) reservation, not an oversight. THIS licence is
         the sole route by which training becomes permitted, and it takes effect
         only for a party meeting the attribution conditions C1-C5 stated at
         the <standard> URL below. Attribution is the consideration; there is
         no monetary term.

         WHY <standard> IS THE POLICY URL AND NOT THE CC BY 4.0 URL, even
         though RSL's own guide shows CC BY there: the policy INCORPORATES
         CC BY 4.0 §3(a) as its definition of adequate attribution, and then
         adds C2-C4 on top (in-output, end-user-visible, corpus disclosure).
         §3(a) alone is satisfied by a model card; C2 is not. Naming the CC
         URL here would let a parser read the weaker half as the whole term,
         and a licensee could satisfy the file while failing the licence. One
         <standard>, pointing at the complete conditions. The CC reference is
         published where it cannot be mistaken for the governing term: in the
         policy prose, and as a namespaced sn:attributionStandard in the ODRL
         representation. -->
    <license>
      <permits type="usage">ai-train</permits>
      <payment type="attribution">
        <standard>${TDM_POLICY_URL}</standard>
      </payment>
      <legal type="contact">${CONTACT_URL}</legal>
    </license>

  </content>
</rsl>
`;

export function rslResponse() {
  return new Response(RSL_XML, {
    status: 200,
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}
