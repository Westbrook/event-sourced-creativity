import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { inspectOutputAsset, MAX_OUTPUT_ASSET_BYTES, validOutputAssetName } from "../src/model/output-asset-inspection.ts";
import { jpeg, join, mp3, mp4, png, pngChunk, presentationEntries, utf8, wav, zip } from "./output-asset-fixtures.mjs";
import { encodeShortStoryMarkdown, readShortStoryMarkdown } from "../src/model/short-story-markdown.ts";

const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const rejected = result => { assert.notEqual(result.status, "inspected"); assert.deepEqual(result.facts, {}); assert.ok(result.errors.length); };

test("byte detection overrides a misleading extension and derives an exact immutable hash", async () => {
  const bytes = png(), expected = digest(bytes), pending = inspectOutputAsset(bytes, "actually-a-png.mp3"); bytes[10] ^= 1;
  const result = await pending; assert.equal(result.status, "inspected"); assert.equal(result.kind, "image"); assert.equal(result.mimeType, "image/png"); assert.equal(result.sha256, expected); assert.deepEqual(result.facts, { width: 3, height: 2 });
  assert.match(result.limitations.join(" "), /does not grant acceptance/);
});
test("unknown bytes and unsupported image families never inherit their declared filename", async () => {
  for (const bytes of [utf8("not a PNG"), join(utf8("RIFF"), new Uint8Array(4), utf8("WEBP")), utf8("GIF89a0000")]) { const result = await inspectOutputAsset(bytes, "photo.png"); assert.equal(result.status, "unsupported"); rejected(result); assert.equal(result.sha256, digest(bytes)); }
});
test("empty and excessive files are rejected before hashing", async () => {
  for (const bytes of [new Uint8Array(), new Uint8Array(MAX_OUTPUT_ASSET_BYTES + 1)]) { const result = await inspectOutputAsset(bytes); rejected(result); assert.equal(result.sha256, null); }
});
test("names reject paths, reserved names, controls, directional overrides and ambiguous suffixes", async () => {
  for (const name of ["../slide.png", "a/b.png", "a\\b.png", "CON.png", ".hidden", "end.png.", "start.png ", "a\n.png", "a\u202e.png", "x".repeat(181)]) { assert.equal(validOutputAssetName(name), false, name); assert.deepEqual((await inspectOutputAsset(png(), name)).errors, ["unsafe_output_asset_name"]); }
  assert.equal(validOutputAssetName("Research résumé.png"), true);
});
test("PNG verifies CRC, complete scanline bytes, legal filters and exact IEND boundary", async () => {
  const corrupt = png(); corrupt[30] ^= 1;
  const badFilter = new Uint8Array(26); badFilter[0] = 5;
  for (const bytes of [corrupt, png({ raw: new Uint8Array(1) }), png({ raw: badFilter }), join(png(), utf8("foreign payload")), png().slice(0, -1)]) rejected(await inspectOutputAsset(bytes));
});
test("PNG explicitly refuses interlace, animation, unknown critical chunks and excessive decoded size", async () => {
  const animated = new Uint8Array(8); new DataView(animated.buffer).setUint32(0, 1);
  for (const bytes of [png({ interlace: 1 }), png({ extraChunks: [pngChunk("acTL", animated)] }), png({ extraChunks: [pngChunk("ABCD", new Uint8Array())] })]) assert.equal((await inspectOutputAsset(bytes)).status, "unsupported");
  rejected(await inspectOutputAsset(png({ width: 16384, height: 16384, raw: new Uint8Array(1) })));
});
test("baseline JPEG dimensions and EXIF orientation come from checked byte structures", async () => {
  const plain = await inspectOutputAsset(jpeg()); assert.equal(plain.status, "inspected"); assert.equal(plain.mimeType, "image/jpeg"); assert.equal(plain.facts.width, 1);
  const rotated = await inspectOutputAsset(jpeg({ width: 2, height: 1, orientation: 6 })); assert.equal(rotated.status, "inspected"); assert.equal(rotated.facts.width, 1); assert.equal(rotated.facts.height, 2); assert.equal(rotated.facts.codedWidth, 2);
  assert.match(rotated.limitations.join(" "), /not decoded/);
});
test("JPEG refuses truncated scans, impossible orientation and appended payloads", async () => {
  for (const bytes of [jpeg().slice(0, -2), jpeg({ orientation: 10 }), join(jpeg(), utf8("trailer")), Uint8Array.from([255, 216, 255, 217])]) rejected(await inspectOutputAsset(bytes));
});
test("WAV duration follows validated PCM sample bytes, not a self-reported field", async () => {
  const result = await inspectOutputAsset(wav({ samples: 4000, channels: 2 }), "episode.wav"); assert.equal(result.status, "inspected"); assert.equal(result.kind, "audio"); assert.equal(result.facts.durationSeconds, 0.5); assert.equal(result.facts.durationBasis, "pcm-samples"); assert.equal(result.facts.channels, 2); assert.equal(result.facts.sampleCount, 4000);
});
test("WAV rejects inconsistent byte rate, RIFF length, data alignment and unknown encodings", async () => {
  const wrongRate = wav(); new DataView(wrongRate.buffer).setUint32(28, 1, true);
  const wrongSize = wav(); new DataView(wrongSize.buffer).setUint32(4, 0, true);
  const wrongAlign = wav(); new DataView(wrongAlign.buffer).setUint16(32, 5, true);
  const codec = wav(); new DataView(codec.buffer).setUint16(20, 65534, true);
  for (const bytes of [wrongRate, wrongSize, wrongAlign, wav().slice(0, -1)]) rejected(await inspectOutputAsset(bytes));
  assert.equal((await inspectOutputAsset(codec)).status, "unsupported");
});
test("MP3 measures every contiguous frame and acknowledges encoder padding", async () => {
  for (const id3 of [false, true]) { const result = await inspectOutputAsset(mp3({ frames: 3, id3 })); assert.equal(result.status, "inspected"); assert.equal(result.facts.frameCount, 3); assert.equal(result.facts.durationSeconds, 3456 / 44100); assert.match(result.limitations.join(" "), /encoder delay\/padding/); }
});
test("MP3 cannot silently discard corrupt, truncated or trailing media", async () => {
  const bad = mp3(); bad[417] = 0;
  const clock = mp3(); clock[419] = 148;
  for (const bytes of [bad, clock, mp3({ frames: 1 }), mp3().slice(0, -1), join(mp3(), utf8("junk")), Uint8Array.from([73, 68, 51, 4, 0, 0, 127, 127, 127, 127])]) rejected(await inspectOutputAsset(bytes));
});
test("real AVC MP4 measures timeline, sample count and SPS-checked coded dimensions", async () => {
  const bytes = mp4(), result = await inspectOutputAsset(bytes, "clip.mov"); assert.equal(result.status, "inspected", result.errors.join(",")); assert.equal(result.mimeType, "video/mp4"); assert.equal(result.facts.width, 16); assert.equal(result.facts.height, 16); assert.equal(result.facts.frameCount, 2); assert.equal(result.facts.durationSeconds, 1); assert.equal(result.sha256, digest(bytes)); assert.match(result.limitations.join(" "), /full video\/audio decoding/);
});
test("MP4 rejects dimension lies, samples outside mdat and duration contradictions", async () => {
  const dimensions = mp4(); new DataView(dimensions.buffer).setUint16(Buffer.from(dimensions).indexOf("avc1", 40) + 28, 32);
  const samples = mp4(); new DataView(samples.buffer).setUint32(Buffer.from(samples).indexOf("stco") + 12, 0);
  const duration = mp4(); new DataView(duration.buffer).setUint32(Buffer.from(duration).indexOf("stts") + 16, 1);
  for (const bytes of [dimensions, samples, duration, mp4().slice(0, -1), join(mp4(), utf8("trailer"))]) rejected(await inspectOutputAsset(bytes));
});
test("MP4 reports unsupported fragmentation and unrecognized codecs instead of header success", async () => {
  const fragmented = mp4(); fragmented.set(utf8("moof"), Buffer.from(fragmented).indexOf("free"));
  const codec = mp4(); codec.set(utf8("hvc1"), Buffer.from(codec).indexOf("avc1", 40));
  for (const bytes of [fragmented, codec]) { const result = await inspectOutputAsset(bytes); assert.equal(result.status, "unsupported"); rejected(result); }
});
test("PPTX verifies stored and deflated packages and counts ordered slides, including hidden slides", async () => {
  for (const compressed of [false, true]) { const result = await inspectOutputAsset(zip(presentationEntries({ slides: 3, hidden: [2] }), { compressed }), "summary.pptx"); assert.equal(result.status, "inspected", result.errors.join(",")); assert.equal(result.kind, "presentation"); assert.equal(result.facts.slideCount, 3); assert.equal(result.facts.hiddenSlideCount, 1); assert.equal(result.facts.slideWidthEmu, 12192000); assert.equal(result.facts.width, undefined); }
});
test("PPTX slide count is not an archive filename count", async () => {
  const entries = presentationEntries(); const unused = presentationEntries({ slides: 3 }).find(entry => entry.name === "ppt/slides/slide3.xml"); entries.push(unused);
  const result = await inspectOutputAsset(zip(entries)); assert.equal(result.status, "inspected", result.errors.join(",")); assert.equal(result.facts.slideCount, 2);
});
test("PPTX accepts ordinary package thumbnail relationships", async () => {
  const entries = presentationEntries();
  entries[0].content = entries[0].content.replace("</Types>", '<Default Extension="jpeg" ContentType="image/jpeg"/></Types>');
  entries[1].content = entries[1].content.replace("</Relationships>", '<Relationship Id="thumbnail" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/thumbnail" Target="docProps/thumbnail.jpeg"/></Relationships>');
  entries.push({ name: "docProps/thumbnail.jpeg", content: jpeg() });
  const result = await inspectOutputAsset(zip(entries)); assert.equal(result.status, "inspected", result.errors.join(",")); assert.equal(result.facts.slideCount, 2);
});
test("PPTX rejects unsafe paths, case aliases, local/central mismatch and CRC corruption", async () => {
  const duplicate = [...presentationEntries(), { name: "ppt/slides/SLIDE1.xml", content: "<x/>" }];
  const traversed = [...presentationEntries(), { name: "../escape.xml", content: "<x/>" }];
  const backslash = [...presentationEntries(), { name: "ppt\\escape.xml", content: "<x/>" }];
  const corrupt = zip(presentationEntries()); corrupt[30 + "[Content_Types].xml".length] ^= 1;
  const localName = zip(presentationEntries()); localName[31] = 88;
  for (const bytes of [zip(duplicate), zip(traversed), zip(backslash), corrupt, localName]) rejected(await inspectOutputAsset(bytes));
});
test("PPTX enforces expansion bounds before attempting inflate", async () => {
  const bytes = zip(presentationEntries(), { compressed: true }), view = new DataView(bytes.buffer), central = view.getUint32(bytes.length - 6, true);
  view.setUint32(central + 24, MAX_OUTPUT_ASSET_BYTES, true); view.setUint32(22, MAX_OUTPUT_ASSET_BYTES, true);
  const result = await inspectOutputAsset(bytes); rejected(result); assert.match(result.errors[0], /expansion/);
});
test("PPTX rejects macros, executable embeddings, XML external entities and namespace spoofing", async () => {
  const macro = [...presentationEntries(), { name: "ppt/vbaProject.bin", content: utf8("macro") }];
  const embedding = [...presentationEntries(), { name: "ppt/embeddings/payload.xml", content: "<x/>" }];
  const entity = presentationEntries(); entity[2].content = '<!DOCTYPE p [<!ENTITY x SYSTEM "https://example.test/private">]>' + entity[2].content;
  const namespace = presentationEntries(); namespace[2].content = namespace[2].content.replace("presentationml/2006/main", "presentationml/evil/main");
  const contentType = presentationEntries(); contentType[0].content = contentType[0].content.replace("presentation.main+xml", "presentation.macroEnabled.main+xml");
  for (const bytes of [zip(macro), zip(embedding), zip(entity), zip(namespace), zip(contentType)]) rejected(await inspectOutputAsset(bytes));
});
test("PPTX relationships must resolve to real slide parts without duplicate target aliases", async () => {
  const missing = presentationEntries(); missing[3].content = missing[3].content.replace("slides/slide2.xml", "slides/missing.xml");
  const duplicate = presentationEntries(); duplicate[3].content = duplicate[3].content.replace("slides/slide2.xml", "slides/slide1.xml");
  const escaped = presentationEntries(); escaped[3].content = escaped[3].content.replace("slides/slide2.xml", "../../escape.xml");
  for (const entries of [missing, duplicate, escaped]) rejected(await inspectOutputAsset(zip(entries)));
});
test("PPTX refuses inline macro actions and ZIP symlinks even without a vbaProject filename", async () => {
  const action = presentationEntries(); action[4].content = action[4].content.replace("<p:grpSpPr/>", '<p:grpSpPr/><p:hlinkClick action="ppaction://%6dacro?name=Run"/>');
  const link = zip(presentationEntries()), view = new DataView(link.buffer), central = view.getUint32(link.length - 6, true); view.setUint32(central + 38, 0xa1ff0000, true);
  for (const bytes of [zip(action), link]) rejected(await inspectOutputAsset(bytes));
});
test("PPTX allows ordinary unfetched hyperlinks but refuses external media and executable protocols", async () => {
  const safe = await inspectOutputAsset(zip(presentationEntries({ external: { url: "https://example.test/evidence" } }))); assert.equal(safe.status, "inspected", safe.errors.join(",")); assert.equal(safe.facts.externalHyperlinkCount, 1);
  for (const external of [{ url: "javascript:alert(1)" }, { url: "file:///private/path" }, { url: "https://example.test/image.png", kind: "image" }]) rejected(await inspectOutputAsset(zip(presentationEntries({ external }))));
});
test("known-format truncations fail closed with no surviving partial facts", async () => {
  for (const original of [png(), jpeg(), wav(), mp3(), mp4(), zip(presentationEntries())]) {
    for (const end of [1, 4, 9, Math.floor(original.length / 2), original.length - 1]) rejected(await inspectOutputAsset(original.slice(0, end)));
  }
});
test("bounded deterministic malformed-byte mutations always return structured inspection results", async () => {
  let seed = 0x5eed1234;
  for (const source of [png(), jpeg(), wav(), mp3(), mp4(), zip(presentationEntries(), { compressed: true })]) {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const bytes = source.slice();
      for (let mutation = 0; mutation < 3; mutation += 1) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; bytes[seed % bytes.length] ^= (seed >>> 24) || 1; }
      const result = await inspectOutputAsset(bytes); assert.ok(["inspected", "unsupported", "invalid"].includes(result.status)); assert.equal(result.sha256, digest(bytes));
      if (result.status !== "inspected") rejected(result);
    }
  }
});

