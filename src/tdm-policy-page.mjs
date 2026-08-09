import {
  CONTACT_URL,
  LICENSE_URL,
  POLICY_DATE,
  POLICY_STATUS,
  POLICY_VERSION,
  RIGHTSHOLDER,
  TDM_META_TAGS,
  TDM_POLICY_URL,
} from "./constants.mjs";
import {
  DRAFT_NOTICE,
  POLICY_DESCRIPTION,
  POLICY_SECTIONS,
  POLICY_TITLE,
} from "./tdm-policy-terms.mjs";

// The page shell for /tdm-policy/. Renders POLICY_SECTIONS; carries no terms of
// its own. The terms live in tdm-policy-terms.mjs so they can be reviewed as a
// document rather than as markup.
//
// Worker-synthesized rather than a WordPress page, because every rights layer
// points here: if WordPress is down, or the page is unpublished by accident,
// the URL that TDM-Policy, tdmrep.json and license.xml all name must still
// answer with terms. That is also why the styling is inline — the page must not
// depend on the theme, or on any origin fetch, to render.

const STYLES = `
:root {
  color-scheme: light dark;
  --bg: #fbfaf8; --fg: #16151a; --muted: #5d5a66; --rule: #e2ded6;
  --card: #fff; --accent: #7a3e12; --flag-bg: #fff5e6; --flag-br: #e0a458;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #131217; --fg: #eceaf2; --muted: #a29eaf; --rule: #2c2a33;
    --card: #1a191f; --accent: #e3a06a; --flag-bg: #2a2113; --flag-br: #7a5a28;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--bg); color: var(--fg);
  font: 16px/1.65 ui-serif, Charter, "Iowan Old Style", Georgia, serif;
  -webkit-text-size-adjust: 100%;
}
.wrap { max-width: 46rem; margin: 0 auto; padding: 3.5rem 1.5rem 6rem; }
h1 { font-size: clamp(1.9rem, 1.4rem + 2vw, 2.6rem); line-height: 1.15; margin: 0 0 .6rem; letter-spacing: -.02em; }
h2 { font-size: 1.28rem; margin: 3.2rem 0 .9rem; letter-spacing: -.01em; }
h3 { font-size: 1.02rem; margin: 2rem 0 .7rem; letter-spacing: .02em; text-transform: uppercase; color: var(--muted); }
p, li, dd { margin: 0 0 1rem; }
a { color: var(--accent); text-underline-offset: .18em; }
code {
  font: 500 .87em/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
  background: color-mix(in oklab, var(--fg) 7%, transparent);
  padding: .1em .34em; border-radius: 4px;
}
.meta { font-size: .82rem; color: var(--muted); letter-spacing: .01em; margin: 0 0 2rem; }
.flag {
  background: var(--flag-bg); border: 1px solid var(--flag-br); border-left-width: 4px;
  border-radius: 8px; padding: 1rem 1.15rem; margin: 0 0 2.5rem; font-size: .93rem;
  box-shadow: 0 1px 2px rgba(0,0,0,.04);
}
.flag strong { letter-spacing: .06em; font-size: .78rem; text-transform: uppercase; display: block; margin-bottom: .35rem; }
.flag p { margin: 0; }
nav.toc {
  background: var(--card); border: 1px solid var(--rule); border-radius: 10px;
  padding: 1.1rem 1.4rem .3rem; margin: 0 0 3rem; font-size: .92rem;
  box-shadow: 0 1px 3px rgba(0,0,0,.05);
}
nav.toc ol { margin: 0 0 .8rem; padding-left: 1.2rem; }
nav.toc li { margin: 0 0 .35rem; }
section { border-top: 1px solid var(--rule); padding-top: .4rem; }
dl.conds { margin: 1.4rem 0 1.6rem; }
dl.conds dt {
  font-weight: 700; margin: 1.6rem 0 .45rem; font-size: .95rem;
  letter-spacing: .01em; font-variant-numeric: tabular-nums;
}
dl.conds dd { margin: 0 0 0 1.1rem; border-left: 2px solid var(--rule); padding-left: 1rem; }
p.test { font-size: .88rem; color: var(--muted); margin: .5rem 0 0; }
p.note-label { font-size: .85rem; color: var(--muted); font-style: italic; }
table { border-collapse: collapse; width: 100%; font-size: .88rem; margin: 1.2rem 0 1.4rem; display: block; overflow-x: auto; }
th, td { text-align: left; vertical-align: top; padding: .55rem .7rem; border-bottom: 1px solid var(--rule); }
th { font-size: .76rem; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); font-weight: 600; }
footer { margin-top: 4rem; padding-top: 1.4rem; border-top: 1px solid var(--rule); font-size: .82rem; color: var(--muted); }
footer p { margin: 0 0 .5rem; }
`;

