import assert from "node:assert/strict";
import test from "node:test";

import { presentationRequiresReadingPosture } from "../src/model/presentation-layout.ts";
import { presentationUsesReadingView } from "../src/model/presentation-view-posture.ts";

test("pitch and feedback desktop slides start and remain visual when delivery content fits", () => {
  for (const [width, height] of [[591, 333], [707, 504], [744, 419], [960, 540], [1280, 720]]) {
    assert.equal(presentationUsesReadingView({
      contentOverflows: false,
      readingPreference: null,
      viewportRequiresReading: presentationRequiresReadingPosture(width, height),
    }), false, `${width}×${height} should preserve a composed visual slide`);
  }
});

test("genuinely narrow and short viewports retain their accessible automatic reading alternative", () => {
  for (const [width, height] of [[320, 568], [390, 844], [844, 250]]) {
    assert.equal(presentationUsesReadingView({
      contentOverflows: false,
      readingPreference: null,
      viewportRequiresReading: presentationRequiresReadingPosture(width, height),
    }), true, `${width}×${height} should provide readable delivery content`);
  }
});

test("meaningful measured clipping safely defaults to complete reading without becoming irreversible", () => {
  assert.equal(presentationUsesReadingView({
    contentOverflows: true,
    readingPreference: null,
    viewportRequiresReading: false,
  }), true, "unclipped delivery remains the safe automatic default");

  assert.equal(presentationUsesReadingView({
    contentOverflows: true,
    readingPreference: false,
    viewportRequiresReading: false,
  }), false, "an intentional Slide view action can restore its structured visual");
});

test("intentional reading stays selected after slides fit and while the viewport changes", () => {
  for (const viewportRequiresReading of [false, true]) {
    for (const contentOverflows of [false, true]) {
      assert.equal(presentationUsesReadingView({
        contentOverflows,
        readingPreference: true,
        viewportRequiresReading,
      }), true, "reader selection is a persistent accessibility choice");
    }
  }
});

test("a resized viewport reevaluates automatic posture without replacing an intentional choice", () => {
  const narrow = presentationRequiresReadingPosture(390, 844);
  const restored = presentationRequiresReadingPosture(707, 504);

  assert.equal(presentationUsesReadingView({
    contentOverflows: false,
    readingPreference: null,
    viewportRequiresReading: narrow,
  }), true);
  assert.equal(presentationUsesReadingView({
    contentOverflows: false,
    readingPreference: null,
    viewportRequiresReading: restored,
  }), false);

  assert.equal(presentationUsesReadingView({
    contentOverflows: false,
    readingPreference: true,
    viewportRequiresReading: restored,
  }), true);
});
