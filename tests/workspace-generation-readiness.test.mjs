import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runReadyImageGeneration } from "../src/model/generation-intent.ts";
import { generationReadinessBlocksAction } from "../src/model/generation-readiness.ts";

const harness = (status, { acknowledged = false, summary, reject } = {}) => {
  const calls = [];
  const requestKey = "generation:document-revision:preview";
  const readiness = status === null ? null : {
    requestKey,
    status,
    summary: summary ?? `${status} provider state`,
  };
  const executor = {
    async ensureGenerationReadiness(kind, options) {
      calls.push({ action: "preflight", kind, options });
      if (reject) throw new Error(reject);
      return readiness;
    },
    generationRiskAcknowledged(key) {
      calls.push({ action: "acknowledgement", requestKey: key });
      return acknowledged;
    },
    async preview(sourceSurface) { calls.push({ action: "preview", sourceSurface }); },
    async generate(options) { calls.push({ action: "generate", options }); },
    toast(message) { calls.push({ action: "toast", message }); },
  };
  return { executor, calls, requestKey };
};

test("suggested drafts are queued only after their document-specific preflight succeeds", async () => {
  const { executor, calls } = harness("ready");
  const started = await runReadyImageGeneration(executor, "preview", {
    sourceSurface: "document-next-step",
  });

  assert.equal(started, true);
  assert.deepEqual(calls, [
    {
      action: "preflight",
      kind: "preview",
      options: { sourcePreviewId: null, sourceSurface: "document-next-step" },
    },
    { action: "preview", sourceSurface: "document-next-step" },
  ]);
});

test("suggested refinements preserve the exact approved draft through preflight and generation", async () => {
  const { executor, calls } = harness("ready");
  const started = await runReadyImageGeneration(executor, "generate", {
    sourceSurface: "document-next-step",
    sourcePreviewId: "approved-draft",
  });

  assert.equal(started, true);
  assert.deepEqual(calls, [
    {
      action: "preflight",
      kind: "generate",
      options: { sourcePreviewId: "approved-draft", sourceSurface: "document-next-step" },
    },
    {
      action: "generate",
      options: { sourceSurface: "document-next-step", sourcePreviewId: "approved-draft" },
    },
  ]);
});

test("suggested paid work fails closed when blocked, checking, unknown, or unavailable", async () => {
  for (const status of ["blocked", "checking", "unknown", null]) {
    const { executor, calls } = harness(status, { summary: "Provider credits are unavailable." });
    const started = await runReadyImageGeneration(executor, "preview", {
      sourceSurface: "document-next-step",
    });

    assert.equal(started, false, `status ${String(status)} must not enqueue provider work`);
    assert.equal(calls.some((call) => call.action === "preview" || call.action === "generate"), false);
    assert.equal(calls.at(-1).action, "toast");
    assert.equal(calls.at(-1).message, status === null
      ? "Generation readiness could not be confirmed."
      : "Provider credits are unavailable.");
  }
});

test("a review-required suggestion cannot spend until its exact request has been acknowledged", async () => {
  const blocked = harness("review");
  assert.equal(await runReadyImageGeneration(blocked.executor, "generate", {
    sourceSurface: "document-next-step",
    sourcePreviewId: "draft-1",
  }), false);
  assert.equal(blocked.calls.some((call) => call.action === "generate"), false);
  assert.deepEqual(blocked.calls.at(-1), {
    action: "toast",
    message: "Review and acknowledge the generation warning in the document controls first.",
  });

  const approved = harness("review", { acknowledged: true });
  assert.equal(await runReadyImageGeneration(approved.executor, "generate", {
    sourceSurface: "document-next-step",
    sourcePreviewId: "draft-1",
  }), true);
  assert.deepEqual(approved.calls.at(-1), {
    action: "generate",
    options: { sourceSurface: "document-next-step", sourcePreviewId: "draft-1" },
  });
});

