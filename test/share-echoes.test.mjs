import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index.mjs";
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
  mastodon: "http.rb/5.1.1 (Mastodon/4.2.10; +https://mastodon.social/)",
  snapInApp: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Snapchat/12.50.0.40",
  waInApp: "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36 WhatsApp/2.24",
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
    expect(previewFamily(UA.metaFetcher)).toBeNull();
    expect(previewFamily(UA.whatsapp)).toBe("whatsapp");
    expect(previewFamily(UA.linkedin)).toBe("linkedin");
    expect(previewFamily(UA.slack)).toBe("slack");
    expect(previewFamily(UA.discord)).toBe("discord");
    expect(previewFamily(UA.telegram)).toBe("telegram");
    expect(previewFamily(UA.x)).toBe("x");
    expect(previewFamily(UA.apple)).toBe("apple-messages");
    expect(previewFamily(UA.other)).toBe("other-preview");
    expect(previewFamily(UA.mastodon)).toBe("other-preview");
    expect(previewFamily("Mastodon/4.3.0 (http.rb/5.2.0; +https://mastodon.social/)")).toBe("other-preview");
    expect(previewFamily("WhatsApp/2")).toBe("other-preview"); // Signal, from the sender's device
    expect(previewFamily("facebookexternalhit/1.1;line-poker/1.0")).toBe("other-preview"); // LINE
    expect(previewFamily("Snap URL Preview Service; bot; snapchat; https://developers.snap.com/robots")).toBe("other-preview");
    expect(previewFamily("Mozilla/5.0 (compatible; Bluesky Cardyb/1.1; +mailto:support@bsky.app)")).toBe("other-preview");
    expect(previewFamily("kakaotalk-scrap/1.0")).toBe("other-preview");
    expect(previewFamily("facebookcatalog/1.0")).toBeNull();
  });
  it("an app's in-app browser is a person, not a preview", () => {
    expect(previewFamily(UA.snapInApp)).toBeNull();
    expect(previewFamily(UA.waInApp)).toBeNull();
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
    expect(observeShareEcho(r, env, new URL(r.url).pathname, "html")).toEqual({ family: "whatsapp", path: "/r/jill", via: "agent" });
    expect(written).toHaveLength(1);
    const [family, path, at] = written[0].blobs;
    expect([family, path]).toEqual(["whatsapp", "/r/jill"]);
    expect(Number.isNaN(Date.parse(at))).toBe(false);
    expect(written[0].blobs).toHaveLength(5);
    expect(written[0].blobs[3]).toBe("0");
    expect(written[0].blobs[4]).toBe("agent");
    const all = JSON.stringify(written[0]);
    for (const leak of ["203.0.113.9", "WhatsApp/2", "fbclid", "?"]) expect(all).not.toContain(leak);
  });
  it("carries Cloudflare's verified flag", () => {
    const { written, env } = sink();
    const r = new Request("https://juanlentino.com/notes/x/", { headers: { "user-agent": UA.linkedin, "x-sn-verified-bot": "Social Media Marketing" } });
    observeShareEcho(r, env, "/notes/x/", "html");
    expect(written[0].blobs[3]).toBe("1");
  });
  it("a phone browser from Meta's network is a meta echo, matched by network, with no network stored", () => {
    const phone = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
    for (const cf of [{ asn: 32934, asOrganization: "Facebook, Inc." }, { asOrganization: "Meta Platforms, Inc." }]) {
      const { written, env } = sink();
      const r = req(phone, "https://juanlentino.com/resume");
      Object.defineProperty(r, "cf", { value: cf });
      expect(observeShareEcho(r, env, "/resume", "html")).toEqual({ family: "meta", path: "/resume", via: "network" });
      expect(written[0].blobs[4]).toBe("network");
      const all = JSON.stringify(written[0]);
      for (const leak of ["32934", "Facebook", "Meta Platforms", "iPhone", "203.0.113.9"]) expect(all).not.toContain(leak);
    }
  });
  it("the same browser on another network writes none, and Meta's named crawlers stay out", () => {
    const { written, env } = sink();
    const r = req(UA.browser, "https://juanlentino.com/resume");
    Object.defineProperty(r, "cf", { value: { asn: 7922, asOrganization: "Comcast Cable Communications, LLC" } });
    expect(observeShareEcho(r, env, "/resume", "html")).toBeNull();
    const t = req(UA.metaTrainer, "https://juanlentino.com/resume");
    Object.defineProperty(t, "cf", { value: { asn: 32934, asOrganization: "Facebook, Inc." } });
    expect(observeShareEcho(t, env, "/resume", "html")).toBeNull();
    const fb = req("Mozilla/5.0 (compatible; FacebookBot/1.0; +https://developers.facebook.com/docs/sharing/webmasters/facebookbot/)", "https://juanlentino.com/resume");
    Object.defineProperty(fb, "cf", { value: { asn: 32934, asOrganization: "Facebook, Inc." } });
    expect(observeShareEcho(fb, env, "/resume", "html")).toBeNull();
    expect(written).toHaveLength(0);
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
  // 1.40.1: a preview is a GET. Other methods wrote rows too.
  it("only a GET is a preview fetch", () => {
    const { written, env } = sink();
    for (const method of ["HEAD", "POST", "PUT", "DELETE", "OPTIONS"]) {
      const r = new Request("https://juanlentino.com/r/jill", { method, headers: { "user-agent": UA.whatsapp } });
      expect(observeShareEcho(r, env, "/r/jill", "html"), method).toBeNull();
    }
    expect(written).toHaveLength(0);
    expect(observeShareEcho(req(UA.whatsapp), env, "/r/jill", "html")).toMatchObject({ family: "whatsapp" });
    expect(written).toHaveLength(1);
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
    expect(echoesQuery(7)).toContain("blob4 AS verified");
    expect(echoesQuery(7)).toContain("blob5 AS via");
    expect(echoesQuery(7)).toContain("blob5 != 'network'");
    expect(echoesQuery(7)).toContain("AND NOT (blob1 = 'meta' AND blob5 != 'network' AND NOT (blob2 LIKE '/r/%'))");
    expect(echoesQuery(7)).toContain("blob4 != '1'");
    expect(echoesQuery(7)).toContain("INTERVAL '7' DAY");
    expect(echoesQuery(9999)).toContain("INTERVAL '90' DAY");
    expect(echoesQuery("1; DROP")).toContain("INTERVAL '30' DAY");
  });
});

