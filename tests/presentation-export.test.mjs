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
    "presentation.export.pdfPrepared", "presentation.export.audiencePrepared", "presentation.export.presenterPrepared",
    "presentation.export.savePreparedPdf", "presentation.export.savePreparedPowerpoint", "presentation.export.savePreparedPresenter",
    "presentation.export.preparedHint", "presentation.export.saveRequested",
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

  assert.match(deck, /#exportProgress:\{stage:"preparing"\|"rendering"\|"finalizing"\|"prepared"\|"save-requested"\|"failed";completed:number;total:number;message\?:string;format\?:"pdf"\|"powerpoint"\|"powerpoint-presenter"\}\|null=null/u);
  assert.match(deck, /class="presentation-deck-export-status" data-export-stage=\$\{progress\.stage\} role=\$\{failed\?"alert":"status"\} aria-live=\$\{failed\?"assertive":"polite"\} aria-atomic="true"/u);
  assert.match(deck, /<progress max=\$\{total\} value=\$\{completed\} aria-label=\$\{this\.i18n\.t\("status\.progress"\)\} aria-valuetext=\$\{count\}>/u);
  assert.match(deck, /<progress aria-label=\$\{this\.i18n\.t\("status\.progress"\)\}><\/progress>/u,"preparation remains truthfully indeterminate until page rendering begins");
  assert.match(deck, /this\.i18n\.system\("\{count\} of \{total\}",\{count:this\.i18n\.number\(completed\),total:this\.i18n\.number\(total\)\}\)/u,"slide counts use existing translated labels and locale-aware numerals");
  assert.match(deck, /this\.i18n\.t\("job\.progress\.rendering"\)/u);
  assert.match(deck, /this\.i18n\.t\("job\.progress\.finalizing"\)/u);
  assert.match(deck, /presentation-deck-export-save/u, "prepared exports expose an explicit native Save link");
  assert.match(deck, /aria-describedby=\$\{this\.#exportProgress\?`\$\{this\.#exportMenuId\}-status`:nothing\} aria-busy=\$\{String\(this\.#exporting\)\}/u);
  assert.match(deck, /#exportAbort\?:AbortController/u);
  assert.match(deck, /override disconnectedCallback\(\)\{this\.#clearExportCompletion\(\);this\.#closeDeckPopovers\(\);this\.#exportAbort\?\.abort\(\)/u,"leaving the presentation clears its completion, closes native menus and cancels any unfinished export synchronously");
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
    assert.ok(calls.includes("this.#captureExportCompletion"), name + " captures the same guarded completion lifecycle");
    assert.equal(calls.includes("this.store.toast"), false, name + " keeps successful completion in the deck, clear of its reading controls");
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
// The current Slides opening path uses native modal autofocus. Reuse the finite
// focus/visibility/autofocus contract in document-slides-content-first-focus tests
// around the actual complete component renderer. No production guard or opening
// method is replaced; these ports do not establish browser paint or physical input.
const exportOpeningSeam0 = "documentPort.defaultView=windowPort;";
assert.equal(exportFixtureModule.split(exportOpeningSeam0).length, 2);
exportFixtureModule = exportFixtureModule.replace(exportOpeningSeam0, "documentPort.defaultView=windowPort;\n// Declared finite window posture. The later export focus tests supply their own\n// focused/hidden transitions through configurable descriptors on this same owner.\nObject.defineProperties(documentPort, {\n  hasFocus: { configurable: true, value: () => activeFixture?.exportDocumentPosture?.focused === true },\n  visibilityState: { configurable: true, get: () => activeFixture?.exportDocumentPosture?.visibilityState ?? \"hidden\" },\n  hidden: { configurable: true, get: () => documentPort.visibilityState === \"hidden\" },\n});");
const exportOpeningSeam1 = "      instance.eventBindings = props.handlers;";
assert.equal(exportFixtureModule.split(exportOpeningSeam1).length, 2);
exportFixtureModule = exportFixtureModule.replace(exportOpeningSeam1, "      instance.eventBindings = props.handlers;\n      // The renderer's component-owner links omit intervening native containers.\n      // Resolve this actual deck's rendered modal, never an unrelated dialog.\n      if (tag === \"forma-presentation-deck\") instance.closest = selector => selector === \"dialog\"\n        ? this.query(owner, \"dialog.document-artifact-view\")[0] ?? null\n        : ElementPort.prototype.closest.call(instance, selector);");
const exportOpeningSeam2 = "      node.setAttribute = (name, value) => { node.attributes[name] = String(value); };";
assert.equal(exportFixtureModule.split(exportOpeningSeam2).length, 2);
exportFixtureModule = exportFixtureModule.replace(exportOpeningSeam2, "      node.setAttribute = (name, value) => { node.attributes[name] = String(value); };\n      node.removeAttribute = name => { delete node.attributes[name]; };\n      node.getClientRects = () => {\n        const dialog = node.owner?.closest?.(\"dialog\");\n        return node.isConnected && (!dialog || dialog.open) && !Object.hasOwn(node.attributes, \"hidden\")\n          ? [node.getBoundingClientRect()] : [];\n      };\n      // Finite rendered-box visibility for the existing declared native port;\n      // no CSS paint or real browser visibility is inferred by these controls.\n      node.checkVisibility = () => node.getClientRects().length > 0;\n      Object.defineProperty(node, \"disabled\", { configurable: true,\n        get: () => Object.hasOwn(node.attributes, \"disabled\") });");
const exportOpeningSeam3 = "      node.focus = () => this.fixture.trace.push(\"focus:\" + (node.attributes.class ?? node.tag));";
assert.equal(exportFixtureModule.split(exportOpeningSeam3).length, 2);
exportFixtureModule = exportFixtureModule.replace(exportOpeningSeam3, "      node.focus = () => {\n        if (!node.isConnected || Object.hasOwn(node.attributes, \"disabled\")) return;\n        this.fixture.trace.push(\"focus:\" + (node.attributes.class ?? node.tag));\n        documentPort.activeElement = node;\n        for (const listener of [...(this.fixture.listeners.get(\"focusin\") ?? [])]) listener({ type: \"focusin\", target: node });\n      };");
const exportOpeningSeam4 = "      this.nodes.push(node);";
assert.equal(exportFixtureModule.split(exportOpeningSeam4).length, 2);
exportFixtureModule = exportFixtureModule.replace(exportOpeningSeam4, "      const nativeMatches = node.matches;\n      node.matches = selector => selector === \":disabled\" ? Object.hasOwn(node.attributes, \"disabled\") : nativeMatches(selector);\n      // Lit preserves the same modal shell for an unchanged native template.\n      // Other native nodes keep this renderer's existing replacement semantics.\n      if (node.tag === \"dialog\" && node.classList.contains(\"document-artifact-view\")) {\n        const previous = (this.previousNodes ?? []).find(candidate => candidate.isConnected\n          && candidate.owner === owner && candidate.tag === \"dialog\" && candidate.classList.contains(\"document-artifact-view\"));\n        if (previous) {\n          for (const key of [\"attributes\", \"properties\", \"propertyParts\", \"handlers\", \"full\"]) previous[key] = node[key];\n          previous.isConnected = true; node.isConnected = false; this.nodes.push(previous); continue;\n        }\n        const matches = node.matches, close = node.close;\n        node.matches = selector => selector === \":modal\" ? node.open && node.modal === true : matches(selector);\n        node.close = () => { node.modal = false; close(); };\n      }\n      this.nodes.push(node);");
const exportOpeningSeam5 = "if (!dialog.open) { dialog.open = true; activeFixture.trace.push(\"open:\" + dialog.attributes.class); }";
assert.equal(exportFixtureModule.split(exportOpeningSeam5).length, 2);
exportFixtureModule = exportFixtureModule.replace(exportOpeningSeam5, "if (!dialog.open) {\n    dialog.open = true; dialog.modal = true; activeFixture.trace.push(\"open:\" + dialog.attributes.class);\n    // Model the native modal autofocus step used by the accepted Slides opening\n    // controls. This executes only after product code sets the target attribute.\n    const targets = activeFixture.renderer.nodes.filter(node => node.isConnected\n      && Object.hasOwn(node.attributes, \"autofocus\") && node.owner?.closest?.(\"dialog\") === dialog);\n    assert.ok(targets.length <= 1, \"the declared export modal has at most one autofocus target\");\n    targets[0]?.focus();\n  }");
exportFixtureModule += "\nexport { fixture as nativePresentationExportFixture };\n";
const exportFixtureModuleUrl = new URL(exportFixtureUrl);
exportFixtureModuleUrl.search = "?presentation-export-compat";
const exportFixtureHook = registerHooks({ load(url, context, next) {
  return url === exportFixtureModuleUrl.href ? { format: "module", source: exportFixtureModule, shortCircuit: true } : next(url, context);
} });
let nativePresentationExportFixture;
try { ({ nativePresentationExportFixture } = await import(exportFixtureModuleUrl.href)); }
finally { exportFixtureHook.deregister(); }

// A separate module instance supplies only new completion-UI tests with an
// explicitly finite PDF result. It never claims PDF capture, valid PDF bytes,
// browser paint or export authorization; the real-converter fixture above stays
// unchanged and all authorization/preparation/focus production methods still run.
const finitePdfImport = 'import * as actualPdfExport from "../src/components/presentation-pdf-export.ts";';
assert.equal(exportFixtureModule.split(finitePdfImport).length, 2);
const finitePdfNamespace = `
const finitePdfCalls = [];
const actualPdfExport = { renderPresentationPdf(items, presentation, options) {
  let settled = false, resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  const finish = (accepted, result) => {
    if (settled) return; settled = true;
    options.signal.removeEventListener("abort", abort);
    if (accepted) resolve(result); else reject(result);
  };
  const abort = () => { const error = new Error("Finite PDF conversion canceled"); error.name = "AbortError"; finish(false, error); };
  const call = { items, presentation, options, get settled() { return settled; },
    complete: () => finish(true, { bytes: new TextEncoder().encode("FINITE PDF COMPLETION UI STIMULUS"), pageCount: items.length, filename: "finite-completion.pdf" }),
    fail: error => finish(false, error) };
  finitePdfCalls.push(call);
  if (options.signal.aborted) abort(); else options.signal.addEventListener("abort", abort, { once: true });
  return promise;
} };
`;
let finitePdfFixtureModule = exportFixtureModule.replace(finitePdfImport, finitePdfNamespace);
const finiteLocaleSeam = 'event.callback({ locale: f.locale, formatLocale: f.locale, direction: f.locale === "ar" ? "rtl" : "ltr", timeZone: "UTC", messages, revision: 0 }, () => {});';
assert.equal(finitePdfFixtureModule.split(finiteLocaleSeam).length, 2);
finitePdfFixtureModule = finitePdfFixtureModule.replace(finiteLocaleSeam,
  'f.setCompletionLocale = locale => { f.locale = locale; event.callback({ locale, formatLocale: locale, direction: locale === "ar" ? "rtl" : "ltr", timeZone: "UTC", messages: { ...FORMA_DEFAULT_MESSAGES, ...localeCatalogs[locale] }, revision: 1 }, () => {}); }; ' + finiteLocaleSeam);
// Only this finite module gets delivered ResizeObserver records and physical
// computed padding. No CSS/layout measurement or production callback is mocked.
const finiteReadingDefinitions = `
const finiteReadingPorts = { observers: [], styles: new WeakMap(), frames: new Map(), sequence: 0 };
class FiniteReadingResizeObserver {
  constructor(callback) { this.callback = callback; this.fixture = activeFixture; this.targets = new Set(); finiteReadingPorts.observers.push(this); }
  observe(target) { this.targets.add(target); }
  disconnect() { this.targets.clear(); }
}
const finiteReadingStyle = node => ({ direction: activeFixture?.locale === "ar" ? "rtl" : "ltr", fontSize: "16px",
  paddingLeft: "0px", paddingRight: "0px", paddingTop: "0px", paddingBottom: "0px", ...finiteReadingPorts.styles.get(node) });
const finiteReadingFrame = callback => { const id = ++finiteReadingPorts.sequence; finiteReadingPorts.frames.set(id, { callback, fixture: activeFixture }); return id; };
const finiteReadingCancelFrame = id => finiteReadingPorts.frames.delete(id);
`;
const finiteReadingSeam = 'class { observe() {} disconnect() {} }, () => ({ direction: activeFixture?.locale === "ar" ? "rtl" : "ltr", fontSize: "16px" })';
assert.equal(finitePdfFixtureModule.split(finiteReadingSeam).length, 2);
finitePdfFixtureModule = finiteReadingDefinitions + finitePdfFixtureModule.replace(finiteReadingSeam, "FiniteReadingResizeObserver, finiteReadingStyle");
const finiteFrameParameters = '"matchMedia", "InputEvent", code)(';
const finiteFrameArguments = '() => ({ matches: true }), class InputEvent {},';
assert.equal(finitePdfFixtureModule.split(finiteFrameParameters).length, 2);
assert.equal(finitePdfFixtureModule.split(finiteFrameArguments).length, 2);
finitePdfFixtureModule = finitePdfFixtureModule.replace(finiteFrameParameters,
  '"matchMedia", "InputEvent", "requestAnimationFrame", "cancelAnimationFrame", code)(').replace(finiteFrameArguments,
  '() => ({ matches: true }), class InputEvent {}, finiteReadingFrame, finiteReadingCancelFrame,');
finitePdfFixtureModule += "\nexport { finitePdfCalls, finiteReadingPorts };\n";
const finitePdfFixtureModuleUrl = new URL(exportFixtureUrl);
finitePdfFixtureModuleUrl.search = "?presentation-pdf-completion-status";
const finitePdfFixtureHook = registerHooks({ load(url, context, next) {
  return url === finitePdfFixtureModuleUrl.href ? { format: "module", source: finitePdfFixtureModule, shortCircuit: true } : next(url, context);
} });
let finitePdfFixture, finitePdfCalls, finiteReadingPorts;
try { ({ nativePresentationExportFixture: finitePdfFixture, finitePdfCalls, finiteReadingPorts } = await import(finitePdfFixtureModuleUrl.href)); }
finally { finitePdfFixtureHook.deregister(); }

async function nativeExportFixture(t, locale, options = {}) {
  const forbiddenFetches = [];
  t.mock.method(globalThis, "fetch", async (...args) => {
    forbiddenFetches.push(args);
    assert.fail("No application or provider network is permitted in native export compatibility tests");
  });
  const f = (options.factory ?? nativePresentationExportFixture)("create", { artifact: true, locale });
  f.exportDocumentPosture = { focused: true, visibilityState: "visible" };
  // This older Store port has no Signal subscription delivery. Model only its
  // explicit subscribe/notify contract; no full Store or signal graph is claimed.
  const subscriptions = new Set();
  assert.equal(f.store.subscribe, undefined); assert.equal(f.store.notify, undefined);
  f.store.subscribe = listener => { subscriptions.add(listener); return () => subscriptions.delete(listener); };
  f.store.notify = () => subscriptions.forEach(listener => listener());
  t.after(() => {
    try { assert.equal(forbiddenFetches.length, 0, "caught converter errors cannot hide a forbidden fetch attempt"); }
    finally {
      for (const { instance } of f.renderer.instances.values()) if (instance.isConnected) { instance.isConnected = false; instance.disconnectedCallback(); }
      f.host.disconnectedCallback(); f.i18n.hostDisconnected();
      assert.equal(subscriptions.size, 0, "all completed or canceled export subscriptions retire with their deck");
    }
  });
  const completed = f.state.events.find(event => event.type === "DocumentRenderCompleted");
  const items = options.items ?? [{ id: "export-slide-a", title: "Exact audience title", body: "Exact audience evidence", notes: "Private presenter notes", image_prompt: "", context_group_ids: [] }];
  completed.payload.artifact_kind = "slides"; completed.payload.items = items; completed.payload.item_count = items.length;
  f.state.content["content-A"] = JSON.stringify({ ...JSON.parse(f.state.content["content-A"]), items });
  assert.equal(await f.host.openArtifactById("artifact-A"), true); await f.flush();
  // The actual current artifact viewer mounts one closed input dialog whose
  // accounting-scope observer subscribes in connectedCallback. Capture those
  // exact existing identities before Export; completion owns only later additions.
  const inputDialogs = f.renderer.query(f.host, "forma-generation-input-dialog");
  assert.equal(inputDialogs.length, 1, "this fixture mounts its one actual input-inspection owner");
  const inputDialog = inputDialogs[0];
  assert.equal(inputDialog.isConnected, true); assert.equal(inputDialog.store, f.store);
  assert.equal(inputDialog.open, false, "the baseline accounting observer does not open or read accounting");
  assert.equal(subscriptions.size, 1, "the current connected input dialog owns its one baseline subscription before export");
  const existingSubscriptions = new Set(subscriptions);
  f.exportSubscriptionCount = () => {
    for (const listener of existingSubscriptions) assert.equal(subscriptions.has(listener), inputDialog.isConnected,
      "the exact baseline observer remains while its component is connected and retires with it");
    return [...subscriptions].filter(listener => !existingSubscriptions.has(listener)).length;
  };
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
// its unchanged Export button across commits, alongside the modal shell modeled
// above; other native nodes retain the supplier's normal replacement behavior. These ports establish
// focus/event ordering and delivered bytes, not browser paint or Office rendering.
function exportCompletionPorts(t, context) {
  const { f, deck, trigger } = context, owner = deck.ownerDocument, view = owner.defaultView;
  const original = trigger(), preparedFiles = [], saveRequests = [], createdUrls = [], revokedUrls = [], focusCalls = [], receipts = [], heldUpdates = new Set();
  const outside = { isConnected: true, tagName: "BUTTON" }, body = { isConnected: true, tagName: "BODY", append() {} };
  let windowFocused = true, hidden = false, replaceTrigger = false, holdUpdate = null, failBlobCreation = false, rejectUpdate = false, throwFocus = false, preparingUpdateFailure = false, enabledUpdateFailureAt = null;
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
  save(owner, "createElement", { value: () => assert.fail("presentation preparation must not dispatch a synthetic download anchor") });
  save(view, "setTimeout", { value: () => assert.fail("prepared URLs live until explicit retirement, not a fixed cleanup timer") });
  const createObjectURL = URL.createObjectURL.bind(URL), revokeObjectURL = URL.revokeObjectURL.bind(URL);
  t.mock.method(URL, "createObjectURL", blob => {
    if (failBlobCreation) { failBlobCreation = false; throw new Error("Native Blob preparation failed"); }
    const url = createObjectURL(blob); createdUrls.push(url); return url;
  });
  t.mock.method(URL, "revokeObjectURL", url => { revokedUrls.push(url); return revokeObjectURL(url); });
  save(deck, "contains", { value: node => node === original || [...f.renderer.ownNodes(deck, "button"), ...f.renderer.ownNodes(deck, "a")].includes(node) });
  const requestUpdate = deck.requestUpdate;
  save(deck, "requestUpdate", { value: function(...args) {
    if (preparingUpdateFailure) { preparingUpdateFailure = false; throw new Error("Native preparing update failed"); }
    if (enabledUpdateFailureAt !== null && createdUrls.length >= enabledUpdateFailureAt) {
      enabledUpdateFailureAt = null; throw new Error("Native enabled requestUpdate failed");
    }
    return requestUpdate.apply(this, args);
  } });
  const collect = f.renderer.collect.bind(f.renderer);
  let retainedSaveAnchor;
  f.renderer.collect = (markup, component) => {
    const start = f.renderer.nodes.length;
    collect(markup, component);
    if (component !== deck) return;
    for (const node of f.renderer.nodes.slice(start)) if (node.tag === "button" || node.tag === "a") install(node);
    const saveIndex = f.renderer.nodes.findIndex((node, index) => index >= start && node.tag === "a" && node.classList.contains("presentation-deck-export-save"));
    if (saveIndex >= 0) {
      let anchor = f.renderer.nodes[saveIndex];
      if (retainedSaveAnchor?.attributes.href === anchor.attributes.href) {
        for (const key of ["attributes", "properties", "propertyParts", "handlers", "full"]) retainedSaveAnchor[key] = anchor[key];
        retainedSaveAnchor.isConnected = true; anchor.isConnected = false; anchor = retainedSaveAnchor;
        f.renderer.nodes[saveIndex] = anchor;
      } else retainedSaveAnchor = anchor;
      Object.defineProperties(anchor, {
        href: { configurable: true, get: () => anchor.attributes.href },
        download: { configurable: true, get: () => anchor.attributes.download },
      });
      const url = anchor.href, blob = resolveObjectURL(url);
      assert.ok(blob instanceof Blob, "the rendered native Save anchor retains the actual converter's Blob");
      if (!preparedFiles.some(file => file.url === url)) preparedFiles.push({ url, filename: anchor.download, blob });
    } else retainedSaveAnchor = undefined;
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
    for (const url of createdUrls) revokeObjectURL(url);
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
  const saveAnchor = () => f.renderer.ownNodes(deck, "a").find(node => node.classList.contains("presentation-deck-export-save"));
  const requestSave = (anchor = saveAnchor(), extra = {}) => {
    assert.ok(anchor, "a native Save anchor is required");
    const event = { type: "click", target: anchor, currentTarget: anchor, button: 0, metaKey: false, ctrlKey: false,
      shiftKey: false, altKey: false, defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, ...extra };
    const result = anchor.handlers[event.type].call(deck, event);
    assert.equal(result instanceof Promise, false, "Save must preserve a synchronous native gesture without another authorization round trip");
    if (!event.defaultPrevented) {
      const blob = resolveObjectURL(anchor.href);
      assert.ok(blob instanceof Blob, "an accepted native Save request resolves its still-live prepared URL");
      saveRequests.push({ url: anchor.href, filename: anchor.download, blob });
    }
    return event;
  };
  return { owner, original, outside, body, preparedFiles, saveRequests, createdUrls, revokedUrls, saveAnchor, requestSave, focusCalls, receipts, begin, waitFor,
    move: () => focus(outside),
    returnToBody: () => focus(body),
    interact: type => emit(type, body),
    leaveWindow: () => { windowFocused = false; emit("blur", view); windowFocused = true; },
    hideDocument: () => { hidden = true; emit("visibilitychange", owner); hidden = false; },
    replace: () => { replaceTrigger = true; f.draw(); },
    failBlobCreation: () => { failBlobCreation = true; },
    rejectEnabledUpdate: () => { rejectUpdate = true; },
    throwReturningFocus: () => { throwFocus = true; },
    failPreparingUpdate: () => { preparingUpdateFailure = true; },
    failEnabledRequestUpdate: () => { enabledUpdateFailureAt = createdUrls.length + 1; },
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
      assert.equal(p.owner.activeElement === p.original, true, "successful preparation restores the original enabled Export button");
      assert.equal(p.original.isConnected, true); assert.equal(p.original.disabled, false);
      assert.equal(returned, 1, "only the exact completed operation returns focus once");
    } else {
      assert.equal(returned, 0, "an invalidated or unsuccessful operation cannot restore the old trigger");
      if (mode === "moved") assert.equal(p.owner.activeElement === p.outside, true, "new user focus remains untouched");
    }
    if (!["authorization", "source", "document", "artifact", "route", "disconnected", "refused"].includes(mode)) {
      assert.equal(p.preparedFiles.length, 1, "focus-only invalidations preserve the authorized prepared bytes");
      assert.equal(p.preparedFiles[0].blob.type, POWERPOINT_DOCUMENT_MIME);
      const bytes = new Uint8Array(await p.preparedFiles[0].blob.arrayBuffer());
      assert.deepEqual([...bytes.slice(0, 4)], [80, 75, 3, 4], "the prepared payload is the real Office ZIP");
    } else assert.equal(p.preparedFiles.length, 0);
    const completedStatus = f.renderer.ownNodes(deck, "section").find(node => node.attributes["data-export-stage"] === "prepared");
    const completionRetired = ["authorization", "source", "document", "artifact", "route", "disconnected", "refused"].includes(mode);
    assert.equal(Boolean(completedStatus), !completionRetired, "only the current authorized deck can retain the success announcement");
    assert.equal(f.trace.some(value => value.startsWith("toast:")), false, "neither success nor refused/stale completion creates a global toast");
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
  assert.equal(p.preparedFiles.length, 1);
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
  assert.equal(p.preparedFiles.length, 2);
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
  assert.equal(p.receipts.length, 0); assert.equal(p.preparedFiles.length, 0); assert.equal(f.state.requests.length, 0);
});

test("native export completion powerpoint: a Blob-URL preparation error keeps recovery explicit", async t => {
  const context = await nativeExportFixture(t, "en"), { f, deck, trigger } = context;
  const p = exportCompletionPorts(t, context), errors = [];
  t.mock.method(console, "error", (...args) => errors.push(args));
  p.begin("powerpoint");
  await p.waitFor(() => p.receipts.length === 1, "the real converter reaches authorization before the native failure");
  const callsBefore = p.focusCalls.filter(call => call.node === p.original).length;
  p.failBlobCreation(); p.receipts[0].resolve(true);
  await p.waitFor(() => !trigger().disabled, "the failed attempt releases its busy state");
  await new Promise(setImmediate);
  assert.equal(p.preparedFiles.length, 0); assert.equal(errors.length, 1);
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
  assert.equal(p.preparedFiles.length, 1, "a failed focus return does not erase or repeat successful preparation");
  assert.equal(p.owner.activeElement === p.body, true);
  p.begin("powerpoint");
  await p.waitFor(() => p.receipts.length === 2, "explicit retry starts another actual conversion after failed return cleanup");
  p.receipts[1].resolve(true);
  await p.waitFor(() => !trigger().disabled, "the explicit retry completes its own enabled update");
  await new Promise(setImmediate);
  assert.equal(p.preparedFiles.length, 2);
  assert.equal(p.owner.activeElement === p.original, true, "no retired controller or lease strands the later explicit export");
});


for (const format of ["pdf", "powerpoint"]) test("native export completion " + format + ": preparing render failure releases its acquired focus lease", async t => {
  const context = await nativeExportFixture(t, "en"), { f, deck, trigger } = context;
  const p = exportCompletionPorts(t, context), errors = [];
  t.mock.method(console, "error", (...args) => errors.push(args));
  p.failPreparingUpdate(); p.begin(format);
  await p.waitFor(() => !trigger().disabled, "preparing failure must settle before any converter or receipt");
  await new Promise(setImmediate);
  assert.equal(errors.length, 1); assert.equal(p.receipts.length, 0); assert.equal(p.preparedFiles.length, 0);
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
  assert.equal(p.preparedFiles.length, 1); assert.equal(p.owner.activeElement === p.original, true);
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
  assert.equal(p.receipts.length, 0); assert.equal(p.preparedFiles.length, 0); assert.equal(f.state.requests.length, 0);
  assert.deepEqual(f.state.events, originalEvents); assert.deepEqual(f.state.content, originalContent);
});

const finiteCompletionItems = [0, 1].map(index => ({ id: "finite-completion-slide-" + index,
  title: "Retained completion slide " + (index + 1), body: "Exact retained audience evidence " + (index + 1),
  notes: "Private completion fixture notes", image_prompt: "", context_group_ids: [] }));


async function finitePdfCompletionContext(t) {
  const context = await nativeExportFixture(t, "en", { factory: finitePdfFixture, items: structuredClone(finiteCompletionItems) });
  const p = exportCompletionPorts(t, context), { f, deck, trigger } = context;
  const originalEvents = structuredClone(f.state.events), originalContent = structuredClone(f.state.content);
  const begin = async () => {
    const before = finitePdfCalls.length;
    p.begin("pdf");
    await p.waitFor(() => finitePdfCalls.length === before + 1, "the actual PDF handler reaches its declared finite converter");
    assert.equal(f.exportSubscriptionCount(), 1);
    return finitePdfCalls[before];
  };
  const settle = async () => {
    await p.waitFor(() => !trigger()?.disabled, "the actual finalizer releases the Export button");
    await new Promise(setImmediate); f.draw();
  };
  const complete = async () => {
    const call = await begin(), before = p.receipts.length;
    call.complete();
    await p.waitFor(() => p.receipts.length === before + 1, "finite conversion still reaches the real export authorization call");
    p.receipts[before].resolve(true); await settle();
    assert.equal(call.settled, true);
    return call;
  };
  const status = () => f.renderer.ownNodes(deck, "section").find(node => node.attributes["data-export-stage"] === "prepared");
  const assertComplete = () => {
    const row = status(); assert.ok(row, "the current deck owns the completed status inside its viewer");
    assert.equal(row.attributes.role, "status"); assert.equal(row.attributes["aria-live"], "polite"); assert.equal(row.attributes["aria-atomic"], "true");
    assert.equal(trigger().attributes["aria-describedby"], row.attributes.id);
    assert.equal(trigger().disabled, false); assert.equal(String(trigger().attributes["aria-busy"]), "false");
    const labels = f.renderer.ownNodes(deck, "span").filter(node => node.classList.contains("presentation-deck-export-status-label"));
    assert.equal(labels.length, 1);
    const start = deck.markup.indexOf(labels[0].full) + labels[0].full.length;
    const label = deck.markup.slice(start, deck.markup.indexOf("</span>", start));
    assert.equal(label, f.i18n.t("presentation.export.pdfPrepared", "", { count: f.i18n.number(2) }));
    assert.equal(f.renderer.ownNodes(deck, "progress").length, 0, "completion is not ongoing work");
    assert.equal(f.renderer.ownNodes(deck, "span").some(node => node.classList.contains("presentation-deck-export-status-count")), false);
    assert.equal(f.renderer.ownNodes(deck, "button").some(node => node.classList.contains("presentation-deck-export-cancel") || node.classList.contains("presentation-deck-export-retry")), false);
    assert.equal(f.trace.some(value => value.startsWith("toast:")), false, "the complete confirmation does not create a global overlay");
    assert.equal(f.exportSubscriptionCount(), 1);
    return label;
  };
  const assertRetired = () => {
    assert.equal(status(), undefined, "a retired completion cannot describe the current deck");
    assert.equal(f.exportSubscriptionCount(), 0, "retirement removes the exact completion subscription");
  };
  return { ...context, p, begin, complete, settle, status, assertComplete, assertRetired, originalEvents, originalContent };
}

test("finite PDF completion UI: localized confirmation survives normal slide navigation and locale changes", async t => {
  const c = await finitePdfCompletionContext(t), { f, deck, p } = c;
  await c.complete();
  assert.equal(p.preparedFiles.length, 1);
  assert.equal(await p.preparedFiles[0].blob.text(), "FINITE PDF COMPLETION UI STIMULUS", "this control explicitly does not supply captured PDF bytes");
  assert.equal(p.receipts.length, 1); assert.equal(p.receipts[0].receipt.payload.page_count, 2);
  assert.equal(p.owner.activeElement === p.original, true, "the existing successful focus return remains owned by Export");
  const labels = [c.assertComplete()];
  const next = f.renderer.ownNodes(deck, "button").find(node => node.attributes["aria-label"] === f.i18n.system("Next"));
  assert.ok(next); assert.equal(next.disabled, false); next.click(); f.draw(); c.assertComplete();
  const previous = f.renderer.ownNodes(deck, "button").find(node => node.attributes["aria-label"] === f.i18n.system("Previous"));
  assert.ok(previous); assert.equal(previous.disabled, false); previous.click(); f.draw(); c.assertComplete();
  const reading = f.renderer.ownNodes(deck, "button").find(node => node.classList.contains("presentation-deck-reading-toggle"));
  assert.ok(reading); reading.click(); f.draw(); c.assertComplete();
  for (const locale of ["fr", "ar", "ja"]) { f.setCompletionLocale(locale); f.draw(); labels.push(c.assertComplete()); }
  assert.equal(new Set(labels).size, 4, "the retained numeric outcome is translated afresh for each current locale");
  assert.equal(p.preparedFiles.length, 1); assert.equal(p.receipts.length, 1); assert.equal(f.state.requests.length, 0);
  assert.deepEqual(f.state.events, c.originalEvents); assert.deepEqual(f.state.content, c.originalContent);
});

for (const mode of ["source-aba", "authorization-aba", "route-aba", "content-aba", "revision", "document", "artifact", "disconnected"]) {
  test("finite PDF completion UI: " + mode + " retires the completed owner without resurrection", async t => {
    const c = await finitePdfCompletionContext(t), { f, deck, p } = c;
    await c.complete(); c.assertComplete();
    const preparedUrl = p.saveAnchor().href;
    if (mode === "source-aba") { f.sourceOwnershipPort.retire(); f.store.notify(); f.sourceOwnershipPort.restore(); f.store.notify(); }
    if (mode === "authorization-aba") { const original = f.state.authorization; f.state.authorization = "retired-completion-owner"; f.store.notify(); f.state.authorization = original; f.store.notify(); }
    if (mode === "route-aba") { const original = f.store.route; f.store.route = { get: () => "/library?document=A" }; f.store.notify(); f.store.route = original; f.store.notify(); }
    if (mode === "content-aba") { const original = f.state.content["content-A"]; f.state.content["content-A"] = original + " "; f.store.notify(); f.state.content["content-A"] = original; f.store.notify(); }
    if (mode === "revision") { f.state.events.push({ ...f.state.events.at(-1), eventId: "completion-revision", sequence: f.state.events.length + 1,
      type: "DocumentArtifactEdited", payload: { artifact_id: "artifact-A", document_id: "A", content_ref: "content-A", revision: 1 } }); f.store.notify(); }
    if (mode === "document") deck.documentId = "B";
    if (mode === "artifact") deck.preferenceKey = "another-artifact";
    if (mode === "disconnected") {
      const close = f.renderer.ownNodes(f.host, "button").find(node => node.attributes["aria-label"] === f.i18n.t("action.close", "Close"));
      assert.ok(close); close.click();
    }
    f.draw(); c.assertRetired(); f.store.notify(); f.draw(); c.assertRetired();
    assert.equal(resolveObjectURL(preparedUrl), undefined, "retired ownership revokes the prepared Blob URL");
    assert.equal(p.revokedUrls.filter(url => url === preparedUrl).length, 1, "retirement cleanup is idempotent");
    if (mode === "disconnected") {
      assert.equal(deck.isConnected, false);
      assert.equal(await f.host.openArtifactById("artifact-A"), true); await f.flush();
      const reopened = f.renderer.query(f.host, "forma-presentation-deck")[0]; assert.ok(reopened);
      assert.equal(f.renderer.ownNodes(reopened, "section").some(node => node.attributes["data-export-stage"] === "prepared"), false);
    }
    assert.equal(p.preparedFiles.length, 1); assert.equal(p.receipts.length, 1); assert.equal(f.state.requests.length, 0);
    assert.equal(p.saveRequests.length, 0, "preparation never synthesizes a Save request");
    assert.equal(f.trace.some(value => value.startsWith("toast:")), false);
  });
}

for (const mode of ["source-generation", "source-content-aba"]) test("finite PDF completion UI: " + mode + " during pending authorization cannot publish a late confirmation", async t => {
  const c = await finitePdfCompletionContext(t), { f, p } = c;
  const call = await c.begin(); call.complete();
  await p.waitFor(() => p.receipts.length === 1, "the PDF operation is pending at its actual authorization boundary");
  if (mode === "source-generation") { f.sourceOwnershipPort.retire(); f.store.notify(); f.sourceOwnershipPort.restore(); f.store.notify(); }
  else { const original = f.state.content["content-A"]; f.state.content["content-A"] = original + " "; f.store.notify(); f.state.content["content-A"] = original; f.store.notify(); }
  assert.equal(f.exportSubscriptionCount(), 0);
  p.receipts[0].resolve(true); await c.settle(); c.assertRetired();
  assert.equal(p.preparedFiles.length, 0, "retired ownership cannot expose a late prepared Save link");
  assert.equal(p.createdUrls.length, 0, "late preparation does not allocate a stale export URL");
  assert.equal(f.trace.some(value => value.startsWith("toast:")), false);
});

test("finite PDF completion UI: a new export replaces completion and focused Cancel clears its pending owner", async t => {
  const c = await finitePdfCompletionContext(t), { f, deck, p } = c;
  await c.complete(); c.assertComplete();
  const call = await c.begin(); assert.equal(c.status(), undefined);
  const cancel = f.renderer.ownNodes(deck, "button").find(node => node.classList.contains("presentation-deck-export-cancel"));
  assert.ok(cancel); cancel.focus({ preventScroll: true }); cancel.click(); f.draw();
  await c.settle(); c.assertRetired();
  assert.equal(call.options.signal.aborted, true); assert.equal(call.settled, true);
  assert.equal(p.owner.activeElement === p.original, true);
  assert.equal(p.preparedFiles.length, 1); assert.equal(p.receipts.length, 1); assert.equal(f.state.requests.length, 0);
});

test("finite PDF completion UI: refused release cannot publish a completed status", async t => {
  const c = await finitePdfCompletionContext(t), { f, p } = c;
  const call = await c.begin(); call.complete();
  await p.waitFor(() => p.receipts.length === 1, "finite PDF conversion reaches release authorization");
  p.receipts[0].resolve(false); await c.settle(); c.assertRetired();
  assert.equal(p.preparedFiles.length, 0); assert.equal(f.trace.some(value => value.startsWith("toast:")), false);
});

test("finite PDF completion UI: converter failure keeps the existing persistent recovery alert", async t => {
  const errors = []; t.mock.method(console, "error", (...args) => errors.push(args));
  const c = await finitePdfCompletionContext(t), { f, deck, p } = c;
  const call = await c.begin(); call.fail(new Error("Declared finite PDF failure"));
  await c.settle(); c.assertRetired();
  const failed = f.renderer.ownNodes(deck, "section").find(node => node.attributes["data-export-stage"] === "failed");
  assert.ok(failed); assert.equal(failed.attributes.role, "alert"); assert.equal(failed.attributes["aria-live"], "assertive");
  assert.equal(f.renderer.ownNodes(deck, "button").filter(node => node.classList.contains("presentation-deck-export-retry")).length, 1);
  assert.equal(errors.length, 1); assert.equal(p.preparedFiles.length, 0); assert.equal(p.receipts.length, 0);
  assert.equal(f.trace.some(value => value.startsWith("toast:")), false);
});

// Deliver declared content-box records to the actual registered Deck callback.
// These dimensions model observer input; they are not browser geometry evidence.
function finiteReadingContext(t, context) {
  const { f, deck } = context;
  const viewport = () => deck.querySelector(".presentation-deck-viewport");
  const observer = () => {
    const matches = finiteReadingPorts.observers.filter(value => value.fixture === f && value.targets.has(viewport()));
    assert.equal(matches.length, 1, "the actual updated hook observes the current viewport exactly once");
    return matches[0];
  };
  const frames = () => [...finiteReadingPorts.frames].filter(([, value]) => value.fixture === f);
  const flush = () => {
    for (const [id, value] of frames()) { finiteReadingPorts.frames.delete(id); value.callback(); }
    f.draw();
  };
  const deliver = (width, height, padding = {}, target = viewport()) => {
    finiteReadingPorts.styles.set(target, { paddingLeft: "0px", paddingRight: "0px", paddingTop: "0px", paddingBottom: "0px", ...padding });
    // Rounded client metrics and transformed rects cannot define this callback's
    // threshold; only the exact observer record and physical padding are inputs.
    target.clientWidth = 1; target.clientHeight = 1;
    observer().callback([{ target, contentRect: { width, height } }]);
  };
  const assertReading = reading => {
    const stage = f.renderer.ownNodes(deck, "div").find(node => node.classList.contains("presentation-deck-stage"));
    const toggle = f.renderer.ownNodes(deck, "button").find(node => node.classList.contains("presentation-deck-reading-toggle"));
    assert.ok(stage && toggle);
    assert.equal(stage.attributes["data-slide-posture"], reading ? "reading" : "visual");
    assert.equal(String(toggle.attributes["aria-pressed"]), String(reading));
    assert.equal(toggle.attributes["aria-label"], reading ? "Slide view" : "Read slide");
    return toggle;
  };
  // The renderer already invokes updated after committing its declared nodes.
  // An extra actual updated call must not register a duplicate observer.
  deck.updated(); observer();
  t.after(() => {
    if (deck.isConnected) { deck.isConnected = false; deck.disconnectedCallback(); }
    assert.equal(frames().length, 0, "disconnect cancels the exact pending posture frame");
    for (const value of finiteReadingPorts.observers.filter(value => value.fixture === f)) assert.equal(value.targets.size, 0);
  });
  return { viewport, observer, frames, flush, deliver, assertReading };
}

test("finite PDF reading posture: a tall progress row can retire into a fitting completed slot without sticky reading", async t => {
  const c = await finitePdfCompletionContext(t), { p } = c, posture = finiteReadingContext(t, c);
  posture.deliver(800, 340); posture.flush(); posture.assertReading(false);
  const call = await c.begin();
  posture.deliver(800, 300); posture.flush(); posture.assertReading(true);
  call.complete(); await p.waitFor(() => p.receipts.length === 1, "actual PDF authorization remains pending");
  p.receipts[0].resolve(true); await c.settle(); c.assertComplete();
  // Reading adds 16px on every side. The completed slot is 800x320 even
  // though its delivered content-box height remains below 315.
  posture.deliver(768, 288, { paddingLeft: "16px", paddingRight: "16px", paddingTop: "16px", paddingBottom: "16px" });
  posture.flush(); posture.assertReading(false); c.assertComplete();
  assert.equal(p.preparedFiles.length, 1); assert.equal(p.receipts.length, 1);
});

test("finite PDF reading posture: genuinely narrow and short padded slots retain automatic reading", async t => {
  const c = await finitePdfCompletionContext(t), posture = finiteReadingContext(t, c);
  const padding = { paddingLeft: "16px", paddingRight: "16px", paddingTop: "16px", paddingBottom: "16px" };
  for (const [width, height] of [[527.75, 400], [700, 282.75]]) {
    posture.deliver(width, height, padding); posture.flush(); posture.assertReading(true);
  }
  posture.deliver(700, 400, padding); posture.flush(); posture.assertReading(false);
});

test("finite PDF reading posture: fractional physical padding preserves strict 560 by 315 boundaries", async t => {
  const c = await finitePdfCompletionContext(t), posture = finiteReadingContext(t, c);
  const padding = { paddingLeft: "8.25px", paddingRight: "8.25px", paddingTop: "8.25px", paddingBottom: "8.25px" };
  for (const [width, height, reading] of [[543.5, 298.5, false], [543.499, 298.5, true], [543.5, 298.499, true], [543.501, 298.501, false]]) {
    posture.deliver(width, height, padding); posture.flush(); posture.assertReading(reading);
  }
});

test("finite PDF reading posture: automatic resize preserves explicit Slide view and Read slide choices", async t => {
  const c = await finitePdfCompletionContext(t), posture = finiteReadingContext(t, c);
  posture.deliver(500, 300); posture.flush();
  posture.assertReading(true).click(); await c.f.flush(); posture.assertReading(false);
  posture.deliver(900, 500); posture.flush(); posture.assertReading(false);
  posture.deliver(500, 300); posture.flush(); posture.assertReading(false);
  posture.assertReading(false).click(); await c.f.flush(); posture.assertReading(true);
  posture.deliver(900, 500); posture.flush(); posture.assertReading(true);
});

test("finite PDF reading posture: a retired viewport cannot alter the current target or queue a frame", async t => {
  const c = await finitePdfCompletionContext(t), posture = finiteReadingContext(t, c);
  posture.deliver(900, 500); posture.flush(); posture.assertReading(false);
  const stale = posture.viewport(); c.f.draw();
  assert.notEqual(posture.viewport(), stale, "this renderer explicitly replaces native node ports after a commit");
  posture.deliver(300, 200, {}, stale);
  assert.equal(posture.frames().length, 0); posture.flush(); posture.assertReading(false);
  posture.deliver(300, 200); assert.equal(posture.frames().length, 1);
  posture.flush(); posture.assertReading(true);
});

test("finite PDF reading posture: disconnect retires the actual observer and queued update", async t => {
  const c = await finitePdfCompletionContext(t), posture = finiteReadingContext(t, c);
  const observer = posture.observer();
  posture.deliver(300, 200); assert.equal(posture.frames().length, 1);
  c.deck.isConnected = false; c.deck.disconnectedCallback();
  assert.equal(observer.targets.size, 0); assert.equal(posture.frames().length, 0);
});


// Exact component/native-port completion controls. The actual Office converter
// creates the prepared Blob; these checks do not claim browser paint or Office
// application rendering. The four locale cases reuse the existing finite PDF
// fixture only for its locale callback; its Office converter remains real and no
// PDF conversion is requested by those cases. The existing focus, cancellation and failure cases above
// remain complete, including delivery semantics after a focus-only invalidation.
// Reuse the dedicated audience-export ZIP STORE decoder to inspect the actual
// notes entry; package part presence alone does not establish private content.
function completedPptxParts(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const footer = bytes.byteLength - 22;
  assert.equal(view.getUint32(footer, true), 0x06054b50, "PowerPoint has a valid ZIP footer");

  const count = view.getUint16(footer + 10, true);
  const directoryLength = view.getUint32(footer + 12, true);
  let central = view.getUint32(footer + 16, true);
  assert.equal(central + directoryLength, footer, "ZIP central-directory boundaries remain valid");

  const entries = new Map();
  for (let index = 0; index < count; index += 1) {
    assert.equal(view.getUint32(central, true), 0x02014b50, "every package part has a central entry");
    const nameLength = view.getUint16(central + 28, true);
    const extraLength = view.getUint16(central + 30, true);
    const commentLength = view.getUint16(central + 32, true);
    const name = new TextDecoder().decode(bytes.slice(central + 46, central + 46 + nameLength));
    const local = view.getUint32(central + 42, true);
    const size = view.getUint32(central + 24, true);

    assert.equal(view.getUint32(local, true), 0x04034b50, `${name} has a valid local header`);
    assert.equal(view.getUint16(local + 8, true), 0, `${name} is an interoperable ZIP STORE entry`);
    const offset = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    entries.set(name, new TextDecoder().decode(bytes.slice(offset, offset + size)));
    central += 46 + nameLength + extraLength + commentLength;
  }

  assert.equal(central, footer, "every declared ZIP entry was inspected");
  return entries;
}

const completedPptxStatus = ({ f, deck }) => f.renderer.ownNodes(deck, "section").find(node => node.attributes["data-export-stage"] === "prepared");
const completedPptxLabel = ({ f, deck }) => {
  const labels = f.renderer.ownNodes(deck, "span").filter(node => node.classList.contains("presentation-deck-export-status-label"));
  assert.equal(labels.length, 1);
  const start = deck.markup.indexOf(labels[0].full) + labels[0].full.length;
  return deck.markup.slice(start, deck.markup.indexOf("</span>", start));
};
async function completePptx(context, ports, format = "powerpoint") {
  const before = ports.receipts.length;
  ports.begin(format);
  await ports.waitFor(() => ports.receipts.length === before + 1, "actual Office bytes reach the existing release authorization boundary");
  ports.receipts[before].resolve(true);
  await ports.waitFor(() => !context.trigger().disabled, "the completed download releases Export");
  await new Promise(setImmediate); context.f.draw();
  assert.ok(completedPptxStatus(context));
}

for (const format of ["powerpoint", "powerpoint-presenter"]) for (const total of [1, 2]) {
  test("PowerPoint completion UI: " + format + " / " + total + " keeps format-specific translated completion inside the deck", async t => {
    const items = Array.from({ length: total }, (_, index) => ({ id: "completion-slide-" + index,
      title: "Exact completion decision " + (index + 1), body: "Exact audience evidence",
      notes: "Private presenter notes", image_prompt: "", context_group_ids: [] }));
    const context = await nativeExportFixture(t, "en", { factory: finitePdfFixture, items }), { f, deck, trigger } = context;
    const p = exportCompletionPorts(t, context);
    await completePptx(context, p, format);
    assert.equal(p.preparedFiles.length, 1); assert.equal(p.receipts.length, 1);
    assert.equal(p.receipts[0].receipt.payload.presenter_notes_included, format === "powerpoint-presenter");
    if (format === "powerpoint-presenter") assert.match(p.preparedFiles[0].filename, /-presenter\.pptx$/u, "private copies remain distinguishable after saving");
    else assert.doesNotMatch(p.preparedFiles[0].filename, /-presenter\.pptx$/u, "audience filenames do not masquerade as private presenter copies");
    assert.equal(p.owner.activeElement === p.original, true, "the same successful Export focus return is retained");
    const parts = completedPptxParts(new Uint8Array(await p.preparedFiles[0].blob.arrayBuffer()));
    const notes = parts.get("ppt/notesSlides/notesSlide1.xml");
    assert.equal(typeof notes, "string", "the compatible notes part exists for both privacy variants");
    const noteText = [...notes.matchAll(/<a:t(?:\s[^>]*)?>([^<]*)<\/a:t>/gu)].map(([, value]) => value.trim()).filter(Boolean);
    if (format === "powerpoint-presenter") assert.ok(noteText.includes("Private presenter notes"), "the message matches the exact private text in the decoded notes entry");
    else assert.deepEqual(noteText, [], "the audience message corresponds to an empty decoded notes entry");
    const labels = [];
    for (const locale of ["en", "fr", "ar", "ja"]) {
      if (locale !== "en") { f.setCompletionLocale(locale); f.draw(); }
      const status = completedPptxStatus(context); assert.ok(status);
      assert.equal(status.attributes.role, "status"); assert.equal(status.attributes["aria-live"], "polite"); assert.equal(status.attributes["aria-atomic"], "true");
      assert.equal(trigger().attributes["aria-describedby"], status.attributes.id);
      assert.equal(trigger().disabled, false); assert.equal(String(trigger().attributes["aria-busy"]), "false");
      const expected = f.i18n.t(format === "powerpoint" ? "presentation.export.audiencePrepared" : "presentation.export.presenterPrepared", "", { count: f.i18n.number(total) });
      const label = completedPptxLabel(context); assert.equal(label, expected); assert.doesNotMatch(label, /PDF/u); labels.push(label);
      assert.equal(f.renderer.ownNodes(deck, "progress").length, 0);
      assert.equal(f.renderer.ownNodes(deck, "span").some(node => node.classList.contains("presentation-deck-export-status-count")), false);
      assert.equal(f.renderer.ownNodes(deck, "button").some(node => node.classList.contains("presentation-deck-export-cancel") || node.classList.contains("presentation-deck-export-retry")), false);
      assert.equal(f.trace.some(value => value.startsWith("toast:")), false);
      assert.equal(f.exportSubscriptionCount(), 1);
    }
    assert.equal(new Set(labels).size, 4, "a retained completion is translated anew when the interface locale changes");
    assert.equal(p.preparedFiles.length, 1); assert.equal(p.receipts.length, 1); assert.equal(f.state.requests.length, 0);
  });
}

for (const mode of ["source-aba", "authorization-aba", "route-aba", "content-aba", "revision", "release-withdrawn"]) {
  test("PowerPoint completion UI: " + mode + " retires its success status without resurrection", async t => {
    const context = await nativeExportFixture(t, "en"), { f, deck } = context;
    const p = exportCompletionPorts(t, context);
    await completePptx(context, p);
    const preparedUrl = p.saveAnchor().href;
    assert.equal(f.exportSubscriptionCount(), 1);
    if (mode === "source-aba") { f.sourceOwnershipPort.retire(); f.store.notify(); f.sourceOwnershipPort.restore(); f.store.notify(); }
    if (mode === "authorization-aba") { const original = f.state.authorization; f.state.authorization = "retired-pptx-completion"; f.store.notify(); f.state.authorization = original; f.store.notify(); }
    if (mode === "route-aba") { const original = f.store.route; f.store.route = { get: () => "/library?document=A" }; f.store.notify(); f.store.route = original; f.store.notify(); }
    if (mode === "content-aba") { const original = f.state.content["content-A"]; f.state.content["content-A"] = original + " "; f.store.notify(); f.state.content["content-A"] = original; f.store.notify(); }
    if (mode === "revision") { f.state.events.push({ ...f.state.events.at(-1), eventId: "pptx-completion-revision", sequence: f.state.events.length + 1,
      type: "DocumentArtifactEdited", payload: { artifact_id: "artifact-A", document_id: "A", content_ref: "content-A", revision: 1 } }); f.store.notify(); }
    if (mode === "release-withdrawn") { deck.releaseAllowed = false; f.store.notify(); deck.releaseAllowed = true; f.store.notify(); }
    f.draw(); assert.equal(completedPptxStatus(context), undefined); assert.equal(f.exportSubscriptionCount(), 0);
    assert.equal(resolveObjectURL(preparedUrl), undefined, "retired ownership revokes the prepared Blob URL");
    assert.equal(p.revokedUrls.filter(url => url === preparedUrl).length, 1, "retirement cleanup is idempotent");
    f.store.notify(); f.draw(); assert.equal(completedPptxStatus(context), undefined, "later notifications cannot revive the old owner");
    assert.equal(p.preparedFiles.length, 1); assert.equal(p.receipts.length, 1); assert.equal(f.state.requests.length, 0);
    assert.equal(p.saveRequests.length, 0, "preparation never synthesizes a Save request");
    assert.equal(f.trace.some(value => value.startsWith("toast:")), false);
  });
}

test("PowerPoint completion UI: a new export replaces success and focused Cancel disposes the new completion owner", async t => {
  const context = await nativeExportFixture(t, "en"), { f, deck, trigger } = context;
  const p = exportCompletionPorts(t, context);
  await completePptx(context, p);
  p.begin("powerpoint");
  assert.equal(completedPptxStatus(context), undefined);
  assert.equal(f.exportSubscriptionCount(), 1, "only the new operation owns a pending completion");
  const cancel = f.renderer.ownNodes(deck, "button").find(node => node.classList.contains("presentation-deck-export-cancel"));
  assert.ok(cancel); cancel.focus({ preventScroll: true }); cancel.click(); f.draw();
  await p.waitFor(() => !trigger().disabled, "explicit Cancel settles the new operation");
  await new Promise(setImmediate); f.draw();
  assert.equal(completedPptxStatus(context), undefined); assert.equal(f.exportSubscriptionCount(), 0);
  assert.equal(p.owner.activeElement === p.original, true);
  assert.equal(p.preparedFiles.length, 1); assert.equal(p.receipts.length, 1); assert.equal(f.state.requests.length, 0);
  assert.equal(f.trace.some(value => value.startsWith("toast:")), false);
});


for (const format of ["pdf", "powerpoint", "powerpoint-presenter"]) test("prepared native save: " + format + " retries only the same authorized bytes", async t => {
  const context = await nativeExportFixture(t, "en", { factory: finitePdfFixture }), { f, deck } = context;
  const p = exportCompletionPorts(t, context), originalEvents = structuredClone(f.state.events), originalContent = structuredClone(f.state.content);
  const converterBefore = finitePdfCalls.length;
  if (format === "pdf") {
    p.begin(format);
    await p.waitFor(() => finitePdfCalls.length === converterBefore + 1, "PDF preparation reaches the declared finite converter");
    finitePdfCalls[converterBefore].complete();
    await p.waitFor(() => p.receipts.length === 1, "PDF preparation authorizes its one release");
    p.receipts[0].resolve(true);
    await p.waitFor(() => !context.trigger().disabled, "PDF preparation releases the busy control");
    await new Promise(setImmediate); f.draw();
  } else await completePptx(context, p, format);
  assert.equal(p.createdUrls.length, 1); assert.equal(p.preparedFiles.length, 1); assert.equal(p.saveRequests.length, 0);
  const anchor = p.saveAnchor(), file = p.preparedFiles[0], beforeFocus = p.focusCalls.length;
  assert.equal(anchor.href, file.url); assert.equal(anchor.download, file.filename);
  assert.equal(p.requestSave(anchor).defaultPrevented, false);
  f.draw();
  assert.equal(p.saveAnchor(), anchor, "the native Save link retains its identity during the same prepared outcome");
  assert.equal(p.requestSave(anchor).defaultPrevented, false);
  f.draw();
  const status = f.renderer.ownNodes(deck, "section").find(node => node.attributes["data-export-stage"] === "save-requested");
  assert.ok(status, "native default dispatch is only a Save request, not confirmed delivery");
  assert.match(deck.markup, /Save requested/u); assert.doesNotMatch(deck.markup, /downloaded\./iu);
  assert.equal(p.saveRequests.length, 2); assert.equal(p.createdUrls.length, 1); assert.equal(p.revokedUrls.length, 0);
  assert.equal(p.receipts.length, 1, "repeated Save never reauthorizes or adds a receipt");
  assert.equal(finitePdfCalls.length, converterBefore + (format === "pdf" ? 1 : 0), "Save never repeats PDF conversion");
  assert.equal(p.focusCalls.length, beforeFocus, "Save does not force focus back to Export or away from its link");
  for (const request of p.saveRequests) { assert.equal(request.url, file.url); assert.deepEqual(new Uint8Array(await request.blob.arrayBuffer()), new Uint8Array(await file.blob.arrayBuffer())); }
  assert.equal(f.state.requests.length, 0); assert.deepEqual(f.state.events, originalEvents); assert.deepEqual(f.state.content, originalContent);
});

for (const mode of ["authorization", "source", "route", "content", "items", "settings", "document", "artifact", "release", "role", "capabilities", "policy", "impersonation", "project-context"]) {
  test("prepared native save: " + mode + " is rechecked synchronously even before a render or notification", async t => {
    const context = await nativeExportFixture(t, "en"), { f, deck } = context;
    const p = exportCompletionPorts(t, context); await completePptx(context, p, "powerpoint-presenter");
    const anchor = p.saveAnchor(), url = anchor.href, originalSession = f.store.session.get();
    if (mode === "authorization") f.state.authorization = "withdrawn-before-save";
    if (mode === "source") f.sourceOwnershipPort.retire();
    if (mode === "route") f.store.route = { get: () => "/library?document=A" };
    if (mode === "content") f.state.content["content-A"] += " ";
    if (mode === "items") deck.items[0].notes += " Changed private note";
    if (mode === "settings") {
      const projection = f.store.projection.get;
      f.store.projection.get = () => { const value = projection(); return { ...value,
        libraryArtifacts: value.libraryArtifacts.map(artifact => artifact.id === "artifact-A"
          ? { ...artifact, settings: { ...artifact.settings, independent_review_required: true } } : artifact) }; };
    }
    if (mode === "document") deck.documentId = "B";
    if (mode === "artifact") deck.preferenceKey = "B";
    if (mode === "release") deck.releaseAllowed = false;
    if (mode === "role") f.store.session.get = () => ({ ...originalSession, user: { ...originalSession.user, role: "viewer" } });
    if (mode === "capabilities") f.store.session.get = () => ({ ...originalSession, capabilities: [] });
    if (mode === "policy") f.store.session.get = () => ({ ...originalSession, policy: { allowExport: false } });
    if (mode === "impersonation") f.store.session.get = () => ({ ...originalSession, impersonation: { userId: "other" } });
    if (mode === "project-context") f.store.session.get = () => ({ ...originalSession, projectContext: { projectId: "different-project", permissions: [] } });
    assert.equal(p.requestSave(anchor).defaultPrevented, true, "a stale native gesture cannot use retained authorized bytes");
    assert.equal(resolveObjectURL(url), undefined, "the invalidated private Blob URL is synchronously revoked");
    f.draw();
    assert.equal(p.saveAnchor(), undefined); assert.equal(f.exportSubscriptionCount(), 0);
    assert.equal(p.saveRequests.length, 0); assert.equal(p.receipts.length, 1);
    assert.equal(p.requestSave(anchor).defaultPrevented, true, "an old detached handler cannot resurrect the retired save");
    assert.equal(p.revokedUrls.filter(value => value === url).length, 1);
  });
}

test("prepared native save: a replaced private export cannot authorize its stale link", async t => {
  const context = await nativeExportFixture(t, "en"), { f } = context;
  const p = exportCompletionPorts(t, context); await completePptx(context, p, "powerpoint-presenter");
  const privateAnchor = p.saveAnchor(), privateUrl = privateAnchor.href;
  p.begin("powerpoint");
  assert.equal(resolveObjectURL(privateUrl), undefined, "starting another variant immediately retires the private buffer");
  assert.equal(p.requestSave(privateAnchor).defaultPrevented, true);
  await p.waitFor(() => p.receipts.length === 2, "the explicit audience preparation owns its separate receipt");
  p.receipts[1].resolve(true); await p.waitFor(() => !context.trigger().disabled, "the audience preparation finishes");
  await new Promise(setImmediate); f.draw();
  const audienceAnchor = p.saveAnchor(); assert.ok(audienceAnchor); assert.notEqual(audienceAnchor.href, privateUrl);
  assert.equal(p.requestSave(privateAnchor).defaultPrevented, true, "old closure cannot clear or dispatch the replacement");
  assert.equal(p.saveAnchor(), audienceAnchor); assert.ok(resolveObjectURL(audienceAnchor.href));
  assert.equal(p.requestSave(audienceAnchor).defaultPrevented, false); assert.equal(p.receipts.length, 2);
  const parts = completedPptxParts(new Uint8Array(await p.saveRequests[0].blob.arrayBuffer()));
  assert.doesNotMatch(parts.get("ppt/notesSlides/notesSlide1.xml"), /Private presenter notes/u);
});


test("prepared native save: non-primary or modified activation cannot bypass the guarded download gesture", async t => {
  const context = await nativeExportFixture(t, "en"), { f } = context;
  const p = exportCompletionPorts(t, context); await completePptx(context, p);
  const anchor = p.saveAnchor(), url = anchor.href;
  for (const event of [{ button: 1 }, { type: "auxclick", button: 1 }, { ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }]) {
    assert.equal(p.requestSave(anchor, event).defaultPrevented, true);
    assert.deepEqual(new Uint8Array(await resolveObjectURL(url).arrayBuffer()), new Uint8Array(await p.preparedFiles[0].blob.arrayBuffer()), "blocked alternate activation does not erase an otherwise current preparation");
  }
  f.draw(); assert.ok(completedPptxStatus(context));
  assert.equal(p.saveRequests.length, 0); assert.equal(p.receipts.length, 1);
  assert.equal(p.requestSave(p.saveAnchor()).defaultPrevented, false, "normal pointer or keyboard click retains native save semantics");
});

test("prepared native save: project-context expiry is checked without a new render or notification", async t => {
  const context = await nativeExportFixture(t, "en"), { f } = context;
  const p = exportCompletionPorts(t, context), session = f.store.session.get();
  let now = Date.now(); t.mock.method(Date, "now", () => now);
  const expiresAt = new Date(now + 60_000).toISOString();
  f.store.session.get = () => ({ ...session, projectContext: { projectId: "p", permissions: ["project.read", "project.author", "project.output.request"], expiresAt } });
  await completePptx(context, p, "powerpoint-presenter");
  const anchor = p.saveAnchor(), url = anchor.href;
  now += 60_001;
  assert.equal(p.requestSave(anchor).defaultPrevented, true);
  assert.equal(resolveObjectURL(url), undefined);
  assert.equal(p.saveRequests.length, 0); assert.equal(p.receipts.length, 1);
});


for (const mode of ["role", "revision"]) test("pending PDF preparation: " + mode + " withdrawal prevents even an export receipt", async t => {
  const c = await finitePdfCompletionContext(t), { f, p } = c;
  const call = await c.begin();
  if (mode === "role") {
    const session = f.store.session.get();
    f.store.session.get = () => ({ ...session, user: { ...session.user, role: "viewer" } });
  } else f.state.events.push({ ...f.state.events.at(-1), eventId: "pending-pdf-revision", sequence: f.state.events.length + 1,
    type: "DocumentArtifactEdited", payload: { artifact_id: "artifact-A", document_id: "A", content_ref: "content-A", revision: 1 } });
  call.complete(); await c.settle(); c.assertRetired();
  assert.equal(p.receipts.length, 0, "ownership is rechecked after asynchronous conversion and before export authorization");
  assert.equal(p.createdUrls.length, 0); assert.equal(p.preparedFiles.length, 0); assert.equal(p.saveRequests.length, 0);
});

test("pending presenter authorization: changed generating-creator eligibility cannot prepare private bytes", async t => {
  const context = await nativeExportFixture(t, "en"), { f } = context;
  const p = exportCompletionPorts(t, context), session = f.store.session.get();
  f.store.session.get = () => ({ ...session, projectContext: { projectId: "p", permissions: ["project.read", "project.author", "project.output.request"] } });
  p.begin("powerpoint-presenter");
  await p.waitFor(() => p.receipts.length === 1, "the original generating creator reaches export authorization");
  const completion = f.state.events.find(event => event.type === "DocumentRenderCompleted");
  const originalCreator = completion.payload.requested_by_user_id;
  completion.payload.requested_by_user_id = "another-creator"; f.store.notify();
  completion.payload.requested_by_user_id = originalCreator; f.store.notify();
  p.receipts[0].resolve(true);
  await p.waitFor(() => !context.trigger().disabled, "the retired authorization settles without a prepared output");
  await new Promise(setImmediate); f.draw();
  assert.equal(p.preparedFiles.length, 0); assert.equal(p.createdUrls.length, 0); assert.equal(p.saveRequests.length, 0);
  assert.equal(f.exportSubscriptionCount(), 0); assert.equal(p.receipts.length, 1);
});
