import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import { runInNewContext } from "node:vm";
import {
  applicationDefinition,
  applicationIdFromRoute,
  authorizedApplicationHome,
  navigationItemAccessible,
  navigationItemActive,
  resolveServerRoute,
  routeRequiredCapabilities,
} from "../src/platform/applications.ts";
import { FORMA_SUPPORTED_LOCALES } from "../src/components/design-system/language-options.ts";
import frenchMessages from "../src/components/design-system/locales/fr.ts";
import arabicMessages from "../src/components/design-system/locales/ar.ts";
import japaneseMessages from "../src/components/design-system/locales/ja.ts";
import { MARKETING_PROFILE_VIDEO_ASSETS } from "../src/marketing/profile-assets.ts";
import { marketingPath } from "../src/marketing/profiles.ts";

const { FORMA_DEFAULT_MESSAGES, formaLocaleFamily } = await (async () => {
  const previousElement = globalThis.HTMLElement;
  const previousRegistry = globalThis.customElements;
  globalThis.HTMLElement ??= class extends EventTarget {};
  globalThis.customElements ??= { get() { return undefined; }, define() {} };

  try {
    return await import("../src/components/design-system/localization.ts");
  } finally {
    if (previousElement === undefined) delete globalThis.HTMLElement;
    else globalThis.HTMLElement = previousElement;
    if (previousRegistry === undefined) delete globalThis.customElements;
    else globalThis.customElements = previousRegistry;
  }
})();

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const catalogs = { en: FORMA_DEFAULT_MESSAGES, fr: frenchMessages, ar: arabicMessages, ja: japaneseMessages };
const audiences = [
  { audience: "overview", profile: "generic", project: "The Quiet Coast", marketing: "audienceOverviewLabel" },
  { audience: "hollywood", profile: "hollywood-filmmakers", project: "The Glass Meridian", marketing: "audienceHollywoodLabel" },
  { audience: "marketers", profile: "marketers", project: "The Brighter Hour", marketing: "audienceMarketersLabel" },
  { audience: "indie", profile: "indie-filmmakers", project: "The Last Light on Mercer", marketing: "audienceIndieLabel" },
];

function evaluateCatalog(moduleSource, messages, locale) {
  const stripped = stripTypeScriptTypes(moduleSource, { mode: "strip" })
    .replace(/^import[^\n]*\n/gm, "")
    .replace("export function renderKnowledgeLandingPages", "function renderKnowledgeLandingPages");
  const nothing = Symbol("nothing");
  const context = {
    html: (strings, ...values) => ({ strings, values }),
    nothing,
    FORMA_SUPPORTED_LOCALES,
    formaLocaleFamily,
    marketingPath,
    globalThis: {},
  };
  runInNewContext(`${stripped}\nglobalThis.renderKnowledgeLandingPages = renderKnowledgeLandingPages;`, context);

  const flatten = (value) => {
    if (value === nothing || value === undefined || value === null) return "";
    if (Array.isArray(value)) return value.map(flatten).join("");
    if (typeof value === "object" && Array.isArray(value.strings)) {
      return value.strings.reduce((result, part, index) =>
        result + part + (index < value.values.length ? flatten(value.values[index]) : ""), "");
    }
    return String(value);
  };
  const i18n = {
    locale,
    t(id, fallback = "", values = {}) {
      return Object.entries(values).reduce((text, [key, value]) =>
        text.replaceAll(`{${key}}`, String(value)), messages[id] ?? FORMA_DEFAULT_MESSAGES[id] ?? fallback);
    },
  };

  return flatten(context.globalThis.renderKnowledgeLandingPages(i18n));
}

