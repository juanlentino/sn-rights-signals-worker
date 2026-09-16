import { describe, it, expect, vi } from "vitest";
import * as client from "../src/webmcp-bridge-client.mjs";
import {
  snAgentApi, snReadManifest, snRightsPointers, snGetRightsTerms,
  snLoadCore, snVerifyPage, snWebmcpMain,
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

describe("snWebmcpMain", () => {
  it("registers the five tools when an agent API and document are present", () => {
    const calls = [];
    const fakeApi = { registerTool: (spec) => calls.push(spec) };
    snWebmcpMain({ document: {}, navigator: { modelContext: fakeApi } });
    expect(calls).toHaveLength(5);
    const byName = Object.fromEntries(calls.map((c) => [c.name, c]));
    expect(byName["verify-page"].inputSchema).toEqual({
      type: "object", properties: {}, additionalProperties: false,
    });
    expect(typeof byName["verify-page"].execute).toBe("function");
    expect(byName["get-rights-terms"].inputSchema).toEqual({
      type: "object", properties: {}, additionalProperties: false,
    });
    expect(typeof byName["get-rights-terms"].execute).toBe("function");
  });

  it("no-ops silently when there is no document", () => {
    const fakeApi = { registerTool: () => { throw new Error("must not register"); } };
    expect(() => snWebmcpMain({ navigator: { modelContext: fakeApi } })).not.toThrow();
  });

  it("no-ops silently when there is no usable agent API", () => {
    expect(() => snWebmcpMain({ document: {}, navigator: {} })).not.toThrow();
  });

  it("resolves globalThis-ish window when no argument is passed (no-op in this test runtime)", () => {
    // workerd has no `document` at all, so the no-arg path hits the
    // no-document guard before it ever looks at `navigator` — it must
    // resolve internally and no-op without throwing regardless of what
    // navigator carries.
    expect(() => snWebmcpMain()).not.toThrow();
  });

  it("does not double-register when called twice on the same window", () => {
    const calls = [];
    const fakeApi = { registerTool: (spec) => calls.push(spec) };
    const win = { document: {}, navigator: { modelContext: fakeApi } };
    snWebmcpMain(win);
    snWebmcpMain(win);
    expect(calls).toHaveLength(5); // not 10
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

// ---------------------------------------------------------------------------
// snLoadCore / snVerifyPage — the DOM-free port of the verification docket
// (assets/js/prov-verify.js in signal-and-noise-tools). Every decision below
// belongs to the core; these tests pin the ORCHESTRATION: which inputs get
// fetched, in what order the core's derive* functions are handed them, and the
// assembled return contract. The fake core's shapes are copied from the real
// core's exports (assets/js/prov-verify-core.js) — see the port notes there.

const STATE = {
  PENDING: "pending", PASS: "PASS", FAIL: "FAIL", UNREACHABLE: "UNREACHABLE", NOTE: "NOTE",
};

const MANIFEST = {
  spec: "https://juanlentino.com/verify",
  subject: { uid: "u1", kind: "note", version: 2, url: "https://juanlentino.com/notes/hello/" },
  calls: {
    credential: { method: "GET", url: "https://juanlentino.com/prov/credential/u1", type: "application/vc+ld+json" },
    record: { method: "GET", url: "https://ledger.example/raw/notes/u1/v2.json", type: "application/json" },
    proof: { method: "GET", url: "https://ledger.example/raw/notes/u1/v2.ots", type: "application/octet-stream" },
    key_history: { method: "GET", url: "https://juanlentino.com/.well-known/provenance-keys.json", type: "application/json" },
    did: { method: "GET", url: "https://juanlentino.com/.well-known/did.json", type: "application/json" },
    block_header: { method: "GET", url_template: "https://mempool.example/api/block-height/{height}", type: "text/plain" },
  },
  standalone: { repository: "https://github.com/x/ledger", documentation: "https://github.com/x/ledger/VERIFY.md" },
};

/** A minimal document exposing only what snReadManifest touches. */
const docWith = (manifest) => ({
  getElementById: (id) =>
    id === "sn-verification-manifest" && manifest !== undefined
      ? { textContent: typeof manifest === "string" ? manifest : JSON.stringify(manifest) }
      : null,
});

/** fetchFn over a { url: bodyObject } routing table; anything unrouted 404s. */
function routedFetch(routes, seen) {
  return async (url) => {
    if (seen) seen.push(url);
    if (!Object.prototype.hasOwnProperty.call(routes, url)) return { ok: false, status: 404 };
    const body = routes[url];
    if (body instanceof Error) throw body;
    return { ok: true, status: 200, json: async () => body };
  };
}

/**
 * A stand-in for window.SNProvVerifyCore. Every derive* returns a fixed
 * verdict and records its own name in `order`, so a test can assert the port
 * consults the core in the docket's sequence rather than inventing one.
 */
function fakeCore(overrides) {
  const order = [];
  const rec = (name, value) => (...args) => {
    order.push({ name, args });
    return typeof value === "function" ? value(...args) : value;
  };
  return Object.assign(
    {
      order,
      STATE,
      SUBJECT_ROOTS: { note: "notes", page: "pages" },
      ledgerKeysUrl: rec("ledgerKeysUrl", (base) => base + "/keys/provenance-keys.json"),
      mempoolTxStatusUrl: rec("mempoolTxStatusUrl", (base, txid) => base + "/tx/" + txid + "/status"),
      deriveKeyAgreement: rec("deriveKeyAgreement", { jwk: null }),
      decodeProofBytes: rec("decodeProofBytes", { payloadBytes: new Uint8Array(), sigBytes: new Uint8Array() }),
      deriveSignatureVerdict: rec("deriveSignatureVerdict", (valid) => ({
        state: valid ? STATE.PASS : STATE.FAIL, detail: "sig " + valid,
      })),
      decodeSignedPayloadBytes: rec("decodeSignedPayloadBytes", { payloadBytes: new Uint8Array([1, 2, 3]) }),
      bytesToHex: rec("bytesToHex", "deadbeef"),
      claimedContentHash: rec("claimedContentHash", "deadbeef"),
      deriveContentHashVerdict: rec("deriveContentHashVerdict", { state: STATE.PASS, detail: "hash ok" }),
      liveMatchTwinUrl: rec("liveMatchTwinUrl", "https://juanlentino.com/notes/hello.json"),
      deriveLiveMatchVerdict: rec("deriveLiveMatchVerdict", { state: STATE.PASS, detail: "live ok" }),
      deriveAnchorPlan: rec("deriveAnchorPlan", { verdict: { state: STATE.PASS, detail: "anchor ok" } }),
      deriveBlockOnlyAnchor: rec("deriveBlockOnlyAnchor", { verdict: { state: STATE.NOTE, detail: "block only" } }),
      deriveLedgerTxAnchor: rec("deriveLedgerTxAnchor", { state: STATE.PASS, detail: "ledger tx" }),
      deriveTxAnchor: rec("deriveTxAnchor", { state: STATE.PASS, detail: "tx anchor" }),
      deriveOverallVerdict: rec("deriveOverallVerdict", (states, retractionState) => ({
        level: retractionState && retractionState.retraction ? "retracted" : "pass",
        word: retractionState && retractionState.retraction ? "Retracted" : "Authentic",
        line: "all four agree", caveats: [], states, retractionState,
      })),
      // Retraction helpers, behaviourally faithful to prov-verify-core.js so
      // the port's sequencing (lookup -> relevance -> verify -> outcome) is
      // exercised rather than stubbed flat.
      base64ToBytes: (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)),
      retractionUrl: rec("retractionUrl", (base, uid, version) =>
        base.replace(/\/?$/, "") + "/retractions/" + encodeURIComponent(uid) + "/v" + Number(version) + ".json"),
      deriveRetraction: rec("deriveRetraction", (res, uid, version) => {
        if (res.status === 404) return { retraction: null, unknown: false, mismatched: false };
        const payload = res.json && res.json.payload;
        if (!payload || payload.kind !== "retraction") return { retraction: null, unknown: true, mismatched: false };
        if (payload.note_uid !== uid || Number(payload.version) !== Number(version)) {
          return { retraction: null, unknown: false, mismatched: true };
        }
        return { retraction: payload, unknown: false, mismatched: false };
      }),
      retractionOutcome: rec("retractionOutcome", (found, verified) => {
        if (found.retraction) {
          return verified === true ? { retraction: found.retraction, unknown: false } : { retraction: null, unknown: true };
        }
        return { retraction: null, unknown: !!(found.unknown || found.mismatched) };
      }),
    },
    overrides || {}
  );
}

const names = (core) => core.order.map((c) => c.name);

describe("snLoadCore", () => {
  it("resolves the already-present global without touching the document", async () => {
    // A page that already loaded the core (the docket's own <script> tag) must
    // not get a second copy appended.
    globalThis.window = { SNProvVerifyCore: { STATE } };
    try {
      const api = await snLoadCore({ createElement: () => { throw new Error("must not be called"); } }, "u");
      expect(api.STATE).toBe(STATE);
    } finally {
      delete globalThis.window;
    }
  });

  it("rejects when the document cannot make the script element", async () => {
    await expect(
      snLoadCore({ createElement: () => { throw new Error("no DOM here"); } }, "u")
    ).rejects.toThrow("no DOM here");
  });

  it("rejects when the script loads but exposes no API", async () => {
    globalThis.window = {};
    try {
      const el = {};
      const doc = { createElement: () => el, head: { appendChild: () => el.onload() } };
      await expect(snLoadCore(doc, "u")).rejects.toThrow("exposed no API");
    } finally {
      delete globalThis.window;
    }
  });

  it("rejects on its own budget when the script fires neither event", async () => {
    globalThis.window = {};
    vi.useFakeTimers();
    try {
      const doc = { createElement: () => ({}), head: { appendChild: () => {} } };
      const p = snLoadCore(doc, "u");
      const assertion = expect(p).rejects.toThrow("timed out after 10 seconds");
      await vi.advanceTimersByTimeAsync(10000);
      await assertion;
    } finally {
      vi.useRealTimers();
      delete globalThis.window;
    }
  });

  it("attaches to a pending script instead of appending a duplicate", async () => {
    globalThis.window = {};
    try {
      const pending = { listeners: {}, addEventListener(t, fn) { this.listeners[t] = fn; } };
      let appended = 0;
      const doc = {
        querySelector: () => pending,
        createElement: () => { throw new Error("must not create a second script"); },
        head: { appendChild: () => { appended++; } },
      };
      const p = snLoadCore(doc, "u");
      pending.listeners.error();
      await expect(p).rejects.toThrow("failed to load");
      expect(appended).toBe(0);
    } finally {
      delete globalThis.window;
    }
  });

  it("settles once when a script fires both load and error", async () => {
    globalThis.window = {};
    try {
      const el = {};
      const doc = { createElement: () => el, head: { appendChild: () => {} } };
      const p = snLoadCore(doc, "u");
      el.onerror();
      el.onload(); // must not re-settle or throw
      await expect(p).rejects.toThrow("failed to load");
    } finally {
      delete globalThis.window;
    }
  });

  it("rejects when the script itself fails to load", async () => {
    globalThis.window = {};
    try {
      const el = {};
      const doc = { createElement: () => el, head: { appendChild: () => el.onerror() } };
      await expect(snLoadCore(doc, "u")).rejects.toThrow("failed to load");
    } finally {
      delete globalThis.window;
    }
  });
});

describe("snVerifyPage", () => {
  it("reports honest absence on an unsigned page — no manifest, no verdicts", async () => {
    const out = await snVerifyPage({
      doc: docWith(undefined),
      fetchFn: () => { throw new Error("must not fetch"); },
      loadCore: () => { throw new Error("must not load the core"); },
    });
    expect(out.signed).toBe(false);
    expect(out.rights.human_policy).toBe(TDM_POLICY_URL);
    expect(out.note).toBe("This page is not a signed subject; nothing to verify.");
    expect(out.checks).toBeUndefined();
    expect(out.overall).toBeUndefined();
  });

  it("surfaces a core load failure as an error, keeping the subject", async () => {
    const out = await snVerifyPage({
      doc: docWith(MANIFEST),
      fetchFn: () => { throw new Error("must not fetch"); },
      loadCore: async () => { throw new Error("blocked by CSP"); },
    });
    expect(out.signed).toBe(true);
    expect(out.subject.uid).toBe("u1");
    expect(out.error).toBe("verifier core unavailable: blocked by CSP");
    expect(out.checks).toBeUndefined();
  });

  it("degrades every leg to UNREACHABLE when the credential cannot be fetched", async () => {
    const core = fakeCore();
    const out = await snVerifyPage({
      doc: docWith(MANIFEST),
      fetchFn: routedFetch({}), // credential 404s
      loadCore: async () => core,
    });
    expect(out.signed).toBe(true);
    ["signature", "contentHash", "liveMatch", "anchor"].forEach((k) => {
      expect(out.checks[k].state).toBe(STATE.UNREACHABLE);
      expect(out.checks[k].detail).toBeTruthy();
    });
    // Distinct objects, not one aliased verdict shared four ways.
    expect(out.checks.signature).not.toBe(out.checks.anchor);
    expect(out.overall.word).toBe("Authentic"); // the fake's fixed reply — presence is the assertion
    expect(names(core)).toEqual(["deriveOverallVerdict"]);
    expect(core.order[0].args[0]).toEqual({
      signature: STATE.UNREACHABLE,
      "content-hash": STATE.UNREACHABLE,
      "live-match": STATE.UNREACHABLE,
      anchor: STATE.UNREACHABLE,
    });
    // #52: with no credential the retraction could not be looked up either —
    // the verdict is qualified, never clean.
    expect(core.order[0].args[1]).toEqual({ retraction: null, unknown: true });
    expect(out.retraction).toEqual({ retraction: null, unknown: true });
    expect(out.ledger_record).toBe(MANIFEST.calls.record.url);
    expect(out.docket).toBe(MANIFEST.spec);
  });

  it("does not throw when a fetch rejects outright", async () => {
    const core = fakeCore();
    const out = await snVerifyPage({
      doc: docWith(MANIFEST),
      fetchFn: async () => { throw new Error("network down"); },
      loadCore: async () => core,
    });
    expect(out.checks.signature.state).toBe(STATE.UNREACHABLE);
  });

  it("assembles the four legs, consulting the core in the docket's order", async () => {
    // Real Ed25519 material so importKey/verify run for real in workerd; the
    // fake core only supplies the bytes and reads back the boolean.
    const kp = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
    const jwk = await crypto.subtle.exportKey("jwk", kp.publicKey);
    const payloadBytes = new TextEncoder().encode('{"content":"hello"}');
    const sigBytes = new Uint8Array(
      await crypto.subtle.sign({ name: "Ed25519" }, kp.privateKey, payloadBytes)
    );

    const core = fakeCore();
    core.deriveKeyAgreement = (...args) => { core.order.push({ name: "deriveKeyAgreement", args }); return { jwk }; };
    core.decodeProofBytes = (...args) => {
      core.order.push({ name: "decodeProofBytes", args });
      return { payloadBytes, sigBytes };
    };

    const seen = [];
    const cred = { proof: { pubkey_id: "k-2026-02" }, credentialSubject: { url: "https://juanlentino.com/notes/hello/" } };
    const out = await snVerifyPage({
      doc: docWith(MANIFEST),
      fetchFn: routedFetch(
        {
          [MANIFEST.calls.credential.url]: cred,
          [MANIFEST.calls.did.url]: { verificationMethod: [{ publicKeyJwk: jwk }] },
          [MANIFEST.calls.key_history.url]: { keys: [] },
          "https://ledger.example/raw/keys/provenance-keys.json": { keys: [] },
          "https://juanlentino.com/notes/hello.json": { content_text: "hello" },
        },
        seen
      ),
      loadCore: async () => core,
    });

    expect(Object.keys(out.checks)).toEqual(["signature", "contentHash", "liveMatch", "anchor"]);
    expect(out.checks.signature).toEqual({ state: STATE.PASS, detail: "sig true" });
    expect(out.checks.contentHash).toEqual({ state: STATE.PASS, detail: "hash ok" });
    expect(out.checks.liveMatch).toEqual({ state: STATE.PASS, detail: "live ok" });
    expect(out.checks.anchor).toEqual({ state: STATE.PASS, detail: "anchor ok" });
    expect(out.overall.states).toEqual({
      signature: STATE.PASS, "content-hash": STATE.PASS, "live-match": STATE.PASS, anchor: STATE.PASS,
    });
    expect(out.ledger_record).toBe(MANIFEST.calls.record.url);
    expect(out.docket).toBe(MANIFEST.spec);
    expect(out.subject).toEqual(MANIFEST.subject);

    // The signature leg's contract with the core, in order.
    const sig = names(core).filter((n) =>
      ["deriveKeyAgreement", "decodeProofBytes", "deriveSignatureVerdict"].includes(n)
    );
    expect(sig).toEqual(["deriveKeyAgreement", "decodeProofBytes", "deriveSignatureVerdict"]);
    // importKey/verify sit between decode and verdict: a real Ed25519 verify
    // over these bytes is the only way deriveSignatureVerdict sees `true`.
    expect(core.order.find((c) => c.name === "deriveSignatureVerdict").args[0]).toBe(true);
    // Key agreement is handed all three published copies: did, this site's
    // mirror, and the independent ledger copy — the ledger base derived from
    // the manifest's record URL.
    expect(core.order.find((c) => c.name === "ledgerKeysUrl").args[0]).toBe("https://ledger.example/raw");
    expect(seen).toContain("https://ledger.example/raw/keys/provenance-keys.json");
    // #51: the credential NAMES its signing key; the agreement must resolve
    // that key by id, not the did's first key, or a record signed under a
    // rotated key fails "signature invalid" while the docket passes it.
    expect(core.order.find((c) => c.name === "deriveKeyAgreement").args.length).toBe(4);
    expect(core.order.find((c) => c.name === "deriveKeyAgreement").args[3]).toBe("k-2026-02");
    // Content hash: the actual digest hex and the credential's claim.
    expect(core.order.find((c) => c.name === "deriveContentHashVerdict").args).toEqual(["deadbeef", "deadbeef"]);
  });

  // #52: the docket consults the retraction record and a VERIFIED retraction
  // dominates the verdict; the port never looked, so a withdrawn record read
  // "Authentic".
  describe("retraction state (#52)", () => {
    const RETRACTION_URL = "https://ledger.example/raw/retractions/u1/v2.json";
    const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    const b64 = (bytes) => btoa(String.fromCharCode(...bytes));

    async function signedRetraction(tamper) {
      const kp = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
      const jwk = await crypto.subtle.exportKey("jwk", kp.publicKey);
      const payload = { kind: "retraction", note_uid: "u1", version: 2, retracted_at: "2026-09-01", what_was_wrong: "a figure" };
      const bytes = new TextEncoder().encode(JSON.stringify(payload));
      const sig = new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, kp.privateKey, bytes));
      if (tamper) sig[0] ^= 0xff;
      const rec = {
        payload,
        signed_payload_b64: b64(bytes),
        signature: b64(sig),
        content_hash: hex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))),
        pubkey_id: "k-retract",
      };
      return { jwk, rec, payload };
    }

    function coreWith(jwk) {
      const core = fakeCore();
      core.deriveKeyAgreement = (...args) => { core.order.push({ name: "deriveKeyAgreement", args }); return { jwk }; };
      core.bytesToHex = (bytes) => hex(bytes);
      return core;
    }

    const routes = (extra) => ({
      [MANIFEST.calls.credential.url]: { proof: {} },
      [MANIFEST.calls.did.url]: { verificationMethod: [{ publicKeyJwk: {} }] },
      [MANIFEST.calls.key_history.url]: { keys: [] },
      "https://ledger.example/raw/keys/provenance-keys.json": { keys: [] },
      ...extra,
    });

    it("reads a 404 at the retraction path as not retracted, and says so to the verdict", async () => {
      const core = fakeCore();
      const seen = [];
      const out = await snVerifyPage({ doc: docWith(MANIFEST), fetchFn: routedFetch(routes({}), seen), loadCore: async () => core });
      expect(seen).toContain(RETRACTION_URL);
      expect(out.retraction).toEqual({ retraction: null, unknown: false });
      expect(core.order.find((c) => c.name === "deriveOverallVerdict").args[1]).toEqual({ retraction: null, unknown: false });
      expect(out.overall.word).toBe("Authentic");
    });

    it("honours a retraction that hashes and verifies under the key it names", async () => {
      const { jwk, rec, payload } = await signedRetraction(false);
      const core = coreWith(jwk);
      const out = await snVerifyPage({
        doc: docWith(MANIFEST), fetchFn: routedFetch(routes({ [RETRACTION_URL]: rec })), loadCore: async () => core,
      });
      expect(out.retraction).toEqual({ retraction: payload, unknown: false });
      expect(out.overall.word).toBe("Retracted");
      // Verified under the key the RETRACTION names, resolved by id.
      const agreements = core.order.filter((c) => c.name === "deriveKeyAgreement").map((c) => c.args[3]);
      expect(agreements).toContain("k-retract");
      expect(out.checks.signature).toBeTruthy(); // the four checks still run
    });

    it("does not honour a retraction whose signature fails, but does not wave it through either", async () => {
      const { jwk, rec } = await signedRetraction(true);
      const core = coreWith(jwk);
      const out = await snVerifyPage({
        doc: docWith(MANIFEST), fetchFn: routedFetch(routes({ [RETRACTION_URL]: rec })), loadCore: async () => core,
      });
      expect(out.retraction).toEqual({ retraction: null, unknown: true });
      expect(core.order.find((c) => c.name === "deriveOverallVerdict").args[1]).toEqual({ retraction: null, unknown: true });
    });

    it("reads an unreachable retraction path as unknown, never as clean", async () => {
      const core = fakeCore();
      const out = await snVerifyPage({
        doc: docWith(MANIFEST), fetchFn: routedFetch(routes({ [RETRACTION_URL]: new Error("blocked") })), loadCore: async () => core,
      });
      expect(out.retraction).toEqual({ retraction: null, unknown: true });
    });

    it("qualifies the verdict when the core predates retraction support", async () => {
      const core = fakeCore();
      delete core.retractionUrl;
      const out = await snVerifyPage({ doc: docWith(MANIFEST), fetchFn: routedFetch(routes({})), loadCore: async () => core });
      expect(out.retraction).toEqual({ retraction: null, unknown: true });
    });
  });

  it("passes an empty key id when the credential names none", async () => {
    const core = fakeCore();
    await snVerifyPage({
      doc: docWith(MANIFEST),
      fetchFn: routedFetch({
        [MANIFEST.calls.credential.url]: { proof: {} },
        [MANIFEST.calls.did.url]: { verificationMethod: [{ publicKeyJwk: {} }] },
      }),
      loadCore: async () => core,
    });
    expect(core.order.find((c) => c.name === "deriveKeyAgreement").args[3]).toBe("");
  });

  it("walks the block-only anchor path: ledger record, then the ledger-supplied txid", async () => {
    const anchor = { status: "confirmed", block: 900001 };
    const core = fakeCore({ });
    core.deriveAnchorPlan = (...a) => {
      core.order.push({ name: "deriveAnchorPlan", args: a });
      return { anchor, evidence: { contentHash: "aa" }, mode: "block-only" };
    };
    core.deriveBlockOnlyAnchor = (...a) => {
      core.order.push({ name: "deriveBlockOnlyAnchor", args: a });
      return { followTxid: "tx9", blockNote: "note" };
    };
    const seen = [];
    const out = await snVerifyPage({
      doc: docWith(MANIFEST),
      fetchFn: routedFetch(
        {
          [MANIFEST.calls.credential.url]: { proof: {} },
          [MANIFEST.calls.record.url]: { content_hash: "aa", ots: { bitcoin_txid: "tx9" } },
          "https://mempool.example/api/tx/tx9/status": { confirmed: true, block_height: 900001 },
        },
        seen
      ),
      loadCore: async () => core,
    });
    expect(out.checks.anchor).toEqual({ state: STATE.PASS, detail: "ledger tx" });
    // The mempool base comes from the manifest's block_header template.
    expect(core.order.find((c) => c.name === "mempoolTxStatusUrl").args).toEqual([
      "https://mempool.example/api", "tx9",
    ]);
    expect(seen).toContain("https://mempool.example/api/tx/tx9/status");
    const blockOnly = core.order.find((c) => c.name === "deriveBlockOnlyAnchor");
    expect(blockOnly.args[0]).toBe(anchor);
    expect(blockOnly.args[2].ok).toBe(true); // the ledger record fetch result
    expect(core.order.find((c) => c.name === "deriveLedgerTxAnchor").args[1]).toBe("note");
  });

  it("walks the txid anchor path: mempool status and ledger record together", async () => {
    const anchor = { status: "confirmed", txid: "abc", block: 5 };
    const core = fakeCore();
    core.deriveAnchorPlan = (...a) => {
      core.order.push({ name: "deriveAnchorPlan", args: a });
      return { anchor, evidence: { contentHash: "aa" }, mode: "txid" };
    };
    const out = await snVerifyPage({
      doc: docWith(MANIFEST),
      fetchFn: routedFetch({
        [MANIFEST.calls.credential.url]: { proof: {} },
        [MANIFEST.calls.record.url]: { content_hash: "aa" },
        "https://mempool.example/api/tx/abc/status": { confirmed: true, block_height: 5 },
      }),
      loadCore: async () => core,
    });
    expect(out.checks.anchor).toEqual({ state: STATE.PASS, detail: "tx anchor" });
    const tx = core.order.find((c) => c.name === "deriveTxAnchor");
    expect(tx.args[0]).toBe(anchor);
    expect(tx.args[2].json.confirmed).toBe(true); // mempool result first
    expect(tx.args[3].json.content_hash).toBe("aa"); // ledger record second
  });

  it("skips the live comparison rather than fetching a foreign origin", async () => {
    const core = fakeCore();
    core.liveMatchTwinUrl = () => "https://evil.example/notes/hello.json";
    const seen = [];
    const out = await snVerifyPage({
      doc: docWith(MANIFEST),
      fetchFn: routedFetch({ [MANIFEST.calls.credential.url]: { proof: {} } }, seen),
      loadCore: async () => core,
    });
    expect(out.checks.liveMatch.state).toBe(STATE.NOTE);
    expect(seen).not.toContain("https://evil.example/notes/hello.json");
  });

  it("derives the ledger base for a page subject, not just a note", async () => {
    // SUBJECT_ROOTS maps kind -> a FIXED literal directory; a 'page' subject
    // lives under pages/, so inverting the record URL must follow the map and
    // not assume notes/.
    const pageManifest = {
      ...MANIFEST,
      subject: { uid: "p1", kind: "page", version: 3, url: "https://juanlentino.com/about/" },
      calls: { ...MANIFEST.calls, record: { method: "GET", url: "https://ledger.example/raw/pages/p1/v3.json", type: "application/json" } },
    };
    const core = fakeCore();
    const seen = [];
    const out = await snVerifyPage({
      doc: docWith(pageManifest),
      fetchFn: routedFetch(
        {
          [MANIFEST.calls.credential.url]: { proof: {} },
          [MANIFEST.calls.did.url]: { verificationMethod: [{ publicKeyJwk: {} }] },
          [MANIFEST.calls.key_history.url]: { keys: [] },
          "https://ledger.example/raw/keys/provenance-keys.json": { keys: [] },
        },
        seen
      ),
      loadCore: async () => core,
    });
    expect(core.order.find((c) => c.name === "ledgerKeysUrl").args[0]).toBe("https://ledger.example/raw");
    expect(seen).toContain("https://ledger.example/raw/keys/provenance-keys.json");
    expect(out.checks.signature.detail).not.toContain("does not end with");
  });

  it("refuses to guess a ledger URL when the record shape drifted", async () => {
    // The three-way key check degrades SILENTLY to two-way if the ledger copy
    // is merely absent (the core skips it), so a wrong URL would still report
    // PASS. The shape mismatch has to stop the leg, not be fetched past.
    const drifted = {
      ...MANIFEST,
      calls: { ...MANIFEST.calls, record: { method: "GET", url: "https://ledger.example/raw/notes/u1.json", type: "application/json" } },
    };
    const core = fakeCore();
    const seen = [];
    const out = await snVerifyPage({
      doc: docWith(drifted),
      fetchFn: routedFetch({ [MANIFEST.calls.credential.url]: { proof: {} } }, seen),
      loadCore: async () => core,
    });
    expect(out.checks.signature.state).toBe(STATE.UNREACHABLE);
    expect(out.checks.signature.detail).toContain("/notes/u1/v2.json");
    expect(out.checks.signature.detail).toContain("Refusing to guess");
    // Nothing was fetched for the key check, and the core was never asked to
    // build a key URL from a base it could not trust.
    expect(names(core)).not.toContain("ledgerKeysUrl");
    expect(names(core)).not.toContain("deriveKeyAgreement");
    expect(seen).not.toContain(MANIFEST.calls.did.url);
    // The anchor leg still uses the manifest's record URL verbatim — only the
    // DERIVATION is refused, not the manifest's own value.
    expect(out.ledger_record).toBe(drifted.calls.record.url);
  });

  it("says HOW a leg degraded: timed out vs. answered a status", async () => {
    const core = fakeCore();
    const timedOut = await snVerifyPage({
      doc: docWith(MANIFEST),
      fetchFn: async () => { const e = new Error("aborted"); e.name = "AbortError"; throw e; },
      loadCore: async () => core,
    });
    expect(timedOut.checks.anchor.detail).toContain("timed out after 8 seconds");

    const status = await snVerifyPage({
      doc: docWith(MANIFEST),
      fetchFn: async () => ({ ok: false, status: 503 }),
      loadCore: async () => fakeCore(),
    });
    expect(status.checks.anchor.detail).toContain("answered 503");
    expect(status.checks.anchor.detail).not.toContain("timed out");
  });

  it("names the cause when a leg throws, so a port bug is not read as a network failure", async () => {
    const core = fakeCore();
    core.deriveAnchorPlan = () => { throw new TypeError("someHelper is not defined"); };
    const out = await snVerifyPage({
      doc: docWith(MANIFEST),
      fetchFn: routedFetch({ [MANIFEST.calls.credential.url]: { proof: {} } }),
      loadCore: async () => core,
    });
    expect(out.checks.anchor.state).toBe(STATE.UNREACHABLE);
    expect(out.checks.anchor.detail).toContain("someHelper is not defined");
  });

  it("passes the core's caveats through — hyphenated, unlike the camelCase check keys", async () => {
    // A KNOWN SKEW, pinned so it is visible rather than discovered later: the
    // returned `checks` map is camelCase (an agent-facing shape), while
    // overall.caveats names checks in the core's own hyphenated vocabulary.
    // Anything consuming caveats to index into checks must translate.
    const core = fakeCore();
    core.deriveOverallVerdict = (states) => ({
      level: "qualified", word: "Authentic", line: "…",
      caveats: ["content-hash", "anchor"], states,
    });
    const out = await snVerifyPage({
      doc: docWith(MANIFEST),
      fetchFn: routedFetch({ [MANIFEST.calls.credential.url]: { proof: {} } }),
      loadCore: async () => core,
    });
    expect(out.overall.caveats).toEqual(["content-hash", "anchor"]);
    expect(Object.keys(out.checks)).toEqual(["signature", "contentHash", "liveMatch", "anchor"]);
    // The skew is PARTIAL, which is what makes it a trap rather than an
    // obvious mismatch: two of the four names coincide, so a naive
    // checks[caveat] lookup appears to work and silently misses exactly the
    // two hyphenated ones. Both halves pinned.
    expect(out.checks.anchor).toBeDefined(); // coincides
    expect(out.checks["content-hash"]).toBeUndefined(); // does not
    expect(out.checks["live-match"]).toBeUndefined();
  });

  it("reports an unreachable did document without failing the signature", async () => {
    const core = fakeCore();
    const out = await snVerifyPage({
      doc: docWith(MANIFEST),
      fetchFn: routedFetch({ [MANIFEST.calls.credential.url]: { proof: {} } }),
      loadCore: async () => core,
    });
    expect(out.checks.signature.state).toBe(STATE.UNREACHABLE);
    expect(names(core)).not.toContain("deriveSignatureVerdict");
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
  // rejects "data:" specifiers for dynamic import() — RE-CONFIRMED 2026-08-28
  // by running it here, which now throws via a path-mangled specifier
  // ("Failed to import .../data:text/javascript,...") rather than the
  // originally-observed "No such module" message. The wording moved (a
  // vitest-pool-workers version bump changed how it reports the failure);
  // the rejection itself did not. `new Function(...)` gives the same
  // self-containment guarantee without that dependency: a Function-
  // constructor body executes with NO lexical access to this file's scope
  // (imports, consts) — only globalThis — so a reference to a module-scope
  // constant would throw ReferenceError here exactly as it would silently
  // vanish in the real toString()-based composition. It is evaluated in
  // STRICT mode below (a real ES module always runs strict; a bare
  // `new Function(src)()` would not) so a sloppy-only construct that a
  // browser's module loader would reject passes here too.
  it("runs snRightsPointers and snReadManifest correctly when composed and executed standalone", async () => {
    // Coverage here is per EXECUTED BODY, not per declared function. Every
    // function appended to this array must also be INVOKED below, THROUGH
    // PATHS THAT EVALUATE ITS NESTED HELPERS — a reference to a module-scope
    // const is only caught when the line holding it actually runs. An
    // appended-but-uncalled function composes cleanly; so does a called one
    // whose inner helpers (snVerifyPage's fetchJSON, ed25519Supported, the
    // four legs) never execute because the call short-circuited early. Both
    // leave the guard blind to exactly the failure mode it exists to catch,
    // which is why the signed path below is driven end to end and not just
    // the unsigned early return.
    //
    // Derived from the client module's namespace object (like PARTS in
    // src/webmcp-bridge.mjs) rather than hand-listed, so this array, the
    // served asset's composition list, and the module's actual export set
    // cannot drift into three copies that silently disagree.
    const fns = Object.values(client);
    const src = fns.map((f) => f.toString()).join("\n");
    const moduleSrc =
      '"use strict";\n' +
      src +
      "\nreturn { " + fns.map((f) => f.name).join(", ") + " };";
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
    // A ReferenceError from a dropped module-scope reference would be caught
    // by snGetRightsTerms' own try/catch and returned as a normal `error`
    // result — a swallowed failure that looks like a healthy return. Pin its
    // absence, or this guard is blind on exactly the path it exists to watch.
    expect(terms.error).toBeUndefined();

    // snVerifyPage on an unsigned page: executes the body (manifest read,
    // sibling snRightsPointers call) without needing a core or a network.
    const unsigned = await composed.snVerifyPage({
      doc: doc(undefined),
      fetchFn: async () => ({ ok: false, status: 404 }),
      loadCore: async () => { throw new Error("must not load"); },
    });
    expect(unsigned.signed).toBe(false);
    expect(unsigned.rights.human_policy).toBe(TDM_POLICY_URL);

    // The unsigned return above stops before fetchJSON, the Ed25519 probe and
    // all four legs ever run — so it alone cannot see a dropped reference in
    // any of them. Drive the SIGNED path too. The deps are call-time values,
    // so nothing here needs serializing; the composed body reaches only
    // globalThis, which in workerd supplies fetch, crypto, AbortController,
    // setTimeout and URL (and `location`, absent here, is typeof-guarded).
    const signed = await composed.snVerifyPage({
      doc: docWith(MANIFEST),
      fetchFn: routedFetch({
        [MANIFEST.calls.credential.url]: { proof: {} },
        [MANIFEST.calls.did.url]: { verificationMethod: [{ publicKeyJwk: {} }] },
        [MANIFEST.calls.key_history.url]: { keys: [] },
        "https://ledger.example/raw/keys/provenance-keys.json": { keys: [] },
        "https://juanlentino.com/notes/hello.json": { content_text: "hello" },
      }),
      loadCore: async () => fakeCore(),
    });
    // `error` FIRST: a dropped reference surfaces as a ReferenceError that
    // snVerifyPage's own outer catch converts into an error result, so this
    // assertion names the cause. Asserting the checks first would fail on an
    // opaque "cannot convert undefined to object" instead.
    expect(signed.error).toBeUndefined();
    expect(signed.signed).toBe(true);
    expect(Object.keys(signed.checks)).toEqual(["signature", "contentHash", "liveMatch", "anchor"]);
    expect(signed.overall).toBeDefined();

    // The signed path above resolves every fetch, so it never reaches why() or
    // the no-credential branch. Drive those too.
    const degraded = await composed.snVerifyPage({
      doc: docWith(MANIFEST),
      fetchFn: routedFetch({}), // credential 404s
      loadCore: async () => fakeCore(),
    });
    expect(degraded.checks.signature.detail).toContain("answered 404");

    // snLoadCore: the throwing createElement proves the body executed rather
    // than short-circuiting, and reaches the querySelector/fresh branch.
    await expect(
      composed.snLoadCore({ createElement: () => { throw new Error("no DOM here"); } }, "u")
    ).rejects.toThrow("no DOM here");
    // ...and a second call settles through finish()/clearTimeout, the lines
    // the throwing-createElement call never gets to.
    globalThis.window = {};
    try {
      const el = {};
      await expect(
        composed.snLoadCore(
          { createElement: () => el, head: { appendChild: () => el.onerror() } },
          "u"
        )
      ).rejects.toThrow("failed to load");
    } finally {
      delete globalThis.window;
    }

    // snWebmcpMain: drive the composed body's registration branch (not just
    // its early-return guard) with a fake window whose registerTool records
    // calls. This proves the composed source reaches api.registerTool for
    // both tools, and that each execute handler is wired to the composed
    // sibling functions — a dropped reference here would throw ReferenceError
    // the moment registerTool's own recording call runs.
    const registered = [];
    composed.snWebmcpMain({
      document: {},
      navigator: { modelContext: { registerTool: (spec) => registered.push(spec) } },
    });
    expect(registered.map((r) => r.name).sort()).toEqual(["get-citation", "get-rights-terms", "get-site-map", "related-notes", "verify-page"]);
    // no-op guards, driven too: absent document, absent agent API.
    expect(() => composed.snWebmcpMain({ navigator: { modelContext: { registerTool: () => {} } } })).not.toThrow();
    expect(() => composed.snWebmcpMain({ document: {}, navigator: {} })).not.toThrow();
    // Idempotence, on the COMPOSED source: a second call on the same window
    // object must not add a second pair of registrations.
    const idemWin = { document: {}, navigator: { modelContext: { registerTool: (spec) => registered.push(spec) } } };
    const before = registered.length;
    composed.snWebmcpMain(idemWin);
    composed.snWebmcpMain(idemWin);
    expect(registered.length - before).toBe(5); // not 10
  });
});
