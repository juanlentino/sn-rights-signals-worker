import { describe, expect, it } from "vitest";
import { parseAccept, prefersMarkdown } from "../src/accept-markdown.mjs";

describe("prefersMarkdown", () => {
  // The four rows Cloudflare's Markdown for Agents documents. Pinned as a
  // table because the whole value of matching their semantics is that agents
  // written against their behaviour work here unchanged — a drift in any row
  // is a compatibility break, not a style choice.
  it.each([
    ["text/markdown", true],
    ["text/markdown, text/html;q=0.9", true],
    ["text/*", true],
    ["*/*", false],
  ])("Accept: %s -> markdown=%s", (accept, expected) => {
    expect(prefersMarkdown(accept)).toBe(expected);
  });

  // THE SAFETY TEST. Every human visit to this site carries an Accept close to
  // this one, and every one of them flows through the same wildcard route. If
  // this assertion ever goes green-to-red, the site is serving readers a text
  // dump. Verbatim from Chrome 2026, not paraphrased.
  it("NEVER hands markdown to a real browser Accept header", () => {
    const chrome =
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8";
    expect(prefersMarkdown(chrome)).toBe(false);
  });

  it("refuses when html explicitly outranks markdown", () => {
    expect(prefersMarkdown("text/html,text/markdown;q=0.5")).toBe(false);
  });

  it("accepts when html is explicitly refused", () => {
    expect(prefersMarkdown("text/html;q=0, text/markdown;q=0.1")).toBe(true);
  });

  it("treats a zero qvalue on markdown as a refusal, not a weak yes", () => {
    expect(prefersMarkdown("text/markdown;q=0")).toBe(false);
  });

  // #54: a specific type beats a range at equal q, and an explicit refusal of
  // text/markdown is not overridden by a text/* range.
  it("lets an explicit text/html win a tie against the text/* range", () => {
    expect(prefersMarkdown("text/html, text/*")).toBe(false);
    expect(prefersMarkdown("text/*, text/html")).toBe(false);
  });

  it("honours an explicit text/markdown;q=0 even when text/* is also listed", () => {
    expect(prefersMarkdown("text/markdown;q=0, text/*")).toBe(false);
  });

  it("still lets an explicit text/markdown win a tie against text/html", () => {
    expect(prefersMarkdown("text/markdown, text/html")).toBe(true);
  });

  it("is case-insensitive on the media type", () => {
    expect(prefersMarkdown("TEXT/MARKDOWN")).toBe(true);
  });

  it("falls back to HTML on absent, empty or junk Accept", () => {
    for (const a of [null, undefined, "", "   ", ",,,", "application/json"]) {
      expect(prefersMarkdown(a)).toBe(false);
    }
  });

  it("defaults a malformed qvalue to 1 rather than dropping the entry", () => {
    // RFC 9110: an absent qvalue is 1. Discarding an unparseable entry would
    // silently change which representation wins.
    expect(parseAccept("text/markdown;q=banana")).toEqual([{ type: "text/markdown", q: 1 }]);
    expect(parseAccept("text/markdown;q=9")).toEqual([{ type: "text/markdown", q: 1 }]);
  });
});
