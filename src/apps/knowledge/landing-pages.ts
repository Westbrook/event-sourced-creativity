import { html, nothing } from "lit";
import { FORMA_SUPPORTED_LOCALES } from "../../components/design-system/language-options";
import { formaLocaleFamily, type FormaLocaleController } from "../../components/design-system/localization";
import "../../components/design-system/layout";
import { marketingPath, type MarketingProfile } from "../../marketing/profiles";
import "./landing-pages.css";

const landingPages = [
  {
    audience: "overview",
    profile: "generic",
    project: "The Quiet Coast",
    poster: "/assets/marketing/quiet-coast-scene-poster-960.af29b34d50f0.jpg",
  },
  {
    audience: "hollywood",
    profile: "hollywood-filmmakers",
    project: "The Glass Meridian",
    poster: "/assets/marketing/glass-meridian-scene-poster-960.f1b46985231e.jpg",
  },
  {
    audience: "marketers",
    profile: "marketers",
    project: "The Brighter Hour",
    poster: "/assets/marketing/brighter-hour-scene-poster-960.87d6d6117994.jpg",
  },
  {
    audience: "indie",
    profile: "indie-filmmakers",
    project: "The Last Light on Mercer",
    poster: "/assets/marketing/mercer-midnight-scene-poster-960.2295e480fb09.jpg",
  },
] as const satisfies ReadonlyArray<{
  audience: "overview" | "hollywood" | "marketers" | "indie";
  profile: MarketingProfile;
  project: string;
  poster: string;
}>;

/** Present the approved public audience introductions without loading private creative work. */
export function renderKnowledgeLandingPages(i18n: FormaLocaleController) {
  const locale = formaLocaleFamily(i18n.locale);

  return html`<section class="admin-page administrative-page knowledge-landing-pages">
    <header class="page-header page-header--admin">
      <div class="page-header-copy">
        <span>${i18n.t("shell.knowledge", "Design & Knowledge")}</span>
        <h1>${i18n.t("knowledge.landing.heading", "Landing page catalog")}</h1>
        <p>${i18n.t("knowledge.landing.description", "Explore four audience-specific landing pages, each available in every supported language.")}</p>
      </div>
    </header>
    <div class="page-pad knowledge-landing-pages__content">
      <div class="knowledge-landing-pages__grid">
        ${landingPages.map((page) => {
          const audience = i18n.t(`knowledge.landing.audience.${page.audience}`);
          const action = i18n.t("knowledge.landing.open", "Open {audience} landing page", { audience });
          const headingId = `knowledge-landing-${page.audience}`;
          const newTabNoticeId = `${headingId}-new-tab`;
          const currentUrl = marketingPath(page.profile, locale);

          return html`<forma-ui-card class="knowledge-landing-pages__card" .value=${page.profile}>
            <a slot="media" class="knowledge-landing-pages__image" href=${currentUrl}
              target="_blank" rel="noopener" aria-label=${action} aria-describedby=${newTabNoticeId}>
              <img src=${page.poster} alt="" width="960" height="540" loading="lazy" decoding="async" />
            </a>
            <span slot="eyebrow">${audience}</span>
            <h2 slot="heading" id=${headingId} dir="auto">${page.project}</h2>
            <nav class="knowledge-landing-pages__locales" aria-labelledby=${headingId}>
              ${FORMA_SUPPORTED_LOCALES.map((option) => html`<a
                href=${marketingPath(page.profile, option.locale)}
                lang=${option.locale}
                dir=${option.direction}
                aria-current=${option.locale === locale ? "true" : nothing}
              >${option.label}</a>`)}
            </nav>
            <div slot="actions" class="knowledge-landing-pages__actions">
              <a class="button secondary" href=${currentUrl} target="_blank" rel="noopener"
                aria-describedby=${newTabNoticeId}>${action}</a>
              <span id=${newTabNoticeId}>${i18n.t("navigation.opensInNewTab", "(opens in a new tab)")}</span>
            </div>
          </forma-ui-card>`;
        })}
      </div>
    </div>
  </section>`;
}
