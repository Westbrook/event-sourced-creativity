import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { exportArchive, importArchive } from "../src/model/archive.ts";
import { buildScenario } from "../src/model/scenarios.ts";
import { foldEvents } from "../src/model/events.ts";

test("uses Lit custom elements and the requested signal packages without React", async () => {
  const [pkg, main, shell, store, admin, files] = await Promise.all([
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../src/main.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/forma-shell.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/state/store.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/forma-admin-events.ts", import.meta.url), "utf8"),
    readdir(new URL("../src/components/", import.meta.url)),
  ]);
  assert.doesNotMatch(pkg, /"react"|"react-dom"|vinext|@vitejs\/plugin-react/);
  assert.match(pkg, /"lit"/); assert.match(pkg, /"signal-polyfill"/); assert.match(pkg, /"signal-utils"/);
  assert.match(main, /forma-shell/); assert.match(shell, /customElements\.define/);
  assert.match(store, /new Signal\.State/); assert.match(store, /new SignalObject/);
  assert.match(admin, /50000|50,000/); assert.match(admin, /Replay laboratory/);
  assert.ok(files.filter((file) => file.endsWith(".ts")).length >= 9);
});

test("builds and replays theoretical long streams deterministically", () => {
  const first = buildScenario("creative-loop", 10_000);
  const second = buildScenario("creative-loop", 10_000);
  assert.equal(first.length, 10_000); assert.deepEqual(first, second);
  assert.equal(first[0].sequence, 1); assert.equal(first.at(-1).sequence, 10_000);
  const halfway = foldEvents(first, 5_000); const final = foldEvents(first);
  assert.ok(final.blocks.length >= halfway.blocks.length);
  assert.ok(final.outputs.length >= halfway.outputs.length);
});

test("round-trips a lossless Forma event archive", () => {
  const events = buildScenario("promotion", 100);
  const archive = exportArchive(events);
  const imported = importArchive(JSON.parse(JSON.stringify(archive)));
  assert.deepEqual(imported.events, events);
  assert.equal(imported.format, "forma-event-archive");
});

test("packages a responsive SPA and Sites metadata", async () => {
  const [html, css, hosting] = await Promise.all([
    readFile(new URL("../dist/client/index.html", import.meta.url), "utf8"),
    readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../dist/.openai/hosting.json", import.meta.url), "utf8"),
  ]);
  assert.match(html, /Forma — An event-sourced creative studio/);
  assert.match(html, /forma-shell/);
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.match(hosting, /appgprj_/);
});

test("enforces the adopted production-pilot boundaries", async () => {
  const [policy, adapter, shares, media, shell, schema, envExample] = await Promise.all([
    readFile(new URL("../worker/pilot-policy.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/openai-adapter.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/shares-api.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/media-api.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/forma-shell.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../.env.example", import.meta.url), "utf8"),
  ]);
  assert.match(policy, /oai-authenticated-user-id/); assert.match(policy, /cf-access-authenticated-user-email/);
  assert.match(policy, /pilot_terms_required/); assert.match(policy, /reserved_tokens/); assert.match(policy, /250_000/); assert.match(policy, /2_500_000/);
  assert.match(adapter, /api\.openai\.com\/v1\/responses/); assert.match(adapter, /store: false/); assert.match(adapter, /safety_identifier/);
  assert.match(shares, /expiresHours/); assert.match(shares, /ShareLinkRevoked/); assert.match(shares, /token_hash/);
  assert.match(media, /rightsConfirmed/); assert.match(shell, /acceptTerms/); assert.match(shell, /forma-shared-view/);
  assert.match(schema, /private_content/); assert.match(schema, /budget_counters/); assert.match(envExample, /OPENAI_API_KEY=/);
});

test("records the accepted provider debt and makes the extractor gate operational", async () => {
  const [decisions, coverage, eventsApi, store, system, classification] = await Promise.all([
    readFile(new URL("../docs/decisions.ndjson", import.meta.url), "utf8"),
    readFile(new URL("../docs/plan-coverage.md", import.meta.url), "utf8"),
    readFile(new URL("../worker/events-api.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/state/store.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/forma-system.ts", import.meta.url), "utf8"),
    readFile(new URL("../docs/event-classification.csv", import.meta.url), "utf8"),
  ]);
  assert.match(decisions, /D-0019.*accepted-debt.*second adapter/);
  assert.match(coverage, /Phase 3.*executable 10% correction-rate gate/);
  assert.match(eventsApi, /evaluate_extractors/); assert.match(eventsApi, /extract_reference/);
  assert.match(store, /evaluateExtractors/); assert.match(system, /Extractor quality gate/);
  assert.match(classification, /ExtractorEvaluationCompleted,operational/);
});

