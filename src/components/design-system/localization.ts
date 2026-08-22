import type { ReactiveController, ReactiveControllerHost } from "lit";

export type FormaMessageValues = Record<string, string | number>;
export type FormaMessageCatalog = Readonly<Record<string, string>>;
export type FormaDirection = "ltr" | "rtl";

export const FORMA_SUPPORTED_LOCALES = [
  { locale: "en", label: "English", direction: "ltr" },
  { locale: "fr", label: "Français", direction: "ltr" },
  { locale: "ar", label: "العربية", direction: "rtl" },
] as const;

export const FORMA_DEFAULT_MESSAGES: FormaMessageCatalog = {
  "action.default": "Action",
  "action.working": "Working",
  "action.busy": "{label}: {status}",
  "action.more": "More actions",
  "action.continue": "Continue",
  "action.open": "Open",
  "action.save": "Save",
  "action.close": "Close",
  "action.cancel": "Cancel",
  "action.confirm": "Confirm",
  "action.retry": "Retry",
  "action.ready": "Ready",
  "field.text": "Text",
  "field.search": "Search",
  "field.clearSearch": "Clear search",
  "field.choose": "Choose an option",
  "field.option": "Option",
  "field.setting": "Setting",
  "field.number": "Number",
  "editor.formatting": "Text formatting",
  "editor.bold": "Bold",
  "editor.italic": "Italic",
  "editor.heading": "Heading",
  "editor.bullets": "Bulleted list",
  "editor.numbered": "Numbered list",
  "editor.quote": "Quotation",
  "editor.link": "Link",
  "editor.help": "Markdown formatting is available. Use Control or Command plus B for bold and I for italic.",
  "editor.applied": "{format} formatting applied.",
  "filter.label": "Filter",
  "filter.remove": "Remove {label}",
  "avatar.unnamed": "Unnamed person",
  "avatar.person": "Person",
  "status.loading": "Loading",
  "status.progress": "Progress",
  "navigation.sections": "Sections",
  "navigation.breadcrumbs": "Breadcrumb",
  "navigation.pagination": "Pagination",
  "navigation.previous": "Previous page",
  "navigation.next": "Next page",
  "navigation.page": "Page {page} of {total}",
  "navigation.actions": "Actions",
  "navigation.openLink": "Open link",
  "navigation.opensInNewTab": "(opens in a new tab)",
  "notice.dismiss": "Dismiss notice",
  "disclosure.more": "More information",
  "popover.open": "Open options",
  "dialog.heading": "Dialog",
  "dialog.open": "Open dialog",
  "dialog.confirm": "Confirm",
  "dialog.cancel": "Cancel",
  "dialog.close": "Close dialog",
  "clipboard.copy": "Copy",
  "clipboard.success": "Copied to clipboard.",
  "clipboard.failure": "Could not copy. Select the text and copy it manually.",
  "language.label": "Language",
  "language.changed": "Language changed to {language}.",
  "language.failed": "The selected language could not be loaded. Please try again.",
  "shell.skip": "Skip to main content",
  "shell.account": "Account and settings",
  "shell.application": "Application",
  "shell.creative": "Creative",
  "shell.canvas": "Canvas",
  "shell.operations": "Operations",
  "shell.laboratory": "Laboratory",
  "shell.projects": "Projects",
  "shell.library": "Library",
  "shell.home": "Home",
  "shell.command": "Search or run a command",
  "shell.loading": "Opening your {application} workspace",
  "shell.loadingDetail": "Your saved projects and creative work are being restored.",
  "shell.error": "Your work could not be loaded.",
  "shell.busy": "Working: {operation}",
  "shell.running": "A document operation is running on the server",
  "shell.queued": "A document operation is queued",
  "shell.documentTitle": "Forma — An event-sourced creative studio",
  "pdf.unicodeUnavailable": "This presentation contains multilingual text. High-quality export is unavailable, so no incomplete PDF was downloaded.",
};

export type FormaLocaleSnapshot = {
  locale: string;
  formatLocale: string;
  direction: FormaDirection;
  timeZone: string;
  messages: FormaMessageCatalog;
  revision: number;
};

