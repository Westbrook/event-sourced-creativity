import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { initialValues, registeredExperience } from '../src/experiences/intake.ts';
import { createExperienceSceneAdapterRequest } from '../worker/experience-scene-adapter-contract.ts';
import { createOutputSceneRequestContract, captureOutputSceneRequest, inspectOutputSceneResponse } from '../worker/output-scene-request.ts';

// Unadmitted synthetic metadata and response bytes, never a real provider/job.
const release = await registeredExperience('scene');
const intake = () => ({ intentId: '00000000-0000-4000-8000-000000000093', experienceId: 'scene', releaseHash: release.releaseHash,
  values: { ...initialValues(release), ...Object.fromEntries(Object.entries({ characterA: 'Alex', characterB: 'Alex', goalA: 'Stay', goalB: 'Leave',
    secret: 'The key is outside', location: 'Waiting room' }).map(([key, value]) => [key, { value, provenance: 'authored' }])) } });
const configuration = { medium: 'visual', source: 'manual', target_format: null, downstream_formats: [], alternate_medium: 'audio',
  context_continuity: 'same-authored-narrative-context', alternate_rendering: { medium: 'audio', preserve_authored_context: true } };
const wire = (contract, safetyIdentifier) => JSON.stringify({ model: contract.model, instructions: contract.instructions, input: contract.input,
  text: { verbosity: 'medium', format: { type: 'json_schema', name: 'document_scene', strict: true, schema: contract.responseSchema } },
  reasoning: { effort: contract.reasoningEffort }, max_output_tokens: contract.maximumOutputTokens, store: false,
  safety_identifier: safetyIdentifier, service_tier: 'default', prompt_cache_options: { mode: 'explicit' } });
async function original(extra = '', cap = 30000) {
  const source = intake(), adapter = await createExperienceSceneAdapterRequest(source);
  const input = { document_title: 'The door', creative_context: { facts: [{ context_key: 'c1', text: 'A closed door. ' + extra }] },
    combined_context_plan: [], audience: 'general', tone: 'derived from the document', scene_configuration: configuration,
    scene_intent: JSON.parse(adapter.input), output_requirements: { instructions: 'Preserve the locked door.', source_evidence: false } };
  const contract = await createOutputSceneRequestContract(source, input, cap), safetyIdentifier = 'forma_' + 'a'.repeat(32);
  return { contract, intake: source, body: wire(contract, safetyIdentifier), clientRequestId: 'forma-scene-00000000-0000-4000-8000-000000000001', safetyIdentifier };
}
const envelope = () => ({ id: 'unadmitted-response', model: 'gpt-5.6-terra', status: 'completed', incomplete_details: null,
  output: [{ id: 'unadmitted-message', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: '{"title":"Unvalidated content"}' }] }],
  usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 } });
const hash = value => createHash('sha256').update(value).digest('hex');

test('Scene captures full compiled input and exact wire bytes, including context beyond intake-definition string limits', async () => {
  const request = await original('x'.repeat(9000)), captured = await captureOutputSceneRequest(request);
  assert.equal(captured.body, request.body); assert.equal(captured.attempt.requestDigest, hash(request.body));
  assert.equal(captured.contract.compiledInputSha256, hash(captured.contract.input));
  assert.equal(captured.attempt.maximumInputTokens, Buffer.byteLength(request.body) + 4096);
  assert.equal(captured.attempt.logicalCallKey, 'planning:0:initial'); assert.equal(captured.attempt.maximumOutputTokens, 3000);
  assert.equal(captured.contract.maximumCalls, 1); assert.equal(captured.contract.layoutQualification, 'unqualified');
  assert.equal(captured.contract.qualification, 'request-only'); assert.ok(captured.contract.input.includes('x'.repeat(9000)));
  const restored = { ...request, contract: JSON.parse(JSON.stringify(request.contract)) };
  assert.deepEqual(await captureOutputSceneRequest(restored), captured);
  assert.throws(() => { captured.attempt.requestDigest = 'other'; }, TypeError);
});

