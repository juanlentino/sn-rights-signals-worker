// The rights-signal invariant set, and the runner that drives it.
//
// ONE assertion set, TWO sources of artifacts:
//
//   static  test/rights-consistency.test.mjs drives the real Worker over a
//           stubbed origin and feeds the composed responses in. Runs on every
//           PR inside the existing `npm test` job — no extra billed job.
//   live    scripts/check-rights-signals.mjs fetches juanlentino.com and feeds
//           the real responses in. Runs as a postdeploy step.
//
// Static mode proves the layers are mutually consistent AS COMPOSED. It cannot
// prove they are live — an edge rule, a stale cache, or an undeployed Worker is
// invisible to it. That is what live mode is for, and why the deploy gate is
// the live one. Saying this out loud because a green static run reads exactly
// like a green live run unless you know the difference.
//
// Artifact bundle shape (every member optional except as used):
//   { html, wpjson, note, robots, tdmrep, license, policy, bridge }
// each: { url?, status?, headers?: Headers|object, body: string }

import { transportChecks } from "./rights-checks-transport.mjs";
import { documentChecks } from "./rights-checks-documents.mjs";

// Records rather than throws. A checker that dies on the first bad layer hides
// every other layer's state, which is the opposite of what a drift report is for.
function check(name, fn) {
  try {
    fn();
    return { name, ok: true, detail: "" };
  } catch (err) {
    return { name, ok: false, detail: err && err.message ? err.message : String(err) };
  }
}

/**
 * The sha384 digest of a string, base64-encoded, in the `sha384-...` shape an
 * `integrity` attribute expects. Computed here — once, before the results
 * array is built — rather than inside a check() body, because check() is a
 * synchronous recorder (see above) and this is the one assertion that needs
 * an async primitive (crypto.subtle.digest) to produce its expected value.
 *
 * @param {string} body Exact served bytes to hash.
 * @returns {Promise<string>} `sha384-<base64>`.
 */
// Recomputes the digest from the served bytes rather than importing BRIDGE_SRI
// from src/webmcp-bridge.mjs on purpose: the oracle must not import the value
// it exists to verify, or a bug in that export would sail through unchecked.
async function sriOf(body) {
  const digest = await crypto.subtle.digest("SHA-384", new TextEncoder().encode(body));
  return "sha384-" + btoa(String.fromCharCode(...new Uint8Array(digest)));
}

/**
 * Run every rights invariant against an artifact bundle.
 *
 * Never throws: a malformed artifact surfaces as a failed check carrying the
 * parse error as its detail.
 *
 * ASYNC: the SRI-parity check needs a digest computed up front (see sriOf
 * above); every check itself stays the same synchronous check(name, fn), so
 * both drivers (the static test and the live script) only need one extra
 * `await` at the call site — nothing else about check() or its callers changes.
 *
 * @param {object} artifacts Bundle as described above.
 * @returns {Promise<{ok: boolean, passed: number, failed: number, results: object[]}>} Report.
 */
export async function runRightsChecks(artifacts) {
  const required = [
    "html",
    "wpjson",
    "robots",
    "tdmrep",
    "license",
    "policy",
    "policyOdrl",
    "nsTdm",
    "nsTdmJson",
    "llms",
    "note",
    "bridge",
  ];
  const absent = required.filter((k) => !artifacts || !artifacts[k]);

  const results = absent.length
    ? [{ name: "artifacts: every layer was collected", ok: false, detail: `missing: ${absent.join(", ")}` }]
    : [
        check("every layer answered with a 2xx", () => {
          const bad = required
            .map((k) => [k, artifacts[k].status])
            .filter(([, s]) => s !== undefined && (s < 200 || s > 299));
          if (bad.length) throw new Error(bad.map(([k, s]) => `${k}=${s}`).join(", "));
        }),
        ...transportChecks(artifacts, check),
        ...documentChecks(artifacts, check, await sriOf(artifacts.bridge.body)),
      ];

  const failed = results.filter((r) => !r.ok);
  return { ok: failed.length === 0, passed: results.length - failed.length, failed: failed.length, results };
}

/**
 * Render a report as plain text.
 *
 * @param {object} report Output of runRightsChecks.
 * @param {string} mode Label for the header line.
 * @returns {string} Human-readable report.
 */
export function formatReport(report, mode) {
  const lines = [`rights-signal check — ${mode}`, ""];
  for (const r of report.results) {
    lines.push(`${r.ok ? "  ok  " : "  FAIL"}  ${r.name}${r.ok ? "" : `\n          ${r.detail}`}`);
  }
  lines.push("");
  lines.push(
    report.ok
      ? `all ${report.passed} checks passed`
      : `${report.failed} of ${report.passed + report.failed} checks FAILED — the rights stack has drifted`,
  );
  return lines.join("\n");
}
