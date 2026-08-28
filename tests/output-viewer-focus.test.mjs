import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { createHash } from "node:crypto";
import { fixture as artifactViewerFixture } from "./inactive-generation-dialog-host.test.mjs";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const [artifacts, workspace, deck, output, outputCard, canvas, shared, styles, canvasStyles, design, responsive, visualFixture] = await Promise.all([
  read("../src/components/document-artifacts.ts"),
  read("../src/components/forma-workspace.ts"),
  read("../src/components/presentation-deck.ts"),
  read("../src/components/output-visual.ts"),
  read("../src/components/output-card.ts"),
  read("../src/canvas/canvas-application.ts"),
  read("../src/components/forma-shared-view.ts"),
  read("../src/styles.css"),
  read("../src/canvas/canvas.css"),
  read("../src/design-system.css"),
  read("../src/responsive-foundation.css"),
  read("./presentation-pdf.fixture.mjs"),
]);


const ownButtons = (f) => f.renderer.ownNodes(f.host, "button");
const reviewPanel = (f) => f.renderer.ownNodes(f.host, "div").find((node) => node.attributes.id === "artifact-review-panel-artifact-A");
const reviewAction = (f, type) => ownButtons(f).find((node) => node.handlers.click?.toString().includes(type));
const exportButtons = (f) => ownButtons(f).filter((node) => node.handlers.click?.toString().includes("#download"));
const appendEvidence = (f, type, payload, actor = "owner") => {
  const previous = f.state.events.at(-1);
  f.state.events.push({ ...previous, eventId: "viewer-evidence-" + (previous.sequence + 1), sequence: previous.sequence + 1, actor: "user:" + actor, type, payload: { project_id: "p", document_id: "A", ...payload } });
};
async function exactViewer({ approved = false, shared = true, actor = "reviewer", locale = "en", kind = "short_story", retainedSlide = false } = {}) {
  const f = artifactViewerFixture("create", { artifact: true, locale });
  const completed = f.state.events.find((event) => event.type === "DocumentRenderCompleted");
  completed.payload.artifact_kind = kind;
  if (retainedSlide) {
    assert.equal(kind, "slides");
    const items = [{ id: "native-slide-a", title: "Exact retained slide", body: "Exact retained evidence", notes: "", image_prompt: "", context_group_ids: [] }];
    completed.payload.items = items;
    completed.payload.item_count = items.length;
    f.state.content["content-A"] = JSON.stringify({ ...JSON.parse(f.state.content["content-A"]), items });
  }
  completed.payload.source_block_versions = f.store.projection.get().libraryBlocks
    .filter((block) => block.documentId === "A").map((block) => ({ block_id: block.id, version: block.sourceEvents.length }));
  const contentSha256 = createHash("sha256").update(f.state.content["content-A"]).digest("hex");
  if (shared) {
    const session = f.store.session.get();
    f.store.session.get = () => ({ ...session, user: { userId: actor, role: "user" }, projectContext: {
      projectId: "p", organizationId: "organization", projectAccessId: "access", role: "viewer",
      permissions: ["project.read", "project.review.approve"], managedPilot: true,
    } });
    f.store.captureAuthorizationScope = () => f.state.canRead ? { key: f.state.authorization, shared: true } : null;
    const binding = { artifact_id: "artifact-A", artifact_revision: 0, content_sha256: contentSha256 };
    appendEvidence(f, "ArtifactReviewRequested", { ...binding, assigned_reviewer_user_id: actor });
    if (approved) appendEvidence(f, "ArtifactApproved", binding, actor);
  }
  // These tests open the actual intent and inspect its gates; they never submit or download.
  f.store.authorizeProjectExport = async () => assert.fail("Opening an intent must not authorize an export");
  f.store.append = async () => assert.fail("Opening an intent must not submit a review");
  assert.equal(await f.host.openArtifactById("artifact-A", { expectedRevision: 0, expectedContentSha256: contentSha256 }), true);
  await f.flush();
  f.originalEventCount = f.state.events.length;
  f.exactContentSha256 = contentSha256;
  return f;
}
function assertIntentControl(f, { intent, action, expanded = false, disabled = false }) {
  const controls = ownButtons(f).filter((node) => node.classList.contains("artifact-viewer-review-toggle"));
  assert.equal(controls.length, 1, "one actual native Review/export control");
  const control = controls[0], panelId = intent === "review" ? "artifact-review-panel-artifact-A" : "artifact-viewer-actions-artifact-A";
  assert.equal(control.attributes.type, "button");
  assert.ok(control.classList.contains("primary"), "the current evidence-specific action is primary");
  const slidesExport = intent === "export" && f.store.projection.get().libraryArtifacts.find(item => item.id === "artifact-A")?.kind === "slides";
  if (slidesExport) {
    assert.equal(Object.hasOwn(control.attributes, "aria-controls"), false, "the semantic Slides handoff does not claim the unrelated footer panel");
    assert.equal(Object.hasOwn(control.attributes, "aria-expanded"), false, "only the real native deck invoker owns its expanded state");
  } else {
    assert.equal(control.attributes["aria-controls"], panelId, "the control owns the exact artifact panel");
    assert.equal(String(control.attributes["aria-expanded"]), String(expanded));
  }
  assert.equal(Object.hasOwn(control.attributes, "disabled"), disabled);
  const targets = f.renderer.ownNodes(f.host, "div").filter((node) => node.attributes.id === panelId);
  assert.equal(targets.length, 1, "aria-controls resolves to exactly one rendered panel");
  const opening = f.renderer.markup.indexOf(control.full);
  assert.ok(opening >= 0, "the control comes from the actual emitted template");
  const start = opening + control.full.length;
  assert.equal(f.renderer.markup.slice(start, f.renderer.markup.indexOf("</button>", start)).trim(), f.i18n.t("artifact.delivery.action." + action), "the control names the current exact intent");
  if (intent === "review") assert.equal(Object.hasOwn(targets[0].attributes, "hidden"), !expanded);
  else assert.equal(f.renderer.ownNodes(f.host, "footer")[0].attributes["data-actions-open"], String(expanded));
  return control;
}
function assertExportGate(f, allowed, kind = "short_story") {
  if (kind === "slides") {
    const decks = f.renderer.ownNodes(f.host, "forma-presentation-deck");
    assert.equal(decks.length, 1, "the actual viewer preserves the native deck host");
    assert.equal(decks[0].properties.releaseAllowed, allowed, "the exact release gate reaches the format renderer");
  } else {
    assert.equal(exportButtons(f).length, 2, "Markdown and editable Word controls remain present");
    for (const control of exportButtons(f)) assert.equal(Object.hasOwn(control.attributes, "disabled"), !allowed);
    assert.equal(ownButtons(f).filter((node) => Object.hasOwn(node.attributes, "data-artifact-export")).length, 1);
  }
}

