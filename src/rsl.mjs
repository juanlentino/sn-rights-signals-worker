import { TDM_POLICY_URL } from "./constants.mjs";

// RSL 1.0 (https://rslstandard.org/rsl). This is the licence LAYERED ON TOP
// of the Article 4 reservation, not a substitute for it: <permits type="usage">
// ai-train</permits> plus <payment type="attribution"> together say "training
// is permitted, conditioned on the attribution terms at tdm-policy" — the
// reservation is what makes that condition legally load-bearing in the first
// place. No major model provider honors RSL today; this is forward-positioning,
// not an enforcement mechanism (see brief Phase 2).
export const RSL_XML = `<?xml version="1.0" encoding="UTF-8"?>
<rsl xmlns="https://rslstandard.org/rsl">
  <content url="/">
    <license>
      <permits type="usage">ai-train</permits>
      <payment type="attribution">
        <standard>${TDM_POLICY_URL}</standard>
      </payment>
    </license>
  </content>
</rsl>
`;

export function rslResponse() {
  return new Response(RSL_XML, {
    status: 200,
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}
