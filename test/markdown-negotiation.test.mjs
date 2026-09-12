import { describe, expect, it, vi, afterEach } from "vitest";
import worker from "../src/index.mjs";
import { withVaryAccept } from "../src/markdown-negotiation.mjs";
import { htmlToMarkdown } from "../src/html-to-markdown.mjs";

// The real converter by default; one test swaps in a failing one.
vi.mock("../src/html-to-markdown.mjs", async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, htmlToMarkdown: vi.fn(real.htmlToMarkdown) };
});

const PAGE =
  "<html><head><title>A Note</title></head><body><nav><a href='/'>MENU</a></nav>" +
  "<article><header><h1>A Note</h1></header><p>Some <strong>prose</strong>.</p></article></body></html>";

function stubOrigin(body, headers = {}, status = 200) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { headers, status })));
}

const CHROME =
  "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8";

const get = (accept) =>
  worker.fetch(new Request("https://juanlentino.com/notes/a-note/", { headers: accept ? { accept } : {} }), {});

afterEach(() => vi.unstubAllGlobals());

describe("markdown negotiation at the edge", () => {
  it("serves markdown when the client explicitly asks", async () => {
    stubOrigin(PAGE, { "content-type": "text/html" });
    const res = await get("text/markdown");
    expect(res.headers.get("content-type")).toContain("text/markdown");
    const body = await res.text();
    expect(body).toContain("title: A Note");
    expect(body).toContain("# A Note");
    expect(body).toContain("**prose**");
    expect(body).not.toContain("<article>");
    expect(body).not.toContain("MENU");
  });

  // The regression that would matter most: a reader gets a text dump.
  it("serves untouched HTML to a real browser", async () => {
    stubOrigin(PAGE, { "content-type": "text/html" });
    const res = await get(CHROME);
    expect(res.headers.get("content-type")).toContain("text/html");
    const body = await res.text();
    expect(body).toContain("<article>");
    expect(body).toContain('<meta name="tdm-reservation" content="1">');
  });

  it("keeps the reservation on the markdown representation too", async () => {
    stubOrigin(PAGE, { "content-type": "text/html" });
    const res = await get("text/markdown");
    // v1.5.0's rule: content taken in ANY representation is content taken.
    expect(res.headers.get("tdm-reservation")).toBe("1");
    expect(res.headers.get("tdm-policy")).toBe("https://juanlentino.com/tdm-policy/");
    expect(res.headers.get("content-signal")).toContain("ai-train=no");
    expect(res.headers.get("link")).toContain('rel="license"');
  });

  it("marks BOTH representations as varying on Accept", async () => {
    stubOrigin(PAGE, { "content-type": "text/html", vary: "Accept-Encoding" });
    const mdRes = await get("text/markdown");
    expect(mdRes.headers.get("vary")).toMatch(/accept/i);
    stubOrigin(PAGE, { "content-type": "text/html", vary: "Accept-Encoding" });
    const htmlRes = await get(CHROME);
    expect(htmlRes.headers.get("vary")).toMatch(/accept/i);
    // The origin's own Vary entry survives — it is a list header.
    expect(htmlRes.headers.get("vary")).toMatch(/accept-encoding/i);
  });

  it("does not convert non-200 pages", async () => {
    stubOrigin("<html><body><h1>Not found</h1></body></html>", { "content-type": "text/html" }, 404);
    const res = await get("text/markdown");
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  it("does not convert non-HTML responses even when markdown is requested", async () => {
    stubOrigin("body{color:red}", { "content-type": "text/css" });
    const res = await worker.fetch(
      new Request("https://juanlentino.com/style.css", { headers: { accept: "text/markdown" } }),
      {},
    );
    expect(await res.text()).toBe("body{color:red}");
    expect(res.headers.get("tdm-reservation")).toBe("1");
  });

  // #49: the fallback used to hand injectTdmMeta() the same Response whose
  // body the converter had already locked, so a converter failure became a
  // rejected fetch (1101) instead of the HTML this branch promises.
  it("falls back to the HTML when the converter fails after reading the body", async () => {
    stubOrigin(PAGE, { "content-type": "text/html" });
    htmlToMarkdown.mockImplementationOnce(async (res) => {
      await res.arrayBuffer(); // consume, then fail mid-conversion
      throw new Error("converter edge case");
    });
    const res = await get("text/markdown");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const body = await res.text();
    expect(body).toContain("<article>");
    expect(body).toContain('<meta name="tdm-reservation" content="1">');
  });

  it("never converts an admin surface, whatever the Accept header says", async () => {
    stubOrigin("<html><body>admin</body></html>", { "content-type": "text/html" });
    const res = await worker.fetch(
      new Request("https://juanlentino.com/wp-admin/edit.php", { headers: { accept: "text/markdown" } }),
      {},
    );
    expect(await res.text()).toContain("admin");
    expect(res.headers.get("content-type")).toContain("text/html");
  });
});

describe("withVaryAccept", () => {
  it("appends rather than clobbering an existing Vary", () => {
    const res = withVaryAccept(new Response("x", { headers: { vary: "Accept-Encoding" } }));
    const vary = res.headers.get("vary");
    expect(vary).toMatch(/accept-encoding/i);
    expect(vary).toMatch(/(^|[\s,])accept([\s,]|$)/i);
  });

  it("does not add a duplicate Accept entry", () => {
    const res = withVaryAccept(new Response("x", { headers: { vary: "Accept" } }));
    expect(res.headers.get("vary").toLowerCase().split(/\s*,\s*/).filter((v) => v === "accept")).toHaveLength(1);
  });
});
