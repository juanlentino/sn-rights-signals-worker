import { afterEach, describe, expect, it, vi } from "vitest";
import { buildQuery, machineReadersResponse } from "../src/machine-readers.mjs";

// 1.30.0: the unknown view carries the verified-bot category and the network
// beside each sampled user agent, so the plugin can say per sample how many
// hits Cloudflare verified and which networks sent them, in the same shape as
// its agent_networks. Pinned as a literal like the rights view's query.
const UNKNOWN_30 =
  "SELECT blob8 AS user_agent, blob12 AS verified_bot, blob13 AS network, sum(_sample_interval) AS hits " +
  "FROM sn_machine_readers " +
  "WHERE timestamp > NOW() - INTERVAL '30' DAY " +
  "AND blob4 = 'unknown' AND blob8 != '' " +
  "GROUP BY user_agent, verified_bot, network ORDER BY hits DESC LIMIT 10000 FORMAT JSON";

describe("unknown view: verification and network per sample (1.30.0)", () => {
  it("selects and groups verified_bot and network beside user_agent", () => {
    expect(buildQuery("unknown", 30)).toBe(UNKNOWN_30);
  });

  it("keeps the user_agent alias the plugin already reads", () => {
    expect(buildQuery("unknown", 30)).toContain("blob8 AS user_agent");
  });

  it("uses the same column names as the aggregate view", () => {
    const agg = buildQuery("aggregate", 30);
    for (const col of ["blob12 AS verified_bot", "blob13 AS network"]) {
      expect(agg).toContain(col);
      expect(buildQuery("unknown", 30)).toContain(col);
    }
  });
});

describe("unknown view: the response (1.30.0)", () => {
  const env = { SN_MR_READ_TOKEN: "secret", CF_ACCOUNT_ID: "acct", SN_MR_SQL_TOKEN: "sql" };
  afterEach(() => vi.unstubAllGlobals());

  it("reports the raised cap and passes the split rows through untouched", async () => {
    const rows = [
      { user_agent: "GrokBot/1.0", verified_bot: "", network: "Google LLC", hits: 3 },
      { user_agent: "GrokBot/1.0", verified_bot: "", network: "", hits: 2 },
    ];
    const spy = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: rows, rows: 2 })));
    vi.stubGlobal("fetch", spy);
    const res = await machineReadersResponse(
      new Request("https://juanlentino.com/_sn/rights-signals/machine-readers?view=unknown&days=30", {
        headers: { authorization: "Bearer secret" },
      }),
      env,
    );
    const body = await res.json();
    expect(spy.mock.calls[0][1].body).toBe(UNKNOWN_30);
    expect(body.limit).toBe(10000);
    expect(body.truncated).toBe(false);
    expect(body.data).toEqual(rows);
    // Rows split by verification and network still sum to the sample's total.
    expect(body.data.filter((r) => r.user_agent === "GrokBot/1.0").reduce((n, r) => n + r.hits, 0)).toBe(5);
  });
});
