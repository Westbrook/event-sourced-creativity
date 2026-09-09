// Reused native Image fixture declarations; deterministic ports, no browser evidence.
import assert from "node:assert/strict";
import { PartType } from "lit/directive.js";
import { getDirectiveClass, isDirectiveResult } from "lit/directive-helpers.js";
import { captureNativeImageHandle } from "../../src/model/native-image-generation.ts";

function evidence(documentId = "document-a") {
  const generationId = `generation-${documentId}`, eventId = `event-${documentId}`, objectId = `output-${documentId}`;
  const mediaUrl = `/api/media/u-757365722d31%2Fgenerated%2F${generationId}.png`;
  const setup = { documentId, documentRevision: "rev-abc123", sourceSurface: "native-image", promptTechnique: "prose",
    kind: "generate", productionMode: "manual", sourcePreviewId: null, requestKey: "generate:rev-abc123:document" };
  const job = { ...setup, jobId: `job-${documentId}`, requestedSequence: 42, status: "completed",
    canvasId: null, promptFanId: null, parentJobId: null, fanKind: null, members: [],
    result: { head: 49, appendedEventIds: [eventId], promoted: false }, error: null, errorDetail: null,
    moderationPromptRef: null, dismissedAt: null, attemptCount: 1,
    requestedAt: "2026-09-04T12:00:00.000Z", startedAt: "2026-09-04T12:00:01.000Z",
    completedAt: "2026-09-04T12:00:02.000Z", notifiedAt: null, leaseExpiresAt: null,
    updatedAt: "2026-09-04T12:00:02.000Z", stage: "completed", progressMessage: "" };
  const event = { eventId, streamId: "creative:user-1", sequence: 48,
    occurredAt: "2026-09-04T12:00:02.000Z", recordedAt: "2026-09-04T12:00:02.000Z",
    actor: "worker:generator", clientId: "server:document-job:generate", correlationId: "private-correlation",
    causationId: "compiled-original", compensatesEventId: null, schemaVersion: 1, type: "GenerationCompleted",
    payload: { document_id: documentId, generation_id: generationId, object_id: objectId, object_ids: [objectId],
      model_id: "gpt-image-2", provider: "openai", source_surface: "native-image", prompt_technique: "prose",
      media_url: mediaUrl, media_type: "image/png", source_content_hash: "a".repeat(64),
      image_width: 1536, image_height: 1024, quality: "high", purpose: "final", simulation: false,
      canvas_id: null, context_set_id: null, prompt_fan_id: null, promotion_id: null,
      reference_preview_event_id: null, promoted_from_generation_id: null, promoted_from_object_id: null,
      promotion_outcome: null, used_ideation_preview_pixels: false, content_expires_at: new Date(Date.now() + 5 * 60_000).toISOString() } };
  const output = { id: objectId, documentId, generationId, sourceEventId: eventId,
    canvasId: null, contextSetId: null, modelId: "gpt-image-2", provider: "openai", variant: 0,
    latency: 1, sequence: 48, pinned: false, saved: false, discarded: false, library: false,
    contentRef: null, promptRef: null, promptTechnique: "prose", promptFanId: null,
    mediaUrl, mediaType: "image/png", width: 1536, height: 1024, plannerModelId: null,
    quality: "high", purpose: "final", sourceSurface: "native-image", promotionId: null,
    promotedFromId: null, promotedFromEventId: null, focalPoint: null, standalone: true, standaloneSequence: 48 };
  const handle = captureNativeImageHandle(job, setup);
  assert.ok(handle, "the fixture uses the actual I1 identity capture");
  return { setup, job, handle, event, output, data: { inspection: { job }, events: [event], outputs: [output] } };
}

function commit(value) {
  for (let remaining = 8; isDirectiveResult(value); remaining--) {
    assert.ok(remaining > 0, "bounded public directive render nesting");
    const DirectiveClass = getDirectiveClass(value), instance = new DirectiveClass({ type: PartType.CHILD });
    value = instance.render(...value.values);
  }
  return value;
}
function* templates(value) {
  if (Array.isArray(value)) { for (const item of value) yield* templates(item); return; }
  // Ref callbacks are installed explicitly, never evaluated as renderer parts.
  if (isDirectiveResult(value) && typeof value.values[0] === "function") return;
  const template = commit(value);
  if (!template || !Array.isArray(template.strings)) return;
  yield template;
  for (const item of template.values) yield* templates(item);
}
function plainElement(tagName) {
  const attributes = new Map(), listeners = new Map(), children = new Set();
  return { tagName, isConnected: true, ownerDocument: { URL: "https://forma.example.test/documents/document-a" },
    hidden: false, disabled: false, textContent: "", src: "", currentSrc: "", complete: false, naturalWidth: 0, naturalHeight: 0, children,
    contains(element) { return children.has(element); },
    getAttribute(name) { return attributes.get(name) ?? null; },
    setAttribute(name, value) { attributes.set(name, String(value)); if (name === "src") { this.src = String(value); this.currentSrc = String(value); } },
    removeAttribute(name) { attributes.delete(name); if (name === "src") this.src = ""; },
    addEventListener(type, callback) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(callback); },
    removeEventListener(type, callback) { listeners.get(type)?.delete(callback); },
    listener(type) { const entries = [...(listeners.get(type) ?? [])]; assert.equal(entries.length, 1); return entries[0]; },
    listenerCount(type) { return listeners.get(type)?.size ?? 0; },
    remove() { this.isConnected = false; },
  };
}
const portEvent = element => ({ currentTarget: element, isTrusted: true });

function loadPort(mounted) {
  mounted.image.complete = true; mounted.image.naturalWidth = 1536; mounted.image.naturalHeight = 1024;
  mounted.loaded(portEvent(mounted.image));
}

export { evidence, templates, plainElement, portEvent, loadPort, isDirectiveResult, captureNativeImageHandle };
