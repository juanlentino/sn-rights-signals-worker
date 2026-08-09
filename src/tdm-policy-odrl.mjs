import {
  CONTACT_URL,
  POLICY_DATE,
  POLICY_STATUS,
  POLICY_VERSION,
  RIGHTSHOLDER,
  SITE_ORIGIN,
  TDM_POLICY_URL,
} from "./constants.mjs";

// The MACHINE-READABLE half of /tdm-policy/, as an ODRL policy in the W3C
// TDMRep profile.
//
// WHY THIS EXISTS. TDMRep says a TDM Policy is human-readable when it is served
// as text/html and MACHINE-READABLE when served as application/json or
// application/ld+json. Until v1.8.0 this site served HTML only — so the
// `tdm-policy` field in tdmrep.json, the `TDM-Policy` header on every response,
// and the `<standard>` in license.xml all resolved to a document no machine
// could act on. The reservation was machine-readable; the terms attached to it
// were not. A crawler could learn that rights were reserved and had no
// programmatic way to learn what would lift the reservation.
//
// Same URL, content-negotiated (see index.mjs) — NOT a second URL. Every layer
// already names https://juanlentino.com/tdm-policy/, and minting a parallel
// /tdm-policy.json would mean five pointers to update and a fifth thing to
// drift. `Vary: Accept` is mandatory on both representations or a shared cache
// will serve the JSON to a browser.
//
// TEMPLATE PROVENANCE: modelled on the W3C TDMRep techniques note and on
// Springer Nature's production policy at
// https://datasolutions.springernature.com/tdm/SNTDMPolicy.json — same
// @context stack, same Offer/profile/assigner/permission shape, same practice
// of versioning inside the `uid` path. Deliberately NOT invented here.
//
// THE ODRL FIT IS EXACT, WHICH IS WHY THE PROSE DID NOT HAVE TO BEND. ODRL
// defines a Duty as "a pre-condition which must be fulfilled in order to
// receive the Permission" — which is precisely what sections 2's C1–C5 are:
// conditions precedent, not covenants. So the attribution condition is a
// `duty` on the ai-train permission, and a party that does not discharge it
// simply never holds the permission. `attribute` is ODRL's own action ("To
// attribute the use of the Asset") and `attributedParty` its own property
// ("The Party to be attributed").

// Purpose tokens. There is no standardised ODRL right-operand vocabulary for
// "train a model" vs "ground an answer", so these are LOCALLY DEFINED and
// namespaced as such — the same discipline applied to use=reference in
// robots.txt. A namespaced local term a parser can resolve to a documented
// URI is honest; an unmarked bare token beside standard ones is not.
export const SN_TDM_NS = `${SITE_ORIGIN}/ns/tdm#`;
const purpose = (token) => `sn:${token}`;

const TARGET = `${SITE_ORIGIN}/#all-content`;

function permission(token, duty) {
  const rule = {
    target: TARGET,
    action: "tdm:mine",
    constraint: [
      { "odrl:leftOperand": "purpose", operator: "eq", "odrl:rightOperand": purpose(token) },
    ],
  };
  return duty ? { ...rule, duty } : rule;
}

export function tdmPolicyOdrl() {
  return {
    "@context": [
      "http://www.w3.org/ns/odrl.jsonld",
      "http://www.w3.org/2006/vcard/ns",
      {
        tdm: "http://www.w3.org/ns/tdmrep/",
        sn: SN_TDM_NS,
        "odrl:leftOperand": { "@type": "@id" },
        "odrl:rightOperand": { "@type": "@id" },
        "vcard:hasURL": { "@type": "@id" },
      },
    ],
    // Versioned in the uid path, as Springer's is. A licensee accepted a
    // specific document; that document must stay identifiable after the terms
    // move on. Superseded uids keep their OpenTimestamps anchor.
    uid: `${TDM_POLICY_URL}${POLICY_VERSION}`,
    "@type": "Offer",
    profile: "http://www.w3.org/ns/tdmrep",

    assigner: {
      uid: SITE_ORIGIN,
      "vcard:fn": RIGHTSHOLDER,
      "vcard:hasURL": CONTACT_URL,
    },

    permission: [
      // Section 3 — unconditional. No duty, so nothing is owed.
      permission("search"),
      permission("ai-input"),

      // Section 2 — the conditional grant. The duty is the whole of it: no
      // attribution, no permission.
      permission("ai-train", [
        {
          action: "attribute",
          attributedParty: {
            "vcard:fn": RIGHTSHOLDER,
            "vcard:hasURL": SITE_ORIGIN,
          },
          // C1–C5 are prose and stay prose. ODRL has no left operand for
          // "visible to the end user in the same response", and inventing one
          // would produce a term no processor can evaluate while implying it
          // can. `sn:conditions` is namespaced local metadata that points a
          // machine at the operative text instead of faking it.
          //
          // `consequence` is deliberately ABSENT: there is no remedial step
          // that cures a failed condition precedent, and modelling one would
          // restate the grant as a covenant.
          "sn:conditions": `${TDM_POLICY_URL}#grant`,
        },
      ]),
    ],

    // Non-normative, for a human reading the JSON. Nothing resolves these.
    "sn:status": POLICY_STATUS,
    "sn:version": POLICY_VERSION,
    "sn:effectiveDate": POLICY_DATE,
    "sn:humanReadable": TDM_POLICY_URL,
    "sn:note":
      POLICY_STATUS === "draft"
        ? "DRAFT — not reviewed by IP counsel, not final legal terms. See the human-readable policy."
        : "",
  };
}

export const TDM_POLICY_ODRL_JSON = JSON.stringify(tdmPolicyOdrl(), null, 2);

export function tdmPolicyOdrlResponse() {
  return new Response(TDM_POLICY_ODRL_JSON, {
    status: 200,
    headers: {
      "content-type": "application/ld+json; charset=utf-8",
      // Mandatory. Both representations live at one URL, so a cache that
      // ignores Accept would hand the JSON to a browser and the HTML to a
      // crawler — worse than not negotiating at all.
      vary: "Accept",
      "cache-control": "public, max-age=3600",
    },
  });
}
