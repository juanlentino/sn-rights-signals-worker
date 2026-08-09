// Document-layer rights assertions: tdmrep.json, license.xml, the policy page,
// and the HTML meta tags on a real note.
//
// license.xml is really PARSED (scripts/mini-xml.mjs) and asserted
// structurally. Substring assertions against the template that produced the
// file would pass on a merged-back-into-one licence, which is precisely the
// regression v1.7.0 exists to prevent.

import { childrenNamed, parseXml, textOf } from "./mini-xml.mjs";
import { POLICY_STATUS, POLICY_VERSION } from "../src/constants.mjs";
import { POLICY_SECTIONS } from "../src/tdm-policy-terms.mjs";
import { header } from "./rights-checks-transport.mjs";

const UNCONDITIONAL = ["search", "ai-input"];

function usageTokens(license) {
  return childrenNamed(license, "permits")
    .filter((p) => (p.attrs.type || "usage") === "usage")
    .flatMap((p) => textOf(p).split(/\s+/))
    .filter(Boolean);
}

function paymentType(license) {
  const payments = childrenNamed(license, "payment");
  // RSL 1.0 §3: "If omitted, the license is assumed to be free."
  if (payments.length === 0) return "free";
  return payments[0].attrs.type || "free";
}

/**
 * tdmrep.json, license.xml, policy page and note-meta assertions.
 *
 * @param {object} a Artifact bundle from rights-assertions.mjs.
 * @param {(name: string, fn: () => void) => object} check Assertion runner.
 * @returns {object[]} Result records.
 */
