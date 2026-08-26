import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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

test("the unified compatible presentation export and import instructions are fully translated", () => {
  const keys = ["presentation.export.powerpoint", "presentation.export.powerpointHint"];
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
  assert.match(deck, /#toggleExportMenu\(event:ToggleEvent\)\{this\.#exportMenuOpen=event\.newState==="open"/u);
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

  assert.match(styles, /\.presentation-deck-export-menu\[popover\]\s*\{[^}]*position:\s*fixed;[^}]*inline-size:\s*min\(24rem,calc\(100dvw - 1rem\)\)/u);
  assert.match(styles, /\.presentation-deck-export-menu button\s*\{[^}]*min-block-size:\s*var\(--forma-control-min-size,2\.75rem\)/u);
  assert.equal((visualHarness.match(/page\.getByRole\("button",\{name:"Export"\}\)\.click\(\)/gu) ?? []).length, 2);
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
