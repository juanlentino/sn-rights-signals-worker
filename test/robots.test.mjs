import { describe, expect, it, vi, afterEach } from "vitest";
import { robotsResponse } from "../src/robots.mjs";

function stubFetch(body, init = { status: 200 }) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, init)));
}

afterEach(() => vi.unstubAllGlobals());

describe("robotsResponse — full ownership (Cloudflare's managed block off)", () => {
  it("owns the Content-Signal line, including ai-input=yes", async () => {
    stubFetch("Disallow: /tools/\n");
    const res = await robotsResponse(new Request("https://juanlentino.com/robots.txt"));
    const text = await res.text();
    expect(text).toContain("Content-Signal: search=yes,ai-train=no,ai-input=yes,use=reference");
  });

  it("preserves the Article 4 preamble and the full named-crawler block", async () => {
    stubFetch("Disallow: /tools/\n");
    const res = await robotsResponse(new Request("https://juanlentino.com/robots.txt"));
    const text = await res.text();
    expect(text).toContain("ARTICLE 4 OF THE EUROPEAN UNION DIRECTIVE 2019/790");
    for (const bot of ["GPTBot", "ClaudeBot", "CCBot", "Google-Extended", "Amazonbot", "Bytespider", "meta-externalagent"]) {
      expect(text).toContain(`User-agent: ${bot}\nDisallow: /`);
    }
  });

  it("appends the origin's own directives and the License: line", async () => {
    stubFetch("Disallow: /tools/\n");
    const res = await robotsResponse(new Request("https://juanlentino.com/robots.txt"));
    const text = await res.text();
    expect(text).toContain("Disallow: /tools/");
    expect(text.trim().endsWith("Sitemap: https://juanlentino.com/wp-sitemap.xml")).toBe(true); // v1.6.1: the guaranteed pointer is now the final line
    expect(text).toContain("License: https://juanlentino.com/license.xml");
  });

  it("never produces a duplicate Content-Signal line", async () => {
    stubFetch("Disallow: /tools/\n");
    const res = await robotsResponse(new Request("https://juanlentino.com/robots.txt"));
    const text = await res.text();
    expect(text.match(/Content-Signal:/g)).toHaveLength(1);
  });
});

describe("robotsResponse — defensive stripping if Cloudflare's block somehow reappears", () => {
  // Belt-and-suspenders: if the dashboard toggle is ever re-enabled by
  // mistake, originTail() strips a leftover Cloudflare block out of the
  // origin fetch rather than duplicating it in our own composition. This
  // does NOT protect against Cloudflare wrapping our OWN output again (see
  // robots.mjs's comment) — only against double-counting within what we read.
  it("strips a still-present Cloudflare block out of the origin fetch", async () => {
    stubFetch(
      "# old preamble\n\n# BEGIN Cloudflare Managed content\n\nUser-agent: *\nContent-Signal: search=yes,ai-train=no,use=reference\nAllow: /\n\n# END Cloudflare Managed Content\n\nDisallow: /tools/\n",
    );
    const res = await robotsResponse(new Request("https://juanlentino.com/robots.txt"));
    const text = await res.text();
    expect(text.match(/Content-Signal:/g)).toHaveLength(1);
    expect(text).toContain("Content-Signal: search=yes,ai-train=no,ai-input=yes,use=reference");
  });
});

