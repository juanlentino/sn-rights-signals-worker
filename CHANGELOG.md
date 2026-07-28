# Changelog

All notable changes to sn-rights-signals are documented here.

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