test("a failed preflight never starts paid work and explains the connection problem", async () => {
  const { executor, calls } = harness("ready", { reject: "The readiness service is offline." });
  const started = await runReadyImageGeneration(executor, "preview", {
    sourceSurface: "document-next-step",
  });

  assert.equal(started, false);
  assert.equal(calls.some((call) => call.action === "preview" || call.action === "generate"), false);
  assert.deepEqual(calls.at(-1), {
    action: "toast",
    message: "The readiness service is offline.",
  });
});

test("next-step recommendations only open exact saved work or free configuration", async () => {
  const workspace = await readFile(new URL("../src/components/forma-workspace.ts", import.meta.url), "utf8");
  assert.match(workspace,/followCreativeNextTarget\(action.target/);
  assert.match(workspace,/configure:\(target\)=>this\.#prepareFormat\(target\)/);
  assert.doesNotMatch(workspace,/runReadyImageGeneration/);
});

test("compact document controls defer hidden fan checks without skipping their safety gates", async () => {
  const controls = await readFile(new URL("../src/components/generation-actions.ts", import.meta.url), "utf8");
  assert.match(controls, /kind\.includes\("fan"\)&&this\.compact&&!this\.#detailsOpen/);
  assert.match(controls, /@toggle=\$\{warmOnOpen\}/);
  assert.match(controls, /@click=\$\{\(\)=>void this\.openConfiguration\(\)\}/);
  assert.match(controls, /requiredReadinessRows=this\.compact&&!this\.#detailsOpen\?readinessRows\.slice\(0,2\):readinessRows/);
  assert.match(controls, /ensureGenerationReadiness\(row\.kind/);
  assert.match(controls, /formaGenerationFirstResolvedMs/);
  assert.match(controls, /formaGenerationResolvedMs/);
});

test("optimistic primary actions remain available without hiding known provider or safety failures", () => {
  const status = (value) => value === null ? null : { status: value, requestKey: "exact-request" };

  assert.equal(generationReadinessBlocksAction(status(null), { optimistic: true }), false);
  assert.equal(generationReadinessBlocksAction(status("checking"), { optimistic: true }), true);
  assert.equal(generationReadinessBlocksAction(status("ready"), { optimistic: true }), false);
  assert.equal(generationReadinessBlocksAction(status("blocked"), { optimistic: true }), true);
  assert.equal(generationReadinessBlocksAction(status("unknown"), { optimistic: true }), true);
  assert.equal(generationReadinessBlocksAction(status("review"), { optimistic: true }), true);
  assert.equal(generationReadinessBlocksAction(status("review"), { optimistic: true, acknowledged: true }), false);
  assert.equal(generationReadinessBlocksAction(status(null)), true);
  assert.equal(generationReadinessBlocksAction(status("checking")), true);
});

test("compact primary controls skip passive checks while paid and fan safety remain mandatory", async () => {
  const controls = await readFile(new URL("../src/components/generation-actions.ts", import.meta.url), "utf8");
  const jobs = await readFile(new URL("../worker/document-jobs-api.ts", import.meta.url), "utf8");

  assert.doesNotMatch(controls, /this\.#readinessTimer\s*=\s*window\.setTimeout/);
  assert.match(controls, /generationReadinessBlocksAction\(value,\{optimistic:true/);
  assert.match(controls, /previewBudgetBlocked\|\|readinessDisabled\(previewReadiness\)/);
  assert.match(controls, /fullBudgetBlocked\|\|readinessDisabled\(generateReadiness\)/);
  assert.match(controls, /previewFanBudgetBlocked\|\|readinessDisabled\(previewFanReadiness\)/);
  assert.match(controls, /fullFanBudgetBlocked\|\|readinessDisabled\(generateFanReadiness\)/);
  assert.match(controls, /formaGenerationActionableMs/);
  assert.match(controls, /Boolean\(session\?\.provider\.configured\)/);
  assert.doesNotMatch(controls, /provider\.provider==="fal"\)\?\.configured/);
  assert.match(controls, /Date\.parse\(value\.expiresAt\)>Date\.now\(\)/);
  assert.match(jobs, /force:true[^\n]*allowCache:false/);
});
