// Share echoes (1.39.0). When a link to the site is pasted into a messaging or
// social app, that app fetches the page within seconds to build a preview.
// This records each such fetch as ONE row: the time, the page's path and the
// app's preview family. Nothing else: no IP address, no user agent, no query
// string (the URL's search part is never read), no visitor identifier. The
// plugin joins these rows to the next human visit to the same page by page
// and time alone.
//
// Its own ordered list, not the taxonomy's first match: Telegram's agent says
// "TelegramBot (like TwitterBot)" and Apple Messages sends
// "facebookexternalhit/1.1 Facebot Twitterbot/1.0", so a first-match on the
// taxonomy would file both under another app. Most specific first.
//
// meta-externalagent and meta-externalfetcher are NOT preview fetchers: Meta
// files the first as its training crawler and the second as an AI agent
// fetching at a user's request, so counting them would turn a crawl or an
// assistant into a share.

export const ECHO_FAMILIES = Object.freeze([
  "meta", "whatsapp", "linkedin", "slack", "discord", "telegram", "x", "apple-messages", "other-preview",
]);

const RULES = [
  ["apple-messages", /facebookexternalhit\/1\.1 facebot twitterbot\/1\.0/],
  // Signal sends exactly "WhatsApp/2" from the sender's device (Signal-Android
  // LinkPreviewRepository, Signal-iOS LinkPreviewFetcher); WhatsApp's own
  // fetcher carries its full version. Signal is not on the fixed list, so it
  // is another app, never WhatsApp.
  ["other-preview", /^whatsapp\/2$/],
  ["telegram", /telegrambot/],
  // The fetcher's agent STARTS with WhatsApp/<version>; an in-app browser starts with Mozilla/.
  ["whatsapp", /^whatsapp\/\d+\.\d+\.\d+/],
  // LINE's fetcher names facebookexternalhit too ("facebookexternalhit/1.1;line-poker/1.0").
  ["other-preview", /line-poker/],
  // Meta's link-preview fetcher for Facebook, Instagram and Messenger. Not
  // meta-externalfetcher (Meta files it as an AI agent fetching at a user's
  // request) and not facebookcatalog (product catalogs).
  ["meta", /facebookexternalhit/],
  ["linkedin", /linkedinbot/],
  ["slack", /slackbot|slack-imgproxy/],
  ["discord", /discordbot/],
  ["x", /twitterbot/],
  // Crawler forms only: a bare "snapchat" or "mastodon" also names an app's own
  // in-app browser, which is a person. Mastodon writes its agent in both orders.
  ["other-preview", /skypeuripreview|microsoftpreview|mastodon\/[\d.]+ \(http\.rb|http\.rb\/[\d.]+ \(mastodon\/|redditbot|embedly|iframely|cardyb|bluesky|pinterestbot|snap url preview service|kakaotalk-scrap/],
];

/** @returns {string|null} The preview family for a user agent, or null. PURE. */
export function previewFamily(ua) {
  const s = (typeof ua === "string" ? ua : "").toLowerCase();
  if (s === "") return null;
  for (const [family, re] of RULES) if (re.test(s)) return family;
  return null;
}

const MAX_PATH = 512;

/** The path as analytics stores it: pathname only, bounded, no control bytes. PURE. */
export function echoPath(pathname) {
  const p = typeof pathname === "string" && pathname !== "" ? pathname : "/";
  if (p.length > MAX_PATH || /[\u0000-\u001f\u007f-\u009f]/.test(p)) return null;
  return p;
}

/**
 * Record one preview fetch of a page. Fire-and-forget, never throws, never
 * touches the response. Pages only (surface html); the site's own tools
 * (first party) never write an echo.
 *
 * @returns {{family:string, path:string}|null} What was recorded, or null.
 */
export function observeShareEcho(request, env, pathname, surface, firstParty = false) {
  try {
    if (!env?.SN_ECHO || typeof env.SN_ECHO.writeDataPoint !== "function") return null;
    if (surface !== "html" || firstParty === true) return null;
    const family = previewFamily(request.headers.get("user-agent"));
    if (family === null) return null;
    const path = echoPath(pathname);
    if (path === null) return null;
    // blob4: Cloudflare verified the fetcher ("1"/"0", the zone's x-sn-verified-bot
    // header). The plugin needs it: a preview agent is easy to spoof, and the
    // apps that fetch from their own servers are verifiable when genuine.
    const verified = (request.headers.get("x-sn-verified-bot") ?? "").trim() !== "" ? "1" : "0";
    env.SN_ECHO.writeDataPoint({
      blobs: [family, path, new Date().toISOString(), verified],
      doubles: [1],
      indexes: [family],
    });
    return { family, path };
  } catch (e) {
    console.error(`[share-echoes] write failed: ${e?.message ?? e}`);
    return null;
  }
}

export const ECHOES_LIMIT = 5000;

/** The per-event read, newest first. days is clamped by the caller. PURE. */
export function echoesQuery(days) {
  const d = Math.max(1, Math.min(90, Math.trunc(Number(days)) || 30));
  return (
    "SELECT blob1 AS family, blob2 AS path, blob3 AS observed_at, blob4 AS verified, sum(_sample_interval) AS hits " +
    `FROM sn_share_echoes WHERE timestamp > NOW() - INTERVAL '${d}' DAY ` +
    // The row cap is spent on shares only (the plugin's rules, inc/share-echoes.php):
    // Meta also crawls on its own schedule, so it counts on /r/ links alone, and an
    // app that fetches from its own servers counts only when Cloudflare verified it.
    "AND NOT (blob1 = 'meta' AND NOT (blob2 LIKE '/r/%')) " +
    "AND NOT (blob1 IN ('meta','linkedin','slack','discord','x') AND blob4 != '1') " +
    "GROUP BY family, path, observed_at, verified " +
    `ORDER BY observed_at DESC LIMIT ${ECHOES_LIMIT} FORMAT JSON`
  );
}
