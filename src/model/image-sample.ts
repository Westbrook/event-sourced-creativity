import type { ImageSample, RGB } from "./extractors";

async function sampleImageSource(source: ImageBitmapSource, gridSize = 12): Promise<ImageSample> {
  const bitmap = await createImageBitmap(source);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = gridSize; canvas.height = gridSize;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("image_sampling_unavailable");
    context.fillStyle = "#ffffff"; context.fillRect(0, 0, gridSize, gridSize); context.drawImage(bitmap, 0, 0, gridSize, gridSize);
    const rgba = context.getImageData(0, 0, gridSize, gridSize).data;
    const pixels: RGB[] = [];
    for (let index = 0; index < rgba.length; index += 4) pixels.push([rgba[index], rgba[index + 1], rgba[index + 2]]);
    return { sourceWidth: bitmap.width, sourceHeight: bitmap.height, gridWidth: gridSize, gridHeight: gridSize, pixels };
  } finally { bitmap.close(); }
}

export async function sampleImageFile(file: File, gridSize = 12): Promise<ImageSample> {
  return sampleImageSource(file, gridSize);
}

export async function sampleImageUrl(url: string, gridSize = 12): Promise<ImageSample> {
  const response = await fetch(url);
  if (!response.ok) throw new Error("reference_image_unavailable");
  return sampleImageSource(await response.blob(), gridSize);
}
