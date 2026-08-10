export type RGB = [number, number, number];

export type ImageSample = {
  sourceWidth: number;
  sourceHeight: number;
  gridWidth: number;
  gridHeight: number;
  pixels: RGB[];
};

export type ExtractedImageFacts = {
  dimensions: { width: number; height: number; aspectRatio: number; orientation: "landscape" | "portrait" | "square" };
  palette: string[];
  dominantEdges: "vertical" | "horizontal" | "balanced";
  confidence: { dimensions: number; palette: number; dominantEdges: number; overall: number };
};

export type ExtractorEvaluationResult = {
  fixtureId: string;
  fixtureLabel: string;
  property: "dimensions" | "palette" | "dominant_edges";
  extractor: string;
  expected: unknown;
  actual: unknown;
  confidence: number;
  correctionRequired: boolean;
  correctionDirection: string;
};

export type ExtractorEvaluationReport = {
  corpusVersion: string;
  threshold: number;
  totalChecks: number;
  correctionsRequired: number;
  correctionRate: number;
  averageConfidence: number;
  passed: boolean;
  results: ExtractorEvaluationResult[];
  byExtractor: Array<{ extractor: string; checks: number; correctionsRequired: number; correctionRate: number; averageConfidence: number; passed: boolean }>;
};

const FIXTURE_CORPUS_VERSION = "extractor-corpus-v1";
export const EXTRACTOR_EVAL_THRESHOLD = 0.1;

const repeatRows = (rows: RGB[][]) => ({
  gridWidth: rows[0].length,
  gridHeight: rows.length,
  pixels: rows.flat(),
});

const DARK: RGB = [39, 37, 43];
const CREAM: RGB = [232, 215, 189];
const BLUE: RGB = [100, 140, 165];
const SAND: RGB = [217, 183, 127];
const INK: RGB = [32, 36, 42];
const PAPER: RGB = [226, 221, 209];

/**
 * Immutable synthetic references. These fixtures are intentionally declared before
 * the extractor implementation so the quality bar cannot move with the algorithm.
 */
export const EXTRACTOR_EVAL_FIXTURES: ReadonlyArray<{
  id: string;
  label: string;
  sample: ImageSample;
  expected: Pick<ExtractedImageFacts, "dimensions" | "palette" | "dominantEdges">;
}> = [
  {
    id: "warm-window",
    label: "Warm window split",
    sample: { sourceWidth: 1600, sourceHeight: 1000, ...repeatRows(Array.from({ length: 4 }, () => [DARK, DARK, CREAM, CREAM])) },
    expected: { dimensions: { width: 1600, height: 1000, aspectRatio: 1.6, orientation: "landscape" }, palette: ["#27252b", "#e8d7bd"], dominantEdges: "vertical" },
  },
  {
    id: "coastal-horizon",
    label: "Coastal horizon",
    sample: { sourceWidth: 1200, sourceHeight: 1600, ...repeatRows([[BLUE, BLUE, BLUE, BLUE], [BLUE, BLUE, BLUE, BLUE], [SAND, SAND, SAND, SAND], [SAND, SAND, SAND, SAND]]) },
    expected: { dimensions: { width: 1200, height: 1600, aspectRatio: 0.75, orientation: "portrait" }, palette: ["#648ca5", "#d9b77f"], dominantEdges: "horizontal" },
  },
  {
    id: "balanced-grid",
    label: "Balanced graphic grid",
    sample: { sourceWidth: 900, sourceHeight: 900, ...repeatRows([[INK, PAPER, INK, PAPER], [PAPER, INK, PAPER, INK], [INK, PAPER, INK, PAPER], [PAPER, INK, PAPER, INK]]) },
    expected: { dimensions: { width: 900, height: 900, aspectRatio: 1, orientation: "square" }, palette: ["#20242a", "#e2ddd1"], dominantEdges: "balanced" },
  },
] as const;

const clampChannel = (value: number) => Math.max(0, Math.min(255, Math.round(value)));
const hex = ([r, g, b]: RGB) => `#${[r, g, b].map((value) => clampChannel(value).toString(16).padStart(2, "0")).join("")}`;
const distance = (a: RGB, b: RGB) => Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
const luminance = ([r, g, b]: RGB) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const round = (value: number, precision = 4) => Number(value.toFixed(precision));

function validateSample(sample: ImageSample) {
  const sizes = [sample.sourceWidth, sample.sourceHeight, sample.gridWidth, sample.gridHeight];
  if (!sizes.every((value) => Number.isInteger(value) && value > 0)) throw new Error("sample_dimensions_invalid");
  if (sample.gridWidth * sample.gridHeight !== sample.pixels.length || sample.pixels.length > 4096) throw new Error("sample_grid_invalid");
  if (!sample.pixels.every((pixel) => Array.isArray(pixel) && pixel.length === 3 && pixel.every((value) => Number.isFinite(value) && value >= 0 && value <= 255))) throw new Error("sample_pixels_invalid");
}

