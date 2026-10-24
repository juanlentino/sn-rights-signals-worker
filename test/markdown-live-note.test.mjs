import { describe, expect, it } from "vitest";
import { decodeEntities, htmlToMarkdown } from "../src/html-to-markdown.mjs";
// The REAL page, saved from https://juanlentino.com/notes/the-pen-is-not-the-notary/
// on 2026-10-24, untrimmed. The synthetic `.skip-link` fixture in
// html-to-markdown.test.mjs passed while every live note still opened with the
// theme's own `.sn-skip-link`, the wordmark and the footer.
import NOTE from "./fixtures/the-pen-is-not-the-notary.html?raw";

const md = (html) => htmlToMarkdown(new Response(html, { headers: { "content-type": "text/html" } }));

describe("site chrome stays out of a note's Markdown", () => {
  it("drops the skip link, the site header and the site footer", async () => {
    const out = await md(NOTE);
    expect(out).not.toContain("Skip to content");
    expect(out).not.toContain("](/)"); // the "Juan Lentino" wordmark link home
    expect(out).not.toContain("© Juan Lentino");
    expect(out).not.toContain("open.spotify.com"); // footer social links
    expect(out).not.toContain("889296100104108"); // the aria-hidden reading dial
  });

  it("begins at the note's own metadata, right after the front matter", async () => {
    const out = await md(NOTE);
    const body = out.slice(out.indexOf("\n---\n") + 5).trimStart();
    expect(out.startsWith("---\ntitle: The pen is not the notary: DAW makers and music provenance\n---\n")).toBe(true);
    expect(body.startsWith("2026.08.05\n")).toBe(true);
    expect(out.indexOf("2026.08.05")).toBeLessThan(out.indexOf("# The pen is not the notary"));
  });

  // The provenance panel sits in a `footer.wp-block-template-part` INSIDE
  // <main>; only the site-level header/footer are chrome.
  it("keeps the note's metadata and its provenance record", async () => {
    const out = await md(NOTE);
    for (const kept of [
      "Updated 2026.10.16",
      "3 min read",
      "[C2PA](https://juanlentino.com/tag/c2pa/)",
      "[Verified · v3 ↗](https://mempool.space/block/971796)",
      "[Verify](https://juanlentino.com/verify?note=77468383-8bdb-4c24-a6b0-18e62b812cdb&v=3)",
      "# The pen is not the notary",
      "Download proof (.ots)",
      "Verify it yourself",
      "## Cited by",
    ]) {
      expect(out).toContain(kept);
    }
  });

  // The /notes/ archive has no .wp-site-blocks wrapper: its header and footer
  // are direct children of <body>.
  it("drops a site header and footer that sit directly under <body>", async () => {
    const out = await md(
      '<body><a class="sn-skip-link" href="#m">Skip to content</a><header><a href="/">SITE</a></header>' +
        "<main><header><h1>Archive</h1></header><p>prose</p><footer>in-main footer</footer></main>" +
        "<footer>© SITE FOOTER</footer></body>",
    );
    expect(out).not.toContain("Skip to content");
    expect(out).not.toContain("SITE");
    expect(out).toContain("# Archive");
    expect(out).toContain("prose");
    expect(out).toContain("in-main footer");
  });
});

// The provenance panel writes `&rarr;`, which was missing from the named-entity
// table, so it reached the Markdown raw. Across 20 live pages it was the only
// entity that survived conversion.
describe("entities on the live note", () => {
  it("leaves no HTML entity in the Markdown", async () => {
    const out = await md(NOTE);
    expect(out).toContain("[See it on the public Bitcoin ledger (mempool.space) →](https://mempool.space/block/971796)");
    expect(out).not.toMatch(/&#?[a-z0-9]+;/i);
  });

  it("decodes both arrows", () => {
    expect(decodeEntities("&larr; Previous · Next &rarr;")).toBe("← Previous · Next →");
  });
});
