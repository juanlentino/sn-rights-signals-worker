import { describe, expect, it, vi, afterEach } from "vitest";
import worker from "../src/index.mjs";
afterEach(() => vi.unstubAllGlobals());

describe("null-body + redirect statuses survive the header wrap", () => {
  it("304 Not Modified does not throw", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 304 })));
    const res = await worker.fetch(new Request("https://juanlentino.com/style.css"), {});
    expect(res.status).toBe(304);
    expect(res.headers.get("tdm-reservation")).toBe("1");
  });
  it("301 redirect keeps its Location", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 301, headers: { location: "https://juanlentino.com/new/" } })));
    const res = await worker.fetch(new Request("https://juanlentino.com/old/"), {});
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("https://juanlentino.com/new/");
  });
  it("204 No Content does not throw", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    const res = await worker.fetch(new Request("https://juanlentino.com/x"), {});
    expect(res.status).toBe(204);
  });
});
