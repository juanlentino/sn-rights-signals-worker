import { describe, expect, it } from "vitest";
import { crawlerListStatusResponse, recordCrawlerListCheck } from "../src/crawler-list-status.mjs";

describe("crawler list status", () => {
  it("surfaces the last recorded check", async () => {
    recordCrawlerListCheck({ ok: true, drift: false, checked_at: "2026-07-23T00:00:00.000Z" });
    const res = await crawlerListStatusResponse();
    const body = await res.json();
    expect(body.worker).toBe("sn-rights-signals");
    expect(body.last_check).toMatchObject({ ok: true, drift: false });
  });

  it("is null before any check has run", async () => {
    recordCrawlerListCheck(null);
    const res = await crawlerListStatusResponse();
    const body = await res.json();
    expect(body.last_check).toBeNull();
  });
});

// v1.4.1 lazy self-heal: the result lives in isolate memory (deliberate), so
// a deploy or eviction leaves the plugin pill "unchecked" until the Monday
// cron. The status endpoint now kicks ONE throttled background re-check when
// its stored result is missing, failed, or stale — answering immediately
// with the current state; the caller's next poll sees the healed result.
import { vi, afterEach } from "vitest";
import { shouldSelfHeal, _resetCrawlerListStateForTests, runAndRecordCrawlerListCheck, _setCrawlerCacheForTests } from "../src/crawler-list-status.mjs";
import { NAMED_CRAWLERS } from "../src/robots-block.mjs";

const docsHtmlFor = (names) =>
  `<p>Managed robots.txt example</p><pre>${names.map((n) => `User-agent: ${n}\nDisallow: /`).join("\n\n")}</pre>`;

afterEach(() => {
  vi.unstubAllGlobals();
  _resetCrawlerListStateForTests();
});

describe("shouldSelfHeal", () => {
  const MIN = 60 * 1000;
  it("heals when no check has ever run", () => {
    expect(shouldSelfHeal(null, 100 * MIN, 0)).toBe(true);
  });
  it("does not heal a fresh successful check", () => {
    const check = { ok: true, checked_at: new Date(Date.now() - 24 * 60 * MIN).toISOString() };
    expect(shouldSelfHeal(check, Date.now(), 0)).toBe(false);
  });
  it("heals a stale check (older than the cron cadence tolerates)", () => {
    const check = { ok: true, checked_at: new Date(Date.now() - 9 * 24 * 60 * MIN).toISOString() };
    expect(shouldSelfHeal(check, Date.now(), 0)).toBe(true);
  });
  it("heals a FAILED check even when recent — a transient docs blip must not stick for a week", () => {
    const check = { ok: false, checked_at: new Date().toISOString(), error: "docs fetch -> 503" };
    expect(shouldSelfHeal(check, Date.now() + 11 * MIN, Date.now())).toBe(true);
  });
  it("throttles: no second attempt within the per-isolate window, even with no result", () => {
    const now = 100 * MIN;
    expect(shouldSelfHeal(null, now, now - 5 * MIN)).toBe(false);
    expect(shouldSelfHeal(null, now, now - 11 * MIN)).toBe(true);
  });
  it("heals on an unparseable checked_at instead of trusting it forever", () => {
    expect(shouldSelfHeal({ ok: true, checked_at: "not-a-date" }, 100 * MIN, 0)).toBe(true);
  });
});