function paletteKMeans(pixels: RGB[], requested = 4) {
  const unique = [...new Map(pixels.map((pixel) => [hex(pixel), pixel])).values()].sort((a, b) => hex(a).localeCompare(hex(b)));
  const k = Math.min(requested, unique.length);
  let centroids = Array.from({ length: k }, (_, index) => [...unique[Math.round(index * (unique.length - 1) / Math.max(1, k - 1))]] as RGB);
  let assignments = new Array(pixels.length).fill(0) as number[];
  for (let iteration = 0; iteration < 8; iteration += 1) {
    assignments = pixels.map((pixel) => {
      let best = 0;
      for (let index = 1; index < centroids.length; index += 1) if (distance(pixel, centroids[index]) < distance(pixel, centroids[best])) best = index;
      return best;
    });
    centroids = centroids.map((centroid, index) => {
      const members = pixels.filter((_, pixelIndex) => assignments[pixelIndex] === index);
      if (!members.length) return centroid;
      return [0, 1, 2].map((channel) => members.reduce((sum, pixel) => sum + pixel[channel], 0) / members.length) as RGB;
    });
  }
  const ranked = centroids.map((centroid, index) => ({ color: hex(centroid), count: assignments.filter((assignment) => assignment === index).length, centroid }))
    .filter((entry) => entry.count > 0)
    .sort((a, b) => b.count - a.count || a.color.localeCompare(b.color));
  const separation = ranked.length < 2 ? 0 : Math.min(...ranked.flatMap((entry, index) => ranked.slice(index + 1).map((other) => distance(entry.centroid, other.centroid)))) / 441.67;
  const confidence = round(Math.min(0.99, 0.62 + separation * 0.35 + Math.min(0.02, pixels.length / 10000)));
  return { colors: ranked.map((entry) => entry.color), confidence };
}

function dominantEdges(sample: ImageSample) {
  let verticalEnergy = 0;
  let horizontalEnergy = 0;
  const at = (x: number, y: number) => luminance(sample.pixels[y * sample.gridWidth + x]);
  for (let y = 0; y < sample.gridHeight; y += 1) for (let x = 1; x < sample.gridWidth; x += 1) verticalEnergy += Math.abs(at(x, y) - at(x - 1, y));
  for (let y = 1; y < sample.gridHeight; y += 1) for (let x = 0; x < sample.gridWidth; x += 1) horizontalEnergy += Math.abs(at(x, y) - at(x, y - 1));
  const total = verticalEnergy + horizontalEnergy;
  const difference = total ? Math.abs(verticalEnergy - horizontalEnergy) / total : 0;
  const value = difference < 0.12 ? "balanced" : verticalEnergy > horizontalEnergy ? "vertical" : "horizontal";
  return { value: value as ExtractedImageFacts["dominantEdges"], confidence: round(value === "balanced" ? 1 - difference : 0.58 + difference * 0.4) };
}

export function analyzeImageSample(sample: ImageSample): ExtractedImageFacts {
  validateSample(sample);
  const aspectRatio = round(sample.sourceWidth / sample.sourceHeight);
  const dimensions = { width: sample.sourceWidth, height: sample.sourceHeight, aspectRatio, orientation: (Math.abs(aspectRatio - 1) < 0.03 ? "square" : aspectRatio > 1 ? "landscape" : "portrait") as ExtractedImageFacts["dimensions"]["orientation"] };
  const palette = paletteKMeans(sample.pixels);
  const edges = dominantEdges(sample);
  const confidence = { dimensions: 1, palette: palette.confidence, dominantEdges: edges.confidence, overall: round((1 + palette.confidence + edges.confidence) / 3) };
  return { dimensions, palette: palette.colors, dominantEdges: edges.value, confidence };
}

const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

export function runExtractorEvaluation(): ExtractorEvaluationReport {
  const results = EXTRACTOR_EVAL_FIXTURES.flatMap((fixture): ExtractorEvaluationResult[] => {
    const actual = analyzeImageSample(fixture.sample);
    return [
      { fixtureId: fixture.id, fixtureLabel: fixture.label, property: "dimensions", extractor: "dimensions-v1", expected: fixture.expected.dimensions, actual: actual.dimensions, confidence: actual.confidence.dimensions, correctionRequired: !same(fixture.expected.dimensions, actual.dimensions), correctionDirection: "none" },
      { fixtureId: fixture.id, fixtureLabel: fixture.label, property: "palette", extractor: "palette-kmeans-v1", expected: fixture.expected.palette, actual: actual.palette, confidence: actual.confidence.palette, correctionRequired: !same(fixture.expected.palette, actual.palette), correctionDirection: "none" },
      { fixtureId: fixture.id, fixtureLabel: fixture.label, property: "dominant_edges", extractor: "dominant-edges-v1", expected: fixture.expected.dominantEdges, actual: actual.dominantEdges, confidence: actual.confidence.dominantEdges, correctionRequired: fixture.expected.dominantEdges !== actual.dominantEdges, correctionDirection: "none" },
    ];
  });
  const correctionsRequired = results.filter((result) => result.correctionRequired).length;
  const correctionRate = round(correctionsRequired / results.length);
  const averageConfidence = round(results.reduce((sum, result) => sum + result.confidence, 0) / results.length);
  const byExtractor = [...new Set(results.map((result) => result.extractor))].map((extractor) => {
    const checks = results.filter((result) => result.extractor === extractor);
    const corrections = checks.filter((result) => result.correctionRequired).length;
    const rate = round(corrections / checks.length);
    return { extractor, checks: checks.length, correctionsRequired: corrections, correctionRate: rate, averageConfidence: round(checks.reduce((sum, result) => sum + result.confidence, 0) / checks.length), passed: rate <= EXTRACTOR_EVAL_THRESHOLD };
  });
  return { corpusVersion: FIXTURE_CORPUS_VERSION, threshold: EXTRACTOR_EVAL_THRESHOLD, totalChecks: results.length, correctionsRequired, correctionRate, averageConfidence, passed: correctionRate <= EXTRACTOR_EVAL_THRESHOLD && byExtractor.every((entry) => entry.passed), results, byExtractor };
}
