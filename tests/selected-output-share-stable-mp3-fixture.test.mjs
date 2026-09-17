import assert from "node:assert/strict";
import test from "node:test";
import { registerOutputSourceImports } from "./output-server-test-helpers.mjs";
import { fixture, MEDIA_HASH } from "./helpers/native-stable-audio-proof-fixture.mjs";
import { selectedOutputShareStableMp3Fixture, STEREO_MP3_SHA256, digest } from "./helpers/selected-output-share-stable-mp3-fixture.mjs";
const imports = registerOutputSourceImports();
let readNativeStableAudioRecipeProof, nativeStableAudioRecipeSnapshot, assertNativeStableAudioRecipeCurrent;
try {
  ({ readNativeStableAudioRecipeProof, nativeStableAudioRecipeSnapshot, assertNativeStableAudioRecipeCurrent }
    = await import("../worker/native-stable-audio-share-proof.ts"));
} finally { imports.deregister(); }

test("native proof fixture default digest and explicit original default preserve genuine source readback", async t => {
  const omitted = await fixture(t), explicit = await fixture(t, { mediaSha256: MEDIA_HASH });
  assert.deepEqual(omitted.selection, explicit.selection);
  assert.deepEqual(omitted.privatePayload().settings, explicit.privatePayload().settings);
  for (const f of [omitted, explicit]) {
    const before = f.changes();
    const proof = await readNativeStableAudioRecipeProof(f.env, f.identity, f.selection, new AbortController().signal);
    assert.equal(nativeStableAudioRecipeSnapshot(proof, f.env).media.sha256, MEDIA_HASH);
    await assertNativeStableAudioRecipeCurrent(proof, f.env);
    const stored = f.sqlite.prepare("SELECT content_sha256 FROM output_native_storage_writes").get();
    assert.equal(stored.content_sha256, MEDIA_HASH);
    assert.equal(f.privatePayload().settings.source_media_sha256, MEDIA_HASH);
    assert.equal(f.privatePayload().settings.duration_media_sha256, MEDIA_HASH);
    assert.equal(f.changes(), before); assert.deepEqual(f.mediaCalls, []); assert.equal(f.media.size, 0);
  }
});

test("fixture digest option rejects coercion, uppercase, short, long and nonhex values before setup", async t => {
  for (const mediaSha256 of [null, 7, new String(MEDIA_HASH), "A".repeat(64), "g".repeat(64), "a".repeat(63), "a".repeat(65), MEDIA_HASH + "\n"])
    await assert.rejects(fixture(t, { mediaSha256 }));
});

test("single-donor sharing fixture binds actual synthetic stereo20 source without native state changes or media access", async t => {
  const f = await selectedOutputShareStableMp3Fixture(t), before = f.nativeSnapshot(), changes = f.changes();
  assert.equal(digest(f.sourceBytes), STEREO_MP3_SHA256);
  assert.equal(f.nativeSelection.mediaSha256, STEREO_MP3_SHA256); assert.equal(f.selection().mediaSha256, STEREO_MP3_SHA256);
  assert.equal(f.privatePayload().settings.source_media_sha256, STEREO_MP3_SHA256);
  assert.equal(f.privatePayload().settings.duration_media_sha256, STEREO_MP3_SHA256);
  assert.equal(f.sqlite.prepare("SELECT content_sha256 FROM output_native_storage_writes").get().content_sha256, STEREO_MP3_SHA256);
  const proof = await readNativeStableAudioRecipeProof(f.env, f.identity, f.nativeSelection, new AbortController().signal);
  assert.equal(nativeStableAudioRecipeSnapshot(proof, f.env).media.sha256, STEREO_MP3_SHA256);
  await assertNativeStableAudioRecipeCurrent(proof, f.env);
  assert.deepEqual(f.shares(), []); assert.equal(f.media.size, 1); assert.equal(f.state.media.size, 0);
  assert.equal(f.nativeSnapshot(), before); assert.equal(f.changes(), changes); assert.deepEqual(f.mediaReads, []); assert.deepEqual(f.writes, []);
  const source = f.mediaSeed(); assert.equal(digest(source.bytes), STEREO_MP3_SHA256); assert.equal(source.metadata.sha256, STEREO_MP3_SHA256);
  assert.deepEqual(f.sqlite.prepare("PRAGMA foreign_key_check").all(), []);
});
