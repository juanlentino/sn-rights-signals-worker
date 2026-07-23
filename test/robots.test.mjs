import { describe, expect, it, vi, afterEach } from "vitest";
import { robotsResponse } from "../src/robots.mjs";

function stubFetch(body, init = { status: 200 }) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, init)));
}

afterEach(() => vi.unstubAllGlobals());

describe("robotsResponse", () => {
  // This Worker's fetch(request) only ever sees WordPress's bare origin file
  // (verified live: Cloudflare's managed content-signals block wraps AROUND
  // whatever this Worker returns, after it runs — so the origin body this
  // Worker patches is just the site's own directives, e.g. "Disallow: /tools/").
  it("appends a License: directive after the origin's own content", async () => {
    stubFetch("Disallow: /tools/\n");
    const res = await robotsResponse(new Request("https://juanlentino.com/robots.txt"));
    const text = await res.text();
    expect(text).toBe("Disallow: /tools/\nLicense: https://juanlentino.com/license.xml\n");
  });

  it("does not attempt to touch a Content-Signal line (it never appears in this body)", async () => {
    stubFetch("Disallow: /tools/\n");
    const res = await robotsResponse(new Request("https://juanlentino.com/robots.txt"));
    const text = await res.text();
    expect(text).not.toContain("ai-input");
  });

  it("fails open on a non-ok origin response", async () => {
    stubFetch("error", { status: 502 });
    const res = await robotsResponse(new Request("https://juanlentino.com/robots.txt"));
    expect(res.status).toBe(502);
  });
});