test("inspection exposes stable localized limitation codes without replacing authored content", async () => {
  const cases = [[png(), "output_png_visual_review_required"], [jpeg(), "output_jpeg_decode_review_required"], [wav(), "output_wav_listening_review_required"], [mp3(), "output_mp3_listening_review_required"], [mp4(), "output_mp4_playback_review_required"], [zip(presentationEntries()), "output_pptx_content_review_required"]];
  for (const [bytes, code] of cases) {
    const result = await inspectOutputAsset(bytes);
    assert.equal(result.status, "inspected", result.errors.join(","));
    assert.deepEqual(result.limitationCodes, ["output_inspection_not_acceptance", code]);
    assert.equal(result.limitations.length, 2);
  }
  for (const bytes of [new Uint8Array(), utf8("unsupported"), png().slice(0, -1)]) assert.deepEqual((await inspectOutputAsset(bytes)).limitationCodes, ["output_inspection_not_acceptance"]);
});


// These are pure encoding facts for supplied bytes, not native lineage,
// acceptance, retained-record correspondence or delivery evidence.
const markdownFailure = code => error => error instanceof Error && error.message === code;
const markdownEnvelope = () => utf8('{"content_markdown":"Retained envelope input","items":[]}');
const rereadMarkdown = (encoded, envelope, overrides = {}) => readShortStoryMarkdown(
  overrides.artifactId ?? "artifact-1", overrides.bytes ?? encoded.bytes,
  overrides.byteLength ?? encoded.inspection.byteLength, overrides.sha256 ?? encoded.inspection.sha256,
  overrides.envelope ?? envelope, overrides.envelopeSha256 ?? encoded.artifactJsonSha256,
);

