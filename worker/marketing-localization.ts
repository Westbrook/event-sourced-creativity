import english, { type MarketingMessageKey } from "../src/marketing/locales/en";
import french from "../src/marketing/locales/fr";
import arabic from "../src/marketing/locales/ar";
import japanese from "../src/marketing/locales/ja";
import hollywoodEnglish from "../src/marketing/profiles/hollywood-filmmakers/en";
import hollywoodFrench from "../src/marketing/profiles/hollywood-filmmakers/fr";
import hollywoodArabic from "../src/marketing/profiles/hollywood-filmmakers/ar";
import hollywoodJapanese from "../src/marketing/profiles/hollywood-filmmakers/ja";
import marketersEnglish from "../src/marketing/profiles/marketers/en";
import marketersFrench from "../src/marketing/profiles/marketers/fr";
import marketersArabic from "../src/marketing/profiles/marketers/ar";
import marketersJapanese from "../src/marketing/profiles/marketers/ja";
import indieEnglish from "../src/marketing/profiles/indie-filmmakers/en";
import indieFrench from "../src/marketing/profiles/indie-filmmakers/fr";
import indieArabic from "../src/marketing/profiles/indie-filmmakers/ar";
import indieJapanese from "../src/marketing/profiles/indie-filmmakers/ja";
import { MARKETING_PROFILE_ASSET_HASHES, MARKETING_PROFILE_VIDEO_ASSETS, MARKETING_STUDY_WIDTHS } from "../src/marketing/profile-assets";
import {
  isMarketingAudienceProfile,
  isMarketingLocale,
  marketingPath,
  MARKETING_PROFILE_ASSET_PREFIX,
  type MarketingAudienceProfile,
  type MarketingLocale,
  type MarketingProfile,
} from "../src/marketing/profiles";

export type { MarketingLocale } from "../src/marketing/profiles";

const catalogs: Record<MarketingLocale, Readonly<Record<MarketingMessageKey, string>>> = {
  en: english,
  fr: french,
  ar: arabic,
  ja: japanese,
};

const profileCatalogs: Record<MarketingAudienceProfile, Record<MarketingLocale, Partial<Record<MarketingMessageKey, string>>>> = {
  "hollywood-filmmakers": { en: hollywoodEnglish, fr: hollywoodFrench, ar: hollywoodArabic, ja: hollywoodJapanese },
  marketers: { en: marketersEnglish, fr: marketersFrench, ar: marketersArabic, ja: marketersJapanese },
  "indie-filmmakers": { en: indieEnglish, fr: indieFrench, ar: indieArabic, ja: indieJapanese },
};

function family(value: string | null | undefined): MarketingLocale | undefined {
  const candidate = value?.trim().replaceAll("_", "-").toLowerCase();
  if (!candidate) return undefined;
  return (["en", "fr", "ar", "ja"] as const).find((locale) => candidate === locale || candidate.startsWith(locale + "-"));
}

export function negotiateMarketingLocale(value: string | null): MarketingLocale {
  if (!value) return "en";
  const candidates = value.split(",").flatMap((part, index) => {
    const [tag, ...parameters] = part.trim().split(";");
    const locale = family(tag);
    if (!locale) return [];
    const qualityValue = parameters.find((parameter) => /^\s*q\s*=/i.test(parameter));
    const quality = qualityValue ? Number(qualityValue.split("=")[1]) : 1;
    return Number.isFinite(quality) && quality > 0 && quality <= 1 ? [{ locale, quality, index }] : [];
  });
  candidates.sort((left, right) => right.quality - left.quality || left.index - right.index);
  return candidates[0]?.locale ?? "en";
}