test("the landing catalog is a first-class Knowledge task for either authorized specialist grant", () => {
  const application = applicationDefinition("knowledge");
  const destination = application.navigation.at(-1);

  assert.equal(destination.id, "landing-pages");
  assert.equal(destination.href, "/knowledge/landing-pages");
  assert.deepEqual(destination.requiredCapabilities, ["design.catalog.read", "design.docs.read"]);
  assert.deepEqual(routeRequiredCapabilities(destination.href), ["design.catalog.read", "design.docs.read"]);
  assert.equal(applicationIdFromRoute(destination.href), "knowledge");

  for (const path of [destination.href, destination.href + "/"]) {
    assert.deepEqual(resolveServerRoute(path), {
      application: "knowledge",
      entryPath: "/knowledge/landing-pages/",
      canonicalFamily: "/knowledge/landing-pages",
    });
    assert.equal(navigationItemActive("knowledge", destination.id, path), true);
  }

  for (const capability of ["design.catalog.read", "design.docs.read"]) {
    assert.equal(navigationItemAccessible(destination, { role: "creator", capabilities: [capability] }), true);
  }
  assert.equal(navigationItemAccessible(destination, { role: "creator", capabilities: [] }), false);
  assert.equal(authorizedApplicationHome("knowledge", { role: "creator", capabilities: ["design.docs.read"] }),
    "/knowledge/patterns", "The new task must not change an existing documentation specialist’s home.");
});

