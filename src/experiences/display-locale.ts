import { FORMA_SUPPORTED_LOCALES } from "../components/design-system/language-options.ts";
import { experienceMessage } from "./display-messages.ts";

export type ExperienceLocale = typeof FORMA_SUPPORTED_LOCALES[number]["locale"];
type Values = Record<string, string | number>;
type BoundValues = Values | (() => Values);
export interface ExperienceDisplayPort {
  translate(source: string, values?: Values): string;
  bindText<T extends HTMLElement>(element: T, source: string, values?: BoundValues): T;
  bindAttribute<T extends HTMLElement>(element: T, name: string, source: string, values?: BoundValues): T;
}
/** Same saved device preference as the full Forma shell, without its private/UI catalogs. */
export const EXPERIENCE_LOCALE_STORAGE_KEY = "forma:locale";
const family = (value: unknown): ExperienceLocale | undefined => {
  if (typeof value !== "string") return undefined;
  try {
    const canonical = Intl.getCanonicalLocales(value.trim())[0];
    return FORMA_SUPPORTED_LOCALES.find(item => canonical === item.locale || canonical?.startsWith(item.locale + "-"))?.locale;
  } catch { return undefined; }
};
export function experienceLocale(saved: unknown, languages: readonly string[] = [], documentLanguage = "en"): ExperienceLocale {
  if (saved) return family(saved) ?? "en";
  return languages.map(family).find((value): value is ExperienceLocale => Boolean(value)) ?? family(documentLanguage) ?? "en";
}

type Binding = { source: string; values: BoundValues };
type Bindings = { text?: Binding; attributes: Map<string, Binding> };
/** Translates explicitly bound authored copy in place; never rebuilds a control or edits its value. */
export class ExperienceDisplay implements ExperienceDisplayPort {
  #locale: ExperienceLocale;
  #bindings = new WeakMap<HTMLElement, Bindings>();
  #listeners = new Set<() => void>();
  constructor(locale: ExperienceLocale = "en") { this.#locale = locale; }
  get locale() { return this.#locale; }
  get direction() { return FORMA_SUPPORTED_LOCALES.find(item => item.locale === this.#locale)!.direction; }
  translate(source: string, values: Values = {}) { return experienceMessage(this.#locale, source, values); }
  number(value: number, options: Intl.NumberFormatOptions = {}) { return new Intl.NumberFormat(this.#locale, options).format(value); }
  subscribe(callback: () => void) { this.#listeners.add(callback); return () => this.#listeners.delete(callback); }
  setLocale(value: unknown) {
    const locale = family(value);
    if (!locale || locale === this.#locale) return false;
    this.#locale = locale;
    for (const callback of [...this.#listeners]) callback();
    return true;
  }
  #binding(element: HTMLElement) {
    let binding = this.#bindings.get(element);
    if (!binding) { binding = { attributes: new Map() }; this.#bindings.set(element, binding); }
    return binding;
  }
  #render(binding: Binding) { return this.translate(binding.source, typeof binding.values === "function" ? binding.values() : binding.values); }
  bindText<T extends HTMLElement>(element: T, source: string, values: BoundValues = {}): T {
    const binding = { source, values }; this.#binding(element).text = binding;
    element.textContent = this.#render(binding); return element;
  }
  bindAttribute<T extends HTMLElement>(element: T, name: string, source: string, values: BoundValues = {}): T {
    if (!["aria-label", "aria-description", "aria-valuetext", "title", "alt", "label"].includes(name)) throw new Error("experience_display_attribute_invalid");
    const binding = { source, values }; this.#binding(element).attributes.set(name, binding);
    element.setAttribute(name, this.#render(binding)); return element;
  }
  refresh(root: HTMLElement) {
    for (const element of [root, ...root.querySelectorAll<HTMLElement>("*")]) {
      const binding = this.#bindings.get(element); if (!binding) continue;
      if (binding.text) element.textContent = this.#render(binding.text);
      for (const [name, value] of binding.attributes) element.setAttribute(name, this.#render(value));
    }
  }
}
