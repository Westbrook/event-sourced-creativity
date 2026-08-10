import assert from "node:assert/strict";
import test from "node:test";
import { analyzeImageSample, EXTRACTOR_EVAL_FIXTURES, EXTRACTOR_EVAL_THRESHOLD, runExtractorEvaluation } from "../src/model/extractors.ts";

test("fixed deterministic extractor corpus clears the agreed correction-rate gate", () => {
  const report = runExtractorEvaluation();
  assert.equal(report.corpusVersion, "extractor-corpus-v1");
  assert.equal(report.totalChecks, EXTRACTOR_EVAL_FIXTURES.length * 3);
  assert.equal(report.correctionsRequired, 0);
  assert.ok(report.correctionRate <= EXTRACTOR_EVAL_THRESHOLD);
  assert.equal(report.passed, true);
  assert.ok(report.byExtractor.every((extractor) => extractor.passed));
});

test("extractor evaluation is deterministic and carries usable confidence", () => {
  assert.deepEqual(runExtractorEvaluation(), runExtractorEvaluation());
  for (const fixture of EXTRACTOR_EVAL_FIXTURES) {
    const result = analyzeImageSample(fixture.sample);
    assert.deepEqual(result.dimensions, fixture.expected.dimensions);
    assert.deepEqual(result.palette, fixture.expected.palette);
    assert.equal(result.dominantEdges, fixture.expected.dominantEdges);
    assert.ok(result.confidence.overall >= 0.7 && result.confidence.overall <= 1);
  }
});

test("malformed samples fail closed", () => {
  assert.throws(() => analyzeImageSample({ sourceWidth: 10, sourceHeight: 10, gridWidth: 2, gridHeight: 2, pixels: [[0, 0, 0]] }), /sample_grid_invalid/);
});
