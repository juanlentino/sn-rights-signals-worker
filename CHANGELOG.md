# Changelog

All notable changes to sn-rights-signals are documented here.

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
