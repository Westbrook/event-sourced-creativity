import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { componentCatalog } from "../src/components/design-system/catalog.ts";
import frenchMessages from "../src/components/design-system/locales/fr.ts";
import arabicMessages from "../src/components/design-system/locales/ar.ts";
import japaneseMessages from "../src/components/design-system/locales/ja.ts";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const tag = "forma-ui-choice-card";

test("context choices use one published, localized, accessible production molecule", async () => {
  const [source, manifestSource, publicManifestSource, catalog, reference, design, styles] = await Promise.all([
    read("../src/components/design-system/choice-card.ts"),
    read("../custom-elements.json"),
    read("../public/custom-elements.json"),
    read("../src/components/design-system/component-catalog.ts"),
    read("../docs/components.md"),
    read("../DESIGN.md"),
    read("../src/design-system.css"),
  ]);

  const manifest = JSON.parse(manifestSource);
  const component = manifest.modules.flatMap((module) => module.declarations ?? []).find((entry) => entry.tagName === tag);
  assert.ok(component, "the shared choice card is present in the generated component manifest");
  assert.equal(publicManifestSource, manifestSource);
  assert.equal(component["x-forma"].category, "molecule");
  assert.equal(component["x-forma"].renderRoot, "light");
  assert.equal(component["x-forma"].stateful, false);
  assert.deepEqual(component["x-forma"].i18n.authorTextAttributes, ["detail", "label"]);
  assert.deepEqual(component["x-forma"].i18n.invariantValuePaths, ["value"]);
  assert.equal(component.demos[0].url, `/knowledge/design-system#${tag}`);
  assert.match(component.events.find((event) => event.name === "forma-action").type.text, /value:\s*string/);

  assert.match(source, /class FormaUiChoiceCard extends FormaPresentationalElement/);
  assert.match(source, /<button\s+type="button"/);
  assert.match(source, /aria-pressed=\$\{typeof this\.selected === "boolean" \? String\(this\.selected\) : nothing\}/);
  assert.match(source, /emitFormaEvent\(this, "forma-action", \{ value: this\.value \}\)/);
  assert.doesNotMatch(source, /FormaStore|state\/store|fetch\(|\/api\//);
  assert.ok(componentCatalog.some((entry) => entry.tag === tag && entry.level === "molecule"));
  assert.match(catalog, /case "forma-ui-choice-card": return html`<forma-ui-choice-card/);
  assert.match(reference, /## Context creation and reusable choice cards/);
  assert.match(reference, /forma-action: CustomEvent<\{ value: string \}>/);
  assert.match(design, /Reuse `<forma-ui-choice-card>`/);
  assert.match(styles, /\.ui-choice-card\s*\{[\s\S]*?min-block-size:\s*var\(--forma-control-min-size/);
  assert.match(styles, /@media \(forced-colors: active\)[\s\S]*?\.ui-choice-card/);

  for (const messages of [frenchMessages, arabicMessages, japaneseMessages]) {
    assert.ok(messages[`component.${tag}.title`]);
    assert.ok(messages[`component.${tag}.summary`]);
  }
});

test("every document lens distinguishes authored context from reusable project context", async () => {
  const [navigation, shell, workspace, canvas] = await Promise.all([
    read("../src/components/studio-navigation.ts"),
    read("../src/components/forma-shell.ts"),
    read("../src/components/forma-workspace.ts"),
    read("../src/canvas/canvas-application.ts"),
  ]);

  assert.match(navigation, /aria-label="Add context"/);
  assert.match(navigation, /#contextSource:\s*"choose"\s*\|\s*"reuse"/);
  assert.match(navigation, /<forma-ui-choice-card[^>]*?value="create"/);
  assert.match(navigation, /<forma-ui-choice-card[^>]*?value="reuse"/);
  assert.match(navigation, /new CustomEvent\("forma-context-create",\{bubbles:true,composed:true\}\)/);
  assert.match(navigation, /copyLibraryBlockSet/);
  assert.match(navigation, /Add context set/);
  assert.match(shell, /@forma-context-create=\$\{\(\)=>\{if\(isCreative&&canAuthor\)void this\.#openContextComposer\(\);\}\}/);

  assert.match(workspace, /this\.i18n\.system\("Add context"\)/);
  assert.match(workspace, /BLOCK_GROUPS\.map/);
  assert.match(workspace, /class="block-type-grid"[\s\S]*?<forma-ui-choice-card/);
  assert.match(workspace, /@forma-action=\$\{\(\)=>\{draft\.type=option\.type/);

  for (const category of ["document", "context", "output", "reference", "draw", "composite"]) {
    assert.match(canvas, new RegExp(`<forma-ui-choice-card data-add-category="${category}"`));
  }
  assert.match(canvas, /closest<HTMLElement>\("\[data-add-category\]"\)\?\.dataset\.addCategory/);
  assert.match(canvas, /this\.#addKind==="context"\?this\.i18n\.system\("Add context"\)/);
  assert.match(canvas, /<form class="canvas-context-create-form"/);
  assert.match(canvas, /<form class="canvas-context-source-form"/);
});

test("modality-specific context choices keep deliberate adoption, roles, and conversation", async () => {
  const [alternatives, editors, creative, chat] = await Promise.all([
    read("../src/components/forma-studio-alternatives.ts"),
    read("../src/components/forma-studio-editor-alternatives.ts"),
    read("../src/components/forma-creative-editor.ts"),
    read("../src/components/forma-chat-studio.ts"),
  ]);

  assert.match(alternatives, /id="board-capture-title">Add context/);
  assert.match(alternatives, /class="board-context-choice"/);
  assert.match(alternatives, /<form id=\$\{guidedFormId\} @submit=\$\{this\.#saveSection\}><\/form>/);
  assert.match(alternatives, /class="guided-subtype">Starting point/);

  assert.match(editors, /#newTypeSelected=false/);
  assert.match(editors, /if\(!text\|\|!this\.#newTypeSelected\)return/);
  assert.match(editors, /class="block-type-catalog layer-type-catalog"/);
  assert.match(editors, /class="adaptive-choices">\$\{this\.#options\(current\.type\)\.map/);
  assert.match(editors, /@forma-action=\$\{\(\) => this\.#commit\(current\.type/);

  assert.match(creative, /class="creative-quick-tools"[\s\S]*?<forma-ui-choice-card/);
  assert.match(creative, /\.value=\$\{`\$\{tool\.type\}:\$\{tool\.intent\}`\}/);
  assert.match(creative, /#openCreate\(tool\.type, tool\.intent\)/);
  assert.match(creative, /Role in the plan/);
  assert.match(creative, /<span>Intent<\/span>/);

  assert.match(chat, /class="chat-context-starters"/);
  assert.match(chat, /@forma-action=\$\{\(\)=>this\.#prepareContext\(type\)\}/);
  const prepare = chat.match(/#prepareContext\(type: BlockKind\) \{([\s\S]*?)\n {2}\}/)?.[1];
  assert.ok(prepare);
  assert.match(prepare, /if \(!this\.#draft\.trim\(\)\) this\.#draft = this\.i18n\.system\(definition\.prompt\)/);
  assert.match(prepare, /#creative-chat-message/);
  assert.doesNotMatch(prepare, /store\.chat|append\(|BlockCreated/);
  assert.match(chat, /<form class="chat-composer" @submit=\$\{this\.#send\}>/);
});
