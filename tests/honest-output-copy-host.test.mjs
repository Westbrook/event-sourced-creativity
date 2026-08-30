import assert from "node:assert/strict";
import test from "node:test";
import { currentPage, targetId } from "./helpers/context-structured-source-fixture.mjs";
import { createCalmFullPage, calmFullPageNativePorts, fullPageTree } from "./helpers/calm-full-page-fixture.mjs";
import { generationBudgetGate } from "../src/model/generation-budget.ts";

// Complete existing Store/Worker fixture for authored input. Actual component
// templates and native-control ports for labels; no browser/CSS/AT certificate.
// No generation, export, recovery, retry, Stop or document-job Dismiss is invoked.
const previousFetch = globalThis.fetch;
let externalCalls = 0;
globalThis.fetch = async () => { externalCalls++; throw new Error("External/provider requests are forbidden in honest-output-copy tests."); };
test.after(() => { try { assert.equal(externalCalls, 0); } finally { globalThis.fetch = previousFetch; } });

const expected = {
  "en": {
    "reservation": "Failure does not prove that no cost was incurred. A reservation can remain held while provider acceptance or final cost is unconfirmed. Check the original receipt.",
    "narrative": "Audio transcript, lyrics, and direction",
    "section": "Audio section",
    "guidance": "Edits change only this reusable text, not the original recording. Saving does not generate audio or enable provider audio transfer."
  },
  "fr": {
    "reservation": "Un échec ne prouve pas l’absence de frais. Une réservation peut rester bloquée tant que l’acceptation par le fournisseur ou le coût final n’est pas confirmé. Consultez le reçu d’origine.",
    "narrative": "Transcription, paroles et direction audio",
    "section": "Section audio",
    "guidance": "Les modifications portent uniquement sur ce texte réutilisable, pas sur l’enregistrement d’origine. Enregistrer ne génère pas d’audio et n’active pas son transfert à un fournisseur."
  },
  "ar": {
    "reservation": "الفشل لا يثبت عدم ترتّب تكلفة. قد يبقى الحجز قائمًا ما دام قبول المزوّد أو التكلفة النهائية غير مؤكّد. راجع الإيصال الأصلي.",
    "narrative": "النص المفرّغ والكلمات والتوجيه الصوتي",
    "section": "قسم صوتي",
    "guidance": "تغيّر التعديلات هذا النص القابل لإعادة الاستخدام فقط، لا التسجيل الأصلي. لا يؤدي الحفظ إلى توليد صوت أو تفعيل نقله إلى مزوّد."
  },
  "ja": {
    "reservation": "失敗しても費用が発生していないとは限りません。プロバイダーの受付または最終費用が未確認の場合、予約枠が確保されたままになることがあります。元の処理記録を確認してください。",
    "narrative": "音声の文字起こし、歌詞、制作指示",
    "section": "音声セクション",
    "guidance": "編集されるのは再利用するテキストだけで、元の録音は変わりません。保存しても音声は生成されず、プロバイダーへの音声転送も有効になりません。"
  }
};
const locales = ["en", "fr", "ar", "ja"];
const normalize = value => String(value).replace(/\s+/gu, " ").trim();
const classHas = (node, name) => String(node.attributes.class ?? "").split(/\s/u).includes(name);
const blockFor = x => x.f.store.projection.get().libraryBlocks.find(block => block.id === targetId);
const immutableKeys = ["source_artifact_id", "source_artifact_kind", "source_document_id",
  "source_artifact_content_ref", "source_artifact_input_ref", "media_url", "media_type",
  "provider", "model_id", "source_content_hash", "duration_seconds", "audio_role",
  "inform_generation", "include_in_output", "allow_provider_audio_transfer"];
const retainedIdentity = block => Object.fromEntries(immutableKeys.map(key => [key, block.properties[key]]));
const financial = f => Object.fromEntries(["document_jobs", "budget_counters", "budget_reservations",
  "cost_budget_counters", "cost_budget_reservations"].map(table => [table, f.storeHost.worker.sqlite.prepare("SELECT * FROM " + table).all()]));

// Reuse the existing template renderer, not a copied component implementation.
// The detached public component uses the original Store/locale. No handler is
// replaced; unknown descendant components are not claimed as rendered evidence.
function inspectDetached(f, Constructor, props, inspect) {
  const previousRenderer = f.renderer;
  const renderer = new previousRenderer.constructor(f, previousRenderer.registry);
  calmFullPageNativePorts.bindFixture(f);
  const host = new Constructor();
  Object.assign(host, props);
  host.attributes = {};
  f.renderer = renderer;
  try {
    renderer.draw(host);
    return inspect({ host, renderer, view: { ...f, host, renderer } });
  } finally {
    for (const { instance } of renderer.instances.values()) {
      instance.isConnected = false; instance.disconnectedCallback();
    }
    host.isConnected = false; host.disconnectedCallback();
    f.renderer = previousRenderer;
    calmFullPageNativePorts.bindFixture(f);
  }
}

