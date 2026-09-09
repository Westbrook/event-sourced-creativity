import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { nativeStoryDialogPresentation, renderNativeStoryDialog } from "../src/components/native-short-story-dialog.ts";

const handle = { documentId: "document-one", jobId: "private-job-one" };
const state = (status, reason = null, savedHandle = null) => ({
  openingId: 1, documentId: "document-one", submissionId: null, readId: null,
  status, reason, handle: savedHandle, reused: null, completion: null,
});
function input(overrides = {}) {
  return {
    openingId: 1, documentTitle: "Document one", locale: "en", audience: "", tone: "", composing: false,
    state: state("ready"), i18n: { t: key => key, number: value => String(value) },
    close() {}, change() {}, composition() {}, create() {}, check() {}, open() {}, ...overrides,
  };
}
function binding(template, marker) {
  const index = template.strings.findIndex(part => part.endsWith(marker));
  assert.notEqual(index, -1, `binding ${marker} exists`);
  return template.values[index];
}
function* templates(template) {
  if (!template || !Array.isArray(template.strings)) return;
  yield template;
  for (const value of template.values) {
    if (Array.isArray(value)) for (const item of value) yield* templates(item);
    else yield* templates(value);
  }
}

test("only initial setup and proven user cancellation expose Create", () => {
  for (const [status, reason, expected] of [
    ["ready", null, true], ["not-dispatched", "user-canceled", true],
    ["not-dispatched", "budget-blocked", false], ["not-dispatched", "unavailable", false],
    ...["submitting", "submitted", "uncertain", "checking", "available", "unavailable", "retired"].map(value => [value, null, false]),
  ]) assert.equal(nativeStoryDialogPresentation(state(status, reason)).create, expected, `${status}/${reason}`);
});

test("completion checks require an acknowledged handle and a nonchecking read state", () => {
  for (const status of ["ready", "submitting", "submitted", "not-dispatched", "uncertain", "checking", "available", "unavailable", "retired"]) {
    assert.equal(nativeStoryDialogPresentation(state(status)).check, false);
    assert.equal(nativeStoryDialogPresentation(state(status, null, handle)).check, ["submitted", "unavailable"].includes(status));
  }
});

test("typed failure states and acknowledgment have truthful presentation keys", () => {
  assert.equal(nativeStoryDialogPresentation(state("submitted", null, handle)).status, "submitted");
  assert.equal(nativeStoryDialogPresentation(state("uncertain")).status, "uncertain");
  assert.equal(nativeStoryDialogPresentation(state("not-dispatched", "budget-blocked")).status, "budget");
  assert.equal(nativeStoryDialogPresentation(state("not-dispatched", "user-canceled")).status, "canceled");
  assert.equal(nativeStoryDialogPresentation(state("not-dispatched", "unavailable")).status, "unavailable");
  for (const status of ["ready", "submitting", "submitted", "not-dispatched", "uncertain", "checking", "unavailable", "retired"])
    assert.equal(nativeStoryDialogPresentation(state(status)).open, false);
  assert.equal(nativeStoryDialogPresentation(state("available", null, handle)).open, true);
});

test("form submit remains explicit and refuses composition, invalid guidance and frozen states", () => {
  for (const [overrides, expected] of [
    [{}, 1], [{ composing: true }, 0], [{ audience: "a".repeat(121) }, 0], [{ tone: "t".repeat(121) }, 0],
    [{ state: state("submitted", null, handle) }, 0], [{ state: state("uncertain") }, 0],
  ]) {
    let submits = 0, prevented = 0;
    const form = renderNativeStoryDialog(input({ ...overrides, create: () => submits++ }));
    binding(form, "@submit=")({ preventDefault: () => prevented++ });
    assert.equal(prevented, 1); assert.equal(submits, expected);
  }
});

test("IME Enter does not submit while ordinary keyboard behavior is preserved", () => {
  const form = renderNativeStoryDialog(input());
  const keydown = binding(form, "@keydown=");
  for (const [key, isComposing, keyCode, expected] of [
    ["Enter", true, 13, 1], ["Enter", false, 229, 1], ["Enter", false, 13, 0], ["Tab", true, 9, 0],
  ]) {
    let prevented = 0;
    keydown({ key, isComposing, keyCode, preventDefault: () => prevented++ });
    assert.equal(prevented, expected);
  }
});

