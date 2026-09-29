import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { resolvePresentationModelRoutes } from "../worker/presentation-model-routing.ts";

import { buildManagedProductionPlan } from "../src/model/managed-production.ts";
import { assessStoredPresentationCandidate, generateDocumentArtifact } from "../worker/openai-adapter.ts";
import { GEMINI_TTS_ADAPTER_CONTRACT, SEED_AUDIO_ADAPTER_CONTRACT, STABLE_AUDIO_ADAPTER_CONTRACT } from "../src/model/audio.ts";

const PRIVATE_BLOCK_ID = "PRIVATE_EXECUTIVE_SOURCE_BLOCK_8731";
const PRIVATE_GROUP_ID = "PRIVATE_EXECUTIVE_SOURCE_GROUP_8731";
const PRIVATE_CLAIM_ID = "PRIVATE_EXECUTIVE_SOURCE_CLAIM_8731";
const PRIVATE_CANVAS_ID = "PRIVATE_EXECUTIVE_SOURCE_CANVAS_8731";
const STAKEHOLDER_QUOTE = "The differentiator is not that one brief can make five artifacts; it is that every artifact remains traceable, editable, reviewable, and reusable across devices.";
const SCORES = [
  ["Phone", "39.75"],
  ["Tablet", "53.00"],
  ["Small monitor", "67.25"],
  ["Large monitor", "68.50"],
  ["Adaptive/accessibility", "58.75"],
  ["Governed creative loop", "79.50"],
];

const presentation = (style = "field-notes") => ({
  aspect_ratio: "16:9",
  theme: "Forma executive source evidence",
  footer_label: "Responsive product assessment",
  style_preset: style,
  mode: style === "nocturne" ? "dark" : "light",
  palette: {
    background: "#edf1ef",
    foreground: "#14211d",
    accent: "#287260",
    muted: "#586b64",
    surface: "#d9e3df",
  },
});

function executiveSourceSnapshot({ grouped = true } = {}) {
  return {
    project_id: "PRIVATE_EXECUTIVE_PROJECT_8731",
    document_id: "PRIVATE_EXECUTIVE_DOCUMENT_8731",
    actor_id: "PRIVATE_EXECUTIVE_ACTOR_8731",
    organization_id: "PRIVATE_EXECUTIVE_ORGANIZATION_8731",
    facts: [{
      block_id: PRIVATE_BLOCK_ID,
      type: "direction",
      locked: true,
      properties: {
        label: "Executive source evidence",
        text: [
          "## Responsive evidence and stakeholder decision",
          "Slide 1 — RESPONSIVE ASSESSMENT",
          "Phone: 39.75; Tablet: 53.00; Small monitor: 67.25; Large monitor: 68.50; Adaptive/accessibility: 58.75; Governed creative loop: 79.50.",
          "Exact equal-weight average: 61.125. Rounded display value: 61.13.",
          "",
          "Slide 2 — STAKEHOLDER DIFFERENTIATOR",
          `“${STAKEHOLDER_QUOTE}” — Product Owner`,
        ].join("\n"),
        ...(grouped ? {
          combined_context_memberships: [{
            context_set_id: PRIVATE_GROUP_ID,
            name: "Executive evidence chapter",
            target: "Executive source evidence",
            role: "slide_chapter",
            application: "ordered",
            relativity: .97,
            member_order: 0,
            source_canvas_id: PRIVATE_CANVAS_ID,
          }],
        } : {}),
      },
    }],
    claims: [{
      id: PRIVATE_CLAIM_ID,
      blockId: PRIVATE_BLOCK_ID,
      label: "Authorized executive assessment claim",
      text: "The six source-authored assessment values are protected evidence.",
    }],
    relationships: [],
  };
}

function scorecardSlide({ grouped = true } = {}) {
  return {
    title: "Six-goal responsive assessment",
    body: "Each product dimension contributes equally to the current baseline.",
    notes: "The exact equal-weight average is 61.125; the rounded display value is 61.13.",
    image_prompt: "Editable evidence-led six-row assessment scorecard.",
    context_group_ids: grouped ? ["context_group_1"] : [],
    slide: {
      layout: "scorecard",
      kicker: "Independent baseline",
      bullets: [],
      quote: null,
      citations: [{
        source_id: "blk_001",
        label: "Executive product assessment",
        anchor: "Authored slide 1",
        excerpt: SCORES.map(([label, value]) => `${label}: ${value}`).join("; "),
      }],
      source_ids: ["blk_001"],
      section: "Responsive evidence and stakeholder decision",
      source_order: 1,
      visual: {
        kind: "scorecard",
        label: "Device and capability assessment",
        value: "61.13",
        exact_value: "61.125",
        display_value: "61.13",
        unit: "/ 100",
        data: SCORES.map(([label, value]) => ({
          label,
          value,
          weight: Number(value) / 100,
          exact_value: value,
          display_value: value,
          source_ids: ["blk_001"],
        })),
      },
    },
  };
}

function attributedQuoteSlide({ grouped = true } = {}) {
  return {
    title: "Traceable creative work earns reviewer confidence",
    body: "",
    notes: `Product Owner: “${STAKEHOLDER_QUOTE}”`,
    image_prompt: "A fully attributed, source-grounded stakeholder quotation.",
    context_group_ids: grouped ? ["context_group_1"] : [],
    slide: {
      layout: "quote",
      kicker: "Stakeholder evidence",
      bullets: [],
      quote: {
        text: STAKEHOLDER_QUOTE,
        speaker: "Product Owner",
        role: "Product Owner",
        source_id: "blk_001",
        citation: "Executive source evidence · authored slide 2",
      },
      citations: [{
        source_id: "blk_001",
        label: "Stakeholder interview",
        anchor: "Authored slide 2",
        excerpt: STAKEHOLDER_QUOTE,
      }],
      source_ids: ["blk_001"],
      section: "Responsive evidence and stakeholder decision",
      source_order: 2,
      visual: {
        kind: "quote",
        label: "The product owner's argument",
        value: STAKEHOLDER_QUOTE,
        exact_value: null,
        display_value: null,
        unit: null,
        data: [],
      },
    },
  };
}

function executivePresentation({ grouped = true, style = "field-notes" } = {}) {
  return {
    title: "Forma executive source evidence",
    summary: "A complete, source-grounded executive assessment.",
    content_markdown: [
      "# Forma executive source evidence",
      "",
      "## Six-goal responsive assessment",
      SCORES.map(([label, value]) => `- ${label}: ${value}`).join("\n"),
      "Exact equal-weight average: 61.125. Rounded display value: 61.13.",
      "",
      "## Stakeholder differentiator",
      `> ${STAKEHOLDER_QUOTE}`,
      "> — Product Owner",
    ].join("\n"),
    presentation: presentation(style),
    items: [scorecardSlide({ grouped }), attributedQuoteSlide({ grouped })],
  };
}

function independentSlideSnapshot(){
  const titles=["RESPONSIVE ASSESSMENT","STAKEHOLDER DIFFERENTIATOR","SOURCE GOVERNANCE","DOCUMENT AUTHORSHIP","CONTEXT IMMUTABILITY","PROJECT AUTHORIZATION","REVIEWER ACCOUNTABILITY","RECEIPT TRANSPARENCY","RECOVERY GUARANTEES","ACCESSIBLE DELIVERY","EDITABLE HANDOFF","EXECUTIVE DECISION"];
  const facts=titles.map((title,index)=>({block_id:`PRIVATE_AUTHORED_SLIDE_${index+1}`,type:"direction",locked:true,properties:{label:`Independently authored source ${index+1}`,text:`Slide ${index+1} — ${title}\n${index===0?`${SCORES.map(([label,value])=>`${label}: ${value}`).join("; ")}. Exact equal-weight average: 61.125. Rounded display value: 61.13.`:index===1?`“${STAKEHOLDER_QUOTE}” — Product Owner`:`Independent evidence for ${title.toLowerCase()} preserves conversion ${index+10}.25%.`}`}}));
  for(const [label,type,text] of [["objective","direction","Preserve source evidence."],["audience","audience","Executive stakeholders."],["deliverable","format","Faithful Field Notes presentation."],["exclusion","exclusion","Unsupported fabricated claims."]])facts.push({block_id:`PRIVATE_${label.toUpperCase()}`,type,properties:{label,text}});
  return{facts,relationships:[]};
}

function independentSlideOutput(snapshot){
  const quote=JSON.parse(JSON.stringify(attributedQuoteSlide({grouped:false})).replaceAll("blk_001","blk_002"));
  const items=snapshot.facts.slice(0,12).map((fact,index)=>{
    if(index===0)return scorecardSlide({grouped:false});
    if(index===1)return quote;
    const alias=`blk_${String(index+1).padStart(3,"0")}`;
    const [heading,body]=fact.properties.text.split("\n");
    const title=heading.replace(/^Slide\s+\d+\s*[—–:-]\s*/,"");
    return{title,body,notes:`${body}\n[Sources] Independently authored source ${index+1}`,image_prompt:`Editable source-grounded visual ${index+1}`,context_group_ids:[],slide:{layout:index===11?"closing":"statement",kicker:`Authored decision ${index+1}`,bullets:[],quote:null,citations:[{source_id:alias,label:`Independently authored source ${index+1}`,anchor:`Authored slide ${index+1}`,excerpt:title}],source_ids:[alias],section:null,source_order:index+1,visual:{kind:"hero-type",label:"Authorized authored evidence",value:`Grounded decision ${index+1}`,exact_value:null,display_value:null,unit:null,data:[]}}};
  });
  return{title:"Faithful executive source evidence",summary:"Twelve independently authored and individually attributed slides.",content_markdown:items.map((item,index)=>`## ${index+1}. ${item.title}\n${index===0?`${SCORES.map(([label,value])=>`${label}: ${value}`).join("; ")}. Exact equal-weight average: 61.125. Rounded display value: 61.13.`:index===1?`“${STAKEHOLDER_QUOTE}” — Product Owner`:item.body}`).join("\n\n"),presentation:presentation("field-notes"),items};
}

