import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { html } from "lit";
import { formaSystemMessageId } from "../src/components/design-system/system-message-id.ts";
import { localizeTemplateResult } from "../src/components/design-system/localized-template.ts";
import englishMessages from "../src/components/design-system/locales/system-en.ts";
import frenchMessages from "../src/components/design-system/locales/fr.ts";
import arabicMessages from "../src/components/design-system/locales/ar.ts";
import japaneseMessages from "../src/components/design-system/locales/ja.ts";

const contracts = [
  {
    "tag": "forma-ui-popover",
    "className": "FormaUiPopover",
    "member": "content",
    "kind": "field",
    "file": "src/components/design-system/feedback.ts",
    "en": "Authored light-DOM controls keep their native semantics and event handlers.",
    "fr": "Les contrôles fournis dans le DOM léger conservent leur sémantique native et leurs gestionnaires d’événements.",
    "ar": "تحتفظ عناصر التحكم المؤلَّفة في DOM الخفيف بدلالاتها الأصلية ومعالجات أحداثها.",
    "ja": "作成したライトDOMのコントロールは、ネイティブのセマンティクスとイベントハンドラーを保持します。"
  },
  {
    "tag": "forma-ui-popover",
    "className": "FormaUiPopover",
    "member": "close",
    "kind": "method",
    "file": "src/components/design-system/feedback.ts",
    "en": "Close before handing off an action; never queue focus over a newer surface.",
    "fr": "Fermez avant de transmettre une action ; ne programmez jamais un déplacement du focus qui empiète sur une interface plus récente.",
    "ar": "أغلق قبل تمرير الإجراء؛ ولا تجدول نقلًا للتركيز يطغى على واجهة أحدث.",
    "ja": "アクションを引き渡す前に閉じてください。後から開いた画面からフォーカスを奪う処理をキューに登録しないでください。"
  },
  {
    "tag": "forma-project-rail",
    "className": "ProjectRail",
    "member": "willUpdate",
    "kind": "method",
    "file": "src/components/project-rail.ts",
    "en": "Close the rail popover when its navigation scope or panel mode changes.",
    "fr": "Ferme la fenêtre contextuelle du volet de navigation lorsque son périmètre de navigation ou son mode d’affichage change.",
    "ar": "يغلق النافذة المنبثقة لشريط التنقل عند تغيّر نطاق التنقل أو وضع اللوحة.",
    "ja": "ナビゲーションの範囲またはパネルの表示モードが変わったときに、レールのポップオーバーを閉じます。"
  }
];
const manifestSource = readFileSync(new URL("../custom-elements.json", import.meta.url), "utf8");
const manifest = JSON.parse(manifestSource);
const declarations = manifest.modules.flatMap(module => module.declarations ?? []);
const catalogs = { en: englishMessages, fr: frenchMessages, ar: arabicMessages, ja: japaneseMessages };
const publicMember = contract => {
  const declaration = declarations.find(value => value.tagName === contract.tag);
  assert.ok(declaration, contract.tag + " remains in the generated inventory");
  const member = declaration.members.find(value => value.name === contract.member);
  assert.ok(member, contract.member + " remains a documented public API");
  return member;
};

test("generated component API documentation keeps the public manifest identical to its canonical source", () => {
  assert.equal(readFileSync(new URL("../public/custom-elements.json", import.meta.url), "utf8"), manifestSource);
  assert.equal(manifest.schemaVersion, "2.1.0");
});

for (const contract of contracts) test("generated " + contract.tag + "." + contract.member + " documents its own public source contract", () => {
  const source = readFileSync(new URL("../" + contract.file, import.meta.url), "utf8");
  const tree = ts.createSourceFile(contract.file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const declaration = tree.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === contract.className);
  const member = declaration.members.find(node => node.name?.getText(tree) === contract.member);
  assert.ok(member);
  assert.equal(member.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.PrivateKeyword || modifier.kind === ts.SyntaxKind.ProtectedKeyword) ?? false, false);
  assert.equal(member.jsDoc?.at(-1)?.comment, contract.en, "Forma supplies its own accurate JSDoc instead of inherited framework examples");
  const generated = publicMember(contract);
  assert.equal(generated.kind, contract.kind);
  assert.equal(generated.description, contract.en);
  if (contract.member === "content") {
    assert.equal(generated.attribute, undefined, "authored controls remain a JavaScript-only property");
    assert.match(generated.type.text, /TemplateResult/u);
    assert.equal(generated.default, "nothing");
  } else {
    assert.equal(generated.return.type.text, "void");
    assert.deepEqual(generated.parameters ?? [], contract.member === "close" ? [{ name: "returnFocus", type: { text: "boolean" } }] : []);
  }
});

