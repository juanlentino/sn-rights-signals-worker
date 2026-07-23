import { describe, expect, it } from "vitest";
import { injectTdmMeta } from "../src/html-injector.mjs";

describe("injectTdmMeta", () => {
  it("appends both meta tags into <head>", async () => {
    const html = "<html><head><title>x</title></head><body>hi</body></html>";
    const res = injectTdmMeta(new Response(html, { headers: { "content-type": "text/html" } }));
    const out = await res.text();
    expect(out).toContain('<meta name="tdm-reservation" content="1">');
    expect(out).toContain('<meta name="tdm-policy" content="https://juanlentino.com/tdm-policy/">');
    expect(out.indexOf("</head>")).toBeGreaterThan(out.indexOf('name="tdm-reservation"'));
  });
});