describe("robotsResponse — error handling", () => {
  // RFC 9309 §2.3.1 gives 4xx and 5xx OPPOSITE meanings for robots.txt, so a
  // single "non-ok" branch is wrong:
  //
  //   4xx "unavailable" → crawlers MAY access any resource (allow all).
  //   5xx "unreachable" → crawlers MUST assume complete disallow.
  //
  // Passing a 5xx through is therefore genuinely protective: crawlers back off
  // entirely. Passing a 404 through is the harmful case — it reads as "no
  // restrictions of any kind", silently discarding the Article 4 reservation,
  // the Content-Signal line, the named-crawler blocks and the License line.
  // The owned block is fully self-contained (fullRobotsTxt("") is asserted in
  // robots-block.test.mjs), so on a 4xx we can still state the rights position
  // even though the origin contributed nothing.
  it("still serves the owned rights block when the origin 404s", async () => {
    stubFetch("Not Found", { status: 404 });
    const res = await robotsResponse(new Request("https://juanlentino.com/robots.txt"));
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).toContain("Content-Signal: search=yes,ai-train=no,ai-input=yes,use=reference");
    expect(text).toContain("ARTICLE 4 OF THE EUROPEAN UNION DIRECTIVE 2019/790");
    expect(text).toContain("User-agent: GPTBot\nDisallow: /");
    expect(text.trim().endsWith("Sitemap: https://juanlentino.com/wp-sitemap.xml")).toBe(true); // v1.6.1: the guaranteed pointer is now the final line
    expect(text).toContain("License: https://juanlentino.com/license.xml");
  });

  it("does not leak the origin's error body into the served block", async () => {
    stubFetch("<html><body>404 Not Found</body></html>", { status: 404 });
    const res = await robotsResponse(new Request("https://juanlentino.com/robots.txt"));
    const text = await res.text();
    expect(text).not.toContain("<html>");
    expect(text.match(/Content-Signal:/g)).toHaveLength(1);
  });

  it("passes a 5xx through untouched so crawlers apply the full-disallow rule", async () => {
    stubFetch("error", { status: 502 });
    const res = await robotsResponse(new Request("https://juanlentino.com/robots.txt"));
    expect(res.status).toBe(502);
  });

  it("passes a 429 through untouched (rate limiting is also 'unreachable')", async () => {
    stubFetch("slow down", { status: 429 });
    const res = await robotsResponse(new Request("https://juanlentino.com/robots.txt"));
    expect(res.status).toBe(429);
  });
});

// 1.40.1: the origin's file is appended whole or not at all. A crawler
// revalidating its copy used to draw a 304 (or a 206 for a Range), which the
// Worker answered as a 200 holding the owned block alone: the origin's own
// Disallow and Sitemap lines were gone.
describe("robotsResponse: built from a full origin body only", () => {
  const sent = () => fetch.mock.calls[0][0];

  it("asks the origin without the client's validators or Range, as the same request otherwise", async () => {
    stubFetch("Disallow: /tools/\n");
    await robotsResponse(
      new Request("https://juanlentino.com/robots.txt", {
        redirect: "manual",
        headers: {
          "if-none-match": '"abc"',
          "if-modified-since": "Sat, 21 Nov 2026 00:00:00 GMT",
          "if-match": '"abc"',
          "if-unmodified-since": "Sat, 21 Nov 2026 00:00:00 GMT",
          "if-range": '"abc"',
          range: "bytes=0-10",
          "user-agent": "Googlebot/2.1",
        },
      }),
    );
    for (const h of ["if-none-match", "if-modified-since", "if-match", "if-unmodified-since", "if-range", "range"]) {
      expect(sent().headers.get(h), h).toBeNull();
    }
    expect(sent().headers.get("user-agent")).toBe("Googlebot/2.1");
    expect(sent().url).toBe("https://juanlentino.com/robots.txt");
    expect(sent().method).toBe("GET");
    expect(sent().redirect).toBe("manual");
  });

  it("does not put the origin's validators on the rewritten body", async () => {
    stubFetch("Disallow: /tools/\n", { status: 200, headers: { etag: '"abc"', "last-modified": "Sat, 21 Nov 2026 00:00:00 GMT", "cache-control": "max-age=60" } });
    const res = await robotsResponse(new Request("https://juanlentino.com/robots.txt"));
    expect(res.headers.get("etag")).toBeNull();
    expect(res.headers.get("last-modified")).toBeNull();
    expect(res.headers.get("cache-control")).toBe("max-age=60");
    expect(await res.text()).toContain("Disallow: /tools/");
  });

  it("passes an origin redirect through unchanged", async () => {
    stubFetch(null, { status: 301, headers: { location: "https://www.juanlentino.com/robots.txt" } });
    const res = await robotsResponse(new Request("https://juanlentino.com/robots.txt"));
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("https://www.juanlentino.com/robots.txt");
    expect(await res.text()).toBe("");
  });

  it("never turns a 304 into a 200 without the origin's rules", async () => {
    stubFetch(null, { status: 304 });
    const res = await robotsResponse(new Request("https://juanlentino.com/robots.txt"));
    expect(res.status).toBe(304);
  });
});
