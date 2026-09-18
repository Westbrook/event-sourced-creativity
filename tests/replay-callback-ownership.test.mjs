import assert from "node:assert/strict";
import { test, deferred, until, replayCallbacks, PRIVATE, estimateBody, persona, row, retryBody } from "./helpers/replay-callback-native.mjs";

// These22 actual-component/finite-HTTP cases preserve the original callback
// baseline assertions, including exact identity/null boolean operands. No test
// invokes a real Replay/persona/provider/financial operation.
for (const denied of [false, true]) test("B3 R2 callback estimate " + (denied ? "cannot publish after current denial" : "healthy current reply publishes"), async t => {
  const f = await replayCallbacks(t), deny = denied ? await f.startDenial() : null, gate = deferred();
  f.replay.postHandlers.set("/api/replay-sessions/estimate", () => gate.promise);
  const pending = f.click(f.control("#estimate"));
  try {
    await until(() => f.postCount("/api/replay-sessions/estimate") === 1, "finite estimate held");
    let denialStatus = "";
    if (deny) {
      await deny(); f.draw();
      denialStatus = f.tree.nodes.filter(node => node.attributes.role === "status").map(node => node.text).join("\n");
      assert.ok(denialStatus.trim(), "current known refusal has visible nonempty status before the old reply");
    }
    gate.resolve(Response.json(estimateBody())); await pending;
    const published = f.draw().includes("$987.65");
    t.diagnostic(JSON.stringify({ denied, lateEstimateVisible: published }));
    assert.equal(published, !denied);
    if (denied) {
      f.draw();
      const currentStatus = f.tree.nodes.filter(node => node.attributes.role === "status").map(node => node.text).join("\n");
      assert.equal(currentStatus, denialStatus, "late estimate must not erase or replace the current localized denial");
      assert.ok(!f.draw().includes(PRIVATE.title), "private list is not recertified by the old estimate");
      assert.equal(f.renderer.ownNodes(f.host, "input").some(node => node.attributes.name === "phrase" && node.attributes.placeholder === PRIVATE.phrase), false,
        "private approval configuration is not recertified by the old estimate");
    }
  } finally { gate.resolve(Response.json(estimateBody())); await pending; }
});

for (const denied of [false, true]) test("B3 R2 callback persona preparation " + (denied ? "does not start a late recertifying read" : "healthy current acknowledgment refreshes"), async t => {
  const f = await replayCallbacks(t, "complete"), deny = denied ? await f.startDenial() : null, gate = deferred();
  const endpoint = "/api/replay-sessions/callback-owned-A/persona";
  f.replay.postHandlers.set(endpoint, () => gate.promise);
  const pending = f.click(f.control("#preparePersona"));
  try {
    await until(() => f.postCount(endpoint) === 1, "finite persona preparation held");
    if (deny) await deny(); const before = f.replay.gets.length;
    gate.resolve(Response.json({ prepared: true })); await pending; f.draw();
    assert.equal(f.replay.gets.length - before, denied ? 0 : 1, "retired command cannot perform another automatic private read");
    if (denied) assert.ok(!f.draw().includes(PRIVATE.title));
    else assert.ok(f.draw().includes(PRIVATE.title));
  } finally { gate.resolve(Response.json({ prepared: true })); await pending; }
});

for (const denied of [false, true]) test("B3 R2 callback persona opening after updateComplete " + (denied ? "cannot reopen or steal focus after denial" : "healthy opens and focuses its field"), async t => {
  const f = await replayCallbacks(t, "persona"), deny = denied ? await f.startDenial() : null, gate = deferred();
  f.holdUpdate = gate;
  const pending = f.click(f.control("#requestPersona"));
  try {
    await until(() => f.updateWaits === 1, "actual opening awaits its native updateComplete port");
    if (deny) await deny();
    const other = f.native("button"); f.owner.append(other); if (denied) other.focus();
    gate.resolve(true); await pending;
    const dialog = f.personaDialog();
    t.diagnostic(JSON.stringify({ denied, dialogVisible: Boolean(dialog), shows: f.replay.shows.length, focusedName: f.doc.activeElement?.attributes?.name ?? null }));
    if (denied) { assert.equal(dialog === null, true); assert.equal(f.replay.shows.length, 0); assert.equal(f.doc.activeElement === other, true); }
    else { assert.ok(dialog?.open); assert.equal(f.replay.shows.length, 1); assert.equal(f.doc.activeElement?.attributes?.name, "confirmation"); }
    assert.equal(f.replay.posts.length, 0);
  } finally { gate.resolve(true); await pending; }
});

