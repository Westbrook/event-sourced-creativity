import english, { type MarketingMessageKey } from "./locales/en";
import { FORMA_SUPPORTED_LOCALES } from "../components/design-system/language-options";
import { ensureNativeModalDialog } from "../components/design-system/native-dialog";
import {
  isMarketingAudienceProfile,
  isMarketingLocale,
  marketingPath,
  parseMarketingRoute,
  type MarketingAudienceProfile,
  type MarketingLocale,
  type MarketingProfile,
} from "./profiles";
import "../components/design-system/language-picker";

// This public entry deliberately stays independent of Forma's authenticated
// shell, application-wide catalog, project state, provider adapters, and APIs.
document.documentElement.dataset.formaExperience = "marketing";

type CreativeDecision = "mood" | "audience" | "boundary" | "source";
type CreativeStudyFamily = "landscape" | "portrait" | "detail" | "twilight";
type MarketingPreviewKind = "story" | "scene" | "presentation" | "storyboard";
type MarketingCatalog = Readonly<Record<MarketingMessageKey, string>>;
type MarketingProfileCatalog = Readonly<Partial<Record<MarketingMessageKey, string>>>;

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
  source: { family: "twilight", label: "referenceLabel", value: "referenceValue" },
};

const STORAGE_KEY = "forma:locale";
const LANGUAGES = FORMA_SUPPORTED_LOCALES;
const LOADERS = {
  fr: () => import("./locales/fr"),
  ar: () => import("./locales/ar"),
  ja: () => import("./locales/ja"),
};
const PROFILE_LOADERS: Record<MarketingAudienceProfile, Record<MarketingLocale, () => Promise<{ default: MarketingProfileCatalog }>>> = {
  "hollywood-filmmakers": {
    en: () => import("./profiles/hollywood-filmmakers/en"),
    fr: () => import("./profiles/hollywood-filmmakers/fr"),
    ar: () => import("./profiles/hollywood-filmmakers/ar"),
    ja: () => import("./profiles/hollywood-filmmakers/ja"),
  },
  marketers: {
    en: () => import("./profiles/marketers/en"),
    fr: () => import("./profiles/marketers/fr"),
    ar: () => import("./profiles/marketers/ar"),
    ja: () => import("./profiles/marketers/ja"),
  },
  "indie-filmmakers": {
    en: () => import("./profiles/indie-filmmakers/en"),
    fr: () => import("./profiles/indie-filmmakers/fr"),
    ar: () => import("./profiles/indie-filmmakers/ar"),
    ja: () => import("./profiles/indie-filmmakers/ja"),
  },
};
const activeProfile: MarketingProfile = parseMarketingRoute(location.pathname)?.profile ?? "generic";
const catalogs = new Map<string, MarketingCatalog>([["generic:en", english]]);
const requests = new Map<string, Promise<MarketingCatalog>>();
let messages: MarketingCatalog = english;
let activeLocale: MarketingLocale = "en";
let revision = 0;
let languagePicker: HTMLElementTagNameMap["forma-ui-language-picker"] | undefined;

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
  const requested = parseMarketingRoute(location.pathname)?.locale;
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
  const key = `${activeProfile}:${locale}`;
  const ready = catalogs.get(key);
  if (ready) return ready;
  const pending = requests.get(key);
  if (pending) return pending;

  const base = locale === "en"
    ? Promise.resolve(english as MarketingCatalog)
    : LOADERS[locale]().then(({ default: catalog }) => catalog);
  const overlay = activeProfile === "generic"
    ? Promise.resolve({} as MarketingProfileCatalog)
    : PROFILE_LOADERS[activeProfile][locale]().then(({ default: catalog }) => catalog);
  const load = Promise.all([base, overlay]).then(([catalog, profile]) => {
    const expected = Object.keys(english);
    if (Object.keys(catalog).length !== expected.length || expected.some((message) => !Object.hasOwn(catalog, message))) {
      throw new Error("Incomplete public marketing language catalog.");
    }
    if (Object.entries(profile).some(([message, value]) => !Object.hasOwn(english, message) || typeof value !== "string" || !value.trim())) {
      throw new Error("Invalid public marketing audience catalog.");
    }
    const complete = Object.freeze({ ...catalog, ...profile });
    catalogs.set(key, complete);
    return complete;
  }).catch((error: unknown) => {
    requests.delete(key);
    throw error;
  });
  requests.set(key, load);
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
  document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.setAttribute("href", marketingPath(activeProfile, locale));
  for (const element of document.querySelectorAll<HTMLAnchorElement | HTMLLinkElement>("a[hreflang], link[rel=alternate][hreflang]")) {
    const requested = element.getAttribute("hreflang") ?? undefined;
    if (requested === "x-default") element.setAttribute("href", marketingPath(activeProfile));
    else if (isMarketingLocale(requested)) element.setAttribute("href", marketingPath(activeProfile, requested));
  }
  for (const link of document.querySelectorAll<HTMLAnchorElement>("[data-profile-link]")) {
    const profile = link.dataset.profileLink;
    if (profile !== "generic" && !isMarketingAudienceProfile(profile)) continue;
    link.href = marketingPath(profile, locale);
    if (profile === activeProfile) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  const audienceNavigation = document.querySelector<HTMLElement>(".marketing-audiences");
  const currentAudience = audienceNavigation?.querySelector<HTMLElement>('[aria-current="page"]');
  if (audienceNavigation && currentAudience) {
    const container = audienceNavigation.getBoundingClientRect();
    const current = currentAudience.getBoundingClientRect();
    if (current.left < container.left || current.right > container.right) {
      audienceNavigation.scrollLeft += direction === "rtl"
        ? current.right - container.right
        : current.left - container.left;
    }
  }
  if (languagePicker) {
    languagePicker.value = locale;
    languagePicker.label = messages.languageLabel;
  }
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
      if (languagePicker) languagePicker.value = activeLocale;
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
    try { history.replaceState(history.state, "", `${marketingPath(activeProfile, target.locale)}${location.search}${location.hash}`); }
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

  const picker = document.createElement("forma-ui-language-picker");
  picker.label = messages.languageLabel;
  picker.value = activeLocale;
  picker.addEventListener("forma-change", (event) => {
    const requested = normalizedLocale((event as CustomEvent<{ value: string }>).detail.value);
    if (!requested) return;
    picker.disabled = true;
    picker.busy = true;
    void setMarketingLocale(requested, { persist: true, announce: true, updateRoute: true }).finally(() => {
      picker.disabled = false;
      picker.busy = false;
    });
  });
  languagePicker = picker;
  container.replaceChildren(picker);
}

