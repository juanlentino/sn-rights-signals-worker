# Changelog

## 1.25.0 - 2026-09-16

### Added
- WebMCP bridge v2, arc one (design: signal-and-noise-tools `docs/webmcp-bridge-v2-design.md`). Three tools join `verify-page` and `get-rights-terms`, each reading public bytes and calling no authenticated door: `related-notes` (the plugin's `#sn-related` manifest; not a note, not built and nothing related are three distinct answers), `get-site-map` (`/notes/index.json`, fetched once per page; 404 reads "not built"), `get-citation` (BibTeX and CSL-JSON from the page's JSON-LD, author "Lentino, Juan" with ORCID on every note, plus the ledger record's content hash and URL on a signed note; a failed record fetch is named, never fatal). Every tool's execute is wrapped by `snWebmcpMeasured`, which reports `{tool, outcome, ms}` and nothing else through `sendBeacon` to `POST /_sn/rights-signals/webmcp-call`; the route writes one row to the machine-readers dataset as family `webmcp`, surface the tool, the outcome in the purpose slot, and answers 204 whatever it did. It writes nothing unless the call is a same-origin POST (`Origin` the site, `Sec-Fetch-Site: same-origin`) under 256 bytes naming a known tool, a known outcome and an integer `ms` in range; each row counts one, never a client count, so a forger's ceiling is the edge's per-IP rate-limiting rule on the path. The totals view excludes the family, so the plugin's exact total agrees with its split aggregate. (#58)

## 1.24.3 - 2026-09-12

### Fixed
- Markdown fallback: `maybeMarkdown()` converts a clone of the origin response, so a converter failure falls back to the HTML instead of rejecting with "ReadableStream has been locked" (a 1101 page). The unread branch is cancelled on success. (#49)
- `html-to-markdown`: a self-closing foreign element (`<svg/>`, or `<a/>`/`<p/>` inside `<svg>`/`<math>`) no longer aborts the conversion — one `onEnd()` helper runs the close callback when HTMLRewriter reports "No end tag". (#50)
- `verify-page`: the signature leg passes `cred.proof.pubkey_id` to `Core.deriveKeyAgreement()`, so a record signed under a rotated key verifies under the key it names rather than the did's first key. (#51)
- `verify-page`: `checkRetraction` is ported from the docket as a fifth, non-check leg. The retraction record is fetched, classified (`Core.deriveRetraction`), and verified (content hash, then Ed25519 under the key it names) before `Core.retractionOutcome`'s state reaches `Core.deriveOverallVerdict`. A retraction that fails to verify, an unreachable path, a missing credential or a core without retraction support all yield `{ retraction: null, unknown: true }` — a qualified verdict, never a clean one. The tool result gains a top-level `retraction` field; key documents are fetched once and shared with the signature leg. (#52)
- `html-to-markdown`: `td`/`th` are separated by ` | ` (reset per row), `figure`/`figcaption` are blocks, and text is buffered per text node before entity decoding so an entity split across stream chunks (`&am` | `p;`) decodes instead of being emitted raw. (#53)
- Content negotiation: `withVaryAccept()` compares `Vary` tokens, so `Accept-Language` no longer suppresses the `Accept` append; `prefersOdrl()` reuses `parseAccept()` and honours q (`application/ld+json, text/html;q=0.5` is a JSON preference; a tie stays HTML); `prefersMarkdown()` lets an explicit `text/markdown` entry outrank the `text/*` range either way (so `text/markdown;q=0` is a refusal) and no longer lets `text/*` win a tie against an explicit `text/html`. (#54)
- Rewritten HTML drops `Content-Length` and suffixes the `ETag` with the bridge SRI prefix, so a bridge release invalidates cached pages instead of a 304 keeping a stale `integrity` attribute; `/tdm-policy/` and `/ns/tdm` answer `Accept: text/markdown` through the same negotiation as origin pages (JSON-LD forms are never converted); the `sitemap` surface matches `^/(wp-)?sitemap[^/]*\.xml$` only, so a note mentioning the word is recorded as `html`. (#55)
- The markdown twin keeps the origin's `cache-control`, `x-robots-tag` and `content-language` (defaulting `public, max-age=300` only when the origin sent none), so a private/no-store or noindex page does not become a public, indexable markdown document. A licence offer appends `Signature-Agent` to `Vary` on every surface that emits one.

## 1.24.2 - 2026-09-08

### Fixed
- Pin authenticated Analytics Engine SQL requests against redirects, cap them at 10 seconds, and enforce a 10 MiB streamed response limit. Release rejected bodies and report upstream failures without changing taxonomy or SQL results.

## 1.24.1 - 2026-09-05

**Headline:** a rights-detail write failure is no longer booked as the
aggregate sensor dying.

### Fixed

- `observeMachineReader()` marks the aggregate write successful BEFORE calling the
  rights-detail stream, and the detail call has its own try/catch and its own
  outcome, `detail_last_write_ok`. It used to share the aggregate's bookkeeping:
  a detail write that threw flipped `last_write_ok` to false after the aggregate
  row had already landed, so `/_sn/rights-signals/version` read the sensor as dead
  for a failure in a stream that sees ~80 rows a month. Verified by mutation before
  the fix (aggregate ok + detail throwing on `/.well-known/tdmrep.json` gave
  `last_write_ok: false`). The version endpoint's `sensor` block gains
  `detail_last_write_ok` additively; `last_error` is still never serialised.

### Tests

- `machine-readers.test.mjs`: aggregate lands + detail throws keeps the aggregate
  true and the detail false, with the failure logged; both land is both true; a
  non-rights path leaves the detail outcome null; the aggregate failing is still
  the aggregate dying.

## 1.24.0 - 2026-08-30

**Headline:** the rights position stops being purely declaratory — a verified
agent is answered with a licence offer keyed to the identity it proved.

Survey item **A2** (`signal-and-noise-tools`
`docs/proposals/edge-capability-survey-2026-08-23.md`). Until now the position
was a DECLARATION: `TDM-Reservation`, `TDM-Policy` and `Content-Signal` ride
every response (v1.5.0), addressed to a reader who may or may not exist and who
could not be identified either way. A1 (v1.19.0) made identity checkable —
Ed25519 HTTP Message Signatures verified in this Worker rather than rented from
a plan tier. This release spends that capability.

**Built on a measurement, not on principle.** A2's gate was whether agents
reaching this site sign at all. In the week to 2026-08-30 the sensor recorded
**311 verified reads against a pre-ship forecast of ~0**, with the verified share
rising across three readings (0.74% → 1.66% → 2.35%, marginal rate 2.57%).

### Added — `src/licence-handshake.mjs`

Five headers, and only for a proved identity:

- `TDM-Licence-Offer: conditional` — **never** "granted". The §2 conditions are
  conditions *precedent*; this Worker can observe who is asking, never whether
  they will meet them. Any word implying the licence is held would be an
  assertion the edge is in no position to make.
- `TDM-Licence-Policy` / `TDM-Licence-Version` — where the operative text lives
  and which version it is. §2 already requires a `POLICY_VERSION` bump on any
  change to itself; an offer that did not name its version could not tell a
  licensee *which* text they met.
- `TDM-Licence-Conditions` — the five condition ids, C1–C5.
- `TDM-Licence-Agent` — the verified `Signature-Agent` origin, echoed back. This
  is the half that makes it a **handshake rather than a broadcast**.

Nothing restates the terms. A header that paraphrased §2 would become a second,
unversioned copy of a legal document — the exact drift this stack exists to
avoid.

**A HANDSHAKE, NOT A PAYWALL.** Cloudflare sells the paywall version (402 plus
`crawler-price`, Stripe-backed). A homebrew charging mechanism is out of scope
and off-brand, and a test asserts the emitted headers carry no price, payment,
or purchase signal of any kind.

**FAIL OPEN, like A1 itself.** Every state that is not a proved identity — did
not sign, signature did not hold, key nobody vouches for — receives *exactly*
the response it received before this release. There is no branch here that
removes anything.

### Changed — a signed request now awaits verification

v1.19.0 deferred the whole observation into `waitUntil` on the rule that no
reader should wait on our telemetry to get their bytes. **That rule is
superseded, deliberately**, and its test is rewritten rather than deleted: the
state now shapes the *response*, so it must be known before the response is
composed. A licence offer computed after the bytes have gone is not an offer.

The cost falls only on requests carrying Web Bot Auth headers, and key
directories are Cache-API cached (6h positive, 15m negative) — so the common
case is an edge-local lookup plus an Ed25519 verify. **No unsigned request pays
anything**; that branch is untouched. The state is resolved **once** and reused
for both the observation and the headers, so verification is never doubled and
the recorded state can never disagree with the offered one.

### Tests — 17 new, every guard negative-controlled

- The offer's content is pinned against the policy, including a **bidirectional
  drift guard**: every advertised condition must appear in §2, and every
  condition §2 states must be advertised. Dropping C5 fails one direction;
  inventing a C6 fails the other. A header advertising fewer conditions than the
  grant requires would describe a licence the rightsholder never offered — the
  same class of failure `constants.mjs` already names for `Content-Signal`,
  where a header and a file stating different terms is "worse than saying
  nothing".
- A third assertion guards the guard: it fails if the prose regex ever stops
  matching, so the two directions cannot pass vacuously.
- End-to-end through `worker.fetch` with a really-signed request (the existing
  `sign-fixture` helper), over a stub serving **both** the key directory and the
  origin — a stub answering only the origin would resolve every signature to
  `unsigned` and leave the negative tests as the only ones really running.
- Leaking the offer to an unverified agent fails 3; dropping the offer from the
  HTML branch fails the end-to-end pin; computing it without awaiting
  verification fails it too.

Suite: 368 passing.

## 1.23.0 - 2026-08-29

**Headline:** the aggregate read declares its own row cap, and a totals view that
cannot truncate.

The machine-readers sensor serves three views. Two declare a `LIMIT` and **report
it** — the comment above them says why: *"a silently truncated leaderboard reads
as 'that is all of them' when it is not."* The aggregate, the view every consumer
sums to get a total, declared none, and therefore inherited the SQL API's own row
cap silently while reporting `limit: null`.

It groups by **eleven dimensions x day**, so its row count scales with the window.
A wide window truncates, and because the consumer derives a total by summing the
returned rows, a truncated read does not look degraded — it looks like less
traffic.

**Measured consequence:** a 60-day read summed to barely more than a 30-day read
(69,216 vs 64,825), so a derived prior period reported a 15x surge that never
happened. It also contradicted this site's own published figure of ~17,463 reads,
which is what made it visible at all.

- **`AGGREGATE_LIMIT = 10000`**, declared and reported. This makes truncation
  ours and visible. It does NOT make a truncated total correct — dropped rows
  stay dropped — which is what the next item is for.
- **New `totals` view**: `sum(_sample_interval)` grouped by **day alone**, so a
  90-day window returns at most 90 rows and the sum is exact however wide the
  window gets. A separate query on purpose: the breakdown needs its dimensions,
  and the total needs to not have them.
- **`rows` and `truncated` in every response.** The upstream row count was
  already present and was being discarded, which is why truncation has been
  unobservable rather than merely unnoticed. A consumer can now refuse to derive
  a total from a read that says it is truncated.

Consumers reading `data` for breakdowns are unaffected. The plugin must adopt
`totals` for its headline count before that number can be trusted — deploy this
first.

## 1.22.0 - 2026-08-28

**Headline:** the site hands browser agents its own provenance tools — from inside the
anchored bytes.

Born from the 2026-08-23 incident: Cloudflare's WebMCP preview injected a script tag at
the zone layer, above the provenance sweep's vantage, leaving `/tdm-policy/` permanently
un-anchorable until the toggle came off. The principle extracted there is now built in:
**agent surfaces ship only from inside the anchored bytes.** Design and plan live in
signal-and-noise-tools `docs/webmcp-native-design.md` / `docs/webmcp-native-plan.md`.

### Added

- **`/webmcp/bridge.js`** ([src/webmcp-bridge.mjs](src/webmcp-bridge.mjs)) — a
  self-hosted WebMCP bridge registering two page-local tools with
  `navigator.modelContext` (W3C draft, Chrome 146+; spec pinned in a comment):
  `verify-page` (a DOM-free port of the /verify docket's four checks — signature,
  content hash, live match, anchor — every verdict delegated to the plugin's
  `prov-verify-core.js` decision core, loaded at runtime) and `get-rights-terms`
  (the negotiated ODRL plus pointers). No MCP server connection
  (`data-mcp-url="none"`); no agent API → silent no-op. Source of truth is
  [src/webmcp-bridge-client.mjs](src/webmcp-bridge-client.mjs); the served asset is
  composed via `Function.prototype.toString()` — no bundler — so the unit-tested
  functions ARE the shipped bytes.
- **The SRI-pinned tag on every HTML surface** ([src/html-injector.mjs](src/html-injector.mjs),
  [src/tdm-policy-page.mjs](src/tdm-policy-page.mjs), [src/ns-tdm.mjs](src/ns-tdm.mjs)):
  `integrity="sha384-…"` is computed at module scope from the exact served source, so
  the tag — which lives inside anchored tdm-policy bytes — attests the exact executable
  it loads. Deploying this mints tdm-policy v4 in the ledger within the hour, by design.
  Non-HTML representations (ODRL, license.xml, tdmrep, robots, markdown, ns/tdm JSON)
  stay tag-free, invariant-pinned.
- **A bundled-artifact gate** ([scripts/webmcp-bridge-bundle-gate.mjs](scripts/webmcp-bridge-bundle-gate.mjs),
  wired as `pretest`): builds through wrangler's real esbuild pipeline and drives the
  composed registration behaviorally. Exists because esbuild's `keepNames` injected
  `__name()` refs into `toString()` output — the served asset would have thrown for
  exactly the Chrome 146+ agents it targets while every vitest-side gate stayed green.
  Neutralized twice over: `keep_names: false` in wrangler.jsonc AND a defensive shim
  baked into the source. The vitest artifact and the wrangler artifact are different
  files; the gate is the one that watches the shipped one.
- **Six new rights invariants + four mutations**
  ([scripts/rights-checks-documents.mjs](scripts/rights-checks-documents.mjs)): tag on
  the policy HTML exactly once; tag on every HTML surface (html, note, ns/tdm); no
  non-HTML leak; JS content-type; behavioral registration of both tools (a syntax-only
  gate was proven green on the broken artifact — this one runs it); SRI parity between
  the tag and the served bytes. The live checker currently fails on exactly these six
  against production — the guard proving it can go red before it gates a deploy.
- `/webmcp/bridge.js` classifies as `agent-discovery` in the machine-readership sensor
  ([src/machine-readers.mjs](src/machine-readers.mjs)) rather than falling into the
  html catch-all bucket.

## 1.21.0 - 2026-08-28

**Headline:** the R6c minimum-age cooldown lands beside the attestation gate.

### Added

- `scripts/dependency-cooldown.mjs` + `.cooldown-accept.json` (min_age_days: 7), a CI
  step after the attestation gate. No locked version may be younger than the policy's
  minimum age; deliberate young bumps are accepted per `name@version` with a reason,
  never silently; stale accepts are reported for pruning; unmeasured ages fail closed.
  Full rationale and the negative-control proof (RED at 11d, per-version accept) live
  in sn-remote-mcp-worker v1.1.0 — the script is byte-identical across all five
  workers, like the attestation gate before it. Verified live against THIS repo's
  tree: PASS at 7d.

## 1.20.0 - 2026-08-23

**Headline:** v1.19.0 recorded the signature state and then did not let anyone read it.

### Added

- **`signed_agent` on the aggregate read query.** v1.19.0 appended `blob11` to
  the WRITE path and stopped there. The plugin reads this dataset through THIS
  worker's `/machine-readers` endpoint, not by querying Analytics Engine
  directly — so a column the read query does not select is a column that does
  not exist as far as every consumer is concerned. The sensor was writing into
  a room with no door.

- **The first tests that pin the read query's shape at all.** blob10's
  exposure was never covered either, so the same omission could have happened
  twice. The suite now asserts that every column v1.18.0 exposed is still
  exposed, that `signed_agent` is both selected AND grouped (without the GROUP
  BY the aggregate sums valid and unsigned into one row, losing the dimension),
  and that `blob8` is still never selected — the raw user-agent sample must not
  escape the aggregate.

### Notes

- `buildQuery` is now exported. It is a pure function of (view, days); exporting
  it is what makes the contract testable.
- The RULE 3 rights-detail view is untouched: a different dataset with its own
  blob order, asserted by test.

## 1.19.0 - 2026-08-23

**Headline:** the site can now tell a signed agent from one that merely says so.

### Added

- **`signed_agent` — an eleventh blob on the aggregate dataset.** Web Bot Auth
  verification (RFC 9421 HTTP Message Signatures, carried in `Signature`,
  `Signature-Input` and `Signature-Agent`), recorded as one of four states:
  `unsigned`, `valid`, `invalid`, `unknown-key`.

  Until now, every rights signal this worker ships has been a declaration
  addressed to an agent whose identity was a string it typed itself. Nothing on
  this site could distinguish an agent that *is* ChatGPT from one that says so
  in a user-agent header. This is the first measurement that can.

### Why four states and not a boolean

`invalid` and `unknown-key` are the two populations that would matter first if
this ever became a gate — an agent signing incorrectly, and an agent signing
with a key no directory vouches for. A boolean erases both. An EMPTY or
unreachable directory reads as `unsigned`, not `unknown-key`: "published
nothing" and "we could not reach it" are the same evidence, and neither says
anything about the key.

### Why this changes no response

Verification is a SENSOR. Every failure path in `src/web-bot-auth.mjs` resolves
to `unsigned`, and nothing in it can alter a status, header or body. Signed
requests defer their whole observation into `waitUntil`, so no reader waits on a
key-directory fetch to get their bytes. An unsigned request — which is nearly
all of them — costs two header reads and performs no fetch at all; a test
asserts that by failing if `fetch` is called.

### Why the packages

`web-bot-auth` and `jsonwebkey-thumbprint` are this worker's first runtime
dependencies. Both are Cloudflare-authored, and both are confined to
`src/web-bot-auth.mjs`. Signature-base construction IS the security property
here, and Cloudflare writes both the IETF draft and the implementation;
hand-rolling it to preserve a zero-dependency count would have been vanity.

Cloudflare exposes the same verdict as `cf.bot_management.signed_agent`, which
requires Enterprise with Bot Management. This zone does not have it — the same
reason markdown negotiation lives in this worker rather than in a plan tier.

### Notes

- Blob order **is** the read query's contract, so the new axis is APPENDED,
  never inserted. Old rows carry `""` and read as not-measured, which is a
  different fact from `unsigned`, itself a measurement.
- **Cross-repo:** the plugin's read query gains the column separately. An older
  plugin against this worker drops it and degrades the readout, never errors.

## 1.18.0 - 2026-08-23

**Headline:** the markdown door gets a number. v1.16.0 opened it and left it
unmeasurable.

### Added

- **`markdown_requested` — a tenth blob on the aggregate dataset**, and a new column
  on the read query. `"1"` when the reader explicitly preferred `text/markdown`,
  `"0"` otherwise.

  Until now, *"how many agents actually use the markdown door?"* — the one number that
  says whether v1.16.0 was worth building — had no answer. A markdown request lands on a
  content page, so it classifies as `html` like any other page read, and the `Accept`
  header is retained only for rights surfaces (`DETAIL_SURFACES`). The representation was
  invisible.

### Why a DIMENSION and not a new surface class

A `markdown` surface class would drain reads **out of** `html`, changing the meaning and
population of a value that already exists. This tree's additive rule (the v1.11.0 family
note) forbids exactly that. A tenth blob changes nothing that already exists; it adds an
axis, and old rows carry `""` and read as not-requested.

Blob order **is** the read query's contract, so the new axis is APPENDED, never inserted —
inserting one would silently relabel every column after it. Pinned positionally by test.

### Why "requested" and not "served"

The sensor runs before the origin fetch, so whether conversion succeeded is not yet known.
That is *our* reliability and it is answerable from logs. **Adoption is a fact about the
agent**, and the request alone states it.

The metric calls the SAME `prefersMarkdown()` the Worker serves markdown with, rather than
re-deriving the rule — a test pins that, because two copies of the predicate would report
adoption of a door that was not actually opened for that request.

### Notes

- `observeMachineReader()`'s RETURN value is deliberately unchanged. Two tests pin its
  shape and nothing in the Worker reads it; widening it would break an existing contract
  to carry a field no caller wants.
- **Cross-repo:** the plugin normalises the new field additively (v12.16.0). An older
  plugin against this Worker simply drops the column — the readout degrades, never errors.

## 1.17.0 - 2026-08-23

**Headline:** the agent-discovery documents get their own surface class — which stops
them being counted as reads of the terms.

### Fixed

- **`/.well-known/mcp/server-card.json` and `/.well-known/api-catalog` were classifying as
  `well-known`** — and `well-known` sits inside the plugin's `snt_mr_rights_surfaces()`,
  the set published as *"a machine read the terms"*. So since v12.14.0, an agent fetching
  a server card was being counted as a machine reading the TDM policy. It never was: a
  server card is **discovery**, not terms.

  `classifySurface()` now returns a new `agent-discovery` class for the three standard
  discovery documents (server card, RFC 9727 api-catalog, ARD ai-catalog), and that class
  is deliberately **absent** from the rights subset. The published rights-reads figure
  therefore gets SMALLER for windows containing such reads. That is the correction, not a
  regression.

### Why it is also the thing that makes the doors measurable

In one shared bucket with `security.txt`, `gpc.json`, `did.json` and `webfinger`, the
question *"did any agent actually use the doors we opened?"* had no answer the sensor
could give. It does now — `ai_surfaces` breaks out `agent-discovery` on its own.

Opening a discovery surface and being unable to measure whether anything reads it is the
same defect as shipping a setting with no control.

### Notes

- The match list is **EXACT, never a prefix**. A future file under `/.well-known/mcp/`
  lands in `well-known` until someone classifies it deliberately, rather than silently
  inheriting this class. Pinned by test.
- **Cross-repo mirror:** `snt_mr_valid_surfaces()` in the plugin must carry the same
  eleven values (plugin v12.15.0). The read path is fail-SOFT per row — an unrecognised
  surface normalises to `html` — so an old plugin against this Worker misattributes those
  rows briefly rather than blacking the readout out. Ship the plugin first anyway.

## 1.16.0 - 2026-08-22

**Headline:** the site answers `Accept: text/markdown`. Cloudflare's own Markdown for
Agents needs a Pro zone; this zone is not on one, and the criterion is about what the
site ANSWERS, not about who converts.

### Added

- **Markdown content negotiation at the edge.** A request that explicitly prefers
  `text/markdown` now receives the page as markdown; every other request receives exactly
  the HTML it received before. Measured on a real Note: **138,512 bytes of HTML in,
  6,622 bytes of markdown out — 95.2% smaller**, with headings, links, emphasis and
  frontmatter intact.
- **`src/accept-markdown.mjs`** — the negotiation predicate, deliberately matching
  Cloudflare's four documented rows (`text/markdown` → markdown, `text/markdown,
  text/html;q=0.9` → markdown, `text/*` → markdown, `*/*` → HTML). Matching their
  semantics is the point: agents written against Cloudflare's implementation work here
  unchanged, and if this zone ever moves to a plan that includes it, these three modules
  delete cleanly and behaviour does not change.
- **`src/html-to-markdown.mjs`** — an HTMLRewriter state machine. No dependency: every JS
  html→markdown library assumes a DOM, and shipping a DOM shim into the Worker on the
  site's wildcard route to serve a minority representation is a bad trade against ~200
  lines.
- **`src/markdown-negotiation.mjs`** — response construction and `Vary: Accept`.

### Why the safety argument is the whole design

Every human visit to this site flows through this Worker's wildcard route, so a
negotiation predicate that is loose by one case turns the site into a text dump for real
readers. `prefersMarkdown()` fails toward HTML in every ambiguous case, and the suite
pins a **verbatim Chrome Accept header** as the case that must never convert. That
assertion was mutation-tested: loosening the predicate turns it, and the end-to-end
"serves untouched HTML to a real browser" test, red.

`Vary: Accept` rides **both** representations. Putting it on only the markdown response is
the bug, not half the fix — a downstream cache holding the HTML without it would replay
that HTML to an agent, and a cached markdown body to a browser. Cloudflare's own edge
cache is not the exposure: it stores this Worker's origin subrequest, which is always the
HTML, and conversion happens after that lookup.

### Notes

- The reservation rides the markdown representation too (`TDM-Reservation`,
  `Content-Signal`, `rel="license"`), per v1.5.0's rule that content taken in ANY
  representation is content taken.
- Non-200 responses are never converted: a Cloudflare 1xxx interstitial rendered as
  markdown is a confident-looking document about nothing.
- A conversion failure logs and falls back to HTML rather than 500-ing the page.
  Observability is on, so a converter that starts failing is visible rather than quietly
  serving HTML.
- **Fidelity is a deliberate floor.** Tables, footnotes and definition lists come through
  as their text. The consumer is an LLM reading prose, and a wrong table is worse than a
  flat one.
- **URL scheme allowlist on links and images.** The first version checked
  `startsWith("javascript:")`; CodeQL flagged it (`js/incomplete-url-scheme-check`, high)
  for missing `data:` and `vbscript:`, and it was right. The fix is not two more strings:
  a denylist must enumerate every dangerous scheme forever, an allowlist only the few
  that are useful (`http:`, `https:`, `mailto:`, and scheme-less relative URLs). This
  matters even though the output is markdown — `[click](data:text/html;base64,...)` is a
  live link in whatever renders it. Converting a document does not sanitize it.
- Three defects were found only by converting **real** pages, after twelve synthetic
  fixtures were green: HTMLRewriter does not entity-decode text or attributes
  (`isn&#039;t` reached the markdown); a bare `title` selector also matched an inline
  `<svg><title>` and concatenated both into the frontmatter; and skip links leaked in as
  content. All three are now pinned.

## 1.15.0 - 2026-08-22

**Headline:** `Disallow: /tools/` governs `*` again, instead of a bot that was already shut out.

### Fixed

- **Bare origin rules are hoisted into the `User-agent: *` group** rather than appended
  below the rights-signals block. A rule belongs to the nearest **preceding** `user-agent`
  line, and RFC 9309 §2.2.1 ends a group only at the next `user-agent` line — a blank line,
  a comment, and the `# END Signal & Noise rights signals` marker all close nothing that a
  parser can see. So the origin's bare `Disallow: /tools/`, appended after the block, bound
  itself to `meta-externalagent` — the last group opened, and one already under a blanket
  `Disallow: /`. `/tools/` was therefore never disallowed for Googlebot.
- Only rules **before** the tail's first `user-agent` line are hoisted; once the origin opens
  a group of its own, its rules stay in it. Comments, `Sitemap:`, and the origin's own groups
  are left in the tail untouched.

### Notes

- **Search Console could not have caught this.** It flagged the two deliberately non-standard
  lines it does not implement (`Content-Signal`, line 47, and `License:`, line 81 — both
  ignored per RFC 9309 §2.2.4, both harmless) and said nothing about the one rule that parses
  perfectly and governs the wrong agent. Well-formed and wrong is invisible to a linter.
- **The tests could not have caught it either, as written.** They asserted the composed string
  and `toContain("Disallow: /tools/")` — presence, never binding. The line was always there.
  `groupFor()` in `test/robots-block.test.mjs` now resolves a rule to its owning group the way
  the RFC does, and is checked against the pre-fix layout to confirm it fails on it.
- This was never a regression the Worker introduced: before composition the origin's rule
  preceded every group, which RFC 9309 discards outright. It went from ignored to misbound —
  both equally not what it looked like.

## 1.14.1 - 2026-08-22

**Headline:** the machine-readers bearer gate compares in constant time, like its siblings.

### Changed

- **`src/machine-readers.mjs` — `SN_MR_READ_TOKEN` is now compared via `safeEqual()`**,
  the SHA-256-then-`crypto.subtle.timingSafeEqual` helper sn-analytics-worker and
  sn-login-guard-worker already use for their bearer secrets, replacing a plain `!==`.
  A 2026-08-22 cross-repo security review judged the timing channel not practically
  exploitable through edge jitter, but this worker was the one deviation from the
  family's own constant-time convention; now all three compare secrets the same way.

## 1.14.0 - 2026-08-18

**Headline:** R6c's gate lands — the dependency-provenance check that the 2026-08-14
attestation audit licensed, now enforced on every run.

### Added

- **`scripts/attestation-gate.mjs` — the dependency-provenance gate.** Two legs, and only
  two: (1) every installed package must carry a valid npm **registry signature** —
  `invalid` or `missing` non-empty is a hard fail; (2) the set of packages lacking a
  **provenance attestation** must not grow beyond `.attestation-allowlist.json`.
- **`.attestation-allowlist.json` — 34 names, pinned BY NAME**, per the audit's condition.
  One name (`lightningcss-linux-x64-gnu`) was added as a **reviewed event** after the first
  CI run, and the file records why: a local `npm install --os=linux --cpu=x64` does not
  resolve that platform binary (libc gnu/musl is outside what the os/cpu override
  simulates), so the gate caught a real gap between the simulated and actual runner
  population. Accepted on the same basis as its already-pinned parent `lightningcss`.
  Adding a name is a reviewed event, never a way to make CI green. When a package starts
  attesting, the gate reports the stale entry as a NOTICE so the list shrinks on its own.

### Notes on what this gate deliberately does NOT do

- **It does not enforce a coverage percentage.** Coverage is reported (56.0%) and never
  gated. This tree is pure toolchain — zero runtime dependencies — so the meaningful
  question is "did the unattested set change?", not "is the ratio high?". Gating a ratio
  creates pressure to push names onto the allowlist to move a number, which inverts an
  allowlist into a pass-through.
- The 2026-08-14 audit predicted low-80s coverage after a toolchain refresh. That
  prediction is superseded, and not because the refresh failed: the vitest 4 jump
  *removed* the `@esbuild/*` and `@cloudflare/workerd-*` families, which were exactly the
  ones that would have started attesting. The tree got smaller and proportionally more
  never-attests. Signatures are 100%; that is the leg with teeth.

### Changed

- **CI now runs node 24 (was 22) — required, not cosmetic.** The gate needs npm >= 11:
  npm 10 accepts `--include-attestations` but silently omits the `verified` array, which
  would make every package read as unattested. node 24 bundles npm 11 at no extra step,
  where `npm i -g npm@11` would have added ~8s to a job already at 36-60s — enough to tip
  a run into a second billed minute. The gate asserts the npm version rather than
  trusting it, and exits 2 with a clear message if it is ever downgraded.
- The gate runs as a **step in the existing job**, never its own job — Actions bills per
  job rounded up to the whole minute.

## 1.13.2 - 2026-08-18

**Headline:** the nested-wrangler advisory closes — and a test isolation gap it was hiding.

### Security

- **Nested `wrangler` OS-command-injection advisory (high) closed.** `@cloudflare/vitest-pool-workers`
  pinned its own `wrangler 4.44.0` beneath the patched top-level copy, so no lockfile refresh could
  reach it. Deferred 2026-08-04 with a stated revisit condition; that condition is now met.
  **Every** pool-workers release peering `vitest 3.x` tops out at `wrangler 4.57.0` — two releases
  *below* the 4.59.1 fix — so the vitest 4 jump was not a preference but the only path. Moving to
  `@cloudflare/vitest-pool-workers ^0.22.0` (ships `wrangler 4.124.0`) collapses the duplicate tree
  to a single hoisted copy: the advisory closes by deduplication, not by an override.
- `npm audit`: 0 vulnerabilities. Signatures 80/80 verified, 45 attested (was 52 of 109 — the tree
  lost 38 packages, so coverage rises 47.7% → 56.3%). R6c gate condition 1.

### Changed

- **`vitest` 3 → 4, and the config moves to the plugin API.** v4 removes the
  `@cloudflare/vitest-pool-workers/config` subpath: `defineWorkersConfig({ test.poolOptions.workers })`
  becomes `defineConfig({ plugins: [cloudflareTest(...)] })`. The options object relocates verbatim —
  same shape, new home. Matches the `vitest ^4.1.9` the analytics and login-guard workers already run.

### Fixed

- **Two self-heal tests were relying on isolation the pool no longer provides.** v4 isolates storage
  **per test file**, not per test — Cloudflare's documented change, matching Vitest's own model, and
  the `isolatedStorage` option is gone entirely. A healed `ok:true` verdict written to the colo cache
  therefore survived into the following cases: one read that stale verdict as its own, the other
  skipped a self-heal it should have kicked. The cache **outliving** the in-memory wipe is deliberate
  — that is precisely how the eviction tests simulate a cold isolate — so the purge belongs in
  `afterEach`, not in `_resetCrawlerListStateForTests()`. Added
  [`_purgeCrawlerCacheForTests()`](src/crawler-list-status.mjs) and awaited it between cases.
  209 tests pass, the same 209 as before the upgrade.

## 1.13.1 - 2026-08-17

**Headline:** R6c toolchain refresh.

### Changed

- **Lockfile updated within declared ranges.** 209 tests, dry-run build, 109/109 registry
  signatures verified, 52 attested. R6c gate condition 1.

All notable changes to sn-rights-signals are documented here.

### 1.13.0 - 2026-08-13 - the auto-deploy starts saying which build it is

Found from the WordPress side: Measurement → Machine Readers showed **"Sensor unreachable"** while
every other indicator on the tab was green and the data below was current to the same day. The
sensor was fine. `/_sn/rights-signals/version` answered HTTP 200 in 0.13s with `ae_bound: true` —
and `version: null`.

**A git-connected worker never runs its own `deploy` script.** Workers Builds executes its own
deploy command, defaulting to `npx wrangler deploy`. The `--var SN_VERSION:$npm_package_version`
that names the build lives only in the `deploy` script, so every automatic deploy shipped with the
variable unset and the endpoint honestly reported that it did not know its own version.

`deploy:ci` is that command, made explicit and pointed at by the dashboard Deploy command. It is a
**separate script from `deploy` on purpose**: `deploy` carries a `postdeploy` hook that probes the
live URL and waits for a version to appear, which inside a build container either hangs or fails
the build.

The commit comes from `WORKERS_CI_COMMIT_SHA`, injected by Workers Builds, and falls back to
`git rev-parse HEAD` so the same script still works when run by hand. Cloudflare documents that
variable as injected into the *build* process and does not explicitly promise it to the *deploy*
command — the fallback means the script is correct either way rather than resting on that reading.

**`source_commit` is now in the version response.** Setting a deploy var that nothing reads back is
inert: it looks identical whether it was plumbed correctly or not. The field is what makes the
change verifiable, so it ships with it rather than after it.

Both fields stay `null` when a deploy did not pass them. A null means *this deploy did not say*,
never *the sensor is down* — a distinction the reader on the WordPress side was collapsing, which is
what produced the false "unreachable" in the first place. That half is fixed separately in the
plugin.

### 1.12.0 - 2026-08-11 - the surface names the agent, and its own traffic

**Taxonomy 1.3.0.** Both changes come from one afternoon in Workers Logs, chasing two questions the
dataset could not answer about itself.

#### The exact agent, stored

`vp.id` now rides as blob9 and comes back as `agent`. Answering *"was the 8 August sweep GPTBot or
ChatGPT-User?"* meant leaving the dataset for the Cloudflare dashboard, where logs live 7 days.
Analytics Engine keeps 90. The agent id closes that gap: the next question of that shape is
answerable from the sensor, and the answer survives thirteen times longer.

For the record, that sweep was **GPTBot**. Over 4 to 11 August OpenAI's agents split GPTBot 670,
ChatGPT-User 240, OAI-SearchBot 160, so **37% of what the frozen `openai` family reports as
AI-training is not training at all.**

#### Five first-party agents, flagged

Every one of the top ten readers of the rights surfaces turned out to be this site's own tooling:
the hourly smoke test (330), the Worker's post-deploy gate (120), the plugin's anchor and drift
probes, the provenance integrity checker, and the ledger verifier. Most matched no frozen family, so
they recorded nothing and the surface could not say the rights-read count was self-traffic.

They are now `first_party: true`, which existing code already excludes from headline totals.

**curl is deliberately NOT flagged.** The 63 `other-bot` rights reads on 9 August were almost
certainly the owner hand-testing during that day's deploys, but curl is a generic client and
flagging it first-party would silently discard real third-party traffic. It stays `dev`.

202 tests pass.

### 1.11.1 - 2026-08-11 — the unknown-agent review pays for itself in 40 minutes

**Taxonomy 1.2.0, effective 2026-08-11.** Data-only; no code change.

Forty minutes after v1.11.0 went live, the RULE 2 unknown-agent view returned exactly one string:
`Amzn-SearchBot/0.1`. Following it up found that **Amazon documents three agents on one page**, not
one:

| Agent | Purpose | Trains? |
| --- | --- | --- |
| `Amazonbot` | improve products and services | *"may be used to train Amazon AI models"* |
| `Amzn-SearchBot` | search experiences, incl. Alexa | explicitly **no** |
| `Amzn-User` | user-initiated live fetches | explicitly **no** |

Neither new token is matched by the frozen `/amazonbot/i` family: `Amzn-SearchBot` lands in
`other-bot`, `Amzn-User` is not recorded at all without `unclassified-machine`. Same shape as
Claude-SearchBot and facebookexternalhit, found the same way the file predicted it would be.

**`Amazonbot` is RECLASSIFIED `search` → `train`.** The 1.0.0 filing rested on Amazon leading with
product improvement while hedging training as *"may be used"*. That reading does not survive a
dedicated `Amzn-SearchBot` existing: with search and user-directed fetching carved into their own
agents, the only AI purpose Amazonbot still declares is training. Filing it `search` double-booked a
purpose Amazon assigns elsewhere and buried the signal the rights claim turns on.
`training_corpus_source` stays true either way, which is the boolean doing its job.

Honest note on how this was missed: v1.11.0 fetched this exact page and asked only what *Amazonbot*
was for. The page answered the question asked. Asking it to enumerate every token surfaced all three.

Rows written under 1.1.0 keep `taxonomy_version: "1.1.0"`, so a window spanning the change reports
`mixed` rather than being silently restated. 196 tests pass.

### 1.11.0 - 2026-08-10 — vendor and purpose, on two new axes beside a frozen one

> **Taxonomy 1.1.0** (bumped from 1.0.0 before first deploy, on further verification):
> `cohere-ai` moves from `train` to `unknown` — Cohere publishes no crawler page and the purpose is
> explicitly *unconfirmed* across training collection, index building and an unannounced
> experiment, so filing `train` asserted one of three. `Diffbot-User` splits out of `Diffbot`
> (Diffbot documents both; the frozen `/diffbot/i` family swallows the pair). And `ads` joins the
> vocabulary as a thirteenth value so `OAI-AdsBot` and `meta-externalads` are not stretched into
> `security`.

The sensor could say *which crawler family* read a surface. It could not say **why**, and purpose is
the axis the published claims actually run along. 73% of 30 days of reads sat in two buckets that
answer nothing: `uptime` 6,403 and `other-bot` 6,295, of 17,463.

**`family` is frozen. Nothing in this release changes what any existing family value means or which
requests it counts.** A published number depends on the old definition and the field has moved
underneath a published figure once already. `MACHINE_FAMILIES` now carries a DO-NOT-EDIT banner
saying so, including that two of its entries are known-wrong and stay wrong deliberately.

#### The taxonomy is data

`src/machine-reader-taxonomy.json` — versioned (`1.1.0`), dated (`2026-08-10`), and served verbatim
and unauthenticated at **`GET /_sn/rights-signals/taxonomy`**. Every entry carries a match token, a
vendor, a purpose from a closed thirteen-value vocabulary, the URL of the vendor's own published
declaration, a `declared` flag separating first-party declarations from third-party inference, and a
note wherever the call is contested. `src/taxonomy.mjs` is a loader and a matcher; it holds no
classification decisions.

Vendor and purpose are matched **independently against the raw User-Agent** and never derived from
`family`. That is what lets `Claude-SearchBot` keep `family=other-bot` — exactly as it has counted
since v1.4.0 — while becoming visible as `anthropic` / `search`.

#### What the vendors' own docs said that the code did not

Verified against each vendor's page, not from memory:

- **`Claude-SearchBot` was never matched.** `/claudebot|claude-web|claude-user/i` does not contain
  it; Anthropic's search crawler has been counting as `other-bot` since v1.4.0.
- **`facebookexternalhit` was never recorded at all** — no bot/crawler/spider substring, so the
  classifier returned `null` and Meta's unfurler was treated as a human. Same for `meta-webindexer`,
  Slackbot, WhatsApp and `ia_archiver`.
- **`Google-CloudVertexBot` and `OAI-AdsBot`** fall to `other-bot`.
- **`Applebot-Extended` does not crawl.** Apple documents it as a robots.txt control token only, so
  the `apple-ai` family reports a phantom: any non-zero count is spoofed or synthetic. The requested
  Apple train/search split is not measurable from request logs, and the file says so.
- **Two live over-counts, both inside the published AI-training set**: `google-ai` matches
  `googleother`, which Google documents as a *generic* crawler; and `/mistralai/i` swallows
  `MistralAI-Index` and `MistralAI-User`, both of which Mistral states are **not** used for training.
  The families stay wrong (frozen); `purpose` is now the honest reading, and three tests pin the
  disagreement so it is deliberate rather than unnoticed.

#### The ambiguous cases, decided

- **CCBot → `archive`, `training_corpus_source: true`.** Common Crawl's own declaration is an open
  repository, not model training; its role as a training corpus is a fact about consumers, not the
  operator's stated purpose. The boolean exists for exactly this.
- **Amazonbot → `search`, `training_corpus_source: true`.** Amazon leads with product and service
  improvement and hedges training as *"may be used"*. Filing it `train` would overstate a hedged
  claim. Same treatment as CCBot, so the two are comparable.
- **Every `*-User` agent is `user`, never `train`** — pinned by test, since this is the call that
  would most overstate the published number.

#### One additive family value

`unclassified-machine` carries only rows the frozen classifier would have **dropped entirely**. No
existing family value changes meaning or population, so any query filtering the original 18 families
returns bit-identical results across the cutover.

#### RULE 2 — the unknown bucket becomes reviewable

`GET /_sn/rights-signals/machine-readers?view=unknown` returns the top 50 unclassified user-agent
strings by volume, so the taxonomy can be extended from evidence. **This narrows one clause of the
v1.4.0 privacy contract**, deliberately: a sanitised UA sample is now stored for requests the
taxonomy did not match. Strict character **allowlist** (`[A-Za-z0-9._/+ -]`) plus a 96-character cap,
so the stored value cannot carry markup, quotes, backslashes or control bytes at all, and the admin
lane escapes it again. Recognised agents still store nothing but their enum values. The posture moves
from *safe by construction* to *safe by sanitisation and escaping* — a real, bounded loss, recorded
here rather than discovered later.

#### RULE 3 — full fidelity where the claim lives

A second dataset, `sn_machine_readers_rights` (binding `SN_MR_RIGHTS`), keeps the complete User-Agent,
path, `Accept` header and timestamp for **rights-surface reads only** — 80 events in 30 days, ~0.5% of
the dataset. Defensible because it is rare, because rights surfaces are a closed set of four fixed
URLs whose path leaks nothing about who asked, and because "do the declared AI-training crawlers read
the rights declarations?" is not answerable from an aggregate. Read via `?view=rights`. Never summed
with the aggregate stream.

#### Schema

Checked against Cloudflare's documented limits before adding a field: 20 blobs, 20 doubles, **exactly
one index**, 96 bytes per index, 16 KB of blobs, three-month retention. The aggregate row goes from 2
blobs to 8 of 20 — it fits, and no dimension was dropped. The binding constraint is the single index:
`indexes: [family]` stays, so `purpose` cannot also be indexed. That costs sampling granularity on the
purpose axis, not queryability.

#### Also

`taxonomy_version` rides both the response envelope and every row, so a window spanning a definition
change is visibly mixed rather than quietly so. `first_party` flags the site's own Better Stack
monitor — 6,403 reads, 37% of the total, the site measuring itself — so headline totals can exclude
it instead of silently carrying it. Truncated views report their own `limit`.

Load-time validation rejects an unknown purpose, a duplicate id, a non-lowercase match token, and the
ordering bug where a generic token shadows a specific one declared later. All four were confirmed to
fire by mutating the file and re-running the suite; the first is the one that would otherwise make an
entire vendor split silently unreachable. 194 tests pass.

### 1.10.3 - 2026-08-09 — the check learns about /llms.txt

**Tooling only — no `src/` change, nothing to deploy.**

A concurrent session found `/llms.txt` announcing *"AI training permitted with attribution"* — the
exception stated as the rule. A machine reading only that file, which is the reader it exists for,
takes away a permission and never learns the default is **no**. They fixed it. **This check would
not have caught it**, and that is the interesting part: 39 invariants covered headers, robots.txt,
tdmrep.json, license.xml, both policy representations, `/ns/tdm` and a note — and said nothing about
a file that makes substantive claims about the licence position in prose.

The blind spot had a shape: `/llms.txt` is **WordPress-owned prose**, not a Worker surface, so it
fell outside the boundary every other assertion here draws. The Worker knows the path exists —
`machine-readers.mjs` classifies it as a surface class — and never looked at what it says.

#### The invariant

If `/llms.txt` mentions training at all, the **list item making that claim** must also carry
reservation or conditioning language, and the file must link both the policy and `license.xml`.
Silence on the subject is not a misstatement and passes.

Deliberately loose on wording, strict on substance: this is hand-written prose that will be
reworded, and a brittle check gets deleted the first time it cries wolf.

#### Three versions of this check were killed by its own mutation test

Worth recording, because each failure was the regex being looser than the intent:

1. `/reserv/` **document-wide** — passed on the gutted bullet, because a *later* bullet contained
   the word "reservation". Document-wide presence is not a statement about the claim being made.
2. A **±160-character window** — passed too, since adjacent bullets sit inside it.
3. Per-bullet, but with an unanchored `/condition/` — **matched "unconditionally"**, which is the
   opposite meaning.

Now: per list item, with `\bconditions?\b`. The unit of a claim is the sentence making it, not the
document and not a character radius. Without the mutation test, all three would have shipped looking
green.

#### Static vs live

`/llms.txt` is proxied, not synthesized, so the static run checks the **assertion logic** against a
stub modelled on the live Rights block, and the live run checks the **content**. The two mutations
are what give the static half its value.

**40 invariants, 22 mutations.** Verified against production: `all 40 checks passed`.

> **Why PATCH:** an addition to a development tool. No published artifact changed.

### 1.10.2 - 2026-08-09 — §6 stops over-promising the anchoring

**Policy prose 1.1 → 1.2. DO NOT DEPLOY BEFORE THE 19:00 UTC SWEEP** — see the sequencing note below.

§6 claimed: *"Each published version of this policy is cryptographically timestamped into the
OpenTimestamps ledger."* That is false, and this stack produced the counterexample within hours of
publishing it. **Version 1.0 was live for about twenty minutes and was replaced before the hourly
sweep could fire**, so it carries no anchor.

The over-claim sat in the one section of the document that talks about *evidence*, which is the
worst place in it to carry one.

#### The correction

§6 now separates the guarantee from its limit:

- **Guaranteed:** superseded versions keep their anchors, and no version is ever silently rewritten
  in place — a change to the terms produces a new version rather than an edit to a published one.
  The substantive commitment is untouched; weakening an over-claim must not quietly weaken the
  promise underneath it.
- **Not guaranteed:** anchoring runs on a periodic sweep, not at publication, so a version published
  and superseded *within a single sweep interval* may carry no anchor of its own. Every version in
  force across a sweep is anchored.

#### The gap is recorded, not left to be found

The appendix names version 1.0 explicitly: when it was published and superseded, and **what
differed** — §5's pointer table did not yet list `/ns/tdm`, and no term in §1, §2 or §3 differed at
all. An unexplained missing anchor invites the reading that terms changed unrecorded; naming the
difference forecloses it. Better for the document to explain the gap than for a reader to discover
it by going looking for an anchor that isn't there.

#### Pinned by tests

Three assertions (157 total): that §6 no longer carries the old "each published version" sentence,
that it states both the sweep-interval limit and what survives it, and that the appendix records the
instance *with* what differed. Prose that is only correct until someone tidies it is not correct.

#### Sequencing — why this must not deploy yet

Policy 1.1 is **currently unanchored**: it went live at 18:32 UTC and the 19:00 sweep has not run.
Deploying 1.2 before that sweep would supersede 1.1 inside its own interval and leave **two**
consecutive unanchored versions — while shipping the very section that explains why that happens.
Self-consistent, and absurd.

Hold until `/_sn/status` shows a `last_cron` after 19:00 with 1.1 anchored, then deploy. Costs
nothing; there is no deploy in flight.

> **Why PATCH:** a correction to published prose. No permission, value, route or representation
> changed.

### 1.10.1 - 2026-08-09 — the deploy gate stops crying wolf, second cause

**No `src/` change — nothing to deploy.** Tooling only; the fix is live for the next `npm run deploy`
from this checkout.

The v1.10.0 deploy produced a second false red, from a cause v1.9.1's version poll does not cover:
`/ns/tdm` answered correctly on the plain request and **404'd on the `ld+json` one, in the same
parallel batch, milliseconds apart.** Both were correct within a minute, and the full check passed
39/39 immediately after.

#### Why version-matching was not enough

Propagation is per-colo, and the ten artifact fetches go out in parallel. Matching the version at
one endpoint proves that endpoint's colo is current; it proves nothing about the colo that serves
the next request. A **brand-new route** is the worst case, because the pre-deploy 404 can still be
cached at an edge the version poll never touched — which is exactly what `/ns/tdm` was.

`--fresh` did not save it either: revalidation asks an edge to check with the origin, and an edge
that has not yet learned the route exists is not an edge that will discover it mid-request.

#### The fix

A deploy run re-collects and re-checks up to **3 times**, 8s apart, before believing a failure. Each
retry names what failed and why it is retrying, so a retry can never be mistaken for the tool
quietly hiding something.

**This does not weaken the gate.** A genuine defect fails every attempt and is still reported — with
`still failing after 3 attempts over ~16s — this is drift, not propagation`, so the report says which
of the two it concluded. The cost is ~16 seconds on a run that was going to fail anyway. What it
removes is the failure mode where a real problem gets waved through because the gate has cried wolf
twice in one afternoon.

**A plain `check:live` retries nothing.** Retries are keyed to `--await-version`, which only
postdeploy passes. With no deploy in flight a failure is a fact about the live site, and retrying
until it passes would be the tool lying on the site's behalf.

#### Verified, all three paths

| Run | Result |
|---|---|
| deploy mode, healthy | passes on attempt 1, no retry noise |
| deploy mode, genuinely broken artifact | retries 2×, then `1 of 39 FAILED` + "this is drift, not propagation", **exit 1** |
| plain drift check, same broken artifact | **zero** retries, exit 1 |

> **Why PATCH:** a fix to a development tool. No published artifact changed and no consumer of this
> Worker can observe it.

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
