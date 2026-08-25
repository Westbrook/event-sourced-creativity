import { defaultSlidePresentation, isSlideStylePresetId } from "/src/model/document-artifacts.ts";
import "/src/components/presentation-slide.ts";
import "/src/components/presentation-deck.ts";
import { store } from "/src/state/store.ts";
import { setFormaLocale } from "/src/components/design-system/localization.ts";

const parameters=new URLSearchParams(location.search);
const locale=parameters.get("locale");
if(locale)await setFormaLocale(locale,{persist:false});
const requestedStyle=parameters.get("style");
const presentation=defaultSlidePresentation(isSlideStylePresetId(requestedStyle)?requestedStyle:"editorial");
const items=[{
  title:"A grounded decision, clearly presented",
  body:"A stable composition preserves authored evidence across every viewing surface.",
  notes:"Presenter notes remain complete in the dedicated reading view.",
  image_prompt:"",
  slide:{
    layout:"scorecard",
    kicker:"Approved creative direction",
    bullets:["Preserve authorized decisions.","Keep the source readable."],
    citations:[{sourceId:"approved-source",label:"Approved research",anchor:"Slide 1",excerpt:"A concise authorized source excerpt."}],
    sourceIds:["approved-source"],
    visual:{
      kind:"scorecard",
      label:"Source-grounded outcomes",
      value:"Measured confidence",
      data:[
        {label:"Clarity",value:"92%",weight:.92},
        {label:"Continuity",value:"81%",weight:.81},
        {label:"Evidence",value:"74%",weight:.74},
      ],
    },
  },
},{
  title:"Every protected source category stays available",
  body:"Dense approved evidence switches to the complete reading surface rather than acquiring nested slide scrollbars.",
  notes:"Protected speaker notes remain available without appearing in the visual slide.",
  image_prompt:"",
  slide:{
    layout:"architecture",
    kicker:"Complete authorized evidence",
    bullets:Array.from({length:8},(_,index)=>`Protected authored decision ${index+1}`),
    citations:[
      {sourceId:"approved-source",label:"Approved research",anchor:"Slide 2",excerpt:"The first complete protected citation survives responsive delivery."},
      {sourceId:"approved-source",label:"Approved research",anchor:"Slide 3",excerpt:"The second complete protected citation remains equally available."},
    ],
    sourceIds:["approved-source"],
    visual:{
      kind:"architecture",
      label:"Every source-backed delivery surface",
      value:"One coherent governed creative system",
      data:Array.from({length:12},(_,index)=>({label:`Approved source category ${index+1}`,value:`Protected claim ${index+1}`,weight:.7})),
    },
  },
}];

if(parameters.get("case")==="executive"||parameters.get("case")==="impossible"){
  const excerpt="Make Intelligence and Cost Understandable. At 20,000 input and 4,000 output tokens, estimated model costs are Luna $0.0088, Terra $0.0880, and Sol $0.2200. Proposed Fast, Balanced, and Deep modes apply organization-approved models, spending limits, measured escalation, explicit premium approvals, and visible cost consequences.";
  const impossible=parameters.get("case")==="impossible";
  const citations=Array.from({length:impossible?4:1},(_,index)=>({
    sourceId:"approved-source",
    label:"Approved research",
    anchor:`Slide ${9+index}`,
    excerpt:impossible?Array(3).fill(excerpt).join(" "):excerpt,
  }));
  items[0]={
    title:"Make Intelligence and Cost Understandable",
    body:"At 20,000 input and 4,000 output tokens, estimated model costs are Luna $0.0088, Terra $0.0880, and Sol $0.2200.",
    notes:"Every authorized model-cost decision remains available without a nested slide scrollbar.",
    image_prompt:"",
    slide:{
      layout:"comparison",
      kicker:"Overview",
      bullets:["Proposed Fast, Balanced, and Deep modes apply organization-approved models, spending limits, measured escalation, explicit premium approvals, and visible cost consequences."],
      citations,
      sourceIds:["approved-source"],
      visual:{
        kind:"comparison",
        label:"Estimated cost",
        value:"20,000 input + 4,000 output tokens",
        data:[
          {label:"Luna",value:"$0.0088",weight:.04},
          {label:"Terra",value:"$0.0880",weight:.4},
          {label:"Sol",value:"$0.2200",weight:1},
        ],
      },
    },
  };
}

const requestedSlideCount=Number.parseInt(parameters.get("slides")??"",10);
if(Number.isSafeInteger(requestedSlideCount)&&requestedSlideCount>items.length&&requestedSlideCount<=24){
  const originals=items.map((item)=>structuredClone(item));
  while(items.length<requestedSlideCount){
    const original=originals[items.length%originals.length];
    items.push({...structuredClone(original),title:`${original.title} · ${items.length+1}`});
  }
}

