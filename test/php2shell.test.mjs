import { describe, it, expect, vi, afterEach } from 'vitest';
import { phpVarName, queryCarriesMarker, cookieCarriesMarker, bodyCarriesMarker, php2shellBlock } from '../src/php2shell.mjs';
import worker from '../src/index.mjs';

const M = 'PHP_SESSION_UPLOAD_PROGRESS';
const CAP = 1024 * 1024;
const req = (body, ct, url = 'https://juanlentino.com/sn-login', headers = {}) =>
  new Request(url, { method: 'POST', body, headers: { 'content-type': ct, ...headers } });
const multipart = (name, { lf = false, value = 'x' } = {}) => {
  const nl = lf ? '\n' : '\r\n';
  return `--b${nl}Content-Disposition: form-data; name="${name}"${nl}${nl}${value}${nl}--b--${nl}`;
};
const MP = 'multipart/form-data; boundary=b';
const UE = 'application/x-www-form-urlencoded';

afterEach(() => vi.unstubAllGlobals());

describe('phpVarName folds like php_register_variable', () => {
  it.each([
    [M, M], ['PHP.SESSION.UPLOAD.PROGRESS', M], ['PHP SESSION UPLOAD PROGRESS', M],
    [`${M}[x]`, M], [`${M}[]`, M], ['PHP_SESSION_UPLOAD[PROGRESS', M], [`  ${M}`, M], [`${M}\0junk`, M],
    ['php_session_upload_progress', 'php_session_upload_progress'], ['PHP.SESSION[UPLOAD]', 'PHP_SESSION'],
  ])('%j -> %j', (raw, want) => expect(phpVarName(raw)).toBe(want));
});

describe('query and cookie names', () => {
  it.each([
    `?${M}=1`, '?PHP.SESSION.UPLOAD.PROGRESS=1', '?PHP+SESSION+UPLOAD+PROGRESS=1', '?PHP%20SESSION%20UPLOAD%20PROGRESS=1',
    '?PHP%5FSESSION%5FUPLOAD%5FPROGRESS=1', `?a=1&${M}`, `?a=1;${M}=2`, `?${M}%00x=1`, `?${M}[;]=1`, `?+${M}=1`,
  ])('blocks %s', (q) => expect(queryCarriesMarker('https://x.test/p' + q)).toBe(true));
  it.each([`?s=${M}`, '?php_session_upload_progress=1', `?${M}X=1`, `?X${M}=1`, '', `?a=1#${M}=1`])(
    'allows %j', (q) => expect(queryCarriesMarker('https://x.test/p' + q)).toBe(false));
  it.each([`${M}=1`, `a=1; ${M}=2`, `a=1,${M}=2`, 'PHP.SESSION.UPLOAD.PROGRESS=1', 'PHP%5FSESSION_UPLOAD_PROGRESS=1'])(
    'blocks cookie %j', (c) => expect(cookieCarriesMarker(c)).toBe(true));
  it.each([`a=${M}`, 'wordpress_logged_in_x=1', null, ''])('allows cookie %j', (c) => expect(cookieCarriesMarker(c)).toBe(false));
});

describe('form bodies', () => {
  it.each([M, 'PHP.SESSION.UPLOAD.PROGRESS', 'PHP SESSION UPLOAD PROGRESS', `${M}[x]`])('blocks multipart field %j', async (name) => {
    expect(await bodyCarriesMarker(req(multipart(name), MP), CAP)).toBe(true);
  });
  it('blocks LF-only multipart, a name split over a continuation line, and an uppercase content type', async () => {
    expect(await bodyCarriesMarker(req(multipart(M, { lf: true }), MP), CAP)).toBe(true);
    expect(await bodyCarriesMarker(req(multipart('PHP_SESSION\r\n_UPLOAD_PROGRESS'), MP), CAP)).toBe(true);
    expect(await bodyCarriesMarker(req(multipart(M), 'Multipart/Form-Data; boundary=b'), CAP)).toBe(true);
  });
  it('blocks a marker behind padding, across chunk boundaries', async () => {
    const body = multipart('pad', { value: 'p'.repeat(200 * 1024) }) + multipart(M);
    expect(await bodyCarriesMarker(req(body, MP), CAP)).toBe(true);
    const enc = new TextEncoder().encode(multipart(M));
    const split = new ReadableStream({ start(c) { for (const b of enc) c.enqueue(new Uint8Array([b])); c.close(); } });
    expect(await bodyCarriesMarker(new Request('https://x.test/', { method: 'POST', body: split, duplex: 'half', headers: { 'content-type': MP } }), CAP)).toBe(true);
  });
  it('refuses a form body over the cap, declared or streamed', async () => {
    expect(await bodyCarriesMarker(req('a=1', UE, undefined, { 'content-length': String(CAP + 1) }), CAP)).toBe(true);
    expect(await bodyCarriesMarker(req('a=' + 'x'.repeat(2048), UE), 1024)).toBe(true);
  });
  it.each([`${M}=1`, `log=juan&${M}=x`, 'PHP.SESSION.UPLOAD.PROGRESS=1', 'PHP%5FSESSION%5FUPLOAD%5FPROGRESS=1', `+${M}=1`])(
    'blocks urlencoded %j', async (b) => expect(await bodyCarriesMarker(req(b, UE), CAP)).toBe(true));
  it.each([
    ['log=juan&pwd=secret&rememberme=forever', UE], [`comment=${M}`, UE], ['log=juan', MP],
    [multipart('log', { value: 'juan' }), MP], [multipart('php_session_upload_progress'), MP], [`{"${M}":1}`, 'application/json'],
  ])('allows %j (%s)', async (b, ct) => expect(await bodyCarriesMarker(req(b, ct), CAP)).toBe(false));
  it('leaves the original body intact for the forward', async () => {
    const r = req('log=juan&pwd=secret', UE);
    expect(await bodyCarriesMarker(r, CAP)).toBe(false);
    expect(await r.text()).toBe('log=juan&pwd=secret');
  });
});

describe('php2shellBlock', () => {
  it('fails closed when the check itself throws', async () => {
    const r = req('a=1', UE);
    Object.defineProperty(r, 'clone', { value: () => { throw new Error('boom'); } });
    expect((await php2shellBlock(r, CAP)).status).toBe(403);
  });
  it('the Worker refuses before the admin bypass and never reaches the origin', async () => {
    const origin = vi.fn();
    vi.stubGlobal('fetch', origin);
    const ctx = { passThroughOnException: vi.fn(), waitUntil() {} };
    for (const r of [
      req(multipart(M), MP, 'https://juanlentino.com/wp-admin/admin-ajax.php'),
      req(`${M}=1`, UE, 'https://juanlentino.com/xmlrpc.php'),
      new Request(`https://juanlentino.com/notes/?${M}=1`),
      new Request('https://juanlentino.com/', { headers: { cookie: `${M}=1` } }),
    ]) expect((await worker.fetch(r, {}, ctx)).status).toBe(403);
    expect(origin).not.toHaveBeenCalled();
  });
  it('forwards an ordinary form POST with its body intact', async () => {
    let seen = null;
    vi.stubGlobal('fetch', vi.fn(async (r) => { seen = await r.text(); return new Response('ok'); }));
    const res = await worker.fetch(req('action=x&nonce=1', UE, 'https://juanlentino.com/wp-admin/admin-ajax.php'), {}, {});
    expect(res.status).toBe(200);
    expect(seen).toBe('action=x&nonce=1');
  });
});