async function withProviderResponses(outputs, callback) {
  const requests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    assert.equal(String(url), "https://api.openai.com/v1/responses");
    assert.equal(init.method, "POST");
    const request = JSON.parse(String(init.body));
    requests.push({
      request,
      input: JSON.parse(request.input),
    });
    const output = outputs[Math.min(requests.length - 1, outputs.length - 1)];
    assert.ok(output, "a mocked provider output must exist for every submitted request");
    return Response.json({
      id: `presentation-provider-response-${requests.length}`,
      model: "gpt-5.6-terra",
      output_text: JSON.stringify(output),
      usage: { input_tokens: 120, output_tokens: 80, total_tokens: 200 },
    });
  };
  try {
    return await callback(requests);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

const narrationArtifact = (script) => ({
  title: "A spoken review", summary: "Two original perspectives.", content_markdown: script,
  items: [{ title: "The conversation", body: "", notes: "Speak clearly and naturally.", image_prompt: "", context_group_ids: [] }],
});

test("audio planning receives the selected model's fields and script budget before any paid request", async () => {
  const script = `Speaker1: ${"Explain this original decision. ".repeat(85)}\nSpeaker2: ${"Review this independent choice. ".repeat(85)}`;
  await withProviderResponses([narrationArtifact(script)], async (requests) => {
    const result = await generateDocumentArtifact({ OPENAI_API_KEY: "mock-provider-key" }, "authorized-actor", "audio", {
      documentTitle: "A spoken review", snapshot: { facts: [] },
      options: { itemCount: 1, audioProfile: { goal: "narration", speakerCount: 2, destination: "podcast" }, audioProviderModel: GEMINI_TTS_ADAPTER_CONTRACT.model },
    });
    assert.equal(requests.length, 1);
    assert.ok(result.output.content_markdown.length > 5_000);
    assert.equal(result.output.content_markdown, script);
    const contract = requests[0].input.audio.provider_contract;
    assert.equal(contract.model, GEMINI_TTS_ADAPTER_CONTRACT.model);
    assert.equal(contract.provider_prompt_character_limit, 50_000);
    assert.equal(contract.maximum_style_characters, 4_000);
    assert.equal(contract.maximum_combined_utf8_bytes, 7_168);
    assert.deepEqual(contract.speaker_aliases, ["Speaker1", "Speaker2"]);
    assert.equal(requests[0].request.text.format.schema.properties.content_markdown.maxLength, contract.maximum_content_characters);
    assert.match(requests[0].request.instructions, /UTF-8 bytes/);
    assert.ok(requests[0].request.max_output_tokens > contract.maximum_script_utf8_bytes);
  });
  await withProviderResponses([narrationArtifact("An original musical progression.")], async (requests) => {
    await generateDocumentArtifact({ OPENAI_API_KEY: "mock-provider-key", FAL_AUDIO_MODEL: STABLE_AUDIO_ADAPTER_CONTRACT.model }, "authorized-actor", "audio", { documentTitle: "A score", snapshot: { facts: [] }, options: { itemCount: 1 } });
    const contract = requests[0].input.audio.provider_contract;
    assert.equal(contract.model, STABLE_AUDIO_ADAPTER_CONTRACT.model);
    assert.equal(contract.provider_prompt_character_limit, null);
    assert.equal(contract.parameter_limits.duration.maximum, 380);
    assert.deepEqual(contract.parameter_limits.enable_safety_checker.values, [true]);
  });
});

test("approved long speaker labels are restored locally without asking the planner to regenerate immutable words", async () => {
  const script = Array.from({ length: 295 }, () => "abcdefghijklmnopqrstuvwxyzABCDEF: A\nabcdefghijklmnopqrstuvwxyzFEDCBA: B").join("\n");
  await withProviderResponses([narrationArtifact("")], async (requests) => {
    const result = await generateDocumentArtifact({ OPENAI_API_KEY: "mock-provider-key" }, "authorized-actor", "audio", {
      documentTitle: "Approved dialogue", snapshot: { facts: [] }, options: { itemCount: 1, audioProfile: { goal: "narration", speakerCount: 2, transcript: script } },
    });
    assert.ok(script.length > 20_000);
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0].request.text.format.schema.properties.content_markdown, { type: "string", enum: [""] });
    assert.match(requests[0].request.instructions, /inserts those approved words unchanged locally/);
    assert.equal(result.output.content_markdown, script);
    assert.deepEqual(result.usage, { inputTokens: 120, outputTokens: 80, totalTokens: 200 });
  });
});

test("an oversized generated speech payload uses the existing single repair and retains both paid responses", async () => {
  const oversized = narrationArtifact(`A: ${"界".repeat(1_600)}\nB: ${"界".repeat(1_600)}`);
  const repaired = narrationArtifact("Speaker1: Welcome.\nSpeaker2: Let us review the decision.");
  await withProviderResponses([oversized, repaired], async (requests) => {
    const result = await generateDocumentArtifact({ OPENAI_API_KEY: "mock-provider-key" }, "authorized-actor", "audio", {
      documentTitle: "A conversation", snapshot: { facts: [] }, options: { itemCount: 1, audioProfile: { goal: "narration", speakerCount: 2 } },
    });
    assert.equal(requests.length, 2);
    assert.equal(requests[1].request.text.format.name, "document_audio_repair");
    assert.ok(requests[1].input.validation_issues.some((issue) => issue.code === "audio_input_budget_exceeded"));
    assert.deepEqual(requests[0].input.audio.provider_contract, requests[1].input.audio.provider_contract);
    assert.equal(result.output.content_markdown, repaired.content_markdown);
    assert.deepEqual(result.usage, { inputTokens: 240, outputTokens: 160, totalTokens: 400 });
    assert.equal(result.inputReceipt.validation.provider_call_count, 2);
  });
  await withProviderResponses([oversized], async (requests) => {
    await assert.rejects(generateDocumentArtifact({ OPENAI_API_KEY: "mock-provider-key" }, "authorized-actor", "audio", {
      documentTitle: "A conversation", snapshot: { facts: [] }, options: { itemCount: 1, audioProfile: { goal: "narration", speakerCount: 2 } },
    }), (error) => error.detail.code === "audio_preparation_failed" && !error.detail.retryable && error.providerCallCount === 2 && error.providerUsage.totalTokens === 400);
    assert.equal(requests.length, 2);
  });
});

test("immutable oversized scripts and required direction never consume a planning call", async () => {
  await withProviderResponses([narrationArtifact("This response must not be requested.")], async (requests) => {
    for (const [snapshot, audioProfile, audioProviderModel] of [
      [{ facts: [] }, { goal: "narration", transcript: "界".repeat(2_400) }, GEMINI_TTS_ADAPTER_CONTRACT.model],
      [{ facts: [{ type: "direction", locked: true, properties: { text: "a".repeat(4_001) } }] }, { goal: "narration" }, GEMINI_TTS_ADAPTER_CONTRACT.model],
      [{ facts: [{ type: "direction", locked: true, properties: { text: "a".repeat(2_050) } }] }, { goal: "mixed_audio" }, SEED_AUDIO_ADAPTER_CONTRACT.model],
    ]) await assert.rejects(generateDocumentArtifact({ OPENAI_API_KEY: "mock-provider-key" }, "authorized-actor", "audio", { documentTitle: "Approved source", snapshot, options: { itemCount: 1, audioProfile, audioProviderModel } }), (error) => ["audio_input_budget_exceeded", "audio_style_instructions_too_long", "audio_prompt_requirements_exceed_provider_limit"].includes(error.code));
    assert.equal(requests.length, 0);
  });
});

function generateExecutivePresentation(options = {}, snapshot = executiveSourceSnapshot(), env = { OPENAI_API_KEY: "mock-provider-key", OPENAI_MODEL: "gpt-5.6-terra" }) {
  return generateDocumentArtifact(
    env,
    "authorized-executive-actor",
    "slides",
    {
      documentTitle: "Executive source evidence",
      snapshot,
      options: { itemCount: 2, presentationStyle: "field-notes", ...options },
    },
  );
}

function assertRequestContainsNoPrivateSourceIdentifiers(request) {
  const serialized = JSON.stringify(request);
  for (const privateIdentifier of [
    PRIVATE_BLOCK_ID,
    PRIVATE_GROUP_ID,
    PRIVATE_CLAIM_ID,
    PRIVATE_CANVAS_ID,
    "PRIVATE_EXECUTIVE_PROJECT_8731",
    "PRIVATE_EXECUTIVE_DOCUMENT_8731",
    "PRIVATE_EXECUTIVE_ACTOR_8731",
    "PRIVATE_EXECUTIVE_ORGANIZATION_8731",
  ]) assert.equal(serialized.includes(privateIdentifier), false, `provider request leaked ${privateIdentifier}`);
}

test("the strict slideshow schema preserves complete attributed quotes, editable scorecards, and an explicitly selected presentation style", async () => {
  await withProviderResponses([executivePresentation()], async (requests) => {
    const result = await generateExecutivePresentation();
    assert.equal(requests.length, 1);

    const { request, input } = requests[0];
    const schema = request.text.format.schema;
    const slideSchema = schema.properties.items.items.properties.slide;
    const visualSchema = slideSchema.properties.visual;
    assert.equal(request.text.format.strict, true);
    assert.equal(schema.additionalProperties, false);
    assert.equal(schema.properties.items.minItems,2,"the provider schema must require the exact approved slide count");
    assert.equal(schema.properties.items.maxItems,2,"the provider schema must reject partial or expanded presentation output");
    assert.ok(slideSchema.properties.quote.properties.text.maxLength >= 1_000, "attributed quotations cannot inherit the legacy 120-character ceiling");
    assert.ok(visualSchema.properties.value.maxLength >= 1_000, "quote-card visible copy must retain a complete protected quotation");
    assert.ok(slideSchema.properties.bullets.maxItems >= 24);
    assert.ok(slideSchema.properties.citations.maxItems >= 24);
    assert.ok(visualSchema.properties.data.maxItems >= 48, "editable scorecards and comparison matrices must not be capped at five rows");
    assert.equal(visualSchema.properties.label.minLength,undefined,"an independently meaningful visual must never require a boilerplate caption");
    assert.equal(visualSchema.properties.data.items.properties.value.minLength,undefined,"category-only architecture nodes must not be forced to invent or repeat a value");
    assert.ok(slideSchema.properties.source_ids.maxItems >= 24);
    assert.deepEqual(schema.properties.presentation.properties.style_preset.enum, ["field-notes"], "an explicitly selected deck style must be schema-locked before the first provider call");
    assert.match(request.instructions,/visual label is optional/i);
    assert.match(request.instructions,/never boilerplate such as Visual emphasis/i);
    assert.match(request.instructions,/repeated complete opening sentence or substantial lead-in/i);

    assert.equal(input.creative_context.facts[0].source_key, "blk_001");
    assert.deepEqual(input.creative_context.facts[0].source_group_keys, ["grp_001"]);
    assert.deepEqual(input.creative_context.facts[0].source_claim_keys, ["clm_001"]);
    assert.equal(input.creative_context.claims[0].source_key, "clm_001");
    assert.equal(input.creative_context.claims[0].source_block_key, "blk_001");
    assert.equal(input.presentation_source.authoredSlideCount, 2);
    assert.deepEqual(input.presentation_source.outline.map((slide) => slide.sourceAlias), ["blk_001", "blk_001"]);
    assert.equal(input.presentation_source.protectedFacts.filter((fact) => fact.precision === "source").length, 6);
    assert.equal(input.presentation_source.protectedQuotes[0].text, STAKEHOLDER_QUOTE);
    assertRequestContainsNoPrivateSourceIdentifiers(request);

    const [scorecard, stakeholder] = result.output.items;
    assert.deepEqual(scorecard.slide.visual.data.map(({ label, value }) => [label, value]), SCORES);
    assert.equal(scorecard.slide.visual.data[1].value, "53.00", "trailing source precision must remain visible");
    assert.equal(scorecard.slide.visual.exactValue, "61.125");
    assert.equal(scorecard.slide.visual.displayValue, "61.13");
    assert.ok(scorecard.slide.sourceIds.includes(PRIVATE_BLOCK_ID));
    assert.equal(scorecard.slide.sourceIds.includes("blk_001"), false, "request aliases must resolve before durable slide storage");
    assert.ok(STAKEHOLDER_QUOTE.length > 120);
    assert.equal(stakeholder.slide.quote.text, STAKEHOLDER_QUOTE);
    assert.equal(stakeholder.slide.visual.value, STAKEHOLDER_QUOTE);
    assert.equal(stakeholder.slide.quote.speaker, "Product Owner");
    assert.equal(stakeholder.slide.quote.role, "Product Owner");
    assert.equal(stakeholder.slide.quote.sourceId, PRIVATE_BLOCK_ID);
    assert.equal(stakeholder.slide.citations[0].sourceId, PRIVATE_BLOCK_ID);
    assert.ok(stakeholder.notes.includes(STAKEHOLDER_QUOTE));
    assert.ok(result.output.content_markdown.includes(STAKEHOLDER_QUOTE));
    assert.deepEqual(result.output.items.map((item) => item.context_group_ids), [[PRIVATE_GROUP_ID], [PRIVATE_GROUP_ID]]);
    assert.deepEqual(result.inputReceipt.validation.source_resolution.initial.rawAssignments, [["blk_001"], ["blk_001"]]);
    assert.deepEqual(result.inputReceipt.validation.source_resolution.initial.canonicalAssignments, [[PRIVATE_BLOCK_ID], [PRIVATE_BLOCK_ID]]);
    assert.deepEqual(result.inputReceipt.validation.source_resolution.initial.unknownAssignments, []);
    assert.equal(result.inputReceipt.validation.repair_attempted, false);
    assert.equal(result.inputReceipt.validation.maximum_provider_calls, 2);
    assert.equal(result.inputReceipt.validation.provider_call_count, 1);
    assert.deepEqual(result.usage, { inputTokens: 120, outputTokens: 80, totalTokens: 200 });
  });
});

