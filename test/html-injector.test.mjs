import { describe, expect, it } from "vitest";
import { injectTdmMeta } from "../src/html-injector.mjs";
import { BRIDGE_SRI, WEBMCP_SCRIPT_TAG } from "../src/webmcp-bridge.mjs";

describe("injectTdmMeta", () => {
  it("appends both meta tags into <head>", async () => {
    const html = "<html><head><title>x</title></head><body>hi</body></html>";
    const res = injectTdmMeta(new Response(html, { headers: { "content-type": "text/html" } }));
    const out = await res.text();
    expect(out).toContain('<meta name="tdm-reservation" content="1">');
    expect(out).toContain('<meta name="tdm-policy" content="https://juanlentino.com/tdm-policy/">');
    expect(out.indexOf("</head>")).toBeGreaterThan(out.indexOf('name="tdm-reservation"'));
  });

  it("appends the SRI-pinned WebMCP tag next to the TDM meta tags", async () => {
    const html = "<html><head></head><body></body></html>";
    const res = injectTdmMeta(new Response(html, { headers: { "content-type": "text/html" } }));
    const out = await res.text();
    expect(out).toContain('src="https://juanlentino.com/webmcp/bridge.js"');
    expect(out).toMatch(/integrity="sha384-[A-Za-z0-9+/=]+"/);
    expect(out.split(WEBMCP_SCRIPT_TAG).length).toBe(2);
    expect(out.indexOf("</head>")).toBeGreaterThan(out.indexOf("/webmcp/bridge.js"));
  });

  // #55: the rewritten body is longer than the origin's, and its script tag
  // changes with every bridge release. Keeping the origin's validators let a
  // client revalidate with If-None-Match, get 304, and keep a page whose SRI
  // no longer matches /webmcp/bridge.js.
  it("drops Content-Length and re-keys the ETag to the injected bridge", async () => {
    const html = "<html><head></head><body></body></html>";
    const res = injectTdmMeta(
      new Response(html, {
        headers: { "content-type": "text/html", "content-length": String(html.length), etag: '"abc123"' },
      }),
    );
    expect(res.headers.get("content-length")).toBeNull();
    const etag = res.headers.get("etag");
    expect(etag).not.toBe('"abc123"');
    expect(etag).toMatch(/^"abc123-[A-Za-z0-9+/]{8}"$/);
    expect(etag).toContain(BRIDGE_SRI.slice("sha384-".length, "sha384-".length + 8));
  });

  it("keeps a weak ETag weak and leaves a missing one missing", async () => {
    const html = "<html><head></head><body></body></html>";
    const weak = injectTdmMeta(new Response(html, { headers: { "content-type": "text/html", etag: 'W/"v1"' } }));
    expect(weak.headers.get("etag")).toMatch(/^W\/"v1-[A-Za-z0-9+/]{8}"$/);
    const none = injectTdmMeta(new Response(html, { headers: { "content-type": "text/html" } }));
    expect(none.headers.get("etag")).toBeNull();
  });

  // 1.40.1: Last-Modified is a validator too. Left on, a client revalidating
  // with If-Modified-Since alone drew a 304 and kept a page whose integrity
  // attribute no longer matched the bridge.
  it("drops Last-Modified from the rewritten page and keeps the other headers", async () => {
    const html = "<html><head></head><body></body></html>";
    const res = injectTdmMeta(
      new Response(html, { headers: { "content-type": "text/html", "last-modified": "Sat, 21 Nov 2026 00:00:00 GMT", "cache-control": "max-age=60" } }),
    );
    expect(res.headers.get("last-modified")).toBeNull();
    expect(res.headers.get("cache-control")).toBe("max-age=60");
  });
});
