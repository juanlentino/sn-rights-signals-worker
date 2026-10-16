import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index.mjs";
import { OWNER_AGENT_HEADER, _resetOwnerAgentForTests, verifyOwnerAgent } from "../src/owner-agent.mjs";

// Traffic Lanes Phase 1 (signal-and-noise-tools docs/plans/traffic-lanes-2026-10-15.md,
// "Phase 1 build contract" and "Advisor checkpoint 2"). The vectors below are
// pinned by every repo that signs or verifies; change them in all or none.
const KEY = "ab".repeat(32);
const OTHER_KEY = "cd".repeat(32);
const VECTOR = "v1.claude-code.1792140000.jJwzmWAzlHun5v56fuqtWUyTbzVfAVozM01-OHUd0Lg";
const VECTOR_EXP = 1792140000;
const MAX_AHEAD = 43200 + 300;
const BROWSER = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0 Safari/537.36";
const CURL = "curl/8.7.1";

const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const hexBytes = (hex) => Uint8Array.from(hex.match(/../g), (h) => parseInt(h, 16));

async function sign(agent, exp, keyHex = KEY) {
  const key = await crypto.subtle.importKey("raw", hexBytes(keyHex), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`v1|agent|${agent}|${exp}`));
  return `v1.${agent}.${exp}.${b64url(sig)}`;
}

const req = (path, headers) => new Request(`https://juanlentino.com${path}`, { headers });
const withToken = (token) => req("/notes/x/", { "user-agent": CURL, [OWNER_AGENT_HEADER]: token });
const now = () => Math.floor(Date.now() / 1000);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  _resetOwnerAgentForTests();
});

describe("SN-Owner-Agent verification: the contract's test vector", () => {
  it("signs the vector message to the pinned bytes", async () => {
    expect(await sign("claude-code", VECTOR_EXP)).toBe(VECTOR);
  });

  it("the pinned header is valid one second before expiry: code 2, agent claude-code (3)", async () => {
    const env = { SN_OWNER_AGENT_KEY: KEY };
    expect(await verifyOwnerAgent(withToken(VECTOR), env, VECTOR_EXP - 1)).toEqual({ identity: 2, agent: 3 });
  });

  it("expired: checked at exp + 1 it is code 3", async () => {
    const env = { SN_OWNER_AGENT_KEY: KEY };
    expect(await verifyOwnerAgent(withToken(VECTOR), env, VECTOR_EXP + 1)).toEqual({ identity: 3, agent: 0 });
  });

  it("valid only while now < exp: at exp itself it is code 3", async () => {
    const env = { SN_OWNER_AGENT_KEY: KEY };
    expect((await verifyOwnerAgent(withToken(VECTOR), env, VECTOR_EXP)).identity).toBe(3);
  });

  it("too far in the future: exp - now may be 43500, not 43501", async () => {
    const env = { SN_OWNER_AGENT_KEY: KEY };
    expect((await verifyOwnerAgent(withToken(VECTOR), env, VECTOR_EXP - MAX_AHEAD)).identity).toBe(2);
    expect((await verifyOwnerAgent(withToken(VECTOR), env, VECTOR_EXP - MAX_AHEAD - 1)).identity).toBe(3);
  });

  it("tampered: a changed agent, expiry or signature byte is code 3", async () => {
    const env = { SN_OWNER_AGENT_KEY: KEY };
    const at = VECTOR_EXP - 60;
    for (const bad of [
      VECTOR.replace("claude-code", "playwright"),
      VECTOR.replace("1792140000", "1792140001"),
      VECTOR.slice(0, -1) + (VECTOR.endsWith("g") ? "h" : "g"),
      VECTOR.replace("v1.", "v2."),
    ]) {
      expect(await verifyOwnerAgent(withToken(bad), env, at)).toEqual({ identity: 3, agent: 0 });
    }
  });

  it("malformed values are code 3", async () => {
    const env = { SN_OWNER_AGENT_KEY: KEY };
    for (const bad of ["", "garbage", "v1.claude-code.1792140000", `${VECTOR}.extra`, "v1.claude-code.17921400x0.abc", "v1.claude-code.1792140000.!!!"]) {
      expect((await verifyOwnerAgent(withToken(bad), env, VECTOR_EXP - 60)).identity).toBe(3);
    }
  });

  it("the previous key is accepted during an overlap", async () => {
    const env = { SN_OWNER_AGENT_KEY: OTHER_KEY, SN_OWNER_AGENT_KEY_PREVIOUS: KEY };
    expect(await verifyOwnerAgent(withToken(VECTOR), env, VECTOR_EXP - 60)).toEqual({ identity: 2, agent: 3 });
  });

  it("a token signed by neither key is code 3", async () => {
    const env = { SN_OWNER_AGENT_KEY: OTHER_KEY, SN_OWNER_AGENT_KEY_PREVIOUS: "ef".repeat(32) };
    expect((await verifyOwnerAgent(withToken(VECTOR), env, VECTOR_EXP - 60)).identity).toBe(3);
  });

  it("maps every allowlisted agent to its code", async () => {
    const env = { SN_OWNER_AGENT_KEY: KEY };
    const codes = { browser: 1, "chrome-extension": 2, "claude-code": 3, playwright: 4, script: 5, "mcp-local": 6, other: 7 };
    for (const [agent, code] of Object.entries(codes)) {
      const exp = now() + 3600;
      expect(await verifyOwnerAgent(withToken(await sign(agent, exp)), env)).toEqual({ identity: 2, agent: code });
    }
  });

  it("a correctly signed agent outside the allowlist is code 3", async () => {
    const env = { SN_OWNER_AGENT_KEY: KEY };
    expect((await verifyOwnerAgent(withToken(await sign("evil", now() + 3600)), env)).identity).toBe(3);
  });

  it("no header: null, nothing to verify", async () => {
    expect(await verifyOwnerAgent(req("/", { "user-agent": CURL }), { SN_OWNER_AGENT_KEY: KEY })).toBeNull();
  });
});

