import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { captureExperienceSceneTarget } from '../src/experiences/scene-target.ts';
import { createSceneOutputContract } from '../src/model/output-scene-contract.ts';
import { sceneMiniAppCostApprovalMatches } from '../src/model/scene-mini-app-consent.ts';
import { createExperienceSceneRecipe } from '../worker/experience-scene-recipe.ts';
import { compileOutputPlan } from '../src/model/output-plan.ts';
import { isExperienceStoryTarget } from '../src/experiences/story-result.ts';
import { outputTerms } from '../src/experiences/output-terms.ts';
const src = readFileSync(new URL('../src/components/forma-experience-host.ts', import.meta.url), 'utf8');

test('actual Scene host target join requires exact original plan/source and never adopts another document target', () => {
  const begin = src.indexOf('  #snapshotMatches('), end = src.indexOf('  #candidate(', begin);
  const method = stripTypeScriptTypes(src.slice(begin, end).replace('#snapshotMatches', 'function snapshotMatches').replaceAll('this.#binding', 'this.binding'));
  const check = new Function('captureExperienceSceneTarget', 'isExperienceStoryTarget', 'bindingJson', method + ';return snapshotMatches;')(captureExperienceSceneTarget, isExperienceStoryTarget, JSON.stringify);
  const source = {draftId: 'experience-draft-' + 'a'.repeat(64), draftHash: 'sha256:' + 'b'.repeat(64),
    releaseHash: 'sha256:' + 'c'.repeat(64), requestHash: 'sha256:' + 'd'.repeat(64), sourceBindingHash: 'sha256:' + 'e'.repeat(64)};
  const recipe = createExperienceSceneRecipe({output: 'scene', requirementId: 'r', deliverableId: 'd', contract: createSceneOutputContract(source)});
  const target = compileOutputPlan([recipe.spec], {document_id: 'doc', source_revision: 'source', requirement_revision: 'req'}).targets[0], grant = {id: 'grant'};
  const state = {output: 'scene', documentId: 'doc', projectId: 'project', original: {grantId: 'grant'},
    plan: {sourceDigest: 'source', requirementsDigest: 'req', revisionId: 'plan', targetId: target.id, targetContractDigest: 'contract'}, grant};
  const snapshot = {documentId: 'doc', projectId: 'project', scope: {kind: 'personal', actorUserId: 'owner'},
    sourceVerification: {status: 'verified'}, permissions: {canRequest: true}, sourceRevision: 'source', requirementRevision: 'req',
    confirmedPlan: {revisionId: 'plan', sourceDigest: 'source', requirementsDigest: 'req', targetContractDigests: {[target.id]: 'contract'}, plan: {targets: [target]}}, grants: [grant]};
  const context = {binding: {ownerId: 'owner', sceneSource: source}, store: {outputRequirements: {resource: () => ({state: 'ready', snapshot})}}};
  assert.equal(check.call(context, state), true);
  for (const mutate of [x => x.confirmedPlan.targetContractDigests[target.id] = 'other', x => x.scope.actorUserId = 'other',
    x => x.confirmedPlan.plan.targets[0].scene_contract.source.requestHash = 'sha256:' + 'f'.repeat(64),
    x => x.confirmedPlan.plan.targets[0].media_kind = 'slides', x => x.confirmedPlan.plan.targets.push(target)]) {
    const bad = structuredClone(snapshot); mutate(bad);
    assert.equal(check.call({...context, store: {outputRequirements: {resource: () => ({state: 'ready', snapshot: bad})}}}, state), false);
  }
});

test('actual Scene host approval requires a separate checked action and exact original Scene contract', () => {
  const begin = src.indexOf('  #sceneConsent('), end = src.indexOf('  #prepare(', begin);
  const method = stripTypeScriptTypes(src.slice(begin, end).replace('#sceneConsent', 'function consent').replaceAll('this.#', 'this.'));
  const consent = new Function('sceneMiniAppCostApprovalMatches', method + ';return consent;')(sceneMiniAppCostApprovalMatches);
  const preview = {version: 'scene-mini-app-cost-v1', requestId: 'job', actorUserId: 'owner', projectId: 'project', documentId: 'doc',
    contextSessionId: null, permissionEpoch: 'epoch', period: '2026-09', requestHash: 'a'.repeat(64), sourceHash: 'b'.repeat(64),
    provider: 'openai', model: 'gpt-5.6-terra', sceneMedium: 'visual', productionMode: 'manual', itemCount: 1, reusedSourceCount: 0,
    providerCallCount: 1, maximumProviderCallCount: 1, maximumMicrousd: 1000000, maximumInputTokens: 30000,
    maximumOutputTokens: 3000, maximumTokens: 128000, sceneContractDigest: 'sha256:' + 'c'.repeat(64),
    executionContractDigest: 'sha256:' + 'd'.repeat(64), expiresAt: new Date(Date.now() + 60000).toISOString(), bindingHash: 'e'.repeat(64)};
  const state = {output: 'scene', sceneCostPreview: preview}, context = {sceneApproval: false,
    binding: {ownerId: 'owner', plan: {documentId: 'doc', projectId: 'project'}, sceneContractDigest: preview.sceneContractDigest}};
  assert.equal(consent.call(context, state), null); context.sceneApproval = true;
  assert.deepEqual(consent.call(context, state), {...preview, confirmed: true});
  for (const patch of [{sceneContractDigest: 'sha256:' + 'f'.repeat(64)}, {actorUserId: 'other'}, {expiresAt: new Date(0).toISOString()}]) {
    assert.equal(consent.call(context, {...state, sceneCostPreview: {...preview, ...patch}}), null);
  }
  assert.match(src, /event\.isTrusted && \(event\.currentTarget as HTMLInputElement\)\.checked/);
  assert.match(src, /this\.#latch\.consume\(event, decision/);
});

test('Scene privacy signals synchronously remove the shared reader; missing terms remain unavailable', () => {
  const begin = src.indexOf('  #storySync ='), end = src.indexOf('  #visibility =', begin);
  const methods = src.slice(begin, end).replace('#storySync =', 'const sync =').replace('#storyWithdraw =', 'const withdraw =').replaceAll('this.#', 'this.');
  const trace = [], context = {binding: {selection: {output: 'scene'}}, current: () => false,
    clearResult: () => trace.push('clear'), retire: () => trace.push('retire'), requestUpdate: () => trace.push('update')};
  const actions = new Function(methods + ';return {sync,withdraw};').call(context); actions.sync(); actions.withdraw();
  assert.deepEqual(trace, ['clear', 'retire', 'update']);
  assert.ok(src.includes('.retained-story-reader, .native-retained-scene-reader'));
  assert.ok(src.includes('if (!original || !this.#binding) return null;'));
  assert.ok(src.includes('readExperienceNativeScene(raw, input, candidate.scene'));
  assert.equal(outputTerms({}, {output: 'scene', targetId: 'target', now: Date.now()}).available, false);
});