class FormaContextDemo {
  #element: HTMLElement;
  #studies = new Map<CreativeStudyFamily, CreativeStudy>();

  constructor(element: HTMLElement) {
    this.#element = element;

    for (const picture of document.querySelectorAll<HTMLPictureElement>("picture[data-context-study]")) {
      const family = picture.dataset.contextStudy as CreativeStudyFamily | undefined;
      if (!family || !["landscape", "portrait", "detail", "twilight"].includes(family)) continue;

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

    for (const carried of this.#element.querySelectorAll<HTMLElement>("[data-context-carried]")) {
      carried.dataset.copy = focus.value;
      carried.textContent = messages[focus.value];
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
    this.#element.dataset.contextActive = decision;
  }
}

class FormaOutputPreview {
  #dialog: HTMLDialogElement;
  #host!: HTMLElement;
  #heading!: HTMLElement;
  #close!: HTMLButtonElement;
  #previous!: HTMLButtonElement;
  #next!: HTMLButtonElement;
  #status!: HTMLElement;
  #navigation!: HTMLElement;
  #details?: HTMLDetailsElement;
  #panel?: HTMLElement;
  #invoker?: HTMLElement;
  #pages: HTMLElement[] = [];
  #kind?: MarketingPreviewKind;
  #index = 0;

  constructor(dialog: HTMLDialogElement) {
    this.#dialog = dialog;
    const host = dialog.querySelector<HTMLElement>("[data-preview-host]");
    const heading = dialog.querySelector<HTMLElement>("#marketing-preview-title");
    const close = dialog.querySelector<HTMLButtonElement>("[data-preview-close]");
    const previous = dialog.querySelector<HTMLButtonElement>("[data-preview-previous]");
    const next = dialog.querySelector<HTMLButtonElement>("[data-preview-next]");
    const status = dialog.querySelector<HTMLElement>("[data-preview-status]");
    const navigation = dialog.querySelector<HTMLElement>("[data-preview-navigation]");
    if (!host || !heading || !close || !previous || !next || !status || !navigation) return;
    this.#host = host;
    this.#heading = heading;
    this.#close = close;
    this.#previous = previous;
    this.#next = next;
    this.#status = status;
    this.#navigation = navigation;
    if (typeof dialog.showModal !== "function") return;

    for (const details of document.querySelectorAll<HTMLDetailsElement>("[data-output-preview]")) {
      const summary = details.querySelector<HTMLElement>("summary");
      if (!summary || !details.querySelector<HTMLElement>("[data-preview-panel]")) continue;
      summary.setAttribute("aria-haspopup", "dialog");
      summary.setAttribute("aria-controls", dialog.id);
      summary.addEventListener("click", (event) => {
        event.preventDefault();
        this.#open(details, summary);
      });
    }

    close.addEventListener("click", () => dialog.close());
    previous.addEventListener("click", () => this.#show(this.#index - 1));
    next.addEventListener("click", () => this.#show(this.#index + 1));
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
    dialog.addEventListener("keydown", (event) => {
      const rtl = document.documentElement.dir === "rtl";
      const forward = event.key === (rtl ? "ArrowLeft" : "ArrowRight") || event.key === "PageDown";
      const backward = event.key === (rtl ? "ArrowRight" : "ArrowLeft") || event.key === "PageUp";
      if (!forward && !backward && event.key !== "Home" && event.key !== "End") return;
      event.preventDefault();
      if (event.key === "Home") this.#show(0);
      else if (event.key === "End") this.#show(this.#pages.length - 1);
      else this.#show(this.#index + (forward ? 1 : -1));
    });
    dialog.addEventListener("close", () => this.#restore());
    document.addEventListener("forma-locale-change", () => {
      if (dialog.open) this.#show(this.#index);
    });
  }

  #open(details: HTMLDetailsElement, invoker: HTMLElement) {
    const kind = details.dataset.outputPreview as MarketingPreviewKind | undefined;
    const panel = details.querySelector<HTMLElement>("[data-preview-panel]");
    if (!kind || !["story", "scene", "presentation", "storyboard"].includes(kind) || !panel) return;

    const title: Record<MarketingPreviewKind, MarketingMessageKey> = {
      story: "formatStory",
      scene: "formatScene",
      presentation: "formatPresentation",
      storyboard: "formatStoryboard",
    };
    this.#details = details;
    this.#panel = panel;
    this.#invoker = invoker;
    this.#kind = kind;
    this.#pages = [...panel.querySelectorAll<HTMLElement>("[data-preview-page]")];
    this.#heading.dataset.copy = title[kind];
    this.#heading.textContent = messages[title[kind]];
    this.#host.replaceChildren(panel);
    this.#show(0);

    if (!ensureNativeModalDialog(this.#dialog, { fallbackLabel: messages[title[kind]] })) {
      this.#dialog.removeAttribute("open");
      this.#restore(false);
      details.open = true;
      return;
    }

    document.documentElement.dataset.marketingPreview = "open";
    document.dispatchEvent(new CustomEvent("forma-marketing-preview-open", { bubbles: true }));
    this.#close.focus({ preventScroll: true });
  }

  #show(index: number) {
    if (!this.#kind || !this.#pages.length) return;
    this.#index = Math.max(0, Math.min(index, this.#pages.length - 1));
    for (const [position, page] of this.#pages.entries()) page.hidden = position !== this.#index;
    this.#previous.disabled = this.#index === 0;
    this.#next.disabled = this.#index === this.#pages.length - 1;
    this.#navigation.hidden = this.#pages.length < 2;

    const key: MarketingMessageKey = this.#kind === "presentation"
      ? "previewSlideStatus"
      : this.#kind === "storyboard"
        ? "previewFrameStatus"
        : "previewPageStatus";
    const format = new Intl.NumberFormat(document.documentElement.lang, { useGrouping: false });
    const current = `\u2068${format.format(this.#index + 1)}\u2069`;
    const total = `\u2068${format.format(this.#pages.length)}\u2069`;
    this.#status.textContent = messages[key].replaceAll("{current}", current).replaceAll("{total}", total);
    this.#host.scrollTop = 0;
  }

  #restore(announce = true) {
    if (!this.#details || !this.#panel) return;
    this.#details.append(this.#panel);
    this.#details.open = false;
    for (const page of this.#pages) page.hidden = false;
    this.#pages = [];
    delete document.documentElement.dataset.marketingPreview;
    if (announce) document.dispatchEvent(new CustomEvent("forma-marketing-preview-close", { bubbles: true }));
    this.#invoker?.focus({ preventScroll: true });
    this.#details = undefined;
    this.#panel = undefined;
    this.#invoker = undefined;
    this.#kind = undefined;
  }
}

class FormaImageViewer {
  #dialog: HTMLDialogElement;
  #media!: HTMLElement;
  #caption!: HTMLElement;
  #section!: HTMLElement;
  #close!: HTMLButtonElement;
  #previous!: HTMLButtonElement;
  #next!: HTMLButtonElement;
  #status!: HTMLElement;
  #pictures: HTMLPictureElement[] = [];
  #studies = new Map<CreativeStudyFamily, { picture: HTMLPictureElement; width: number; formats: number }>();
  #group: HTMLPictureElement[] = [];
  #scope?: HTMLElement;
  #invoker?: HTMLPictureElement;
  #index = 0;
  #ownsPlaybackPause = false;

  constructor(dialog: HTMLDialogElement) {
    this.#dialog = dialog;
    const media = dialog.querySelector<HTMLElement>("[data-image-viewer-media]");
    const caption = dialog.querySelector<HTMLElement>("[data-image-viewer-caption]");
    const section = dialog.querySelector<HTMLElement>("[data-image-viewer-section]");
    const close = dialog.querySelector<HTMLButtonElement>("[data-image-viewer-close]");
    const previous = dialog.querySelector<HTMLButtonElement>("[data-image-viewer-previous]");
    const next = dialog.querySelector<HTMLButtonElement>("[data-image-viewer-next]");
    const status = dialog.querySelector<HTMLElement>("[data-image-viewer-status]");
    if (!media || !caption || !section || !close || !previous || !next || !status || typeof dialog.showModal !== "function") return;
    this.#media = media;
    this.#caption = caption;
    this.#section = section;
    this.#close = close;
    this.#previous = previous;
    this.#next = next;
    this.#status = status;

    for (const picture of document.querySelectorAll<HTMLPictureElement>("main picture")) {
      if (!picture.querySelector("img") || picture.closest(".output-motion--playable, a")) continue;
      const family = this.#family(picture);
      if (!family) continue;
      this.#remember(picture, family);
      this.#pictures.push(picture);
    }

    for (const picture of this.#pictures) {
      for (let ancestor: HTMLElement | null = picture; ancestor; ancestor = ancestor.parentElement) {
        if (ancestor.getAttribute("aria-hidden") === "true") ancestor.removeAttribute("aria-hidden");
        if (ancestor.matches("main > section, [data-preview-panel]")) break;
      }
      picture.dataset.marketingImageTrigger = "true";
      picture.setAttribute("role", "button");
      picture.setAttribute("aria-haspopup", "dialog");
      picture.setAttribute("aria-controls", dialog.id);
      picture.tabIndex = 0;
      picture.addEventListener("click", () => this.#open(picture));
      picture.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        this.#open(picture);
      });
    }

    close.addEventListener("click", () => dialog.close());
    previous.addEventListener("click", () => this.#show(this.#index - 1));
    next.addEventListener("click", () => this.#show(this.#index + 1));
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
    dialog.addEventListener("keydown", (event) => {
      const rtl = document.documentElement.dir === "rtl";
      const forward = event.key === (rtl ? "ArrowLeft" : "ArrowRight") || event.key === "PageDown";
      const backward = event.key === (rtl ? "ArrowRight" : "ArrowLeft") || event.key === "PageUp";
      if (!forward && !backward && event.key !== "Home" && event.key !== "End") return;
      event.preventDefault();
      if (event.key === "Home") this.#show(0);
      else if (event.key === "End") this.#show(this.#group.length - 1);
      else this.#show(this.#index + (forward ? 1 : -1));
    });
    dialog.addEventListener("close", () => this.#restore());
    document.addEventListener("forma-locale-change", () => {
      this.#updateLabels();
      if (dialog.open) this.#show(this.#index);
    });
    for (const choice of document.querySelectorAll<HTMLButtonElement>("[data-context]")) {
      choice.addEventListener("click", () => this.#updateLabels());
    }
    this.#updateLabels();
  }

  #family(picture: HTMLPictureElement): CreativeStudyFamily | undefined {
    const image = picture.querySelector<HTMLImageElement>("img");
    const candidate = image?.getAttribute("src") ?? "";
    return candidate.match(/\/(?:quiet-coast|glass-meridian|brighter-hour|mercer-midnight)-(landscape|portrait|detail|twilight)-/)?.[1] as CreativeStudyFamily | undefined;
  }

  #remember(picture: HTMLPictureElement, family: CreativeStudyFamily) {
    const sources = [...picture.querySelectorAll<HTMLSourceElement>("source")];
    const widths = sources.flatMap((source) => [...(source.getAttribute("srcset") ?? "").matchAll(/(?:^|,)\s*\S+\s+(\d+)w/g)].map(([, width]) => Number(width)));
    const width = widths.length ? Math.max(...widths) : Number(picture.querySelector("img")?.getAttribute("width") ?? 0);
    const saved = this.#studies.get(family);
    if (saved && (saved.width > width || (saved.width === width && saved.formats >= sources.length))) return;
    this.#studies.set(family, { picture: picture.cloneNode(true) as HTMLPictureElement, width, formats: sources.length });
  }

  #label(picture: HTMLPictureElement) {
    const preview = picture.closest<HTMLElement>(".preview-frame, .preview-slide");
    const previewHeading = preview?.querySelector<HTMLElement>("figcaption h3, .preview-slide__content h3");
    if (previewHeading?.textContent?.trim()) return previewHeading.textContent.trim();

    const frame = picture.closest<HTMLElement>(".output-frame, .proof-artifact--twilight");
    const frameHeading = frame?.querySelector<HTMLElement>("figcaption [data-copy], figcaption");
    if (frameHeading?.textContent?.trim()) return frameHeading.textContent.trim();

    if (picture.hasAttribute("data-context-study-target")) {
      const selected = picture.closest(".marketing-context")?.querySelector<HTMLElement>("[data-context-focus-value]")?.textContent?.trim();
      if (selected) return `${messages.campaignImage} · ${selected}`;
    }

    const family = this.#family(picture);
    const labels: Record<CreativeStudyFamily, MarketingMessageKey> = {
      landscape: "proofFrameTwo",
      portrait: "proofFrameThree",
      detail: "previewFrameFour",
      twilight: "proofFrameOne",
    };
    return family ? messages[labels[family]] : messages.formatImage;
  }

  #updateLabels() {
    for (const picture of this.#pictures) {
      const label = `\u2068${this.#label(picture)}\u2069`;
      picture.setAttribute("aria-label", messages.imageViewerOpen.replaceAll("{label}", label));
    }
  }

  #collection(picture: HTMLPictureElement) {
    const panel = picture.closest<HTMLElement>("[data-preview-panel]");
    const scope = panel ?? picture.closest<HTMLElement>("main > section");
    if (!scope) return undefined;
    const available = [...scope.querySelectorAll<HTMLPictureElement>("picture[data-marketing-image-trigger]")].filter((candidate) => {
      if (panel) return candidate.closest("[data-preview-panel]") === panel;
      if (candidate.closest("[data-preview-panel]") || candidate.closest("details:not([open])")) return false;
      const bounds = candidate.getBoundingClientRect();
      return bounds.width > 0 && bounds.height > 0;
    });
    if (panel) return { scope, pictures: available };

    const unique = new Map<CreativeStudyFamily, HTMLPictureElement>();
    for (const candidate of available) {
      const family = this.#family(candidate);
      if (!family) continue;
      if (!unique.has(family) || candidate === picture) unique.set(family, candidate);
    }
    return { scope, pictures: [...unique.values()] };
  }

  #open(picture: HTMLPictureElement) {
    const collection = this.#collection(picture);
    if (!collection?.pictures.length) return;
    const index = collection.pictures.indexOf(picture);
    if (index < 0) return;

    this.#scope = collection.scope;
    this.#group = collection.pictures;
    this.#invoker = picture;
    this.#show(index);
    if (!ensureNativeModalDialog(this.#dialog, { fallbackLabel: messages.imageViewerTitle })) {
      this.#dialog.removeAttribute("open");
      this.#media.replaceChildren();
      this.#group = [];
      this.#scope = undefined;
      this.#invoker = undefined;
      return;
    }

    this.#ownsPlaybackPause = !document.querySelector<HTMLDialogElement>("[data-marketing-preview-dialog]")?.open;
    document.documentElement.dataset.marketingLightbox = "open";
    if (this.#ownsPlaybackPause) document.dispatchEvent(new CustomEvent("forma-marketing-preview-open", { bubbles: true }));
    this.#close.focus({ preventScroll: true });
  }

  #show(index: number) {
    if (!this.#group.length || !this.#scope) return;
    const count = this.#group.length;
    this.#index = ((index % count) + count) % count;
    const selected = this.#group[this.#index];
    const family = this.#family(selected);
    const donor = family ? this.#studies.get(family)?.picture : undefined;
    if (!donor) return;

    const picture = donor.cloneNode(true) as HTMLPictureElement;
    picture.removeAttribute("class");
    picture.removeAttribute("style");
    picture.removeAttribute("data-context-study");
    picture.removeAttribute("data-context-study-target");
    picture.removeAttribute("data-preview-family");
    picture.removeAttribute("aria-hidden");
    for (const source of picture.querySelectorAll<HTMLSourceElement>("source")) source.setAttribute("sizes", "100vw");
    const image = picture.querySelector<HTMLImageElement>("img");
    if (!image) return;
    const fallback = picture.querySelector<HTMLSourceElement>('source[type="image/webp"]')?.getAttribute("srcset") ?? "";
    const variants = [...fallback.matchAll(/(?:^|,)\s*(\S+)\s+(\d+)w/g)].map(([, src, width]) => ({ src, width: Number(width) }));
    const largest = variants.sort((first, second) => second.width - first.width)[0];
    if (largest) image.src = largest.src;
    image.loading = "eager";
    image.decoding = "async";
    image.fetchPriority = "high";
    const label = this.#label(selected);
    image.alt = `${messages.projectName} — ${label}`;
    this.#media.replaceChildren(picture);
    this.#caption.textContent = label;

    const panel = this.#scope.dataset.previewPanel;
    this.#section.textContent = panel === "storyboard"
      ? messages.formatStoryboard
      : panel === "presentation"
        ? messages.formatPresentation
        : this.#scope.querySelector("h1, h2")?.textContent?.trim() ?? messages.projectName;

    const singleton = count < 2;
    this.#previous.hidden = singleton;
    this.#next.hidden = singleton;
    this.#previous.disabled = singleton;
    this.#next.disabled = singleton;
    const rtl = document.documentElement.dir === "rtl";
    this.#previous.setAttribute("aria-keyshortcuts", rtl ? "ArrowRight" : "ArrowLeft");
    this.#next.setAttribute("aria-keyshortcuts", rtl ? "ArrowLeft" : "ArrowRight");
    const format = new Intl.NumberFormat(document.documentElement.lang, { useGrouping: false });
    const current = `\u2068${format.format(this.#index + 1)}\u2069`;
    const total = `\u2068${format.format(this.#group.length)}\u2069`;
    this.#status.textContent = messages.imageViewerStatus.replaceAll("{current}", current).replaceAll("{total}", total);
  }

  #restore() {
    if (!this.#invoker) return;
    const invoker = this.#invoker;
    const resume = this.#ownsPlaybackPause;
    this.#media.replaceChildren();
    this.#group = [];
    this.#scope = undefined;
    this.#invoker = undefined;
    this.#ownsPlaybackPause = false;
    delete document.documentElement.dataset.marketingLightbox;
    if (resume) document.dispatchEvent(new CustomEvent("forma-marketing-preview-close", { bubbles: true }));
    invoker.focus({ preventScroll: true });
  }
}

void (async () => {
  const preferred = preferredLocale();
  const initialized = await setMarketingLocale(preferred, { persist: preferred.persist });
  if (!initialized) await setMarketingLocale({ locale: "en", languageTag: "en" });
  mountLanguagePicker();
  // Decisions cannot be activated before their translated catalog is ready.
  for (const demo of document.querySelectorAll<HTMLElement>("[data-context-demo]")) new FormaContextDemo(demo);
  const preview = document.querySelector<HTMLDialogElement>("[data-marketing-preview-dialog]");
  if (preview) new FormaOutputPreview(preview);
  const images = document.querySelector<HTMLDialogElement>("[data-marketing-image-dialog]");
  if (images) new FormaImageViewer(images);
})();

const ambientPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
const ambientToggle = document.querySelector<HTMLButtonElement>("[data-marketing-motion-toggle]");
let ambientPaused = false;

if (ambientToggle) {
  const updateAmbientMotion = () => {
    const reduced = ambientPreference.matches;
    const active = !reduced && !ambientPaused;
    document.documentElement.dataset.marketingMotion = active ? "on" : "off";
    ambientToggle.hidden = reduced;
    ambientToggle.setAttribute("aria-pressed", String(ambientPaused));
    const key: MarketingMessageKey = ambientPaused ? "motionResumeLabel" : "motionPauseLabel";
    ambientToggle.dataset.copyAria = key;
    ambientToggle.setAttribute("aria-label", messages[key]);
  };
  ambientToggle.addEventListener("click", () => {
    ambientPaused = !ambientPaused;
    updateAmbientMotion();
  });
  ambientPreference.addEventListener("change", updateAmbientMotion);
  document.addEventListener("forma-locale-change", updateAmbientMotion);
  updateAmbientMotion();
}

const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
const motionVideo = document.querySelector<HTMLVideoElement>("[data-marketing-video]");
const motionToggle = document.querySelector<HTMLButtonElement>("[data-marketing-video-toggle]");
let manuallyPaused = false;
if (motionVideo) motionVideo.loop = !motionPreference.matches;

if (motionVideo && motionToggle) {
  const updateMotionToggle = () => {
    const playing = !motionVideo.paused && !motionVideo.ended;
    const key: MarketingMessageKey = playing ? "videoPauseLabel" : "videoPlayLabel";
    motionToggle.setAttribute("aria-pressed", String(playing));
    motionToggle.dataset.copyAria = key;
    motionToggle.setAttribute("aria-label", messages[key]);
  };

  motionToggle.addEventListener("click", () => {
    if (motionVideo.paused || motionVideo.ended) {
      manuallyPaused = false;
      motionVideo.muted = true;
      void motionVideo.play().catch(updateMotionToggle);
    } else {
      manuallyPaused = true;
      motionVideo.pause();
    }
  });
  for (const event of ["play", "pause", "ended", "error"]) motionVideo.addEventListener(event, updateMotionToggle);
  motionVideo.controls = false;
  motionToggle.hidden = false;
}

if ("IntersectionObserver" in window) {
  const videoTarget = motionVideo?.closest<HTMLElement>(".output-piece--video");
  let videoVisible = false;
  let automaticallyPausing = false;
  let previewActive = false;
  let resumeAfterPreview = false;

  const playMotion = () => {
    if (!motionVideo || !videoVisible || document.hidden || motionPreference.matches || manuallyPaused || previewActive) return;
    motionVideo.muted = true;
    void motionVideo.play().catch(() => { /* The accessible play button remains available if autoplay is blocked. */ });
  };

  const pauseMotion = () => {
    if (!motionVideo || motionVideo.paused) return;
    automaticallyPausing = true;
    motionVideo.pause();
  };

  motionVideo?.addEventListener("pause", () => {
    if (automaticallyPausing || !videoVisible || document.hidden || motionPreference.matches) {
      automaticallyPausing = false;
      return;
    }
    manuallyPaused = true;
  });
  motionVideo?.addEventListener("play", () => {
    manuallyPaused = false;
    automaticallyPausing = false;
  });

  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.target === videoTarget) {
        if (entry.isIntersecting && !motionPreference.matches) entry.target.classList?.add("marketing-visible");
        videoVisible = entry.isIntersecting && entry.intersectionRatio >= .35;
        if (videoVisible) playMotion();
        else pauseMotion();
        continue;
      }
      if (!entry.isIntersecting || motionPreference.matches) continue;
      entry.target.classList.add("marketing-visible");
      observer.unobserve(entry.target);
    }
  }, { rootMargin: "0px 0px -8% 0px", threshold: [0.08, 0.35] });

  if (!motionPreference.matches) {
    for (const section of document.querySelectorAll<HTMLElement>("[data-reveal]")) observer.observe(section);
  }

  if (videoTarget && motionVideo) {
    observer.observe(videoTarget);
    document.addEventListener("forma-marketing-preview-open", () => {
      resumeAfterPreview = !motionVideo.paused && !motionVideo.ended;
      previewActive = true;
      pauseMotion();
    });
    document.addEventListener("forma-marketing-preview-close", () => {
      previewActive = false;
      if (!resumeAfterPreview) return;
      resumeAfterPreview = false;
      playMotion();
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) pauseMotion();
      else playMotion();
    });
    motionPreference.addEventListener("change", () => {
      motionVideo.loop = !motionPreference.matches;
      if (motionPreference.matches) pauseMotion();
      else playMotion();
    });
  }
}
