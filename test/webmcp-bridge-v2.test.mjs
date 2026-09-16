import { describe, it, expect } from "vitest";
import { snRelatedNotes, snGetSiteMap, snGetCitation, snReadArticle, snCiteKey, snWebmcpBeacon, snWebmcpMeasured, snWebmcpTools } from "../src/webmcp-bridge-client.mjs";
import { parseWebmcpCall, isSameOriginBeacon, webmcpCallResponse, WEBMCP_TOOLS, WEBMCP_CALL_PATH } from "../src/webmcp-call.mjs";
import { buildQuery } from "../src/machine-readers.mjs";

// Bridge v2, arc one (design: signal-and-noise-tools docs/webmcp-bridge-v2-design.md).
// Every tool is exercised over a fixture DOCUMENT (plain objects: the tools
// are DOM-free by construction), every absence is a distinct answer, and the
// beacon route writes nothing unless everything about the call is right.

function docWith(blocks, ldjson) {
  return {
    getElementById: (id) => (id in blocks ? { textContent: blocks[id] } : null),
    querySelectorAll: () => (ldjson ? [{ textContent: ldjson }] : []),
    location: { href: "https://juanlentino.com/notes/x/" },
  };
}

describe("related-notes", () => {
  it("not a note (no manifest), not built, nothing related and matches are four distinct answers", () => {
    expect(snRelatedNotes(docWith({}))).toEqual({ related: [], reason: "not a note" });
    expect(snRelatedNotes(docWith({ "sn-related": JSON.stringify({ post_id: 7, built: false, related: [] }) }))).toEqual({ related: [], reason: "not built" });
    expect(snRelatedNotes(docWith({ "sn-related": JSON.stringify({ post_id: 7, built: true, related: [] }) }))).toEqual({ related: [], reason: "nothing related" });
    const r = snRelatedNotes(docWith({ "sn-related": JSON.stringify({ post_id: 7, built: true, related: [{ id: 8, title: "A", url: "https://juanlentino.com/notes/a/", score: 0.81, shared_tags: ["provenance"] }] }) }));
    expect(r).toEqual({ related: [{ title: "A", url: "https://juanlentino.com/notes/a/", score: 0.81, shared_tags: ["provenance"] }] });
  });
  it("a malformed manifest reads as not a note, never throws", () => {
    expect(snRelatedNotes(docWith({ "sn-related": "{nope" }))).toEqual({ related: [], reason: "not a note" });
  });
});

describe("get-site-map", () => {
  it("fetches /notes/index.json once per window and caches it", async () => {
    let calls = 0;
    const f = async () => { calls++; return { ok: true, status: 200, json: async () => ({ version: 1, counts: { notes: 3 } }) }; };
    const win = {};
    const a = await snGetSiteMap(f, win);
    const b = await snGetSiteMap(f, win);
    expect(a.site_map.counts.notes).toBe(3);
    expect(b).toBe(a);
    expect(calls).toBe(1);
  });
  it("404 is not built; a failed fetch names the leg; a bad body names the parse", async () => {
    expect(await snGetSiteMap(async () => ({ ok: false, status: 404 }), {})).toEqual({ error: "not built", reason: "not built" });
    expect((await snGetSiteMap(async () => { throw new Error("offline"); }, {})).error).toBe("site map fetch failed: offline");
    expect((await snGetSiteMap(async () => ({ ok: true, status: 200, json: async () => { throw new Error("x"); } }), {})).error).toContain("parse failed");
  });
});

