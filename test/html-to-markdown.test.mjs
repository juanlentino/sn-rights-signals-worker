import { describe, expect, it } from "vitest";
import { decodeEntities, htmlToMarkdown, safeUrl } from "../src/html-to-markdown.mjs";

// Drives the REAL HTMLRewriter in the real workerd runtime (vitest.config.mjs
// runs the Workers pool), never a DOM stub — the converter's whole behaviour
// lives in HTMLRewriter's streaming semantics, so a stubbed rewriter would be
// testing a different program.
const md = (html) => htmlToMarkdown(new Response(html, { headers: { "content-type": "text/html" } }));

describe("htmlToMarkdown", () => {
  it("lifts <title> into YAML frontmatter", async () => {
    const out = await md("<html><head><title>A Note</title></head><body><p>Hi</p></body></html>");
    expect(out.startsWith("---\ntitle: A Note\n---\n")).toBe(true);
    expect(out).toContain("Hi");
    expect(out).not.toContain("<p>");
  });

  it("converts headings by level", async () => {
    const out = await md("<body><h1>One</h1><h3>Three</h3></body>");
    expect(out).toContain("# One");
    expect(out).toContain("### Three");
  });

  it("converts links, emphasis and images", async () => {
    const out = await md(
      '<body><p>See <a href="https://x.test/a">the note</a> and <strong>this</strong> and <em>that</em>.</p>' +
        '<p><img src="/i.png" alt="a chart"></p></body>',
    );
    expect(out).toContain("[the note](https://x.test/a)");
    expect(out).toContain("**this**");
    expect(out).toContain("_that_");
    expect(out).toContain("![a chart](/i.png)");
  });

  it("numbers ordered lists and bullets unordered ones", async () => {
    const out = await md("<body><ul><li>alpha</li><li>beta</li></ul><ol><li>first</li><li>second</li></ol></body>");
    expect(out).toContain("- alpha");
    expect(out).toContain("- beta");
    expect(out).toContain("1. first");
    expect(out).toContain("2. second");
  });

  it("drops script, style and nav subtrees entirely", async () => {
    const out = await md(
      "<body><nav><a href='/x'>MENU ITEM</a></nav><script>var SECRET=1</script>" +
        "<style>.a{color:red}</style><p>real prose</p></body>",
    );
    expect(out).toContain("real prose");
    expect(out).not.toContain("MENU ITEM");
    expect(out).not.toContain("SECRET");
    expect(out).not.toContain("color:red");
  });

  // The reason header/footer are NOT in the skip list: block themes wrap the
  // post title in an <header> inside <article>.
  it("keeps an h1 that sits inside an article header", async () => {
    const out = await md("<body><article><header><h1>The Title</h1></header><p>body</p></article></body>");
    expect(out).toContain("# The Title");
  });

  it("fences pre blocks and does not double-tick code inside them", async () => {
    const out = await md("<body><pre><code>const a = 1;</code></pre></body>");
    expect(out).toContain("```");
    expect(out).toContain("const a = 1;");
    expect(out).not.toContain("`const");
  });

  it("prefixes every paragraph of a multi-paragraph blockquote", async () => {
    const out = await md("<body><blockquote><p>first para</p><p>second para</p></blockquote></body>");
    const quoted = out.split("\n").filter((l) => l.startsWith("> "));
    expect(quoted.some((l) => l.includes("first para"))).toBe(true);
    expect(quoted.some((l) => l.includes("second para"))).toBe(true);
  });

  it("collapses source whitespace instead of preserving HTML line wrapping", async () => {
    const out = await md("<body><p>one\n   two\n\tthree</p></body>");
    expect(out).toContain("one two three");
  });

  // ---- the three defects the SYNTHETIC fixtures above all missed ----------
  // Found only by converting a real /notes/ page. Every test above was green at
  // the time. Pinned here so they cannot come back silently.

  it("decodes HTML entities in prose, hrefs and the title", async () => {
    const out = await md(
      "<html><head><title>Why C2PA isn&#039;t enough</title></head>" +
        '<body><p>a &middot; b &#8599; c &amp; d &hellip;</p>' +
        '<p><a href="/verify?note=1&#038;v=2">link</a></p></body></html>',
    );
    expect(out).toContain("title: Why C2PA isn't enough");
    expect(out).toContain("a · b ↗ c & d …");
    expect(out).toContain("(/verify?note=1&v=2)");
    expect(out).not.toMatch(/&#\d+;/);
    expect(out).not.toContain("&middot;");
  });

  it("takes only the head title, never an inline <svg><title>", async () => {
    const out = await md(
      "<html><head><title>The Page</title></head><body>" +
        "<svg><title>A diagram label</title></svg><p>body</p></body></html>",
    );
    expect(out).toContain("title: The Page");
    expect(out).not.toContain("A diagram label");
  });

  it("drops skip links and visually-hidden text", async () => {
    const out = await md(
      '<body><a class="skip-link" href="#main">Skip to content</a>' +
        '<span class="screen-reader-text">for screen readers</span><p>real prose</p></body>',
    );
    expect(out).toContain("real prose");
    expect(out).not.toContain("Skip to content");
    expect(out).not.toContain("for screen readers");
  });

  it("leaves an unknown or malformed entity alone rather than corrupting it", () => {
    expect(decodeEntities("&notarealentity; &#99999999999; plain")).toBe("&notarealentity; &#99999999999; plain");
    expect(decodeEntities("&#x2197;")).toBe("↗");
    expect(decodeEntities("no ampersands here")).toBe("no ampersands here");
  });

  // CodeQL js/incomplete-url-scheme-check (high) caught the original
  // `startsWith("javascript:")` denylist. These pin the allowlist that replaced it.
  describe("URL scheme allowlist", () => {
    it.each(["javascript:alert(1)", "data:text/html;base64,PHNjcmlwdD4=", "vbscript:msgbox", "JaVaScRiPt:alert(1)", "file:///etc/passwd"])(
      "drops the dangerous scheme %s",
      (u) => expect(safeUrl(u)).toBe(""),
    );

    it.each(["https://x.test/a", "http://x.test/a", "mailto:a@b.test", "/relative/path", "../up", "//protocol-relative.test/x"])(
      "keeps the safe URL %s",
      (u) => expect(safeUrl(u)).toBe(u),
    );

    it("drops in-page anchors, which mean nothing in a standalone document", () => {
      expect(safeUrl("#section")).toBe("");
    });

    it("strips a dangerous link end to end, keeping its text", async () => {
      const out = await md('<body><p>see <a href="javascript:alert(1)">this</a> and <a href="/ok">that</a></p></body>');
      expect(out).not.toContain("javascript:");
      expect(out).toContain("this");
      expect(out).toContain("[that](/ok)");
    });

    it("drops a data: image rather than inlining a base64 blob", async () => {
      const out = await md('<body><img src="data:image/png;base64,iVBORw0KGgo=" alt="x"></body>');
      expect(out).not.toContain("base64");
    });
  });

  it("never emits three consecutive newlines", async () => {
    const out = await md("<body><div><div><p>a</p></div></div><section></section><p>b</p></body>");
    expect(/\n{3}/.test(out)).toBe(false);
  });

  // #50: a self-closing foreign element (<svg/>, or <a/>/<p/> inside an
  // <svg>/<math> subtree) has no end tag, and HTMLRewriter's onEndTag() throws
  // "No end tag" for it. That must not abort the whole conversion.
  it("survives self-closing foreign elements instead of aborting the conversion", async () => {
    const out = await md(
      "<body><p>before</p><svg/><p>middle</p>" +
        '<svg viewBox="0 0 1 1"><a href="/x"/><p/><title>icon</title></svg><p>after</p></body>',
    );
    expect(out).toContain("before");
    expect(out).toContain("middle");
    expect(out).toContain("after");
    expect(out).not.toContain("icon");
  });

  // #53: cells had no boundary, so adjacent cells fused into one token.
  it("separates table cells instead of gluing them together", async () => {
    const out = await md(
      "<body><table><tr><th>Year</th><th>Reads</th></tr><tr><td>2026</td><td>77 reads</td></tr></table></body>",
    );
    expect(out).not.toContain("202677");
    expect(out).not.toContain("YearReads");
    expect(out).toContain("2026 | 77 reads");
    expect(out).toContain("Year | Reads");
  });

  it("puts a figcaption on its own block, not glued to the image", async () => {
    const out = await md('<body><figure><img src="/i.png" alt="a chart"><figcaption>Caption</figcaption></figure><p>x</p></body>');
    expect(out).toContain("![a chart](/i.png)\n\nCaption");
  });

  // #53: entity decoding ran per text CHUNK, so an entity straddling a stream
  // chunk boundary arrived as two halves and was emitted raw.
  it("decodes an entity that straddles a stream chunk boundary", async () => {
    const chunks = ["<html><head><title>A &am", "p; B</title></head><body><p>a &am", "p; b</p><pre>x &l", "t; y</pre></body></html>"];
    const enc = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        for (const c of chunks) controller.enqueue(enc.encode(c));
        controller.close();
      },
    });
    const out = await htmlToMarkdown(new Response(stream, { headers: { "content-type": "text/html" } }));
    expect(out).toContain("title: A & B");
    expect(out).toContain("a & b");
    expect(out).toContain("x < y");
    expect(out).not.toContain("&amp;");
    expect(out).not.toContain("&lt;");
  });
});
