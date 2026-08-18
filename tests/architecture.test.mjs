import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { exportArchive, importArchive } from "../src/model/archive.ts";
import { buildScenario, explainReplayEvent, SCENARIOS, SCENARIO_EVENT_TYPES } from "../src/model/scenarios.ts";
import { BLOCK_TYPES } from "../src/model/block-types.ts";
import { foldEvents } from "../src/model/events.ts";
import { applicationIdFromRoute } from "../src/platform/applications.ts";

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

test("delivers prompt fans as one generation with explicit member promotion", async () => {
  const [review, generations, worker] = await Promise.all([
    readFile(new URL("../src/components/prompt-fan-review.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/document-generations.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/events-api.ts", import.meta.url), "utf8"),
  ]);
  assert.match(generations, /generationHistoryItems/);
  assert.match(generations, /forma-prompt-fan-visual/);
  assert.match(review, /One generation, four ways to hand off the plan/);
  assert.match(review, /Promote image/);
  assert.match(review, /Promote all/);
  assert.match(review, /Use as default/);
  assert.match(review, /Apply default to/);
  assert.match(worker, /PromptFanOutputPromoted/);
});

test("keeps every replay fixture current and every mocked event specifically explained", () => {
  assert.ok(SCENARIOS.length >= 8);
  const stories = new Set();
  for (const scenario of SCENARIOS) {
    const events=buildScenario(scenario.key,SCENARIO_EVENT_TYPES.length*3);
    events.forEach((event,index)=>{const story=explainReplayEvent(event,index?events[index-1]:undefined);assert.doesNotMatch(story.action,/ appended /);assert.match(story.trigger,/^This happens/);assert.ok(story.trigger.length>70);assert.ok(story.value.length>40);assert.match(story.cause,/actor /);stories.add(`${event.type}:${story.value}`);});
  }
  assert.ok(stories.size>=SCENARIO_EVENT_TYPES.length);
  const taste=buildScenario("taste-time",13); const compile=taste.find((event)=>event.type==="ContextCompiled"); const complete=taste.find((event)=>event.type==="GenerationCompleted"); const critique=taste.find((event)=>event.type==="ObjectCritiqued");
  assert.equal(compile?.payload.generation_id,complete?.payload.generation_id); assert.ok(complete?.payload.object_ids.includes(critique?.payload.object_id)); assert.ok(compile?.payload.source_block_versions.length);
  assert.ok(buildScenario("attention-friction",12).some((event)=>event.type==="AttentionSignalsForgotten"));
  const evolution=buildScenario("document-evolution",SCENARIO_EVENT_TYPES.length*3);const evolutionProjection=foldEvents(evolution);assert.ok(evolution.some((event)=>event.type==="BlockRelationAdded"));assert.ok(evolution.some((event)=>event.type==="BlockRelationRemoved"));assert.ok(evolutionProjection.libraryBlockRelations.some((relation)=>relation.kind==="style_reference"));assert.ok(evolutionProjection.libraryBlockRelations.some((relation)=>relation.kind==="subject_reference"));
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
  assert.match(html, /<title>Create — Forma<\/title>/);
  assert.match(html, /forma-shell/);
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.match(hosting, /appgprj_/);
});

test("codifies and applies a gallery-first accessible design system", async () => {
  const [design, main, system, editor, generations] = await Promise.all([
    readFile(new URL("../DESIGN.md", import.meta.url), "utf8"),
    readFile(new URL("../src/main.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/design-system.css", import.meta.url), "utf8"),
    readFile(new URL("../src/components/library-block-editor.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/document-generations.ts", import.meta.url), "utf8"),
  ]);
  assert.match(design, /quiet creative instrument/i);
  assert.match(design, /White space is the primary container/);
  assert.match(design, /No layout-affecting hover reveal/);
  assert.match(design, /No text below 10px/);
  assert.match(design, /No imbalanced border on a rounded element/);
  assert.match(main, /import "\.\/design-system\.css"/);
  assert.match(system, /Gallery-first interface system/);
  assert.match(system, /font-family: var\(--sans\)/);
  assert.match(system, /\.asset-focus-trigger \.reference-image img/);
  assert.doesNotMatch(system, /box-shadow:\s*inset/);
  assert.doesNotMatch(system, /:hover[^{}]*\{[^}]*transform:\s*(?:translate|scale)/s);
  assert.match(editor, /context-collapsed/);
  assert.match(editor, /filing-collapsed/);
  assert.match(editor, /aria-label="Collapse project context"/);
  assert.match(generations, /document-generation-collapse/);
  assert.match(generations, /Collapse images/);
});

