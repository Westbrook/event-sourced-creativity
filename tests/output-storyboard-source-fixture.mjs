import assert from 'node:assert/strict';

import test from 'node:test';

import {registerHooks} from 'node:module';

import {existsSync} from 'node:fs';

const C=process.env.FORMA_SOURCE_ROOT;
if(!C)throw Error('FORMA_SOURCE_ROOT required');

const {registerOutputSourceImports}=await import(C+'/tests/output-execution-test-helpers.mjs');
registerOutputSourceImports();

registerHooks({resolve(specifier,context,next){
 if(!specifier.startsWith('.')&&!specifier.startsWith('/')&&!specifier.includes(':'))return next(specifier,{...context,parentURL:new URL('file://'+C+'/worker/openai-adapter.ts').href});
 if(specifier.startsWith('.')&&context.parentURL?.startsWith('file:')){const normal=new URL(/\.[a-z0-9]+$/iu.test(specifier)?specifier:specifier+'.ts',context.parentURL);if(!existsSync(normal)&&normal.pathname.includes('/src/experiences/'))return next(new URL('file://'+C+'/src/experiences/'+normal.pathname.split('/src/experiences/')[1]).href,context);}
 return next(specifier,context);
}});

const {readFileSync}=await import("node:fs");

const {stripTypeScriptTypes}=await import("node:module");

const {canonicalJson,digest,freeze}=await import("../src/experiences/compiler.ts");

const {buildExperiencePlan,registeredExperience,validateIntakeRequest,experienceResourceId,receiptPrefix}=await import("../src/experiences/intake.ts");

const {experienceSourceMatches}=await import("../src/experiences/host-source.ts");

const {createStoryboardOutputContract,parseStoryboardOutputContract}=await import("../src/model/output-storyboard-contract.ts");

const {confirmOutputRequirementInterpretation}=await import("../src/model/output-requirements.ts");

const {compileOutputPlan}=await import("../src/model/output-plan.ts");

const {experienceOutputBinding}=await import("../worker/experience-output-binding.ts");

const {createExperienceOutputRecipe,matchExperienceOutputRecipeTarget}=await import("../worker/experience-output-recipe.ts");

const {standingConstraints}=await import("../src/model/taste.ts");

const {documentRenderTokenReservation}=await import("../src/model/generation-budget.ts");

const {OUTPUT_NATIVE_EXECUTION_POLICY}=await import("../src/model/output-execution-policy.ts");

const {createOutputFalImageContract,OUTPUT_FAL_PLANNING_MODEL}=await import("../worker/output-fal-image-contract.ts");

const {selectImageAdapter}=await import("../worker/image-adapter-selection.ts");

const {prepareStoryboardPlannerRequest}=await import("../worker/openai-adapter.ts");

const {estimateOpenAITextCallMaximumMicrousd}=await import("../worker/openai-text-cost.ts");

const {outputProofReadStatements}=await import("../worker/output-disclosure-proof.ts");

const originalFetch=globalThis.fetch;
globalThis.fetch=()=>{throw Error('network forbidden');};
test.after(()=>{globalThis.fetch=originalFetch;});

const source = path => { const local=new URL("../"+path,import.meta.url);return readFileSync(existsSync(local)?local:C+"/"+path,"utf8"); };

const {readStoryboardExecutionOffer,STORYBOARD_READY_REASON,STORYBOARD_TRANSFER}=await import("../src/model/output-storyboard-offer.ts");

function extracted(path, names, deps) {
  // Execute complete actual module logic, replacing import bindings only. Heavy
  // Worker readers receive finite ports; real pure compiler/profile helpers run.
  const body = source(path).replace(/^import[\s\S]*?;\n/gmu, "").replace(/^export /gmu, "");
  const js = stripTypeScriptTypes(body);
  return new Function(...Object.keys(deps), js + "\nreturn {" + names.join(",") + "};")(...Object.values(deps));
}

class OutputConflictError extends Error { constructor(code, status = 409) { super(code); this.code = code; this.status = status; } }

const creator = "storyboard-owned-test";

const release = await registeredExperience("storyboard");

