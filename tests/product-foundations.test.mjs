import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildAnalyticsReport } from "../src/model/analytics.ts";
import { exportProjectArchive, projectArchiveEvents } from "../src/model/archive.ts";
import { buildSpatialPromptDirectives } from "../src/model/prompt-structures.ts";
import { CREATIVE_PROMPT_GUARDRAILS, promptFactIsActive, providerFacingCreativeContext, providerFacingRenderingContext } from "../src/model/prompt-policy.ts";
import { documentShareScope, ownedMediaKey, sanitizeSharedValue, shareAllowsMedia } from "../src/model/share-scope.ts";
import { creativeNextActions, describeCreativeProposal } from "../src/model/workspace-intelligence.ts";
import { creativeCreationHref, resolveServerRoute } from "../src/platform/applications.ts";

const event = (sequence, type, payload = {}) => ({
  eventId: `foundation-${sequence}`,
  streamId: "creative:owner-1",
  sequence,
  occurredAt: `2026-08-20T12:${String(sequence).padStart(2, "0")}:00.000Z`,
  recordedAt: "2026-08-20T12:00:00.000Z",
  actor: "user",
  clientId: "test",
  correlationId: `correlation-${sequence}`,
  causationId: null,
  compensatesEventId: null,
  schemaVersion: 1,
  type,
  payload,
});

test("Create opens the current project document or an actionable project overview without crossing projects", () => {
  const documentHref = (id, title) => `/document/${id}/${title.toLowerCase().replaceAll(" ", "-")}`;
  const documents = [
    { id: "foreign-document", projectId: "other-project", title: "Someone else's study", createdSequence: 30 },
    { id: "first-document", projectId: "active-project", title: "First study", createdSequence: 10 },
    { id: "latest-document", projectId: "active-project", title: "Latest study", createdSequence: 20 },
  ];

  assert.equal(creativeCreationHref({ projectId: "active-project", documentId: "first-document", documents }, documentHref), "/document/first-document/first-study");
  assert.equal(creativeCreationHref({ projectId: "active-project", documentId: "foreign-document", documents }, documentHref), "/document/latest-document/latest-study");
  assert.equal(creativeCreationHref({ projectId: "active-project", documentId: "", documents: [] }, documentHref), "/studio/project");
  assert.equal(creativeCreationHref({ projectId: "", documentId: "foreign-document", documents }, documentHref), "/projects");
});

