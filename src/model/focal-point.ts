import type { ImageSample, RGB } from "./extractors.ts";

export type ImageFocalPoint = {
  x: number;
  y: number;
  confidence: number;
  method: "saliency-grid-v1" | "attention-region-v2";
  sampleWidth: number;
  sampleHeight: number;
  region?: { x0: number; y0: number; x1: number; y1: number };
  visualConfidence?: number;
  compositionConfidence?: number;
};

export const CURRENT_FOCAL_POINT_METHOD = "attention-region-v2" as const;

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
 * The aspect-preserving sample is scored for local visual separation, grouped into
 * multi-scale attention regions, and ranked with mild interior, foreground, and
 * composition priors. The returned point is the winning region's weighted centroid.
 */
export function calculateImageFocalPoint(sample: ImageSample): ImageFocalPoint {
  validate(sample);
  const { gridWidth: width, gridHeight: height, pixels } = sample;
  const mean = pixels.reduce<RGB>((total, pixel) => [total[0] + pixel[0], total[1] + pixel[1], total[2] + pixel[2]], [0, 0, 0]).map((value) => value / pixels.length) as RGB;
  const meanLuminance = pixels.reduce((total, pixel) => total + luminance(pixel), 0) / pixels.length;
  const at = (x: number, y: number) => pixels[y * width + x];
  const visual = pixels.map((pixel, index) => {
    const x = index % width; const y = Math.floor(index / width); const neighbours: RGB[] = [];
    for (let offsetY = -1; offsetY <= 1; offsetY += 1) for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      if (!offsetX && !offsetY) continue;
      const sampleX = x + offsetX; const sampleY = y + offsetY;
      if (sampleX >= 0 && sampleY >= 0 && sampleX < width && sampleY < height) neighbours.push(at(sampleX, sampleY));
    }
    const localContrast = neighbours.reduce((total, neighbour) => total + colorDistance(pixel, neighbour), 0) / Math.max(1, neighbours.length);
    const edgePeak = neighbours.reduce((maximum, neighbour) => Math.max(maximum, colorDistance(pixel, neighbour)), 0);
    const rarity = colorDistance(pixel, mean);
    const tonalContrast = Math.abs(luminance(pixel) - meanLuminance);
    return localContrast * .31 + edgePeak * .19 + rarity * .24 + tonalContrast * .16 + saturation(pixel) * .10;
  });
  const smoothed = smoothGrid(visual, width, height, 2);
  const average = smoothed.reduce((total, value) => total + value, 0) / smoothed.length;
  const peak = Math.max(...smoothed); const minimum = Math.min(...smoothed);
  const deviation = Math.sqrt(smoothed.reduce((total, value) => total + (value - average) ** 2, 0) / smoothed.length);
  if (peak - minimum < .012 || deviation < .006) return {
    x: .5, y: .5, confidence: round(clamp(.18 + deviation * 3, .18, .34)), method: CURRENT_FOCAL_POINT_METHOD,
    sampleWidth: width, sampleHeight: height, region: { x0: .35, y0: .35, x1: .65, y1: .65 }, visualConfidence: round(clamp(deviation * 5)), compositionConfidence: .5,
  };
  const rowComplexity = Array.from({ length: height }, (_, row) => {
    const rowValues = smoothed.slice(row * width, (row + 1) * width);
    return rowValues.reduce((total, value) => total + Math.abs(value - average), 0) / Math.max(1, rowValues.length);
  });
  const maximumRowComplexity = Math.max(...rowComplexity, .001);
  const attention = smoothed.map((score, index) => {
    const normalizedX = (index % width + .5) / width; const normalizedY = (Math.floor(index / width) + .5) / height;
    const normalizedVisual = clamp((score - minimum) / Math.max(.001, peak - minimum));
    const composition = Math.exp(-.5 * (((normalizedX - .5) / .4) ** 2 + ((normalizedY - .6) / .34) ** 2));
    const edgeDistance = Math.min(normalizedX, normalizedY, 1 - normalizedX, 1 - normalizedY);
    const interior = .38 + .62 * clamp(edgeDistance / .16);
    const depth = .72 + normalizedY * .38;
    const rowDetail = .72 + .28 * clamp(rowComplexity[Math.floor(index / width)] / maximumRowComplexity);
    const pixel = pixels[index];
    const skyLike = normalizedY < .46 && luminance(pixel) > .67 && saturation(pixel) < .22 ? .66 : 1;
    return normalizedVisual * (.68 + composition * .32) * interior * depth * rowDetail * skyLike + composition * .055;
  });
  const sorted = [...attention].sort((left, right) => left - right);
  const threshold = sorted[Math.floor((sorted.length - 1) * .68)];
  const summaries = attentionWindows(attention, width, height, threshold, rowComplexity, maximumRowComplexity).sort((left, right) => right.rank - left.rank);
  const selected = summaries[0];
  if (!selected) return { x: .5, y: .5, confidence: .22, method: CURRENT_FOCAL_POINT_METHOD, sampleWidth: width, sampleHeight: height };
  const totalRank = summaries.reduce((total, component) => total + component.rank, 0);
  const dominance = selected.rank / Math.max(.001, totalRank);
  const visualConfidence = clamp((peak - average) * 1.8 + deviation * 2.3);
  const compositionConfidence = clamp(selected.composition * .55 + selected.compactness * .25 + dominance * .2);
  const marginX = 1.5 / width; const marginY = 1.5 / height;
  return {
    x: round(clamp(selected.x, .04, .96)), y: round(clamp(selected.y, .04, .96)),
    confidence: round(clamp(.18 + visualConfidence * .36 + compositionConfidence * .34 + dominance * .12, .18, .92)),
    method: CURRENT_FOCAL_POINT_METHOD, sampleWidth: width, sampleHeight: height,
    region: { x0: round(clamp(selected.x0 - marginX)), y0: round(clamp(selected.y0 - marginY)), x1: round(clamp(selected.x1 + marginX)), y1: round(clamp(selected.y1 + marginY)) },
    visualConfidence: round(visualConfidence), compositionConfidence: round(compositionConfidence),
  };
}

