import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { scenePreflightFixture } from './helpers/scene-output-fixture.mjs';
import { prepareOutputSceneAdapter, generateOutputSceneArtifact } from '../worker/output-scene-adapter.ts';
import { verifyOutputSceneCompletion, outputScenePlannerCost, readOutputSceneArtifact } from '../worker/output-scene-completion.ts';
import { sceneContentSha256 } from '../worker/output-scene-completion.ts';
import { captureExperienceSceneEvidence, readExperienceNativeScene } from '../src/experiences/scene-native-result.ts';

// Local supplied-response composition, never a DB/provider/job acceptance test.
async function fixture(action = 'A hand rests against the door.') {
  const payload = await scenePreflightFixture(), { intake, contract, costPreview } = payload.outputScene;
  const screenplay = { schemaVersion: 1, format: 'forma-screenplay@1', heading: { setting: 'INT.', location: 'location', time: 'NIGHT' }, blocks: [
    { kind: 'action', text: action }, { kind: 'dialogue', speaker: 'A', parenthetical: null, text: 'Stay.' },
    { kind: 'dialogue', speaker: 'B', parenthetical: null, text: 'I have to go.' }] };
  const response = { id: 'fixture-response', model: contract.model, status: 'completed', incomplete_details: null,
    output: [{ id: 'fixture-message', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify({ title: 'The door', summary: 'Two intentions meet.', screenplay }) }] }],
    usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 } };
  const reference = { scopeKey: 'scope', grantId: 'grant', slotId: 'slot', planRevisionId: 'plan', targetId: 'target', targetContractDigest: 'digest', sourceDigest: 'source' };
  let envelope, dispatches = 0;
  const checkpoint = { providerSubmissions: {} };
  const selection = await prepareOutputSceneAdapter({ intake, contract, retainEnvelope: async received => {
    envelope = { version: 'output-scene-envelope-v1', jobId: costPreview.requestId, documentId: costPreview.documentId,
      actorUserId: costPreview.actorUserId, outputExecution: structuredClone(reference), sceneCostBindingHash: costPreview.bindingHash, ...received };
    return { responseRef: 'fixture-private-response' };
  } });
  const generated = await generateOutputSceneArtifact(selection, contract.input, 'forma_' + 'a'.repeat(32), {
    onBeforeProviderAttempt() {}, onBeforeProviderDispatch() {}, onProviderSubmission(call) { checkpoint.providerSubmissions[call.clientRequestId] = call; },
  }, async () => { dispatches++; return new Response(JSON.stringify(response)); });
  const bytes = await readFile(new URL('../public/fonts/dm-mono/DMMono-Regular-55b4c98f.ttf', import.meta.url));
  const font = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return { payload, generated, checkpoint, envelope, reference, font, dispatches,
    run: () => verifyOutputSceneCompletion(payload, generated.output, generated.inputReceipt, checkpoint, JSON.stringify(envelope), reference, font) };
}

test('Scene completion recomputes original structure, measured cost and fixed-font layout without another call', async () => {
  const f = await fixture(), result = await f.run();
  assert.equal(f.dispatches, 1); assert.equal(result.receipt.validation.requirement_fulfilled, true);
  assert.equal(result.receipt.scene_layout.pageCount, 1); assert.equal(result.receipt.scene_layout.status, 'qualified');
  assert.deepEqual(readOutputSceneArtifact(f.generated.output), f.generated.output);
  assert.ok(outputScenePlannerCost(f.checkpoint, f.payload).totalMicrousd > 0);
  const original = structuredClone(f.envelope.outputExecution); f.envelope.outputExecution.slotId = 'other-slot';
  await assert.rejects(f.run); f.envelope.outputExecution = original;
  f.generated.output.content_markdown += 'Changed'; await assert.rejects(f.run);
});

test('Scene completion retains literal unsupported text and refuses missing own financial evidence', async () => {
  const f = await fixture('日本語の動作。'), result = await f.run();
  assert.equal(result.receipt.validation.requirement_fulfilled, false); assert.equal(result.receipt.scene_layout.status, 'unqualified');
  assert.match(f.generated.output.content_markdown, /日本語/); assert.equal(f.dispatches, 1);
  const id = Object.keys(f.checkpoint.providerSubmissions)[0];
  f.checkpoint.providerSubmissions[id] = { ...f.checkpoint.providerSubmissions[id], costMicrousd: undefined };
  assert.throws(() => outputScenePlannerCost(f.checkpoint, f.payload), /cost_evidence_missing/); await assert.rejects(f.run);
});

test('actual adapter and completion receipts compose with the private Scene client reader', async () => {
  // Supplied transport response, not live provider/admission evidence. Unlike
  // parser fixtures, all planner calls, hashes and layout fields below come
  // from the production adapter and completion verifier.
  for (const action of ['A hand rests against the door.', '日本語の動作。']) {
    const f = await fixture(action), completed = await f.run();
    const { contract, sceneContract, costPreview } = f.payload.outputScene;
    const responseId = completed.receipt.validation.provider_response_ids[0];
    const raw = JSON.stringify(f.generated.output);
    const rawInput = JSON.stringify({ schema_version: 1, artifact_id: 'composed-artifact', artifact_kind: 'scene',
      document_id: costPreview.documentId, project_id: costPreview.projectId,
      request: { item_count: 1, production_mode: 'manual', source_surface: 'outputs' },
      planner: { provider: 'openai', model: contract.model, response_id: responseId, ...completed.inputReceipt } });
    const settings = { ...completed.receipt, scene_content_sha256: await sceneContentSha256(raw),
      scene_input_sha256: await sceneContentSha256(rawInput) };
    const source = JSON.parse(contract.input).scene_intent;
    const expected = { documentId: costPreview.documentId, projectId: costPreview.projectId, artifactId: 'composed-artifact',
      providerResponseId: responseId, source: sceneContract.source, costPreview, expiresAt: costPreview.expiresAt,
      displaySource: { characters: source.characters.map(c => ({ id: c.id, name: c.name.value })), location: source.location.value } };
    const evidence = captureExperienceSceneEvidence(settings);
    assert.ok(evidence);
    const result = await readExperienceNativeScene(raw, rawInput, evidence, expected, Date.parse(costPreview.expiresAt) - 1000);
    assert.ok(result, 'production completion metadata must be readable by the client');
    assert.equal(result.content.body, f.generated.output.content_markdown);
    assert.equal(result.layout.status, completed.receipt.scene_layout.status);
    assert.equal(result.content.selection.revision, 0);
    assert.equal(f.dispatches, 1);
    assert.equal(await readExperienceNativeScene(raw, rawInput + ' ', evidence, expected, Date.parse(costPreview.expiresAt) - 1000), null);
  }
});
