import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index.mjs";
import { buildQuery } from "../src/machine-readers.mjs";
import { OWNER_AGENT_HEADER, _resetOwnerAgentForTests, getInvalidTokenCount, verifyOwnerAgent } from "../src/owner-agent.mjs";

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
    const env = { SN_OWNER_KEY: KEY };
    expect(await verifyOwnerAgent(withToken(VECTOR), env, VECTOR_EXP - 1)).toEqual({ identity: 2, agent: 3 });
  });

  it("expired: checked at exp + 1 it is code 3", async () => {
    const env = { SN_OWNER_KEY: KEY };
    expect(await verifyOwnerAgent(withToken(VECTOR), env, VECTOR_EXP + 1)).toEqual({ identity: 3, agent: 0 });
  });

  it("valid only while now < exp: at exp itself it is code 3", async () => {
    const env = { SN_OWNER_KEY: KEY };
    expect((await verifyOwnerAgent(withToken(VECTOR), env, VECTOR_EXP)).identity).toBe(3);
  });

  it("too far in the future: exp - now may be 43500, not 43501", async () => {
    const env = { SN_OWNER_KEY: KEY };
    expect((await verifyOwnerAgent(withToken(VECTOR), env, VECTOR_EXP - MAX_AHEAD)).identity).toBe(2);
    expect((await verifyOwnerAgent(withToken(VECTOR), env, VECTOR_EXP - MAX_AHEAD - 1)).identity).toBe(3);
  });

  it("tampered: a changed agent, expiry or signature byte is code 3", async () => {
    const env = { SN_OWNER_KEY: KEY };
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
    const env = { SN_OWNER_KEY: KEY };
    for (const bad of ["garbage", "v1.claude-code.1792140000", `${VECTOR}.extra`, "v1.claude-code.17921400x0.abc", "v1.claude-code.1792140000.!!!"]) {
      expect((await verifyOwnerAgent(withToken(bad), env, VECTOR_EXP - 60)).identity).toBe(3);
    }
  });

  it("the previous key is accepted during an overlap", async () => {
    const env = { SN_OWNER_KEY: OTHER_KEY, SN_OWNER_KEY_PREVIOUS: KEY };
    expect(await verifyOwnerAgent(withToken(VECTOR), env, VECTOR_EXP - 60)).toEqual({ identity: 2, agent: 3 });
  });

  it("a token signed by neither key is code 3", async () => {
    const env = { SN_OWNER_KEY: OTHER_KEY, SN_OWNER_KEY_PREVIOUS: "ef".repeat(32) };
    expect((await verifyOwnerAgent(withToken(VECTOR), env, VECTOR_EXP - 60)).identity).toBe(3);
  });

  it("maps every allowlisted agent to its code", async () => {
    const env = { SN_OWNER_KEY: KEY };
    const codes = { browser: 1, "chrome-extension": 2, "claude-code": 3, playwright: 4, script: 5, "mcp-local": 6, other: 7 };
    for (const [agent, code] of Object.entries(codes)) {
      const exp = now() + 3600;
      expect(await verifyOwnerAgent(withToken(await sign(agent, exp)), env)).toEqual({ identity: 2, agent: code });
    }
  });

  it("a device marker signed with the same key is rejected as a token (one key, domain-separated)", async () => {
    const env = { SN_OWNER_KEY: KEY };
    const at = VECTOR_EXP - 60;
    // The contract's device-marker vector, presented as the agent header.
    const marker = "v1.0123456789abcdef.20261015.anHSQ9ch5h07TmKcjtSoniVfPuP9aRaSNJ5UjEgtLpc";
    expect(await verifyOwnerAgent(withToken(marker), env, at)).toEqual({ identity: 3, agent: 0 });
    // A `v1|dev|...` MAC over a token-shaped body must not verify either.
    const key = await crypto.subtle.importKey("raw", hexBytes(KEY), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const devSig = b64url(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`v1|dev|claude-code|${VECTOR_EXP}`)));
    expect(await verifyOwnerAgent(withToken(`v1.claude-code.${VECTOR_EXP}.${devSig}`), env, at)).toEqual({ identity: 3, agent: 0 });
  });

  it("a correctly signed agent outside the allowlist is code 3", async () => {
    const env = { SN_OWNER_KEY: KEY };
    expect((await verifyOwnerAgent(withToken(await sign("evil", now() + 3600)), env)).identity).toBe(3);
  });

  it("an empty value is the same as no header (review round 1)", async () => {
    expect(await verifyOwnerAgent(withToken(""), { SN_OWNER_KEY: KEY })).toBeNull();
    expect(getInvalidTokenCount()).toBe(0);
  });

  it("no header: null, nothing to verify", async () => {
    expect(await verifyOwnerAgent(req("/", { "user-agent": CURL }), { SN_OWNER_KEY: KEY })).toBeNull();
  });
});

