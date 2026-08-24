/** Audit exactly the static Lit copy that the runtime template localizer can translate. */

const STATIC_SLOT = "\uE000forma-static-slot\uE001";
const PROTECTED_TAGS = new Set(["pre", "code", "script", "style", "svg"]);
const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta",
  "param", "source", "track", "wbr",
]);
const READABLE_ATTRIBUTES = new Set([
  "aria-label", "aria-description", "aria-valuetext", "aria-placeholder", "title",
  "placeholder", "alt", "label", "heading", "description",
]);
const TECHNICAL_WORDS = new Set([
  "forma", "canvas", "json", "xml", "html", "css", "svg", "pdf", "mp4", "png",
  "jpg", "jpeg", "webp", "url", "uri", "api", "id", "gpt", "ai", "hd", "usd",
  "rgb", "hsl", "ok", "http", "https", "utc", "ltr", "rtl", "px", "rem", "em",
  "vh", "vw", "ms", "scim", "sso",
]);

function decodeStaticEntities(value) {
  return value.replace(
    /&(?:#x([\da-f]+)|#(\d+)|(amp|lt|gt|quot|apos|nbsp));/giu,
    (_, hex, decimal, name) => hex
      ? String.fromCodePoint(Number.parseInt(hex, 16))
      : decimal
        ? String.fromCodePoint(Number(decimal))
        : ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " })[name.toLowerCase()],
  );
}

function classifyStaticCopy(raw, knownEnglish) {
  const value = decodeStaticEntities(String(raw)).replace(/\s+/gu, " ").trim();
  if (!value || !/[A-Za-z]{2,}/u.test(value)) return null;
  if (TECHNICAL_WORDS.has(value.toLowerCase())) return null;
  if (/^(?:https?:|data:|blob:|#|--)/iu.test(value)) return null;
  if (/^[/.]\S*$/u.test(value)) return null;
  if (/^[a-z\d]+(?:[-_./:][a-z\d]+)+$/u.test(value)) return null;
  if (/^[A-Z\d_./:-]+$/u.test(value)) return null;
  if (/^\d+(?:px|rem|em|vh|vw|ms|s|%)$/iu.test(value)) return null;
  if (/^[a-z][a-zA-Z\d]*$/u.test(value) && /[A-Z\d]/u.test(value)) return null;
  if (knownEnglish.has(value)) return null;

  // Mirror localized-template.ts's exact punctuation-bounded core fallback.
  const bounded = value.match(/^([/·,:;–—-]+\s+)(.+)$/u)
    || value.match(/^(.+?)(\s+[/·,:;–—-]+)$/u);
  if (bounded) {
    const core = /^[/·,:;–—-]/u.test(value) ? bounded[2] : bounded[1];
    if (knownEnglish.has(core)) return null;
  }

  return value;
}

export function auditStaticHtmlTemplate({ typescript, knownEnglish, errors, node, source, relative }) {
  const template = node.template;
  const pieces = typescript.isNoSubstitutionTemplateLiteral(template)
    ? [template.text]
    : [template.head.text, ...template.templateSpans.map((span) => span.literal.text)];
  const markup = pieces.join(STATIC_SLOT);
  const baseLine = source.getLineAndCharacterOfPosition(template.getStart(source)).line + 1;
  const stack = [];

  function inspect(raw, position, attribute) {
    const value = classifyStaticCopy(raw, knownEnglish);
    if (value === null) return;
    const line = baseLine + (markup.slice(0, position).match(/\n/gu)?.length ?? 0);
    const classification = attribute ? `static accessible ${attribute} attribute` : "static visible text";
    errors.push(`${relative}:${line} has untranslated ${classification}: ${JSON.stringify(value)}`);
  }

  function inspectPieces(raw, position, attribute) {
    for (const piece of raw.split(STATIC_SLOT)) {
      inspect(piece, position, attribute);
      position += piece.length + STATIC_SLOT.length;
    }
  }

  const tokens = /<!--[\s\S]*?-->|<(?:"[^"]*"|'[^']*'|[^'">])*?>|[^<]+|</gu;
  for (const token of markup.matchAll(tokens)) {
    const value = token[0];
    const position = token.index ?? 0;
    if (value.startsWith("<!--")) continue;

    if (!value.startsWith("<")) {
      if (!stack.at(-1)?.protected) inspectPieces(value, position);
      continue;
    }

    const tag = value.match(/^<\s*(\/?)\s*([a-z][a-z\d:-]*)\b/iu);
    if (!tag) continue;
    const name = tag[2].toLowerCase();
    if (tag[1]) {
      const opening = stack.findLastIndex((entry) => entry.name === name);
      if (opening >= 0) stack.splice(opening);
      continue;
    }

    const suppressed = Boolean(stack.at(-1)?.protected)
      || PROTECTED_TAGS.has(name)
      || /\btranslate\s*=\s*(["'])no\1/iu.test(value);

    if (!suppressed) {
      const attributes = /(?:^|\s)([.?@]?[\w-]+)\s*=\s*(["'])([\s\S]*?)\2/gu;
      for (const attribute of value.matchAll(attributes)) {
        if (!READABLE_ATTRIBUTES.has(attribute[1])) continue;
        inspectPieces(attribute[3], position + (attribute.index ?? 0), attribute[1]);
      }
    }

    if (!VOID_TAGS.has(name) && !/\/\s*>$/u.test(value)) {
      stack.push({ name, protected: suppressed });
    }
  }
}
