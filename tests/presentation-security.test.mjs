import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

import {
  documentArtifactValidationIssues,
  resolveDocumentArtifactContextGroups,
} from "../src/model/document-artifacts.ts";
import { generationFailureGuidance } from "../src/model/document-jobs.ts";
import { buildManagedProductionPlan } from "../src/model/managed-production.ts";
import { providerFacingRenderingContext } from "../src/model/prompt-policy.ts";
import { sanitizeSharedValue } from "../src/model/share-scope.ts";
import {
  buildPresentationSourceContract,
  inferPresentationSourceOutline,
  providerFacingPresentationSourceContract,
  resolvePresentationSourceReferences,
} from "../src/model/presentation-source.ts";
import { publicEventPayload } from "../worker/event-privacy.ts";
import { assessStoredPresentationCandidate } from "../worker/openai-adapter.ts";

const authorizedBlock = "PRIVATE_AUTHORIZED_BLOCK_9137";
const authorizedGroup = "PRIVATE_AUTHORIZED_GROUP_9137";
const authorizedClaim = "PRIVATE_AUTHORIZED_CLAIM_9137";
const mutedSecret = "MUTED_CUSTOMER_ACCOUNT_SECRET_9137";
const foreignSecret = "FOREIGN_TENANT_CUSTOMER_SECRET_9137";

const authorizedSnapshot = () => ({
  organization_id: "PRIVATE_ORGANIZATION_9137",
  project_id: "PRIVATE_PROJECT_9137",
  facts: [
    {
      block_id: authorizedBlock,
      type: "direction",
      source_claim_ids: [authorizedClaim],
      properties: {
        text: "Slide 1. Present only the authorized customer-approved conclusion.",
        weight: 1,
        combined_context_memberships: [{ context_set_id: authorizedGroup }],
        organization_context_source_block_id: "PRIVATE_PACKAGE_SOURCE_BLOCK_9137",
      },
    },
    {
      block_id: "PRIVATE_MUTED_BLOCK_9137",
      type: "direction",
      properties: {
        text: `Slide 2. Never transmit ${mutedSecret}.`,
        weight: 0,
      },
    },
    {
      block_id: "PRIVATE_REMOVED_BLOCK_9137",
      type: "direction",
      removed: true,
      properties: { text: `Slide 3. Never transmit ${foreignSecret}.`, weight: 1 },
    },
  ],
  context_groups: [
    { id: authorizedGroup, name: "Approved customer evidence" },
    { id: "PRIVATE_FOREIGN_GROUP_9137", name: foreignSecret },
  ],
  claims: [
    { id: authorizedClaim, block_id: authorizedBlock, label: "Approved factual claim" },
    {
      id: "PRIVATE_FOREIGN_CLAIM_9137",
      block_id: "PRIVATE_FOREIGN_BLOCK_9137",
      label: foreignSecret,
    },
  ],
});

test("presentation source contracts exclude muted, removed, and foreign source material before provider transmission", () => {
  const contract = buildPresentationSourceContract(authorizedSnapshot(), {
    sourceAliases: [{
      alias: "blk_987",
      sourceId: "PRIVATE_FOREIGN_BLOCK_9137",
      sourceKind: "block",
      contextGroupIds: ["PRIVATE_FOREIGN_GROUP_9137"],
      label: foreignSecret,
    }],
    contextGroups: [{ id: "PRIVATE_INJECTED_GROUP_9137", name: foreignSecret }],
  });

  assert.equal(contract.authoredSlideCount, 1);
  assert.deepEqual(
    contract.sources.filter((source) => source.sourceKind === "block").map((source) => source.sourceId),
    [authorizedBlock],
  );
  assert.ok(contract.sources.every((source) => source.sourceKind !== "context-group"
    || source.sourceId === authorizedGroup));
  assert.ok(contract.sources.every((source) => source.sourceKind !== "claim"
    || source.blockId === authorizedBlock));

  const providerContract = providerFacingPresentationSourceContract(contract);
  const creativeContext = providerFacingRenderingContext(authorizedSnapshot(), contract.sources);
  const providerPayload = JSON.stringify({ sourceContract: providerContract, creativeContext });

  assert.equal(creativeContext.facts.length, 1);
  assert.match(providerPayload, /customer-approved conclusion/);
  assert.doesNotMatch(providerPayload, /PRIVATE_|MUTED_CUSTOMER_ACCOUNT_SECRET|FOREIGN_TENANT_CUSTOMER_SECRET/);
  assert.doesNotMatch(providerPayload, /blk_987/);
});

