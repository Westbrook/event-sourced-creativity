import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { inferDocumentArtifactKind } from "../src/model/document-output-intent.ts";
import { inferPresentationSourceOutline } from "../src/model/presentation-source.ts";

const authoringSource = await readFile(new URL("../src/components/document-artifacts.ts", import.meta.url), "utf8");
const workspaceSource = await readFile(new URL("../src/components/forma-workspace.ts", import.meta.url), "utf8");
const executiveFixture = JSON.parse(await readFile(new URL("./fixtures/presentation-executive-source.json", import.meta.url), "utf8"));

test("presentation documents default to Slides and their complete authored outline before opening the output dialog", () => {
  assert.equal(inferDocumentArtifactKind(executiveFixture.snapshot.facts, executiveFixture.title), "slides");
  assert.equal(inferDocumentArtifactKind([
    { type: "format", properties: { text: "One compelling pitch slideshow, followed by honest end-user feedback expressed as a storyboard and video." } },
    { type: "message", properties: { text: "One living context reaches audiences through documents, audio, video, and slides." } },
  ], "Pitch context"), "slides", "the live pitch document retains its authored primary slideshow medium");
  assert.equal(inferDocumentArtifactKind([
    { type: "format", properties: { text: "Six-slide faithful field-notes research readout, four-frame storyboard, and four-second video." } },
    { type: "message", properties: { text: "Context: 7/10. Slides: 2/10. Message: 3/10. Video and storyboard follow the completed deck." } },
  ], "Pitch context feedback"), "slides", "later requested storyboard and video variants never displace the first authored feedback deck");
  assert.equal(inferDocumentArtifactKind([
    { type: "format", properties: { text: "An image/poster for a product pitch" } },
    { type: "direction", properties: { text: "Pitch our product clearly." } },
  ], "Product pitch"), null, "an explicit image-only deliverable never becomes a slideshow because its subject is a product pitch");
  assert.equal(inferPresentationSourceOutline(executiveFixture.snapshot).authoredSlideCount, 12);
  assert.match(authoringSource, /import \{ inferDocumentArtifactKind \} from "\.\.\/model\/document-output-intent"/u);
  assert.match(authoringSource, /@click=\$\{\(\)=>\{this\.#activeWorkflowStageId="";void this\.#openCreate\(true\);\}\}>Create output/u);

  const opening = authoringSource.slice(authoringSource.indexOf("  #openCreate="), authoringSource.indexOf("  async #revealWorkbenchPane()"));
  const inference = opening.indexOf("inferDocumentArtifactKind(projection.blocks,projection.documentTitle)");
  const slideCount = opening.indexOf('if(this.#kind==="slides")this.#resetPresentationCount()');
  const dialog = opening.indexOf("this.#createOpen=true");

  assert.ok(inference >= 0, "generic output creation reads this document's actual authored intent");
  assert.ok(slideCount > inference, "the selected Slides medium precedes authored-outline count initialization");
  assert.ok(dialog > slideCount, "the first rendered dialog already has the complete authored slide count");
  assert.match(opening, /if\(inferred\)this\.#selectArtifactKind\(inferred\)/u);
});

test("explicit output overrides, recovery, and structured production stages keep their deliberately selected medium", () => {
  assert.match(authoringSource, /#openCreate=async\(inferKind=false\)/u);
  assert.match(authoringSource, /if\(kind\)this\.#selectArtifactKind\(kind\)/u);
  assert.match(authoringSource, /await this\.#openCreate\(!kind\)/u, "explicit openRender(kind) never gets replaced by inferred document intent");
  assert.match(authoringSource, /this\.#selectArtifactKind\(stage\.format\);\s*await this\.#openCreate\(\)/u, "structured workflow stages retain their selected format");
  assert.match(authoringSource, /await this\.openRender\(kind,this\.#targetDocumentId\(\)\)/u, "retry retains the original failed output medium");
  assert.match(authoringSource, /@change=\$\{\(\)=>\{this\.#selectArtifactKind\(kind\);if\(kind==="slides"\)this\.#resetPresentationCount\(\)/u, "the author can always change the suggested medium");
  assert.match(authoringSource, /this\.#workflowTarget=inferDocumentArtifactKind\(projection\.blocks,projection\.documentTitle\)\?\?"video"/u);
});

test("authored medium recommendations cannot submit paid work, bypass project permission, or preapprove provider charges", () => {
  const opening = authoringSource.slice(authoringSource.indexOf("  #openCreate="), authoringSource.indexOf("  async #revealWorkbenchPane()"));
  const permission = opening.indexOf('if(project&&!project.permissions.includes("project.output.request"))return');
  const inference = opening.indexOf("inferDocumentArtifactKind");

  assert.ok(permission >= 0 && inference > permission, "project output-request authorization is checked before adapting the dialog");
  assert.match(opening, /this\.#confirmed=false/u, "an inferred format never reuses an earlier paid-generation confirmation");
  assert.match(opening, /this\.#sendSoundtrackToVideoProvider=false/u, "changing default formats never grants soundtrack transmission consent");
  assert.doesNotMatch(opening, /renderDocumentArtifact|#submit|fetch\(/u, "opening the suggested-medium dialog cannot start generation or contact a provider");
  assert.match(authoringSource, /Use my settings/u, "manual production remains available for every inferred format");
});

test("new Format blocks follow authored slideshow intent without inserting image instructions, controls, or image metadata", () => {
  const formatterBody = workspaceSource.match(/#formatDraftText\(draft:BlockDraft,preset="3:2"\)\{([\s\S]*?)\n\x20{2}\}/u)?.[1];
  const frameExpression = workspaceSource.match(/#formatDraftUsesImageFrame\(draft:BlockDraft\)\{return ([^;]+);\}/u)?.[1];
  assert.ok(formatterBody && frameExpression, "the workspace exposes distinct medium-aware Format defaults and frame eligibility");

  const describe = new Function("draft", "preset = '3:2'", formatterBody);
  const usesImageFrame = new Function("draft", `return ${frameExpression};`);
  const imageFormat = { dimensions: { width: 1536, height: 1024 } };
  const slideDraft = { outputKind: "slides", imageFormat };
  const storyboardDraft = { outputKind: "storyboard", imageFormat };
  const imageDraft = { outputKind: null, imageFormat };

  assert.equal(inferDocumentArtifactKind(executiveFixture.snapshot.facts, executiveFixture.title), slideDraft.outputKind);
  assert.match(describe(slideDraft), /presentation.*authored slide outline/iu);
  assert.doesNotMatch(describe(slideDraft), /image|pixels?|3:2/iu);
  assert.equal(usesImageFrame(slideDraft), false, "a pitch or presentation Format never receives an Image frame control");

  for (const outputKind of ["video", "audio", "scene", "short_story"]) {
    const draft = { outputKind, imageFormat };
    assert.equal(usesImageFrame(draft), false, `${outputKind} never receives unrelated image dimensions`);
    assert.doesNotMatch(describe(draft), /image|pixels?|3:2/iu, outputKind);
  }

  assert.equal(usesImageFrame(storyboardDraft), true, "storyboard frame geometry remains intentionally editable");
  assert.match(describe(storyboardDraft, "16:9"), /storyboard.*16:9.*1536 × 1024 pixels/iu);
  assert.equal(usesImageFrame(imageDraft), true, "ordinary image creation preserves its existing frame selector");
  assert.equal(describe(imageDraft), "Create for a 3:2 image at 1536 × 1024 pixels.");

  assert.match(workspaceSource, /outputKind:inferDocumentArtifactKind\(projection\.blocks,projection\.documentTitle\)/u);
  assert.match(workspaceSource, /if\(option\.type==="format"\)draft\.text=this\.#formatDraftText\(draft\)/u);
  assert.match(workspaceSource, /draft\.type==="format"&&this\.#formatDraftUsesImageFrame\(draft\)\?\{image_format:draft\.imageFormat\}:\{\}/u, "nonvisual formats cannot persist misleading image_format metadata");
  assert.match(workspaceSource, /draft\.type==="format"&&this\.#formatDraftUsesImageFrame\(draft\)\?html/u, "only image and storyboard contexts expose a frame selector");
  assert.match(workspaceSource, /draft\.outputKind==="storyboard"\?"Storyboard frame":"Image frame"/u);
  assert.match(workspaceSource, /"missing-message":"message"/u, "the concurrently authored context-health quick fix remains intact");
});
