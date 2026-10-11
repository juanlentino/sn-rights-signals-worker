import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index.mjs";
import { observeMachineReader } from "../src/machine-readers.mjs";

// 1.30.0: a request carrying x-sn-first-party equal to the SN_FIRST_PARTY_TOKEN
// secret is recorded first-party (blob7 "1") whatever its user agent; the agent
// id stays the taxonomy's. The header never reaches the origin.
const HEADER = "x-sn-first-party";
const SECRET = "test-first-party-secret";
const CURL = "curl/8.7.1";

function harness(extraEnv = {}) {
  const agg = [];
  const detail = [];
  const env = {
    SN_MR: { writeDataPoint: (d) => agg.push(d) },
    SN_MR_RIGHTS: { writeDataPoint: (d) => detail.push(d) },
    SN_FIRST_PARTY_TOKEN: SECRET,
    ...extraEnv,
  };
  const origin = vi.fn().mockImplementation(() => Promise.resolve(new Response("ok", { headers: { "content-type": "text/plain" } })));
  vi.stubGlobal("fetch", origin);
  return { agg, detail, env, origin };
}

const req = (path, headers) => new Request(`https://juanlentino.com${path}`, { headers });

afterEach(() => vi.unstubAllGlobals());

describe("first-party by signed header: the flag (1.30.0)", () => {
  it("a matching header marks the row first-party and keeps the taxonomy's agent id", async () => {
    const { agg, env } = harness();
    await worker.fetch(req("/notes/x/", { "user-agent": CURL, [HEADER]: SECRET }), env, {});
    expect(agg).toHaveLength(1);
    expect(agg[0].blobs[6]).toBe("1"); // blob7 first_party
    expect(agg[0].blobs[8]).toBe("dev-curl"); // blob9 agent, unchanged
    expect(agg[0].blobs[3]).toBe("dev"); // blob4 purpose, unchanged
  });

  it("a wrong value does not", async () => {
    const { agg, env } = harness();
    await worker.fetch(req("/notes/x/", { "user-agent": CURL, [HEADER]: "not-the-secret" }), env, {});
    expect(agg[0].blobs[6]).toBe("0");
  });

  it("a missing header does not", async () => {
    const { agg, env } = harness();
    await worker.fetch(req("/notes/x/", { "user-agent": CURL }), env, {});
    expect(agg[0].blobs[6]).toBe("0");
  });

  it("an unset secret disables the feature", async () => {
    const { agg, env } = harness({ SN_FIRST_PARTY_TOKEN: undefined });
    await worker.fetch(req("/notes/x/", { "user-agent": CURL, [HEADER]: SECRET }), env, {});
    expect(agg[0].blobs[6]).toBe("0");
  });

  it("an empty secret disables it too, even against an empty header", async () => {
    const { agg, env } = harness({ SN_FIRST_PARTY_TOKEN: "" });
    await worker.fetch(req("/notes/x/", { "user-agent": CURL, [HEADER]: "" }), env, {});
    expect(agg[0].blobs[6]).toBe("0");
  });

  it("keeps the network: observation reads the request as it arrived", async () => {
    const { agg, env } = harness();
    const r = req("/notes/x/", { "user-agent": CURL, [HEADER]: SECRET });
    Object.defineProperty(r, "cf", { value: { asOrganization: "Charter Communications, Inc" } });
    await worker.fetch(r, env, {});
    expect(agg[0].blobs[12]).toBe("Charter Communications, Inc");
  });

  it("does not widen recording: a browser user agent with the header is still not recorded", async () => {
    const { agg, env } = harness();
    await worker.fetch(req("/notes/x/", { "user-agent": "Mozilla/5.0 (Macintosh) Chrome/127.0 Safari/537.36", [HEADER]: SECRET }), env, {});
    expect(agg).toHaveLength(0);
  });

  it("a first-party read of a rights file does not spend the detail stream's cap", async () => {
    const { agg, detail, env } = harness();
    await worker.fetch(req("/license.xml", { "user-agent": CURL, [HEADER]: SECRET }), env, {});
    expect(agg).toHaveLength(1);
    expect(agg[0].blobs[6]).toBe("1");
    expect(detail).toHaveLength(0);
  });

  it("observeMachineReader defaults to not first-party, so old call sites keep working", () => {
    const { agg, env } = harness();
    observeMachineReader(req("/llms.txt", { "user-agent": CURL }), env, "/llms.txt");
    observeMachineReader(req("/llms.txt", { "user-agent": CURL }), env, "/llms.txt", undefined, true);
    expect(agg.map((d) => d.blobs[6])).toEqual(["0", "1"]);
    expect(agg[1].blobs[10]).toBe("unsigned");
  });
});

describe("first-party by signed header: the header never reaches the origin (1.30.0)", () => {
  const forwarded = (origin) => origin.mock.calls[0][0];

  it("strips it on the main origin fetch", async () => {
    const { env, origin } = harness();
    await worker.fetch(req("/notes/x/", { "user-agent": CURL, [HEADER]: SECRET, accept: "text/html" }), env, {});
    expect(forwarded(origin).headers.get(HEADER)).toBeNull();
    expect(forwarded(origin).headers.get("user-agent")).toBe(CURL);
  });

  it("strips it on the admin bypass", async () => {
    const { env, origin } = harness();
    await worker.fetch(req("/wp-admin/", { [HEADER]: SECRET }), env, {});
    expect(forwarded(origin).headers.get(HEADER)).toBeNull();
  });

  it("strips it on the robots.txt origin fetch", async () => {
    const { env, origin } = harness();
    await worker.fetch(req("/robots.txt", { "user-agent": CURL, [HEADER]: SECRET }), env, {});
    expect(forwarded(origin).headers.get(HEADER)).toBeNull();
  });

  it("strips a wrong value too: an internal header has no business at the origin", async () => {
    const { env, origin } = harness({ SN_FIRST_PARTY_TOKEN: undefined });
    await worker.fetch(req("/notes/x/", { "user-agent": CURL, [HEADER]: "anything" }), env, {});
    expect(forwarded(origin).headers.get(HEADER)).toBeNull();
  });

  it("forwards the request itself, untouched, when the header is absent", async () => {
    const { env, origin } = harness();
    const r = req("/notes/x/", { "user-agent": CURL });
    await worker.fetch(r, env, {});
    expect(forwarded(origin)).toBe(r);
  });
});
