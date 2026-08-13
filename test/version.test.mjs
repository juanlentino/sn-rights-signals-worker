import { beforeEach, describe, expect, it, vi } from "vitest";
import { versionResponse } from "../src/version.mjs";
import { _resetSensorStateForTests, observeMachineReader } from "../src/machine-readers.mjs";

const mkReq = (method = "GET") => new Request("https://juanlentino.com/_sn/rights-signals/version", { method });
const crawlerReq = () => new Request("https://juanlentino.com/llms.txt", { headers: { "user-agent": "GPTBot/1.0" } });

describe("versionResponse — sensor-alive block", () => {
  beforeEach(() => {
    _resetSensorStateForTests();
  });

  it("405s non-GET", () => {
    expect(versionResponse(mkReq("POST"), {}).status).toBe(405);
  });

  it("carries the sensor block, with ae_bound live from env before any write", async () => {
    const bound = await versionResponse(mkReq(), { SN_MR: { writeDataPoint: () => {} } }).json();
    expect(bound.sensor).toEqual({ ae_bound: true, last_write_ok: null, last_write_at: null });
    const unbound = await versionResponse(mkReq(), {}).json();
    expect(unbound.sensor.ae_bound).toBe(false);
  });

  it("reflects a successful write's state", async () => {
    const env = { SN_MR: { writeDataPoint: () => {} } };
    observeMachineReader(crawlerReq(), env, "/llms.txt");
    const body = await versionResponse(mkReq(), env).json();
    expect(body.sensor.ae_bound).toBe(true);
    expect(body.sensor.last_write_ok).toBe(true);
    expect(Number.isFinite(Date.parse(body.sensor.last_write_at))).toBe(true);
  });

  it("reports version and source_commit from deploy-time vars", async () => {
    const body = await versionResponse(mkReq(), { SN_VERSION: "1.13.0", SN_COMMIT: "abc1234" }).json();
    expect(body.version).toBe("1.13.0");
    expect(body.source_commit).toBe("abc1234");
  });

  it("reports null — never a placeholder — when the deploy passed no vars", async () => {
    // The Workers Builds default deploy command passes neither, so this is the
    // shape a git-connected auto-deploy actually serves. It must stay
    // distinguishable from an unreachable worker by the reader downstream.
    const body = await versionResponse(mkReq(), {}).json();
    expect(body.version).toBeNull();
    expect(body.source_commit).toBeNull();
    expect(body.worker).toBe("sn-rights-signals");
  });

  it("never leaks error text into the response after a failed write", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const env = { SN_MR: { writeDataPoint: () => { throw new Error("secret-internal-detail"); } } };
    observeMachineReader(crawlerReq(), env, "/llms.txt");
    const res = versionResponse(mkReq(), env);
    const text = await res.text();
    expect(text).not.toContain("secret-internal-detail");
    const body = JSON.parse(text);
    expect(body.sensor.last_write_ok).toBe(false);
    expect(body.sensor.last_error).toBeUndefined();
    expect(Object.keys(body.sensor).sort()).toEqual(["ae_bound", "last_write_at", "last_write_ok"]);
    spy.mockRestore();
  });
});
