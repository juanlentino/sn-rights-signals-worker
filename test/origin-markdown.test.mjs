import { describe, expect, it, vi, afterEach } from "vitest";
import worker from "../src/index.mjs";
import { originMarkdownHref } from "../src/markdown-negotiation.mjs";

// The origin can name its own Markdown for a page with a response header,
//   Link: </resume.md>; rel="alternate"; type="text/markdown"
// and an agent asking for the page with Accept: text/markdown gets that file
// instead of the generic HTML conversion. The plugin sends it on the résumé.

const PAGE = "<html><head><title>Resume</title></head><body><a href='#main'>Skip to content</a><main><h1>RESUME</h1></main></body></html>";
const MD = "---\nname: \"Juan Lentino\"\n---\n\n# Juan Lentino\n";
const LINK = '<https://juanlentino.com/resume.md>; rel="alternate"; type="text/markdown"';

function stubFetch(routes) {
  const fn = vi.fn(async (req) => {
    const url = typeof req === "string" ? req : req.url;
    const hit = routes[new URL(url).pathname];
    return hit ? hit() : new Response("nope", { status: 404, headers: { "content-type": "text/html" } });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

const page = (headers = {}) => () => new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8", ...headers } });
const md = (status = 200, type = "text/markdown; charset=utf-8") => () =>
  new Response(MD, { status, headers: { "content-type": type, "cache-control": "public, max-age=300", "x-robots-tag": "noindex" } });

const get = (accept) =>
  worker.fetch(new Request("https://juanlentino.com/resume/", { headers: accept ? { accept } : {} }), {});

afterEach(() => vi.unstubAllGlobals());

describe("the origin's own Markdown for a page", () => {
  it("serves the file the origin names instead of converting", async () => {
    const f = stubFetch({ "/resume/": page({ link: LINK }), "/resume.md": md() });
    const res = await get("text/markdown");
    expect(await res.text()).toBe(MD);
    expect(res.headers.get("content-type")).toContain("text/markdown");
    expect(res.headers.get("vary")).toContain("Accept");
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
    expect(res.headers.get("x-robots-tag")).toBe("noindex");
    expect(res.headers.get("link")).toContain("license");
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("falls back to the conversion when the named file is not Markdown", async () => {
    stubFetch({ "/resume/": page({ link: LINK }), "/resume.md": md(404) });
    const body = await (await get("text/markdown")).text();
    expect(body).toContain("RESUME");
    expect(body).not.toBe(MD);
  });

  it("falls back when the named file answers HTML", async () => {
    stubFetch({ "/resume/": page({ link: LINK }), "/resume.md": md(200, "text/html") });
    expect(await (await get("text/markdown")).text()).toContain("RESUME");
  });

  it("converts as before when the origin names nothing", async () => {
    const f = stubFetch({ "/resume/": page() });
    expect(await (await get("text/markdown")).text()).toContain("RESUME");
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("never fetches for a browser", async () => {
    const f = stubFetch({ "/resume/": page({ link: LINK }), "/resume.md": md() });
    const res = await get("text/html,application/xhtml+xml,*/*;q=0.8");
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe("originMarkdownHref", () => {
  const base = "https://juanlentino.com/resume/";
  it("reads a same-origin .md alternate from a Link list", () => {
    expect(originMarkdownHref(`<https://juanlentino.com/license.xml>; rel="license", ${LINK}`, base)).toBe("https://juanlentino.com/resume.md");
    expect(originMarkdownHref('</resume.md>; rel="alternate"; type="text/markdown"', base)).toBe("https://juanlentino.com/resume.md");
  });
  it("ignores other hosts, other types, other rels and non-.md paths", () => {
    expect(originMarkdownHref('<https://evil.test/resume.md>; rel="alternate"; type="text/markdown"', base)).toBeNull();
    expect(originMarkdownHref('</resume.md>; rel="alternate"; type="text/html"', base)).toBeNull();
    expect(originMarkdownHref('</resume.md>; rel="canonical"; type="text/markdown"', base)).toBeNull();
    expect(originMarkdownHref('</resume/?output_format=markdown>; rel="alternate"; type="text/markdown"', base)).toBeNull();
    expect(originMarkdownHref(null, base)).toBeNull();
  });
});
