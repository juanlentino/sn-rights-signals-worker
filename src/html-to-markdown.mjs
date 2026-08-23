// HTML -> Markdown at the edge, via HTMLRewriter.
//
// WHY THIS EXISTS RATHER THAN A TOGGLE: Cloudflare's own Markdown for Agents
// does exactly this job, and this module would be deleted the day the zone
// moves to a plan that includes it (see accept-markdown.mjs — the negotiation
// semantics are already identical, so that swap is a delete, not a rewrite).
// The zone is not on that plan, and the criterion is about what the site
// ANSWERS, not about who converts.
//
// NO DEPENDENCY ON PURPOSE. HTMLRewriter is native to the runtime and streams;
// every JS html->markdown library assumes a DOM, and shipping a DOM shim into a
// Worker on the site's wildcard route to serve a minority representation is a
// bad trade against a ~150-line state machine.
//
// Fidelity is deliberately partial. Tables, footnotes and definition lists come
// through as their text. That is a considered floor, not an oversight: the
// consumer is an LLM reading prose, and a wrong table is worse than a flat one.

// Subtrees whose text is chrome or machinery, never content. `header`/`footer`
// are NOT here: in a block theme the post title sits inside an <header> within
// <article>, so skipping them by tag name loses the h1 — the single most
// valuable line on the page. Site chrome is mostly <nav>, which is skipped.
const SKIP =
  "script, style, noscript, svg, form, iframe, template, dialog, nav, button, select, textarea, " +
  // Site-specific chrome. This Worker serves exactly one site, so naming its
  // theme's classes here is precision, not coupling: skip links and
  // visually-hidden text are written FOR assistive tech and are pure noise in a
  // markdown rendering ("Skip to content" appeared twice on every real page).
  ".skip-link, .screen-reader-text";

const HEADING = /^h([1-6])$/;

// URL scheme ALLOWLIST, not a denylist.
//
// The first version of this checked `href.startsWith("javascript:")` and CodeQL
// flagged it (js/incomplete-url-scheme-check, high) for missing `data:` and
// `vbscript:`. It was right, and the fix is not "add two more strings": a
// denylist has to enumerate every dangerous scheme forever, while an allowlist
// only has to enumerate the few that are useful.
//
// This matters even though the output is markdown rather than HTML.
// `[click](data:text/html;base64,...)` is a live link in whatever eventually
// renders the markdown — converting a document does not sanitize it, it just
// moves the payload into a format someone else will render.
const SAFE_SCHEME = /^(?:https?:|mailto:)/i;
const HAS_SCHEME = /^[a-z][a-z0-9+.\-]*:/i;

export function safeUrl(raw) {
  const url = (raw || "").trim();
  if (!url) return "";
  // In-page anchors carry no meaning once the page is a standalone document.
  if (url.startsWith("#")) return "";
  // No scheme => relative (or protocol-relative) => resolves against this site.
  if (!HAS_SCHEME.test(url)) return url;
  return SAFE_SCHEME.test(url) ? url : "";
}

// HTMLRewriter does NOT entity-decode text chunks or attribute values, and a
// markdown document is not an HTML document: `isn&#039;t` is correct in HTML
// source and simply wrong in markdown, where nothing will ever decode it. Found
// against the real /notes/ pages — every synthetic fixture in the suite passed
// while live prose came through littered with numeric entities.
//
// Named entities are the small set WordPress actually emits (texturized
// punctuation plus the XML five); everything else arrives numeric and is
// handled generically below.
const NAMED = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  hellip: "…", mdash: "—", ndash: "–", middot: "·",
  lsquo: "\u2018", rsquo: "\u2019", ldquo: "\u201c", rdquo: "\u201d",
};

export function decodeEntities(input) {
  if (typeof input !== "string" || input.indexOf("&") === -1) return input;
  return input.replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]*);/gi, (whole, body) => {
    if (body[0] === "#") {
      const code =
        body[1] === "x" || body[1] === "X"
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
      // Reject non-characters rather than emitting U+FFFD: leaving the original
      // entity visible is a better failure than silently corrupting a codepoint.
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return whole;
      try {
        return String.fromCodePoint(code);
      } catch {
        return whole;
      }
    }
    const named = NAMED[body.toLowerCase()];
    return named === undefined ? whole : named;
  });
}

class Markdown {
  constructor() {
    this.parts = [];
    this.skip = 0;
    this.pre = 0;
    this.quote = 0;
    this.lists = [];
    this.title = "";
    this.inTitle = false;
    this.titleDone = false;
  }

  push(s) {
    if (this.skip === 0) this.parts.push(s);
  }

  // A block boundary. Inside a blockquote every new block re-opens the "> "
  // prefix, which is what makes a multi-paragraph quote survive streaming —
  // there is no point at which the whole quote is in hand to prefix at once.
  block() {
    this.push("\n\n" + "> ".repeat(this.quote));
  }

