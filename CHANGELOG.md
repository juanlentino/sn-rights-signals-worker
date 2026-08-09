# Changelog

All notable changes to sn-rights-signals are documented here.

### 1.10.0 - 2026-08-09 — the sn: namespace resolves, and §5 stops pointing at a 404

Three loose ends from the post-deploy audit. Policy prose moves to **1.1**; see the supersession
note below for why it is a bump and not an edit.

#### New — `GET /ns/tdm`, the vocabulary behind the `sn:` prefix

The ODRL policy declares `"sn": "https://juanlentino.com/ns/tdm#"` and uses ten terms from it, and
that URI returned **404**. JSON-LD never required it to resolve, so nothing was broken — but a
published URI that does not resolve is a poor argument on a site whose whole claim is that
assertions should be checkable.

Negotiated identically to `/tdm-policy/` (HTML by default, JSON-LD on an explicit ask, `Vary:
Accept` on both), because the same clients read both for the same reason and diverging would be a
trap. Every term renders with `id="<term>"`, so the fragment the ODRL document actually uses —
`/ns/tdm#ai-train` — lands on its definition.

Each entry gives the URI, a one-line definition, and what it corresponds to in Content-Signal or in
the policy. Terms are marked **normative** or **non-normative**: `sn:conditions` governs;
`sn:attributionStandard` explicitly does not, because CC BY §3(a) alone is satisfied by a model card
and C2 is not.

**The term list is audited, not maintained by hand.** The obvious way to build it — grep the source
for `sn:` — **misses three of the ten**. `sn:search`, `sn:ai-input` and `sn:ai-train` are generated
by interpolation (`` `sn:${token}` ``) and exist as literals in no source file. So the test walks
the *emitted* ODRL document and fails if any term it finds is undefined, and the live check does the
same against the *deployed* document. A hand-maintained list under-covers silently, and the terms it
forgets are exactly the ones nobody thought about.

#### Investigated — RSL multi-value permits are conforming, and the proposed fix was not

`<permits type="usage">search ai-input</permits>` was raised as possibly non-conforming, with a
proposed split into two `<permits>` elements. **RSL 1.0 §3.5 settles it both ways.** Space
separation conforms:

> "the listed values, separated by one or more spaces, are allowed"

and, in the same section:

> "A `<license>` element MAY contain at most one `<permits>` element for each distinct value of the
> `type` attribute"

so **the remedy would itself have been non-conforming** — two `<permits type="usage">` siblings in
one `<license>` is the thing §3.5 forbids. Splitting the grant means splitting the `<license>`,
which says something different: two term sets rather than one licence covering both uses.

Left as-is, with the spec text quoted in a source comment so the next audit does not re-raise it,
plus a test asserting exactly one `<permits>` per type **and** that both tokens survive parsing. The
worry behind the item was real — a strict parser reading only the first token would silently drop
the `ai-input` grant — but that is a parser risk, and the fix for it is a conforming document with a
test, not a non-conforming one.

#### Extended — the deploy-time check §5 promises

It already existed and already ran: `scripts/rights-assertions.mjs`, static on every PR inside
`npm test`, live at deploy via `postdeploy`. **§5 was true**, so nothing was softened. It now also
asserts:

- `/ns/tdm` resolves 200 in both representations, with `Vary: Accept` on each;
- every `sn:` term the **live** ODRL document emits is defined at `/ns/tdm` **and** has a resolving
  fragment anchor — cross-repo, so a term added in one session and undocumented in another fails;
- the ODRL purposes cover **exactly** the published Content-Signal terms, no more and no fewer. A
  purpose the signal never mentions is an unannounced grant; a signal term with no purpose is a
  permission the machine document forgot.

**39 invariants, 20 mutations.** Three new mutations: an undocumented `sn:` term, `/ns/tdm` ceasing
to resolve, and an ODRL purpose robots.txt never declares.

#### Policy 1.0 → 1.1, and why it is a bump

§5 gained a row for `/ns/tdm`. At that moment the only anchored `tdm-policy` record in the ledger was
the **old placeholder page** (`rights-signals/tdm-policy/v1`, Bitcoin block 960034) — 1.0 itself had
not been swept yet, so an in-place edit was technically available.

Declined. The sweep runs hourly on the hour and anchors whatever is live when it fires, so "edit in
place" meant racing a cron for the right to rewrite a published version — the precise thing §6 was
written to prevent, dressed as a technicality. A bump costs one constant and exercises the rule the
policy states. **§1, §2 and C1–C5 are untouched.**

> **Why MINOR:** a new route and a new published document. No existing permission or value changed.

### 1.9.1 - 2026-08-09 — the deploy gate stops crying wolf

**Headline:** the v1.9.0 deploy landed correctly and `postdeploy` reported **9 of 36 failed**. The
gate was wrong, not the deploy. A gate that cries wolf is worse than no gate, because the next real
failure gets waved through by someone who has learned to re-run it.

#### Two causes, and why a bigger sleep fixes neither

`--settle 8` guessed at a duration and hoped. It was wrong twice over:

1. **Propagation is not a fixed interval.** Replaced the blind sleep with a poll of
   `/_sn/rights-signals/version` until it reports the version being shipped (`--await-version`).
   That endpoint is `cache-control: no-store`, so it flips the instant the deploy lands: the wait is
   exactly as long as it needs to be. Measured against production, **0 seconds** — the padded eight
   was pure superstition even when it worked.

