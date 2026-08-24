import english, { type MarketingMessageKey } from "./locales/en";

// This public entry deliberately stays independent of Forma's authenticated
// shell, application-wide catalog, project state, provider adapters, and APIs.
document.documentElement.dataset.formaExperience = "marketing";

type CreativeDecision = "mood" | "audience" | "boundary" | "source";
type CreativeStudyFamily = "landscape" | "portrait" | "detail";
type MarketingLocale = "en" | "fr" | "ar" | "ja";
type MarketingCatalog = Readonly<Record<MarketingMessageKey, string>>;

type CreativeStudy = Readonly<{
  sources: ReadonlyMap<string, string>;
  image: Readonly<Record<"src" | "width" | "height", string>>;
}>;

const DECISION_STUDIES: Record<CreativeDecision, Readonly<{
  family: CreativeStudyFamily;
  label: MarketingMessageKey;
  value: MarketingMessageKey;
}>> = {
  mood: { family: "landscape", label: "moodLabel", value: "moodValue" },
  audience: { family: "portrait", label: "audienceLabel", value: "audienceValue" },
  boundary: { family: "detail", label: "creativeBoundaryLabel", value: "creativeBoundaryValue" },
  source: { family: "landscape", label: "referenceLabel", value: "referenceValue" },
};

const STORAGE_KEY = "forma:locale";
const LANGUAGES = [
  { locale: "en", label: "English", direction: "ltr" },
  { locale: "fr", label: "Français", direction: "ltr" },
  { locale: "ar", label: "العربية", direction: "rtl" },
  { locale: "ja", label: "日本語", direction: "ltr" },
] as const;
const LOADERS = {
  fr: () => import("./locales/fr"),
  ar: () => import("./locales/ar"),
  ja: () => import("./locales/ja"),
};
const catalogs = new Map<MarketingLocale, MarketingCatalog>([["en", english]]);
const requests = new Map<MarketingLocale, Promise<MarketingCatalog>>();
let messages: MarketingCatalog = english;
let activeLocale: MarketingLocale = "en";
let revision = 0;
let languageSelect: HTMLSelectElement | undefined;

function normalizedLocale(value: string | null | undefined) {
  if (!value) return undefined;
  let languageTag: string;
  try { languageTag = Intl.getCanonicalLocales(value.trim().replaceAll("_", "-"))[0]; }
  catch { return undefined; }
  const candidate = languageTag.toLowerCase();
  const language = LANGUAGES.find(({ locale }) => candidate === locale || candidate.startsWith(locale + "-"));
  return language ? { locale: language.locale, languageTag } : undefined;
}

function preferredLocale() {
  const requested = location.pathname.match(/^\/welcome\/(en|fr|ar|ja)\/?$/)?.[1];
  const explicit = normalizedLocale(requested);
  if (explicit) return { ...explicit, persist: true };

  let saved: string | null = null;
  try { saved = localStorage.getItem(STORAGE_KEY); }
  catch { /* Device preference storage is not guaranteed to be available. */ }
  const persisted = normalizedLocale(saved);
  if (persisted) return { ...persisted, persist: true };

  for (const candidate of navigator.languages?.length ? navigator.languages : [navigator.language]) {
    const preferred = normalizedLocale(candidate);
    if (preferred) return { ...preferred, persist: false };
  }
  return { ...(normalizedLocale(document.documentElement.lang) ?? { locale: "en" as const, languageTag: "en" }), persist: false };
}

async function catalogFor(locale: MarketingLocale): Promise<MarketingCatalog> {
  const ready = catalogs.get(locale);
  if (ready) return ready;
  const pending = requests.get(locale);
  if (pending) return pending;

  const load = LOADERS[locale as Exclude<MarketingLocale, "en">]().then(({ default: catalog }) => {
    const expected = Object.keys(english);
    if (Object.keys(catalog).length !== expected.length || expected.some((key) => !Object.hasOwn(catalog, key))) {
      throw new Error("Incomplete public marketing language catalog.");
    }
    const complete = Object.freeze({ ...catalog });
    catalogs.set(locale, complete);
    return complete;
  }).catch((error: unknown) => {
    requests.delete(locale);
    throw error;
  });
  requests.set(locale, load);
  return load;
}

