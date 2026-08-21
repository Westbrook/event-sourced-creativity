import { IMAGE_ADAPTER_EVALUATION_CORPUS as V1_CORPUS, type ImageAdapterEvaluationCase } from "./canvas-image-corpus-v1.ts";
import { IMAGE_ADAPTER_EVALUATION_CORPUS as V2_SQUARE_CORPUS } from "./canvas-image-corpus-v2.ts";

export const IMAGE_ADAPTER_CORPUS_VERSION="canvas-image-corpus-v3";

/**
 * V3 preserves the complete semantic content and capability balance of V2.
 * New IDs keep the previous paid pixels and report immutable while exercising
 * the v7 provider-native prompt adaptation and corrected evaluator cache.
 */
export const IMAGE_ADAPTER_EVALUATION_CORPUS:ImageAdapterEvaluationCase[]=V2_SQUARE_CORPUS.map((source)=>{
  const item=structuredClone(source);item.id=item.id.replace(/^v2-/,"v3-");return item;
});

if(V1_CORPUS.length!==IMAGE_ADAPTER_EVALUATION_CORPUS.length||IMAGE_ADAPTER_EVALUATION_CORPUS.length!==50)throw new Error("image_adapter_v3_corpus_must_retain_50_cases");