test("Short story Markdown preserves complete Unicode, BOM, whitespace and newline bytes", async () => {
  const narratives = [
    "A complete story", "  A complete story  ", "A\rB", "A\nB\n", "A\r\nB\r\n",
    "\ufeffA complete story", "\ufeff\ufeffA complete story", "caf\u00e9", "cafe\u0301", "A \ud83e\udded story", "A\ufffdB",
  ];
  const hashes = new Map();
  for (const narrative of narratives) {
    const envelope = markdownEnvelope(), encoded = await encodeShortStoryMarkdown("artifact-1", narrative, envelope);
    assert.equal(encoded.name, "short-story-artifact-1.md");
    assert.equal(encoded.contentMarkdown, narrative); assert.deepEqual(encoded.bytes, utf8(narrative));
    assert.deepEqual({ profile: encoded.inspection.profile, kind: encoded.inspection.kind, mimeType: encoded.inspection.mimeType, extension: encoded.inspection.extension },
      { profile: "forma.short-story.markdown@1", kind: "document", mimeType: "text/markdown; charset=utf-8", extension: "md" });
    assert.equal(encoded.inspection.byteLength, utf8(narrative).length); assert.equal(encoded.inspection.sha256, digest(utf8(narrative)));
    assert.deepEqual(encoded.inspection.facts, { encoding: "utf-8" });
    assert.equal(encoded.artifactJsonByteLength, envelope.length); assert.equal(encoded.artifactJsonSha256, digest(envelope));
    const restored = await rereadMarkdown(encoded, envelope);
    assert.equal(restored.contentMarkdown, narrative); assert.deepEqual(restored.bytes, utf8(narrative));
    hashes.set(narrative, encoded.inspection.sha256);
  }
  assert.notEqual(hashes.get("caf\u00e9"), hashes.get("cafe\u0301"), "normalization forms remain distinct");
  assert.deepEqual([...utf8("\ufeffA").slice(0, 3)], [239, 187, 191], "authored BOM has explicit bytes");
});

