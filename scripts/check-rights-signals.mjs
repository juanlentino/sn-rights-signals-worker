#!/usr/bin/env node
// LIVE rights-signal check. Fetches the real site and asserts that all four
// layers — HTTP headers, robots.txt, tdmrep.json, license.xml — are present,
// parse, and agree with each other and with the deployed policy page.
//
//   npm run check:live                     # against https://juanlentino.com
//   node scripts/check-rights-signals.mjs --origin https://staging.example
//   node scripts/check-rights-signals.mjs --note https://.../notes/some-note/
//
// Wired as `postdeploy` in package.json, so `npm run deploy` gates on it and a
// deploy that breaks the stack fails loudly instead of silently shipping.
//
// Exit 0 = every check passed. Exit 1 = drift. Exit 2 = the check could not run
// (network, DNS, the site is down) — deliberately a DIFFERENT code, because
// "unreachable" is not "consistent" and must not be read as a pass.

import { SITE_ORIGIN } from "../src/constants.mjs";
import { formatReport, runRightsChecks } from "./rights-assertions.mjs";

const TIMEOUT_MS = 15000;

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function get(url, accept) {
  const res = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: {
      // A plain, honest UA. Not a crawler string: the Worker's machine-reader
      // sensor classifies by UA family, and a check run must not pollute the
      // machine-readership aggregates with synthetic crawler traffic.
      "user-agent": "sn-rights-check/1.0 (+https://juanlentino.com/tdm-policy/)",
      ...(accept ? { accept } : {}),
    },
  });
  return { url, status: res.status, headers: res.headers, body: await res.text() };
}

// Discovered, not hardcoded. A pinned slug rots the day a note is renamed, and
// a rotted check that 404s reads as drift in the rights stack rather than as a
// stale fixture. --note overrides for staging origins with no sitemap.
async function discoverNote(origin) {
  const index = await get(`${origin}/wp-sitemap.xml`);
  const posts = index.body.match(/<loc>([^<]*wp-sitemap-posts-post[^<]*)<\/loc>/);
  if (!posts) throw new Error("no posts sitemap in /wp-sitemap.xml");
  const page = await get(posts[1]);
  const first = page.body.match(/<loc>([^<]+\/notes\/[^<]+)<\/loc>/);
  if (!first) throw new Error(`no /notes/ URL in ${posts[1]}`);
  return first[1];
}

async function main() {
  const origin = arg("origin", SITE_ORIGIN).replace(/\/+$/, "");
  let artifacts;

  // Deploy propagation is seconds, not instant. Without a settle the postdeploy
  // run can read the PREVIOUS version and fail on the policy-version assertion —
  // a false red that trains you to ignore the gate, which is worse than no gate.
  const settle = Number(arg("settle", 0));
  if (settle > 0) {
    process.stdout.write(`settling ${settle}s for deploy propagation…\n`);
    await new Promise((r) => setTimeout(r, settle * 1000));
  }

  try {
    const noteUrl = arg("note") || (await discoverNote(origin));
    const [html, wpjson, robots, tdmrep, license, policy, policyOdrl, note] = await Promise.all([
      get(`${origin}/`),
      get(`${origin}/wp-json/wp/v2/posts`, "application/json"),
      get(`${origin}/robots.txt`),
      get(`${origin}/.well-known/tdmrep.json`),
      get(`${origin}/license.xml`),
      get(`${origin}/tdm-policy/`),
      // Same URL, negotiated. Asking for it separately is the only way to
      // prove the machine representation is really reachable in production —
      // a Vary-blind cache in front of the Worker would break exactly this.
      get(`${origin}/tdm-policy/`, "application/ld+json"),
      get(noteUrl),
    ]);
    artifacts = { html, wpjson, robots, tdmrep, license, policy, policyOdrl, note };
  } catch (err) {
    process.stderr.write(`rights-signal check could not run against ${origin}\n  ${err.message}\n`);
    process.stderr.write("  (exit 2 = unreachable, NOT a pass — nothing was verified)\n");
    process.exit(2);
  }

  const report = runRightsChecks(artifacts);
  process.stdout.write(`${formatReport(report, `live · ${origin} · note ${artifacts.note.url}`)}\n`);
  process.exit(report.ok ? 0 : 1);
}

main();
