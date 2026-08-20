export const IMAGE_ADAPTER_EVALUATION_EVIDENCE={
  schemaVersion:3,
  corpusVersion:"canvas-image-corpus-v2",
  corpusHash:"c1b85881f7ef57b724dc09198d9c57b7b1c392b970bff31cbefdb39af57d3528",
  evaluationRef:"docs/evaluations/canvas-image-corpus-v2.md",
  adapterId:"fal-ideogram-v4",
  adapterVersion:"v6",
  completedAt:"2026-08-20T17:43:30.461Z",
  status:"review_required" as const,
  passed:false,
  caseCount:50,
  evaluatedPairs:49,
  recordedSuccessfulProviderCostUsd:6.023623,
  openai:{completed:50,failed:0,usable:47,meanInstruction:4.592,meanLatencySeconds:66.206},
  fal:{completed:49,failed:1,usable:39,meanInstruction:3.469,meanLatencySeconds:17.696},
  preference:{openai:46,fal:3,tie:0},
  reference:{evaluated:10,falUsable:6,preserveCompositionEvaluated:5,preserveCompositionUsable:3},
  failedCases:["v2-10-harbor-workshop-material"],
  finding:"Ideogram 4 is not ready for approval on the v6 evidence: one benign material study was repeatedly rejected by the provider output safety filter, candidate usability was 39/49, reference usability was 6/10, and mean instruction following trailed the baseline by 1.123 points.",
};

export type ImageAdapterEvaluationEvidence=typeof IMAGE_ADAPTER_EVALUATION_EVIDENCE;
