import test from "node:test";
import assert from "node:assert/strict";
import {
  presentationAudienceArtifact,
  presentationAudienceCitations,
  presentationAudienceItem,
  presentationAudienceText,
} from "../src/model/presentation-delivery.ts";

const TAGLINE = "Your content. One context. Infinite paths to your target.";

function slide(overrides = {}) {
  return {
    title: "One context, infinite paths",
    body: "The storyteller and the recipient choose the right medium for this moment.",
    notes: "PRIVATE_PRESENTER_NOTES — review the source excerpt before delivery.",
    image_prompt: "PRIVATE_PROVIDER_PROMPT — internal production direction.",
    context_group_ids: ["private-context-group"],
    slide: {
      layout: "matrix",
      kicker: "THE INVITATION",
      section: "Creator and recipient agency",
      bullets: [".doc · .ppt · .mov · .mp3 · .psd", "P0: preserve reliable provider-request reconciliation."],
      sourceIds: ["private-source-block"],
      citations: [],
      quote: {
        text: "The right medium is the one this person needs now.",
        speaker: "Research participant",
        role: "Product owner",
        sourceId: "private-interview-block",
        citation: "Narrative brief",
      },
      visual: {
        kind: "matrix",
        label: "One approved context",
        value: "Infinite paths to your target",
        data: [{ label: "Audience format", value: "Recipient-led", weight: 1, sourceIds: ["private-claim"] }],
      },
      ...overrides,
    },
  };
}

test("all nine real pitch-shaped Narrative brief citations remain private without mutating canonical evidence", () => {
  for (let position = 1; position <= 9; position += 1) {
    const citation = {
      sourceId: `private-slide-${position}`,
      label: "Narrative brief",
      anchor: `Slide ${position}`,
      excerpt: `Slide ${position} — ${TAGLINE}`,
    };
    const original = slide({ citations: [citation] });
    const before = structuredClone(original);

    assert.deepEqual(presentationAudienceCitations(original.slide.citations), []);
    assert.deepEqual(presentationAudienceItem(original).slide.citations, []);
    assert.deepEqual(original, before, `Canonical evidence changed on slide ${position}`);
  }
});

test("structural feedback coordinates do not turn meaningful P0 audience content into slide provenance", () => {
  const citation = {
    sourceId: "private-plan-block",
    label: "Slide 6",
    anchor: "Priority plan",
    excerpt: "Slide 6 — P0: Move generation to durable server-owned execution; reconcile explicit charge states.",
    audience_visible: true,
    visibility: "public",
  };
  const item = slide({ citations: [citation] });
  const projected = presentationAudienceItem(item);

  assert.deepEqual(projected.slide.citations, []);
  assert.match(projected.slide.bullets.join(" "), /P0: preserve reliable provider-request reconciliation/);
  assert.match(presentationAudienceText(item), /P0: preserve reliable provider-request reconciliation/);
  assert.doesNotMatch(presentationAudienceText(item), /Priority plan|Slide 6|durable server-owned execution/);
  assert.equal(item.slide.citations[0].excerpt, citation.excerpt);
});

test("genuine public research, legal, licensing, and organization attribution stays compact and source-safe", () => {
  const citations = [
    { sourceId: "private-who-block", label: "World Health Organization", anchor: "p. 12", excerpt: "PRIVATE_PUBLICATION_EXCERPT" },
    { sourceId: "private-research-block", label: "Approved research", anchor: "Slide 1", excerpt: "PRIVATE_RESEARCH_EXCERPT" },
    { sourceId: "private-legal-block", label: "European Union regulation 2024/1689", anchor: "Article 13", excerpt: "PRIVATE_LEGAL_EXCERPT" },
    { sourceId: "private-license-block", label: "Licensed photograph © Lina Meyer", anchor: "Cover image", excerpt: "PRIVATE_LICENSE_TERMS" },
    { sourceId: "private-duplicate", label: "World Health Organization", anchor: "p. 12", excerpt: "ANOTHER_PRIVATE_EXCERPT" },
  ];

  assert.deepEqual(presentationAudienceCitations(citations), [
    { label: "World Health Organization", anchor: "p. 12", excerpt: "" },
    { label: "Approved research", anchor: "", excerpt: "" },
    { label: "European Union regulation 2024/1689", anchor: "Article 13", excerpt: "" },
    { label: "Licensed photograph © Lina Meyer", anchor: "Cover image", excerpt: "" },
  ]);
  assert.doesNotMatch(JSON.stringify(presentationAudienceCitations(citations)), /PRIVATE_|private-/);
});