function smoothGrid(values: number[], width: number, height: number, radius: number) {
  return values.map((_, index) => {
    const x = index % width; const y = Math.floor(index / width); let total = 0; let weight = 0;
    for (let offsetY = -radius; offsetY <= radius; offsetY += 1) for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
      const sampleX = x + offsetX; const sampleY = y + offsetY;
      if (sampleX < 0 || sampleY < 0 || sampleX >= width || sampleY >= height) continue;
      const distance = Math.hypot(offsetX, offsetY); const sampleWeight = 1 / (1 + distance * .85);
      total += values[sampleY * width + sampleX] * sampleWeight; weight += sampleWeight;
    }
    return total / weight;
  });
}

function attentionWindows(attention: number[], width: number, height: number, threshold: number, rowComplexity: number[], maximumRowComplexity: number) {
  const windows = new Map<string, ReturnType<typeof summarizeWindow>>();
  const windowWidths = [...new Set([.3, .42, .55].map((ratio) => Math.min(width, Math.max(1, Math.round(width * ratio)))))];
  const windowHeights = [...new Set([.3, .42, .54].map((ratio) => Math.min(height, Math.max(1, Math.round(height * ratio)))))];
  for (const windowWidth of windowWidths) for (const windowHeight of windowHeights) {
    const stepX = Math.max(1, Math.floor(windowWidth / 5)); const stepY = Math.max(1, Math.floor(windowHeight / 5));
    const startsX = [...new Set([...Array.from({ length: Math.floor((width-windowWidth)/stepX)+1 },(_,index)=>index*stepX), width-windowWidth])];
    const startsY = [...new Set([...Array.from({ length: Math.floor((height-windowHeight)/stepY)+1 },(_,index)=>index*stepY), height-windowHeight])];
    for (const startX of startsX) for (const startY of startsY) {
      const summary = summarizeWindow(startX,startY,windowWidth,windowHeight,attention,width,height,threshold,rowComplexity,maximumRowComplexity);
      windows.set(`${startX}:${startY}:${windowWidth}:${windowHeight}`,summary);
    }
  }
  return [...windows.values()];
}

function summarizeWindow(startX:number,startY:number,windowWidth:number,windowHeight:number,attention:number[],width:number,height:number,threshold:number,rowComplexity:number[],maximumRowComplexity:number){
  let totalWeight=0;let weightedX=0;let weightedY=0;let active=0;let totalAttention=0;let detail=0;
  for(let cellY=startY;cellY<startY+windowHeight;cellY+=1)for(let cellX=startX;cellX<startX+windowWidth;cellX+=1){
    const index=cellY*width+cellX;const score=attention[index];const weight=Math.max(.003,score-threshold+.018);const x=(cellX+.5)/width;const y=(cellY+.5)/height;
    totalAttention+=score;if(score>=threshold)active+=1;totalWeight+=weight;weightedX+=x*weight;weightedY+=y*weight;detail+=rowComplexity[cellY]/maximumRowComplexity;
  }
  const cells=windowWidth*windowHeight;const x=weightedX/totalWeight;const y=weightedY/totalWeight;const density=active/cells;const meanAttention=totalAttention/cells;const rowDetail=detail/cells;
  const composition=Math.exp(-.5*(((x-.5)/.34)**2+((y-.64)/.25)**2));const compactness=clamp(density*1.45);const foreground=clamp((y-.28)/.32);
  return{x,y,x0:startX/width,y0:startY/height,x1:(startX+windowWidth)/width,y1:(startY+windowHeight)/height,compactness,composition,rank:meanAttention*(.16+composition*.84)*(.4+foreground*.6)*(.7+compactness*.3)*(.68+rowDetail*.32)*(.9+Math.sqrt(cells/(width*height))*.1)};
}

export function calculateLegacyImageFocalPoint(sample: ImageSample): ImageFocalPoint {
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
  const method = point.method === CURRENT_FOCAL_POINT_METHOD ? CURRENT_FOCAL_POINT_METHOD : "saliency-grid-v1";
  const regionValue = point.region; const region = regionValue && [regionValue.x0, regionValue.y0, regionValue.x1, regionValue.y1].every((item) => Number.isFinite(item) && item >= 0 && item <= 1) && regionValue.x0 <= regionValue.x1 && regionValue.y0 <= regionValue.y1 ? { x0:Number(regionValue.x0), y0:Number(regionValue.y0), x1:Number(regionValue.x1), y1:Number(regionValue.y1) } : undefined;
  const visualConfidence = Number(point.visualConfidence); const compositionConfidence = Number(point.compositionConfidence);
  return { x, y, confidence: clamp(confidence), method, sampleWidth: Math.max(1, Math.floor(Number(point.sampleWidth ?? 12))), sampleHeight: Math.max(1, Math.floor(Number(point.sampleHeight ?? 12))), ...(region ? { region } : {}), ...(Number.isFinite(visualConfidence) ? { visualConfidence:clamp(visualConfidence) } : {}), ...(Number.isFinite(compositionConfidence) ? { compositionConfidence:clamp(compositionConfidence) } : {}) };
}

export function focalPointCss(value: unknown) {
  const point = normalizeImageFocalPoint(value);
  return point ? `--focal-x:${round(point.x * 100, 2)}%;--focal-y:${round(point.y * 100, 2)}%` : "";
}
