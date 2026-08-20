import { IMAGE_ADAPTER_EVALUATION_CORPUS as V1_CORPUS, type ImageAdapterEvaluationCase } from "./canvas-image-corpus-v1.ts";

export const IMAGE_ADAPTER_CORPUS_VERSION="canvas-image-corpus-v2";

/**
 * V2 retains all 50 frozen creative contexts while moving the comparison onto
 * the exact common 1:1 request contract supported by GPT Image and Imagen 4.
 * The original v1 corpus and paid receipts remain immutable.
 */
export const IMAGE_ADAPTER_EVALUATION_CORPUS:ImageAdapterEvaluationCase[]=V1_CORPUS.map((source)=>{
  const item=structuredClone(source);item.id=item.id.replace(/^/,"v2-");item.options.size="1024x1024";item.options.outputFormat=item.options.outputFormat==="webp"?"png":item.options.outputFormat;
  const facts=Array.isArray(item.snapshot.facts)?item.snapshot.facts as Array<Record<string,unknown>>:[];
  for(const fact of facts){if(fact.type!=="format")continue;const properties=fact.properties&&typeof fact.properties==="object"?fact.properties as Record<string,unknown>:{};properties.text="Create for a square 1024 × 1024 pixel frame.";properties.label="1024x1024 output";properties.image_format={schema_version:1,aspect_ratio:{width:1,height:1},dimensions:{width:1024,height:1024,unit:"px"}};fact.properties=properties;}
  item.rubric=[...item.rubric,"The composition is resolved deliberately for a square frame."];
  return item;
});

if(IMAGE_ADAPTER_EVALUATION_CORPUS.length!==50)throw new Error("image_adapter_v2_corpus_must_contain_50_cases");