test("document sharing freezes one authorized document and its exact owner-scoped media", () => {
  const projection = {
    documentId: "doc-1",
    projectId: "project-1",
    documents: [{ id: "doc-1", projectId: "project-1" }],
    blocks: [{ properties: { media_url: "/api/media/owner-1%2Freferences%2Freference.png",artifact_structure:{items:[{media_url:"/api/media/owner-1%2Fgenerated%2Fscene-2.mp4"},{media_url:"/api/media/other-user%2Fgenerated%2Fprivate.mp4"}]} } }],
    outputs: [{ mediaUrl: "/api/media/owner-1%2Fgenerated%2Fimage.png" }],
    artifacts: [{ mediaUrl: null, items: [{ mediaUrl: "/api/media/owner-1%2Fgenerated%2Fframe.png" }] }],
  };
  const scope = documentShareScope(projection, "owner-1", "doc-1", "project-1");
  assert.deepEqual(scope.mediaKeys, ["owner-1/generated/frame.png", "owner-1/generated/image.png", "owner-1/generated/scene-2.mp4", "owner-1/references/reference.png"]);
  assert.equal(documentShareScope(projection, "owner-1", "doc-2", "project-1"), null);
  assert.equal(ownedMediaKey("/api/media/other-user%2Fgenerated%2Fprivate.png", "owner-1"), null);
  assert.equal(shareAllowsMedia(scope, "owner-1/generated/not-shared.png"), false);

  const sanitized = sanitizeSharedValue({
    mediaUrl: "/api/media/owner-1%2Fgenerated%2Fimage.png",
    privateMedia: "/api/media/owner-1%2Fgenerated%2Fnot-shared.png",
    content_ref: "private-snake",
    contentRef: "private-camel",
    promptRef: "private-prompt",
    storyboard_frame_prompt:"PRIVATE STORYBOARD PROVIDER PROMPT",
    framePrompt:"PRIVATE FRAME PROMPT",
    compiledPrompt:"PRIVATE COMPILED PROMPT",
    plannerModelId:"PRIVATE_MODEL",
    adapterVersion:"PRIVATE_ADAPTER_VERSION",
    authoredText:"This authored paragraph may safely discuss the word prompt.",
    externalImage: {mediaUrl:"https://tracker.example/pixel",image_url:"//tracker.example/pixel",posterUrl:"data:image/svg+xml,<svg/>",note:"https://reference.example/research"},
    nested: { input_ref: "private-input",frame_prompt:"PRIVATE NESTED PROMPT",providerRequestId:"PRIVATE_PROVIDER_REQUEST",media_url:"/api/media/owner-1%2Fgenerated%2Fscene-2.mp4",foreign_media:"/api/media/other-user%2Fgenerated%2Fprivate.mp4" },
  }, scope, "share-token");
  assert.equal(sanitized.mediaUrl, "/api/shared/share-token/media/owner-1%2Fgenerated%2Fimage.png");
  assert.equal(sanitized.privateMedia, null);
  assert.equal(sanitized.nested.media_url,"/api/shared/share-token/media/owner-1%2Fgenerated%2Fscene-2.mp4");assert.equal(sanitized.nested.foreign_media,null);
  assert.deepEqual(sanitized.externalImage,{mediaUrl:null,image_url:null,posterUrl:null,note:"https://reference.example/research"});
  assert.equal("content_ref" in sanitized, false);
  assert.equal("contentRef" in sanitized, false);
  assert.equal("promptRef" in sanitized, false);
  for(const key of ["storyboard_frame_prompt","framePrompt","compiledPrompt","plannerModelId","adapterVersion"])assert.equal(key in sanitized,false,key);
  for(const key of ["frame_prompt","providerRequestId"])assert.equal(key in sanitized.nested,false,key);
  assert.equal(sanitized.authoredText,"This authored paragraph may safely discuss the word prompt.");
  assert.doesNotMatch(JSON.stringify(sanitized),/PRIVATE STORYBOARD|PRIVATE FRAME|PRIVATE COMPILED|PRIVATE_MODEL|PRIVATE_ADAPTER|PRIVATE NESTED|PRIVATE_PROVIDER/);
  assert.equal("input_ref" in sanitized.nested,false);
});

test("project library export cannot disclose another project's interleaved history or reference media",()=>{
  const events=[
    event(1,"ProjectCreated",{project_id:"project-one",name:"First"}),
    event(2,"DocumentCreated",{project_id:"project-one",document_id:"document-one",title:"First document"}),
    event(3,"ReferenceIngested",{reference_id:"reference-one",source_ref:"/api/media/owner-1%2Freferences%2Ffirst.png",rights_class:"owned"}),
    event(4,"BlockCreated",{document_id:"document-one",block_id:"block-one",type:"reference",properties:{reference_id:"reference-one"}}),
    event(5,"ProjectCreated",{project_id:"project-two",name:"Second"}),
    event(6,"DocumentCreated",{project_id:"project-two",document_id:"document-two",title:"Second document"}),
    event(7,"BlockCreated",{document_id:"document-two",block_id:"block-two",type:"subject",properties:{text:"Private second-project subject"}}),
    event(8,"BlockPropertyEdited",{block_id:"block-one",property_path:"label",new_value:"First image"}),
    event(9,"ReferenceIngested",{reference_id:"reference-two",source_ref:"/api/media/owner-1%2Freferences%2Fsecond.png",rights_class:"owned"}),
  ];
  const scoped=projectArchiveEvents(events,"project-one");
  assert.deepEqual(scoped.map((item)=>item.sequence),[1,2,3,4,8]);
  const archive=exportProjectArchive(events,"project-one");
  assert.equal(archive.events.length,5);
  assert.deepEqual(archive.mediaManifest,[{sourceRef:"/api/media/owner-1%2Freferences%2Ffirst.png",rightsClass:"owned"}]);
  assert.doesNotMatch(JSON.stringify(archive),/project-two|document-two|reference-two|second\.png|Private second-project/);
});