2. **Edge caching outlives propagation, and version-matching alone would NOT have caught it.**
   `license.xml` and `tdmrep.json` are served `public, max-age=3600`, so a colo can hand back an
   hour-old copy long after the Worker itself has updated. That is what actually produced most of
   the nine failures. `--fresh` sends `cache-control: no-cache` so the documents are revalidated
   against the Worker instead of read out of a colo.

#### `--fresh` is deliberately not the default

Without it the tool reports **what a crawler actually receives**, cache and all — the honest thing
for a drift check to measure. With it, it reports **what the Worker is serving now** — the right
question immediately after a deploy, and the only one `postdeploy` cares about. The report header
names which mode ran (`as cached` / `revalidated`) so a reader is never guessing which question was
answered.

#### Version gating is opt-in, never inferred

npm exports `npm_package_version` to *every* script, so reading it as a default would have made a
plain `npm run check:live` exit 2 whenever `main` was ahead of production — silently converting a
drift report into a deploy gate for someone who only wanted to look. `postdeploy` passes
`--await-version $npm_package_version` explicitly, so the expectation still comes from package.json
and the number is still written exactly once.

#### Exit codes keep their meanings

A version that never goes live exits **2** (not verified), not 1 (drifted). Nothing was checked
against the expected build, and reporting that as drift would misname the fault: the stack is not
inconsistent, it is unconfirmed. `--await-timeout` bounds the wait (default 120s, generous so a slow
rollout never reads as a failure) and makes the give-up path exercisable.

#### Verified against production, both paths

- `--await-version 1.9.0 --fresh` → live in 0s, **36/36 passed**, exit 0
- `--await-version 99.0.0 --await-timeout 6` → `never reported v99.0.0 (last seen: 1.9.0)`, **exit 2**

The failure path is tested by running it, not by asserting a mock: the bug being fixed was one a
mocked clock and a mocked cache would both have missed.

> **Why PATCH:** a fix to a broken gate. The three new flags exist to serve it. Judgment call worth
> flagging — additive CLI surface has a MINOR case, but nothing a consumer of this Worker can see
> changed.

### 1.9.0 - 2026-08-09 — the attribution standard comes from Creative Commons, and the terms come into force

**Headline:** the definition of "adequate attribution" is no longer bespoke. Section 2's C1 now
incorporates **CC BY 4.0 §3(a)** — a drafted, translated, widely-construed clause, and the reference
RSL's own guide names for `payment type="attribution"`. With the riskiest piece of drafting borrowed
rather than invented, `POLICY_STATUS` moves from `draft` to `published` and the version to **1.0**.

#### What CC does and does not do here

**Incorporated as a STANDARD, not granted as a LICENCE.** This distinction is the whole position and
every layer is asserted against it:

> CC BY 4.0 grants rights in the licensed *material*, not in a particular *use*. It cannot be
> narrowed to "training only" and still be CC BY. A party accepting it would acquire reproduction,
> adaptation and commercial redistribution of whole works.

So §2 incorporates one clause and expressly reserves the rest. A new **"What this section does not
license"** block names the reserved uses — republication, distribution, public display, translation,
adaptation, commercial exploitation — rather than leaving them to inference from "everything not
granted". The policy also states in terms that it is *not* a grant of CC BY 4.0.

**C2 stays stricter than §3(a), and says so.** §3(a) asks for attribution "in any reasonable manner
based on the medium, means, and context" — written for republication, and silent on where credit
belongs when the medium is a generated answer. On its own it is satisfied by a model card. C2 is
not, and the policy states that C2 governs where the two could be met by different placements. This
is the one place borrowing CC would have *weakened* the position, so it is the one place the bespoke
condition is kept and labelled `beyond §3(a)`.

**CC Signals was the better fit and is not available.** Creative Commons' purpose-built framework —
credit, compensation, contribution — remains in development with no released text and no
machine-readable identifiers. Revisit when it ships; the promotion path is a constant, not a rewrite.

#### Where the reference appears, and where it deliberately does not

| Layer | Carries the CC reference? |
|---|---|
| policy prose (§2 C1) | **yes** — incorporated by link, with the non-grant denial beside it |
| ODRL duty | **yes**, as namespaced `sn:attributionStandard` |
| ODRL `sn:conditions` | **no** — governing conditions stay the policy URL |
| `license.xml` `<standard>` | **no** — deliberately, see below |

RSL's guide shows `<standard>https://creativecommons.org/licenses/by/4.0/</standard>` for attribution
payments, and this file does **not** follow it. §3(a) alone is satisfied by a model card and C2 is
not, so naming the CC URL as the governing standard would let a parser read the weaker half as the
whole term — a licensee could satisfy the file while failing the licence. One `<standard>`, pointing
at the complete conditions. The CC reference is published only where it cannot be mistaken for what
governs.

#### Status

`POLICY_STATUS = "published"`, `POLICY_VERSION = "1.0"`. The banner now reads *"In force —
self-drafted, not legal advice"* and says plainly that the terms are written by the rightsholder,
not a lawyer, and lean on a standard public licence clause for the part that matters most. The
HTML-comment status block says the same. **No layer claims a legal review that has not happened** —
that assertion holds in both status branches, so it cannot be lost by a future promotion.

