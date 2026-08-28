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

export function snAgentApi(w) {
  var api = (w && w.navigator && w.navigator.modelContext) || (w && w.agent) || null;
  return api && typeof api.registerTool === "function" ? api : null;
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
  var api = snAgentApi(win);
  if (!api) return;

  api.registerTool({
    name: "verify-page",
    description:
      "Verify this page's provenance: signature, content hash, live match, and anchor, computed in this browser from the page's own verification manifest. Returns the honest absence on unsigned pages.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    execute: function () { return snVerifyPage(); },
  });

  api.registerTool({
    name: "get-rights-terms",
    description:
      "The machine-readable rights terms in force for this site: the ODRL policy (W3C TDMRep profile) plus pointers to license.xml, tdmrep.json, and the human-readable policy.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    execute: function () { return snGetRightsTerms(); },
  });
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
    var results = await Promise.all([
      fetchJSON(callUrl("did")),
      fetchJSON(callUrl("key_history")),
      fetchJSON(Core.ledgerKeysUrl(base)),
    ]);
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
    var agreement = Core.deriveKeyAgreement(results[0].json, results[1].json, results[2].json);
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

  function assemble(checks) {
    return {
      signed: true,
      subject: subject,
      checks: checks,
      overall: Core.deriveOverallVerdict({
        signature: checks.signature.state,
        "content-hash": checks.contentHash.state,
        "live-match": checks.liveMatch.state,
        anchor: checks.anchor.state,
      }),
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
      return assemble({
        signature: noCredential(), contentHash: noCredential(),
        liveMatch: noCredential(), anchor: noCredential(),
      });
    }
    var cred = credRes.json;
    var settled = await Promise.all([
      guard(function () { return signatureLeg(cred); }, "The signature check could not be completed."),
      guard(function () { return contentHashLeg(cred); }, "The content-hash check could not be completed."),
      guard(function () { return liveMatchLeg(cred); }, "The live-match check could not be completed."),
      guard(function () { return anchorLeg(cred); }, "The anchor check could not be completed."),
    ]);
    return assemble({
      signature: settled[0], contentHash: settled[1], liveMatch: settled[2], anchor: settled[3],
    });
  } catch (e) {
    return {
      signed: true,
      subject: subject,
      error: "verification failed: " + (e && e.message ? e.message : e),
    };
  }
}