describe("SN-Owner-Agent verification: key unset is no verdict, never code 3", () => {
  it("returns code 0 and logs owner_key_unset once per isolate", async () => {
    const log = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const env of [{}, { SN_OWNER_AGENT_KEY: "" }, { SN_OWNER_AGENT_KEY: "not-hex" }]) {
      expect(await verifyOwnerAgent(withToken(VECTOR), env, VECTOR_EXP - 60)).toEqual({ identity: 0, agent: 0 });
    }
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0][0])).toContain("owner_key_unset");
    expect(String(log.mock.calls[0][0])).not.toContain(VECTOR);
  });

  it("only the previous key set still verifies", async () => {
    const env = { SN_OWNER_AGENT_KEY_PREVIOUS: KEY };
    expect((await verifyOwnerAgent(withToken(VECTOR), env, VECTOR_EXP - 60)).identity).toBe(2);
  });
});

// ---- the sensor ----

function harness(extraEnv = {}) {
  const agg = [];
  const detail = [];
  const env = {
    SN_MR: { writeDataPoint: (d) => agg.push(d) },
    SN_MR_RIGHTS: { writeDataPoint: (d) => detail.push(d) },
    SN_OWNER_AGENT_KEY: KEY,
    ...extraEnv,
  };
  const origin = vi.fn().mockImplementation(() => Promise.resolve(new Response("ok", { headers: { "content-type": "text/plain" } })));
  vi.stubGlobal("fetch", origin);
  return { agg, detail, env, origin };
}

