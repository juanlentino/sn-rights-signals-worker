import { describe, expect, it } from "vitest";
import { injectTdmMeta } from "../src/html-injector.mjs";
import { WEBMCP_SCRIPT_TAG } from "../src/webmcp-bridge.mjs";

describe("injectTdmMeta", () => {
  it("appends both meta tags into <head>", async () => {
    const html = "<html><head><title>x</title></head><body>hi</body></html>";
    const res = injectTdmMeta(new Response(html, { headers: { "content-type": "text/html" } }));
    const out = await res.text();
    expect(out).toContain('<meta name="tdm-reservation" content="1">');
    expect(out).toContain('<meta name="tdm-policy" content="https://juanlentino.com/tdm-policy/">');
    expect(out.indexOf("</head>")).toBeGreaterThan(out.indexOf('name="tdm-reservation"'));
  });

  it("appends the SRI-pinned WebMCP tag next to the TDM meta tags", async () => {
    const html = "<html><head></head><body></body></html>";
    const res = injectTdmMeta(new Response(html, { headers: { "content-type": "text/html" } }));
    const out = await res.text();
    expect(out).toContain('src="https://juanlentino.com/webmcp/bridge.js"');
    expect(out).toMatch(/integrity="sha384-[A-Za-z0-9+/=]+"/);
    expect(out.split(WEBMCP_SCRIPT_TAG).length).toBe(2);
    expect(out.indexOf("</head>")).toBeGreaterThan(out.indexOf("/webmcp/bridge.js"));
  });
});
