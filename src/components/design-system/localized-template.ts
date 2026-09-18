import type { FormaLocaleController } from "./localization";

type LocalizedTemplate = {
  readonly _$litType$: unknown;
  readonly strings: TemplateStringsArray;
  readonly values: unknown[];
};
type TemplateLocalization = Pick<FormaLocaleController, "locale" | "messages" | "system">;
type TemplateSlot = { readonly original: number } | { readonly source: string };
type TemplatePlan = {
  readonly strings: TemplateStringsArray;
  readonly slots: readonly TemplateSlot[];
  readonly originalSlots: readonly number[];
};

// Only immutable application markup is retained here, never values, DOM or a locale.
const sourcePlans = new WeakMap<TemplateStringsArray, TemplatePlan>();
const preparedPlans = new WeakMap<TemplateStringsArray, TemplatePlan>();
const protectedTags = new Set(["code", "pre", "script", "style", "svg"]);
const voidTags = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
const readableAttributes = new Set(["aria-label", "aria-description", "aria-valuetext", "aria-placeholder", "title", "placeholder", "alt", "label", "heading", "description"]);
// Consume every quoted attribute, so copy-looking text inside a technical value
// cannot become an attribute of its own. Property/event/boolean names stay intact.
const attributes = /(\s+)([.?@]?[\w:-]+)(\s*=\s*)(["'])([\s\S]*?)\4/gu;
const namedEntities: Readonly<Record<string, string>> = {
  amp: "&", AMP: "&", lt: "<", LT: "<", gt: ">", GT: ">", quot: '"', QUOT: '"', apos: "'", nbsp: "\u00a0",
};
const numericReplacements: Readonly<Record<number, number>> = {
  128: 0x20ac, 130: 0x201a, 131: 0x0192, 132: 0x201e, 133: 0x2026, 134: 0x2020, 135: 0x2021,
  136: 0x02c6, 137: 0x2030, 138: 0x0160, 139: 0x2039, 140: 0x0152, 142: 0x017d,
  145: 0x2018, 146: 0x2019, 147: 0x201c, 148: 0x201d, 149: 0x2022, 150: 0x2013, 151: 0x2014,
  152: 0x02dc, 153: 0x2122, 154: 0x0161, 155: 0x203a, 156: 0x0153, 158: 0x017e, 159: 0x0178,
};

/** Decode the audited entity subset before moving static HTML into a Lit value.
 * Unfamiliar named references stay in static HTML for the browser to interpret;
 * neither application markup nor translator output is parsed dynamically.
 */
function staticText(value: string, attribute: boolean): string | null {
  // Literal NUL has context-specific HTML parsing rules; keep its source static.
  // A numeric &#0; reference is different and still decodes below.
  if (value.includes("\0")) return null;
  let supported = true;
  const normalized = value.replace(/\r\n?/gu, "\n");
  const decoded = normalized.replace(/&(?:#(?:[xX][\da-fA-F]+|\d+);?|[A-Za-z][A-Za-z\d]*;?)/gu, (reference, offset: number) => {
    if (reference.startsWith("&#")) {
      const hexadecimal = /^&#[xX]/u.test(reference);
      const number = Number.parseInt(reference.slice(hexadecimal ? 3 : 2), hexadecimal ? 16 : 10);
      if (!number || number > 0x10ffff || (number >= 0xd800 && number <= 0xdfff)) return "\ufffd";
      return String.fromCodePoint(numericReplacements[number] ?? number);
    }
    const terminated = reference.endsWith(";");
    const name = reference.slice(1, terminated ? -1 : undefined);
    if (!Object.hasOwn(namedEntities, name) || (!terminated && name === "apos")) {
      supported = false;
      return reference;
    }
    if (!terminated && attribute && /[=A-Za-z\d]/u.test(normalized[offset + reference.length] ?? "")) return reference;
    return namedEntities[name];
  });
  return supported ? decoded : null;
}

function localizedCopy(value: string, locale: TemplateLocalization) {
  // Preserve the original English-copy contract without a different structure.
  if (locale.locale === "en" || locale.locale.startsWith("en-")) return value;
  const leading = value.match(/^\s*/u)?.[0] || "";
  const trailing = value.match(/\s*$/u)?.[0] || "";
  const source = value.trim();
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
  return translation === source ? value : leading + translation + trailing;
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

function templatePlan(strings: TemplateStringsArray): TemplatePlan {
  const existing = sourcePlans.get(strings);
  if (existing) return existing;
  let prefix = "\uE000forma-slot-";
  while (strings.some(value => value.includes(prefix))) prefix += "slot-";
  const marker = (index: number) => prefix + index + "\uE001";
  const markers = new RegExp(prefix + "(\\d+)\uE001", "gu");
  const source = strings.reduce((combined, value, index) => combined + (index ? marker(index - 1) : "") + value, "");
  const parts = [""], slots: TemplateSlot[] = [], originalSlots: number[] = [];
  let copyCount = 0;
  const literal = (value: string) => { parts[parts.length - 1] += value; };
  const expression = (slot: TemplateSlot) => { slots.push(slot); parts.push(""); };
  const pieces = (value: string, visit: (part: string) => void) => {
    let position = 0;
    for (const match of value.matchAll(markers)) {
      visit(value.slice(position, match.index));
      const original = Number(match[1]);
      originalSlots[original] = slots.length;
      expression({ original });
      position = match.index + match[0].length;
    }
    visit(value.slice(position));
  };
  const unchanged = (value: string) => pieces(value, literal);
  const text = (value: string, attribute = false) => pieces(value, part => {
    const decoded = staticText(part, attribute);
    if (decoded === null || !decoded.trim()) literal(part);
    else { copyCount += 1; expression({ source: decoded }); }
  });
  const tagCopy = (value: string) => {
    let position = 0;
    for (const match of value.matchAll(attributes)) {
      if (!readableAttributes.has(match[2].toLowerCase())) continue;
      const start = match.index + match[1].length + match[2].length + match[3].length + match[4].length;
      unchanged(value.slice(position, start));
      text(match[5], true);
      position = start + match[5].length;
    }
    unchanged(value.slice(position));
  };
  const stack: Array<{ name: string; protected: boolean }> = [];
  let position = 0;
  while (position < source.length) {
    const next = source.indexOf("<", position);
    if (next < 0) {
      const remaining = source.slice(position);
      if (stack.at(-1)?.protected) unchanged(remaining); else text(remaining);
      break;
    }
    const preceding = source.slice(position, next);
    if (stack.at(-1)?.protected) unchanged(preceding); else text(preceding);
    const commentEnd = source.startsWith("<!--", next) ? source.indexOf("-->", next + 4) : -1;
    const end = source.startsWith("<!--", next) ? (commentEnd < 0 ? source.length : commentEnd + 3) : tagEnd(source, next);
    const tag = source.slice(next, end);
    const match = tag.match(/^<\s*(\/?)\s*([a-z][a-z0-9-]*)\b/iu);
    if (!match) { unchanged(tag); position = end; continue; }
    const name = match[2].toLowerCase();
    if (match[1]) {
      const found = stack.findLastIndex(entry => entry.name === name);
      if (found >= 0) stack.splice(found);
      unchanged(tag);
    } else {
      const untranslated = [...tag.matchAll(attributes)].some(attribute => attribute[2].toLowerCase() === "translate" && attribute[5].toLowerCase() === "no");
      const suppressed = Boolean(stack.at(-1)?.protected) || protectedTags.has(name) || untranslated;
      if (suppressed) unchanged(tag); else tagCopy(tag);
      // Textarea default content (including HTML's initial-LF rule) is not system
      // copy. Its accessible attributes can still use ordinary localized values.
      if (!voidTags.has(name) && !/\/\s*>$/u.test(tag)) stack.push({ name, protected: suppressed || name === "textarea" });
    }
    position = end;
  }
  const prepared = copyCount
    ? Object.freeze(Object.defineProperty(parts, "raw", { value: Object.freeze([...parts]) })) as unknown as TemplateStringsArray
    : strings;
  const plan: TemplatePlan = { strings: prepared, slots, originalSlots };
  sourcePlans.set(strings, plan);
  if (prepared !== strings) preparedPlans.set(prepared, plan);
  return plan;
}

/** Translate audited static Lit copy without changing the structural template.
 * Original values and opaque directives are never cached or reinterpreted.
 */
export function localizeTemplateResult<T>(value: T, locale: TemplateLocalization): T {
  if (Array.isArray(value)) {
    const entries = value.map(entry => localizeTemplateResult(entry, locale));
    return (entries.every((entry, index) => Object.is(entry, value[index])) ? value : entries) as T;
  }
  if (!value || typeof value !== "object" || !("_$litType$" in value) || !("strings" in value) || !("values" in value)) return value;
  const template = value as LocalizedTemplate;
  const prepared = preparedPlans.get(template.strings);
  const plan = prepared ?? templatePlan(template.strings);
  // Repeated component/inner localization reads the same original values, not
  // the previous locale's already-expanded copy slots.
  const original = prepared ? plan.originalSlots.map(index => template.values[index]) : template.values;
  const values = plan.slots.map(slot => "original" in slot
    ? localizeTemplateResult(original[slot.original], locale)
    : localizedCopy(slot.source, locale));
  return { ...template, strings: plan.strings, values } as T;
}
