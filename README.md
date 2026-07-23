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
| `GET /robots.txt` | **Full ownership**, not a patch — generates the entire content-signals block itself (`Content-Signal: search=yes,ai-train=no,ai-input=yes,use=reference`, the Article 4 preamble, the named-crawler `Disallow` list), appends whatever WordPress's own origin file contributes, then a `License:` directive. See `src/robots-block.mjs`. |
| `GET /.well-known/tdmrep.json` | Worker-owned TDMRep well-known expression. |
| `GET /license.xml` | Worker-owned RSL 1.0 licence document. |
| `GET /tdm-policy(/)` | Worker-rendered placeholder page (real terms pending counsel). |
| `GET /wp-json/*` | Proxies to origin, adds `TDM-Reservation` / `TDM-Policy` headers. |
| Everything else | Proxies to origin. If `content-type` is `text/html`, adds the same two headers and injects `<meta name="tdm-reservation">` / `<meta name="tdm-policy">` into `<head>` via `HTMLRewriter`. Non-HTML (images, CSS, JS) passes through unmodified. |
| `GET /_sn/rights-signals/version` | Deploy verification, mirrors the sibling workers' `/_sn/version` pattern (namespaced because sn-analytics already owns the bare path). |

## robots.txt ownership: how we got here, and the tradeoff it accepts

Empirically verified (2026-07-23): this Worker's own `fetch(request)` call
for `/robots.txt` only ever reached WordPress's bare origin file. Cloudflare's
managed content-signals feature wraps its own block AROUND whatever a Worker
returns, after the Worker runs — so a Worker could append text (that's how
the `License:` directive landed originally) but could never *edit* the
managed `Content-Signal` line to add `ai-input=yes`. Cloudflare's dashboard
didn't expose an `ai-input` toggle either. Filed as product feedback; not
worth waiting on.

Instead, as of `v1.1.0`, this Worker took full ownership: it generates the
entire managed-look-alike block itself (`src/robots-block.mjs`), defensively
stripping a still-active Cloudflare block out of the origin fetch if the
owner hasn't disabled "Managed robots.txt" in the dashboard yet (so the two
never end up duplicated during the transition), and appends WordPress's own
tail content after it.

**The tradeoff this accepts:** the named-crawler `Disallow` list
(Amazonbot, Applebot-Extended, Bytespider, CCBot, ClaudeBot,
CloudflareBrowserRenderingCrawler, Google-Extended, GPTBot,
meta-externalagent) is a **hand-maintained snapshot** of what Cloudflare's
managed feature was serving live as of 2026-07-23, not an auto-updating
feed. If Cloudflare adds a new AI crawler to their managed default, this
list will not pick it up automatically — diff it against
[Cloudflare's managed-robots-txt docs](https://developers.cloudflare.com/bots/additional-configurations/managed-robots-txt/)
periodically (or once Cloudflare ships an `ai-input` API/dashboard control,
consider reverting to the patch approach and re-enabling their managed
feature).

## Development

```bash
npm install
npm test        # real workerd runtime via @cloudflare/vitest-pool-workers
npm run deploy   # wrangler deploy --var SN_VERSION:$npm_package_version
```