describe("wired into the Worker", () => {
  const harness = () => {
    const echoes = [];
    const env = { SN_MR: { writeDataPoint: () => {} }, SN_MR_RIGHTS: { writeDataPoint: () => {} }, SN_ECHO: { writeDataPoint: (d) => echoes.push(d) } };
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(new Response("ok", { headers: { "content-type": "text/plain" } }))));
    return { echoes, env };
  };
  afterEach(() => vi.unstubAllGlobals());

  it("a preview fetch of a page writes one echo; the response is the origin's", async () => {
    const { echoes, env } = harness();
    const res = await worker.fetch(req(UA.whatsapp, "https://juanlentino.com/r/jill?utm_source=x"), env, {});
    expect(await res.text()).toBe("ok");
    expect(echoes).toHaveLength(1);
    expect(echoes[0].blobs.slice(0, 2)).toEqual(["whatsapp", "/r/jill"]);
  });
  it("a browser, a feed and the Worker's own paths write none", async () => {
    const { echoes, env } = harness();
    await worker.fetch(req(UA.browser, "https://juanlentino.com/notes/x/"), env, {});
    await worker.fetch(req(UA.slack, "https://juanlentino.com/feed/"), env, {});
    await worker.fetch(req(UA.slack, "https://juanlentino.com/_sn/rights-signals/version"), env, {});
    expect(echoes).toHaveLength(0);
  });
});
