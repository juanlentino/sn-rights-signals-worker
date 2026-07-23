import { describe, expect, it, vi, afterEach } from "vitest";
import { checkCrawlerListDrift, parseCrawlersFromDocs } from "../src/crawler-list-sync.mjs";
import { NAMED_CRAWLERS } from "../src/robots-block.mjs";

afterEach(() => vi.unstubAllGlobals());

const docsHtmlFor = (names) =>
  `<p>Managed robots.txt example</p><pre>${names.map((n) => `User-agent: ${n}\nDisallow: /`).join("\n\n")}</pre>`;

describe("parseCrawlersFromDocs", () => {
  it("extracts every named crawler with a Disallow rule", () => {
    const html = docsHtmlFor(["GPTBot", "ClaudeBot", "CCBot"]);
    expect(parseCrawlersFromDocs(html)).toEqual(["CCBot", "ClaudeBot", "GPTBot"]);
  });

  it("excludes the wildcard User-agent block", () => {
    const html = "User-agent: *\nContent-Signal: search=yes,ai-train=no\nAllow: /\n\nUser-agent: GPTBot\nDisallow: /";
    expect(parseCrawlersFromDocs(html)).toEqual(["GPTBot"]);
  });

  it("de-dupes repeated mentions", () => {
    const html = docsHtmlFor(["GPTBot", "GPTBot"]);
    expect(parseCrawlersFromDocs(html)).toEqual(["GPTBot"]);
  });

  // Regression: the real docs page renders its example as a syntax-
  // highlighted code block, each line wrapped in its own nested <span>s —
  // verified live 2026-07-23. A naive (non-tag-stripping) regex gets 0
  // matches against this exact shape.
  it("survives syntax-highlighter markup between User-agent and Disallow lines", () => {
    const html =
      '<span class="line"><span class="tok">User-agent: GPTBot</span></span>\n' +
      '<span class="line"><span class="tok">Disallow: /</span></span>\n';
    expect(parseCrawlersFromDocs(html)).toEqual(["GPTBot"]);
  });
});

describe("checkCrawlerListDrift", () => {
  it("reports no drift when the docs list matches NAMED_CRAWLERS exactly", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(docsHtmlFor(NAMED_CRAWLERS))));
    const result = await checkCrawlerListDrift();
    expect(result.drift).toBe(false);
    expect(result.missing).toEqual([]);
    expect(result.extra).toEqual([]);
  });

  it("reports a crawler Cloudflare added that we don't have as missing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(docsHtmlFor([...NAMED_CRAWLERS, "NewAIBot"]))));
    const result = await checkCrawlerListDrift();
    expect(result.drift).toBe(true);
    expect(result.missing).toEqual(["NewAIBot"]);
    expect(result.extra).toEqual([]);
  });

  it("reports a crawler we have that Cloudflare no longer lists as extra", async () => {
    const withoutOne = NAMED_CRAWLERS.filter((c) => c !== "GPTBot");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(docsHtmlFor(withoutOne))));
    const result = await checkCrawlerListDrift();
    expect(result.drift).toBe(true);
    expect(result.extra).toEqual(["GPTBot"]);
    expect(result.missing).toEqual([]);
  });

  it("throws instead of reporting false drift when the docs page barely parses (likely redesigned)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<p>Cloudflare redesigned this page</p>")));
    await expect(checkCrawlerListDrift()).rejects.toThrow(/suspiciously few/);
  });

  it("throws on a non-ok docs fetch", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 503 })));
    await expect(checkCrawlerListDrift()).rejects.toThrow(/503/);
  });
});
