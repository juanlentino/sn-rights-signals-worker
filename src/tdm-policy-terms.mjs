// The operative text of /tdm-policy/. Kept apart from the page shell
// (tdm-policy-page.mjs) so this file is reviewable as a document: everything
// here is terms, nothing here is markup plumbing.
//
// DRAFTING RULES for anyone editing this file:
//   1. Every condition must be TESTABLE — a reader must be able to look at a
//      model's output and say yes or no. "Appropriate credit" is not a
//      condition; "the author's name, verbatim, in the response" is.
//   2. Cite no statute that has not been checked. Article 4 of Directive (EU)
//      2019/790 is cited because its paragraph 3 is the reservation mechanism
//      this whole stack expresses; nothing else is cited.
//   3. Claim no enforceability. §7 says plainly what is unsettled. Deleting
//      that section is a legal change, not an editorial one.
//   4. Any change to §2 changes what a licensee already accepted — bump
//      POLICY_VERSION in constants.mjs and timestamp the superseded text.

import {
  ATTRIBUTION_STANDARD_NAME,
  ATTRIBUTION_STANDARD_URL,
  CONTACT_URL,
  LICENSE_URL,
  RIGHTSHOLDER,
  ROBOTS_URL,
  SITE_ORIGIN,
  TDMREP_URL,
  TDM_POLICY_URL,
} from "./constants.mjs";

