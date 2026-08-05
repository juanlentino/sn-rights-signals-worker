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
    expect(text.trim().endsWith("License: https://juanlentino.com/license.xml")).toBe(true);
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
    expect(text.trim().endsWith("License: https://juanlentino.com/license.xml")).toBe(true);
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
