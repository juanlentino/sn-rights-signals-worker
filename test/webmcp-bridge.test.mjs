import { describe, it, expect } from "vitest";
import { BRIDGE_SOURCE, BRIDGE_SRI, WEBMCP_SCRIPT_TAG, webmcpBridgeResponse } from "../src/webmcp-bridge.mjs";

describe("composed bridge asset", () => {
  it("is a valid standalone script that no-ops headless (the self-containment gate)", () => {
    // workerd DOES expose `navigator` on globalThis (unlike a browser lacking
    // WebMCP support entirely), but it carries no `modelContext`, and workerd
    // has no `document` at all. So the trailing snWebmcpMain() call must hit
    // its "no usable agent API OR no document" guard and return silently —
    // neither throwing nor registering anything. That silence, on real
    // workerd globals, IS the headless no-op this test pins.
    expect(() => new Function(BRIDGE_SOURCE)()).not.toThrow();
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

  it("registers both tools with the pinned shape when driven with a fake window", () => {
    // Positive path for snWebmcpMain's composed body: a fake window carrying a
    // recording registerTool proves the trailing call in BRIDGE_SOURCE reaches
    // the registration branch (not just the early-return guard exercised by
    // the headless test above), and that both tools land with the described
    // shape — including that `execute` is a callable function.
    const calls = [];
    const fakeApi = { registerTool: (spec) => calls.push(spec) };
    const fakeWindow = { document: {}, navigator: { modelContext: fakeApi } };

    const src = BRIDGE_SOURCE.replace(
      /snWebmcpMain\(\);\s*$/,
      "return snWebmcpMain;"
    );
    const composedMain = new Function(src)();
    composedMain(fakeWindow);

    expect(calls).toHaveLength(2);
    const byName = Object.fromEntries(calls.map((c) => [c.name, c]));
    expect(Object.keys(byName).sort()).toEqual(["get-rights-terms", "verify-page"]);

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
});