describe("crawler list status: lazy self-heal", () => {
  it("kicks one background check via ctx.waitUntil when empty, answers immediately, and the next read sees the result", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(docsHtmlFor(NAMED_CRAWLERS))));
    let captured = null;
    const ctx = { waitUntil: (p) => { captured = p; } };
    const res = await crawlerListStatusResponse(ctx);
    const body = await res.json();
    expect(body.last_check).toBeNull(); // never blocks the response on the check
    expect(captured).not.toBeNull();
    await captured;
    const healed = await (await crawlerListStatusResponse(ctx)).json();
    expect(healed.last_check).toMatchObject({ ok: true, drift: false });
  });
  it("does not re-kick while a fresh result stands", async () => {
    recordCrawlerListCheck({ ok: true, drift: false, checked_at: new Date().toISOString() });
    const waitUntil = vi.fn();
    await (await crawlerListStatusResponse({ waitUntil })).json();
    expect(waitUntil).not.toHaveBeenCalled();
  });
  it("survives a missing ctx (unit callers, old signatures) without healing or crashing", async () => {
    recordCrawlerListCheck(null);
    const body = await (await crawlerListStatusResponse()).json();
    expect(body.last_check).toBeNull();
  });
  it("throttles repeated reads: one attempt per window even when the check keeps failing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 503 })));
    let first = null;
    const calls = [];
    const ctx = { waitUntil: (p) => { calls.push(p); first = first ?? p; } };
    await crawlerListStatusResponse(ctx);
    await first;
    await crawlerListStatusResponse(ctx); // failed result is heal-eligible, but the throttle window has not passed
    expect(calls.length).toBe(1);
  });
});

// v1.4.3: the verdict PERSISTS across isolate eviction via the colo-local
// Cache API. The v1.4.1 design held it in isolate memory only — and the
// plugin polls once per 15 minutes, long enough for Cloudflare to evict the
// isolate between polls, so "poll -> null (heal kicks) -> isolate dies ->
// poll -> null" could repeat forever. These tests run against the REAL
// workerd Cache API (vitest-pool-workers), not stubs: stubbing the caches
// global corrupts the pool's isolated storage.
describe("crawler list status: colo-cache persistence (v1.4.3)", () => {
  // Map-backed fake with the two Cache API methods the module touches. The
  // store OUTLIVES _resetCrawlerListStateForTests' memory wipe, which is
  // exactly the isolate-eviction shape being pinned.
  const makeFakeCache = () => {
    const store = new Map();
    return {
      async match(key) { return store.has(key) ? new Response(store.get(key)) : undefined; },
      async put(key, res) { store.set(key, await res.text()); },
    };
  };

  it("the verdict survives a memory wipe (isolate eviction): a cold isolate answers from the colo cache without re-healing", async () => {
    const cache = makeFakeCache();
    _setCrawlerCacheForTests(cache);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(docsHtmlFor(NAMED_CRAWLERS))));
    await runAndRecordCrawlerListCheck();       // heal happens, writes memory + cache
    _resetCrawlerListStateForTests();           // simulate isolate eviction (memory gone, colo cache stays)
    _setCrawlerCacheForTests(cache);
    const waitUntil = vi.fn();
    const body = await (await crawlerListStatusResponse({ waitUntil })).json();
    expect(body.last_check).toMatchObject({ ok: true, drift: false });
    expect(waitUntil).not.toHaveBeenCalled();   // fresh cached verdict needs no re-heal
  });

  it("a FAILED verdict also persists, and a cold isolate re-heals from it (failed stays heal-eligible)", async () => {
    const cache = makeFakeCache();
    _setCrawlerCacheForTests(cache);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 503 })));
    await runAndRecordCrawlerListCheck();       // records + caches ok:false
    _resetCrawlerListStateForTests();
    _setCrawlerCacheForTests(cache);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(docsHtmlFor(NAMED_CRAWLERS))));
    const waitUntil = vi.fn();
    const body = await (await crawlerListStatusResponse({ waitUntil })).json();
    expect(body.last_check).toMatchObject({ ok: false }); // honest immediate answer from cache
    expect(waitUntil).toHaveBeenCalledOnce();   // and the re-check kicks
  });

  it("no cache available degrades to the v1.4.1 behavior (null + self-heal), never a fatal", async () => {
    _setCrawlerCacheForTests(null);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(docsHtmlFor(NAMED_CRAWLERS))));
    const waitUntil = vi.fn();
    const body = await (await crawlerListStatusResponse({ waitUntil })).json();
    expect(body.last_check).toBeNull();
    expect(waitUntil).toHaveBeenCalledOnce();
  });
});
