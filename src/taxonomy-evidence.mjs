// Taxonomy 1.6.0: the two per-entry fields that let a reader check a claimed
// agent against something other than its user agent. Data, validated here so
// a malformed entry fails at deploy rather than in a published number.
//
//   ip_ranges_url  the vendor's own published list of its crawler's IP ranges
//                  (https only). The sensor checks the client IP against it.
//   home_networks  lowercase substrings of cf.asOrganization the vendor's
//                  crawler runs from. The read path stamps home_network.
//
// Neither may sit beside observable: false (a control token has no requests of
// its own, so there is no network or IP to check).

/**
 * Throws on a malformed ip_ranges_url or home_networks.
 *
 * @param {object} e One taxonomy entry.
 */
export function validateEvidenceFields(e) {
  if (e.ip_ranges_url !== undefined) {
    if (typeof e.ip_ranges_url !== "string" || !/^https:\/\/[^\s/]+\/\S+$/.test(e.ip_ranges_url)) {
      throw new Error(`taxonomy: ip_ranges_url must be an https URL (${e.id})`);
    }
    if (e.observable === false) throw new Error(`taxonomy: ip_ranges_url cannot sit beside observable: false (${e.id})`);
  }
  if (e.home_networks !== undefined) {
    const ok = Array.isArray(e.home_networks) && e.home_networks.length > 0 && e.home_networks.every((n) => typeof n === "string" && n.trim() !== "" && n === n.toLowerCase());
    if (!ok) throw new Error(`taxonomy: home_networks must be a non-empty array of lowercase strings (${e.id})`);
    if (e.observable === false) throw new Error(`taxonomy: home_networks cannot sit beside observable: false (${e.id})`);
  }
}

/**
 * '1' when the network matches a home network, '0' when it matches none, ''
 * when the agent has no list or the network was not measured.
 *
 * @param {string[]|undefined} homes   The entry's home_networks.
 * @param {string}             network The row's network (cf.asOrganization).
 * @returns {"1"|"0"|""}
 */
export function homeNetworkFlag(homes, network) {
  const net = String(network ?? "").trim().toLowerCase();
  if (!homes || net === "") return "";
  return homes.some((h) => net.includes(h)) ? "1" : "0";
}