test("Short story Markdown rejects blank text and lone UTF-16 surrogates without replacement", async () => {
  for (const value of ["", " \t\r\n ", "\ufeff", "\ufeff \r\n"]) {
    await assert.rejects(encodeShortStoryMarkdown("artifact-1", value, markdownEnvelope()), markdownFailure("short_story_markdown_blank"));
  }
  for (const value of ["\ud800", "\udc00", "A\ud800B", "A\udc00B", "\ud800\ud800"]) {
    await assert.rejects(encodeShortStoryMarkdown("artifact-1", value, markdownEnvelope()), markdownFailure("short_story_markdown_ill_formed_utf16"));
  }
  await assert.rejects(encodeShortStoryMarkdown("artifact-1", null, markdownEnvelope()), markdownFailure("short_story_markdown_invalid_text"));
});

test("Short story Markdown filename uses the literal safe artifact identity", async () => {
  const envelope = markdownEnvelope(), retained = await encodeShortStoryMarkdown("artifact-1", "Story", envelope);
  for (const id of ["artifact-1", "r\u00e9sum\u00e9-1", "artifact.part-1"]) {
    const result = await encodeShortStoryMarkdown(id, "Story", markdownEnvelope());
    assert.equal(result.name, `short-story-${id}.md`); assert.equal(validOutputAssetName(result.name), true);
  }
  for (const id of ["", " ", "../escape", "a/b", "a\\b", ".hidden", "CON", "a\n", "a\u202e", "cafe\u0301", "x".repeat(180), "\ud800", "\udc00", "artifact-\ud800"]) {
    await assert.rejects(encodeShortStoryMarkdown(id, "Story", markdownEnvelope()), markdownFailure("short_story_markdown_invalid_artifact_id"));
    await assert.rejects(rereadMarkdown(retained, envelope, { artifactId: id }), markdownFailure("short_story_markdown_invalid_artifact_id"));
  }
});

