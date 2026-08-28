// SOURCE OF TRUTH for the code browsers run at /webmcp/bridge.js. The served
// asset is COMPOSED from these functions via Function.prototype.toString()
// (src/webmcp-bridge.mjs, a later task), so every function here must be
// self-contained: call sibling exports and browser globals only — never a
// module-scope constant or import, which serialization would silently drop.
// The composition test (test/webmcp-bridge.test.mjs) imports the composed
// source as a data: URL module to prove it stands alone.

export function snAgentApi(w) {
  var api = (w && w.navigator && w.navigator.modelContext) || (w && w.agent) || null;
  return api && typeof api.registerTool === "function" ? api : null;
}

export function snReadManifest(doc) {
  var el = doc.getElementById("sn-verification-manifest");
  if (!el) return null;
  try { return JSON.parse(el.textContent); } catch (e) { return null; }
}

export function snRightsPointers() {
  return {
    human_policy: "https://juanlentino.com/tdm-policy/",
    license_xml: "https://juanlentino.com/license.xml",
    tdmrep: "https://juanlentino.com/.well-known/tdmrep.json",
    robots: "https://juanlentino.com/robots.txt",
  };
}

export async function snGetRightsTerms(fetchFn) {
  var f = fetchFn || fetch;
  var res;
  try {
    res = await f("/tdm-policy/", { headers: { accept: "application/ld+json" } });
  } catch (e) {
    return { error: "policy fetch failed: " + (e && e.message ? e.message : e), links: snRightsPointers() };
  }
  if (!res.ok) return { error: "policy fetch failed: " + res.status, links: snRightsPointers() };
  var odrl;
  try {
    odrl = await res.json();
  } catch (e) {
    return { error: "policy parse failed: " + (e && e.message ? e.message : e), links: snRightsPointers() };
  }
  return { policy: odrl, links: snRightsPointers() };
}