test("faithfully renders twelve independently authored blocks with exact quotations, numerical evidence, and Field Notes styling in one provider request",async()=>{
  const snapshot=independentSlideSnapshot();
  await withProviderResponses([independentSlideOutput(snapshot)],async(requests)=>{
    const result=await generateDocumentArtifact({OPENAI_API_KEY:"mock-provider-key",OPENAI_MODEL:"gpt-5.6-terra"},"authorized-executive-actor","slides",{
      documentTitle:"Event-Sourced Conversational Experience — Executive Plan",snapshot,
      options:{itemCount:12,requestedSlideCount:12,presentationStyle:"field-notes",presentationFidelity:"faithful"},
    });

    assert.equal(requests.length,1);
    assert.deepEqual(requests[0].input.presentation_source.outline.map((slide)=>slide.sourceAlias),Array.from({length:12},(_,index)=>`blk_${String(index+1).padStart(3,"0")}`));
    assert.deepEqual(result.output.items.map((item)=>item.slide.sourceIds[0]),snapshot.facts.slice(0,12).map((fact)=>fact.block_id));
    assert.equal(result.output.presentation.stylePreset,"field-notes");
    assert.equal(result.output.items[0].slide.visual.exactValue,"61.125");
    assert.equal(result.output.items[0].slide.visual.displayValue,"61.13");
    assert.equal(result.output.items[1].slide.quote.text,STAKEHOLDER_QUOTE);
    assert.equal(result.output.items[1].slide.quote.role,"Product Owner");
    assert.doesNotMatch(JSON.stringify(requests[0].request),/PRIVATE_/);
  });
});

test("repairs a repeated slide title and empty hero from that slide's exact authored source without a paid repair",async()=>{
  const snapshot=independentSlideSnapshot();
  const output=independentSlideOutput(snapshot);
  const originalBody=output.items[3].body;
  output.items[3].title=output.items[2].slide.visual.value;
  output.items[3].slide.visual.value=output.items[3].title;
  await withProviderResponses([output],async(requests)=>{
    const generated=await generateDocumentArtifact({OPENAI_API_KEY:"mock-provider-key",OPENAI_MODEL:"gpt-5.6-terra"},"authorized-executive-actor","slides",{documentTitle:"Independent approved presentation",snapshot,options:{itemCount:12,requestedSlideCount:12,presentationStyle:"field-notes",presentationFidelity:"faithful"}});
    assert.equal(requests.length,1,"source-grounded local title and visual repairs must not initiate another provider request");
    assert.equal(generated.output.items[3].title,"DOCUMENT AUTHORSHIP");
    assert.equal(generated.output.items[3].body,"");
    assert.equal(generated.output.items[3].slide.visual.value,originalBody);
    assert.deepEqual(generated.output.items[3].slide.sourceIds,["PRIVATE_AUTHORED_SLIDE_4"]);
    assert.equal(generated.output.items[0].slide.visual.exactValue,"61.125");
    assert.equal(generated.output.items[1].slide.quote.text,STAKEHOLDER_QUOTE);
    assert.deepEqual(generated.inputReceipt.validation.initial_issues,[]);
    assert.doesNotMatch(requests[0].request.instructions,/Phone\/Tablet\/Small-snapped-monitor|Write\/Shape\/Present/u,"instructions must not import another document's device and product categories");
  });
});

test("classifies paid output exhaustion, provider refusals, and empty presentation responses without blind retries",async()=>{
  const variants=[
    {name:"output limit",envelope:{status:"incomplete",incomplete_details:{reason:"max_output_tokens"},output_text:'{"items":['},code:"presentation_output_limit_reached"},
    {name:"provider refusal",envelope:{status:"completed",output:[{content:[{type:"refusal",refusal:"Private provider safety rationale"}]}],output_text:""},code:"presentation_provider_refused"},
    {name:"empty response",envelope:{status:"completed",output_text:""},code:"presentation_empty_provider_response"},
  ];
  for(const variant of variants){
    const previous=globalThis.fetch;const receipts=[];let calls=0;
    globalThis.fetch=async()=>{calls+=1;return Response.json({id:`paid-${calls}`,model:"gpt-5.6-terra",usage:{input_tokens:40,output_tokens:20,total_tokens:60},...variant.envelope});};
    try{
      await assert.rejects(()=>generateExecutivePresentation({onProviderResponse:(receipt)=>receipts.push(receipt)}),(error)=>error.detail?.code===variant.code&&error.providerCallCount===1,variant.name);
      assert.equal(calls,1,`${variant.name} must stop after the already-paid response`);
      assert.equal(receipts.length,1,"the paid response must be checkpointed before its completion status is classified");
      assert.equal(receipts[0].completionStatus,variant.envelope.status);
      assert.doesNotMatch(JSON.stringify(receipts[0]),/Private provider safety rationale/u);
    }finally{globalThis.fetch=previous;}
  }
});

test("locally repairs category-only proposal rows without submitting a second paid slideshow request",async()=>{
  const snapshot=independentSlideSnapshot();
  const categories=["authorized evidence","affected resources","expected revision","approval requirements","cost when relevant"];
  snapshot.facts[5].properties.text+=` Proposal ingredients preserve ${categories.join(", ")}.`;
  const output=independentSlideOutput(snapshot);
  output.items[5].slide.layout="matrix";
  output.items[5].slide.visual={kind:"matrix",label:"Proposal ingredients",value:"",exact_value:null,display_value:null,unit:null,data:categories.map((label)=>({label,value:label,weight:.8,exact_value:null,display_value:null,source_ids:["blk_006"]}))};

  await withProviderResponses([output],async(requests)=>{
    const result=await generateDocumentArtifact({OPENAI_API_KEY:"mock-provider-key",OPENAI_MODEL:"gpt-5.6-terra"},"authorized-executive-actor","slides",{
      documentTitle:"Event-Sourced Conversational Experience — Executive Plan",snapshot,
      options:{itemCount:12,requestedSlideCount:12,presentationStyle:"field-notes",presentationFidelity:"faithful"},
    });

    assert.equal(requests.length,1,"echoed category-only visual values are corrected without a second paid provider call");
    assert.equal(result.output.items[5].slide.layout,"architecture");
    assert.equal(result.output.items[5].slide.visual.kind,"architecture");
    assert.deepEqual(result.output.items[5].slide.visual.data.map(({label,value,sourceIds})=>({label,value,sourceIds})),categories.map((label)=>({label,value:"",sourceIds:[snapshot.facts[5].block_id]})));
    assert.equal(result.inputReceipt.validation.repair_attempted,false);
    assert.match(requests[0].request.instructions,/architecture visual with an empty string for each category-only row value/i);
  });
});

test("preserves source-authored recurring legacy formats on slide five without a paid repair",async()=>{
  const sourceId="PRIVATE_PITCH_FEEDBACK_SOURCE_8731";
  const authored=[
    "Slide 1 — One context, infinite paths\nForma replaces fragmented .doc, .ppt, .mov, .mp3, and .psd handoffs with one living context.",
    "Slide 2 — Gather meaningful context\nCollect each independently useful decision.",
    "Slide 3 — Choose the best medium\nRespect the audience and moment.",
    "Slide 4 — Preserve the message\nMaintain every source-authored promise.",
    "Slide 5 — Close the trust gap\nVisual storyboard beats: scattered .doc/.ppt/.mov/.mp3/.psd files; one unified creative context.",
    "Slide 6 — Restore human confidence\nMake each delivery reviewable.",
  ];
  const snapshot={facts:[{block_id:sourceId,type:"direction",properties:{label:"Authored end-user feedback",text:authored.join("\n")}}],relationships:[]};
  const rowValue="scattered .doc/.ppt/.mov/.mp3/.psd files";
  const titles=["One context, infinite paths","Gather meaningful context","Choose the best medium","Preserve the message","Close the trust gap","Restore human confidence"];
  const heroValues=[".doc · .ppt · .mov · .mp3 · .psd","Collect useful decisions","Respect each audience","Keep authored intent","unused","Review every delivery"];
  const output={title:"Pitch context feedback",summary:"An independently source-grounded end-user assessment.",content_markdown:`# Pitch context feedback\n${authored.join("\n\n")}`,presentation:presentation("field-notes"),items:titles.map((title,index)=>({title,body:"",notes:"Retain the exact independently authored evidence.",image_prompt:"Editable source-grounded visual.",context_group_ids:[],slide:{layout:index===4?"timeline":index===0?"cover":"statement",kicker:`Evidence ${index+1}`,bullets:[],source_ids:["blk_001"],source_order:index+1,visual:index===4?{kind:"timeline",label:"Creative delivery sequence",value:"",data:[{label:"Fragmented handoffs",value:rowValue,weight:1,source_ids:["blk_001"]},{label:"Unified Forma context",value:"one unified creative context",weight:.8,source_ids:["blk_001"]}]}:{kind:"hero-type",label:"Authored emphasis",value:heroValues[index],data:[]}}}))};

  await withProviderResponses([output],async(requests)=>{
    const result=await generateDocumentArtifact({OPENAI_API_KEY:"mock-provider-key",OPENAI_MODEL:"gpt-5.6-terra"},"authorized-end-user","slides",{documentTitle:"Pitch context feedback",snapshot,options:{itemCount:6,requestedSlideCount:6,presentationStyle:"field-notes",presentationFidelity:"faithful"}});
    assert.equal(requests.length,1,"independently authored recurring visual evidence must never trigger a second paid response");
    assert.equal(result.inputReceipt.validation.repair_attempted,false);
    assert.deepEqual(result.inputReceipt.validation.initial_issues,[]);
    assert.equal(result.output.items[0].slide.visual.value,".doc · .ppt · .mov · .mp3 · .psd");
    assert.equal(result.output.items[4].slide.visual.data[0].value,rowValue);
    assert.deepEqual(result.output.items[4].slide.visual.data[0].sourceIds,[sourceId]);

    const retained=assessStoredPresentationCandidate(JSON.stringify(output),snapshot,{itemCount:6,requestedSlideCount:6,presentationStyle:"field-notes",presentationFidelity:"faithful"});
    assert.deepEqual(retained.issues,[],"the same grounded recurrence must allow zero-provider recovery of an already-paid draft");
    assert.equal(retained.output.items[4].slide.visual.data[0].value,rowValue);
    assert.equal(requests.length,1,"reassessing a retained paid response never contacts the provider");
  });
});

