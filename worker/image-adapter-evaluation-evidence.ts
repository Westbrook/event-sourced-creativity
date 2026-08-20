export const IMAGE_ADAPTER_EVALUATION_EVIDENCE={
  schemaVersion:1,
  corpusVersion:"canvas-image-corpus-v1",
  corpusHash:"e8cc43af938404306a69eb4d11a0ad42255cbeccea36156dd853ce0a0151c27f",
  evaluationRef:"docs/evaluations/canvas-image-corpus-v1.md",
  adapterId:"fal-ideogram-v4",
  adapterVersion:"v2",
  completedAt:"2026-08-20T13:19:35.100Z",
  status:"review_required" as const,
  passed:false,
  caseCount:50,
  evaluatedPairs:46,
  recordedSuccessfulProviderCostUsd:5.638431,
  openai:{completed:50,failed:0,usable:46,meanInstruction:4.891,meanLatencySeconds:63.4},
  fal:{completed:46,failed:4,usable:38,meanInstruction:3.587,meanLatencySeconds:20.8},
  preference:{openai:43,fal:3,tie:0},
  reference:{evaluated:10,falUsable:3,preserveCompositionEvaluated:5,preserveCompositionUsable:0},
  failedCases:["08-signal-kitchen-material","09-desert-printshop-spatial","10-harbor-workshop-typography","10-harbor-workshop-spatial"],
  finding:"The v2 adapter is not ready for approval: four benign renders were rejected by the provider output safety filter, and preserve-composition reference requests retained the source subject instead of translating its composition into the requested subject.",
};

export type ImageAdapterEvaluationEvidence=typeof IMAGE_ADAPTER_EVALUATION_EVIDENCE;
