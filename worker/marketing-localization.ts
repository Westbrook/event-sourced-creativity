import english, { type MarketingMessageKey } from "../src/marketing/locales/en";
import french from "../src/marketing/locales/fr";
import arabic from "../src/marketing/locales/ar";
import japanese from "../src/marketing/locales/ja";

export type MarketingLocale = "en" | "fr" | "ar" | "ja";

const catalogs: Record<MarketingLocale, Readonly<Record<MarketingMessageKey, string>>> = {
  en: english,
  fr: french,
  ar: arabic,
  ja: japanese,
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

export function renderMarketingDocument(document: string, locale: MarketingLocale) {
  const messages = catalogs[locale];
  const direction = locale === "ar" ? "rtl" : "ltr";
  let localized = document.replace(/<html\b[^>]*>/i, `<html lang="${locale}" dir="${direction}">`);
  localized = localized.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escaped(messages.pageTitle)}</title>`);
  localized = localized.replace(/(<link\b[^>]*\brel="canonical"[^>]*\bhref=")[^"]*(")/i, (_match, start: string, end: string) => `${start}/welcome/${locale}${end}`);

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