test("preserves an exact authored opening-to-closing promise without a paid presentation repair",async()=>{
  const sourceId="PRIVATE_PITCH_PROMISE_SOURCE_8731";
  const promise="Your content. One context. Infinite paths to your target.";
  const authored=Array.from({length:9},(_,index)=>index===0?`Slide 1 — ${promise}\nOpen with the exact approved promise.`:index===8?`Slide 9 — Confident delivery\nClose with the exact promise: ${promise}`:`Slide ${index+1} — Independently authored chapter ${index+1}\nAdvance a distinct customer decision ${index+1}.`);
  const snapshot={facts:[{block_id:sourceId,type:"direction",properties:{label:"Authored Forma pitch",text:authored.join("\n")}}],relationships:[]};
  const heroValues=["Shared creative beginning","Gather meaningful context","Choose relevant delivery","Adapt each expression","Respect individual attention","Keep durable decisions","Follow productive paths","Protect human control","Reach the intended audience"];
  const output={title:"Pitch context",summary:"One exact opening promise returns in its authored closing.",content_markdown:`# Pitch context\n${authored.join("\n\n")}`,presentation:presentation("editorial"),items:heroValues.map((value,index)=>({title:index===0?promise:index===8?"Confident delivery":`Authored chapter ${index+1}`,body:index===8?promise:"",notes:"Keep the exact approved source-authored promise.",image_prompt:"Source-grounded editable creative direction.",context_group_ids:[],slide:{layout:index===0?"cover":index===8?"closing":"statement",kicker:`Decision ${index+1}`,bullets:[],source_ids:["blk_001"],source_order:index+1,visual:{kind:"hero-type",label:"Independent emphasis",value,data:[]}}}))};

  await withProviderResponses([output],async(requests)=>{
    const result=await generateDocumentArtifact({OPENAI_API_KEY:"mock-provider-key",OPENAI_MODEL:"gpt-5.6-terra"},"authorized-end-user","slides",{documentTitle:"Pitch context",snapshot,options:{itemCount:9,requestedSlideCount:9,presentationStyle:"editorial",presentationFidelity:"faithful"}});
    assert.equal(requests.length,1,"the source-authored opening and closing promise must not submit a second paid request");
    assert.equal(result.inputReceipt.validation.repair_attempted,false);
    assert.deepEqual(result.inputReceipt.validation.initial_issues,[]);
    assert.equal(result.output.items[0].title,promise);
    assert.equal(result.output.items[8].body,promise);
    assert.equal(requests[0].input.presentation_source.outline.length,9);
  });
});

test("repairs redundant title-and-question visuals before a second paid slideshow request",async()=>{
  for(const variant of ["row-values","row-labels"]){
    const snapshot=independentSlideSnapshot();
    const output=independentSlideOutput(snapshot);
    const item=output.items[2];
    const sourceAlias=item.slide.source_ids[0];
    const originalBody=item.body;
    item.slide.layout=variant==="row-values"?"comparison":"architecture";
    item.slide.visual={
      kind:item.slide.layout,label:"Opening concepts",value:"",exact_value:null,display_value:null,unit:null,
      data:variant==="row-values"
        ?[{label:"Title",value:item.title,weight:1,source_ids:[sourceAlias]},{label:"Question",value:originalBody,weight:.8,source_ids:[sourceAlias]}]
        :[{label:item.title,value:item.title,weight:1,source_ids:[sourceAlias]},{label:originalBody,value:originalBody,weight:.8,source_ids:[sourceAlias]}],
    };

    await withProviderResponses([output],async(requests)=>{
      const result=await generateDocumentArtifact({OPENAI_API_KEY:"mock-provider-key",OPENAI_MODEL:"gpt-5.6-terra"},"authorized-executive-actor","slides",{
        documentTitle:"Event-Sourced Conversational Experience — Executive Plan",snapshot,
        options:{itemCount:12,requestedSlideCount:12,presentationStyle:"field-notes",presentationFidelity:"faithful"},
      });

      assert.equal(requests.length,1,`${variant}: cosmetic source-faithful normalization never submits a second paid request`);
      assert.equal(result.inputReceipt.validation.repair_attempted,false);
      assert.deepEqual(result.inputReceipt.validation.initial_issues,[]);
      assert.ok(result.output.items[2].slide.sourceIds.includes(snapshot.facts[2].block_id));
      if(variant==="row-values"){
        assert.equal(result.output.items[2].slide.visual.kind,"architecture");
        assert.deepEqual(result.output.items[2].slide.visual.data.map(({value})=>value),["",""]);
        assert.equal(result.output.items[2].body,originalBody);
      }else{
        assert.equal(result.output.items[2].slide.visual.kind,"hero-type");
        assert.equal(result.output.items[2].slide.visual.value,originalBody);
        assert.equal(result.output.items[2].body,"");
      }
      assert.equal(result.output.items[0].slide.visual.exactValue,"61.125");
      assert.equal(result.output.items[1].slide.quote.text,STAKEHOLDER_QUOTE);
    });
  }
});

test("retains authored body categories, editable visual labels, and zero-valued release controls without a second paid presentation request",async()=>{
  const snapshot=independentSlideSnapshot();
  const acceptanceCriteria=" Deliver safety and source integrity first, then event-derived projections, nonblocking coordinator lanes, atomic proposals, complete output orchestration, and page-specific adapters. Measure zero lost turns, zero unauthorized actions, correct selections, bounded context, all 61 route policies, and four-language parity.";
  snapshot.facts[7].properties.text=snapshot.facts[7].properties.text.replace("for receipt transparency ","")+" Decision decomposition separates bounded choices before execution.";
  snapshot.facts[10].properties.text+=" Private conversations remain access-controlled and specialist permissions constrain authorized collaboration.";
  snapshot.facts[11].properties.text+=acceptanceCriteria;
  const output=independentSlideOutput(snapshot);
  const decomposition=output.items[7];
  decomposition.slide.layout="matrix";
  decomposition.slide.visual={kind:"matrix",label:"Independent execution controls",value:"",exact_value:null,display_value:null,unit:null,data:[
    {label:"Decision decomposition",value:"bounded",weight:1,exact_value:null,display_value:null,source_ids:["blk_008"]},
    {label:"Execution authority",value:"verified",weight:1,exact_value:null,display_value:null,source_ids:["blk_008"]},
  ]};
  const collaboration=output.items[10];
  collaboration.slide.layout="matrix";
  collaboration.slide.visual={kind:"matrix",label:"Independent collaboration controls",value:"",exact_value:null,display_value:null,unit:null,data:[
    {label:"Private conversations",value:"restricted",weight:1,exact_value:null,display_value:null,source_ids:["blk_011"]},
    {label:"Specialist permissions",value:"scoped",weight:1,exact_value:null,display_value:null,source_ids:["blk_011"]},
  ]};
  const closing=output.items[11];
  closing.slide.layout="matrix";
  closing.slide.visual={kind:"matrix",label:"Independent release controls",value:"",exact_value:null,display_value:null,unit:null,data:[
    {label:"Safety and source integrity",value:"first",weight:1,exact_value:null,display_value:null,source_ids:["blk_012"]},
    {label:"Event-derived projections",value:"event-derived",weight:1,exact_value:null,display_value:null,source_ids:["blk_012"]},
    {label:"Coordinator lanes",value:"nonblocking",weight:1,exact_value:null,display_value:null,source_ids:["blk_012"]},
    {label:"Change proposals",value:"atomic",weight:1,exact_value:null,display_value:null,source_ids:["blk_012"]},
    {label:"Route policies",value:"61",weight:1,exact_value:null,display_value:null,source_ids:["blk_012"]},
    {label:"Language parity",value:"four",weight:1,exact_value:null,display_value:null,source_ids:["blk_012"]},
    {label:"Lost conversation turns",value:"zero",weight:1,exact_value:null,display_value:null,source_ids:["blk_012"]},
    {label:"Unauthorized actions",value:"zero",weight:1,exact_value:null,display_value:null,source_ids:["blk_012"]},
    {label:"Output orchestration",value:"complete",weight:1,exact_value:null,display_value:null,source_ids:["blk_012"]},
  ]};

  await withProviderResponses([output],async(requests)=>{
    const result=await generateDocumentArtifact({OPENAI_API_KEY:"mock-provider-key",OPENAI_MODEL:"gpt-5.6-terra"},"authorized-executive-actor","slides",{
      documentTitle:"Event-Sourced Conversational Experience — Executive Plan",snapshot,
      options:{itemCount:12,requestedSlideCount:12,presentationStyle:"field-notes",presentationFidelity:"faithful"},
    });

    assert.equal(requests.length,1,"source-faithful category labels and matching measurements must not trigger a second paid provider request");
    assert.match(result.output.items[7].body,/Decision decomposition/u);
    assert.match(result.output.items[10].body,/Private conversations.*specialist permissions/u);
    assert.match(result.output.items[11].body,/event-derived projections.*output orchestration/u);
    assert.equal(result.output.items[11].slide.visual.data.length,9);
    assert.deepEqual(result.output.items[11].slide.visual.data.slice(6,8).map(({label,value})=>({label,value})),[
      {label:"Lost conversation turns",value:"zero"},
      {label:"Unauthorized actions",value:"zero"},
    ]);
    assert.deepEqual([result.output.items[7].slide.visual.data[0].label,...result.output.items[10].slide.visual.data.map(({label})=>label),result.output.items[11].slide.visual.data[1].label,result.output.items[11].slide.visual.data[8].label],["Decision decomposition","Private conversations","Specialist permissions","Event-derived projections","Output orchestration"]);
    assert.equal(result.inputReceipt.validation.repair_attempted,false);
    assert.deepEqual(result.inputReceipt.validation.initial_issues,[]);
    assert.equal(result.inputReceipt.validation.provider_call_count,1);
    assert.match(requests[0].request.instructions,/different[^.]*visual\.data[^.]*same[^.]*value|visual\.data[^.]*same[^.]*value/i,"provider instructions must explicitly preserve equal authored values across distinct rows");
    assert.match(requests[0].request.instructions,/visual\.data row labels[^.]*longer[^.]*body/i,"provider instructions must explicitly preserve concise authored visual categories within independently meaningful body copy");
  });
});

