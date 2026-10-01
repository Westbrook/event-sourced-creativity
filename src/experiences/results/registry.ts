import type { OutputKind } from "../contracts.ts";

type ResultViewerRefs = {
  image: "image.read-only@1"; short_story: "short_story.read-only@1"; scene: "scene.read-only@1"; slides: "slides.read-only@1";
  storyboard: "storyboard.read-only@1"; video: "video.read-only@1"; audio: "audio.read-only@1"; model3d: "model3d.read-only@1";
};
export type ResultViewerRef<K extends OutputKind = OutputKind> = ResultViewerRefs[K];
export type ResultViewerDescriptor<K extends OutputKind = OutputKind> = Readonly<{
  id: ResultViewerRef<K>;
  output: K;
  dtoVersion: 1;
  contractRevision: 1;
  activation: "ready-result" | "explicit-user";
  qualification: "fixture-only";
}>;

/**
 * Metadata only: no import functions, renderer, mount, fetch, admission or ready
 * state. Registration is not qualification for native generation or delivery.
 * Existing intake/catalog release hashes are intentionally not changed here.
 */
export const experienceResultViewers = Object.freeze({
  image: Object.freeze({ id: "image.read-only@1", output: "image", dtoVersion: 1, contractRevision: 1, activation: "ready-result", qualification: "fixture-only" }),
  short_story: Object.freeze({ id: "short_story.read-only@1", output: "short_story", dtoVersion: 1, contractRevision: 1, activation: "ready-result", qualification: "fixture-only" }),
  scene: Object.freeze({ id: "scene.read-only@1", output: "scene", dtoVersion: 1, contractRevision: 1, activation: "ready-result", qualification: "fixture-only" }),
  slides: Object.freeze({ id: "slides.read-only@1", output: "slides", dtoVersion: 1, contractRevision: 1, activation: "ready-result", qualification: "fixture-only" }),
  storyboard: Object.freeze({ id: "storyboard.read-only@1", output: "storyboard", dtoVersion: 1, contractRevision: 1, activation: "ready-result", qualification: "fixture-only" }),
  video: Object.freeze({ id: "video.read-only@1", output: "video", dtoVersion: 1, contractRevision: 1, activation: "explicit-user", qualification: "fixture-only" }),
  audio: Object.freeze({ id: "audio.read-only@1", output: "audio", dtoVersion: 1, contractRevision: 1, activation: "explicit-user", qualification: "fixture-only" }),
  model3d: Object.freeze({ id: "model3d.read-only@1", output: "model3d", dtoVersion: 1, contractRevision: 1, activation: "explicit-user", qualification: "fixture-only" }),
} satisfies { [K in OutputKind]: ResultViewerDescriptor<K> });
