import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import en from "../src/components/design-system/locales/system-en.ts";
import fr from "../src/components/design-system/locales/fr.ts";
import ar from "../src/components/design-system/locales/ar.ts";
import ja from "../src/components/design-system/locales/ja.ts";
import { formaSystemMessageId } from "../src/components/design-system/system-message-id.ts";

const component = await readFile(new URL("../src/components/document-artifacts.ts", import.meta.url), "utf8");
const dialog = await readFile(new URL("../src/components/generation-input-dialog.ts", import.meta.url), "utf8");
const store = await readFile(new URL("../src/state/store.ts", import.meta.url), "utf8");

test("saved storyboard inspection replaces the legacy paid continuation", () => {
  assert.ok(component.includes('this.i18n.system("View saved frames")'));
  assert.ok(component.includes('@click=${()=>this.#inspectFailedInputs(job)}'));
  assert.ok(!component.includes("continueWithSaferFrames"));
  assert.ok(!store.includes("continueDocumentStoryboardWithSaferFrames"));
  assert.ok(store.includes('/api/document-jobs/${encodeURIComponent(jobId)}?inspection=1'));
});

test("inspection uses authenticated images with only a local unavailable placeholder and clears on authorization change", () => {
  assert.ok(dialog.includes("savedStoryboardInspection(inspection)"));
  assert.ok(dialog.includes('<img src=${frame.mediaUrl}'));
  assert.ok(dialog.includes('referrerpolicy="no-referrer"'));
  for (const action of ["@load=", "calculateImageFocalPoint", "renderDocumentArtifact", "recoverDocumentRender"]) assert.ok(!dialog.includes(action));
  assert.ok(dialog.includes("#frameUnavailable(url:string){this.#unavailableFrames.add(url);this.requestUpdate();}"));
  assert.ok(dialog.includes('window.addEventListener("forma-authorization-changed",this.#clearPrivatePreview)'));
  assert.ok(dialog.includes("#clearPrivatePreview=()=>{this.#unavailableFrames.clear();this.inspection=null;this.#close();}"));
  assert.ok(dialog.includes("this.inspection=null;super.disconnectedCallback()"));
});

test("original-source incomplete status and no-generation copy exist in every supported language", () => {
  for (const source of [
    "View saved frames", "Saved storyboard preview", "{saved} of {total} frames recorded · Incomplete",
    "Original request source, not current approval. Viewing does not generate, replace, approve, or release any work or budget hold.",
    "Original source revision", "Recorded image unavailable", "No image recorded", "Recorded provider and model", "Original shot direction",
    "{saved} frames recorded. Inspect the original plan without generating again. The storyboard is incomplete; its existing budget hold is unchanged.",
  ]) {
    const key = formaSystemMessageId(source);
    assert.equal(en[key], source);
    for (const messages of [fr, ar, ja]) {
      assert.ok(messages[key], source);
      for (const placeholder of source.match(/\{[^}]+\}/gu) ?? []) assert.ok(messages[key].includes(placeholder));
    }
  }
});