test("treats context block hover as a stable row instead of a new container", async () => {
  const [styles, design] = await Promise.all([
    readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../src/design-system.css", import.meta.url), "utf8"),
  ]);
  for (const sheet of [styles, design]) {
    assert.match(sheet, /\.block-list\s*\{[^}]*gap:\s*0/);
    const contextRule = sheet.match(/\.context-block\s*\{[^}]*\}/)?.[0] ?? "";
    assert.match(contextRule, /border:\s*0;[^}]*border-bottom:\s*1px solid var\(--line\)/);
    assert.doesNotMatch(contextRule, /border-radius/);
    assert.match(sheet, /\.context-block:hover\s*\{[^}]*background:[^}]*border-bottom-color:\s*var\(--line-strong\)/);
  }
});

test("anchors selectable output, context, and project cards without clipped decoration", async () => {
  const [styles, design, context, projects] = await Promise.all([
    readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../src/design-system.css", import.meta.url), "utf8"),
    readFile(new URL("../src/components/context-block.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/forma-projects.ts", import.meta.url), "utf8"),
  ]);
  for (const sheet of [styles, design]) {
    assert.match(sheet, /\.output-card\s*\{[^}]*border:\s*3px solid transparent/);
    assert.match(sheet, /\.output-card\.selected\s*\{[^}]*border-color:\s*var\(--orange\)/);
    assert.doesNotMatch(sheet, /\.output-card\.selected\s*\{[^}]*outline-offset/);
  }
  assert.match(design, /\.output-card\.selected\s*\{[^}]*outline:\s*0/);
  assert.match(context, /block-intent-badge/);
  assert.match(context, /block-classifiers/);
  assert.ok(context.indexOf("block-classifiers") > context.indexOf("block-copy"));
  assert.match(projects, /project-card-summary/);
  assert.match(projects, /Continue working/);
  assert.match(projects, /View project contents/);
  assert.doesNotMatch(projects, /Created at event/);
  assert.match(design, /\.project-card\s*\{[^}]*border:\s*1px solid var\(--line\);[^}]*border-radius:\s*14px/);
  assert.match(design, /\.project-card\.current\s*\{[^}]*border-color:\s*var\(--orange\)/);
});

test("keeps Studio composition wrappers free of redundant page padding", async () => {
  const [styles, design] = await Promise.all([
    readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../src/design-system.css", import.meta.url), "utf8"),
  ]);
  for (const sheet of [styles, design]) {
    const wrappers = [...sheet.matchAll(/(?:\.context-column\s*,\s*\.output-column|(?:html\[data-document-focus\]\s+)?\.studio-subpage-body)\s*\{[^}]*\}/g)].map((match) => match[0]);
    assert.ok(wrappers.length > 0);
    for (const rule of wrappers) assert.doesNotMatch(rule, /padding/);
  }
  assert.match(design, /\.context-column > \.section-heading,[\s\S]*?\.output-column > \.section-heading\s*\{[^}]*padding:/);
});

