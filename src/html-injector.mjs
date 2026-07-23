import { TDM_META_TAGS } from "./constants.mjs";

class HeadMetaInjector {
  element(el) {
    el.append(TDM_META_TAGS, { html: true });
  }
}

// Streams the transform — never buffers the page into memory. Only called
// once the caller has already confirmed content-type is text/html.
export function injectTdmMeta(response) {
  return new HTMLRewriter().on("head", new HeadMetaInjector()).transform(response);
}