test('Scene wire capture refuses changed source, schema, model, caps, cache, identity and repeated-call settings', async () => {
  const request = await original();
  for (const mutate of [r => { r.model = 'other'; }, r => { r.max_output_tokens = 6000; }, r => { r.store = true; },
    r => { r.prompt_cache_options.mode = 'automatic'; }, r => { r.text.format.name = 'document_short_story'; },
    r => { r.text.format.schema = {}; }, r => { r.input += ' '; }, r => { r.instructions += ' Extra'; }]) {
    const raw = JSON.parse(request.body); mutate(raw);
    await assert.rejects(captureOutputSceneRequest({ ...request, body: JSON.stringify(raw) }), /output_scene_request_outside_contract/);
  }
  const changed = intake(); changed.values.secret.value = 'Different';
  await assert.rejects(captureOutputSceneRequest({ ...request, intake: changed }), /output_scene_request_outside_contract/);
  await assert.rejects(captureOutputSceneRequest({ ...request, contract: { ...request.contract, maximumCalls: 2 } }), /output_scene_request_outside_contract/);
  await assert.rejects(captureOutputSceneRequest({ ...request, safetyIdentifier: 'forma_' + 'b'.repeat(32) }), /output_scene_request_outside_contract/);
  await assert.rejects(captureOutputSceneRequest(await original('', 4096)), /output_scene_request_outside_contract/);
});

test('Scene compiled context is closed and snapshotted without reading executable fields or changing legacy Scene configuration', async () => {
  const request = await original(), input = JSON.parse(request.contract.input);
  for (const mutate of [p => { p.production = {}; }, p => { p.scene_configuration.medium = 'audio'; }, p => { p.output_requirements.source_evidence = true; },
    p => { p.scene_intent.characters[0].name.value = 'Other'; }]) {
    const copy = structuredClone(input); mutate(copy); assert.equal(await createOutputSceneRequestContract(request.intake, copy, 30000), null);
  }
  let read = false; const hostile = { ...request.contract };
  Object.defineProperty(hostile, 'input', { enumerable: true, get() { read = true; return request.contract.input; } });
  await assert.rejects(captureOutputSceneRequest({ ...request, contract: hostile }), /output_scene_request_invalid/); assert.equal(read, false);
  const pending = createOutputSceneRequestContract(request.intake, input, 30000); input.creative_context.facts[0].text = 'Changed';
  assert.equal((await pending).compiledInputSha256, request.contract.compiledInputSha256);
});

test('Scene envelope inspection preserves exact response/call metadata and measured usage without claiming accepted content or layout', async () => {
  const request = await original(), raw = JSON.stringify(envelope()), evidence = await inspectOutputSceneResponse(request, raw);
  assert.equal(evidence.problem, null); assert.equal(evidence.responseSha256, hash(raw)); assert.equal(evidence.requestDigest, hash(request.body));
  assert.equal(evidence.clientRequestId, request.clientRequestId); assert.equal(evidence.responseId, 'unadmitted-response');
  assert.equal(evidence.candidateRaw, '{"title":"Unvalidated content"}'); assert.equal(evidence.qualification, 'evidence-only');
  assert.equal(evidence.layoutQualification, 'unqualified'); assert.equal(evidence.usage.totalTokens, 150);
  assert.equal(evidence.cost.totalMicrousd, evidence.cost.textInputMicrousd + evidence.cost.textOutputMicrousd);
  assert.ok(evidence.cost.totalMicrousd > 0);
});

