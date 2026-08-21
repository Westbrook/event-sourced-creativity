import { IMAGE_ADAPTER_EVALUATION_CORPUS as V1_CORPUS, type ImageAdapterEvaluationCase } from "./canvas-image-corpus-v1.ts";
import { IMAGE_ADAPTER_EVALUATION_CORPUS as V3_CORPUS } from "./canvas-image-corpus-v3.ts";

export const IMAGE_ADAPTER_CORPUS_VERSION="canvas-image-corpus-v4";

/**
 * V4 preserves every frozen creative requirement from V3 under new immutable
 * case IDs. The new receipts exercise the v8 subject-adherence and benign
 * exact-typography framing contracts without rewriting the evaluation tasks.
 */
export const IMAGE_ADAPTER_EVALUATION_CORPUS:ImageAdapterEvaluationCase[]=V3_CORPUS.map((source)=>{
  const item=structuredClone(source);item.id=item.id.replace(/^v3-/,"v4-");return item;
});

if(V1_CORPUS.length!==IMAGE_ADAPTER_EVALUATION_CORPUS.length||IMAGE_ADAPTER_EVALUATION_CORPUS.length!==50)throw new Error("image_adapter_v4_corpus_must_retain_50_cases");