  indent() {
    return "  ".repeat(Math.max(0, this.lists.length - 1));
  }

  toString() {
    let out = this.parts.join("");
    out = out.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    const front = this.title ? `---\ntitle: ${this.title.replace(/\n/g, " ").trim()}\n---\n\n` : "";
    return front + out + "\n";
  }
}

function openClose(md, marker) {
  return {
    element(el) {
      md.push(marker);
      el.onEndTag(() => md.push(marker));
    },
  };
}

export function markdownRewriter(md) {
  return new HTMLRewriter()
    // Skip counting must be registered first so the depth is already raised
    // when the handlers below run for nested elements.
    .on(SKIP, {
      element(el) {
        md.skip++;
        el.onEndTag(() => {
          md.skip--;
        });
      },
    })
    // `head > title`, not `title`: an inline <svg> carries its own <title>
    // element, and a bare selector concatenated the two into one frontmatter
    // line. `titleDone` then pins the FIRST one, so nothing later can append.
    .on("head > title", {
      element(el) {
        if (md.titleDone) return;
        md.inTitle = true;
        el.onEndTag(() => {
          md.inTitle = false;
          md.titleDone = true;
        });
      },
      text(t) {
        if (md.inTitle) md.title += decodeEntities(t.text);
      },
    })
    .on("h1, h2, h3, h4, h5, h6", {
      element(el) {
        const level = Number.parseInt(HEADING.exec(el.tagName.toLowerCase())?.[1] ?? "1", 10);
        md.block();
        md.push("#".repeat(level) + " ");
        el.onEndTag(() => md.block());
      },
    })
    .on("p, div, section, article, tr, dt, dd", {
      element(el) {
        md.block();
        el.onEndTag(() => md.block());
      },
    })
    .on("blockquote", {
      element(el) {
        md.quote++;
        md.block();
        el.onEndTag(() => {
          md.quote--;
          md.block();
        });
      },
    })
    .on("ul, ol", {
      element(el) {
        md.lists.push({ ordered: el.tagName.toLowerCase() === "ol", n: 0 });
        md.block();
        el.onEndTag(() => {
          md.lists.pop();
          md.block();
        });
      },
    })
    .on("li", {
      element(el) {
        const list = md.lists[md.lists.length - 1];
        const marker = list && list.ordered ? `${++list.n}. ` : "- ";
        md.push("\n" + "> ".repeat(md.quote) + md.indent() + marker);
        el.onEndTag(() => md.push(""));
      },
    })
    .on("pre", {
      element(el) {
        md.pre++;
        md.block();
        md.push("```\n");
        el.onEndTag(() => {
          md.pre--;
          md.push("\n```");
          md.block();
        });
      },
    })
    // A <code> inside <pre> is already fenced; a second backtick pair there
    // would corrupt the block.
    .on("code", {
      element(el) {
        if (md.pre > 0) return;
        md.push("`");
        el.onEndTag(() => md.push("`"));
      },
    })
    .on("strong, b", openClose(md, "**"))
    .on("em, i", openClose(md, "_"))
    .on("a", {
      element(el) {
        const href = safeUrl(decodeEntities(el.getAttribute("href") || ""));
        if (!href) return;
        md.push("[");
        el.onEndTag(() => md.push(`](${href})`));
      },
    })
    .on("img", {
      element(el) {
        // Same allowlist for images. It also drops `data:` image URIs, which are
        // legitimate HTML but would inline a base64 blob into a document whose
        // whole purpose is to cost an agent fewer tokens than the HTML did.
        const src = safeUrl(decodeEntities(el.getAttribute("src") || ""));
        if (!src) return;
        md.push(`![${decodeEntities(el.getAttribute("alt") || "")}](${src})`);
      },
    })
    .on("br", { element() { md.push("\n"); } })
    .on("hr", { element() { md.block(); md.push("---"); md.block(); } })
    .on("*", {
      text(t) {
        if (md.inTitle) return;
        if (md.pre > 0) {
          md.push(decodeEntities(t.text));
          return;
        }
        // Collapse runs of whitespace to a single space. Newlines in source
        // HTML are formatting, not content, and preserving them would turn
        // every wrapped paragraph into a ragged list of short lines.
        const s = decodeEntities(t.text).replace(/\s+/g, " ");
        if (s.trim() === "" && s !== " ") return;
        md.push(s);
      },
    });
}

// Drives the rewriter to completion and returns the markdown. Buffers the page
// (the transformed HTML is discarded — only the handler side effects matter).
export async function htmlToMarkdown(response) {
  const md = new Markdown();
  await markdownRewriter(md).transform(response).arrayBuffer();
  return md.toString();
}
