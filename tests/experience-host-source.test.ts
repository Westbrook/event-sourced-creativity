import assert from "node:assert/strict";
import test from "node:test";
import { experienceSourceMatches, experienceSourceMismatch } from "../src/experiences/host-source.ts";
import type { ExperiencePlan } from "../src/experiences/intake.ts";
import type { ExperienceIntakeReceipt } from "../src/experiences/native-host.ts";

type Row = Record<string, unknown>;

// Plain synthetic witnesses for the matcher's already-validated plan/receipt
// precondition. This does not exercise intake validation, admission, authority,
// canonical projection execution, generation, or registered release selection.
function fixture(output: "image" | "slides" = "image") {
  const documentId = "document-1", projectId = "project-1", streamId = "creative:actor-1";
  const draftId = "experience-draft-" + "a".repeat(64);
  const title = output === "image" ? "Image" : "Slides";
  const releaseHash = "b".repeat(64);
  const events: ExperiencePlan["events"] = [
    { type: "ProjectCreated", payload: { project_id: projectId, name: title, state: "active" } },
    { type: "DocumentCreated", payload: { project_id: projectId, document_id: documentId, handle: output, title } },
    { type: "EmptyCanvasChosen", payload: { project_id: projectId, document_id: documentId, source_surface: "experience" } },
    ...["subject", "format"].map((kind, index) => ({
      type: "BlockCreated",
      payload: {
        project_id: projectId, document_id: documentId, block_id: `block-${index}`, type: kind,
        handle: `${kind}/experience`, position: `z000${index + 1}`,
        properties: {
          text: kind === "subject" ? "Subject" : output === "image" ? "One image" : "Five slides",
          subtype: kind === "subject" ? "Hero subject" : "Aspect ratio", weight: 0.8,
          authority: "authored", experience_origin: "authored", experience_release: releaseHash,
        },
      },
    })),
  ];
  const plan: ExperiencePlan = {
    version: 1, draftId, streamId, projectId, documentId, title, events, draftHash: "c".repeat(64),
    request: { intentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", experienceId: `synthetic-${output}`, releaseHash, values: { subject: { value: "Subject", provenance: "authored" } } },
    release: {
      schemaVersion: 1, qualification: "context-authoring", definitionHash: "d".repeat(64), releaseHash, dependencies: {},
      definition: {
        schemaVersion: 1, id: `synthetic-${output}`, revision: 1, outputContractRef: `${output}@1`,
        bindingPackRef: `${output}.bindings@1`, essentialInteractionRef: "subject@1", layout: "stage-and-controls",
        decisions: [{ id: "subject", interactionRef: "subject@1", bindingSlot: "subject", labelKey: "subject" }],
        viewerRef: `${output}.read-only@1`, mobileProfileRef: "touch.standard@1", copySetRef: "functional.en@1",
      },
      output: {
        id: output, version: 1, output, label: title, result: output === "image" ? "One image" : "Five slides",
        bindingPackRef: `${output}.bindings@1`, essentialInteractionRef: "subject@1", viewerRef: `${output}.read-only@1`,
        bindings: [{ slot: "subject", decisionId: "subject", interactionRef: "subject@1", role: "subject", target: output }],
      },
      interactions: { subject: { id: "subject", version: 1, kind: "source", renderer: "role-source@1", feedback: "subject", required: true, maxLength: 500, defaultValue: "" } },
      copy: { subject: "Subject" },
    },
  };
  const appended = events.map((event, index) => ({ ...structuredClone(event), eventId: `event-${index}`, sequence: index + 10 }));
  const receipt: ExperienceIntakeReceipt = {
    status: "complete", generation: "unavailable", documentId, projectId, draftId, draftHash: plan.draftHash,
    documentRoute: `/document/${documentId}/${output}`, head: 14, appended, rejected: [],
  };
  const current = {
    documentId, projectId,
    documents: [{ id: documentId, projectId, title, removed: false }] as Row[],
    blocks: events.flatMap((event, index) => event.type === "BlockCreated" ? [{
      id: event.payload.block_id, documentId, projectId, scope: "document", canvasId: "", removed: false, locked: false,
      type: event.payload.type, handle: event.payload.handle, position: event.payload.position,
      properties: structuredClone(event.payload.properties), sourceEvents: [`event-${index}`],
    }] : []) as Row[],
    relations: [] as Row[],
    events: appended.map(event => ({ ...structuredClone(event), streamId, actor: "user" })) as Row[],
  };
  return { plan, receipt, current };
}

test("matches both exact validated synthetic sources without mutating them", () => {
  for (const output of ["image", "slides"] as const) {
    const input = fixture(output), before = JSON.stringify(input);
    assert.equal(experienceSourceMatches(input.plan, input.receipt, input.current), true, output);
    assert.equal(JSON.stringify(input), before);
  }
});

test("ignores other-document data and canonical event array order", () => {
  const { plan, receipt, current } = fixture();
  current.documents.push({ id: "other-document" });
  current.blocks.push({ id: "other-block", documentId: "other-document" });
  current.relations.push({ id: "other-relation", documentId: "other-document" });
  current.events.push({ eventId: "unrelated-event" });
  current.events.reverse();
  assert.equal(experienceSourceMatches(plan, receipt, current), true);
});

test("rejects current selection and receipt identity mismatches", () => {
  for (const key of ["documentId", "projectId"] as const) {
    const { plan, receipt, current } = fixture();
    assert.equal(experienceSourceMatches(plan, receipt, { ...current, [key]: "other" }), false, key);
  }
  for (const key of ["documentId", "projectId", "draftId", "draftHash"] as const) {
    const { plan, receipt, current } = fixture();
    assert.equal(experienceSourceMatches(plan, { ...receipt, [key]: "other" }, current), false, key);
  }
});

test("requires exactly one unchanged current Document", () => {
  const mutations: Array<(rows: Row[]) => void> = [
    rows => { rows.length = 0; }, rows => { rows.push({ ...rows[0] }); },
    rows => { rows[0].removed = true; }, rows => { rows[0].title = "Edited"; },
    rows => { rows[0].projectId = "other-project"; },
  ];
  for (const mutate of mutations) {
    const { plan, receipt, current } = fixture();
    mutate(current.documents);
    assert.equal(experienceSourceMatches(plan, receipt, current), false);
  }
});

test("requires unique complete receipt and canonical event associations", () => {
  const { plan, receipt, current } = fixture();
  assert.equal(experienceSourceMatches(plan, { ...receipt, appended: receipt.appended.slice(1) }, current), false);
  assert.equal(experienceSourceMatches(plan, { ...receipt, appended: [receipt.appended[0], receipt.appended[0], ...receipt.appended.slice(2)] }, current), false);
  assert.equal(experienceSourceMatches(plan, { ...receipt, appended: [...receipt.appended].reverse() }, current), false);
  assert.equal(experienceSourceMatches(plan, receipt, { ...current, events: current.events.slice(1) }), false);
  assert.equal(experienceSourceMatches(plan, receipt, { ...current, events: [...current.events, current.events[0]] }), false);
});

test("rejects changed original event ownership, sequence, type or payload", () => {
  for (const [key, value] of [
    ["streamId", "creative:other"], ["actor", "assistant"], ["sequence", 100],
    ["type", "DocumentRenamed"], ["payload", { replacement: true }],
  ] as const) {
    const { plan, receipt, current } = fixture();
    current.events[1][key] = value;
    assert.equal(experienceSourceMatches(plan, receipt, current), false, key);
  }
});

test("rejects edited block content, ownership, location, flags and provenance", () => {
  for (const [key, value] of [
    ["projectId", "other-project"], ["scope", "project"], ["canvasId", "canvas"],
    ["removed", true], ["locked", true], ["type", "lighting"], ["handle", "changed"],
    ["position", "z9999"], ["properties", { text: "Edited" }], ["sourceEvents", ["event-3", "later-edit"]],
  ] as const) {
    const { plan, receipt, current } = fixture();
    current.blocks[0][key] = value;
    assert.equal(experienceSourceMatches(plan, receipt, current), false, key);
  }
});

test("rejects missing, added or duplicate current source blocks and document relations", () => {
  const { plan, receipt, current } = fixture();
  assert.equal(experienceSourceMatches(plan, receipt, { ...current, blocks: current.blocks.slice(1) }), false);
  assert.equal(experienceSourceMatches(plan, receipt, { ...current, blocks: [...current.blocks, { ...current.blocks[0], id: "extra-block" }] }), false);
  assert.equal(experienceSourceMatches(plan, receipt, { ...current, blocks: [current.blocks[0], current.blocks[0]] }), false);
  assert.equal(experienceSourceMatches(plan, receipt, { ...current, relations: [{ id: "relation", documentId: plan.documentId }] }), false);
});

test("diagnostics return fixed categories without source values and retain refusal semantics", () => {
  const cases: Array<[string, (input: ReturnType<typeof fixture>) => void]> = [
    ["identity", input => { input.current.documentId = "private-identity"; }],
    ["document", input => { input.current.documents[0].title = "private-title"; }],
    ["original_event", input => { input.current.events[0].payload = { secret: "private-payload" }; }],
    ["block_membership", input => { input.current.blocks.pop(); }],
    ["relation", input => { input.current.relations.push({ documentId: input.plan.documentId, secret: "private-relation" }); }],
    ["block_fields", input => { input.current.blocks[0].handle = "private-handle"; }],
    ["properties", input => { input.current.blocks[0].properties = { secret: "private-content" }; }],
    ["provenance", input => { input.current.blocks[0].sourceEvents = ["private-event"]; }],
    ["unreadable", input => { Object.defineProperty(input.current.blocks[0], "properties", { get() { throw Error("private-exception"); } }); }],
  ];
  for (const [category, mutate] of cases) {
    const input = fixture(); mutate(input);
    assert.equal(experienceSourceMismatch(input.plan, input.receipt, input.current), category);
    assert.equal(experienceSourceMatches(input.plan, input.receipt, input.current), false);
  }
  const input = fixture();
  assert.equal(experienceSourceMismatch(input.plan, input.receipt, input.current), null);
});

test("later operational events do not invalidate exact Video source; same-value edits still do", () => {
  // Comparator regression only. Full canonical folding and live evidence remain
  // separate: these later operational events leave source blocks unchanged.
  const { plan, receipt, current } = fixture();
  Object.assign(plan.release.output, { output: "video" });
  for (const [index, type] of ["ContextCompiled", "DocumentRenderRequested", "BudgetReserved", "DocumentRenderFailed", "GenerationUsageRecorded"].entries()) {
    current.events.push({ eventId: `run-event-${index}`, streamId: plan.streamId, actor: "worker:renderer", sequence: 100 + index,
      type, payload: { document_id: plan.documentId, artifact_kind: "video", reason: "provider_submission_uncertain" } });
    assert.equal(experienceSourceMismatch(plan, receipt, current), null, type);
  }
  // A same-value author edit must not be ignored merely because visible text
  // still matches: changed provenance remains a hard refusal.
  current.blocks[0].sourceEvents = [...current.blocks[0].sourceEvents as string[], "same-value-edit"];
  assert.equal(experienceSourceMismatch(plan, receipt, current), "provenance");
  assert.equal(experienceSourceMatches(plan, receipt, current), false);
});
