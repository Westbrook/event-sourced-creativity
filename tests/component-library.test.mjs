import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { componentCatalog } from "../src/components/design-system/catalog.ts";
import frenchMessages from "../src/components/design-system/locales/fr.ts";
import arabicMessages from "../src/components/design-system/locales/ar.ts";
import japaneseMessages from "../src/components/design-system/locales/ja.ts";

const read = (relative) => readFile(new URL(relative, import.meta.url), "utf8");
const [packageSource, manifestSource, publicManifestSource, shippedManifestSource, globalStyles, familyStyles, laboratoryStyles, catalogSource, applicationPreviewSource, labSource, librarySource, analyticsSource, collectionSource, baseSource, slottedBaseSource, layoutSource, feedbackSource, generatorSource] = await Promise.all([
  read("../package.json"),
  read("../custom-elements.json"),
  read("../public/custom-elements.json"),
  read("../dist/client/custom-elements.json"),
  read("../src/styles.css"),
  read("../src/design-system.css"),
  read("../src/components/design-system/component-catalog.css"),
  read("../src/components/design-system/component-catalog.ts"),
  read("../src/components/design-system/application-pattern-previews.ts"),
  read("../src/components/forma-design-system-lab.ts"),
  read("../src/components/forma-library.ts"),
  read("../src/components/forma-analytics.ts"),
  read("../src/components/collection-tree.ts"),
  read("../src/components/presentational-element.ts"),
  read("../src/components/design-system/slotted-element.ts"),
  read("../src/components/design-system/layout.ts"),
  read("../src/components/design-system/feedback.ts"),
  read("../scripts/generate-custom-elements-manifest.mjs"),
]);

const manifest = JSON.parse(manifestSource);
const declarations = manifest.modules.flatMap((module) => module.declarations ?? []);
const elements = declarations.filter((declaration) => declaration.customElement);
const declarationByTag = new Map(elements.map((declaration) => [declaration.tagName, declaration]));
const shadowContracts = new Map([
  ["forma-ui-card", ["", "actions", "eyebrow", "heading", "media"]],
  ["forma-ui-page-header", ["", "actions", "eyebrow", "heading"]],
  ["forma-ui-list-item", ["", "heading", "leading", "trailing"]],
  ["forma-ui-notice", ["", "actions", "heading", "leading"]],
  ["forma-ui-disclosure", ["", "summary"]],
]);

const rgb = (hex) => {
  const value = hex.replace("#", "");
  const expanded = value.length === 3 ? [...value].map((part) => part + part).join("") : value;
  return [0, 2, 4].map((offset) => Number.parseInt(expanded.slice(offset, offset + 2), 16));
};

const luminance = (color) => rgb(color)
  .map((part) => part / 255)
  .map((part) => part <= .04045 ? part / 12.92 : ((part + .055) / 1.055) ** 2.4)
  .reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);

const contrast = (first, second) => {
  const values = [luminance(first), luminance(second)].sort((left, right) => right - left);
  return (values[0] + .05) / (values[1] + .05);
};

const paired = (token) => {
  const match = globalStyles.match(new RegExp(`--${token}:\\s*light-dark\\((#[0-9a-f]+),\\s*(#[0-9a-f]+)\\)`, "i"));
  assert.ok(match, `${token} exposes preference-reactive light and dark values`);
  return { light: match[1], dark: match[2] };
};

test("the standard manifest documents every registered UI and application custom element", () => {
  const pkg = JSON.parse(packageSource);
  assert.equal(manifest.schemaVersion, "2.1.0");
  assert.equal(pkg.customElements, "./custom-elements.json");
  assert.equal(publicManifestSource, manifestSource);
  assert.equal(shippedManifestSource, manifestSource);
  assert.ok(elements.length >= 99, "include the original application inventory, locale provider, and expanded component library");
  assert.ok(elements.filter((element) => element.tagName.startsWith("forma-ui-")).length >= 41);
  assert.equal(new Set(elements.map((element) => element.tagName)).size, elements.length);
  for (const tag of ["forma-shell", "forma-platform-shell", "forma-library", "forma-projects", "forma-analytics", "forma-design-system-lab", "forma-component-catalog", "forma-ui-theme", "forma-ui-locale", "forma-ui-dialog", "forma-ui-workspace-switcher", "forma-ui-audience-navigation"]) {
    assert.ok(declarationByTag.has(tag), `${tag} is documented`);
  }
  assert.ok(elements.every((element) => element.summary && element.description), "every element has readable machine-discoverable purpose");
  for (const element of elements) {
    const expectedSlots = shadowContracts.get(element.tagName);
    assert.equal(element["x-forma"].renderRoot, expectedSlots ? "shadow" : "light", `${element.tagName} declares its actual rendering boundary`);
    if (expectedSlots) {
      assert.deepEqual(element.slots.map((slot) => slot.name), expectedSlots, `${element.tagName} documents only its actual native slots`);
      assert.ok(element.slots.every((slot) => slot.description), `${element.tagName} explains every content contract`);
      assert.equal(element.superclass.name, "FormaSlottedElement");
    } else {
      assert.ok(!element.slots, `${element.tagName} must not promise fictional light-DOM slots`);
    }
    assert.ok(!element.cssParts, `${element.tagName} must not promise nonexistent shadow parts`);
  }
  assert.equal(elements.filter((element) => element["x-forma"].renderRoot === "shadow").length, shadowContracts.size);
  assert.equal(elements.reduce((count, element) => count + (element.slots?.length ?? 0), 0), 19);
  assert.ok(declarations.some((declaration) => declaration.name === "FormaPresentationalElement"));
  assert.ok(declarations.some((declaration) => declaration.name === "FormaSlottedElement"));
  assert.ok(declarations.some((declaration) => declaration.name === "FormaElement"));
  assert.match(generatorSource, /typescript/);
  assert.match(packageSource, /"cem:check"/);
});

