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
wildcard, so it never shadows them.

| Path | Behavior |
|---|---|
| `GET /robots.txt` | Proxies to origin, appends a `License:` directive pointing at `/license.xml`. Cannot touch the `Content-Signal` line — see "Known limitation" below. |
| `GET /.well-known/tdmrep.json` | Worker-owned TDMRep well-known expression. |
| `GET /license.xml` | Worker-owned RSL 1.0 licence document. |
| `GET /tdm-policy(/)` | Worker-rendered placeholder page (real terms pending counsel). |
| `GET /wp-json/*` | Proxies to origin, adds `TDM-Reservation` / `TDM-Policy` headers. |
| Everything else | Proxies to origin. If `content-type` is `text/html`, adds the same two headers and injects `<meta name="tdm-reservation">` / `<meta name="tdm-policy">` into `<head>` via `HTMLRewriter`. Non-HTML (images, CSS, JS) passes through unmodified. |
| `GET /_sn/rights-signals/version` | Deploy verification, mirrors the sibling workers' `/_sn/version` pattern (namespaced because sn-analytics already owns the bare path). |

## Known limitation: `Content-Signal: ai-input=yes`

Empirically verified (2026-07-23): this Worker's own `fetch(request)` call
for `/robots.txt` only ever reaches WordPress's bare origin file. Cloudflare's
managed content-signals feature — the Article 4 preamble, the `Content-Signal`
line, and the named-crawler `Disallow` block — is injected by a layer that
wraps AROUND whatever this Worker returns, after the Worker runs. That means:

- Text appended by this Worker lands after the origin's content, which is
  exactly where the final composed file's tail ends up (confirmed live —
  this is how the `License:` directive gets in).
- The managed `Content-Signal` line itself is never visible to this Worker
  and can never be edited from here, no matter what the Worker returns.

Cloudflare's dashboard doesn't expose an `ai-input` toggle either (as of
2026-07-23) — "Managed robots.txt" only controls `search` / `ai-train`. The
existing custom-directive mechanism (used to inject the Article 4 paragraph
into the preamble) only adds text *above* the managed block, which can't
override a field *inside* it. There is currently no way — worker, dashboard,
or custom directive — to make `ai-input=yes` live. This needs Cloudflare to
ship the control; track their AI Crawl Control changelog.

## Development

```bash
npm install
npm test        # real workerd runtime via @cloudflare/vitest-pool-workers
npm run deploy   # wrangler deploy --var SN_VERSION:$npm_package_version
```
