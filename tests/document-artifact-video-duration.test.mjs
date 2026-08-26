import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { foldEvents } from "../src/model/events.ts";

const source = await readFile(new URL("../src/components/document-artifacts.ts", import.meta.url), "utf8");

function exportedPlaybackHelper() {
  const declaration = /export\s+function\s+documentArtifactPlaybackSeconds\s*\([^)]*\)\s*:\s*number\s*\|\s*null\s*\{/u.exec(source);
  assert.ok(declaration, "the viewer exposes its exact runtime decision as a small, testable pure helper");

  const opening = declaration.index + declaration[0].length - 1;
  let depth = 0;
  for (let cursor = opening; cursor < source.length; cursor += 1) {
    if (source[cursor] === "{") depth += 1;
    if (source[cursor] === "}") depth -= 1;
    if (depth === 0) {
      const body = source.slice(opening + 1, cursor).replace(/\((\w+)\)\s*:\s*\1\s+is\s+number\s*=>/gu, "($1)=>");
      return new Function("artifact", body);
    }
  }
  assert.fail("the exported playback helper must have a complete function body");
}

const documentArtifactPlaybackSeconds = exportedPlaybackHelper();

const event = (sequence, type, payload) => ({
  eventId: `video-duration-event-${sequence}`,
  streamId: "video-duration-project",
  sequence,
  occurredAt: "2026-08-25T12:00:00.000Z",
  recordedAt: "2026-08-25T12:00:00.000Z",
  actor: "worker:renderer",
  clientId: "video-duration-test",
  correlationId: `video-duration-correlation-${sequence}`,
  causationId: null,
  compensatesEventId: null,
  schemaVersion: 1,
  type,
  payload,
});

function completedVideo({ settings = {}, items = [{}], latencyMs = 43_000, kind = "video" } = {}) {
  const projectId = "video-duration-project";
  const documentId = "video-duration-document";
  const events = [
    event(1, "ProjectCreated", { project_id: projectId, name: "Video playback duration" }),
    event(2, "DocumentCreated", { project_id: projectId, document_id: documentId, title: "Pitch context feedback" }),
    event(3, "DocumentRenderCompleted", {
      artifact_id: "video-duration-artifact",
      artifact_kind: kind,
      document_id: documentId,
      project_id: projectId,
      title: "A finished feedback film",
      summary: "A completed audience-visible motion study.",
      item_count: items.length,
      items: items.map((item, index) => ({ id: `scene-${index + 1}`, title: `Scene ${index + 1}`, ...item })),
      media_url: kind === "video" ? "/api/media/owner%2Ffinished-feedback.mp4" : null,
      media_type: kind === "video" ? "video/mp4" : null,
      latency_ms: latencyMs,
      settings,
    }),
  ];

  const artifact = foldEvents(events, Number.POSITIVE_INFINITY, documentId, projectId).artifacts[0];
  assert.ok(artifact);
  return artifact;
}

test("the actual manual-video receipt displays its four-second authorized runtime, not 43 seconds of provider latency", () => {
  const artifact = completedVideo({ settings: { video_seconds: 4 } });

  assert.equal(artifact.latency, 43_000);
  assert.equal(artifact.items.length, 1);
  assert.equal(artifact.items[0].durationSeconds, undefined);
  assert.equal(artifact.settings.video_seconds, 4);
  assert.equal(documentArtifactPlaybackSeconds(artifact), 4);
});

test("managed reels prefer the complete trustworthy sum of every delivered scene", () => {
  const managed = completedVideo({
    settings: { video_seconds: 99, production_mode: "managed" },
    items: [{ duration_seconds: 5 }, { duration_seconds: 6 }, { duration_seconds: 7 }],
  });

  assert.deepEqual(managed.items.map((item) => item.durationSeconds), [5, 6, 7]);
  assert.equal(documentArtifactPlaybackSeconds(managed), 18);

  const fractional = completedVideo({ settings: { video_seconds: 8 }, items: [{ duration_seconds: 1.25 }, { duration_seconds: 2.75 }] });
  assert.equal(documentArtifactPlaybackSeconds(fractional), 4);
});