const request = { experienceId: "storyboard", intentId: "00000000-0000-4000-8000-000000000020", releaseHash: release.releaseHash,
  values: { story: { value: "A keeper brings a lantern home through the harbor. 水", provenance: "authored" },
    composition: { value: "Charcoal outlines; preserve the keeper and lantern.", provenance: "authored" } } };

const plan = await buildExperiencePlan(creator, request, release);

const binding = await experienceOutputBinding(plan);

const contract = createStoryboardOutputContract({ draftId: binding.draftId, draftHash: binding.draftHash, releaseHash: binding.releaseHash,
  requestHash: binding.requestHash, sourceBindingHash: binding.sourceBindingHash });

const requirementId = await experienceResourceId(plan.draftId, "native-output-requirement");

const deliverableId = await experienceResourceId(plan.draftId, "native-output-deliverable");

const recipe = createExperienceOutputRecipe({ output: "storyboard", requirementId, deliverableId, contract });

const sourceDigest = "a".repeat(64), requirementsDigest = "b".repeat(64);

const compiled = compileOutputPlan([confirmOutputRequirementInterpretation(recipe.spec)],
  { document_id: plan.documentId, source_revision: sourceDigest, requirement_revision: requirementsDigest });

const receipt = { status: "complete", generation: "unavailable", projectId: plan.projectId, documentId: plan.documentId,
  draftId: plan.draftId, draftHash: plan.draftHash,
  appended: plan.events.map((event, i) => ({ eventId: "intake-event-" + i, sequence: i + 1, type: event.type, payload: structuredClone(event.payload) })) };

const originalEvents = receipt.appended.map(event => ({ ...event, streamId: plan.streamId, actor: "user" }));

const authoredBlocks = receipt.appended.filter(event => event.type === "BlockCreated").map(event => ({
  id: event.payload.block_id, projectId: plan.projectId, documentId: plan.documentId, scope: "document", canvasId: "",
  removed: false, locked: false, type: event.payload.type, handle: event.payload.handle, position: event.payload.position,
  properties: event.payload.properties, sourceEvents: [event.eventId],
}));

const outputBlock = { id: requirementId, type: "output", scope: "document", canvasId: "", projectId: plan.projectId,
  documentId: plan.documentId, removed: false, locked: false, handle: "storyboard-output", position: "z",
  properties: { output_spec: recipe.spec }, sourceEvents: ["managed-output"] };

const outputEvent = { eventId: "managed-output", actor: "user:" + creator, streamId: plan.streamId, clientId: "server:output-requirements", type: "BlockCreated",
  payload: { block_id: requirementId, type: "output", scope: "document", project_id: plan.projectId, document_id: plan.documentId,
    handle: outputBlock.handle, position: outputBlock.position, properties: outputBlock.properties } };


