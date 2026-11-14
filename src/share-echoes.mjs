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
// meta-externalagent is NOT a preview fetcher: Meta files it as the crawler
// that trains models and indexes content, so counting it would turn a crawl
// into a share. meta-externalfetcher is Meta's user-initiated fetch and is.

export const ECHO_FAMILIES = Object.freeze([
  "meta", "whatsapp", "linkedin", "slack", "discord", "telegram", "x", "apple-messages", "other-preview",
]);

const RULES = [
  ["apple-messages", /facebookexternalhit\/1\.1 facebot twitterbot\/1\.0/],
  ["telegram", /telegrambot/],
  ["whatsapp", /whatsapp/],
  ["meta", /facebookexternalhit|meta-externalfetcher|facebookcatalog/],
  ["linkedin", /linkedinbot/],
  ["slack", /slackbot|slack-imgproxy/],
  ["discord", /discordbot/],
  ["x", /twitterbot/],
  ["other-preview", /skypeuripreview|microsoftpreview|mastodon|redditbot|embedly|iframely|cardyb|pinterestbot|snapchat|viber/],
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
    env.SN_ECHO.writeDataPoint({
      blobs: [family, path, new Date().toISOString()],
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
    "SELECT blob1 AS family, blob2 AS path, blob3 AS observed_at, sum(_sample_interval) AS hits " +
    `FROM sn_share_echoes WHERE timestamp > NOW() - INTERVAL '${d}' DAY ` +
    "GROUP BY family, path, observed_at " +
    `ORDER BY observed_at DESC LIMIT ${ECHOES_LIMIT} FORMAT JSON`
  );
}
