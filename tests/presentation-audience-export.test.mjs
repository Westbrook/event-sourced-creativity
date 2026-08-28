import assert from "node:assert/strict";
import test from "node:test";

import { defaultSlidePresentation } from "../src/model/document-artifacts.ts";
import { createPowerPointDocument } from "../src/model/office-documents.ts";
import { createPresentationPdf } from "../src/model/presentation-pdf.ts";

const exactPromise = "Your content. One context. Infinite paths to your target.";
const privatePresenterNote = "PRIVATE PRESENTER NOTES: discuss the unreconciled provider charge.";
const privateNarrativeExcerpt = "ADAPTER INSTRUCTIONS: Preserve this line exactly and keep the internal narrative scaffold.";
const privatePriorityExcerpt = "Priority plan Slide 6 — P0: Move generation to durable server-owned execution.";
const presentation = defaultSlidePresentation("editorial");

function closingSlide() {
  return {
    title: "Build the story once",
    body: exactPromise,
    notes: privatePresenterNote,
    image_prompt: "PRIVATE IMAGE ADAPTER PROMPT",
    context_group_ids: ["PRIVATE_CONTEXT_GROUP_ID"],
    slide: {
      layout: "closing",
      kicker: "THE INVITATION",
      sourceIds: ["PRIVATE_SLIDE_SOURCE_ID"],
      citations: [
        {
          sourceId: "PRIVATE_NARRATIVE_SOURCE_ID",
          label: "Narrative brief",
          anchor: "Slide 9",
          excerpt: privateNarrativeExcerpt,
        },
        {
          sourceId: "PRIVATE_PRIORITY_SOURCE_ID",
          label: "Slide 6",
          anchor: "Priority plan",
          excerpt: privatePriorityExcerpt,
        },
      ],
      bullets: [],
      visual: {
        kind: "hero-type",
        label: "The invitation",
        value: "Tell it once. Deliver it everywhere.",
        data: [
          {
            label: "Delivery",
            value: "Every approved medium",
            weight: 1,
            sourceIds: ["PRIVATE_DATUM_SOURCE_ID"],
          },
        ],
      },
    },
  };
}

