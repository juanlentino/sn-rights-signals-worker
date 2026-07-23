export const SITE_ORIGIN = "https://juanlentino.com";
export const TDM_POLICY_URL = `${SITE_ORIGIN}/tdm-policy/`;
export const LICENSE_URL = `${SITE_ORIGIN}/license.xml`;

export const TDM_RESERVATION_HEADERS = {
  "TDM-Reservation": "1",
  "TDM-Policy": TDM_POLICY_URL,
};

// Raw HTML fragment, reused verbatim by the generic <head> injector (for
// WordPress-rendered pages) and by the Worker-synthesized /tdm-policy/ page
// itself, so the two surfaces can never drift out of sync.
export const TDM_META_TAGS =
  `<meta name="tdm-reservation" content="1"><meta name="tdm-policy" content="${TDM_POLICY_URL}">`;
