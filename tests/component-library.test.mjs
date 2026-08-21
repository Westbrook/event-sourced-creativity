import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { componentCatalog } from "../src/components/design-system/catalog.ts";

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
  assert.ok(elements.length >= 98, "include the original application inventory and expanded component library");
  assert.ok(elements.filter((element) => element.tagName.startsWith("forma-ui-")).length >= 40);
  assert.equal(new Set(elements.map((element) => element.tagName)).size, elements.length);
  for (const tag of ["forma-shell", "forma-library", "forma-projects", "forma-analytics", "forma-design-system-lab", "forma-component-catalog", "forma-ui-theme", "forma-ui-dialog"]) {
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
  assert.match(layoutSource, /this\.querySelector\('\[slot="heading"\]'\)\?\.textContent\?\.trim\(\)/);
  assert.doesNotMatch(layoutSource, /<h[1-6][^>]*>\s*<slot name="heading"/);

  assert.match(feedbackSource, /<div class="ui-notice-copy" role=/);
  assert.match(feedbackSource, /<div class="ui-notice-actions"><slot name="actions">/);
  assert.match(feedbackSource, /<summary><slot name="summary">\$\{this\.label\}<\/slot><\/summary>/);
  assert.match(feedbackSource, /if \(open && this\.group\)[\s\S]*?this\.getRootNode\(\)[\s\S]*?querySelectorAll<FormaUiDisclosure>\("forma-ui-disclosure"\)/);
  assert.match(feedbackSource, /peer !== this && peer\.group === this\.group[\s\S]*?details\.open = false/);
  assert.match(feedbackSource, /querySelector\('\[slot="heading"\]'\)\?\.textContent\?\.trim\(\)/);

  for (const tag of ["forma-ui-button", "forma-ui-field", "forma-ui-search", "forma-ui-select", "forma-ui-tabs", "forma-ui-popover", "forma-ui-dialog", "forma-ui-stack", "forma-ui-theme", "forma-ui-empty-state", "forma-ui-metric"]) {
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
  for (const token of ["--forma-focus-ring-color", "--forma-focus-ring-width", "--forma-font-size-supporting", "--forma-color-danger-text", "--forma-duration-normal", "--forma-control-min-size"]) {
    assert.ok(theme.cssProperties.some((property) => property.name === token), `${token} is machine-discoverable`);
  }
  for (const name of ["density", "radius"]) {
    const member = theme.members.find((candidate) => candidate.name === name);
    assert.equal(member.attribute, name);
    assert.equal(member.reflects, true);
    assert.equal(typeof member.default, "string");
  }
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
  assert.equal(applicationPatterns.length, 12);
  assert.equal(elements.filter((element) => element["x-forma"].demonstration === "isolated-composition").length, applicationPatterns.length);

  for (const entry of applicationPatterns) {
    const declaration = declarationByTag.get(entry.tag);
    assert.equal(entry.preview, false, `${entry.tag} is never mounted as a live application`);
    assert.equal(entry.previewKind, "application-composition");
    assert.equal(declaration["x-forma"].demonstration, "isolated-composition");
    assert.deepEqual(declaration.demos, [{ url: `/laboratory/design-system#${entry.tag}` }]);
    assert.match(applicationPreviewSource, new RegExp(`case "${entry.tag}":`));
    assert.doesNotMatch(applicationPreviewSource, new RegExp(`<${entry.tag}(?:\\s|>)`), `${entry.tag} cannot be mounted by its illustrative composition`);
  }

  const imports = [...applicationPreviewSource.matchAll(/^import\s+[^;]+?\s+from\s+"([^"]+)"/gm)]
    .map((match) => match[1]);
  assert.deepEqual(imports, ["lit"], "demonstrations cannot import application modules or the workspace store");
  assert.doesNotMatch(applicationPreviewSource, /this\.store|state\/store|fetch\(|setTimeout\(|localStorage|<img\b|<video\b|<canvas\b/);
  assert.doesNotMatch(applicationPreviewSource, /<h[1-3]\b|role="tree"|role="menu"|role="tablist"|<section\b[^>]*aria-label=/);
  assert.match(applicationPreviewSource, /role="group" aria-label="Example Laboratory navigation"/);
  assert.match(applicationPreviewSource, /value="design-system"/);
  assert.match(applicationPreviewSource, /role="list" aria-label="Sample collection hierarchy"/);
  assert.match(applicationPreviewSource, /class="sr-only"> items<\/span>/);
  for (const approach of ["Prose", "Bullets", "JSON", "XML"]) assert.match(applicationPreviewSource, new RegExp(`"${approach}"`));

  assert.match(catalogSource, /entry\.previewKind === "application-composition"/);
  assert.match(catalogSource, /renderApplicationPatternPreview\(entry\.tag\)/);
  assert.match(catalogSource, /Illustrative composition · application element not mounted/);
  assert.match(catalogSource, /Live loading announcement omitted to keep this reference quiet/);
  assert.match(catalogSource, /Every component API is real; application previews safely compose shared interface patterns/);
  assert.match(laboratoryStyles, /\.component-pattern-navigation \.ui-segmented\s*\{[\s\S]*?flex-wrap:\s*wrap/);
  assert.match(laboratoryStyles, /@media \(forced-colors: active\)[\s\S]*?\.component-pattern-artwork/);

  assert.equal(componentCatalog.find((entry) => entry.tag === "forma-ui-spinner").preview, false);
  assert.equal(componentCatalog.find((entry) => entry.tag === "forma-ui-spinner").previewKind, "component");
  for (const tag of ["forma-artifact-summary", "forma-presentation-slide"]) {
    assert.equal(declarationByTag.get(tag)["x-forma"].stateful, false, `${tag} truthfully reports its presentational base`);
  }
  for (const tag of ["forma-collection-tree", "forma-generation-actions", "forma-shared-view"]) {
    assert.equal(declarationByTag.get(tag)["x-forma"].stateful, true, `${tag} preserves its real stateful application boundary`);
  }
});

test("the reference remains route-lazy, store-independent, searchable, and interactive", async () => {
  const route = await read("../src/apps/laboratory/entry.ts");
  assert.match(route, /import\("\.\.\/\.\.\/components\/forma-design-system-lab"\)/);
  assert.match(baseSource, /createRenderRoot\(\)\s*\{\s*return this/);
  assert.doesNotMatch(catalogSource, /\.\/forma-element|state\/store|this\.store/);
  assert.match(catalogSource, /extends FormaPresentationalElement/);
  assert.match(catalogSource, /label="Search components"/);
  assert.match(catalogSource, /Browse by atomic level/);
  assert.match(catalogSource, /aria-live="polite"/);
  assert.match(catalogSource, /#openApis\.has\(entry\.tag\)\s*\?\s*this\.#api\(entry\)/);
  assert.match(catalogSource, /<pre><code>\$\{entry\.example\}/);
  assert.match(catalogSource, /declaration\.slots/);
  assert.match(catalogSource, /Content slots/);
  assert.match(catalogSource, /Main content \(default\)/);
  assert.match(catalogSource, /Attribute-only shorthand/);
  assert.match(catalogSource, /Authored buttons and links keep their own native click and form behavior/);
  assert.match(catalogSource, /shadowRoot[\s\S]*?querySelectorAll\("slot"\)/);
  assert.match(catalogSource, /<h4 slot="heading">/);
  assert.match(catalogSource, /role="img" aria-label="Soft blue and warm summer campaign color study"/);
  assert.match(catalogSource, /href="\/custom-elements\.json"/);
  assert.match(catalogSource, /\.trim\(\)\.toLocaleLowerCase\(\)/);
  assert.match(catalogSource, /this\.#query = event\.detail\.value/);
  assert.match(catalogSource, /customElements\.get\(tag\)/);
  assert.match(catalogSource, /loadComponentManifest\(\)/);
  assert.match(labSource, /<forma-component-catalog>/);
  assert.match(labSource, /administrative-page design-system-lab/);
  assert.match(labSource, /<forma-ui-disclosure class="design-disclosure"><span slot="summary">Progressive disclosure<\/span>/);
  assert.match(labSource, /@forma-action=\$\{\(\) => this\.store\.setRoute\("\/projects"\)/);
  for (const level of ["Foundations", "Atoms", "Molecules", "Organisms", "Templates"]) assert.match(labSource, new RegExp(level));
});

test("the component library is actually adopted by Library and Operations surfaces", () => {
  assert.match(librarySource, /<forma-ui-search class="searchbox" label="Search project library"/);
  assert.match(librarySource, /<forma-ui-segmented-control class="segmented" label="Library content"/);
  assert.match(librarySource, /@forma-input/);
  assert.match(librarySource, /@forma-change/);
  assert.match(analyticsSource, /<div><forma-ui-metric \.label=\$\{label\}/);
  assert.match(familyStyles, /\.analytics-readiness-outcomes/);
  assert.doesNotMatch(collectionSource, /role="tree"|role="treeitem"|role="menu"|role="menuitem"/);
  assert.match(collectionSource, /role="group" aria-label=\$\{`\$\{collection\.handle\} actions`\}/);
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
