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
  it("fails open on a non-ok origin response", async () => {
    stubFetch("error", { status: 502 });
    const res = await robotsResponse(new Request("https://juanlentino.com/robots.txt"));
    expect(res.status).toBe(502);
  });
});
