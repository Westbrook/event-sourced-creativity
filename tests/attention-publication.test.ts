import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { AttentionPublicationGate } from "../src/state/attention-publication.ts";
import { ExperienceHostOperation } from "../src/experiences/host-operation.ts";

test("mini-app lifetime rejects earlier, in-host, and boundary-spanning episodes without flushing", async () => {
  const gate = new AttentionPublicationGate(), before = gate.ticket(); let calls = 0;
  const release = gate.hold(), during = gate.ticket();
  await gate.publish(before, async () => { calls++; });
  await gate.publish(during, async () => { calls++; });
  release(); release();
  await gate.publish(before, async () => { calls++; });
  await gate.publish(during, async () => { calls++; });
  assert.equal(calls, 0);
  await gate.publish(gate.ticket(), async () => { calls++; });
  assert.equal(calls, 1);
});

test("overlapping hosts cannot release each other and queued append-pipeline work stays local", async () => {
  const gate = new AttentionPublicationGate(), queued = gate.ticket();
  const first = gate.hold(), second = gate.hold(); first(); first();
  assert.equal(gate.ticket(), null); second();
  let calls = 0;
  await gate.publish(queued, async () => { calls++; });
  assert.equal(calls, 0); assert.notEqual(gate.ticket(), null);
});

test("native operation waits for prior attention publication through response settlement", async () => {
  const gate = new AttentionPublicationGate(); let resolve!: () => void, called = false;
  const pending = gate.publish(gate.ticket(), () => new Promise<void>(done => { resolve = done; }));
  const release = gate.hold(), operation = new ExperienceHostOperation(() => {});
  const command = operation.wait(gate.settled()).then(() => { if (operation.current()) called = true; });
  await Promise.resolve(); assert.equal(called, false);
  resolve(); await pending; await command;
  assert.equal(called, true); operation.finish(); release();
});

test("timeout or teardown does not dispatch a command or replay old attention", async () => {
  const gate = new AttentionPublicationGate(); let resolve!: () => void, calls = 0;
  const pending = gate.publish(gate.ticket(), () => new Promise<void>(done => { resolve = done; }));
  const release = gate.hold(), ticket = gate.ticket();
  const operation = new ExperienceHostOperation(() => {});
  const command = operation.wait(gate.settled()).then(() => { if (operation.current()) calls++; });
  operation.cancel(); release();
  await assert.rejects(command, /operation_withdrawn/u);
  resolve(); await pending; await gate.settled();
  await gate.publish(ticket, async () => { calls++; });
  assert.equal(calls, 0);
});

test("idle completion after 65 seconds remains local for the complete authorized lifecycle", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const gate = new AttentionPublicationGate(), release = gate.hold(); let calls = 0;
  const ticket = gate.ticket();
  setTimeout(() => { void gate.publish(ticket, async () => { calls++; }); }, 60_000);
  context.mock.timers.tick(65_000); await gate.settled(); assert.equal(calls, 0);
  // Successful authorization does not release the mounted-host lease before Run.
  assert.equal(gate.ticket(), null); release(); assert.equal(calls, 0);
});

test("integration retains local capture and ownership checks, gates only attention, and awaits before dispatch", () => {
  const observer = readFileSync(new URL("../src/components/forma-attention-observer.ts", import.meta.url), "utf8");
  const store = readFileSync(new URL("../src/state/store.ts", import.meta.url), "utf8");
  const host = readFileSync(new URL("../src/components/forma-experience-host.ts", import.meta.url), "utf8");
  assert.match(observer, /current\.ownerId===\(this\.store\.session\.get\(\)\?\.user\.userId/u);
  assert.match(observer, /current\.publicationGate===this\.store\.attentionPublication/u);
  assert.match(observer, /#withdraw=\(\)=>\{this\.#episode=null;\}/u);
  for (const event of ["forma-authorization-changed", "forma-event-source-retired"]) {
    assert.ok(observer.includes(`addEventListener("${event}",this.#withdraw)`));
    assert.ok(observer.includes(`removeEventListener("${event}",this.#withdraw)`));
  }
  assert.ok(observer.indexOf("saveLocalAttentionEpisode(episode") < observer.indexOf("current(current.publicationTicket)"));
  const hot = store.slice(store.indexOf("  async hot("), store.indexOf("  async #nativeImagePublisherWork"));
  assert.match(hot, /event\.type === "AttentionEpisodeObserved"/u);
  assert.ok(hot.indexOf("await this.#appendPipeline") < hot.indexOf("attentionPublication.publish(attentionTicket,publish)"));
  assert.match(hot, /else await publish\(\)/u);
  assert.match(hot, /#assertAuthorizationScope\(authorization\);this\.#assertSourceOwnership\(sourceOwner\)/u);
  const command = host.slice(host.indexOf("  async #command("), host.indexOf("  #captureCommandFocusVisibility("));
  assert.ok(command.indexOf("attentionPublication.settled()") < command.indexOf("binding.client.command("));
  assert.match(command, /if \(!this\.#operationCurrent\(operation\) \|\| !this\.#visible\(binding\)\) return/u);
});
