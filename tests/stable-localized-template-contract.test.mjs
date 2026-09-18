import assert from "node:assert/strict";
import test from "node:test";
import { html, noChange, nothing } from "lit";
import { repeat } from "lit/directives/repeat.js";
import { keyed } from "lit/directives/keyed.js";
import { cache } from "lit/directives/cache.js";
import { localizeTemplateResult } from "../src/components/design-system/localized-template.ts";
import { calmFullPageNativePorts as ports } from "./helpers/calm-full-page-fixture.mjs";

const messages = {
  en: { Save: "Save", Close: "Close", Search: "Search", Preview: "Preview", Open: "Open" },
  fr: { Save: "Enregistrer", Close: "Fermer", Search: "Rechercher", Preview: "Aperçu", Open: "Ouvrir" },
  ar: { Save: "حفظ", Close: "إغلاق", Search: "بحث", Preview: "معاينة", Open: "فتح" },
  ja: { Save: "保存", Close: "閉じる", Search: "検索", Preview: "プレビュー", Open: "開く" },
};
const locale = (name, translations = messages[name]) => ({
  locale: name, messages: translations,
  system(source) { return translations[source] ?? source; },
});

// Reuse the existing renderer's text escaping and attribute/reference ports.
// This inspects template/part contracts only, not physical DOM or native focus.
// The original whole Settings retained-B suite remains the form-retention gate.
function inspect(template) {
  const renderer = new ports.RendererPort({}, {});
  const markup = renderer.value(template, null, "localization-contract");
  const element = tag => {
    const matches = [...markup.matchAll(new RegExp("<" + tag + "\\b([^>]*)>", "gu"))];
    assert.equal(matches.length, 1, "one exact " + tag + " contract element");
    return renderer.attrs(matches[0][1]);
  };
  return { markup, element };
}

for (const firstLocale of ["en", "fr", "ar", "ja"]) test("locale-independent structural identity from " + firstLocale + " through every supported locale", () => {
  const authored = "Private Save", callback = () => authored;
  const literal = html`<form title="Save"><label>Search<input .value=${authored}></label><button @click=${callback}>Save</button></form>`;
  // A fresh source identity for each registration proves each first-locale order.
  // The same immutable source is then reused for every render within that case.
  const strings = Object.freeze(Object.defineProperty([...literal.strings], "raw", { value: Object.freeze([...literal.strings.raw]) }));
  const source = { ...literal, strings };
  const first = localizeTemplateResult(source, locale(firstLocale));
  for (const name of ["en", "fr", "ar", "ja", "en"]) {
    const current = localizeTemplateResult(source, locale(name));
    assert.equal(current.strings === first.strings, true, "a locale changes values, never the original Lit template identity");
    assert.equal(current._$litType$, source._$litType$);
    assert.ok(Object.isFrozen(current.strings));
    assert.ok(Object.isFrozen(current.strings.raw));
    const view = inspect(current);
    assert.equal(view.element("form").attributes.title, messages[name].Save);
    assert.equal(view.element("input").properties.value, authored);
    assert.equal(view.element("button").handlers.click, callback);
    assert.ok(view.markup.includes(">" + messages[name].Save + "</button>"));
    assert.ok(view.markup.includes(">" + messages[name].Search + "<input"));
  }
});

test("a missing first translation and English regional locale cannot choose a different later structure", () => {
  const source = html`<p title="Save">Save</p>`;
  const empty = locale("fr", {}), first = localizeTemplateResult(source, empty);
  const translated = localizeTemplateResult(source, locale("ja"));
  const regional = localizeTemplateResult(source, locale("en-US", messages.en));
  assert.equal(translated.strings === first.strings, true);
  assert.equal(regional.strings === first.strings, true);
  assert.equal(inspect(first).element("p").attributes.title, "Save");
  assert.equal(inspect(translated).element("p").attributes.title, "保存");
  empty.messages.Save = "Enregistrer";
  assert.equal(inspect(localizeTemplateResult(source, empty)).element("p").attributes.title, "Enregistrer", "copy is evaluated for the current render, not retained from an earlier catalog");
});

