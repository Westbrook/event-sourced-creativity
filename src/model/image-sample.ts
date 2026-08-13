import type { ImageSample, RGB } from "./extractors";

export function imageSampleGrid(width: number, height: number, longEdge: number) {
  if (![width, height, longEdge].every((value) => Number.isFinite(value) && value > 0)) throw new Error("image_sample_dimensions_invalid");
  const size = Math.max(1, Math.round(longEdge));
  if (width >= height) return { width: size, height: Math.max(1, Math.round(size * height / width)) };
  return { width: Math.max(1, Math.round(size * width / height)), height: size };
}

async function sampleImageSource(source: ImageBitmapSource, gridSize = 24, preserveAspect = true): Promise<ImageSample> {
  const bitmap = await createImageBitmap(source);
  try {
    const grid = preserveAspect ? imageSampleGrid(bitmap.width, bitmap.height, gridSize) : { width: gridSize, height: gridSize };
    const canvas = document.createElement("canvas");
    canvas.width = grid.width; canvas.height = grid.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("image_sampling_unavailable");
    context.fillStyle = "#ffffff"; context.fillRect(0, 0, grid.width, grid.height); context.drawImage(bitmap, 0, 0, grid.width, grid.height);
    const rgba = context.getImageData(0, 0, grid.width, grid.height).data;
    const pixels: RGB[] = [];
    for (let index = 0; index < rgba.length; index += 4) pixels.push([rgba[index], rgba[index + 1], rgba[index + 2]]);
    return { sourceWidth: bitmap.width, sourceHeight: bitmap.height, gridWidth: grid.width, gridHeight: grid.height, pixels };
  } finally { bitmap.close(); }
}

export async function sampleImageFile(file: File, gridSize = 24): Promise<ImageSample> {
  return sampleImageSource(file, gridSize);
}

export async function sampleImageUrl(url: string, gridSize = 24): Promise<ImageSample> {
  const response = await fetch(url);
  if (!response.ok) throw new Error("reference_image_unavailable");
  return sampleImageSource(await response.blob(), gridSize);
}

/** Reproduces the original 12 × 12 distorted sample only for migration diagnostics. */
export async function sampleImageUrlLegacySquare(url: string, gridSize = 12): Promise<ImageSample> {
  const response = await fetch(url);
  if (!response.ok) throw new Error("reference_image_unavailable");
  return sampleImageSource(await response.blob(), gridSize, false);
}
