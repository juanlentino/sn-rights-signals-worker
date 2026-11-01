import { describe, expect, it, vi, afterEach } from "vitest";
import worker from "../src/index.mjs";
import { RESUME_PDF_PATH, withResumePdfNoindex } from "../src/resume-pdf-noindex.mjs";

// v1.37.0 (owner brief 2026-11-01 #2): the résumé PDFs stay out of search. The
// music PDF and the Spanish CV are static files, so the edge adds the header.
function stubOrigin(body, headers = {}, status = 200) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { status, headers })));
}
const get = (path) => worker.fetch(new Request("https://juanlentino.com" + path), {}, { passThroughOnException() {}, waitUntil() {} });

afterEach(() => vi.unstubAllGlobals());

describe("résumé PDF noindex", () => {
  it("adds X-Robots-Tag noindex to the music PDF, ?v= or not, beside the TDM reservation, body untouched", async () => {
    for (const path of ["/wp-content/uploads/resume/JuanLentino_Resume.pdf", "/wp-content/uploads/resume/JuanLentino_Resume.pdf?v=1cbacf3e", "/wp-content/uploads/resume/JuanLentino_CV.pdf"]) {
      stubOrigin("%PDF-1.7", { "content-type": "application/pdf", "cache-control": "public, max-age=31536000" });
      const res = await get(path);
      expect(res.headers.get("x-robots-tag"), path).toBe("noindex, nofollow");
      expect(res.headers.get("tdm-reservation"), path).toBe("1");
      expect(res.headers.get("cache-control"), path).toBe("public, max-age=31536000");
      expect(await res.text(), path).toBe("%PDF-1.7");
    }
  });

  it("leaves every other file alone: other uploads, other PDFs, lookalikes", async () => {
    for (const path of ["/wp-content/uploads/2026/07/JuanLentino_Resume.pdf", "/wp-content/uploads/resume/photo.png", "/wp-content/uploads/resume/sub/x.pdf", "/wp-content/uploads/resumes/x.pdf", "/notes/a.pdf"]) {
      stubOrigin("x", { "content-type": "application/pdf" });
      const res = await get(path);
      expect(res.headers.get("x-robots-tag"), path).toBeNull();
    }
  });

  it("keeps an origin noindex as it is, and the page itself is never touched", async () => {
    const kept = withResumePdfNoindex(new Response("x", { headers: { "x-robots-tag": "noindex" } }), "/wp-content/uploads/resume/a.pdf");
    expect(kept.headers.get("x-robots-tag")).toBe("noindex");
    stubOrigin("<html><head></head><body>r</body></html>", { "content-type": "text/html" });
    expect((await get("/resume/")).headers.get("x-robots-tag")).toBeNull();
  });

  it("matches the machine-readers résumé PDF path exactly", () => {
    expect(RESUME_PDF_PATH.test("/wp-content/uploads/resume/JuanLentino_Resume.pdf")).toBe(true);
    expect(RESUME_PDF_PATH.test("/wp-content/uploads/resume/JuanLentino_Resume.PDF")).toBe(true);
    expect(RESUME_PDF_PATH.test("/wp-content/uploads/resume/JuanLentino_Resume.pdf.html")).toBe(false);
  });
});
