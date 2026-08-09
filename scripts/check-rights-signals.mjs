#!/usr/bin/env node
// LIVE rights-signal check. Fetches the real site and asserts that all four
// layers — HTTP headers, robots.txt, tdmrep.json, license.xml — are present,
// parse, and agree with each other and with the deployed policy page.
//
//   npm run check:live                     # what a crawler sees, right now
//   node scripts/check-rights-signals.mjs --origin https://staging.example
//   node scripts/check-rights-signals.mjs --note https://.../notes/some-note/
//   node scripts/check-rights-signals.mjs --await-version 1.9.0 --fresh
//   node scripts/check-rights-signals.mjs --await-version 9.9.9 --await-timeout 6
//
// Wired as `postdeploy` in package.json, so `npm run deploy` gates on it and a
// deploy that breaks the stack fails loudly instead of silently shipping.
//
// Exit 0 = every check passed. Exit 1 = drift. Exit 2 = the check could not run
// (network, DNS, the site is down, the expected version never went live) —
// deliberately a DIFFERENT code, because "unverified" is not "consistent" and
// must not be read as a pass.
//
// v1.10.0 — WHY THE FIXED SETTLE IS GONE.
//
// postdeploy used to `--settle 8` and hope. On the v1.9.0 deploy that produced
// a 9-of-36 FALSE RED: the version endpoint had flipped but the edge was still
// serving the previous robots.txt, license.xml and policy page. A gate that
// cries wolf is worse than no gate, because the next real failure gets waved
// through by a human who has learned to re-run it.
//
// Two causes, two fixes, because guessing a bigger number addresses neither:
//
//   1. PROPAGATION is not instant. Replaced the blind sleep with a poll of
//      /_sn/rights-signals/version until it reports the version being shipped
//      (`--await-version`). That endpoint is `cache-control: no-store`, so it
//      flips the moment the deploy lands and the wait is exactly as long as it
//      needs to be — usually a second or two, never a padded eight.
//
//   2. EDGE CACHING outlives propagation. license.xml and tdmrep.json are
//      served `public, max-age=3600`, so a colo can hand back an hour-old copy
//      long after the Worker itself has updated. Version-matching alone would
//      NOT have caught this. `--fresh` sends `cache-control: no-cache` so the
//      documents are revalidated against the Worker rather than read out of a
//      colo.
//
// `--fresh` is deliberately NOT the default. Without it this tool reports what
// a crawler actually receives, cache and all, which is the honest thing for a
// drift check to measure. With it, it reports what the Worker is serving now,
// which is the right question immediately after a deploy.
//
// v1.10.1 — WHY A DEPLOY RUN RETRIES, AND A PLAIN RUN NEVER DOES.
//
// The v1.10.0 deploy produced a SECOND false red, from a cause the version poll
// above does not cover: /ns/tdm answered correctly on the plain request and
// 404'd on the ld+json one, in the same batch, milliseconds apart. Both were
// correct within a minute. Propagation is per-colo and the ten artifact fetches
// go out in parallel, so matching the version at one endpoint proves nothing
// about the colo that serves the next request — and a brand-new route is the
// worst case, because the pre-deploy 404 may still be cached at an edge the
// poll never touched.
//
// So a deploy run re-collects and re-checks up to DEPLOY_ATTEMPTS times before
// believing a failure. This does NOT weaken the gate: a genuine defect fails
// every attempt and is still reported, at the cost of ~16 extra seconds on a
// run that was going to fail anyway. What it removes is the failure mode where
// a real problem gets waved through because the gate has cried wolf twice.
//
// A plain `check:live` retries NOTHING. There is no deploy in flight, so a
// failure is a fact about the live site and retrying until it passes would be
// the tool lying on the site's behalf.

import { SITE_ORIGIN } from "../src/constants.mjs";
import { formatReport, runRightsChecks } from "./rights-assertions.mjs";

const TIMEOUT_MS = 15000;
const AWAIT_TIMEOUT_MS = 120000; // generous: a slow rollout must not read as a failure
const AWAIT_INTERVAL_MS = 3000;

// v1.10.1: how many times to re-collect and re-check before believing a
// failure, and how long to wait between tries. DEPLOY RUNS ONLY — see runOnce's
// caller for why a plain drift check must never retry.
const DEPLOY_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = 8000;

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const flag = (name) => process.argv.includes(`--${name}`);
const FRESH = flag("fresh");

async function get(url, accept, { fresh = FRESH } = {}) {
  const res = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: {
      // A plain, honest UA. Not a crawler string: the Worker's machine-reader
      // sensor classifies by UA family, and a check run must not pollute the
      // machine-readership aggregates with synthetic crawler traffic.
      "user-agent": "sn-rights-check/1.0 (+https://juanlentino.com/tdm-policy/)",
      // Ask the edge to revalidate rather than answer from a colo copy. Only
      // under --fresh: by default this tool should see what a crawler sees.
      ...(fresh ? { "cache-control": "no-cache", pragma: "no-cache" } : {}),
      ...(accept ? { accept } : {}),
    },
  });
  return { url, status: res.status, headers: res.headers, body: await res.text() };
}

