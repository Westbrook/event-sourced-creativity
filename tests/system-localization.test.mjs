import assert from "node:assert/strict";
import test from "node:test";
import { html } from "lit";
import { formaSystemMessageId } from "../src/components/design-system/system-message-id.ts";
import { localizeTemplateResult } from "../src/components/design-system/localized-template.ts";
import { localizedDocumentJobProgress, localizedDocumentJobProgressDetail, localizedGenerationFailureGuidance, localizedSourceExtractionMessage } from "../src/components/design-system/localized-runtime-copy.ts";
import { localizedSpatialScopeLabel } from "../src/components/design-system/localized-spatial-scope.ts";
import englishSystemMessages from "../src/components/design-system/locales/system-en.ts";
import frenchMessages from "../src/components/design-system/locales/fr.ts";
import arabicMessages from "../src/components/design-system/locales/ar.ts";
import japaneseMessages from "../src/components/design-system/locales/ja.ts";

const translatedLocale = (translations, locale = "ja") => ({
  locale,
  messages: translations,
  number(value) { return new Intl.NumberFormat(locale).format(value); },
  system(source) { return translations[source] || source; },
});

test("every audited system message has French, Arabic, and Japanese translations", () => {
  assert.ok(Object.keys(englishSystemMessages).length >= 4_700);
  for (const [id, english] of Object.entries(englishSystemMessages)) {
    assert.equal(id, formaSystemMessageId(english), `stable system message identifier for ${english}`);
    for (const [locale, messages] of [["fr", frenchMessages], ["ar", arabicMessages], ["ja", japaneseMessages]]) {
      assert.ok(messages[id]?.trim(), `${locale} translation missing for ${english}`);
    }
  }
  assert.equal(japaneseMessages["context.health.severity.suggestion"], "改善");
  assert.equal(japaneseMessages["context.health.issue.missing-deliverable.label"], "成果物を明確にする");
  for (const kind of ["review_requested", "review_due", "output_edited", "changes_requested", "output_ready", "output_approved", "context_changed"]) {
    for (const messages of [frenchMessages, arabicMessages, japaneseMessages]) {
      assert.ok(messages[`notifications.${kind}.label`]);
      assert.ok(messages[`notifications.${kind}.detail`]);
    }
  }
});

test("static system copy and accessible attributes translate without touching authored values", () => {
  const authored = "Save";
  const callback = () => authored;
  const state = { title: "Save" };
  const template = html`<button class="Save" id="Save" title="Save" aria-label="Close" @click=${callback}>Save ${authored}</button><input placeholder="Search" .value=${authored}><img alt="Preview" src="Save"><a href="/Save">Open</a>${state}`;
  const locale = translatedLocale({ Save: "保存", Close: "閉じる", Search: "検索", Preview: "プレビュー", Open: "開く" });
  const localized = localizeTemplateResult(template, locale);
  const markup = localized.strings.join("EXPRESSION");

  assert.match(markup, /class="Save" id="Save" title="保存" aria-label="閉じる"/);
  assert.match(markup, />保存 EXPRESSION<\/button>/);
  assert.match(markup, /placeholder="検索"/);
  assert.match(markup, /alt="プレビュー" src="Save"/);
  assert.match(markup, /href="\/Save">開く<\/a>/);
  assert.equal(localized.values[0], callback);
  assert.equal(localized.values[1], authored);
  assert.equal(localized.values[2], authored);
  assert.equal(localized.values[3], state);
  assert.notEqual(localized.strings, template.strings);
  assert.ok(Object.isFrozen(localized.strings));
  assert.ok(Object.isFrozen(localized.strings.raw));
});

test("localized templates preserve technical and expressly untranslated regions", () => {
  const template = html`<pre>Save <code>Close</code></pre><code>Save</code><span translate="no">Save</span><svg><title>Save</title></svg><p>Save</p>`;
  const localized = localizeTemplateResult(template, translatedLocale({ Save: "保存", Close: "閉じる" }));
  const markup = localized.strings.join("");
  assert.match(markup, /<pre>Save <code>Close<\/code><\/pre>/);
  assert.match(markup, /<code>Save<\/code>/);
  assert.match(markup, /<span translate="no">Save<\/span>/);
  assert.match(markup, /<svg><title>Save<\/title><\/svg>/);
  assert.match(markup, /<p>保存<\/p>/);
});

test("nested system templates are cached by immutable source and locale catalog", () => {
  const nested = html`<span>Save</span>`;
  const template = html`<main>${[nested, "Save"]}</main>`;
  const japanese = translatedLocale({ Save: "保存" });
  const french = translatedLocale({ Save: "Enregistrer" }, "fr");
  const first = localizeTemplateResult(template, japanese);
  const second = localizeTemplateResult(template, japanese);
  const changed = localizeTemplateResult(template, french);

  assert.equal(first.strings, second.strings, "the same locale reuses Lit's cached static strings");
  assert.equal(first.values[0][0].strings, second.values[0][0].strings);
  assert.notEqual(first.strings, changed.strings, "switching locale invalidates each static template once");
  assert.match(first.values[0][0].strings.join(""), /保存/);
  assert.equal(first.values[0][1], "Save", "an authored value equal to a system phrase stays untouched");
  assert.equal(localizeTemplateResult(template, translatedLocale({}, "en")), template);
});

