/** Additive observation contract. Never an admission, retry, settlement or retention authority. */
export const GENERATION_OUTCOME_SCHEMA = 'forma-generation-outcome-v1' as const;
export type PipelineStage = 'planner' | 'compiler' | 'app_moderation' | 'media_submission' | 'media_result' | 'retrieval' | 'storage' | 'unknown';
export type ProviderModerationStage = 'input' | 'output' | 'unknown';
export type ContentOutcome = 'usable' | 'refused' | 'invalid' | 'unknown';
export type DispatchState = 'not_dispatched' | 'dispatch_unknown' | 'response_received' | 'accepted' | 'unknown';
export type AccountingState = 'not_incurred' | 'usage_recorded' | 'settled' | 'unknown';
export type FailureKind = 'safety' | 'authentication' | 'access' | 'quota' | 'rate_limit' | 'transport' | 'canceled' | 'provider' | 'server' | 'validation' | 'incomplete' | 'storage' | 'unknown';
export type CorrectiveActionScope = 'request' | 'user' | 'workspace' | 'account' | 'project' | 'organization' | 'model' | 'region' | 'network' | 'provider' | 'unknown';
export type GenerationOutcomeEvidence = {
  schemaVersion: typeof GENERATION_OUTCOME_SCHEMA;
  pipelineStage: PipelineStage;
  providerModerationStage: ProviderModerationStage;
  failureKind: FailureKind | null;
  correctiveActionScope: CorrectiveActionScope;
  contentOutcome: ContentOutcome;
  dispatchState: DispatchState;
  accountingState: AccountingState;
};
export type SafetyEvidence = {
  schemaVersion: 'forma-safety-evidence-v1';
  source: 'local_policy' | 'standalone_omni' | 'attached_text' | 'downstream_media';
  stage: ProviderModerationStage;
  verdict: 'flagged' | 'clear' | 'unknown';
  validity: 'valid' | 'invalid' | 'unknown';
  /** A single multimodal probe returns one result; text batches return one per input. */
  expectedResultCount: number | null;
  returnedResultCount: number | null;
  requestedModel: string | null;
  returnedModel: string | null;
  requestId: string | null;
  responseId: string | null;
  categories?: Record<string, boolean>;
  scores?: Record<string, number>;
  moderationDetails?: unknown;
};
export type OperationEvidence = {
  schemaVersion: 'forma-operation-evidence-v1';
  entryPath: string | null;
  provider: string;
  requestedAlias: string | null;
  effectiveModel: string | null;
  returnedModel: string | null;
  requestedQuality: string | null;
  endpoint: string;
  routingPolicyVersion: string | null;
  capabilityVersion: string | null;
  overrideProvenance: string | null;
  deploymentVersion: string | null;
  compilerVersion: string | null;
  adapterVersion: string | null;
  /** Exact nonsecret values actually submitted. Omitted keys stay omitted. */
  settings: Record<string, unknown>;
  requestId: string | null;
  responseId: string | null;
  requestSha256: string | null;
  responseSha256: string | null;
};
/** Raw prompts, envelopes, revised prompts and moderation details are private, never billing fields. */
export type PrivateGenerationEvidence = {
  schemaVersion: 'forma-private-generation-evidence-v1';
  evidenceId: string;
  capturedAt: string;
  phase: 'request' | 'response';
  operation: OperationEvidence;
  outcome: GenerationOutcomeEvidence;
  safety?: SafetyEvidence;
  requestBody?: string;
  responseBody?: string;
  revisedPrompt?: string;
};
export type GenerationEvidenceObserver = (evidence: PrivateGenerationEvidence) => void | Promise<void>;
export function unknownGenerationOutcome(pipelineStage: PipelineStage = 'unknown'): GenerationOutcomeEvidence {
  return {schemaVersion: GENERATION_OUTCOME_SCHEMA, pipelineStage, providerModerationStage:'unknown', failureKind:null,
    correctiveActionScope:'unknown', contentOutcome:'unknown', dispatchState:'unknown', accountingState:'unknown'};
}
