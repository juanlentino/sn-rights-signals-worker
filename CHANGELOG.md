# Changelog

All notable changes to sn-rights-signals are documented here.

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
