import { describe, expect, it } from "vitest";
import { appendLicenseOnly, fullRobotsTxt, originTail, OWNED_ROBOTS_HEADER } from "../src/robots-block.mjs";

// Wired into robots.mjs as of 2026-07-23 (the owner disabled Cloudflare's
// "Managed robots.txt" toggle, making full ownership safe — see robots.mjs).

describe("originTail", () => {
  it("returns the whole text when no Cloudflare marker is present", () => {
    expect(originTail("Disallow: /tools/\n")).toBe("Disallow: /tools/");
  });

  it("strips everything up to and including the Cloudflare end marker", () => {
    const raw = "preamble\n\n# END Cloudflare Managed Content\n\nDisallow: /tools/\n";
    expect(originTail(raw)).toBe("Disallow: /tools/");
  });
});

describe("fullRobotsTxt", () => {
  it("is exactly the owned header + tail + License: + Sitemap: lines when there is a tail (v1.6.1 contract)", () => {
    const out = fullRobotsTxt("Disallow: /tools/");
    expect(out).toBe(`${OWNED_ROBOTS_HEADER}\n\nDisallow: /tools/\n\nLicense: https://juanlentino.com/license.xml\nSitemap: https://juanlentino.com/wp-sitemap.xml\n`);
  });

  it("omits the blank tail gap when there is no origin tail (v1.6.1 contract)", () => {
    const out = fullRobotsTxt("");
    expect(out).toBe(`${OWNED_ROBOTS_HEADER}\n\nLicense: https://juanlentino.com/license.xml\nSitemap: https://juanlentino.com/wp-sitemap.xml\n`);
  });
});

describe("appendLicenseOnly", () => {
  it("touches nothing but appends the License: line", () => {
    const raw = "# Cloudflare's own block\n\nContent-Signal: search=yes,ai-train=no,use=reference\n";
    expect(appendLicenseOnly(raw)).toBe(`${raw.trimEnd()}\nLicense: https://juanlentino.com/license.xml\n`);
  });
});
describe("Sitemap pointer guarantee (v1.6.1)", () => {
  it("appends the Sitemap line when no source provides one (the live regression: a physical origin robots.txt bypasses WordPress's pointer)", () => {
    const out = fullRobotsTxt("Disallow: /tools/");
    expect(out).toContain("Sitemap: https://juanlentino.com/wp-sitemap.xml");
    expect(out.trimEnd().split("\n").at(-1)).toContain("Sitemap:");
  });

  it("appends it on the empty-tail fallback too (origin 4xx path)", () => {
    expect(fullRobotsTxt("")).toContain("Sitemap: https://juanlentino.com/wp-sitemap.xml");
  });

  it("is idempotent: an origin tail that already carries a Sitemap line is left alone", () => {
    const out = fullRobotsTxt("Sitemap: https://juanlentino.com/wp-sitemap.xml\nDisallow: /tools/");
    expect(out.match(/Sitemap:/g)).toHaveLength(1);
  });
});

