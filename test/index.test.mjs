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

describe("signature observation never blocks the response (v1.19.0)", () => {
  const aeEnv = () => ({ SN_MR: { writeDataPoint() {} }, SN_MR_RIGHTS: { writeDataPoint() {} } });

  it("observes synchronously and schedules nothing for an unsigned request", async () => {
    stubOrigin("<html><body>hi</body></html>", { "content-type": "text/html" });
    const waitUntil = vi.fn();
    await worker.fetch(
      new Request("https://juanlentino.com/notes/x", { headers: { "user-agent": "GPTBot/1.0" } }),
      aeEnv(),
      { waitUntil }
    );
    expect(waitUntil).not.toHaveBeenCalled();
  });

  // SUPERSEDED BY v1.24.0, deliberately. This assertion used to require that a
  // signed request DEFER the whole observation into waitUntil, on the v1.19.0
  // rule that no reader should wait on our telemetry to get their bytes. That
  // rule was right while the signature state was ONLY telemetry.
  //
  // Under survey item A2 the state shapes the RESPONSE — it decides whether the
  // licence offer rides these headers — so it must be known before the response
  // is composed. A licence offer computed after the bytes have gone is not an
  // offer. The verification is therefore awaited inline and nothing is deferred.
  //
  // What did NOT change is the part that protected readers: no UNSIGNED request
  // pays anything (the assertion above still holds), and observation still
  // cannot alter the body or status of any response.
  it("awaits verification inline for a signed request, deferring nothing", async () => {
    stubOrigin("<html><body>hi</body></html>", { "content-type": "text/html" });
    const waitUntil = vi.fn();
    const written = [];
    const env = { SN_MR: { writeDataPoint: (d) => written.push(d) }, SN_MR_RIGHTS: { writeDataPoint() {} } };
    const res = await worker.fetch(
      new Request("https://juanlentino.com/notes/x", {
        headers: {
          "user-agent": "GPTBot/1.0",
          signature: "sig1=:AAAA:",
          "signature-input": 'sig1=("@authority");keyid="k";tag="web-bot-auth"',
        },
      }),
      env,
      { waitUntil }
    );
    expect(waitUntil).not.toHaveBeenCalled();
    // Still observed, and the response still composed — the state moved from
    // being deferred to being awaited, it did not stop being recorded.
    expect(written).toHaveLength(1);
    expect(res.headers.get("tdm-reservation")).toBe("1");
  });

  it("still observes when no ctx is supplied, as older call sites do", async () => {
    stubOrigin("<html><body>hi</body></html>", { "content-type": "text/html" });
    const written = [];
    const env = { SN_MR: { writeDataPoint: (d) => written.push(d) }, SN_MR_RIGHTS: { writeDataPoint() {} } };
    await worker.fetch(
      new Request("https://juanlentino.com/notes/x", { headers: { "user-agent": "GPTBot/1.0" } }),
      env,
      {}
    );
    expect(written).toHaveLength(1);
  });
});

describe("WebMCP bridge (Task 4)", () => {
  it("serves the WebMCP bridge with rights headers riding it", async () => {
    // Guards against a false green: without this, the route falling through
    // to the (unstubbed) real fetch would still pass every assertion below
    // once this deploys to production — the test would keep passing even if
    // the local route were deleted.
    stubOrigin("origin fallback", { "content-type": "text/html" });
    const res = await worker.fetch(new Request("https://juanlentino.com/webmcp/bridge.js"), {});
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    // v1.5.0 rule: the reservation rides EVERY response.
    expect(res.headers.get("tdm-reservation")).toBe("1");
    expect(await res.text()).toContain("registerTool");
  });
});


// ── v1.24.0 (survey A2): the licence handshake, end to end ──────────────────
//
// licence-handshake.test.mjs pins the offer's CONTENT against the policy. This
// pins the WIRING: that a real verified request actually receives it through
// worker.fetch, and — the safety-critical half — that everything else does not.
import { signWithFixture } from "./helpers/sign-fixture.mjs";

describe("licence handshake wiring (v1.24.0)", () => {
  const aeEnv = () => ({ SN_MR: { writeDataPoint() {} }, SN_MR_RIGHTS: { writeDataPoint() {} } });

  // One stub serving BOTH hops: the agent's key directory and the origin. A
  // stub that answered only the origin would resolve every signature to
  // `unsigned` and this suite would pass while proving nothing about a verified
  // request — the failure mode where the negative tests below are the only ones
  // really running.
  function stubDirectoryAndOrigin(directory, agentOrigin) {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((input) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.startsWith(agentOrigin)) return Promise.resolve(new Response(JSON.stringify(directory)));
      return Promise.resolve(new Response("<html><body>hi</body></html>", { headers: { "content-type": "text/html" } }));
    }));
  }

  it("offers the licence to an agent that actually proved who it is", async () => {
    const agent = "https://agent-offer.test";
    const { request, directory } = await signWithFixture("https://juanlentino.com/notes/x", agent);
    stubDirectoryAndOrigin(directory, agent);
    const res = await worker.fetch(request, aeEnv(), { waitUntil: () => {} });
    expect(res.headers.get("tdm-licence-offer")).toBe("conditional");
    expect(res.headers.get("tdm-licence-agent")).toBe(agent);
    expect(res.headers.get("tdm-licence-version")).toBeTruthy();
    // The declaration still rides alongside it — the offer is an addition to
    // the reservation, never a replacement for it.
    expect(res.headers.get("tdm-reservation")).toBe("1");
  });

  // FAIL OPEN. An agent whose signature does not hold gets the response it
  // would have got before A2 existed: the declaration, and nothing keyed to it.
  it("offers nothing to a signature that does not hold", async () => {
    const agent = "https://agent-bad.test";
    const { directory } = await signWithFixture("https://juanlentino.com/notes/x", agent);
    stubDirectoryAndOrigin(directory, agent);
    const tampered = new Request("https://juanlentino.com/notes/x", {
      headers: {
        "signature-agent": `"${agent}"`,
        "signature-input": 'sig1=("@authority");keyid="nope";tag="web-bot-auth"',
        signature: "sig1=:AAAA:",
      },
    });
    const res = await worker.fetch(tampered, aeEnv(), { waitUntil: () => {} });
    expect(res.headers.get("tdm-licence-offer")).toBeNull();
    expect(res.headers.get("tdm-reservation")).toBe("1");
  });

  it("offers nothing to an ordinary unsigned crawler", async () => {
    stubOrigin("<html><body>hi</body></html>", { "content-type": "text/html" });
    const res = await worker.fetch(
      new Request("https://juanlentino.com/notes/x", { headers: { "user-agent": "GPTBot/1.0" } }),
      aeEnv(),
      { waitUntil: () => {} }
    );
    expect(res.headers.get("tdm-licence-offer")).toBeNull();
    expect(res.headers.get("tdm-reservation")).toBe("1");
  });
});
