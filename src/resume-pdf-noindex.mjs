// v1.37.0: the résumé PDFs stay out of search (owner brief 2026-11-01 #2).
//
// The /resume/ page is the canonical résumé; its PDFs are downloads, linked
// from the page and named in llms.txt, but not results of their own. The music
// PDF and the Spanish CV are static files under /wp-content/uploads/resume/,
// so their headers belong to the web server and carried no X-Robots-Tag; the
// owner was unsure a Cloudflare rule was available for it (2026-11-01). This
// Worker already fronts those reads (it adds the TDM reservation to them), so
// it adds the noindex there, and the Download URL and its ?v= cache-busting
// stay as they are. The operations PDF (/resume/<file>.pdf) is served by
// WordPress with its own X-Robots-Tag. Exact directory, PDFs only: the same
// match as the machine-readers résumé surface.
export const RESUME_PDF_PATH = /^\/wp-content\/uploads\/resume\/[^/]+\.pdf$/i;
export const RESUME_PDF_ROBOTS = "noindex, nofollow";

/** The response with X-Robots-Tag noindex when the path is a résumé PDF; otherwise unchanged. */
export function withResumePdfNoindex(response, pathname) {
  if (!RESUME_PDF_PATH.test(String(pathname || ""))) return response;
  if (/\bnoindex\b/i.test(response.headers.get("x-robots-tag") || "")) return response;
  const headers = new Headers(response.headers);
  headers.set("X-Robots-Tag", RESUME_PDF_ROBOTS);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
