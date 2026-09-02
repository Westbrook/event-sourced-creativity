import assert from "node:assert/strict";
import test from "node:test";

import { inferDocumentArtifactKind } from "../src/model/document-output-intent.ts";

const block = (type, text, properties = {}) => ({ type, properties: { text, ...properties } });

test("an explicitly authored format outweighs direction, title, and multi-medium message copy", () => {
  const blocks = [
    block("direction", "Produce a video explaining the opportunity."),
    block("message", "Recipients can choose a storyboard, podcast, video, or written brief."),
    block("format", "An executive presentation with nine authored slides."),
  ];

  assert.equal(inferDocumentArtifactKind(blocks, "Cinematic storyboard"), "slides");
});

test("the first authored format wins when one context deliberately supports multiple future media", () => {
  assert.equal(inferDocumentArtifactKind([
    block("format", "One compelling pitch slideshow, followed by an honest storyboard and short video."),
  ], "Pitch context"), "slides");
  assert.equal(inferDocumentArtifactKind([
    block("format", "Six-slide faithful research readout, four-frame storyboard, and four-second video."),
  ], "Pitch context feedback"), "slides");
  assert.equal(inferDocumentArtifactKind([
    block("format", "A four-frame storyboard, followed by a cinematic video and presentation."),
  ]), "storyboard");
});

test("authored format synonyms map to every supported editable output kind", () => {
  const cases = [
    ["PowerPoint pitch deck", "slides"],
    ["A keynote presentation", "slides"],
    ["A four-shot storyboard", "storyboard"],
    ["A cinematic product video", "video"],
    ["An audio podcast", "audio"],
    ["A dramatic screenplay scene", "scene"],
    ["A written short story", "short_story"],
    ["An executive briefing", "short_story"],
    ["A customer memo", "short_story"],
    ["A research report", "short_story"],
    ["A commercial proposal", "short_story"],
    ["A launch email", "short_story"],
  ];

  for (const [format, expected] of cases) {
    assert.equal(inferDocumentArtifactKind([block("format", format)]), expected, format);
  }
});

test("an explicitly visual-only deliverable blocks vague pitch inference without overriding an explicit artifact", () => {
  assert.equal(inferDocumentArtifactKind([
    block("format", "An image/poster for a product pitch"),
    block("direction", "Pitch our product clearly."),
  ], "Product pitch"), null);
  assert.equal(inferDocumentArtifactKind([
    block("format", "Photorealistic founder headshot"),
    block("direction", "Pitch our product clearly."),
  ], "Pitch assets"), null);
  assert.equal(inferDocumentArtifactKind([
    block("format", "A product pitch", { image_format: "portrait" }),
  ], "Pitch assets"), null);
  assert.equal(inferDocumentArtifactKind([
    block("format", "A faithful slideshow", { image_format: "landscape" }),
  ]), "slides", "a stale visual-format field cannot replace an explicit presentation");
});

test("inactive, removed, excluded, negative, and audience-only text never drives output selection", () => {
  const forbidden = [
    block("format", "A slide deck", { weight: 0 }),
    block("format", "A video", { active: false }),
    { ...block("format", "A storyboard"), removed: true },
    block("exclusion", "Do not create an audio podcast."),
    block("boundary", "Never produce a written report."),
    block("audience", "People who enjoy presentation decks."),
    block("direction", "Never create slides.", { intent: "avoid" }),
    block("message", "Never create a video.", { effect: "prohibit" }),
    block("format", "Never create an audio track.", { authority: "excluded" }),
    block("direction", "Never create a storyboard.", { label: "Exclusion" }),
  ];

  assert.equal(inferDocumentArtifactKind(forbidden), null);
  assert.equal(inferDocumentArtifactKind([...forbidden, block("format", "An approved executive presentation")]), "slides");
});

test("direction beats weak message evidence while document title breaks ties against generic message copy", () => {
  assert.equal(inferDocumentArtifactKind([
    block("direction", "Create an educational video."),
    block("message", "Explain how one context can also become a pitch deck."),
  ], "Fundraising presentation"), "video");
  assert.equal(inferDocumentArtifactKind([
    block("message", "The customer story eventually becomes a video."),
  ], "Fundraising presentation"), "slides");
  assert.equal(inferDocumentArtifactKind([
    block("direction", "Pitch the value of unified content."),
  ], "Untitled document"), "slides");
  assert.equal(inferDocumentArtifactKind([], "Untitled document"), null);
});

test("structured camel-case and snake-case authored format values remain first-class intent", () => {
  const cases = [
    ["output_kind", "video", "video"],
    ["outputKind", "slides", "slides"],
    ["artifact_kind", "storyboard", "storyboard"],
    ["artifactKind", "audio", "audio"],
    ["output_format", "presentation", "slides"],
    ["outputFormat", "podcast", "audio"],
    ["delivery_format", "screenplay", "scene"],
    ["deliveryFormat", "proposal", "short_story"],
    ["requested_medium", "film", "video"],
    ["requestedMedium", "shot list", "storyboard"],
  ];

  for (const [property, value, expected] of cases) {
    assert.equal(inferDocumentArtifactKind([
      { type: "format", properties: { [property]: value } },
    ]), expected, `${property}: ${value}`);
  }
});

test("medium inference is a read-only recommendation and never mutates authored context", () => {
  const blocks = [Object.freeze({
    type: "format",
    properties: Object.freeze({ text: "A nine-slide presentation", weight: 1 }),
  })];

  assert.equal(inferDocumentArtifactKind(Object.freeze(blocks), "Pitch context"), "slides");
  assert.deepEqual(blocks[0].properties, { text: "A nine-slide presentation", weight: 1 });
});
