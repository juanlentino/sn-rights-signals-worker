#!/usr/bin/env node
/**
 * Outbound-redirect census gate.
 *
 * THE RULE: every outbound call in src/ either sets `redirect: "manual"` /
 * `"error"`, or carries a `redirect-ok:` comment saying why it does not need to.
 * A NEW call site fails this gate until someone classifies it.
 *
 * WHY NOT DETECT CREDENTIALS. The obvious design — "flag calls carrying an
 * Authorization header" — is the one that failed. On 2026-09-08 two hand-written
 * credential scans over these repos returned CLEAN while `sn-provenance-worker`
 * was shipping an unpinned POST carrying an Ed25519 signature: the call is
 * `fetchImpl(...)` in one repo and builds its headers upstream in another, so
 * neither the callee name nor the literal args revealed the credential. A scan
 * that invents a clean bill of health is worse than one that invents a gap.
 * So this gate makes no judgement about credentials — it demands that every
 * outbound call be ACCOUNTED FOR, and puts the reasoning at the call site where
 * a reviewer sees it.
 *
 * WHY A SCRIPT AND NOT A VITEST SUITE. Some of these repos run vitest inside the
 * real workerd runtime (@cloudflare/vitest-pool-workers). There, `node:fs` is
 * absent and vite's parser fails outright — it loads a native Rust binding
 * workerd cannot require. Measured: "Failed to require .../rolldown-binding
 * .linux-x64-gnu.node". This runs in plain Node, next to scripts/attestation-
 * gate.mjs and scripts/dependency-cooldown.mjs, which exist for the same reason.
 *
 * WHY vite's parser. It is already required for `npm test` to run at all
 * (vitest depends on it), so leaning on it adds no new failure mode and no new
 * dependency. Regex was tried and rejected: over raw source it matched
 * `fetch()` inside COMMENTS and 9 `fetchJSON(` wrapper calls, while missing the
 * injected `fetchImpl(` that actually carried a credential. An AST separates
 * all three for free.
 */
import { parseAst } from "vite";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const SRC = "src";
const MIN_FILES = 27;
const MIN_CALLS = 8;

function walkFiles(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? walkFiles(p) : (/\.(mjs|js)$/.test(p) ? [p] : []);
  });
}

/** Function names declared IN this module: wrappers, not the global fetch. */
function localFunctionNames(ast) {
  const names = new Set();
  (function w(n) {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) return n.forEach(w);
    if (n.type === "FunctionDeclaration" && n.id) names.add(n.id.name);
    if (n.type === "VariableDeclarator" && n.id?.type === "Identifier" &&
        (n.init?.type === "FunctionExpression" || n.init?.type === "ArrowFunctionExpression"))
      names.add(n.id.name);
    for (const k in n) if (k !== "type") w(n[k]);
  })(ast);
  return names;
}

const hasRedirect = (o) => o?.type === "ObjectExpression" && o.properties.some((p) =>
  p.type === "Property" && (p.key?.name ?? p.key?.value) === "redirect" &&
  ["manual", "error"].includes(p.value?.value));

function outboundCalls(src) {
  const ast = parseAst(src);
  const wrappers = localFunctionNames(ast);
  const out = [];
  (function w(n) {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) return n.forEach(w);
    if (n.type === "CallExpression") {
      const c = n.callee;
      const name = c.type === "Identifier" ? c.name
        : c.type === "MemberExpression" && c.property?.type === "Identifier" ? "." + c.property.name
        : null;
      // Fetch-shaped and NOT declared here → the global fetch, an injected
      // fetchImpl/fetchFn, or a stub. A locally declared fetchJSON is a wrapper;
      // the real call it makes is scanned on its own.
      if (name && /fetch/i.test(name) && !wrappers.has(name)) {
        // Two legal guard forms: fetch(url, { redirect }) and
        // fetch(new Request(req, { redirect })) — the latter is how a passthrough
        // re-pins an inherited request. Missing it would demand an annotation on
        // already-correct code.
        const guarded = hasRedirect(n.arguments[1]) ||
          (n.arguments[0]?.type === "NewExpression" && n.arguments[0].callee?.name === "Request" &&
           hasRedirect(n.arguments[0].arguments?.[1]));
        out.push({ name, start: n.start, end: n.end, guarded, line: src.slice(0, n.start).split("\n").length });
      }
    }
    for (const k in n) if (k !== "type") w(n[k]);
  })(ast);
  return out;
}

const files = walkFiles(SRC);
const rows = [];
for (const file of files) {
  const src = readFileSync(file, "utf8");
  const lines = src.split("\n");
  for (const c of outboundCalls(src)) {
    // The reason may sit on the call or in the 3 lines above it.
    const ctx = lines.slice(Math.max(0, c.line - 4), c.line).join("\n") + src.slice(c.start, c.end);
    rows.push({ file, line: c.line, name: c.name, guarded: c.guarded, annotated: /redirect-ok:/.test(ctx) });
  }
}

const fail = [];
// Floors: a resolver that matches nothing reports a clean sweep and a broken
// scan identically. These separate them. If you legitimately remove an outbound
// call, lower the floor deliberately in the same commit.
if (files.length < MIN_FILES) fail.push(`scan reached only ${files.length} file(s), floor ${MIN_FILES} — the scan is broken, not the code`);
if (rows.length < MIN_CALLS) fail.push(`resolved only ${rows.length} outbound call(s), floor ${MIN_CALLS} — the resolver stopped seeing calls it used to see`);
for (const r of rows.filter((r) => !r.guarded && !r.annotated))
  fail.push(`${r.file}:${r.line} ${r.name}( — set redirect:"manual"/"error", or add a "redirect-ok: <why>" comment`);

if (fail.length) {
  console.error("outbound-redirect-gate: FAIL");
  for (const f of fail) console.error("  " + f);
  process.exit(1);
}
console.log(`outbound-redirect-gate: OK — ${files.length} files, ${rows.length} outbound call(s), ` +
  `${rows.filter((r) => r.guarded).length} guarded, ${rows.filter((r) => !r.guarded && r.annotated).length} justified`);