test("preserves the authored audience language when the application interface uses Japanese",async()=>{
  await withProviderResponses([executivePresentation()],async(requests)=>{
    await generateExecutivePresentation({locale:"ja-JP"});
    assert.equal(requests.length,1);
    assert.match(requests[0].request.instructions,/selected language \(en\)/u);
    assert.match(requests[0].request.instructions,/interface language \(ja-JP\)/u);
    assert.doesNotMatch(requests[0].request.instructions,/selected language \(ja(?:-JP)?\)/u);
  });
});

test("canonicalizes public source labels and hides producer-only instructions before retaining a slide deck",async()=>{
  const output=executivePresentation();
  output.items[1].slide.citations[0].label="blk_001";
  output.items[1].slide.citations[0].anchor="grp_001";
  output.items[1].slide.quote.citation="blk_001";
  const hidden="Authored presentation-ready narrative only; no generation, spend, publication or unsupported ROI claims.";
  output.items[1].slide.bullets=[hidden];
  output.items[1].notes+=`\n${hidden}`;
  output.content_markdown+=`\n\n## 1. Responsive assessment\nSources: blk_001\n\n## 2. Stakeholder decision\nSources: blk_001\n${hidden}`;
  await withProviderResponses([output],async(requests)=>{
    const result=await generateExecutivePresentation();
    assert.equal(requests.length,1);
    assert.doesNotMatch(result.output.content_markdown,/\b(?:blk|grp|clm)_\d+\b/u);
    assert.doesNotMatch(result.output.content_markdown,/no generation, spend, publication/u);
    assert.doesNotMatch(result.output.items[1].notes,/no generation, spend, publication/u);
    assert.deepEqual(result.output.items[1].slide.bullets,[]);
    assert.equal(result.output.items[1].slide.citations[0].label,"STAKEHOLDER DIFFERENTIATOR");
    assert.equal(result.output.items[1].slide.citations[0].anchor,"");
    assert.equal(result.output.items[1].slide.quote.citation,"STAKEHOLDER DIFFERENTIATOR");
  });
});

test("repairs a fabricated citation excerpt once without disclosing private identifiers",async()=>{
  const invented=executivePresentation();
  invented.items[0].slide.citations[0].excerpt="Independent auditors certify 999.99% unrestricted enterprise readiness.";
  await withProviderResponses([invented,executivePresentation()],async(requests)=>{
    const result=await generateExecutivePresentation();
    assert.equal(requests.length,2);
    assert.equal(result.inputReceipt.validation.repair_attempted,true);
    assert.ok(result.inputReceipt.validation.initial_issues.some((issue)=>issue.code==="ungrounded_citation_excerpt"));
    assert.match(requests[1].request.instructions,/visual\.data row labels[^.]*longer[^.]*body/i,"bounded repair must retain authored visual categories that also appear in independently meaningful body copy");
    assertRequestContainsNoPrivateSourceIdentifiers(requests[1].request);
  });
});

test("fails closed after the bounded repair if a citation excerpt remains fabricated",async()=>{
  const invented=executivePresentation();
  invented.items[0].slide.citations[0].excerpt="Independent auditors certify 999.99% unrestricted enterprise readiness.";
  await withProviderResponses([invented,invented],async(requests)=>{
    await assert.rejects(generateExecutivePresentation(),(error)=>error.detail?.code==="source_fidelity_validation_failed"&&error.detail.retryable===false);
    assert.equal(requests.length,2);
    requests.forEach(({request})=>assertRequestContainsNoPrivateSourceIdentifiers(request));
  });
});

test("locally restores authored posture, mode, and roadmap visuals without a second paid request",async()=>{
  const snapshot=executiveSourceSnapshot();
  snapshot.facts[0].properties.text+=[
    "",
    "Slide 3 — ONE PRODUCT, FOUR POSTURES",
    "ONE PRODUCT, FOUR POSTURES: Phone = exact next action; Tablet = touch-rich exploration and two useful panes; Small/snapped monitor = complete work + one chosen pane; Large monitor = source → work → result → review relationships.",
    "Slide 4 — UNDERSTANDABLE MODES",
    "UNDERSTANDABLE MODES: preserve seven document views; present explicit Write / Shape / Present families without changing routes, ownership or entitlement.",
    "Slide 5 — FIRST RELEASE, 4–6 WEEKS",
    "FIRST RELEASE, 4–6 WEEKS: visible phone Search/Send, complete collections, measured 44×44px essential targets, short-height posture, stable destinations, exact scoped Activity/review access.",
    "Slide 6 — FULL PROGRAM, 12–16 WEEKS",
    "FULL PROGRAM, 12–16 WEEKS: truth/baseline → adaptive shell → secure Activity → phone Work/Chat → Explore continuity → touch-native tablet Canvas → wide workbench/truthful collaboration → accessibility/trust evidence.",
  ].join("\n");
  const output=executivePresentation();
  for(const [number,title,kind,bullets] of [
    [3,"ONE PRODUCT, FOUR POSTURES","comparison",["Phone = exact next action","Tablet = touch-rich exploration and two useful panes","Small/snapped monitor = complete work + one chosen pane","Large monitor = source → work → result → review relationships"]],
    [4,"UNDERSTANDABLE MODES","matrix",["Write","Shape","Present"]],
    [5,"FIRST RELEASE, 4–6 WEEKS","roadmap",["visible phone Search/Send","complete collections","measured 44×44px essential targets","short-height posture","stable destinations","exact scoped Activity/review access"]],
    [6,"FULL PROGRAM, 12–16 WEEKS","timeline",["truth/baseline","adaptive shell","secure Activity","phone Work/Chat","Explore continuity","touch-native tablet Canvas","wide workbench/truthful collaboration","accessibility/trust evidence"]],
  ]){
    output.items.push({title,body:`Authored executive decision ${number}.`,notes:`Discuss ${title} with the executive audience.`,image_prompt:"Source-grounded semantic editable visual.",context_group_ids:["context_group_1"],slide:{layout:kind,kicker:`Authored position ${number}`,bullets,quote:null,citations:[{source_id:"blk_001",label:"Authorized executive source",anchor:`Slide ${number}`,excerpt:title}],source_ids:["blk_001"],section:"Responsive evidence and stakeholder decision",source_order:number,visual:{kind,label:`Source evidence ${number}`,value:number===6?"12–16 weeks":"",exact_value:null,display_value:null,unit:null,data:[]}}});
    output.content_markdown+=`\n\n## ${number}. ${title}\n${bullets.join("\n")}`;
  }
  await withProviderResponses([output],async(requests)=>{
    const result=await generateExecutivePresentation({itemCount:6,requestedSlideCount:6},snapshot);
    assert.equal(requests.length,1,"source-local visual completion must not incur a metered repair");
    assert.equal(result.inputReceipt.validation.repair_attempted,false);
    const [postures,modes,roadmap,fullProgram]=result.output.items.slice(2);
    assert.deepEqual(postures.slide.visual.data.map(({label,value})=>[label,value]),[["Phone","exact next action"],["Tablet","touch-rich exploration and two useful panes"],["Small/snapped monitor","complete work + one chosen pane"],["Large monitor","source → work → result → review relationships"]]);
    assert.equal(modes.slide.layout,"architecture");
    assert.equal(modes.slide.visual.kind,"architecture");
    assert.deepEqual(modes.slide.visual.data.map(({label})=>label),["Write","Shape","Present"]);
    assert.equal(roadmap.slide.visual.kind,"roadmap");
    assert.equal(roadmap.slide.visual.value,"4–6 weeks");
    assert.deepEqual(roadmap.slide.visual.data.map(({label})=>label),["visible phone Search/Send","complete collections","measured 44×44px essential targets","short-height posture","stable destinations","exact scoped Activity/review access"]);
    assert.equal(fullProgram.slide.visual.value,"12–16 weeks");
    assert.deepEqual(fullProgram.slide.visual.data.map(({label})=>label),["truth/baseline","adaptive shell","secure Activity","phone Work/Chat","Explore continuity","touch-native tablet Canvas","wide workbench/truthful collaboration","accessibility/trust evidence"]);
    for(const item of [postures,modes,roadmap,fullProgram]){
      assert.deepEqual(item.slide.bullets,[],"claims promoted into the editable visual must not remain duplicated bullets");
      assert.equal(item.slide.visual.data.every((datum)=>datum.sourceIds?.[0]===PRIVATE_BLOCK_ID),true);
    }
    assert.equal(result.output.items[0].slide.visual.data.length,6,"protected scorecard fidelity remains independently enforced");
  });
});

test("locally preserves authored brand typography without broadening the provider output schema",async()=>{
  const snapshot=executiveSourceSnapshot();
  snapshot.facts[0].properties.text=`Typography: Helvetica Neue\n${snapshot.facts[0].properties.text}`;
  await withProviderResponses([executivePresentation()],async(requests)=>{
    const result=await generateExecutivePresentation({},snapshot);
    assert.equal(requests.length,1);
    assert.equal(requests[0].input.presentation_source.style.typography,"Helvetica Neue");
    assert.equal(result.output.presentation.fontFamily,"Helvetica Neue");
  });
});

test("accepts source-authored roadmap duration precision without a needless paid repair", async () => {
  const snapshot = executiveSourceSnapshot();
  snapshot.facts[0].properties.text += [
    "",
    "Slide 3 — FIRST RELEASE, 4–6 WEEKS",
    "First release: 4–6 weeks. Visible phone search and send.",
    "Slide 4 — FULL PROGRAM, 12–16 WEEKS",
    "Full program: 12–16 weeks. Accessible adaptive creative work.",
  ].join("\n");

  const output = executivePresentation();
  output.content_markdown += "\n\nFirst release: 4–6 weeks.\nFull program: 12–16 weeks.";
  for (const [index, label, duration, milestone] of [
    [3, "First release", "4–6 weeks", "Visible phone search and send"],
    [4, "Full program", "12–16 weeks", "Accessible adaptive creative work"],
  ]) {
    output.items.push({
      title: `${label.toUpperCase()}, ${duration.toUpperCase()}`,
      body: `${label}: ${duration}. ${milestone}.`,
      notes: `${label} remains ${duration}. ${milestone}.`,
      image_prompt: `An editable ${label.toLowerCase()} delivery roadmap.`,
      context_group_ids: ["context_group_1"],
      slide: {
        layout: "roadmap",
        kicker: "Delivery phase",
        bullets: [],
        quote: null,
        citations: [{ source_id: "blk_001", label, anchor: `Authored slide ${index}`, excerpt: `${label}: ${duration}` }],
        source_ids: ["blk_001"],
        section: "Responsive evidence and stakeholder decision",
        source_order: index,
        visual: {
          kind: "roadmap",
          label,
          value: duration,
          exact_value: duration,
          display_value: duration,
          unit: "weeks",
          data: [
            { label: "Phase", value: duration, weight: 1, exact_value: null, display_value: null, source_ids: ["blk_001"] },
            { label: "Outcome", value: milestone, weight: 1, exact_value: null, display_value: null, source_ids: ["blk_001"] },
          ],
        },
      },
    });
  }

  await withProviderResponses([output], async (requests) => {
    const result = await generateExecutivePresentation({ itemCount: 4, requestedSlideCount: 4 }, snapshot);
    assert.equal(requests.length, 1, "valid authored roadmap durations must not initiate a second paid model request");
    assert.equal(result.inputReceipt.validation.repair_attempted, false);
    assert.deepEqual(result.inputReceipt.validation.initial_issues, []);
    assert.deepEqual(result.output.items.slice(2).map((item) => ({
      exact: item.slide.visual.exactValue,
      display: item.slide.visual.displayValue,
    })), [
      { exact: "4–6 weeks", display: "4–6 weeks" },
      { exact: "12–16 weeks", display: "12–16 weeks" },
    ]);
    assertRequestContainsNoPrivateSourceIdentifiers(requests[0].request);
  });
});