test("finished outputs preserve an explicitly chosen list but open unfamiliar decks directly in slideshow mode", () => {
  assert.match(deck, /localStorage\.getItem\(DECK_VIEW_PREFERENCE\)==="list"\?"list":"slideshow"/);
  assert.match(deck, /catch\{return"slideshow";\}/);
  assert.match(deck, /writeDeckView\(view\)/);
  assert.match(deck, /class="presentation-deck-view-switch"/);
  assert.match(deck, /aria-current=/);
  assert.match(visualFixture, /if\(viaDeck\)\{\s*deck\.querySelector\("\.presentation-deck-view-switch button"\)\?\.click\(\);\s*await deck\.updateComplete/s, "visual export fixtures explicitly request simultaneous list rendering");
});

test("slideshow geometry fits the real output viewport without subtracting imaginary chrome", () => {
  assert.match(deck, /class="presentation-deck-viewport"/);
  assert.match(deck, /class="presentation-deck-supporting"/);
  assert.match(styles, /\.presentation-deck-viewport \{[^}]*container:\s*presentation-deck-viewport \/ size/);
  assert.match(styles, /\.presentation-deck-viewport > \.presentation-deck-frame \{[^}]*inline-size:\s*min\(100cqi,calc\(100cqb \* 1\.7778\),96rem\)/);
  assert.doesNotMatch(styles, /177\.78cqh\s*-\s*12\.5rem/);
  assert.match(styles, /forma-presentation-deck:fullscreen \.presentation-deck-viewport > \.presentation-deck-frame \{[^}]*inline-size:\s*min\(100cqi,calc\(100cqb \* 1\.7778\)\)/);
  assert.match(styles, /@media \(max-width: 720px\) \{[\s\S]*?\.document-artifact-view \.presentation-deck-toolbar \{[^}]*flex-direction:\s*row[^}]*overflow-x:\s*auto/);
  assert.match(styles, /:is\(\.document-artifact-view,\.canvas-artifact-viewer\) \.presentation-deck-supporting \{[^}]*grid-auto-flow:\s*column[^}]*overflow-x:\s*auto/);
  assert.match(styles, /:is\(\.document-artifact-view,\.canvas-artifact-viewer\)\[data-output-focus="true"\] \.presentation-deck-toolbar \{ display:\s*none/);
  assert.match(styles, /:is\(\.document-artifact-view,\.canvas-artifact-viewer\)\[data-output-focus="true"\] \.presentation-deck-stage \{[^}]*grid-template-columns:[^}]*grid-template-rows:\s*minmax\(0,1fr\) auto/);

  for (const [inline, block] of [[288, 162], [350, 197], [640, 360], [960, 540], [1600, 900]]) {
    const visibleWidth = Math.min(inline, block * 16 / 9);
    assert.ok(visibleWidth >= inline - 1, `${inline}×${block}: the available 16:9 viewport remains fully useful`);
  }

  const landscapeHeight = 390;
  const compactHeader = 56;
  const sharedControls = 56;
  const stageGapsAndPadding = 20;
  const availableSlideHeight = landscapeHeight - compactHeader - sharedControls - stageGapsAndPadding;
  assert.ok(availableSlideHeight >= 236, "focused phone landscape reserves one shared navigation/evidence row");
  assert.ok(availableSlideHeight * 16 / 9 >= 420, "a 390px-high phone can show a useful 16:9 slide");
});

