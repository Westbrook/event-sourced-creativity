import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { isImageReference, referenceMedium } from "../src/model/reference-media.ts";

const readSurface = (name) => readFile(new URL(`../src/components/${name}.ts`, import.meta.url), "utf8");

test("reference metadata distinguishes pasted passages and documents from genuine images", () => {
  const historicalPastedSource = { label: "Project source excerpt", text: "One context powers every delivery medium." };
  const pastedSource = { ...historicalPastedSource, source_type: "pasted-text", source_mime_type: "text/plain" };
  const document = { label: "Pitch context.pdf", source_mime_type: "application/pdf", media_url: "/api/media/pitch-context" };
  const image = { label: "Story frame.png", source_mime_type: "image/png", media_url: "/api/media/story-frame", pixel_reference_mode: "context_only" };
  const historicalImage = { label: "Story frame", media_url: "/api/media/story-frame", extraction_preferences: ["palette"], pixel_reference_mode: "inspiration" };

  for (const source of [historicalPastedSource, pastedSource]) {
    assert.equal(referenceMedium(source), "text");
    assert.equal(isImageReference(source), false);
  }
  assert.equal(referenceMedium(document), "document");
  assert.equal(isImageReference(document), false);
  for (const source of [image, historicalImage]) {
    assert.equal(referenceMedium(source), "image");
    assert.equal(isImageReference(source), true);
  }

  const mislabeledForeignSource = {
    source_mime_type: "text/plain",
    media_url: "https://foreign.example/reference.png",
    pixel_reference_mode: "preserve_subject",
    text: "This source remains text and does not authorize image transfer.",
  };
  assert.equal(referenceMedium(mislabeledForeignSource), "text", "an image-looking foreign URL cannot override an authoritative text MIME type");
  assert.equal(isImageReference(mislabeledForeignSource), false, "source classification does not grant pixel-transfer rights");
});

test("library previews use source-appropriate excerpts instead of broken pasted-text images", async () => {
  const library = await readSurface("forma-library");

  assert.match(library, /import \{ isImageReference, referenceMedium \} from "\.\.\/model\/reference-media"/);
  assert.match(library, /block\.type==="reference"&&isImageReference\(block\.properties\)&&block\.properties\.media_url/);
  assert.match(library, /block\.properties\.artifact_markdown\?\?block\.properties\.source_excerpt/);
  assert.match(library, /medium==="text"\|\|medium==="document"\?"document"/);
  assert.match(library, /data-reference-medium=\$\{medium\}/);
  assert.match(library, /block\.type==="reference"&&isImageReference\(block\.properties\)/, "only actual images count as related visual references");
});

test("reusable-block editing restricts image previews, image URLs, and pixel controls to image sources", async () => {
  const editor = await readSurface("library-block-editor");

  assert.match(editor, /const referenceBlocks=standalone\.filter\(\(item\)=>item\.type==="reference"&&isImageReference\(item\.properties\)/);
  assert.match(editor, /const imageReference=this\.#type==="reference"&&\(!block\|\|block\.type!=="reference"\|\|isImageReference\(block\.properties\)\)/);
  assert.match(editor, /\$\{imageReference\?html`<div class="library-reference-editor">/);
  assert.match(editor, /library-reference-source" data-reference-medium=\$\{selectedReferenceMedium\}/);
  assert.match(editor, /block\.properties\.source_excerpt\?\?block\.properties\.text/);
  assert.match(editor, /if\(this\.#type==="reference"&&\(block\.type!=="reference"\|\|isImageReference\(block\.properties\)\)\)\{add\("media_url"/);
  assert.match(editor, /source_mime_type:mimeType,media_type:mimeType/, "newly uploaded images retain their verified media classification");
  assert.match(editor, /rightsConfirmed/);
  assert.match(editor, /owned_or_licensed/);
});

test("creative-editor cards and inspectors never offer image or pixel controls for written sources", async () => {
  const editor = await readSurface("forma-creative-editor");

  assert.match(editor, /kind === "reference" && isImageReference\(item\.properties\) \? String\(item\.properties\.media_url/);
  assert.match(editor, /selected\.type === "reference" && isImageReference\(selected\.properties\) && selected\.properties\.media_url/);
  assert.match(editor, /selected\.type === "reference" && isImageReference\(selected\.properties\) \? html`<forma-reference-pixel-policy/);
  assert.match(editor, /selected\.type === "reference" && !isImageReference\(selected\.properties\) \? html`<div class="creative-inspector-source"/);
  assert.match(editor, /section\.id === "references" && hasNonImageReference \? "References" : section\.label/);
  assert.match(editor, /medium === "text" \? "Source" : "Reference"/);
  assert.match(editor, /explicit-upload-confirmation/, "real image uploads continue to require explicit rights confirmation");
});