describe("get-citation", () => {
  const ld = JSON.stringify({ "@graph": [{ "@type": "Person", name: "Juan Lentino" }, { "@type": "Article", headline: "Two kinds of provenance", datePublished: "2026-07-25T10:00:00+00:00", dateModified: "2026-07-26T10:00:00+00:00", mainEntityOfPage: "https://juanlentino.com/notes/two-kinds/" }] });
  it("not a note when the page carries no Article", async () => {
    expect(await snGetCitation(docWith({}))).toEqual({ reason: "not a note" });
  });
  it("an unsigned note cites without the anchor: BibTeX, CSL-JSON, ORCID, author Lentino, Juan", async () => {
    const c = await snGetCitation(docWith({}, ld));
    expect(c.canonical_url).toBe("https://juanlentino.com/notes/two-kinds/");
    expect(c.orcid).toBe("https://orcid.org/0009-0006-8151-5920");
    expect(c.csl_json.author).toEqual([{ family: "Lentino", given: "Juan", ORCID: "https://orcid.org/0009-0006-8151-5920" }]);
    expect(c.csl_json.issued["date-parts"]).toEqual([[2026, 7, 25]]);
    expect(c.bibtex).toContain("@online{lentino2026two,");
    expect(c.bibtex).toContain("author = {Lentino, Juan}");
    expect(c.bibtex).toContain("title = {Two kinds of provenance}");
    expect(c.anchored_hash).toBeUndefined();
    expect(c.ledger_url).toBeUndefined();
  });
  it("a signed note carries the ledger record's content hash and URL; a failed record fetch names it, never breaks the citation", async () => {
    const manifest = JSON.stringify({ subject: { uid: "u1", version: 3 }, calls: { record: { url: "https://ledger.example/u1/v3.json" } } });
    const ok = async () => ({ ok: true, status: 200, json: async () => ({ content_hash: "abc123" }) });
    const c = await snGetCitation(docWith({ "sn-verification-manifest": manifest }, ld), ok);
    expect(c.anchored_hash).toBe("abc123");
    expect(c.ledger_url).toBe("https://ledger.example/u1/v3.json");
    expect(c.version).toBe(3);
    expect(c.bibtex).toContain("Content hash abc123, record https://ledger.example/u1/v3.json");
    const down = await snGetCitation(docWith({ "sn-verification-manifest": manifest }, ld), async () => ({ ok: false, status: 503 }));
    expect(down.anchored_hash).toBeUndefined();
    expect(down.anchor_error).toBe("ledger record fetch failed: 503");
    expect(down.bibtex).toContain("@online{");
  });
  it("the cite key skips stop words and strips punctuation", () => {
    expect(snCiteKey("2026", "The key that was not a key")).toBe("lentino2026key");
    expect(snCiteKey("2026", "Falsifiability is the line")).toBe("lentino2026falsifiability");
    expect(snCiteKey("", "")).toBe("lentinonote");
  });
  it("snReadArticle finds the Article in a graph or as a bare object, skips bad JSON", () => {
    expect(snReadArticle(docWith({}, ld))["@type"]).toBe("Article");
    expect(snReadArticle(docWith({}, JSON.stringify({ "@type": "Article", headline: "x" }))).headline).toBe("x");
    expect(snReadArticle(docWith({}, "{bad"))).toBeNull();
  });
});

describe("the beacon, client side", () => {
  it("sends {tool, outcome, ms} and nothing else, ms clamped; a missing sendBeacon is a quiet false", () => {
    const sent = [];
    const w = { navigator: { sendBeacon: (url, blob) => { sent.push([url, blob]); return true; } } };
    expect(snWebmcpBeacon(w, "related-notes", "ok", 12.6)).toBe(true);
    expect(sent[0][0]).toBe("/_sn/rights-signals/webmcp-call");
    expect(snWebmcpBeacon({ navigator: {} }, "x", "ok", 1)).toBe(false);
    expect(snWebmcpBeacon(null, "x", "ok", 1)).toBe(false);
  });
  it("the measured wrapper reports ok / absent / error from the result shape, and rethrows a throw after reporting", async () => {
    const sent = [];
    const w = { navigator: { sendBeacon: (url, blob) => { sent.push(blob); return true; } } };
    const texts = async () => Promise.all(sent.map((b) => b.text()));
    await snWebmcpMeasured(w, "related-notes", async () => ({ related: [] , reason: "not a note" }))();
    await snWebmcpMeasured(w, "get-site-map", async () => ({ site_map: {} }))();
    await snWebmcpMeasured(w, "get-site-map", async () => ({ error: "x" }))();
    await expect(snWebmcpMeasured(w, "verify-page", async () => { throw new Error("boom"); })()).rejects.toThrow("boom");
    const bodies = (await texts()).map((t) => JSON.parse(t));
    expect(bodies.map((b) => b.outcome)).toEqual(["absent", "ok", "error", "error"]);
    expect(bodies.map((b) => b.tool)).toEqual(["related-notes", "get-site-map", "get-site-map", "verify-page"]);
    for (const b of bodies) expect(Object.keys(b).sort()).toEqual(["ms", "outcome", "tool"]);
  });
  it("the client's tool list and the worker's accepted list are the same list", () => {
    expect(snWebmcpTools()).toEqual([...WEBMCP_TOOLS]);
  });
});

