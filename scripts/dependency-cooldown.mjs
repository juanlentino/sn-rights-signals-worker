#!/usr/bin/env node
/**
 * Dependency minimum-age cooldown — the second leg of the R6c board row
 * (the attestation gate, scripts/attestation-gate.mjs, is the first).
 *
 * WHAT THIS GATES, precisely: no locked package version may be YOUNGER than
 * the policy's minimum age. A hijacked release does its damage in its first
 * days, before the ecosystem notices and the registry yanks it — the window
 * every recent npm supply-chain incident exploited. Waiting out that window
 * costs nothing for a pure-toolchain tree (all five workers declare zero
 * runtime dependencies; nothing here is a production hotfix path).
 *
 * INDEPENDENT of attestation coverage, by design: publish timestamps come
 * from the packument for 100% of packages, attested or not (the 2026-08-14
 * audit's condition 2 — this leg works at full coverage today).
 *
 * DELIBERATE young bumps go through .cooldown-accept.json as a REVIEWED
 * decision — `"name@version": "reason"` — never silently. An accepted
 * version that has since aged past the minimum is reported for pruning,
 * exactly like the attestation allowlist's stale entries: the accept list
 * must only ever hold live exceptions.
 *
 * FAIL-CLOSED: a packument that cannot be fetched, or a locked version the
 * registry has no timestamp for, is a FAILURE, not a skip — an age nobody
 * measured is not an age that passed. On a registry hiccup, re-run.
 */
import { readFileSync } from 'node:fs';

const POLICY_FILE = '.cooldown-accept.json';
const REGISTRY = 'https://registry.npmjs.org';
const CONCURRENCY = 12;
const FETCH_TIMEOUT_MS = 15000;

const fail = [];
const notice = [];

const policy = JSON.parse(readFileSync(POLICY_FILE, 'utf8'));
const minAgeDays = Number(policy.min_age_days);
if (!Number.isFinite(minAgeDays) || minAgeDays <= 0) {
  console.error(`FATAL: ${POLICY_FILE} min_age_days must be a positive number.`);
  process.exit(2);
}
const accept = policy.accept ?? {};
const minAgeMs = minAgeDays * 86400 * 1000;
const now = Date.now();

// ── the population: every locked name@version, from the lockfile itself ─────
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
if (lock.lockfileVersion !== 3) {
  console.error(`FATAL: expected lockfileVersion 3, got ${lock.lockfileVersion}.`);
  process.exit(2);
}
const pairs = new Map(); // name -> Set(version)
for (const [path, entry] of Object.entries(lock.packages ?? {})) {
  if (path === '' || !entry.version || entry.link) continue;
  const name = entry.name ?? path.replace(/^.*node_modules\//, '');
  if (!pairs.has(name)) pairs.set(name, new Set());
  pairs.get(name).add(entry.version);
}

// ── vacuous-pass guard: an empty measurement must never read as "clean" ─────
if (pairs.size === 0) {
  console.error('FATAL: measured ZERO locked packages — the lockfile parse found nothing.');
  process.exit(2);
}

// ── one packument per name, bounded concurrency, fail-closed ────────────────
async function fetchTimes(name) {
  const res = await fetch(`${REGISTRY}/${name}`, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { 'user-agent': 'sn-dependency-cooldown' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()).time ?? {};
}

const names = [...pairs.keys()].sort();
const ages = []; // { name, version, publishedAt, ageMs }
let cursor = 0;
async function worker() {
  while (cursor < names.length) {
    const name = names[cursor++];
    let times;
    try {
      times = await fetchTimes(name);
    } catch (e) {
      fail.push(`UNMEASURED: packument fetch failed for ${name} (${e.message}) — an age nobody measured is not an age that passed; re-run on registry flake`);
      continue;
    }
    for (const version of pairs.get(name)) {
      const iso = times[version];
      if (!iso) {
        fail.push(`UNMEASURED: registry has no publish time for ${name}@${version} — lockfile/registry mismatch, investigate before trusting the tree`);
        continue;
      }
      ages.push({ name, version, publishedAt: iso, ageMs: now - Date.parse(iso) });
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

// ── the verdict ─────────────────────────────────────────────────────────────
const young = ages.filter(a => a.ageMs < minAgeMs).sort((a, b) => a.ageMs - b.ageMs);
const acceptedKeys = new Set(Object.keys(accept));
const blocked = young.filter(a => !acceptedKeys.has(`${a.name}@${a.version}`));
const usedAccepts = young.filter(a => acceptedKeys.has(`${a.name}@${a.version}`));
const staleAccepts = [...acceptedKeys].filter(
  k => !young.some(a => `${a.name}@${a.version}` === k)
);

for (const a of blocked) {
  const days = (a.ageMs / 86400000).toFixed(1);
  fail.push(`TOO YOUNG: ${a.name}@${a.version} published ${a.publishedAt} (${days}d < ${minAgeDays}d).`);
  fail.push(`    Wait it out, or accept it in ${POLICY_FILE} with a reason — never silently.`);
}
if (staleAccepts.length) {
  notice.push(`${staleAccepts.length} accept entr${staleAccepts.length === 1 ? 'y' : 'ies'} aged past ${minAgeDays}d — prune: ${staleAccepts.join(', ')}`);
}
for (const a of usedAccepts) {
  notice.push(`accepted young package in tree: ${a.name}@${a.version} (${(a.ageMs / 86400000).toFixed(1)}d) — "${accept[`${a.name}@${a.version}`]}"`);
}

const oldest = ages.length ? Math.min(...ages.map(a => a.ageMs)) : 0;
console.log(`locked packages     ${ages.length} name@version pairs across ${pairs.size} names`);
console.log(`minimum age         ${minAgeDays}d (policy: ${POLICY_FILE})`);
console.log(`youngest in tree    ${ages.length ? (oldest / 86400000).toFixed(1) + 'd' : 'n/a'}`);
console.log(`within cooldown     ${young.length} (${usedAccepts.length} accepted, ${blocked.length} blocked)`);
for (const n of notice) console.log(`NOTICE: ${n}`);
if (fail.length) {
  console.error('\nFAIL');
  for (const f of fail) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`\nPASS — every locked version is at least ${minAgeDays} days old (or a reviewed accept).`);