function escaped(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function replaceMeta(document: string, identifier: string, content: string) {
  const safeIdentifier = identifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(<meta\\b[^>]*\\b(?:name|property)="${safeIdentifier}"[^>]*\\bcontent=")[^"]*(")`, "i");
  return document.replace(pattern, (_match, start: string, end: string) => start + escaped(content) + end);
}

function profileAsset(profile: MarketingAudienceProfile, family: "landscape" | "portrait" | "detail" | "twilight", width: number, format: "avif" | "webp") {
  const index = (MARKETING_STUDY_WIDTHS[family] as readonly number[]).indexOf(width);
  const hash = MARKETING_PROFILE_ASSET_HASHES[profile][family][format][index];
  if (!hash) throw new Error(`Missing public marketing study: ${profile} ${family} ${width} ${format}.`);
  return `/assets/marketing/${MARKETING_PROFILE_ASSET_PREFIX[profile]}-${family}-${width}.${hash}.${format}`;
}

export function renderMarketingDocument(document: string, locale: MarketingLocale, profile: MarketingProfile = "generic") {
  const messages: Readonly<Record<MarketingMessageKey, string>> = profile === "generic"
    ? catalogs[locale]
    : { ...catalogs[locale], ...profileCatalogs[profile][locale] };
  const direction = locale === "ar" ? "rtl" : "ltr";
  let localized = document.replace(/<html\b[^>]*>/i, `<html lang="${locale}" dir="${direction}">`);
  localized = localized.replace(/(<body\b[^>]*\bdata-marketing-profile=")[^"]*(")/i, (_match, start: string, end: string) => `${start}${profile}${end}`);
  localized = localized.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escaped(messages.pageTitle)}</title>`);
  localized = localized.replace(/(<link\b[^>]*\brel="canonical"[^>]*\bhref=")[^"]*(")/i,
    (_match, start: string, end: string) => `${start}${marketingPath(profile, locale)}${end}`);
  localized = localized.replace(/<(?:a|link)\b[^>]*\bhreflang="([^"]+)"[^>]*>/gi, (tag: string, requested: string) => {
    if (requested !== "x-default" && !isMarketingLocale(requested)) return tag;
    return tag.replace(/(\bhref=")[^"]*(")/i, (_match, start: string, end: string) =>
      `${start}${marketingPath(profile, requested === "x-default" ? undefined : requested)}${end}`);
  });
  localized = localized.replace(/<a\b[^>]*\bdata-profile-link="([^"]+)"[^>]*>/gi, (tag: string, requested: string) => {
    if (requested !== "generic" && !isMarketingAudienceProfile(requested)) return tag;
    const linked = tag.replace(/(\bhref=")[^"]*(")/i, (_match, start: string, end: string) =>
      `${start}${marketingPath(requested, locale)}${end}`).replace(/\s+aria-current="page"/i, "");
    return requested === profile ? linked.replace(/>$/, ' aria-current="page">') : linked;
  });

  if (profile !== "generic") {
    localized = localized.replace(/\/assets\/marketing\/quiet-coast-(landscape|portrait|detail|twilight)-(\d+)\.[a-f0-9]{12}\.(avif|webp)/g,
      (_match, study: "landscape" | "portrait" | "detail" | "twilight", width: string, format: "avif" | "webp") =>
        profileAsset(profile, study, Number(width), format));
    localized = localized.replace(/\/assets\/marketing\/quiet-coast-scene-poster-960\.[a-f0-9]{12}\.jpg/g,
      MARKETING_PROFILE_VIDEO_ASSETS[profile].poster);
    localized = localized.replace(/\/assets\/marketing\/quiet-coast-scene-(?:4|8)s\.[a-f0-9]{12}\.mp4/g,
      MARKETING_PROFILE_VIDEO_ASSETS[profile].video);
    const socialImage = profileAsset(profile, "landscape", 1200, "webp");
    localized = replaceMeta(localized, "og:image", socialImage);
    localized = replaceMeta(localized, "twitter:image", socialImage);
  }

  for (const [identifier, value] of Object.entries({
    description: messages.pageDescription,
    "og:title": messages.socialTitle,
    "og:description": messages.socialDescription,
    "og:locale": ({ en: "en_US", fr: "fr_FR", ar: "ar_SA", ja: "ja_JP" } as const)[locale],
    "twitter:title": messages.socialTitle,
    "twitter:description": messages.socialDescription,
  })) localized = replaceMeta(localized, identifier, value);

  localized = localized.replace(/(<([a-z][\w:-]*)\b[^>]*\bdata-copy="([^"]+)"[^>]*>)([^<]*)(<\/\2>)/gi,
    (match: string, start: string, _tag: string, identifier: string, _content: string, end: string) =>
      Object.hasOwn(messages, identifier) ? start + escaped(messages[identifier as MarketingMessageKey]) + end : match);
  localized = localized.replace(/<[^>]*\bdata-copy-aria="([^"]+)"[^>]*>/gi, (tag: string, identifier: string) => {
    if (!Object.hasOwn(messages, identifier)) return tag;
    return tag.replace(/(\baria-label=")[^"]*(")/i, (_match, start: string, end: string) =>
      start + escaped(messages[identifier as MarketingMessageKey]) + end);
  });
  return localized;
}