test("the catalog renders all four approved creative worlds and every localized public destination", async () => {
  const [moduleSource, html] = await Promise.all([
    source("src/apps/knowledge/landing-pages.ts"),
    source("marketing.html"),
  ]);

  assert.match(moduleSource, /import "\.\.\/\.\.\/components\/design-system\/layout"/);
  assert.match(moduleSource, /<forma-ui-card/);
  assert.match(moduleSource, /formaLocaleFamily\(i18n\.locale\)/);
  assert.match(moduleSource, /FORMA_SUPPORTED_LOCALES\.map/);
  assert.match(moduleSource, /dir="auto"/);
  assert.match(moduleSource, /loading="lazy"\s+decoding="async"/);
  assert.match(moduleSource, /target="_blank"\s+rel="noopener"/);
  assert.equal([...moduleSource.matchAll(/aria-describedby=\$\{newTabNoticeId\}/g)].length, 2);
  assert.doesNotMatch(moduleSource, /fetch\(|state\/store|this\.store|\/api\/|protected-assets|<iframe|<video|customElements\.define/);

  for (const [locale, messages] of Object.entries(catalogs)) {
    const regionalLocale = locale === "fr" ? "fr-CA" : locale === "ar" ? "ar-SA" : locale;
    const rendered = evaluateCatalog(moduleSource, messages, regionalLocale);
    assert.equal([...rendered.matchAll(/<forma-ui-card\b/g)].length, audiences.length, locale);
    assert.equal([...rendered.matchAll(/aria-current=true/g)].length, audiences.length, locale);
    assert.match(rendered, new RegExp(messages["knowledge.landing.heading"].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

    for (const { audience, profile, project } of audiences) {
      const localizedAudience = messages[`knowledge.landing.audience.${audience}`];
      assert.ok(rendered.includes(localizedAudience), `${locale}: ${audience}`);
      assert.ok(rendered.includes(`dir="auto">${project}</h2>`), `${locale}: ${project}`);
      assert.ok(rendered.includes(`href=${marketingPath(profile, locale)}`), `${locale}: current ${profile}`);
      for (const option of FORMA_SUPPORTED_LOCALES) {
        assert.ok(rendered.includes(`href=${marketingPath(profile, option.locale)}`), `${locale}: ${profile}/${option.locale}`);
        assert.ok(rendered.includes(`lang=${option.locale}`), option.locale);
        assert.ok(rendered.includes(`dir=${option.direction}`), option.direction);
        assert.ok(rendered.includes(`>${option.label}</a>`), option.label);
      }
    }
  }

  for (const entry of audiences) {
    const escapedProject = entry.project.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = moduleSource.match(new RegExp(`project: "${escapedProject}",[\\s\\S]*?poster: "(/assets/marketing/[^"]+\\.([a-f0-9]{12})\\.jpg)"`));
    assert.ok(match, `${entry.project} requires its authentic approved scene poster.`);
    const bytes = await readFile(new URL(`../public${match[1]}`, import.meta.url));
    assert.equal(createHash("sha256").update(bytes).digest("hex").slice(0, 12), match[2]);
    assert.ok(bytes.length < 45_000, entry.project);
    if (entry.profile === "generic") assert.ok(html.includes(match[1]), entry.project);
    else assert.equal(MARKETING_PROFILE_VIDEO_ASSETS[entry.profile].poster, match[1], entry.project);
  }
});

test("the Knowledge catalog and public audience labels remain specialist-localized in all four languages", async () => {
  const ids = [
    "knowledge.landing.heading", "knowledge.landing.description", "knowledge.landing.open",
    "shell.navigation.landing-pages", "shell.description.landing-pages",
    ...audiences.map(({ audience }) => `knowledge.landing.audience.${audience}`),
  ];

  for (const [locale, messages] of Object.entries(catalogs)) {
    const marketing = (await import(`../src/marketing/locales/${locale}.ts`)).default;
    for (const id of ids) assert.ok(messages[id], `${locale}: ${id}`);
    assert.equal(messages["shell.navigation.landing-pages"], messages["knowledge.landing.heading"], locale);
    assert.equal(messages["shell.description.landing-pages"], messages["knowledge.landing.description"], locale);
    assert.ok(messages["knowledge.landing.open"].includes("{audience}"), locale);
    for (const audience of audiences) {
      assert.equal(messages[`knowledge.landing.audience.${audience.audience}`], marketing[audience.marketing],
        `${locale}: ${audience.audience} must reuse the approved public audience label.`);
    }
  }
});

test("the isolated catalog uses one protected route leaf and preserves accessible responsive links", async () => {
  const [entry, moduleSource, styles, route, manifestSource, guide, architecture] = await Promise.all([
    source("src/apps/knowledge/entry.ts"),
    source("src/apps/knowledge/landing-pages.ts"),
    source("src/apps/knowledge/landing-pages.css"),
    source("dist/client/knowledge/landing-pages/index.html"),
    source("dist/client/.vite/manifest.json"),
    source("DESIGN.md"),
    source("ARCHITECTURE.md"),
  ]);
  const manifest = JSON.parse(manifestSource);
  const leaf = manifest["src/apps/knowledge/landing-pages.ts"];

  assert.ok(entry.includes('path.replace(/\\/+$/, "") === "/knowledge/landing-pages"'));
  assert.ok(entry.includes('location.pathname.replace(/\\/+$/, "") === "/knowledge/landing-pages"'));
  assert.match(entry, /import\("\.\/landing-pages"\)/);
  assert.ok(leaf?.file?.startsWith("protected-assets/knowledge/landing-pages-"));
  assert.ok(route.includes(`href="/${leaf.file}" data-forma-route-leaf="/knowledge/landing-pages"`));
  assert.equal([...route.matchAll(/data-forma-route-leaf=/g)].length, 1);
  assert.doesNotMatch(route, /forma-design-system-lab-|forma-component-catalog-/);
  assert.match(route, /\/api\/session\?audience=knowledge/);
  assert.doesNotMatch(route, /forma-static-route-prefetch|\/api\/portfolio|\/api\/events|\/api\/media/);
  assert.doesNotMatch(moduleSource, /from "\.\.\/\.\.\/marketing\/(?:main|locales|profile-assets)/);
  assert.match(styles, /grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(min\(22rem,\s*100%\),\s*1fr\)\)/);
  assert.match(styles, /\.knowledge-landing-pages__actions\s*>\s*a\s*\{[^}]*min-block-size:\s*var\(--forma-control-min-size,\s*2\.75rem\)/s);
  assert.match(styles, /\.knowledge-landing-pages__locales\s+a\s*\{[^}]*min-inline-size:\s*var\(--forma-control-min-size,\s*2\.75rem\)[^}]*min-block-size:\s*var\(--forma-control-min-size,\s*2\.75rem\)/s);
  assert.match(styles, /:focus-visible\s*\{[^}]*outline:/s);
  assert.match(guide, /\/knowledge\/landing-pages/);
  assert.match(architecture, /\/knowledge\/landing-pages/);
});