test("missing, partial, zero, negative, nonfinite, or overflowing scene timing never produces a fabricated runtime", () => {
  for (const items of [
    [],
    [{ durationSeconds: 5 }, {}],
    [{ durationSeconds: 5 }, { durationSeconds: 0 }],
    [{ durationSeconds: 5 }, { durationSeconds: -1 }],
    [{ durationSeconds: 5 }, { durationSeconds: Number.NaN }],
    [{ durationSeconds: 5 }, { durationSeconds: Number.POSITIVE_INFINITY }],
    [{ durationSeconds: Number.MAX_VALUE }, { durationSeconds: Number.MAX_VALUE }],
  ]) {
    const artifact = { kind: "video", items, settings: { video_seconds: 4 }, latency: 43_000 };
    assert.equal(documentArtifactPlaybackSeconds(artifact), 4, JSON.stringify(items));
  }

  for (const settings of [{}, { video_seconds: "4" }, { video_seconds: 0 }, { video_seconds: -4 }, { video_seconds: Number.NaN }, { video_seconds: Number.POSITIVE_INFINITY }]) {
    const artifact = { kind: "video", items: [{}], settings, latency: 43_000 };
    assert.equal(documentArtifactPlaybackSeconds(artifact), null, JSON.stringify(settings));
    assert.notEqual(documentArtifactPlaybackSeconds(artifact), 43);
  }
});

test("other output forms keep generation latency rather than acquiring fake video playback time", () => {
  for (const kind of ["slides", "storyboard", "audio", "short_story", "scene"]) {
    const artifact = completedVideo({ kind, settings: { video_seconds: 4 }, items: [{ duration_seconds: 9 }], latencyMs: 43_000 });
    assert.equal(documentArtifactPlaybackSeconds(artifact), null, kind);
    assert.equal(Math.round(artifact.latency / 1_000), 43, kind);
  }
});

test("runtime calculation accesses only audience-safe timing and never private provider or generation metadata", () => {
  const accessed = [];
  const item = new Proxy({ durationSeconds: 4 }, {
    get(target, property) {
      assert.equal(property, "durationSeconds");
      accessed.push(`item.${String(property)}`);
      return Reflect.get(target, property);
    },
  });
  const artifact = new Proxy({ kind: "video", items: [item], settings: { video_seconds: 4 } }, {
    get(target, property) {
      assert.ok(["kind", "items", "settings"].includes(String(property)), `private field ${String(property)} must not be inspected`);
      accessed.push(String(property));
      return Reflect.get(target, property);
    },
  });

  assert.equal(documentArtifactPlaybackSeconds(artifact), 4);
  assert.ok(accessed.includes("kind"));
  assert.ok(accessed.includes("item.durationSeconds"));
  assert.ok(!accessed.some((field) => /latency|provider|cost|owner|input|receipt|document|media/i.test(field)));
});

test("the actual audience-facing footer uses real localized video duration, omits unknown duration, and preserves non-video latency", () => {
  assert.match(source, /playbackSeconds\s*=\s*documentArtifactPlaybackSeconds\(artifact\)/u);
  assert.match(source, /viewerDuration\s*=\s*artifact\.kind\s*===\s*"video"\s*\?\s*\(?playbackSeconds\s*===\s*null\s*\?\s*""/u);
  assert.match(source, /this\.i18n\.number\(playbackSeconds\)/u);
  assert.match(source, /Math\.round\(artifact\.latency\s*\/\s*1000\)/u);

  const footer = /<footer\s+data-actions-open=[\s\S]*?<\/span>/u.exec(source)?.[0];
  assert.ok(footer, "the actual output-reader footer is still rendered");
  assert.match(footer, /\$\{viewerDuration\}/u);
  assert.doesNotMatch(footer, /artifact\.latency|latency_ms/u);
  assert.doesNotMatch(footer, /provider|modelId|reservation|settlement|inputRef|sourceEventId/u);
});

test("settled slideshow, audio, storyboard, and video costs remain visible only to their exact non-impersonating production owner", () => {
  assert.match(
    source,
    /const\s+productionOwner\s*=\s*Boolean\(session\s*&&\s*!session\.impersonation\s*&&\s*\(!context\s*\|\|\s*String\(completed\?\.payload\.requested_by_user_id\s*\?\?\s*actorOf\(rendered\?\.actor\s*\?\?\s*""\)\)\s*===\s*userId\)\)/u,
  );

  const calculation = /const\s+generationCost\s*=\s*productionOwner\s*&&\s*\(([^;]+)\)\s*\?\s*creatorProductionSummary\(artifact,history\)\s*:\s*null\s*;/u.exec(source);
  assert.ok(calculation, "private settlement details require the original exact-owner guard");
  for (const kind of ["slides", "audio", "storyboard", "video"]) {
    assert.match(calculation[1], new RegExp(`artifact\\.kind\\s*===\\s*"${kind}"`), kind);
  }
  assert.match(source, /generationCost\s*\?\s*html`<p class="artifact-generation-cost">/u);
  assert.match(source, /productionOwner\s*\?\s*html`<p class="artifact-viewer-provider">/u);
});