test("genuine slots preserve authored semantics, shared styles, fallback behavior, and grouped disclosures", () => {
  assert.match(slottedBaseSource, /const compositionStyles = css`/);
  assert.match(slottedBaseSource, /class FormaSlottedElement extends LitElement/);
  assert.match(slottedBaseSource, /static override styles = compositionStyles/);
  assert.doesNotMatch(slottedBaseSource, /MutationObserver|slotchange|adoptedStyleSheets\s*=/);
  assert.match(slottedBaseSource, /::slotted\(button\)[\s\S]*?min-inline-size:\s*var\(--forma-control-min-size/);
  assert.match(slottedBaseSource, /slot\[name="heading"\]::slotted\(\*\)/);
  assert.match(slottedBaseSource, /@media \(forced-colors: active\)/);

  assert.match(layoutSource, /<slot name="heading">\$\{this\.heading \? this\.#heading\(\) : nothing\}<\/slot>/);
  assert.match(layoutSource, /this\.detail \? html`<p>\$\{this\.detail\}<\/p>` : nothing\}[\s\S]*?<slot><\/slot>/);
  assert.match(layoutSource, /emitFormaEvent\(this, "forma-action", \{ value: this\.value \}\)/);
  assert.doesNotMatch(layoutSource, /value:\s*this\.(heading|label)/);
  assert.doesNotMatch(layoutSource, /<h[1-6][^>]*>\s*<slot name="heading"/);

  assert.match(feedbackSource, /<div class="ui-notice-copy" role=/);
  assert.match(feedbackSource, /<div class="ui-notice-actions"><slot name="actions">/);
  assert.match(feedbackSource, /<summary><slot name="summary">\$\{this\.label \|\| this\.i18n\.t\("disclosure\.more"\)\}<\/slot><\/summary>/);
  assert.match(feedbackSource, /if \(open && this\.group\)[\s\S]*?this\.getRootNode\(\)[\s\S]*?querySelectorAll<FormaUiDisclosure>\("forma-ui-disclosure"\)/);
  assert.match(feedbackSource, /peer !== this && peer\.group === this\.group[\s\S]*?details\.open = false/);
  assert.match(feedbackSource, /emitFormaEvent\(this, "forma-dismiss", \{ value: this\.value \}\)/);

  for (const tag of ["forma-ui-button", "forma-ui-field", "forma-ui-search", "forma-ui-select", "forma-ui-tabs", "forma-ui-popover", "forma-ui-dialog", "forma-ui-stack", "forma-ui-theme", "forma-ui-locale", "forma-ui-empty-state", "forma-ui-metric", "forma-ui-workspace-switcher", "forma-ui-audience-navigation"]) {
    assert.equal(declarationByTag.get(tag)["x-forma"].renderRoot, "light", `${tag} preserves its native/light-DOM behavior`);
  }
  assert.match(generatorSource, /documents slots without a shadow root/);
  assert.match(generatorSource, /documents an unrendered @slot/);
  assert.match(generatorSource, /renders an undocumented slot/);
});

test("machine-readable attributes, options, defaults, themes, and event details reflect actual APIs", () => {
  const field = declarationByTag.get("forma-ui-field");
  const fieldMaximum = field.attributes.find((attribute) => attribute.name === "max-length");
  assert.equal(fieldMaximum.fieldName, "maxLength");
  assert.equal(typeof fieldMaximum.default, "string");
  assert.match(field.events.find((event) => event.name === "forma-input").type.text, /value:\s*string/);

  const button = declarationByTag.get("forma-ui-button");
  assert.match(button.members.find((member) => member.name === "variant").type.text, /"primary".*"secondary"/);
  assert.ok(button.attributes.find((attribute) => attribute.name === "label").description);

  const select = declarationByTag.get("forma-ui-select");
  const options = select.members.find((member) => member.name === "options");
  assert.match(options.type.text, /label:\s*string/);
  assert.match(options.type.text, /value:\s*string/);
  assert.match(options.type.text, /disabled\?:\s*boolean/);
  assert.ok(!select.attributes.some((attribute) => attribute.name === "options"), "complex options are property-only");

  const emptyState = declarationByTag.get("forma-ui-empty-state");
  assert.equal(emptyState.events.find((event) => event.name === "forma-action").type.text, "CustomEvent<null>");
  const video = declarationByTag.get("forma-video-reference-preflight");
  assert.match(video.events.find((event) => event.name === "video-reference-busy").type.text, /busy:\s*boolean/);

  const theme = declarationByTag.get("forma-ui-theme");
  assert.ok(theme.cssProperties.length >= 35);
  for (const token of ["--forma-focus-ring-color", "--forma-focus-ring-width", "--forma-font-size-supporting", "--forma-color-danger-text", "--forma-duration-normal", "--forma-control-min-size", "--forma-heading-letter-spacing", "--forma-heading-line-height", "--forma-body-line-height"]) {
    assert.ok(theme.cssProperties.some((property) => property.name === token), `${token} is machine-discoverable`);
  }
  for (const name of ["density", "radius"]) {
    const member = theme.members.find((candidate) => candidate.name === name);
    assert.equal(member.attribute, name);
    assert.equal(member.reflects, true);
    assert.equal(typeof member.default, "string");
  }
});

test("one published choice card unifies context creation across document, canvas, and creative lenses", async () => {
  const [choiceSource, workspace, navigation, canvas, alternatives, editors, creative, chat, reference] = await Promise.all([
    read("../src/components/design-system/choice-card.ts"),
    read("../src/components/forma-workspace.ts"),
    read("../src/components/studio-navigation.ts"),
    read("../src/canvas/canvas-application.ts"),
    read("../src/components/forma-studio-alternatives.ts"),
    read("../src/components/forma-studio-editor-alternatives.ts"),
    read("../src/components/forma-creative-editor.ts"),
    read("../src/components/forma-chat-studio.ts"),
    read("../docs/components.md"),
  ]);
  const tag = "forma-ui-choice-card";
  const choice = declarationByTag.get(tag);

  assert.ok(choice, "the same production choice component is documented in the generated manifest");
  assert.equal(choice["x-forma"].category, "molecule");
  assert.equal(choice["x-forma"].renderRoot, "light");
  assert.deepEqual(choice["x-forma"].i18n.authorTextAttributes, ["detail", "label"]);
  assert.deepEqual(choice["x-forma"].i18n.invariantValuePaths, ["value"]);
  assert.equal(choice.demos[0].url, `/knowledge/design-system#${tag}`);
  assert.match(choice.events.find((event) => event.name === "forma-action").type.text, /value:\s*string/);
  assert.match(choiceSource, /<button\s+type="button"/);
  assert.match(choiceSource, /emitFormaEvent\(this, "forma-action", \{ value: this\.value \}\)/);
  assert.doesNotMatch(choiceSource, /FormaStore|state\/store|fetch\(|\/api\//);
  assert.match(catalogSource, /case "forma-ui-choice-card": return html`<forma-ui-choice-card/);
  assert.match(reference, /## Context creation and reusable choice cards/);

  for (const source of [workspace, navigation, canvas, alternatives, editors, creative, chat]) {
    assert.match(source, /<forma-ui-choice-card/, "every applicable context-creation experience reuses the production molecule");
  }
});

test("scoped locale contracts separate translated authored content from invariant machine identifiers", async () => {
  const [localeSource, languageOptionsSource, controllerSource] = await Promise.all([
    read("../src/components/design-system/localization.ts"),
    read("../src/components/design-system/language-options.ts"),
    read("../src/components/design-system/locale-controller.ts"),
  ]);
  const locale = declarationByTag.get("forma-ui-locale");
  assert.equal(locale["x-forma"].category, "foundation");
  assert.deepEqual(manifest["x-forma"].i18n.supportedLocales, ["en", "fr", "ar", "ja"]);
  assert.equal(manifest["x-forma"].i18n.scopeElement, "forma-ui-locale");
  for (const [attributeName, propertyName] of [["format-locale", "formatLocale"], ["time-zone", "timeZone"]]) {
    const attribute = locale.attributes.find((candidate) => candidate.name === attributeName);
    const property = locale.members.find((candidate) => candidate.name === propertyName);
    assert.equal(attribute.fieldName, propertyName);
    assert.equal(property.attribute, attributeName);
    assert.equal(property.reflects, true);
    assert.ok(attribute.description);
  }
  assert.ok(locale.members.some((member) => member.name === "messages" && !member.attribute));
  for (const [tag, collection] of [["forma-ui-select", "options"], ["forma-ui-breadcrumbs", "items"], ["forma-ui-toolbar", "actions"], ["forma-ui-workspace-switcher", "destinations"], ["forma-ui-audience-navigation", "destinations"]]) {
    const metadata = declarationByTag.get(tag)["x-forma"].i18n;
    assert.ok(metadata.optionTextPaths.includes(`${collection}[].label`));
    assert.ok(metadata.invariantValuePaths.includes(`${collection}[].value`));
  }
  assert.ok(declarationByTag.get("forma-ui-card")["x-forma"].i18n.authorOwnedSlots.includes(""));
  assert.ok(declarationByTag.get("forma-ui-avatar")["x-forma"].i18n.authorTextAttributes.includes("name"));
  assert.deepEqual(declarationByTag.get("forma-ui-segmented-control")["x-forma"].i18n.internalMessages, ["field.choose"]);
  assert.match(localeSource, /import\("\.\/locales\/fr"\)/);
  assert.match(localeSource, /import\("\.\/locales\/ar"\)/);
  assert.match(localeSource, /import\("\.\/locales\/ja"\)/);
  assert.match(languageOptionsSource, /\{ locale: "ja", label: "日本語", direction: "ltr" \}/);
  assert.match(localeSource, /export \{ FORMA_SUPPORTED_LOCALES \} from "\.\/language-options\.ts"/);
  assert.match(localeSource, /context-request/);
  assert.match(controllerSource, /Intl\.PluralRules/);
  assert.match(controllerSource, /Intl\.Segmenter/);
  for (const entry of componentCatalog) {
    for (const messages of [frenchMessages, arabicMessages, japaneseMessages]) {
      assert.ok(messages[`component.${entry.tag}.title`], `${entry.tag} has a translated title`);
      assert.ok(messages[`component.${entry.tag}.summary`], `${entry.tag} has a translated summary`);
    }
  }
  for (const category of ["zero", "one", "two", "few", "many", "other"]) assert.ok(arabicMessages[`catalog.results.${category}`]);
  assert.equal(new Intl.PluralRules("ja").select(1), "other");
  assert.ok(japaneseMessages["catalog.results.other"]);
  for (const [key, source] of Object.entries(frenchMessages)) {
    assert.ok(japaneseMessages[key], `Japanese translation missing for ${key}`);
    const placeholders = (message) => [...message.matchAll(/\{([^{}]+)\}/g)]
      .map((match) => match[1])
      .sort();
    assert.deepEqual(placeholders(japaneseMessages[key]), placeholders(source), `${key} preserves interpolation placeholders`);
  }
  assert.match(globalStyles, /:root:lang\(ar\)/);
  assert.match(globalStyles, /:root:lang\(ja\)/);
  assert.match(globalStyles, /--forma-script-letter-spacing:\s*0/);
  assert.match(catalogSource, /<pre lang="en" dir="ltr">/);
  assert.match(catalogSource, /catalog\.canonicalExample/);
});

test("one public-safe, documented native language picker is reused by every audience", async () => {
  const [pickerSource, pickerStyles, languageOptions, marketingSource, creatorSource, platformSource, guestSource, designContract, architectureContract, reference, readme] = await Promise.all([
    read("../src/components/design-system/language-picker.ts"),
    read("../src/components/design-system/language-picker.css"),
    read("../src/components/design-system/language-options.ts"),
    read("../src/marketing/main.ts"),
    read("../src/components/forma-shell.ts"),
    read("../src/components/forma-platform-shell.ts"),
    read("../src/apps/public-share/entry.ts"),
    read("../DESIGN.md"),
    read("../ARCHITECTURE.md"),
    read("../docs/components.md"),
    read("../README.md"),
  ]);
  const tag = "forma-ui-language-picker";
  const picker = declarationByTag.get(tag);

  assert.ok(picker, "The canonical public-safe control is published in both component manifests.");
  assert.equal(picker["x-forma"].category, "molecule");
  assert.equal(picker["x-forma"].renderRoot, "light");
  assert.equal(picker["x-forma"].stateful, false);
  assert.deepEqual(picker.superclass, { name: "HTMLElement", package: "global:" });
  assert.match(picker.summary, /visible translated label and a native select/);
  assert.equal(picker.demos[0].url, `/knowledge/design-system#${tag}`);

  for (const name of ["label", "value", "disabled", "busy"]) {
    const attribute = picker.attributes.find((item) => item.name === name);
    const member = picker.members.find((item) => item.name === name);
    assert.ok(attribute, `${name} is documented as an actual reflected attribute.`);
    assert.equal(attribute.fieldName, name);
    assert.equal(member.attribute, name);
    assert.equal(member.reflects, true);
  }

  const options = picker.members.find((item) => item.name === "options");
  assert.ok(options);
  assert.ok(!options.attribute, "Language options remain JavaScript-only records.");
  assert.match(options.type.text, /value:\s*string/);
  assert.match(options.type.text, /label:\s*string/);
  assert.match(options.type.text, /direction:\s*"ltr"\s*\|\s*"rtl"/);
  assert.deepEqual(picker["x-forma"].i18n.optionTextPaths, ["options[].label"]);
  assert.deepEqual(picker["x-forma"].i18n.invariantValuePaths, ["options[].value", "value"]);
  assert.ok(picker["x-forma"].i18n.authorTextAttributes.includes("label"));
  assert.match(picker.events.find((event) => event.name === "forma-change").type.text, /value:\s*string/);
  assert.ok(picker.cssProperties.some((property) => property.name === "--forma-control-min-size"));

  assert.match(pickerSource, /class FormaUiLanguagePicker extends HTMLElement/);
  assert.match(pickerSource, /static observedAttributes\s*=\s*\["label", "value", "disabled", "busy"\]/);
  assert.match(pickerSource, /option\.lang\s*=\s*choice\.value/);
  assert.match(pickerSource, /option\.dir\s*=\s*choice\.direction/);
  assert.match(pickerSource, /bubbles:\s*true[\s\S]*?composed:\s*true/);
  assert.doesNotMatch(pickerSource, /(?:from\s+["']lit|localization|FormaStore|\/api\/|fetch\()/);
  assert.doesNotMatch(languageOptions, /HTMLElement|customElements|document\.|from\s+["']lit/);
  assert.equal([...languageOptions.matchAll(/\{ locale: "(?:en|fr|ar|ja)"/g)].length, 4);
  assert.match(pickerStyles, /min-block-size:\s*var\(--forma-control-min-size,\s*2\.75rem\)/);

  assert.match(marketingSource, /document\.createElement\("forma-ui-language-picker"\)/);
  assert.match(marketingSource, /picker\.addEventListener\("forma-change"/);
  assert.match(marketingSource, /picker\.busy\s*=\s*true/);
  for (const host of [creatorSource, platformSource, guestSource]) {
    assert.match(host, /<forma-ui-language-picker\b/);
    assert.match(host, /@forma-change=/);
    assert.doesNotMatch(host, /<label class="locale-switcher"><span>/);
  }
  assert.match(creatorSource, /<form class="locale-picker-form" @submit=/);
  assert.match(catalogSource, /case "forma-ui-language-picker": return html`<forma-ui-language-picker/);

  for (const document of [designContract, architectureContract, reference, readme]) {
    assert.match(document, /(?:reuse|reus)/i);
    assert.match(document, /(?:manifest|custom-elements\.json)/i);
  }
  assert.match(designContract, /Mandatory reuse-first delivery and publication/);
  assert.match(designContract, /migrate every known duplicate[\s\S]*?same change/);
  assert.match(architectureContract, /public welcome experience[\s\S]*?exact-token[\s\S]*?guest review/);
  assert.match(reference, /<forma-ui-language-picker label="Language" value="en">/);
});

test("human reference and manifest describe the same atomic component taxonomy", () => {
  assert.equal(new Set(componentCatalog.map((entry) => entry.tag)).size, componentCatalog.length);
  assert.ok(componentCatalog.length >= 52);
  for (const entry of componentCatalog) {
    const declaration = declarationByTag.get(entry.tag);
    assert.ok(declaration, `${entry.tag} exists in the canonical manifest`);
    assert.equal(declaration["x-forma"].category, entry.level, `${entry.tag} has one coherent atomic role`);
    if (entry.level === "application") {
      assert.equal(entry.preview, false, "do not mount full application components inside documentation");
      assert.equal(entry.previewKind, "application-composition", "application patterns use independently isolated demonstrations");
    }
  }
  for (const level of ["foundation", "atom", "molecule", "organism", "application"]) {
    assert.ok(componentCatalog.some((entry) => entry.level === level), `${level} has documented components`);
  }
  for (const [tag] of shadowContracts) {
    const entry = componentCatalog.find((candidate) => candidate.tag === tag);
    assert.match(entry.example, /slot="/);
    assert.ok(entry.fallbackExample, `${tag} preserves a documented attribute-only shorthand`);
    assert.doesNotMatch(entry.fallbackExample, /slot="/);
    assert.match(entry.searchText, /slots/);
  }
  assert.match(componentCatalog.find((entry) => entry.tag === "forma-ui-card").example, /<img slot="media"[^>]+alt="[^"]+"/);
  assert.match(componentCatalog.find((entry) => entry.tag === "forma-ui-disclosure").example, /<span slot="summary">/);
});

test("every application pattern has an isolated, truthful, accessible production-primitive demonstration", () => {
  const applicationPatterns = componentCatalog.filter((entry) => entry.level === "application");
  assert.equal(applicationPatterns.length, 15);
  assert.equal(elements.filter((element) => element["x-forma"].demonstration === "isolated-composition").length, applicationPatterns.length);

  for (const entry of applicationPatterns) {
    const declaration = declarationByTag.get(entry.tag);
    assert.equal(entry.preview, false, `${entry.tag} is never mounted as a live application`);
    assert.equal(entry.previewKind, "application-composition");
    assert.equal(declaration["x-forma"].demonstration, "isolated-composition");
    assert.deepEqual(declaration.demos, [{ url: `/knowledge/design-system#${entry.tag}` }]);
    assert.match(applicationPreviewSource, new RegExp(`case "${entry.tag}":`));
    assert.doesNotMatch(applicationPreviewSource, new RegExp(`<${entry.tag}(?:\\s|>)`), `${entry.tag} cannot be mounted by its illustrative composition`);
  }

  const imports = [...applicationPreviewSource.matchAll(/^import\s+[^;]+?\s+from\s+"([^"]+)"/gm)]
    .map((match) => match[1]);
  assert.deepEqual(imports, ["lit"], "demonstrations cannot import application modules or the workspace store");
  assert.doesNotMatch(applicationPreviewSource, /this\.store|state\/store|fetch\(|setTimeout\(|localStorage|<img\b|<video\b|<canvas\b/);
  assert.doesNotMatch(applicationPreviewSource, /<h[1-3]\b|role="tree"|role="menu"|role="tablist"|<section\b[^>]*aria-label=/);
  assert.match(applicationPreviewSource, /role="group" aria-label=\$\{t\("pattern\.navigation", "Example audience-specific navigation"\)\}/);
  assert.match(applicationPreviewSource, /value="components"/);
  assert.match(applicationPreviewSource, /case "forma-platform-shell"/);
  assert.match(applicationPreviewSource,/case "forma-workspace-settings"/);
  assert.match(applicationPreviewSource,/pattern\.workspaceAdministration/);
  assert.match(applicationPreviewSource,/<forma-ui-switch \.label=\$\{t\("workspace\.admin\.canvasAccessNamed"/);
  assert.match(applicationPreviewSource,/workspace\.admin\.editorBudgetNotice/);
  assert.match(applicationPreviewSource, /<forma-ui-workspace-switcher/);
  assert.match(applicationPreviewSource, /<forma-ui-audience-navigation/);
  assert.match(applicationPreviewSource, /role="list" aria-label=\$\{t\("pattern\.collectionHierarchy", "Sample collection hierarchy"\)\}/);
  assert.match(applicationPreviewSource, /class="sr-only"> \$\{t\("pattern\.libraryItems"/);
  for (const approach of ["Prose", "Bullets", "JSON", "XML"]) assert.match(applicationPreviewSource, new RegExp(`"${approach}"`));

  assert.match(catalogSource, /entry\.previewKind === "application-composition"/);
  assert.match(catalogSource, /renderApplicationPatternPreview\(entry\.tag, this\.i18n\)/);
  assert.match(catalogSource, /Illustrative composition · application element not mounted/);
  assert.match(catalogSource, /Live loading announcement omitted to keep this reference quiet/);
  assert.match(catalogSource, /Every component API is real; application previews safely compose shared interface patterns/);
  assert.match(laboratoryStyles, /\.component-pattern-navigation \.ui-segmented\s*\{[\s\S]*?flex-wrap:\s*wrap/);
  assert.match(laboratoryStyles, /@media \(forced-colors: active\)[\s\S]*?\.component-pattern-artwork/);

  assert.equal(componentCatalog.find((entry) => entry.tag === "forma-ui-spinner").preview, false);
  assert.equal(componentCatalog.find((entry) => entry.tag === "forma-ui-spinner").previewKind, "component");
  for (const tag of ["forma-artifact-summary", "forma-presentation-slide", "forma-platform-shell", "forma-shared-view", "forma-ui-workspace-switcher", "forma-ui-audience-navigation"]) {
    assert.equal(declarationByTag.get(tag)["x-forma"].stateful, false, `${tag} truthfully reports its presentational base`);
  }
  for (const tag of ["forma-collection-tree", "forma-generation-actions"]) {
    assert.equal(declarationByTag.get(tag)["x-forma"].stateful, true, `${tag} preserves its real stateful application boundary`);
  }
});

test("the reference remains route-lazy, store-independent, searchable, and interactive", async () => {
  const route = await read("../src/apps/knowledge/entry.ts");
  assert.match(route, /import\("\.\.\/\.\.\/components\/forma-design-system-lab"\)/);
  assert.match(baseSource, /createRenderRoot\(\)\s*\{\s*return this/);
  assert.doesNotMatch(catalogSource, /\.\/forma-element|state\/store|this\.store/);
  assert.match(catalogSource, /extends FormaPresentationalElement/);
  assert.match(catalogSource, /\.label=\$\{this\.i18n\.t\("catalog\.searchLabel", "Search components"\)\}/);
  assert.match(catalogSource, /Browse by atomic level/);
  assert.match(catalogSource, /aria-live="polite"/);
  assert.match(catalogSource, /#openApis\.has\(entry\.tag\)\s*\?\s*this\.#api\(entry\)/);
  assert.match(catalogSource, /<pre lang="en" dir="ltr"><code>\$\{entry\.example\}/);
  assert.match(catalogSource, /declaration\.slots/);
  assert.match(catalogSource, /Content slots/);
  assert.match(catalogSource, /Main content \(default\)/);
  assert.match(catalogSource, /Attribute-only shorthand/);
  assert.match(catalogSource, /Authored buttons and links keep their own native click and form behavior/);
  assert.match(catalogSource, /shadowRoot[\s\S]*?querySelectorAll\("slot"\)/);
  assert.match(catalogSource, /<h4 slot="heading">/);
  assert.match(catalogSource, /role="img" aria-label=\$\{this\.i18n\.t\("sample\.campaignImage", "Soft blue and warm summer campaign color study"\)\}/);
  assert.match(catalogSource, /href="\/custom-elements\.json"/);
  assert.match(catalogSource, /toLocaleLowerCase\(this\.i18n\.locale\)/);
  assert.match(catalogSource, /\\p\{Script=Latin\}/);
  assert.match(catalogSource, /this\.#query = event\.detail\.value/);
  assert.match(catalogSource, /customElements\.get\(tag\)/);
  assert.match(catalogSource, /loadComponentManifest\(\)/);
  assert.match(labSource, /<forma-component-catalog>/);
  assert.match(labSource, /administrative-page design-system-lab/);
  assert.match(labSource, /<forma-ui-disclosure class="design-disclosure"><span slot="summary">\$\{this\.i18n\.t\("lab\.disclosure", "Progressive disclosure"\)\}<\/span>/);
  assert.match(labSource, /extends FormaPresentationalElement/);
  assert.match(labSource, /SYNTHETIC_DESIGN_FIXTURES/);
  assert.match(labSource, /SYNTHETIC_AUDIENCE_TASKS/);
  assert.match(labSource, /view==="components"/);
  assert.match(labSource, /#cancelPreview\(event:Event\)/);
  assert.doesNotMatch(labSource, /this\.store|state\/store|fetch\(/);
  for (const level of ["Foundations", "Atoms", "Molecules", "Organisms", "Templates"]) assert.match(labSource, new RegExp(level));
});

test("audience information architecture is a documented, localized, production-adopted design-system contract", async()=>{
  const [navigation,creatorShell,platformShell,design,architecture,readme,reference,knowledgeEntry]=await Promise.all([
    "../src/components/design-system/navigation.ts","../src/components/forma-shell.ts","../src/components/forma-platform-shell.ts",
    "../DESIGN.md","../ARCHITECTURE.md","../README.md","../docs/components.md","../src/apps/knowledge/entry.ts",
  ].map(read));
  for(const [tag,category] of [["forma-ui-workspace-switcher","organism"],["forma-ui-audience-navigation","molecule"]]){
    const declaration=declarationByTag.get(tag);
    assert.ok(componentCatalog.some((entry)=>entry.tag===tag&&entry.level===category));
    assert.equal(declaration["x-forma"].category,category);
    assert.equal(declaration["x-forma"].stateful,false);
    assert.equal(declaration["x-forma"].renderRoot,"light");
    assert.ok(declaration.members.some((member)=>member.name==="destinations"&&!member.attribute));
    assert.ok(!declaration.attributes.some((attribute)=>attribute.name==="destinations"));
    assert.match(declaration.events.find((event)=>event.name==="forma-navigate").type.text,/value:\s*string;\s*href:\s*string/);
    const i18n=declaration["x-forma"].i18n;
    assert.deepEqual(i18n.optionTextPaths,["destinations[].label","destinations[].description"]);
    assert.ok(i18n.invariantValuePaths.includes("destinations[].value"));
    assert.ok(i18n.invariantValuePaths.includes("destinations[].href"));
    assert.ok(i18n.invariantValuePaths.includes("value"));
    assert.deepEqual(declaration.demos,[{url:`/knowledge/design-system#${tag}`}]);
    assert.ok(frenchMessages[`component.${tag}.title`]);
    assert.ok(arabicMessages[`component.${tag}.summary`]);
    assert.match(creatorShell,new RegExp(`<${tag}`));
    assert.match(platformShell,new RegExp(`<${tag}`));
    assert.match(reference,new RegExp(tag));
  }
  assert.match(navigation,/destinations\.length < 2\) return nothing/);
  assert.match(navigation,/const authorized = this\.destinations\.filter\(\(destination\) => !destination\.disabled\)/);
  assert.match(navigation,/const destinations = authorized\.slice\(0, 5\)/);
  assert.match(navigation,/aria-current=\$\{destination\.value === this\.value \? "page" : nothing\}/);
  assert.match(navigation,/\{ value: destination\.value, href: destination\.href \}/);
  assert.match(familyStyles,/\.ui-workspace-switcher/);
  assert.match(familyStyles,/\.ui-audience-navigation/);
  assert.match(knowledgeEntry,/\/knowledge\/patterns/);
  assert.match(knowledgeEntry,/\/knowledge\/guidance/);
  for(const document of [design,architecture,readme,reference]){
    for(const surface of ["Creator Workspace","Canvas","Platform Operations","Product & Quality","Design & Knowledge","Engineering Diagnostics"])
      assert.ok(document.includes(surface),`${surface} is documented`);
    assert.match(document,/\/knowledge\/design-system/);
  }
  assert.doesNotMatch(reference,/\/laboratory\/design-system/);
});

test("workspace navigation opens an accessible native link popover instead of a disclosure or form control",async()=>{
  const [navigation,defaultMessages,design,reference]=await Promise.all([
    "../src/components/design-system/navigation.ts","../src/components/design-system/localization.ts","../DESIGN.md","../docs/components.md",
  ].map(read));
  const start=navigation.indexOf("export class FormaUiWorkspaceSwitcher");
  const end=navigation.indexOf("export class FormaUiAudienceNavigation",start);
  assert.ok(start>=0&&end>start);
  const switcher=navigation.slice(start,end);

  assert.match(switcher,/destinations\.length < 2\) return nothing/);
  assert.match(switcher,/destinations\.length === 2\) return html`<nav/);
  assert.match(switcher,/destinations\.find\(\(destination\) => destination\.value === this\.value\)/);
  assert.match(switcher,/nextFormaId\("workspace-switcher"\)/);
  assert.match(switcher,/<button type="button"[^>]*popovertarget=\$\{this\.#id\}/);
  assert.match(switcher,/aria-controls=\$\{this\.#id\} aria-expanded=\$\{String\(this\.#open\)\}/);
  assert.match(switcher,/navigation\.switchWorkspaceCurrent[\s\S]*?workspace: current\.label/);
  assert.match(switcher,/<nav id=\$\{this\.#id\}[^>]*popover="auto" aria-label=\$\{label\}/);
  assert.match(switcher,/@toggle=\$\{this\.#toggle\}/);
  assert.match(switcher,/querySelector<HTMLAnchorElement>\('a\[aria-current="page"\]'\)/);
  assert.match(switcher,/event\.key === "Escape"[\s\S]*?this\.#returnFocus = true/);
  assert.match(switcher,/querySelector<HTMLButtonElement>\("\.ui-workspace-switcher-trigger"\)/);
  assert.match(switcher,/focus\.lease\.run\(target, \(\) => \{ target\.focus\(\); return true; \}\)/);
  assert.match(switcher,/panel\.hidePopover\(\)/);
  assert.match(switcher,/event\.button!==0\|\|event\.metaKey\|\|event\.ctrlKey\|\|event\.shiftKey\|\|event\.altKey/);
  assert.match(switcher,/<a href=\$\{destination\.href\}/);
  assert.doesNotMatch(switcher,/<details\b|<summary\b|<select\b|<dialog\b|role="(?:menu|menuitem|listbox|combobox)"/);

  assert.match(familyStyles,/\.ui-workspace-switcher-panel\[popover\]:popover-open\s*\{[^}]*display:\s*grid/);
  assert.match(familyStyles,/forma-ui-popover,forma-ui-workspace-switcher\s*\{\s*anchor-scope:/);
  assert.doesNotMatch(familyStyles,/\.ui-workspace-switcher\s+summary|\.platform-switcher\s*>\s*nav\s*\{/);
  assert.match(defaultMessages,/"navigation\.switchWorkspaceCurrent":/);
  for(const catalog of [frenchMessages,arabicMessages])assert.match(catalog["navigation.switchWorkspaceCurrent"],/\{workspace\}/);
  assert.ok(declarationByTag.get("forma-ui-workspace-switcher")["x-forma"].i18n.internalMessages.includes("navigation.switchWorkspaceCurrent"));
  assert.match(catalogSource,/case "forma-ui-workspace-switcher"[^\n]*value:"product"/);
  assert.match(design,/native\s+automatically dismissed popover/);
  assert.match(reference,/popover="auto"/);
});

test("audience task rails are neutral, current-preserving, keyboard-safe, and consistent across shells",async()=>{
  const [navigation,creatorShell,platformShell,adapter,design,reference,canvasStyles]=await Promise.all([
    "../src/components/design-system/navigation.ts","../src/components/forma-shell.ts","../src/components/forma-platform-shell.ts",
    "../src/components/area-navigation.ts","../DESIGN.md","../docs/components.md","../src/canvas/canvas.css",
  ].map(read));
  const start=navigation.indexOf("export class FormaUiAudienceNavigation");
  assert.ok(start>=0);
  const audience=navigation.slice(start,navigation.indexOf("\nconst definitions =",start));

  assert.match(audience,/if \(!authorized\.length\) return nothing/);
  assert.match(audience,/const destinations = authorized\.slice\(0, 5\)/);
  assert.match(audience,/if \(current && !destinations\.includes\(current\)\) destinations\[destinations\.length - 1\] = current/);
  assert.match(audience,/const currentIndex = destinations\.findIndex\(\(destination\) => destination\.value === this\.value\)/);
  assert.match(audience,/<nav class="ui-audience-navigation" aria-label=\$\{label\}><ul class="ui-audience-navigation-list">/);
  assert.match(audience,/<li><a href=\$\{destination\.href\}/);
  assert.match(audience,/aria-current=\$\{index === currentIndex \? "page" : nothing\}/);
  assert.match(audience,/querySelector<HTMLElement>\("\.ui-audience-navigation-list"\)/);
  assert.match(audience,/Number\.parseFloat\(getComputedStyle\(current\)\.outlineWidth\)/);
  assert.match(audience,/target\.right > viewport\.right - focusClearance[\s\S]*scroller\.scrollLeft \+=/);
  assert.match(audience,/this\.matches\(":dir\(rtl\)"\)/);
  assert.match(audience,/event\.button!==0\|\|event\.metaKey\|\|event\.ctrlKey\|\|event\.shiftKey\|\|event\.altKey/);
  assert.doesNotMatch(audience,/area-navigation--administrative|<span>\$\{label\}<\/span>|role="(?:tablist|tab|menu|menuitem)"|scrollIntoView|scroll-behavior:\s*smooth/);
  assert.doesNotMatch(adapter,/getBoundingClientRect|\.area-navigation > div/);

  assert.match(familyStyles,/forma-ui-audience-navigation:empty\s*\{\s*display:\s*none/);
  assert.match(familyStyles,/\.ui-audience-navigation-list\s*\{[^}]*padding-inline:\s*var\(--page-gutter,[^;]+\);[^}]*overflow-x:\s*auto;[^}]*scroll-padding-inline:\s*var\(--page-gutter,/s);
  assert.doesNotMatch(familyStyles,/\.ui-audience-navigation-list\s*\{[^}]*padding-block:/s);
  assert.match(familyStyles,/\.ui-audience-navigation a:focus-visible\s*\{\s*outline-offset:\s*calc\(-1 \* var\(--forma-focus-ring-width,/);
  assert.match(familyStyles,/\.ui-audience-navigation a\s*\{[^}]*min-inline-size:\s*var\(--forma-control-min-size,[^;]+\);[^}]*color:\s*var\(--forma-color-text-muted,[^;]+\);[^}]*border-block-end:\s*2px solid transparent/s);
  assert.match(familyStyles,/\.ui-audience-navigation a\[aria-current="page"\]\s*\{[^}]*border-block-end-color:\s*var\(--forma-color-accent,/s);
  assert.match(familyStyles,/@media \(forced-colors: active\)[\s\S]*?\.ui-audience-navigation a\[aria-current="page"\]\s*\{[^}]*color:\s*CanvasText;[^}]*background:\s*Canvas;[^}]*border-block-end-color:\s*Highlight;/s);
  assert.match(familyStyles,/html\[data-document-focus\] \.app-shell > forma-ui-audience-navigation,\s*html\[data-canvas-focus\] \.app-shell > forma-ui-audience-navigation\s*\{\s*display:\s*none/);
  assert.match(canvasStyles,/html\[data-canvas-focus\] \.application-canvas>\.topbar,html\[data-canvas-focus\] \.application-canvas>\.area-navigation--canvas\{display:none\}/);
  assert.match(canvasStyles,/--canvas-chrome-height:calc\(4rem \+ var\(--forma-control-min-size,2\.75rem\) \+ 1px\)/);
  assert.match(creatorShell,/application-task-navigation area-navigation--\$\{applicationId\}/);
  assert.match(platformShell,/<forma-ui-audience-navigation class="platform-navigation"/);
  assert.match(laboratoryStyles,/\.component-library \.ui-audience-navigation-list,[\s\S]*?padding-inline:\s*var\(--forma-space-3/);
  assert.match(catalogSource,/case "forma-ui-audience-navigation"[^\n]*value="delivery"/);
  for(const token of ["--forma-color-surface","--forma-color-border","--forma-color-text","--forma-color-text-muted","--forma-color-accent-text","--forma-color-accent"])
    assert.ok(declarationByTag.get("forma-ui-audience-navigation").cssProperties.some((property)=>property.name===token),`${token} is machine-discoverable`);
  assert.match(design,/audience-neutral, preference-reactive task rail/);
  assert.match(reference,/current authorized destination instead of silently hiding it/);
});

test("the component library is actually adopted by Library and Operations surfaces", () => {
  assert.match(librarySource, /<forma-ui-search class="searchbox" \.label=\$\{this\.i18n\.t\("projects\.searchLibrary","Search project library"\)/);
  assert.match(librarySource, /<forma-ui-segmented-control class="segmented" \.label=\$\{this\.i18n\.t\("projects\.libraryContent","Library content"\)/);
  assert.match(librarySource, /@forma-input/);
  assert.match(librarySource, /@forma-change/);
  assert.match(analyticsSource, /<div><forma-ui-metric \.label=\$\{label\}/);
  assert.match(familyStyles, /\.analytics-readiness-outcomes/);
  assert.doesNotMatch(collectionSource, /role="tree"|role="treeitem"|role="menu"|role="menuitem"/);
  assert.match(collectionSource, /role="group" aria-label=\$\{this\.i18n\.system\("\{handle\} actions", \{ handle: collection\.handle \}\)\}/);
});

test("the Design System documents workspace-owned shared capabilities and explicit localized Creator handoffs",async()=>{
  const [design,reference,architecture,rail,editor,output,fan,artifacts]=await Promise.all([
    "../DESIGN.md","../docs/components.md","../ARCHITECTURE.md","../src/components/project-rail.ts",
    "../src/components/library-block-editor.ts","../src/components/output-card.ts","../src/components/prompt-fan-review.ts","../src/components/document-artifacts.ts",
  ].map(read));
  for(const source of [design,reference,architecture,applicationPreviewSource]){
    assert.match(source,/\/canvas\/projects/);
    assert.match(source,/\/canvas\/library/);
  }
  assert.match(applicationPreviewSource,/href:\s*"#forma-area-navigation-canvas-projects"/);
  assert.match(applicationPreviewSource,/href:\s*"#forma-area-navigation-canvas-library"/);
  for(const catalog of [frenchMessages,arabicMessages]){
    for(const key of ["pattern.workspaceOwnedResources","pattern.sharedProjectResources","projects.editCreator","projects.useEditCreator","projects.removeKeptNamed","projects.keepReuseNamed"])assert.ok(catalog[key],key);
    assert.ok(catalog["projects.removeKeptNamed"].startsWith(catalog["projects.removeKept"]));
    assert.ok(catalog["projects.keepReuseNamed"].startsWith(catalog["projects.keepReuse"]));
  }
  assert.match(rail,/event\.button!==0\|\|event\.metaKey\|\|event\.ctrlKey/);
  assert.match(editor,/<h1 id="library-block-editor-title">/);
  assert.doesNotMatch(editor,/<main class="library-block-workbench">/);
  assert.match(librarySource,/\$\{canAuthor&&!context\?html`<button class="button ghost"/);
  assert.match(librarySource,/for\(const dialog of this\.querySelectorAll<HTMLDialogElement>/);
  for(const source of [output,fan,artifacts,librarySource]){
    assert.match(source,/projects\.editCreator/);
    assert.match(source,/projects\.useEditCreator/);
  }
  assert.match(librarySource,/libraryBaseRoute\(this\.store\.route\.get\(\)\)==="\/canvas\/library"/);
  assert.match(librarySource,/aria-label=\$\{this\.#inputAction\(adopted,artifact\.title\)\}/);
  assert.match(librarySource,/\$\{this\.#inputLabel\(adopted\)\}/);
  assert.match(fan,/aria-label=\$\{this\.#inputLabel\(output,definition\.label\)\}/);
});

test("single-select pickers enhance progressively while preserving native forms and accessibility", async () => {
  const formsSource = await read("../src/components/design-system/forms.ts");
  const enhancement = familyStyles.match(/@supports \(appearance: base-select\) and selector\(::picker\(select\)\) \{([\s\S]*?)\n\}\n\ntextarea/);
  assert.ok(enhancement, "custom picker styles require both select and picker support");

  const [, rules] = enhancement;
  assert.equal((rules.match(/\bappearance:\s*base-select/g) ?? []).length, 2, "both the select and its picker opt in");
  assert.doesNotMatch(familyStyles.replace(enhancement[0], ""), /\bappearance:\s*base-select/, "unsupported browsers retain their existing native appearance");
  assert.match(rules, /select:not\(\[multiple\]\):not\(\[size\]\)/);
  assert.match(rules, /select:not\(\[multiple\]\)\[size="1"\]/);
  assert.match(rules, /appearance:\s*base-select;\s*display:\s*inline-flex;\s*align-items:\s*center;\s*gap:\s*var\(--forma-space-2,\s*\.5rem\)/);
  assert.match(rules, /:is\(\.block-subtype,\s*\.block-intent\)\s*:is\(select:not\(\[multiple\]\):not\(\[size\]\),\s*select:not\(\[multiple\]\)\[size="1"\]\)\s*\{\s*padding-inline:\s*\.6rem/);
  assert.match(familyStyles, /\.block-subtype select,\s*\.block-intent select\s*\{[^}]*padding:\s*\.4rem 1\.8rem \.4rem \.6rem/, "native browsers retain the original compact arrow reserve");
  assert.match(rules, /::picker\(select\)\s*\{[\s\S]*?appearance:\s*base-select/);
  assert.match(rules, /::picker-icon\s*\{\s*flex:\s*none;\s*margin-inline-start:\s*auto/);
  assert.match(rules, /:open::picker-icon\s*\{[\s\S]*?rotate:\s*180deg/);
  assert.match(rules, /option\)[^\n]*\{[\s\S]*?min-block-size:\s*var\(--forma-control-min-size/);
  assert.match(rules, /option\):focus-visible\s*\{[\s\S]*?--forma-focus-ring-color/);
  assert.match(rules, /option\):checked\s*\{[\s\S]*?--forma-color-accent-subtle/);
  assert.match(rules, /option\)::checkmark\s*\{[\s\S]*?margin-inline-start:\s*auto/);
  assert.match(rules, /option\):disabled\s*\{[\s\S]*?cursor:\s*not-allowed/);
  assert.match(rules, /select:not\(\[multiple\]\):not\(\[size\]\) optgroup/);
  assert.match(rules, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?::picker-icon\s*\{[\s\S]*?transition:\s*none/);
  assert.match(rules, /@media \(forced-colors: active\)[\s\S]*?background:\s*Highlight/);
  assert.doesNotMatch(rules, /(?:^|\n)\s*option(?:[:\s,{])/, "datalist options must not receive picker-only styles");

  const nativeSelect = formsSource.match(/<select\b[\s\S]*?<\/select>/)?.[0];
  assert.ok(nativeSelect, "the design-system component renders a real native select");
  assert.match(nativeSelect, /<option\b/);
  assert.match(nativeSelect, /\?required=\$\{this\.required\}/);
  assert.match(nativeSelect, /\?disabled=\$\{this\.disabled\}/);
  assert.match(nativeSelect, /aria-describedby=/);
  assert.match(nativeSelect, /@change=\$\{this\.#change\}/);
  assert.doesNotMatch(nativeSelect, /<button\b|<selectedcontent\b/, "legacy HTML parsers keep standard select content");
});

test("theme defaults reach AAA text contrast and visible interactive boundaries", () => {
  for (const surfaceName of ["paper", "panel", "panel-2"]) {
    const surface = paired(surfaceName);
    const muted = paired("muted");
    const strong = paired("line-strong");
    for (const mode of ["light", "dark"]) {
      assert.ok(contrast(muted[mode], surface[mode]) >= 7, `${mode} supporting text is readable on ${surfaceName}`);
      assert.ok(contrast(strong[mode], surface[mode]) >= 3, `${mode} control boundary is visible on ${surfaceName}`);
    }
  }

  const accent = paired("forma-color-accent-text");
  const accentWash = paired("orange-soft");
  const warning = paired("forma-color-warning-text");
  const warningWash = paired("warning-soft");
  for (const mode of ["light", "dark"]) {
    assert.ok(contrast(accent[mode], accentWash[mode]) >= 7, `${mode} accent text remains readable on its wash`);
    assert.ok(contrast(warning[mode], warningWash[mode]) >= 7, `${mode} warning text remains readable on its wash`);
  }
  assert.match(globalStyles, /--forma-control-min-size:\s*2\.75rem/);
  assert.match(familyStyles, /\.button\.compact\s*\{\s*min-height:\s*2\.75rem/);
  assert.match(familyStyles, /@media \(forced-colors: active\)/);
  assert.match(familyStyles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(familyStyles, /\.tree-row:hover \.tree-more/);
  assert.match(familyStyles, /anchor-scope:\s*--forma-popover-trigger/);
  assert.match(laboratoryStyles, /overflow-x:\s*auto/);
  assert.match(laboratoryStyles, /min-block-size:\s*var\(--forma-control-min-size/);
  assert.doesNotMatch(`${globalStyles}\n${familyStyles}`, /prefers-color-scheme/);
});