test("runs the Phase 6 pilot from event-derived sessions instead of brief fixtures", async () => {
  const [eventsApi, store, sessions, briefModel, contextBlock, workspace, library, referenceImage, palettePicker, classification] = await Promise.all([
    readFile(new URL("../worker/events-api.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/state/store.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/forma-sessions.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/model/brief.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/context-block.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/forma-workspace.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/forma-library.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/reference-image.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/reference-palette-picker.ts", import.meta.url), "utf8"),
    readFile(new URL("../docs/event-classification.csv", import.meta.url), "utf8"),
  ]);
  assert.match(eventsApi, /open_session/); assert.match(eventsApi, /close_session/); assert.match(eventsApi, /compose_brief/); assert.match(eventsApi, /declare_intent/);
  assert.doesNotMatch(eventsApi, /brief-today/);
  assert.match(store, /composeBrief/); assert.match(sessions, /event-derived/); assert.match(sessions, /Dosage curve/);
  assert.match(briefModel, /PHASE6_MIN_CLOSED_SESSIONS/); assert.match(briefModel, /rejectedPathMemory/); assert.match(briefModel, /phase6GateMetrics/);
  assert.match(briefModel, /destination/); assert.match(sessions, /new_document_id/); assert.match(sessions, /data-target-ref/);
  const startBlank = sessions.match(/async #startBlank[\s\S]*?\n {2}}/)?.[0] ?? "";
  assert.match(startBlank, /DocumentCreated/); assert.doesNotMatch(startBlank, /BlockCreated/); assert.match(sessions, /Name it before it enters the stream/);
  assert.match(eventsApi, /DocumentRenamed/); assert.match(classification, /DocumentRenamed,user_content/); assert.match(workspace, /Rename document/);
  assert.match(workspace, /This document is empty/); assert.match(workspace, /New authored block/); assert.match(contextBlock, /block-editor/);
  assert.match(contextBlock, /forma-reference-image/); assert.match(library, /forma-reference-image/); assert.match(referenceImage, /<img/);
  assert.match(workspace, /upload-rights-modal/); assert.doesNotMatch(workspace, /window\.confirm/); assert.match(workspace, /type:"subject"/); assert.match(workspace, /type:"exclusion"/);
  assert.match(referenceImage, /reference-viewer/); assert.doesNotMatch(referenceImage, /target="_blank"/);
  assert.match(contextBlock, /text\/forma-block-id/); assert.match(contextBlock, /BlockRemoved/); assert.match(contextBlock, /Explore palettes/);
  assert.match(palettePicker, /palette_strategy/); assert.match(palettePicker, /getImageData/); assert.match(palettePicker, /source_reference_block_id/);
  assert.doesNotMatch(palettePicker, /type=["']color/); assert.match(palettePicker, /next click replaces swatch/i);
  assert.match(referenceImage, /showModal/); assert.match(palettePicker, /showModal/); assert.match(referenceImage, /closedby="any"/); assert.match(palettePicker, /closedby="any"/);
  assert.match(sessions, /PhaseGateReviewed/); assert.match(eventsApi, /PhaseGateReviewed/); assert.match(classification, /PhaseGateReviewed,human_judgment/);
});

test("runs the Phase 7 private-pilot index as a correctable derived projection", async () => {
  const [eventsApi, store, library, indexing, coverage, classification] = await Promise.all([
    readFile(new URL("../worker/events-api.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/state/store.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/forma-library.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/model/indexing.ts", import.meta.url), "utf8"),
    readFile(new URL("../docs/plan-coverage.md", import.meta.url), "utf8"),
    readFile(new URL("../docs/event-classification.csv", import.meta.url), "utf8"),
  ]);
  assert.match(eventsApi, /rebuild_index/); assert.match(eventsApi, /worker:indexer/);
  assert.doesNotMatch(eventsApi.match(/const USER_EVENTS[\s\S]*?\]\);/)?.[0] ?? "", /FamilyDeclared|FamilyMembershipAsserted/);
  assert.match(store, /rebuildIndex/); assert.match(library, /Vector, family, and corpus index/); assert.match(library, /Correct grouping/);
  assert.match(indexing, /EMBEDDING_MODEL_ID/); assert.match(indexing, /retrieveFewShotExemplars/); assert.match(indexing, /collectionIds/);
  assert.match(coverage, /Phase 7.*Operational pilot/); assert.match(classification, /FamilyDeclared.*worker:indexer/);
});

test("operationalizes bounded Scout and reversible ranking-only taste memory", async () => {
  const [eventsApi, store, shell, scoutPage, memoryPage, scoutModel, tasteModel, outputCard, coverage, classification] = await Promise.all([
    readFile(new URL("../worker/events-api.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/state/store.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/forma-shell.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/forma-scout.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/forma-memory.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/model/scout.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/model/taste.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/output-card.ts", import.meta.url), "utf8"),
    readFile(new URL("../docs/plan-coverage.md", import.meta.url), "utf8"),
    readFile(new URL("../docs/event-classification.csv", import.meta.url), "utf8"),
  ]);
  assert.match(shell, /forma-scout/); assert.match(shell, /forma-memory/); assert.match(shell, /"\/scout"/); assert.match(shell, /"\/memory"/);
  assert.match(eventsApi, /run_scout/); assert.match(eventsApi, /ScoutBudgetExhausted/); assert.match(eventsApi, /report_space:"scout"/);
  assert.doesNotMatch(`${eventsApi}${scoutModel}${scoutPage}`, /DirectionChosen/);
  assert.match(scoutModel, /convergence/); assert.match(scoutModel, /divergence/); assert.match(scoutModel, /stall/); assert.match(scoutModel, /adjacency/);
  assert.match(scoutPage, /ObservationJudged/); assert.match(scoutPage, /Promote to document/); assert.match(store, /runScout/);
  assert.match(eventsApi, /standing_constraints/); assert.match(eventsApi, /ranking_only:true/); assert.match(eventsApi, /half_life_days:60/);
  assert.match(tasteModel, /PreferenceAuthored/); assert.match(tasteModel, /PreferenceRevoked/); assert.match(tasteModel, /FactRetracted/);
  assert.match(memoryPage, /Affirm as standing/); assert.match(memoryPage, /Forget inference/); assert.match(memoryPage, /Bi-temporal history/);
  assert.match(outputCard, /ObjectCritiqued|critiqueObject/); assert.match(coverage, /Phase 8.*Operational pilot/); assert.match(coverage, /Phase 9.*Evaluation/);
  const userPermissions = eventsApi.match(/const USER_EVENTS[\s\S]*?\]\);/)?.[0] ?? "";
  assert.doesNotMatch(userPermissions, /ObjectCritiqued|Deferred|ConditionSet|ConditionFired|Resurfaced/); assert.match(eventsApi, /Deferred/); assert.match(classification, /ConditionFired,behavioral,structured_only,worker:scheduler/);
});