test("translated static markup is safely escaped and message identifiers normalize whitespace", () => {
  const localized = localizeTemplateResult(html`<p title="Save">Save</p>`, translatedLocale({ Save: '<safe & "quoted">' }));
  const markup = localized.strings.join("");
  assert.match(markup, /title="&lt;safe &amp; &quot;quoted&quot;&gt;"/);
  assert.match(markup, />&lt;safe &amp; "quoted"&gt;<\/p>/);
  assert.equal(formaSystemMessageId("  Save\n now  "), formaSystemMessageId("Save now"));
});

test("punctuation-bounded system copy translates without changing authored project names or routes",()=>{
  const authored="My English Project";
  const template=html`<span>${authored} / Document view</span><a href="/documents">Open</a>`;
  const localized=localizeTemplateResult(template,translatedLocale({"Document view":"ドキュメント表示",Open:"開く"}));
  assert.match(localized.strings.join("EXPRESSION"),/EXPRESSION \/ ドキュメント表示/);
  assert.match(localized.strings.join(""),/href="\/documents">開く/);
  assert.equal(localized.values[0],authored);
});

test("runtime localization preserves unknown authored placeholders and interpolates known system messages",async()=>{
  const previousElement=globalThis.HTMLElement;
  const previousRegistry=globalThis.customElements;
  globalThis.HTMLElement=class extends EventTarget{};
  globalThis.customElements={get(){return undefined;},define(){}};
  try{
    const {FormaLocaleController}=await import("../src/components/design-system/localization.ts");
    const snapshot={locale:"ja",formatLocale:"ja-JP",direction:"ltr",timeZone:"UTC",messages:japaneseMessages,revision:1};
    const controller=new FormaLocaleController({addController(){},requestUpdate(){},dispatchEvent(event){event.callback(snapshot,()=>{});return true;}});
    controller.hostConnected();
    const authored="Customer {private} evidence";
    assert.equal(controller.system(authored),authored);
    const opening=controller.system("Opening {name}…",{name:authored});
    assert.equal(opening,japaneseMessages[formaSystemMessageId("Opening {name}…")].replace("{name}",authored));
    assert.match(opening,/Customer \{private\} evidence/);
    controller.hostDisconnected();
  }finally{
    if(previousElement===undefined)delete globalThis.HTMLElement;else globalThis.HTMLElement=previousElement;
    if(previousRegistry===undefined)delete globalThis.customElements;else globalThis.customElements=previousRegistry;
  }
});

test("background progress, failures, and source extraction translate without exposing provider details",()=>{
  const japanese={
    locale:"ja-JP",
    messages:japaneseMessages,
    number(value){return new Intl.NumberFormat("ja-JP").format(value);},
    t(id,fallback="",values={}){return(japaneseMessages[id]??fallback).replace(/\{(\w+)\}/g,(_,name)=>String(values[name]??""));},
    system(source,values={}){return(japaneseMessages[formaSystemMessageId(source)]??source).replace(/\{(\w+)\}/g,(_,name)=>String(values[name]??""));},
  };
  const job={stage:"rendering",status:"running",kind:"render_document",progressMessage:"Rendering scene 2 of 5",result:{artifactKind:"video"}};
  assert.equal(localizedDocumentJobProgress(job,japanese),japanese.t("job.progress.detail.renderingScene","",{count:"2",total:"5"}));
  assert.equal(job.progressMessage,"Rendering scene 2 of 5","canonical provider progress remains unchanged");
  assert.equal(localizedDocumentJobProgressDetail("43% reported by the provider",job,japanese),japanese.t("job.progress.detail.providerPercent","",{percent:"43"}));

  const privateError="private-provider-debug-secret";
  const failure=localizedGenerationFailureGuidance({title:"Generation failed",summary:privateError,actionLabel:"Try again"},{message:privateError},privateError,japanese);
  assert.doesNotMatch(failure.summary,/private-provider-debug-secret/);

  const extraction={sourceKind:"presentation",status:"ready",message:"2 slides extracted",segments:[{},{}],truncated:false};
  assert.equal(localizedSourceExtractionMessage(extraction,japanese),japanese.t("source.extraction.ready.slides","",{count:"2"}));
  assert.equal(extraction.message,"2 slides extracted","retained source-extraction receipts remain unchanged");
});

test("spatial scope localization preserves authored areas and subject names exactly", () => {
  const japanese = translatedLocale({ "Whole document": "ドキュメント全体", "right area": "右側", around: "周囲" });
  assert.equal(localizedSpatialScopeLabel({ kind: "document" }, japanese), "ドキュメント全体");
  assert.equal(localizedSpatialScopeLabel({ kind: "region", region: "right" }, japanese), "右側");
  assert.equal(localizedSpatialScopeLabel({ kind: "region", region: "custom", instruction: "Whole document" }, japanese), "Whole document");
  assert.equal(localizedSpatialScopeLabel({ kind: "subject", subject_relation: "around" }, japanese, "Save"), "Saveの周囲");
});
