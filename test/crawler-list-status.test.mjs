import { describe, expect, it } from "vitest";
import { crawlerListStatusResponse, recordCrawlerListCheck } from "../src/crawler-list-status.mjs";

describe("crawler list status", () => {
  it("surfaces the last recorded check", async () => {
    recordCrawlerListCheck({ ok: true, drift: false, checked_at: "2026-07-23T00:00:00.000Z" });
    const res = crawlerListStatusResponse();
    const body = await res.json();
    expect(body.worker).toBe("sn-rights-signals");
    expect(body.last_check).toMatchObject({ ok: true, drift: false });
  });

  it("is null before any check has run", async () => {
    recordCrawlerListCheck(null);
    const res = crawlerListStatusResponse();
    const body = await res.json();
    expect(body.last_check).toBeNull();
  });
});
