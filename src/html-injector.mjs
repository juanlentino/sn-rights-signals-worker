import { TDM_META_TAGS } from "./constants.mjs";
import { BRIDGE_SRI, WEBMCP_SCRIPT_TAG } from "./webmcp-bridge.mjs";

// The rewritten page is a different entity from the origin's: longer, and
// carrying a script tag whose SRI changes with every bridge release. Keeping
// the origin's validators verbatim let a client revalidate with If-None-Match,
// get 304 from the origin, and keep a page whose integrity attribute no longer
// matches /webmcp/bridge.js (#55). Content-Length is simply wrong after the
// transform; the ETag is re-keyed with the SRI so a bridge release invalidates.
// Last-Modified is dropped (1.40.1): it is the origin's date for the origin's
// page, and an If-Modified-Since revalidation against it drew the same 304.
const ETAG_SUFFIX = BRIDGE_SRI.slice("sha384-".length, "sha384-".length + 8);

class HeadMetaInjector {
  element(el) {
    el.append(TDM_META_TAGS + WEBMCP_SCRIPT_TAG, { html: true });
  }
}

// Streams the transform — never buffers the page into memory. Only called
// once the caller has already confirmed content-type is text/html. Also
// injects the WebMCP script tag alongside the TDM meta tags, into <head>.
export function injectTdmMeta(response) {
  const rewritten = new HTMLRewriter().on("head", new HeadMetaInjector()).transform(response);
  const headers = new Headers(rewritten.headers);
  headers.delete("content-length");
  headers.delete("last-modified");
  const etag = headers.get("etag");
  if (etag) headers.set("etag", etag.endsWith('"') ? `${etag.slice(0, -1)}-${ETAG_SUFFIX}"` : `${etag}-${ETAG_SUFFIX}`);
  return new Response(rewritten.body, { status: rewritten.status, statusText: rewritten.statusText, headers });
}
