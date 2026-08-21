import { applySlideStylePreset, defaultSlidePresentation, isSlideStylePresetId } from "/src/model/document-artifacts.ts";
import "/src/components/presentation-slide.ts";
import { renderPresentationPdf } from "/src/components/presentation-pdf-export.ts";

const slide=document.querySelector("forma-presentation-slide");
let presentation,items;

window.configurePresentationPdfFixture=async(config={})=>{
  const style=isSlideStylePresetId(config.style)?config.style:"nocturne";
  const selected=applySlideStylePreset(defaultSlidePresentation(style),style);
  const palette=config.contrast==="low"?{background:"#101820",foreground:"#121921",accent:"#47d6bc",muted:"#131a22",surface:"#203040"}:config.custom?{background:"#162130",foreground:"#f3e8d4",accent:"#47d6bc",muted:"#b5bbc8",surface:"#30445b"}:selected.palette;
  presentation={...selected,palette,theme:"Fidelity review",footerLabel:"Café 東京 — visual system"};
  const kind=config.visual||"bars";
  const noVisual=kind==="none";
  const visual={kind:noVisual?"hero-type":kind,label:noVisual?"":"Creative confidence",value:["hero-type","metric","diagram"].includes(kind)?"A more human outcome":"",data:noVisual?[]:[
    {label:"Direction",value:"92%",weight:.92},
    {label:"Coherence",value:"78%",weight:.78},
    {label:"Texture",value:"64%",weight:.64},
  ]};
  items=[{
    title:"One coherent world",
    body:"Layered atmosphere, precise typography, and every creative choice remain visible.",
    notes:"Speaker notes stay outside the rendered slide.",
    image_prompt:"",
    slide:{layout:config.layout||"split",kicker:"Creative direction",bullets:["Protect the human scale","Keep the palette warm","Preserve every visible detail"],visual},
  }];

  slide.item=items[0];
  slide.presentation=presentation;
  slide.index=0;
  slide.total=1;
  slide.showFooterLabel=config.footer!=="hidden";
  document.querySelector("#pdf-output").textContent="";
  document.querySelector("#status").value="Ready";
  await slide.updateComplete;
  await document.fonts.ready;
};

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
