// SOURCE OF TRUTH for the code browsers run at /webmcp/bridge.js. The served
// asset is COMPOSED from these functions via Function.prototype.toString()
// (src/webmcp-bridge.mjs, a later task), so every function here must be
// self-contained: call sibling exports and browser globals only — never a
// module-scope constant or import, which serialization would silently drop.
// The composition guard (test/webmcp-bridge-client.test.mjs, "serialization
// self-containment") proves that by recomposing these functions with
// new Function(...) — whose body has no lexical access to this module — and
// EXECUTING them. A data:-URL dynamic import would model the browser more
// closely but is rejected by this repo's workerd test runtime; see the note on
// the test itself. Coverage there is per EXECUTED BODY, not per exported name:
// adding a function, or a new branch inside one, means driving it from that
// test or the guard cannot see a dropped reference in it.

// See the SPEC-PIN comment above snWebmcpMain (bottom of this file) for the
// registration surface this probes and why the precedence order below is
// unchanged by that pin.
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

/**
 * Load the verification docket's PURE decision core (prov-verify-core.js) as a
 * classic script exposing window.SNProvVerifyCore. Decisions live in ONE place
 * — this bridge never re-derives a verdict, it only fetches inputs and hands
 * them to the core, exactly as assets/js/prov-verify.js does.
 *
 * Resolves the already-present global when the page's own docket loaded it.
 */
export function snLoadCore(doc, url) {
  return new Promise(function (resolve, reject) {
    var w = typeof window !== "undefined" ? window : null;
    if (w && w.SNProvVerifyCore) return resolve(w.SNProvVerifyCore);

    var settled = false;
    var timer = null;
    // One settle, one cleanup: a script that fires load AND error, or fires
    // after the budget, must not re-settle or leave a live timer behind.
    var finish = function (fn, arg) {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      fn(arg);
    };
    var onLoad = function () {
      var api = (typeof window !== "undefined" && window.SNProvVerifyCore) || null;
      if (api) finish(resolve, api);
      else finish(reject, new Error("verifier core loaded but exposed no API"));
    };
    var onError = function () {
      finish(reject, new Error("verifier core failed to load"));
    };

    // A second call while the first is still in flight must attach to the
    // pending script, not append a duplicate — two <script> tags for the same
    // core is a wasted fetch and a second parse of the same global. The marker
    // is an attribute on the element (no module scope survives serialization).
    var s = doc.querySelector ? doc.querySelector("script[data-sn-prov-core]") : null;
    var fresh = !s;
    if (fresh) {
      s = doc.createElement("script");
      s.src = url;
      if (s.setAttribute) s.setAttribute("data-sn-prov-core", "pending");
    }
    if (s.addEventListener) {
      s.addEventListener("load", onLoad);
      s.addEventListener("error", onError);
    } else {
      s.onload = onLoad;
      s.onerror = onError;
    }
    // A script that fires NEITHER event (a hung connection, a CSP block that
    // reports nothing) would otherwise hang the agent's tool call forever.
    // Inline literal: a module-scope constant would be dropped by composition.
    timer = setTimeout(function () {
      finish(reject, new Error("verifier core timed out after 10 seconds"));
    }, 10000);
    if (fresh) doc.head.appendChild(s);
  });
}

/**
 * The verification docket's four checks, DOM-free, for an agent.
 *
 * A faithful port of runVerification() + checkSignature/checkContentHash/
 * checkLiveMatch/checkAnchor from assets/js/prov-verify.js, minus every DOM
 * concern (setCheck, renderProofWalk, announce, paintVerdict, setStatusLine).
 * No verdict is DERIVED here. Most come straight from the core's derive*
 * functions. The rest are constructed locally — but each one is copied
 * VERBATIM from the docket's own non-core branches, which construct them
 * inline too, and the line it came from is cited at the call site:
 *   prov-verify.js:307  Ed25519 unsupported            -> NOTE
 *   prov-verify.js:332  importKey/verify threw          -> FAIL
 *   prov-verify.js:341  no SHA-256 available            -> UNREACHABLE
 *   prov-verify.js:365  credential carries no live URL  -> UNREACHABLE
 *   prov-verify.js:378  live URL on a foreign origin    -> NOTE
 *   prov-verify.js:383  live twin unreachable           -> UNREACHABLE
 *   prov-verify.js:545  no credential to check          -> UNREACHABLE
 *   prov-verify.js:558  did document unreachable        -> UNREACHABLE
 * Two verdicts have no docket ancestor and are this port's own, both of them
 * refusals to proceed rather than judgements about the credential: the
 * manifest-shape mismatch in signatureLeg() and guard()'s caught-throw. They
 * are marked as such at their call sites. Anything beyond that list belongs in
 * the core, not here.
 *
 * Endpoint reconciliation vs. the docket, which reads its config from page
 * data attributes this bridge does not have:
 *   - credential / did / key_history / record come straight from the in-page
 *     manifest, so Core.ledgerRecordUrl() is not re-derived — the manifest's
 *     record URL IS its output (inc/provenance-machine-pointers.php builds it
 *     from the same SUBJECT_ROOTS map).
 *   - ledgerBase is recovered from that record URL (<base>/<root>/<uid>/vN.json)
 *     purely to reach Core.ledgerKeysUrl(); mempoolBase from the block_header
 *     template. Both are derivations of manifest values, never new endpoints.
 *
 * Never throws: any leg's fetch failure surfaces as that leg's verdict.
 */