test("ungrouped authored source blocks still ground every slide without manufacturing Combined Context provenance", async () => {
  const snapshot = executiveSourceSnapshot({ grouped: false });
  await withProviderResponses([executivePresentation({ grouped: false })], async (requests) => {
    const result = await generateExecutivePresentation({}, snapshot);
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0].input.combined_context_plan, []);
    assert.equal(requests[0].input.creative_context.facts[0].source_key, "blk_001");
    assert.equal(requests[0].input.creative_context.facts[0].source_group_keys, undefined);
    assert.deepEqual(result.output.items.map((item) => item.context_group_ids), [[], []]);
    assert.deepEqual(result.output.items.map((item) => item.slide.sourceIds), [[PRIVATE_BLOCK_ID], [PRIVATE_BLOCK_ID]]);
    assert.equal(result.output.items[1].slide.quote.sourceId, PRIVATE_BLOCK_ID);
    assertRequestContainsNoPrivateSourceIdentifiers(requests[0].request);
  });
});

for(const kind of ["short_story","scene","storyboard","video","audio"]){
  test(`${kind} repairs an unauthorized context alias once without disclosing private identifiers`,async()=>{
    const artifact=(groups)=>({
      title:"Scoped authored work",
      summary:"An independent authored movement.",
      content_markdown:"# Scoped authored work\n\nPreserve the complete original movement.",
      items:[{
        title:"First independent movement",
        body:"The team preserves its source-authorized creative continuity.",
        notes:"Keep the authored ordering.",
        image_prompt:"Optional authored visual reference.",
        context_group_ids:groups,
      }],
    });
    const invalid=artifact(["context_group_999",PRIVATE_GROUP_ID]);
    const repaired=artifact(["context_group_1"]);

    await withProviderResponses([invalid,repaired],async(requests)=>{
      const preflights=[];
      const result=await generateDocumentArtifact(
        {OPENAI_API_KEY:"mock-provider-key",OPENAI_MODEL:"gpt-5.6-terra"},
        "authorized-executive-actor",
        kind,
        {documentTitle:"Scoped authored work",snapshot:executiveSourceSnapshot(),options:{itemCount:1,onBeforeProviderAttempt:(attempt)=>preflights.push(attempt)}},
      );

      assert.equal(requests.length,2);
      assert.equal(requests[1].request.text.format.name,`document_${kind}_repair`);
      assert.equal(preflights.length,2);
      assert.equal(new Set(preflights.map(({clientRequestId})=>clientRequestId)).size,2);
      assert.ok(result.inputReceipt.validation.initial_issues.some(({code})=>code==="unknown_context_group_reference"));
      assert.deepEqual(result.inputReceipt.validation.repair_issues,[]);
      assert.equal(result.inputReceipt.validation.maximum_provider_calls,2);
      assert.equal(result.inputReceipt.validation.provider_call_count,2);
      assert.deepEqual(result.inputReceipt.validation.provider_response_ids,["presentation-provider-response-1","presentation-provider-response-2"]);
      assert.deepEqual(result.output.items[0].context_group_ids,[PRIVATE_GROUP_ID]);
      assert.deepEqual(result.usage,{inputTokens:240,outputTokens:160,totalTokens:400});
      assert.deepEqual(result.inputReceipt.validation.validation_history.map(({stage})=>stage),["initial","repair"]);
      assert.equal(result.inputReceipt.validation.adapter_reconciliation.status,"pending");
      assert.equal(result.inputReceipt.validation.adapter_reconciliation.self_healed,true);
      assert.doesNotMatch(JSON.stringify(result.inputReceipt.validation.validation_history),/PRIVATE_/u);
      for(const {request} of requests)assertRequestContainsNoPrivateSourceIdentifiers(request);
    });
  });
}

test("an unresolved non-slide validation failure stops after exactly one bounded repair",async()=>{
  const invalid={
    title:"Scoped authored scene",
    summary:"One ordered narrative moment.",
    content_markdown:"# Scoped authored scene\n\nThe original moment remains complete.",
    items:[{title:"First movement",body:"The original source-authorized movement remains complete.",notes:"Keep the continuity.",image_prompt:"Authored framing.",context_group_ids:[PRIVATE_GROUP_ID]}],
  };

  await withProviderResponses([invalid,invalid],async(requests)=>{
    await assert.rejects(
      generateDocumentArtifact({OPENAI_API_KEY:"mock-provider-key",OPENAI_MODEL:"gpt-5.6-terra"},"authorized-executive-actor","scene",{documentTitle:"Scoped authored scene",snapshot:executiveSourceSnapshot(),options:{itemCount:1}}),
      (error)=>{
        assert.equal(error.providerCallCount,2);
        assert.deepEqual(error.providerResponseIds,["presentation-provider-response-1","presentation-provider-response-2"]);
        assert.deepEqual(error.providerUsage,{inputTokens:240,outputTokens:160,totalTokens:400});
        assert.doesNotMatch(error.detail.message,/PRIVATE_/u);
        return true;
      },
    );
    assert.equal(requests.length,2);
    assert.equal(requests[1].request.text.format.name,"document_scene_repair");
    for(const {request} of requests)assertRequestContainsNoPrivateSourceIdentifiers(request);
  });
});

for (const invalidReference of [
  {
    label: "invented slide source alias",
    issue: "unknown_source_reference",
    apply: (output) => { output.items[0].slide.source_ids.push("blk_999"); },
  },
  {
    label: "guessed durable slide source identifier",
    issue: "unknown_source_reference",
    apply: (output) => { output.items[0].slide.source_ids.push(PRIVATE_BLOCK_ID); },
  },
  {
    label: "invented combined-context alias",
    issue: "unknown_context_group_reference",
    apply: (output) => { output.items[0].context_group_ids.push("context_group_999"); },
  },
  {
    label: "guessed durable combined-context identifier",
    issue: "unknown_context_group_reference",
    apply: (output) => { output.items[0].context_group_ids.push(PRIVATE_GROUP_ID); },
  },
]) {
  test(`${invalidReference.label} triggers exactly one source-safe bounded repair`, async () => {
    const invalid = executivePresentation();
    invalidReference.apply(invalid);
    await withProviderResponses([invalid, executivePresentation()], async (requests) => {
      const result = await generateExecutivePresentation();
      assert.equal(requests.length, 2, "an unauthorized provider reference must trigger exactly one repair call");
      assert.equal(requests[1].request.text.format.name, "document_slides_repair");
      assert.equal(result.inputReceipt.validation.repair_attempted, true);
      assert.ok(result.inputReceipt.validation.initial_issues.some((issue) => issue.code === invalidReference.issue));
      assert.deepEqual(result.inputReceipt.validation.repair_issues, []);
      assert.deepEqual(result.inputReceipt.validation.source_resolution.repair.unknownAssignments, []);
      assert.equal(result.inputReceipt.validation.maximum_provider_calls, 2);
      assert.equal(result.inputReceipt.validation.provider_call_count, 2);
      assert.deepEqual(result.usage, { inputTokens: 240, outputTokens: 160, totalTokens: 400 });
      assert.ok(requests[1].input.validation_issues.some((issue) => issue.code === invalidReference.issue));
      for (const { request } of requests) assertRequestContainsNoPrivateSourceIdentifiers(request);
      assert.ok(result.output.items.every((item) => item.slide.sourceIds.includes(PRIVATE_BLOCK_ID)));
    });
  });

  test(`${invalidReference.label} fails closed when the one permitted repair remains unauthorized`, async () => {
    const invalid = executivePresentation();
    invalidReference.apply(invalid);
    await withProviderResponses([invalid, invalid], async (requests) => {
      await assert.rejects(
        generateExecutivePresentation(),
        (error) => {
          assert.equal(error.detail?.code, "source_fidelity_validation_failed");
          assert.equal(error.detail?.action, "edit_request");
          assert.equal(error.detail?.retryable, false);
          assert.match(error.detail?.message ?? "", /after one bounded repair pass/i);
          assert.match(error.detail?.message ?? "", new RegExp(invalidReference.issue));
          assert.equal((error.detail?.message ?? "").includes(PRIVATE_BLOCK_ID), false);
          assert.equal((error.detail?.message ?? "").includes(PRIVATE_GROUP_ID), false);
          assert.deepEqual(error.providerUsage, { inputTokens: 240, outputTokens: 160, totalTokens: 400 });
          assert.deepEqual(error.providerResponseIds, ["presentation-provider-response-1", "presentation-provider-response-2"]);
          assert.equal(error.providerCallCount, 2);
          return true;
        },
      );
      assert.equal(requests.length, 2, "unauthorized evidence must not be silently accepted or retried indefinitely");
      assert.equal(requests[1].request.text.format.name, "document_slides_repair");
      for (const { request } of requests) assertRequestContainsNoPrivateSourceIdentifiers(request);
    });
  });
}

test("reversed exact/display semantics and a dropped sixth score independently require a bounded factual repair", async () => {
  for (const defect of [
    {
      label: "reversed exact/display values",
      issue: "reversed_precision_labels",
      apply: (output) => {
        output.items[0].slide.visual.exact_value = "61.13";
        output.items[0].slide.visual.display_value = "61.125";
      },
    },
    {
      label: "dropped governed-creative-loop score",
      issue: "inconsistent_scorecard_average",
      apply: (output) => { output.items[0].slide.visual.data.pop(); },
    },
  ]) {
    const invalid = executivePresentation();
    defect.apply(invalid);
    await withProviderResponses([invalid, executivePresentation()], async (requests) => {
      const result = await generateExecutivePresentation();
      assert.equal(requests.length, 2, defect.label);
      assert.ok(result.inputReceipt.validation.initial_issues.some((issue) => issue.code === defect.issue), defect.label);
      assert.deepEqual(result.output.items[0].slide.visual.data.map(({ label, value }) => [label, value]), SCORES);
      assert.equal(result.output.items[0].slide.visual.exactValue, "61.125");
      assert.equal(result.output.items[0].slide.visual.displayValue, "61.13");
    });
  }
});