for (const denied of [false, true]) test("B3 R2 callback persona confirmation " + (denied ? "does not navigate after denial" : "healthy exact finite reply navigates once"), async t => {
  const f = await replayCallbacks(t, "persona"), deny = denied ? await f.startDenial() : null, gate = deferred();
  await f.click(f.control("#requestPersona")); assert.ok(f.personaDialog()?.open);
  f.replay.postHandlers.set("/api/impersonation", () => gate.promise);
  const pending = f.submit("#confirmPersona", { confirmation: "I understand, continue", personaAcknowledged: "yes" });
  try {
    await until(() => f.postCount("/api/impersonation") === 1, "finite persona confirmation held");
    if (deny) await deny();
    gate.resolve(Response.json({ route: "/document/finite-fictional-A" })); await pending;
    assert.deepEqual(f.replay.posts.find(call => call.url === "/api/impersonation").body, { personaId: "finite-persona-A", confirmation: "I understand, continue" });
    assert.deepEqual(f.replay.navigation, denied ? [] : ["/document/finite-fictional-A"]);
  } finally { gate.resolve(Response.json({ route: "/document/finite-fictional-A" })); await pending; }
});

for (const denied of [false, true]) test("B3 R2 callback retry settings " + (denied ? "do not publish or estimate after denial" : "healthy finite receipt restores exact settings only"), async t => {
  const f = await replayCallbacks(t), deny = denied ? await f.startDenial() : null, gate = deferred(), endpoint = "/api/replay-sessions/callback-owned-A/retry";
  f.replay.postHandlers.set(endpoint, () => gate.promise);
  const pending = f.click(f.control("#retry"));
  try {
    await until(() => f.postCount(endpoint) === 1, "finite declared-settled retry response held");
    if (deny) await deny();
    gate.resolve(Response.json(retryBody())); await pending; f.draw();
    const seeds = f.renderer.ownNodes(f.host, "textarea").map(node => node.value);
    assert.equal(f.postCount("/api/replay-sessions/estimate"), denied ? 0 : 1, "old reply must not chain another estimate after retirement");
    assert.equal(seeds.includes(PRIVATE.seed), !denied);
    assert.equal(f.postCount("/api/replay-sessions/approval"), 0); assert.equal(f.postCount("/api/replay-sessions"), 0);
    if (!denied) assert.deepEqual(f.replay.posts.find(call => call.url === "/api/replay-sessions/estimate").body,
      { seed: PRIVATE.seed, eventCount: 321, providerCoverage: "finite-coverage", studyTypes: ["finite-study"], experienceProfile: "finite-profile" });
  } finally { gate.resolve(Response.json(retryBody())); await pending; }
});

for (const replacement of ["none", "same", "different"]) test("B3 R2 callback native persona close " + (replacement === "none" ? "healthy current cancellation closes only its opening" : "cannot clear a newer " + replacement + " persona opening"), async t => {
  const f = await replayCallbacks(t, "persona");
  const newer = replacement !== "none";
  await f.click(f.control("#requestPersona")); const old = f.personaDialog(); assert.ok(old?.open);
  await f.click(f.control("#dismissPersona")); f.draw();
  assert.equal(f.replay.closes.length, 1, "the close event is captured at the real current Cancel's native close boundary");
  assert.equal(f.personaDialog() === null, true);
  if (newer) {
    if (replacement === "different") { f.replay.row = { ...f.replay.row, persona: persona(true) }; await f.refresh(); }
    await f.click(f.control("#requestPersona")); assert.ok(f.personaDialog()?.open);
  }
  f.replay.closes.shift()(); f.draw();
  assert.equal(Boolean(f.personaDialog()?.open), newer, "old queued close must not clear the new exact pending persona");
  if (newer) assert.ok(f.draw().includes(replacement === "different" ? PRIVATE.nextPersona : PRIVATE.persona));
  assert.equal(f.replay.posts.length, 0); assert.deepEqual(f.replay.navigation, []);
});

for (const replacement of ["same", "different"]) test("B3 R2 callback old persona updateComplete cannot focus the newer " + replacement + " opening", async t => {
  const f = await replayCallbacks(t, "persona"), gate = deferred();
  f.holdUpdate = gate;
  const pending = f.click(f.control("#requestPersona"));
  try {
    await until(() => f.updateWaits === 1, "old opening continuation awaits updateComplete");
    // Commit the emitted native tree while its completion callback is held.
    // This is an explicit render/completion scheduling port, not browser timing.
    f.draw(); assert.ok(f.personaDialog()?.open);
    await f.click(f.control("#dismissPersona")); f.draw();
    assert.equal(f.replay.closes.length, 1);
    f.replay.closes.shift()(); f.draw();
    if (replacement === "different") { f.replay.row = { ...f.replay.row, persona: persona(true) }; await f.refresh(); }
    await f.click(f.control("#requestPersona")); assert.ok(f.personaDialog()?.open);
    const cancel = f.control("#dismissPersona"); cancel.focus();
    const shows = f.replay.shows.length;
    gate.resolve(true); await pending;
    assert.ok(f.personaDialog()?.open);
    assert.equal(f.replay.shows.length, shows, "an old opening cannot promote the newer dialog again");
    assert.equal(f.doc.activeElement === cancel, true, "the newer in-dialog focus gesture owns the continuation");
    assert.equal(f.replay.posts.length, 0); assert.deepEqual(f.replay.navigation, []);
  } finally { gate.resolve(true); await pending; }
});