test("Short story Markdown narrative bound uses exact UTF-8 bytes for encoding and rereading", async () => {
  for (const narrative of ["A".repeat(512_000), "\ud83e\udded".repeat(512_000 / 4)]) {
    const envelope = markdownEnvelope(), encoded = await encodeShortStoryMarkdown("artifact-1", narrative, envelope);
    assert.equal(encoded.inspection.byteLength, 512_000);
    assert.equal((await rereadMarkdown(encoded, envelope)).contentMarkdown, narrative);
    await assert.rejects(encodeShortStoryMarkdown("artifact-1", narrative + "A", envelope), markdownFailure("short_story_markdown_too_large"));
    const excessive = utf8(narrative + "A");
    await assert.rejects(readShortStoryMarkdown("artifact-1", excessive, 512_000, digest(excessive), envelope, digest(envelope)), markdownFailure("short_story_markdown_too_large"));
  }
});

test("Short story Markdown supplied JSON-envelope budget has independent exact and overflow boundaries", async () => {
  const prefix = utf8('{"padding":"'), suffix = utf8('"}');
  const envelope = new Uint8Array(1_000_000).fill(32);
  envelope.set(prefix); envelope.set(suffix, envelope.length - suffix.length);
  const result = await encodeShortStoryMarkdown("artifact-1", "Story", envelope);
  assert.equal(result.artifactJsonByteLength, 1_000_000);
  assert.equal(result.artifactJsonSha256, digest(envelope));
  assert.equal((await rereadMarkdown(result, envelope)).contentMarkdown, "Story");
  const excessive = join(envelope, utf8(" "));
  await assert.rejects(encodeShortStoryMarkdown("artifact-1", "Story", excessive), markdownFailure("short_story_artifact_json_too_large"));
  await assert.rejects(readShortStoryMarkdown("artifact-1", result.bytes, result.bytes.length, result.inspection.sha256, excessive, digest(excessive)), markdownFailure("short_story_artifact_json_too_large"));
});

