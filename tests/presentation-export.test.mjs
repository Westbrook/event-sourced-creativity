import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { registerHooks } from "node:module";
import { resolveObjectURL } from "node:buffer";
import ts from "typescript";

import { FORMA_RESPONSIVE_MESSAGES } from "../src/components/design-system/locales/responsive-messages.ts";
import { defaultSlidePresentation } from "../src/model/document-artifacts.ts";
import { createPowerPointDocument, POWERPOINT_DOCUMENT_MIME } from "../src/model/office-documents.ts";
import { presentationEditableExportFilename } from "../src/model/presentation-export.ts";
import { extractSourceDocument } from "../src/model/source-documents.ts";
import { publicEventPayload } from "../worker/event-privacy.ts";

test("one genuine editable .pptx presentation works across PowerPoint, Google Slides, and Keynote", async () => {
  const item = {
    title: "Approved customer decision",
    body: "Every compatible editor preserves editable evidence.",
    notes: "Source: Approved executive narrative.",
    image_prompt: "",
    slide: null,
  };
  const bytes = createPowerPointDocument([item], defaultSlidePresentation("editorial"));
  const archive = Buffer.from(bytes).toString("latin1");
  assert.match(archive, /ppt\/slides\/slide1\.xml/);
  assert.match(archive, /ppt\/notesSlides\/notesSlide1\.xml/);

  const filename = presentationEditableExportFilename("Café — Executive Decision", "en");
  assert.equal(filename, "cafe-executive-decision.pptx");
  assert.doesNotMatch(filename, /\.(?:key|gslides|pdf)$/u);
  const extracted = await extractSourceDocument(new File([bytes], filename, { type: POWERPOINT_DOCUMENT_MIME }));
  assert.equal(extracted.status, "ready");
  assert.equal(extracted.sourceKind, "presentation");
  assert.match(extracted.text, /Approved customer decision/u);

  assert.equal(presentationEditableExportFilename("", "en"), "slide-deck.pptx");
  assert.equal(presentationEditableExportFilename("東京の提案", "ja"), "東京の提案.pptx");
});

test("the presentation export records truthful, public-safe audited PowerPoint metadata", () => {
  const event = publicEventPayload("export-event", {
    artifact_id: "approved-artifact",
    artifact_kind: "slides",
    document_id: "approved-document",
    format: POWERPOINT_DOCUMENT_MIME,
    destination_kind: "powerpoint",
    page_count: 12,
    artifact_revision: 3,
    content_sha256: "abcdef1234567890",
    render_mode: "editable-office-shapes",
  });

  assert.equal(event.payload.format, POWERPOINT_DOCUMENT_MIME);
  assert.equal(event.payload.destination_kind, "powerpoint");
  assert.equal(event.payload.artifact_revision, 3);
  assert.equal(event.payload.content_sha256, "abcdef1234567890");
  assert.equal(event.privateJson, null, "format metadata never requires an authored private envelope");
});

test("the unified compatible presentation export, recovery, and import instructions are fully translated", () => {
  const keys = [
    "presentation.export.powerpoint",
    "presentation.export.powerpointHint",
    "presentation.export.pdfClipped",
    "presentation.export.pdfFailed",
    "presentation.export.powerpointFailed",
  ];
  for (const [locale, messages] of Object.entries(FORMA_RESPONSIVE_MESSAGES)) {
    for (const key of keys) assert.ok(messages[key]?.trim(), `${locale} translates ${key}`);
    const label = messages["presentation.export.powerpoint"];
    assert.match(label, /PowerPoint/u);
    assert.match(label, /Google (?:Slides|スライド)/u);
    assert.match(label, /Keynote/u);
    assert.match(label, /\.pptx/u);
    assert.match(messages["presentation.export.powerpointHint"], /Google (?:Drive|ドライブ)/u);
    assert.equal(messages["presentation.export.googleSlides"], undefined);
    assert.equal(messages["presentation.export.keynote"], undefined);
  }
});

