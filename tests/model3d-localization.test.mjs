import assert from "node:assert/strict";
import test from "node:test";
import { validateModel3dRequest } from "../src/model/model3d.ts";
import { generationFailureGuidance } from "../src/model/document-jobs.ts";
import { localizedModel3dValidationIssue } from "../src/components/design-system/localized-model3d.ts";
import { localizedGenerationFailureGuidance } from "../src/components/design-system/localized-runtime-copy.ts";
import { FORMA_MODEL3D_MESSAGES } from "../src/components/design-system/locales/model3d-messages.ts";
import french from "../src/components/design-system/locales/fr.ts";
import japanese from "../src/components/design-system/locales/ja.ts";
import arabic from "../src/components/design-system/locales/ar.ts";

const catalogs = { fr: french, ja: japanese, ar: arabic };
const systemIds = new Map(Object.entries(FORMA_MODEL3D_MESSAGES.en).map(([id, copy]) => [copy, id]));
const localizer = (locale) => ({
  locale,
  messages: catalogs[locale],
  number(value) { return new Intl.NumberFormat(locale).format(value); },
  t(id, fallback = "", values = {}) {
    return (catalogs[locale][id] ?? fallback).replace(/\{(\w+)\}/gu, (_, name) => String(values[name] ?? ""));
  },
  system(source, values = {}) { return this.t(systemIds.get(source) ?? "", source, values); },
});

test("overlength 3D guidance uses localized Unicode character counts and leaves the receipt unchanged", () => {
  const checked = validateModel3dRequest({ prompt: "😀".repeat(1025) });
  const issue = checked.issues.find((entry) => entry.code === "model3d_prompt_too_long");
  assert.ok(issue);
  const retained = structuredClone(issue);
  for (const locale of Object.keys(catalogs)) {
    const translator = localizer(locale);
    const copy = localizedModel3dValidationIssue(issue, translator);
    assert.ok(copy.includes(translator.number(1025)), `${locale}: actual Unicode character count`);
    assert.ok(copy.includes(translator.number(1024)), `${locale}: provider limit`);
    assert.notEqual(copy, issue.message);
    assert.doesNotMatch(copy, /\{(?:count|limit)\}/u);
  }
  assert.deepEqual(issue, retained);
});

test("3D setting guidance translates known field names and preserves an unsupported parameter name", () => {
  const checked = validateModel3dRequest({ prompt: "A chair", settings: { tier: "unsupported", unsupported_parameter: true } });
  const enumIssue = checked.issues.find((entry) => entry.code === "model3d_setting_enum_invalid");
  const unsupported = checked.issues.find((entry) => entry.code === "model3d_setting_unsupported");
  assert.ok(enumIssue);
  assert.ok(unsupported);
  for (const locale of Object.keys(catalogs)) {
    const translator = localizer(locale);
    assert.ok(localizedModel3dValidationIssue(enumIssue, translator).includes(catalogs[locale]["model3d.field.tier"]));
    assert.ok(localizedModel3dValidationIssue(unsupported, translator).includes("unsupported_parameter"));
    const unknown = localizedModel3dValidationIssue({ code: "unknown_provider_error", field: "provider", message: "private-debug-details" }, translator);
    assert.equal(unknown, catalogs[locale]["model3d.validation.unknown"]);
    assert.doesNotMatch(unknown, /private-debug-details/u);
  }
});

test("paid 3D preflight warnings resolve to complete supported-locale guidance", () => {
  const warnings = new Set([
    ...validateModel3dRequest({ prompt: "A chair", settings: { tier: "Gen-2.5-Minimum", quality_mesh_option: "4K Quad", geometry_file_format: "obj", material: "None", addons: { high_pack: true } } }).warnings,
    ...validateModel3dRequest({ prompt: "", referenceCount: 1 }).warnings,
  ]);
  assert.ok(warnings.size >= 5);
  for (const warning of warnings) {
    const id = Object.entries(FORMA_MODEL3D_MESSAGES.en).find(([, english]) => english === warning)?.[0];
    assert.ok(id, `uncatalogued preflight warning: ${warning}`);
    for (const [locale, catalog] of Object.entries(catalogs)) {
      assert.ok(catalog[id]?.trim(), `${locale}: missing ${id}`);
      assert.notEqual(catalog[id], warning, `${locale}: untranslated ${id}`);
    }
  }
});

test("3D failure guidance translates provider outcomes without changing retry or billing actions", () => {
  const cases = [
    { category: "safety" },
    { code: "model3d_prompt_too_long" },
    { category: "authentication" },
    { category: "quota" },
    { httpStatus: 422 },
    { category: "rate_limit", retryAfterMs: 31000 },
    { category: "rate_limit" },
    { code: "model3d_recovery", retryable: true, confirmed: true },
  ];
  for (const { confirmed, ...changes } of cases) {
    const detail = { code: "model3d_failed", category: "server", scope: "request", action: "review", message: "private-provider-details", retryable: false, retryAfterMs: null, requestId: "request-3d", httpStatus: null, ...changes };
    const job = { kind: "render_document", status: "failed", stage: "rendering", result: { artifactKind: "model3d", ...(confirmed ? { model3dProviderSubmission: "confirmed", providerJobId: "confirmed-request" } : {}) } };
    const guidance = generationFailureGuidance(detail, "", job);
    const retained = structuredClone(guidance);
    for (const locale of Object.keys(catalogs)) {
      const translated = localizedGenerationFailureGuidance(guidance, detail, detail.message, localizer(locale));
      assert.notEqual(translated.title, guidance.title, `${locale}: ${guidance.title}`);
      assert.notEqual(translated.summary, guidance.summary, `${locale}: ${guidance.summary}`);
      assert.equal(translated.retryAllowed, guidance.retryAllowed);
      assert.equal(translated.actionUrl, guidance.actionUrl);
      assert.doesNotMatch(translated.summary, /private-provider-details/u);
      if (guidance.actionLabel) assert.notEqual(translated.actionLabel, guidance.actionLabel);
      if (detail.retryAfterMs) assert.ok(translated.summary.includes(localizer(locale).number(31)));
    }
    assert.deepEqual(guidance, retained);
  }
});
