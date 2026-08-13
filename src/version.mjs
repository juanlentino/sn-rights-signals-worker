// GET /_sn/rights-signals/version → namespaced like sn-login-guard's
// /_sn/login-guard/status (sn-analytics already owns the bare /_sn/version
// path with a more-specific route), so deploy verification still uses the
// same one-curl pattern across all four workers on this zone.
import { getSensorState } from "./machine-readers.mjs";

export function versionResponse(request, env) {
  if (request.method !== "GET") {
    return new Response(null, { status: 405, headers: { allow: "GET" } });
  }
  const meta = env.CF_VERSION_METADATA || {};
  // Machine-reader sensor-alive block: ae_bound reflects env.SN_MR at THIS
  // request (so a dropped binding is visible before any crawler ever hits),
  // the rest is isolate-memory best-effort. last_error is deliberately NOT
  // exposed — raw error text stays in Workers Logs only.
  const sensor = getSensorState();
  const body = JSON.stringify(
    {
      worker: "sn-rights-signals",
      // Both come from `--var` at deploy time, so both are null on any deploy
      // that did not pass them. Workers Builds runs its OWN deploy command and
      // never the package.json `deploy` script — which is why `deploy:ci`
      // exists and why the dashboard Deploy command must point at it. A null
      // here means "this deploy did not say", never "the sensor is down": the
      // reader on the WordPress side must not conflate the two.
      version: env.SN_VERSION || null,
      source_commit: env.SN_COMMIT || null,
      cf_version_id: meta.id || null,
      cf_version_tag: meta.tag || null,
      deployed_at: meta.timestamp || null,
      sensor: {
        ae_bound: !!(env && env.SN_MR && typeof env.SN_MR.writeDataPoint === "function"),
        last_write_ok: sensor.last_write_ok,
        last_write_at: sensor.last_write_at,
      },
    },
    null,
    2,
  );
  return new Response(body, {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