type FormaLocaleSubscriber = (snapshot: FormaLocaleSnapshot, unsubscribe?: () => void) => void;
type FormaLocaleRequest = Event & {
  context: symbol;
  callback: FormaLocaleSubscriber;
  subscribe?: boolean;
};
type FormaLocaleHost = ReactiveControllerHost & HTMLElement;

const LOCALE_CONTEXT = Symbol.for("forma.locale.context");
const STORAGE_KEY = "forma:locale";
const RTL_SCRIPTS = new Set(["Adlm", "Arab", "Hebr", "Mand", "Nkoo", "Rohg", "Samr", "Syrc", "Thaa"]);
const catalogs = new Map<string, FormaMessageCatalog>([["en", FORMA_DEFAULT_MESSAGES]]);
const requests = new Map<string, Promise<FormaMessageCatalog>>();
const subscribers = new Set<FormaLocaleSubscriber>();
const formatters = new Map<string, Intl.NumberFormat | Intl.DateTimeFormat | Intl.PluralRules | Intl.Collator | Intl.Segmenter>();
const timeZones = new Map<string, string>();
let defaultTimeZone = "";
let requestedRevision = 0;

function canonicalLocale(value: string | null | undefined) {
  try { return Intl.getCanonicalLocales(String(value || "en").trim())[0] || "en"; }
  catch { return "en"; }
}

export function formaLocaleFamily(value: string | null | undefined) {
  const canonical = canonicalLocale(value);
  return FORMA_SUPPORTED_LOCALES.find((item) => canonical === item.locale || canonical.startsWith(item.locale + "-"))?.locale || "en";
}

function localeDirection(value: string): FormaDirection {
  try {
    const locale = new Intl.Locale(value) as Intl.Locale & { getTextInfo?: () => { direction?: string } };
    const provided = typeof locale.getTextInfo === "function" ? locale.getTextInfo().direction : undefined;
    return provided === "rtl" || RTL_SCRIPTS.has(locale.maximize().script || "") ? "rtl" : "ltr";
  } catch { return "ltr"; }
}

function safeTimeZone(value?: string | null) {
  const fallback = defaultTimeZone ||= Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  if (!value) return fallback;
  if (value === fallback) return fallback;
  const cached = timeZones.get(value);
  if (cached) return cached;
  try {
    const resolved = new Intl.DateTimeFormat("en", { timeZone: value }).resolvedOptions().timeZone;
    if (timeZones.size >= 32) timeZones.delete(timeZones.keys().next().value || "");
    timeZones.set(value, resolved);
    return resolved;
  }
  catch { return fallback; }
}

let active: FormaLocaleSnapshot = {
  locale: "en",
  formatLocale: "en",
  direction: "ltr",
  timeZone: safeTimeZone(),
  messages: FORMA_DEFAULT_MESSAGES,
  revision: 0,
};

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

async function catalogFor(locale: string): Promise<FormaMessageCatalog> {
  const family = formaLocaleFamily(locale);
  const existing = catalogs.get(family);
  if (existing) return existing;
  let pending = requests.get(family);
  if (!pending) {
    const loader = family === "fr"
      ? import("./locales/fr")
      : import("./locales/ar");
    pending = loader.then((module) => {
      const messages = Object.freeze({ ...FORMA_DEFAULT_MESSAGES, ...module.default });
      catalogs.set(family, messages);
      return messages;
    }).catch((error: unknown) => {
      requests.delete(family);
      throw error;
    });
    requests.set(family, pending);
  }
  return pending;
}

export function currentFormaLocale() { return active; }

function subscribeToRoot(callback: FormaLocaleSubscriber) {
  subscribers.add(callback);
  return () => subscribers.delete(callback);
}

