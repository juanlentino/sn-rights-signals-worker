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

import {
  snAgentApi, snReadManifest, snRightsPointers, snGetRightsTerms,
  snLoadCore, snVerifyPage, snWebmcpMain,
} from "./webmcp-bridge-client.mjs";

export const BRIDGE_URL = "https://juanlentino.com/webmcp/bridge.js";

const PARTS = [snAgentApi, snReadManifest, snRightsPointers, snGetRightsTerms, snLoadCore, snVerifyPage, snWebmcpMain];

export const BRIDGE_SOURCE =
  "// juanlentino.com WebMCP bridge. Source of truth: sn-rights-signals-worker\n" +
  "// src/webmcp-bridge-client.mjs. Anchored hourly as rights-signals/webmcp-bridge\n" +
  "// in https://github.com/juanlentino/signal-and-noise-provenance.\n\n" +
  PARTS.map((f) => f.toString()).join("\n\n") +
  "\n\nsnWebmcpMain();\n";

// Top-level await: verified to work under this repo's @cloudflare/vitest-pool-
// workers setup (real workerd, which supports ES module top-level await).
const digest = await crypto.subtle.digest("SHA-384", new TextEncoder().encode(BRIDGE_SOURCE));
export const BRIDGE_SRI = "sha384-" + btoa(String.fromCharCode(...new Uint8Array(digest)));

// Frozen shape: attribute order and quoting never change casually — these
// bytes live inside anchored tdm-policy bytes, so tag churn is anchor churn
// (accepted per design: once per bridge release).
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