describe("SN-Owner-Agent verification: key unset is no verdict, never code 3", () => {
  it("returns code 0 and logs owner_key_unset once per isolate", async () => {
    const log = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const env of [{}, { SN_OWNER_KEY: "" }, { SN_OWNER_KEY: "not-hex" }]) {
      expect(await verifyOwnerAgent(withToken(VECTOR), env, VECTOR_EXP - 60)).toEqual({ identity: 0, agent: 0 });
    }
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0][0])).toContain("owner_key_unset");
    expect(String(log.mock.calls[0][0])).not.toContain(VECTOR);
  });

  it("the retired per-purpose secret name is not read (owner decision: one key)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const env = { SN_OWNER_AGENT_KEY: KEY, SN_OWNER_AGENT_KEY_PREVIOUS: KEY };
    expect(await verifyOwnerAgent(withToken(VECTOR), env, VECTOR_EXP - 60)).toEqual({ identity: 0, agent: 0 });
  });

  it("only the previous key set still verifies", async () => {
    const env = { SN_OWNER_KEY_PREVIOUS: KEY };
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
    SN_OWNER_KEY: KEY,
    ...extraEnv,
  };
  const origin = vi.fn().mockImplementation(() => Promise.resolve(new Response("ok", { headers: { "content-type": "text/plain" } })));
  vi.stubGlobal("fetch", origin);
  return { agg, detail, env, origin };
}

describe("sn_machine_readers: blob14 identity, blob15 agent (append only)", () => {
  it("row fixture: a code-2 row is today's row with first_party=1, blob14/15 appended", async () => {
    const { agg, env } = harness();
    const token = await sign("claude-code", now() + 3600);
    const r = req("/llms.txt", { "user-agent": CURL, [OWNER_AGENT_HEADER]: token, "x-sn-verified-bot": "" });
    Object.defineProperty(r, "cf", { value: { asOrganization: "Charter Communications, Inc" } });
    await worker.fetch(r, env, {});
    expect(agg).toHaveLength(1);
    const blobs = agg[0].blobs;
    expect(blobs).toHaveLength(17); // 1.6.0 appended blob16; résumé format blob17
    expect(blobs.slice(0, 13)).toEqual(["other-bot", "llms", blobs[2], blobs[3], blobs[4], blobs[5], "1", "", "dev-curl", "0", "unsigned", "", "Charter Communications, Inc"]);
    expect(blobs.slice(13, 15)).toEqual(["2", "3"]);
    expect(agg[0].doubles).toEqual([1]);
    expect(agg[0].indexes).toEqual(["other-bot"]);
  });

  it("a code-2 row differs from the headerless row only in first_party and blob14/15", async () => {
    const { agg, env } = harness();
    await worker.fetch(req("/llms.txt", { "user-agent": CURL }), env, {});
    await worker.fetch(req("/llms.txt", { "user-agent": CURL, [OWNER_AGENT_HEADER]: await sign("script", now() + 60) }), env, {});
    expect(agg[0].blobs.slice(13, 15)).toEqual(["0", "0"]);
    expect(agg[0].blobs[6]).toBe("0");
    expect(agg[1].blobs[6]).toBe("1");
    expect([...agg[1].blobs.slice(0, 6), "0", ...agg[1].blobs.slice(7, 13)]).toEqual(agg[0].blobs.slice(0, 13));
    expect(agg[1].blobs.slice(13, 15)).toEqual(["2", "5"]);
  });

  it("a junk header on a taxonomy-matched UA writes the normal row, blob14=3, nothing else changed", async () => {
    const { agg, env } = harness();
    await worker.fetch(req("/llms.txt", { "user-agent": CURL }), env, {});
    await worker.fetch(req("/llms.txt", { "user-agent": CURL, [OWNER_AGENT_HEADER]: "v1.claude-code.1.AAAA" }), env, {});
    expect(agg).toHaveLength(2);
    expect(agg[1].blobs.slice(0, 13)).toEqual(agg[0].blobs.slice(0, 13));
    expect(agg[1].blobs.slice(13, 15)).toEqual(["3", "0"]);
    expect(getInvalidTokenCount()).toBe(1);
  });

  it("key unset: 0/0, exactly as without the header", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { agg, env } = harness({ SN_OWNER_KEY: undefined });
    await worker.fetch(req("/llms.txt", { "user-agent": CURL, [OWNER_AGENT_HEADER]: VECTOR }), env, {});
    expect(agg[0].blobs.slice(13, 15)).toEqual(["0", "0"]);
  });
});