function updateDocument(locale: MarketingLocale, languageTag: string) {
  const direction = locale === "ar" ? "rtl" : "ltr";
  document.documentElement.lang = languageTag;
  document.documentElement.dir = direction;
  document.title = messages.pageTitle;

  for (const element of document.querySelectorAll<HTMLElement>("[data-copy]")) {
    const key = element.dataset.copy as MarketingMessageKey;
    if (Object.hasOwn(messages, key)) element.textContent = messages[key];
  }
  for (const element of document.querySelectorAll<HTMLElement>("[data-copy-aria]")) {
    const key = element.dataset.copyAria as MarketingMessageKey;
    if (Object.hasOwn(messages, key)) element.setAttribute("aria-label", messages[key]);
  }

  const metadata: Record<string, string> = {
    'meta[name="description"]': messages.pageDescription,
    'meta[property="og:title"]': messages.socialTitle,
    'meta[property="og:description"]': messages.socialDescription,
    'meta[property="og:locale"]': ({ en: "en_US", fr: "fr_FR", ar: "ar_SA", ja: "ja_JP" } as const)[locale],
    'meta[name="twitter:title"]': messages.socialTitle,
    'meta[name="twitter:description"]': messages.socialDescription,
  };
  for (const [selector, content] of Object.entries(metadata)) {
    document.querySelector<HTMLMetaElement>(selector)?.setAttribute("content", content);
  }
  document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.setAttribute("href", `/welcome/${locale}`);
  if (languageSelect) languageSelect.value = locale;
  document.dispatchEvent(new CustomEvent("forma-locale-change", { detail: { locale: languageTag, direction }, bubbles: true }));
}

async function setMarketingLocale(
  target: { locale: MarketingLocale; languageTag: string },
  options: { persist?: boolean; announce?: boolean; updateRoute?: boolean } = {},
) {
  const current = ++revision;
  let catalog: MarketingCatalog;
  try { catalog = await catalogFor(target.locale); }
  catch {
    if (current === revision) {
      if (languageSelect) languageSelect.value = activeLocale;
      const status = document.querySelector<HTMLElement>("[data-language-announcement]");
      if (status) status.textContent = messages.languageChangeError;
    }
    return false;
  }
  if (current !== revision) return false;

  activeLocale = target.locale;
  messages = catalog;
  updateDocument(target.locale, target.languageTag);
  if (options.persist) {
    try { localStorage.setItem(STORAGE_KEY, target.languageTag); }
    catch { /* The selected language remains usable without device storage. */ }
  }
  if (options.updateRoute) {
    try { history.replaceState(history.state, "", `/welcome/${target.locale}${location.search}${location.hash}`); }
    catch { /* Translation remains functional when history updates are blocked. */ }
  }
  if (options.announce) {
    const label = LANGUAGES.find(({ locale }) => locale === target.locale)?.label ?? target.locale;
    const status = document.querySelector<HTMLElement>("[data-language-announcement]");
    if (status) status.textContent = messages.languageChanged.replaceAll("{language}", label);
  }
  return true;
}

function mountLanguagePicker() {
  const container = document.querySelector<HTMLElement>("[data-language-picker]");
  if (!container) return;

  const label = document.createElement("label");
  label.className = "marketing-screen-reader";
  label.htmlFor = "marketing-language-select";
  label.dataset.copy = "languageLabel";
  label.textContent = messages.languageLabel;

  const select = document.createElement("select");
  select.id = "marketing-language-select";
  select.className = "marketing-language__select";
  for (const language of LANGUAGES) {
    const option = document.createElement("option");
    option.value = language.locale;
    option.lang = language.locale;
    option.dir = language.direction;
    option.textContent = language.label;
    select.add(option);
  }
  select.value = activeLocale;
  select.addEventListener("change", () => {
    const requested = normalizedLocale(select.value);
    if (!requested) return;
    select.disabled = true;
    select.setAttribute("aria-busy", "true");
    void setMarketingLocale(requested, { persist: true, announce: true, updateRoute: true }).finally(() => {
      select.disabled = false;
      select.removeAttribute("aria-busy");
    });
  });
  languageSelect = select;
  container.replaceChildren(label, select);
}

class FormaContextDemo {
  #element: HTMLElement;
  #studies = new Map<CreativeStudyFamily, CreativeStudy>();