test("guessed durable source identifiers and foreign aliases cannot authenticate as provider evidence", () => {
  const contract = buildPresentationSourceContract(authorizedSnapshot());
  const allowed = contract.sources.find((source) => source.sourceKind === "block");
  assert.ok(allowed);

  const authorized = resolvePresentationSourceReferences([allowed.alias], contract);
  assert.equal(authorized.valid, true);
  assert.deepEqual(authorized.blockIds, [authorizedBlock]);

  for (const guessed of [authorizedBlock, authorizedGroup, authorizedClaim, "blk_999", "grp_999"]) {
    const rejected = resolvePresentationSourceReferences([guessed], contract);
    assert.equal(rejected.valid, false, `The provider must not authenticate ${guessed}.`);
    assert.deepEqual(rejected.sourceIds, []);
    assert.deepEqual(rejected.unknownReferences, [guessed]);
  }
});

test("hero visual normalization cannot authenticate a foreign evidence alias after discarding its original data row",()=>{
  const snapshot={facts:[{block_id:authorizedBlock,type:"message",locked:true,properties:{label:"Approved source evidence",text:"Authorized customer-approved product decision."}}]};
  const presentation={aspect_ratio:"16:9",theme:"Authorized presentation",footer_label:"Authorized evidence",style_preset:"editorial",mode:"light",palette:{background:"#ffffff",foreground:"#111111",accent:"#2255aa",muted:"#555555",surface:"#eeeeee"}};
  const raw=JSON.stringify({title:"Approved briefing",summary:"Authorized product conclusion",content_markdown:"# Approved briefing",presentation,items:[{title:"Approved product conclusion",body:"",notes:"",image_prompt:"",context_group_ids:[],slide:{layout:"statement",kicker:"Independent evidence",bullets:[],visual:{kind:"hero-type",label:"Source finding",value:"Approved product conclusion",data:[{label:foreignSecret,value:"",source_ids:["blk_999"]}]}}}]});
  const scene=buildManagedProductionPlan("slides",snapshot,{requestedSlideCount:1}).scenes;
  const assessed=assessStoredPresentationCandidate(raw,snapshot,{itemCount:1,requestedSlideCount:1,productionScenes:scene});
  assert.ok(assessed.issues.some((issue)=>issue.code==="unknown_source_reference"),"promoted hero text must retain its foreign provider source alias for authorization validation");
  assert.ok(assessed.sourceResolution.unknownAssignments.includes("blk_999"));
});

test("a globally valid source alias cannot cross an isolated managed presentation chapter",()=>{
  const blocks=["PRIVATE_CHAPTER_SOURCE_A_9137","PRIVATE_CHAPTER_SOURCE_B_9137"];
  const groups=["PRIVATE_CHAPTER_GROUP_A_9137","PRIVATE_CHAPTER_GROUP_B_9137"];
  const snapshot={facts:blocks.map((blockId,index)=>({block_id:blockId,type:"message",locked:true,properties:{label:`Approved chapter evidence ${index+1}`,text:`Authorized source evidence for isolated presentation position ${index+1}.`,combined_context_memberships:[{context_set_id:groups[index],name:`Chapter ${index+1}`,target:`Slide ${index+1}`,role:"slide_chapter",application:"isolate",member_order:index}]}}))};
  const plan=buildManagedProductionPlan("slides",snapshot,{requestedSlideCount:2});
  const contract=buildPresentationSourceContract(snapshot,{requestedSlideCount:2,itemCount:2});
  const aliases=blocks.map((blockId)=>contract.sources.find((source)=>source.sourceKind==="block"&&source.sourceId===blockId)?.alias);
  const presentation={aspect_ratio:"16:9",theme:"Isolated evidence",footer_label:"Authorized chapters",style_preset:"editorial",mode:"light",palette:{background:"#ffffff",foreground:"#111111",accent:"#2255aa",muted:"#555555",surface:"#eeeeee"}};
  const raw=JSON.stringify({title:"Isolated presentation",summary:"Two independently isolated chapters.",content_markdown:"# Isolated presentation",presentation,items:blocks.map((_blockId,index)=>({title:`Distinct chapter ${index+1}`,body:`Independent approved decision ${index+1}.`,notes:"",image_prompt:"",context_group_ids:[`context_group_${index+1}`],slide:{layout:"statement",kicker:`Authored stage ${index+1}`,bullets:[],source_ids:index===0?[aliases[0],aliases[1]]:[aliases[1]],visual:{kind:"hero-type",label:`Approved finding ${index+1}`,value:`Independent insight ${index+1}`,data:[]}}}))});
  const assessed=assessStoredPresentationCandidate(raw,snapshot,{itemCount:2,requestedSlideCount:2,productionScenes:plan.scenes});
  assert.ok(assessed.issues.some((issue)=>issue.code==="incorrect_slide_source"&&issue.path==="items.0.slide.source_ids"),"all canonical source references must belong to the slide's assigned isolated chapter");
  assert.ok(assessed.issues.some((issue)=>issue.code==="incorrect_context_group_assignment"),"foreign source aliases must not silently attach an unrelated Combined Context chapter");
});