#### Checks

One new invariant (36 total), asserting the standard-not-grant boundary across all three layers at
once: the policy incorporates §3(a) *and* denies granting CC BY; `license.xml` does **not** name CC
as its governing `<standard>`; the ODRL duty names it only under the local namespace and never in
`sn:conditions`. Three new mutations (17 total) — `license.xml` renamed to the CC URL, the non-grant
denial removed, the ODRL standard dropped — each must turn the run red.

> **Why MINOR:** the terms come into force and their scope is stated more tightly, but no permission
> is added or withdrawn. A party meeting C1–C5 held a licence before this release and holds the same
> licence after it.

### 1.8.0 - 2026-08-09 — the policy becomes machine-readable, on the same URL

**Headline:** v1.7.0 gave `/tdm-policy/` real terms. It gave them only to humans. TDMRep treats a
TDM Policy as machine-readable **only** when it is served as `application/json` or
`application/ld+json` — so the `tdm-policy` field in tdmrep.json, the `TDM-Policy` header on every
response, and the attribution `<standard>` in license.xml all resolved to a document no crawler
could act on. The reservation was machine-readable; the terms that lift it were not.

#### New — an ODRL policy in the W3C TDMRep profile

[src/tdm-policy-odrl.mjs](src/tdm-policy-odrl.mjs). Not invented here: modelled on the W3C TDMRep
techniques note and on Springer Nature's production policy at
`datasolutions.springernature.com/tdm/SNTDMPolicy.json` — same `@context` stack (ODRL + vCard +
`tdm:`), same `Offer` / `profile` / `assigner` / `permission` shape, same practice of versioning
inside the `uid` path.

**The ODRL fit is exact, which is why none of the prose had to bend.** ODRL defines a Duty as *"a
pre-condition which must be fulfilled in order to receive the Permission"* — which is precisely what
§2's C1–C5 are: conditions precedent, not covenants. So:

