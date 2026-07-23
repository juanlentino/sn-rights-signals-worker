# Changelog

All notable changes to sn-rights-signals are documented here.

## [1.1.0] - 2026-07-23

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
