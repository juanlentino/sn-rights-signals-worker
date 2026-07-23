import { describe, expect, it } from "vitest";
import { bypassesRightsSignals } from "../src/admin-bypass.mjs";

describe("bypassesRightsSignals", () => {
  it("bypasses wp-admin and everything under it", () => {
    expect(bypassesRightsSignals("/wp-admin")).toBe(true);
    expect(bypassesRightsSignals("/wp-admin/")).toBe(true);
    expect(bypassesRightsSignals("/wp-admin/edit.php")).toBe(true);
  });

  it("bypasses the exact auth-critical files", () => {
    expect(bypassesRightsSignals("/wp-login.php")).toBe(true);
    expect(bypassesRightsSignals("/xmlrpc.php")).toBe(true);
    expect(bypassesRightsSignals("/wp-cron.php")).toBe(true);
  });

  it("does not bypass normal content or the paths this Worker owns", () => {
    expect(bypassesRightsSignals("/")).toBe(false);
    expect(bypassesRightsSignals("/notes/some-post/")).toBe(false);
    expect(bypassesRightsSignals("/robots.txt")).toBe(false);
    expect(bypassesRightsSignals("/wp-json/wp/v2/posts")).toBe(false);
    expect(bypassesRightsSignals("/wp-admin-lookalike/")).toBe(false);
  });
});
