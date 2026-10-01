import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { outputAvailabilityMessage, outputSourceCapacityMessage } from "../src/experiences/output-availability-message.ts";
import { unavailableBinding } from "../src/experiences/output-binding-client.ts";
import type { ExperienceNativeState } from "../src/experiences/output-binding-contract.ts";
import { FORMA_OUTPUT_DELIVERY_RUNTIME_MESSAGES as messages } from "../src/components/design-system/locales/output-delivery-runtime-messages.ts";

function state(code = "output_scene_original_expired") {
  return { status: "unavailable", disposition: "prepared", original: null, grant: null,
    preflight: { targets: [{ available: false, reasonCode: code, reason: "PRIVATE BODY", reasonValues: { secret: "PRIVATE BODY" } }] },
  } as unknown as ExperienceNativeState;
}

test("every Scene preflight refusal has fixed four-locale copy without response prose", () => {
  const source = readFileSync(new URL("../worker/output-scene-preflight.ts", import.meta.url), "utf8");
  const codes = [...source.matchAll(/unavailable\(target.id, "([^"]+)"\)/gu)].map(match => match[1]!);
  assert.equal(new Set(codes).size, 7);
  for (const code of codes) {
    const value = state(code), before = JSON.stringify(value), result = outputAvailabilityMessage(value)!;
    assert.equal(result.known, true, code); assert.deepEqual(result.values, {});
    for (const catalog of Object.values(messages)) {
      assert.ok(catalog[result.id].length > 20); assert.ok(!catalog[result.id].includes("PRIVATE BODY"));
    }
    assert.equal(JSON.stringify(value), before);
  }
});

test("unknown and parameterized reason codes fail closed without exposing raw values", () => {
  const unknown = outputAvailabilityMessage(state("PRIVATE BODY"))!;
  assert.equal(unknown.known, false); assert.equal(unknown.id, "output.delivery.message.unknown");
  assert.deepEqual(unknown.values, {});
  const value = state("model3d_prompt_too_long");
  assert.equal(outputAvailabilityMessage(value)!.known, false);
});

test("only one unavailable saved preparation receives a reason; original outcomes never do", () => {
  for (const status of ["review", "authorized", "running", "uncertain", "failed", "succeeded"] as const) {
    const value = state(); value.status = status; assert.equal(outputAvailabilityMessage(value), null);
  }
  for (const change of [
    (value: ExperienceNativeState) => { value.disposition = "original_run_recorded"; },
    (value: ExperienceNativeState) => { value.original = {} as NonNullable<ExperienceNativeState["original"]>; },
    (value: ExperienceNativeState) => { value.grant = {} as NonNullable<ExperienceNativeState["grant"]>; },
    (value: ExperienceNativeState) => { value.preflight = null; },
    (value: ExperienceNativeState) => { value.preflight!.targets = []; },
    (value: ExperienceNativeState) => { value.preflight!.targets.push(value.preflight!.targets[0]!); },
    (value: ExperienceNativeState) => { value.preflight!.targets[0]!.available = true; },
  ]) { const value = state(); change(value); assert.equal(outputAvailabilityMessage(value), null); }
});

test("host renders registered localized text inline without raw reason or new actions", () => {
  const source = readFileSync(new URL("../src/components/forma-experience-host.ts", import.meta.url), "utf8");
  const summary = source.slice(source.indexOf("  #termsSummary("), source.indexOf("  #renderSponsor()"));
  assert.match(summary, /outputAvailabilityMessage\(state\)/u);
  assert.match(summary, /<p data-experience-availability-reason dir="auto">/u);
  assert.match(summary, /this.i18n.t\(availability.id, FORMA_OUTPUT_DELIVERY_RUNTIME_MESSAGES.en\[availability.id\], availability.values\)/u);
  assert.doesNotMatch(summary, /reasonValues|\.reason\b|unsafeHTML|<button|\.request\(/u);
});

test("known complete-source capacity refusal is explained without admitting work or claiming original outcomes", () => {
  for (const code of ["output_source_proof_too_large", "output_source_governance_proof_too_large"]) {
    const value = unavailableBinding(code), before = JSON.stringify(value), result = outputSourceCapacityMessage(value)!;
    assert.equal(result.known, true); assert.deepEqual(result.values, {});
    for (const catalog of Object.values(messages)) assert.ok(catalog[result.id].length > 30);
    assert.equal(JSON.stringify(value), before); assert.ok(Object.values(value.permitted).every(v => v === false));
  }
  for (const code of ["submission_unconfirmed", "original_unavailable", "PRIVATE BODY", "output_scene_original_expired"])
    assert.equal(outputSourceCapacityMessage(unavailableBinding(code)), null);
  assert.equal(outputSourceCapacityMessage(state()), null);
  const malformed = {...unavailableBinding("output_source_proof_too_large"), permitted:{prepare:true}};
  assert.equal(outputSourceCapacityMessage(malformed as never), null);
  const source = readFileSync(new URL("../src/components/forma-experience-host.ts", import.meta.url), "utf8");
  assert.match(source, /outputSourceCapacityMessage\(response\) \|\| outputCommandRefusal\(response\) \? this.i18n.system\("Original unavailable"\)/u);
  assert.match(source, /available && binding \? outputSourceCapacityMessage\(binding.client.state\) : null/u);
  assert.match(source, /data-experience-source-capacity dir="auto"/u);
  assert.match(source, /this.i18n.t\(sourceCapacity.id, FORMA_OUTPUT_DELIVERY_RUNTIME_MESSAGES.en\[sourceCapacity.id\], sourceCapacity.values\)/u);
});