describe("no force-record (review round 2): a token never creates a row", () => {
  it("a junk header with an unclassified UA writes no row, on a page or an asset; the isolate counter counts it", async () => {
    const { agg, detail, env } = harness();
    await worker.fetch(req("/notes/x/", { "user-agent": BROWSER, [OWNER_AGENT_HEADER]: "forged" }), env, {});
    await worker.fetch(req("/wp-content/x.png", { "user-agent": BROWSER, [OWNER_AGENT_HEADER]: "forged" }), env, {});
    await worker.fetch(req("/license.xml", { "user-agent": BROWSER, [OWNER_AGENT_HEADER]: "forged" }), env, {});
    expect(agg).toHaveLength(0);
    expect(detail).toHaveLength(0);
    expect(getInvalidTokenCount()).toBe(3);
  });

  it("a junk header on an asset with a classified UA writes the normal row with blob14=3", async () => {
    const { agg, env } = harness();
    await worker.fetch(req("/wp-content/x.png", { "user-agent": CURL, [OWNER_AGENT_HEADER]: "forged" }), env, {});
    expect(agg).toHaveLength(1);
    expect(agg[0].blobs[6]).toBe("0");
    expect(agg[0].blobs.slice(13, 15)).toEqual(["3", "0"]);
  });

  it("code 2 with a browser user agent writes no row on a page either", async () => {
    const { agg, detail, env } = harness();
    await worker.fetch(req("/notes/x/", { "user-agent": BROWSER, [OWNER_AGENT_HEADER]: await sign("playwright", now() + 600) }), env, {});
    await worker.fetch(req("/license.xml", { "user-agent": BROWSER, [OWNER_AGENT_HEADER]: await sign("playwright", now() + 600) }), env, {});
    expect(agg).toHaveLength(0);
    expect(detail).toHaveLength(0);
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
    expect(agg[0].blobs.slice(13, 15)).toEqual(["2", "5"]);
  });

  it("no header, browser user agent: not recorded, as today", async () => {
    const { agg, env } = harness();
    await worker.fetch(req("/notes/x/", { "user-agent": BROWSER }), env, {});
    expect(agg).toHaveLength(0);
  });

  it("key unset: a browser with the header is not force-recorded (nothing changes)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { agg, env } = harness({ SN_OWNER_KEY: undefined });
    await worker.fetch(req("/notes/x/", { "user-agent": BROWSER, [OWNER_AGENT_HEADER]: "forged" }), env, {});
    expect(agg).toHaveLength(0);
  });

  it("/_sn/ paths stay unobserved, header or not", async () => {
    const { agg, env } = harness();
    await worker.fetch(req("/_sn/rights-signals/version", { "user-agent": BROWSER, [OWNER_AGENT_HEADER]: "forged" }), env, {});
    expect(agg).toHaveLength(0);
  });
});

