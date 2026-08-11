import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { exportArchive, importArchive } from "../src/model/archive.ts";
import { buildScenario, explainReplayEvent, SCENARIOS, SCENARIO_EVENT_TYPES } from "../src/model/scenarios.ts";
import { BLOCK_TYPES } from "../src/model/block-types.ts";
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
  assert.ok(SCENARIOS.length >= 8);
  const stories = new Set();
  for (const scenario of SCENARIOS) {
    const events=buildScenario(scenario.key,SCENARIO_EVENT_TYPES.length*3);
    events.forEach((event,index)=>{const story=explainReplayEvent(event,index?events[index-1]:undefined);assert.doesNotMatch(story.action,/ appended /);assert.match(story.trigger,/^This happens/);assert.ok(story.trigger.length>70);assert.ok(story.value.length>40);assert.match(story.cause,/actor /);stories.add(`${event.type}:${story.value}`);});
  }
  assert.equal(stories.size,SCENARIO_EVENT_TYPES.length);
  const taste=buildScenario("taste-time",13); const compile=taste.find((event)=>event.type==="ContextCompiled"); const complete=taste.find((event)=>event.type==="GenerationCompleted"); const critique=taste.find((event)=>event.type==="ObjectCritiqued");
  assert.equal(compile?.payload.generation_id,complete?.payload.generation_id); assert.ok(complete?.payload.object_ids.includes(critique?.payload.object_id)); assert.ok(compile?.payload.source_block_versions.length);
  assert.ok(buildScenario("attention-friction",12).some((event)=>event.type==="AttentionSignalsForgotten"));
  const timed=buildScenario("taste-time",100);const gaps=timed.slice(1).map((event,index)=>Date.parse(event.occurredAt)-Date.parse(timed[index].occurredAt));
  assert.ok(new Set(gaps).size>5);assert.ok(Math.max(...gaps)>=86_400_000);const timedStory=explainReplayEvent(timed[1],timed[0]);assert.ok(timedStory.timing.value.length>60);assert.ok(timedStory.timing.gapMs>0);
});

