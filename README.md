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
| `GET /robots.txt` | **Full ownership** — generates the entire content-signals block itself (`Content-Signal: search=yes,ai-train=no,ai-input=yes,use=reference`, the Article 4 preamble, the named-crawler `Disallow` list), appends whatever WordPress's own origin file contributes, then a `License:` directive. See "robots.txt ownership" below for why this took two tries. |
| `GET /.well-known/tdmrep.json` | Worker-owned TDMRep well-known expression. |
| `GET /license.xml` | Worker-owned RSL 1.0 licence document. |
| `GET /tdm-policy(/)` | Worker-rendered placeholder page (real terms pending counsel). |
| `GET /wp-json/*` | Proxies to origin, adds `TDM-Reservation` / `TDM-Policy` headers. |
| Everything else | Proxies to origin. If `content-type` is `text/html`, adds the same two headers and injects `<meta name="tdm-reservation">` / `<meta name="tdm-policy">` into `<head>` via `HTMLRewriter`. Non-HTML (images, CSS, JS) passes through unmodified. |
| `GET /_sn/rights-signals/version` | Deploy verification, mirrors the sibling workers' `/_sn/version` pattern (namespaced because sn-analytics already owns the bare path). |

## robots.txt ownership: what was tried, and where it landed

Empirically verified (2026-07-23), twice, with a debug endpoint dumping the
exact bytes each layer sees: this Worker's own `fetch(request)` call for
`/robots.txt` only EVER reached WordPress's bare origin file — it never saw
Cloudflare's managed content-signals block, regardless of whether "Managed
robots.txt" was on or off in the dashboard. Meanwhile, the response this
Worker returned to the client got Cloudflare's block prepended
unconditionally whenever that dashboard toggle was on — including a
response that already contained a hand-authored look-alike block, which
produced two conflicting `Content-Signal` lines rather than replacing
Cloudflare's. This shipped live for a few minutes on 2026-07-23 (`v1.1.0`)
before being reverted (`v1.1.1`): there was no signal available to Worker
code that distinguished "safe to compose our own block" from "will get
double-wrapped," so full ownership could only go live as a manual code
change made AFTER the toggle was actually disabled — not something a
Worker could ever detect or force itself.

**Resolved in `v1.2.0`:** the owner disabled "Managed robots.txt" in the
Cloudflare dashboard for juanlentino.com, and `robots.mjs` was flipped to
call `fullRobotsTxt(originTail(body))`. `Content-Signal: ai-input=yes` is
live. `originTail()` still defensively strips a Cloudflare block out of the
origin fetch as belt-and-suspenders, in case the toggle is ever re-enabled
by mistake — though that alone wouldn't be enough; see `robots.mjs`'s
comment for what "still wrapped" looks like and how to revert (`git log`
`v1.1.1`).

**The tradeoff this accepted:** the named-crawler `Disallow` list
(Amazonbot, Applebot-Extended, Bytespider, CCBot, ClaudeBot,
CloudflareBrowserRenderingCrawler, Google-Extended, GPTBot,
meta-externalagent) baked into `robots-block.mjs` is a **hand-maintained
snapshot** of what Cloudflare's managed feature was serving live as of
2026-07-23, not an auto-updating feed. Diff it against
[Cloudflare's managed-robots-txt docs](https://developers.cloudflare.com/bots/additional-configurations/managed-robots-txt/)
periodically — a periodic sync/diff job (instead of a fully manual check)
is a reasonable follow-up if this drifts in practice.

## Development

```bash
npm install
npm test        # real workerd runtime via @cloudflare/vitest-pool-workers
npm run deploy   # wrangler deploy --var SN_VERSION:$npm_package_version
```