const surface=parameters.get("surface");
const documentId="11111111-1111-4111-8111-111111111111";
const projectId="22222222-2222-4222-8222-222222222222";
const event={streamId:"responsive-fixture",occurredAt:"2026-01-01T00:00:00.000Z",recordedAt:"2026-01-01T00:00:00.000Z",clientId:"fixture",correlationId:"fixture",causationId:null,compensatesEventId:null,schemaVersion:1,actor:"user:fixture"};
store.route.set(`/document/${documentId}/responsive-acceptance`);
store.events.set([
  {...event,eventId:"fixture-project",sequence:1,type:"ProjectCreated",payload:{project_id:projectId,name:"Responsive fixture"}},
  {...event,eventId:"fixture-document",sequence:2,type:"DocumentCreated",payload:{document_id:documentId,project_id:projectId,title:"Responsive acceptance"}},
  {...event,eventId:"fixture-source",sequence:3,type:"BlockCreated",payload:{block_id:"approved-source",document_id:documentId,project_id:projectId,type:"direction",handle:"direction/approved-research",properties:{label:"Approved research",text:"Approved responsive presentation source"}}},
]);
const deck=document.querySelector("#deck");
const thumbnail=document.querySelector("#thumbnail");
deck.preferenceKey=`responsive-acceptance-${parameters.get("case")??"default"}-${presentation.stylePreset}`;
document.querySelector("#viewer").hidden=surface==="preview"||surface==="shared";
document.querySelector("#preview").hidden=surface!=="preview";
document.querySelector("#shared").hidden=surface!=="shared";
deck.items=items;
deck.presentation=presentation;
deck.deckTitle="Responsive acceptance";
deck.documentId=documentId;
thumbnail.item=items[0];
thumbnail.presentation=presentation;
thumbnail.compact=true;
await Promise.all([deck.updateComplete,thumbnail.updateComplete]);
const requestedView=parameters.get("view")==="list"?"list":"slideshow";
const requestedViewButton=deck.querySelectorAll(".presentation-deck-view-switch button")[requestedView==="list"?0:1];
if(requestedViewButton?.getAttribute("aria-pressed")!=="true"){
  requestedViewButton?.click();
  await deck.updateComplete;
}
document.querySelector("#viewer > .document-artifact-reader > footer > span").textContent=`${items.length} slides · Approved`;
document.querySelector("#focus").addEventListener("click",(event)=>{
  const viewer=document.querySelector("#viewer");
  const focused=viewer.dataset.outputFocus!=="true";
  viewer.dataset.outputFocus=String(focused);
  event.currentTarget.setAttribute("aria-pressed",String(focused));
  event.currentTarget.setAttribute("aria-label",focused?"Exit focus":"Focus view");
});

if(surface==="shared"){
  const artifact={
    id:"responsive-shared-artifact",
    documentId,
    kind:"slides",
    title:"Shared protected presentation",
    summary:"Approved evidence remains available across shared viewing surfaces.",
    contentRef:null,
    itemCount:items.length,
    items:items.map((item,index)=>({
      id:`responsive-slide-${index+1}`,
      title:item.title,
      body:item.body,
      notes:item.notes,
      imagePrompt:"",
      mediaUrl:null,
      mediaType:null,
      width:null,
      height:null,
      focalPoint:null,
      slide:item.slide,
    })),
    mediaUrl:null,
    mediaType:null,
    provider:"fixture",
    modelId:"fixture",
    latency:0,
    sequence:1,
    library:false,
    sourceEventId:"fixture-completion",
    sourceSurface:"responsive-fixture",
    settings:{},
    presentation,
  };
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async(input,options)=>{
    const pathname=new URL(typeof input==="string"?input:input.url,location.origin).pathname;
    if(pathname==="/api/shared/responsive-fixture"){
      return new Response(JSON.stringify({
        projection:{projectName:"Responsive fixture",documentTitle:"Shared responsive acceptance",blocks:[],outputs:[],artifacts:[artifact]},
        share:{expiresAt:"2030-01-01T00:00:00.000Z"},
      }),{headers:{"content-type":"application/json"}});
    }
    return originalFetch(input,options);
  };
  await import("/src/components/forma-shared-view.ts");
  const shared=document.createElement("forma-shared-view");
  shared.token="responsive-fixture";
  document.querySelector("#shared").append(shared);
  await shared.updateComplete;
}
