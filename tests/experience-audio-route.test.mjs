import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { resolveServerRoute } from "../src/platform/applications.ts";
import { isStandaloneExperienceRoute, parseExperienceHostRoute } from "../src/experiences/host-route.ts";
import { registeredExperience, parseExperienceEntryRoute, isExperienceContextOutput } from "../src/experiences/intake.ts";
import { EXPERIENCE_AUDIO_INTENT } from "../src/experiences/contracts.ts";
import { selectAudioAdapter } from "../worker/audio-selection.ts";
import { audioDurationMetadata } from "../src/model/audio.ts";

test("Actual server resolver selects Audio intake HTML and keeps retained Audio navigation separate", () => {
  const expected = { application: "creative", entryPath: "/experiences", canonicalFamily: "/experiences/audio" };
  const draft = "experience-draft-" + "a".repeat(64);
  for (const route of ["/experiences/audio", "/experiences/audio/", "/experiences/audio?progress-report", "/experiences/audio?draft=" + draft]) {
    assert.deepEqual(resolveServerRoute(route), expected);
    assert.equal(isStandaloneExperienceRoute(route), true);
    assert.equal(parseExperienceEntryRoute(new URL(route, "https://forma.test")).output, "audio");
  }
  assert.equal(isExperienceContextOutput("audio"), true);
  assert.equal(isExperienceContextOutput("Audio"), false);
  assert.deepEqual(resolveServerRoute("/make/audio"), { application: "creative", entryPath: "/creative/", canonicalFamily: "/make/audio" });
  assert.equal(parseExperienceHostRoute("/document/original/audio?experience=audio&experience-draft=" + draft), null);
  for (const path of ["/experiences/audio/native", "/experiences/audio-provider", "/native/audio"]) {
    assert.equal(resolveServerRoute(path), null);
    assert.equal(isStandaloneExperienceRoute(path), false);
  }
});

test("Audio entry selectors reject malformed or widened recovery instead of changing intent", () => {
  const draft = "experience-draft-" + "b".repeat(64);
  for (const suffix of [
    "?draft=bad", "?draft=" + draft + "&draft=" + draft,
    "?draft=" + draft + "&intent=00000000-0000-4000-8000-000000000020",
    "?audioProfile=instrumental", "?duration=20", "#generated",
  ]) assert.equal(parseExperienceEntryRoute(new URL("/experiences/audio" + suffix, "https://forma.test")), null);
  assert.equal(isStandaloneExperienceRoute("/experiences/audio#generated"), false);
});

test("Planned intent maps to the existing timed instrumental selector without making measured-duration claims", () => {
  // Pure existing selection functions only: no request, credentials, admission or provider.
  const selection = selectAudioAdapter({}, EXPERIENCE_AUDIO_INTENT);
  assert.equal(selection.model, "fal-ai/stable-audio-3/medium/text-to-audio");
  assert.equal(selection.profile.durationSeconds, 20);
  assert.equal(selection.profile.requireInstrumental, true);
  assert.equal(selection.profile.goal, "timed_music");
  assert.equal(selection.profile.transcript, undefined);
  assert.equal(selection.contract.supportsExactDuration, true);
  const timing = audioDurationMetadata({}, 20);
  assert.equal(timing.duration_basis, "estimate");
  assert.notEqual(timing.measured_duration_seconds, 20);
});

test("Actual Audio preview branch renders authored text and planned intent without a player or completed media", async () => {
  const source = readFileSync(new URL("../src/experiences/view.ts", import.meta.url), "utf8");
  const start = source.indexOf("  #preview() {"), summary = source.indexOf("  #summary() {", start), end = source.indexOf("  #review =", summary);
  assert.ok(start >= 0 && summary > start && end > summary);
  const methods = stripTypeScriptTypes(source.slice(start, end)
    .replace("  #preview() {", "  function preview() {").replace("  #summary() {", "  function summary() {").replaceAll("this.#", "this."));
  const makeNode = (tag, text = "", className = "") => ({
    tag, text, className, children: [], append(...nodes) { this.children.push(...nodes); },
    replaceChildren(...nodes) { this.children = nodes; },
  });
  const { preview, summary: renderSummary } = new Function("el", methods + "; return {preview,summary};")(makeNode);
  const release = await registeredExperience("audio");
  const literal = "<audio src='https://example.test/foreign.mp3'>literal direction</audio>";
  const context = { runtime: { release, state: { draft: { values: {
    direction: { value: literal, provenance: "authored" }, detail: { value: "", provenance: "default" },
  } } } }, stage: makeNode("section"), summary: renderSummary, describe: entry => entry.value };
  preview.call(context);
  const nodes = []; const walk = node => { nodes.push(node); node.children.forEach(walk); }; walk(context.stage);
  assert.ok(nodes.some(node => node.tag === "dd" && node.text === literal));
  assert.ok(nodes.some(node => node.text === "No audio generated"));
  assert.ok(nodes.some(node => node.text.includes("not a measured recording")));
  assert.equal(nodes.some(node => ["audio", "source", "canvas", "img"].includes(node.tag)), false);
});