test("every audited quoted accessible attribute localizes while technical and mixed authored attributes keep their exact meaning", () => {
  const authored = 'Private <Save> & "title"';
  const source = html`<section aria-label="Save" aria-description='Close' aria-valuetext="Save" aria-placeholder="Search" title="Save" placeholder="Search" alt="Preview" label="Save" heading="Save" description="Close" class="Save" id="Save" data-example=' title="Save" '><img alt="Preview: ${authored} / Close" src="Save"><a href="/Save">Open</a></section>`;
  for (const name of ["en", "fr", "ar", "ja"]) {
    const translations = { ...messages[name], "Preview:": messages[name].Preview + ":" };
    const view = inspect(localizeTemplateResult(source, locale(name, translations)));
    const attrs = view.element("section").attributes;
    assert.deepEqual(Object.fromEntries(["aria-label", "aria-valuetext", "title", "label", "heading"].map(key => [key, attrs[key]])),
      Object.fromEntries(["aria-label", "aria-valuetext", "title", "label", "heading"].map(key => [key, messages[name].Save])));
    for (const key of ["aria-description", "description"]) assert.equal(attrs[key], messages[name].Close);
    for (const key of ["aria-placeholder", "placeholder"]) assert.equal(attrs[key], messages[name].Search);
    assert.equal(attrs.alt, messages[name].Preview);
    assert.equal(attrs.class, "Save"); assert.equal(attrs.id, "Save"); assert.equal(attrs["data-example"], ' title="Save" ');
    assert.equal(view.element("img").attributes.alt, translations["Preview:"] + " " + authored + " / " + messages[name].Close);
    assert.equal(view.element("img").attributes.src, "Save"); assert.equal(view.element("a").attributes.href, "/Save");
    assert.ok(view.markup.includes(">" + messages[name].Open + "</a>"));
  }
});

test("original callbacks, property values, directive keys and sentinel identities are unchanged and never evaluated by localization", () => {
  const authored = "Save", model = { private: "Save" }, callback = () => authored;
  let rendered = 0, identified = 0;
  const identify = item => { identified += 1; return item.id; };
  const render = () => { rendered += 1; return html`<input .value=${authored}>`; };
  const repeated = repeat([{ id: "exact-original" }], identify, render);
  const key = { original: true }, keyedValue = keyed(key, html`<input .value=${authored}>`);
  const cached = cache(html`<input .value=${authored}>`);
  const source = html`<button title="Save" @click=${callback} .value=${authored} .model=${model} ?disabled=${false} .checked=${noChange}>Save ${authored}</button>${repeated}${keyedValue}${cached}${nothing}`;
  const current = localizeTemplateResult(source, locale("ja"));
  const authoredValues = [callback, authored, model, false, noChange, authored, repeated, keyedValue, cached, nothing];
  assert.deepEqual(current.values.filter(value => authoredValues.includes(value)), authoredValues, "original values retain exact relative order, including repeated authored strings");
  for (const value of [callback, model, noChange, repeated, keyedValue, cached, nothing]) assert.equal(current.values.filter(candidate => candidate === value).length, 1);
  assert.equal(repeated.values[1], identify); assert.equal(repeated.values[2], render); assert.equal(keyedValue.values[0], key);
  assert.equal(identified, 0); assert.equal(rendered, 0);
  assert.deepEqual(source.values, authoredValues, "the original TemplateResult is not mutated");
  const nextModel = { private: "newer" }, nextCallback = () => nextModel;
  const update = { ...source, values: source.values.map(value => value === model ? nextModel : value === callback ? nextCallback : value) };
  const next = localizeTemplateResult(update, locale("fr"));
  assert.equal(next.strings === current.strings, true);
  assert.ok(next.values.includes(nextModel)); assert.ok(next.values.includes(nextCallback));
  assert.equal(next.values.includes(model), false); assert.equal(next.values.includes(callback), false);
  assert.equal(identified, 0); assert.equal(rendered, 0);
});

test("nested templates and repeated localization preserve structure without treating prior translated slots as authored data", () => {
  const authored = "Save", nested = html`<label title="Save">Save<input .value=${authored}></label>`;
  const source = html`<main>Open${[nested, authored]}</main>`;
  const french = localizeTemplateResult(source, locale("fr"));
  const japanese = localizeTemplateResult(french, locale("ja"));
  const direct = localizeTemplateResult(source, locale("ja"));
  const again = localizeTemplateResult(japanese, locale("ja"));
  assert.equal(french.strings === japanese.strings, true); assert.equal(again.strings === direct.strings, true);
  const nestedValue = value => value.values.find(Array.isArray)[0];
  assert.equal(nestedValue(french).strings === nestedValue(japanese).strings, true);
  assert.equal(nestedValue(japanese).strings === nestedValue(direct).strings, true);
  assert.equal(inspect(japanese).markup, inspect(direct).markup); assert.equal(inspect(again).markup, inspect(direct).markup);
  assert.equal(inspect(japanese).element("label").attributes.title, "保存");
  assert.equal(inspect(japanese).element("input").properties.value, authored);
  assert.equal(japanese.values.find(Array.isArray)[1], authored);
});

