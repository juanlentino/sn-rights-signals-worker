import { describe, expect, it } from "vitest";
import { TDMREP_JSON, tdmrepResponse } from "../src/tdmrep.mjs";

describe("tdmrep.json", () => {
  it("parses as JSON with the required tdm-reservation shape", () => {
    const parsed = JSON.parse(TDMREP_JSON);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0]).toMatchObject({
      location: "/",
      "tdm-reservation": 1,
      "tdm-policy": "https://juanlentino.com/tdm-policy/",
    });
  });

  it("serves application/json", async () => {
    const res = tdmrepResponse();
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual(JSON.parse(TDMREP_JSON));
  });
});