test("makes closeable dialogs light-dismissable with a compatibility fallback", async () => {
  const sources = await Promise.all([
    "forma-shell.ts", "forma-workspace.ts", "forma-library.ts", "collection-tree.ts", "reference-image.ts", "reference-palette-picker.ts",
  ].map((file) => readFile(new URL(`../src/components/${file}`, import.meta.url), "utf8")));
  const dialogs = sources.flatMap((source) => source.match(/<dialog[^>]*>/g) ?? []);
  assert.ok(dialogs.length >= 7); assert.ok(dialogs.every((dialog) => /closedby="(?:any|none)"/.test(dialog)));
  assert.ok(dialogs.filter((dialog) => /closedby="any"/.test(dialog)).every((dialog) => /@click=/.test(dialog)));
});

test("connects the final Library and Studio affordances to explicit destinations", async()=>{
  const [library,workspace,collections,store,eventsModel,eventsApi,outputCard,styles,shell,system,classification]=await Promise.all([
    readFile(new URL("../src/components/forma-library.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/components/forma-workspace.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/components/collection-tree.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/state/store.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/model/events.ts",import.meta.url),"utf8"),
    readFile(new URL("../worker/events-api.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/components/output-card.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/styles.css",import.meta.url),"utf8"),
    readFile(new URL("../src/components/forma-shell.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/components/forma-system.ts",import.meta.url),"utf8"),
    readFile(new URL("../docs/event-classification.csv",import.meta.url),"utf8"),
  ]);
  assert.match(library,/Use in open document/);assert.match(library,/focused preview/i);assert.match(library,/Generated with this block/);assert.match(library,/Open family lightbox/);
  assert.match(library,/Keep for reuse/);assert.match(library,/Recent shows the project trail/);assert.match(library,/Project contents/);assert.match(library,/openDocument/);
  assert.match(eventsModel,/DocumentOpened/);assert.match(eventsApi,/DocumentOpened/);assert.match(store,/openDocument/);assert.match(classification,/DocumentOpened,behavioral/);
  assert.match(collections,/File open document/);assert.match(collections,/New nested collection/);assert.match(collections,/collection-dialog/);assert.doesNotMatch(collections,/window\.prompt/);
  assert.match(workspace,/project-settings-dialog/);assert.match(workspace,/All documents/);assert.match(workspace,/type:BlockKind/);assert.match(workspace,/block-composer-dialog/);
  assert.match(workspace,/\?disabled=\$\{!canCompare\}/);assert.match(store,/canUndo/);assert.match(store,/canRedo/);assert.match(styles,/\.document-bar \{ position: sticky/);
  assert.match(outputCard,/Taste evidence/);assert.match(outputCard,/taste-axis-grid/);assert.match(outputCard,/Record taste evidence/);
  assert.match(shell,/system#governance/);assert.match(shell,/Passive \/ dwell capture/);assert.match(system,/id="governance"/);assert.match(system,/structurally unavailable/);
});
