import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index.mjs";

// 1.38.2: a browser prerender or prefetch the visitor may never see is not a
// read. Mirrors sn-analytics' check; the response is served unchanged.
const BOT = "Mozilla/5.0 (compatible; GPTBot/1.0)";

function harness() {
  const agg = [];
  const detail = [];
  const env = {
    SN_MR: { writeDataPoint: (d) => agg.push(d) },
    SN_MR_RIGHTS: { writeDataPoint: (d) => detail.push(d) },
  };
  vi.stubGlobal("fetch", vi.fn().mockImplementation(() =>
    Promise.resolve(new Response("body", { headers: { "content-type": "text/plain", "x-o": "1" } }))));
  return { agg, detail, env };
}
const req = (path, headers) => new Request(`https://juanlentino.com${path}`, { headers });

afterEach(() => vi.unstubAllGlobals());

describe("prerender and prefetch are not reads", () => {
  for (const [name, hdr] of [
    ["Sec-Purpose: prefetch;prerender", { "sec-purpose": "prefetch;prerender" }],
    ["Sec-Purpose: prefetch", { "sec-purpose": "prefetch" }],
    ["legacy Purpose: prefetch", { purpose: "prefetch" }],
  ]) {
    it(`${name} is not recorded, and the response is unchanged`, async () => {
      const { agg, detail, env } = harness();
      const plain = await worker.fetch(req("/robots.txt", { "user-agent": BOT }), harness().env, {});
      const res = await worker.fetch(req("/robots.txt", { "user-agent": BOT, ...hdr }), env, {});
      expect(agg).toHaveLength(0);
      expect(detail).toHaveLength(0);
      expect(res.status).toBe(plain.status);
      expect(await res.text()).toBe(await plain.text());
      expect([...res.headers]).toEqual([...plain.headers]);
    });
  }

  it("a normal read is still recorded", async () => {
    const { agg, env } = harness();
    await worker.fetch(req("/notes/x/", { "user-agent": BOT }), env, {});
    expect(agg).toHaveLength(1);
  });
});