test("replay narratives cover the complete authorized event and block vocabulary",async()=>{
  const [worker,admin]=await Promise.all([
    readFile(new URL("../worker/events-api.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/components/forma-admin-events.ts",import.meta.url),"utf8"),
  ]);
  const permissionSection=worker.match(/const USER_EVENTS[\s\S]*?const COMMUTATIVE/)?.[0]??"";
  const authorized=new Set([...permissionSection.matchAll(/"([A-Z][A-Za-z]+)"/g)].map((match)=>match[1]));
  authorized.add("ConditionSet");authorized.add("ObjectCritiqued");
  assert.deepEqual([...authorized].filter((type)=>!SCENARIO_EVENT_TYPES.includes(type)),[]);
  assert.deepEqual(SCENARIO_EVENT_TYPES.filter((type)=>!authorized.has(type)),[]);
  const blockEvents=buildScenario("document-evolution",1000).filter((event)=>event.type==="BlockCreated");
  assert.deepEqual(new Set(blockEvents.map((event)=>event.payload.type)),new Set(BLOCK_TYPES.map((definition)=>definition.type)));
  assert.match(admin,/capability-audit/);assert.match(admin,/SCENARIO_EVENT_TYPES\.length/);assert.match(admin,/Why this happens/);assert.match(admin,/How this helps/);assert.doesNotMatch(admin,/Why now matters/);assert.match(admin,/scenario span/);
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
  const routes = ["document","projects","studio/project","studio/board","studio/guided","studio/layers","studio/adaptive","studio/editor","library","sessions","scout","memory","system","admin/events","admin/events/stream","admin/events/replay","admin/events/permissions"];
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
  assert.match(config, /manifest: true/); assert.match(config, /"\/share\/\*"/); assert.match(worker, /"\/share\/index\.html"/); assert.match(worker, /appEntryPath/);
  assert.match(routeLoader, /import\("\.\/components\/forma-library"\)/); assert.match(routeLoader, /import\("\.\/components\/forma-admin-events"\)/);
  assert.match(shell, /addEventListener\("forma-route-changed", this\.#routeChanged\)/); assert.match(shell, /loadRouteComponent\(path\)/);
  assert.doesNotMatch(shell, /import "\.\/forma-library"/); assert.doesNotMatch(shell, /import "\.\/forma-admin-events"/);
});

test("restores Event operations tabs and Studio documents from URL state", async () => {
  const [admin, store, shell, routes, navigation, rail] = await Promise.all([
    readFile(new URL("../src/components/forma-admin-events.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/state/store.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/forma-shell.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/model/routes.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/studio-navigation.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/project-rail.ts", import.meta.url), "utf8"),
  ]);
  assert.match(admin, /\/admin\/events\/stream/); assert.match(admin, /\/admin\/events\/replay/); assert.match(admin, /\/admin\/events\/permissions/);
  assert.match(admin, /adminTabFromPath/); assert.match(admin, /href=\$\{adminTabPath/); assert.match(admin, /store\.setRoute\(adminTabPath\(tab\)\)/);
  assert.match(routes, /`\/document\/\$\{encodeURIComponent\(documentId\)\}/); assert.match(routes, /documentSlug/); assert.match(routes, /documentIdFromRoute/); assert.match(routes, /isDocumentViewRoute/);
  assert.match(store, /syncDocumentFromRoute/); assert.match(store, /shared-document-url/); assert.match(store, /replaceState/);
  assert.match(shell, /syncDocumentFromRoute\(path\)/); assert.match(shell, /withDocumentInRoute/);
  assert.match(navigation, /withDocumentInRoute/); assert.match(rail, /withDocumentInRoute/);
});

test("restores focused Library dialogs from durable URLs", async () => {
  const [library, routes, worker] = await Promise.all([
    readFile(new URL("../src/components/forma-library.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/model/routes.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
  ]);
  assert.match(routes, /LibraryFocusKind/); assert.match(routes, /\/library\/\$\{kind\}\/\$\{encodeURIComponent\(id\)\}/); assert.match(routes, /libraryFocusFromRoute/);
  assert.match(library, /libraryFocusRoute\("block"/); assert.match(library, /libraryFocusRoute\("output"/); assert.match(library, /libraryFocusRoute\("family"/);
  assert.match(library, /libraryRootRoute/); assert.match(library, /replace:true/); assert.doesNotMatch(library, /#focused(?:Block|Output|Family)Id/);
  assert.match(worker, /appEntryPath/); assert.match(routes, /"\/library\/index\.html"/);
});

test("presents every alternate Studio lens as the same complete durable document", async () => {
  const [alternatives, editorAlternatives, creativeEditor, navigation, styles] = await Promise.all([
    readFile(new URL("../src/components/forma-studio-alternatives.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/forma-studio-editor-alternatives.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/forma-creative-editor.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/studio-navigation.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
  ]);
  assert.match(alternatives, /forma-document-continuity/); assert.match(alternatives, /Next useful move/); assert.match(alternatives, /Whole-document check/);
  assert.match(alternatives, /projection\.blocks|projection\.get\(\)\.blocks/); assert.match(alternatives, /BLOCK_GROUPS/);
  assert.match(editorAlternatives, /Everything in this document/); assert.match(editorAlternatives, /supportingBlocks/); assert.match(editorAlternatives, /Why this is next/); assert.match(editorAlternatives, /What this unlocks/);
  assert.match(creativeEditor, /projection\.blocks/); assert.match(creativeEditor, /Everything shaping the work/); assert.match(creativeEditor, /continuity: false/); assert.match(creativeEditor, /inspector: false/); assert.match(creativeEditor, /quietRail: true/);
  assert.match(creativeEditor, /BlockCreated/); assert.match(creativeEditor, /BlockPropertyEdited/); assert.match(creativeEditor, /BlockWeightSet/); assert.match(creativeEditor, /BlockRemoved/);
  assert.match(creativeEditor, /The brief/); assert.match(creativeEditor, /The picture/); assert.match(creativeEditor, /The look/); assert.match(creativeEditor, /The guardrails/); assert.match(creativeEditor, /Visual references/);
  assert.doesNotMatch(creativeEditor, />Event|>Metadata|>Provenance|Creative history|source events/i);
  assert.match(navigation, /projection\.blocks\.length/); assert.match(navigation, /projection\.outputs\.length/); assert.match(navigation, /Every saved decision and result/);
  assert.match(navigation, /Creative editor/);
  assert.match(styles, /\.creative-editor \{[^}]*grid-template-rows: auto minmax\(0,1fr\)[^}]*height: clamp\(590px,72dvh,780px\)/);
  assert.match(styles, /\.creative-editor-layout \{[^}]*min-height: 0;[^}]*overflow: hidden/);
  assert.match(styles, /\.creative-editor-tools,\.creative-editor-inspector \{[^}]*overflow-y: auto;[^}]*overscroll-behavior: contain/);
});

test("lets Reference blocks prepare and explicitly adopt multiple image realities", async () => {
  const [extractors, workspace, contextBlock, findings, eventsApi, scenarios] = await Promise.all([
    readFile(new URL("../src/model/extractors.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/forma-workspace.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/context-block.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/reference-findings.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/events-api.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/model/scenarios.ts", import.meta.url), "utf8"),
  ]);
  for (const kind of ["palette", "mood", "composition", "material", "lighting", "spatial"]) assert.match(extractors, new RegExp(`kind: "${kind}"`));
  assert.match(workspace, /extraction_preferences/); assert.match(workspace, /REFERENCE_FINDING_OPTIONS/); assert.match(workspace, /Choose what this image should contribute/);
  assert.match(contextBlock, /forma-reference-findings/); assert.match(findings, /Add as decision/); assert.match(findings, /source_reference_block_id/); assert.match(findings, /source_finding_kind/); assert.match(findings, /sampleImageUrl/);
  assert.match(eventsApi, /deterministic-image-suite-v2/); assert.match(eventsApi, /reference_findings/); assert.match(scenarios, /palette, mood, composition, material, lighting, and spatial findings/);
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
  assert.match(alternatives,/created_from:\s*"context-board"/);assert.match(alternatives,/created_from:\s*"guided-brief"/);assert.match(alternatives,/forma-studio-navigator/);
  assert.match(editorAlternatives,/application\/x-forma-reality/);assert.match(editorAlternatives,/created_from:"reality-layers"/);assert.match(editorAlternatives,/BlockWeightSet/);assert.match(editorAlternatives,/created_from:"adaptive-path"/);assert.match(editorAlternatives,/related_block_ids/);
  assert.match(editorAlternatives,/layer-create-dialog/);assert.match(editorAlternatives,/Save layer/);assert.match(editorAlternatives,/Duplicate/);assert.match(editorAlternatives,/structureAdaptive/);assert.match(eventsApi,/structure_adaptive/);assert.match(adapter,/forma_adaptive_structure/);
  assert.match(blockTypes,/type:"audience"/);assert.match(blockTypes,/type:"environment"/);assert.match(blockTypes,/type:"accessibility"/);assert.match(blockTypes,/BLOCK_GROUPS/);assert.match(blockTypes,/Purpose & audience/);assert.match(blockTypes,/Grounding evidence/);assert.match(workspace,/BLOCK_GROUPS\.map/);assert.match(workspace,/block-type-catalog/);assert.match(workspace,/System-suggested subtype/);
  assert.match(shell,/forma-reality-layers/);assert.match(shell,/forma-adaptive-path/);assert.match(styles,/\.reality-editor/);assert.match(styles,/\.adaptive-workspace/);
  assert.doesNotMatch(`${workspace}${library}${styles}`,/studio-sidebar|library-tree/);assert.match(styles,/\.project-rail/);
  assert.match(workspace,/\?disabled=\$\{!canCompare\}/);assert.match(store,/canUndo/);assert.match(store,/canRedo/);assert.match(styles,/\.document-bar \{ position: sticky/);
  assert.match(outputCard,/Taste evidence/);assert.match(outputCard,/taste-axis-grid/);assert.match(outputCard,/Record taste evidence/);
  assert.match(shell,/system#governance/);assert.match(shell,/Use attention signals to improve Forma/);assert.match(system,/id="governance"/);assert.match(system,/Forget attention data/);
});

test("keeps account, project, document, intelligence, and administration scopes distinct",async()=>{
  const [shell,rail,navigation,areas,contents,library,sessions,scout,memory,system,admin,collections,styles,review]=await Promise.all([
    "forma-shell.ts","project-rail.ts","studio-navigation.ts","area-navigation.ts","forma-project-contents.ts","forma-library.ts","forma-sessions.ts","forma-scout.ts","forma-memory.ts","forma-system.ts","forma-admin-events.ts","collection-tree.ts",
  ].map((file)=>readFile(new URL(`../src/components/${file}`,import.meta.url),"utf8")).concat([
    readFile(new URL("../src/styles.css",import.meta.url),"utf8"),
    readFile(new URL("../docs/information-architecture-review.md",import.meta.url),"utf8"),
  ]));
  assert.match(shell,/label: "Projects"/);assert.match(shell,/label: "Studio"/);assert.match(shell,/label: "Re-entry"/);assert.match(shell,/label: "Taste & time"/);
  assert.doesNotMatch(shell.match(/const routes = \[[\s\S]*?\] as const;/)?.[0]??"",/System|Event admin/);assert.match(shell,/class="account-nav"/);assert.match(shell,/System & governance/);assert.match(shell,/Event operations/);
  assert.match(rail,/rail-project-card/);assert.match(rail,/rail-dock/);assert.match(rail,/aria-controls="project-rail-content"/);assert.match(rail,/Project destinations/);assert.match(rail,/Project library/);assert.match(rail,/Creative history/);
  assert.match(navigation,/aria-label="Document views"/);assert.doesNotMatch(navigation,/Project-level|studio-project-overview/);assert.match(navigation,/studio-breadcrumbs/);assert.match(navigation,/Projects/);
  assert.doesNotMatch(contents,/forma-studio-mode-nav|forma-studio-navigator/);assert.match(library,/Project library/);assert.match(collections,/destination==="\/library"/);
  for(const [source,active] of [[sessions,"sessions"],[scout,"scout"],[memory,"memory"]])assert.match(source,new RegExp(`forma-area-navigation area="intelligence" active="${active}"`));
  assert.match(system,/area="administration" active="system"/);assert.match(admin,/area="administration" active="events"/);assert.match(areas,/Creative intelligence/);assert.match(areas,/Administration/);
  assert.match(styles,/\.rail-dock/);assert.match(styles,/\.area-navigation/);assert.match(styles,/\.studio-breadcrumbs/);assert.match(styles,/\.block-type-group/);assert.doesNotMatch(styles,/global-nav a:nth-child/);
  assert.match(review,/Deficiencies found and resolved/);assert.match(review,/Primary navigation/);assert.match(review,/Follow-up evaluation/);
});

test("never gives a rounded element an imbalanced border or simulated edge",async()=>{
  const [styles,review]=await Promise.all([
    readFile(new URL("../src/styles.css",import.meta.url),"utf8"),
    readFile(new URL("../docs/information-architecture-review.md",import.meta.url),"utf8"),
  ]);
  const rules=[...styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)].flatMap(([,selectorList,body])=>
    selectorList.split(",").map((selector)=>({selector:selector.trim(),body})),
  );
  const rounded=rules.filter(({body})=>/\bborder-radius\s*:/.test(body)).map(({selector})=>selector);
  const directional=rules.filter(({body})=>/\bborder-(?:top|right|bottom|left)(?:-(?:width|style|color))?\s*:/.test(body));
  const violations=directional.filter(({selector})=>rounded.some((base)=>
    selector===base||selector.startsWith(`${base}.`)||selector.startsWith(`${base}:`)||selector.startsWith(`${base}[`),
  ));
  assert.deepEqual(violations.map(({selector})=>selector),[]);
  const insetOffsets=[...styles.matchAll(/\binset\s+(-?(?:\d*\.)?\d+)(?:[a-z%]+)?\s+(-?(?:\d*\.)?\d+)(?:[a-z%]+)?/gi)];
  const insetShadowCount=[...styles.matchAll(/\bbox-shadow\s*:\s*([^;{}]+)/gi)].reduce((count,[,value])=>count+[...value.matchAll(/\binset\b/gi)].length,0);
  assert.ok(insetOffsets.length>0,"expected balanced inset highlights to remain covered by the invariant");
  assert.equal(insetOffsets.length,insetShadowCount,"every inset shadow must declare auditable numeric x/y offsets first");
  assert.deepEqual(insetOffsets.filter(([,x,y])=>Number(x)!==0||Number(y)!==0).map((match)=>match[0]),[]);
  assert.match(styles,/\.rail-links a\.active \{[^}]*box-shadow: inset 0 0 0/);
  assert.match(styles,/\.observation-card \{[^}]*box-shadow: inset/);
  assert.match(styles,/\.belief-card \{[^}]*box-shadow: inset/);
  assert.match(styles,/\.blame-cluster \{[^}]*box-shadow: inset/);
  assert.match(review,/must not simulate an imbalanced border with an offset inset shadow/);
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
