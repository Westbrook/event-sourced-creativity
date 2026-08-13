import { calculateImageFocalPoint, calculateLegacyImageFocalPoint, normalizeImageFocalPoint, type ImageFocalPoint } from "./focal-point";
import { sampleImageUrl, sampleImageUrlLegacySquare } from "./image-sample";
import type { ImageSample } from "./extractors";

export type LocalFocalPointRun = {
  sample: ImageSample;
  focalPoint: ImageFocalPoint;
  sampleDurationMs: number;
  calculationDurationMs: number;
  totalDurationMs: number;
  providerCostUsd: 0;
};

export type ImageFocalComparison = LocalFocalPointRun & {
  legacySample: ImageSample;
  legacyFocalPoint: ImageFocalPoint;
  legacySampleDurationMs: number;
  legacyCalculationDurationMs: number;
  legacyTotalDurationMs: number;
  legacyProviderCostUsd: 0;
};

const cache = new Map<string, Promise<LocalFocalPointRun>>();
const comparisonCache = new Map<string, Promise<ImageFocalComparison>>();
const now = () => globalThis.performance?.now() ?? Date.now();

export function resolveImageFocalAnalysis(url:string){
  const current=cache.get(url);if(current)return current;
  const startedAt=now();
  const pending=sampleImageUrl(url).then((sample)=>{
    const sampledAt=now();const focalPoint=calculateImageFocalPoint(sample);const completedAt=now();
    return{sample,focalPoint,sampleDurationMs:sampledAt-startedAt,calculationDurationMs:completedAt-sampledAt,totalDurationMs:completedAt-startedAt,providerCostUsd:0 as const};
  }).catch((error)=>{cache.delete(url);throw error;});cache.set(url,pending);return pending;
}

export function resolveImageFocalComparison(url:string){
  const current=comparisonCache.get(url);if(current)return current;
  const legacyStartedAt=now();
  const legacy=sampleImageUrlLegacySquare(url).then((legacySample)=>{const sampledAt=now();const legacyFocalPoint=calculateLegacyImageFocalPoint(legacySample);const completedAt=now();return{legacySample,legacyFocalPoint,legacySampleDurationMs:sampledAt-legacyStartedAt,legacyCalculationDurationMs:completedAt-sampledAt,legacyTotalDurationMs:completedAt-legacyStartedAt,legacyProviderCostUsd:0 as const};});
  const pending=Promise.all([resolveImageFocalAnalysis(url),legacy]).then(([analysis,legacyAnalysis])=>({...analysis,...legacyAnalysis})).catch((error)=>{comparisonCache.delete(url);throw error;});comparisonCache.set(url,pending);return pending;
}

export function resolveImageFocalPoint(url: string) {
  return resolveImageFocalAnalysis(url).then((analysis)=>analysis.focalPoint);
}

export function positionImageAtFocalPoint(image: HTMLImageElement, known?: unknown) {
  const point = normalizeImageFocalPoint(known);
  const apply=(resolved:ImageFocalPoint)=>{image.style.setProperty("--focal-x",`${Number((resolved.x*100).toFixed(2))}%`);image.style.setProperty("--focal-y",`${Number((resolved.y*100).toFixed(2))}%`);};
  if (point) { apply(point); return; }
  const url = image.currentSrc || image.src;
  if (!url) return;
  void resolveImageFocalPoint(url).then((resolved) => { if (image.isConnected) apply(resolved); }).catch(() => { /* Center remains a safe fallback when pixels cannot be read. */ });
}