function assertAudioLabels(tree, child, rich, copy) {
  assert.ok(rich?.isConnected);
  assert.equal(rich.label, copy.narrative);
  const renderedLabel = tree.nodes.find(row => row.owner === rich && row.tag === "label" && classHas(row, "ui-rich-text-label"));
  assert.ok(renderedLabel, "the current rich-text label is actually rendered");
  assert.equal(normalize(renderedLabel.text), copy.narrative);
  const guidance = tree.nodes.find(row => row.owner === child && row.tag === "p" && row.parent?.tag === "div" && row.parent.parent?.tag === "header");
  assert.ok(guidance);
  assert.equal(normalize(guidance.text), copy.guidance);
  const legends = tree.nodes.filter(row => row.owner === child && row.tag === "legend");
  assert.equal(legends.length, 2);
  for (const [index, legend] of legends.entries()) {
    assert.ok(normalize(legend.text).startsWith(copy.section + " " + (index + 1)), "actual item legend names Audio, not Story or Video");
  }
}

for (const locale of locales) test("honest output copy: " + locale + " adopted Audio labels and saved text preserve the recording", async t => {
  const x = await currentPage(t, locale, {
    source_artifact_kind: "audio", source_document_id: "original-audio-document",
    source_artifact_content_ref: "original-audio-content", source_artifact_input_ref: "original-audio-input",
    media_url: "/api/media/original-recording.wav", media_type: "audio/wav",
    provider: "retained-provider", model_id: "retained-audio-model", source_content_hash: "original-recording-sha",
    duration_seconds: 19, audio_role: "score",
    inform_generation: false, include_in_output: false, allow_provider_audio_transfer: false,
    label: "Authored Audio title — العربية 日本語", artifact_markdown: "Original authored Audio transcript.",
    artifact_structure: { presentation: null, items: [
      { source_artifact_item_id: "original-audio-part-1", title: "Opening", body: "Original words 1", notes: "Original cue 1", image_prompt: "", context_group_ids: [], slide: null },
      { source_artifact_item_id: "original-audio-part-2", title: "Closing", body: "Original words 2", notes: "Original cue 2", image_prompt: "", context_group_ids: [], slide: null },
    ] },
  }, { blockType: "audio" });
  const identity = retainedIdentity(blockFor(x)), original = structuredClone(x.child().draft), Editor = x.child().constructor;
  assert.equal(original.kind, "audio");
  assert.equal(blockFor(x).type, "audio", "the actual Worker admitted an Audio block, not media on a different block type");
  assertAudioLabels(x.f.tree(), x.child(), x.child().querySelector("forma-ui-rich-text"), expected[locale]);
  assert.equal(x.child().draft.title, "Authored Audio title — العربية 日本語", "authored text is not translated");

  // Actual existing text-input handler and Store/Worker authoring boundary.
  // The fixture has no generated recording bytes; retained media identity,
  // provider-transfer flags and every financial/job row are the assertions.
  const text = "Revised authored Audio transcript — " + locale + " — العربية 日本語";
  await x.input("markdown", text);
  await x.saveVisible();
  assert.equal(x.state().markdown, text);
  assert.deepEqual(retainedIdentity(blockFor(x)), identity);
  assert.deepEqual(x.financial(), x.financialBefore);
  assert.equal(x.state().items.length, original.items.length);
  for (const key of ["inform_generation", "include_in_output", "allow_provider_audio_transfer"]) assert.equal(blockFor(x).properties[key], false);
  x.unchangedAuthority();

  inspectDetached(x.f, Editor, {
    tag: "forma-output-input-editor", standalone: true, block: structuredClone(blockFor(x)),
  }, ({ host, renderer, view }) => {
    assertAudioLabels(fullPageTree(view), host, renderer.component("forma-ui-rich-text"), expected[locale]);
    assert.deepEqual(host.draft, x.state(), "standalone and embedded labels describe the same saved input");
    assert.equal(renderer.ownNodes(host, "form").length, 1);
  });
  assert.deepEqual(retainedIdentity(blockFor(x)), identity);
  assert.deepEqual(x.financial(), x.financialBefore);
  assert.equal(externalCalls, 0);
});