test("managed presentation limits never silently discard authored slides and expose bounded call reservations", () => {
  const numberedSnapshot = (count) => ({
    facts: [{
      block_id: authorizedBlock,
      type: "direction",
      properties: {
        text: Array.from({ length: count }, (_, index) =>
          `Slide ${index + 1}. Authorized conclusion ${index + 1}.`,
        ).join("\n"),
        weight: 1,
      },
    }],
  });

  const unsupported = numberedSnapshot(101);
  assert.equal(inferPresentationSourceOutline(unsupported).authoredSlideCount, 101);
  assert.throws(
    () => buildManagedProductionPlan("slides", unsupported),
    /managed_presentation_slide_count_exceeds_supported_maximum:100/,
  );
  assert.throws(
    () => buildManagedProductionPlan("slides", numberedSnapshot(1), { requestedSlideCount: 101 }),
    /managed_presentation_slide_count_exceeds_supported_maximum:100/,
  );

  const supported = buildManagedProductionPlan("slides", numberedSnapshot(100));
  assert.equal(supported.predictedSlideCount, 100);
  assert.equal(supported.scenes.length, 100);
  assert.equal(supported.providerBatchCount, 13);
  assert.equal(supported.maximumProviderCallCount, 52);
  assert.equal(supported.estimatedPlanningCostMicrousd, 13_000_000);
});

test("invented context assignments fail closed without disclosing the guessed durable identifier", () => {
  const output = {
    title: "Approved customer briefing",
    summary: "Authorized material only.",
    content_markdown: "# Approved customer briefing",
    presentation: {
      aspectRatio: "16:9",
      theme: "Approved customer briefing",
      footerLabel: "Approved briefing",
      stylePreset: "editorial",
      mode: "light",
      palette: {
        background: "#ffffff",
        foreground: "#111111",
        accent: "#2255aa",
        muted: "#555555",
        surface: "#eeeeee",
      },
    },
    items: [{
      title: "Authorized conclusion",
      body: "Only the approved evidence remains.",
      notes: "Presenter notes.",
      image_prompt: "",
      context_group_ids: [authorizedGroup],
      slide: {
        layout: "metric",
        kicker: "Evidence",
        bullets: [],
        visual: { kind: "metric", label: "Confidence", value: "82%", data: [] },
      },
    }],
  };
  const resolved = resolveDocumentArtifactContextGroups(output, [{ id: authorizedGroup, alias: "context_group_1" }]);

  assert.deepEqual(resolved.receipt.unknownAssignments, [authorizedGroup]);

  const issues = documentArtifactValidationIssues("slides", resolved.output, {
    itemCount: 1,
    contextGroupIds: [authorizedGroup],
    unknownContextGroupAssignments: resolved.receipt.unknownAssignments,
  });
  const unauthorized = issues.find((issue) => issue.code === "unknown_context_group_reference");
  assert.ok(unauthorized, "Invented model references must not disappear during canonicalization.");
  assert.doesNotMatch(unauthorized.message, /PRIVATE_AUTHORIZED_GROUP_9137/);
});