  constructor(element: HTMLElement) {
    this.#element = element;

    for (const picture of document.querySelectorAll<HTMLPictureElement>("picture[data-context-study]")) {
      const family = picture.dataset.contextStudy as CreativeStudyFamily | undefined;
      if (!family || !["landscape", "portrait", "detail"].includes(family)) continue;

      const image = picture.querySelector<HTMLImageElement>("img");
      const sources = new Map<string, string>();
      for (const source of picture.querySelectorAll<HTMLSourceElement>("source[type]")) {
        const type = source.getAttribute("type");
        const candidates = source.getAttribute("srcset");
        if (type && candidates) sources.set(type, candidates);
      }
      if (!image?.getAttribute("src") || !image.getAttribute("width") || !image.getAttribute("height") || !sources.size) continue;

      this.#studies.set(family, {
        sources,
        image: {
          src: image.getAttribute("src") ?? "",
          width: image.getAttribute("width") ?? "",
          height: image.getAttribute("height") ?? "",
        },
      });
    }

    for (const button of this.#element.querySelectorAll<HTMLButtonElement>("[data-context]")) {
      button.addEventListener("click", () => this.#select(button));
    }
  }

  #showStudy(decision: CreativeDecision) {
    const family = DECISION_STUDIES[decision].family;
    const study = this.#studies.get(family);
    const picture = this.#element.querySelector<HTMLPictureElement>("[data-context-study-target]");
    const image = picture?.querySelector<HTMLImageElement>("img");
    const sources = picture ? [...picture.querySelectorAll<HTMLSourceElement>("source[type]")] : [];
    if (!study || !picture || !image || !sources.length || sources.some((source) => !study.sources.has(source.getAttribute("type") ?? ""))) return;

    for (const source of sources) source.setAttribute("srcset", study.sources.get(source.getAttribute("type") ?? "") ?? "");
    for (const [attribute, value] of Object.entries(study.image)) image.setAttribute(attribute, value);
    picture.dataset.contextStudy = family;

    const stage = this.#element.querySelector<HTMLElement>("[data-context-decision]");
    if (stage) stage.dataset.contextDecision = decision;
  }

  #select(button: HTMLButtonElement) {
    const decision = button.dataset.context as CreativeDecision | undefined;
    if (!decision || !["mood", "audience", "boundary", "source"].includes(decision)) return;

    for (const choice of this.#element.querySelectorAll<HTMLButtonElement>("[data-context]")) {
      choice.setAttribute("aria-pressed", String(choice === button));
    }

    const suffix = decision[0].toUpperCase() + decision.slice(1);
    const image = this.#element.querySelector<HTMLElement>('[data-context-line="image"]');
    const story = this.#element.querySelector<HTMLElement>('[data-context-line="story"]');
    const announcement = this.#element.querySelector<HTMLElement>("[data-context-announcement]");
    const focusLabel = this.#element.querySelector<HTMLElement>("[data-context-focus-label]");
    const focusValue = this.#element.querySelector<HTMLElement>("[data-context-focus-value]");
    const focus = DECISION_STUDIES[decision];

    this.#showStudy(decision);

    if (focusLabel) {
      focusLabel.dataset.copy = focus.label;
      focusLabel.textContent = messages[focus.label];
    }
    if (focusValue) {
      focusValue.dataset.copy = focus.value;
      focusValue.textContent = messages[focus.value];
    }

    if (image) {
      const key = `demoImage${suffix}` as MarketingMessageKey;
      image.dataset.copy = key;
      image.textContent = messages[key];
    }
    if (story) {
      const key = `demoStory${suffix}` as MarketingMessageKey;
      story.dataset.copy = key;
      story.textContent = messages[key];
    }
    if (announcement) {
      const key = `demoAnnouncement${suffix}` as MarketingMessageKey;
      announcement.dataset.copy = key;
      announcement.textContent = messages[key];
    }

    for (const preview of this.#element.querySelectorAll<HTMLElement>("[data-context-preview]")) {
      preview.dataset.highlighted = "true";
    }
  }
}

void (async () => {
  const preferred = preferredLocale();
  const initialized = await setMarketingLocale(preferred, { persist: preferred.persist });
  if (!initialized) await setMarketingLocale({ locale: "en", languageTag: "en" });
  mountLanguagePicker();
  // Decisions cannot be activated before their translated catalog is ready.
  for (const demo of document.querySelectorAll<HTMLElement>("[data-context-demo]")) new FormaContextDemo(demo);
})();

if ("IntersectionObserver" in window && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add("marketing-visible");
      observer.unobserve(entry.target);
    }
  }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });

  for (const section of document.querySelectorAll<HTMLElement>("[data-reveal]")) observer.observe(section);
}