describe("sn_machine_readers: blob14 identity, blob15 agent (append only)", () => {
  it("row fixture: blobs 1-13 are exactly today's, blob14/15 are appended", async () => {
    const { agg, env } = harness();
    const token = await sign("claude-code", now() + 3600);
    const r = req("/llms.txt", { "user-agent": CURL, [OWNER_AGENT_HEADER]: token, "x-sn-verified-bot": "" });
    Object.defineProperty(r, "cf", { value: { asOrganization: "Charter Communications, Inc" } });
    await worker.fetch(r, env, {});
    expect(agg).toHaveLength(1);
    const blobs = agg[0].blobs;
    expect(blobs).toHaveLength(15);
    expect(blobs.slice(0, 13)).toEqual(["other-bot", "llms", blobs[2], blobs[3], blobs[4], blobs[5], "0", "", "dev-curl", "0", "unsigned", "", "Charter Communications, Inc"]);
    expect(blobs.slice(13)).toEqual(["2", "3"]);
    expect(agg[0].doubles).toEqual([1]);
    expect(agg[0].indexes).toEqual(["other-bot"]);
  });

  it("a request without the header writes 0/0 and the same first thirteen blobs", async () => {
    const { agg, env } = harness();
    await worker.fetch(req("/llms.txt", { "user-agent": CURL }), env, {});
    await worker.fetch(req("/llms.txt", { "user-agent": CURL, [OWNER_AGENT_HEADER]: await sign("script", now() + 60) }), env, {});
    expect(agg[0].blobs.slice(13)).toEqual(["0", "0"]);
    expect(agg[1].blobs.slice(0, 13)).toEqual(agg[0].blobs.slice(0, 13));
    expect(agg[1].blobs.slice(13)).toEqual(["2", "5"]);
  });

  it("an invalid token writes 3/0", async () => {
    const { agg, env } = harness();
    await worker.fetch(req("/llms.txt", { "user-agent": CURL, [OWNER_AGENT_HEADER]: "v1.claude-code.1.AAAA" }), env, {});
    expect(agg[0].blobs.slice(13)).toEqual(["3", "0"]);
  });

  it("key unset: 0/0, exactly as without the header", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { agg, env } = harness({ SN_OWNER_AGENT_KEY: undefined });
    await worker.fetch(req("/llms.txt", { "user-agent": CURL, [OWNER_AGENT_HEADER]: VECTOR }), env, {});
    expect(agg[0].blobs.slice(13)).toEqual(["0", "0"]);
  });
});

describe("force-record: a token-bearing request never vanishes", () => {
  it("code 3 with a browser user agent is recorded as unclassified-machine", async () => {
    const { agg, env } = harness();
    await worker.fetch(req("/notes/x/", { "user-agent": BROWSER, [OWNER_AGENT_HEADER]: "forged" }), env, {});
    expect(agg).toHaveLength(1);
    expect(agg[0].blobs[0]).toBe("unclassified-machine");
    expect(agg[0].blobs.slice(13)).toEqual(["3", "0"]);
  });

  it("code 3 is recorded on an asset too", async () => {
    const { agg, env } = harness();
    await worker.fetch(req("/wp-content/x.png", { "user-agent": BROWSER, [OWNER_AGENT_HEADER]: "forged" }), env, {});
    expect(agg).toHaveLength(1);
    expect(agg[0].blobs[1]).toBe("asset");
  });

  it("code 2 with a browser user agent is recorded on a page", async () => {
    const { agg, env } = harness();
    await worker.fetch(req("/notes/x/", { "user-agent": BROWSER, [OWNER_AGENT_HEADER]: await sign("playwright", now() + 600) }), env, {});
    expect(agg).toHaveLength(1);
    expect(agg[0].blobs[0]).toBe("unclassified-machine");
    expect(agg[0].blobs.slice(13)).toEqual(["2", "4"]);
  });

  it("code 2 with a browser user agent is NOT force-recorded on an asset", async () => {
    const { agg, env } = harness();
    await worker.fetch(req("/wp-content/x.png", { "user-agent": BROWSER, [OWNER_AGENT_HEADER]: await sign("playwright", now() + 600) }), env, {});
    expect(agg).toHaveLength(0);
  });

  it("code 2 on an asset is still recorded when its user agent classifies, as today", async () => {
    const { agg, env } = harness();
    await worker.fetch(req("/wp-content/x.png", { "user-agent": CURL, [OWNER_AGENT_HEADER]: await sign("script", now() + 600) }), env, {});
    expect(agg).toHaveLength(1);
    expect(agg[0].blobs.slice(13)).toEqual(["2", "5"]);
  });

  it("no header, browser user agent: not recorded, as today", async () => {
    const { agg, env } = harness();
    await worker.fetch(req("/notes/x/", { "user-agent": BROWSER }), env, {});
    expect(agg).toHaveLength(0);
  });

  it("key unset: a browser with the header is not force-recorded (nothing changes)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { agg, env } = harness({ SN_OWNER_AGENT_KEY: undefined });
    await worker.fetch(req("/notes/x/", { "user-agent": BROWSER, [OWNER_AGENT_HEADER]: "forged" }), env, {});
    expect(agg).toHaveLength(0);
  });

  it("/_sn/ paths stay unobserved, header or not", async () => {
    const { agg, env } = harness();
    await worker.fetch(req("/_sn/rights-signals/version", { "user-agent": BROWSER, [OWNER_AGENT_HEADER]: "forged" }), env, {});
    expect(agg).toHaveLength(0);
  });
});

