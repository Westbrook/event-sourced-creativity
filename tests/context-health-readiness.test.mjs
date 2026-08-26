import assert from "node:assert/strict";
import test from "node:test";

import { assessCreativeContext } from "../src/model/context-health.ts";

const block = (type, text, properties = {}) => ({
  id: properties.block_id ?? `block-${type}`,
  documentId: "document-pitch",
  canvasId: "",
  projectId: "project-pitch",
  scope: "document",
  type,
  handle: `${type}/authored`,
  position: "a0001",
  removed: false,
  locked: false,
  properties: { text, weight: .8, authority: "authored", ...properties },
  sourceEvents: [`created-${type}`],
});

const ownedReference = block("reference", "Owned source evidence supports the pitch.", {
  label: "Project source excerpt",
  reference_id: "reference-owned",
  source_mime_type: "text/plain",
  source_type: "pasted-text",
});

const rights = [{
  eventId: "rights-owned",
  streamId: "creative:owner",
  sequence: 1,
  occurredAt: "2026-08-25T12:00:00.000Z",
  recordedAt: "2026-08-25T12:00:00.000Z",
  actor: "user",
  clientId: "web:test",
  correlationId: "context-health-test",
  causationId: null,
  compensatesEventId: null,
  schemaVersion: 1,
  type: "RightsAsserted",
  payload: { reference_id: "reference-owned", rights_class: "owned_or_licensed" },
}];

const wizardContext = (deliverable = "A persuasive nine-slide pitch presentation") => [
  block("direction", "Explain why one living context can adapt to every audience."),
  block("audience", "Product leaders, founders, and enterprise buyers"),
  block("format", deliverable),
  block("exclusion", "Never invent customer claims or share private source material.", { intent: "prohibit" }),
  ownedReference,
];

test("an otherwise complete presentation brief is not ready until its central Message exists", () => {
  const incomplete = assessCreativeContext({ blocks: wizardContext() }, rights);
  const issue = incomplete.issues.find((candidate) => candidate.id === "missing-message");

  assert.equal(incomplete.score, 88);
  assert.equal(incomplete.state, "needs-attention");
  assert.equal(incomplete.verifiedSources, 1);
  assert.equal(issue?.severity, "warning", "missing creative messaging must not replace rights/security blocking semantics");
  assert.match(issue?.detail ?? "", /presentation.*authored Message/i);
  assert.deepEqual(issue?.blockIds, [], "an absent message should open the typed Message composer");

  const complete = assessCreativeContext({
    blocks: [...wizardContext(), block("message", "Your content. One context. Infinite paths to your target.")],
  }, rights);

  assert.equal(complete.score, 100);
  assert.equal(complete.state, "ready");
  assert.deepEqual(complete.issues, []);
  assert.equal(complete.verifiedSources, 1);
});

test("narrative output intent requires a Message while image, ambient video, and instrumental audio remain compatible", () => {
  for (const deliverable of [
    "A customer-facing presentation slide deck",
    "A written short story explaining the audience journey",
    "A written executive brief explaining the audience journey",
    "A scripted scene for the launch",
    "A four-frame storyboard explaining the launch",
  ]) {
    const report = assessCreativeContext({ blocks: wizardContext(deliverable) }, rights);
    assert.ok(report.issues.some((issue) => issue.id === "missing-message"), `${deliverable} needs an authored central Message`);
    assert.notEqual(report.state, "ready");
  }

  for (const deliverable of [
    "A 3:2 image at 1536 × 1024 pixels",
    "A quiet atmospheric video of an abstract landscape",
    "An original instrumental audio score",
  ]) {
    const report = assessCreativeContext({ blocks: wizardContext(deliverable) }, rights);
    assert.equal(report.state, "ready", `${deliverable} should not acquire an unrelated narrative requirement`);
    assert.equal(report.score, 100);
    assert.ok(!report.issues.some((issue) => issue.id === "missing-message"));
  }
});

test("prohibited presentation references never invent narrative intent for an image-only document", () => {
  const forbiddenFormat = block("direction", "Never produce a slideshow or presentation.", {
    block_id: "direction-no-presentation",
    intent: "prohibit",
  });
  const context = [...wizardContext("An original 3:2 campaign image"), forbiddenFormat];
  const report = assessCreativeContext({ blocks: context }, rights);

  assert.equal(report.state, "ready");
  assert.equal(report.score, 100);
  assert.ok(!report.issues.some((issue) => issue.id === "missing-message"));
});

