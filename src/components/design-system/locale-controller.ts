import type { ReactiveController, ReactiveControllerHost } from "lit";
import { formaSystemMessageId } from "./system-message-id.ts";

export type FormaMessageValues = Record<string, string | number>;
export type FormaMessageCatalog = Readonly<Record<string, string>>;
export type FormaDirection = "ltr" | "rtl";

export type FormaLocaleSnapshot = {
  locale: string;
  formatLocale: string;
  direction: FormaDirection;
  timeZone: string;
  messages: FormaMessageCatalog;
  revision: number;
};

export type FormaLocaleSubscriber = (snapshot: FormaLocaleSnapshot, unsubscribe?: () => void) => void;
export type FormaLocaleRequest = Event & {
  context: symbol;
  callback: FormaLocaleSubscriber;
  subscribe?: boolean;
};
export type FormaLocaleHost = ReactiveControllerHost & HTMLElement;

export const LOCALE_CONTEXT = Symbol.for("forma.locale.context");
const formatters = new Map<string, Intl.NumberFormat | Intl.DateTimeFormat | Intl.PluralRules | Intl.Collator | Intl.Segmenter>();

function cachedFormatter<T extends Intl.NumberFormat | Intl.DateTimeFormat | Intl.PluralRules | Intl.Collator | Intl.Segmenter>(
  kind: string,
  locale: string,
  options: object,
  create: () => T,
): T {
  const sorted = Object.fromEntries(Object.entries(options).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));
  const key = kind + "|" + locale + "|" + JSON.stringify(sorted);
  const existing = formatters.get(key);
  if (existing) {
    formatters.delete(key);
    formatters.set(key, existing);
    return existing as T;
  }
  const created = create();
  formatters.set(key, created);
  if (formatters.size > 64) {
    const first = formatters.keys().next().value;
    if (first) formatters.delete(first);
  }
  return created;
}

export type FormaLocaleRootPort = {
  current(): FormaLocaleSnapshot;
  subscribe(callback: FormaLocaleSubscriber): () => void;
  defaults(): FormaMessageCatalog;
  defaultMessageId(source: string): string | undefined;
};
const fallback: FormaLocaleSnapshot = {locale:"en",formatLocale:"en",direction:"ltr",timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",messages:{},revision:0};
let localeRoot: FormaLocaleRootPort = {current:()=>fallback,subscribe:()=>()=>{},defaults:()=>({}),defaultMessageId:()=>undefined};
const rootSubscribers = new Set<FormaLocaleSubscriber>();
let releaseRoot: (() => void) | undefined;
/** One controller for public and application surfaces. Late root installation
 * preserves connected subscribers; scoped providers still take precedence. */
export function installFormaLocaleRoot(port: FormaLocaleRootPort) {
  releaseRoot?.(); localeRoot = port;
  releaseRoot = port.subscribe(snapshot => { for (const callback of [...rootSubscribers]) callback(snapshot); });
  for (const callback of [...rootSubscribers]) callback(port.current());
}
function subscribeToLocaleRoot(callback: FormaLocaleSubscriber) {
  rootSubscribers.add(callback); return () => { rootSubscribers.delete(callback); };
}

export class FormaLocaleController implements ReactiveController {
  #host: FormaLocaleHost;
  #snapshot = localeRoot.current();
  #unsubscribe?: () => void;

  constructor(host: FormaLocaleHost) {
    this.#host = host;
    host.addController(this);
  }

  hostConnected() {
    const callback: FormaLocaleSubscriber = (value, unsubscribe) => {
      if (unsubscribe) this.#unsubscribe = unsubscribe;
      const changed = this.#snapshot !== value;
      this.#snapshot = value;
      if (changed) this.#host.requestUpdate();
    };
    const request = Object.assign(new Event("context-request", { bubbles: true, composed: true }), {
      context: LOCALE_CONTEXT,
      callback,
      subscribe: true,
    });
    this.#host.dispatchEvent(request);
    if (!this.#unsubscribe) {
      this.#snapshot = localeRoot.current();
      this.#unsubscribe = subscribeToLocaleRoot(callback);
    }
  }

  hostDisconnected() {
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
  }

  get locale() { return this.#snapshot.locale; }
  get direction() { return this.#snapshot.direction; }
  get timeZone() { return this.#snapshot.timeZone; }
  get messages() { return this.#snapshot.messages; }

  t(id: string, fallback = "", values: FormaMessageValues = {}) {
    const message = this.#snapshot.messages[id] || localeRoot.defaults()[id] || fallback || id;
    return message.replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? ""));
  }

  /** Only use with copy authored by Forma; customer content must stay unchanged. */
  system(source: string, values: FormaMessageValues = {}) {
    const normalized = source.replace(/\s+/gu, " ").trim();
    if (!normalized) return source;
    const automatic = formaSystemMessageId(normalized);
    const existing = localeRoot.defaultMessageId(normalized);
    if (!this.#snapshot.messages[automatic] && !existing && !Object.keys(values).length) return source;
    return this.t(this.#snapshot.messages[automatic] ? automatic : existing || automatic, source, values);
  }

  plural(id: string, count: number, one: string, other: string, values: FormaMessageValues = {}) {
    const options = {};
    const formatter = cachedFormatter("plural", this.#snapshot.locale, options, () => new Intl.PluralRules(this.#snapshot.locale));
    const category = formatter.select(count);
    return this.t(id + "." + category, category === "one" ? one : other, {
      count: this.number(count),
      ...values,
    });
  }

  number(value: number, options: Intl.NumberFormatOptions = {}) {
    const formatter = cachedFormatter("number", this.#snapshot.formatLocale, options, () => new Intl.NumberFormat(this.#snapshot.formatLocale, options));
    return formatter.format(value);
  }

  date(value: Date | number, options: Intl.DateTimeFormatOptions = {}) {
    const resolved = { timeZone: this.#snapshot.timeZone, ...options };
    const formatter = cachedFormatter("date", this.#snapshot.formatLocale, resolved, () => new Intl.DateTimeFormat(this.#snapshot.formatLocale, resolved));
    return formatter.format(value);
  }

  collator(options: Intl.CollatorOptions = { usage: "search", sensitivity: "base" }) {
    return cachedFormatter("collator", this.#snapshot.locale, options, () => new Intl.Collator(this.#snapshot.locale, options));
  }

  firstGrapheme(value: string) {
    if (typeof Intl.Segmenter === "function") {
      const options: Intl.SegmenterOptions = { granularity: "grapheme" };
      const segmenter = cachedFormatter("segmenter", this.#snapshot.locale, options, () => new Intl.Segmenter(this.#snapshot.locale, options));
      return segmenter.segment(value)[Symbol.iterator]().next().value?.segment || "";
    }
    return Array.from(value)[0] || "";
  }
}
