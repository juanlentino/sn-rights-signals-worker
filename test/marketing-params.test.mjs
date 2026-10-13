import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index.mjs";
import { strippedForwardUrl } from "../src/marketing-params.mjs";

// 1.31.0: marketing params are removed from the URL the page passthrough
// fetches, so a tracked copy (?utm_source=rss, a share link, an ad click) reads
// the one cached page instead of being its own edge entry and a PHP miss.
const BASE = "https://juanlentino.com";
const req = (path, init = {}) => new Request(`${BASE}${path}`, init);
const strip = (path, init) => strippedForwardUrl(req(path, init));

describe("strippedForwardUrl: what is removed", () => {
  it("drops every utm_* and the named click ids", () => {
    expect(strip("/notes/x/?utm_source=rss&utm_medium=feed")).toBe(`${BASE}/notes/x/`);
    expect(strip("/?utm_anything=1")).toBe(`${BASE}/`);
    for (const k of ["fbclid", "gclid", "dclid", "msclkid", "mc_cid", "mc_eid", "ref"]) {
      expect(strip(`/notes/x/?${k}=abc`)).toBe(`${BASE}/notes/x/`);
    }
  });

  it("keeps every other param, in order, byte for byte", () => {
    expect(strip("/?utm_source=rss&sn-cache-probe=1")).toBe(`${BASE}/?sn-cache-probe=1`);
    expect(strip("/?page=2&utm_source=x&s=q")).toBe(`${BASE}/?page=2&s=q`);
    expect(strip("/?q=a%20b&utm_source=x")).toBe(`${BASE}/?q=a%20b`);
    expect(strip("/?q=a+b&flag&utm_source=x")).toBe(`${BASE}/?q=a+b&flag`);
  });

  it("drops repeated keys and keys without a value", () => {
    expect(strip("/?utm_source=a&utm_source=b")).toBe(`${BASE}/`);
    expect(strip("/?fbclid&x=1")).toBe(`${BASE}/?x=1`);
  });

  it("matches exact keys only, case-sensitive", () => {
    expect(strip("/?ref=1&ref_src=t&referrer=y")).toBe(`${BASE}/?ref_src=t&referrer=y`);
    expect(strip("/?UTM_SOURCE=x")).toBe(null);
  });

  it("keeps the fragment-free path and returns null when nothing changes", () => {
    expect(strip("/notes/x/")).toBe(null);
    expect(strip("/notes/x/?page=2")).toBe(null);
  });
});

describe("strippedForwardUrl: what is never touched", () => {
  it("only GET and HEAD", () => {
    expect(strip("/?utm_source=x", { method: "HEAD" })).toBe(`${BASE}/`);
    expect(strip("/?utm_source=x", { method: "POST", body: "a" })).toBe(null);
  });

  it("WordPress, Worker and login surfaces", () => {
    for (const p of ["/wp-json/wp/v2/posts", "/wp-admin/", "/wp-login.php", "/wp-content/x.css", "/xmlrpc.php", "/_sn/px", "/sn-login", "/sn-login/x"]) {
      expect(strip(`${p}?utm_source=x`)).toBe(null);
    }
  });

  it("files: any last segment with an extension", () => {
    for (const p of ["/llms.txt", "/sitemap.xml", "/notes/x.md", "/img/a.png"]) expect(strip(`${p}?utm_source=x`)).toBe(null);
  });

  it("previews, the customizer and REST by query", () => {
    for (const q of ["preview=true", "preview_id=5", "preview_nonce=n", "customize_changeset_uuid=u", "customize_theme=t", "customize_messenger_channel=c", "rest_route=/wp/v2"]) {
      expect(strip(`/?${q}&utm_source=x`)).toBe(null);
    }
  });

  it("a logged-in WordPress session", () => {
    expect(strip("/?utm_source=x", { headers: { cookie: "a=1; wordpress_logged_in_abc=u%7C1" } })).toBe(null);
    expect(strip("/?utm_source=x", { headers: { cookie: "wp-settings-1=x" } })).toBe(`${BASE}/`);
  });
});

describe("the page passthrough forwards the stripped URL", () => {
  afterEach(() => vi.unstubAllGlobals());
  const stub = () => {
    const origin = vi.fn().mockImplementation(() => Promise.resolve(new Response("<html><head></head></html>", { headers: { "content-type": "text/html" } })));
    vi.stubGlobal("fetch", origin);
    return origin;
  };

  it("fetches the bare URL, keeps method, headers, cf and redirect: manual", async () => {
    const origin = stub();
    const r = req("/notes/x/?utm_source=rss&utm_medium=feed", { headers: { accept: "text/html", "x-keep": "1" }, cf: { cacheTtl: 5 } });
    const res = await worker.fetch(r, {}, {});
    const sent = origin.mock.calls[0][0];
    expect(sent.url).toBe(`${BASE}/notes/x/`);
    expect(sent.method).toBe("GET");
    expect(sent.headers.get("x-keep")).toBe("1");
    expect(sent.redirect).toBe("manual");
    expect(sent.cf).toEqual({ cacheTtl: 5 });
    expect(res.headers.get("tdm-reservation")).toBe("1");
  });

  it("a request with nothing to strip is forwarded as the same object", async () => {
    const origin = stub();
    const r = req("/notes/x/?page=2");
    await worker.fetch(r, {}, {});
    expect(origin.mock.calls[0][0]).toBe(r);
  });

  it("composes with the first-party strip", async () => {
    const origin = stub();
    await worker.fetch(req("/?utm_source=x", { headers: { "x-sn-first-party": "v" } }), {}, {});
    const sent = origin.mock.calls[0][0];
    expect(sent.url).toBe(`${BASE}/`);
    expect(sent.headers.has("x-sn-first-party")).toBe(false);
  });

  it("the admin bypass is untouched", async () => {
    const origin = stub();
    const r = req("/wp-admin/?utm_source=x");
    await worker.fetch(r, {}, {});
    expect(origin.mock.calls[0][0]).toBe(r);
  });
});