test("native cancellation delegates retirement synchronously without claiming job cancellation", () => {
  const sequence = [];
  const form = renderNativeStoryDialog(input({ close: () => sequence.push("close") }));
  binding(form, "@cancel=")({ preventDefault: () => sequence.push("prevent") });
  assert.deepEqual(sequence, ["prevent", "close"]);
});

test("field input changes guidance only and forwards composition state separately", () => {
  const changes = [], composition = [];
  const form = renderNativeStoryDialog(input({
    change: (...value) => changes.push(value), composition: value => composition.push(value),
    create: () => assert.fail("field changes cannot generate"),
  }));
  const fields = [...templates(form)].filter(value => value.strings.some(part => part.endsWith("@input=")));
  assert.equal(fields.length, 2);
  binding(fields[0], "@input=")({ currentTarget: { value: "読者" } });
  binding(fields[1], "@input=")({ currentTarget: { value: "هادئ" } });
  binding(form, "@compositionstart=")(); binding(form, "@compositionend=")();
  assert.deepEqual(changes, [["audience", "読者"], ["tone", "هادئ"]]);
  assert.deepEqual(composition, [true, false]);
});

test("every active state retains the same two fields and one nonautofocusing status region", () => {
  for (const status of ["ready", "submitting", "submitted", "not-dispatched", "uncertain", "checking", "available", "unavailable"]) {
    const form = renderNativeStoryDialog(input({ state: state(status, null, handle) }));
    const markup = [...templates(form)].flatMap(value => value.strings).join("");
    assert.equal((markup.match(/role="status"/gu) ?? []).length, 1);
    assert.equal((markup.match(/name=/gu) ?? []).length, 2);
    assert.match(markup, /aria-live="polite" aria-atomic="true"/u);
    assert.doesNotMatch(markup, /autofocus|placeholder=|contenteditable/iu);
  }
});

test("Check keeps its template and refuses activation while checking or after availability", () => {
  let previous;
  for (const [status, expected] of [["submitted", 1], ["checking", 0], ["available", 0], ["unavailable", 1]]) {
    let checks = 0;
    const form = renderNativeStoryDialog(input({ state: state(status, null, handle), check: () => checks++ }));
    const button = [...templates(form)].find(value => value.values.includes("story.launcher.check"));
    assert.ok(button);
    if (previous) assert.equal(button.strings, previous);
    previous = button.strings;
    assert.equal(binding(button, "aria-disabled="), String(!expected));
    binding(button, "@click=")();
    assert.equal(checks, expected);
  }
});

test("backdrop clicks close but clicks from dialog descendants do not", () => {
  let closes = 0;
  const dialog = {}, descendant = {};
  const form = renderNativeStoryDialog(input({ close: () => closes++ }));
  const click = binding(form, "@click=");
  click({ target: descendant, currentTarget: dialog });
  assert.equal(closes, 0);
  click({ target: dialog, currentTarget: dialog });
  assert.equal(closes, 1);
});

test("native close delegates only while the dialog remains closed", () => {
  let closes = 0;
  const form = renderNativeStoryDialog(input({ close: () => closes++ }));
  const close = binding(form, "@close=");
  close({ currentTarget: { open: true } });
  assert.equal(closes, 0);
  close({ currentTarget: { open: false } });
  assert.equal(closes, 1);
});

test("Open forwards the exact activation event to the host", () => {
  const events = [], event = { type: "click", detail: 0 };
  const form = renderNativeStoryDialog(input({ state: state("available", null, handle), open: value => events.push(value) }));
  const button = [...templates(form)].find(value => value.values.includes("story.launcher.open"));
  assert.ok(button);
  binding(button, "@click=")(event);
  assert.equal(events.length, 1);
  assert.equal(events[0], event);
});

test("frozen guidance is readonly rather than disabled and keeps the field templates", () => {
  let previous;
  for (const [status, reason, readonly] of [
    ["ready", null, false], ["not-dispatched", "user-canceled", false],
    ["not-dispatched", "budget-blocked", true], ["not-dispatched", "unavailable", true],
    ...["submitting", "submitted", "uncertain", "checking", "available", "unavailable", "retired"].map(value => [value, null, true]),
  ]) {
    const form = renderNativeStoryDialog(input({ state: state(status, reason, handle), audience: "読者", tone: "هادئ" }));
    const fields = [...templates(form)].filter(value => value.strings.some(part => part.endsWith("@input=")));
    assert.equal(fields.length, 2);
    fields.forEach((field, index) => {
      assert.equal(binding(field, "?readonly="), readonly, `${status}/${reason}/${index}`);
      assert.doesNotMatch(field.strings.join(""), /\bdisabled\b/u);
      assert.equal(binding(field, ".value="), ["読者", "هادئ"][index]);
      if (previous) assert.equal(field.strings, previous[index]);
    });
    previous = fields.map(field => field.strings);
  }
});

