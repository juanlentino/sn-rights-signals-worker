import { describe, it, expect } from "vitest";
import { BRIDGE_SOURCE, BRIDGE_SRI, WEBMCP_SCRIPT_TAG, webmcpBridgeResponse } from "../src/webmcp-bridge.mjs";

describe("composed bridge asset", () => {
  it("is a valid standalone script that no-ops headless (the self-containment gate)", () => {
    // workerd's globalThis carries no `document` at all — the trailing
    // snWebmcpMain() call hits its FIRST guard (`if (!doc) return;`) and
    // returns before it ever looks at `navigator`, so what navigator does or
    // doesn't carry is irrelevant to this particular no-op. (It's exercised
    // deliberately below instead: the "no usable agent API" branch is driven
    // with a fake window that has a document but no modelContext/agent.)
    // This test's job is narrower and blunter than that: prove the composed
    // bytes evaluate as strict-mode-clean, self-contained JS AT ALL — no
    // ReferenceError from a dropped module-scope reference (imports/consts)
    // or from a bundler-injected helper (the __name hazard fixed in
    // src/webmcp-bridge.mjs and wrangler.jsonc; see
    // scripts/webmcp-bridge-bundle-gate.mjs for the gate that catches a
    // regression on the ACTUAL bundled artifact, which this in-process
    // evaluation cannot see). Evaluated strict (a real ES module always runs
    // strict; a bare `new Function(src)()` would not).
    expect(() => new Function('"use strict";' + BRIDGE_SOURCE)()).not.toThrow();
  });

  it("carries the registration marker the sweep validator and live check key on", () => {
    expect(BRIDGE_SOURCE).toContain("registerTool");
  });

  it("SRI in the tag matches the served bytes (skew impossible by construction)", async () => {
    const digest = await crypto.subtle.digest("SHA-384", new TextEncoder().encode(BRIDGE_SOURCE));
    const expected = "sha384-" + btoa(String.fromCharCode(...new Uint8Array(digest)));
    expect(BRIDGE_SRI).toBe(expected);
    expect(WEBMCP_SCRIPT_TAG).toContain(`integrity="${expected}"`);
    expect(WEBMCP_SCRIPT_TAG).toContain('src="https://juanlentino.com/webmcp/bridge.js"');
    expect(WEBMCP_SCRIPT_TAG).toContain('data-mcp-url="none"');
    expect(WEBMCP_SCRIPT_TAG).toContain('type="module"');
  });

  it("serves deterministic bytes with a JS content-type and nosniff", async () => {
    const res = webmcpBridgeResponse();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
    expect(await res.text()).toBe(BRIDGE_SOURCE);
  });

  it("registers the five tools with the pinned shape when driven with a fake window", () => {
    // Positive path for snWebmcpMain's composed body: a fake window carrying a
    // recording registerTool proves the trailing call in BRIDGE_SOURCE reaches
    // the registration branch (not just the early-return guard exercised by
    // the headless test above), and that both tools land with the described
    // shape — including that `execute` is a callable function. Strict mode,
    // like every other composed-source evaluation in this file.
    const calls = [];
    const fakeApi = { registerTool: (spec) => calls.push(spec) };
    const fakeWindow = { document: {}, navigator: { modelContext: fakeApi } };

    const src = '"use strict";\n' + BRIDGE_SOURCE.replace(
      /snWebmcpMain\(\);\s*$/,
      "return snWebmcpMain;"
    );
    const composedMain = new Function(src)();
    composedMain(fakeWindow);

    expect(calls).toHaveLength(5);
    const byName = Object.fromEntries(calls.map((c) => [c.name, c]));
    expect(Object.keys(byName).sort()).toEqual(["get-citation", "get-rights-terms", "get-site-map", "related-notes", "verify-page"]);
    // Bridge v2 arc one: every tool takes no input and reads public bytes.
    for (const name of ["related-notes", "get-site-map", "get-citation"]) {
      expect(byName[name].inputSchema).toEqual({ type: "object", properties: {}, additionalProperties: false });
      expect(typeof byName[name].execute).toBe("function");
    }
    expect(byName["related-notes"].description).toContain("relatedness kernel");
    expect(byName["get-site-map"].description).toContain("/notes/index.json");
    expect(byName["get-citation"].description).toContain("BibTeX");

    expect(byName["verify-page"].description).toContain("signature, content hash, live match, and anchor");
    expect(byName["verify-page"].inputSchema).toEqual({
      type: "object", properties: {}, additionalProperties: false,
    });
    expect(typeof byName["verify-page"].execute).toBe("function");

    expect(byName["get-rights-terms"].description).toContain("ODRL policy");
    expect(byName["get-rights-terms"].inputSchema).toEqual({
      type: "object", properties: {}, additionalProperties: false,
    });
    expect(typeof byName["get-rights-terms"].execute).toBe("function");
  });

  it("does not double-register when the composed main runs twice on the same window", () => {
    // A duplicate <script> injection (or any other double-invocation path)
    // must not leave an agent choosing between two identically-named tools.
    const calls = [];
    const fakeApi = { registerTool: (spec) => calls.push(spec) };
    const fakeWindow = { document: {}, navigator: { modelContext: fakeApi } };

    const src = '"use strict";\n' + BRIDGE_SOURCE.replace(
      /snWebmcpMain\(\);\s*$/,
      "return snWebmcpMain;"
    );
    const composedMain = new Function(src)();
    composedMain(fakeWindow);
    composedMain(fakeWindow);

    expect(calls).toHaveLength(5); // not 10
  });
});