test("public presentation receipts preserve accounting without exposing actor-private provenance or provider inputs", () => {
  const event = publicEventPayload("event-presentation-security", {
    document_id: "document-9137",
    artifact_id: "artifact-9137",
    provider: "openai-responses",
    model: "gpt-test",
    predicted_slide_count: 23,
    provider_call_count: 3,
    maximum_provider_call_count: 12,
    reserved_microusd: 3_000_000,
    used_microusd: 81_250,
    presentation_source_contract: {
      sources: [{ alias: "blk_001", sourceId: authorizedBlock }],
      protectedQuotes: [{ text: mutedSecret }],
    },
    generation_receipt: {
      providerInput: { facts: [{ block_id: authorizedBlock, text: foreignSecret }] },
      sourceAliasMap: { blk_001: authorizedBlock },
    },
  });

  assert.equal(event.payload.predicted_slide_count, 23);
  assert.equal(event.payload.maximum_provider_call_count, 12);
  assert.equal(event.payload.reserved_microusd, 3_000_000);
  assert.equal(event.payload.used_microusd, 81_250);
  assert.doesNotMatch(JSON.stringify(event.payload), /PRIVATE_|CUSTOMER_(?:ACCOUNT_)?SECRET|providerInput|sourceAliasMap|blk_001/);
  assert.match(event.privateJson, /PRIVATE_AUTHORIZED_BLOCK_9137/);
});

test("public presentation failure events retain safely reconstructed slide-level diagnostics without private source text",()=>{
  const event=publicEventPayload("event-presentation-validation-security",{
    document_id:"document-9137",
    error_code:"source_fidelity_validation_failed",
    validation_issues:[{
      code:"unknown_source_reference",path:"items.2.slide.source_ids",message:`Provider exposed ${authorizedBlock} and ${mutedSecret}`,
      category:"presentation-preference",blocking:false,overridable:true,pageIndex:0,pageCount:1,globalSlideIndex:3,
      providerAttempt:1,stage:"initial",source_id:authorizedBlock,
    },{
      code:"unknown_context_group_reference",path:`items.${authorizedGroup}.context_group_ids`,message:foreignSecret,
      category:"structure",blocking:false,overridable:true,pageIndex:0,pageCount:1,globalSlideIndex:4,
      providerAttempt:2,stage:"repair",provider_prompt:mutedSecret,
    }],
  });
  assert.equal(event.payload.validation_issues.length,2);
  assert.deepEqual(event.payload.validation_issues.map((issue)=>issue.stage),["initial","repair"]);
  assert.equal(event.payload.validation_issues[0].globalSlideIndex,3);
  assert.equal(event.payload.validation_issues[0].category,"authorization");
  assert.equal(event.payload.validation_issues[0].blocking,true);
  assert.equal(event.payload.validation_issues[0].overridable,false);
  assert.equal(event.payload.validation_issues[1].path,"$");
  assert.doesNotMatch(JSON.stringify(event.payload),/PRIVATE_|CUSTOMER_(?:ACCOUNT_)?SECRET|provider_prompt|source_id"\s*:/u);
  assert.match(event.privateJson,/PRIVATE_AUTHORIZED_BLOCK_9137/u,"original authored material remains solely inside the erasable private envelope");
});

test("anonymous presentation shares retain visible evidence while recursively removing durable source, claim, and group identifiers",()=>{
  const slide={
    sourceIds:[authorizedBlock,authorizedClaim,authorizedGroup],
    source_ids:["PRIVATE_SNAKE_CASE_SOURCE_9137"],
    quote:{text:"A complete attributable stakeholder quotation.",speaker:"Product Owner",role:"Product Owner",sourceId:authorizedClaim},
    citations:[{label:"Reviewed executive decision",anchor:"Authored slide 2",excerpt:"Visible citation evidence.",source_id:authorizedGroup}],
    visual:{kind:"scorecard",data:[{label:"Phone",value:"39.75",sourceIds:[authorizedBlock]}]},
  };
  const shared=sanitizeSharedValue(slide,{ownerId:"share-owner",mediaKeys:[]},"anonymous-review-token");
  assert.deepEqual(shared,{
    quote:{text:"A complete attributable stakeholder quotation.",speaker:"Product Owner",role:"Product Owner"},
    citations:[{label:"Reviewed executive decision",anchor:"Authored slide 2",excerpt:"Visible citation evidence."}],
    visual:{kind:"scorecard",data:[{label:"Phone",value:"39.75"}]},
  });
  assert.doesNotMatch(JSON.stringify(shared),/PRIVATE_|sourceIds|source_ids|sourceId|source_id/);
});

test("public share provenance filtering rejects acronym, nested source-kind, and singular context-group identifier variants",()=>{
  const hidden=Object.fromEntries(["sourceID","sourceIDs","SourceId","SOURCE_ID","sourceBlockId","source_block_id","sourceClaimId","source_claim_id","sourceContextGroupId","contextGroupId","context_group_id","contextSetId","context_set_id","source_key","sourceKey","sourceAlias","sourceAliases","sourceAliasMap","source_alias_map","blockId","blockIds","block_id","claimId","claimIds","claim_id","groupId","groupIds","group_id","organization_context_source_block_id","organizationContextSourceBlockId","organization_context_package_id","organization_context_package_version_id","organization_context_package_binding_id","source_claim_ref","source_event_refs","evidence_refs","source_block_versions","source_fingerprint","contextFingerprint"].map((key)=>[key,"PRIVATE_DURABLE_PROVENANCE_9137"]));
  const result=sanitizeSharedValue({id:"public-authorized-block-id",label:"Visible source citation",nested:hidden},{ownerId:"share-owner",mediaKeys:[]},"public-token");
  assert.deepEqual(result,{id:"public-authorized-block-id",label:"Visible source citation",nested:{}});
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE_DURABLE_PROVENANCE/);
});

