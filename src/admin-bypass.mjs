// Auth-critical WordPress surfaces this Worker has no reason to touch.
// index.mjs checks this FIRST, before any parsing/fetch/rewrite logic runs —
// so a future regression in this Worker's own code (an HTMLRewriter edge
// case, a header-merge bug) can never be the thing that breaks login or the
// admin dashboard. Security-reviewer finding, 2026-07-23: the wildcard route
// otherwise unconditionally intercepts every request on the zone, including
// these, even though the Worker's actual job never touches them.
const BYPASS_PREFIX = "/wp-admin";
const BYPASS_EXACT = new Set(["/wp-login.php", "/xmlrpc.php", "/wp-cron.php"]);

export function bypassesRightsSignals(pathname) {
  return pathname === BYPASS_PREFIX || pathname.startsWith(`${BYPASS_PREFIX}/`) || BYPASS_EXACT.has(pathname);
}
