import assert from "node:assert/strict";
import test from "node:test";
import { FORMA_SUPPORTED_LOCALES } from "../src/components/design-system/language-options.ts";
import { SELECTED_OUTPUT_SHARE_MESSAGES, selectedOutputShareCopy,
  selectedOutputShareExpiryLabel } from "../src/components/selected-output-share-messages.ts";

test("sharing copy covers every canonical locale and retains the same output identities", () => {
  assert.deepEqual(Object.keys(SELECTED_OUTPUT_SHARE_MESSAGES).sort(), FORMA_SUPPORTED_LOCALES.map(value => value.locale).sort());
  const keys = Object.keys(SELECTED_OUTPUT_SHARE_MESSAGES.en).sort();
  for (const { locale } of FORMA_SUPPORTED_LOCALES) {
    const copy = selectedOutputShareCopy(locale);
    assert.deepEqual(Object.keys(copy).sort(), keys);
    assert.notEqual(copy.manageLinks, copy.shareOutput, `${locale}: managing retained links is distinct from sharing an output`);
    assert.notEqual(copy.manageLinks, copy.publishLink, `${locale}: managing retained links does not imply publication`);
    assert.deepEqual(Object.keys(copy.outputKinds).sort(), ["audio", "model3d", "scene", "short_story", "slides", "video"]);
    assert.notEqual(copy.loadFile, copy.downloadFile, `${locale}: loading preview and downloading a file are distinct actions`);
    assert.notEqual(copy.watermarkDeclared, copy.watermarkUndeclared, `${locale}: a source declaration never implies detection or absence`);
    for (const [name, value] of Object.entries(copy)) {
      if (name === "outputKinds") continue;
      assert.equal(typeof value, "string"); assert(value.trim(), `${locale}:${name}`);
      assert.deepEqual(value.match(/\{[^}]+\}/gu) ?? [], name === "expiresAt" ? ["{date}"] : [], `${locale}:${name}`);
    }
    for (const label of Object.values(copy.outputKinds)) assert(label.trim());
    assert(Object.isFrozen(copy) && Object.isFrozen(copy.outputKinds));
    assert.throws(() => { copy.outputKinds.short_story = "Changed"; }, TypeError);
  }
  assert(Object.isFrozen(SELECTED_OUTPUT_SHARE_MESSAGES));
});

test("saved regional locale values select supported copy without exposing prototype properties", () => {
  for (const [value, expected] of [["en-US", "en"], [" fr-CA ", "fr"], ["FR_fr", "fr"],
    ["ja-JP", "ja"], ["JA_jp", "ja"], ["ar-EG", "ar"], ["AR_sa", "ar"],
    ["", "en"], ["de-DE", "en"], ["toString", "en"], ["__proto__", "en"]]) {
    assert.equal(selectedOutputShareCopy(value), SELECTED_OUTPUT_SHARE_MESSAGES[expected]);
  }
  assert.equal(selectedOutputShareCopy("unsupported").manageLinks, "Manage links");
});

test("every translated expiry label preserves a literal supplied date exactly once", () => {
  const dates = ["17 septembre 2026 à 14:05", "٢٠٢٦/٩/١٧ ١٤:٠٥", "2026年9月17日 14:05",
    "$& $1 $$ {date} <time>literal</time> 日本語 العربية"];
  for (const { locale } of FORMA_SUPPORTED_LOCALES) for (const date of dates) {
    const label = selectedOutputShareExpiryLabel(locale, date);
    assert.equal(label.split(date).length, 2, "the entire parameter is inserted literally once");
    assert.equal(label.length, selectedOutputShareCopy(locale).expiresAt.length - "{date}".length + date.length);
    assert.equal(selectedOutputShareCopy(locale).expiresAt.includes("{date}"), true, "formatting cannot consume the shared template");
  }
});
