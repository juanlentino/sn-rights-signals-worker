import { describe, expect, it } from "vitest";
import { buildQuery, classifySurface, observeMachineReader, resumeFormat } from "../src/machine-readers.mjs";
import { DETAIL_SURFACES } from "../src/machine-readers-rights-detail.mjs";

// The résumé's machine formats: which crawlers and agents read the résumé, and
// in which format. A surface class for the format FILES, plus blob17 naming the
// format, so a Markdown read negotiated on /resume/ is counted too.
const GPTBOT = "Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)";

function write(url, accept = "*/*") {
  const written = [];
  const env = { SN_MR: { writeDataPoint: (d) => written.push(d) } };
  const req = new Request(url, { headers: { "user-agent": GPTBOT, accept } });
  observeMachineReader(req, env, new URL(url).pathname);
  return written[0];
}

describe("resume surface class", () => {
  it("classifies every résumé format file as resume", () => {
    for (const p of [
      "/resume.md", "/cv.md",
      "/resume/json-resume.json", "/cv/json-resume.json",
      "/resume/contact.vcf",
      "/wp-content/uploads/resume/JuanLentino_Resume.pdf",
      "/resume.json", "/cv.json",
    ]) {
      expect(classifySurface(p), p).toBe("resume");
    }
  });

  it("leaves the HTML pages and lookalikes where they were", () => {
    expect(classifySurface("/resume/")).toBe("html");
    expect(classifySurface("/cv/")).toBe("html");
    expect(classifySurface("/notes/my-resume.md")).toBe("html");
    expect(classifySurface("/resume/other.json")).toBe("html");
    expect(classifySurface("/wp-content/uploads/resume/photo.png")).toBe("asset");
    expect(classifySurface("/wp-content/uploads/2026/10/resume.pdf")).toBe("asset");
  });

  it("is not a rights surface: a résumé read is not a read of the terms", () => {
    expect(DETAIL_SURFACES).not.toContain("resume");
  });
});

describe("resumeFormat (blob17)", () => {
  it("names the format of each file", () => {
    const at = (p) => resumeFormat(new Request("https://juanlentino.com" + p), new URL("https://x" + p).pathname);
    expect(at("/resume.md")).toBe("md");
    expect(at("/cv.md")).toBe("md");
    expect(at("/resume/json-resume.json")).toBe("json");
    expect(at("/cv/json-resume.json")).toBe("json");
    expect(at("/resume/contact.vcf")).toBe("vcf");
    expect(at("/wp-content/uploads/resume/JuanLentino_Resume.pdf?v=f813b3bc")).toBe("pdf");
    expect(at("/resume.json")).toBe("twin");
    expect(at("/cv.json")).toBe("twin");
    expect(at("/notes/x/")).toBe("");
  });

  it("counts Markdown asked for on the page itself, by header or by query", () => {
    expect(write("https://juanlentino.com/resume/", "text/markdown").blobs[16]).toBe("md");
    expect(write("https://juanlentino.com/cv/?output_format=markdown").blobs[16]).toBe("md");
    expect(write("https://juanlentino.com/resume/").blobs[16]).toBe("html");
    expect(write("https://juanlentino.com/cv").blobs[16]).toBe("html");
  });

  it("keeps a negotiated Markdown read of the page in the html surface", () => {
    expect(write("https://juanlentino.com/resume/", "text/markdown").blobs[1]).toBe("html");
  });

  it("is appended as blob17, '' for every other read", () => {
    const d = write("https://juanlentino.com/resume.md");
    expect(d.blobs).toHaveLength(17);
    expect(d.blobs[1]).toBe("resume");
    expect(d.blobs[16]).toBe("md");
    expect(write("https://juanlentino.com/notes/x/").blobs[16]).toBe("");
  });

  it("is read and grouped by the aggregate query", () => {
    const q = buildQuery("aggregate", 30);
    expect(q).toContain("blob17 AS resume_format");
    expect(q).toMatch(/GROUP BY[^F]*resume_format/);
  });
});
