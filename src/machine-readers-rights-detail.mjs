// Rights-surface detail stream (v1.11.0, RULE 3).
//
// Everywhere else this sensor aggregates: family, surface class, a count, and
// nothing that could be joined back to a request. Here, and only here, it keeps
// the complete event — full User-Agent, full path, Accept header, timestamp.
//
// Why that is defensible rather than a hole in the posture:
//
//   1. It is RARE. Rights surfaces took 80 reads in 30 days against 17,463
//      total. This stream is ~0.5% of the dataset by volume.
//   2. The PATH leaks nothing. Rights surfaces are a closed set of four fixed
//      URLs that every visitor sees identically; storing "/license.xml" says
//      nothing about who asked, unlike storing an arbitrary article path.
//   3. These are the events the published claim rests on. "Do the crawlers that
//      declare themselves AI-training actually read the rights declarations?"
//      is answerable only with the specific agent and the specific document.
//      An aggregate cannot support that sentence.
//
// Separate dataset, deliberately: different retention question, different
// query shape, and it must never be summed with the aggregate stream.

/** Surface classes that get full-fidelity retention. Widening is a one-line change. */
export const DETAIL_SURFACES = Object.freeze(["rights"]);

// A real User-Agent is well under this. Anything longer is a payload, not a UA,
// so the cap is an attack ceiling rather than truncation of legitimate data —
// "complete" in the sense that matters.
const UA_HARD_CAP = 512;
const HEADER_CAP = 256;
const PATH_CAP = 256;

/**
 * Strip control characters -- which no legitimate header carries, and which
 * break log and JSON handling downstream -- then cap the length. Unlike the
 * aggregate stream's sanitizeUnknownUa(), this does NOT apply a character
 * allowlist: RULE 3 asks for the COMPLETE User-Agent, and an allowlist would
 * not be complete. Renderers MUST therefore escape this on output. It is the
 * one place in the sensor where safety rests on the render lane rather than on
 * the shape of what was stored, which is exactly why the stream is scoped to
 * ~80 events per 30 days.
 */
function clip(value, cap) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .slice(0, cap);
}

/**
 * Record one rights-surface read in full. Fire-and-forget: a missing binding is
 * a no-op, never an error, so a dataset that has not been provisioned yet
 * cannot take the aggregate stream down with it.
 *
 * @returns {boolean} true when a detail row was written.
 */
export function observeRightsSurfaceDetail(request, env, pathname, surface, family, vp) {
  if (!DETAIL_SURFACES.includes(surface)) return false;
  const ds = env && env.SN_MR_RIGHTS;
  if (!ds || typeof ds.writeDataPoint !== "function") return false;

  ds.writeDataPoint({
    blobs: [
      surface,
      family,
      vp?.vendor ?? "",
      vp?.purpose ?? "unknown",
      clip(pathname, PATH_CAP),
      clip(request.headers.get("user-agent"), UA_HARD_CAP),
      clip(request.headers.get("accept"), HEADER_CAP),
      new Date().toISOString(),
    ],
    doubles: [1],
    indexes: [family],
  });
  return true;
}