export async function setFormaLocale(value: string, options: { persist?: boolean; timeZone?: string; formatLocale?: string } = {}) {
  const revision = ++requestedRevision;
  const candidate = canonicalLocale(value);
  const locale = formaLocaleFamily(candidate) === "en" && !/^en(?:-|$)/i.test(candidate) ? "en" : candidate;
  let messages: FormaMessageCatalog;
  try { messages = await catalogFor(locale); }
  catch {
    if (revision === requestedRevision) document.dispatchEvent(new CustomEvent("forma-locale-error", {
      detail: { locale, currentLocale: active.locale },
      bubbles: true,
    }));
    return active;
  }
  if (revision !== requestedRevision) return active;
  const direction = localeDirection(locale);
  active = {
    locale,
    formatLocale: canonicalLocale(options.formatLocale || locale),
    direction,
    timeZone: safeTimeZone(options.timeZone),
    messages,
    revision,
  };
  document.documentElement.lang = locale;
  document.documentElement.dir = direction;
  document.title = messages["shell.documentTitle"] || FORMA_DEFAULT_MESSAGES["shell.documentTitle"];
  if (options.persist !== false) {
    try { localStorage.setItem(STORAGE_KEY, locale); }
    catch { /* Device preference storage may be unavailable. */ }
  }
  for (const callback of [...subscribers]) callback(active);
  document.dispatchEvent(new CustomEvent("forma-locale-change", {
    detail: { locale, direction },
    bubbles: true,
  }));
  return active;
}

export function initializeFormaLocale() {
  let saved: string | null = null;
  try { saved = localStorage.getItem(STORAGE_KEY); }
  catch { /* Respect browsers that prohibit device preference storage. */ }
  const browserLocale = navigator.languages?.find((candidate) => {
    const normalized = canonicalLocale(candidate);
    return FORMA_SUPPORTED_LOCALES.some((item) => normalized === item.locale || normalized.startsWith(item.locale + "-"));
  });
  const preferred = saved || browserLocale || document.documentElement.lang || "en";
  const requested = canonicalLocale(preferred);
  if (formaLocaleFamily(requested) === "en") {
    document.documentElement.lang = /^en(?:-|$)/i.test(requested) ? requested : "en";
    document.documentElement.dir = "ltr";
    active = { ...active, locale: document.documentElement.lang, formatLocale: document.documentElement.lang };
    return Promise.resolve(active);
  }
  return setFormaLocale(requested, { persist: Boolean(saved) });
}

/**
 * Non-rendering, composable language and formatting scope.
 * @tag forma-ui-locale
 * @summary Scope translated component messages, writing direction, and regional formatting.
 * @attr {string} lang - Canonical BCP 47 language used by authored and component content.
 * @attr {string} dir - Explicit ltr, rtl, or auto writing-direction override.
 * @attr {string} format-locale - BCP 47 regional locale used for human-readable numbers and dates.
 * @attr {string} time-zone - IANA time zone used for human-readable dates.
 * @fires {CustomEvent<{ locale: string; direction: string }>} forma-locale-change - The effective locale or writing direction changed.
 */
export class FormaUiLocale extends HTMLElement {
  static observedAttributes = ["lang", "dir", "format-locale", "time-zone"];
  #listeners = new Set<FormaLocaleSubscriber>();
  #unsubscribe?: () => void;
  #snapshot?: FormaLocaleSnapshot;
  #parentSnapshot = active;
  #customMessages: FormaMessageCatalog = {};
  #mergedCatalog?: FormaMessageCatalog;
  #mergedSource?: FormaMessageCatalog;
  #mergedOverrides?: FormaMessageCatalog;
  #managedDirection = false;
  #settingDirection = false;