test("protected regions, textarea default content, comments and technical attributes remain original markup", () => {
  const authored = "Save";
  const source = html`<pre title="Save">\nSave &amp; <code>Close</code></pre><code>Save ${authored}</code><span translate="no" title="Save">Save</span><svg><title>Save</title></svg><script>"Save"</script><style>.Save { color: red; }</style><textarea title="Save">\nSave &amp; Close</textarea><!-- Save --> <p>Save</p>`;
  const localized = localizeTemplateResult(source, locale("ja")), view = inspect(localized);
  for (const fragment of ['<pre title="Save">\nSave &amp; <code>Close</code></pre>', '<code>Save Save</code>', '<span translate="no" title="Save">Save</span>', '<svg><title>Save</title></svg>', '<script>"Save"</script>', '<style>.Save { color: red; }</style>', '<!-- Save -->']) assert.ok(view.markup.includes(fragment), fragment);
  assert.equal(view.element("textarea").attributes.title, "保存");
  assert.ok(view.markup.includes(">\nSave &amp; Close</textarea>"), "the native textarea initial-LF and default-content parsing remain in static HTML");
  assert.ok(view.markup.includes("<p>保存</p>"));
  assert.ok(localized.values.includes(authored));
  assert.equal(localizeTemplateResult(source, locale("en")).strings === localized.strings, true);
});

test("translator markup and quote characters remain safe text and attribute values, never new HTML", () => {
  const translated = '<img src="bad" onerror="bad()"> & "quoted"';
  const source = html`<p title="Save">Save</p>`;
  const current = localizeTemplateResult(source, locale("ja", { Save: translated }));
  const view = inspect(current);
  assert.equal(view.element("p").attributes.title, translated);
  assert.doesNotMatch(view.markup, /<img\b/u);
  assert.match(view.markup, /&lt;img src="bad" onerror="bad\(\)"&gt; &amp; "quoted"/u);
  assert.equal(current.strings.join("").includes(translated), false, "translator content never enters the structural template");
});

test("static whitespace, punctuation boundaries and authored text keep exact separate meanings", () => {
  const authored = "My English Project";
  const source = html`<p>\n  Save\t </p><span>${authored} / Document view</span><small>Document view — </small><b>\u00a0Save\u00a0</b>`;
  const current = localizeTemplateResult(source, locale("ja", { Save: "保存", "Document view": "ドキュメント表示" }));
  const view = inspect(current);
  assert.ok(view.markup.includes("<p>\n  保存\t </p>"));
  assert.ok(view.markup.includes("<span>My English Project / ドキュメント表示</span>"));
  assert.ok(view.markup.includes("<small>ドキュメント表示 — </small>"));
  assert.ok(view.markup.includes("<b>\u00a0保存\u00a0</b>"));
  assert.ok(current.values.includes(authored));
});

test("audited HTML entities preserve DOM character meaning before localization, including numeric replacements and nonbreaking spaces", () => {
  const calls = [], decoded = 'A & < > " \' B\u00a0C 😀 € � � �';
  const source = html`<p title="Save &amp; Close">Save &amp; Close</p><small>A &amp; &lt; &gt; &quot; &apos; B&nbsp;C &#x1f600; &#128; &#0; &#xD800; &#x110000;</small>`;
  const current = localizeTemplateResult(source, { locale: "fr", messages: {}, system(value) {
    calls.push(value); return value === "Save & Close" ? "Enregistrer & fermer" : value;
  } });
  const view = inspect(current);
  assert.equal(view.element("p").attributes.title, "Enregistrer & fermer");
  assert.ok(view.markup.includes("<p title=")); assert.ok(view.markup.includes(">Enregistrer &amp; fermer</p>"));
  assert.ok(calls.includes(decoded), "the translator sees decoded characters without NBSP normalization");
  assert.ok(current.values.includes(decoded), "the untranslated original has the same DOM characters as its static HTML");
  assert.equal(current.values.some(value => typeof value === "string" && value.includes("&amp;")), false, "static entities are not double escaped in a dynamic text value");
});

test("unsupported named entities and unquoted copy remain static rather than guessed or reparsed", () => {
  const source = html`<p title=Save>Save &copy; Close</p><span>Save</span><small title="A &notit; B">A &notit; B</small>`;
  const current = localizeTemplateResult(source, locale("ja")), view = inspect(current);
  assert.ok(current.strings.join("").includes('<p title=Save>Save &copy; Close</p>'));
  assert.ok(current.strings.join("").includes('<small title="A &notit; B">A &notit; B</small>'));
  assert.ok(view.markup.includes("<span>保存</span>"));
  assert.equal(localizeTemplateResult(source, locale("en")).strings === current.strings, true);
});

test("literal marker-looking application text cannot absorb an original authored expression", () => {
  const authored = { original: "private" };
  const source = html`<p>\uE000forma-slot-0\uE001 Save</p>${authored}`;
  const current = localizeTemplateResult(source, locale("ja"));
  assert.equal(current.values.filter(value => value === authored).length, 1);
  assert.ok(inspect(current).markup.includes("\uE000forma-slot-0\uE001 Save"));
  assert.equal(localizeTemplateResult(source, locale("fr")).strings === current.strings, true);
});