test("project archives retain every owned generated scene and continuity image without foreign media or duplicate manifest entries", () => {
  const firstClip = "/api/media/owner-1%2Fgenerated%2Fscene-one.mp4";
  const secondClip = "/api/media/owner-1%2Fgenerated%2Fscene-two.mp4";
  const frame = "/api/media/owner-1%2Fgenerated%2Fframe-one.jpg";
  const anchor = "/api/media/owner-1%2Fgenerated%2Fcontinuity-anchor.jpg";
  const rows = [
    event(1, "ProjectCreated", { project_id: "project-one", name: "First" }),
    event(2, "DocumentCreated", { project_id: "project-one", document_id: "document-one", title: "First document" }),
    event(3, "DocumentRenderCompleted", { project_id: "project-one", document_id: "document-one", artifact_id: "film-one", artifact_kind: "video", media_url: firstClip, media_type: "video/mp4", items: [
      { id: "clip-two", media_url: secondClip, media_type: "video/mp4", narrative_order: 2, generation_order: 1, duration_seconds: 7 },
      { id: "clip-one", media_url: firstClip, media_type: "video/mp4", narrative_order: 1, generation_order: 2, duration_seconds: 6 },
    ], production_assets: [{ role: "production-continuity-anchor", media_url: anchor, media_type: "image/jpeg" }, { role: "forbidden-foreign-anchor", media_url: "/api/media/another-owner%2Fprivate.jpg", media_type: "image/jpeg" }] }),
    event(4, "DocumentRenderCompleted", { project_id: "project-one", document_id: "document-one", artifact_id: "board-one", artifact_kind: "storyboard", items: [{ id: "frame-one", media_url: frame, media_type: "image/jpeg", narrative_order: 1 }] }),
    event(5, "ReferenceIngested", { project_id: "project-one", document_id: "document-one", reference_id: "reused-frame", source_ref: frame, rights_class: "account-generated" }),
    event(6, "ReferenceIngested", { project_id: "project-one", document_id: "document-one", reference_id: "foreign-reference", source_ref: "/api/media/another-owner%2Fprivate.png", rights_class: "owned" }),
    event(7, "GenerationCompleted", { project_id: "project-one", document_id: "document-one", media_url: "/api/media/owner-1%2Fgenerated%2Ffinal-image.png", media_type: "image/png" }),
  ];
  const archive = exportProjectArchive(rows, "project-one");
  assert.equal(archive.mediaManifest.filter((entry) => entry.sourceRef === frame).length, 1);
  assert.deepEqual(archive.mediaManifest.find((entry) => entry.sourceRef === frame), { sourceRef: frame, rightsClass: "account-generated", artifactId: "board-one", itemId: "frame-one", role: "storyboard-frame", mediaType: "image/jpeg", narrativeOrder: 1 });
  const clips = archive.mediaManifest.filter((entry) => entry.role === "video-scene");
  assert.deepEqual(clips.map((entry) => [entry.itemId, entry.narrativeOrder, entry.generationOrder, entry.durationSeconds]), [["clip-one", 1, 2, 6], ["clip-two", 2, 1, 7]]);
  assert.ok(archive.mediaManifest.some((entry) => entry.role === "production-continuity-anchor"));
  assert.ok(archive.mediaManifest.some((entry) => entry.role === "generated-image"));
  assert.ok(archive.mediaManifest.every((entry) => !entry.sourceRef.includes("another-owner")));
});