test("Short story Markdown rereading rejects malformed UTF-8 instead of replacing bytes", async () => {
  for (const values of [[255], [128], [192, 175], [237, 160, 128], [240, 159, 146], [244, 144, 128, 128]]) {
    const bytes = Uint8Array.from(values), envelope = markdownEnvelope();
    await assert.rejects(readShortStoryMarkdown("artifact-1", bytes, bytes.length, digest(bytes), envelope, digest(envelope)), markdownFailure("short_story_markdown_invalid_utf8"));
  }
});

test("Short story Markdown rereading requires exact length and file digest", async () => {
  const envelope = markdownEnvelope(), encoded = await encodeShortStoryMarkdown("artifact-1", "Byte proof", envelope);
  for (const length of [-1, 1.5, Number.NaN]) {
    await assert.rejects(readShortStoryMarkdown("artifact-1", encoded.bytes, length, encoded.inspection.sha256, envelope, encoded.artifactJsonSha256), markdownFailure("short_story_markdown_invalid_expected_length"));
  }
  await assert.rejects(rereadMarkdown(encoded, envelope, { byteLength: encoded.bytes.length + 1 }), markdownFailure("short_story_markdown_length_mismatch"));
  const changed = encoded.bytes.slice(); changed[0] = 67;
  await assert.rejects(rereadMarkdown(encoded, envelope, { bytes: changed }), markdownFailure("short_story_markdown_hash_mismatch"));
  await assert.rejects(rereadMarkdown(encoded, envelope, { sha256: "0".repeat(64) }), markdownFailure("short_story_markdown_hash_mismatch"));
  for (const hash of [null, "", "sha256:" + encoded.inspection.sha256]) {
    await assert.rejects(readShortStoryMarkdown("artifact-1", encoded.bytes, encoded.bytes.length, hash, envelope, encoded.artifactJsonSha256), markdownFailure("short_story_markdown_invalid_expected_hash"));
  }
});

test("Short story Markdown keeps the supplied JSON digest separate from the file digest", async () => {
  const envelope = markdownEnvelope(), encoded = await encodeShortStoryMarkdown("artifact-1", "Story", envelope);
  assert.notEqual(encoded.artifactJsonSha256, encoded.inspection.sha256);
  await assert.rejects(rereadMarkdown(encoded, envelope, { envelopeSha256: encoded.inspection.sha256 }), markdownFailure("short_story_artifact_json_hash_mismatch"));
  const changedEnvelope = envelope.slice(); changedEnvelope[1] = 32;
  await assert.rejects(rereadMarkdown(encoded, envelope, { envelope: changedEnvelope }), markdownFailure("short_story_artifact_json_hash_mismatch"));
  for (const hash of [null, "", "sha256:" + encoded.artifactJsonSha256]) {
    await assert.rejects(readShortStoryMarkdown("artifact-1", encoded.bytes, encoded.bytes.length, encoded.inspection.sha256, envelope, hash), markdownFailure("short_story_artifact_json_invalid_expected_hash"));
  }
});

