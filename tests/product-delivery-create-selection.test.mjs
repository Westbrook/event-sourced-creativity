// Exact ten root-executed case bodies; no historical freeze wrapper is replayed.
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { productDeliveryFixture, snapshot, setLocale, seedExistingFixtureHistory, ports, untilScene,
  endpoint, createForms, nativeCreateSelection, seedDependencies } from "./helpers/product-delivery-create-selection-fixture.mjs";
const observations = [];
after(() => {
  console.log("DELIVERY_CREATE_SELECTION_CASES " + JSON.stringify({ expected: 10, observations: observations.length }));
  assert.equal(observations.length, 10, "Every case reaches its current-control observation; setup failures are not product evidence.");
});

const scenarios = ["unchanged", "preceding-removed", "reordered", "chosen-removed", "route-owner-retired"];
for (const locale of ["en", "ja"]) for (const mode of scenarios) test(
  "R4 current Create native owner/dependency continuity " + locale + " / " + mode,
  { concurrency: false, timeout: 30000 }, async t => {
    const f = await productDeliveryFixture(t); setLocale(f, locale); f.nativeUrlParts = true;
    const seeded = seedExistingFixtureHistory(f, locale, false), dependencies = seedDependencies(f, seeded, locale);
    const db = f.storeHost.worker.sqlite, reads = [];
    f.deliver = async (call, response) => {
      assert.equal(call.method, "GET"); assert.equal(call.url, endpoint); assert.equal(response.status, 200);
      const body = await response.clone().json(); assert.ok(Array.isArray(body.report?.owners) && Array.isArray(body.report?.decisions));
      reads.push(body.report); return response; // Same original actual Worker response, never substituted.
    };
    await f.refresh(); f.draw(); assert.equal(reads.length, 1);
    const ownerC = seeded.people[2].userId, dependencyC = dependencies[2].decision_id;
    assert.equal(reads[0].owners.at(-1).userId, ownerC, "The exact C option is last before this controlled transition.");
    assert.deepEqual(reads[0].decisions.map(row => row.decisionId), [seeded.decisionId, ...dependencies.map(row => row.decision_id)]);
    const native = nativeCreateSelection(f), form = native.fillRaw({ title: "  Unsubmitted create 文書  ", audience: "product", evidence: "  Raw evidence B\nنور  " });
    native.choose("ownerUserId", [ownerC]); native.choose("dependencies", [dependencyC]);
    const before = native.observation(), original = snapshot(f), expected = structuredClone(original), callsBefore = f.calls.length;
    assert.equal(original.creates.length, 0); assert.equal(original.updates.length, 0); assert.equal(original.receipts.length, 0);
    assert.deepEqual(before.selectors.ownerUserId.selected, [ownerC]); assert.deepEqual(before.selectors.dependencies.selected, [dependencyC]);
    assert.equal(before.actionable, true); assert.equal(before.ownerRequired, false);
    const fallbackBefore = native.fallbacks.length;
    if (mode === "preceding-removed" || mode === "chosen-removed") {
      const index = mode === "preceding-removed" ? 0 : 2;
      db.prepare("UPDATE users SET role='creator' WHERE user_id=?").run(seeded.people[index].userId);
      db.prepare("DELETE FROM delivery_decisions WHERE decision_id=?").run(dependencies[index].decision_id);
      expected.users.find(row => row.user_id === seeded.people[index].userId).role = "creator";
      expected.decisions = expected.decisions.filter(row => row.decision_id !== dependencies[index].decision_id);
    } else if (mode === "reordered") {
      db.prepare("UPDATE users SET display_name=? WHERE user_id=?").run("zzzz Owner 0", ownerC);
      db.prepare("UPDATE delivery_decisions SET updated_at=? WHERE decision_id=?").run("2026-08-29T00:04:00.000Z", dependencyC);
      expected.users.find(row => row.user_id === ownerC).display_name = "zzzz Owner 0";
      expected.decisions.find(row => row.decision_id === dependencyC).updated_at = "2026-08-29T00:04:00.000Z";
    }
    let retired = null;
    if (mode === "route-owner-retired") {
      f.store.route.set("/product/evaluation"); f.emitWindow("popstate"); f.draw();
      retired = { oldFormDisconnected: form.form.isConnected === false, currentCreateForms: createForms(f).length, calls: f.calls.length - callsBefore };
      assert.equal(retired.oldFormDisconnected, true); assert.equal(retired.currentCreateForms, 0); assert.equal(retired.calls, 0);
      // Standalone retained Delivery has no dashboard Refresh after retirement.
      // Normal platform return remounts it: use public lifecycle and its actual
      // automatic report read, never a private refresh or extra manual GET.
      f.host.isConnected = false; f.host.disconnectedCallback();
      f.store.route.set("/product/delivery");
      f.host.isConnected = true; f.host.connectedCallback();
      await untilScene(() => f.draw().includes("delivery-decision-form"), "The public remount automatically loads the current original Delivery report.");
    } else await f.refresh();
    const after = native.observation(); assert.equal(reads.length, 2);
    assert.deepEqual(f.calls.slice(callsBefore).map(call => [call.method, call.url]), [["GET", endpoint]]);
    assert.equal(f.calls.some(call => call.method !== "GET"), false);
    assert.equal(f.committed.length, 0); assert.equal(f.formResets, 0); assert.deepEqual(f.external, []);
    assert.deepEqual(snapshot(f), expected, "Only declared isolated fixture metadata transitions are permitted; no command/Source/authority/receipt/financial effect.");
    assert.equal(f.store.authorizationScopeActive(original.authorization), true);
    if (mode !== "route-owner-retired") {
      assert.equal(native.current() === form, true); assert.deepEqual(after.raw, before.raw);
      const ownerEligible = reads[1].owners.some(row => row.userId === ownerC), dependencyEligible = reads[1].decisions.some(row => row.decisionId === dependencyC);
      assert.equal(ownerEligible, mode !== "chosen-removed"); assert.equal(dependencyEligible, mode !== "chosen-removed");
      if (mode === "reordered") {
        assert.notDeepEqual(reads[1].owners.map(row => row.userId), reads[0].owners.map(row => row.userId));
        assert.notDeepEqual(reads[1].decisions.map(row => row.decisionId), reads[0].decisions.map(row => row.decisionId));
      }
    }
    const record = { locale, mode, before, after, retired, sameForm: native.retained() === form,
      originalOwner: ownerC, originalDependency: dependencyC,
      ownerOrderBefore: reads[0].owners.map(row => row.userId), ownerOrderAfter: reads[1].owners.map(row => row.userId),
      dependencyOrderBefore: reads[0].decisions.map(row => row.decisionId), dependencyOrderAfter: reads[1].decisions.map(row => row.decisionId),
      selectedOptionCommits: native.commits.filter(commit => before.selectors.ownerUserId.selectedNodes.includes(commit.optionNode) || before.selectors.dependencies.selectedNodes.includes(commit.optionNode)),
      newFallbacks: native.fallbacks.slice(fallbackBefore), commands: 0, creates: 0, updateEvents: 0, providers: 0,
      limits: "Actual unchanged Delivery/Store/RAM Worker GETs; declared synthetic fixture-row transitions; finite native option rules and installed Lit Parts, not browser/OS selectedness or a real authorization mutation." };
    observations.push(record); console.log("DELIVERY_CREATE_SELECTION_OBSERVATION " + JSON.stringify(record));
    if (mode === "route-owner-retired") {
      assert.equal(native.current() === form, false); assert.deepEqual(after.selectors.ownerUserId.selected, [""]);
      assert.deepEqual(after.selectors.dependencies.selected, []); assert.equal(after.raw.title, ""); assert.equal(after.raw.evidence, "");
    } else if (mode === "chosen-removed") {
      assert.equal(after.actionable, false, "Removed selected owner/dependency requires explicit reconciliation; never silently actionable self or no dependency.");
    } else {
      assert.deepEqual({ owner: after.selectors.ownerUserId.selected, dependencies: after.selectors.dependencies.selected },
        { owner: [ownerC], dependencies: [dependencyC] }, "Still-eligible deliberate selections retain exact IDs, never another owner, self, another dependency or none.");
    }
    ports.bindFixture(f);
  });
