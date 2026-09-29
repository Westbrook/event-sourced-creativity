import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const presenterSource = () => readFile(new URL("../src/components/presentation-deck.ts", import.meta.url), "utf8");

test("presenter navigation preserves the current slide and supports complete direction-aware keyboard controls", async () => {
  const source = await presenterSource();

  for (const key of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"]) {
    assert.match(source, new RegExp(`["']${key}["']`), `the presenter must support ${key}`);
  }

  assert.match(source, /:dir\(rtl\)/, "horizontal presenter navigation must respect the reading direction");
  assert.match(source, /event\.defaultPrevented/, "presenter shortcuts must preserve handled keyboard events");
  assert.match(source, /event\.isComposing/, "presenter shortcuts must preserve active text composition");
  assert.match(source, /DECK_SLIDE_PREFERENCE/, "the current slide needs a dedicated persistence namespace");
  assert.match(source, /\breadDeckIndex\b/, "a previously selected slide must be restored");
  assert.match(source, /\bwriteDeckIndex\b/, "the selected slide must survive a view change or reopen");
  assert.match(source, /localStorage\.getItem/, "the saved presenter position must be read from local storage");
  assert.match(source, /localStorage\.setItem/, "the saved presenter position must be written to local storage");
  assert.match(source, /aria-current\s*=/, "the current list item must be exposed to assistive technology");
  assert.match(source, /presentation-deck-jump/, "reviewers must be able to jump directly to a slide");
});

