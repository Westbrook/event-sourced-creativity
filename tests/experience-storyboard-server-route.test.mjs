import test from "node:test";
import assert from "node:assert/strict";
import { resolveServerRoute } from "../src/platform/applications.ts";
import { isStandaloneExperienceRoute, parseExperienceHostRoute } from "../src/experiences/host-route.ts";
import { parseExperienceEntryRoute } from "../src/experiences/intake.ts";

test("Actual server resolver selects Storyboard intake HTML without enabling native routes", () => {
  const expected = { application: "creative", entryPath: "/experiences", canonicalFamily: "/experiences/storyboard" };
  for (const route of ["/experiences/storyboard", "/experiences/storyboard/", "/experiences/storyboard?progress-report", "/experiences/storyboard?draft=experience-draft-" + "a".repeat(64)]) {
    assert.deepEqual(resolveServerRoute(route), expected);
    assert.equal(isStandaloneExperienceRoute(route), true);
    assert(parseExperienceEntryRoute(new URL(route, "https://forma.test")));
  }
  for (const id of ["image", "slides", "short-story", "scene", "model3d"]) {
    assert.deepEqual(resolveServerRoute("/experiences/" + id), { application: "creative", entryPath: "/experiences", canonicalFamily: "/experiences/" + id });
  }
  for (const route of ["/experiences/storyboard/native", "/native/storyboard", "/experiences/storyboard-provider"]) {
    assert.equal(resolveServerRoute(route), null);
    assert.equal(isStandaloneExperienceRoute(route), false);
  }
  assert.deepEqual(resolveServerRoute("/make/storyboard"), { application: "creative", entryPath: "/creative/", canonicalFamily: "/make/storyboard" });
  assert.equal(parseExperienceHostRoute("/document/saved-board/storyboard?experience=storyboard&experience-draft=experience-draft-" + "a".repeat(64)), null);
});
