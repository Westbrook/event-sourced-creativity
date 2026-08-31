// Permanent form of the unchanged eight-case root-executed fragment proof.
// Actual Worker/session and full classes; finite history/form ports, not browser.
import assert from "node:assert/strict";
import test from "node:test";
import { originalDraft, rawDraft, posts, values, canonical, currentDelivery, currentCreate, submitCurrent, historyDelivery, platformDeliveryFixture } from "./helpers/product-platform-fragment-fixture.mjs";

for (const attempted of [false, true]) for (const mode of ["none", "skip", "path-departure", "query-departure"])
  test("Product full Platform original custody across native history " + JSON.stringify({ attempted, mode }), { concurrency: false, timeout: 45000 }, async t => {
    const f = await platformDeliveryFixture(t), owner = currentDelivery(f), form = currentCreate(f).form;
    const money = f.financial(), counts = f.storeHost.worker.counts(), session = f.platformSession.get();
    let original = null, originalReceipt = null;
    if (attempted) {
      f.fill(form, originalDraft); f.loseNextCreate = "transport"; await submitCurrent(f);
      assert.equal(f.committed.length, 1); assert.equal(f.committed[0].status, 201);
      assert.equal(f.decisions().length, 1); assert.equal(f.creationEvents().length, 1); assert.equal(f.formResets, 0);
      original = structuredClone(posts(f)[0].body); originalReceipt = structuredClone(f.committed[0].receipt);
      assert.ok(originalReceipt.receipt?.eventId); assert.match(currentCreate(f).button.text, /Retry original save/u);
    }
    f.fill(form, rawDraft); f.draw(); assert.equal(currentCreate(f).form === form, true);
    assert.deepEqual(values(f, form), { title: rawDraft.title, evidence: rawDraft.evidence });
    const before = canonical(f), postCount = posts(f).length, reads = f.calls.filter(call => call.method === "GET").length, traversals = [];
    if (mode === "skip") traversals.push(await historyDelivery(f, "#main-content", { skip: true }));
    else if (mode === "path-departure") {
      traversals.push(await historyDelivery(f, "/product/insights"));
      assert.equal(currentDelivery(f), null); assert.equal(owner.isConnected, false);
      traversals.push(await historyDelivery(f, "/product/delivery"));
    } else if (mode === "query-departure") {
      traversals.push(await historyDelivery(f, "/product/delivery?sort=recent"));
      traversals.push(await historyDelivery(f, "/product/delivery"));
    } else await f.settle();
    const current = currentCreate(f), observed = { attempted, mode, traversals, sameOwner: current.owner === owner,
      sameForm: current.form === form, oldFormConnected: form.isConnected, currentDraft: values(f, current.form),
      currentButton: current.button.text, originalRequestId: original?.requestId ?? null, originalEventId: originalReceipt?.receipt?.eventId ?? null,
      postCountBefore: postCount, postCountAfter: posts(f).length, additionalReads: f.calls.filter(call => call.method === "GET").length - reads,
      canonicalDecisionCount: f.decisions().length, canonicalEventCount: f.creationEvents().length };
    // Observe before desired assertions, so a liveness failure still records
    // actual current ownership/action/draft and original canonical identity.
    console.log("PRODUCT_PLATFORM_FRAGMENT_OBSERVATION " + JSON.stringify(observed));
    assert.equal(posts(f).length, postCount, "history never retries or creates automatically");
    assert.deepEqual(canonical(f), before); assert.deepEqual(f.financial(), money); assert.deepEqual(f.storeHost.worker.counts(), counts);
    assert.equal(f.platformSession.get() === session, true); assert.deepEqual(f.external, []);
    if (mode === "none" || mode === "skip") {
      assert.deepEqual(values(f, current.form), { title: rawDraft.title, evidence: rawDraft.evidence }, "same-resource Skip preserves the current raw native draft");
      assert.equal(current.owner === owner, true, "same-resource Skip keeps the original private form owner");
      assert.equal(current.form === form, true);
      assert.equal(current.button.text, f.i18n.t(attempted ? "delivery.retryOriginal" : "delivery.add", attempted ? "Retry original save" : "Add delivery decision"));
      await submitCurrent(f);
      assert.equal(posts(f).length, postCount + 1); assert.equal(f.decisions().length, 1); assert.equal(f.creationEvents().length, 1);
      if (attempted) {
        assert.deepEqual(posts(f).at(-1).body, original); assert.deepEqual(f.committed.at(-1).receipt, originalReceipt);
        assert.deepEqual(canonical(f), before, "explicit same-original retry recovers A without a second canonical decision/event");
        assert.equal(f.formResets, 0); assert.deepEqual(values(f, currentCreate(f).form), { title: rawDraft.title, evidence: rawDraft.evidence });
      } else {
        assert.equal(posts(f)[0].body.title, rawDraft.title.trim()); assert.equal(posts(f)[0].body.evidence, rawDraft.evidence.trim());
        assert.equal(f.committed[0].status, 201); assert.equal(f.formResets, 1);
      }
    } else {
      assert.equal(current.owner === owner, false); assert.equal(form.isConnected, false);
      assert.deepEqual(values(f, current.form), { title: "", evidence: "" }, "real pathname/query departure retires old private draft ownership");
      assert.equal(current.button.text, f.i18n.t("delivery.add", "Add delivery decision"));
      assert.equal(posts(f).length, postCount, "no old detached control is invoked after departure");
    }
    assert.deepEqual(f.financial(), money); assert.deepEqual(f.storeHost.worker.counts(), counts); assert.deepEqual(f.external, []);
  });
