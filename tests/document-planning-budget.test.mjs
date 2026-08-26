import assert from "node:assert/strict";
import test from "node:test";
import { documentPlanningTokenReservation, documentRenderTokenReservation, presentationTokenReservation } from "../src/model/generation-budget.ts";

test("all document forms reuse the bounded planning allowance without consuming media reserves",()=>{
  assert.equal(documentPlanningTokenReservation(),128_000);
  assert.equal(presentationTokenReservation(),128_000);
  for(const kind of ["short_story","scene","slides","audio"])assert.equal(documentRenderTokenReservation(kind),128_000);
  assert.equal(documentRenderTokenReservation("storyboard",8),320_000);
  assert.equal(documentRenderTokenReservation("video",8),152_000);
  assert.equal(documentPlanningTokenReservation(8),256_000);
  assert.equal(documentRenderTokenReservation("storyboard",16,8),640_000);
});