export async function snVerifyPage(deps) {
  var options = deps || {};
  var doc = options.doc || (typeof document !== "undefined" ? document : null);
  // redirect-ok: browser-side bridge default fetcher — runs in the visitor page, not the Worker.
  var fetchFn = options.fetchFn || function (u, init) { return fetch(u, init); };
  var loadCore =
    options.loadCore ||
    function () {
      return snLoadCore(
        doc,
        "https://juanlentino.com/wp-content/plugins/signal-and-noise-tools/assets/js/prov-verify-core.js"
      );
    };

  var manifest = doc ? snReadManifest(doc) : null;
  if (!manifest) {
    return {
      signed: false,
      rights: snRightsPointers(),
      note: "This page is not a signed subject; nothing to verify.",
    };
  }
  var subject = manifest.subject || null;

  var Core;
  try {
    Core = await loadCore();
  } catch (e) {
    return {
      signed: true,
      subject: subject,
      error: "verifier core unavailable: " + (e && e.message ? e.message : e),
    };
  }
  if (!Core || !Core.STATE) {
    return { signed: true, subject: subject, error: "verifier core unavailable: no API" };
  }

  var STATE = Core.STATE;
  var calls = manifest.calls || {};
  var subtle = (typeof crypto !== "undefined" && crypto && crypto.subtle) || null;

  function callUrl(name) {
    var c = calls[name];
    return (c && c.url) || "";
  }

  /**
   * The suffix the ledger record URL MUST carry. This convention is built in
   * two OTHER repos (prov-verify-core.js's ledgerRecordUrl + SUBJECT_ROOTS,
   * and the plugin's inc/provenance-machine-pointers.php) — recovering the
   * base by inverting it is only sound while the shape holds, so the shape is
   * checked rather than assumed. The root comes from the core's own
   * SUBJECT_ROOTS map, never from interpolating the page-supplied kind.
   */
  function expectedRecordSuffix() {
    var roots = Core.SUBJECT_ROOTS || { note: "notes" };
    var root = roots[(subject && subject.kind) || "note"] || roots.note || "notes";
    return (
      "/" + root + "/" + encodeURIComponent((subject && subject.uid) || "") +
      "/v" + ((subject && subject.version) || 0) + ".json"
    );
  }

  /** <base>/<root>/<uid>/v<n>.json -> <base>, or "" when the shape drifted. */
  function ledgerBase() {
    var recordUrl = String(callUrl("record"));
    var suffix = expectedRecordSuffix();
    var cut = recordUrl.length - suffix.length;
    if (cut <= 0 || recordUrl.slice(cut) !== suffix) return "";
    return recordUrl.slice(0, cut);
  }

  /** <base>/block-height/{height} -> <base>. */
  function mempoolBase() {
    var t = (calls.block_header && calls.block_header.url_template) || "";
    return String(t).replace(/\/block-height\/\{height\}\/?$/, "");
  }

  /**
   * The docket's fetchJSON, verbatim in semantics: credentials omitted, an
   * AbortController budget so a blocked origin degrades to an explicit
   * unanswered result, and it NEVER rejects — the caller reads `ok`.
   * The 8000 ms budget is inlined: a module-scope constant would be dropped
   * when this function is serialized into the served bridge asset.
   */
  function fetchJSON(u) {
    if (!u) return Promise.resolve({ ok: false, status: 0, json: null, timedOut: false });
    var controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = controller
      ? setTimeout(function () { controller.abort(); }, 8000)
      : null;
    return Promise.resolve()
      .then(function () {
        // redirect-ok: browser-side bridge fetch with credentials:"omit"; no ambient credential can attach.
        return fetchFn(u, { signal: controller ? controller.signal : undefined, credentials: "omit" });
      })
      .then(function (res) {
        if (timer) clearTimeout(timer);
        if (!res || !res.ok) {
          return { ok: false, status: (res && res.status) || 0, json: null, timedOut: false };
        }
        return Promise.resolve(res.json()).then(
          function (json) { return { ok: true, status: res.status, json: json, timedOut: false }; },
          function () { return { ok: false, status: res.status, json: null, timedOut: false }; }
        );
      })
      .catch(function (err) {
        if (timer) clearTimeout(timer);
        var timedOut =
          !!(controller && controller.signal && controller.signal.aborted) ||
          "AbortError" === (err && err.name);
        return { ok: false, status: 0, json: null, timedOut: timedOut };
      });
  }

  /**
   * A degraded result should say WHICH way it degraded: a slow or blocked
   * origin and one that answered 404 are different problems for whoever has to
   * fix it. The docket conflates them (it has a status line to carry the
   * nuance); an agent reading only the verdict does not.
   */
  function why(res) {
    if (res.timedOut) return " The request timed out after 8 seconds.";
    if (res.status) return " The endpoint answered " + res.status + ".";
    return " The request could not be completed.";
  }

  /** Feature-detect Ed25519 the docket's way: an unsupported runtime is a
   *  NOTE, never a FAIL — a missing capability is not a bad signature. */
  function ed25519Supported() {
    if (!subtle || !subtle.importKey) return Promise.resolve(false);
    return Promise.resolve()
      .then(function () {
        return subtle.importKey(
          "jwk",
          { kty: "OKP", crv: "Ed25519", x: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" },
          { name: "Ed25519" },
          false,
          ["verify"]
        );
      })
      .then(function () { return true; }, function () { return false; });
  }

  /** did + this site's mirror + the ledger copy, fetched ONCE for both the
   *  signature leg and the retraction leg (the docket fetches them once too). */
  var keyDocs = null;
  function keyDocuments(base) {
    if (!keyDocs) {
      keyDocs = Promise.all([
        fetchJSON(callUrl("did")),
        fetchJSON(callUrl("key_history")),
        fetchJSON(Core.ledgerKeysUrl(base)),
      ]);
    }
    return keyDocs;
  }

  /**
   * Has the publisher WITHDRAWN this record? A port of checkRetraction
   * (prov-verify.js:369), DOM-free: the retraction is fetched from the ledger
   * and VERIFIED before it is honoured — signed bytes must hash to the claimed
   * content_hash and the signature must verify under the key the retraction
   * NAMES. One that fails is neither honoured nor waved through: it becomes
   * UNKNOWN, which qualifies the verdict. Only a confirmed 404 is clean.
   * Not one of the four checks — its result outranks them (#52).
   */
  async function retractionLeg(cred) {
    var UNKNOWN = { retraction: null, unknown: true };
    if ("function" !== typeof Core.retractionUrl || !subtle || !subtle.digest) return UNKNOWN;
    var base = ledgerBase();
    if (!base) return UNKNOWN;
    var uid = (subject && subject.uid) || "";
    var version =
      (subject && subject.version) ||
      (cred && cred.evidence && cred.evidence[0] && cred.evidence[0].version) ||
      0;
    var res = await fetchJSON(Core.retractionUrl(base, uid, version));
    var found = Core.deriveRetraction(res, uid, version);
    if (!found.retraction) return Core.retractionOutcome(found, null);
    var rec = res.json || {};
    var bytes;
    try {
      bytes = Core.base64ToBytes(rec.signed_payload_b64);
    } catch (e) {
      return Core.retractionOutcome(found, null); // present, unverifiable.
    }
    var keys = await keyDocuments(base);
    var agreement = Core.deriveKeyAgreement(keys[0].json, keys[1].json, keys[2].json, String(rec.pubkey_id || ""));
    if (agreement.verdict || !agreement.jwk) return Core.retractionOutcome(found, null);
    try {
      var digest = await subtle.digest("SHA-256", bytes);
      if (Core.bytesToHex(new Uint8Array(digest)) !== String(rec.content_hash || "").toLowerCase()) {
        return Core.retractionOutcome(found, false);
      }
      var key = await subtle.importKey("jwk", agreement.jwk, { name: "Ed25519" }, false, ["verify"]);
      var valid = await subtle.verify("Ed25519", key, Core.base64ToBytes(rec.signature), bytes);
      return Core.retractionOutcome(found, !!valid);
    } catch (e2) {
      return Core.retractionOutcome(found, null);
    }
  }

  async function signatureLeg(cred) {
    // THIS PORT'S OWN, no docket ancestor: a refusal to guess a URL. The key
    // check is three-way (did + this site's mirror + the independent ledger
    // copy), but the core SKIPS an absent ledger key rather than failing — so
    // fetching a wrong ledger URL would silently degrade the check to two-way
    // and still report PASS. A shape it cannot verify must stop it instead.
    var base = ledgerBase();
    if (!base) {
      return {
        state: STATE.UNREACHABLE,
        detail:
          "The manifest's ledger record URL does not end with the expected " +
          expectedRecordSuffix() +
          ", so the independent ledger copy of the key cannot be located. Refusing to guess: without that third copy this check would quietly become a two-way one and still report a pass.",
      };
    }
    var results = await keyDocuments(base);
    if (!results[0].ok) {
      // prov-verify.js:558
      return {
        state: STATE.UNREACHABLE,
        detail: "Could not reach this site's did document." + why(results[0]),
      };
    }
    if (!(await ed25519Supported())) {
      // prov-verify.js:307
      return {
        state: STATE.NOTE,
        detail: "This runtime does not support Ed25519 verification, so no pass/fail verdict is reported for the signature.",
      };
    }
    // The key the credential NAMES, resolved by id (plugin #874): a record
    // signed under a rotated key must verify under that key, not under
    // whichever key the did lists first (#51).
    var agreement = Core.deriveKeyAgreement(
      results[0].json, results[1].json, results[2].json,
      String((cred && cred.proof && cred.proof.pubkey_id) || "")
    );
    if (agreement.verdict) return agreement.verdict;
    var decoded = Core.decodeProofBytes(cred);
    if (decoded.malformed) return decoded.verdict;
    var valid;
    try {
      var key = await subtle.importKey("jwk", agreement.jwk, { name: "Ed25519" }, false, ["verify"]);
      valid = await subtle.verify("Ed25519", key, decoded.sigBytes, decoded.payloadBytes);
    } catch (e) {
      // prov-verify.js:332
      return { state: STATE.FAIL, detail: "The signature could not be verified." };
    }
    return Core.deriveSignatureVerdict(valid);
  }

  async function contentHashLeg(cred) {
    if (!subtle || !subtle.digest) {
      // prov-verify.js:341
      return { state: STATE.UNREACHABLE, detail: "This runtime has no SHA-256 support to run this check with." };
    }
    var decoded = Core.decodeSignedPayloadBytes(cred);
    if (decoded.malformed) return decoded.verdict;
    var digest = await subtle.digest("SHA-256", decoded.payloadBytes);
    return Core.deriveContentHashVerdict(
      Core.bytesToHex(new Uint8Array(digest)),
      Core.claimedContentHash(cred)
    );
  }

  async function liveMatchLeg(cred) {
    var twinUrl = Core.liveMatchTwinUrl(cred);
    if (!twinUrl) {
      // prov-verify.js:365
      return { state: STATE.UNREACHABLE, detail: "This credential does not carry a live URL to compare against." };
    }
    // The docket's same-origin pin, kept: the credential's claimed live URL is
    // attacker-influenceable data, so a foreign origin is skipped, never
    // probed. The pin is the subject's own URL (the manifest's, not the
    // credential's) falling back to the page location.
    var pin =
      (subject && subject.url) ||
      (typeof location !== "undefined" && location ? location.href : "");
    var pinOrigin = "";
    var twinOrigin = "";
    try { pinOrigin = new URL(pin).origin; } catch (e) { pinOrigin = ""; }
    try { twinOrigin = new URL(twinUrl, pin || undefined).origin; } catch (e2) { twinOrigin = ""; }
    if (!pinOrigin || twinOrigin !== pinOrigin) {
      return {
        state: STATE.NOTE,
        // prov-verify.js:378
        detail: "This credential's live URL is not on this site, so the live comparison is skipped rather than fetching a foreign origin.",
      };
    }
    var res = await fetchJSON(twinUrl);
    if (!res.ok) {
      // prov-verify.js:383
      return {
        state: STATE.UNREACHABLE,
        detail: "Could not reach the live version of this note to compare." + why(res),
      };
    }
    return Core.deriveLiveMatchVerdict(cred, res.json);
  }

  async function anchorLeg(cred) {
    var plan = Core.deriveAnchorPlan(cred);
    if (plan.verdict) return plan.verdict;
    var recordUrl = callUrl("record");
    if ("block-only" === plan.mode) {
      var ledgerRes = await fetchJSON(recordUrl);
      var outcome = Core.deriveBlockOnlyAnchor(plan.anchor, plan.evidence, ledgerRes);
      if (outcome.verdict) return outcome.verdict;
      var txRes2 = await fetchJSON(Core.mempoolTxStatusUrl(mempoolBase(), outcome.followTxid));
      return Core.deriveLedgerTxAnchor(plan.anchor, outcome.blockNote, txRes2);
    }
    var both = await Promise.all([
      fetchJSON(Core.mempoolTxStatusUrl(mempoolBase(), plan.anchor.txid)),
      fetchJSON(recordUrl),
    ]);
    return Core.deriveTxAnchor(plan.anchor, plan.evidence, both[0], both[1]);
  }

  function assemble(checks, retraction) {
    return {
      signed: true,
      subject: subject,
      checks: checks,
      retraction: retraction,
      overall: Core.deriveOverallVerdict(
        {
          signature: checks.signature.state,
          "content-hash": checks.contentHash.state,
          "live-match": checks.liveMatch.state,
          anchor: checks.anchor.state,
        },
        retraction
      ),
      ledger_record: callUrl("record"),
      docket: manifest.spec,
    };
  }

  /** A leg that blew up is an unanswered check, never a thrown run. */
  function guard(leg, detail) {
    return Promise.resolve()
      .then(leg)
      .then(
        function (v) {
          return v && v.state
            ? v
            : { state: STATE.UNREACHABLE, detail: detail + " It returned no verdict." };
        },
        // THIS PORT'S OWN, no docket ancestor. The message is carried through
        // deliberately: a ReferenceError from a port bug and a dead network
        // both land here, and an UNREACHABLE that hides which one it was sends
        // whoever debugs it to the wrong place entirely.
        function (e) {
          return {
            state: STATE.UNREACHABLE,
            detail: detail + " (" + (e && e.message ? e.message : e) + ")",
          };
        }
      );
  }

  try {
    var credRes = await fetchJSON(callUrl("credential"));
    if (!credRes.ok) {
      // prov-verify.js:545 — one fresh object per leg, never one aliased
      // verdict shared four ways.
      var noCredential = function () {
        return {
          state: STATE.UNREACHABLE,
          detail: "Could not run: no credential to check." + why(credRes),
        };
      };
      // Could not look for a retraction either: qualified, never clean.
      return assemble(
        {
          signature: noCredential(), contentHash: noCredential(),
          liveMatch: noCredential(), anchor: noCredential(),
        },
        { retraction: null, unknown: true }
      );
    }
    var cred = credRes.json;
    var settled = await Promise.all([
      guard(function () { return signatureLeg(cred); }, "The signature check could not be completed."),
      guard(function () { return contentHashLeg(cred); }, "The content-hash check could not be completed."),
      guard(function () { return liveMatchLeg(cred); }, "The live-match check could not be completed."),
      guard(function () { return anchorLeg(cred); }, "The anchor check could not be completed."),
      // A retraction leg that blew up is an unknown withdrawal status.
      Promise.resolve()
        .then(function () { return retractionLeg(cred); })
        .then(
          function (r) { return r && "object" === typeof r ? r : { retraction: null, unknown: true }; },
          function () { return { retraction: null, unknown: true }; }
        ),
    ]);
    return assemble(
      { signature: settled[0], contentHash: settled[1], liveMatch: settled[2], anchor: settled[3] },
      settled[4]
    );
  } catch (e) {
    return {
      signed: true,
      subject: subject,
      error: "verification failed: " + (e && e.message ? e.message : e),
    };
  }
}

/**
 * The bridge's tool names, one place. The beacon route on the worker
 * (src/webmcp-call.mjs) accepts exactly these, so a forged beacon naming
 * anything else writes nothing.
 */
export function snWebmcpTools() {
  return ["verify-page", "get-rights-terms", "related-notes", "get-site-map", "get-citation"];
}

/**
 * Read a data-shaped JSON block by id. null when absent or malformed.
 */
export function snReadJsonBlock(doc, id) {
  var el = doc && doc.getElementById ? doc.getElementById(id) : null;
  if (!el) return null;
  try { return JSON.parse(el.textContent); } catch (e) { return null; }
}

/**
 * related-notes (bridge v2, arc one): the kernel's stored top matches for
 * this note, from the #sn-related manifest the plugin emits beside the
 * verification one. Three absences, kept distinct: not a note (no manifest),
 * not built (the artifacts were never built), nothing related (an answer).
 */
export function snRelatedNotes(doc) {
  var m = snReadJsonBlock(doc, "sn-related");
  if (!m) return { related: [], reason: "not a note" };
  if (!m.built) return { related: [], reason: "not built" };
  var rows = Array.isArray(m.related) ? m.related : [];
  if (!rows.length) return { related: [], reason: "nothing related" };
  return { related: rows.map(function (r) {
    return { title: String(r.title || ""), url: String(r.url || ""), score: Number(r.score) || 0, shared_tags: Array.isArray(r.shared_tags) ? r.shared_tags.map(String) : [] };
  }) };
}

/**
 * get-site-map (bridge v2, arc one): /notes/index.json, the machine twin of
 * the site, built by the plugin at each artifact rebuild. Fetched once per
 * page (a module-scope cache would not survive toString composition, so the
 * cache hangs off the window). 404 is "not built"; a failed fetch names the leg.
 */
export async function snGetSiteMap(fetchFn, w) {
  var win = w || (typeof window !== "undefined" ? window : null);
  if (win && win.__snSiteMap) return win.__snSiteMap;
  var f = fetchFn || fetch;
  var res;
  try {
    res = await f("/notes/index.json", { headers: { accept: "application/json" } });
  } catch (e) {
    return { error: "site map fetch failed: " + (e && e.message ? e.message : e) };
  }
  if (res.status === 404) return { error: "not built", reason: "not built" };
  if (!res.ok) return { error: "site map fetch failed: " + res.status };
  var map;
  try { map = await res.json(); } catch (e) { return { error: "site map parse failed: " + (e && e.message ? e.message : e) }; }
  var out = { site_map: map };
  if (win) win.__snSiteMap = out;
  return out;
}

/**
 * The page's own canonical URL, from <link rel="canonical">, else the
 * location. Trailing slash kept as served; comparisons strip it.
 */
export function snCanonicalUrl(doc) {
  var link = doc && doc.querySelector ? doc.querySelector('link[rel="canonical"]') : null;
  var href = (link && link.getAttribute && link.getAttribute("href")) || (doc && doc.location && doc.location.href) || "";
  return String(href).split("#")[0].split("?")[0];
}

/**
 * The page's OWN JSON-LD Article: the one whose mainEntityOfPage (or @id,
 * minus its fragment) is this page's canonical URL. null when the page has
 * none (not a note). v1.25.2: the notes archive lists ten notes as Article
 * items inside an ItemList, and "the first Article in the graph" cited the
 * first listed note as if it were the page.
 */
export function snReadArticle(doc) {
  var canonical = snCanonicalUrl(doc).replace(/\/$/, "");
  var scripts = doc && doc.querySelectorAll ? doc.querySelectorAll('script[type="application/ld+json"]') : [];
  var same = function (u) { return String(u || "").split("#")[0].split("?")[0].replace(/\/$/, "") === canonical; };
  for (var i = 0; i < scripts.length; i++) {
    var data;
    try { data = JSON.parse(scripts[i].textContent); } catch (e) { continue; }
    var graph = data && Array.isArray(data["@graph"]) ? data["@graph"] : [data];
    for (var j = 0; j < graph.length; j++) {
      var node = graph[j];
      if (!node || node["@type"] !== "Article") continue;
      var main = node.mainEntityOfPage && typeof node.mainEntityOfPage === "object" ? node.mainEntityOfPage["@id"] : node.mainEntityOfPage;
      if (canonical && (same(main) || same(node["@id"]) || same(node.url))) return node;
    }
  }
  return null;
}

/**
 * A BibTeX key: surname, year, first word of the title.
 */
export function snCiteKey(year, title) {
  var word = String(title || "").toLowerCase().replace(/[^a-z0-9 ]/g, "").split(/\s+/).filter(function (x) { return x && ["a", "an", "the", "on", "of", "in", "and", "to", "is", "not"].indexOf(x) < 0; })[0] || "note";
  return "lentino" + (year || "") + word;
}

/**
 * BibTeX-escape a field value: the characters TeX reads as commands, and
 * braces, which would unbalance the entry.
 */
export function snBibEscape(v) {
  return String(v || "").replace(/[{}]/g, "").replace(/([&%$#_])/g, "\\$1");
}

/**
 * Two-digit pad for dates.
 */
export function snPad2(n) {
  var s = String(n);
  return s.length < 2 ? "0" + s : s;
}

/**
 * get-citation (bridge v2, arc one; fields widened v1.25.3): this note or
 * essay as BibTeX, CSL-JSON and one plain line (APA-shaped), from the page's
 * own JSON-LD Article (author, dates, headline, description, keywords,
 * canonical) plus, on a signed page, the ledger record's content hash and URL
 * from the verification manifest. Owner decisions 2026-09-16: author
 * "Lentino, Juan", ORCID on every note. Unsigned returns the citation without
 * the anchor. Dates are ISO and zero-padded everywhere.
 */
export async function snGetCitation(doc, fetchFn) {
  var art = snReadArticle(doc);
  if (!art) return { reason: "not a note" };
  var url = snCanonicalUrl(doc) || String((doc.location && doc.location.href) || "");
  var title = String(art.headline || "");
  var published = String(art.datePublished || "");
  var modified = String(art.dateModified || "");
  var description = String(art.description || "");
  var keywords = String(art.keywords || "").split(",").map(function (k) { return k.trim(); }).filter(Boolean);
  var year = published.slice(0, 4);
  var month = published.slice(5, 7);
  var day = published.slice(8, 10);
  var now = new Date();
  var accessed = [now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate()];
  var accessedIso = accessed[0] + "-" + snPad2(accessed[1]) + "-" + snPad2(accessed[2]);
  var orcid = "https://orcid.org/0009-0006-8151-5920";
  var key = snCiteKey(year, title);
  var out = {
    canonical_url: url,
    orcid: orcid,
    csl_json: {
      id: key, type: "post-weblog", title: title, "container-title": "Signal & Noise", URL: url,
      author: [{ family: "Lentino", given: "Juan", ORCID: orcid }],
      issued: { "date-parts": [[Number(year), Number(month), Number(day)]] },
      accessed: { "date-parts": [accessed] },
      language: "en-US",
    },
  };
  if (description) out.csl_json.abstract = description;
  if (keywords.length) out.csl_json.keyword = keywords.join(", ");
  if (modified) out.csl_json.modified = modified;
  var m = snReadManifest(doc);
  if (m && m.calls && m.calls.record && m.calls.record.url) {
    out.ledger_url = String(m.calls.record.url);
    out.uid = m.subject ? String(m.subject.uid || "") : "";
    out.version = m.subject ? Number(m.subject.version) || 0 : 0;
    var f = fetchFn || fetch;
    try {
      var res = await f(out.ledger_url, { headers: { accept: "application/json" } });
      if (res.ok) {
        var rec = await res.json();
        if (rec && rec.content_hash) out.anchored_hash = String(rec.content_hash);
        else out.anchor_error = "the ledger record carries no content_hash";
      } else {
        out.anchor_error = "ledger record fetch failed: " + res.status;
      }
    } catch (e) {
      out.anchor_error = "ledger record fetch failed: " + (e && e.message ? e.message : e);
    }
  }
  if (out.anchored_hash) out.csl_json.note = "Content hash " + out.anchored_hash + "; record " + out.ledger_url;
  var note = "ORCID " + orcid + "." + (out.anchored_hash ? " Content hash " + out.anchored_hash + ", record " + out.ledger_url + "." : "");
  var lines = [
    "@online{" + key + ",",
    "  author = {Lentino, Juan},",
    "  title = {" + snBibEscape(title) + "},",
    "  organization = {Signal \\& Noise},",
    "  date = {" + published.slice(0, 10) + "},",
    "  year = {" + year + "},",
    "  month = {" + month + "},",
    "  url = {" + url + "},",
    "  urldate = {" + accessedIso + "},",
  ];
  if (keywords.length) lines.push("  keywords = {" + snBibEscape(keywords.join(", ")) + "},");
  if (out.version) lines.push("  version = {" + out.version + "},");
  lines.push("  language = {english},");
  lines.push("  note = {" + snBibEscape(note) + "}");
  lines.push("}");
  out.bibtex = lines.join("\n");
  var monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var when = year ? year + (month ? ", " + (monthNames[Number(month) - 1] || month) + (day ? " " + Number(day) : "") : "") : "n.d.";
  out.plain = "Lentino, J. (" + when + "). " + title + ". Signal & Noise. " + url;
  return out;
}

/**
 * The beacon: one row per tool call, {tool, outcome, ms} and nothing else,
 * to the rights-signals worker, which writes it to the machine-readers
 * dataset as family webmcp. Fire-and-forget; a missing sendBeacon or a
 * failure changes nothing for the caller. The figure this feeds is labelled
 * "reported by browsers" on the admin side: a signal, never an audit.
 */
export function snWebmcpBeacon(w, tool, outcome, ms) {
  try {
    var nav = w && w.navigator;
    if (!nav || typeof nav.sendBeacon !== "function") return false;
    var body = JSON.stringify({ tool: String(tool), outcome: String(outcome), ms: Math.max(0, Math.min(60000, Math.round(Number(ms) || 0))) });
    return nav.sendBeacon("/_sn/rights-signals/webmcp-call", new Blob([body], { type: "application/json" }));
  } catch (e) {
    return false;
  }
}

/**
 * Wrap a tool's execute so every call reports itself: ok when the result
 * carries neither error nor reason, absent when it carries a reason (not a
 * note, not built, nothing related), error otherwise or on a throw.
 */
export function snWebmcpMeasured(w, tool, fn) {
  return async function (input) {
    var t0 = Date.now();
    var result;
    try {
      result = await fn(input);
    } catch (e) {
      snWebmcpBeacon(w, tool, "error", Date.now() - t0);
      throw e;
    }
    var outcome = result && result.error ? "error" : (result && result.reason ? "absent" : "ok");
    snWebmcpBeacon(w, tool, outcome, Date.now() - t0);
    return result;
  };
}

/**
 * SPEC-PIN (2026-08-28). Current tool-registration surface for in-page agents
 * is `navigator.modelContext.registerTool({ name, description, inputSchema,
 * execute })` — a W3C WebMachineLearning Community Group Draft Report
 * (latest publication 2026-04-23; editors Brandon Walderman/Microsoft,
 * Khushal Sagar & Dominic Farolino/Google), shipped in Chrome 146
 * (2026-02) as `navigator.modelContext`. Cloudflare's own Browser Run
 * WebMCP developer preview (developers.cloudflare.com/browser-run/features/
 * webmcp/, blog.cloudflare.com/webmcp) targets this exact same surface —
 * their edge-injected bridge.js calls registerTool() the same way this file
 * does, which is the production precedent this task's design follows.
 * `provideContext()` is a sibling API on the same object for ambient (not
 * tool-call) context; unused here.
 *
 * The existing snAgentApi() probe — navigator.modelContext first, window.agent
 * as a fallback for pre-standardization or non-Chrome implementations, gated
 * on registerTool existing — is UNCHANGED by this pin: it already resolves to
 * the confirmed surface. Only the registration CALL SHAPE below is new.
 */
export function snWebmcpMain(w) {
  var win = w || (typeof window !== "undefined" ? window : null);
  var doc = win && win.document;
  if (!doc) return;
  // Idempotence: a page that loads this tag twice (a duplicate injection, a
  // second bridge from a different code path) must not double-register —
  // registerTool has no dedup of its own, so two registrations would leave
  // an agent choosing between two "verify-page" tools with identical names.
  if (win.__snWebmcpRegistered) return;
  var api = snAgentApi(win);
  if (!api) return;
  win.__snWebmcpRegistered = true;

  var none = { type: "object", properties: {}, additionalProperties: false };

  api.registerTool({
    name: "verify-page",
    description:
      "Verify this page's provenance: signature, content hash, live match, and anchor, computed in this browser from the page's own verification manifest. Returns the honest absence on unsigned pages.",
    inputSchema: none,
    execute: snWebmcpMeasured(win, "verify-page", function () { return snVerifyPage(); }),
  });

  api.registerTool({
    name: "get-rights-terms",
    description:
      "The machine-readable rights terms in force for this site: the ODRL policy (W3C TDMRep profile) plus pointers to license.xml, tdmrep.json, and the human-readable policy.",
    inputSchema: none,
    execute: snWebmcpMeasured(win, "get-rights-terms", function () { return snGetRightsTerms(); }),
  });

  // Bridge v2, arc one (2026-09-16): the reader's agent gets the site's own
  // arithmetic. Each reads public bytes and calls no authenticated door.
  api.registerTool({
    name: "related-notes",
    description:
      "The notes this site's own relatedness kernel ranks closest to the current note (title, url, score, shared tags), from the page's related manifest. Says so when the page is not a note, when the index is not built, or when nothing is related.",
    inputSchema: none,
    execute: snWebmcpMeasured(win, "related-notes", function () { return snRelatedNotes(doc); }),
  });

  api.registerTool({
    name: "get-site-map",
    description:
      "What this site is, as structure: pillars with their notes, every published note (title, url, dates, tags, pillar, signed), every published page, the provenance papers, the feeds and the rights terms pointer. From /notes/index.json, built at each index rebuild.",
    inputSchema: none,
    execute: snWebmcpMeasured(win, "get-site-map", function () { return snGetSiteMap(null, win); }),
  });

  api.registerTool({
    name: "get-citation",
    description:
      "Cite the current note: BibTeX and CSL-JSON with the canonical URL, the author's ORCID, and on a signed note the anchored content hash and its public ledger record. Says so when the page is not a note.",
    inputSchema: none,
    execute: snWebmcpMeasured(win, "get-citation", function () { return snGetCitation(doc); }),
  });
}