test("one accessible export menu separates audience-safe delivery from explicitly labeled private presenter copies", async () => {
  const [deck, styles, visualHarness] = await Promise.all([
    readFile(new URL("../src/components/presentation-deck.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
    readFile(new URL("./presentation-pdf.visual.mjs", import.meta.url), "utf8"),
  ]);

  assert.equal((deck.match(/class="button secondary compact presentation-deck-export"/gu) ?? []).length, 1);
  assert.match(deck, /popovertarget=\$\{this\.#exportMenuId\} aria-controls=\$\{this\.#exportMenuId\} aria-expanded=\$\{this\.#exportMenuOpen\}/u);
  assert.match(deck, /class="presentation-deck-export-menu" popover="auto" role="group"/u);
  assert.match(deck, /#toggleExportMenu\(event:ToggleEvent\)\{\s*const panel=event\.currentTarget as HTMLElement;\s*this\.#exportMenuOpen=this\.isConnected&&panel\.matches\(":popover-open"\);/u, "aria-expanded follows current native state, not a stale queued toggle detail");
  assert.match(deck, /menu\.hidePopover\(\);this\.querySelector<HTMLButtonElement>\("\.presentation-deck-export"\)\?\.focus\(\{preventScroll:true\}\)/u);
  assert.match(deck, /#exportFromMenu\("pdf",items,presentation\)/u);
  assert.match(deck, /#exportFromMenu\("powerpoint",items,presentation\)/u);
  assert.match(deck, /#exportFromMenu\("powerpoint-presenter",items,presentation\)/u);
  assert.match(deck, /#presenterExportAllowed\(artifact\)\?html/u,"only the authorized generating creator receives a private-copy control");
  assert.match(deck, /#downloadPowerPointVariant\(items,presentation,false\)/u,"ordinary presentation downloads are audience-safe");
  assert.match(deck, /#downloadPowerPointVariant\(items,presentation,true\)/u,"presenter copies require a separate explicit choice");
  assert.match(deck, /presenter_notes_included:includePresenterNotes/u,"release receipts disclose which privacy variant was exported");
  assert.ok(deck.indexOf('#exportFromMenu("pdf",items,presentation)') < deck.indexOf('#exportFromMenu("powerpoint",items,presentation)'));
  assert.match(deck, /this\.i18n\.system\("Export"\)/u);
  assert.match(deck, /this\.i18n\.system\("Download PDF"\)/u);
  assert.match(deck, /this\.i18n\.t\("presentation\.export\.powerpoint"\)/u);

  assert.match(styles, /\.presentation-deck-export-menu\[popover\]\s*\{[^}]*position:\s*fixed;[^}]*inline-size:\s*min\(24rem,var\(--forma-popover-max-width,calc\(100dvw - 1rem\)\)\);[^}]*max-block-size:\s*var\(--forma-popover-max-height,calc\(100dvh - 1rem\)\);[^}]*overflow:\s*auto/u, "native positioning preserves explicit viewport bounds and scrolling, including the CSS fallback");
  assert.match(styles, /\.presentation-deck-export-menu button\s*\{[^}]*min-block-size:\s*var\(--forma-control-min-size,2\.75rem\)/u);
  assert.equal((visualHarness.match(/page\.getByRole\("button",\{name:"Export"\}\)\.click\(\)/gu) ?? []).length, 2);
  assert.match(visualHarness,/presentation-deck-export-status\[data-export-stage="failed"\]/u,"the browser fidelity harness verifies the persistent export failure state");
  assert.match(visualHarness,/getByRole\("button",\{name:"Retry"\}\)/u,"failed captures expose the same accessible recovery control in the real browser");
});

test("presentation exports communicate staged progress, accessible completion counts, and recoverable failures", async () => {
  const [deck, styles] = await Promise.all([
    readFile(new URL("../src/components/presentation-deck.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
  ]);

  assert.match(deck, /#exportProgress:\{stage:"preparing"\|"rendering"\|"finalizing"\|"downloading"\|"failed";completed:number;total:number;message\?:string\}\|null=null/u);
  assert.match(deck, /class="presentation-deck-export-status" data-export-stage=\$\{progress\.stage\} role=\$\{failed\?"alert":"status"\} aria-live=\$\{failed\?"assertive":"polite"\} aria-atomic="true"/u);
  assert.match(deck, /<progress max=\$\{total\} value=\$\{completed\} aria-label=\$\{this\.i18n\.t\("status\.progress"\)\} aria-valuetext=\$\{count\}>/u);
  assert.match(deck, /<progress aria-label=\$\{this\.i18n\.t\("status\.progress"\)\}><\/progress>/u,"preparation remains truthfully indeterminate until page rendering begins");
  assert.match(deck, /this\.i18n\.system\("\{count\} of \{total\}",\{count:this\.i18n\.number\(completed\),total:this\.i18n\.number\(total\)\}\)/u,"slide counts use existing translated labels and locale-aware numerals");
  assert.match(deck, /this\.i18n\.t\("job\.progress\.rendering"\)/u);
  assert.match(deck, /this\.i18n\.t\("job\.progress\.finalizing"\)/u);
  assert.match(deck, /this\.i18n\.t\("job\.progress\.downloading"\)/u);
  assert.match(deck, /aria-describedby=\$\{this\.#exportProgress\?`\$\{this\.#exportMenuId\}-status`:nothing\} aria-busy=\$\{String\(this\.#exporting\)\}/u);
  assert.match(deck, /#exportAbort\?:AbortController/u);
  assert.match(deck, /override disconnectedCallback\(\)\{this\.#closeDeckPopovers\(\);this\.#exportAbort\?\.abort\(\)/u,"leaving the presentation closes native menus and cancels any unfinished export synchronously");
  assert.match(deck, /const result=await renderPresentationPdf\(items,presentation,options\)/u);
  const exportTree = ts.createSourceFile("presentation-deck.ts", deck, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const exportClass = exportTree.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === "PresentationDeck");
  for (const name of ["#downloadPdf", "#downloadPowerPointVariant"]) {
    const method = exportClass?.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(exportTree) === name);
    assert.ok(method, name + " is the real exporter");
    const calls = [];
    const visit = node => { if (ts.isCallExpression(node)) calls.push(node.expression.getText(exportTree)); ts.forEachChild(node, visit); };
    visit(method);
    assert.ok(calls.includes("this.#captureExportFocus") && calls.includes("this.#finishExport"),
      name + " binds the shared focus owner and finalizer; PDF success still requires browser observation");
  }
  assert.match(deck, /const bytes=await createPowerPointDocumentAsync\(items,presentation,/u,"large editable exports use the same cooperative asynchronous pipeline");
  assert.ok((deck.match(/onProgress,signal:controller\.signal/gu)??[]).length>=2,"PDF and editable presentations both stream real slide progress and honor cancellation");
  assert.match(deck, /new Blob\(\[result\.bytes as Uint8Array<ArrayBuffer>\]/u,"the complete PDF is not duplicated in memory before browser delivery");
  assert.match(deck, /new Blob\(\[bytes as Uint8Array<ArrayBuffer>\]/u,"the complete editable presentation is not duplicated in memory before browser delivery");
  assert.doesNotMatch(deck,/Uint8Array\.from\((?:result\.bytes|bytes)\)/u);
  assert.match(deck, /class="button secondary compact presentation-deck-export-cancel"[\s\S]{0,100}this\.#exportAbort\?\.abort\(\)/u,"large asynchronous exports provide a genuinely cancellable operation");
  assert.match(deck, /this\.i18n\.t\("action\.cancel"\)/u,"the cancel action remains translated in every supported locale");
  assert.match(deck, /class="button secondary compact presentation-deck-export-retry"[\s\S]{0,180}trigger\?\.focus\(\{preventScroll:true\}\);trigger\?\.click\(\)/u,"failure recovery restores focus and reopens the export format chooser");
  assert.match(deck,/presentation\.export\.pdfClipped/u,"irrecoverable protected-content clipping receives truthful, actionable guidance");
  assert.match(deck,/presentation\.export\.pdfFailed/u);
  assert.match(deck,/presentation\.export\.powerpointFailed/u);
  assert.doesNotMatch(deck,/too large to export completely|Nothing was released/u,"export failures must not misdiagnose slide clipping as deck size");
  assert.doesNotMatch(deck,/this\.store\.toast\(message\)/u,"export failures stay in their persistent alert instead of the shell's success-check toast");
  assert.match(deck, /\$\{this\.#renderExportProgress\(\)\}\s*<span class="sr-only" role="status"/u,"export announcements remain separate from slide-navigation announcements");

  assert.match(styles, /\.presentation-deck-export-status\s*\{[^}]*display:\s*grid;[^}]*min-inline-size:\s*0/u);
  assert.match(styles, /\.presentation-deck-export-status :is\(\.presentation-deck-export-cancel,\.presentation-deck-export-retry\)\s*\{[^}]*min-block-size:\s*var\(--forma-control-min-size,2\.75rem\)/u,"cancellation and recovery remain accessible touch targets");
  assert.match(styles, /\.presentation-deck-export-status\[data-export-stage="failed"\]\s*\{[^}]*color:\s*var\(--danger\)/u);
  assert.match(styles, /\.presentation-deck--slideshow\.presentation-deck--export-status\s*\{\s*grid-template-rows:\s*auto auto minmax\(0,1fr\)/u,"a visible status region preserves the constrained slide viewport");
  assert.match(styles, /\[data-output-focus="true"\] \.presentation-deck--slideshow\.presentation-deck--export-status\s*\{\s*grid-template-rows:\s*auto minmax\(0,1fr\)/u,"progress remains visible and slide geometry remains bounded in focused short-landscape viewers");
});

test("PDF, PowerPoint, Word, and media-archive conversion load only after an authorized export is requested", async () => {
  const [deck, artifacts] = await Promise.all([
    readFile(new URL("../src/components/presentation-deck.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/document-artifacts.ts", import.meta.url), "utf8"),
  ]);

  for (const component of [deck, artifacts]) {
    assert.doesNotMatch(component, /^import\s+(?!type\b)[^\n]*from\s+["'][^"']*office-documents["']/mu);
  }
  assert.doesNotMatch(deck, /^import\s+(?!type\b)[^\n]*from\s+["'][^"']*presentation-pdf(?:-export)?["']/mu);
  assert.match(deck, /await import\("\.\/presentation-pdf-export"\)/u);
  assert.match(deck, /await import\("\.\.\/model\/office-documents"\)/u);
  assert.equal((artifacts.match(/await import\("\.\.\/model\/office-documents"\)/gu) ?? []).length, 2);

  assert.match(deck, /#downloadPowerPoint\(items:DocumentArtifactDraftItem\[\],presentation:SlidePresentation\)/u);
  assert.match(deck, /format:POWERPOINT_DOCUMENT_MIME,destination_kind:"powerpoint"/u);
  assert.match(deck, /presentationEditableExportFilename\([^;]+,this\.i18n\.locale\)/u);
  assert.match(deck, /presentation\.export\.powerpointHint/u);
  assert.match(deck, /presentation\.export\.powerpoint/u);
  assert.doesNotMatch(deck, /#exportTarget|#setExportTarget|presentation-deck-export-format|value="google-slides"|value="keynote"/u);
  assert.ok((deck.match(/authorizationScopeActive\(authorization\)/gu) ?? []).length >= 6);
  assert.doesNotMatch(deck, /(?:www\.)?(?:googleapis\.com|drive\.google\.com|icloud\.com)|window\.open\(/u);
});

test("production workspace and Canvas routes never eagerly preload PDF or Office converters", async () => {
  const manifest = JSON.parse(await readFile(new URL("../dist/client/.vite/manifest.json", import.meta.url), "utf8"));
  const entries = Object.entries(manifest);
  const office = entries.find(([key, entry]) => key === "src/model/office-documents.ts" || entry.src === "src/model/office-documents.ts");
  const pdf = entries.find(([key, entry]) => key === "src/components/presentation-pdf-export.ts" || entry.src === "src/components/presentation-pdf-export.ts");

  assert.ok(office, "Office creation must have its own lazy production chunk");
  assert.ok(pdf, "PDF capture must have its own lazy production chunk");
  assert.equal(office[1].isDynamicEntry, true);
  assert.equal(pdf[1].isDynamicEntry, true);

  const walkStaticImports = (key, visited = new Set()) => {
    if (visited.has(key)) return visited;
    visited.add(key);
    for (const child of manifest[key]?.imports ?? []) walkStaticImports(child, visited);
    return visited;
  };

  const applicationEntries = entries.filter(([key, entry]) => (entry.isEntry || entry.isDynamicEntry) && key !== office[0] && key !== pdf[0]);
  assert.ok(applicationEntries.length >= 2, "application entry points remain independently code-split");
  for (const [key] of applicationEntries) {
    const staticImports = walkStaticImports(key);
    assert.equal(staticImports.has(office[0]), false, `${key} must not eagerly load Office conversion`);
    assert.equal(staticImports.has(pdf[0]), false, `${key} must not eagerly load PDF capture`);
  }

  assert.ok(entries.some(([, entry]) => entry.dynamicImports?.includes(office[0])), "Office is reachable through a dynamic import");
  assert.ok(entries.some(([, entry]) => entry.dynamicImports?.includes(pdf[0])), "PDF is reachable through a dynamic import");
});


// Reuse the complete actual component/native-port fixture. Only test registration
// is omitted. Its two lazy converter dependencies are the real modules; no export,
// cancellation, authorization, or native-popover production method is replaced.
const exportFixtureUrl = new URL("./inactive-generation-dialog-host.test.mjs", import.meta.url);
const exportFixtureSource = await readFile(exportFixtureUrl, "utf8");
const exportFixtureTree = ts.createSourceFile(exportFixtureUrl.pathname, exportFixtureSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const exportFixtureFirstTest = exportFixtureTree.statements.find(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) && node.expression.expression.getText(exportFixtureTree) === "test");
assert.ok(exportFixtureFirstTest);
let exportFixtureModule = exportFixtureSource.slice(0, exportFixtureFirstTest.getFullStart());
const exportDependencySeam = "  const code = ts.transpileModule(sourceText(relative),";
assert.equal(exportFixtureModule.split(exportDependencySeam).length, 2);
exportFixtureModule = 'import * as actualOfficeExport from "../src/model/office-documents.ts";\nimport * as actualPdfExport from "../src/components/presentation-pdf-export.ts";\n' + exportFixtureModule.replace(exportDependencySeam,
  '  if (relative === "src/components/presentation-deck.ts") { dependencies.set("../model/office-documents", actualOfficeExport); dependencies.set("./presentation-pdf-export", actualPdfExport); }\n' + exportDependencySeam);
// Expose the existing finite Store owner's returned retirement controls; its
// source/auth implementation is unchanged, and no full Store claim is made.
const exportSourceOwnershipSeam = "  installSourceOwnershipPort(f.store);";
assert.equal(exportFixtureModule.split(exportSourceOwnershipSeam).length, 2);
exportFixtureModule = exportFixtureModule.replace(exportSourceOwnershipSeam,
  "  f.sourceOwnershipPort = installSourceOwnershipPort(f.store);");
exportFixtureModule += "\nexport { fixture as nativePresentationExportFixture };\n";
const exportFixtureModuleUrl = new URL(exportFixtureUrl);
exportFixtureModuleUrl.search = "?presentation-export-compat";
const exportFixtureHook = registerHooks({ load(url, context, next) {
  return url === exportFixtureModuleUrl.href ? { format: "module", source: exportFixtureModule, shortCircuit: true } : next(url, context);
} });
let nativePresentationExportFixture;
try { ({ nativePresentationExportFixture } = await import(exportFixtureModuleUrl.href)); }
finally { exportFixtureHook.deregister(); }

async function nativeExportFixture(t, locale) {
  const forbiddenFetches = [];
  t.mock.method(globalThis, "fetch", async (...args) => {
    forbiddenFetches.push(args);
    assert.fail("No application or provider network is permitted in native export compatibility tests");
  });
  const f = nativePresentationExportFixture("create", { artifact: true, locale });
  t.after(() => {
    try { assert.equal(forbiddenFetches.length, 0, "caught converter errors cannot hide a forbidden fetch attempt"); }
    finally {
      for (const { instance } of f.renderer.instances.values()) if (instance.isConnected) { instance.isConnected = false; instance.disconnectedCallback(); }
      f.host.disconnectedCallback(); f.i18n.hostDisconnected();
    }
  });
  const completed = f.state.events.find(event => event.type === "DocumentRenderCompleted");
  const items = [{ id: "export-slide-a", title: "Exact audience title", body: "Exact audience evidence", notes: "Private presenter notes", image_prompt: "", context_group_ids: [] }];
  completed.payload.artifact_kind = "slides"; completed.payload.items = items; completed.payload.item_count = 1;
  f.state.content["content-A"] = JSON.stringify({ ...JSON.parse(f.state.content["content-A"]), items });
  assert.equal(await f.host.openArtifactById("artifact-A"), true); await f.flush();
  const deck = f.renderer.query(f.host, "forma-presentation-deck")[0];
  assert.ok(deck, "the actual artifact viewer mounts the complete production deck");
  const trigger = () => f.renderer.ownNodes(deck, "button").find(node => node.classList.contains("presentation-deck-export"));
  const panel = () => f.renderer.ownNodes(deck, "div").find(node => node.attributes.id === trigger()?.attributes.popovertarget);
  assert.ok(trigger() && panel());
  assert.equal(panel().attributes.popover, "auto"); assert.equal(panel().attributes.role, "group");
  assert.equal(Object.hasOwn(trigger().attributes, "disabled"), false);
  f.store.authorizeProjectExport = async () => assert.fail("Canceled conversion cannot authorize release or append an export receipt");
  return { f, deck, trigger, panel };
}

for (const locale of ["en", "fr", "ar", "ja"]) {
  test("native export " + locale + ": current popover state owns aria-expanded despite queued toggle detail", async t => {
    const { f, deck, trigger, panel } = await nativeExportFixture(t, locale);
    const original = structuredClone(f.state.events), content = structuredClone(f.state.content);
    assert.equal(trigger().attributes["aria-expanded"], false);
    trigger().click(); f.draw();
    assert.equal(panel().matches(":popover-open"), true); assert.equal(trigger().attributes["aria-expanded"], true);
    panel().handlers.toggle.call(deck, { currentTarget: panel(), newState: "closed" }); f.draw();
    assert.equal(panel().matches(":popover-open"), true);
    assert.equal(trigger().attributes["aria-expanded"], true, "an older queued closed detail cannot hide the current open state");
    panel().hidePopover(); f.draw();
    panel().handlers.toggle.call(deck, { currentTarget: panel(), newState: "open" }); f.draw();
    assert.equal(panel().matches(":popover-open"), false);
    assert.equal(trigger().attributes["aria-expanded"], false, "an older queued open detail cannot claim that a closed panel is open");
    assert.equal(f.state.requests.length, 0); assert.deepEqual(f.state.events, original); assert.deepEqual(f.state.content, content);
  });

  for (const format of ["pdf", "powerpoint"]) test("native export " + locale + " / " + format + ": leaving the real viewer aborts an unfinished export before its lazy converter runs", async t => {
    const { f, deck, trigger, panel } = await nativeExportFixture(t, locale);
    const original = structuredClone(f.state.events), content = structuredClone(f.state.content), aborted = [];
    const nativeAbort = AbortController.prototype.abort;
    t.mock.method(AbortController.prototype, "abort", function(reason) { aborted.push(this); return nativeAbort.call(this, reason); });
    trigger().click(); f.draw();
    const action = f.renderer.ownNodes(deck, "button").find(node => typeof node.handlers.click === "function" && node.handlers.click.toString().includes('#exportFromMenu("' + format + '",'));
    assert.ok(action, "the actual " + format + " menu action remains reachable");
    assert.equal(Object.hasOwn(action.attributes, "disabled"), false);
    action.click();
    assert.equal(panel().matches(":popover-open"), false, "the native menu closes before conversion handoff");
    f.draw();
    const progress = f.renderer.ownNodes(deck, "section").find(node => node.attributes["data-export-stage"] === "preparing");
    assert.ok(progress, "the unchanged async export has actually started, with visible preparing progress");
    assert.equal(progress.attributes.role, "status"); assert.equal(progress.attributes["aria-live"], "polite");
    assert.equal(String(trigger().attributes["aria-busy"]), "true");
    assert.equal(aborted.length, 0);
    const close = f.renderer.ownNodes(f.host, "button").find(node => node.attributes["aria-label"] === f.i18n.t("action.close", "Close"));
    assert.ok(close, "the actual viewer exposes its existing close action");
    close.click(); f.draw();
    assert.equal(deck.isConnected, false, "closing the parent actually detaches the deck");
    assert.equal(aborted.length, 1); assert.equal(aborted[0].signal.aborted, true, "the native abort signal is canceled synchronously during disconnection");
    await new Promise(setImmediate);
    assert.equal(f.renderer.query(f.host, "forma-presentation-deck").length, 0);
    assert.equal(f.state.requests.length, 0); assert.deepEqual(f.state.events, original); assert.deepEqual(f.state.content, content);
    assert.equal(f.trace.some(value => value.startsWith("toast:")), false, "canceling cannot claim a completed download");
  });
}


// Local browser contracts for the existing actual-component fixture. Preserve
// only its unchanged Export button across commits, as Lit does; all other native
// nodes retain the supplier's normal replacement behavior. These ports establish
// focus/event ordering and delivered bytes, not browser paint or Office rendering.
function exportCompletionPorts(t, context) {
  const { f, deck, trigger } = context, owner = deck.ownerDocument, view = owner.defaultView;
  const original = trigger(), downloads = [], focusCalls = [], receipts = [], releases = [], downloadUrls = [], heldUpdates = new Set();
  const outside = { isConnected: true, tagName: "BUTTON" }, body = { isConnected: true, tagName: "BODY", append() {} };
  let windowFocused = true, hidden = false, replaceTrigger = false, holdUpdate = null, failDownload = false, rejectUpdate = false, throwFocus = false, preparingUpdateFailure = false, enabledUpdateFailureAt = null;
  const originals = new Map(), save = (object, key, descriptor) => {
    const keys = originals.get(object) ?? new Map(); originals.set(object, keys);
    if (!keys.has(key)) keys.set(key, Object.getOwnPropertyDescriptor(object, key));
    Object.defineProperty(object, key, { configurable: true, ...descriptor });
  };
  const emit = (type, target) => { for (const listener of [...(f.listeners.get(type) ?? [])]) listener({ type, target }); };
  const focus = node => {
    if (node === original || node?.classList?.contains("presentation-deck-export")) {
      if (!node.isConnected || Object.hasOwn(node.attributes, "disabled")) return;
    }
    const previous = owner.activeElement;
    if (previous === node) return;
    previous?.listeners?.blur?.({ type: "blur", target: previous, relatedTarget: node });
    previous?.handlers?.blur?.call(previous.owner, { type: "blur", target: previous, relatedTarget: node });
    owner.activeElement = node;
    emit("focusin", node);
  };
  const install = node => {
    Object.defineProperty(node, "disabled", { configurable: true, get: () => Object.hasOwn(node.attributes, "disabled") });
    node.getClientRects = () => node.isConnected ? [node.getBoundingClientRect()] : [];
    node.checkVisibility = () => node.isConnected;
    node.focus = options => {
      focusCalls.push({ node, options });
      if (node === original && throwFocus) { throwFocus = false; throw new Error("Native focus failed"); }
      focus(node);
    };
    return node;
  };
  install(original);
  save(owner, "body", { value: body, writable: true });
  save(owner, "hasFocus", { value: () => windowFocused });
  save(owner, "hidden", { get: () => hidden });
  save(owner, "visibilityState", { get: () => hidden ? "hidden" : "visible" });
  save(owner, "createElement", { value: tag => {
    assert.equal(tag, "a", "the Deck only creates a native download anchor in this port");
    return { href: "", download: "", remove() {}, click() {
      downloadUrls.push(this.href);
      const blob = resolveObjectURL(this.href);
      assert.ok(blob instanceof Blob, "download resolves the actual converter's Blob");
      if (failDownload) throw new Error("Native download dispatch failed");
      downloads.push({ filename: this.download, blob });
    } };
  } });
  save(view, "setTimeout", { value: (callback, delay) => {
    assert.equal(delay, 60_000, "retain the production Blob cleanup schedule without a live long timer");
    releases.push(callback); return releases.length;
  } });
  save(deck, "contains", { value: node => node === original || f.renderer.ownNodes(deck, "button").includes(node) });
  const requestUpdate = deck.requestUpdate;
  save(deck, "requestUpdate", { value: function(...args) {
    if (preparingUpdateFailure) { preparingUpdateFailure = false; throw new Error("Native preparing update failed"); }
    if (enabledUpdateFailureAt !== null && downloads.length >= enabledUpdateFailureAt) {
      enabledUpdateFailureAt = null; throw new Error("Native enabled requestUpdate failed");
    }
    return requestUpdate.apply(this, args);
  } });
  const collect = f.renderer.collect.bind(f.renderer);
  f.renderer.collect = (markup, component) => {
    const start = f.renderer.nodes.length;
    collect(markup, component);
    if (component !== deck) return;
    for (const node of f.renderer.nodes.slice(start)) if (node.tag === "button") install(node);
    const index = f.renderer.nodes.findIndex((node, index) => index >= start && node.tag === "button" && node.classList.contains("presentation-deck-export"));
    if (index < 0) return;
    const next = f.renderer.nodes[index];
    if (replaceTrigger) { install(next); return; }
    for (const key of ["attributes", "properties", "propertyParts", "handlers", "full"]) original[key] = next[key];
    original.isConnected = true;
    f.renderer.nodes[index] = original;
    next.isConnected = false;
    if (original.disabled && owner.activeElement === original) {
      original.listeners?.blur?.({ type: "blur", target: original, relatedTarget: body });
      owner.activeElement = body;
      emit("focusin", body);
    }
  };
  const draw = f.draw;
  f.draw = () => {
    const result = draw();
    if (owner.activeElement && !owner.activeElement.isConnected) { owner.activeElement = body; emit("focusin", body); }
    return result;
  };
  const tick = f.tick;
  f.tick = async component => {
    const result = await tick(component);
    if (component === deck && rejectUpdate) { rejectUpdate = false; throw new Error("Native enabled update failed"); }
    if (component === deck && holdUpdate) {
      const held = holdUpdate; holdUpdate = null; held.entered(); await held.promise;
    }
    return result;
  };
  f.store.authorizeProjectExport = async (receipt, authorization) => {
    const call = { receipt, authorization, resolve: null };
    const answer = new Promise(resolve => { call.resolve = resolve; });
    receipts.push(call); return answer;
  };
  owner.activeElement = body;
  t.after(() => {
    for (const call of receipts) call.resolve?.(false);
    for (const held of heldUpdates) held.resolve();
    for (const release of releases) release();
    for (const url of downloadUrls) URL.revokeObjectURL(url);
    f.renderer.collect = collect; f.tick = tick; f.draw = draw;
    owner.activeElement = null;
    for (const [object, keys] of originals) for (const [key, descriptor] of keys) {
      if (descriptor) Object.defineProperty(object, key, descriptor); else delete object[key];
    }
  });
  const waitFor = async (predicate, message) => {
    for (let step = 0; step < 200; step++) {
      if (predicate()) return;
      await new Promise(setImmediate);
      if (f.requested) { f.requested = false; f.draw(); }
    }
    assert.fail(message);
  };
  const begin = format => {
    const action = f.renderer.ownNodes(deck, "button").find(node => typeof node.handlers.click === "function"
      && node.handlers.click.toString().includes('#exportFromMenu("' + format + '",'));
    assert.ok(action, "the real " + format + " action is rendered");
    trigger().focus({ preventScroll: true });
    action.click(); f.draw();
  };
  return { owner, original, outside, body, downloads, focusCalls, receipts, begin, waitFor,
    move: () => focus(outside),
    returnToBody: () => focus(body),
    interact: type => emit(type, body),
    leaveWindow: () => { windowFocused = false; emit("blur", view); windowFocused = true; },
    hideDocument: () => { hidden = true; emit("visibilitychange", owner); hidden = false; },
    replace: () => { replaceTrigger = true; f.draw(); },
    failDownload: () => { failDownload = true; },
    rejectEnabledUpdate: () => { rejectUpdate = true; },
    throwReturningFocus: () => { throwFocus = true; },
    failPreparingUpdate: () => { preparingUpdateFailure = true; },
    failEnabledRequestUpdate: () => { enabledUpdateFailureAt = downloads.length + 1; },
    deferUpdate: () => {
      let entered, resolve, enteredAlready = false;
      const reached = new Promise(done => { entered = () => { enteredAlready = true; done(); }; });
      const promise = new Promise(done => { resolve = done; });
      const held = { entered, promise, resolve: () => { heldUpdates.delete(held); resolve(); } };
      heldUpdates.add(held); holdUpdate = held;
      return { reached, resolve: held.resolve, isReached: () => enteredAlready };
    },
  };
}

for (const mode of ["current", "moved", "moved-back", "pointer", "key", "window", "hidden", "authorization", "source", "document", "artifact", "route", "replaced", "disconnected", "refused"]) {
  test("native export completion powerpoint: " + mode + " preserves exact focus ownership", async t => {
    const context = await nativeExportFixture(t, "en"), { f, deck, trigger } = context;
    const p = exportCompletionPorts(t, context), originalEvents = structuredClone(f.state.events), originalContent = structuredClone(f.state.content);
    p.begin("powerpoint");
    assert.equal(trigger() === p.original, true, "busy rendering retains the exact native trigger");
    assert.equal(trigger().disabled, true);
    assert.equal(p.owner.activeElement === p.body, true, "native disabled-button blur leaves BODY focused");
    await p.waitFor(() => p.receipts.length === 1, "the real PowerPoint converter must reach export authorization");
    const callsBefore = p.focusCalls.filter(call => call.node === p.original).length;
    if (mode === "moved") p.move();
    if (mode === "moved-back") { p.move(); p.returnToBody(); }
    if (mode === "pointer") p.interact("pointerdown");
    if (mode === "key") p.interact("keydown");
    if (mode === "source") { f.sourceOwnershipPort.retire(); f.sourceOwnershipPort.restore(); }
    if (mode === "window") p.leaveWindow();
    if (mode === "hidden") p.hideDocument();
    if (mode === "authorization") f.state.authorization = "retired-export-authorization";
    if (mode === "document") deck.documentId = "B";
    if (mode === "artifact") {
      f.state.events.push({ ...f.state.events.at(-1), eventId: "export-focus-revision", sequence: f.state.events.length + 1,
        type: "DocumentArtifactEdited", payload: { artifact_id: "artifact-A", document_id: "A", content_ref: "content-A", revision: 1 } });
    }
    if (mode === "route") f.store.route = { get: () => "/library?document=A" };
    if (mode === "replaced") p.replace();
    if (mode === "disconnected") {
      const close = f.renderer.ownNodes(f.host, "button").find(node => node.attributes["aria-label"] === f.i18n.t("action.close", "Close"));
      assert.ok(close); close.click(); f.draw();
      assert.equal(deck.isConnected, false, "the actual viewer removal retires the export owner");
    }
    p.receipts[0].resolve(mode !== "refused");
    await p.waitFor(() => !trigger()?.disabled, "the completed attempt must release its busy state");
    await new Promise(setImmediate);
    const returned = p.focusCalls.filter(call => call.node === p.original).length - callsBefore;
    if (mode === "current") {
      assert.equal(p.owner.activeElement === p.original, true, "successful delivery restores the original enabled Export button");
      assert.equal(p.original.isConnected, true); assert.equal(p.original.disabled, false);
      assert.equal(returned, 1, "only the exact completed operation returns focus once");
    } else {
      assert.equal(returned, 0, "an invalidated or unsuccessful operation cannot restore the old trigger");
      if (mode === "moved") assert.equal(p.owner.activeElement === p.outside, true, "new user focus remains untouched");
    }
    if (!["authorization", "disconnected", "refused"].includes(mode)) {
      assert.equal(p.downloads.length, 1, "these focus-only invalidations do not rewrite existing delivery semantics");
      assert.equal(p.downloads[0].blob.type, POWERPOINT_DOCUMENT_MIME);
      const bytes = new Uint8Array(await p.downloads[0].blob.arrayBuffer());
      assert.deepEqual([...bytes.slice(0, 4)], [80, 75, 3, 4], "the downloaded payload is the real Office ZIP");
    } else assert.equal(p.downloads.length, 0);
    assert.equal(f.state.requests.length, 0);
    if (mode !== "artifact") assert.deepEqual(f.state.events, originalEvents);
    assert.deepEqual(f.state.content, originalContent);
  });
}


test("native export completion powerpoint: a newer export owns its own enabled update", async t => {
  const context = await nativeExportFixture(t, "en"), { f, trigger } = context;
  const p = exportCompletionPorts(t, context);
  p.begin("powerpoint");
  await p.waitFor(() => p.receipts.length === 1, "the original real converter reaches authorization");
  const deferred = p.deferUpdate();
  p.receipts[0].resolve(true);
  await p.waitFor(deferred.isReached, "the finishing update must expose its real completion barrier");
  assert.equal(trigger().disabled, false, "the old enabled DOM has committed while its updateComplete is pending");
  assert.equal(p.downloads.length, 1);
  p.begin("powerpoint");
  const callsBefore = p.focusCalls.filter(call => call.node === p.original).length;
  assert.equal(trigger().disabled, true);
  deferred.resolve();
  await p.waitFor(() => p.receipts.length === 2, "the second actual converter must reach its own authorization");
  assert.equal(p.focusCalls.filter(call => call.node === p.original).length, callsBefore, "the older completion does not return focus into the newer operation");
  assert.equal(trigger().disabled, true, "old finalization cannot clear the newer busy operation");
  p.receipts[1].resolve(true);
  await p.waitFor(() => !trigger().disabled, "the newer operation completes its own enabled update");
  await new Promise(setImmediate);
  assert.equal(p.downloads.length, 2);
  assert.equal(p.owner.activeElement === p.original, true);
  assert.equal(p.focusCalls.filter(call => call.node === p.original).length, callsBefore + 1, "only the newer current operation returns focus");
  assert.equal(f.state.requests.length, 0);
});

for (const format of ["pdf", "powerpoint"]) test("native export completion " + format + ": explicit focused Cancel keeps its existing return", async t => {
  const context = await nativeExportFixture(t, "en"), { f, deck, trigger } = context;
  const p = exportCompletionPorts(t, context);
  p.begin(format);
  const cancel = f.renderer.ownNodes(deck, "button").find(node => node.classList.contains("presentation-deck-export-cancel"));
  assert.ok(cancel);
  cancel.focus({ preventScroll: true });
  assert.equal(p.owner.activeElement === cancel, true);
  const callsBefore = p.focusCalls.filter(call => call.node === p.original).length;
  cancel.click(); f.draw();
  await p.waitFor(() => !trigger().disabled, "deliberate cancellation releases the busy Export control");
  await new Promise(setImmediate);
  assert.equal(p.owner.activeElement === p.original, true, "the explicit removal of focused Cancel preserves its owned return");
  assert.equal(p.focusCalls.filter(call => call.node === p.original).length, callsBefore + 1);
  assert.equal(p.receipts.length, 0); assert.equal(p.downloads.length, 0); assert.equal(f.state.requests.length, 0);
});

test("native export completion powerpoint: a real download-dispatch error keeps recovery explicit", async t => {
  const context = await nativeExportFixture(t, "en"), { f, deck, trigger } = context;
  const p = exportCompletionPorts(t, context), errors = [];
  t.mock.method(console, "error", (...args) => errors.push(args));
  p.begin("powerpoint");
  await p.waitFor(() => p.receipts.length === 1, "the real converter reaches authorization before the native failure");
  const callsBefore = p.focusCalls.filter(call => call.node === p.original).length;
  p.failDownload(); p.receipts[0].resolve(true);
  await p.waitFor(() => !trigger().disabled, "the failed attempt releases its busy state");
  await new Promise(setImmediate);
  assert.equal(p.downloads.length, 0); assert.equal(errors.length, 1);
  assert.equal(p.focusCalls.filter(call => call.node === p.original).length, callsBefore, "failure does not masquerade as a successful automatic focus return");
  assert.ok(f.renderer.ownNodes(deck, "section").some(node => node.attributes["data-export-stage"] === "failed"));
  assert.ok(f.renderer.ownNodes(deck, "button").some(node => node.classList.contains("presentation-deck-export-retry")), "the unchanged explicit Retry remains available");
});


for (const failure of ["requestUpdate", "update", "focus"]) test("native export completion powerpoint: " + failure + " failure releases ownership for an explicit retry", async t => {
  const context = await nativeExportFixture(t, "en"), { trigger } = context;
  const p = exportCompletionPorts(t, context);
  p.begin("powerpoint");
  await p.waitFor(() => p.receipts.length === 1, "the original converter reaches authorization");
  if (failure === "requestUpdate") p.failEnabledRequestUpdate();
  else if (failure === "update") p.rejectEnabledUpdate(); else p.throwReturningFocus();
  p.receipts[0].resolve(true);
  await p.waitFor(() => !trigger().disabled, "failed return still releases the completed operation's busy state");
  await new Promise(setImmediate);
  assert.equal(p.downloads.length, 1, "a failed focus return does not erase or repeat successful delivery");
  assert.equal(p.owner.activeElement === p.body, true);
  p.begin("powerpoint");
  await p.waitFor(() => p.receipts.length === 2, "explicit retry starts another actual conversion after failed return cleanup");
  p.receipts[1].resolve(true);
  await p.waitFor(() => !trigger().disabled, "the explicit retry completes its own enabled update");
  await new Promise(setImmediate);
  assert.equal(p.downloads.length, 2);
  assert.equal(p.owner.activeElement === p.original, true, "no retired controller or lease strands the later explicit export");
});


for (const format of ["pdf", "powerpoint"]) test("native export completion " + format + ": preparing render failure releases its acquired focus lease", async t => {
  const context = await nativeExportFixture(t, "en"), { f, deck, trigger } = context;
  const p = exportCompletionPorts(t, context), errors = [];
  t.mock.method(console, "error", (...args) => errors.push(args));
  p.failPreparingUpdate(); p.begin(format);
  await p.waitFor(() => !trigger().disabled, "preparing failure must settle before any converter or receipt");
  await new Promise(setImmediate);
  assert.equal(errors.length, 1); assert.equal(p.receipts.length, 0); assert.equal(p.downloads.length, 0);
  assert.ok(f.renderer.ownNodes(deck, "section").some(node => node.attributes["data-export-stage"] === "failed"));
  p.move();
  const callsBefore = p.focusCalls.filter(call => call.node === p.original).length;
  await f.flush();
  assert.equal(p.owner.activeElement === p.outside, true);
  assert.equal(p.focusCalls.filter(call => call.node === p.original).length, callsBefore, "failed preparation has no delayed focus callback");
  p.begin("powerpoint");
  await p.waitFor(() => p.receipts.length === 1, "the explicit later export uses the real Office converter");
  p.receipts[0].resolve(true);
  await p.waitFor(() => !trigger().disabled, "the later explicit operation can settle normally");
  await new Promise(setImmediate);
  assert.equal(p.downloads.length, 1); assert.equal(p.owner.activeElement === p.original, true);
});


for (const format of ["pdf", "powerpoint"]) test("native export completion " + format + ": focused Cancel after window return owns a fresh return", async t => {
  const context = await nativeExportFixture(t, "en"), { f, deck, trigger } = context;
  const p = exportCompletionPorts(t, context);
  const originalEvents = structuredClone(f.state.events), originalContent = structuredClone(f.state.content);
  p.begin(format);
  assert.equal(trigger() === p.original, true); assert.equal(trigger().disabled, true);
  assert.equal(p.owner.activeElement === p.body, true);
  const callsBefore = p.focusCalls.filter(call => call.node === p.original).length;
  p.leaveWindow();
  assert.equal(p.owner.hasFocus(), true, "the native window has returned before the new explicit gesture");
  assert.equal(p.owner.activeElement === p.body, true, "window return alone does not renew the old focus lease");
  assert.equal(p.focusCalls.filter(call => call.node === p.original).length, callsBefore);
  const cancel = f.renderer.ownNodes(deck, "button").find(node => node.classList.contains("presentation-deck-export-cancel"));
  assert.ok(cancel); assert.equal(cancel.isConnected, true); assert.equal(cancel.disabled, false);
  cancel.focus({ preventScroll: true });
  assert.equal(p.owner.activeElement === cancel, true, "the user deliberately focuses this operation's current Cancel");
  cancel.click(); f.draw();
  await p.waitFor(() => !trigger().disabled, "the explicit cancellation commits an enabled Export button");
  await new Promise(setImmediate);
  assert.equal(trigger() === p.original, true); assert.equal(p.original.isConnected, true);
  assert.equal(p.owner.activeElement === p.original, true, "focused Cancel owns a fresh return after the earlier window departure");
  assert.equal(p.focusCalls.filter(call => call.node === p.original).length, callsBefore + 1);
  assert.equal(p.receipts.length, 0); assert.equal(p.downloads.length, 0); assert.equal(f.state.requests.length, 0);
  assert.deepEqual(f.state.events, originalEvents); assert.deepEqual(f.state.content, originalContent);
});
