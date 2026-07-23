// GET /_sn/rights-signals/version → namespaced like sn-login-guard's
// /_sn/login-guard/status (sn-analytics already owns the bare /_sn/version
// path with a more-specific route), so deploy verification still uses the
// same one-curl pattern across all four workers on this zone.
export function versionResponse(request, env) {
  if (request.method !== "GET") {
    return new Response(null, { status: 405, headers: { allow: "GET" } });
  }
  const meta = env.CF_VERSION_METADATA || {};
  const body = JSON.stringify(
    {
      worker: "sn-rights-signals",
      version: env.SN_VERSION || null,
      cf_version_id: meta.id || null,
      cf_version_tag: meta.tag || null,
      deployed_at: meta.timestamp || null,
    },
    null,
    2,
  );
  return new Response(body, {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