test("presenter mode offers a real fullscreen transition without replacing the established slide views", async () => {
  const source = await presenterSource();

  assert.match(source, /#fullscreen\s*\(/, "fullscreen must have an explicit presenter action");
  assert.match(source, /requestFullscreen\s*\(/, "presenting must use the browser fullscreen contract");
  assert.match(source, /(?:document\s*\.\s*)?exitFullscreen\s*\(/, "presenters must be able to leave fullscreen");
  assert.match(source, /presentation-deck-presenter/, "presenter controls require their accessible styling hook");
  assert.match(source, /presentation-deck-view-switch/, "list and slideshow view controls must remain available");
  assert.match(source, /["']list["']/, "the established list view must remain supported");
  assert.match(source, /["']slideshow["']/, "the established slideshow view must remain supported");
});

test("the evidence-oriented reading alternative retains every chart row and complete attributed quotations", async () => {
  const source = await presenterSource();

  assert.match(source, /#reader\s*\(/, "the presenter needs a dedicated complete-content reading alternative");
  for (const hook of ["presentation-deck-reader", "presentation-deck-reader-content", "presentation-deck-evidence"]) {
    assert.match(source, new RegExp(`\\b${hook}\\b`), `${hook} must remain available to readable responsive layouts`);
  }

  assert.match(source, /\bvisual\s*(?:\?\.|\.)\s*data\s*(?:\?\.|\.)\s*map\s*\(/, "all structured visual rows must appear in reading order");
  assert.doesNotMatch(source, /\bvisual\s*(?:\?\.|\.)\s*data\s*(?:\?\.|\.)\s*(?:slice|splice)\s*\(/, "a complete scorecard must not silently drop later values");

  for (const field of ["text", "speaker", "role"]) {
    assert.match(source, new RegExp(`\\bquote\\s*(?:\\?\\.|\\.)\\s*${field}\\b`), `stakeholder quotation ${field} must remain visible`);
  }
  assert.doesNotMatch(source, /\bquote\s*(?:\?\.|\.)\s*text\s*(?:\?\.|\.)\s*(?:slice|substring|substr)\s*\(/, "protected stakeholder quotations must remain complete");
  assert.match(source, /Speaker notes/, "speaker notes must remain available alongside the presentation");
});

test("source evidence resolves only authorized blocks in the current document and project", async () => {
  const source = await presenterSource();

  assert.match(source, /#evidence\s*\(/, "source grounding must be resolved through a dedicated evidence contract");
  assert.match(source, /combinedContextMemberships/, "source aliases must be resolved through real context memberships");
  assert.match(source, /block\.documentId\s*===\s*documentId/, "source evidence must be restricted to the current document");
  assert.match(source, /block\.projectId\s*===\s*projection\.projectId/, "source evidence must be restricted to the current project");
  assert.match(source, /Authorized source evidence/, "reviewers must receive an honest evidence heading");
  assert.match(source, /Some source references could not be verified against this document\./, "unresolvable source aliases must not appear valid");
  assert.match(source, /No authorized source evidence was retained for this slide\./, "missing slide-level provenance must be disclosed");
  assert.match(source, /presentation-deck-source-chip/, "authorized source labels must remain individually inspectable");
  assert.match(source, /authorizedPresentationCitations\(citations,reference,source\.label\)/, "all approved citations for each authorized source must remain visible");
  assert.match(source, /for\(const citation of matches\.length\?matches:\[undefined\]\)/, "multiple approved excerpts must not collapse into a single source disclosure");
  assert.match(source, /OPAQUE_SOURCE_LABEL/, "opaque provider aliases and durable UUIDs must never become source labels");
  assert.match(source, /visibleSourceLabel\(membership\.name,\s*this\.i18n\.system\(["']Authored context["']\)\)/, "opaque context aliases require a safe, localized human-readable fallback");
  assert.match(source, /visibleSourceLabel\(citation\?\.label/, "opaque citation aliases require privacy-preserving label filtering");
  assert.match(source, /\bsource\.label\b/, "reviewers must see a human-readable authorized source label");
  assert.match(source, /Source decision/, "source blocks must retain their reviewer-facing evidence classification");
  assert.match(source, /Combined context/, "authorized grouped context must retain its reviewer-facing evidence classification");

  const evidenceStart = source.indexOf("#evidence(");
  assert.notEqual(evidenceStart, -1);
  const nextMethod = source.indexOf("\n  #", evidenceStart + "#evidence(".length);
  const evidence = source.slice(evidenceStart, nextMethod === -1 ? source.length : nextMethod);
  assert.doesNotMatch(evidence, /\$\{\s*(?:groupId|contextGroupId|context_group_id|block\.id|membership\.(?:groupId|contextGroupId|context_group_id))\s*\}/, "private source identifiers must never be rendered as reviewer-facing labels");
});

test("presenter status changes are announced atomically and expose stable accessible control hooks", async () => {
  const source = await presenterSource();
  const statuses = [...source.matchAll(/<[^>]*\brole\s*=\s*["']status["'][^>]*>/g)].map(([tag]) => tag);
  const status = statuses.find((tag) => /\baria-live\s*=\s*["']polite["']/.test(tag));

  assert.ok(status, "slide changes require a screen-reader status region");
  assert.match(status, /\baria-live\s*=\s*["']polite["']/, "slide changes should announce without interrupting the presenter");
  assert.match(status, /\baria-atomic\s*=\s*["']true["']/, "the complete current slide position should be announced together");

  for (const hook of ["presentation-deck-view-switch", "presentation-deck-presenter", "presentation-deck-jump", "presentation-deck-reader"]) {
    assert.match(source, new RegExp(`\\b${hook}\\b`), `${hook} needs a stable hook for minimum 44px accessible controls`);
  }
  assert.match(source, /aria-label\s*=\s*["']Slideshow controls["']/, "presentation navigation must retain an accessible landmark");
});

test("presentation and evidence improvements retain independent-review and export-authorization gates", async () => {
  const source = await presenterSource();

  assert.match(source, /#downloadPdf\s*\(/, "the reviewed PDF export path must remain intact");
  assert.match(source, /#downloadPowerPoint\s*\(/, "the reviewed editable PowerPoint export path must remain intact");
  assert.ok((source.match(/!this\.releaseAllowed/g) ?? []).length >= 2, "both exports must reject presentations without independent approval");
  assert.ok((source.match(/captureAuthorizationScope\s*\(/g) ?? []).length >= 2, "both exports must capture a current project authorization scope");
  assert.ok((source.match(/authorizeProjectExport\s*\(/g) ?? []).length >= 2, "both project exports must pass their independent authorization gate");
  assert.ok((source.match(/authorizationScopeActive\s*\(/g) ?? []).length >= 4, "authorization must be rechecked around both export releases");
  assert.match(source, /DocumentArtifactExported/, "successful releases must retain their audited export receipts");
  assert.match(source, /artifact_revision/, "reviewed exports must remain bound to their artifact revision");
  assert.doesNotMatch(source, /normalizeSlideDeckItems/, "approved slides must not be rewritten by provider-draft cross-slide deduplication");
});
