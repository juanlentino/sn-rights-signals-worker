// A small, strict, dependency-free XML reader.
//
// WHY THIS EXISTS: the rights check has to assert that /license.xml *parses*
// and that its STRUCTURE is right — two <license> elements, ai-train under an
// attribution payment, search/ai-input under a free one. Neither runtime the
// check has to run in provides a parser: Node has no global DOMParser, and the
// vitest worker pool runs in workerd, which has none either. Adding an XML
// library for one file is more supply chain than the job is worth.
//
// The alternative — substring assertions against the template string that
// produced the file — is worthless: it would pass on any well-formed-looking
// garbage and, worse, would pass on a file whose two licences had been merged
// back into one, which is the exact regression this check exists to catch.
//
// STRICT means: throws on unbalanced tags, on a mismatched close tag, on more
// than one root element, on unterminated tags or attribute values, and on text
// outside the root. It does NOT implement entities beyond the five predefined
// ones, DTDs, CDATA, or namespace resolution — none of which appear in RSL 1.0
// documents, and any of which appearing here should be looked at by a human
// rather than silently tolerated.

const PREDEFINED = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

const ATTR_PATTERN = /([:\w][-.:\w]*)\s*=\s*("([^"]*)"|'([^']*)')/g;

function decodeEntities(text) {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body) => {
    if (body[0] === "#") {
      const code =
        body[1] === "x" || body[1] === "X"
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return Object.prototype.hasOwnProperty.call(PREDEFINED, body) ? PREDEFINED[body] : whole;
  });
}

function parseAttributes(raw, tagName) {
  const attrs = {};
  for (const m of raw.matchAll(ATTR_PATTERN)) {
    attrs[m[1]] = decodeEntities(m[3] !== undefined ? m[3] : m[4]);
  }
  // Anything that is not whitespace and did not match name="value" is a
  // malformed attribute (an unquoted value, or a stray quote). Fail loudly
  // rather than dropping it — a dropped attribute is a silent wrong answer.
  const leftover = raw.replace(ATTR_PATTERN, "").trim();
  if (leftover) {
    throw new Error(`malformed attributes on <${tagName}>: ${JSON.stringify(leftover)}`);
  }
  return attrs;
}

/**
 * Parse an XML document into a tree.
 *
 * @param {string} xml Document source.
 * @returns {{name:string, attrs:Record<string,string>, children:object[], text:string}} Root element.
 */
export function parseXml(xml) {
  if (typeof xml !== "string" || xml.trim() === "") throw new Error("empty document");

  // Strip the prolog, processing instructions and comments before tokenizing.
  // Unterminated forms are caught here rather than confusing the tag scanner.
  let src = xml;
  for (const [open, close, label] of [
    ["<?", "?>", "processing instruction"],
    ["<!--", "-->", "comment"],
  ]) {
    let i = src.indexOf(open);
    while (i !== -1) {
      const end = src.indexOf(close, i + open.length);
      if (end === -1) throw new Error(`unterminated ${label}`);
      src = src.slice(0, i) + src.slice(end + close.length);
      i = src.indexOf(open);
    }
  }
  if (src.includes("<!")) throw new Error("DTD or CDATA is not supported by this reader");

  const root = { name: null, attrs: {}, children: [], text: "" };
  const stack = [root];
  let cursor = 0;

  while (cursor < src.length) {
    const lt = src.indexOf("<", cursor);
    if (lt === -1) {
      if (src.slice(cursor).trim()) throw new Error("text after the root element");
      break;
    }

    const between = src.slice(cursor, lt);
    if (between.trim()) {
      if (stack.length === 1) throw new Error("text outside the root element");
      stack[stack.length - 1].text += decodeEntities(between);
    }

    const gt = src.indexOf(">", lt);
    if (gt === -1) throw new Error("unterminated tag");
    const inner = src.slice(lt + 1, gt);
    cursor = gt + 1;

    if (inner.startsWith("/")) {
      const name = inner.slice(1).trim();
      if (stack.length === 1) throw new Error(`close tag </${name}> with no open element`);
      const open = stack.pop();
      if (open.name !== name) {
        throw new Error(`mismatched close tag: <${open.name}> closed by </${name}>`);
      }
      continue;
    }

    const selfClosing = inner.endsWith("/");
    const body = selfClosing ? inner.slice(0, -1) : inner;
    const space = body.search(/\s/);
    const name = (space === -1 ? body : body.slice(0, space)).trim();
    if (!name || /[<>]/.test(name)) throw new Error(`invalid tag name: ${JSON.stringify(inner)}`);

    if (stack.length === 1 && root.name !== null) throw new Error("more than one root element");

    const node = {
      name,
      attrs: parseAttributes(space === -1 ? "" : body.slice(space), name),
      children: [],
      text: "",
    };

    if (stack.length === 1) root.name = name;
    stack[stack.length - 1].children.push(node);
    if (!selfClosing) stack.push(node);
  }

  if (stack.length !== 1) throw new Error(`unclosed element <${stack[stack.length - 1].name}>`);
  if (root.children.length !== 1) throw new Error("document must have exactly one root element");
  return root.children[0];
}

/**
 * Direct children of a node with the given tag name.
 *
 * @param {object} node Parent element.
 * @param {string} name Tag name to match.
 * @returns {object[]} Matching child elements.
 */
export function childrenNamed(node, name) {
  return node.children.filter((c) => c.name === name);
}

/**
 * Whitespace-collapsed text content of a node.
 *
 * @param {object} node Element.
 * @returns {string} Collapsed text.
 */
export function textOf(node) {
  return node.text.replace(/\s+/g, " ").trim();
}