for (const locale of locales) test("honest output copy: " + locale + " existing non-Audio family names stay unchanged", async t => {
  const x = await currentPage(t, locale);
  const before = structuredClone(x.f.store.events.get()), money = x.financial(), start = x.host.requests.length;
  const names = { short_story: "Story manuscript", scene: "Scene and dialogue", storyboard: "Storyboard narrative",
    slides: "Presentation narrative", video: "Video direction and transcript" };
  for (const [kind, label] of Object.entries(names)) {
    const block = structuredClone(blockFor(x));
    block.properties.source_artifact_kind = kind;
    inspectDetached(x.f, x.child().constructor, {
      tag: "forma-output-input-editor", standalone: true, block,
    }, ({ host, renderer, view }) => {
      const rich = renderer.component("forma-ui-rich-text");
      assert.equal(host.draft.kind, kind);
      assert.equal(rich.label, x.f.i18n.system(label));
      const actualLabel = fullPageTree(view).nodes.find(row => row.owner === rich && row.tag === "label" && classHas(row, "ui-rich-text-label"));
      assert.equal(normalize(actualLabel.text), x.f.i18n.system(label));
      assert.equal(host.draft.markdown, x.state().markdown, "copy selection does not transform the authored source");
    });
  }
  assert.deepEqual(x.f.store.events.get(), before);
  assert.deepEqual(x.financial(), money);
  assert.deepEqual(x.host.requests.slice(start).filter(row => (row.init.method ?? "GET") !== "GET"), []);
  assert.equal(externalCalls, 0);
});

for (const locale of locales) test("honest output copy: " + locale + " visible and accessible capacity hints share qualified uncertainty", async t => {
  const f = await createCalmFullPage(t, { locale });
  const { GenerationActions } = await calmFullPageNativePorts.loadActual("src/components/generation-actions.ts");
  const before = structuredClone(f.store.events.get()), money = financial(f), start = f.storeHost.requests.length;
  const originalSession = f.store.session.get();
  for (const band of ["tokens", "cost", "cost-only-blocked"]) {
    const usedMicrousd = band === "tokens" ? 0 : band === "cost" ? 85_000_000 : 100_000_000;
    const usedTokens = band === "cost-only-blocked" ? 0 : 980_000;
    const cost = { limitMicrousd: 100_000_000, usedMicrousd, reservedMicrousd: 0, remainingMicrousd: 100_000_000 - usedMicrousd };
    f.store.session.set({ ...originalSession,
      budgets: { ...originalSession.budgets,
        user: { ...originalSession.budgets.user, limit: 1_000_000, used: usedTokens, reserved: 0 },
        workspace: { ...originalSession.budgets.workspace, limit: 1_000_000, used: usedTokens, reserved: 0 } },
      costBudgets: { period: "synthetic-current-period", currency: "USD", user: { ...cost }, workspace: { ...cost } },
    });
    assert.equal(generationBudgetGate(f.store.session.get().costBudgets, { projectedMicrousd: 1_000_000 }).level,
      band === "tokens" ? "none" : band === "cost" ? "every-generation" : "blocked");
    for (const compact of [true, false]) inspectDetached(f, GenerationActions, {
      tag: "forma-generation-actions", source: "studio", compact,
    }, ({ host, renderer }) => {
      const note = renderer.ownNodes(host, compact ? "span" : "p").find(row => classHas(row, compact ? "sr-only" : "generation-budget-note"));
      assert.ok(note, band + " current " + (compact ? "accessible" : "visible") + " warning is rendered");
      const escaped = expected[locale].reservation.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
      assert.equal(renderer.markup.split(escaped).length - 1, 1, "actual template emits the same qualified localized message exactly once");
      assert.doesNotMatch(renderer.markup, /Failed work releases its (?:unused )?reservation automatically/u);
      if (compact) {
        assert.ok(note.attributes.id);
        const described = renderer.ownNodes(host, "button").filter(row => row.attributes["aria-describedby"] === note.attributes.id);
        assert.ok(described.length >= 2, "disabled draft/full controls retain the exact accessible description target");
        assert.ok(described.every(row => Object.hasOwn(row.attributes, "disabled")));
      } else assert.equal(note.attributes.role, "status");
      assert.equal(host.compact, compact);
    });
  }
  f.store.session.set(originalSession);
  assert.deepEqual(f.store.events.get(), before);
  assert.deepEqual(financial(f), money, "copy rendering cannot release, settle, reserve or create work");
  assert.deepEqual(f.storeHost.requests.slice(start).filter(row => (row.init.method ?? "GET") !== "GET"), []);
  assert.equal(externalCalls, 0);
});
