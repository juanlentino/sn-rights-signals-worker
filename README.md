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
the sibling workers (sn-analytics, sn-login-guard, sn-provenance) take
precedence over this wildcard, so it never shadows them. Auth-critical
WordPress surfaces (`/wp-admin`, `/wp-login.php`, `/xmlrpc.php`,
`/wp-cron.php`) bypass every other check immediately — see
`src/admin-bypass.mjs` — so a regression in this Worker's own logic can
never be the thing that breaks login or the admin dashboard.

| Path | Behavior |
|---|---|
| `GET /robots.txt` | **Full ownership** — generates the entire content-signals block itself (`Content-Signal: search=yes,ai-train=no,ai-input=yes,use=reference`, the Article 4 preamble, the named-crawler `Disallow` list), appends whatever WordPress's own origin file contributes, then a `License:` directive. See "robots.txt ownership" below for why this took two tries. |
| `GET /.well-known/tdmrep.json` | Worker-owned TDMRep well-known expression. |
| `GET /license.xml` | Worker-owned RSL 1.0 licence document. |
| `GET /tdm-policy(/)` | Worker-rendered policy document, **content-negotiated**: `text/html` by default, an ODRL policy in the W3C TDMRep profile (`application/ld+json`) when a client explicitly asks. `Vary: Accept` on both — the operative terms every other layer points at. Terms in `src/tdm-policy-terms.mjs`, shell in `src/tdm-policy-page.mjs`. Currently `POLICY_STATUS = "draft"` (see below). |
| `GET /wp-json` and `/wp-json/*` | Proxies to origin, adds `TDM-Reservation` / `TDM-Policy` headers. |
| Everything else | Proxies to origin. If `content-type` is `text/html`, adds the same two headers and injects `<meta name="tdm-reservation">` / `<meta name="tdm-policy">` into `<head>` via `HTMLRewriter`. Non-HTML (images, CSS, JS) passes through unmodified. |
| `GET /_sn/rights-signals/version` | Deploy verification, mirrors the sibling workers' `/_sn/version` pattern (namespaced because sn-analytics already owns the bare path). |
| `GET /_sn/rights-signals/crawler-list-status` | Last result of the weekly crawler-list drift check (see below). Isolate-memory, best-effort — resets on redeploy/eviction. |
| `GET /_sn/rights-signals/machine-readers` | Token-auth read path for the machine-readership dataset (`Authorization: Bearer <SN_MR_READ_TOKEN>`). `?days=N` clamped to 1–90, default 30. Queries the Analytics Engine SQL API; 503 when the read secrets aren't configured. |

## The policy document, and its draft state

`/tdm-policy/` is the human-readable end of the chain: the `TDM-Policy` header,
`tdmrep.json`'s `tdm-policy` field and `license.xml`'s attribution `<standard>`
all resolve here. It is Worker-synthesized rather than a WordPress page on
purpose — if WordPress is down or the page gets unpublished, the URL every
signal names must still answer with terms.

Three constants in `src/constants.mjs` govern it: `POLICY_VERSION`,
`POLICY_DATE`, `POLICY_STATUS`.

**Two representations, one URL.** TDMRep treats a policy as machine-readable only
when served as `application/(ld+)json`, so `src/tdm-policy-odrl.mjs` serves an
ODRL policy in the TDMRep profile from the same address — modelled on Springer
Nature's production policy, not invented here. `search` and `ai-input` are
permissions with no duty; `ai-train` carries an ODRL `attribute` duty, which is
ODRL's own name for a pre-condition on a permission. Negotiation is
conservative: HTML unless JSON is named explicitly, because crawlers send `*/*`
and must get the human terms, not the machine ones.

**It is in force, and it is self-drafted.** `POLICY_STATUS = "published"` since
v1.9.0. It has not been reviewed by a lawyer and the page says so on its face —
that assertion is checked in *both* status branches, so a future promotion
cannot quietly drop it. Drafting risk is reduced by borrowing rather than by
review: C1 incorporates **CC BY 4.0 §3(a)** as the definition of adequate
attribution.

**The line that must not move.** Incorporating §3(a) as a *standard* is not
licensing this content under CC BY 4.0. CC BY grants rights in the licensed
*material*, not in a *use*, so it cannot be narrowed to "training only" and stay
CC BY — a party accepting it would acquire reproduction, adaptation and
commercial redistribution of whole works. §2 therefore incorporates one clause
and names the reserved uses explicitly. `license.xml` deliberately does **not**
name the CC URL as its governing `<standard>` even though RSL's guide shows that
pattern: §3(a) alone is met by a model card and C2 is not, so a parser reading
the CC URL as the whole term would let a licensee satisfy the file while failing
the licence. One invariant in the check asserts this boundary across all three
layers.

**C2 is stricter than §3(a) on purpose** and is labelled `beyond §3(a)` in the
document. That is the one place borrowing CC would have weakened the position.

**If CC Signals ships,** revisit: it is the purpose-built framework for this and
was still in development at v1.9.0.

Editing the terms is a legal change, not an editorial one. The drafting rules
are at the top of `src/tdm-policy-terms.mjs`; read them first.

