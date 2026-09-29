// Explicitly synthetic. This module imports no store and makes no API/provider requests.
import "/src/components/forma-output-requirement-card.ts";
import { parseOutputRequirement } from "/src/model/output-requirements.ts";
import { setFormaLocale, currentFormaLocale, formaLocaleFamily } from "/src/components/design-system/localization.ts";
import { FORMA_OUTPUT_REQUIREMENT_MESSAGES } from "/src/components/design-system/locales/output-requirement-messages.ts";

const examples = {
  executive: {
    label: "Executive summary",
    content: "1 slideshow with 5-15 slides, one podcast episode outlining the document, a series of TickTok style videos outlining the various parts of the document.",
  },
  image: {
    label: "Social media image",
    content: 'Output images at aspect ratios "1:1" Instagram and other carousels, "4:5" Meta at large, "9:16" shorts, reels, and TickTok, "16:9" YouTube recommendation thumbnails, "1.91:1" Facebook and X link preview cards',
  },
  video: {
    label: "Social media video",
    content: 'Output videos at aspect ratios "9:16" for TickTok, "16:9" for YouTube, "4:5" for Facebook/Instagram feeds, and "1:1" optionally for additional Facebook usage.',
  },
};
const full = document.querySelector("#fixture-full");
const compact = document.querySelector("#fixture-compact");
const cards = [full, compact];
const parameters = new URLSearchParams(location.search);
const locale = ["en", "fr", "ar", "ja"].includes(parameters.get("locale")) ? parameters.get("locale") : "en";
await setFormaLocale(locale, { persist: false });
document.querySelector("#fixture-locale").value = locale;
let selectedExample = Object.hasOwn(examples, parameters.get("case")) ? parameters.get("case") : "executive";
let saved;
let precedingSaved;
let nextSave = "saved";
const log = [];
function t(key) {
  const family = formaLocaleFamily(currentFormaLocale().locale);
  return (FORMA_OUTPUT_REQUIREMENT_MESSAGES[family] ?? FORMA_OUTPUT_REQUIREMENT_MESSAGES.en)[`output.requirement.${key}`];
}
function localizeChrome() {
  document.title = t("fixtureTitle");
  document.querySelectorAll("[data-message]").forEach((element) => { element.textContent = t(element.dataset.message); });
  renderLog();
}
function record(type, detail) {
  log.push({ sequence: log.length + 1, type, detail, providerCalls: 0 });
  renderLog();
}
function renderLog() { document.querySelector("#fixture-log").textContent = log.length ? JSON.stringify(log.slice(-20), null, 2) : t("fixtureEmptyLog"); }
function localizedSnapshot(snapshot) {
  return {
    ...snapshot,
    summary: { ...snapshot.summary, headline: t("fixtureSummary"), detail: t("fixtureDetail") },
    sourceOptions: [{ id: "fixture-source-a", label: t("fixtureSourceA") }, { id: "fixture-source-b", label: t("fixtureSourceB") }],
  };
}
function show(snapshot = saved, resourceState = "ready", editorState = { status: "idle" }) {
  for (const card of cards) { card.snapshot = localizedSnapshot(snapshot); card.resourceState = resourceState; card.editorState = editorState; }
  full.presentation = "full";
  compact.presentation = "compact";
  // The compact surface receives identical totals but cannot open a second editor.
  compact.snapshot = { ...compact.snapshot, canEdit: false };
}
function loadExample(key) {
  selectedExample = key;
  const example = examples[key];
  const parsed = parseOutputRequirement({ id: `fixture-${key}`, Type: "Output", Subtype: example.label, Content: example.content });
  const deck = parsed.spec?.deliverables.find((value) => value.media_kind === "slides");
  saved = {
    scope: { projectId: "fixture-project", documentId: `fixture-document-${key}`, authorizationScopeKey: "fixture-actor" },
    requirementId: `fixture-${key}`, revision: 1,
    label: example.label, originalText: example.content, spec: parsed.spec,
    canEdit: true, canReviewPlan: true,
    summary: { headline: "", detail: "", overall: "unresolved", requiredRemaining: null, unresolvedGroups: null, selectedResultFiles: 0 },
    sourceOptions: [],
    planSuggestions: { countPolicies: {}, suggestedCounts: deck ? { [deck.id]: 8 } : {} },
    results: [],
  };
  precedingSaved = structuredClone(saved);
  nextSave = "saved";
  document.querySelector("#fixture-example").value = key;
  show();
}
document.querySelector("#fixture-controls").addEventListener("submit", (event) => event.preventDefault());
document.querySelector("#fixture-example").addEventListener("change", (event) => { loadExample(event.target.value); record("fixture-example", { example: selectedExample }); });
document.querySelector("#fixture-locale").addEventListener("change", async (event) => {
  await setFormaLocale(event.target.value, { persist: false });
  localizeChrome();
  for (const card of cards) card.snapshot = localizedSnapshot(card.snapshot);
});
document.querySelector("#fixture-narrow").addEventListener("change", (event) => { document.querySelector("#fixture-cards").dataset.narrow = String(event.target.checked); });
document.querySelector("#fixture-ready").addEventListener("click", () => show());
document.querySelector("#fixture-loading").addEventListener("click", () => show(saved, "loading"));
document.querySelector("#fixture-unavailable").addEventListener("click", () => show(saved, "unavailable", { status: "unavailable" }));
document.querySelector("#fixture-permission").addEventListener("click", () => show({ ...saved, canEdit: false }, "ready", { status: "forbidden" }));
document.querySelector("#fixture-conflict").addEventListener("click", () => { nextSave = "conflict"; record("fixture-next-save", { outcome: "conflict" }); });
document.querySelector("#fixture-late").addEventListener("click", () => {
  show({ ...precedingSaved, revision: Math.max(0, Number(saved.revision) - 1) }, "refreshing");
  record("fixture-late-snapshot", { note: "Synthetic presentational input only; controller monotonicity is tested separately." });
});
document.querySelector("#fixture-partial").addEventListener("click", () => {
  const partial = structuredClone(saved);
  if (partial.spec?.deliverables) partial.spec.deliverables = partial.spec.deliverables.slice(0, 1);
  partial.summary = { ...partial.summary, overall: "unknown", requiredRemaining: null, unresolvedGroups: null, selectedResultFiles: null };
  show(partial);
});
document.querySelector("#fixture-unsupported").addEventListener("click", () => show({ ...saved, spec: { ...saved.spec, schema_version: 999 } }));
document.querySelector("#fixture-clear-log").addEventListener("click", () => { log.length = 0; renderLog(); });
for (const eventName of ["forma-output-edit", "forma-output-save", "forma-output-cancel", "forma-output-review-plan", "forma-output-open-result"]) {
  document.querySelector("#fixture-cards").addEventListener(eventName, (event) => {
    event.preventDefault();
    record(eventName, structuredClone(event.detail));
    if (eventName === "forma-output-edit" && event.detail.action === "reapply") { full.editorState = { status: "idle" }; return; }
    if (eventName !== "forma-output-save") return;
    const { clientMutationId, draft, planSuggestions, expectedRevision } = event.detail;
    full.editorState = { status: "saving", clientMutationId };
    // This is a local fake command adapter, not persistence or a provider invocation.
    queueMicrotask(() => {
      precedingSaved = structuredClone(saved);
      if (nextSave === "conflict" || expectedRevision !== saved.revision) {
        const latestSpec = structuredClone(saved.spec ?? draft);
        if (latestSpec?.deliverables[0]) latestSpec.deliverables[0].label += ` · ${t("latest")}`;
        saved = { ...saved, revision: Number(saved.revision) + 1, spec: latestSpec };
        nextSave = "saved";
        const latest = localizedSnapshot(saved);
        show(saved, "ready", { status: "conflict", clientMutationId, latest });
      } else {
        saved = { ...saved, revision: Number(saved.revision) + 1, label: draft.label, originalText: draft.original_text, spec: structuredClone(draft), planSuggestions: structuredClone(planSuggestions) };
        show(saved, "ready", { status: "saved", clientMutationId });
      }
    });
  });
}
localizeChrome();
loadExample(selectedExample);
if (parameters.get("width") === "narrow") {
  document.querySelector("#fixture-narrow").checked = true;
  document.querySelector("#fixture-cards").dataset.narrow = "true";
}
