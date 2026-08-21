import { IMAGE_ADAPTER_EVALUATION_CORPUS as V5_CORPUS } from "./canvas-image-corpus-v5.ts";

/** V6 preserves the v5 contexts for the v10 expanded-caption provider contract. */
export const IMAGE_ADAPTER_CORPUS_VERSION="canvas-image-corpus-v6";
export const IMAGE_ADAPTER_EVALUATION_CORPUS=V5_CORPUS.map((item)=>({
  ...structuredClone(item),
  id:item.id.replace(/^v5-/,"v6-"),
}));
