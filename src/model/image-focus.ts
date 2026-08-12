import { calculateImageFocalPoint, normalizeImageFocalPoint, type ImageFocalPoint } from "./focal-point";
import { sampleImageUrl } from "./image-sample";
import type { ImageSample } from "./extractors";

const cache = new Map<string, Promise<{sample:ImageSample;focalPoint:ImageFocalPoint}>>();

export function resolveImageFocalAnalysis(url:string){
  const current=cache.get(url);if(current)return current;
  const pending=sampleImageUrl(url).then((sample)=>({sample,focalPoint:calculateImageFocalPoint(sample)})).catch((error)=>{cache.delete(url);throw error;});cache.set(url,pending);return pending;
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