describe("rights detail stream: a valid token stays out, an invalid one stays in (review round 2)", () => {
  it("code 2 stays out (self-traffic); code 3 and a headerless read go in, so a junk header cannot drop a crawler from the evidence", async () => {
    const { agg, detail, env } = harness();
    await worker.fetch(req("/license.xml", { "user-agent": CURL, [OWNER_AGENT_HEADER]: await sign("script", now() + 600) }), env, {});
    expect(agg).toHaveLength(1);
    expect(detail).toHaveLength(0);
    await worker.fetch(req("/license.xml", { "user-agent": CURL, [OWNER_AGENT_HEADER]: "forged" }), env, {});
    await worker.fetch(req("/license.xml", { "user-agent": CURL }), env, {});
    expect(agg).toHaveLength(3);
    expect(agg[1].blobs.slice(13, 15)).toEqual(["3", "0"]);
    expect(detail).toHaveLength(2);
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
    const { env, origin } = harness({ SN_OWNER_KEY: undefined });
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
    responses.push(await worker.fetch(req("/license.xml", { "user-agent": CURL }), env, {}));
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

describe("read endpoint: the aggregate view carries owner_identity and owner_agent (checkpoint 3)", () => {
  // Pinned from origin/main 39d6ca7 before this change: every other view is byte-identical.
  const SINCE = "WHERE timestamp > NOW() - INTERVAL '30' DAY ";
  const PINNED = {
    totals: "SELECT toDate(timestamp) AS day, sum(_sample_interval) AS hits FROM sn_machine_readers " + SINCE + "AND blob1 != 'webmcp' GROUP BY day ORDER BY day ASC LIMIT 92 FORMAT JSON",
    unknown: "SELECT blob8 AS user_agent, sum(_sample_interval) AS hits FROM sn_machine_readers " + SINCE + "AND blob4 = 'unknown' AND blob8 != '' GROUP BY user_agent ORDER BY hits DESC LIMIT 50 FORMAT JSON",
    unknownNetwork: "SELECT blob8 AS user_agent, blob12 AS verified_bot, blob13 AS network, sum(_sample_interval) AS hits FROM sn_machine_readers " + SINCE + "AND blob4 = 'unknown' AND blob8 != '' GROUP BY user_agent, verified_bot, network ORDER BY hits DESC LIMIT 10000 FORMAT JSON",
    rights: "SELECT blob1 AS surface, blob2 AS family, blob3 AS vendor, blob4 AS purpose, blob5 AS path, blob6 AS user_agent, blob7 AS accept, blob8 AS observed_at, sum(_sample_interval) AS hits FROM sn_machine_readers_rights " + SINCE + "GROUP BY surface, family, vendor, purpose, path, user_agent, accept, observed_at ORDER BY observed_at DESC LIMIT 500 FORMAT JSON",
  };

  it("aggregate: blob14 AS owner_identity and blob15 AS owner_agent, selected and grouped, appended after network", () => {
    expect(buildQuery("aggregate", 30)).toBe(
      "SELECT blob1 AS family, blob2 AS surface, blob3 AS vendor, blob4 AS purpose, blob5 AS taxonomy_version, blob6 AS training_corpus_source, blob7 AS first_party, blob9 AS agent, blob10 AS markdown_requested, blob11 AS signed_agent, blob12 AS verified_bot, blob13 AS network, blob14 AS owner_identity, blob15 AS owner_agent, blob16 AS vendor_verified, blob17 AS resume_format, toDate(timestamp) AS day, sum(_sample_interval) AS hits FROM sn_machine_readers " +
        SINCE +
        "GROUP BY family, surface, vendor, purpose, taxonomy_version, training_corpus_source, first_party, agent, markdown_requested, signed_agent, verified_bot, network, owner_identity, owner_agent, vendor_verified, resume_format, day ORDER BY day ASC LIMIT 10000 FORMAT JSON",
    );
  });

  it("totals, unknown (both shapes) and rights are byte-identical to before", () => {
    expect(buildQuery("totals", 30)).toBe(PINNED.totals);
    expect(buildQuery("unknown", 30)).toBe(PINNED.unknown);
    expect(buildQuery("unknown", 30, { detail: "network" })).toBe(PINNED.unknownNetwork);
    expect(buildQuery("rights", 30)).toBe(PINNED.rights);
    for (const v of ["totals", "unknown", "rights"]) expect(buildQuery(v, 30)).not.toMatch(/blob1[45]|owner_/);
  });
});