describe("the beacon route, worker side", () => {
  const good = { tool: "related-notes", outcome: "ok", ms: 12 };
  const req = (over = {}) => new Request("https://juanlentino.com" + WEBMCP_CALL_PATH, {
    method: over.method || "POST",
    headers: { origin: "https://juanlentino.com", "sec-fetch-site": "same-origin", "content-type": "application/json", ...(over.headers || {}) },
    body: over.body === undefined ? JSON.stringify(good) : over.body,
  });
  const envWith = () => { const points = []; return { env: { SN_MR: { writeDataPoint: (p) => points.push(p) } }, points }; };

  it("a valid same-origin beacon writes one row: family webmcp, surface the tool, the outcome in the purpose slot, no UA, no IP", async () => {
    const { env, points } = envWith();
    const res = await webmcpCallResponse(req(), env);
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    expect(points).toHaveLength(1);
    expect(points[0].blobs[0]).toBe("webmcp");
    expect(points[0].blobs[1]).toBe("related-notes");
    expect(points[0].blobs[3]).toBe("ok");
    expect(points[0].blobs[7]).toBe("");
    expect(points[0].doubles).toEqual([1]);
    expect(points[0].indexes).toEqual(["webmcp"]);
    expect(points[0].blobs).toHaveLength(11);
  });
  it("refuses, with the same 204 and no write: GET, a foreign origin, a missing sec-fetch-site, an unknown tool, an unknown outcome, a bad ms, an oversized body, non-JSON", async () => {
    const cases = [
      req({ method: "GET", body: null }),
      req({ headers: { origin: "https://evil.example" } }),
      req({ headers: { "sec-fetch-site": "cross-site" } }),
      req({ body: JSON.stringify({ ...good, tool: "drop-tables" }) }),
      req({ body: JSON.stringify({ ...good, outcome: "meh" }) }),
      req({ body: JSON.stringify({ ...good, ms: 99999 }) }),
      req({ body: JSON.stringify({ ...good, ms: 1.5 }) }),
      req({ body: JSON.stringify({ ...good, pad: "x".repeat(300) }) }),
      req({ body: "{nope" }),
    ];
    for (const r of cases) {
      const { env, points } = envWith();
      const res = await webmcpCallResponse(r, env);
      expect(res.status).toBe(204);
      expect(points).toHaveLength(0);
    }
  });
  it("a beacon never carries a count: each row is one, whatever the body says", async () => {
    const { env, points } = envWith();
    await webmcpCallResponse(req({ body: JSON.stringify({ ...good, hits: 5000, count: 5000 }) }), env);
    expect(points).toHaveLength(1);
    expect(points[0].doubles).toEqual([1]);
  });
  it("no binding: 204, nothing thrown", async () => {
    const res = await webmcpCallResponse(req(), {});
    expect(res.status).toBe(204);
  });
  it("parseWebmcpCall and isSameOriginBeacon are pure and strict", () => {
    expect(parseWebmcpCall(good)).toEqual(good);
    expect(parseWebmcpCall(null)).toBeNull();
    expect(parseWebmcpCall({ tool: "verify-page", outcome: "ok", ms: "12" })).toBeNull();
    expect(isSameOriginBeacon(new Request("https://x/", { headers: { origin: "https://juanlentino.com", "sec-fetch-site": "same-origin" } }))).toBe(true);
    expect(isSameOriginBeacon(new Request("https://x/", { headers: { origin: "https://juanlentino.com" } }))).toBe(false);
  });
});

describe("the totals view leaves the family out", () => {
  it("excludes blob1 = webmcp so the plugin's exact total matches its split aggregate", () => {
    expect(buildQuery("totals", 30)).toContain("AND blob1 != 'webmcp'");
    expect(buildQuery("aggregate", 30)).not.toContain("webmcp");
  });
});
