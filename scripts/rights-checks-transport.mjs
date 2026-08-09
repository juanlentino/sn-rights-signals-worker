// Transport-layer rights assertions: HTTP response headers, and robots.txt.
//
// Driven by rights-assertions.mjs, which supplies an artifact bundle that is
// either composed from src/ (static mode) or fetched from the live site.
//
// The assertions here deliberately compare LAYERS AGAINST EACH OTHER wherever
// two layers state the same fact, rather than each against the constant that
// produced it. A guard built from the same constant as the thing it guards can
// only ever catch a typo; it cannot catch the realistic failure, which is a
// partial deploy where one layer moved and another did not.

import { NAMED_CRAWLERS } from "../src/robots-block.mjs";

const CONTENT_SIGNAL_LINE = /^[ \t]*content-signal[ \t]*:[ \t]*(.+?)[ \t\r]*$/gim;

/**
 * Case-insensitive header lookup over a plain object or a Headers instance.
 *
 * @param {object} res Artifact with a `headers` member.
 * @param {string} name Header name.
 * @returns {string} Trimmed value, or '' when absent.
 */
export function header(res, name) {
  const h = res && res.headers;
  if (!h) return "";
  if (typeof h.get === "function") return (h.get(name) || "").trim();
  const key = Object.keys(h).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? String(h[key]).trim() : "";
}

/**
 * Every Content-Signal line found in a robots.txt body.
 *
 * @param {string} robots robots.txt source.
 * @returns {string[]} The value of each Content-Signal line, in order.
 */
export function contentSignalLines(robots) {
  return [...String(robots).matchAll(CONTENT_SIGNAL_LINE)].map((m) => m[1]);
}

function firstLineValue(robots, field) {
  const re = new RegExp(`^[ \\t]*${field}[ \\t]*:[ \\t]*(\\S.*?)[ \\t\\r]*$`, "im");
  const m = String(robots).match(re);
  return m ? m[1] : "";
}

/**
 * Header + robots.txt assertions.
 *
 * @param {object} a Artifact bundle from rights-assertions.mjs.
 * @param {(name: string, fn: () => void) => object} check Assertion runner.
 * @returns {object[]} Result records.
 */
export function transportChecks(a, check) {
  const results = [];
  const surfaces = [
    ["html", a.html],
    ["wp-json", a.wpjson],
    ["note", a.note],
  ].filter(([, res]) => res);

  for (const [label, res] of surfaces) {
    results.push(
      check(`${label}: TDM-Reservation is exactly "1"`, () => {
        const v = header(res, "tdm-reservation");
        // Value-level, never presence. "0" means rights are NOT reserved —
        // the semantic inverse — and an isset()-shaped test fails open on it.
        if (v !== "1") throw new Error(`got ${JSON.stringify(v)}, want "1"`);
      }),
      check(`${label}: TDM-Policy header is present and absolute`, () => {
        const v = header(res, "tdm-policy");
        if (!/^https:\/\/\S+$/.test(v)) throw new Error(`got ${JSON.stringify(v)}`);
      }),
      check(`${label}: Content-Signal header carries ai-train=no and ai-input=yes`, () => {
        const v = header(res, "content-signal").toLowerCase();
        if (!v.includes("ai-train=no")) throw new Error(`ai-train is not "no": ${v}`);
        if (!v.includes("ai-input=yes")) throw new Error(`ai-input is not "yes": ${v}`);
        if (!v.includes("search=yes")) throw new Error(`search is not "yes": ${v}`);
      }),
    );
  }

  results.push(
    check("headers: HTML and /wp-json state the identical Content-Signal", () => {
      const a1 = header(a.html, "content-signal");
      const a2 = header(a.wpjson, "content-signal");
      if (a1 !== a2) throw new Error(`html=${JSON.stringify(a1)} wp-json=${JSON.stringify(a2)}`);
    }),

    check("headers: HTML and /wp-json state the identical TDM-Policy", () => {
      const a1 = header(a.html, "tdm-policy");
      const a2 = header(a.wpjson, "tdm-policy");
      if (a1 !== a2) throw new Error(`html=${JSON.stringify(a1)} wp-json=${JSON.stringify(a2)}`);
    }),

    check('headers: a Link rel="license" entry is present alongside WordPress\'s own', () => {
      const link = header(a.html, "link");
      if (!/rel=("license"|license)/i.test(link)) throw new Error(`no rel="license" in: ${link}`);
      // APPEND, not set: WordPress's REST-discovery entry must survive, or API
      // autodiscovery breaks. Its absence means something clobbered the list.
      if (!/api\.w\.org/.test(link)) {
        throw new Error("rel=license present but WordPress's own Link entries are gone");
      }
    }),

    check("robots.txt: exactly ONE Content-Signal line", () => {
      const lines = contentSignalLines(a.robots.body);
      if (lines.length !== 1) throw new Error(`found ${lines.length} lines: ${lines.join(" | ")}`);
    }),

    check("robots.txt: its Content-Signal is byte-identical to the header", () => {
      // The strongest cross-layer assertion available here. Both come from one
      // constant in source, so in static mode this pins the wiring; live, it
      // catches an edge rule or a cache serving a stale robots.txt.
      const [line] = contentSignalLines(a.robots.body);
      const hdr = header(a.html, "content-signal");
      if (line !== hdr) throw new Error(`robots=${JSON.stringify(line)} header=${JSON.stringify(hdr)}`);
    }),

    check("robots.txt: License: points at the same URL as the Link header", () => {
      const license = firstLineValue(a.robots.body, "license");
      if (!license) throw new Error("no License: line");
      const link = header(a.html, "link");
      if (link && !link.includes(license)) {
        throw new Error(`License: ${license} is not among the Link header entries`);
      }
    }),

    check("robots.txt: the Sitemap pointer survives", () => {
      // v1.6.1 regression class: a physical robots.txt on the host's disk
      // bypasses WordPress's virtual robots entirely, taking the pointer with it.
      if (!firstLineValue(a.robots.body, "sitemap")) throw new Error("no Sitemap: line");
    }),

    check(`robots.txt: all ${NAMED_CRAWLERS.length} named crawlers are still disallowed`, () => {
      const missing = NAMED_CRAWLERS.filter((name) => {
        const re = new RegExp(`^[ \\t]*user-agent[ \\t]*:[ \\t]*${name}[ \\t\\r]*$\\s*^[ \\t]*disallow[ \\t]*:[ \\t]*/`, "im");
        return !re.test(a.robots.body);
      });
      if (missing.length) throw new Error(`no Disallow for: ${missing.join(", ")}`);
    }),

    check("robots.txt: use=reference is marked as a non-normative local extension", () => {
      // Issue 3. The term is kept, but a reader must never be able to mistake
      // it for part of the Content Signals vocabulary.
      const body = String(a.robots.body);
      const [line] = contentSignalLines(body);
      if (!line || !line.includes("use=")) return; // term dropped; nothing to disclaim
      if (!/NON-NORMATIVE LOCAL EXTENSION: use=reference/.test(body)) {
        throw new Error("use= is published with no non-normative extension notice");
      }
      if (!/NOT load-bearing/.test(body)) {
        throw new Error("the extension notice does not state that the term is not load-bearing");
      }
    }),
  );

  return results;
}
