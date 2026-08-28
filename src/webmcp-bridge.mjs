// The served /webmcp/bridge.js asset: composed from the client module's
// functions via toString() — no bundler, and the unit-tested functions ARE
// the shipped bytes. SRI is computed here from the exact served source, so
// the tag (which rides inside anchored tdm-policy bytes) attests the exact
// executable it loads; tag/asset skew is impossible by construction and
// additionally pinned by rights-assertions.
//
// Path is deliberately NOT /.webmcp/ — that is Cloudflare's reserved
// namespace (the 2026-08-23 incident); /webmcp/ is dispatched by this
// worker like every other surface it owns.
//
// BUNDLER HAZARD, fixed here on two levers (see scripts/webmcp-bridge-bundle-
// gate.mjs for the regression gate): esbuild's --keep-names (wrangler's
// default) rewrites nested named function expressions inside a function body
// to `fn = __name(fn, "fn")`. Function.prototype.toString() on the OUTER
// function then captures that call verbatim, so the composed bytes reference
// a bundle-scope `__name` helper that exists nowhere in a browser — a
// ReferenceError the moment any nested helper (snVerifyPage's callUrl,
// fetchJSON, etc., or the execute closures in snWebmcpMain) actually runs.
// Lever 1: wrangler.jsonc sets `"keep_names": false`, so real deploys never
// inject the helper. Lever 2 (defense-in-depth, in case some future esbuild
// pass or dev-mode path re-enables it): BRIDGE_SOURCE is prefixed with a
// no-op `__name` shim below, so the composed bytes are self-contained even if
// lever 1 is ever bypassed.
import * as client from "./webmcp-bridge-client.mjs";

export const BRIDGE_URL = "https://juanlentino.com/webmcp/bridge.js";

// Derived once from the client module's namespace object, so this list, the
// composition-guard test's `fns` array (test/webmcp-bridge-client.test.mjs),
// and the actual export set can never drift apart into three copies that
// silently disagree. An ES module namespace object's string keys enumerate in
// SPEC-SORTED order (alphabetical by UTF-16 code unit), NOT source
// declaration order — snWebmcpMain lands last here because "snW" sorts after
// "snA"/"snG"/"snL"/"snR"/"snV", not because of where it sits in the file.
// That sort is deterministic, which is what keeps the composed bytes stable
// across runs; it is also why composition doesn't depend on declaration
// order for correctness — every PART is a hoisted function declaration, so
// each one can already see every sibling regardless of where any of them
// land in the concatenated output.
const PARTS = Object.values(client);

// Defensive shim for the __name hazard described above: a plain passthrough,
// not esbuild's real helper (which also stamps Function#name for debugging).
// That's deliberate — function.name is not load-bearing anywhere in
// webmcp-bridge-client.mjs or this file (verified: the only `.name` access in
// either is Error#name, unrelated), so the shim only needs to make the
// reference resolve, never to reproduce the renaming behavior.
const NAME_SHIM = 'var __name = function (t) { return t; };\n';

export const BRIDGE_SOURCE =
  "// juanlentino.com WebMCP bridge. Source of truth: sn-rights-signals-worker\n" +
  "// src/webmcp-bridge-client.mjs. Anchored hourly as rights-signals/webmcp-bridge\n" +
  "// in https://github.com/juanlentino/signal-and-noise-provenance.\n\n" +
  NAME_SHIM +
  "\n" +
  PARTS.map((f) => f.toString()).join("\n\n") +
  "\n\nsnWebmcpMain();\n";

// Top-level await: verified to work under this repo's @cloudflare/vitest-pool-
// workers setup (real workerd). It is NOT what proves this file survives a
// real deploy, though — see scripts/webmcp-bridge-bundle-gate.mjs, which
// bundles this module through wrangler's own esbuild pipeline (the check that
// actually proves deploy behavior; vitest's transform is a different, more
// permissive pipeline that missed the __name hazard entirely).
const digest = await crypto.subtle.digest("SHA-384", new TextEncoder().encode(BRIDGE_SOURCE));
export const BRIDGE_SRI = "sha384-" + btoa(String.fromCharCode(...new Uint8Array(digest)));

// Frozen shape: attribute order and quoting never change casually — these
// bytes live inside anchored tdm-policy bytes, so tag churn is anchor churn
// (accepted per design: once per bridge release). The SRI is ALSO a function
// of the bundler, not just this source: BRIDGE_SOURCE is produced by
// deploy-time bundling (esbuild via wrangler), and different bundler settings
// have been measured to produce different byte counts from the SAME source
// (the keep_names hazard above is one example). A wrangler version bump is
// therefore a candidate cause the next time this tag — and so the tdm-policy
// anchor version that embeds it — moves with no code change in this repo.
export const WEBMCP_SCRIPT_TAG =
  `<script type="module" src="${BRIDGE_URL}" integrity="${BRIDGE_SRI}" data-mcp-url="none"></script>`;

export function webmcpBridgeResponse() {
  return new Response(BRIDGE_SOURCE, {
    status: 200,
    headers: {
      "content-type": "text/javascript; charset=utf-8",
      // Short-lived on purpose: the hourly anchor sweep hashes exact bytes.
      "cache-control": "public, max-age=300",
      "x-content-type-options": "nosniff",
    },
  });
}