test("Short story Markdown encoding snapshots the supplied envelope before asynchronous hashing", async t => {
  const nativeDigest = crypto.subtle.digest.bind(crypto.subtle);
  let release, calls = 0;
  const gate = new Promise(resolve => { release = resolve; });
  // Delay the real hash invocation so Web Crypto's own input copy cannot mask
  // a missing codec snapshot. No successful hash response is fabricated.
  t.mock.method(crypto.subtle, "digest", async (algorithm, data) => { calls++; await gate; return nativeDigest(algorithm, data); });
  t.after(() => release());
  const envelope = markdownEnvelope(), original = envelope.slice();
  const pending = encodeShortStoryMarkdown("artifact-1", "Story", envelope);
  t.after(async () => { release(); await pending.catch(() => {}); });
  assert.ok(calls > 0); envelope.fill(255); release();
  const encoded = await pending;
  assert.equal(encoded.artifactJsonSha256, digest(original)); assert.equal(encoded.artifactJsonByteLength, original.length);
  assert.deepEqual(encoded.bytes, utf8("Story"));
});

test("Short story Markdown rereading snapshots both byte views before asynchronous hashing", async t => {
  const envelope = markdownEnvelope(), encoded = await encodeShortStoryMarkdown("artifact-1", "Story", envelope);
  const backing = join(utf8("prefix"), encoded.bytes, utf8("suffix"));
  const view = backing.subarray(6, 6 + encoded.bytes.length), originalFile = view.slice(), originalEnvelope = envelope.slice();
  const nativeDigest = crypto.subtle.digest.bind(crypto.subtle);
  let release, calls = 0;
  const gate = new Promise(resolve => { release = resolve; });
  t.mock.method(crypto.subtle, "digest", async (algorithm, data) => { calls++; await gate; return nativeDigest(algorithm, data); });
  t.after(() => release());
  const pending = readShortStoryMarkdown("artifact-1", view, view.length, encoded.inspection.sha256, envelope, encoded.artifactJsonSha256);
  t.after(async () => { release(); await pending.catch(() => {}); });
  assert.ok(calls > 0); backing.fill(255); envelope.fill(255); release();
  const restored = await pending;
  assert.deepEqual(restored.bytes, originalFile); assert.equal(restored.contentMarkdown, "Story");
  assert.equal(restored.inspection.sha256, digest(originalFile)); assert.equal(restored.artifactJsonSha256, digest(originalEnvelope));
});

test("Short story Markdown refuses non-byte inputs without treating them as encoded content", async () => {
  const envelope = markdownEnvelope(), encoded = await encodeShortStoryMarkdown("artifact-1", "Story", envelope);
  await assert.rejects(encodeShortStoryMarkdown("artifact-1", "Story", []), markdownFailure("short_story_artifact_json_invalid_bytes"));
  await assert.rejects(readShortStoryMarkdown("artifact-1", [], encoded.bytes.length, encoded.inspection.sha256, envelope, encoded.artifactJsonSha256), markdownFailure("short_story_markdown_invalid_bytes"));
  await assert.rejects(readShortStoryMarkdown("artifact-1", encoded.bytes, encoded.bytes.length, encoded.inspection.sha256, [], encoded.artifactJsonSha256), markdownFailure("short_story_artifact_json_invalid_bytes"));
});

test("generic asset inspection still denies Markdown and forged native MIME or profile claims", async () => {
  const bytes = utf8("A complete short story.");
  for (const name of ["story.md", "story.png", "story.glb"]) {
    const result = await inspectOutputAsset(bytes, name, { mimeType: "text/markdown; charset=utf-8", profile: "forma.short-story.markdown@1", origin: "native", native: true });
    assert.equal(result.status, "unsupported"); rejected(result);
    assert.equal(result.kind, null); assert.equal(result.sha256, digest(bytes));
  }
});
