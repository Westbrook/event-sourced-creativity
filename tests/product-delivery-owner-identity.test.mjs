// Eight root-executed desired/healthy case bodies are unchanged from the TMP
// R3 baseline. Current integration owns source pins; no old guard is repinned.
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { productDeliveryFixture } from "./helpers/product-delivery-native-fixture.mjs";
import { nativeUpdateForms, endpoint } from "./helpers/product-delivery-update-draft-fixture.mjs";
import { snapshot, setLocale, seedExistingFixtureHistory, choices } from "./helpers/product-delivery-owner-choice-fixture.mjs";
const observations = [];
after(() => { assert.equal(observations.length, 8, "Every current case reached both actual choice surfaces before its desired assertion."); });

for (const locale of ["en", "fr", "ar", "ja"]) for (const colliding of [false, true]) test(
  "B3 R3 Delivery Owner choices " + locale + " " + (colliding ? "same-name desired distinction" : "unique-name control"),
  { timeout: 30000, concurrency: false }, async t => {
    const f = nativeUpdateForms(await productDeliveryFixture(t)); setLocale(f, locale);
    const seeded = seedExistingFixtureHistory(f, locale, colliding);
    const before = snapshot(f), callsBefore = f.calls.length, reads = [];
    f.deliver = async (call, response) => {
      assert.equal(call.url, endpoint); assert.equal(call.method, "GET"); assert.equal(response.status, 200);
      const body = await response.clone().json(); assert.ok(Array.isArray(body.report?.owners));
      reads.push({ status: response.status, report: body.report }); return response;
    };
    await f.refresh(); f.draw();
    assert.equal(reads.length, 1); const owners = reads[0].report.owners;
    assert.equal(owners.length, seeded.people.length + 1);
    for (const person of seeded.people) assert.deepEqual(owners.find(item => item.userId === person.userId),
      { userId: person.userId, displayName: person.name }, "The real authorized report supplies this exact fixture person.");
    assert.equal(f.platformSession.get().user.userId, seeded.currentOwner);
    assert.ok(f.platformSession.get().capabilities.includes("product.delivery.manage"));
    const first = choices(f, seeded, owners);
    // A second ordinary current read checks stable identity without mutating
    // server order, substituting a response, or reaching a stale callback.
    await f.refresh(); const second = choices(f, seeded, reads.at(-1).report.owners);
    const stableChoice = surface => ({ kind: surface.kind, decisionId: surface.decisionId,
      associatedLabel: surface.associatedLabel, formContext: surface.formContext,
      surroundingContext: surface.surroundingContext, submitterText: surface.submitterText, choices: surface.choices });
    assert.deepEqual(second.map(stableChoice), first.map(stableChoice),
      "Same current read preserves exact choice context; the global report's refreshed timestamp is not frozen.");
    assert.deepEqual(snapshot(f), before, "No account authority, Source, decision, receipt, grant, event or financial row changed after setup.");
    assert.equal(f.formResets, 0); assert.equal(f.committed.length, 0); assert.deepEqual(f.external, []);
    const observationCalls = f.calls.slice(callsBefore);
    assert.deepEqual(observationCalls.map(call => [call.method, call.url]), [["GET", endpoint], ["GET", endpoint]]);
    assert.equal(f.calls.filter(call => call.method !== "GET").length, 0, "No application submit/grant/hold/provider request, including fixture construction.");
    const distinct = first.map(surface => ({ kind: surface.kind,
      visibleCount: new Set(surface.choices.map(item => item.visibleText)).size, exactCount: surface.choices.length }));
    observations.push({ locale, colliding, currentPrincipal: seeded.currentOwner, decisionId: seeded.decisionId,
      qualifierShapedName: seeded.qualifierShaped, currentWorkerReports: reads.length, surfaces: first, distinct,
      readOnlyAfterExplicitRamSetup: true, sourceAndAuthorityUnchanged: true, grantsSubmitted: 0,
      deliverySubmissions: 0, holdsSubmitted: 0, providerCalls: 0,
      limits: "Complete actual component/session/Store/routed RAM Worker; synthetic pre-existing admin-user and milestone fixture rows; finite native TemplateResult ports, not physical DOM/OS picker/AT or live account authority." });
    console.log("DELIVERY_OWNER_CHOICE_OBSERVATION " + JSON.stringify(observations.at(-1)));
    assert.ok(distinct.every(item => item.visibleCount === item.exactCount),
      "Both actual owner selectors require distinct complete visible text for different eligible owners; hidden exact IDs are not visible choice identity.");
  });
