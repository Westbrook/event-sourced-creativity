import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { audioDurationMetadata, audioPlaybackTiming } from "../src/model/audio.ts";
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
      const run=new Function("artifact", "audioPlaybackTiming", body);
      return artifact=>run(artifact,audioPlaybackTiming);
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
      media_url: kind === "video" ? "/api/media/owner%2Ffinished-feedback.mp4" : kind === "audio" ? "/api/media/owner%2Ffinished-podcast.mp3" : null,
      media_type: kind === "video" ? "video/mp4" : kind === "audio" ? "audio/mpeg" : null,
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
  for (const kind of ["slides", "storyboard", "short_story", "scene"]) {
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

test("the audience-facing footer separates audio playback and estimates from generation latency", () => {
  assert.match(source, /playbackSeconds\s*=\s*documentArtifactPlaybackSeconds\(artifact\)/u);
  assert.match(source, /viewerDuration\s*=\s*artifact\.kind\s*===\s*"audio"/u);
  assert.match(source, /audioTiming=artifact\.kind==="audio"\?audioPlaybackTiming\(artifact\.settings,artifact\.mediaUrl\)/u);
  assert.match(source, /audio\.duration\.\$\{audioTiming\.basis\}/u);
  assert.match(source, /:artifact\.kind==="video"\?\(playbackSeconds===null\?""/u);
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


test("a measured 123.56-second podcast never displays its 56-second generation latency", () => {
  const media={url:"/api/media/owner%2Ffinished-podcast.mp3",contentHash:"a".repeat(64),durationSeconds:123.56};
  const artifact=completedVideo({kind:"audio",latencyMs:56_000,settings:{source_media_sha256:media.contentHash,...audioDurationMetadata(media,90)}});
  assert.equal(documentArtifactPlaybackSeconds(artifact),123.56);
  assert.deepEqual(audioPlaybackTiming(artifact.settings,artifact.mediaUrl),{seconds:123.56,basis:"measured"});
  assert.equal(artifact.settings.estimated_duration_seconds,null);
  const legacy=completedVideo({kind:"audio",latencyMs:56_000,settings:{duration_seconds:123.56}});
  assert.equal(documentArtifactPlaybackSeconds(legacy),123.56);
  assert.equal(audioPlaybackTiming(legacy.settings,legacy.mediaUrl).basis,"recorded","Legacy metadata is not newly certified as measured");
});

test("audio estimates and stale or invalid media metadata never masquerade as measured playback", () => {
  const media={url:"/api/media/owner%2Ffinished-podcast.mp3",contentHash:"a".repeat(64),durationSeconds:null};
  const artifact=completedVideo({kind:"audio",settings:{source_media_sha256:media.contentHash,...audioDurationMetadata(media,90)}});
  assert.equal(documentArtifactPlaybackSeconds(artifact),null);
  assert.deepEqual(audioPlaybackTiming(artifact.settings,artifact.mediaUrl),{seconds:90,basis:"estimate"});
  for(const duration of [undefined,null,"123.56",0,-1,NaN,Infinity]){
    const unknown=completedVideo({kind:"audio",latencyMs:56_000,settings:{duration_seconds:duration}});
    assert.equal(documentArtifactPlaybackSeconds(unknown),null);
  }
  const measured={...artifact,settings:{source_media_sha256:media.contentHash,...audioDurationMetadata({...media,durationSeconds:123.56})}};
  assert.equal(documentArtifactPlaybackSeconds({...measured,mediaUrl:"/api/media/owner%2Freplaced.mp3"}),null);
  assert.equal(documentArtifactPlaybackSeconds({...measured,settings:{...measured.settings,source_media_sha256:"b".repeat(64)}}),null);
});