## Rights-signal check

`scripts/rights-assertions.mjs` holds 31 invariants across all four layers —
headers on HTML *and* `/wp-json`, the robots.txt `Content-Signal`, `tdmrep.json`
parsing and matching the header, `license.xml` parsing and licensing what it
should, the policy page's sections and draft state, and the meta tags on a real
note. Two ways to run it:

```bash
npm test          # STATIC: included in the suite; drives the real Worker
                  # over a stubbed origin and checks the composed output
npm run check:live   # LIVE: fetches juanlentino.com and checks what is served
```

`npm run deploy` runs the live check automatically afterwards (`postdeploy`), so
a deploy that breaks the stack fails loudly. Exit 0 = consistent, 1 = drifted,
**2 = could not verify** — unreachable, or the expected version never went live.
Deliberately a different code: unverified is not a pass.

Two flags matter, and both exist because v1.9.0's deploy produced a 9-of-36
**false red**:

- `--await-version <v>` polls `/_sn/rights-signals/version` (which is
  `no-store`) until the Worker reports that version, instead of sleeping a
  guessed number of seconds. Opt-in, never inferred from `npm_package_version`,
  or `check:live` would refuse to run whenever main is ahead of production.
- `--fresh` sends `cache-control: no-cache`. `license.xml` and `tdmrep.json` are
  served `max-age=3600`, so a colo can return an hour-old copy long after the
  Worker updated — version-matching alone does **not** catch that. Not the
  default: without it the tool measures what a crawler actually receives, which
  is the honest question for a drift check. The report header names which mode
  ran.

Two things worth knowing:

- **The assertions compare layers against each other**, not each against the
  constant that produced it — `tdmrep.json`'s policy URL against the *header*,
  robots.txt's `Content-Signal` against the *header* value byte for byte. A
  guard sharing its producer's constant can only catch a typo, never a partial
  deploy.
- **A green static run is not a green live run.** Static proves the layers agree
  as composed; it cannot see an undeployed Worker, an edge rule, or a stale
  cache. The deploy gate is the live one.

The note URL is **discovered** from `/wp-sitemap.xml` at run time, not pinned —
a hardcoded slug rots the day a note is renamed, and a rotted fixture reads as
rights drift. `--note <url>` and `--origin <url>` override for staging.

## Machine-readership sensor

`src/machine-readers.mjs` observes every non-`/_sn/` request on the way
through: when the User-Agent classifies into the fixed crawler-family enum
(OpenAI, Anthropic, Perplexity, search, feed, …), it writes one aggregate
datapoint to the Analytics Engine dataset **`sn_machine_readers`** — blobs
`[family, surface]`, one count, nothing else. Humans (browser UAs) and
internal `/_sn/` paths are never recorded; the raw User-Agent never leaves
the module. Observation is fail-open by contract — a sensor failure can
never affect a response — but not silent: failures and a missing `SN_MR`
binding are `console.error`'d, and `GET /_sn/rights-signals/version` carries
a `sensor` block (`ae_bound`, `last_write_ok`, `last_write_at`; isolate-
memory, error text log-only) so a dead sensor is distinguishable from "no
crawlers came".

## What this Worker serves gets anchored

The sibling `sn-provenance` Worker's hourly cron (`src/rights-signals.mjs`)
independently fetches the four published surfaces this Worker owns —
`/robots.txt`, `/.well-known/tdmrep.json`, `/license.xml`, `/tdm-policy/` —
and, when a file's content hash has changed since the last anchored
version, signs and OTS-stamps it into the provenance ledger under
`rights-signals/<slug>/v<n>`. Unchanged files are skipped. Practical
consequence for anyone editing this repo: changing any of those four
outputs mints a new signed, dated ledger record within the hour, so "what
reservation was in force on date X" is answerable after the fact.

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
(`NAMED_CRAWLERS` in `robots-block.mjs`) is a **hand-maintained snapshot**
of what Cloudflare's managed feature was serving live as of 2026-07-23, not
an auto-updating feed.

**Mitigated in `v1.3.0`:** `src/crawler-list-sync.mjs` runs weekly
(`23 7 * * 1`), fetches
[Cloudflare's managed-robots-txt docs](https://developers.cloudflare.com/bots/additional-configurations/managed-robots-txt/)
— the page `NAMED_CRAWLERS` was seeded from — and diffs its published
crawler list against ours, logging loudly on drift (`GET
/_sn/rights-signals/crawler-list-status` for the last result). Still
manual to *fix* (this only detects drift, it doesn't rewrite
`robots-block.mjs`), but no longer manual to *notice*. First real run
(2026-07-23, ad hoc, not yet the scheduled cron) already flagged that
`CloudflareBrowserRenderingCrawler` — present in our list — isn't in
Cloudflare's current docs example; left as-is pending review, since the
docs example may be illustrative rather than exhaustive.

## Development

```bash
npm install
npm test        # real workerd runtime via @cloudflare/vitest-pool-workers
npm run deploy   # wrangler deploy --var SN_VERSION:$npm_package_version
```
