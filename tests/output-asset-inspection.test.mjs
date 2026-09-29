import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { inspectOutputAsset, MAX_OUTPUT_ASSET_BYTES, validOutputAssetName } from "../src/model/output-asset-inspection.ts";
import { jpeg, join, mp3, mp4, png, pngChunk, presentationEntries, utf8, wav, zip } from "./output-asset-fixtures.mjs";

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

test("explicit Markdown inspection preserves multilingual UTF-8, BOM and line-ending identities without inferring a screenplay", async () => {
  const prose = "# Harbor script — نص المشهد / 港の脚本\n\nMAYA: Café at dawn.\n\tThe boat waits. �\n";
  const variants = [utf8(prose), utf8(prose.replaceAll("\n", "\r\n")), join(Uint8Array.of(0xef, 0xbb, 0xbf), utf8(prose.replaceAll("\n", "\r\n")))];
  const hashes = new Set();
  for (const bytes of variants) {
    const original = bytes.slice(), result = await inspectOutputAsset(bytes, "Harbor script.MD");
    assert.equal(result.status, "inspected", result.errors.join(","));
    assert.equal(result.kind, "document"); assert.equal(result.mimeType, "text/markdown"); assert.equal(result.extension, "md");
    assert.equal(result.sha256, digest(original)); assert.equal(result.byteLength, original.length); assert.deepEqual(bytes, original);
    assert.deepEqual(result.facts, {}); assert.deepEqual(result.errors, []);
    assert.deepEqual(result.limitationCodes, ["output_inspection_not_acceptance", "output_markdown_content_review_required"]);
    assert.match(result.limitations.join(" "), /screenplay structure, completeness, source coverage, rights/);
    assert.match(result.limitations.join(" "), /no links or embedded media were fetched/);
    hashes.add(result.sha256);
  }
  assert.equal(hashes.size, 3, "BOM and CRLF remain distinct original byte identities");
});

test("text requires an explicit safe Markdown filename instead of inheriting a binary or missing suffix", async () => {
  const bytes = utf8("# Authored script\nA boat arrives.\n");
  for (const name of [undefined, "script", "script.txt", "script.markdown", "script.png", "script.md.png"]) {
    const result = await inspectOutputAsset(bytes, name);
    assert.equal(result.status, "unsupported"); assert.deepEqual(result.errors, ["output_asset_format_unsupported"]); assert.equal(result.sha256, digest(bytes));
  }
  for (const name of ["../script.md", "a/b.md", "a\\b.md", "CON.md", ".md", "script.md ", "script.md.", "script\u202e.md", "script\n.md"]) {
    const result = await inspectOutputAsset(bytes, name);
    assert.deepEqual(result.errors, ["unsafe_output_asset_name"]); assert.equal(result.sha256, null); rejected(result);
  }
});

test("Markdown rejects malformed UTF-8 instead of silently decoding replacement text", async () => {
  const malformed = [Uint8Array.of(0x80), Uint8Array.of(0xc0, 0xaf), Uint8Array.of(0xe2, 0x82), Uint8Array.of(0xed, 0xa0, 0x80), Uint8Array.of(0xf4, 0x90, 0x80, 0x80)];
  for (const suffix of malformed) {
    const bytes = join(utf8("# Script\n"), suffix), result = await inspectOutputAsset(bytes, "script.md");
    assert.equal(result.status, "invalid"); assert.deepEqual(result.errors, ["invalid_markdown_text"]); assert.equal(result.sha256, digest(bytes)); rejected(result);
  }
});

test("Markdown refuses blank and binary-control text while permitting ordinary text whitespace", async () => {
  for (const text of [" \t\r\n", "\u00a0\u2003", "\ufeff\r\n", ...[0, 1, 8, 11, 12, 14, 31, 127, 128, 133, 159].map(code => `# Script\nA${String.fromCharCode(code)}B`)]) {
    const bytes = utf8(text), result = await inspectOutputAsset(bytes, "script.md");
    assert.equal(result.status, "invalid"); assert.deepEqual(result.errors, ["invalid_markdown_text"]); assert.equal(result.sha256, digest(bytes)); rejected(result);
  }
  assert.equal((await inspectOutputAsset(utf8("# Script\r\n\tAn ordinary line.\rNext line.\n"), "script.md")).status, "inspected");
});

test("recognized binary and unsupported-format signatures outrank a Markdown filename", async () => {
  for (const bytes of [png(), jpeg(), wav(), mp3(), mp4(), zip(presentationEntries())]) {
    const original = await inspectOutputAsset(bytes), renamed = await inspectOutputAsset(bytes, "script.md");
    assert.equal(original.status, "inspected"); assert.deepEqual(renamed, original); assert.notEqual(renamed.kind, "document");
  }
  const unsupported = [utf8("GIF89a0000"), utf8("GIF87a0000"), join(utf8("RIFF"), new Uint8Array(4), utf8("WEBP")), utf8("%PDF-1.7\nnot a supported document format")];
  const invalid = [png().slice(0, -1), jpeg().slice(0, -2), wav().slice(0, -1), utf8("ID3"), utf8("glTF"), Uint8Array.of(80, 75, 3, 4)];
  for (const bytes of [...unsupported, ...invalid]) {
    const original = await inspectOutputAsset(bytes), renamed = await inspectOutputAsset(bytes, "script.md");
    rejected(original); assert.deepEqual(renamed, original, "renaming cannot weaken an existing binary refusal");
  }
});

test("Markdown inspection hashes and validates its entry snapshot through caller mutation", async () => {
  const bytes = utf8("# Original script\r\nThe boat waits.\r\n"), original = bytes.slice();
  const pending = inspectOutputAsset(bytes, "script.md"); bytes.fill(0);
  const result = await pending;
  assert.equal(result.status, "inspected"); assert.equal(result.sha256, digest(original)); assert.equal(result.byteLength, original.length);
  const invalid = utf8("# Script\nA\u0000B"), invalidHash = digest(invalid), rejectedPending = inspectOutputAsset(invalid, "script.md"); invalid.fill(65);
  const rejectedResult = await rejectedPending; assert.deepEqual(rejectedResult.errors, ["invalid_markdown_text"]); assert.equal(rejectedResult.sha256, invalidHash);
});

test("Markdown applies the existing 24 MB bound before attempting a hash", async t => {
  let hashCalls = 0;
  t.mock.method(crypto.subtle, "digest", () => { hashCalls += 1; throw new Error("oversize bytes must not reach the hash function"); });
  const result = await inspectOutputAsset(new Uint8Array(MAX_OUTPUT_ASSET_BYTES + 1), "script.md");
  assert.deepEqual(result.errors, ["output_asset_too_large"]); assert.equal(result.sha256, null); assert.equal(hashCalls, 0);
});