test("inactive decisions and internal identifiers cannot leak into any provider-facing output", () => {
  const snapshot = {
    document: { id: "document-1", title: "Product study" },
    facts: [
      { block_id: "keep", active: true, type: "subject", properties: { text: "A ceramic vessel", weight: .8, content_ref: "private-content", combined_context_memberships: [{ context_set_id: "private-group" }] } },
      { block_id: "muted", active: false, type: "subject", properties: { text: "A suppressed unsafe concept", weight: .8 } },
      { block_id: "weightless", type: "direction", properties: { text: "Zero influence", weight: 0 } },
    ],
    context_groups: [{ id: "private-group" }],
  };
  const result = providerFacingCreativeContext(snapshot);
  assert.deepEqual(result.facts.map((fact) => fact.block_id), ["keep"]);
  assert.equal("context_groups" in result, false);
  assert.equal("combined_context_memberships" in result.facts[0].properties, false);
  assert.equal("content_ref" in result.facts[0].properties, false);
  assert.equal(promptFactIsActive(snapshot.facts[1]), false);
  assert.equal(promptFactIsActive(snapshot.facts[2]), false);
  assert.ok(CREATIVE_PROMPT_GUARDRAILS.some((rule) => /avoid and prohibit/.test(rule)));
  assert.doesNotMatch(buildSpatialPromptDirectives(snapshot).join(" "), /suppressed unsafe concept|Zero influence/);
  const rendered=providerFacingRenderingContext(snapshot);
  assert.equal(rendered.facts[0].decision_key,"decision_1");
  assert.equal(rendered.facts[0].order,1);
  assert.doesNotMatch(JSON.stringify(rendered),/document-1|private-content|private-group|"block_id"/);
});

test("document artifact rendering counts its actual source decisions without attributing project-library blocks to the open document", () => {
  const events = [
    event(1, "ProjectCreated", { project_id: "project-1", name: "Campaign" }),
    event(2, "DocumentCreated", { project_id: "project-1", document_id: "document-1", title: "Brief" }),
    event(3, "BlockCreated", { project_id: "project-1", document_id: "document-1", block_id: "document-block", type: "subject", properties: { text: "Lead figure", weight: .8 } }),
    event(4, "BlockCreated", { project_id: "project-1", document_id: "", block_id: "library-block", type: "style", properties: { text: "Reusable editorial system", weight: .8 } }),
    event(5, "DocumentRenderRequested", { project_id: "project-1", document_id: "document-1", artifact_id: "slides-1", artifact_kind: "slides", source_block_versions: [{ block_id: "document-block", version: 1 }] }),
    event(6, "DocumentRenderCompleted", { project_id: "project-1", document_id: "document-1", artifact_id: "slides-1", artifact_kind: "slides" }),
  ];
  const report = buildAnalyticsReport([{ streamId: "creative:owner-1", userId: "owner-1", userName: "Ari", organizationId: "forma", organizationName: "Forma", fictional: false, events }], { now: Date.parse("2026-08-21T12:00:00.000Z"), rangeDays: 30 });
  assert.equal(report.blocks.active, 2);
  assert.equal(report.blocks.used, 1);
  assert.equal(report.blocks.unused, 1);
  assert.equal(report.dimensions.document[0]?.blocks, 1);
});

test("outcome-led guidance changes with durable creative evidence instead of exposing every control", () => {
  assert.equal(creativeNextActions({ blocks: [], outputs: [], artifacts: [] })[0].id, "add-context");
  const blocks = [{ removed: false, properties: { weight: .8 } }];
  assert.equal(creativeNextActions({ blocks, outputs: [], artifacts: [] })[0].id, "make-draft");
  assert.equal(creativeNextActions({ blocks: [{ removed: false, properties: { weight: 0 } }], outputs: [], artifacts: [] })[0].id, "add-context");
  assert.equal(creativeNextActions({ blocks: [{ removed: false, properties: { weight: .8, active: false } }], outputs: [], artifacts: [] })[0].id, "add-context");
  const outputs = [{ quality: "low", purpose: "ideate", saved: false, pinned: false, library: false }];
  assert.equal(creativeNextActions({ blocks, outputs, artifacts: [] })[0].id, "refine-image");
  assert.equal(creativeNextActions({ blocks, outputs, artifacts: [], failedOperations: 1 })[0].id, "review-failure");
  const unpromotedFan=Array.from({length:4},(_,index)=>({...outputs[0],id:`member-${index}`,promptFanId:"fan-1",standalone:false}));
  assert.equal(creativeNextActions({blocks,outputs:unpromotedFan,artifacts:[]}).some((action)=>action.id==="compare-images"),false,"a grouped fan alone cannot satisfy the standalone comparison action");
  const promoted=[{...unpromotedFan[0],standalone:true},{...unpromotedFan[1],standalone:true}];
  assert.equal(creativeNextActions({blocks,outputs:promoted,artifacts:[]}).find((action)=>action.id==="compare-images")?.evidence,2);
});

