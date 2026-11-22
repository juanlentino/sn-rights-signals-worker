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

// 1.40.0: Meta's preview renderer for Instagram and Facebook fetches a sent
// link from Meta's own network with an ordinary phone-browser agent (it even
// runs the page's beacon), so no agent rule sees it (2026-11-15: an Instagram
// DM of /resume drew two such fetches, Boardman and Lulea, and no echo).
// AS32934 is Meta's network; the organization name is the fallback when the
// edge sends no number. Browser-shaped agents only: Meta's named crawlers
// (meta-externalagent, meta-externalfetcher) keep their own meaning.
const META_ASN = 32934;
const META_ORG = /^(facebook|meta platforms)/i;
const DECLARED_AGENT = /\(compatible;|bot\b|bot\/|crawl|spider|fetcher|externalagent|externalhit/i;

/** Whether a request came from Meta's network. PURE. */
export function fromMetaNetwork(cf) {
  if (!cf) return false;
  if (Number(cf.asn) === META_ASN) return true;
  return META_ORG.test(String(cf.asOrganization ?? "").trim());
}

/**
 * The family and how it was matched: "agent" (the user agent names the app)
 * or "network" (a browser agent from Meta's network). Null when neither. PURE.
 */
export function echoMatch(ua, cf) {
  const family = previewFamily(ua);
  if (family !== null) return { family, via: "agent" };
  const s = typeof ua === "string" ? ua : "";
  // A declared crawler sends "Mozilla/5.0 (compatible; FacebookBot/1.0; ...)":
  // Mozilla-first is not browser-shaped on its own.
  if (/^mozilla\//i.test(s) && !DECLARED_AGENT.test(s) && fromMetaNetwork(cf)) return { family: "meta", via: "network" };
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
 * touches the response. Pages only (surface html), GET only; the site's own
 * tools (first party) never write an echo.
 *
 * @returns {{family:string, path:string}|null} What was recorded, or null.
 */
export function observeShareEcho(request, env, pathname, surface, firstParty = false) {
  try {
    if (!env?.SN_ECHO || typeof env.SN_ECHO.writeDataPoint !== "function") return null;
    if (surface !== "html" || firstParty === true) return null;
    // 1.40.1: a preview is a GET. A HEAD, POST or any other method is not one.
    if (request.method !== "GET") return null;
    const match = echoMatch(request.headers.get("user-agent"), request.cf);
    if (match === null) return null;
    const { family, via } = match;
    const path = echoPath(pathname);
    if (path === null) return null;
    // blob4: Cloudflare verified the fetcher ("1"/"0", the zone's x-sn-verified-bot
    // header). The plugin needs it: a preview agent is easy to spoof, and the
    // apps that fetch from their own servers are verifiable when genuine.
    const verified = (request.headers.get("x-sn-verified-bot") ?? "").trim() !== "" ? "1" : "0";
    env.SN_ECHO.writeDataPoint({
      // blob5 (1.40.0): how the family was matched, "agent" or "network". The
      // network itself is never stored: no ASN, IP or agent.
      blobs: [family, path, new Date().toISOString(), verified, via],
      doubles: [1],
      indexes: [family],
    });
    return { family, path, via };
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
    "SELECT blob1 AS family, blob2 AS path, blob3 AS observed_at, blob4 AS verified, blob5 AS via, sum(_sample_interval) AS hits " +
    `FROM sn_share_echoes WHERE timestamp > NOW() - INTERVAL '${d}' DAY ` +
    // The row cap is spent on shares only (the plugin's rules, inc/share-echoes.php):
    // Meta also crawls on its own schedule, so it counts on /r/ links alone, and an
    // app that fetches from its own servers counts only when Cloudflare verified it.
    // A Meta fetch matched by Meta's network (blob5 'network', 1.40.0) passes both:
    // the network is its proof, and it is a send, not a crawl.
    "AND NOT (blob1 = 'meta' AND blob5 != 'network' AND NOT (blob2 LIKE '/r/%')) " +
    "AND NOT (blob1 IN ('meta','linkedin','slack','discord','x') AND blob4 != '1' AND NOT (blob1 = 'meta' AND blob5 = 'network')) " +
    "GROUP BY family, path, observed_at, verified, via " +
    `ORDER BY observed_at DESC LIMIT ${ECHOES_LIMIT} FORMAT JSON`
  );
}
