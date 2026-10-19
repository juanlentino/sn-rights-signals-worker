import { describe, it, expect } from "vitest";
import WRANGLER from "../wrangler.jsonc?raw";

// A ratelimit namespace_id is account-wide, not per-Worker: two bindings on
// one id share counters, and an IPv4 key here collides with the same IP's key
// on the sibling Worker. Ids in use elsewhere on the account (2026-10-19):
// 1001 analytics PX_LIMITER, 1002 login-guard LOGIN_RL, 1003 provenance
// VERIFY_RL. Sharing 1001 once let pageviews 429 the login POST.
const TAKEN = ["1001", "1002", "1003"];

describe("WEBMCP_LIMITER has its own rate-limit namespace", () => {
  it("does not reuse a sibling Worker's namespace_id", () => {
    const m = WRANGLER.match(/"name":\s*"WEBMCP_LIMITER",\s*"namespace_id":\s*"(\d+)"/);
    expect(m).not.toBeNull();
    expect(TAKEN).not.toContain(m[1]);
  });
});
