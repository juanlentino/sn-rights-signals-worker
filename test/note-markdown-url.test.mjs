import { describe, expect, it, vi, afterEach } from "vitest";
import worker from "../src/index.mjs";
import { htmlToMarkdown } from "../src/html-to-markdown.mjs";

vi.mock("../src/html-to-markdown.mjs", async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, htmlToMarkdown: vi.fn(real.htmlToMarkdown) };
});

const ADVERT = '<link rel="alternate" type="text/markdown" href="https://juanlentino.com/notes/a-note.md" title="This note as Markdown">';
const page = (head = ADVERT) =>
  `<html><head><title>A Note</title>${head}</head><body><nav><a href='/'>MENU</a></nav>` +
  "<article><header><h1>A Note</h1></header><p>Some <strong>prose</strong>.</p></article></body></html>";

function stubOrigin(body, headers = { "content-type": "text/html" }, status = 200) {
  const fn = vi.fn().mockImplementation(async () => new Response(body, { headers, status }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

const get = (path, headers = {}, method = "GET") =>
  worker.fetch(new Request(`https://juanlentino.com${path}`, { method, headers }), {});

afterEach(() => vi.unstubAllGlobals());

describe("/notes/<slug>.md, the note's Markdown at its own URL", () => {
  it("serves the same Markdown the Accept negotiation produces for the note", async () => {
    stubOrigin(page());
    const negotiated = await (await get("/notes/a-note/", { accept: "text/markdown" })).text();
    stubOrigin(page());
    const res = await get("/notes/a-note.md");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(await res.text()).toBe(negotiated);
  });

  it("names the HTML note as canonical, beside the licence link", async () => {
    stubOrigin(page());
    const res = await get("/notes/a-note.md");
    const link = res.headers.get("link");
    expect(link).toContain('<https://juanlentino.com/notes/a-note/>; rel="canonical"');
    expect(link).toContain('rel="license"');
    expect(res.headers.get("tdm-reservation")).toBe("1");
  });

  it("reads the note's HTML URL anonymously, so a session can never reach a draft", async () => {
    const fn = stubOrigin(page());
    await get("/notes/a-note.md", { cookie: "wordpress_logged_in_x=1", authorization: "Basic eA==" });
    const sent = fn.mock.calls[0][0];
    expect(sent.url).toBe("https://juanlentino.com/notes/a-note/");
    expect(sent.method).toBe("GET");
    expect(sent.headers.get("cookie")).toBeNull();
    expect(sent.headers.get("authorization")).toBeNull();
  });

  it("gives a browser the Markdown too: the URL is the representation", async () => {
    stubOrigin(page());
    const res = await get("/notes/a-note.md", { accept: "text/html,*/*;q=0.8" });
    expect(res.headers.get("content-type")).toContain("text/markdown");
  });

  // The theme's <head> advertisement is the scope gate: only a published,
  // unprotected note carries it, so /notes/tags.md (a 200 page that is not a
  // note) and a password-protected note both answer 404.
  it("answers 404 when the page does not advertise this Markdown URL", async () => {
    stubOrigin(page(""));
    const res = await get("/notes/tags.md");
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("text/plain");
  });

  it("answers 404 when the page advertises a different Markdown URL", async () => {
    stubOrigin(page());
    expect((await get("/notes/another-note.md")).status).toBe(404);
  });

  it("answers 404 for a note the origin does not serve (draft, trashed, unknown)", async () => {
    stubOrigin("<html><body>Not found</body></html>", { "content-type": "text/html" }, 404);
    expect((await get("/notes/a-draft.md")).status).toBe(404);
  });

  it("answers 404 when the origin redirects, rather than following it", async () => {
    stubOrigin("", { location: "https://juanlentino.com/notes/new-slug/" }, 301);
    expect((await get("/notes/old-slug.md")).status).toBe(404);
  });

  it("passes an origin outage through instead of calling the note gone", async () => {
    stubOrigin("down", { "content-type": "text/html" }, 503);
    expect((await get("/notes/a-note.md")).status).toBe(503);
  });

  it("never answers the .md URL with HTML when the converter fails", async () => {
    stubOrigin(page());
    htmlToMarkdown.mockImplementationOnce(async () => {
      throw new Error("converter edge case");
    });
    const res = await get("/notes/a-note.md");
    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toContain("text/plain");
  });

  it("answers HEAD with the headers and no body", async () => {
    stubOrigin(page());
    const res = await get("/notes/a-note.md", {}, "HEAD");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/markdown");
    expect(res.body).toBeNull();
  });

  it("leaves every other path alone", async () => {
    for (const path of ["/notes/a/b.md", "/notes/.md", "/a-note.md", "/notes/a-note.md/"]) {
      const fn = stubOrigin("origin", { "content-type": "text/plain" });
      const res = await get(path);
      expect(fn.mock.calls[0][0].url).toBe(`https://juanlentino.com${path}`);
      expect(await res.text()).toBe("origin");
    }
  });
});
