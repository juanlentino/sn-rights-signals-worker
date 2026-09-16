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
import { contentSignalLines, header } from "./rights-checks-transport.mjs";

const UNCONDITIONAL = ["search", "ai-input"];

// The exact `src="..."` attribute the WebMCP script tag renders with. Hoisted
// once so the "exactly once" and "every HTML surface" checks below can never
// drift apart into two slightly different literals.
const WEBMCP_TAG_SRC = 'src="https://juanlentino.com/webmcp/bridge.js"';

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
 * @param {string} bridgeSri sha384 digest of a.bridge.body, precomputed by
 *   the caller (rights-assertions.mjs) since check() itself must stay
 *   synchronous — see the comment on sriOf there.
 * @returns {object[]} Result records.
 */
export function documentChecks(a, check, bridgeSri) {
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

    check("CC BY 4.0 is incorporated as a STANDARD, never published as a grant", () => {
      // The most expensive mistake available in this stack. CC BY 4.0 grants
      // rights in the licensed MATERIAL, not in a USE — a consumer that read
      // it as the licence would take reproduction, adaptation and commercial
      // redistribution of whole works. Three assertions, one per layer.
      const html = String(a.policy.body);
      if (!html.includes("creativecommons.org/licenses/by/4.0/legalcode#s3a")) {
        throw new Error("the policy does not incorporate the §3(a) attribution standard");
      }
      if (!/not a grant of CC BY 4\.0 over this content/i.test(html)) {
        throw new Error("the policy does not deny granting CC BY 4.0 in terms");
      }
      // RSL: the governing <standard> must be the POLICY, not the CC licence.
      // §3(a) alone is satisfied by a model card; C2 is not, so a CC URL here
      // would let a parser read the weaker half as the whole term.
      const content = childrenNamed(parseXml(a.license.body), "content")[0];
      const training = childrenNamed(content, "license").find((l) =>
        usageTokens(l).includes("ai-train"),
      );
      const standards = childrenNamed(childrenNamed(training, "payment")[0], "standard").map(textOf);
      if (standards.some((s) => /creativecommons\.org/.test(s))) {
        throw new Error(`license.xml names CC BY as the governing standard: ${standards.join(", ")}`);
      }
      // ODRL: the CC reference may appear, but only under a local namespace.
      const duty = JSON.parse(a.policyOdrl.body)
        .permission.find((p) => /ai-train/.test(String(p.constraint?.[0]?.["odrl:rightOperand"])))
        .duty[0];
      if (!String(duty["sn:attributionStandard"] || "").includes("creativecommons.org")) {
        throw new Error("the ODRL duty does not name the incorporated attribution standard");
      }
      if (String(duty["sn:conditions"]).includes("creativecommons.org")) {
        throw new Error("the ODRL governing conditions point at CC BY instead of the policy");
      }
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

    check("/ns/tdm: the declared sn: namespace actually resolves", () => {
      // JSON-LD never required it to. But the ODRL document publishes this URI
      // and a published URI that 404s is a poor argument on a site whose claim
      // is that assertions should be checkable.
      const ct = header(a.nsTdm, "content-type");
      if (!/text\/html/.test(ct)) throw new Error(`HTML representation content-type is ${ct}`);
      const jsonCt = header(a.nsTdmJson, "content-type");
      if (!/application\/(ld\+)?json/.test(jsonCt)) throw new Error(`ld+json content-type is ${jsonCt}`);
      for (const [label, res] of [["html", a.nsTdm], ["ld+json", a.nsTdmJson]]) {
        if (!/accept/i.test(header(res, "vary"))) throw new Error(`${label} has no Vary: Accept`);
      }
    }),

    check("/ns/tdm: defines every sn: term the live ODRL policy emits", () => {
      // Walks the DEPLOYED ODRL document rather than the source, so a term
      // added to the policy without a definition fails here even if the two
      // repos were edited in different sessions. Three of these terms are
      // generated by interpolation and appear as literals in no source file —
      // a grep-based audit misses exactly them.
      const emitted = new Set();
      const visit = (n) => {
        if (typeof n === "string") {
          const m = n.match(/^sn:([A-Za-z0-9_-]+)$/);
          if (m) emitted.add(m[1]);
        } else if (Array.isArray(n)) n.forEach(visit);
        else if (n && typeof n === "object") {
          for (const [k, v] of Object.entries(n)) {
            const m = k.match(/^sn:([A-Za-z0-9_-]+)$/);
            if (m) emitted.add(m[1]);
            visit(v);
          }
        }
      };
      visit(JSON.parse(a.policyOdrl.body));
      if (emitted.size < 8) throw new Error(`only ${emitted.size} sn: terms found — the walk is vacuous`);
      const graph = JSON.parse(a.nsTdmJson.body)["@graph"] || [];
      const defined = new Set(graph.map((n) => String(n["@id"]).replace(/^sn:/, "")));
      const missing = [...emitted].filter((t) => !defined.has(t));
      if (missing.length) throw new Error(`undefined at /ns/tdm: ${missing.join(", ")}`);
      // Fragments must land, or the namespace resolves in name only.
      const html = String(a.nsTdm.body);
      const noAnchor = [...emitted].filter((t) => !html.includes(`id="${t}"`));
      if (noAnchor.length) throw new Error(`no fragment anchor for: ${noAnchor.join(", ")}`);
    }),

    check("the ODRL purposes cover exactly the published Content-Signal terms", () => {
      // Cross-layer: the machine policy must speak about the same three uses
      // robots.txt declares, no more and no fewer. A purpose the signal never
      // mentions is an unannounced grant; a signal term with no purpose is a
      // permission the machine document forgot to express.
      // Reuse the transport module's parser rather than a second regex here:
      // two parsers for one grammar is how the two layers start disagreeing
      // about what a Content-Signal line even is.
      const [line = ""] = contentSignalLines(a.robots.body);
      if (!line) throw new Error("no Content-Signal line to compare against");
      const signalTerms = new Set(
        line
          .split(",")
          .map((p) => p.trim().split("=")[0])
          .filter((t) => t && t !== "use"), // use= is the non-normative local extension
      );
      const purposes = new Set(
        JSON.parse(a.policyOdrl.body).permission.map((p) =>
          String(p.constraint?.[0]?.["odrl:rightOperand"] || "").replace(/^sn:/, ""),
        ),
      );
      const missing = [...signalTerms].filter((t) => !purposes.has(t));
      const extra = [...purposes].filter((t) => !signalTerms.has(t));
      if (missing.length || extra.length) {
        throw new Error(`signal-only: [${missing.join(", ")}] odrl-only: [${extra.join(", ")}]`);
      }
    }),

    check("/llms.txt: does not announce the training grant without the reservation", () => {
      // v1.10.3. NOT a worker surface — /llms.txt is WordPress prose, and that
      // is exactly why it drifted: it sat outside the boundary every other
      // assertion here draws. It shipped saying the RSL licence permits "AI
      // training permitted with attribution", which states the EXCEPTION as
      // the rule. A machine reading only that file — the reader it exists for
      // — takes away a permission and never learns the default is no.
      //
      // Deliberately loose on wording and strict on substance, because this is
      // hand-written prose that will be reworded and a brittle check would be
      // deleted the first time it cried wolf. The rule: if the file talks
      // about training at all, it must also say the default is reserved.
      const body = String(a.llms.body);
      const mentions = [...body.matchAll(/ai[- ]?train\w*|training/gi)];
      if (mentions.length === 0) return; // silent on the subject is not a misstatement

      // THE UNIT OF A CLAIM IS THE BULLET, not the document and not a character
      // radius. Two earlier versions of this check were killed by their own
      // mutation test: asserting /reserv/ document-wide passed when the
      // training bullet was gutted, because a LATER bullet contained the word
      // "reservation"; widening to a ±160-char window failed the same way,
      // since adjacent bullets sit inside it. A claim is qualified by the
      // sentence making it, so each list item is evaluated on its own.
      // \b matters more than it looks: an unanchored /condition/ matches
      // "unconditionally", which is the OPPOSITE meaning and let the gutted
      // bullet pass. Third time this mutation test killed a version of this
      // check — each failure was my regex being looser than my intent.
      const GATING = /\breserv|by default|only under|\bconditions?\b/i;
      const units = body.split(/\n(?=\s*[-*]\s)/);
      const ungated = units.filter(
        (u) => /ai[- ]?train\w*|training/i.test(u) && !GATING.test(u),
      );
      if (ungated.length) {
        throw new Error(
          "training stated with no reservation or condition in the same item: " +
            JSON.stringify(ungated[0].replace(/\s+/g, " ").trim().slice(0, 140)),
        );
      }
      // A machine reading only this file must be able to reach the conditions.
      const hdr = header(a.html, "tdm-policy");
      if (hdr && !body.includes(hdr)) {
        throw new Error(`mentions training but does not link the policy (${hdr})`);
      }
      if (!body.includes("/license.xml")) {
        throw new Error("mentions training but does not link license.xml");
      }
    }),

    check("note: the TDM meta tags are present in the rendered <head>", () => {
      const html = String(a.note.body);
      for (const tag of ['<meta name="tdm-reservation" content="1">', '<meta name="tdm-policy"']) {
        if (!html.includes(tag)) throw new Error(`missing ${tag} on ${a.note.url}`);
      }
    }),

    check("the WebMCP tag rides the policy HTML exactly once", () => {
      const n = a.policy.body.split(WEBMCP_TAG_SRC).length - 1;
      if (n !== 1) throw new Error(`found ${n} occurrences`);
    }),

    check("the WebMCP tag rides every HTML surface", () => {
      // html-injector.mjs stamps every pass-through page; tdm-policy-page.mjs
      // and ns-tdm.mjs each interpolate it into their own template. Three
      // independent call sites, so each needs its own witness here — a check
      // that only watched one HTML surface would stay green while another
      // silently dropped the tag (this is exactly what happened to /ns/tdm
      // before this loop existed).
      const missing = ["html", "note", "nsTdm"].filter((k) => !a[k].body.includes(WEBMCP_TAG_SRC));
      if (missing.length) throw new Error(`tag missing from: ${missing.join(", ")}`);
    }),

    check("no non-HTML representation carries the tag", () => {
      // Deliberately broader than WEBMCP_TAG_SRC: a leak that lands as a
      // relative src, a different quoting style, or inside a comment is still
      // a leak, and this check exists to catch the tag turning up anywhere in
      // a document that must stay tag-free — not just the one exact rendering.
      const clean = ["wpjson", "policyOdrl", "license", "tdmrep", "robots", "nsTdmJson", "llms"];
      const dirty = clean.filter((k) => a[k].body.includes("/webmcp/bridge.js"));
      if (dirty.length) throw new Error(`tag leaked into: ${dirty.join(", ")}`);
    }),

    check("the bridge serves a JS content-type", () => {
      const ct = header(a.bridge, "content-type");
      if (!ct.includes("text/javascript")) throw new Error(`content-type is ${JSON.stringify(ct)}`);
    }),

    check("the served bridge registers the five tools when driven (behavioral, not syntax)", () => {
      // A syntax-only gate (`new Function(body)`) stayed GREEN on a real broken
      // artifact earlier in this arc — bundler-injected `__name` refs that only
      // fail when the registration path RUNS. So this check drives the source
      // for real, with a fake window, instead of merely parsing it. Content-
      // type is its own check above; this one stays purely behavioral.
      const names = [];
      const fakeWin = {
        document: { getElementById: () => null, createElement: () => ({}), head: { appendChild: () => {} } },
        navigator: { modelContext: { registerTool: (t) => names.push(t.name) } },
      };
      // The served source ends with a no-arg snWebmcpMain() call; strip that
      // and drive registration with the fake window instead. A failed strip
      // must fail LOUDLY (never silently drive nothing), because a check that
      // quietly no-ops on an unexpected shape is exactly the failure mode this
      // check exists to close off.
      const src = a.bridge.body.replace(/snWebmcpMain\(\);\s*$/, "");
      if (src === a.bridge.body) {
        throw new Error("could not find the trailing snWebmcpMain(); call to strip — bridge shape changed?");
      }
      new Function('"use strict"; return function(win){' + src + '\nsnWebmcpMain(win);}')()(fakeWin);
      // v1.25.0 (bridge v2 arc one): five, in registration order.
      if (names.join(",") !== "verify-page,get-rights-terms,related-notes,get-site-map,get-citation") {
        throw new Error(`registered: [${names.join(", ")}]`);
      }
    }),

    check("SRI parity: the tag's integrity equals the sha384 of the served bridge", () => {
      const m = a.policy.body.match(/integrity="(sha384-[^"]+)"/);
      if (!m) throw new Error("no integrity attribute in the policy HTML tag");
      if (m[1] !== bridgeSri) throw new Error(`tag says ${m[1]}, served bytes hash to ${bridgeSri}`);
    }),
  );

  return results;
}