test("packages first-class HTML entry points for every named application route", async () => {
  const plugin = await readFile(new URL("../build/sites-vite-plugin.ts", import.meta.url), "utf8");
  const applications = await readFile(new URL("../src/platform/applications.ts", import.meta.url), "utf8");
  const routeLoader = await readFile(new URL("../src/route-loader.ts", import.meta.url), "utf8");
  const shell = await readFile(new URL("../src/components/forma-shell.ts", import.meta.url), "utf8");
  const worker = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  const config = await readFile(new URL("../vite.config.ts", import.meta.url), "utf8");
  const routes = ["creative","creative/create","document","projects","studio/project","studio/board","studio/guided","studio/layers","studio/adaptive","studio/editor","studio/chat","library","sessions","scout","memory","operations","operations/events","operations/events/permissions","laboratory","laboratory/replay","laboratory/focal-points","system","system/focal-points","admin/events","admin/events/stream","admin/events/replay","admin/events/permissions"];
  for (const route of routes) {
    assert.match(applications, new RegExp(`route\\("/${route.replaceAll("/", "\\/")}"`));
    const entry = await readFile(new URL(`../dist/client/${route}/index.html`, import.meta.url), "utf8");
    const direct = await readFile(new URL(`../dist/client/${route}.html`, import.meta.url), "utf8");
    assert.match(entry, /<forma-shell><\/forma-shell>/); assert.match(entry, new RegExp(`content="/${route.replaceAll("/", "\\/")}"`));
    assert.match(entry, new RegExp(`data-forma-route-module="/${route.replaceAll("/", "\\/")}"`));
    assert.match(entry,new RegExp(`data-forma-application="${applicationIdFromRoute(`/${route}`)}"`));
    assert.match(direct, /\/assets\/entry-[^"/]+\.js/);
  }
  const rootEntry = await readFile(new URL("../dist/client/index.html", import.meta.url), "utf8");
  const shareEntry = await readFile(new URL("../dist/client/share/index.html", import.meta.url), "utf8");
  assert.match(rootEntry, /data-forma-route-module="\/"/); assert.match(shareEntry, /data-forma-application="creative"/);
  assert.match(config, /manifest: true/); assert.match(config, /run_worker_first: \["\/\*"\]/); assert.match(worker, /resolveServerRoute\(url\.pathname\)/); assert.match(worker, /x-forma-route-family/); assert.doesNotMatch(worker, /entryPath=.*index\.html/); assert.match(applications,/resolveServerRoute/);assert.match(applications,/\/document\\\/\[\^\/\]\+/);assert.match(applications,/\/library\\\//);
  assert.match(plugin,/SITE_ROUTE_ENTRIES/);assert.match(routeLoader,/\.\/apps\/creative\/entry/);assert.match(routeLoader,/\.\/apps\/operations\/entry/);assert.match(routeLoader,/\.\/apps\/laboratory\/entry/);
  assert.match(shell, /addEventListener\("forma-route-changed", this\.#routeChanged\)/); assert.match(shell, /loadRouteComponent\(path\)/);
  assert.match(shell,/forma-creative-application/);assert.match(shell,/forma-operations-application/);assert.match(shell,/forma-laboratory-application/);
  assert.doesNotMatch(shell, /<forma-library|<forma-admin-events|<forma-system|<forma-focal-point-lab/);
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
  assert.match(admin, /\/operations\/events/); assert.match(admin, /\/laboratory\/replay/); assert.match(admin, /\/operations\/events\/permissions/);
  assert.match(admin, /adminTabFromPath/); assert.match(admin, /href=\$\{adminTabPath/); assert.match(admin, /store\.setRoute\(adminTabPath\(tab\)\)/);
  assert.match(routes, /`\/document\/\$\{encodeURIComponent\(documentId\)\}/); assert.match(routes, /documentSlug/); assert.match(routes, /documentIdFromRoute/); assert.match(routes, /isDocumentViewRoute/); assert.match(routes, /documentFocusFromRoute/); assert.match(routes, /withDocumentFocusInRoute/);
  assert.match(store, /syncDocumentFromRoute/); assert.match(store, /shared-document-url/); assert.match(store, /replaceState/);
  assert.match(shell, /syncDocumentFromRoute\(path\)/); assert.match(shell, /withDocumentInRoute/);
  assert.match(navigation, /withDocumentInRoute/); assert.match(rail, /withDocumentInRoute/);
});

test("restores focused Library dialogs from durable URLs", async () => {
  const [library, routes, worker, applications] = await Promise.all([
    readFile(new URL("../src/components/forma-library.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/model/routes.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/platform/applications.ts", import.meta.url), "utf8"),
  ]);
  assert.match(routes, /LibraryFocusKind/); assert.match(routes, /\/library\/\$\{kind\}\/\$\{encodeURIComponent\(id\)\}/); assert.match(routes, /libraryFocusFromRoute/);
  assert.match(library, /libraryFocusRoute\("block"/); assert.match(library, /libraryFocusRoute\("output"/); assert.match(library, /libraryFocusRoute\("family"/);
  assert.match(library, /libraryRootRoute/); assert.match(library, /replace:true/); assert.doesNotMatch(library, /#focused(?:Block|Output|Family)Id/);
  assert.match(worker, /resolveServerRoute/); assert.match(applications, /route\("\/library"/);assert.match(applications,/canonicalFamily: "\/library\/:focus\/:id"/); assert.doesNotMatch(routes, /documentEntryPath[\s\S]*?index\.html/);
});

test("edits project-scoped reusable blocks through the Library and shared project folders",async()=>{
  const [editor,library,tree,projects,events,routes,worker]=await Promise.all([
    readFile(new URL("../src/components/library-block-editor.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/components/forma-library.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/components/collection-tree.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/components/forma-project-contents.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/model/events.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/model/routes.ts",import.meta.url),"utf8"),
    readFile(new URL("../worker/events-api.ts",import.meta.url),"utf8"),
  ]);
  assert.match(editor,/scope:"library"/);assert.match(editor,/project_id:p\.projectId/);assert.match(editor,/forked_from_block_id/);
  assert.match(editor,/BlockPropertyEdited/);assert.match(editor,/BlockWeightSet/);assert.match(editor,/BlockRemoved/);assert.match(editor,/BlockLocked/);
  assert.match(editor,/Related reference images/);assert.match(editor,/BlockRelationAdded/);assert.match(editor,/BlockRelationRemoved/);assert.match(editor,/subject_reference/);assert.doesNotMatch(editor,/<legend>Block identity|<legend>Reusable content/);
  assert.match(editor,/CollectionItemAdded/);assert.match(editor,/item_ref:\{block_id:id\}/);assert.match(editor,/forma-collection-tree/);
  assert.match(library,/forma-library-block-editor/);assert.match(library,/New reusable block/);assert.match(library,/Fork & edit/);
  assert.match(tree,/itemKind/);assert.match(tree,/block_id:id/);assert.match(worker,/ref\.block_id/);
  assert.match(projects,/Independent project context/);assert.match(projects,/block\.scope==="library"/);
  assert.match(events,/scope: "document" \| "library"/);assert.match(events,/b\.projectId===state\.projectId/);
  assert.match(events,/libraryBlockRelations/);assert.match(worker,/BlockRelationAdded/);assert.match(worker,/BlockRelationRemoved/);
  assert.match(routes,/libraryBlockEditorFromRoute/);assert.match(routes,/libraryBlockEditorRoute/);
});

test("presents every alternate Studio lens as the same complete durable document", async () => {
  const [alternatives, editorAlternatives, creativeEditor, navigation, generations, styles] = await Promise.all([
    readFile(new URL("../src/components/forma-studio-alternatives.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/forma-studio-editor-alternatives.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/forma-creative-editor.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/studio-navigation.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/document-generations.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
  ]);
  assert.match(alternatives, /forma-document-continuity/); assert.match(alternatives, /forma-document-generations/); assert.match(alternatives, /view="guided" presentation="compact"/); assert.match(alternatives, /Next useful move/); assert.match(alternatives, /Whole-document check/);
  assert.match(alternatives, /projection\.blocks|projection\.get\(\)\.blocks/); assert.match(alternatives, /BLOCK_GROUPS/);
  assert.match(editorAlternatives, /Everything in this document/); assert.match(editorAlternatives, /supportingBlocks/); assert.match(editorAlternatives, /Why this is next/); assert.match(editorAlternatives, /What this unlocks/);
  assert.match(editorAlternatives, /view="layers" presentation="canvas"/); assert.match(editorAlternatives, /view="adaptive" presentation="rail"/);
  assert.match(creativeEditor, /projection\.blocks/); assert.match(creativeEditor, /Everything shaping the work/); assert.match(creativeEditor, /continuity: false/); assert.match(creativeEditor, /inspector: false/); assert.match(creativeEditor, /quietRail: true/);
  assert.match(creativeEditor, /BlockCreated/); assert.match(creativeEditor, /BlockPropertyEdited/); assert.match(creativeEditor, /BlockWeightSet/); assert.match(creativeEditor, /BlockRemoved/);
  assert.match(creativeEditor, /The brief/); assert.match(creativeEditor, /The picture/); assert.match(creativeEditor, /The look/); assert.match(creativeEditor, /The guardrails/); assert.match(creativeEditor, /Visual references/);
  assert.doesNotMatch(creativeEditor, />Event|>Metadata|>Provenance|Creative history|source events/i);
  assert.match(navigation, /projection\.blocks\.length/); assert.match(navigation, /generationHistoryItems\(projection\.outputs\)/); assert.match(navigation, /Every saved decision and result/);
  assert.match(navigation, /Creative editor/);
  assert.match(navigation, /Add context/);assert.match(navigation, /copyLibraryBlockSet/);assert.match(navigation, /Add context set/);
  assert.match(generations, /projection\.get\(\)\.outputs/); assert.match(generations, /Results from this document/); assert.match(generations, /"full"\s*\|\s*"compact"\s*\|\s*"canvas"\s*\|\s*"rail"/); assert.match(generations, /interactive/);
  assert.match(navigation, /DOCUMENT_FOCUS_KEY/); assert.match(navigation, /data-document-focus/); assert.match(navigation, /Focus view/); assert.match(navigation, /Exit focus/); assert.match(navigation, /event\.key === "Escape"/); assert.match(navigation, /withDocumentFocusInRoute/); assert.match(navigation, /documentFocusFromRoute/);
  assert.match(styles, /\.creative-editor \{[^}]*grid-template-rows: auto minmax\(0,1fr\)[^}]*height: clamp\(590px,72dvh,780px\)/);
  assert.match(styles, /\.creative-editor-layout \{[^}]*min-height: 0;[^}]*overflow: hidden/);
  assert.match(styles, /\.creative-editor-tools,\.creative-editor-inspector \{[^}]*overflow-y: auto;[^}]*overscroll-behavior: contain/);
  assert.match(styles, /html\[data-document-focus\] \.workspace-page \{[^}]*grid-template-columns: minmax\(0,1fr\)/);
  assert.match(styles, /html\[data-document-focus\] \.workspace-page:has\(> forma-project-rail > \.project-rail\.collapsed\) \{ grid-template-columns: minmax\(0,1fr\); \}/);
  assert.match(styles, /html\[data-document-focus\] \.workspace-page > forma-project-rail \{ display: none; \}/);
  assert.match(styles, /html\[data-document-focus\] \.workspace-page:has\(> forma-project-rail > \.project-rail\.collapsed\) \.composer-dock \{ left: 0; \}/);
  assert.match(styles, /html\[data-document-focus\] \.studio-subpage-body \{[^}]*max-width: none;[^}]*margin: 0/);
  assert.match(styles, /html\[data-document-focus\] \.studio-subpage-body > \* \{ border-radius: 0; \}/);
  assert.match(styles, /html\[data-document-focus\] \.studio-subpage-body > \.creative-editor,[\s\S]*\.studio-subpage-body > \.chat-workspace \{ border: 0; box-shadow: none; \}/);
  assert.match(styles, /html\[data-document-focus\] \.creative-editor,[\s\S]*height: calc\(100dvh - 70px\)/);
});

test("keeps the Chat document view conversational while resolving durable changes and two-stage images",async()=>{
  const [chat,store,jobsApi,eventsApi,adapter,routes]=await Promise.all([
    readFile(new URL("../src/components/forma-chat-studio.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/state/store.ts",import.meta.url),"utf8"),
    readFile(new URL("../worker/document-jobs-api.ts",import.meta.url),"utf8"),
    readFile(new URL("../worker/events-api.ts",import.meta.url),"utf8"),
    readFile(new URL("../worker/openai-adapter.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/model/routes.ts",import.meta.url),"utf8"),
  ]);
  assert.match(chat,/Chat with Forma/);assert.match(chat,/page-header--document/);assert.match(chat,/studio-subpage-body--chat/);assert.match(chat,/forma-output-visual/);assert.match(chat,/store\.chat\(message,this\.#livePreview\)/);assert.match(chat,/forma-generation-actions/);assert.match(chat,/outputQualityLabel/);
  assert.match(chat,/#livePreview=true/);assert.match(chat,/type="checkbox"/);assert.match(chat,/>Live preview</);assert.match(chat,/Keep chatting without generating an image/);
  assert.doesNotMatch(chat,/forma-context-block|forma-event-inspector|forma-document-continuity|projection\.blocks/);
  assert.match(store,/#startDocumentJob\("chat"/);assert.match(store,/\{message,livePreview,documentId/);assert.match(store,/#startDocumentJob\("preview"/);assert.match(store,/sourcePreviewId/);assert.match(store,/documentPreviewProgress/);assert.match(store,/#driveDocumentJob/);assert.match(jobsApi,/\/run/);assert.match(jobsApi,/runWithHeartbeat/);assert.match(jobsApi,/status='running'/);assert.match(jobsApi,/queueFollowupPreview/);assert.doesNotMatch(jobsApi,/ctx\.waitUntil/);assert.match(eventsApi,/body\.action==="chat"/);assert.match(eventsApi,/body\.action==="preview"/);assert.match(eventsApi,/livePreview=body\.livePreview!==false/);assert.match(eventsApi,/previewQueued=livePreview&&generated\.output\.preview_worthy/);assert.match(eventsApi,/followupJob:directionStored/);assert.match(eventsApi,/creativeChatMutationEvents/);assert.match(eventsApi,/IdeationPreviewCompleted/);assert.match(eventsApi,/IdeationPromoted/);assert.match(eventsApi,/reference_preview_event_id/);
  assert.ok(eventsApi.indexOf("creativeChatMutationEvents")<eventsApi.indexOf("followupJob:directionStored"),"Chat mutations must commit before the optional image follow-up is queued");
  assert.match(adapter,/quality=options\.quality\?\?"high"/);assert.match(adapter,/images\/edits/);assert.match(adapter,/partial_images/);assert.match(adapter,/output_compression/);assert.match(routes,/"chat"/);
});

test("runs document async work as durable reconnectable server jobs",async()=>{
  const [schema,runtime,worker,jobs,store,actions]=await Promise.all([
    readFile(new URL("../db/schema.ts",import.meta.url),"utf8"),
    readFile(new URL("../worker/runtime.ts",import.meta.url),"utf8"),
    readFile(new URL("../worker/index.ts",import.meta.url),"utf8"),
    readFile(new URL("../worker/document-jobs-api.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/state/store.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/components/generation-actions.ts",import.meta.url),"utf8"),
  ]);
  for(const source of [schema,runtime])assert.match(source,/document_jobs/);
  assert.match(worker,/\/api\/document-jobs/);assert.match(worker,/WorkerExecutionContext/);assert.match(worker,/context/);
  assert.match(jobs,/lease_expires_at/);assert.match(jobs,/\/run/);assert.match(jobs,/runWithHeartbeat/);assert.match(jobs,/renewJobLease/);assert.match(jobs,/documentJobMaxAttempts/);assert.match(jobs,/failStaleJob/);assert.match(jobs,/releaseInterruptedAttempt/);assert.match(jobs,/correlationId/);assert.match(jobs,/notified_at/);assert.match(jobs,/context\?\.waitUntil\(driveDocumentQueue/);assert.match(jobs,/reconcilePromptFanParent/);
  for(const kind of ["preview","generate","prompt_fan","chat","structure_adaptive","extract_reference"])assert.match(store,new RegExp(`#startDocumentJob\\("${kind}"`));
  assert.match(store,/visibilitychange/);assert.match(store,/#jobResultVisible/);assert.match(store,/#pendingJobNotices/);assert.match(store,/#driveDocumentJobs/);assert.match(store,/documentJobIsStale/);assert.match(store,/documentGenerationRevision/);assert.match(store,/documentJobForRequest/);assert.match(store,/\/ack/);
  assert.match(jobs,/generationRequestIdentity/);assert.match(jobs,/requestKey/);assert.match(jobs,/candidates\.find/);
  assert.match(actions,/documentJobActionLabel/);assert.match(actions,/documentJobForRequest/);assert.match(actions,/Images in progress/);assert.match(actions,/Current document state/);assert.match(actions,/Earlier document state/);assert.match(actions,/closedby="any"/);
});

test("opens otherwise passive generation and reference images in contained dialogs",async()=>{
  const [visual,reference,creative,projectContents,shared]=await Promise.all([
    readFile(new URL("../src/components/output-visual.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/components/reference-image.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/components/forma-creative-editor.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/components/forma-project-contents.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/components/forma-shared-view.ts",import.meta.url),"utf8"),
  ]);
  assert.match(visual,/interactive/);assert.match(visual,/generated-image-viewer/);assert.match(visual,/showModal\(\)/);assert.match(visual,/closedby="any"/);
  assert.match(reference,/reference-viewer/);assert.match(reference,/closedby="any"/);
  assert.match(creative,/\.interactive=\$\{true\}/);assert.match(creative,/forma-reference-image/);
  assert.match(projectContents,/\.interactive=\$\{true\}/);assert.match(shared,/\.interactive=\$\{true\}/);
});

test("keeps toast feedback above open modal dialogs",async()=>{
  const shell=await readFile(new URL("../src/components/forma-shell.ts",import.meta.url),"utf8");
  assert.match(shell,/popover="manual"/);assert.match(shell,/showPopover\(\)/);assert.match(shell,/MutationObserver/);
});

test("explains comparison changes as creative actions instead of block ids",async()=>{
  const workspace=await readFile(new URL("../src/components/forma-workspace.ts",import.meta.url),"utf8");
  assert.match(workspace,/Creative decisions between these results/);assert.match(workspace,/affected area moved from/);assert.match(workspace,/intent changed from/);assert.doesNotMatch(workspace,/<b>\$\{d\.id\}<\/b>/);
});

test("lets Reference blocks prepare, adopt, and opt pixels into image generation", async () => {
  const [extractors, workspace, contextBlock, pixelPolicy, findings, eventsApi, adapter, scenarios, replayCoverage] = await Promise.all([
    readFile(new URL("../src/model/extractors.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/forma-workspace.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/context-block.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/reference-pixel-policy.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/reference-findings.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/events-api.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/openai-adapter.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/model/scenarios.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/model/replay-coverage.ts", import.meta.url), "utf8"),
  ]);
  for (const kind of ["palette", "mood", "composition", "material", "lighting", "spatial"]) assert.match(extractors, new RegExp(`kind: "${kind}"`));
  assert.match(workspace, /extraction_preferences/); assert.match(workspace, /REFERENCE_FINDING_OPTIONS/); assert.match(workspace, /Choose what this image should contribute/);
  assert.match(contextBlock, /forma-reference-findings/);assert.match(contextBlock,/forma-reference-pixel-policy/);assert.match(pixelPolicy,/pixel_reference_mode/);assert.match(pixelPolicy,/Original pixels/); assert.match(findings, /Add as decision/); assert.match(findings, /source_reference_block_id/); assert.match(findings, /source_finding_kind/); assert.match(findings, /sampleImageUrl/);
  assert.match(eventsApi, /deterministic-image-suite-v2/); assert.match(eventsApi, /uploadedPixelReferences/);assert.match(eventsApi,/reference_pixel_rights_required/);assert.match(adapter,/Never create a reference item through chat/);assert.match(adapter,/multiple-image-input|image\[\]/); assert.match(scenarios, /palette, mood, composition, material, lighting, and spatial findings/);assert.match(replayCoverage,/reference-pixel-handoff/);
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
  assert.match(schema, /private_content/); assert.match(schema, /budget_counters/); assert.match(schema, /budget_reservations/); assert.match(envExample, /OPENAI_API_KEY=/);
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
  const [eventsApi, store, creativeEntry, applications, scoutPage, memoryPage, scoutModel, tasteModel, outputCard, coverage, classification] = await Promise.all([
    readFile(new URL("../worker/events-api.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/state/store.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/apps/creative/entry.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/platform/applications.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/forma-scout.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/forma-memory.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/model/scout.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/model/taste.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/output-card.ts", import.meta.url), "utf8"),
    readFile(new URL("../docs/plan-coverage.md", import.meta.url), "utf8"),
    readFile(new URL("../docs/event-classification.csv", import.meta.url), "utf8"),
  ]);
  assert.match(creativeEntry, /forma-scout/); assert.match(creativeEntry, /forma-memory/); assert.match(applications, /"\/scout"/); assert.match(applications, /"\/memory"/);
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

test("keeps document-view workflow evidence durable and separate from aesthetic taste",async()=>{
  const [shell,observer,eventsApi,signals,brief,scout,taste,sessionsPage,scoutPage,memoryPage,classification]=await Promise.all([
    readFile(new URL("../src/components/forma-shell.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/components/forma-attention-observer.ts",import.meta.url),"utf8"),
    readFile(new URL("../worker/events-api.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/model/document-view-signals.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/model/brief.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/model/scout.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/model/taste.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/components/forma-sessions.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/components/forma-scout.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/components/forma-memory.ts",import.meta.url),"utf8"),
    readFile(new URL("../docs/event-classification.csv",import.meta.url),"utf8"),
  ]);
  assert.match(shell,/DocumentViewVisited/);assert.match(observer,/document_view/);assert.match(eventsApi,/normalizeDocumentView/);assert.match(eventsApi,/workflow_policy:\{ui_routing_only:true,generation_input:false/);
  assert.match(signals,/visits \* \.18/);assert.match(signals,/outcomes \+/);assert.match(brief,/document_view/);assert.match(scout,/type:"workflow"/);assert.match(taste,/documentViewWorkflow/);
  assert.match(sessionsPage,/Working-mode acceptance/);assert.match(scoutPage,/Where progress is happening/);assert.match(memoryPage,/Working-mode memory/);assert.match(memoryPage,/excluded from generation input/);
  assert.match(classification,/DocumentViewVisited,behavioral,structured_only,user,immutable/);
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
  assert.match(library,/Keep for reuse/);assert.match(library,/A four-image fan remains one result/);assert.doesNotMatch(library,/Project contents|Open in Studio/);
  assert.match(contents,/Project contents/);assert.match(contents,/>Open \$\{icon\("arrow"\)\}/);assert.match(contents,/openDocument/);
  assert.match(eventsModel,/DocumentOpened/);assert.match(eventsApi,/DocumentOpened/);assert.match(store,/openDocument/);assert.match(classification,/DocumentOpened,behavioral/);
  assert.match(eventsModel,/ProjectOpened/);assert.match(eventsApi,/ProjectOpened/);assert.match(store,/openProject/);assert.match(classification,/ProjectOpened,behavioral/);
  assert.match(eventsModel,/DocumentRemoved/);assert.match(eventsApi,/DocumentRemoved/);assert.match(store,/removeDocument/);assert.match(classification,/DocumentRemoved,user_content/);
  assert.match(collections,/File open document/);assert.match(collections,/New nested collection/);assert.match(collections,/>\$\{icon\("edit"\)\} Rename</);assert.match(collections,/tree-menu/);assert.doesNotMatch(collections,/tree-actions/);assert.match(collections,/collection-dialog/);assert.doesNotMatch(collections,/window\.prompt/);
  assert.match(workspace,/project-settings-dialog/);assert.match(workspace,/type:BlockKind/);assert.match(workspace,/block-composer-dialog/);
  assert.match(workspace,/forma-project-rail surface="studio"/);assert.match(library,/forma-project-rail surface="library"/);assert.match(projectRail,/Library overview/);assert.match(projectRail,/Project overview/);assert.doesNotMatch(projectRail,/All documents/);assert.match(projectRail,/No auto-filing/);assert.match(projectRail,/rail-collapse-toggle/);
  assert.match(workspace,/studio-document-delete-dialog/);assert.match(contents,/project-document-delete-dialog/);assert.match(`${workspace}${contents}`,/Remove document/);
  assert.match(shell,/this\.#route\("\/projects"\)/);assert.match(projects,/New project/);assert.match(navigation,/Context board/);assert.match(navigation,/Guided brief/);assert.match(navigation,/Reality layers/);assert.match(navigation,/Adaptive path/);
  assert.match(alternatives,/created_from:\s*"context-board"/);assert.match(alternatives,/created_from:\s*"guided-brief"/);assert.match(alternatives,/forma-studio-navigator/);
  assert.match(editorAlternatives,/application\/x-forma-reality/);assert.match(editorAlternatives,/created_from:"reality-layers"/);assert.match(editorAlternatives,/BlockWeightSet/);assert.match(editorAlternatives,/created_from:"adaptive-path"/);assert.match(editorAlternatives,/related_block_ids/);
  assert.match(editorAlternatives,/layer-create-dialog/);assert.match(editorAlternatives,/Save layer/);assert.match(editorAlternatives,/Duplicate/);assert.match(editorAlternatives,/structureAdaptive/);assert.match(eventsApi,/structure_adaptive/);assert.match(adapter,/forma_adaptive_structure/);
  assert.match(blockTypes,/type:"audience"/);assert.match(blockTypes,/type:"environment"/);assert.match(blockTypes,/type:"accessibility"/);assert.match(blockTypes,/BLOCK_GROUPS/);assert.match(blockTypes,/Purpose & audience/);assert.match(blockTypes,/Grounding evidence/);assert.match(workspace,/BLOCK_GROUPS\.map/);assert.match(workspace,/block-type-catalog/);assert.match(workspace,/System-suggested subtype/);
  assert.match(editorAlternatives,/forma-reality-layers/);assert.match(editorAlternatives,/forma-adaptive-path/);assert.match(styles,/\.reality-editor/);assert.match(styles,/\.adaptive-workspace/);
  assert.doesNotMatch(`${workspace}${library}${styles}`,/studio-sidebar|library-tree/);assert.match(styles,/\.project-rail/);
  assert.match(workspace,/\?disabled=\$\{!canCompare\}/);assert.match(store,/canUndo/);assert.match(store,/canRedo/);assert.match(styles,/\.document-bar \{ position: sticky/);
  assert.match(outputCard,/Taste evidence/);assert.match(outputCard,/taste-axis-grid/);assert.match(outputCard,/Record taste evidence/);
  assert.match(shell,/operations#governance/);assert.match(shell,/Use attention signals to improve Forma/);assert.match(system,/id="governance"/);assert.match(system,/Forget attention data/);
});

test("keeps account, project, document, intelligence, operations, and laboratory scopes distinct",async()=>{
  const [shell,rail,navigation,areas,contents,library,sessions,scout,memory,system,admin,collections,styles,review,applications]=await Promise.all([
    "forma-shell.ts","project-rail.ts","studio-navigation.ts","area-navigation.ts","forma-project-contents.ts","forma-library.ts","forma-sessions.ts","forma-scout.ts","forma-memory.ts","forma-system.ts","forma-admin-events.ts","collection-tree.ts",
  ].map((file)=>readFile(new URL(`../src/components/${file}`,import.meta.url),"utf8")).concat([
    readFile(new URL("../src/styles.css",import.meta.url),"utf8"),
    readFile(new URL("../docs/information-architecture-review.md",import.meta.url),"utf8"),
    readFile(new URL("../src/platform/applications.ts",import.meta.url),"utf8"),
  ]));
  assert.match(applications,/label: "Creative"/);assert.match(applications,/label: "Operations"/);assert.match(applications,/label: "Laboratory"/);assert.match(applications,/label: "Projects"/);assert.match(applications,/label: "Create"/);assert.match(applications,/label: "Re-entry"/);assert.match(applications,/label: "Taste & time"/);
  assert.match(shell,/class="account-nav"/);assert.match(shell,/application-switcher/);assert.match(shell,/Durable stream/);assert.match(shell,/Laboratory/);
  assert.match(rail,/rail-project-card/);assert.match(rail,/rail-dock/);assert.match(rail,/aria-controls="project-rail-content"/);assert.match(rail,/Project destinations/);assert.match(rail,/Project library/);assert.match(rail,/Creative history/);
  assert.match(navigation,/aria-label="Document views"/);assert.doesNotMatch(navigation,/Project-level|studio-project-overview/);assert.match(navigation,/studio-breadcrumbs/);assert.match(navigation,/Projects/);
  assert.doesNotMatch(contents,/forma-studio-mode-nav|forma-studio-navigator/);assert.match(library,/Project library/);assert.match(collections,/destination==="\/library"/);
  for(const [source,active] of [[sessions,"sessions"],[scout,"scout"],[memory,"memory"]])assert.match(source,new RegExp(`forma-area-navigation area="intelligence" active="${active}"`));
  assert.match(system,/system-page administrative-page/);assert.match(system,/system-page-content page-pad/);assert.match(admin,/admin-page administrative-page/);
  assert.match(system,/area="operations" active="system"/);assert.match(admin,/laboratory\?"laboratory":"operations"/);assert.match(areas,/Creative intelligence/);assert.match(areas,/Operations/);assert.match(areas,/Laboratory/);
  assert.match(areas,/area-navigation--administrative/);
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
