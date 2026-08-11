import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { exportArchive, importArchive } from "../src/model/archive.ts";
import { buildScenario, explainReplayEvent, SCENARIOS, SCENARIO_EVENT_TYPES } from "../src/model/scenarios.ts";
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

test("keeps every replay fixture current and every mocked event specifically explained", () => {
  assert.ok(SCENARIOS.length >= 6);
  const stories = new Set();
  for (const scenario of SCENARIOS) {
    const events=buildScenario(scenario.key,SCENARIO_EVENT_TYPES.length*3);
    for (const event of events) { const story=explainReplayEvent(event); assert.doesNotMatch(story.action,/ appended /); assert.ok(story.value.length>40); assert.match(story.cause,/actor /); stories.add(`${event.type}:${story.value}`); }
  }
  assert.equal(stories.size,SCENARIO_EVENT_TYPES.length);
  const taste=buildScenario("taste-time",13); const compile=taste.find((event)=>event.type==="ContextCompiled"); const complete=taste.find((event)=>event.type==="GenerationCompleted"); const critique=taste.find((event)=>event.type==="ObjectCritiqued");
  assert.equal(compile?.payload.generation_id,complete?.payload.generation_id); assert.ok(complete?.payload.object_ids.includes(critique?.payload.object_id)); assert.ok(compile?.payload.source_block_versions.length);
  assert.ok(buildScenario("attention-friction",12).some((event)=>event.type==="AttentionSignalsForgotten"));
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

test("packages first-class HTML entry points for every named application route", async () => {
  const plugin = await readFile(new URL("../build/sites-vite-plugin.ts", import.meta.url), "utf8");
  const routeLoader = await readFile(new URL("../src/route-loader.ts", import.meta.url), "utf8");
  const shell = await readFile(new URL("../src/components/forma-shell.ts", import.meta.url), "utf8");
  const worker = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  const config = await readFile(new URL("../vite.config.ts", import.meta.url), "utf8");
  const routes = ["projects","studio/project","studio/board","studio/guided","studio/layers","studio/adaptive","library","sessions","scout","memory","system","admin/events"];
  for (const route of routes) {
    assert.match(plugin, new RegExp(`path: "/${route.replaceAll("/", "\\/")}"`));
    const entry = await readFile(new URL(`../dist/client/${route}/index.html`, import.meta.url), "utf8");
    const direct = await readFile(new URL(`../dist/client/${route}.html`, import.meta.url), "utf8");
    assert.match(entry, /<forma-shell><\/forma-shell>/); assert.match(entry, new RegExp(`content="/${route.replaceAll("/", "\\/")}"`));
    assert.match(entry, new RegExp(`data-forma-route-module="/${route.replaceAll("/", "\\/")}"`));
    assert.match(direct, /\/assets\/index-/);
  }
  const rootEntry = await readFile(new URL("../dist/client/index.html", import.meta.url), "utf8");
  const shareEntry = await readFile(new URL("../dist/client/share/index.html", import.meta.url), "utf8");
  assert.match(rootEntry, /data-forma-route-module="\/"/); assert.match(shareEntry, /forma-shared-view-/);
  assert.match(config, /manifest: true/); assert.match(config, /"\/share\/\*"/); assert.match(worker, /"\/share\/index\.html"/); assert.match(worker, /"\/index\.html"/);
  assert.match(routeLoader, /import\("\.\/components\/forma-library"\)/); assert.match(routeLoader, /import\("\.\/components\/forma-admin-events"\)/);
  assert.doesNotMatch(shell, /import "\.\/forma-library"/); assert.doesNotMatch(shell, /import "\.\/forma-admin-events"/);
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
  const [eventsApi, store, sessions, briefModel, contextBlock, workspace, library, referenceImage, palettePicker, classification, blockTypes] = await Promise.all([
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
    readFile(new URL("../src/model/block-types.ts", import.meta.url), "utf8"),
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
  assert.match(workspace, /upload-rights-modal/); assert.doesNotMatch(workspace, /window\.confirm/); assert.match(workspace, /BLOCK_TYPES/); assert.match(blockTypes, /type:"subject"/); assert.match(blockTypes, /type:"exclusion"/);
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
  const [library,workspace,collections,projectRail,store,eventsModel,eventsApi,outputCard,styles,shell,system,classification,contents,projects,alternatives,navigation,editorAlternatives,blockTypes,adapter]=await Promise.all([
    readFile(new URL("../src/components/forma-library.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/components/forma-workspace.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/components/collection-tree.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/components/project-rail.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/state/store.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/model/events.ts",import.meta.url),"utf8"),
    readFile(new URL("../worker/events-api.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/components/output-card.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/styles.css",import.meta.url),"utf8"),
    readFile(new URL("../src/components/forma-shell.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/components/forma-system.ts",import.meta.url),"utf8"),
    readFile(new URL("../docs/event-classification.csv",import.meta.url),"utf8"),
    readFile(new URL("../src/components/forma-project-contents.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/components/forma-projects.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/components/forma-studio-alternatives.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/components/studio-navigation.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/components/forma-studio-editor-alternatives.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/model/block-types.ts",import.meta.url),"utf8"),
    readFile(new URL("../worker/openai-adapter.ts",import.meta.url),"utf8"),
  ]);
  assert.match(library,/Use in open document/);assert.match(library,/focused preview/i);assert.match(library,/Generated with this block/);assert.match(library,/Open family lightbox/);
  assert.match(library,/Keep for reuse/);assert.match(library,/Recent shows the project trail/);assert.doesNotMatch(library,/Project contents|Open in Studio/);
  assert.match(contents,/Project contents/);assert.match(contents,/>Open \$\{icon\("arrow"\)\}/);assert.match(contents,/openDocument/);
  assert.match(eventsModel,/DocumentOpened/);assert.match(eventsApi,/DocumentOpened/);assert.match(store,/openDocument/);assert.match(classification,/DocumentOpened,behavioral/);
  assert.match(eventsModel,/ProjectOpened/);assert.match(eventsApi,/ProjectOpened/);assert.match(store,/openProject/);assert.match(classification,/ProjectOpened,behavioral/);
  assert.match(eventsModel,/DocumentRemoved/);assert.match(eventsApi,/DocumentRemoved/);assert.match(store,/removeDocument/);assert.match(classification,/DocumentRemoved,user_content/);
  assert.match(collections,/File open document/);assert.match(collections,/New nested collection/);assert.match(collections,/collection-dialog/);assert.doesNotMatch(collections,/window\.prompt/);
  assert.match(workspace,/project-settings-dialog/);assert.match(workspace,/type:BlockKind/);assert.match(workspace,/block-composer-dialog/);
  assert.match(workspace,/forma-project-rail surface="studio"/);assert.match(library,/forma-project-rail surface="library"/);assert.match(projectRail,/Library overview/);assert.match(projectRail,/Project overview/);assert.doesNotMatch(projectRail,/All documents/);assert.match(projectRail,/No auto-filing/);assert.match(projectRail,/rail-collapse-toggle/);
  assert.match(workspace,/studio-document-delete-dialog/);assert.match(contents,/project-document-delete-dialog/);assert.match(`${workspace}${contents}`,/Remove document/);
  assert.match(shell,/this\.#route\("\/projects"\)/);assert.match(projects,/New project/);assert.match(navigation,/Context board/);assert.match(navigation,/Guided brief/);assert.match(navigation,/Reality layers/);assert.match(navigation,/Adaptive path/);
  assert.match(alternatives,/created_from:"context-board"/);assert.match(alternatives,/created_from:"guided-brief"/);assert.match(alternatives,/forma-studio-navigator/);
  assert.match(editorAlternatives,/application\/x-forma-reality/);assert.match(editorAlternatives,/created_from:"reality-layers"/);assert.match(editorAlternatives,/BlockWeightSet/);assert.match(editorAlternatives,/created_from:"adaptive-path"/);assert.match(editorAlternatives,/related_block_ids/);
  assert.match(editorAlternatives,/layer-create-dialog/);assert.match(editorAlternatives,/Save layer/);assert.match(editorAlternatives,/Duplicate/);assert.match(editorAlternatives,/structureAdaptive/);assert.match(eventsApi,/structure_adaptive/);assert.match(adapter,/forma_adaptive_structure/);
  assert.match(blockTypes,/type:"audience"/);assert.match(blockTypes,/type:"environment"/);assert.match(blockTypes,/type:"accessibility"/);assert.match(workspace,/System-suggested subtype/);
  assert.match(shell,/forma-reality-layers/);assert.match(shell,/forma-adaptive-path/);assert.match(styles,/\.reality-editor/);assert.match(styles,/\.adaptive-workspace/);
  assert.doesNotMatch(`${workspace}${library}${styles}`,/studio-sidebar|library-tree/);assert.match(styles,/\.project-rail/);
  assert.match(workspace,/\?disabled=\$\{!canCompare\}/);assert.match(store,/canUndo/);assert.match(store,/canRedo/);assert.match(styles,/\.document-bar \{ position: sticky/);
  assert.match(outputCard,/Taste evidence/);assert.match(outputCard,/taste-axis-grid/);assert.match(outputCard,/Record taste evidence/);
  assert.match(shell,/system#governance/);assert.match(shell,/Use attention signals to improve Forma/);assert.match(system,/id="governance"/);assert.match(system,/Forget attention data/);
});

test("keeps opt-in attention capture visible-only, coarse, bounded, and forgettable",async()=>{
  const [observer,attention,store,shell,system,scout,memory,eventsApi,policy,decisions,classification]=await Promise.all([
    readFile(new URL("../src/components/forma-attention-observer.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/model/attention.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/state/store.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/components/forma-shell.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/components/forma-system.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/model/scout.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/components/forma-memory.ts",import.meta.url),"utf8"),
    readFile(new URL("../worker/events-api.ts",import.meta.url),"utf8"),
    readFile(new URL("../worker/pilot-policy.ts",import.meta.url),"utf8"),
    readFile(new URL("../docs/decisions.ndjson",import.meta.url),"utf8"),
    readFile(new URL("../docs/event-classification.csv",import.meta.url),"utf8"),
  ]);
  assert.match(observer,/document\.visibilityState==="visible"/);assert.match(observer,/IntersectionObserver/);assert.match(observer,/idle_timeout/);assert.match(observer,/terminal_type/);
  assert.doesNotMatch(observer,/clientX|clientY|screenX|screenY|event\.key|\.value/);
  assert.match(attention,/ATTENTION_RETENTION_DAYS = 14/);assert.match(attention,/\.25/);assert.match(attention,/AttentionSignalsForgotten/);
  assert.match(store,/setAttentionCapture/);assert.match(store,/forgetAttentionSignals/);assert.match(shell,/off until you enable them separately/);assert.match(system,/off by default/);
  assert.match(scout,/attention_weight_cap:\.25/);assert.match(memory,/cannot create a taste belief/);assert.match(eventsApi,/AttentionEpisodeObserved/);assert.match(eventsApi,/normalizeAttention/);assert.match(policy,/rawInputCapture: false/);
  assert.match(decisions,/D-0029.*supersedes":"D-0015"/);assert.match(classification,/AttentionEpisodeObserved,derived_sensitive/);
});

test("uses one edge rail and one header vocabulary without Library overflow traps", async()=>{
  const [library,workspace,sessions,scout,memory,system,admin,contextBlock,styles]=await Promise.all([
    "forma-library.ts","forma-workspace.ts","forma-sessions.ts","forma-scout.ts","forma-memory.ts","forma-system.ts","forma-admin-events.ts","context-block.ts",
  ].map((file)=>readFile(new URL(`../src/components/${file}`,import.meta.url),"utf8")).concat(readFile(new URL("../src/styles.css",import.meta.url),"utf8")));
  assert.match(library,/library-page"><forma-project-rail surface="library"/);assert.match(workspace,/forma-project-rail surface="studio"/);
  assert.doesNotMatch(library,/library-layout|page-pad/);assert.match(library,/library-main/);assert.match(styles,/\.workspace-page, \.library-page/);
  for(const source of [library,workspace,sessions,scout,memory,system,admin])assert.match(source,/page-header/);
  assert.match(styles,/\.library-main \{ container-type: inline-size/);assert.match(styles,/@container \(max-width: 760px\)/);
  assert.match(styles,/repeat\(auto-fit,minmax\(min\(220px,100%\),1fr\)\)/);assert.match(styles,/\.library-content > section \{ min-width: 0/);
  assert.match(styles,/\.page-header--library,\.page-header--document \{ position: sticky/);assert.match(styles,/\.page-header--library h1,\.page-header--document h1/);
  assert.match(styles,/\.context-block \{[^}]*container-type: inline-size/);assert.match(styles,/@container \(max-width: 520px\)/);assert.match(styles,/@container \(max-width: 370px\)/);
  assert.match(contextBlock,/class="meta-short"/);assert.match(contextBlock,/aria-label="Block influence"/);assert.match(contextBlock,/aria-label="Remove block"/);
});
