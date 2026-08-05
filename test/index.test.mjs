import { describe, expect, it, vi, afterEach } from "vitest";
import worker from "../src/index.mjs";

function stubOrigin(body, headers = {}) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { headers })));
}

afterEach(() => vi.unstubAllGlobals());

describe("dispatcher", () => {
  it("bypasses wp-admin before touching anything else", async () => {
    stubOrigin("admin page", { "content-type": "text/html" });
    const res = await worker.fetch(new Request("https://juanlentino.com/wp-admin/edit.php"), {});
    expect(res.headers.get("tdm-reservation")).toBeNull();
    expect(await res.text()).toBe("admin page");
  });

  it("adds TDM headers to /wp-json/* while preserving origin headers and body", async () => {
    stubOrigin('{"id":1}', { "content-type": "application/json", "x-wp-total": "1" });
    const res = await worker.fetch(new Request("https://juanlentino.com/wp-json/wp/v2/posts"), {});
    expect(res.headers.get("tdm-reservation")).toBe("1");
    expect(res.headers.get("tdm-policy")).toBe("https://juanlentino.com/tdm-policy/");
    expect(res.headers.get("x-wp-total")).toBe("1");
    expect(await res.json()).toEqual({ id: 1 });
  });

  // v1.5.0 CHANGED THIS. It previously asserted that non-HTML responses got
  // no headers at all. The sensor showed that meant 18 asset reads plus the
  // feed and sitemap were being taken with no reservation attached, so the
  // headers now ride every response and only the BODY is left untouched.
  it("adds headers to non-HTML responses but never alters the body", async () => {
    stubOrigin("body{color:red}", { "content-type": "text/css" });
    const res = await worker.fetch(new Request("https://juanlentino.com/style.css"), {});
    expect(res.headers.get("tdm-reservation")).toBe("1");
    expect(await res.text()).toBe("body{color:red}");
  });

  it("adds TDM headers AND injects meta tags for text/html origin responses", async () => {
    stubOrigin("<html><head><title>x</title></head><body>hi</body></html>", { "content-type": "text/html" });
    const res = await worker.fetch(new Request("https://juanlentino.com/notes/some-post/"), {});
    expect(res.headers.get("tdm-reservation")).toBe("1");
    const text = await res.text();
    expect(text).toContain('<meta name="tdm-reservation" content="1">');
  });

  // v1.5.0: ordering is not enforceable — HTTP is client-driven and RFC 9309
  // already requires compliant crawlers to read robots.txt first. Gating
  // content on a prior robots.txt fetch would need per-client state and would
  // serve crawlers something different from humans (cloaking). The workable
  // alternative is to make ordering IRRELEVANT: attach the rights to every
  // response, so a crawler that never read robots.txt still receives the
  // reservation in the same response as the content it is taking.
  //
  // HTML is where that matters most: /wp-json is noindex and is not where a
  // scraper takes prose from, yet /wp-json was the only surface carrying
  // Content-Signal.
  describe("rights travel with every response (v1.5.0)", () => {
    it("carries Content-Signal on HTML, matching the robots.txt block verbatim", async () => {
      stubOrigin("<html><head></head><body>hi</body></html>", { "content-type": "text/html" });
      const res = await worker.fetch(new Request("https://juanlentino.com/notes/some-post/"), {});
      expect(res.headers.get("content-signal")).toBe("search=yes,ai-train=no,ai-input=yes,use=reference");
    });

    it("advertises the license with a registered RFC 8288 rel", async () => {
      stubOrigin("<html><head></head><body>hi</body></html>", { "content-type": "text/html" });
      const res = await worker.fetch(new Request("https://juanlentino.com/notes/some-post/"), {});
      expect(res.headers.get("link")).toContain('<https://juanlentino.com/license.xml>; rel="license"');
    });

    it("APPENDS Link rather than replacing the origin's own Link headers", async () => {
      stubOrigin('{"id":1}', {
        "content-type": "application/json",
        link: '<https://juanlentino.com/wp-json/>; rel="https://api.w.org/"',
      });
      const res = await worker.fetch(new Request("https://juanlentino.com/wp-json/wp/v2/posts"), {});
      const link = res.headers.get("link");
      // WordPress's REST discovery link must survive — clobbering it would
      // break API autodiscovery for every client.
      expect(link).toContain('rel="https://api.w.org/"');
      expect(link).toContain('rel="license"');
    });

    // v1.5.0, driven by the live sensor: over 30 days the declared AI-training
    // crawlers made 172 reads — 110 html, 27 robots, 18 asset, 15 wp-json,
    // 1 sitemap, 1 feed, and ZERO of the rights files. Anything the Worker
    // passes through untouched is content taken with no reservation attached,
    // and the feed carries full prose while images are copyrighted works. So
    // the reservation rides EVERY response, not just the HTML ones.
    it("carries the rights on the RSS feed (full prose, previously bare)", async () => {
      stubOrigin("<rss><channel><item>…</item></channel></rss>", { "content-type": "application/rss+xml" });
      const res = await worker.fetch(new Request("https://juanlentino.com/feed/"), {});
      expect(res.headers.get("content-signal")).toBe("search=yes,ai-train=no,ai-input=yes,use=reference");
      expect(res.headers.get("tdm-reservation")).toBe("1");
    });

    it("carries the rights on the sitemap", async () => {
      stubOrigin("<urlset></urlset>", { "content-type": "application/xml" });
      const res = await worker.fetch(new Request("https://juanlentino.com/wp-sitemap.xml"), {});
      expect(res.headers.get("content-signal")).toBe("search=yes,ai-train=no,ai-input=yes,use=reference");
    });

    it("carries the rights on images (copyrighted works, 18 reads in 30d)", async () => {
      stubOrigin("\x89PNG", { "content-type": "image/png" });
      const res = await worker.fetch(new Request("https://juanlentino.com/wp-content/uploads/x.png"), {});
      expect(res.headers.get("content-signal")).toBe("search=yes,ai-train=no,ai-input=yes,use=reference");
      expect(res.headers.get("link")).toContain('rel="license"');
    });

    it("does NOT inject meta tags into non-HTML bodies (headers only, body untouched)", async () => {
      stubOrigin("body{color:red}", { "content-type": "text/css" });
      const res = await worker.fetch(new Request("https://juanlentino.com/style.css"), {});
      expect(res.headers.get("content-signal")).toBe("search=yes,ai-train=no,ai-input=yes,use=reference");
      expect(await res.text()).toBe("body{color:red}");
    });

    it("still bypasses auth-critical paths entirely", async () => {
      stubOrigin("login", { "content-type": "text/html" });
      const res = await worker.fetch(new Request("https://juanlentino.com/wp-login.php"), {});
      expect(res.headers.get("content-signal")).toBeNull();
      expect(res.headers.get("tdm-reservation")).toBeNull();
    });
  });
});

describe("scheduled: crawler-list-sync", () => {
  it("runs the drift check and the result shows up on the status route", async () => {
    const html = "User-agent: *\nAllow: /\n\n" +
      ["Amazonbot", "Applebot-Extended", "Bytespider", "CCBot", "ClaudeBot",
        "CloudflareBrowserRenderingCrawler", "Google-Extended", "GPTBot", "meta-externalagent"]
        .map((n) => `User-agent: ${n}\nDisallow: /`).join("\n\n");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(html)));

    let captured;
    await worker.scheduled({}, {}, { waitUntil: (p) => { captured = p; } });
    await captured; // scheduled() only kicks off ctx.waitUntil — await it directly so the record lands before we assert

    const res = await worker.fetch(new Request("https://juanlentino.com/_sn/rights-signals/crawler-list-status"), {});
    const body = await res.json();
    expect(body.last_check).toMatchObject({ ok: true, drift: false });
  });
});