test("blank, placeholder, muted, removed, or prohibited decisions never count as authored readiness", () => {
  const emptyMessage = block("message", "   ", { block_id: "message-empty" });
  const placeholderAudience = block("audience", "TBD", { block_id: "audience-placeholder" });
  const placeholderDirection = block("direction", "Enter your objective", { block_id: "direction-placeholder" });
  const placeholderFormat = block("format", "Format", { block_id: "format-placeholder" });
  const context = [placeholderDirection, placeholderAudience, placeholderFormat, ...wizardContext().filter((item) => ["exclusion", "reference"].includes(item.type))];

  const incompleteBasics = assessCreativeContext({ blocks: context }, rights);
  assert.deepEqual(incompleteBasics.issues.find((issue) => issue.id === "missing-direction")?.blockIds, ["direction-placeholder"]);
  assert.deepEqual(incompleteBasics.issues.find((issue) => issue.id === "missing-audience")?.blockIds, ["audience-placeholder"]);
  assert.deepEqual(incompleteBasics.issues.find((issue) => issue.id === "missing-deliverable")?.blockIds, ["format-placeholder"]);
  assert.notEqual(incompleteBasics.state, "ready");

  const empty = assessCreativeContext({ blocks: [...wizardContext(), emptyMessage] }, rights);
  assert.deepEqual(empty.issues.find((issue) => issue.id === "missing-message")?.blockIds, ["message-empty"]);

  for (const unusable of [
    block("message", "A removed message must not count.", { block_id: "message-removed" }),
    block("message", "A muted message must not count.", { block_id: "message-muted", weight: 0 }),
    block("message", "A prohibited message must not become the audience takeaway.", { block_id: "message-prohibited", intent: "prohibit" }),
    block("message", "TODO", { block_id: "message-placeholder" }),
    block("message", "...", { block_id: "message-punctuation" }),
  ]) {
    if (unusable.id === "message-removed") unusable.removed = true;
    const report = assessCreativeContext({ blocks: [...wizardContext(), unusable] }, rights);
    assert.ok(report.issues.some((issue) => issue.id === "missing-message"), `${unusable.id} must not satisfy the central-message requirement`);
  }
});

test("owned source excerpts cannot substitute for a first-class authored Message", () => {
  const centralPromise = "Your content. One context. Infinite paths to your target.";
  const context = wizardContext().map((item) => item.type === "reference"
    ? { ...item, properties: { ...item.properties, text: centralPromise } }
    : item);
  const report = assessCreativeContext({ blocks: context }, rights);

  assert.ok(report.issues.some((issue) => issue.id === "missing-message"));
  assert.equal(report.verifiedSources, 1);
  assert.notEqual(report.state, "ready");
});

test("explicit protected wording and opening/closing placement stay source-grounded without leaking their text", () => {
  const promise = "Your content. One context. Infinite paths to your target.";
  const message = block("message", `Explain why Forma adapts one living context.\n\nPreserve this line exactly: ${promise}`, {
    exact_text: promise,
    exact_placements: ["opening", "closing"],
    protected_phrases: [{ text: promise, placement: "opening_and_closing" }],
  });

  const complete = assessCreativeContext({ blocks: [...wizardContext(), message] }, rights);
  assert.equal(complete.score, 100);
  assert.equal(complete.state, "ready");

  const ungroundedPromise = "Confidential exact promise that must never leak through an issue.";
  const ungrounded = assessCreativeContext({
    blocks: [...wizardContext(), {
      ...message,
      properties: {
        ...message.properties,
        exact_text: ungroundedPromise,
        protected_phrases: [{ text: ungroundedPromise, placement: "closing" }],
      },
    }],
  }, rights);
  const issue = ungrounded.issues.find((candidate) => candidate.id === "protected-message-not-in-context");

  assert.equal(issue?.severity, "warning");
  assert.deepEqual(issue?.blockIds, [message.id]);
  assert.doesNotMatch(JSON.stringify(ungrounded.issues), /Confidential exact promise/i);
  assert.equal(ungrounded.state, "needs-attention");
});

test("malformed explicitly requested protected wording or placement receives focused, nonblocking guidance", () => {
  const invalid = block("message", "Explain the product clearly.", {
    block_id: "message-invalid-protection",
    exact_text: "   ",
    exact_placements: ["middle"],
    protected_phrases: [{ text: "", placement: "speaker_notes" }],
  });
  const report = assessCreativeContext({ blocks: [...wizardContext(), invalid] }, rights);

  for (const id of ["missing-protected-message", "invalid-protected-message-placement"]) {
    const issue = report.issues.find((candidate) => candidate.id === id);
    assert.equal(issue?.severity, "warning");
    assert.deepEqual(issue?.blockIds, ["message-invalid-protection"]);
  }
  assert.equal(report.state, "needs-attention");
  assert.ok(!report.issues.some((issue) => issue.severity === "blocking"));
});

test("source-rights failures remain blocking after message and protected-wording readiness improves", () => {
  const message = block("message", "Give recipients the content they need in the medium they choose.");
  const report = assessCreativeContext({ blocks: [...wizardContext(), message] }, []);

  assert.equal(report.state, "incomplete");
  assert.equal(report.verifiedSources, 0);
  assert.ok(report.issues.some((issue) => issue.id === "source-rights-block-reference" && issue.severity === "blocking"));
  assert.ok(!report.issues.some((issue) => issue.id === "missing-message"));
});

test("structured image formats preserve existing readiness without requiring narrative copy", () => {
  const format = block("format", "", {
    image_format: { preset: "3:2", dimensions: { width: 1536, height: 1024 } },
  });
  const context = wizardContext("A 3:2 image").map((item) => item.type === "format" ? format : item);
  const report = assessCreativeContext({ blocks: context }, rights);

  assert.equal(report.state, "ready");
  assert.equal(report.score, 100);
  assert.ok(!report.issues.some((issue) => issue.id === "missing-message" || issue.id === "missing-deliverable"));
});