export function documentChecks(a, check) {
  const results = [];

  results.push(
    check("tdmrep.json: parses, reserves rights, and points at a policy", () => {
      const doc = JSON.parse(a.tdmrep.body);
      if (!Array.isArray(doc) || doc.length === 0) throw new Error("not a non-empty array");
      const entry = doc[0];
      // Strict 1, not truthy: the TDMRep vocabulary uses 0 for "not reserved",
      // and 0 is falsy — a truthy test would report the inverse state as fine.
      if (entry["tdm-reservation"] !== 1) {
        throw new Error(`tdm-reservation is ${JSON.stringify(entry["tdm-reservation"])}, want 1`);
      }
      if (!entry["tdm-policy"]) throw new Error("no tdm-policy field");
    }),

    check("tdmrep.json: its tdm-policy equals the TDM-Policy header", () => {
      const entry = JSON.parse(a.tdmrep.body)[0];
      const hdr = header(a.html, "tdm-policy");
      if (entry["tdm-policy"] !== hdr) {
        throw new Error(`tdmrep=${entry["tdm-policy"]} header=${hdr}`);
      }
    }),

    check("license.xml: parses as well-formed XML in the RSL namespace", () => {
      const rsl = parseXml(a.license.body);
      if (rsl.name !== "rsl") throw new Error(`root is <${rsl.name}>, want <rsl>`);
      if (rsl.attrs.xmlns !== "https://rslstandard.org/rsl") {
        throw new Error(`xmlns is ${JSON.stringify(rsl.attrs.xmlns)}`);
      }
      if (childrenNamed(rsl, "content").length !== 1) throw new Error("want exactly one <content>");
    }),

    check("license.xml: carries no <content server=…> (not joining the RSL Collective)", () => {
      const content = childrenNamed(parseXml(a.license.body), "content")[0];
      if ("server" in content.attrs) {
        throw new Error(`server attribute present: ${content.attrs.server}`);
      }
    }),

    check("license.xml: the unconditional permits are a FREE licence of their own", () => {
      // Issue 2. Read alone, the file must show that search and ai-input cost
      // nothing — separately from the conditioned training permit.
      const content = childrenNamed(parseXml(a.license.body), "content")[0];
      const free = childrenNamed(content, "license").filter((l) => paymentType(l) === "free");
      const tokens = new Set(free.flatMap(usageTokens));
      const missing = UNCONDITIONAL.filter((t) => !tokens.has(t));
      if (missing.length) throw new Error(`not permitted free: ${missing.join(", ")}`);
      if (tokens.has("ai-train")) throw new Error("ai-train is permitted under a FREE licence");
    }),

    check("license.xml: ai-train is permitted only under payment type=attribution", () => {
      const content = childrenNamed(parseXml(a.license.body), "content")[0];
      const licenses = childrenNamed(content, "license");
      const training = licenses.filter((l) => usageTokens(l).includes("ai-train"));
      if (training.length !== 1) {
        throw new Error(`${training.length} licences permit ai-train, want exactly 1`);
      }
      const type = paymentType(training[0]);
      if (type !== "attribution") throw new Error(`payment type is ${JSON.stringify(type)}`);
      // "all" and "ai-all" would silently re-grant training under the free
      // licence via a superset token, defeating the split entirely.
      const supersets = licenses.flatMap(usageTokens).filter((t) => t === "all" || t === "ai-all");
      if (supersets.length) throw new Error(`superset token grants training: ${supersets.join(", ")}`);
    }),

    check("license.xml: the attribution standard is the policy page, not a dead link", () => {
      const content = childrenNamed(parseXml(a.license.body), "content")[0];
      const training = childrenNamed(content, "license").find((l) =>
        usageTokens(l).includes("ai-train"),
      );
      const payment = childrenNamed(training, "payment")[0];
      const standard = textOf(childrenNamed(payment, "standard")[0] || { text: "" });
      const hdr = header(a.html, "tdm-policy");
      if (!standard) throw new Error("no <standard> under the attribution payment");
      if (hdr && standard !== hdr) throw new Error(`standard=${standard} TDM-Policy=${hdr}`);
    }),

    check("license.xml and robots.txt agree on the shape of the training term", () => {
      // The pairing IS the design: robots says no by default, license.xml says
      // yes-if-attributed. Either half alone is a misstatement of the position.
      const body = String(a.robots.body).toLowerCase();
      const reserved = body.includes("ai-train=no");
      const content = childrenNamed(parseXml(a.license.body), "content")[0];
      const conditioned = childrenNamed(content, "license").some(
        (l) => usageTokens(l).includes("ai-train") && paymentType(l) === "attribution",
      );
      if (!reserved || !conditioned) {
        throw new Error(
          `robots reserves ai-train=${reserved}; license.xml conditions it=${conditioned}`,
        );
      }
    }),

    check("policy page: answers with every section the terms declare", () => {
      const html = String(a.policy.body);
      const missing = POLICY_SECTIONS.filter((s) => !html.includes(`id="${s.id}"`));
      if (missing.length) throw new Error(`missing sections: ${missing.map((s) => s.id).join(", ")}`);
      if (!/id="grant"[\s\S]*C1[\s\S]*C5/.test(html)) {
        throw new Error("the grant section does not state the C1–C5 conditions");
      }
    }),

    check("policy page: is not a placeholder", () => {
      // The original defect. "Placeholder" as the whole body is what every
      // signal layer was pointing at; this fails if it ever comes back.
      const html = String(a.policy.body);
      if (/<strong>Placeholder\.<\/strong>/i.test(html)) throw new Error("placeholder body is back");
      if (html.length < 4000) throw new Error(`policy page is only ${html.length} bytes`);
    }),

    check("policy page: its draft state matches POLICY_STATUS, and the version is stated", () => {
      const html = String(a.policy.body);
      const declared = html.match(/<meta name="tdm-policy-status" content="([^"]*)">/);
      const version = html.match(/<meta name="tdm-policy-version" content="([^"]*)">/);
      if (!declared) throw new Error("no tdm-policy-status meta");
      if (!version) throw new Error("no tdm-policy-version meta");
      if (version[1] !== POLICY_VERSION) throw new Error(`version meta ${version[1]} != ${POLICY_VERSION}`);
      // Live mode compares the DEPLOYED page against the CURRENT source, so a
      // mismatch here means the worker has not shipped the current terms.
      if (declared[1] !== POLICY_STATUS) throw new Error(`status meta ${declared[1]} != ${POLICY_STATUS}`);
      const banner = /Draft — not final legal terms/.test(html);
      if (declared[1] === "draft" && !banner) throw new Error("status is draft but no banner renders");
      if (declared[1] !== "draft" && banner) throw new Error("status is final but the draft banner renders");
    }),

    check("policy (ODRL): the same URL answers ld+json to a machine", () => {
      // TDMRep treats a policy as machine-readable ONLY when served as
      // application/(ld+)json. Serving HTML alone leaves the tdm-policy field
      // pointing at something no crawler can act on.
      const ct = header(a.policyOdrl, "content-type");
      if (!/application\/(ld\+)?json/.test(ct)) throw new Error(`content-type is ${JSON.stringify(ct)}`);
      const doc = JSON.parse(a.policyOdrl.body);
      if (doc.profile !== "http://www.w3.org/ns/tdmrep") throw new Error(`profile is ${doc.profile}`);
      if (doc["@type"] !== "Offer") throw new Error(`@type is ${doc["@type"]}`);
    }),

    check("policy (ODRL): Vary: Accept rides BOTH representations", () => {
      // Without it a shared cache serves the JSON to a browser and the HTML to
      // a crawler — worse than not negotiating at all.
      for (const [label, res] of [["html", a.policy], ["ld+json", a.policyOdrl]]) {
        const v = header(res, "vary");
        if (!/accept/i.test(v)) throw new Error(`${label} representation has Vary: ${JSON.stringify(v)}`);
      }
    }),

    check("policy (ODRL): its permissions mirror the RSL licences exactly", () => {
      // The cross-layer assertion that matters: two machine-readable
      // expressions of the same grant, checked against EACH OTHER. Either one
      // drifting alone is the defect this exists to catch.
      const doc = JSON.parse(a.policyOdrl.body);
      const purposeOf = (p) => String(p.constraint?.[0]?.["odrl:rightOperand"] || "");
      const dutied = new Set(
        doc.permission.filter((p) => p.duty?.length).map((p) => purposeOf(p).replace(/^sn:/, "")),
      );
      const free = new Set(
        doc.permission.filter((p) => !p.duty?.length).map((p) => purposeOf(p).replace(/^sn:/, "")),
      );
      for (const t of UNCONDITIONAL) {
        if (!free.has(t)) throw new Error(`${t} is not an unconditional ODRL permission`);
      }
      if (!dutied.has("ai-train")) throw new Error("ai-train carries no ODRL duty");
      if (free.has("ai-train")) throw new Error("ai-train is permitted with no duty");
      const duty = doc.permission.find((p) => purposeOf(p) === "sn:ai-train").duty[0];
      if (duty.action !== "attribute") throw new Error(`duty action is ${duty.action}`);
    }),

    check("policy (ODRL): version and draft status match the HTML representation", () => {
      const doc = JSON.parse(a.policyOdrl.body);
      const html = String(a.policy.body);
      const version = html.match(/<meta name="tdm-policy-version" content="([^"]*)">/);
      const status = html.match(/<meta name="tdm-policy-status" content="([^"]*)">/);
      if (doc["sn:version"] !== version?.[1]) {
        throw new Error(`odrl=${doc["sn:version"]} html=${version?.[1]}`);
      }
      if (doc["sn:status"] !== status?.[1]) {
        throw new Error(`odrl=${doc["sn:status"]} html=${status?.[1]}`);
      }
      if (!String(doc.uid).endsWith(doc["sn:version"])) {
        throw new Error(`uid ${doc.uid} is not versioned to ${doc["sn:version"]}`);
      }
    }),

    check("note: the TDM meta tags are present in the rendered <head>", () => {
      const html = String(a.note.body);
      for (const tag of ['<meta name="tdm-reservation" content="1">', '<meta name="tdm-policy"']) {
        if (!html.includes(tag)) throw new Error(`missing ${tag} on ${a.note.url}`);
      }
    }),
  );

  return results;
}
