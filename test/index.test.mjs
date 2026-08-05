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

  it("passes non-HTML origin responses through with no header additions", async () => {
    stubOrigin("body{color:red}", { "content-type": "text/css" });
    const res = await worker.fetch(new Request("https://juanlentino.com/style.css"), {});
    expect(res.headers.get("tdm-reservation")).toBeNull();
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

    it("still adds nothing to non-HTML, non-REST assets", async () => {
      stubOrigin("body{color:red}", { "content-type": "text/css" });
      const res = await worker.fetch(new Request("https://juanlentino.com/style.css"), {});
      expect(res.headers.get("content-signal")).toBeNull();
      expect(res.headers.get("link")).toBeNull();
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
