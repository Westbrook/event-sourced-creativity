import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createOfficeArchive, createPowerPointDocument } from "../src/model/office-documents.ts";
import { defaultSlidePresentation } from "../src/model/document-artifacts.ts";
import { inspectOutputAsset } from "../src/model/output-asset-inspection.ts";
import { createOutputDeliveryArchive, MAX_OUTPUT_DELIVERY_PAYLOAD_BYTES } from "../src/model/output-delivery-archive.ts";
import { mp4, png, presentationEntries, readStoredZip, utf8, wav, zip } from "./output-asset-fixtures.mjs";

const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const file = (id, bytes = png(), name = `${id}.png`) => ({ id, bytes, name, expectedSha256: digest(bytes) });
const plan = files => ({ schemaVersion: 1, planId: "plan-1", planRevision: "revision-1", createdAt: "2026-08-27T12:00:00.000Z", targets: files.map((file, index) => ({ targetId: `target-${index + 1}`, fileId: file.id, acceptanceId: `acceptance-${index + 1}` })) });

test("delivery ZIP contains exact adopted files plus a JSON/CSV inventory, not metadata placeholders", async () => {
  const files = [file("summary", zip(presentationEntries()), "executive-summary.pptx"), file("episode", wav(), "episode.wav"), file("part-one", mp4(), "part-one.mp4"), file("cover", png(), "cover.png")];
  const result = await createOutputDeliveryArchive(files, plan(files)); assert.equal(result.mimeType, "application/zip"); assert.equal(result.sha256, digest(result.bytes)); assert.ok(result.bytes.length <= MAX_OUTPUT_DELIVERY_PAYLOAD_BYTES);
  const entries = readStoredZip(result.bytes); assert.equal(entries.size, 6);
  const manifest = JSON.parse(new TextDecoder().decode(entries.get("manifest.json"))); assert.equal(manifest.format, "forma-output-delivery"); assert.deepEqual(manifest.targets, plan(files).targets); assert.equal(manifest.files.length, 4);
  for (const delivered of manifest.files) { const original = files.find(file => file.id === delivered.id); assert.deepEqual(entries.get(delivered.path), original.bytes); assert.equal(delivered.sha256, digest(entries.get(delivered.path))); assert.equal(delivered.byteLength, original.bytes.length); }
  assert.equal(manifest.files[0].facts.slideCount, 2); assert.equal(manifest.files[1].facts.durationSeconds, 0.5); assert.equal(manifest.files[2].facts.frameCount, 2);
  assert.match(new TextDecoder().decode(entries.get("manifest.csv")), /"record_type","delivery_status","inventory_complete"/); assert.match(manifest.validationScope, /separately verifies/);
  assert.equal(manifest.deliveryStatus, "unknown", "a list of accepted files cannot establish the complete assignment scope");
});
test("delivery packages the snapshot that was actually hashed despite caller mutation", async () => {
  const original = png(), expected = original.slice(), files = [file("cover", original)], manifest = plan(files);
  const pending = createOutputDeliveryArchive(files, manifest); original[20] ^= 1; files[0].name = "replacement.png"; manifest.targets[0].targetId = "replacement";
  const result = await pending, entries = readStoredZip(result.bytes); assert.deepEqual(entries.get("files/cover.png"), expected); assert.equal(result.manifest.files[0].name, "cover.png"); assert.equal(result.manifest.targets[0].targetId, "target-1");
});
test("canonical detected extensions and IDs prevent user-controlled paths and MIME aliases", async () => {
  const files = [file("cover", png(), "not-really-an-episode.mp3")]; const result = await createOutputDeliveryArchive(files, plan(files));
  assert.equal(result.manifest.files[0].path, "files/cover.png"); assert.equal(result.manifest.files[0].mimeType, "image/png");
  for (const id of ["../cover", "a/b", "a\\b", ".hidden", "bad:stream", "CON", "com1", "x".repeat(65)]) { const bad = [{ ...files[0], id }]; await assert.rejects(createOutputDeliveryArchive(bad, plan(bad)), /unsafe_or_duplicate_output_file_id|invalid_output_delivery_target/); }
});
test("manifest CSV neutralizes formula injection without changing original JSON names", async () => {
  const files = [file("cover", png(), "=SUM(1+1).png")]; const result = await createOutputDeliveryArchive(files, plan(files));
  const csv = new TextDecoder().decode(readStoredZip(result.bytes).get("manifest.csv")); assert.ok(csv.includes('"\'=SUM(1+1).png"')); assert.equal(result.manifest.files[0].name, "=SUM(1+1).png");
});
test("delivery refuses changed bytes, unsupported bytes and invented expected hashes", async () => {
  const changed = file("cover"); changed.bytes[30] ^= 1;
  const unknown = file("unknown", utf8("not a real media file"), "cover.png");
  const malformedHash = { ...file("cover"), expectedSha256: "self-reported" };
  await assert.rejects(createOutputDeliveryArchive([changed], plan([changed])), /hash_mismatch/);
  await assert.rejects(createOutputDeliveryArchive([unknown], plan([unknown])), /file_inspection_failed/);
  await assert.rejects(createOutputDeliveryArchive([malformedHash], plan([malformedHash])), /expected_hash/);
});
test("delivery rejects filename aliases, duplicate byte copies and unmapped or missing files", async () => {
  const first = file("cover"), alias = file("COVER", wav(), "audio.wav"), duplicate = file("duplicate");
  await assert.rejects(createOutputDeliveryArchive([first, alias], plan([first, alias])), /duplicate_output_file_id/);
  await assert.rejects(createOutputDeliveryArchive([first, duplicate], plan([first, duplicate])), /duplicate_output_delivery_file_bytes/);
  const missing = plan([first]); missing.targets[0].fileId = "missing"; await assert.rejects(createOutputDeliveryArchive([first], missing), /mapping_mismatch/);
  const second = file("episode", wav(), "episode.wav"); await assert.rejects(createOutputDeliveryArchive([first, second], plan([first])), /mapping_mismatch/);
});
test("one exact file can map to multiple accepted targets without duplicate archive entries", async () => {
  const files = [file("cover")], manifest = plan(files); manifest.targets.push({ targetId: "target-2", fileId: "cover", acceptanceId: "acceptance-2" });
  const result = await createOutputDeliveryArchive(files, manifest); assert.equal(result.manifest.files.length, 1); assert.equal(result.manifest.targets.length, 2); assert.equal(readStoredZip(result.bytes).size, 3);
});
test("delivery bounds file/target counts, plan identity, creation time and aggregate bytes", async () => {
  const files = [file("cover")];
  await assert.rejects(createOutputDeliveryArchive([], plan([])), /file_count/);
  for (const overrides of [{ schemaVersion: 0 }, { planId: "../plan" }, { createdAt: "2026-99-99T12:00:00.000Z" }, { targets: [] }]) await assert.rejects(createOutputDeliveryArchive(files, { ...plan(files), ...overrides }));
  const duplicateTargets = plan(files); duplicateTargets.targets.push({ ...duplicateTargets.targets[0] }); await assert.rejects(createOutputDeliveryArchive(files, duplicateTargets), /duplicate_output_delivery_target/);
  const large = [0, 1].map(index => ({ id: `big-${index}`, name: `big-${index}.wav`, expectedSha256: "0".repeat(64), bytes: new Uint8Array(17 * 1024 * 1024) }));
  await assert.rejects(createOutputDeliveryArchive(large, plan(large)), /archive_too_large/);
});
test("existing Forma ZIP writer creates compatible inspectable package bytes", async () => {
  const bytes = createOfficeArchive(presentationEntries()); const result = await inspectOutputAsset(bytes, "summary.pptx"); assert.equal(result.status, "inspected", result.errors.join(",")); assert.equal(result.facts.slideCount, 2);
});
test("real existing Forma PowerPoint export remains inspectable without changing exporter source", async () => {
  const items = [{ title: "One reviewed finding", body: "Verified source statement", notes: "", image_prompt: "", slide: null }];
  const bytes = createPowerPointDocument(items, defaultSlidePresentation(), { title: "Approved research" });
  const result = await inspectOutputAsset(bytes, "forma-export.pptx"); assert.equal(result.status, "inspected", result.errors.join(",")); assert.equal(result.facts.slideCount, 1);
});
