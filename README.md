# sn-rights-signals

Cloudflare Worker that expresses one machine-readable rights position across
every relevant surface of juanlentino.com: search indexing permitted, AI
retrieval/grounding permitted and invited, AI training reserved under
Article 4 of EU Directive 2019/790 with a conditional attribution licence
offered on top of that reservation. Policy signals only — no theme or plugin
logic. See the project's `machine-readable-rights-signals` session notes for
the full brief and rationale.

## Routes

Bound to a single wildcard route (`juanlentino.com/*`) and does its own
pathname dispatch — see `src/index.mjs`. More-specific Cloudflare routes on
the sibling workers (sn-analytics, sn-login-guard) take precedence over this
wildcard, so it never shadows them. Auth-critical WordPress surfaces
(`/wp-admin`, `/wp-login.php`, `/xmlrpc.php`, `/wp-cron.php`) bypass every
other check immediately — see `src/admin-bypass.mjs` — so a regression in
this Worker's own logic can never be the thing that breaks login or the
admin dashboard.

| Path | Behavior |
|---|---|
| `GET /robots.txt` | Proxies to origin, appends a `License:` directive. Cannot touch `Content-Signal` — see "robots.txt ownership" below. |
| `GET /.well-known/tdmrep.json` | Worker-owned TDMRep well-known expression. |
| `GET /license.xml` | Worker-owned RSL 1.0 licence document. |
| `GET /tdm-policy(/)` | Worker-rendered placeholder page (real terms pending counsel). |
| `GET /wp-json/*` | Proxies to origin, adds `TDM-Reservation` / `TDM-Policy` headers. |
| Everything else | Proxies to origin. If `content-type` is `text/html`, adds the same two headers and injects `<meta name="tdm-reservation">` / `<meta name="tdm-policy">` into `<head>` via `HTMLRewriter`. Non-HTML (images, CSS, JS) passes through unmodified. |
| `GET /_sn/rights-signals/version` | Deploy verification, mirrors the sibling workers' `/_sn/version` pattern (namespaced because sn-analytics already owns the bare path). |

## robots.txt ownership: what was tried, why it doesn't work yet

Empirically verified (2026-07-23), twice, with a debug endpoint dumping the
exact bytes each layer sees: this Worker's own `fetch(request)` call for
`/robots.txt` only EVER reaches WordPress's bare origin file — it never sees
Cloudflare's managed content-signals block, **regardless of whether
"Managed robots.txt" is on or off in the dashboard**. Meanwhile, the FINAL
response this Worker returns to the client gets Cloudflare's block
prepended unconditionally whenever that dashboard toggle is on — including
a response that already contains a hand-authored look-alike block, which
produces two conflicting `Content-Signal` lines rather than replacing
Cloudflare's. This shipped live for a few minutes on 2026-07-23 (`v1.1.0`)
before being reverted (`v1.1.1`).

**The conclusion:** there is no signal available to Worker code that
distinguishes "safe to compose our own block" from "will get double-wrapped."
Full ownership (`src/robots-block.mjs`'s `fullRobotsTxt`/`originTail`, kept
and tested but not wired into `robots.mjs`) can only go live as a **manual**
code change, made AFTER the owner confirms "Managed robots.txt" is disabled
in the Cloudflare dashboard — see `robots.mjs`'s comment for the exact
one-line swap. Until then, `/robots.txt` stays in the safe v1.0.0-era mode:
append `License:`, touch nothing else, and `Content-Signal: ai-input=yes`
stays unset. Filed as Cloudflare product feedback in the meantime — see
session notes.

**The tradeoff full ownership will accept, once it's safe to enable:** the
named-crawler `Disallow` list (Amazonbot, Applebot-Extended, Bytespider,
CCBot, ClaudeBot, CloudflareBrowserRenderingCrawler, Google-Extended,
GPTBot, meta-externalagent) baked into `robots-block.mjs` is a
**hand-maintained snapshot** of what Cloudflare's managed feature was
serving live as of 2026-07-23, not an auto-updating feed — diff it against
[Cloudflare's managed-robots-txt docs](https://developers.cloudflare.com/bots/additional-configurations/managed-robots-txt/)
periodically once it's in use.

## Development

```bash
npm install
npm test        # real workerd runtime via @cloudflare/vitest-pool-workers
npm run deploy   # wrangler deploy --var SN_VERSION:$npm_package_version
```
