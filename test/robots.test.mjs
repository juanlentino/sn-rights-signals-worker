import { describe, expect, it, vi, afterEach } from "vitest";
import { robotsResponse } from "../src/robots.mjs";

function stubFetch(body, init = { status: 200 }) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, init)));
}

afterEach(() => vi.unstubAllGlobals());

describe("robotsResponse", () => {
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

  it("strips a still-live Cloudflare managed block instead of duplicating it (transition window)", async () => {
    stubFetch(
      "# old preamble\n\n# BEGIN Cloudflare Managed content\n\nUser-agent: *\nContent-Signal: search=yes,ai-train=no,use=reference\nAllow: /\n\n# END Cloudflare Managed Content\n\nDisallow: /tools/\n",
    );
    const res = await robotsResponse(new Request("https://juanlentino.com/robots.txt"));
    const text = await res.text();
    expect(text.match(/Content-Signal:/g)).toHaveLength(1);
    expect(text).not.toContain("ai-train=no,use=reference\n"); // Cloudflare's un-augmented line is gone
    expect(text).toContain("Disallow: /tools/");
  });

  it("fails open on a non-ok origin response", async () => {
    stubFetch("error", { status: 502 });
    const res = await robotsResponse(new Request("https://juanlentino.com/robots.txt"));
    expect(res.status).toBe(502);
  });
});