- `search` and `ai-input` are permissions with **no duty** — nothing is owed;
- `ai-train` is a permission carrying an `attribute` duty (ODRL's own action, *"To attribute the use
  of the Asset"*) naming the `attributedParty`.

`consequence` is deliberately absent: there is no remedial step that cures a failed condition
precedent, and modelling one would restate the grant as a covenant with a remedy.

**Purpose tokens are namespaced local terms** (`sn:ai-train`, resolvable under
`https://juanlentino.com/ns/tdm#`), because ODRL has no standard right-operand for "train a model"
versus "ground an answer". That is the `use=reference` lesson applied on the way in rather than
retrofitted: a local term that resolves to a documented URI is honest; a bare token sitting beside
standard ones is not. Likewise `sn:conditions` points at the operative prose instead of faking an
ODRL left operand for "visible to the end user in the same response" — a term no processor could
evaluate while implying it can.

#### New — content negotiation, one URL

Same `/tdm-policy/`, two representations. Not a second URL: five layers already name this one, and
a parallel `/tdm-policy.json` would be a fifth pointer to update and a fifth thing to drift.

`prefersOdrl()` is deliberately conservative — the JSON type must be named **explicitly** and must
not be outranked by `text/html`. The trap it exists for: crawlers send `Accept: */*`, so a naive
"does Accept mention json" test would hand every crawler the machine document and never the terms a
human reviewer reads. Six cases are pinned by table.

`Vary: Accept` rides **both** representations, and the check asserts it on both. Without it a shared
cache serves the JSON to a browser and the HTML to a crawler — worse than not negotiating at all.

#### Changed — the attribution standard is borrowed, not invented

C1 now defers, where it is silent, to the attribution requirements of **CC BY 4.0 §3(a)** — a
lawyer-drafted, widely-construed clause, and the reference RSL's own guide names for
`payment type="attribution"`. Scoped explicitly: it defines *adequate attribution* and nothing else.
The policy states in terms that this is **not** a grant of CC BY 4.0 over the content, which would
license reproduction, adaptation and commercial use of whole works — far beyond training.

#### Checks

Four new invariants (35 total): the ld+json representation answers with the right content-type and
profile; `Vary: Accept` on both representations; **the ODRL permissions mirror the RSL licences
exactly**; and the ODRL version and draft status match the HTML representation's meta tags, with the
`uid` versioned to match. Three new mutation tests — ai-train's duty stripped, the ODRL version
drifting from the HTML, `Vary` dropped — each must turn the run red.

The RSL-vs-ODRL mirror check is the one that earns its keep: two machine-readable expressions of one
grant, asserted against **each other**. Either drifting alone is the whole failure mode.

> **Why MINOR:** a new representation of an existing resource. No published value changed and no
> existing consumer is affected — HTML remains the default for everything that does not explicitly
> ask for JSON.

### 1.7.0 - 2026-08-09 — the policy page stops being a placeholder, and the stack starts checking itself

**Headline:** every rights layer pointed at `/tdm-policy/`, and `/tdm-policy/` said "Placeholder."
The reservation was real, the signals were live, and there was nothing at the end of the chain for
a party to read or accept. This closes that, makes `license.xml` self-consistent when read alone,
disclaims the one non-standard term, and adds a check so none of it can drift back unnoticed.

Nothing already live was changed: the headers, the `Content-Signal` value, the named-crawler blocks,
the `Link: rel="license"` and the `tdmrep.json` reservation are byte-identical to 1.6.1. The live
check below was run against production BEFORE this change and passed 26 of 31 — the 5 failures were
exactly the four defects being fixed here.

#### New — `/tdm-policy/` is an operative document

- **[src/tdm-policy-terms.mjs](src/tdm-policy-terms.mjs)** (new) holds the terms as a document,
  apart from the page shell, so counsel reviews prose and not markup. Eight sections: the Article
  4(3) reservation asserted globally; the conditional training licence; the unconditional permits;
  acceptance; the machine-readable pointer table; version and supersession; what the document does
  **not** claim; and a non-normative appendix.

- **The attribution condition is testable, not aspirational.** Five conditions precedent
  (C1–C5), each stating what is owed *and* how compliance is verified from the outside:
  the author name verbatim and the canonical URL (C1), in the output itself and visible to the end
  user (C2), corpus-level disclosure at a public URL (C3), when C2 triggers — including that a
  licensee who operates no provenance machinery fails C2 for every output rather than escaping it
  (C4), and non-transferability (C5). Failure of any one means no licence, with no cure period:
  they are conditions precedent, not covenants.

- **Marked as a draft in three places** — an HTML comment, a `tdm-policy-status` meta tag, and a
  rendered banner — all driven by one `POLICY_STATUS` constant, so promotion after counsel's review
  is a one-line edit that cannot leave a stale banner behind. §7 states plainly what is unsettled:
  Article 4(3) supplies the mechanism, it does not decide the case; no major provider honours RSL
  today; Content Signals are honoured voluntarily.

#### Fixed — `license.xml` no longer reads as a naked grant to train

A parser reading only `/license.xml` — the normal case, since robots.txt points at it with a
`License:` line — saw `<permits type="usage">ai-train</permits>` and nothing else. The
`ai-train=no` reservation the grant is an exception *to* lived in robots.txt, in the headers, and on
the policy page, but not in the file itself. Correct as one layer of a stack; wrong as the
standalone document most machines will actually read.

Fixed in RSL's own grammar rather than in prose. §3.4 permits multiple `<license>` elements per
`<content>`, so the two tiers are now two licences: `search ai-input` under `<payment type="free"/>`,
and `ai-train` under `<payment type="attribution">` naming the policy as its `<standard>`. Plus
`<copyright type="person">` and `<terms>` so the file names its own rightsholder and human terms.
No `<content server=…>` — the owner is not joining the RSL Collective, and an unreachable license
server would be worse than none. Validated well-formed with `xmllint`, independently of the reader
this repo ships.

#### Fixed — `use=reference` is disclaimed where a machine will meet it

`use` is not in the Cloudflare Content Signals vocabulary. It was listed in robots.txt alongside
`search`, `ai-train` and `ai-input` as though it were, which is the actual defect — not its
presence. The term is kept; it now sits under its own `NON-NORMATIVE LOCAL EXTENSION` block stating
that it is locally defined, that nothing depends on it, and that a parser may ignore it without
loss. The same caveat appears in the policy appendix for human readers.

#### New — a deploy check that fails loud on drift

- **[scripts/rights-assertions.mjs](scripts/rights-assertions.mjs)** — 31 invariants over all four
  layers, run from two artifact sources:
  - **static**, on every PR, inside the existing `npm test` job
    ([test/rights-consistency.test.mjs](test/rights-consistency.test.mjs)) — drives the real Worker
    over a stubbed origin, so the header wrap, the HTMLRewriter injection and the robots composition
    all really run;
  - **live**, at deploy, via `postdeploy` in package.json
    ([scripts/check-rights-signals.mjs](scripts/check-rights-signals.mjs)).

- **The assertions compare layers against each other**, not each against the constant that produced
  it. `tdmrep.json`'s policy URL is asserted equal to the `TDM-Policy` *header*; robots.txt's
  `Content-Signal` equal to the *header* value byte for byte. A guard built from the same constant
  as the thing it guards can only catch a typo — it cannot catch a partial deploy, which is the
  failure that actually happens.

- **`license.xml` is really parsed** ([scripts/mini-xml.mjs](scripts/mini-xml.mjs), strict,
  dependency-free — neither Node nor workerd has a DOM parser). The old test asserted
  `RSL_XML.toContain('<permits type="usage">ai-train</permits>')`, which stayed green for the entire
  life of the defect it was meant to guard: a naked grant contains that substring exactly as happily
  as a conditioned one. Structural assertions replace it, including one that fails if `all` or
  `ai-all` ever re-grants training through a superset token.

- **Eleven mutation tests assert the checker can fail.** Each flips a real regression — reservation
  to 0, the two licences merged back into one, a second `Content-Signal` line, a crawler quietly
  un-blocked, the extension notice removed, the `Link` header clobbering WordPress's own entries —
  and each must turn the run red. A guard that cannot fail is decoration.

- **Exit 2 means "could not run"**, distinct from exit 1 "drifted". Unreachable is not consistent
  and must never be read as a pass.

#### Notes

- **CI adds no job.** The static check is a step in the existing `test` job and the live check is a
  gated step in that same job (`workflow_dispatch` only). Actions bills per job rounded up, so a
  second job for a four-second check would cost a whole extra minute on every run.
- **Timestamping needs no new work.** `sn-provenance-worker` already fetches and OTS-anchors all
  four rights surfaces hourly, content-hash de-duplicated and versioned. Deploying this produces
  `tdm-policy/v2`, `license-xml/v2` and `robots-txt/v3` in the ledger on the next sweep, with no
  manual step. Verify after deploy rather than assuming.

> **Why MINOR:** new user-visible capability (a real policy document where a placeholder stood) with
> no breaking change to any published signal value.

### 1.6.1 - 2026-08-08

- **Fix (lost Sitemap pointer):** the composed robots.txt now GUARANTEES a
  `Sitemap:` line (idempotent — appended only when no source provides one).
  The regression: this Worker owns /robots.txt and appends the origin's
  contribution, but a physical robots.txt file on the host's disk bypasses
  WordPress's virtual robots entirely — so neither WP core's Sitemap line nor
  the plugin's idempotent pointer ever ran, the origin contributed a bare
  `Disallow: /tools/`, and the pointer vanished from the internet until
  Search Console dropped the sitemap. The Worker owns the route, so it now
  owns the guarantee: the pointer survives ANY origin state (virtual robots,
  physical file, or the 4xx empty-tail fallback). Why the edge never noticed:
  sitemap discovery is a crawler-side behavior — nothing this Worker measures
  could see it; Search Console was the only instrument that could, and did.

## Known: 2 dev-only advisories, deliberately not fixed (re-evaluated 2026-08-05)

`@cloudflare/vitest-pool-workers@0.9.x` bundles its own `wrangler` in a vulnerable range. The advisory is **OS command injection in `wrangler pages deploy`** — a command this repo never runs; it deploys a Worker, not Pages, via `npm run deploy`. Dev-only, never in the bundle.

Four fixes were attempted and all fail cleanly rather than silently:

1. a top-level `wrangler` override → npm `EOVERRIDE` (conflicts with the direct devDependency)
2. a nested override under `@cloudflare/vitest-pool-workers` → accepted but does not take effect
3. the same nested override with the parent version pinned → `EOVERRIDE` again
4. bumping the pool alone → npm rejects it as invalid against `vitest@3`

The fifth **does** work and was tried in full: `vitest@^4.1.0` + `@cloudflare/vitest-pool-workers@^0.20.1` resolves to **0 vulnerabilities**. It requires migrating `vitest.config.mjs` off the removed `defineWorkersConfig` / `./config` export to the `cloudflareTest()` plugin form (shape taken from the package's own `codemods/vitest-v3-to-v4`). With that migration applied, **76 of 78 tests pass** — the two failures are both in the crawler-list self-heal group (`survives a missing ctx`, `throttles repeated reads`), and both indicate the 0.20 pool **reuses isolates**, so module-level state that the old pool reset between cases now persists.

Those two assertions guard the self-heal and throttle behavior of the Worker that owns the site's rights surface. Making them pass means changing their isolation assumptions, which is a change that deserves review on its own rather than riding along as collateral of an advisory cleanup. Parked with that evidence rather than forced.

## [1.6.0] - 2026-08-07

**Headline:** the machine-readership sensor can now prove it is alive, so a quiet `sn_machine_readers` dataset stops being ambiguous between "no crawlers came" and "the sensor died in a deploy".

### Added

- **Sensor-alive state** ([src/machine-readers.mjs](src/machine-readers.mjs)). `observeMachineReader()` was fully fail-open — correct, observation must never break serving — but its failure modes were *silent*: a bare `catch { return null; }`, and an unbound `SN_MR` binding that also returned null. If the binding were dropped in a deploy, the dataset behind a published argument would simply go quiet with nothing anywhere saying why. Every observe attempt now updates isolate-memory state (`ae_bound`, `last_write_ok`, `last_write_at`, `last_error`), and both failure paths `console.error` with the message — the return-null contract is unchanged, the silence is not. Same isolate-memory/best-effort convention as the crawler-list check: resets on eviction/redeploy, no new bindings.
- **`sensor` block on `GET /_sn/rights-signals/version`** ([src/version.mjs](src/version.mjs)): `{ ae_bound, last_write_ok, last_write_at }`. `ae_bound` reflects `env.SN_MR` at the request itself, so a dropped binding is visible on the next deploy-verification curl — before any crawler ever hits. `last_error` is deliberately **not** exposed: raw error text stays in Workers Logs only, pinned by a test.
- **README catch-up:** the routes table now documents `GET /_sn/rights-signals/machine-readers` (Bearer `SN_MR_READ_TOKEN`, `?days=N` clamped 1–90), and a new section documents the sensor and the `sn_machine_readers` dataset (blobs `[family, surface]`, humans and `/_sn/` paths never recorded) — both had shipped in v1.4.0 undocumented.

> **Why MINOR:** a new field on the version endpoint's response and new module exports. No removed or renamed export, no configuration change, nothing requiring operator action.

## [1.5.0] - 2026-08-04

**Headline:** the rights reservation now travels with every HTML response, so a crawler that never reads robots.txt still receives it alongside the content it is taking.

### Added

- **The reservation rides EVERY response, not just HTML and REST.** Driven by the live machine-readership sensor: across 30 days the declared AI-training crawlers made **172 reads** — 110 html, 27 robots, 18 asset, 15 wp-json, 1 sitemap, 1 feed, and **zero of the rights files**. Every response the Worker passed through untouched was content taken with no reservation attached, and two of those buckets are prime training material: the feed carries full prose, and images are copyrighted works in their own right. Coverage of the granular signal goes from **42/172 (~24%)** to effectively all of it. Only the `<head>` meta injection stays HTML-gated — `HTMLRewriter` has nothing to rewrite in a PNG.
- **`Content-Signal` on HTML responses** ([src/constants.mjs](src/constants.mjs), [src/index.mjs](src/index.mjs)). It was previously REST-only, which was backwards: `/wp-json` is `noindex` and is not where a scraper takes prose from — the HTML pages are. HTML carried `TDM-Reservation: 1` (the TDMRep binary reservation) but not the granular `search=yes,ai-train=no,ai-input=yes,use=reference` signal that separates indexing from training.
- **`Link: <https://juanlentino.com/license.xml>; rel="license"`** on every HTML and REST response. `rel="license"` is a registered RFC 8288 relation, so the license becomes machine-discoverable straight off the content fetch instead of requiring a crawler to know to look for `/license.xml`. It is **appended, never set** — WordPress emits its own `Link` entries (REST discovery, shortlink) and replacing them would break API autodiscovery. Pinned by a test.

### Changed

- **`Content-Signal` is now one constant** (`CONTENT_SIGNAL`), interpolated into both the robots.txt block and the response header, so the file and the header can never state different terms. Contradictory permissions between two surfaces a crawler reads would be worse than saying nothing at all. The robots.txt tests pass unchanged, proving the block is byte-identical.

### Why this shape, and not "make crawlers read the rights first"

Fetch order cannot be enforced. HTTP is client-driven, and the only way to force a crawler to read the rights files before the content is to gate content until it has — which requires per-client state (against this site's cookieless principle) and serves crawlers something different from humans, which is cloaking. It would also penalize well-behaved crawlers arriving on a deep link while doing nothing to the bad ones.

It is also unnecessary: [RFC 9309](https://www.rfc-editor.org/rfc/rfc9309) already requires compliant crawlers to fetch and honor `/robots.txt` before crawling, and a crawler ignoring that would ignore a gate too. So rather than controlling *when* the rights are read, this release makes ordering **irrelevant** — the reservation rides the same response as the content.

> **Why MINOR:** new response headers on every HTML and REST response. No removed or renamed export, no configuration change, nothing requiring operator action.

### Tests

- 75 passing (8 new): Content-Signal on HTML, the RFC 8288 link, the append-not-replace guarantee against a WordPress `Link` header, the feed / sitemap / image surfaces, that non-HTML bodies are never altered, and that auth-critical paths still bypass everything.
- One pre-existing assertion was **inverted deliberately**: `passes non-HTML origin responses through with no header additions` encoded the gap the sensor exposed. It now asserts headers are added while the body stays untouched.

## [1.4.4] - 2026-08-04

**Headline:** an origin 404 no longer erases every rights signal on the site. `robots.txt` failure handling now follows RFC 9309, which gives 4xx and 5xx opposite meanings — the previous single "not ok" branch treated them identically.

### Fixed

- **`robotsResponse()` returned the origin's response verbatim whenever the origin was not OK**, which on any 4xx dropped the entire owned block: the Article 4 reservation, `Content-Signal: search=yes,ai-train=no,ai-input=yes,use=reference`, all nine named-crawler `Disallow`s, and the `License:` line. That is the harmful direction, because [RFC 9309 §2.3.1](https://www.rfc-editor.org/rfc/rfc9309#section-2.3.1) defines a 4xx `robots.txt` as "unavailable", meaning crawlers **may access any resource** — so a transient origin 404 would publish "no restrictions of any kind" on the site's primary machine-readable rights surface. On a 4xx the Worker now composes `fullRobotsTxt("")` and serves it with a 200: the owned block is self-contained, and the origin simply had no directives of its own to contribute. The origin's error body is never echoed into the response.
- **5xx and 429 still pass through untouched, deliberately.** RFC 9309 defines 5xx as "unreachable", which crawlers **must** treat as a complete disallow — strictly more protective than anything this Worker could compose, so converting it to a 200 would *weaken* the signal. The old single-branch behavior was correct for exactly this half of the status space; it is now pinned by its own test instead of riding on a shared one.

> **Why PATCH:** a correctness fix to a failure mode. No new capability, no renamed or removed export, no configuration or user action required. The observable change is confined to origin-failure states.

### Known, not addressed here

- `package-lock.json` still reports `version: 1.0.0`, unchanged since the repo was created — it has never tracked `package.json`. The deploy stamp reads `$npm_package_version` from `package.json`, so nothing deployed is affected. Left alone rather than hand-edited; a routine `npm install` resyncs it.

## [1.4.3] - 2026-07-28

**Headline:** the crawler-list verdict survives isolate eviction — the self-heal's result now lands somewhere the plugin's next poll can actually find it.

### Fixed

- v1.4.1's self-heal stored its result in isolate memory only. The plugin polls once per 15 minutes, long enough for Cloudflare to evict the isolate between polls, so "poll returns null (heal kicks), isolate dies, next poll returns null" could repeat indefinitely — observed live: the pill stayed "unchecked" through two deploys and multiple poll cycles. The verdict now also persists in the colo-local Cache API (`caches.default`, 14-day TTL, no new bindings): the heal and the Monday cron both write it, and a cold isolate answers from the cache before deciding whether to re-check. Staleness is still judged by `checked_at`, failed verdicts stay heal-eligible, and every cache touch is try/caught so a cache failure degrades to the v1.4.1 behavior, never a fatal.

### Deploy notes

`npm run deploy` from this tag; no new secrets, vars, or bindings.

## [1.4.2] - 2026-07-28

**Headline:** the first live self-healed check found real drift, and this release records the review verdict instead of leaving a permanent warning.

### Changed

- Cloudflare's managed-robots.txt docs page no longer lists `CloudflareBrowserRenderingCrawler` (verified live 2026-07-28; the page now shows 8 crawlers). The block STAYS — the crawler still exists, and removing it would silently relax a public rights signal on a site whose posture is restrictive (ai-train=no, TDM reservation). The verdict is encoded as `REVIEWED_EXTRAS` in `crawler-list-sync.mjs`: reviewed deltas are reported separately (`reviewed_extra`) and excluded from `drift`, so the plugin's pill reads "in sync" while any UNREVIEWED delta — Cloudflare adding a crawler, or dropping one we haven't reviewed — still warns.

### Deploy notes

`npm run deploy` from this tag (the npm script is what stamps `SN_VERSION`; a bare `wrangler deploy` reports `version: null`, which the plugin renders as sensor-unknown).

## [1.4.1] - 2026-07-28

**Headline:** the crawler-list status self-heals — the plugin's "Crawler list" pill no longer sits on "unchecked" for up to a week after every deploy.

### Fixed

- The weekly drift-check result lives in isolate memory by design, so a deploy or isolate eviction erased it and `GET /_sn/rights-signals/crawler-list-status` answered `last_check: null` until the next Monday 07:23 UTC cron. The endpoint now kicks ONE background re-check via `ctx.waitUntil` whenever its stored result is missing, failed, or older than 8 days — throttled to one attempt per 10 minutes per isolate (the URL is public; the outbound docs fetch stays rate-bound) — and still answers immediately with the current state. The caller's next poll sees the healed result. A failed check is deliberately heal-eligible so a transient docs blip cannot pin "check failed" for a week.
- One shared `runAndRecordCrawlerListCheck()` path now serves both the Monday cron and the lazy self-heal; the drift/failure `console.error` trail is unchanged.

### Deploy notes

`npm run deploy` from this tag; no new secrets, vars, or bindings.

## [1.4.0] - 2026-07-28

**Headline:** the machine-readership sensor — the edge half of the plugin's v10.0.0 Machine Readers surface. The Worker that already intercepts every zone request now records WHICH machine families read WHICH surfaces, aggregate-only.

### New

- `src/machine-readers.mjs`: fixed-enum UA classification (18 named families, specific-before-generic ordering, `other-bot` fallback — the raw User-Agent never leaves the module, killing the stored-XSS-into-admin class by construction) + fixed surface-class enum (robots/rights/llms/agents-manifest/feed/wp-json/sitemap/asset/html/well-known). One Analytics Engine datapoint per classified request: `blobs [family, surface]`, `doubles [1]`, `indexes [family]`. No IPs, no full paths, no raw UAs; humans (browser UAs) are never recorded — human readership stays the beacon pipeline's, and the two are never summed.
- `GET /_sn/rights-signals/machine-readers?days=N` (1-90, default 30): token-auth read path for the plugin (Bearer `SN_MR_READ_TOKEN`), querying the AE SQL API with `sum(_sample_interval)` (sampled-count correct), grouped by family + surface + day. 401 unauthorized, 503 not-configured, 502 upstream — misconfiguration is visible, never silent.
- `wrangler.jsonc`: `SN_MR` Analytics Engine binding, dataset `sn_machine_readers` (auto-creates on first write).
- Observation is fire-and-forget: fully try/catch'd, skips `/_sn/*` internals, and can never alter or block a response.

### Deploy notes

Set before or with the deploy (values never in repo): secret `SN_MR_READ_TOKEN` (the bearer the plugin will present), secret `SN_MR_SQL_TOKEN` (a Cloudflare API token with Analytics Engine read), var `CF_ACCOUNT_ID`. The sensor itself works without them (writes need only the binding); the read path answers 503 until they exist.

## [1.3.0] - 2026-07-23

### New

- Weekly crawler-list drift check (`src/crawler-list-sync.mjs`, cron
  `23 7 * * 1`): fetches Cloudflare's published managed-robots-txt docs (the
  page `NAMED_CRAWLERS` was seeded from), extracts the crawler list they
  currently document, and diffs it against `robots-block.mjs`'s
  hand-maintained list — the tradeoff accepted in `v1.2.0`. Logs loudly on
  drift or a failed check; `GET /_sn/rights-signals/crawler-list-status`
  surfaces the last result (isolate-memory, best-effort, same convention as
  sn-provenance's `/_sn/status`).
- `robots-block.mjs` refactored: `NAMED_CRAWLERS` is now a plain array that
  both generates the served block and the sync check compares against —
  single source of truth, output verified byte-identical to before.
- **First real finding, live 2026-07-23:** the parser needed to strip HTML
  tags before matching — Cloudflare's docs page renders the example as a
  syntax-highlighted code block (each line in its own nested `<span>`s),
  which defeated a naive regex entirely (0 matches) until fixed. Once
  fixed, it flagged that `CloudflareBrowserRenderingCrawler` — present in
  our list (seeded from the live robots.txt output during this session) —
  isn't mentioned in Cloudflare's current docs example. Left as-is pending
  review: the docs example may simply be illustrative/incomplete rather
  than exhaustive; this is exactly the kind of discrepancy the job exists
  to surface, not silently resolve.

## [1.2.0] - 2026-07-23

### New

- **`Content-Signal: ai-input=yes` is live.** The owner disabled Cloudflare's
  "Managed robots.txt" dashboard toggle for juanlentino.com, which is the
  precondition v1.1.1 identified as the only real unblock — with the toggle
  off, Cloudflare no longer wraps its own block around this Worker's
  response, so full ownership (`robots-block.mjs`'s `fullRobotsTxt`,
  written and tested since v1.1.0) is now safe to run. `robots.mjs` flipped
  from `appendLicenseOnly` to `fullRobotsTxt(originTail(body))`. Verified
  live: single `Content-Signal` line, `ai-input=yes` present, Article 4
  preamble and full named-crawler block intact, `License:` directive still
  appended.
- Accepts the tradeoff flagged since v1.1.0: the named-crawler `Disallow`
  list is now a hand-maintained snapshot, not Cloudflare-auto-updating.

## [1.1.1] - 2026-07-23

### Fixed (reverts most of 1.1.0's `/robots.txt` change)

- **1.1.0 shipped a live regression:** composing the full owned block while
  Cloudflare's "Managed robots.txt" was still on produced TWO conflicting
  `Content-Signal` lines (Cloudflare's ai-input-less one, then ours) —
  because Cloudflare wraps its own block around whatever this Worker
  returns, unconditionally, independent of what the Worker's response
  contains. A same-session follow-up attempt to self-detect this via the
  Worker's own `fetch(request)` result also failed: that internal subrequest
  never sees Cloudflare's block regardless of the dashboard toggle state
  (confirmed live, twice, with a debug endpoint dumping the exact bytes) —
  so there is genuinely no signal available to Worker code that
  distinguishes "safe to own" from "will get double-wrapped."
- `/robots.txt` is back to `v1.0.0`-era behavior: append `License:` only,
  touch nothing else. `robots-block.mjs`'s full-ownership functions
  (`fullRobotsTxt`, `originTail`) are kept, tested, and documented as ready
  for a **manual** code change once the owner confirms "Managed robots.txt"
  is disabled in the Cloudflare dashboard — see `robots.mjs`'s comment for
  the exact one-line swap.
- `Content-Signal: ai-input=yes` is NOT live. Back to the v1.0.0 known
  limitation, now with a corrected root-cause understanding and a concrete
  unblock condition (owner disables the dashboard toggle) instead of an
  open-ended "wait for Cloudflare."

## [1.1.0] - 2026-07-23 (partially reverted by 1.1.1 — see above)

### New

- **`/robots.txt` takes full ownership** of the managed-content-signals
  block instead of patching Cloudflare's. `Content-Signal: ai-input=yes` is
  now live — resolves the v1.0.0 known limitation, which turned out to be
  structural (Cloudflare's managed block wraps around a Worker's response
  rather than being editable by one) rather than a bug on this side.
  `src/robots-block.mjs` hand-authors the Article 4 preamble and
  named-crawler `Disallow` list byte-identical to Cloudflare's last-observed
  managed output, and defensively strips a still-active Cloudflare block out
  of the origin fetch so the transition (before the dashboard toggle is
  disabled) never produces a duplicated block. Accepts a real tradeoff: the
  crawler list is now hand-maintained, not Cloudflare-auto-updating — see
  README.
- Auth-critical WordPress surfaces (`/wp-admin`, `/wp-login.php`,
  `/xmlrpc.php`, `/wp-cron.php`) now bypass every dispatcher check
  immediately (`src/admin-bypass.mjs`), instead of the wildcard route
  unconditionally routing them through HTMLRewriter/header logic that has
  no reason to touch them. Security-reviewer finding.
- `robots.mjs` now also strips `content-encoding` (not just
  `content-length`) after rewriting the body — a latent bug (never
  observed live, since the origin body was always tiny and uncompressed)
  caught by code review.
- Test coverage: `src/index.mjs`'s dispatcher (header merge, `/wp-json`
  branch, content-type sniff) and `src/admin-bypass.mjs` were previously
  untested; both now have direct coverage. 24 tests total (was 11).

## [1.0.0] - 2026-07-23

### New

- Initial release. Serves the machine-readable rights-signal surface for
  juanlentino.com: TDMRep (header pair, `<head>` meta tags, and
  `/.well-known/tdmrep.json`), an RSL 1.0 licence at `/license.xml`, a
  `License:` directive appended to `/robots.txt`, TDM headers on every
  `/wp-json/*` response, and a placeholder `/tdm-policy/` page pending
  counsel's terms.
- `GET /_sn/rights-signals/version` for deploy verification.

### Known limitation

- `Content-Signal: ai-input=yes` cannot be set from this repo. Cloudflare's
  managed content-signals feature wraps its own `robots.txt` block around
  whatever this Worker returns, after the Worker runs — the `Content-Signal`
  line is never visible to Worker code, and Cloudflare's dashboard doesn't
  yet expose an `ai-input` toggle. See README "Known limitation" for detail
  and the owner-side options.
