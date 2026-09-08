import { it,expect,vi,afterEach } from 'vitest';
import { machineReadersResponse } from '../src/machine-readers.mjs';
import { readSqlJson } from '../src/sql-response.mjs';
afterEach(()=>vi.restoreAllMocks());
const request=()=>new Request('https://example.test/?view=totals',{headers:{authorization:'Bearer reader'}});
const env={SN_MR_READ_TOKEN:'reader',CF_ACCOUNT_ID:'test',SN_MR_SQL_TOKEN:'sql-secret'};
it.each([301,302,303,307,308,500])('rejects SQL HTTP %s, keeps credentials pinned and releases body',async status=>{
 const cancel=vi.fn();const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(new ReadableStream({cancel}),{status,headers:{location:'https://other.test/'}}));
 const response=await machineReadersResponse(request(),env);expect(response.status).toBe(502);expect(fetch).toHaveBeenCalledTimes(1);expect(fetch.mock.calls[0][1].redirect).toBe('manual');expect(fetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);expect(cancel).toHaveBeenCalled();
});
it('caps a declared oversized response before reading',async()=>{const cancel=vi.fn();await expect(readSqlJson(new Response(new ReadableStream({cancel}),{headers:{'content-length':'99999999'}}))).rejects.toThrow('too large');expect(cancel).toHaveBeenCalled();});
it('caps streamed bytes when Content-Length is missing or false',async()=>{for(const headers of [{},{'content-length':'1'}]){const cancel=vi.fn();const response=new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(10*1024*1024+1));},cancel}),{headers});await expect(readSqlJson(response)).rejects.toThrow('too large');expect(cancel).toHaveBeenCalled();}});
it('decodes UTF-8 split between chunks',async()=>{const bytes=new TextEncoder().encode('{"data":["é"]}');const response=new Response(new ReadableStream({start(c){for(const byte of bytes)c.enqueue(new Uint8Array([byte]));c.close();}}));expect(await readSqlJson(response)).toEqual({data:['é']});});
it('reports a timed out upstream as 502',async()=>{vi.spyOn(globalThis,'fetch').mockRejectedValue(new DOMException('timeout','TimeoutError'));expect((await machineReadersResponse(request(),env)).status).toBe(502);});
