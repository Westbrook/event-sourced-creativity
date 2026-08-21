import { IMAGE_ADAPTER_EVALUATION_CORPUS as V4_CORPUS } from "./canvas-image-corpus-v4.ts";

/**
 * V5 freezes the same 50 semantic contexts and evaluation rubrics as V4 while
 * giving the v9 provider-caption contract a new, non-overlapping evidence set.
 */
export const IMAGE_ADAPTER_CORPUS_VERSION="canvas-image-corpus-v5";
export const IMAGE_ADAPTER_EVALUATION_CORPUS=V4_CORPUS.map((item)=>({
  ...structuredClone(item),
  id:item.id.replace(/^v4-/,"v5-"),
}));