/**
 * Block until the Worker reports the expected version, or give up.
 *
 * Returns the version actually seen. Never throws on a bad poll — a 502 during
 * a rollout is normal and is simply not-yet-live.
 *
 * @param {string} origin  Site origin.
 * @param {string} want    Version the caller just shipped.
 * @returns {Promise<{ok: boolean, seen: string|null, waitedMs: number}>} Outcome.
 */
async function awaitVersion(origin, want, budgetMs = AWAIT_TIMEOUT_MS) {
  const started = Date.now();
  let seen = null;
  for (;;) {
    try {
      const res = await get(`${origin}/_sn/rights-signals/version`, "application/json", { fresh: true });
      seen = JSON.parse(res.body).version ?? null;
      if (seen === want) return { ok: true, seen, waitedMs: Date.now() - started };
    } catch {
      // Unreachable or unparseable mid-rollout. Keep waiting; the timeout below
      // is the only thing that ends this loop unsuccessfully.
    }
    if (Date.now() - started >= budgetMs) {
      return { ok: false, seen, waitedMs: Date.now() - started };
    }
    await new Promise((r) => setTimeout(r, Math.min(AWAIT_INTERVAL_MS, budgetMs)));
  }
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

/**
 * Collect every artifact once and run the invariants over them.
 *
 * @param {string} origin   Site origin.
 * @param {number} attempt  1-based attempt number, for the report header.
 * @param {number} attempts Total attempts allowed.
 * @returns {Promise<{report: object, mode: string}>} Report and its header line.
 */
async function collectAndCheck(origin, attempt, attempts) {
  let artifacts;
  try {
    const noteUrl = arg("note") || (await discoverNote(origin));
    const [html, wpjson, robots, tdmrep, license, policy, policyOdrl, nsTdm, nsTdmJson, note] = await Promise.all([
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
      get(`${origin}/ns/tdm`),
      get(`${origin}/ns/tdm`, "application/ld+json"),
      get(noteUrl),
    ]);
    artifacts = { html, wpjson, robots, tdmrep, license, policy, policyOdrl, nsTdm, nsTdmJson, note };
  } catch (err) {
    process.stderr.write(`rights-signal check could not run against ${origin}\n  ${err.message}\n`);
    process.stderr.write("  (exit 2 = unreachable, NOT a pass — nothing was verified)\n");
    process.exit(2);
  }

  const report = runRightsChecks(artifacts);
  const attemptNote = attempts > 1 ? ` · attempt ${attempt}/${attempts}` : "";
  const mode = `live · ${origin} · ${FRESH ? "revalidated" : "as cached"}${attemptNote} · note ${artifacts.note.url}`;
  return { report, mode };
}

async function main() {
  const origin = arg("origin", SITE_ORIGIN).replace(/\/+$/, "");

  // OPT-IN, never inferred from the environment: npm exports
  // npm_package_version to every script, so defaulting to it would make a plain
  // `check:live` exit 2 whenever main is ahead of production — turning a drift
  // report into a deploy gate for someone who only wanted to look. postdeploy
  // passes it explicitly, so the expectation still comes from package.json and
  // the number is still written once.
  const want = arg("await-version", "");
  if (want) {
    process.stdout.write(`waiting for ${origin} to report v${want}…\n`);
    const budgetMs = Number(arg("await-timeout", AWAIT_TIMEOUT_MS / 1000)) * 1000;
    const { ok, seen, waitedMs } = await awaitVersion(origin, want, budgetMs);
    if (!ok) {
      process.stderr.write(
        `the Worker never reported v${want} (last seen: ${seen ?? "unreachable"}) ` +
          `after ${Math.round(waitedMs / 1000)}s\n` +
          "  (exit 2 = NOT verified — the deploy may not have landed; nothing was checked against it)\n",
      );
      process.exit(2);
    }
    process.stdout.write(`v${want} live after ${Math.round(waitedMs / 1000)}s\n`);
  }

  // Retries are a DEPLOY affordance, not a general one. `want` is only set by
  // postdeploy, so a plain drift check gets exactly one attempt: with no deploy
  // in flight a failure is a fact about the live site, and retrying until it
  // passes would be the tool lying on the site's behalf.
  const attempts = want ? DEPLOY_ATTEMPTS : 1;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const { report, mode } = await collectAndCheck(origin, attempt, attempts);

    if (report.ok || attempt === attempts) {
      process.stdout.write(`${formatReport(report, mode)}\n`);
      if (!report.ok && attempts > 1) {
        process.stdout.write(
          `\nstill failing after ${attempts} attempts over ` +
            `~${Math.round((RETRY_BACKOFF_MS * (attempts - 1)) / 1000)}s — this is drift, not propagation\n`,
        );
      }
      process.exit(report.ok ? 0 : 1);
    }

    // A brand-new route is the worst case here: the pre-deploy 404 can still be
    // cached at an edge the version poll never touched. Name what failed, so a
    // retry is never mistaken for the tool hiding something.
    process.stdout.write(
      `attempt ${attempt}/${attempts}: ${report.failed} failed ` +
        `(${report.results.filter((r) => !r.ok).map((r) => r.name).join("; ")}) — ` +
        `retrying in ${RETRY_BACKOFF_MS / 1000}s in case this is propagation\n`,
    );
    await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS));
  }
}

main();
