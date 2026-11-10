import { describe, expect, it, vi, afterEach } from "vitest";
import worker from "../src/index.mjs";
import { htmlToMarkdown } from "../src/html-to-markdown.mjs";

vi.mock("../src/html-to-markdown.mjs", async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, htmlToMarkdown: vi.fn(real.htmlToMarkdown) };
});

const ADVERT = '<link rel="alternate" type="text/markdown" href="https://juanlentino.com/notes/a-note.md">';
const PAGE = `<html><head><title>A Note</title>${ADVERT}</head><body><article><h1>A Note</h1><p>Prose.</p></article></body></html>`;

function stubOrigin(headers = {}, body = PAGE) {
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async () =>
    new Response(body, { headers: { "content-type": "text/html", ...headers } })));
}
const get = (path, headers = {}) => worker.fetch(new Request(`https://juanlentino.com${path}`, { headers }), {});
const md = { accept: "text/markdown" };
const canonicals = (link) => (link || "").split(",").filter((l) => /rel="?canonical"?/i.test(l)).map((l) => l.trim());

afterEach(() => vi.unstubAllGlobals());

describe("negotiated Markdown names the HTML page as canonical", () => {
  it("a note gets exactly one canonical, the same one /notes/<slug>.md sends", async () => {
    stubOrigin();
    const route = canonicals((await get("/notes/a-note.md")).headers.get("link"));
    stubOrigin();
    const res = await get("/notes/a-note/?ref=feed", md);
    expect(res.headers.get("content-type")).toContain("text/markdown");
    expect(route).toEqual(['<https://juanlentino.com/notes/a-note/>; rel="canonical"']);
    expect(canonicals(res.headers.get("link"))).toEqual(route);
    expect(res.headers.get("vary")).toBe("Accept");
  });

  it("keeps the origin's own canonical and does not add a second", async () => {
    stubOrigin({ link: '<https://juanlentino.com/about/>; rel="canonical"' });
    const res = await get("/about/", md);
    expect(canonicals(res.headers.get("link"))).toEqual(['<https://juanlentino.com/about/>; rel="canonical"']);
  });

  it("preserves the origin's other Link relations", async () => {
    stubOrigin({ link: '<https://juanlentino.com/wp-json/>; rel="https://api.w.org/", <https://juanlentino.com/?p=7>; rel=shortlink' });
    const link = (await get("/notes/a-note/", md)).headers.get("link");
    expect(link).toContain('rel="https://api.w.org/"');
    expect(link).toContain("rel=shortlink");
    expect(canonicals(link)).toEqual(['<https://juanlentino.com/notes/a-note/>; rel="canonical"']);
  });

  it("sends no canonical when it is not knowable", async () => {
    stubOrigin();
    const res = await get("/about/", md);
    expect(res.headers.get("content-type")).toContain("text/markdown");
    expect(canonicals(res.headers.get("link"))).toEqual([]);
  });

  it("leaves the HTML and a failed conversion unaffected", async () => {
    stubOrigin();
    expect(canonicals((await get("/notes/a-note/")).headers.get("link"))).toEqual([]);
    htmlToMarkdown.mockRejectedValueOnce(new Error("boom"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    stubOrigin();
    const res = await get("/notes/a-note/", md);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(canonicals(res.headers.get("link"))).toEqual([]);
  });
});
