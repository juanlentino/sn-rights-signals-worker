// TEMPORARY virtual patch for PHP2Shell (CVE-2026-109618, CVE-2026-109619).
// Remove once the origin's PHP is patched or session.upload_progress.enabled=0.
// The same file ships in sn-login-guard and sn-rights-signals; keep them identical.
//
// A request is refused when PHP_SESSION_UPLOAD_PROGRESS is the NAME of a
// query parameter, a cookie, an urlencoded form field or a multipart field.
// Every check is a superset of what PHP itself would see: a refusal here may be
// a request PHP would not have treated as the marker, never the other way round.

export const MARKER = 'PHP_SESSION_UPLOAD_PROGRESS';

// The marker with PHP's folded separators allowed between its words.
const FOLDED = /PHP[_. []SESSION[_. []UPLOAD[_. []PROGRESS/;
// Longest raw spelling of the marker (every byte percent-encoded): the tail a
// streamed scan must carry so a match split across two chunks is still seen.
const TAIL = MARKER.length * 3;

// An urlencoded body is held whole and split into pairs, so it gets its own
// small cap whatever the caller's: nothing legitimate posts a megabyte of fields.
const URLENCODED_CAP = 1024 * 1024;

const BLOCK_HEADERS = { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' };

/** PHP's php_url_decode: '+' is a space, %XX is a byte, a bad escape stays. */
export function phpUrlDecode(s) {
  return s.replace(/\+|%([0-9a-fA-F]{2})/g, (m, hex) => (hex ? String.fromCharCode(parseInt(hex, 16)) : ' '));
}

/**
 * The variable name PHP registers (php_register_variable_ex): cut at NUL,
 * leading whitespace dropped, ' ' and '.' become '_'. A '[' with a ']' after
 * it starts an array index, so the name is what comes before it. A '[' with
 * no ']' becomes '_'; PHP stops folding there, this folds the rest too
 * (superset).
 */
export function phpVarName(raw) {
  const name = raw.split('\0')[0].replace(/^\s+/, '');
  const open = name.indexOf('[');
  if (open !== -1 && name.indexOf(']', open) !== -1) return name.slice(0, open).replace(/[ .]/g, '_');
  return name.replace(/[ .[]/g, '_');
}

// Splits on PHP's own separator AND a wider set: a finer split alone could cut
// a name PHP reads whole (`MARKER[;]`), so both are checked.
function pairsCarryMarker(text, separators) {
  return separators.some((sep) => text.split(sep).some((pair) => {
    const eq = pair.indexOf('=');
    return phpVarName(phpUrlDecode(eq === -1 ? pair : pair.slice(0, eq))) === MARKER;
  }));
}

export function queryCarriesMarker(url) {
  const q = url.indexOf('?');
  if (q === -1) return false;
  const hash = url.indexOf('#', q);
  return pairsCarryMarker(url.slice(q + 1, hash === -1 ? undefined : hash), ['&', /[&;]/]);
}

export function cookieCarriesMarker(cookie) {
  return Boolean(cookie) && pairsCarryMarker(cookie, [';', /[;,]/]);
}

// PHP picks its POST parser from the content type, lowercased. Matching a
// substring is looser than PHP's exact mime match, so it scans more, not less.
function formKind(contentType) {
  const ct = (contentType || '').toLowerCase();
  if (ct.includes('multipart')) return 'multipart';
  if (ct.includes('urlencoded')) return 'urlencoded';
  return null;
}

// A multipart field name is never decoded by PHP, but its header may be split
// over continuation lines, which PHP joins. So: drop CR/LF, then look for the
// marker anywhere (raw or percent-decoded). Anywhere means a file whose CONTENT
// holds the marker is refused too; for a temporary patch, that is the price of
// having no parser of our own that could disagree with PHP's.
function multipartWindowCarriesMarker(window) {
  return FOLDED.test(window) || FOLDED.test(phpUrlDecode(window));
}

/**
 * Reads a COPY of the body (the original must reach the origin untouched).
 * True when the body carries the marker, or when it is a form body over the cap
 * (`cap`, or URLENCODED_CAP for an urlencoded body):
 * padding past a cap must not be a way around the check, so over the cap is a
 * refusal, not a pass.
 */
export async function bodyCarriesMarker(request, cap) {
  const kind = formKind(request.headers.get('content-type'));
  if (!kind || !request.body) return false;
  const limit = kind === 'urlencoded' ? Math.min(cap, URLENCODED_CAP) : cap;
  const declared = request.headers.get('content-length');
  if (declared !== null && /^\d+$/.test(declared) && Number(declared) > limit) return true;
  const reader = request.clone().body.getReader();
  // Never await cancel(): on a tee'd branch it settles only once the other
  // branch (the forward) is finished, which would hang this request.
  const stop = (why) => { reader.cancel(why).catch(() => { /* the forward owns the body */ }); return true; };
  const decoder = new TextDecoder();
  let total = 0;
  let tail = '';
  let text = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) return stop('form body over the PHP2Shell scan cap');
    // UTF-8 decoding keeps every ASCII byte as itself, and the marker is ASCII.
    const chunk = decoder.decode(value, { stream: true });
    if (kind === 'urlencoded') { text += chunk; continue; }
    const window = (tail + chunk).replace(/[\r\n]/g, '');
    if (multipartWindowCarriesMarker(window)) return stop('PHP2Shell marker');
    tail = window.slice(-TAIL);
  }
  const rest = decoder.decode();
  if (kind === 'urlencoded') return pairsCarryMarker(text + rest, ['&', /[&;]/]);
  return multipartWindowCarriesMarker((tail + rest).replace(/[\r\n]/g, ''));
}

/**
 * The 403 for a request that carries the marker, or null to let it through.
 * Fails closed: an error while checking is a refusal, because the Workers
 * this runs in fail open (passThroughOnException, the guard's catch) and would
 * otherwise send the request to the origin unchecked.
 */
export async function php2shellBlock(request, cap) {
  let reason = '';
  try {
    if (queryCarriesMarker(request.url)) reason = 'query';
    else if (cookieCarriesMarker(request.headers.get('cookie'))) reason = 'cookie';
    else if (await bodyCarriesMarker(request, cap)) reason = 'body';
  } catch (error) {
    reason = 'error';
  }
  if (!reason) return null;
  console.log(JSON.stringify({ event: 'php2shell_block', reason, method: request.method }));
  return new Response('Forbidden', { status: 403, headers: BLOCK_HEADERS });
}
