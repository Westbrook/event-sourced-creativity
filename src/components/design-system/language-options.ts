/** Canonical, public-safe language endonyms and writing directions shared by every Forma surface. */
export const FORMA_SUPPORTED_LOCALES = Object.freeze([
  { locale: "en", label: "English", direction: "ltr" },
  { locale: "fr", label: "Français", direction: "ltr" },
  { locale: "ar", label: "العربية", direction: "rtl" },
  { locale: "ja", label: "日本語", direction: "ltr" },
] as const);

export type FormaSupportedLocale = typeof FORMA_SUPPORTED_LOCALES[number];
