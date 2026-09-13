import assert from "node:assert/strict";
import test from "node:test";
import { experienceHostRoute, hasExperienceHostSelector, isStandaloneExperienceRoute, parseExperienceHostRoute } from "../src/experiences/host-route.ts";

test("standalone entry transport accepts only the catalog and closed two-output paths", () => {
  for (const path of ["/experiences", "/experiences/image", "/experiences/slides"])
    for (const suffix of ["", "/", "?progress-report=return", "/?progress-report=return&resume=id"])
      assert.equal(isStandaloneExperienceRoute(path + suffix), true, path + suffix);
});

test("standalone entry transport leaves ordinary and malformed paths outside the full-page boundary", () => {
  for (const path of ["/", "/document/Doc-1?experience=image", "/make/slides", "/library", "/experiences/video",
    "/experiences/image/more", "/experiences//", "/experiences/Image", "/Experiences", "/experiences#", "/experiences#result",
    "/prefix/../experiences", "/experiences/./image", "/%65xperiences", "/experiences%2fimage", "/experiences\\image",
    "https://forma.local/experiences", "//forma.local/experiences", "/experiences\n", "/experiences?q=" + "x".repeat(4096)])
    assert.equal(isStandaloneExperienceRoute(path), false, path.slice(0, 120));
});

const draftId = "experience-draft-" + "a".repeat(64);
const route = `/document/Doc-1/deck?experience=slides&experience-draft=${draftId}`;

test("round trips both selectors and preserves the independent report return query", () => {
  for (const output of ["image", "slides"] as const) {
    for (const documentRoute of ["/document/Doc-1", "/document/Doc-1/deck?progress-report=return"]) {
      const encoded = experienceHostRoute(documentRoute, output, draftId);
      const selection = parseExperienceHostRoute(encoded);
      assert.deepEqual(selection, { output, draftId, documentId: "Doc-1", documentRoute });
      assert.equal(hasExperienceHostSelector(encoded), true);
      assert.ok(selection && Object.isFrozen(selection));
    }
  }
});

test("rejects nonlocal, malformed and oversized route authority", () => {
  for (const invalid of [
    "https://forma.local" + route, "https://other.test" + route, "//other.test" + route,
    route.replace("/document/", "/document\\"), route + "\n", route + "#fragment",
    route.replace("/document/Doc-1", "/document/_invalid"), route.replace("/deck?", "/deck/extra?"),
    route.replace("Doc-1", "a".repeat(161)), route.replace("/deck?", "/" + "a".repeat(4096) + "?"),
  ]) assert.equal(parseExperienceHostRoute(invalid), null, invalid.slice(0, 120));
});

test("rejects incomplete, unsupported, duplicated and unrelated selector parameters", () => {
  for (const invalid of [
    "/document/Doc-1?experience=image", `/document/Doc-1?experience-draft=${draftId}`,
    route.replace("experience=slides", "experience=video"), route.replace(draftId, "experience-draft-invalid"),
    route + "&experience=image", route + `&experience-draft=${draftId}`,
    route + "&progress-report=one&progress-report=two", route + "&grant=untrusted",
  ]) assert.equal(parseExperienceHostRoute(invalid), null, invalid);
});

test("presence detection remains true for invalid authority without granting a parsed selection", () => {
  for (const invalid of [
    "/elsewhere?experience=unknown", "/document/Doc-1?experience=", "/document/Doc-1?experience-draft=",
    "https://other.test" + route, route + "&experience=image", route + "#fragment",
    "/document/Doc-1?%65xperience=unknown", "/document/Doc-1?experience%2Ddraft=invalid",
  ]) {
    assert.equal(hasExperienceHostSelector(invalid), true, invalid);
    assert.equal(parseExperienceHostRoute(invalid), null, invalid);
  }
  assert.equal(hasExperienceHostSelector("/" + "x".repeat(131072)), true);
});

test("presence detection ignores fragments, values and similarly named unrelated keys", () => {
  for (const absent of [
    "/document/Doc-1", "/document/Doc-1?progress-report", "/document/Doc-1#?experience=image",
    "/document/Doc-1?progress-report=value#?experience=image", "/document/Doc-1?other=experience",
    "/document/Doc-1?experience-other=image", "/document/Doc-1?Experience=image",
  ]) assert.equal(hasExperienceHostSelector(absent), false, absent);
});

test("builder refuses existing selectors or invalid base routes instead of replacing authority", () => {
  for (const invalid of [
    route, "/document/Doc-1?experience=", "/document/Doc-1?experience-draft=",
    "/document/Doc-1?unknown=value", "/document/Doc-1#fragment", "https://other.test/document/Doc-1",
  ]) assert.throws(() => experienceHostRoute(invalid, "image", draftId), /experience_route_invalid/);
  assert.throws(() => experienceHostRoute("/document/Doc-1", "image", "invalid-draft"), /experience_route_invalid/);
});
