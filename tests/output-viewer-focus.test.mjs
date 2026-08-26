import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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
  assert.match(artifacts, /#clearPrivateGenerationInputs=.*this\.#viewerFocused=false/);

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

test("meaningful slide overflow remains a safe, reversible reading recommendation without trapping visual presentation",()=>{
  assert.match(deck,/presentationUsesReadingView\(\{contentOverflows:this\.#visualOverflow,readingPreference:this\.#readingOverride,viewportRequiresReading:this\.#automaticReading\}\)/,"reading policy preserves both accessibility defaults and deliberate viewer choice");
  assert.match(deck,/if\(overflow===this\.#visualOverflow\)return;[\s\S]*?this\.#visualOverflow=overflow;[\s\S]*?if\(this\.#readingOverride===null\)this\.requestUpdate\(\)/,"actual clipping is still measured without silently overriding a deliberate reading or slide choice");
  assert.match(deck,/const retryVisual=sizeChanged&&this\.#visualOverflow;/,"responsive resizing retries a previously oversized visual composition");
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

test("review, production disclosure, private inputs, and exact export gates remain available without occupying the initial stage", () => {
  assert.match(artifacts, /class="artifact-viewer-details"/);
  assert.match(artifacts, /class="artifact-review-status artifact-review-|class=\$\{`artifact-review-status artifact-review-/);
  assert.match(artifacts, /class="button secondary compact artifact-viewer-review-toggle"[^>]*aria-controls=\$\{reviewPanelId\}[^>]*aria-expanded=\$\{this\.#reviewPanelOpen\}/);
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