test("checkpoints each successful paid response before bounded repair can fail", async () => {
  const invalid = executivePresentation();
  invalid.items[0].slide.source_ids = ["blk_999"];
  const attempts = [];
  const responses=[];

  await withProviderResponses([invalid, invalid], async () => {
    await assert.rejects(generateExecutivePresentation({onProviderResponse:(receipt)=>responses.push(receipt),onProviderAttempt:(receipt)=>attempts.push(receipt)}), (error) => {
      assert.equal(error.providerCallCount, 2);
      assert.equal(error.providerUsage.totalTokens, 400);
      return true;
    });
  });

  assert.deepEqual(attempts.map((attempt) => attempt.usage.totalTokens), [200, 400]);
  assert.deepEqual(attempts.map((attempt) => attempt.responseIds), [["presentation-provider-response-1"], ["presentation-provider-response-1", "presentation-provider-response-2"]]);
  assert.doesNotMatch(JSON.stringify(attempts), /PRIVATE_EXECUTIVE_/);
  assert.equal(responses.length,2,"every paid candidate is captured before local validation can reject it");
  assert.deepEqual(responses.map(({responseId})=>responseId),["presentation-provider-response-1","presentation-provider-response-2"]);
  for(const response of responses){
    assert.equal(response.candidateRaw,JSON.stringify(invalid));
    assert.equal(response.candidateBytes,new TextEncoder().encode(JSON.stringify(invalid)).byteLength);
    assert.equal(response.candidateTruncated,false);
    assert.doesNotMatch(response.candidateRaw,/PRIVATE_EXECUTIVE_/);
  }
});

test("reassesses retained provider output with the complete source contract without another request",()=>{
  const result=assessStoredPresentationCandidate(JSON.stringify(executivePresentation()),executiveSourceSnapshot(),{itemCount:2,presentationStyle:"field-notes"});
  assert.deepEqual(result.issues,[]);
  assert.equal(result.output?.items.length,2);
  assert.ok(result.output?.items[0]?.slide?.sourceIds?.includes(PRIVATE_BLOCK_ID),"request-local provider aliases resolve only against the original authorized source");
  const forged=executivePresentation();
  forged.items[0].slide.source_ids=["blk_999"];
  const rejected=assessStoredPresentationCandidate(JSON.stringify(forged),executiveSourceSnapshot(),{itemCount:2,presentationStyle:"field-notes"});
  assert.ok(rejected.issues.some((issue)=>issue.code==="unknown_source_reference"),"retained replay cannot bypass source-authorization validation");
});

test("never automatically resubmits a paid OpenAI Responses request after an ambiguous gateway failure",async(context)=>{
  let submissions=0;
  context.mock.method(globalThis,"fetch",async()=>{
    submissions+=1;
    return Response.json({error:{code:"upstream_gateway",message:"The upstream gateway could not confirm provider execution."}},{status:502});
  });

  await assert.rejects(generateExecutivePresentation(),(error)=>error.detail?.httpStatus===502);
  assert.equal(submissions,1,"an ambiguous paid POST cannot be automatically replayed or billed repeatedly");
});