test("unaccepted assistant proposals explain the actual creative change without identifiers or event machinery",()=>{
  const changes=describeCreativeProposal([
    {type:"BlockCreated",payload:{block_id:"secret-block-id",type:"subject",properties:{text:"A ceramic vessel"}}},
    {type:"BlockPropertyEdited",payload:{block_id:"secret-block-id",property_path:"temperature",old_value:"neutral",new_value:"warmer"}},
    {type:"BlockRemoved",payload:{block_id:"secret-block-id"}},
  ]);
  assert.deepEqual(changes,["Add subject: “A ceramic vessel”","Change temperature from neutral to warmer","Remove a creative decision"]);
  assert.doesNotMatch(changes.join(" "),/secret-block-id|BlockCreated|BlockPropertyEdited/);
});

test("the standalone Design & Knowledge system and artifact deep links remain server-addressable", async () => {
  assert.equal(resolveServerRoute("/laboratory/design-system")?.application, "knowledge");
  assert.equal(resolveServerRoute("/library/artifact/story-1/creative-study")?.application, "creative");
  const [primitives, presentational, presentation, lab, shell] = await Promise.all([
    readFile(new URL("../src/components/design-primitives.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/presentational-element.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/presentation-slide.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/forma-design-system-lab.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/forma-shell.ts", import.meta.url), "utf8"),
  ]);
  assert.match(primitives, /extends FormaPresentationalElement/);
  assert.doesNotMatch(primitives, /this\.store/);
  assert.doesNotMatch(primitives, /from "\.\/forma-element"/);
  assert.doesNotMatch(presentational, /state\/store|\.store/);
  assert.match(presentation, /extends FormaPresentationalElement/);
  for (const level of ["Foundations", "Atoms", "Molecules", "Organisms", "Templates"]) assert.match(lab, new RegExp(level));
  assert.match(shell, /this\.i18n\.t\("shell\.skip"\)/);
});

test("documented primitives power actual Creative, Canvas, intelligence, and Operations surfaces",async()=>{
  const [projects,canvas,scout,system,fields]=await Promise.all([
    readFile(new URL("../src/components/forma-projects.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/canvas/canvas-application.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/components/forma-scout.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/components/forma-system.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/components/design-primitives.ts",import.meta.url),"utf8"),
  ]);
  assert.match(projects,/<forma-ui-button/);
  assert.match(projects,/<forma-ui-field/);
  assert.match(projects,/<forma-ui-badge/);
  assert.match(canvas,/<forma-ui-button/);
  assert.match(canvas,/<forma-ui-empty-state/);
  assert.match(scout,/<forma-ui-empty-state/);
  assert.match(system,/<forma-ui-badge/);
  assert.match(system,/<forma-ui-metric/);
  assert.match(fields,/attribute: "max-length"/);
  assert.match(system,/Product surfaces & outcomes/);
});

