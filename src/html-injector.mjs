import { TDM_META_TAGS } from "./constants.mjs";
import { WEBMCP_SCRIPT_TAG } from "./webmcp-bridge.mjs";

class HeadMetaInjector {
  element(el) {
    el.append(TDM_META_TAGS + WEBMCP_SCRIPT_TAG, { html: true });
  }
}

// Streams the transform — never buffers the page into memory. Only called
// once the caller has already confirmed content-type is text/html. Also
// injects the WebMCP script tag alongside the TDM meta tags, into <head>.
export function injectTdmMeta(response) {
  return new HTMLRewriter().on("head", new HeadMetaInjector()).transform(response);
}
