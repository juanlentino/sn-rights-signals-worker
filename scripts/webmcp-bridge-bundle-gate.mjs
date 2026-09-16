#!/usr/bin/env node
/**
 * Bundled-artifact gate for src/webmcp-bridge.mjs (R-webmcp, Task 3 follow-up).
 *
 * WHAT THIS GATES: the SHIPPED bytes, not the source. Vitest's transform
 * pipeline (@cloudflare/vitest-pool-workers) is NOT wrangler's bundler — it
 * missed a real bug where esbuild's --keep-names (wrangler's default: true)
 * rewrites nested named function expressions inside a function body to
 * `fn = __name(fn, "fn")`. Function.prototype.toString() on the OUTER
 * function then captures that call verbatim, so BRIDGE_SOURCE — the actual
 * text served at /webmcp/bridge.js — referenced a bundle-scope `__name`
 * helper that exists nowhere in a browser. Every vitest-level composition
 * guard was green on that broken artifact, because vitest never ran the
 * module through esbuild's keep-names pass. Measured before the fix: served
 * bytes 14,873 with 19 `__name(` occurrences vs. vitest's 17,522 with 0;
 * composing snWebmcpMain with a fake agent API and calling it threw
 * "__name is not defined".
 *
 * HOW: builds src/webmcp-bridge.mjs through wrangler's OWN esbuild pipeline —
 * `wrangler deploy <entry> --dry-run --outdir <tmp>` — via a synthetic entry
 * file that re-exports it and adds a default fetch handler (so wrangler
 * treats it as a real ES module worker, matching the shape src/index.mjs has
 * once Task 4 wires this module into the real entry point; without a default
 * export wrangler falls back to "service-worker" format and refuses
 * top-level await entirely, which is a DIFFERENT failure mode than the one
 * being gated here). The emitted bundle is imported in plain Node and the
 * composed BRIDGE_SOURCE is evaluated exactly as a browser would: as a
 * strict-mode script with `new Function`, then driven through snWebmcpMain's
 * registration branch with a fake window/registerTool.
 *
 * Wired as `pretest` (package.json) — `npm test` always runs this before
 * vitest. Run directly: `node scripts/webmcp-bridge-bundle-gate.mjs`.
 *
 * Exit 0 = the served bytes survive the real bundler. Exit 1 = they don't —
 * a syntax error, a thrown ReferenceError, or a shape mismatch. Exit 2 = the
 * gate itself could not run (wrangler missing, build failed for an unrelated
 * reason) — deliberately distinct, because "could not check" is not "passed".
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BRIDGE_SOURCE_FILE = join(REPO_ROOT, "src", "webmcp-bridge.mjs");
const WRANGLER_BIN = join(REPO_ROOT, "node_modules", ".bin", "wrangler");

// fail()/fatal() THROW rather than calling process.exit() directly. Exiting
// mid-try skips the `finally` below entirely (process.exit() terminates
// immediately; it does not unwind the stack the way a thrown error does), so
// every failing run was leaking its two $TMPDIR directories — the outer
// catch below converts the thrown GateError back into the right exit code
// AFTER cleanup has actually run.
class GateError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}
function fail(msg) {
  throw new GateError(`FAIL: ${msg}`, 1);
}
function fatal(msg) {
  throw new GateError(`FATAL (gate could not run): ${msg}`, 2);
}

let entryDir = null;
let outDir = null;
let exitCode = 0;

try {
  if (!existsSync(BRIDGE_SOURCE_FILE)) fatal(`${BRIDGE_SOURCE_FILE} does not exist`);
  if (!existsSync(WRANGLER_BIN)) fatal(`wrangler binary not found at ${WRANGLER_BIN} — run npm install`);

  entryDir = mkdtempSync(join(tmpdir(), "sn-webmcp-bundle-entry-"));
  outDir = mkdtempSync(join(tmpdir(), "sn-webmcp-bundle-out-"));

  // A synthetic default export is required: without one, wrangler decides
  // this is a "service-worker" format module and refuses top-level await
  // outright (a build error, not the hazard this gate targets). The real
  // production entry (src/index.mjs) already has a default export, so this
  // matches what actually ships once Task 4 wires this module in.
  const entryFile = join(entryDir, "entry.mjs");
  writeFileSync(
    entryFile,
    `export { BRIDGE_SOURCE, BRIDGE_SRI, WEBMCP_SCRIPT_TAG, webmcpBridgeResponse } from ${JSON.stringify(BRIDGE_SOURCE_FILE)};\n` +
      `export default { fetch() { return new Response("ok"); } };\n`
  );

  let deployOutput;
  try {
    deployOutput = execFileSync(
      WRANGLER_BIN,
      ["deploy", entryFile, "--config", join(REPO_ROOT, "wrangler.jsonc"), "--dry-run", "--outdir", outDir],
      { cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    );
  } catch (e) {
    fatal(`wrangler dry-run build failed:\n${(e.stdout || "") + (e.stderr || "") || e.message}`);
  }

  const bundleFile = readdirSync(outDir).find((f) => f.endsWith(".js") && !f.endsWith(".js.map"));
  if (!bundleFile) fatal(`wrangler produced no .js bundle in ${outDir}. Output:\n${deployOutput}`);
  const bundlePath = join(outDir, bundleFile);

  const bundled = await import(pathToFileURL(bundlePath).href);
  const { BRIDGE_SOURCE, BRIDGE_SRI, WEBMCP_SCRIPT_TAG, webmcpBridgeResponse } = bundled;

  if (typeof BRIDGE_SOURCE !== "string" || BRIDGE_SOURCE.length === 0) {
    fail("bundled BRIDGE_SOURCE is not a non-empty string");
  }
  if (typeof BRIDGE_SRI !== "string" || !BRIDGE_SRI.startsWith("sha384-")) {
    fail(`bundled BRIDGE_SRI is not a sha384- string: ${BRIDGE_SRI}`);
  }
  if (typeof WEBMCP_SCRIPT_TAG !== "string" || !WEBMCP_SCRIPT_TAG.includes(BRIDGE_SRI)) {
    fail("bundled WEBMCP_SCRIPT_TAG does not embed the bundled BRIDGE_SRI");
  }
  if (typeof webmcpBridgeResponse !== "function") {
    fail("bundled module does not export webmcpBridgeResponse");
  }

  const nameHelperCount = (BRIDGE_SOURCE.match(/__name\(/g) || []).length;
  console.log(`bundled BRIDGE_SOURCE: ${BRIDGE_SOURCE.length} bytes, ${nameHelperCount} __name( occurrences (diagnostic only — the assertion below is behavioral)`);

  // THE BEHAVIORAL CHECK. A regex/grep count is a syntax gate; it cannot see
  // whether a reference actually resolves at runtime. Evaluate the bundled
  // BRIDGE_SOURCE exactly as a browser would load it: a strict-mode script
  // (a real ES module always runs strict) with no lexical access to this
  // gate's own scope.
  let composed;
  try {
    composed = new Function('"use strict";' + BRIDGE_SOURCE.replace(/snWebmcpMain\(\);\s*$/, "return snWebmcpMain;"))();
  } catch (e) {
    fail(`bundled BRIDGE_SOURCE threw evaluating as a standalone strict script: ${e.message}`);
  }
  if (typeof composed !== "function") {
    fail("bundled BRIDGE_SOURCE did not yield snWebmcpMain when evaluated (the trailing-call replace found nothing to replace)");
  }

  const registered = [];
  const fakeApi = { registerTool: (spec) => registered.push(spec) };
  try {
    composed({ document: {}, navigator: { modelContext: fakeApi } });
  } catch (e) {
    fail(`composed snWebmcpMain threw registering tools against the bundled artifact: ${e.message}`);
  }
  if (registered.length !== 5) {
    fail(`expected 5 tools registered, got ${registered.length}: ${registered.map((r) => r.name).join(", ")}`);
  }
  const names = registered.map((r) => r.name).sort();
  if (names.join(",") !== "get-citation,get-rights-terms,get-site-map,related-notes,verify-page") {
    fail(`unexpected tool names registered: ${names.join(", ")}`);
  }
  for (const spec of registered) {
    if (typeof spec.execute !== "function") fail(`tool "${spec.name}" execute is not a function`);
  }

  // The unsigned path, driven for real against the bundled execute handler —
  // this is the leg most likely to still touch a nested closure that a
  // shallower check (just "did registerTool get called") would miss.
  const verifyPageTool = registered.find((r) => r.name === "verify-page");
  let unsignedResult;
  try {
    unsignedResult = await verifyPageTool.execute();
  } catch (e) {
    fail(`bundled verify-page execute() threw on an unsigned (no-manifest) fake doc: ${e.message}`);
  }
  if (unsignedResult.signed !== false) {
    fail(`expected verify-page execute() to report signed:false with no manifest, got ${JSON.stringify(unsignedResult)}`);
  }

  console.log("PASS — the bundled /webmcp/bridge.js artifact registers the five tools and runs its unsigned-page path without a bundler-injected reference error.");
} catch (e) {
  if (e instanceof GateError) {
    console.error(`\n${e.message}`);
    exitCode = e.code;
  } else {
    console.error(`\nFATAL (unexpected): ${e.stack || e.message}`);
    exitCode = 2;
  }
} finally {
  if (entryDir) rmSync(entryDir, { recursive: true, force: true });
  if (outDir) rmSync(outDir, { recursive: true, force: true });
}

process.exit(exitCode);
