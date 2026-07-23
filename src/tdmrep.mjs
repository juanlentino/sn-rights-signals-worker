import { TDM_POLICY_URL } from "./constants.mjs";

// TDMRep well-known expression (https://www.w3.org/community/reports/tdmrep/).
// One of three expression methods this Worker ships (see also: the HTTP
// header pair in constants.mjs, and the <head> meta tags in html-injector.mjs) —
// precedence runs meta > header > well-known file, so all three carry the
// same reservation in case a crawler only reads one of them.
export const TDMREP_JSON = JSON.stringify(
  [{ location: "/", "tdm-reservation": 1, "tdm-policy": TDM_POLICY_URL }],
  null,
  2,
);

export function tdmrepResponse() {
  return new Response(TDMREP_JSON, {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}