test("the governed artifact dialog exposes reversible focused viewing for every retained output type", () => {
  assert.match(artifacts, /class="document-artifact-view" data-output-focus=\$\{String\(this\.#viewerFocused\)\} data-artifact-kind=\$\{artifact\.kind\}/);
  assert.match(artifacts, /@cancel=\$\{this\.#cancelViewer\}/);
  assert.match(artifacts, /#cancelViewer\(event:Event\)\{if\(!this\.#viewerFocused\)return;event\.preventDefault\(\);event\.stopPropagation\(\);this\.#setViewerFocus\(false\);\}/);
  assert.match(artifacts, /class="icon-button artifact-viewer-focus-toggle"[^>]*aria-label=\$\{focusLabel\}[^>]*aria-pressed=\$\{this\.#viewerFocused\}/);
  assert.match(artifacts, /this\.i18n\.system\(this\.#viewerFocused\?"Exit focus":"Focus view"\)/);
  assert.match(artifacts, /\?disabled=\$\{editing\}/, "focused viewing must never strand unsaved direct edits");
  assert.match(artifacts, /#viewerReturnFocus\?:HTMLElement/);
  assert.match(artifacts, /if\(opener\?\.isConnected\)opener\.focus\(\{preventScroll:true\}\)/);
  assertViewerPrivateFocusCleanup(artifacts);

  for (const kind of ["audio", "video", "storyboard", "slides", "short_story", "scene"]) {
    assert.match(artifacts, new RegExp(`artifact\\.kind==="${kind}"|"${kind}"`), `${kind} remains available through the same governed viewer`);
  }

  assert.match(styles, /\.document-artifact-view\[data-output-focus="true"\] \{[^}]*inline-size:\s*100dvi;[^}]*block-size:\s*100dvb/);
  assert.match(styles, /\.document-artifact-view\[data-output-focus="true"\] > \.document-artifact-reader \{[^}]*grid-template-rows:\s*auto minmax\(0,1fr\)[^}]*safe-area-inset-top/);
  assert.match(styles, /\.document-artifact-reader-actions > \.icon-button \{[^}]*min-inline-size:[^}]*min-block-size:/);
  assert.match(styles, /\.document-artifact-view\[data-output-focus="true"\] \.artifact-reader-video \.forma-video-reel-player \{[^}]*max-block-size:\s*calc\(100dvb - 11rem\)[^}]*object-fit:\s*contain/);
  assert.match(styles, /\.document-artifact-view \.artifact-storyboard img \{ object-fit:\s*contain/);
  assert.match(styles, /\.document-artifact-reader > footer > div > \.button\.primary \{ order:\s*-1/);
  assert.doesNotMatch(styles, /\.document-artifact-view\[data-output-focus="true"\][^{]*\.artifact-review-status[^}]*display:\s*none/, "approval status must remain visible while focused");
});

test("active artifact viewers retain a visible result-pane ancestor across responsive transitions",()=>{
  const lifecycle=artifacts.slice(artifacts.indexOf("protected override updated()"),artifacts.indexOf("  #bindCompletedWorkflowStage()"));
  const opening=lifecycle.indexOf("document-artifact-viewer-open");
  const promotion=lifecycle.indexOf("ensureModalDialog(view)");
  assert.ok(opening>=0,"the viewer announces its ownership to the workbench");
  assert.ok(promotion>opening,"the result pane is protected before native modal promotion");
  assert.match(lifecycle,/new CustomEvent\("document-artifact-viewer-open",\{bubbles:true,composed:true\}\)/);
  assert.match(workspace,/#artifactViewerOpen=false/);
  assert.match(workspace,/#setArtifactViewerOpen\(open:boolean\)\s*\{[\s\S]*?if\(this\.#artifactViewerOpen===open\)return;/);
  assert.match(workspace,/@document-artifact-viewer-open=\$\{\(\)=>this\.#setArtifactViewerOpen\(true\)\}/);
  assert.match(workspace,/@document-artifact-close=\$\{\(\)=>this\.#setArtifactViewerOpen\(false\)\}/);
  assert.match(artifacts,/if\(opener\?\.isConnected\)opener\.focus\(\{preventScroll:true\}\);this\.dispatchEvent\(new CustomEvent\("document-artifact-close"/);
  const expression=workspace.match(/id="document-results-panel"[^>]*\?hidden=\$\{([^}]*)\}/)?.[1];
  assert.ok(expression,"the result-pane visibility expression remains explicit");
  const runnable=expression.replaceAll("this.#narrowWorkbench","narrow").replaceAll("this.#workbenchPane","pane").replaceAll("this.#artifactViewerOpen","viewerOpen");
  const hidden=new Function("narrow","pane","viewerOpen",`return ${runnable};`);
  assert.equal(hidden(false,"write",false),false);
  assert.equal(hidden(true,"write",false),true);
  assert.equal(hidden(true,"result",true),false);
  assert.equal(hidden(true,"write",true),false);
});

test("authenticated slides expose one readable surface with fixed reachable navigation",()=>{
  assert.match(deck,/presentationRequiresReadingPosture\(width,height\)/);
  assert.match(deck,/@presentation-slide-fit=\$\{this\.#slideFit\}/);
  assert.match(deck,/reading\?this\.#reader\(current,index,true\):this\.#slide\(current,presentation,index,total\)/);
  assert.match(deck,/class="presentation-deck-reading" tabindex="0"/);
  assert.match(deck,/class="button secondary compact presentation-deck-reading-toggle" aria-pressed=\$\{reading\}/);
  assert.match(deck,/target\?\.closest\("\.presentation-deck-reading"\)/);
  assert.match(responsive,/\.presentation-deck-reading\s*\{[^}]*overflow-x:\s*hidden;[^}]*overflow-y:\s*auto;/s);
  assert.match(responsive,/\.presentation-deck--slideshow \.presentation-deck-stage\[data-slide-posture\][\s\S]*?grid-template-rows:\s*minmax\(0,1fr\) auto;/);
  assert.match(responsive,/\.presentation-deck-toolbar\[data-tools-open="false"\]\s*>\s*div\s*\{\s*display:\s*none;/);
  assert.match(responsive,/:is\(\.document-artifact-view,\.canvas-artifact-viewer\)\[data-artifact-kind="slides"\] \.presentation-deck--slideshow \.presentation-deck-stage\[data-slide-posture\]\s*\{[^}]*padding-inline-end:\s*calc\(var\(--forma-hit-target,2\.75rem\)\s*\+\s*\.875rem\)/s,"short-landscape action trays cannot cover the localized reading-mode toggle in either writing direction");
});

test("visual slides never acquire an outer scrollbar while review, editing, and list views keep one reachable scroll owner",()=>{
  assert.match(responsive,/\.document-artifact-view\[data-artifact-kind="slides"\] > \.document-artifact-reader \{[^}]*overflow:\s*hidden/s);
  assert.match(responsive,/\.document-artifact-view\[data-artifact-kind="slides"\]:not\(\[data-output-focus="true"\]\) > \.document-artifact-reader:has\(> \.artifact-review-actions:not\(\[hidden\]\),> \.artifact-review-guidance,> \.artifact-revision-history:not\(\[hidden\]\)\) \{[^}]*overflow-y:\s*auto/s,"expanded independent review remains accessible without restoring focused-slide scrollbars");
  assert.match(responsive,/\.document-artifact-view\[data-artifact-kind="slides"\] \.document-artifact-reader-content:has\(> \.artifact-direct-editor\) \{[^}]*overflow-y:\s*auto/s,"long direct slide editors receive their own intentional scroll region");
  assert.match(responsive,/:is\(\.document-artifact-view,\.canvas-artifact-viewer\)\[data-artifact-kind="slides"\] \.presentation-deck--list \{[^}]*grid-template-rows:\s*auto minmax\(0,1fr\)[^}]*overflow:\s*hidden/s);
  assert.match(responsive,/:is\(\.document-artifact-view,\.canvas-artifact-viewer\)\[data-artifact-kind="slides"\] \.presentation-deck--list > \.presentation-deck-list \{[^}]*overflow-y:\s*auto/s,"the last list item stays reachable inside exactly one bounded scroll owner");
  assert.match(styles,/\.presentation-deck--slideshow \.presentation-deck-stage \{[^}]*overflow:\s*hidden/);
});

test("desktop overflow is reported without unmounting the slide or resetting an explicit viewing choice",()=>{
  assert.match(deck,/presentationUsesReadingView\(\{contentOverflows:this\.#visualOverflow,readingPreference:this\.#readingOverride,viewportRequiresReading:this\.#automaticReading\}\)/,"reading policy preserves both accessibility defaults and deliberate viewer choice");
  assert.match(deck,/if\(overflow===this\.#visualOverflow\)return;\s*this\.#visualOverflow=overflow;\s*this\.requestUpdate\(\)/,"actual clipping updates the diagnostic even after an explicit visual choice");
  assert.match(deck,/event\.detail\.renderKey!==this\.#activeFitKey/,"obsolete fit receipts cannot affect the current slide revision");
  assert.match(deck,/connectedCallback\(\)\{[^\n]*this\.requestUpdate\(\)/,"reattaching a viewer rebinds its viewport observer even when all slide properties are unchanged");
  assert.match(deck,/#postureFrame=requestAnimationFrame/);
  assert.match(shared,/#presentationPostureFrame=requestAnimationFrame/,"responsive posture updates never change observed layout during ResizeObserver delivery");
  assert.match(deck,/if\(fitKey!==this\.#activeFitKey\)\{this\.#activeFitKey=fitKey;this\.#visualOverflow=false;/,"a revised item, style, footer, or locale invalidates the old fit result");
  assert.match(deck,/presentation\.fitOverflow/,"unresolved overflow remains visible with a complete reading alternative");
  assert.doesNotMatch(deck,/next!==this\.#index&&this\.#readingOverride===false/);
  assert.doesNotMatch(shared,/nextIndex!==active\.index&&this\.#presentationReadingPreference===false|!reading&&this\.#presentationContentOverflow&&narrow/);
  assert.doesNotMatch(deck,/unsafeVisualOverride|if\(!reading&&this\.#visualOverflow\)/,"Slide view must never remain permanently disabled by stale provenance overflow");
  assert.doesNotMatch(deck,/contentNeedsReading|layout\?\.density==="dense"&&layout\.overflow\.readingModeRecommended/,"dense styling gets a real canonical fit measurement before choosing the reading view");
  assert.match(deck,/if\(view==="list"&&this\.#fullscreenActive\)[\s\S]*?document\.exitFullscreen\(\)/,"List cannot remove the last visible fullscreen exit action");
  assert.doesNotMatch(shared,/layout\?\.density==="dense"&&layout\.overflow\.readingModeRecommended/,"public shares also allow dense full-evidence compositions to prove that they fit");
});

test("reading mode presents audience delivery first and requires deliberate disclosure of presenter material",()=>{
  assert.match(deck,/const delivery=presentationAudienceItem\(item\),slide=delivery\.slide/,"semantic reading uses the same safe audience projection as visual slides");
  assert.match(deck,/<h3 dir="auto">\$\{delivery\.title\}<\/h3>\$\{delivery\.body\?html`<p dir="auto">\$\{delivery\.body\}/,"the audience reader presents real title and body instead of backstage scaffolding");
  assert.match(deck,/<details class="presentation-deck-evidence presentation-deck-reader"><summary>Authorized source evidence<\/summary>/,"complete private evidence is inspectable only after its closed disclosure is opened");
  assert.match(deck,/<details class="presentation-deck-notes"><summary>Speaker notes<\/summary><p dir="auto">\$\{item\.notes\}<\/p><\/details>/,"speaker notes are never automatically exposed by an adaptive reading fallback");
  assert.doesNotMatch(deck,/<details class="presentation-deck-(?:evidence|notes)"[^>]*\bopen\b/,"private evidence and notes start closed");
  assert.match(deck,/#downloadPowerPoint\([^)]*\)\{return this\.#downloadPowerPointVariant\(items,presentation,false\);\}/,"ordinary PowerPoint downloads are audience-safe and never include presenter notes");
  assert.match(deck,/#downloadPresenterPowerPoint\([^)]*\)\{return this\.#downloadPowerPointVariant\(items,presentation,true\);\}/,"presenter notes require a separately chosen, explicitly private export");
  assert.match(deck,/if\(includePresenterNotes&&!this\.#presenterExportAllowed\(artifact\)\)return/,"private notes are refused without the exact producer's authorization");
  assert.match(deck,/return Boolean\(session&&!session\.impersonation&&\(!session\.projectContext\|\|String\(completed\?\.payload\.requested_by_user_id\?\?renderedBy\)===session\.user\.userId\)\)/,"reviewers, missing principals, impersonating sessions, and other project members cannot receive presenter notes");
});

test("review, production disclosure, private inputs, and exact export gates remain available without occupying the initial stage", async () => {
  assert.match(artifacts, /class="artifact-viewer-details"/);
  assert.match(artifacts, /class="artifact-review-status artifact-review-|class=\$\{`artifact-review-status artifact-review-/);
  for (const locale of ["en", "fr", "ar", "ja"]) for (const kind of ["short_story", "slides"]) {
    const review = await exactViewer({ locale, kind });
    const details = review.renderer.ownNodes(review.host, "details").find((node) => node.classList.contains("artifact-viewer-details"));
    assert.ok(details); assert.equal(Object.hasOwn(details.attributes, "open"), false, "production evidence starts closed");
    assert.ok(review.renderer.markup.includes(review.exactContentSha256), "the actual retained byte hash is inspectable");
    const reviewControl = assertIntentControl(review, { intent: "review", action: "review" });
    assertExportGate(review, false, kind);
    assert.equal(Object.hasOwn(reviewAction(review, "ArtifactApproved").attributes, "disabled"), false, "the designated independent reviewer can approve");
    assert.equal(Object.hasOwn(reviewAction(review, "ArtifactChangesRequested").attributes, "disabled"), true, "changes require a note");
    await reviewControl.handlers.click.call(review.host, {}); await review.flush();
    assertIntentControl(review, { intent: "review", action: "review", expanded: true });
    assert.equal(review.state.events.length, review.originalEventCount);
    assert.equal(review.state.requests.length, 0);

    const released = await exactViewer({ approved: true, locale, kind });
    const exportControl = assertIntentControl(released, { intent: "export", action: "export" });
    assert.equal(Object.hasOwn(reviewPanel(released).attributes, "hidden"), true, "approved output still starts with review collapsed");
    assertExportGate(released, true, kind);
    await exportControl.handlers.click.call(released.host, {}); await released.flush();
    assertIntentControl(released, { intent: "export", action: "export", expanded: true });
    assert.equal(Object.hasOwn(reviewPanel(released).attributes, "hidden"), true, "export does not expand the unrelated review panel");
    assert.equal(released.state.events.length, released.originalEventCount);
    assert.equal(released.state.requests.length, 0);
  }
  assert.match(artifacts, /id=\$\{reviewPanelId\} class="artifact-review-actions"[^>]*\?hidden=\$\{!this\.#reviewPanelOpen\}/);
  assert.match(styles, /\.document-artifact-reader > \.artifact-review-actions\[hidden\] \{ display:\s*none/);

  for (const gate of ["canAuthor", "canReview", "independentEligible", "releaseAllowed", "ArtifactReviewRequested", "ArtifactChangesRequested", "ArtifactApproved"]) {
    assert.match(artifacts, new RegExp(`\\b${gate}\\b`), `${gate} must remain intact`);
  }

  assert.match(artifacts, /const productionOwner=Boolean\(session&&!session\.impersonation&&\(!context\|\|String\(completed\?\.payload\.requested_by_user_id\?\?actorOf\(rendered\?\.actor\?\?""\)\)===userId\)\)/, "production details require a real producing principal, never another author, impersonating account, or missing session");
  assert.match(artifacts, /productionOwner\?html`<p class="artifact-viewer-provider">/, "reviewers and unrelated shared authors must not receive provider/model metadata");
  assert.match(artifacts, /const generationCost=productionOwner&&/, "provider settlement must stay limited to the exact production owner");
  assert.match(artifacts, /\?disabled=\$\{!releaseAllowed\}/);
  assert.match(artifacts, /class="artifact-review-guidance"/);
});


test("actual intent controls preserve current source, independent review, permission and unsaved-edit gates", async () => {
  const stale = await exactViewer({ approved: true });
  const oldExport = assertIntentControl(stale, { intent: "export", action: "export" });
  appendEvidence(stale, "BlockPropertyEdited", { block_id: "direction-A", property: "text", new_value: "Changed after the exact review." });
  await oldExport.handlers.click.call(stale.host, {}); await stale.flush();
  assertIntentControl(stale, { intent: "review", action: "sources", expanded: true });
  assertExportGate(stale, false);
  assert.equal(stale.renderer.ownNodes(stale.host, "footer")[0].attributes["data-actions-open"], "false", "a retained approved callback cannot open exports after source changes");
  assert.equal(Object.hasOwn(reviewAction(stale, "ArtifactApproved").attributes, "disabled"), true);
  assert.equal(stale.state.requests.length, 0);

  const self = await exactViewer({ actor: "owner" });
  assert.equal(reviewAction(self, "ArtifactApproved"), undefined, "the production owner is not offered self-approval");
  assert.equal(reviewAction(self, "ArtifactChangesRequested"), undefined);
  assertExportGate(self, false);

  const editing = await exactViewer({ shared: false });
  const oldIntent = assertIntentControl(editing, { intent: "export", action: "exportPersonal" });
  await editing.renderer.handler(editing.host, "button", (node) => node.handlers.click?.toString().includes("#startArtifactEdit"))(); editing.draw();
  const editor = () => editing.renderer.ownNodes(editing.host, "textarea").find((node) => node.attributes.rows === "12");
  const draft = "Keep this exact authored correction uncommitted.";
  editor().handlers.input.call(editing.host, { currentTarget: { value: draft } }); editing.draw();
  assertIntentControl(editing, { intent: "export", action: "exportPersonal", disabled: true });
  await oldIntent.handlers.click.call(editing.host, {}); await editing.flush();
  assert.equal(editor().value, draft, "a queued intent cannot strand or discard native edits");
  assertIntentControl(editing, { intent: "export", action: "exportPersonal", disabled: true });
  assert.equal(editing.state.events.length, editing.originalEventCount);
  assert.equal(editing.state.requests.length, 0);

  const unreadable = await exactViewer({ approved: true });
  const retained = assertIntentControl(unreadable, { intent: "export", action: "export" });
  unreadable.state.canRead = false;
  await retained.handlers.click.call(unreadable.host, {}); await unreadable.flush();
  assert.equal(ownButtons(unreadable).filter((node) => node.classList.contains("artifact-viewer-review-toggle")).length, 0);
  assert.equal(unreadable.renderer.ownNodes(unreadable.host, "dialog").length, 0, "withdrawn read access removes the private viewer");
  assert.equal(unreadable.state.events.length, unreadable.originalEventCount);
  assert.equal(unreadable.state.requests.length, 0);
});

test("document images open in one deliberate action without nesting a dialog or focus button inside their selection control", () => {
  assert.match(outputCard, /class="output-art"[\s\S]*?<forma-output-visual \.output=\$\{out\}><\/forma-output-visual><\/button>/);
  assert.match(outputCard, /class="output-card-image-viewer" \.output=\$\{out\} \.viewerOnly=\$\{true\}/);
  assert.match(outputCard, /querySelector<OutputVisual>\("\.output-card-image-viewer"\)\?\.openImageViewer\(event\.currentTarget as HTMLElement\)/);
  assert.match(output, /this\.viewerOnly\?nothing:this\.interactive/);
  assert.match(output, /class="modal generated-image-viewer" data-output-focus=\$\{String\(this\.#focused\)\}/);
  assert.match(output, /class="icon-button image-lightbox-focus-toggle"[^>]*aria-pressed=\$\{this\.#focused\}/);
  assert.match(output, /class="sr-only image-lightbox-position" role="status" aria-live="polite" aria-atomic="true"/);
  assert.doesNotMatch(output, /<footer><span aria-live="polite"/, "fan position must remain announced after focus hides the footer");
  assert.match(output, /if\(this\.#focused\)\{this\.#setFocused\(false\);return;\}this\.#close\(\)/);
  assert.match(styles, /\.generated-image-viewer\[data-output-focus="true"\] > \.image-lightbox-card \{[^}]*inline-size:\s*100dvi;[^}]*block-size:\s*100dvb/);
  assert.match(styles, /\.generated-image-viewer\[data-output-focus="true"\] \.image-lightbox-card > header > p \{ display:\s*none/);
  assert.match(styles, /\.generated-image-viewer\[data-output-focus="true"\] \.modal-close \{[^}]*--forma-safe-inline-end/);
  assert.match(styles, /\.generated-image-viewer\[data-output-focus="true"\] \.image-lightbox-focus-toggle \{[^}]*--forma-safe-inline-end/);
});

test("Canvas preserves identical focus, Escape, contain-fit, storyboard, and authorization behavior", () => {
  assert.match(canvas, /class="modal canvas-artifact-viewer" data-output-focus=\$\{String\(this\.#viewerFocused\)\}/);
  assert.match(canvas, /class="modal canvas-output-viewer" data-output-focus=\$\{String\(this\.#viewerFocused\)\}/);
  assert.match(canvas, /event\.key==="Escape"&&this\.#viewerFocused&&\(this\.#viewingOutputId\|\|this\.#viewingArtifactId\)/);
  assert.match(canvas, /#restoreViewerFocus\(\)/);
  assert.match(canvas, /aria-pressed=\$\{this\.#viewerFocused\}/);
  assert.match(canvas, /\.releaseAllowed=\$\{releaseAllowed\}/);
  assert.match(canvas, /const productionOwner=Boolean\(session&&!session\.impersonation&&\(!project\|\|String\(completed\?\.payload\.requested_by_user_id\?\?renderedBy\)===session\.user\.userId\)\)/);
  assert.match(canvas, /this\.#canEditCanvas\(\)\?html`<button type="button" class="button primary"/);
  assert.match(canvasStyles, /:is\(\.canvas-artifact-viewer,\.canvas-output-viewer\)\[data-output-focus="true"\] > \.modal-card \{[^}]*inline-size:\s*100dvi;[^}]*block-size:\s*100dvb/s);
  assert.match(canvasStyles, /\.canvas-artifact-viewer\[data-output-focus="true"\] \.forma-video-reel-player \{[^}]*max-block-size:[^}]*object-fit:\s*contain/s);
  assert.match(canvasStyles, /\.canvas-artifact-viewer \.canvas-artifact-storyboard img \{\s*object-fit:\s*contain/s);
  assert.match(canvasStyles, /\.canvas-artifact-viewer-card > footer > div,\.canvas-output-viewer-card > footer > div \{[^}]*flex-wrap:\s*wrap/s);
  assert.match(canvasStyles, /:is\(\.canvas-artifact-viewer,\.canvas-output-viewer\)\[data-output-focus="true"\] > \.modal-card > header > p \{\s*display:\s*none/s);
  assert.match(canvasStyles, /:is\(\.canvas-artifact-viewer,\.canvas-output-viewer\)\[data-output-focus="true"\] \.modal-close \{[^}]*--forma-safe-inline-end/s);
  assert.match(canvasStyles, /\.canvas-artifact-viewer-card > footer > div > \.button\.primary,\.canvas-output-viewer-card > footer > div > \.button\.primary \{\s*order:\s*-1/s);
});

test("anonymous shared images focus using only approved share-scoped media", () => {
  assert.match(shared, /class="modal shared-image-dialog" data-output-focus=\$\{String\(this\.#imageFocused\)\}/);
  assert.match(shared, /class="button secondary compact shared-image-focus-toggle"[^>]*aria-pressed=\$\{this\.#imageFocused\}/);
  assert.match(shared, /if\(!this\.#imageFocused\)return;event\.preventDefault\(\);this\.#setImageFocus\(false\)/);
  assert.match(shared, /\/api\/shared\/\$\{encodeURIComponent\(this\.token\)\}\/media\//);
  assert.doesNotMatch(shared, /state\/store|this\.store|output-visual/, "public share must remain completely independent of account/project state");
  assert.match(design, /\.shared-image-dialog\[data-output-focus="true"\]>\.modal-card\{width:100dvi;height:100dvb/);
  assert.match(design, /\.shared-image-dialog>\.modal-card>img\{[^}]*object-fit:contain/);
  assert.match(design, /dialog\.modal\[data-output-focus="true"\] \{\s*padding:\s*0/s, "focused modal cards cannot be clipped or double-inset by their parent");
  assert.match(design, /@media\(max-width:30rem\)\{[\s\S]*?\.shared-image-dialog>\.modal-card>header\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(design, /\.shared-image-dialog>\.modal-card>header>\.button\{[^}]*white-space:normal[^}]*overflow-wrap:anywhere/);
});

test("anonymous shared presentations offer a safe full-size slideshow and complete sanitized reading alternative", () => {
  assert.match(shared, /class="button secondary compact shared-presentation-open"/);
  assert.match(shared, /#openPresentation\(event:MouseEvent,artifact:SharedArtifact\)/);
  assert.match(shared, /class="modal shared-presentation-dialog" data-output-focus=\$\{String\(this\.#presentationFocused\)\}/);
  assert.match(shared, /ensureModalDialog\(dialog\)/);
  assert.match(shared, /class="button secondary compact shared-presentation-focus-toggle" aria-pressed=\$\{this\.#presentationFocused\}/);
  assert.match(shared, /class="shared-presentation-viewport"><forma-presentation-slide/);
  assert.match(shared, /\.compact=\$\{false\}/, "approved shared slides render as complete rather than thumbnail presentations");
  assert.match(shared, /#sharedSlideReader\(item:DocumentArtifactItem,index:number\)/);
  assert.match(shared, /slide\.bullets\.map/);
  assert.match(shared, /quote\.text/);
  assert.match(shared, /\[quote\.speaker,quote\.role\]/);
  assert.match(shared, /safeLabel\(quote\.citation\)/);
  assert.match(shared, /slide\.visual\.data\.map/);
  assert.match(shared, /slide\.visual\.exactValue/);
  assert.match(shared, /slide\.visual\.displayValue/);
  assert.match(shared, /formatPresentationQuantity\(slide\.visual\.exactValue,slide\.visual\.unit/);
  assert.match(shared, /formatPresentationQuantity\(slide\.visual\.displayValue,slide\.visual\.unit/);
  assert.match(shared, /datum\.exactValue/);
  assert.match(shared, /citations\.map/);
  assert.match(shared, /OPAQUE_SHARED_SOURCE_LABEL/);
  assert.match(shared, /safeLabel\(citation\.label\)/);
  assert.doesNotMatch(shared, /item\.notes|citation\.excerpt|Speaker notes/, "anonymous reading and slide views never expose private presenter notes or full source excerpts");
  assert.match(shared, /notes:\s*""/, "anonymous presentation renderers receive an explicitly empty presenter channel");
  assert.match(shared, /#experienceSelector\(experience\)/, "recipients can choose among already-shared expressions of the same context");
  assert.match(shared, /result\.artifact\.contextRevision===experience\.revision/, "recipient format selection never crosses context revisions");
  assert.match(shared, /for\(const newest of candidates\)/, "a newer single-format revision cannot hide an already approved same-context format choice");
  assert.match(shared, /latestByKind\.size>1/, "a recipient selector appears only for independently available forms of one context revision");
  assert.match(shared, /referenceMedium\(block\.properties\)/, "shared text and document references are not mistaken for images");
  assert.match(shared, /role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(shared, /#presentationPointerUp\(event:PointerEvent\)/);
  assert.match(shared, /event\.key==="Home"\|\|event\.key==="End"/);
  assert.doesNotMatch(shared, /state\/store|this\.store|output-visual/);
  assert.match(design, /\.shared-presentation-viewport\{[^}]*container:shared-presentation-viewport \/ size/);
  assert.match(design, /\.shared-presentation-viewport>forma-presentation-slide\{[^}]*width:min\(100cqi,calc\(100cqb \* 1\.7778\)\)/);
  assert.match(design, /\.shared-presentation-dialog\[data-output-focus="true"\]>\.shared-presentation-card\{width:100dvi;height:100dvb/);
});

function actualSlideExport(f) {
  const deck = f.renderer.query(f.host, "forma-presentation-deck")[0];
  const footer = f.renderer.query(f.host, "forma-ui-popover").find(item => item.attributes.class === "artifact-viewer-actions-popover");
  assert.ok(deck, "the actual retained Slides renderer is mounted");
  assert.ok(footer, "the separate actual More actions popover remains mounted");
  const trigger = f.renderer.ownNodes(deck, "button").find(node => node.classList.contains("presentation-deck-export"));
  const panel = f.renderer.ownNodes(deck, "div").find(node => node.attributes.id === trigger?.attributes.popovertarget);
  const more = f.renderer.ownNodes(footer, "section").find(node => node.classList.contains("ui-popover-panel"));
  assert.ok(trigger); assert.ok(panel); assert.ok(more);
  assert.equal(trigger.attributes.popovertarget, panel.attributes.id, "the existing native invoker uses its real instance-owned target");
  assert.equal(trigger.attributes["aria-controls"], panel.attributes.id);
  return { trigger, panel, more };
}

for (const locale of ["en", "fr", "ar", "ja"]) test("the actual Slides Export handoff in " + locale + " owns only the deck export disclosure", async () => {
  const f = await exactViewer({ approved: true, kind: "slides", locale, retainedSlide: true });
  const primary = assertIntentControl(f, { intent: "export", action: "export" });
  let controls = actualSlideExport(f);
  assert.equal(Object.hasOwn(controls.trigger.attributes, "disabled"), false);
  assert.equal(controls.panel.matches(":popover-open"), false);
  assert.equal(controls.more.matches(":popover-open"), false);
  await primary.handlers.click.call(f.host, {}); await f.flush();
  assertIntentControl(f, { intent: "export", action: "export", expanded: true });
  controls = actualSlideExport(f);
  assert.equal(controls.panel.matches(":popover-open"), true, "the unchanged exact guarded action opens the real native deck export menu");
  assert.equal(String(controls.trigger.attributes["aria-expanded"]), "true");
  assert.equal(controls.more.matches(":popover-open"), false, "Export does not open the unrelated additional-actions panel");
  controls.panel.hidePopover(); await f.flush();
  controls = actualSlideExport(f);
  assert.equal(controls.panel.matches(":popover-open"), false);
  assert.equal(String(controls.trigger.attributes["aria-expanded"]), "false");
  assert.equal(controls.more.matches(":popover-open"), false);
  assert.equal(f.state.events.length, f.originalEventCount);
  assert.equal(f.state.requests.length, 0, "native menu inspection never generates or authorizes an export");
});

for (const boundary of ["source", "bytes", "revision", "authority", "read access", "approval"]) test("the actual Slides Export handoff refuses changed " + boundary + " after its owned update", async () => {
  const f = await exactViewer({ approved: true, kind: "slides", retainedSlide: true });
  const primary = assertIntentControl(f, { intent: "export", action: "export" });
  const before = actualSlideExport(f);
  assert.equal(before.panel.matches(":popover-open"), false);
  assert.equal(Object.hasOwn(before.trigger.attributes, "disabled"), false);
  const originalTick = f.tick;
  let changed = false, expectedEvents = f.state.events.length;
  f.tick = async (...args) => {
    const result = await originalTick(...args);
    if (!changed) {
      changed = true;
      if (boundary === "source") appendEvidence(f, "BlockPropertyEdited", { block_id: "direction-A", property: "text", new_value: "Changed after the exact approved opening." });
      else if (boundary === "bytes") f.state.content["content-A"] += " ";
      else if (boundary === "revision") appendEvidence(f, "DocumentArtifactEdited", { artifact_id: "artifact-A", content_ref: "content-A", revision: 1, changed_fields: ["content_markdown"] });
      else if (boundary === "authority") f.state.authorization = "a-different-current-actor-scope";
      else if (boundary === "read access") f.state.canRead = false;
      else appendEvidence(f, "ArtifactChangesRequested", { artifact_id: "artifact-A", artifact_revision: 0, content_sha256: f.exactContentSha256, note: "The current reviewer requires changes." }, "reviewer");
      expectedEvents = f.state.events.length;
    }
    return result;
  };
  await primary.handlers.click.call(f.host, {}); await f.flush();
  assert.equal(changed, true, "the current fact changed at the actual awaited update boundary");
  assert.equal(f.renderer.openPopovers.size, 0, "no stale primary callback opens any native menu");
  assert.equal(f.state.events.length, expectedEvents, "opening an intent cannot append review or export events");
  assert.equal(f.state.requests.length, 0);
});


// Scope this source contract to the actual cleanup member and its event/lifecycle
// callers. A reset in some other viewer method must not satisfy private cleanup.
function assertViewerPrivateFocusCleanup(surface) {
  const tree = ts.createSourceFile("document-artifacts.ts", surface, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  assert.equal(tree.parseDiagnostics.length, 0);
  const component = tree.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === "DocumentArtifacts");
  assert.ok(component);
  const compact = node => node.getText(tree).replace(/\s+/gu, "");
  const member = name => { const found = component.members.find(node => node.name?.getText(tree) === name); assert.ok(found, name); return found; };
  const body = name => { const found = member(name), result = ts.isPropertyDeclaration(found) ? found.initializer?.body : found.body; assert.ok(result && ts.isBlock(result), name); return result; };
  const direct = (block, text) => { const found = block.statements.find(node => ts.isExpressionStatement(node) && compact(node.expression) === text); assert.ok(found, text); return found; };
  const clear = body("#clearPrivateGenerationInputs");
  const revision = direct(clear, "this.#privateSourceRevision++");
  const focus = direct(clear, "this.#viewerFocused=false");
  for (const field of ["this.#viewerCurrent=null", "this.#viewerOpening=false", "this.#viewerReturnFocus=undefined", 'this.#activeId=""', "this.#reviewPanelOpen=false", "this.#viewerActionsOpen=false", "this.#deliveryBinding=null", "this.#deliveryBindingLoading=null"]) direct(clear, field);
  direct(clear, "this.#closeViewerPopovers()");
  const close = direct(clear, "this.#viewDialog()?.close()"), update = direct(clear, "this.requestUpdate()");
  assert.ok(revision.end < focus.pos && focus.end < close.pos && close.end <= update.pos, "Retire continuations and focus before native close and repaint");

  const retired = body("#retirePrivateGenerationInputs");
  const scopeGuard = retired.statements.find(node => ts.isIfStatement(node) && compact(node.expression) === "source&&this.store.sourceOwnershipScopeActive(source)");
  assert.ok(scopeGuard, "Only the exact currently owned source notice clears the viewer");
  assert.equal(compact(scopeGuard.thenStatement), "this.#clearPrivateGenerationInputs();");
  const connected = body("connectedCallback"), disconnected = body("disconnectedCallback");
  for (const [event, callback] of [["forma-authorization-changed", "#clearPrivateGenerationInputs"], ["forma-event-source-retired", "#retirePrivateGenerationInputs"]]) {
    direct(connected, 'window.addEventListener("' + event + '",this.' + callback + ")");
    direct(disconnected, 'window.removeEventListener("' + event + '",this.' + callback + ")");
  }
  const dispose = direct(disconnected, "this.#clearPrivateGenerationInputs()"), unmount = direct(disconnected, "super.disconnectedCallback()");
  assert.ok(dispose.end <= unmount.pos, "Disconnection also retires the same private viewer state");
}

for (const [label, before, after] of [
  ["focus reset", "this.#pendingWorkflowRegeneration=null;this.#viewerFocused=false;this.#reviewPanelOpen=false;", "this.#pendingWorkflowRegeneration=null;this.#reviewPanelOpen=false;"],
  ["owned source cleanup call", "if(source&&this.store.sourceOwnershipScopeActive(source))this.#clearPrivateGenerationInputs();", "if(source&&this.store.sourceOwnershipScopeActive(source))this.#closeViewerPopovers();"],
  ["source ownership guard", "if(source&&this.store.sourceOwnershipScopeActive(source))this.#clearPrivateGenerationInputs();", "if(source)this.#clearPrivateGenerationInputs();"],
  ["disconnect cleanup", "this.#clearPrivateGenerationInputs();super.disconnectedCallback();", "super.disconnectedCallback();"],
]) test("private viewer cleanup oracle rejects a missing " + label, () => {
  assertViewerPrivateFocusCleanup(artifacts);
  const mutated = artifacts.replace(before, after);
  assert.notEqual(mutated, artifacts, "The causal control mutates the real member, not a substitute class");
  assert.throws(() => assertViewerPrivateFocusCleanup(mutated), assert.AssertionError);
});

// These are complete existing DocumentArtifacts/deck renderers and native
// focus/dialog event ports, with the existing branded test Store owner port.
// Actual Worker denial/recovery is covered separately by media-private-viewer-retirement.
for (const kind of ["audio", "video", "storyboard", "slides", "short_story", "scene"]) for (const retire of [false, true])
test("actual " + kind + " viewer focus remains reversible across " + (retire ? "owned source cleanup" : "ordinary close"), async () => {
  const f = await exactViewer({ kind, shared: false, retainedSlide: kind === "slides" });
  const viewer = () => f.renderer.ownNodes(f.host, "dialog").find(node => node.attributes.class === "document-artifact-view");
  const toggle = () => ownButtons(f).find(node => node.classList.contains("artifact-viewer-focus-toggle"));
  assert.ok(viewer()?.open); assert.equal(viewer().attributes["data-artifact-kind"], kind);
  assert.equal(String(viewer().attributes["data-output-focus"]), "false");
  await toggle().handlers.click.call(f.host, {}); await f.flush();
  assert.equal(String(viewer().attributes["data-output-focus"]), "true");
  assert.equal(String(toggle().attributes["aria-pressed"]), "true");
  assert.equal(toggle().attributes["aria-label"], f.i18n.system("Exit focus"));
  f.draw();
  assert.equal(String(viewer().attributes["data-output-focus"]), "true", "An ordinary current render preserves deliberate focus");
  let prevented = 0, stopped = 0;
  viewer().handlers.cancel.call(f.host, { preventDefault() { prevented++; }, stopPropagation() { stopped++; } });
  await f.flush();
  assert.equal(prevented, 1); assert.equal(stopped, 1); assert.ok(viewer()?.open, "Escape exits focus before closing the governed viewer");
  assert.equal(String(viewer().attributes["data-output-focus"]), "false");
  await toggle().handlers.click.call(f.host, {}); await f.flush();
  assert.equal(String(viewer().attributes["data-output-focus"]), "true");
  if (retire) {
    const source = f.store.captureSourceOwnership(), listeners = [...(f.listeners.get("forma-event-source-retired") ?? [])];
    assert.ok(source); assert.equal(listeners.length, 1);
    const signal = owner => { const event = new Event("forma-event-source-retired"); Object.defineProperty(event, "detail", { value: { source: owner } }); for (const listener of listeners) listener(event); };
    signal({ ...source }); await f.flush();
    assert.equal(String(viewer().attributes["data-output-focus"]), "true", "A copied unbranded notice cannot erase the current viewer");
    signal(source); await f.flush();
  } else { viewer().close(); await f.flush(); }
  assert.equal(viewer(), undefined, "Closing or owned cleanup removes the actual private dialog");
  await f.flush(); assert.equal(viewer(), undefined, "Rerender is not automatic reopen or inspection");
  assert.equal(await f.host.openArtifactById("artifact-A", { expectedRevision: 0, expectedContentSha256: f.exactContentSha256 }), true);
  await f.flush();
  assert.ok(viewer()?.open); assert.equal(viewer().attributes["data-artifact-kind"], kind);
  assert.equal(String(viewer().attributes["data-output-focus"]), "false", "A new explicit exact opening starts without stale focus");
  assert.equal(String(toggle().attributes["aria-pressed"]), "false");
  assert.equal(f.state.events.length, f.originalEventCount); assert.equal(f.state.requests.length, 0);
});