function fixture() {
  const reads = [], selects = [], principal = { userId: creator, streamId: plan.streamId, access: { capabilities: ["project.author"] }, consent: true };
  const input = { request: new Request("https://forma.test"), principal,
    env: { FORMA_IMAGE_PROVIDER: "fal", OPENAI_API_KEY: "synthetic-configured-no-network", FAL_KEY: "synthetic-configured-no-network", DB: {
      prepare(sql) { assert.match(sql, /^SELECT (?:1 AS current WHERE |CASE WHEN )/u); selects.push(sql);
        return { bind(...values) { assert.ok(values.length<=100);selects.push(values); return {
          async first() { return input.current ? { current: 1 } : null; },
          async all() { return {success:true,results:input.current?[{current:1}]:[]}; },
        }; } }; },
      async batch(statements){return Promise.all(statements.map(statement=>statement.all()));},
    } }, current: true,
    scope: { kind: "personal", actorUserId: creator, ownerUserId: creator, projectId: plan.projectId, documentId: plan.documentId,
      organizationId: null, projectAccessId: null, contextId: null },
    sourceDigest, requirementsDigest, sourceAssertions: [{ sql: "source_head_current = ?", bindings: [42] }],
    sourceEvents: structuredClone([...originalEvents, outputEvent]),
    confirmedPlan: { revisionId: "confirmed-original", confirmedAt: new Date(Date.now() - 1000).toISOString(),
      plan: structuredClone(compiled), sourceDigest, requirementsDigest },
    target: structuredClone(compiled.targets[0]),
    context: { snapshot: { document: { title: plan.title }, facts: authoredBlocks.map(block => ({
      block_id: block.id, type: block.type, active: true, properties: block.properties,
    })) }, projection: { documentId: plan.documentId, documentTitle: plan.title, projectId: plan.projectId,
      documents: [{ id: plan.documentId, projectId: plan.projectId, title: plan.title, removed: false }],
      libraryBlocks: structuredClone([...authoredBlocks, outputBlock]), libraryBlockRelations: [] } },
  };
  const ports = {
    readExperienceDraft: async (_env, auth, draftId) => { reads.push("draft"); assert.equal(auth.principal, principal); assert.equal(draftId, plan.draftId);
      return input.missing ? null : { plan: input.retainedPlan ?? plan, content: { exact: "retained-source" }, expiresAt: new Date(Date.now() + 86400000).toISOString() }; },
    experienceDraftGuard: (_auth, actual) => { assert.equal(actual.draftId, plan.draftId); return { sql: "private_draft_current = ?", bindings: [plan.draftHash] }; },
    projectIntakeAuthority: (_env, auth) => { assert.equal(auth.principal, principal); return { sql: "actor_current = ?", bindings: [creator] }; },
    join: (...guards) => ({ sql: guards.map(g => "(" + g.sql + ")").join(" AND "), bindings: guards.flatMap(g => g.bindings) }),
    requireConsent: actor => { assert.equal(actor, principal); return actor.consent ? null : new Response(null, { status: 403 }); },
    commitAtomicIntake: async (_env, auth, actual, mode, options) => {
      reads.push("check"); assert.equal(auth.principal, principal); assert.equal(mode, "check");
      assert.deepEqual(actual.events, plan.events); assert.equal(options.receiptPrefix, receiptPrefix(plan.draftId));
      return Response.json(input.badReceipt ? { ...receipt, status: "unavailable" } : receipt);
    },
  };
  const resolver = extracted("worker/output-storyboard-source.ts", ["resolveOutputStoryboardSource", "outputStoryboardPreparationIdentity"], {
    canonicalJson, digest, freeze, buildExperiencePlan, experienceResourceId, receiptPrefix, validateIntakeRequest, experienceSourceMatches,
    createStoryboardOutputContract, parseStoryboardOutputContract, experienceOutputBinding, createExperienceOutputRecipe, matchExperienceOutputRecipeTarget, OutputConflictError, ...ports,
  });
  const preflight = extracted("worker/output-storyboard-preflight.ts", ["preflightOutputStoryboardTarget", "outputStoryboardPreflightProof"], {
    freeze, parseStoryboardOutputContract, standingConstraints, documentRenderTokenReservation, OUTPUT_NATIVE_EXECUTION_POLICY,
    createOutputFalImageContract, OUTPUT_FAL_PLANNING_MODEL, selectImageAdapter, prepareStoryboardPlannerRequest,
    estimateOpenAITextCallMaximumMicrousd, resolveOutputStoryboardSource: resolver.resolveOutputStoryboardSource,
    readStoryboardExecutionOffer,STORYBOARD_READY_REASON,STORYBOARD_TRANSFER,outputProofReadStatements,
  });
  return { input, reads, selects, ...resolver, ...preflight };
}

function oneFunction(path, start, end, deps) {
  const text = source(path), from = text.indexOf(start), to = text.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, "Exact function boundary");
  return new Function(...Object.keys(deps), stripTypeScriptTypes(text.slice(from, to).replace(/^export /u, "")) + "\nreturn " + start.match(/function (\w+)/u)[1] + ";")(...Object.values(deps));
}

export {fixture,oneFunction,canonicalJson,digest};
export default { fixture, plan, contract, oneFunction, digest, sourceDigest, requirementsDigest, binding, recipe, canonicalJson, readStoryboardExecutionOffer };
