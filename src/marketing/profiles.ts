export const MARKETING_LOCALES = ["en", "fr", "ar", "ja"] as const;

export type MarketingLocale = typeof MARKETING_LOCALES[number];

export const MARKETING_PROFILE_SLUGS = [
  "hollywood-filmmakers",
  "marketers",
  "indie-filmmakers",
] as const;

export type MarketingAudienceProfile = typeof MARKETING_PROFILE_SLUGS[number];
export type MarketingProfile = "generic" | MarketingAudienceProfile;

export const MARKETING_PROFILE_ASSET_PREFIX: Record<MarketingAudienceProfile, string> = {
  "hollywood-filmmakers": "glass-meridian",
  marketers: "brighter-hour",
  "indie-filmmakers": "mercer-midnight",
};

export type MarketingRoute = Readonly<{
  profile: MarketingProfile;
  locale?: MarketingLocale;
}>;

export function isMarketingLocale(value: string | undefined): value is MarketingLocale {
  return Boolean(value && MARKETING_LOCALES.includes(value as MarketingLocale));
}

export function isMarketingAudienceProfile(value: string | undefined): value is MarketingAudienceProfile {
  return Boolean(value && MARKETING_PROFILE_SLUGS.includes(value as MarketingAudienceProfile));
}

export function parseMarketingRoute(pathname: string): MarketingRoute | undefined {
  if (pathname === "/") return { profile: "generic" };
  const match = pathname.match(/^\/welcome(?:\/([^/]+)(?:\/([^/]+))?)?\/?$/);
  if (!match) return undefined;

  const [, first, second] = match;
  if (!first) return { profile: "generic" };
  if (!second && isMarketingLocale(first)) return { profile: "generic", locale: first };
  if (isMarketingAudienceProfile(first)) {
    if (!second) return { profile: first };
    if (isMarketingLocale(second)) return { profile: first, locale: second };
  }
  return undefined;
}

export function marketingPath(profile: MarketingProfile, locale?: MarketingLocale) {
  const audience = profile === "generic" ? "" : `/${profile}`;
  return `/welcome${audience}${locale ? `/${locale}` : ""}`;
}