const [host, workspace, view, css] = await Promise.all([
  readFile(new URL("../src/components/document-artifacts.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/components/forma-workspace.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/components/native-short-story-dialog.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/components/native-short-story-dialog.css", import.meta.url), "utf8"),
]);

test("binding source keeps one controller and an explicit personal-document entry", () => {
  assert.match(host, /this\.#nativeStoryController\?\?=new NativeShortStoryController/u);
  assert.equal((host.match(/new NativeShortStoryController/gu) ?? []).length, 1);
  const controllerStart = host.indexOf("    const controller=this.#nativeStoryController??=new NativeShortStoryController({");
  const controllerEnd = host.indexOf("    const opening=controller.open({documentId,current});", controllerStart);
  assert.ok(controllerStart >= 0 && controllerEnd > controllerStart);
  const controller = host.slice(controllerStart, controllerEnd);
  assert.match(controller, /request:\(path,init\)=>\{\n {8}const opening=this\.#nativeStoryOpening,signal=init\.signal;/u);
  assert.match(controller, /return store\.guardedFetch\(path,init,"Read story",\{\n {10}current:\(\)=>this\.store===store&&Boolean\(opening&&signal&&!signal\.aborted&&this\.#nativeStoryLive\(opening\)\),/u);
  assert.doesNotMatch(controller, /globalThis\.fetch|current:\s*current|current:\(\)=>current\(/u);
  assert.match(host, /change:\(field,value\)=>\{if\(!editable\(\)\)return;/u);
  assert.match(host, /composition:active=>\{if\(!editable\(\)\)return;/u);
  assert.match(host, /session&&!session\.projectContext&&!session\.impersonation/u);
  assert.match(host, /projection\.documents\.some\(value=>value\.id===documentId[^\n]*!value\.removed\)/u);
  assert.match(host, /openNativeShortStory\(nativeStoryDocumentId,\{current:\(\)=>nativeStorySourceCurrent\(\)\}\)/u);
  assert.match(host, /void this\.#openCreate\(true\);\}\}>Create output/u);
  assert.equal((host.match(/\+\+this\.#nativeStoryIntentRevision/gu) ?? []).length, 1);
  for (const [start, end] of [
    ["  #openCreate=async(", "  async #revealWorkbenchPane("],
    ["  async openRender(", "  async openArtifactById("],
    ["  async openArtifactById(", "  // Exact read-only job inspection"],
    ["  async openJobById(", "  #closeOnBackdrop("],
    ["  async #openArtifact(", "  #model3dReferences("],
    ["  async #inspectFailedInputs(", "  async #inspectRunningInputs("],
    ["  async #inspectRunningInputs(", "  #content("],
  ]) {
    const a = host.indexOf(start), b = host.indexOf(end, a);
    assert.ok(a >= 0 && b > a);
    const method = host.slice(a, b);
    if (start === "  async openArtifactById(")
      assert.match(method, /if\(!sourceCurrent\(\)\|\|options\.current&&!options\.current\("opening"\)\|\|nativeIntent!==this\.#nativeStoryIntentRevision\)return false;this\.retireNativeShortStory\(\)/u);
    assert.match(method, /nativeIntent=this\.#nativeStoryIntentRevision/u);
    assert.match(method, /sourceCurrent=\(\)=>nativeIntent===this\.#nativeStoryIntentRevision&&privateCurrent\(\)/u);
  }
});

test("native dialog source bypasses generic cached draft DOM", () => {
  assert.match(host, /this\.#nativeStoryOpening\?keyed\(this\.#nativeStoryOpening\.id,this\.#createOpen\?this\.#nativeStoryTemplate\(this\.#nativeStoryOpening\):nothing\):cache\(/u);
  const retire = host.slice(host.indexOf("  #retireNativeStoryOpening("), host.indexOf("  async openNativeShortStory("));
  assert.match(retire, /this\.#nativeStoryAudience="";this\.#nativeStoryTone="";this\.#nativeStoryLocale=""/u);
  const clear = retire.indexOf("this.#nativeStoryOpening=null"), close = retire.indexOf("dialog?.close()");
  assert.notEqual(clear, -1); assert.notEqual(close, -1); assert.ok(clear < close);
  assert.doesNotMatch(retire, /rememberRequestDraft/u);
});

test("opening focus is owned temporarily and editing requires the exact still-open native dialog", () => {
  const opening = host.slice(host.indexOf("  async openNativeShortStory("), host.indexOf("  #nativeStoryTemplate("));
  assert.match(opening, /const epoch=this\.#nativeStoryEpoch\+1;\n {4}this\.retireNativeShortStory\(\);if\(this\.#nativeStoryEpoch!==epoch\)return false/u);
  assert.match(opening, /captureOutputNavigationFocus\(this\.ownerDocument/u);
  assert.match(opening, /stage==="opening"\?focus\.current\(\)/u);
  assert.match(opening, /this\.#nativeStoryDialog\(\)\?\.open&&this\.#nativeStoryDialog\(\)\?\.matches\(":modal"\)/u);
  assert.match(opening, /finally\{focus\.dispose\(\);\}/u);
  assert.match(host, /create&&!create\.open&&!this\.#nativeStoryOpening\)ensureModalDialog\(create\)/u);
});

// The former adjacency-only pane assertion is replaced by actual Workspace
// transition and reentry controls in native-image-workspace-integration.test.mjs.

test("result navigation source retains exact expiry checks across admitted native close", () => {
  const open = host.slice(host.indexOf("  async #openNativeStoryResult("), host.indexOf("  #privateSourceRevision=0;"));
  assert.match(open, /controller\.openStory\(opening\)/u);
  assert.match(open, /Date\.parse\(completion\.expiresAt\)>Date\.now\(\)&&nativeStoryRetainedRoute\(completion,handle\)===path/u);
  assert.match(open, /await navigation\.closeNativePresentation/u);
  assert.match(open, /if\(!navigation\.current\(\)\|\|!lease\.closedCurrent\(\)\|\|!exact\(\)\)return false;\n {8}return navigation\.route\(path,\{documentFocus:false\}\)/u);
  assert.doesNotMatch(open, /location\.(assign|replace)|window\.open|setInterval/u);
});

test("focused presentation source supplies touch, zoom and logical layout foundations", () => {
  assert.match(css, /min-block-size: max\(2\.75rem, 44px\)/u);
  assert.match(css, /font-size: max\(1rem, 16px\)/u);
  assert.match(css, /100dvh/u); assert.match(css, /env\(safe-area-inset-bottom\)/u);
  assert.match(css, /flex-wrap: wrap/u); assert.match(css, /overflow-wrap: anywhere/u);
  assert.match(css, /@media \(max-width: 40rem\)/u);
  assert.match(css, /--native-story-content-gutter: 1\.5rem/u);
  assert.match(css, /\.native-short-story-dialog > :is\(header, \.native-story-context, \.native-story-fields, \.native-story-status, footer\) \{\n {2}padding-inline: var\(--native-story-content-gutter\);/u);
  assert.match(css, /\.document-artifacts > header:has\(> \.native-story-launch\) \{ align-items: stretch; \}/u);
  const footerStart = css.indexOf(".native-short-story-create > .native-short-story-dialog > footer {");
  const footerEnd = css.indexOf("}", footerStart);
  assert.ok(footerStart >= 0 && footerEnd > footerStart);
  const footer = css.slice(footerStart, footerEnd);
  assert.match(footer, /align-items: stretch/u);
  assert.match(footer, /position: static/u);
  assert.doesNotMatch(css, /position: sticky|scroll-padding-block: 1rem 6rem/u);
  assert.match(view, /<bdi lang=\$\{input\.locale\}/u);
  assert.match(view, /type="text" dir="auto"/u);
});

test("all four message catalogs contain every focused presentation key", async () => {
  const keys = ["title", "document", "language", "settings", "audience", "tone", "optional", "maximum", "create", "close", "check", "open", "submitting", "submitted", "checking", "available", "unavailable", "uncertain", "canceled", "budget"];
  for (const path of ["localization.ts", "locales/fr.ts", "locales/ar.ts", "locales/ja.ts"]) {
    const source = await readFile(new URL(`../src/components/design-system/${path}`, import.meta.url), "utf8");
    for (const key of keys) assert.ok(source.includes(`"story.launcher.${key}":`), `${path}: ${key}`);
  }
});
