import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index.mjs";
import { runRightsChecks, formatReport } from "../scripts/rights-assertions.mjs";

// The STATIC half of the rights check (see scripts/rights-assertions.mjs for
// the static-vs-live split). Drives the real Worker over a stubbed origin and
// runs the deploy-time invariant set over the responses it actually composes.
//
// This is not a restatement of the source constants. Every artifact below is
// produced by worker.fetch — the header wrap, the HTMLRewriter meta injection,
// and the robots.txt composition all really run — so a change that breaks the
// composition fails here, on the PR, before it can reach a deploy gate.
//
// What it CANNOT prove: that any of this is live. An undeployed Worker, a
// Cloudflare edge rule, or a cached robots.txt is invisible from here.

// A WordPress-shaped origin. The Link header matters: the Worker must APPEND
// rel="license" without clobbering WordPress's REST-discovery entry, and a stub
// that omitted it would let a clobbering regression pass — the stub has to model
// the transport's transform, not just its happy path.
const WP_LINK =
  '<https://juanlentino.com/wp-json/>; rel="https://api.w.org/", <https://juanlentino.com/>; rel=shortlink';

const ORIGIN_ROBOTS = "User-agent: *\nDisallow: /tools/\n";

// Modelled on the LIVE /llms.txt Rights block, not invented. /llms.txt is
// WordPress prose that the Worker only proxies, so static mode is checking the
// ASSERTION LOGIC against a faithful stub — the live run is what checks the
// actual content. The mutations below are what give the static half its value:
// they prove the invariant can fail.
const ORIGIN_LLMS = `# Juan Lentino

## Rights

- [RSL license](https://juanlentino.com/license.xml): machine-readable terms. Search and AI input
  are permitted unconditionally and free. AI training is reserved by default and permitted only
  under the attribution conditions stated in the TDM policy.
- [TDM policy](https://juanlentino.com/tdm-policy/): the text-and-data-mining reservation behind
  the TDM-Reservation headers, and the conditions a training licence requires.
`;
const ORIGIN_HTML =
  "<html><head><title>A note</title></head><body><p>prose</p></body></html>";

function stubOrigin() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input) => {
      const url = new URL(typeof input === "string" ? input : input.url);
      if (url.pathname === "/robots.txt") {
        return new Response(ORIGIN_ROBOTS, { headers: { "content-type": "text/plain" } });
      }
      if (url.pathname === "/llms.txt") {
        return new Response(ORIGIN_LLMS, { headers: { "content-type": "text/plain" } });
      }
      if (url.pathname.startsWith("/wp-json/")) {
        return new Response("[]", { headers: { "content-type": "application/json", link: WP_LINK } });
      }
      return new Response(ORIGIN_HTML, { headers: { "content-type": "text/html", link: WP_LINK } });
    }),
  );
}

async function artifact(path, accept) {
  const url = `https://juanlentino.com${path}`;
  const res = await worker.fetch(new Request(url, accept ? { headers: { accept } } : undefined), {});
  return { url, status: res.status, headers: res.headers, body: await res.text() };
}

afterEach(() => vi.unstubAllGlobals());