describe("the header value goes nowhere", () => {
  const forwarded = (origin) => origin.mock.calls[0][0];

  it("is stripped on the page passthrough, the admin bypass and robots.txt", async () => {
    for (const path of ["/notes/x/", "/wp-admin/", "/robots.txt", "/notes/x/?utm_source=a"]) {
      const { env, origin } = harness();
      await worker.fetch(req(path, { "user-agent": CURL, [OWNER_AGENT_HEADER]: VECTOR }), env, {});
      expect(forwarded(origin).headers.get(OWNER_AGENT_HEADER)).toBeNull();
      expect(forwarded(origin).headers.get("user-agent")).toBe(CURL);
      vi.unstubAllGlobals();
    }
  });

  it("is stripped alongside x-sn-first-party", async () => {
    const { env, origin } = harness({ SN_FIRST_PARTY_TOKEN: "fp" });
    await worker.fetch(req("/notes/x/", { "user-agent": CURL, [OWNER_AGENT_HEADER]: VECTOR, "x-sn-first-party": "fp" }), env, {});
    expect(forwarded(origin).headers.get(OWNER_AGENT_HEADER)).toBeNull();
    expect(forwarded(origin).headers.get("x-sn-first-party")).toBeNull();
  });

  it("is stripped with the key unset", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { env, origin } = harness({ SN_OWNER_AGENT_KEY: undefined });
    await worker.fetch(req("/notes/x/", { "user-agent": CURL, [OWNER_AGENT_HEADER]: VECTOR }), env, {});
    expect(forwarded(origin).headers.get(OWNER_AGENT_HEADER)).toBeNull();
  });

  it("never lands in a row (aggregate or rights detail), a log line or the response", async () => {
    const logs = [];
    for (const m of ["log", "warn", "error", "info"]) vi.spyOn(console, m).mockImplementation((...a) => logs.push(a.join(" ")));
    const { agg, detail, env } = harness();
    const token = await sign("claude-code", now() + 600);
    const bad = "v1.claude-code.1.SECRETISHVALUE";
    const responses = [];
    for (const t of [token, bad]) {
      responses.push(await worker.fetch(req("/license.xml", { "user-agent": CURL, [OWNER_AGENT_HEADER]: t }), env, {}));
      responses.push(await worker.fetch(req("/notes/x/", { "user-agent": BROWSER, [OWNER_AGENT_HEADER]: t }), env, {}));
    }
    expect(agg.length).toBeGreaterThan(0);
    expect(detail.length).toBeGreaterThan(0);
    const sigOf = (t) => t.split(".")[3];
    const haystack = JSON.stringify([agg, detail, logs]) + (await Promise.all(responses.map(async (r) => JSON.stringify([...r.headers]) + (await r.text())))).join("");
    for (const t of [token, bad]) {
      expect(haystack).not.toContain(t);
      expect(haystack).not.toContain(sigOf(t));
    }
  });
});