test("opaque aliases and durable UUIDs cannot hitchhike on legitimate public attribution", () => {
  const citation = {
    sourceId: "private-owner-block",
    label: "World Health Organization blk_001 4e9b1eec-a4c2-473c-bb54-4b4b237d9b71",
    anchor: "p. 12 grp_004 ccad396b-2acb-4966-adb3-cf1605dafbfd",
    excerpt: "PRIVATE_ARTIFACT_EXCERPT",
  };

  assert.deepEqual(presentationAudienceCitations([citation]), [{
    label: "World Health Organization",
    anchor: "p. 12",
    excerpt: "",
  }]);
  assert.deepEqual(presentationAudienceCitations([{ label: "blk_001", anchor: "grp_004", excerpt: "" }]), []);
});

test("private passage anchors remain canonical for grounding but disappear from audience attribution", () => {
  const original = slide({
    citations: [{ sourceId: "private-research", label: "Published research passage_001", anchor: "Appendix B passage_002", excerpt: "PRIVATE_SOURCE_PASSAGE" }],
    quote: { text: "The right medium is the one this person needs now.", speaker: "Research participant", role: "Product owner", sourceId: "private-research", citation: "Published research passage_001" },
  });
  const before = structuredClone(original);
  const delivered = presentationAudienceItem(original);
  assert.deepEqual(delivered.slide.citations, [{ label: "Published research", anchor: "Appendix B", excerpt: "" }]);
  assert.equal(delivered.slide.quote.citation, "Published research");
  assert.deepEqual(presentationAudienceCitations([{ label: "Published research", anchor: "passage_001", excerpt: "" }]), [{ label: "Published research", anchor: "", excerpt: "" }]);
  assert.deepEqual(presentationAudienceCitations([{ label: "passage_001", anchor: "passage_002", excerpt: "" }]), []);
  assert.doesNotMatch(JSON.stringify(delivered), /passage_\d+|PRIVATE_SOURCE_PASSAGE/u);
  assert.deepEqual(original, before, "audience sanitation cannot erase evidence used by source validation or private inspection");
});

test("only trusted application source decisions can publish ordinary labels; explicit privacy wins", () => {
  const citation = {
    sourceId: "approved-external-source",
    label: "Original creator",
    anchor: "Installation wall",
    excerpt: "PRIVATE_SOURCE_EXCERPT",
    audience_visible: true,
    visibility: "public",
    public: true,
  };

  assert.deepEqual(presentationAudienceCitations([citation]), []);
  assert.deepEqual(presentationAudienceCitations([citation], {
    authorizedPublicSourceIds: new Set(["approved-external-source"]),
  }), [{ label: "Original creator", anchor: "Installation wall", excerpt: "" }]);
  assert.deepEqual(presentationAudienceCitations([citation], {
    authorizedPublicSourceIds: ["approved-external-source"],
    authorizedPrivateSourceIds: ["approved-external-source"],
  }), []);

  assert.deepEqual(presentationAudienceCitations([{
    label: "Confidential customer research interviews",
    anchor: "Unpublished participant report",
    excerpt: "PRIVATE_CUSTOMER_IDENTITY",
    visibility: "public",
  }]), []);
});

test("audience item removes presenter direction, provider prompts, private identifiers, and internal quote attribution", () => {
  const item = slide({
    citations: [{ sourceId: "private-source-block", label: "Narrative brief", anchor: "Slide 9", excerpt: TAGLINE }],
  });
  const original = structuredClone(item);
  const projected = presentationAudienceItem(item);

  assert.equal(projected.notes, "");
  assert.equal(projected.image_prompt, "");
  assert.deepEqual(projected.context_group_ids, []);
  assert.deepEqual(projected.slide.sourceIds, []);
  assert.deepEqual(projected.slide.visual.data[0].sourceIds, []);
  assert.equal(projected.slide.quote.sourceId, undefined);
  assert.equal(projected.slide.quote.citation, undefined);
  assert.equal(projected.slide.quote.text, original.slide.quote.text);
  assert.equal(projected.slide.quote.speaker, "Research participant");
  assert.equal(projected.slide.quote.role, "Product owner");
  assert.equal(projected.title, original.title);
  assert.equal(projected.body, original.body);
  assert.deepEqual(projected.slide.bullets, original.slide.bullets);
  assert.deepEqual(item, original);
  assert.doesNotMatch(JSON.stringify(projected), /PRIVATE_|private-|Narrative brief|Slide 9/);
});

