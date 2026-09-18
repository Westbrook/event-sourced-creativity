import { digest } from '../../src/experiences/compiler.ts';
import { registeredExperience, initialValues } from '../../src/experiences/intake.ts';
import { createSceneOutputContract } from '../../src/model/output-scene-contract.ts';
import { createExperienceSceneAdapterRequest } from '../../worker/experience-scene-adapter-contract.ts';
import { createOutputSceneRequestContract } from '../../worker/output-scene-request.ts';
// Local configuration data only, never real source/consent/job authority.
export async function scenePreflightFixture() {
  const release = await registeredExperience('scene');
  const intake = { intentId: '00000000-0000-4000-8000-000000000094', experienceId: 'scene', releaseHash: release.releaseHash,
    values: { ...initialValues(release), ...Object.fromEntries(Object.entries({ characterA: 'Alex', characterB: 'Alex', goalA: 'Stay', goalB: 'Leave', secret: 'The key is outside', location: 'Waiting room' }).map(([key, value]) => [key, { value, provenance: 'authored' }])) } };
  const spec = await createExperienceSceneAdapterRequest(intake), instructions = '1 scene · 2 characters · 1 location\n1–2 pages';
  const input = { document_title: 'The door', creative_context: { facts: [{ context_key: 'c1', text: 'A closed door.' }] }, combined_context_plan: [], audience: 'general', tone: 'derived from the document',
    output_requirements: { instructions, source_evidence: false }, scene_configuration: { medium: 'visual', source: 'manual', target_format: null, downstream_formats: [], alternate_medium: 'audio', context_continuity: 'same-authored-narrative-context', alternate_rendering: { medium: 'audio', preserve_authored_context: true } }, scene_intent: JSON.parse(spec.input) };
  const contract = await createOutputSceneRequestContract(intake, input, 30000);
  const sceneContract = createSceneOutputContract({ draftId: 'experience-draft-' + 'a'.repeat(64), draftHash: 'sha256:' + 'b'.repeat(64), releaseHash: intake.releaseHash, requestHash: await digest(intake), sourceBindingHash: 'sha256:' + 'c'.repeat(64) });
  const costPreview = { version: 'scene-mini-app-cost-v1', requestId: 'request-1', actorUserId: 'actor-1', projectId: 'project-1', documentId: 'document-1', contextSessionId: null, permissionEpoch: 'permission-1', period: '2026-09',
    requestHash: 'a'.repeat(64), sourceHash: 'b'.repeat(64), provider: 'openai', model: 'gpt-5.6-terra', sceneMedium: 'visual', productionMode: 'manual', itemCount: 1, reusedSourceCount: 0,
    providerCallCount: 1, maximumProviderCallCount: 1, maximumMicrousd: 1000000, maximumInputTokens: 30000, maximumOutputTokens: 3000, maximumTokens: 128000,
    sceneContractDigest: await digest(sceneContract), executionContractDigest: await digest(contract), expiresAt: '2026-09-13T04:05:00.000Z', bindingHash: 'e'.repeat(64) };
  return { artifactKind: 'scene', productionMode: 'manual', sceneMedium: 'visual', itemCount: 1, budgetAcknowledged: true, preflightAcknowledged: true,
    outputTargetInstructions: instructions, sceneRequestId: costPreview.requestId, outputScene: { intake, contract, sceneContract, costPreview } };
}