for (const name of ["en", "en-GB"]) test("English copy remains original even when " + name + " system would translate it", () => {
  const authored = "Save", nested = html`<label>Save</label>`;
  const source = html`<p title="Save">Save ${authored}</p>${[nested]}`;
  let calls = 0;
  const english = { locale: name, messages: { Save: "Not English" }, system() { calls += 1; return "Not English"; } };
  const first = localizeTemplateResult(source, english);
  assert.equal(calls, 0, "English preserves the old system-copy bypass, not a catalog-controlled translation");
  const firstView = inspect(first);
  assert.equal(firstView.element("p").attributes.title, "Save");
  assert.ok(firstView.markup.includes(">Save Save</p>"));
  assert.ok(firstView.markup.includes("<label>Save</label>"));
  const japanese = localizeTemplateResult(source, locale("ja"));
  const back = localizeTemplateResult(japanese, english);
  assert.equal(calls, 0);
  assert.equal(first.strings === japanese.strings, true);
  assert.equal(back.strings === first.strings, true);
  assert.equal(inspect(back).markup, firstView.markup);
});

test("literal NUL keeps its original static text and attribute parsing, separately from numeric references", () => {
  const source = html`<p title="A\0B">A\0B</p><small>Save</small>`;
  const japanese = localizeTemplateResult(source, locale("ja"));
  assert.ok(japanese.strings.join("").includes('<p title="A\0B">A\0B</p>'), "context-specific native NUL parsing is not replaced by a guessed common character");
  assert.equal(japanese.values.some(value => typeof value === "string" && value.includes("A\ufffdB")), false);
  assert.ok(inspect(japanese).markup.includes("<small>保存</small>"));
  assert.equal(localizeTemplateResult(source, locale("en")).strings === japanese.strings, true);
});

test("textarea authored properties and body values are unchanged while accessible copy relocalizes", () => {
  const authored = 'Save </textarea> & "private"';
  const source = html`<textarea title="Save" .value=${authored} .checked=${noChange}>${authored}</textarea>`;
  const japanese = localizeTemplateResult(source, locale("ja")), view = inspect(japanese);
  assert.equal(view.element("textarea").attributes.title, "保存");
  assert.equal(view.element("textarea").properties.value, authored);
  assert.equal(view.element("textarea").properties.checked, noChange);
  assert.ok(view.markup.includes('Save &lt;/textarea&gt; &amp; "private"</textarea>'));
  assert.deepEqual(japanese.values.filter(value => value === authored || value === noChange), [authored, noChange, authored]);
  assert.equal(localizeTemplateResult(source, locale("en")).strings === japanese.strings, true);
});

test("authored array properties preserve exact references and fresh rerenders never reuse old caller values", () => {
  const row = { role: "user", text: "Save" }, rows = [row, "Save", NaN], colors = [["Save", "#123456"]];
  const source = html`<div .messages=${rows} .colors=${colors}>Save</div>`;
  let structural;
  for (const name of ["en", "fr", "ar", "ja"]) {
    const current = localizeTemplateResult(source, locale(name));
    structural ??= current.strings;
    assert.equal(current.strings === structural, true);
    const properties = inspect(current).element("div").properties;
    assert.equal(properties.messages === rows, true, "an authored array is not copied merely to localize adjacent system copy");
    assert.equal(properties.colors === colors, true); assert.equal(properties.colors[0], colors[0]);
    assert.equal(properties.messages[0], row); assert.equal(properties.messages[1], "Save");
    assert.equal(Number.isNaN(properties.messages[2]), true, "unchanged NaN stays in the exact original authored array");
  }
  const newerRows = [{ role: "user", text: "newer private value" }];
  const next = localizeTemplateResult({ ...source, values: [newerRows, colors] }, locale("ja"));
  assert.equal(inspect(next).element("div").properties.messages, newerRows);
  assert.equal(inspect(next).element("div").properties.colors, colors);
  assert.equal(source.values[0], rows); assert.equal(source.values[1], colors);
});

test("an array containing a real nested template changes only the localized entries", () => {
  const authored = ["Save", { private: true }], nested = html`<span>Save</span>`;
  const original = [nested, authored];
  const french = localizeTemplateResult(original, locale("fr"));
  assert.equal(french === original, false, "a translated nested template requires a new array value");
  assert.equal(french[0] === nested, false); assert.equal(french[1], authored);
  assert.equal(original[0], nested); assert.equal(original[1], authored);
  assert.equal(inspect(french[0]).markup, "<span>Enregistrer</span>");
  const japanese = localizeTemplateResult(french, locale("ja"));
  assert.equal(japanese[0].strings === french[0].strings, true);
  assert.equal(japanese[1], authored); assert.equal(inspect(japanese[0]).markup, "<span>保存</span>");
});