test("authorized presenter-note opt-in never puts private excerpts back into audience-facing slide copy", () => {
  const item = slide({
    citations: [{ sourceId: "private-source-block", label: "Approved research", anchor: "Slide 4", excerpt: "PRIVATE_EXCERPT" }],
  });
  const projected = presentationAudienceItem(item, { includePresenterNotes: true });

  assert.equal(projected.notes, item.notes);
  assert.deepEqual(projected.slide.citations, [{ label: "Approved research", anchor: "", excerpt: "" }]);
  assert.equal(projected.slide.quote.sourceId, undefined);
  assert.equal(item.slide.citations[0].excerpt, "PRIVATE_EXCERPT");
});

test("exact-message guarantees never count a tagline found only in notes or provenance", () => {
  const item = slide({
    citations: [{ label: "Narrative brief", anchor: "Slide 9", excerpt: TAGLINE }],
  });
  item.notes = `Privately remind the presenter: ${TAGLINE}`;

  assert.doesNotMatch(presentationAudienceText(item), new RegExp(TAGLINE.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")));

  item.body = TAGLINE;
  assert.ok(presentationAudienceText(item).includes(TAGLINE));

  item.body = "";
  item.slide.visual.value = TAGLINE;
  assert.ok(presentationAudienceText(item).includes(TAGLINE));
});

test("meaningful public quote attribution survives alongside speaker and role", () => {
  const item = slide();
  item.slide.quote.citation = "Published research interview";

  const projected = presentationAudienceItem(item);
  assert.equal(projected.slide.quote.citation, "Published research interview");
  assert.doesNotMatch(presentationAudienceText(item), /Published research interview/);
  assert.match(presentationAudienceText(item), /Research participant/);
});

test("message checks tolerate sparse provider drafts and reject phrases hidden in public attribution", () => {
  const sparse = {
    title: "A sparse audience slide",
    body: "",
    notes: TAGLINE,
    slide: {
      citations: [{ label: `Published research: ${TAGLINE}`, anchor: "p. 9", excerpt: TAGLINE }],
      quote: { text: "A relevant quote.", citation: TAGLINE },
    },
  };

  assert.equal(presentationAudienceText(null), "");
  assert.equal(presentationAudienceText({ title: "Only the title" }), "Only the title");
  assert.doesNotMatch(presentationAudienceText(sparse), /Your content/);
  assert.match(presentationAudienceText({ slide: { visual: { exact_value: "61.125", data: [{ display_value: "61.13" }] } } }), /61\.125\n61\.13/);
});

test("public artifact projects every slide immutably and clears both draft and stored private field shapes", () => {
  const draft = slide({ citations: [{ label: "Narrative brief", anchor: "Slide 1", excerpt: TAGLINE }] });
  const stored = {
    ...slide({ citations: [{ label: "Slide 6", anchor: "Priority plan", excerpt: "PRIVATE_PLAN" }] }),
    imagePrompt: "PRIVATE_STORED_PROMPT",
    contextGroupIds: ["private-stored-group"],
  };
  const artifact = { id: "approved-artifact", title: "A real presentation", items: [draft, stored] };
  const canonical = structuredClone(artifact);
  const projected = presentationAudienceArtifact(artifact);

  assert.equal(projected.title, "A real presentation");
  assert.equal(projected.items.length, 2);
  assert.equal(projected.items.every((item) => item.notes === ""), true);
  assert.equal(projected.items[1].imagePrompt, "");
  assert.deepEqual(projected.items[1].contextGroupIds, []);
  assert.doesNotMatch(JSON.stringify(projected), /PRIVATE_|private-|Narrative brief|Priority plan/);
  assert.deepEqual(artifact, canonical);
});