describe("rights-signal consistency (static)", () => {
  async function collect() {
    stubOrigin();
    const [html, wpjson, robots, tdmrep, license, policy, policyOdrl, nsTdm, nsTdmJson, llms, note] = await Promise.all([
      artifact("/"),
      artifact("/wp-json/wp/v2/posts"),
      artifact("/robots.txt"),
      artifact("/.well-known/tdmrep.json"),
      artifact("/license.xml"),
      artifact("/tdm-policy/"),
      artifact("/tdm-policy/", "application/ld+json"),
      artifact("/ns/tdm"),
      artifact("/ns/tdm", "application/ld+json"),
      artifact("/llms.txt"),
      artifact("/notes/a-note/"),
    ]);
    return { html, wpjson, robots, tdmrep, license, policy, policyOdrl, nsTdm, nsTdmJson, llms, note };
  }

  it("every layer the Worker composes agrees with every other", async () => {
    const report = runRightsChecks(await collect());
    // The formatted report is the failure message, so a red run names the
    // drifted invariant instead of just saying `false !== true`.
    expect(report.ok, `\n${formatReport(report, "static")}`).toBe(true);
    expect(report.passed).toBeGreaterThan(15);
  });

  // The runner is a guard. A guard that cannot fail is decoration, so each
  // mutation below is a real regression the check exists to catch, and each
  // must turn it red. These are the checks on the checks.
  const mutations = [
    ["tdmrep says rights are NOT reserved", (a) => (a.tdmrep.body = a.tdmrep.body.replace('"tdm-reservation": 1', '"tdm-reservation": 0'))],
    ["license.xml collapses back to one naked ai-train grant", (a) => (a.license.body = a.license.body.replace(/<permits type="usage">search ai-input<\/permits>/, '<permits type="usage">search ai-input ai-train</permits>'))],
    ["license.xml stops parsing", (a) => (a.license.body = a.license.body.replace("</rsl>", ""))],
    ["the policy page reverts to a placeholder", (a) => (a.policy.body = "<html><body><strong>Placeholder.</strong></body></html>")],
    ["robots.txt gains a second Content-Signal line", (a) => (a.robots.body += "\nContent-Signal: ai-train=yes\n")],
    ["robots.txt loses the Sitemap pointer", (a) => (a.robots.body = a.robots.body.replace(/^Sitemap:.*$/m, ""))],
    ["a named crawler is quietly un-blocked", (a) => (a.robots.body = a.robots.body.replace("User-agent: GPTBot\nDisallow: /", ""))],
    ["use=reference is published with no extension notice", (a) => (a.robots.body = a.robots.body.replace(/# NON-NORMATIVE LOCAL EXTENSION: use=reference/, "#"))],
    ["the note loses its TDM meta tags", (a) => (a.note.body = a.note.body.replace(/<meta name="tdm-reservation"[^>]*>/, ""))],
    ["the Link header clobbers WordPress's own entries", (a) => a.html.headers.set("link", '<https://juanlentino.com/license.xml>; rel="license"')],
    ["the tdmrep policy URL drifts from the header", (a) => (a.tdmrep.body = a.tdmrep.body.replace("/tdm-policy/", "/tdm-policy-old/"))],
    ["the ODRL policy grants ai-train with no duty", (a) => (a.policyOdrl.body = a.policyOdrl.body.replace(/"duty": \[[\s\S]*?\n {6}\]\n/, ""))],
    ["the ODRL policy drifts to a different version than the HTML", (a) => (a.policyOdrl.body = a.policyOdrl.body.replace(/"sn:version": "[^"]*"/, '"sn:version": "9.9"'))],
    ["Vary: Accept is dropped from the HTML representation", (a) => a.policy.headers.delete("vary")],
    ["license.xml names CC BY as the governing attribution standard", (a) => (a.license.body = a.license.body.replace("<standard>https://juanlentino.com/tdm-policy/</standard>", "<standard>https://creativecommons.org/licenses/by/4.0/</standard>"))],
    ["the policy stops denying that it grants CC BY 4.0", (a) => (a.policy.body = a.policy.body.replace(/This is not a grant of CC BY 4\.0 over this content/i, "This content is available"))],
    ["the ODRL duty loses the incorporated attribution standard", (a) => (a.policyOdrl.body = a.policyOdrl.body.replace(/"sn:attributionStandard": "[^"]*",?\n/, ""))],
    ["a new sn: term is emitted with no definition at /ns/tdm", (a) => (a.policyOdrl.body = a.policyOdrl.body.replace('"sn:status"', '"sn:undocumentedThing": "x",\n  "sn:status"'))],
    ["/ns/tdm stops resolving", (a) => { a.nsTdm.body = "not found"; a.nsTdm.headers = new Headers({ "content-type": "text/plain" }); }],
    ["an ODRL purpose appears that robots.txt never declares", (a) => (a.policyOdrl.body = a.policyOdrl.body.replace('"sn:ai-train"', '"sn:ai-embed"'))],
    // The real regression, reproduced: the exception stated as the rule.
    ["llms.txt announces the training grant with no reservation", (a) => (a.llms.body = a.llms.body.replace(/AI training is reserved by default and permitted only[\s\S]*?TDM policy\./, "AI training permitted with attribution."))],
    ["llms.txt mentions training but drops the link to the conditions", (a) => (a.llms.body = a.llms.body.replace(/https:\/\/juanlentino\.com\/tdm-policy\//g, "https://example.invalid/"))],
  ];

  it.each(mutations)("fails loudly when %s", async (_label, mutate) => {
    const artifacts = await collect();
    mutate(artifacts);
    expect(runRightsChecks(artifacts).ok).toBe(false);
  });
});