test("preflights a unique provider-support trace before each paid slideshow submission",async(context)=>{
  const invalid=executivePresentation();
  invalid.items[0].slide.source_ids=["blk_999"];
  const preflightIds=[];
  const submittedIds=[];
  const completedPreflights=new Set();

  context.mock.method(globalThis,"fetch",async(url,init)=>{
    assert.equal(String(url),"https://api.openai.com/v1/responses");
    const clientRequestId=new Headers(init.headers).get("X-Client-Request-Id");
    assert.equal(clientRequestId,preflightIds.at(-1),"the submitted trace must exactly match the durable preflight identity");
    assert.ok(completedPreflights.has(clientRequestId),"the provider request cannot start before its async preflight is complete");
    assert.match(clientRequestId,/^forma-slides-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
    assert.ok(clientRequestId.length<=512,"provider support IDs must fit OpenAI's documented header limit");
    assert.ok([...clientRequestId].every((character)=>character.charCodeAt(0)<=0x7f),"provider support IDs must contain only ASCII characters");
    submittedIds.push(clientRequestId);
    const output=submittedIds.length===1?invalid:executivePresentation();
    return Response.json({
      id:`presentation-provider-response-${submittedIds.length}`,
      model:"gpt-5.6-terra",
      output_text:JSON.stringify(output),
      usage:{input_tokens:120,output_tokens:80,total_tokens:200},
    });
  });

  const result=await generateExecutivePresentation({onBeforeProviderAttempt:async({clientRequestId})=>{
    preflightIds.push(clientRequestId);
    await Promise.resolve();
    completedPreflights.add(clientRequestId);
  }});

  assert.equal(result.responseId,"presentation-provider-response-2");
  assert.equal(submittedIds.length,2,"the bounded source repair still issues its already-approved second request");
  assert.deepEqual(submittedIds,preflightIds);
  assert.equal(new Set(submittedIds).size,submittedIds.length,"each paid request must receive its own unique support trace");
});

test("preflights each paid slideshow request and preserves truthful accounting when its repair exceeds the ceiling",async()=>{
  await withProviderResponses([executivePresentation()],async(requests)=>{
    await assert.rejects(generateExecutivePresentation({onBeforeProviderAttempt:(attempt)=>{
      assert.equal(attempt.model,"gpt-5.6-terra");
      assert.ok(attempt.maximumInputTokens>4096);
      assert.ok(attempt.maximumOutputTokens>=6500);
      throw new Error("application_spending_ceiling_reached");
    }}),/application_spending_ceiling_reached/);
    assert.equal(requests.length,0,"a denied initial request never contacts the model provider");
  });

  const invalid=executivePresentation();
  invalid.items[0].slide.source_ids=["blk_999"];
  await withProviderResponses([invalid],async(requests)=>{
    let attempts=0;
    await assert.rejects(generateExecutivePresentation({onBeforeProviderAttempt:()=>{
      attempts+=1;
      if(attempts===2)throw new Error("application_spending_ceiling_reached");
    }}),(error)=>{
      assert.equal(error.providerCallCount,1);
      assert.deepEqual(error.providerUsage,{inputTokens:120,outputTokens:80,totalTokens:200});
      assert.deepEqual(error.providerResponseIds,["presentation-provider-response-1"]);
      return true;
    });
    assert.equal(attempts,2);
    assert.equal(requests.length,1,"an unaffordable repair never reaches the provider");
  });
});

test("a visibly truncated stakeholder quotation is repaired from authorized evidence even when notes and Markdown retain the complete text", async () => {
  const invalid = executivePresentation();
  const truncation = STAKEHOLDER_QUOTE.slice(0, 120);
  invalid.items[1].slide.quote.text = truncation;
  invalid.items[1].slide.visual.value = truncation;
  invalid.items[1].slide.citations[0].excerpt = truncation;
  assert.ok(invalid.items[1].notes.includes(STAKEHOLDER_QUOTE));
  assert.ok(invalid.content_markdown.includes(STAKEHOLDER_QUOTE));

  await withProviderResponses([invalid, executivePresentation()], async (requests) => {
    const result = await generateExecutivePresentation();
    assert.equal(requests.length, 2, "speaker notes and Markdown cannot excuse a clipped slide quotation");
    assert.ok(result.inputReceipt.validation.initial_issues.some((issue) => issue.code === "missing_protected_quote"));
    assert.equal(result.output.items[1].slide.quote.text, STAKEHOLDER_QUOTE);
    assert.equal(result.output.items[1].slide.visual.value, STAKEHOLDER_QUOTE);
    assert.equal(result.output.items[1].slide.quote.speaker, "Product Owner");
    assert.equal(result.output.items[1].slide.quote.role, "Product Owner");
    for (const { request } of requests) assertRequestContainsNoPrivateSourceIdentifiers(request);
  });
});

test("managed assigned scenes expose only resolvable source aliases and retain canonical slide attribution", async () => {
  const snapshot = executiveSourceSnapshot();
  const productionPlan = buildManagedProductionPlan("slides", snapshot, { requestedSlideCount: 2 });
  assert.equal(productionPlan.scenes.length, 2);

  await withProviderResponses([executivePresentation({ style: "editorial" })], async (requests) => {
    const result = await generateExecutivePresentation({
      presentationStyle: "editorial",
      productionMode: "managed",
      productionPlan,
      productionScenes: productionPlan.scenes,
      productionPage: {
        pageIndex: 0,
        pageCount: 1,
        globalStartIndex: 0,
        totalItems: 2,
        phase: "complete",
        priorSummary: "",
        priorEnding: "",
        priorVisibleCopy: [],
      },
    }, snapshot);

    assert.equal(requests.length, 1);
    const { request, input } = requests[0];
    assert.deepEqual(request.text.format.schema.properties.presentation.properties.style_preset.enum, ["editorial"]);
    assert.equal(input.production.assigned_scenes.length, 2);
    assert.deepEqual(input.production.assigned_scenes.map((scene) => scene.source_keys), [["blk_001"], ["blk_001"]]);
    assert.deepEqual(input.production.assigned_scenes.map((scene) => scene.context_keys), [["context_group_1"], ["context_group_1"]]);
    assert.deepEqual(input.production.assigned_scenes.map((scene) => scene.narrative_order), [1, 2]);
    assertRequestContainsNoPrivateSourceIdentifiers(request);
    assert.deepEqual(result.output.items.map((item) => item.slide.sourceIds), [[PRIVATE_BLOCK_ID], [PRIVATE_BLOCK_ID]]);
    assert.deepEqual(result.output.items.map((item) => item.context_group_ids), [[PRIVATE_GROUP_ID], [PRIVATE_GROUP_ID]]);
  });
});


test("mixed slideshow repair retains exact per-call evidence and frozen routes before the next paid request",async context=>{
  const invalid=executivePresentation();invalid.items[0].slide.source_ids=["blk_999"];
  const raw=[JSON.stringify(invalid,null,2)+"\n",JSON.stringify(executivePresentation(),null,2)+"\n"];
  const usage=[
    {input_tokens:200,output_tokens:120,total_tokens:320,input_tokens_details:{cached_tokens:0,cache_write_tokens:0},output_tokens_details:{reasoning_tokens:80}},
    {input_tokens:400,output_tokens:160,total_tokens:560,input_tokens_details:{cached_tokens:0,cache_write_tokens:0},output_tokens_details:{reasoning_tokens:100}},
  ];
  const env={OPENAI_API_KEY:"mock-provider-key",OPENAI_MODEL:"gpt-5.6-terra",OPENAI_SLIDES_COMPOSITION_MODEL:"gpt-5.6-terra",OPENAI_SLIDES_COMPOSITION_REASONING_EFFORT:"medium",OPENAI_SLIDES_REPAIR_MODEL:"gpt-5.6-sol",OPENAI_SLIDES_REPAIR_REASONING_EFFORT:"high"};
  const frozen=resolvePresentationModelRoutes(env),guards=[],requests=[],retained=[],observed=new Map(),trace=[];
  // An accepted server-owned route, not a later environment value, is used for both calls.
  env.OPENAI_SLIDES_COMPOSITION_MODEL="gpt-5.6-sol";env.OPENAI_SLIDES_COMPOSITION_REASONING_EFFORT="low";
  context.mock.method(globalThis,"fetch",async(url,init)=>{
    assert.equal(String(url),"https://api.openai.com/v1/responses");
    const index=requests.length,request=JSON.parse(init.body),guard=guards[index];
    assert.ok(index<2,"the comparison permits exactly the existing initial and repair calls");
    assert.equal(guard.requestDigest,createHash("sha256").update(init.body).digest("hex"));
    assert.equal(new Headers(init.headers).get("X-Client-Request-Id"),guard.clientRequestId);
    assert.deepEqual(request.prompt_cache_options,{mode:"explicit"});assert.equal(request.service_tier,"default");
    assert.equal(request.max_output_tokens,6_500);assertRequestContainsNoPrivateSourceIdentifiers(request);
    requests.push(request);trace.push(`fetch:${index}`);
    if(index===0){env.OPENAI_MODEL="unsupported-after-admission";env.OPENAI_SLIDES_REPAIR_MODEL="gpt-5.6-terra";env.OPENAI_SLIDES_REPAIR_REASONING_EFFORT="none";}
    return Response.json({id:`mixed-response-${index}`,model:request.model,service_tier:"default",status:"completed",output_text:raw[index],usage:usage[index]},{headers:{"x-request-id":`mixed-http-${index}`}});
  });
  const result=await generateExecutivePresentation({presentationModelRoutes:frozen,
    onBeforeProviderAttempt:async attempt=>{
      if(guards.length===1){
        assert.equal(retained.length,1,"raw paid output must be durably acknowledged before another preflight");
        const prior=observed.get(guards[0].clientRequestId);assert.equal(prior.status,"completed");
        assert.equal(prior.responseRef,"retained-mixed-0");assert.equal(prior.costMicrousd,1_840);
        assert.equal(prior.validationStatus,"invalid");
      }
      guards.push(structuredClone(attempt));trace.push(`preflight:${guards.length-1}`);
    },
    onProviderResponse:async receipt=>{
      const index=retained.length;assert.equal(receipt.candidateRaw,raw[index]);
      assert.equal(receipt.candidateBytes,Buffer.byteLength(raw[index]));assert.equal(receipt.candidateTruncated,false);
      assert.equal(receipt.call.inputTokens,usage[index].input_tokens);assert.equal(receipt.call.outputTokens,usage[index].output_tokens);
      assert.equal(receipt.call.totalTokens,usage[index].total_tokens,"a per-call receipt must not contain aggregate usage");
      assert.equal(receipt.call.reasoningTokens,usage[index].output_tokens_details.reasoning_tokens);
      assert.equal(receipt.call.requestDigest,guards[index].requestDigest);
      assert.equal(receipt.call.providerRequestId,`mixed-response-${index}`);assert.equal(receipt.call.httpRequestId,`mixed-http-${index}`);
      assert.equal(receipt.call.effectiveModel,guards[index].model);
      assert.equal(receipt.call.pricingReceipt.model,guards[index].model);assert.equal(receipt.call.pricingReceipt.usage.inputTokens,usage[index].input_tokens);
      assert.equal(receipt.call.pricingReceipt.requestPolicy.cachePolicy,"disabled-explicit");
      assert.deepEqual(receipt.call.pricingReceipt.derivedUsageFields,[]);
      await Promise.resolve();retained.push(structuredClone(receipt));trace.push(`retained:${index}`);
      return{responseRef:`retained-mixed-${index}`};
    },
    onProviderSubmission:async receipt=>{await Promise.resolve();observed.set(receipt.clientRequestId,structuredClone(receipt));},
  },executiveSourceSnapshot(),env);
  assert.deepEqual(requests.map(request=>[request.model,request.reasoning.effort]),[["gpt-5.6-terra","medium"],["gpt-5.6-sol","high"]]);
  assert.deepEqual(guards.map(guard=>guard.presentationRoute),[frozen.composition,frozen.repair]);
  assert.deepEqual(guards.map(guard=>guard.logicalCallKey),["planning:0:initial","planning:0:repair"]);
  assert.equal(new Set(guards.map(guard=>guard.clientRequestId)).size,2);
  assert.deepEqual(trace,["preflight:0","fetch:0","retained:0","preflight:1","fetch:1","retained:1"]);
  const calls=result.inputReceipt.provider_calls;
  assert.deepEqual(calls.map(call=>[call.model,call.routingPhase,call.validationStatus,call.costMicrousd]),[["gpt-5.6-terra","composition","invalid",1_840],["gpt-5.6-sol","validation-repair","valid",4_800]]);
  assert.equal(calls.reduce((sum,call)=>sum+call.costMicrousd,0),6_640,"Terra tokens must not be repriced at the final Sol rate");
  assert.deepEqual(result.usage,{inputTokens:600,outputTokens:280,totalTokens:880});
  assert.deepEqual(retained.map(receipt=>receipt.usage.totalTokens),[320,880],"legacy aggregate progress is distinct from each call's own evidence");
  assert.deepEqual(result.inputReceipt.presentation_model_routes,frozen);
});

test("an undisclosed response model is not invented from the frozen requested model",async context=>{
  let requests=0;const retained=[];
  context.mock.method(globalThis,"fetch",async()=>{
    requests++;
    return Response.json({id:"undisclosed-model-response",service_tier:"default",status:"completed",output_text:JSON.stringify(executivePresentation()),usage:{input_tokens:120,output_tokens:80,total_tokens:200}});
  });
  const result=await generateExecutivePresentation({onProviderResponse:receipt=>{retained.push(structuredClone(receipt));}});
  assert.equal(requests,1);
  assert.equal(retained[0].call.effectiveModel,undefined);
  const call=result.inputReceipt.provider_calls[0];
  assert.equal(call.effectiveModel,undefined);
  assert.equal(call.model,"gpt-5.6-terra");
  assert.equal(call.pricingReceipt.model,"gpt-5.6-terra","pricing stays bound to the requested tariff, not a fabricated returned model");
});

test("unpriced slideshow evidence stops before repair even without a submission observer",async context=>{
  const invalid=executivePresentation();invalid.items[0].slide.source_ids=["blk_999"];
  const raw=JSON.stringify(invalid);
  const validUsage={input_tokens:200,output_tokens:120,total_tokens:320,input_tokens_details:{cached_tokens:0,cache_write_tokens:0},output_tokens_details:{reasoning_tokens:80}};
  const variants=[
    {name:"missing usage",envelope:{usage:undefined}},
    {name:"missing total",envelope:{usage:{...validUsage,total_tokens:undefined}}},
    {name:"cache policy conflict",envelope:{usage:{...validUsage,input_tokens_details:{cached_tokens:0,cache_write_tokens:1}}}},
    {name:"malformed cache details",envelope:{usage:{...validUsage,input_tokens_details:{cached_tokens:"0",cache_write_tokens:0}}}},
    {name:"unpriced actual tier",envelope:{service_tier:"flex"}},
    {name:"changed actual model",envelope:{model:"gpt-5.6-sol"}},
  ];
  for(const variant of variants)for(const observe of[false,true])await context.test(`${variant.name}; observer=${observe}`,async sub=>{
    let requests=0,preflights=0;const retained=[],submissions=[];
    sub.mock.method(globalThis,"fetch",async(url)=>{
      assert.equal(String(url),"https://api.openai.com/v1/responses");requests++;
      return Response.json({id:"unpriced-response",model:"gpt-5.6-terra",service_tier:"default",status:"completed",output_text:raw,usage:validUsage,...variant.envelope});
    });
    await assert.rejects(generateExecutivePresentation({onBeforeProviderAttempt:()=>{preflights++;},onProviderResponse:receipt=>{retained.push(structuredClone(receipt));},...(observe?{onProviderSubmission:receipt=>{submissions.push(structuredClone(receipt));}}:{})}),error=>error.detail?.code==="provider_usage_receipt_missing"&&error.providerCallCount===1);
    assert.equal(requests,1);assert.equal(preflights,1,"unknown cost cannot authorize a repair preflight");
    assert.equal(retained.length,1);assert.equal(retained[0].candidateRaw,raw);
    assert.equal(retained[0].call.status,"completed");assert.equal(retained[0].call.costMicrousd,undefined,"unknown usage is not zero-cost evidence");
    if(observe){const completed=submissions.filter(receipt=>receipt.status==="completed");assert.equal(completed.length,1);assert.equal(completed[0].costMicrousd,undefined);}
  });
});

test("managed editorial rewrite and its validation repair use the editorial route and distinct logical call keys",async context=>{
  const snapshot=executiveSourceSnapshot(),plan=buildManagedProductionPlan("slides",snapshot,{requestedSlideCount:2});
  const invalid=executivePresentation();invalid.items[0].slide.source_ids=["blk_999"];
  const outputs=[executivePresentation(),invalid,executivePresentation()],guards=[],requests=[];
  const frozen=resolvePresentationModelRoutes({OPENAI_SLIDES_COMPOSITION_MODEL:"gpt-5.6-terra",OPENAI_SLIDES_COMPOSITION_REASONING_EFFORT:"medium",OPENAI_SLIDES_REPAIR_MODEL:"gpt-5.6-sol",OPENAI_SLIDES_REPAIR_REASONING_EFFORT:"high"});
  const page={pageIndex:0,pageCount:1,globalStartIndex:0,totalItems:2,phase:"complete",priorSummary:"",priorEnding:"",priorVisibleCopy:[]};
  context.mock.method(globalThis,"fetch",async(url,init)=>{
    assert.equal(String(url),"https://api.openai.com/v1/responses");const request=JSON.parse(init.body),index=requests.length;assert.ok(index<3);requests.push(request);
    return Response.json({id:`editorial-response-${index}`,model:request.model,service_tier:"default",status:"completed",output_text:JSON.stringify(outputs[index]),usage:{input_tokens:200,output_tokens:120,total_tokens:320,input_tokens_details:{cached_tokens:0,cache_write_tokens:0},output_tokens_details:{reasoning_tokens:80}}});
  });
  const options={productionMode:"managed",productionPlan:plan,productionScenes:plan.scenes,presentationModelRoutes:frozen,onBeforeProviderAttempt:attempt=>{guards.push(structuredClone(attempt));}};
  const original=await generateExecutivePresentation({...options,productionPage:page},snapshot);
  const rewritten=await generateExecutivePresentation({...options,productionPage:{...page,repairIssues:["Remove the repeated visible opening without losing protected evidence."]}},snapshot);
  assert.deepEqual(guards.map(guard=>guard.logicalCallKey),["planning:0:initial","planning:0:editorial-initial","planning:0:editorial-repair"]);
  assert.deepEqual(guards.map(guard=>guard.presentationRoute.workflow),["slides.composition","slides.editorial_repair","slides.editorial_repair"]);
  assert.deepEqual(requests.map(request=>[request.model,request.reasoning.effort]),[["gpt-5.6-terra","medium"],["gpt-5.6-sol","high"],["gpt-5.6-sol","high"]]);
  const calls=[...original.inputReceipt.provider_calls,...rewritten.inputReceipt.provider_calls];
  assert.deepEqual(calls.map(call=>call.routingPhase),["composition","editorial-rewrite","editorial-validation-repair"]);
  assert.deepEqual(calls.map(call=>call.unitId),guards.map(guard=>guard.logicalCallKey));
  assert.equal(new Set(calls.map(call=>call.unitId)).size,3,"a whole-work rewrite must not collide with the first page submission");
  assert.equal(new Set(calls.map(call=>call.clientRequestId)).size,3);
  assert.deepEqual(calls.map(call=>call.validationStatus),["valid","invalid","valid"]);
});
