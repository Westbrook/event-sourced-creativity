import test from 'node:test';
import assert from 'node:assert/strict';
import { scenePreflightFixture } from './helpers/scene-output-fixture.mjs';
import { outputScenePreflightConfiguration } from '../worker/output-scene-preflight-contract.ts';
import { captureOutputSceneRequest } from '../worker/output-scene-request.ts';
import { assertOutputSceneAttempt } from '../worker/output-scene-execution.ts';

async function fixture() {
  const payload = await scenePreflightFixture(), { contract, intake } = payload.outputScene;
  const preflight = await outputScenePreflightConfiguration('target-1', payload, Date.parse('2026-09-13T04:00:00.000Z'));
  const safetyIdentifier = 'forma_' + 'a'.repeat(32), clientRequestId = 'forma-scene-00000000-0000-4000-8000-000000000001';
  const requestBody = JSON.stringify({ model: contract.model, instructions: contract.instructions, input: contract.input,
    text: { verbosity: 'medium', format: { type: 'json_schema', name: 'document_scene', strict: true, schema: contract.responseSchema } },
    reasoning: { effort: contract.reasoningEffort }, max_output_tokens: contract.maximumOutputTokens, store: false,
    safety_identifier: safetyIdentifier, service_tier: 'default', prompt_cache_options: { mode: 'explicit' } });
  const captured = await captureOutputSceneRequest({ contract, intake, body: requestBody, clientRequestId, safetyIdentifier });
  return { settings: structuredClone(preflight.settings), attempt: { ...captured.attempt, scene: { contract, intake, requestBody } } };
}

test('Scene dispatch guard accepts only the original exact one-call request and route', async () => {
  const f = await fixture(); await assertOutputSceneAttempt(f.settings, f.attempt);
  for (const change of [
    x => { x.attempt.requestDigest = 'f'.repeat(64); },
    x => { x.attempt.maximumInputTokens += 1; },
    x => { x.attempt.logicalCallKey = 'planning:0:repair'; },
    x => { x.attempt.scene.requestBody = x.attempt.scene.requestBody.replace('"store":false', '"store":true'); },
    x => { x.attempt.scene.intake.values.location.value = 'Changed source'; },
    x => { x.settings.calls.push({ ...x.settings.calls[0] }); },
    x => { x.settings.calls[0].maximumMicrousd += 1; },
    x => { delete x.attempt.scene; },
  ]) {
    const changed = structuredClone(f); change(changed);
    await assert.rejects(() => assertOutputSceneAttempt(changed.settings, changed.attempt));
  }
});
