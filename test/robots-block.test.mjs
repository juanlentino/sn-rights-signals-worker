import { describe, expect, it } from "vitest";
import { fullRobotsTxt, originTail, OWNED_ROBOTS_HEADER } from "../src/robots-block.mjs";

describe("originTail", () => {
  it("returns the whole text when no Cloudflare marker is present (toggle already off)", () => {
    expect(originTail("Disallow: /tools/\n")).toBe("Disallow: /tools/");
  });

  it("strips everything up to and including the Cloudflare end marker", () => {
    const raw = "preamble\n\n# END Cloudflare Managed Content\n\nDisallow: /tools/\n";
    expect(originTail(raw)).toBe("Disallow: /tools/");
  });
});

describe("fullRobotsTxt", () => {
  it("is exactly the owned header + tail + License: line when there is a tail", () => {
    const out = fullRobotsTxt("Disallow: /tools/");
    expect(out).toBe(`${OWNED_ROBOTS_HEADER}\n\nDisallow: /tools/\n\nLicense: https://juanlentino.com/license.xml\n`);
  });

  it("omits the blank tail gap when there is no origin tail", () => {
    const out = fullRobotsTxt("");
    expect(out).toBe(`${OWNED_ROBOTS_HEADER}\n\nLicense: https://juanlentino.com/license.xml\n`);
  });
});