function tocHtml() {
  const items = POLICY_SECTIONS.map(
    (s) => `<li><a href="#${s.id}">${s.heading}</a></li>`,
  ).join("\n    ");
  return `<nav class="toc" aria-label="Contents">\n  <ol>\n    ${items}\n  </ol>\n</nav>`;
}

function sectionsHtml() {
  return POLICY_SECTIONS.map(
    (s) => `<section id="${s.id}">\n<h2>${s.heading}</h2>\n${s.html.trim()}\n</section>`,
  ).join("\n\n");
}

// The draft banner is rendered from POLICY_STATUS, not hardcoded — flipping the
// constant to "final" is the single edit that promotes the document, and the
// deploy check asserts the page and the constant agree.
function draftBannerHtml() {
  if (POLICY_STATUS !== "draft") return "";
  return `<div class="flag" role="note">
<strong>Draft — not final legal terms</strong>
<p>${DRAFT_NOTICE}</p>
</div>`;
}

export function tdmPolicyHtml() {
  const label = POLICY_STATUS === "draft" ? "Draft" : "In force";
  return `<!doctype html>
<!--
  ${POLICY_TITLE} — version ${POLICY_VERSION} (${POLICY_STATUS}), ${POLICY_DATE}.

  STATUS: ${POLICY_STATUS.toUpperCase()}. This document has NOT been reviewed by IP counsel.
  It is published so the machine-readable rights signals have something to point at that
  states real terms, and so counsel has a concrete draft to mark up — not as final legal
  terms. Do not cite it as settled. Promotion path: review, then flip POLICY_STATUS in
  src/constants.mjs, bump POLICY_VERSION, and timestamp the superseded text.

  Source: src/tdm-policy-terms.mjs in sn-rights-signals-worker.
-->
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${POLICY_TITLE} — juanlentino.com</title>
<meta name="description" content="${POLICY_DESCRIPTION}">
<link rel="canonical" href="${TDM_POLICY_URL}">
<link rel="license" href="${LICENSE_URL}">
${TDM_META_TAGS}
<meta name="tdm-policy-version" content="${POLICY_VERSION}">
<meta name="tdm-policy-status" content="${POLICY_STATUS}">
<style>${STYLES}</style>
</head>
<body>
<main class="wrap">

<h1>${POLICY_TITLE}</h1>
<p class="meta">${label} &middot; Version ${POLICY_VERSION} &middot; ${POLICY_DATE} &middot; ${RIGHTSHOLDER} &middot; juanlentino.com</p>

${draftBannerHtml()}

<p>This page states how this site licenses text and data mining, AI training, and retrieval access
to its content. It is the human-readable document that the site's machine-readable rights signals
point at: the <code>TDM-Policy</code> header on every response, the
<code>tdm-policy</code> field in <a href="/.well-known/tdmrep.json">tdmrep.json</a>, and the
attribution standard named in <a href="${LICENSE_URL}">license.xml</a>.</p>

<p><strong>The short version.</strong> Search and AI-assisted retrieval are free and unconditional.
Training is reserved by default, and licensed to anyone who attributes — in the output, by name and
canonical URL. The conditions are in <a href="#grant">&sect;2</a> and are written to be checkable
from the outside.</p>

${tocHtml()}

${sectionsHtml()}

<footer>
<p><strong>${POLICY_TITLE}</strong>, version ${POLICY_VERSION} (${POLICY_STATUS}), dated ${POLICY_DATE}.
Superseded versions are cryptographically timestamped; see <a href="#version">&sect;6</a>.</p>
<p>${RIGHTSHOLDER} &middot; <a href="${CONTACT_URL}">${CONTACT_URL}</a> &middot;
<a href="${LICENSE_URL}">license.xml</a> &middot;
<a href="/.well-known/tdmrep.json">tdmrep.json</a> &middot;
<a href="/robots.txt">robots.txt</a></p>
</footer>

</main>
</body>
</html>
`;
}