for (const locale of ["en", "fr", "ar", "ja"]) test("actual LocaleController localizes generated native API descriptions in " + locale + " without translating authored controls", async () => {
  // Native registration ports only; execute the complete production localization module.
  const previousElement = globalThis.HTMLElement, previousRegistry = globalThis.customElements;
  globalThis.HTMLElement = class extends EventTarget {};
  globalThis.customElements = { get() { return undefined; }, define() {} };
  let controller;
  try {
    const { FormaLocaleController } = await import("../src/components/design-system/localization.ts");
    controller = new FormaLocaleController({ addController() {}, requestUpdate() {}, dispatchEvent(event) {
      event.callback({ locale, formatLocale: locale, direction: locale === "ar" ? "rtl" : "ltr", timeZone: "UTC",
        messages: catalogs[locale], revision: 1 }, () => {});
      return true;
    } });
    controller.hostConnected();
    for (const contract of contracts) {
      const description = publicMember(contract).description, id = formaSystemMessageId(description);
      assert.equal(englishMessages[id], contract.en);
      assert.equal(catalogs[locale][id], contract[locale]);
      assert.equal(controller.system(description), contract[locale]);
      if (locale !== "en") assert.notEqual(controller.system(description), description);
      const authored = description, action = () => authored;
      const template = html`<button type="button" @click=${action}>${authored}</button><p>${controller.system(description)}</p>`;
      const localized = localizeTemplateResult(template, controller);
      assert.equal(localized.values[0], action, "the native callback stays identical");
      assert.equal(localized.values[1], authored, "an authored value equal to a system description is not translated");
      assert.equal(localized.values[2], contract[locale]);
    }
    assert.equal(JSON.stringify(manifest, null, 2) + "\n", manifestSource, "localization does not rewrite canonical API metadata");
  } finally {
    controller?.hostDisconnected();
    if (previousElement === undefined) delete globalThis.HTMLElement; else globalThis.HTMLElement = previousElement;
    if (previousRegistry === undefined) delete globalThis.customElements; else globalThis.customElements = previousRegistry;
  }
});

test("generated Popover trigger name remains explicitly author-localized text", t => {
  const tag = "forma-ui-popover", name = "triggerAccessibleName", attributeName = "trigger-accessible-name";
  const popover = declarations.find(value => value.tagName === tag);
  assert.ok(popover, "root regenerated the actual component manifest after E2 installation");
  const member = popover.members.find(value => value.name === name);
  const attribute = popover.attributes.find(value => value.name === attributeName);
  assert.ok(member && attribute, "the actual installed public field and attribute are generated, not fabricated here");
  const description = "Optional accessible name for the native trigger; visible text remains unchanged.";
  assert.equal(member.kind, "field"); assert.equal(member.type.text, "string");
  assert.equal(member.attribute, attributeName); assert.equal(member.default, '""');
  assert.equal(member.description, description);
  assert.equal(attribute.fieldName, name); assert.equal(attribute.type.text, "string");
  assert.equal(attribute.description, description);
  const source = readFileSync(new URL("../src/components/design-system/feedback.ts", import.meta.url), "utf8");
  assert.ok(source.includes('triggerAccessibleName: { type: String, attribute: "trigger-accessible-name" }'));
  assert.ok(source.includes("aria-label=" + "$" + "{this.triggerAccessibleName?.trim() || nothing}"));
  const id = formaSystemMessageId(description);
  assert.equal(id, "system.auto.vcfvld.80");
  assert.equal(englishMessages[id], description);
  for (const locale of ["fr", "ar", "ja"]) {
    assert.ok(catalogs[locale][id]);
    assert.notEqual(catalogs[locale][id], description, "the existing E2 documentation companion supplies " + locale);
  }
  const generator = readFileSync(new URL("../scripts/generate-custom-elements-manifest.mjs", import.meta.url), "utf8");
  const sourcePolicy = generator.match(/const authorTextAttributes = new Set\(\[([^\]]+)\]\);/u);
  assert.ok(sourcePolicy, "inspect the existing authored-text inventory, not a replacement metadata system");
  const current = {
    sourceListsAuthorText: sourcePolicy[1].includes(JSON.stringify(attributeName)),
    manifestListsAuthorText: popover["x-forma"].i18n.authorTextAttributes.includes(attributeName),
  };
  t.diagnostic("E2_TRIGGER_NAME_CEM " + JSON.stringify({ tag, name, attributeName, ...current }));
  assert.deepEqual(current, { sourceListsAuthorText: true, manifestListsAuthorText: true },
    "both the existing source policy and its generated manifest must classify the localized native trigger name");
});