// Section list, in document order. Each entry renders as <section id> with an
// <h2>; the page builds its table of contents from this same array, so a new
// section can never be missing from the contents.
export const POLICY_SECTIONS = [
  {
    id: "reservation",
    heading: "1. Reservation of rights",
    html: `
<p>All content published at <code>${SITE_ORIGIN}</code> — text, images, data, feeds, and the
API representations of any of them — is the copyright work of ${RIGHTSHOLDER}, except where a
work states otherwise on its face.</p>

<p><strong>The rightsholder expressly reserves the right to reproduce and extract this content for
the purposes of text and data mining.</strong> This reservation is made under Article 4(3) of
Directive (EU) 2019/790, which allows a rightsholder to reserve the text-and-data-mining exception
in Article 4(1)&ndash;(2), and which provides that for content made publicly available online the
reservation is appropriately made by machine-readable means. The machine-readable expressions of
this reservation are listed in <a href="#pointers">&sect;5</a>.</p>

<p><strong>The reservation is asserted globally</strong>, across every URL path on this site and
every representation of it, and is not limited to the European Union or to parties established
there. Outside the scope of Directive (EU) 2019/790, the same reservation is asserted as a
condition of access to this site and under whatever copyright, database, or contract law applies
to the party doing the mining.</p>

<p>The reservation is the default state of this content. Everything below is an exception the
rightsholder grants on top of it, not a limit on it.</p>`,
  },

  {
    id: "grant",
    heading: "2. Conditional licence for AI training",
    html: `
<p>Notwithstanding <a href="#reservation">&sect;1</a>, the rightsholder grants a
<strong>non-exclusive, worldwide, royalty-free licence to reproduce and extract the content of this
site for the purpose of training or fine-tuning a machine-learning model</strong>, to any party
that satisfies every condition in this section in full.</p>

<p>The conditions below are <strong>conditions precedent</strong>. The licence does not come into
effect for a party that does not meet them, and no notice, demand, or cure period is required for
that to be so. A party that meets some but not all of them holds no licence, and
<a href="#reservation">&sect;1</a> applies to it unmodified.</p>

<h3>The attribution condition</h3>

<dl class="conds">

  <dt>C1 &mdash; What must be attributed</dt>
  <dd>Attribution meeting <a href="${ATTRIBUTION_STANDARD_URL}">${ATTRIBUTION_STANDARD_NAME}</a>,
  which is incorporated here as the standard of adequate attribution and applies as though this
  content were licensed under CC BY 4.0. In substance that requires, so far as reasonably
  practicable: the author name <strong>${RIGHTSHOLDER}</strong>; a copyright notice; a URI to the
  work; a notice of these terms; and an indication if the work was modified.
  <p class="test"><em>Test:</em> the author name appears verbatim, character for character. The URI
  is an absolute <code>https://</code> URL on the <code>juanlentino.com</code> host that resolves to
  the specific work relied on &mdash; not the site root, and not a shortened, proxied, redirected,
  or tracker-wrapped form of it. The notice of terms is a link to this page.</p>
  <p class="test"><em>Why a standard rather than a bespoke definition:</em> &sect;3(a) is drafted,
  translated into dozens of languages, and widely construed. Nothing is gained by inventing a
  private definition of a term that already has a good public one.</p></dd>

  <dt>C2 &mdash; Where it must appear <span class="beyond">beyond &sect;3(a)</span></dt>
  <dd>In the model output itself, in the same response as the content it is attributing, visible to
  the end user who receives that response.
  <p class="test"><em>This condition is stricter than ${ATTRIBUTION_STANDARD_NAME}, deliberately.</em>
  &sect;3(a) asks for attribution "in any reasonable manner based on the medium, means, and context",
  which was written for republication and does not settle where credit belongs when the medium is a
  generated answer. C2 settles it for this content: in the answer. Where &sect;3(a) and C2 could both
  be satisfied by different placements, C2 governs.</p>
  <p class="test"><em>Test:</em> a user reading the response sees the attribution without taking a
  further action. Attribution carried only in a training-data manifest, a model card, a system
  prompt, a hover state, a collapsed panel, a separate "sources" page, or an aggregated corpus
  listing does not satisfy C2. Those may satisfy C3; they do not substitute for C2.</p></dd>

  <dt>C3 &mdash; Corpus-level disclosure</dt>
  <dd>The licensee publicly names <code>juanlentino.com</code> among the sources of the model's
  training data, in the documentation it publishes for that model.
  <p class="test"><em>Test:</em> a publicly reachable URL, requiring no account and no
  non-disclosure agreement, on which the string <code>juanlentino.com</code> appears as a named
  training source for the model in question.</p></dd>

  <dt>C4 &mdash; When C2 is triggered</dt>
  <dd>C2 applies to any output that reproduces, quotes, paraphrases, translates, or summarises a
  material part of a work from this site, and to any output that would not have taken the form it
  took but for that work.
  <p class="test"><em>Test:</em> if the licensee's own retrieval, attribution, or provenance
  machinery can identify a work from this site as a contributor to the output, C2 is triggered for
  that work. A licensee that has disabled or does not operate such machinery does not thereby avoid
  C2; it fails C2 for every output.</p></dd>

  <dt>C5 &mdash; Scope of the licence granted</dt>
  <dd>The licence runs to the licensee and to the specific models it trains. It is
  non-transferable and non-sublicensable.
  <p class="test"><em>Test:</em> redistributing this content as part of a corpus, dataset, index,
  or model artefact that a third party may train on is outside the licence, whether or not that
  third party would itself meet C1&ndash;C4.</p></dd>

</dl>

<p>Nothing in this section is a payment obligation. The consideration for the licence is the
attribution, and only the attribution.</p>

<h3>What this section does not license</h3>

<p class="reserved"><strong>This is not a grant of CC BY 4.0 over this content.</strong> C1
incorporates one clause of that licence &mdash; &sect;3(a), which defines adequate attribution
&mdash; and nothing else of it. CC BY 4.0 grants rights in the licensed <em>material</em> rather
than in a particular <em>use</em>, so a party accepting it would acquire far more than training
rights. No party acquires those rights here.</p>

<p>The licence in this section extends to reproduction and extraction <strong>for the purpose of
training or fine-tuning a model</strong>, and to nothing else. Reproduction, republication,
distribution, public display, translation, adaptation, and any commercial exploitation of the works
themselves &mdash; whether by a licensee, its users, or a third party &mdash; are
<strong>reserved</strong> under <a href="#reservation">&sect;1</a> and are not licensed by this
section, by C1's reference to &sect;3(a), or by any machine-readable signal this site publishes.</p>`,
  },

  {
    id: "unconditional",
    heading: "3. Permitted without condition",
    html: `
<p>The following are permitted to anyone, free of charge, with no acceptance, notice, registration,
or attribution condition attached:</p>

<ul>
  <li><strong>Search indexing</strong> &mdash; building a search index over this content and
  returning hyperlinks and short excerpts from it in search results.</li>
  <li><strong>AI-assisted retrieval and grounding</strong> (<code>ai-input</code>) &mdash; reading
  this content at query time to ground, cite, or answer from, including retrieval-augmented
  generation and AI search answers.</li>
</ul>

<p>This matches the <code>Content-Signal</code> published in
<a href="${ROBOTS_URL}">robots.txt</a> and on every HTTP response from this site:
<code>search=yes, ai-train=no, ai-input=yes</code>. The <code>ai-train=no</code> term is
<a href="#reservation">&sect;1</a>; the licence in <a href="#grant">&sect;2</a> is the route by
which it becomes yes for a given party.</p>

<p><strong>What &sect;3 does not cover.</strong> Permission to read this content at query time is
not permission to retain it. Content taken under <code>ai-input</code> may be held for as long as
the query that prompted it is being served, and may not be added to a training corpus, a
fine-tuning set, or a persistent derived store on the strength of &sect;3. Attribution is not
required by &sect;3, but a retrieval answer that reproduces a material part of a work and names no
source is a reproduction, and the reservation in &sect;1 reaches it.</p>`,
  },

  {
    id: "acceptance",
    heading: "4. Acceptance",
    html: `
<p>There are two ways to accept, and they have the same effect:</p>

<ol>
  <li><strong>By performance.</strong> Meeting every condition in <a href="#grant">&sect;2</a>
  constitutes acceptance of this policy at the version then published. No notice to the rightsholder
  is required, and none will be acknowledged. This is the intended route: the conditions are written
  to be verifiable from the outside precisely so that no negotiation is needed.</li>

  <li><strong>By notice.</strong> A party that wants the acceptance on record, or that wants terms
  this policy does not offer &mdash; a transferable licence, a corpus redistribution right, a
  commercial arrangement in place of attribution &mdash; should write via
  <a href="${CONTACT_URL}">${CONTACT_URL}</a>, stating the party, the model or programme, and the
  policy version being accepted or the departure being sought.</li>
</ol>

<p>Silence from the rightsholder is not acceptance, waiver, or a grant of anything. A licence under
<a href="#grant">&sect;2</a> arises from meeting C1&ndash;C5 and from nothing else.</p>`,
  },

  {
    id: "pointers",
    heading: "5. Machine-readable expressions",
    html: `
<p>Every layer below states the same terms. They are published together so that a machine reading
any one of them reaches the others, and so that a human reviewer can trace the whole stack.</p>

<table>
  <thead>
    <tr><th scope="col">Layer</th><th scope="col">Where</th><th scope="col">What it carries</th></tr>
  </thead>
  <tbody>
    <tr>
      <td>Content Signals</td>
      <td><a href="${ROBOTS_URL}">/robots.txt</a></td>
      <td><code>Content-Signal</code>, per-crawler <code>Disallow</code> rules, and a
      <code>License:</code> pointer to the RSL file</td>
    </tr>
    <tr>
      <td>TDMRep</td>
      <td><a href="${TDMREP_URL}">/.well-known/tdmrep.json</a></td>
      <td><code>tdm-reservation: 1</code> and <code>tdm-policy</code> pointing at this page</td>
    </tr>
    <tr>
      <td>RSL 1.0</td>
      <td><a href="${LICENSE_URL}">/license.xml</a></td>
      <td>the unconditional permits of &sect;3 and the attribution-conditioned
      <code>ai-train</code> permit of &sect;2, as two distinct licences</td>
    </tr>
    <tr>
      <td>HTTP headers</td>
      <td>every response, HTML and <code>/wp-json</code> alike</td>
      <td><code>TDM-Reservation</code>, <code>TDM-Policy</code>, <code>Content-Signal</code>, and a
      <code>Link: &lt;/license.xml&gt;; rel="license"</code></td>
    </tr>
    <tr>
      <td>Vocabulary</td>
      <td><a href="${SITE_ORIGIN}/ns/tdm">/ns/tdm</a></td>
      <td>definitions for the locally-defined <code>sn:</code> terms the machine-readable policy
      uses, each with a resolving fragment. Definitions only &mdash; nothing there grants
      anything</td>
    </tr>
    <tr>
      <td>ODRL / TDMRep</td>
      <td>this URL, requested as <code>application/ld+json</code></td>
      <td>the same permissions as a machine-readable W3C TDMRep policy: the two unconditional
      permits, and the training permit carrying an ODRL <code>attribute</code> duty</td>
    </tr>
    <tr>
      <td>HTML metadata</td>
      <td><code>&lt;head&gt;</code> of every page</td>
      <td><code>tdm-reservation</code> and <code>tdm-policy</code> meta tags</td>
    </tr>
  </tbody>
</table>

<p>Where two layers disagree, this page governs, and the disagreement is a defect &mdash; please
report it via <a href="${CONTACT_URL}">${CONTACT_URL}</a>. A deploy-time check asserts that the
layers agree; it is not infallible.</p>`,
  },

  {
    id: "version",
    heading: "6. Version, effective date, and supersession",
    html: `
<p>This policy is versioned. The version and date in force are stated in the header of this page
and repeated in the footer.</p>

<p><strong>Which version governs.</strong> A party's obligations are fixed by the version published
at the time it accepted, under <a href="#acceptance">&sect;4</a>. A later version does not
retroactively change the terms of an acceptance already performed, and does not renew one: a party
whose conduct continues under a new version is accepting that new version by performance.</p>

<p><strong>Supersession is timestamped.</strong> Versions of this policy are cryptographically
timestamped into the OpenTimestamps ledger, which anchors a hash of the document to the Bitcoin
blockchain. That anchor is the evidence of what these terms said on a given date, and is independent
of this site, of the rightsholder, and of any log either controls. Superseded versions keep their
anchors, and <strong>no version is ever silently rewritten in place</strong>: a change to the terms
produces a new version rather than an edit to a published one.</p>

<p><strong>Reads are timestamped too.</strong> From September 2026, a record is anchored in the same
ledger for each calendar month and each crawler family that read this site: which versions of this
policy and of the machine-readable reservation were in force, how many times that family fetched
them and on which days, and how much it crawled, with the share declared as training. The record
carries counts and paths, never a browser string or an address. It is evidence of what was published
and what was read while it was published; it is not a finding that any party accepted or breached
these terms.</p>

<p><strong>What the anchoring does not guarantee.</strong> Anchoring runs on a periodic sweep, not at
the moment of publication. A version that is published and superseded <em>within a single sweep
interval</em> may therefore carry no anchor of its own. Every version that is in force across a
sweep is anchored. One instance of the gap has occurred and is recorded in the
<a href="#notes">appendix</a>; it is noted there rather than left for a reader to discover by
finding an anchor missing.</p>

<p>The timestamp proves <em>when a document existed in a given form</em>. It proves nothing about
who accepted it or whether its terms are enforceable.</p>`,
  },

  {
    id: "limits",
    heading: "7. What this document does not claim",
    html: `
<p>Stated plainly, because a rights stack that overclaims is worth less than one that does not:</p>

<ul>
  <li>Whether the reservation in <a href="#reservation">&sect;1</a> binds any particular party in
  any particular jurisdiction is a question of law that this document does not settle and cannot.
  Article 4(3) provides the mechanism; it does not decide the case.</li>
  <li>No major model provider is known to honour RSL 1.0 today. <a href="${LICENSE_URL}">The licence
  file</a> is a standards bet and a statement of terms, not an enforcement mechanism.</li>
  <li>Content Signals and TDMRep are conventions honoured voluntarily. Publishing them creates a
  record of what was asked; it does not stop anyone.</li>
  <li>This document is not legal advice, and nothing in it is a waiver of any right not expressly
  licensed here. Rights not granted are reserved.</li>
</ul>`,
  },

  {
    id: "notes",
    heading: "Appendix — non-normative notes",
    html: `
<p class="note-label">The notes below are commentary. They grant nothing, restrict nothing, and
form no part of the terms above.</p>

<p><strong><code>use=reference</code> is a local extension.</strong> The
<code>Content-Signal</code> line published in <a href="${ROBOTS_URL}">robots.txt</a> and in the HTTP
headers carries a fourth term, <code>use=reference</code>, after the three standard terms
<code>search</code>, <code>ai-train</code>, and <code>ai-input</code>. <code>use</code> is
<strong>not part of the Cloudflare Content Signals vocabulary</strong>. It is published here as a
locally-defined hint that content taken under <code>ai-input</code> is expected to be referenced and
cited rather than reproduced whole, and it is
<strong>not load-bearing</strong>: nothing in this policy depends on it, and a parser that does not
recognise it loses nothing by ignoring it. The operative statement of that expectation is
<a href="#unconditional">&sect;3</a>. The same caveat is carried as a comment in robots.txt itself,
so a machine reader that never reaches this page still sees it.</p>

<p><strong>Known unanchored version: 1.0.</strong> Version 1.0 was published on 9 August 2026 and
superseded by 1.1 about twenty minutes later, inside a single sweep interval, so it carries no
OpenTimestamps anchor of its own. It differed from 1.1 in one respect: &sect;5's table of
machine-readable pointers did not yet list <code>/ns/tdm</code>. No term in
<a href="#reservation">&sect;1</a>, <a href="#grant">&sect;2</a> or <a href="#unconditional">&sect;3</a>
differed. Recorded here because an absent anchor should be explained by the document rather than
discovered by a reader who goes looking for one.</p>

<p><strong>Version 1.3.</strong> Adds one paragraph to <a href="#version">&sect;6</a> stating that
monthly read records are anchored beside the policy versions. No term in
<a href="#reservation">&sect;1</a>, <a href="#grant">&sect;2</a> or <a href="#unconditional">&sect;3</a>
differed from 1.2.</p>

<p><strong>Why a reservation and a grant in the same stack.</strong> Reading
<a href="${LICENSE_URL}">/license.xml</a> in isolation, a parser sees <code>ai-train</code>
permitted. Reading <a href="${ROBOTS_URL}">robots.txt</a> in isolation, it sees
<code>ai-train=no</code>. Both are correct and they are not in conflict: the reservation is the
default, and the licence is a conditional exception to it that only takes effect for a party meeting
<a href="#grant">&sect;2</a>. The RSL file expresses that shape directly &mdash; the unconditional
permits and the attribution-conditioned permit are two separate <code>&lt;license&gt;</code>
elements &mdash; so the two files agree even when read separately.</p>`,
  },
];

// Rendered into the page banner and asserted by the deploy check, so the
// document can never present a status its source does not declare.
//
// v1.9.0 CHANGED WHAT THIS SAYS. It previously read "pending IP counsel". The
// owner decided not to instruct counsel for now and to lean on a standard
// public licence clause instead, which is a real reduction in drafting risk —
// the definition of attribution is no longer bespoke. So the terms are in
// force, and the notice says what is actually true about them rather than
// promising a review that is not scheduled. It does NOT claim legal review.
export const STATUS_NOTICE = `These terms are in force. They are written by the rightsholder rather
than by a lawyer, and they lean deliberately on a standard public licence clause &mdash;
<a href="${ATTRIBUTION_STANDARD_URL}">${ATTRIBUTION_STANDARD_NAME}</a> &mdash; for the definition of
attribution, rather than inventing one. Nothing here is legal advice. Corrections and questions to
<a href="${CONTACT_URL}">${CONTACT_URL}</a>.`;

export const POLICY_TITLE = "Text and Data Mining Policy";
export const POLICY_DESCRIPTION =
  `How ${SITE_ORIGIN.replace("https://", "")} reserves text-and-data-mining rights, and the ` +
  `attribution condition on which it licenses AI training.`;

export { TDM_POLICY_URL };
