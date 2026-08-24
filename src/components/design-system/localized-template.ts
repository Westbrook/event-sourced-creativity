import type { FormaLocaleController } from "./localization";

type LocalizedTemplate = {
  readonly _$litType$: unknown;
  readonly strings: TemplateStringsArray;
  readonly values: unknown[];
};

type TemplateLocalization = Pick<FormaLocaleController, "locale" | "messages" | "system">;

const localizedTemplates = new WeakMap<TemplateStringsArray, WeakMap<object, TemplateStringsArray>>();
const protectedTags = new Set(["code", "pre", "script", "style", "svg"]);
const voidTags = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
const translatableAttribute = /([\s](?:aria-label|aria-description|aria-valuetext|aria-placeholder|title|placeholder|alt|label|heading|description)\s*=\s*)(["'])([\s\S]*?)\2/giu;
const marker = (index: number) => `\uE000forma-slot-${index}\uE001`;
const markers = /\uE000forma-slot-\d+\uE001/gu;

function escaped(value: string, attribute: boolean) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', attribute ? "&quot;" : '"').replaceAll("'", attribute ? "&#39;" : "'");
}

function localizeText(value: string, locale: TemplateLocalization, attribute: boolean) {
  return value.split(markers).reduce((result, part, index) => {
    const leading = part.match(/^\s*/u)?.[0] || "";
    const trailing = part.match(/\s*$/u)?.[0] || "";
    const source = part.trim();
    let translation = source ? locale.system(source) : source;
    if (translation === source) {
      const bounded = source.match(/^([/·,:;–—-]+\s+)(.+)$/u) || source.match(/^(.+?)(\s+[/·,:;–—-]+)$/u);
      if (bounded) {
        const leadingPunctuation = /^[/·,:;–—-]/u.test(source);
        const core = leadingPunctuation ? bounded[2] : bounded[1];
        const localizedCore = locale.system(core);
        if (localizedCore !== core) translation = leadingPunctuation ? bounded[1] + localizedCore : localizedCore + bounded[2];
      }
    }
    const localized = translation === source ? part : leading + escaped(translation, attribute) + trailing;
    return result + (index ? value.match(markers)?.[index - 1] || "" : "") + localized;
  }, "");
}

function localizeTag(value: string, locale: TemplateLocalization) {
  return value.replace(translatableAttribute, (match: string, prefix: string, quote: string, content: string) => {
    const translated = localizeText(content, locale, true);
    return translated === content ? match : prefix + quote + translated + quote;
  });
}

function tagEnd(source: string, start: number) {
  let quote = "";
  for (let position = start + 1; position < source.length; position += 1) {
    const character = source[position];
    if (quote) {
      if (character === quote) quote = "";
    } else if (character === '"' || character === "'") quote = character;
    else if (character === ">") return position + 1;
  }
  return source.length;
}

function localizeStrings(strings: TemplateStringsArray, locale: TemplateLocalization): TemplateStringsArray {
  const existingByCatalog = localizedTemplates.get(strings);
  const existing = existingByCatalog?.get(locale.messages);
  if (existing) return existing;

  const source = strings.reduce((combined, value, index) => combined + (index ? marker(index - 1) : "") + value, "");
  const stack: Array<{ name: string; protected: boolean }> = [];
  let position = 0;
  let result = "";

  while (position < source.length) {
    const next = source.indexOf("<", position);
    if (next < 0) {
      const text = source.slice(position);
      result += stack.at(-1)?.protected ? text : localizeText(text, locale, false);
      break;
    }
    const text = source.slice(position, next);
    result += stack.at(-1)?.protected ? text : localizeText(text, locale, false);
    const end = source.startsWith("<!--", next) ? Math.min(source.length, (source.indexOf("-->", next + 4) + 3 || source.length)) : tagEnd(source, next);
    const tag = source.slice(next, end);
    const match = tag.match(/^<\s*(\/?)\s*([a-z][a-z0-9-]*)\b/iu);
    if (!match) {
      result += tag;
      position = end;
      continue;
    }
    const name = match[2].toLowerCase();
    if (match[1]) {
      const found = stack.findLastIndex((entry) => entry.name === name);
      if (found >= 0) stack.splice(found);
      result += tag;
    } else {
      const suppressed = Boolean(stack.at(-1)?.protected) || protectedTags.has(name) || /\btranslate\s*=\s*(["'])no\1/iu.test(tag);
      result += suppressed ? tag : localizeTag(tag, locale);
      if (!voidTags.has(name) && !/\/\s*>$/u.test(tag)) stack.push({ name, protected: suppressed });
    }
    position = end;
  }

  const parts = result.split(markers);
  if (parts.length !== strings.length) return strings;
  const raw = Object.freeze([...parts]);
  const localized = Object.freeze(Object.defineProperty(parts, "raw", { value: raw })) as unknown as TemplateStringsArray;
  const byCatalog = existingByCatalog || new WeakMap<object, TemplateStringsArray>();
  byCatalog.set(locale.messages, localized);
  if (!existingByCatalog) localizedTemplates.set(strings, byCatalog);
  return localized;
}

/** Translate audited static Lit copy while preserving every dynamic authored value. */
export function localizeTemplateResult<T>(value: T, locale: TemplateLocalization): T {
  if (locale.locale === "en" || locale.locale.startsWith("en-")) return value;
  if (Array.isArray(value)) return value.map((entry) => localizeTemplateResult(entry, locale)) as T;
  if (!value || typeof value !== "object" || !("_$litType$" in value) || !("strings" in value) || !("values" in value)) return value;
  const template = value as LocalizedTemplate;
  const strings = localizeStrings(template.strings, locale);
  const values = template.values.map((entry) => localizeTemplateResult(entry, locale));
  return { ...template, strings, values } as T;
}
