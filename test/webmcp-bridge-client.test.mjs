import { describe, it, expect } from "vitest";
import {
  snAgentApi, snReadManifest, snRightsPointers, snGetRightsTerms,
} from "../src/webmcp-bridge-client.mjs";
import { TDM_POLICY_URL, LICENSE_URL, TDMREP_URL, ROBOTS_URL } from "../src/constants.mjs";

describe("snAgentApi", () => {
  it("prefers navigator.modelContext, falls back to window.agent, else null", () => {
    const mc = { registerTool: () => {} };
    expect(snAgentApi({ navigator: { modelContext: mc } })).toBe(mc);
    const ag = { registerTool: () => {} };
    expect(snAgentApi({ navigator: {}, agent: ag })).toBe(ag);
    expect(snAgentApi({ navigator: {} })).toBeNull();
    expect(snAgentApi({ navigator: { modelContext: {} } })).toBeNull(); // no registerTool
  });
});

describe("snReadManifest", () => {
  const doc = (json) => ({
    getElementById: (id) =>
      id === "sn-verification-manifest" && json !== undefined ? { textContent: json } : null,
  });
  it("parses the v11.7.0 manifest block", () => {
    const m = snReadManifest(doc('{"subject":{"uid":"u","kind":"note","version":2}}'));
    expect(m.subject.uid).toBe("u");
  });
  it("returns null when the block is absent or malformed", () => {
    expect(snReadManifest(doc(undefined))).toBeNull();
    expect(snReadManifest(doc("not json"))).toBeNull();
  });
});

describe("snRightsPointers", () => {
  it("names the four public rights surfaces", () => {
    const p = snRightsPointers();
    expect(p.human_policy).toBe(TDM_POLICY_URL);
    expect(p.license_xml).toBe(LICENSE_URL);
    expect(p.tdmrep).toBe(TDMREP_URL);
    expect(p.robots).toBe(ROBOTS_URL);
  });
});

describe("snGetRightsTerms", () => {
  it("fetches the ODRL representation with an explicit ld+json accept", async () => {
    let seen;
    const fetchFn = async (url, init) => {
      seen = { url, accept: init.headers.accept };
      return { ok: true, json: async () => ({ "@type": "Policy" }) };
    };
    const out = await snGetRightsTerms(fetchFn);
    expect(seen.url).toBe("/tdm-policy/");
    expect(seen.accept).toBe("application/ld+json");
    expect(out.policy["@type"]).toBe("Policy");
    expect(out.links.human_policy).toBe(TDM_POLICY_URL);
  });

  it("returns an error result, never throws, on a non-2xx", async () => {
    const out = await snGetRightsTerms(async () => ({ ok: false, status: 503 }));
    expect(out.error).toContain("503");
    expect(out.links.human_policy).toBe(TDM_POLICY_URL);
  });

  it("returns an error result, never throws, when the body is not valid JSON", async () => {
    const out = await snGetRightsTerms(async () => ({
      ok: true,
      json: async () => {
        throw new SyntaxError("Unexpected token <");
      },
    }));
    expect(out.error).toContain("Unexpected token <");
    expect(out.links.human_policy).toBe(TDM_POLICY_URL);
  });

  it("returns an error result, never throws, when the fetch itself rejects", async () => {
    const out = await snGetRightsTerms(async () => {
      throw new Error("network down");
    });
    expect(out.error).toContain("network down");
    expect(out.links.human_policy).toBe(TDM_POLICY_URL);
  });
});

describe("serialization self-containment", () => {
  // The served /webmcp/bridge.js asset is composed by concatenating these
  // functions' Function.prototype.toString() output — never their original
  // module. If any function closed over a module-scope const or import,
  // that reference would be dropped silently at composition time and only
  // fail in a browser. This test proves the composed source stands alone.
  //
  // Ideally this loads the composed source as a "data:text/javascript,..."
  // dynamic import (a true separate module, matching how a browser would
  // load /webmcp/bridge.js). That specifier form is unsupported by this
  // repo's test runtime: tests run under @cloudflare/vitest-pool-workers'
  // real workerd runtime (see vitest.config.mjs), whose module resolver
  // rejects "data:" specifiers for dynamic import() — confirmed by running
  // it here, which throws "No such module ...data:text/javascript,...".
  // `new Function(...)` gives the same guarantee without that dependency:
  // a Function-constructor body executes with NO lexical access to this
  // file's scope (imports, consts) — only globalThis — so a reference to a
  // module-scope constant would throw ReferenceError here exactly as it
  // would silently vanish in the real toString()-based composition.
  it("runs snRightsPointers and snReadManifest correctly when composed and executed standalone", async () => {
    // Every function appended to this array must also be INVOKED below —
    // an appended-but-uncalled function composes cleanly even if it closes
    // over a module-scope const, since that reference is never evaluated.
    // Leaving one uncalled makes the guard blind to exactly the failure
    // mode it exists to catch.
    const fns = [snAgentApi, snReadManifest, snRightsPointers, snGetRightsTerms];
    const src = fns.map((f) => f.toString()).join("\n");
    const moduleSrc =
      src + "\nreturn { snAgentApi, snReadManifest, snRightsPointers, snGetRightsTerms };";
    const composed = new Function(moduleSrc)();

    const p = composed.snRightsPointers();
    expect(p.human_policy).toBe(TDM_POLICY_URL);
    expect(p.license_xml).toBe(LICENSE_URL);
    expect(p.tdmrep).toBe(TDMREP_URL);
    expect(p.robots).toBe(ROBOTS_URL);

    const doc = (json) => ({
      getElementById: (id) =>
        id === "sn-verification-manifest" && json !== undefined ? { textContent: json } : null,
    });
    const m = composed.snReadManifest(doc('{"subject":{"uid":"u","kind":"note","version":2}}'));
    expect(m.subject.uid).toBe("u");
    expect(composed.snReadManifest(doc(undefined))).toBeNull();

    expect(composed.snAgentApi({ navigator: {} })).toBeNull();

    const terms = await composed.snGetRightsTerms(async () => ({ ok: true, json: async () => ({}) }));
    expect(terms.links.human_policy).toBe(TDM_POLICY_URL);
  });
});
