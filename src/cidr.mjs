// IPv4 and IPv6 CIDR matching for vendor-ranges.mjs. PURE. An address is
// parsed to [family, BigInt]; an IPv4-mapped IPv6 address (::ffff:a.b.c.d)
// is read as the IPv4 address it carries. Anything unparseable is null, and a
// null never matches.

function parseV4(s) {
  const p = s.split(".");
  if (p.length !== 4 || !p.every((x) => /^\d{1,3}$/.test(x) && Number(x) <= 255)) return null;
  return p.reduce((n, x) => (n << 8n) | BigInt(Number(x)), 0n);
}

function parseV6(s) {
  if (!/^[0-9a-f:.]+$/i.test(s) || s.split("::").length > 2) return null;
  let tail = [];
  const v4 = s.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const n = parseV4(v4[2]);
    if (n === null) return null;
    s = v4[1] + "0:0";
    tail = [Number(n >> 16n), Number(n & 0xffffn)];
  }
  const [head, rest] = s.split("::");
  const a = head ? head.split(":") : [];
  const b = rest !== undefined && rest !== "" ? rest.split(":") : [];
  const fill = rest === undefined ? 0 : 8 - a.length - b.length;
  if (fill < 0 || (rest === undefined && a.length !== 8)) return null;
  const groups = [...a, ...Array(fill).fill("0"), ...b];
  if (groups.length !== 8 || !groups.every((g) => /^[0-9a-f]{1,4}$/i.test(g))) return null;
  if (tail.length) groups.splice(6, 2, ...tail.map((t) => t.toString(16)));
  return groups.reduce((n, g) => (n << 16n) | BigInt(parseInt(g, 16)), 0n);
}

/**
 * @param {string} ip
 * @returns {[4|6, bigint]|null}
 */
export function parseIp(ip) {
  const s = String(ip ?? "").trim();
  if (s.includes(":")) {
    const n = parseV6(s);
    if (n === null) return null;
    return n >> 32n === 0xffffn ? [4, n & 0xffffffffn] : [6, n];
  }
  const n = parseV4(s);
  return n === null ? null : [4, n];
}

/**
 * Whether ip lies inside cidr ("a.b.c.d/n" or "x::/n"). Families never cross.
 *
 * @param {string} ip
 * @param {string} cidr
 * @returns {boolean}
 */
export function ipInCidr(ip, cidr) {
  const [net, len] = String(cidr ?? "").split("/");
  const a = parseIp(ip);
  const b = parseIp(net);
  const width = b?.[0] === 4 ? 32 : 128;
  if (!a || !b || a[0] !== b[0] || !/^\d{1,3}$/.test(len ?? "") || Number(len) > width || (b[0] === 6 && !net.includes(":"))) return false;
  const shift = BigInt(width - Number(len));
  return a[1] >> shift === b[1] >> shift;
}