test('Scene refusal, incomplete or ambiguous content retain measured cost; missing usage/model never becomes zero', async () => {
  const request = await original();
  for (const [change, problem] of [
    [r => { r.output[0].content.push({ type: 'refusal', refusal: 'No' }); }, 'scene_provider_refused'],
    [r => { r.status = 'incomplete'; }, 'scene_provider_response_incomplete'],
    [r => { r.output[0].content.push({ type: 'output_text', text: 'Second' }); }, 'scene_response_content_ambiguous'],
    [r => { r.output_text = 'Conflicting'; }, 'scene_response_content_ambiguous'],
    [r => { r.output[0].status = 'incomplete'; }, 'scene_response_content_ambiguous'],
  ]) {
    const body = envelope(); change(body); const value = await inspectOutputSceneResponse(request, JSON.stringify(body));
    assert.equal(value.problem, problem); assert.ok(value.cost.totalMicrousd > 0);
  }
  for (const change of [r => { delete r.usage; }, r => { r.model = 'other'; }, r => { r.service_tier = {}; }]) {
    const body = envelope(); change(body); const value = await inspectOutputSceneResponse(request, JSON.stringify(body));
    assert.ok(value.problem); assert.equal(value.cost, null);
  }
  const over = envelope(); over.usage = { input_tokens: 100, output_tokens: 3001, total_tokens: 3101 };
  const evidence = await inspectOutputSceneResponse(request, JSON.stringify(over)); assert.equal(evidence.problem, 'scene_usage_outside_contract'); assert.ok(evidence.cost.totalMicrousd > 0);
  const malformed = await inspectOutputSceneResponse(request, '{'); assert.equal(malformed.responseSha256, hash('{')); assert.equal(malformed.cost, null);
});

test('Scene output items require completed assistant text; tools, wrong roles and malformed arrays cannot hide behind output_text', async () => {
  const request = await original();
  for (const change of [
    r => { r.output[0].type = 'function_call'; }, r => { r.output[0].type = 'tool_call'; },
    r => { r.output[0].role = 'user'; }, r => { r.output[0].role = 'system'; }, r => { r.output[0].role = 'tool'; },
    r => { delete r.output[0].role; }, r => { delete r.output[0].id; }, r => { r.output[0].phase = 'commentary'; },
    r => { r.output[0].content = { type: 'output_text', text: r.output_text }; },
    r => { r.output[0].content = r.output_text; }, r => { r.output[0].content = null; }, r => { r.output[0].content = []; },
    r => { r.output.push({ type: 'function_call', name: 'unexpected', arguments: '{}' }); },
    r => { r.output[0].content.push({ type: 'function_call', text: r.output_text }); },
    r => { r.output.unshift({ type: 'reasoning', id: 'rs', summary: [], content: [{ type: 'output_text', text: r.output_text }] }); },
    r => { r.output = [{ type: 'reasoning', id: 'rs', summary: [] }]; },
    r => { r.output.unshift({ type: 'reasoning', id: 'rs', summary: [], content: r.output_text }); },
  ]) {
    const raw = envelope(); raw.output_text = raw.output[0].content[0].text; change(raw);
    const result = await inspectOutputSceneResponse(request, JSON.stringify(raw));
    assert.equal(result.problem, 'scene_response_content_ambiguous'); assert.equal(result.candidateRaw, null);
    assert.ok(result.cost.totalMicrousd > 0);
  }
  const reasoning = envelope(); reasoning.output.unshift({ type: 'reasoning', id: 'rs', summary: [{ type: 'summary_text', text: 'Synthetic summary' }],
    content: [{ type: 'reasoning_text', text: 'Synthetic reasoning text, not Scene output' }], encrypted_content: null, status: 'completed' });
  const valid = await inspectOutputSceneResponse(request, JSON.stringify(reasoning));
  assert.equal(valid.problem, null); assert.equal(valid.candidateRaw, envelope().output[0].content[0].text);
  const unknown = envelope(); unknown.output[0].role = 'tool'; delete unknown.usage;
  const invalid = await inspectOutputSceneResponse(request, JSON.stringify(unknown)); assert.equal(invalid.candidateRaw, null); assert.equal(invalid.cost, null);
});