test("public document shares expose every authorized outcome without touching a recipient's private creative stream", async () => {
  const [shared, visual] = await Promise.all([
    readFile(new URL("../src/components/forma-shared-view.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/output-visual.ts", import.meta.url), "utf8"),
  ]);
  assert.match(shared, /projection\.artifacts/);
  assert.match(shared, /documentArtifactDefinition/);
  assert.match(shared, /forma-presentation-slide/);
  assert.match(shared,/shared-image-dialog/);
  assert.match(shared,/const approvedFan=result\.outputs\.flatMap/);
  assert.match(shared,/\/api\/shared\/\$\{encodeURIComponent\(this\.token\)\}\/media\//);
  assert.match(shared,/ensureModalDialog/);
  assert.doesNotMatch(shared,/from "\.\/forma-element"|state\/store|this\.store/);
  assert.doesNotMatch(shared, /event #\$\{|outputs\.slice\(0, 4\)/);
  assert.match(visual, /if\(this\.readOnly\|\|this\.store\.session\.get\(\)\?\.projectContext\)return/);
  assert.match(visual, /this\.readOnly\?\[output,\.\.\.this\.fanOutputs\]/);
});

test("document outputs explain failures without exposing technical receipts until the creator asks", async () => {
  const source=await readFile(new URL("../src/components/document-artifacts.ts",import.meta.url),"utf8");
  assert.match(source,/failedGenerationInputInspection/);
  assert.match(source,/document-artifact-failure-details/);
  assert.match(source,/<summary>Technical details<\/summary>/);
  assert.match(source,/>Inspect inputs<\/button>/);
  assert.doesNotMatch(source,/<small>\$\{detail\?\.requestId\?`Provider request/);
});

test("creation, sharing, project editing, and image inspection remain complete and creator-readable from every entry point",async()=>{
  const [shell,workspace,rail,image,canvas,library,outputCard]=await Promise.all([
    readFile(new URL("../src/components/forma-shell.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/components/forma-workspace.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/components/project-rail.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/components/output-visual.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/canvas/canvas-application.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/components/forma-library.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/components/output-card.ts",import.meta.url),"utf8"),
  ]);
  assert.match(shell,/run: \(\) => this\.#openContextComposer\(\)/);
  assert.doesNotMatch(shell,/A new creative direction|Export full graph|Blocks, weights, constraints, and compiler snapshot/);
  assert.match(shell,/APPLICATIONS\.filter\(\(candidate\)=>applicationAccessible\(candidate\.id,access\)\)/);
  assert.doesNotMatch(shell,/\(!shared\|\|candidate\.id!=="canvas"\)/,"an explicitly authorized collaborator must retain access to the shared Canvas application");
  assert.match(shell,/navigationItemAccessible\(item,/);
  assert.match(shell,/<forma-ui-workspace-switcher/);
  assert.match(shell,/<forma-ui-audience-navigation/);
  assert.match(shell,/Latest result \+ plan/);
  assert.match(shell,/result:latestResult\?\?null/);
  assert.match(shell,/text, image, or video providers/);
  assert.match(workspace,/openContextComposer\(\)/);
  assert.match(workspace,/describeCreativeProposal\(this\.#proposal\.events\)/);
  assert.match(workspace,/retrieveFewShotExemplars\([^\n]*projectId: this\.store\.projection\.get\(\)\.projectId/);
  assert.doesNotMatch(workspace,/Proposed events · inert until accepted|Expected sequence \$\{this\.store\.head\.get\(\)\}/);
  assert.match(rail,/documentViewFromRoute\(route\)==="document"/);
  assert.match(rail,/Your work is saved/);
  assert.doesNotMatch(image,/generation event #|:active\.id\}<\/h2>/);
  assert.doesNotMatch(canvas,/generation event #/);
  assert.match(library,/exportProjectArchive\(events,projection\.projectId\)/);
  assert.match(library,/Export this project/);
  assert.match(library,/output\.promptFanId\?` · \$\{promptTechniqueDefinition\(output\.promptTechnique\)\.shortLabel\}`/);
  assert.doesNotMatch(library,/Export full graph|Ask the event stream for precedent|\$\{String\(member\.object_id\)\} <small>/);
  assert.doesNotMatch(outputCard,/Quiet nocturne|Private provider output|refined from \$\{out\.promotedFromId\}/);
});

test("one modal foundation gives every Canvas, output, and Laboratory dialog an accessible name and a true top-layer position", async () => {
  const [modal, shell, ...surfaces] = await Promise.all([
    readFile(new URL("../src/components/modal-dialog.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/forma-shell.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/canvas/canvas-application.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/collection-tree.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/document-artifacts.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/forma-admin-events.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/forma-creative-editor.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/forma-library.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/forma-project-contents.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/forma-projects.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/forma-studio-editor-alternatives.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/forma-workspace.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/generation-actions.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/generation-input-dialog.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/library-block-editor.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/output-visual.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/prompt-fan-review.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/reference-image.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/reference-palette-picker.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/spatial-scope-editor.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/studio-navigation.ts", import.meta.url), "utf8"),
  ]);
  assert.match(modal, /dialog\.setAttribute\("aria-labelledby", heading\.id\)/);
  assert.match(modal, /dialog\.showModal\(\)/);
  for (const source of [shell, ...surfaces]) {
    assert.match(source, /ensureModalDialog/);
    assert.doesNotMatch(source, /\.showModal\(/);
  }
  assert.match(shell, /aria-label=\$\{this\.i18n\.t\("shell\.command"\)\}/);
});
