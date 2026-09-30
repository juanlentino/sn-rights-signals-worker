import { afterEach, describe, expect, it, vi } from "vitest";
import { buildQuery, machineReadersResponse } from "../src/machine-readers.mjs";

// 1.29.0: optional family / exclude_purpose filters on the rights view. The
// unfiltered query is pinned as a literal: the plugin (19.9.0) calls
// ?view=rights&days=N and must get the byte-identical query it always got.
const UNFILTERED_30 =
  "SELECT blob1 AS surface, blob2 AS family, blob3 AS vendor, blob4 AS purpose, " +
  "blob5 AS path, blob6 AS user_agent, blob7 AS accept, blob8 AS observed_at, " +
  "sum(_sample_interval) AS hits FROM sn_machine_readers_rights " +
  "WHERE timestamp > NOW() - INTERVAL '30' DAY " +
  "GROUP BY surface, family, vendor, purpose, path, user_agent, accept, observed_at " +
  "ORDER BY observed_at DESC LIMIT 500 FORMAT JSON";

const WHERE = "WHERE timestamp > NOW() - INTERVAL '30' DAY ";
const TAIL = "GROUP BY surface, family, vendor, purpose, path, user_agent, accept, observed_at ";

describe("rights view filter: the SQL (1.29.0)", () => {
  it("no filter is byte-identical to the pre-filter query", () => {
    expect(buildQuery("rights", 30)).toBe(UNFILTERED_30);
    expect(buildQuery("rights", 30, { family: null, exclude_purpose: [] })).toBe(UNFILTERED_30);
  });

  it("family emits one literal equality before GROUP BY", () => {
    expect(buildQuery("rights", 30, { family: "openai", exclude_purpose: [] })).toBe(
      UNFILTERED_30.replace(WHERE, WHERE + "AND blob2 = 'openai' "),
    );
  });

  it("exclude_purpose emits a literal NOT IN list before GROUP BY", () => {
    expect(buildQuery("rights", 30, { family: null, exclude_purpose: ["ops", "dev"] })).toBe(
      UNFILTERED_30.replace(WHERE, WHERE + "AND blob4 NOT IN ('ops','dev') "),
    );
  });

  it("combined: family then purpose, both ahead of GROUP BY and LIMIT", () => {
    const q = buildQuery("rights", 30, { family: "unclassified-machine", exclude_purpose: ["ops", "dev"] });
    expect(q).toBe(
      UNFILTERED_30.replace(WHERE, WHERE + "AND blob2 = 'unclassified-machine' AND blob4 NOT IN ('ops','dev') "),
    );
    expect(q.indexOf("NOT IN")).toBeLessThan(q.indexOf(TAIL));
  });

  it("buildQuery refuses an unvalidated value at the point of interpolation", () => {
    expect(() => buildQuery("rights", 30, { family: "x' OR 1=1 --" })).toThrow();
    expect(() => buildQuery("rights", 30, { exclude_purpose: ["ops');DROP"] })).toThrow();
  });
});

describe("rights view filter: the request (1.29.0)", () => {
  const env = { SN_MR_READ_TOKEN: "secret", CF_ACCOUNT_ID: "acct", SN_MR_SQL_TOKEN: "sql" };
  const get = (qs) =>
    machineReadersResponse(
      new Request(`https://juanlentino.com/_sn/rights-signals/machine-readers?${qs}`, {
        headers: { authorization: "Bearer secret" },
      }),
      env,
    );
  const stubSql = () => {
    const spy = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ hits: 1 }], rows: 1 })));
    vi.stubGlobal("fetch", spy);
    return spy;
  };
  afterEach(() => vi.unstubAllGlobals());

  const refused = [
    ["a quote", "view=rights&family=" + encodeURIComponent("openai'")],
    ["a semicolon", "view=rights&family=" + encodeURIComponent("openai;DROP")],
    ["an unknown family", "view=rights&family=notafamily"],
    ["an uppercase family", "view=rights&family=OpenAI"],
    ["an empty family", "view=rights&family="],
    ["an unknown purpose", "view=rights&exclude_purpose=ops,bogus"],
    ["a quoted purpose", "view=rights&exclude_purpose=" + encodeURIComponent("ops','x")],
    ["an empty purpose item", "view=rights&exclude_purpose=ops,,dev"],
    ["an empty exclude_purpose", "view=rights&exclude_purpose="],
    ["a filter on another view", "view=aggregate&family=openai"],
    ["a filter on the default view", "exclude_purpose=ops"],
  ];
  for (const [label, qs] of refused) {
    it(`400s on ${label}, before any SQL call`, async () => {
      const spy = stubSql();
      const res = await get(qs);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("bad_filter");
      expect(spy).not.toHaveBeenCalled();
    });
  }

  it("sends the filtered SQL and echoes the filter beside the truncation report", async () => {
    const spy = stubSql();
    const res = await get("view=rights&days=30&family=unclassified-machine&exclude_purpose=ops,dev,ops");
    expect(res.status).toBe(200);
    expect(spy.mock.calls[0][1].body).toContain("AND blob2 = 'unclassified-machine' AND blob4 NOT IN ('ops','dev') GROUP BY");
    const body = await res.json();
    expect(body.filter).toEqual({ family: "unclassified-machine", exclude_purpose: ["ops", "dev"] });
    expect(body.limit).toBe(500);
    expect(body.truncated).toBe(false);
  });

  it("an unfiltered rights read sends the pinned query and echoes an empty filter", async () => {
    const spy = stubSql();
    const body = await (await get("view=rights&days=30")).json();
    expect(spy.mock.calls[0][1].body).toBe(UNFILTERED_30);
    expect(body.filter).toEqual({ family: null, exclude_purpose: [] });
  });

  it("other views carry no filter key", async () => {
    stubSql();
    expect((await (await get("view=totals&days=30")).json()).filter).toBeUndefined();
  });
});
