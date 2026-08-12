import type { ImageSample, RGB } from "./extractors.ts";

export type ImageFocalPoint = {
  x: number;
  y: number;
  confidence: number;
  method: "saliency-grid-v1";
  sampleWidth: number;
  sampleHeight: number;
};

const clamp = (value: number, minimum = 0, maximum = 1) => Math.max(minimum, Math.min(maximum, value));
const round = (value: number, precision = 4) => Number(value.toFixed(precision));
const luminance = ([red, green, blue]: RGB) => (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
const saturation = ([red, green, blue]: RGB) => {
  const maximum = Math.max(red, green, blue); const minimum = Math.min(red, green, blue);
  return maximum ? (maximum - minimum) / maximum : 0;
};
const colorDistance = (left: RGB, right: RGB) => Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]) / 441.67;

function validate(sample: ImageSample) {
  const dimensions = [sample.sourceWidth, sample.sourceHeight, sample.gridWidth, sample.gridHeight];
  if (!dimensions.every((value) => Number.isInteger(value) && value > 0)) throw new Error("sample_dimensions_invalid");
  if (sample.gridWidth * sample.gridHeight !== sample.pixels.length || sample.pixels.length > 4096) throw new Error("sample_grid_invalid");
  if (!sample.pixels.every((pixel) => Array.isArray(pixel) && pixel.length === 3 && pixel.every((value) => Number.isFinite(value) && value >= 0 && value <= 255))) throw new Error("sample_pixels_invalid");
}

/**
 * Finds a useful crop anchor without recognizing or transmitting depicted content.
 * A tiny pixel grid combines local edges, visual rarity, saturation, tonal contrast,
 * and a deliberately mild center prior. The weighted result is stable across crop sizes.
 */
export function calculateImageFocalPoint(sample: ImageSample): ImageFocalPoint {
  validate(sample);
  const { gridWidth: width, gridHeight: height, pixels } = sample;
  const mean = pixels.reduce<RGB>((total, pixel) => [total[0] + pixel[0], total[1] + pixel[1], total[2] + pixel[2]], [0, 0, 0]).map((value) => value / pixels.length) as RGB;
  const meanLuminance = pixels.reduce((total, pixel) => total + luminance(pixel), 0) / pixels.length;
  const at = (x: number, y: number) => pixels[y * width + x];
  const raw = pixels.map((pixel, index) => {
    const x = index % width; const y = Math.floor(index / width); const neighbours: RGB[] = [];
    if (x > 0) neighbours.push(at(x - 1, y)); if (x + 1 < width) neighbours.push(at(x + 1, y));
    if (y > 0) neighbours.push(at(x, y - 1)); if (y + 1 < height) neighbours.push(at(x, y + 1));
    const edge = neighbours.reduce((total, neighbour) => total + colorDistance(pixel, neighbour), 0) / Math.max(1, neighbours.length);
    const rarity = colorDistance(pixel, mean);
    const tonalContrast = Math.abs(luminance(pixel) - meanLuminance);
    const normalizedX = (x + .5) / width; const normalizedY = (y + .5) / height;
    const centerDistance = Math.hypot((normalizedX - .5) * 1.15, normalizedY - .5) / .76;
    const centerPrior = clamp(1 - centerDistance);
    return edge * .38 + rarity * .27 + tonalContrast * .15 + saturation(pixel) * .12 + centerPrior * .08;
  });
  const smoothed = raw.map((_, index) => {
    const x = index % width; const y = Math.floor(index / width); let total = 0; let weight = 0;
    for (let offsetY = -1; offsetY <= 1; offsetY += 1) for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      const sampleX = x + offsetX; const sampleY = y + offsetY;
      if (sampleX < 0 || sampleY < 0 || sampleX >= width || sampleY >= height) continue;
      const sampleWeight = offsetX === 0 && offsetY === 0 ? 4 : offsetX === 0 || offsetY === 0 ? 2 : 1;
      total += raw[sampleY * width + sampleX] * sampleWeight; weight += sampleWeight;
    }
    return total / weight;
  });
  const average = smoothed.reduce((total, value) => total + value, 0) / smoothed.length;
  const peak = Math.max(...smoothed); const threshold = average + (peak - average) * .42;
  let weightedX = 0; let weightedY = 0; let totalWeight = 0;
  smoothed.forEach((score, index) => {
    if (score < threshold) return;
    const x = (index % width + .5) / width; const y = (Math.floor(index / width) + .5) / height;
    const weight = Math.max(.001, score - threshold) + .012 * clamp(1 - Math.hypot(x - .5, y - .5));
    weightedX += x * weight; weightedY += y * weight; totalWeight += weight;
  });
  const deviation = Math.sqrt(smoothed.reduce((total, value) => total + (value - average) ** 2, 0) / smoothed.length);
  return {
    x: round(totalWeight ? clamp(weightedX / totalWeight, .04, .96) : .5),
    y: round(totalWeight ? clamp(weightedY / totalWeight, .04, .96) : .5),
    confidence: round(clamp(.22 + (peak - average) * 1.5 + deviation * 1.8, .22, .96)),
    method: "saliency-grid-v1",
    sampleWidth: width,
    sampleHeight: height,
  };
}

export function normalizeImageFocalPoint(value: unknown): ImageFocalPoint | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const point = value as Partial<ImageFocalPoint>; const x = Number(point.x); const y = Number(point.y); const confidence = Number(point.confidence);
  if (![x, y, confidence].every(Number.isFinite) || x < 0 || x > 1 || y < 0 || y > 1) return null;
  return { x, y, confidence: clamp(confidence), method: "saliency-grid-v1", sampleWidth: Math.max(1, Math.floor(Number(point.sampleWidth ?? 12))), sampleHeight: Math.max(1, Math.floor(Number(point.sampleHeight ?? 12))) };
}

export function focalPointCss(value: unknown) {
  const point = normalizeImageFocalPoint(value);
  return point ? `--focal-x:${round(point.x * 100, 2)}%;--focal-y:${round(point.y * 100, 2)}%` : "";
}
