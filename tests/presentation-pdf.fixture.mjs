import { applySlideStylePreset, defaultSlidePresentation, isSlideStylePresetId } from "/src/model/document-artifacts.ts";
import "/src/components/presentation-slide.ts";
import "/src/components/presentation-deck.ts";
import { renderPresentationPdf } from "/src/components/presentation-pdf-export.ts";
import { store } from "/src/state/store.ts";

const slide=document.querySelector("forma-presentation-slide");
const deck=document.querySelector("#deck");
let presentation,items;

window.configurePresentationPdfFixture=async(config={})=>{
  const style=isSlideStylePresetId(config.style)?config.style:"nocturne";
  const selected=applySlideStylePreset(defaultSlidePresentation(style),style);
  const palette=config.contrast==="low"?{background:"#101820",foreground:"#121921",accent:"#47d6bc",muted:"#131a22",surface:"#203040"}:config.custom?{background:"#162130",foreground:"#f3e8d4",accent:"#47d6bc",muted:"#b5bbc8",surface:"#30445b"}:selected.palette;
  const formatQuestion=config.content==="format-question";
  presentation={...selected,palette,theme:"Fidelity review",footerLabel:formatQuestion?"THE CONTEXT COMPANY":"Café 東京 — visual system"};
  const kind=config.visual||"bars";
  const noVisual=kind==="none";
  const visual={kind:noVisual?"hero-type":kind,label:noVisual?"":formatQuestion?"THE FORMAT QUESTION":"Creative confidence",value:["hero-type","metric","diagram"].includes(kind)?formatQuestion?"One workflow":"A more human outcome":"",data:noVisual?[]:formatQuestion?[
    {label:"Formats",value:"",weight:1},
    {label:"Workflow",value:"",weight:1},
  ]:[
    {label:"Direction",value:"92%",weight:.92},
    {label:"Coherence",value:"78%",weight:.78},
    {label:"Texture",value:"64%",weight:.64},
  ]};
  const first={
    title:formatQuestion?"Can it end file types?":"One coherent world",
    body:formatQuestion?"A question for work that moves across formats.":"Layered atmosphere, precise typography, and every creative choice remain visible.",
    notes:"Speaker notes stay outside the rendered slide.",
    image_prompt:"",
    slide:{layout:config.layout||"split",kicker:formatQuestion?"THE CONTEXT COMPANY":"Creative direction",bullets:formatQuestion?[]:["Protect the human scale","Keep the palette warm","Preserve every visible detail"],visual},
  };
  const pageCount=Math.max(1,Number.parseInt(String(config.pages??"1"),10)||1);
  items=Array.from({length:pageCount},(_,index)=>index?{...first,title:`${first.title} · ${index+1}`,slide:{...first.slide,visual:{...first.slide.visual,data:first.slide.visual.data.map((datum)=>({...datum}))}}}:first);
  const viaDeck=config.via==="deck";
  slide.hidden=viaDeck;
  deck.hidden=!viaDeck;
  document.querySelector("#export").hidden=viaDeck;

  slide.item=items[0];
  slide.presentation=presentation;
  slide.index=0;
  slide.total=items.length;
  slide.showFooterLabel=config.footer!=="hidden";
  deck.items=items;
  deck.presentation=presentation;
  deck.deckTitle="Visual fidelity fixture";
  document.querySelector("#pdf-output").textContent="";
  document.querySelector("#status").value="Ready";
  await slide.updateComplete;
  await deck.updateComplete;
  if(viaDeck){
    deck.querySelector(".presentation-deck-view-switch button")?.click();
    await deck.updateComplete;
    await Promise.all(Array.from(deck.querySelectorAll("forma-presentation-slide")).map((item)=>item.updateComplete));
  }
  await document.fonts.ready;
};

store.subscribe(()=>{if(!deck.hidden&&store.ui.toast)document.querySelector("#status").value=store.ui.toast;});

await window.configurePresentationPdfFixture(Object.fromEntries(new URLSearchParams(location.search)));

document.querySelector("#export").addEventListener("click",async()=>{
  const status=document.querySelector("#status");
  status.value="Rendering…";
  try{
    const result=await renderPresentationPdf(items,presentation,{title:"Visual fidelity fixture",showFooterLabel:slide.showFooterLabel});
    let binary="";
    for(let index=0;index<result.bytes.length;index+=8192)binary+=String.fromCharCode(...result.bytes.subarray(index,index+8192));
    document.querySelector("#pdf-output").textContent=btoa(binary);
    status.value=`${result.pageCount} page ready`;
  }catch(error){
    status.value=`Export failed: ${error.message}`;
    console.error("Slideshow PDF visual fixture failed",error);
  }
});