for (const denied of [false, true]) test("B3 R2 callback approval continuation " + (denied ? "does not dispatch finite generate after denial" : "healthy exact finite approval is consumed once"), async t => {
  const f = await replayCallbacks(t), deny = denied ? await f.startDenial() : null, gate = deferred();
  f.replay.postHandlers.set("/api/replay-sessions/approval", () => gate.promise);
  const pending = f.submit("#approve", { phrase: PRIVATE.phrase, acknowledged: "yes" });
  try {
    await until(() => f.postCount("/api/replay-sessions/approval") === 1, "finite approval response held; no real grant is created");
    if (deny) await deny(); const before = f.replay.gets.length;
    gate.resolve(Response.json({ approvalId: "finite-approval-NOT-A-REAL-GRANT" })); await pending;
    assert.equal(f.postCount("/api/replay-sessions"), denied ? 0 : 1, "old approved-looking reply cannot trigger second POST after current retirement");
    assert.equal(f.replay.gets.length - before, denied ? 0 : 1);
    if (!denied) assert.deepEqual(f.replay.posts.find(call => call.url === "/api/replay-sessions").body,
      { approvalId: "finite-approval-NOT-A-REAL-GRANT", directUserApproval: true, confirmationVersion: "finite-version-no-authority", initiator: "direct-user" });
  } finally { gate.resolve(Response.json({ approvalId: "finite-approval-NOT-A-REAL-GRANT" })); await pending; }
});

for (const denied of [false, true]) test("B3 R2 callback sent finite generation reply " + (denied ? "cannot recertify or claim completion after denial" : "healthy current reply refreshes and reports completion"), async t => {
  const f = await replayCallbacks(t), deny = denied ? await f.startDenial() : null, gate = deferred();
  f.replay.postHandlers.set("/api/replay-sessions", () => gate.promise);
  const pending = f.submit("#approve", { phrase: PRIVATE.phrase, acknowledged: "yes" });
  try {
    await until(() => f.postCount("/api/replay-sessions") === 1, "second finite POST was already issued before denial; it is not retroactively called canceled");
    assert.equal(f.postCount("/api/replay-sessions/approval"), 1);
    if (deny) await deny(); const before = f.replay.gets.length;
    gate.resolve(Response.json({ session: row("complete") })); await pending;
    const complete = f.i18n.t("replay.actual.complete", "The approved replay is saved and can be reused without another provider call.");
    assert.equal(f.replay.gets.length - before, denied ? 0 : 1);
    assert.equal(f.draw().includes(complete), !denied);
    assert.equal(f.postCount("/api/replay-sessions"), 1, "already sent remains one finite request, never replayed or released by this test");
  } finally { gate.resolve(Response.json({ session: row("complete") })); await pending; }
});

test("B3 R2 callback untrusted persona opening cannot reach finite impersonation", async t => {
  const f = await replayCallbacks(t, "persona"); await f.click(f.control("#requestPersona"), false); f.draw();
  assert.equal(f.personaDialog() === null, true); assert.equal(f.replay.posts.length, 0); assert.deepEqual(f.replay.navigation, []);
});

test("B3 R2 callback untrusted final persona confirmation cannot reach finite impersonation", async t => {
  const f = await replayCallbacks(t, "persona"); await f.click(f.control("#requestPersona")); assert.ok(f.personaDialog()?.open);
  await f.submit("#confirmPersona", { confirmation: "I understand, continue", personaAcknowledged: "yes" }, false);
  assert.equal(f.replay.posts.length, 0); assert.deepEqual(f.replay.navigation, []);
});

test("B3 R2 callback untrusted approval cannot reach either finite POST", async t => {
  const f = await replayCallbacks(t); await f.submit("#approve", { phrase: PRIVATE.phrase, acknowledged: "yes" }, false);
  assert.equal(f.replay.posts.length, 0); assert.deepEqual(f.replay.navigation, []);
});