test("project-scoped job responses never include actor-private generation receipts or nested input references", async () => {
  const source = await readFile(new URL("../worker/document-jobs-api.ts", import.meta.url), "utf8");
  const syntax = ts.createSourceFile("document-jobs-api.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const declaration = syntax.statements.find((statement) => ts.isFunctionDeclaration(statement)
    && statement.name?.text === "safeScopedJob");
  assert.ok(declaration, "The actual project-scoped job projection must remain inspectable.");

  const harness = `
    const serializeJob = (row) => row;
    ${declaration.getText(syntax)}
    export { safeScopedJob };
  `;
  const { outputText } = ts.transpileModule(harness, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    fileName: "project-presentation-job-security.ts",
  });
  const { safeScopedJob } = await import(`data:text/javascript,${encodeURIComponent(outputText)}`);
  const scoped = safeScopedJob({
    jobId: "job-9137",
    moderationPromptRef: "PRIVATE_MODERATION_REFERENCE_9137",
    result: {
      stage: "queued",
      predicted_slide_count: 23,
      reserved_microusd: 3_000_000,
      presentationCandidates:[{contentRef:"PRIVATE_PROVIDER_RESPONSE_REFERENCE_9137",candidateRaw:"PRIVATE_PROVIDER_RESPONSE_BODY_9137"}],
      generationReceipt: {
        input_ref: "PRIVATE_INPUT_REFERENCE_9137",
        source_snapshot_sha256: "PRIVATE_SOURCE_HASH_9137",
        settings: { audience: mutedSecret, tone: foreignSecret },
      },
      nested: {
        input_ref: "PRIVATE_NESTED_INPUT_REFERENCE_9137",
        sourceAliasMap: { blk_001: authorizedBlock },
        providerInput: { text: foreignSecret },
        presentationCandidates:[{contentRef:"PRIVATE_NESTED_RESPONSE_REFERENCE_9137"}],
      },
    },
    members: [{
      status: "queued",
      generation_receipt: { input_ref: "PRIVATE_MEMBER_INPUT_REFERENCE_9137" },
      nested: { audience: mutedSecret, tone: foreignSecret },
    }],
  });

  assert.equal(scoped.result.stage, "queued");
  assert.equal(scoped.result.predicted_slide_count, 23);
  assert.equal(scoped.result.reserved_microusd, 3_000_000);
  assert.equal(scoped.members[0].status, "queued");
  assert.equal(scoped.moderationPromptRef, null);
  assert.doesNotMatch(
    JSON.stringify(scoped),
    /PRIVATE_|MUTED_CUSTOMER_ACCOUNT_SECRET|FOREIGN_TENANT_CUSTOMER_SECRET|generationReceipt|generation_receipt|input_ref|sourceAliasMap|providerInput/,
  );
});

test("a local presentation persistence failure never promises a safe provider retry", () => {
  const guidance = generationFailureGuidance({
    code: "local_persistence_failed",
    category: "server",
    scope: "unknown",
    action: "retry",
    message: "The local presentation event could not be committed.",
    retryable: false,
    retryAfterMs: null,
    requestId: null,
    httpStatus: null,
  });

  assert.equal(guidance.retryAllowed, false);
  assert.doesNotMatch(`${guidance.title} ${guidance.summary}`, /provider (?:connection|interruption)|safe to retry/i);
});
