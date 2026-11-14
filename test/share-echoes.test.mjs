import { describe, expect, it } from "vitest";
import { ECHO_FAMILIES, echoPath, echoesQuery, observeShareEcho, previewFamily } from "../src/share-echoes.mjs";
import { buildQuery } from "../src/machine-readers.mjs";

const UA = {
  meta: "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
  metaFetcher: "meta-externalfetcher/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)",
  whatsapp: "WhatsApp/2.23.20.0 A",
  linkedin: "LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)",
  slack: "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
  discord: "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)",
  telegram: "TelegramBot (like TwitterBot)",
  x: "Twitterbot/1.0",
  apple: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_1) AppleWebKit/601.2.4 (KHTML, like Gecko) Version/9.0.1 Safari/601.2.4 facebookexternalhit/1.1 Facebot Twitterbot/1.0",
  other: "Mozilla/5.0 (Windows NT 6.1; WOW64) SkypeUriPreview Preview/0.5",
  browser: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  metaTrainer: "meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)",
};

const sink = () => {
  const written = [];
  return { written, env: { SN_ECHO: { writeDataPoint: (d) => written.push(d) } } };
};
const req = (ua, url = "https://juanlentino.com/r/jill?fbclid=abc&x=1") =>
  new Request(url, { headers: { "user-agent": ua, "cf-connecting-ip": "203.0.113.9" } });

describe("previewFamily", () => {
  it("maps each app's user agent to its family", () => {
    expect(previewFamily(UA.meta)).toBe("meta");
    expect(previewFamily(UA.metaFetcher)).toBe("meta");
    expect(previewFamily(UA.whatsapp)).toBe("whatsapp");
    expect(previewFamily(UA.linkedin)).toBe("linkedin");
    expect(previewFamily(UA.slack)).toBe("slack");
    expect(previewFamily(UA.discord)).toBe("discord");
    expect(previewFamily(UA.telegram)).toBe("telegram");
    expect(previewFamily(UA.x)).toBe("x");
    expect(previewFamily(UA.apple)).toBe("apple-messages");
    expect(previewFamily(UA.other)).toBe("other-preview");
  });
  it("every family it returns is on the fixed list", () => {
    for (const ua of Object.values(UA)) {
      const f = previewFamily(ua);
      if (f !== null) expect(ECHO_FAMILIES).toContain(f);
    }
  });
  it("an ordinary browser, an empty agent and Meta's training crawler are not previews", () => {
    expect(previewFamily(UA.browser)).toBeNull();
    expect(previewFamily("")).toBeNull();
    expect(previewFamily(undefined)).toBeNull();
    expect(previewFamily(UA.metaTrainer)).toBeNull();
  });
});

describe("observeShareEcho", () => {
  it("writes time, path and family only: no IP, user agent or query string", () => {
    const { written, env } = sink();
    const r = req(UA.whatsapp);
    expect(observeShareEcho(r, env, new URL(r.url).pathname, "html")).toEqual({ family: "whatsapp", path: "/r/jill" });
    expect(written).toHaveLength(1);
    const [family, path, at] = written[0].blobs;
    expect([family, path]).toEqual(["whatsapp", "/r/jill"]);
    expect(Number.isNaN(Date.parse(at))).toBe(false);
    expect(written[0].blobs).toHaveLength(3);
    const all = JSON.stringify(written[0]);
    for (const leak of ["203.0.113.9", "WhatsApp/2", "fbclid", "?"]) expect(all).not.toContain(leak);
  });
  it("an ordinary browser writes no echo", () => {
    const { written, env } = sink();
    expect(observeShareEcho(req(UA.browser), env, "/r/jill", "html")).toBeNull();
    expect(written).toHaveLength(0);
  });
  it("pages only, and never the site's own tools", () => {
    const { written, env } = sink();
    expect(observeShareEcho(req(UA.slack), env, "/feed/", "feed")).toBeNull();
    expect(observeShareEcho(req(UA.slack), env, "/notes/x/", "html", true)).toBeNull();
    expect(written).toHaveLength(0);
  });
  it("a missing binding or a throwing write never throws", () => {
    expect(observeShareEcho(req(UA.slack), {}, "/", "html")).toBeNull();
    const env = { SN_ECHO: { writeDataPoint: () => { throw new Error("boom"); } } };
    expect(observeShareEcho(req(UA.slack), env, "/", "html")).toBeNull();
  });
  it("an oversized or control-character path is not a page", () => {
    expect(echoPath("/" + "a".repeat(600))).toBeNull();
    expect(echoPath("/a\u0007b")).toBeNull();
    expect(echoPath("")).toBe("/");
  });
});

describe("the echoes read", () => {
  it("is a fixed per-event query with clamped days", () => {
    expect(buildQuery("echoes", 7)).toBe(echoesQuery(7));
    expect(echoesQuery(7)).toContain("FROM sn_share_echoes");
    expect(echoesQuery(7)).toContain("INTERVAL '7' DAY");
    expect(echoesQuery(9999)).toContain("INTERVAL '90' DAY");
    expect(echoesQuery("1; DROP")).toContain("INTERVAL '30' DAY");
  });
});