function storedZipEntries(bytes) {
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

function pdfText(bytes) {
  const raw = new TextDecoder().decode(bytes);
  const semantic = [...raw.matchAll(/\/ActualText\s*<(FEFF[0-9A-F]+)>/giu)].map(([, value]) =>
    Buffer.from(value, "hex").subarray(2).swap16().toString("utf16le"),
  );
  return [raw, ...semantic].join("\n");
}

function assertAudiencePrivacy(value, surface) {
  assert.doesNotMatch(value, /Narrative brief/u, `${surface} must not expose internal source labels`);
  assert.doesNotMatch(value, /\bSlide 6\b/u, `${surface} must not expose structural adapter coordinates`);
  assert.doesNotMatch(value, /ADAPTER INSTRUCTIONS/u, `${surface} must not expose source-only production instructions`);
  assert.doesNotMatch(value, /Move generation to durable server-owned execution/u, `${surface} must not duplicate private source excerpts`);
  assert.doesNotMatch(value, /PRIVATE PRESENTER NOTES/u, `${surface} must not expose presenter notes`);
  assert.doesNotMatch(value, /PRIVATE IMAGE ADAPTER PROMPT/u, `${surface} must not expose generation prompts`);
  assert.doesNotMatch(value, /PRIVATE_[A-Z][A-Z_]*_ID/u, `${surface} must not expose opaque source identifiers`);
}

test("default PDF and PowerPoint exports hide v2 passage anchors while preserving public attribution and canonical evidence", () => {
  const item = closingSlide();
  item.slide.citations = [
    { sourceId: "PRIVATE_PASSAGE_SOURCE_ID", label: "Published research passage_001", anchor: "Appendix B passage_002", excerpt: "PRIVATE_CITED_PASSAGE_CONTENT" },
    { sourceId: "PRIVATE_REPORT_SOURCE_ID", label: "Public technical report", anchor: "passage_003", excerpt: "PRIVATE_REPORT_WORKPAPER" },
  ];
  const before = structuredClone(item);
  const pdf = createPresentationPdf([item], presentation, { title: "Passage-safe delivery" });
  const powerpoint = createPowerPointDocument([item], presentation);
  const parts = storedZipEntries(powerpoint);

  for (const [surface, text] of [["PDF", pdfText(pdf.bytes)], ["PowerPoint", [...parts.values()].join("\n")]]) {
    assert.doesNotMatch(text, /passage_\d+|PRIVATE_CITED_PASSAGE_CONTENT|PRIVATE_REPORT_WORKPAPER|PRIVATE_(?:PASSAGE|REPORT)_SOURCE_ID/u, surface);
    assert.match(text, /Published research/u, `${surface} retains public research attribution`);
    assert.match(text, /Appendix B/u, `${surface} retains meaningful public anchors`);
    assert.match(text, /Public technical report/u, `${surface} does not drop the source when its private anchor is removed`);
  }
  assert.deepEqual(item, before, "exports must not mutate canonical evidence or conceal an incorrect anchor from later validation");
});

test("audience PDFs retain exact closing copy without publishing adapter labels, excerpts, or presenter notes", () => {
  const result = createPresentationPdf([closingSlide()], presentation, { title: "Forma pitch" });
  const contents = pdfText(result.bytes);

  assert.equal(result.pageCount, 1);
  assert.match(contents, /Your content\. One context\. Infinite paths to your target\./u,
    "the protected promise must survive as actual visible closing-slide copy");
  assert.match(contents, /Build the story once/u);
  assertAudiencePrivacy(contents, "the audience PDF");
});

test("default PowerPoint exports keep both audience slides and optional notes parts free of private content", () => {
  for (const options of [{ title: "Forma pitch" }, { title: "Forma pitch", includePresenterNotes: false }]) {
    const bytes = createPowerPointDocument([closingSlide()], presentation, options);
    const parts = storedZipEntries(bytes);
    const slide = parts.get("ppt/slides/slide1.xml");
    const notes = parts.get("ppt/notesSlides/notesSlide1.xml");

    assert.ok(slide, "PowerPoint retains a real, editable audience slide");
    assert.ok(notes, "an interoperable default notes part may still exist");
    assert.match(slide, /Your content\. One context\. Infinite paths to your target\./u,
      "the exact closing promise remains an editable on-slide shape");
    assertAudiencePrivacy(slide, "the default PowerPoint slide");
    assertAudiencePrivacy(notes, "the default PowerPoint notes part");
    assert.doesNotMatch(notes, /\[Sources\]/u, "default exports do not quietly populate private evidence notes");

    const noteText = [...notes.matchAll(/<a:t(?:\s[^>]*)?>([^<]*)<\/a:t>/gu)]
      .map(([, value]) => value.trim())
      .filter(Boolean);
    assert.deepEqual(noteText, [], "default presenter notes are empty rather than accidentally audience-shareable");
    assertAudiencePrivacy(new TextDecoder().decode(bytes), "the complete default PowerPoint package");
  }
});

test("published research and compliance attributions remain compact while their private excerpts stay unpublished", () => {
  const researchExcerpt = "PRIVATE RESEARCH WORKPAPER: participant identities and unredacted interview transcripts.";
  const complianceExcerpt = "PRIVATE LEGAL WORKPAPER: unreleased counsel annotations and restricted source material.";
  const licensedExcerpt = "PRIVATE LICENSE CONTRACT: unpublished photographer payment terms.";
  const item = {
    title: "Evidence the audience can verify",
    body: "Research and compliance references stay attributable without publishing their working papers.",
    notes: privatePresenterNote,
    image_prompt: "",
    slide: {
      layout: "statement",
      kicker: "Published evidence",
      bullets: ["Keep public attributions concise."],
      citations: [
        {
          sourceId: "PRIVATE_RESEARCH_SOURCE_ID",
          label: "Customer research",
          anchor: "Approved 2026 findings",
          excerpt: researchExcerpt,
        },
        {
          sourceId: "PRIVATE_COMPLIANCE_SOURCE_ID",
          label: "Public compliance report",
          anchor: "Regulatory disclosure",
          excerpt: complianceExcerpt,
        },
        {
          sourceId: "PRIVATE_LICENSE_SOURCE_ID",
          label: "Licensed photograph",
          anchor: "Copyright notice",
          excerpt: licensedExcerpt,
        },
      ],
      visual: { kind: "hero-type", label: "Grounded delivery", value: "Trustworthy by design", data: [] },
    },
  };

  const pdf = pdfText(createPresentationPdf([item], presentation).bytes);
  const parts = storedZipEntries(createPowerPointDocument([item], presentation));
  const slide = parts.get("ppt/slides/slide1.xml");
  const notes = parts.get("ppt/notesSlides/notesSlide1.xml");

  for (const [surface, value] of [["PDF", pdf], ["PowerPoint slide", slide]]) {
    assert.match(value, /Customer research/u, `${surface} retains meaningful research attribution`);
    assert.match(value, /Approved 2026 findings/u, `${surface} retains its meaningful public anchor`);
    assert.match(value, /Public compliance report/u, `${surface} retains legal/compliance attribution`);
    assert.match(value, /Regulatory disclosure/u, `${surface} retains the relevant legal anchor`);
    assert.match(value, /Licensed photograph/u, `${surface} retains required licensed-work attribution`);
    assert.match(value, /Copyright notice/u, `${surface} retains the relevant copyright anchor`);
    assert.doesNotMatch(value, /PRIVATE (?:RESEARCH|LEGAL|LICENSE)/u, `${surface} never includes full evidence excerpts`);
    assert.doesNotMatch(value, /PRIVATE_(?:RESEARCH|COMPLIANCE|LICENSE)_SOURCE_ID/u,
      `${surface} never exposes the opaque source identifiers`);
  }

  assert.doesNotMatch(notes, /PRIVATE PRESENTER NOTES|PRIVATE (?:RESEARCH|LEGAL|LICENSE)|\[Sources\]/u,
    "meaningful public attribution does not implicitly authorize private presenter notes");
});

test("feedback exports preserve a complete five-row visual matrix and all three authored scores", () => {
  const rows = [
    ["Context gathering", "7/10"],
    ["Slideshow adaptation", "2/10"],
    ["Message capture", "3/10"],
    ["Storyteller choice", "Creator-led"],
    ["Recipient choice", "Audience-led"],
  ];
  const item = {
    title: "Capturing the intended message",
    body: "Keep every scored interaction and both sides of the creator-recipient promise visible.",
    notes: privatePresenterNote,
    image_prompt: "",
    slide: {
      layout: "matrix",
      kicker: "End-user assessment",
      bullets: ["Keep the exact promise.", "Preserve authored scores.", "Retain creator choice.", "Retain audience choice."],
      citations: [
        {
          sourceId: "PRIVATE_MATRIX_SOURCE_ID",
          label: "Slide 6",
          anchor: "Priority plan",
          excerpt: privatePriorityExcerpt,
        },
      ],
      visual: {
        kind: "matrix",
        label: "What the end user actually experienced",
        value: "",
        data: rows.map(([label, value]) => ({ label, value, weight: 1 })),
      },
    },
  };

  const pdf = pdfText(createPresentationPdf([item], defaultSlidePresentation("field-notes")).bytes);
  const parts = storedZipEntries(createPowerPointDocument([item], defaultSlidePresentation("field-notes")));
  const slide = parts.get("ppt/slides/slide1.xml");

  for (const [label, value] of rows) {
    assert.ok(pdf.includes(label), `the PDF preserves matrix label ${label}`);
    assert.ok(pdf.includes(value), `the PDF preserves matrix value ${value}`);
    assert.ok(slide.includes(label), `PowerPoint preserves editable matrix label ${label}`);
    assert.ok(slide.includes(value), `PowerPoint preserves editable matrix value ${value}`);
  }
  assert.match(slide, /name="Editable matrix label 5"/u, "the fifth row remains an editable native PowerPoint shape");
  assert.match(slide, /name="Editable matrix value 5"/u, "the fifth value remains an editable native PowerPoint shape");
  assertAudiencePrivacy(pdf, "the feedback PDF");
  assertAudiencePrivacy(slide, "the feedback PowerPoint slide");
  assertAudiencePrivacy(parts.get("ppt/notesSlides/notesSlide1.xml"), "the default feedback notes part");
});

test("explicit presenter-note exports retain full private provenance only in notes, never on audience slides", () => {
  const item = closingSlide();
  item.slide.citations.push({
    sourceId: "PRIVATE_RESEARCH_SOURCE_ID",
    label: "Customer research",
    anchor: "Approved 2026 findings",
    excerpt: "PRIVATE FULL RESEARCH EXCERPT: retain the complete authorized participant evidence.",
  });

  const parts = storedZipEntries(createPowerPointDocument([item], presentation, {
    title: "Forma presenter copy",
    includePresenterNotes: true,
  }));
  const slide = parts.get("ppt/slides/slide1.xml");
  const notes = parts.get("ppt/notesSlides/notesSlide1.xml");

  assertAudiencePrivacy(slide, "the audience-facing slide in an explicitly authorized presenter export");
  assert.match(slide, /Customer research/u, "public research attribution remains visible on the slide");
  assert.match(slide, /Your content\. One context\. Infinite paths to your target\./u,
    "authorizing presenter notes does not change the delivered closing promise");
  assert.doesNotMatch(slide, /PRIVATE FULL RESEARCH EXCERPT/u, "full research evidence is presenter-only");

  assert.match(notes, /PRIVATE PRESENTER NOTES/u, "explicit opt-in preserves the authored presenter notes");
  assert.match(notes, /ADAPTER INSTRUCTIONS/u, "explicit opt-in preserves the full internal narrative excerpt");
  assert.match(notes, /Move generation to durable server-owned execution/u,
    "explicit opt-in preserves the complete internal priority-plan evidence");
  assert.match(notes, /PRIVATE FULL RESEARCH EXCERPT/u,
    "explicit opt-in preserves the complete approved research excerpt");
  assert.match(notes, /\[Sources\]/u, "explicit presenter notes keep evidence inspectable in its proper surface");
  assert.doesNotMatch(`${slide}${notes}`, /PRIVATE_[A-Z][A-Z_]*_ID/u,
    "even explicitly authorized presenter exports never expose opaque internal identifiers");
});

test("audience-safe exports never rewrite the canonical slide, protected promise, private notes, or provenance", () => {
  const item = closingSlide();
  const canonical = structuredClone(item);

  createPresentationPdf([item], presentation, { title: "Forma pitch" });
  createPowerPointDocument([item], presentation, { title: "Forma pitch" });
  createPowerPointDocument([item], presentation, { title: "Forma presenter copy", includePresenterNotes: true });

  assert.deepEqual(item, canonical, "audience projection must not mutate the authoritative source-bound artifact");
  assert.equal(item.body, exactPromise, "protected authored delivery copy remains unchanged");
  assert.equal(item.notes, privatePresenterNote, "original presenter notes remain available to authorized owners");
  assert.deepEqual(item.slide.citations.map(({ excerpt }) => excerpt), [privateNarrativeExcerpt, privatePriorityExcerpt],
    "full source excerpts remain available for private evidence inspection");
});