  get formatLocale() { return this.getAttribute("format-locale") || ""; }
  set formatLocale(value: string) { this.setAttribute("format-locale", value); }
  get timeZone() { return this.getAttribute("time-zone") || ""; }
  set timeZone(value: string) { this.setAttribute("time-zone", value); }
  get messages() { return this.#customMessages; }
  set messages(value: FormaMessageCatalog) {
    this.#customMessages = value || {};
    if (this.isConnected) this.#refresh();
  }

  #request = (event: Event) => {
    const request = event as FormaLocaleRequest;
    if (request.context !== LOCALE_CONTEXT) return;
    request.stopImmediatePropagation();
    if (request.subscribe) {
      this.#listeners.add(request.callback);
      request.callback(this.#snapshot || active, () => this.#listeners.delete(request.callback));
    } else request.callback(this.#snapshot || active);
  };

  connectedCallback() {
    this.#managedDirection ||= !this.hasAttribute("dir");
    const callback: FormaLocaleSubscriber = (snapshot, unsubscribe) => {
      if (unsubscribe) this.#unsubscribe = unsubscribe;
      this.#parentSnapshot = snapshot;
      if (this.isConnected) this.#refresh();
    };
    const request = Object.assign(new Event("context-request", { bubbles: true, composed: true }), {
      context: LOCALE_CONTEXT,
      callback,
      subscribe: true,
    });
    this.dispatchEvent(request);
    if (!this.#unsubscribe) {
      this.#parentSnapshot = active;
      this.#unsubscribe = subscribeToRoot(callback);
    }
    this.addEventListener("context-request", this.#request);
    this.#refresh();
  }

  disconnectedCallback() {
    this.removeEventListener("context-request", this.#request);
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
    this.#listeners.clear();
  }

  attributeChangedCallback(name: string, oldValue: string | null, value: string | null) {
    if (oldValue === value || !this.isConnected) return;
    if (name === "dir" && this.#settingDirection) return;
    if (name === "dir" && !this.#settingDirection) this.#managedDirection = value === null;
    this.#refresh();
  }

  #refresh() {
    const ownLanguage = this.hasAttribute("lang");
    const locale = canonicalLocale(this.getAttribute("lang") || this.#parentSnapshot.locale);
    const available = locale === this.#parentSnapshot.locale
      ? this.#parentSnapshot.messages
      : catalogs.get(formaLocaleFamily(locale));
    if (!available) {
      void catalogFor(locale)
        .then(() => { if (this.isConnected) this.#refresh(); })
        .catch(() => { /* Preserve the previously resolved scope if a locale chunk fails. */ });
      return;
    }
    const explicit = this.getAttribute("dir");
    const direction: FormaDirection = !this.#managedDirection && explicit === "rtl"
      ? "rtl"
      : !this.#managedDirection && explicit === "ltr"
        ? "ltr"
        : explicit === "auto"
          ? this.matches(":dir(rtl)") ? "rtl" : "ltr"
          : ownLanguage ? localeDirection(locale) : this.#parentSnapshot.direction;
    if (this.#managedDirection && explicit !== direction) {
      this.#settingDirection = true;
      this.setAttribute("dir", direction);
      this.#settingDirection = false;
    }
    let messages = available;
    if (Object.keys(this.#customMessages).length) {
      if (this.#mergedSource !== available || this.#mergedOverrides !== this.#customMessages) {
        this.#mergedSource = available;
        this.#mergedOverrides = this.#customMessages;
        this.#mergedCatalog = { ...available, ...this.#customMessages };
      }
      messages = this.#mergedCatalog || available;
    }
    const snapshot: FormaLocaleSnapshot = {
      locale,
      formatLocale: canonicalLocale(this.formatLocale || (ownLanguage ? locale : this.#parentSnapshot.formatLocale)),
      direction,
      timeZone: safeTimeZone(this.timeZone || this.#parentSnapshot.timeZone),
      messages,
      revision: this.#parentSnapshot.revision,
    };
    const previous = this.#snapshot;
    if (previous && previous.locale === snapshot.locale && previous.formatLocale === snapshot.formatLocale
      && previous.direction === snapshot.direction && previous.timeZone === snapshot.timeZone
      && previous.messages === snapshot.messages) return;
    this.#snapshot = snapshot;
    for (const callback of [...this.#listeners]) callback(snapshot);
    if (previous) this.dispatchEvent(new CustomEvent("forma-locale-change", {
      detail: { locale: snapshot.locale, direction: snapshot.direction },
      bubbles: true,
      composed: true,
    }));
  }
}

export class FormaLocaleController implements ReactiveController {
  #host: FormaLocaleHost;
  #snapshot = active;
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
      this.#snapshot = active;
      this.#unsubscribe = subscribeToRoot(callback);
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
    const message = this.#snapshot.messages[id] || FORMA_DEFAULT_MESSAGES[id] || fallback || id;
    return message.replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? ""));
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

if (!customElements.get("forma-ui-locale")) customElements.define("forma-ui-locale", FormaUiLocale);

declare global {
  interface HTMLElementTagNameMap {
    "forma-ui-locale": FormaUiLocale;
  }
}
