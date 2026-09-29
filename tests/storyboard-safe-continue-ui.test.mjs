import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import en from "../src/components/design-system/locales/system-en.ts";
import fr from "../src/components/design-system/locales/fr.ts";
import ar from "../src/components/design-system/locales/ar.ts";
import ja from "../src/components/design-system/locales/ja.ts";
import { formaSystemMessageId } from "../src/components/design-system/system-message-id.ts";

const component = await readFile(new URL("../src/components/document-artifacts.ts", import.meta.url), "utf8");
const dialog = await readFile(new URL("../src/components/generation-input-dialog.ts", import.meta.url), "utf8");
const store = await readFile(new URL("../src/state/store.ts", import.meta.url), "utf8");

const receiptSyntax = ts.createSourceFile("generation-input-dialog.ts", dialog, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const receiptClass = receiptSyntax.statements.find((node) => ts.isClassDeclaration(node) && node.name?.text === "GenerationInputDialog");
const receiptMember = (name) => {
  const member = receiptClass?.members.find((node) => node.name?.getText(receiptSyntax) === name);
  assert.ok(member, `actual GenerationInputDialog.${name}`);
  return member;
};
const cleanupStep = (statement) => {
  const expression = ts.isExpressionStatement(statement) ? statement.expression : null;
  if (expression && ts.isBinaryExpression(expression)) {
    const field = expression.left.getText(receiptSyntax);
    return { "this.open": "open", "this.inspection": "inspection", "this.#inspectionScope": "scope" }[field];
  }
  if (expression && ts.isCallExpression(expression) && ts.isPropertyAccessExpression(expression.expression)) {
    return { removeEventListener: "listener", close: "dialog", clear: "frames", disconnectedCallback: "super" }[expression.expression.name.text];
  }
};
function receiptDisconnectFixture({ omit, dialogPresent = true, nativeOpen = true } = {}) {
  const disconnected = receiptMember("disconnectedCallback");
  const statements = disconnected.body.statements;
  if (omit) assert.equal(statements.filter((statement) => cleanupStep(statement) === omit).length, 1, "one actual cleanup statement is mutated");
  const body = disconnected.getText(receiptSyntax).replace(disconnected.body.getText(receiptSyntax),
    "{" + statements.filter((statement) => !omit || cleanupStep(statement) !== omit).map((statement) => statement.getText(receiptSyntax)).join("\n") + "}");
  const selected = ["open", "inspection", "#unavailableFrames", "#inspectionScope", "#close", "#clearPrivatePreview", "connectedCallback"];
  const fieldsAndMethods = selected.map((name) => receiptMember(name).getText(receiptSyntax)).join("\n");
  const listeners = new Map(), superSnapshots = [];
  const nativeDialog = { open: nativeOpen, closes: 0, close() { this.open = false; this.closes += 1; } };
  const windowPort = {
    addEventListener(type, callback) { listeners.set(type, callback); },
    removeEventListener(type, callback) { assert.equal(listeners.get(type), callback, "disconnect removes its own authorization listener"); listeners.delete(type); },
  };
  class BasePort {
    connectedCallback() {}
    disconnectedCallback() { superSnapshots.push(this.snapshotForTest()); }
  }
  // Actual production methods/initializers; only native dialog, event and base ports are deterministic.
  const code = ts.transpileModule(`(class extends Base {
    ${fieldsAndMethods}
    ${body}
    seedForTest(){this.open=true;this.inspection={receipt:{submitted_prompt:"private retained storyboard"}};this.#unavailableFrames.add("private-frame-A");this.#unavailableFrames.add("private-frame-B");this.#inspectionScope="actor-A/project-A";}
    snapshotForTest(){return {open:this.open,inspection:this.inspection,frames:[...this.#unavailableFrames],scope:this.#inspectionScope};}
  })`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  const Constructor = new Function("Base", "window", "CustomEvent", `return ${code}`)(BasePort, windowPort, CustomEvent);
  const host = new Constructor();
  host.renderRoot = { querySelector(selector) { assert.equal(selector, "dialog"); return dialogPresent ? nativeDialog : null; } };
  host.dispatchEvent = () => true; host.requestUpdate = () => {};
  host.connectedCallback(); host.seedForTest();
  assert.equal(listeners.size, 1);
  return { host, nativeDialog, dialogPresent, listeners, superSnapshots };
}
function assertReceiptDisconnected(fixture) {
  const { host, nativeDialog, dialogPresent, listeners, superSnapshots } = fixture;
  host.disconnectedCallback();
  const cleared = { open: false, inspection: null, frames: [], scope: "" };
  assert.deepEqual(host.snapshotForTest(), cleared, "disconnect clears open state, private inspection, unavailable frames and scope");
  assert.equal(listeners.size, 0, "disconnect removes the private authorization listener");
  assert.equal(nativeDialog.closes, dialogPresent ? 1 : 0, "disconnect closes the owned native dialog when present");
  if (dialogPresent) assert.equal(nativeDialog.open, false, "disconnect leaves no open native dialog");
  assert.deepEqual(superSnapshots, [cleared], "disconnect completes private cleanup before exactly one base disconnect");
}

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
  for (const options of [{}, { nativeOpen: false }, { dialogPresent: false }]) assertReceiptDisconnected(receiptDisconnectFixture(options));
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

test("disconnect assertions reject omission of each actual cleanup effect", () => {
  for (const omit of ["listener", "open", "dialog", "frames", "inspection", "scope", "super"]) {
    const fixture = receiptDisconnectFixture({ omit });
    assert.throws(() => assertReceiptDisconnected(fixture), { code: "ERR_ASSERTION" }, `missing ${omit} cleanup cannot pass`);
  }
});
