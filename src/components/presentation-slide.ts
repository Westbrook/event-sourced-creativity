import { html, nothing } from "lit";
import { defaultSlidePresentation, normalizeSlideItem, normalizeSlidePresentation, normalizeSlideVisual, slideVisualIsComplete, type DocumentArtifactDraftItem, type SlidePresentation, type SlideVisualData } from "../model/document-artifacts";
import { FormaPresentationalElement } from "./presentational-element";

const channel=(hex:string,index:number)=>Number.parseInt(hex.slice(index,index+2),16)/255;
const luminance=(hex:string)=>{const values=[1,3,5].map((index)=>{const value=channel(hex,index);return value<=.03928?value/12.92:((value+.055)/1.055)**2.4;});return .2126*(values[0]??0)+.7152*(values[1]??0)+.0722*(values[2]??0);};
const contrast=(left:string,right:string)=>{const [light,dark]=[luminance(left),luminance(right)].sort((a,b)=>b-a);return(light+.05)/(dark+.05);};
const accessibleInk=(background:string,foreground:string)=>contrast(background,foreground)>=4.5?foreground:contrast(background,"#111714")>contrast(background,"#ffffff")?"#111714":"#ffffff";
const slideStyle=(presentation:SlidePresentation)=>{const palette=presentation.palette,foreground=accessibleInk(palette.background,palette.foreground);return`--slide-bg:${palette.background};--slide-ink:${foreground};--slide-accent:${palette.accent};--slide-muted:${contrast(palette.background,palette.muted)>=3?palette.muted:foreground};--slide-surface:${palette.surface}`;};
const SLIDE_FOOTER_LABEL_PREFERENCE="forma:slides:footer-label";
export const readSlideFooterLabelPreference=()=>{try{return localStorage.getItem(SLIDE_FOOTER_LABEL_PREFERENCE)!=="hidden";}catch{return true;}};
export const writeSlideFooterLabelPreference=(visible:boolean)=>{try{localStorage.setItem(SLIDE_FOOTER_LABEL_PREFERENCE,visible?"visible":"hidden");}catch{/* The active viewer still applies the preference when storage is unavailable. */}};

export class PresentationSlide extends FormaPresentationalElement {
  static properties={item:{attribute:false},presentation:{attribute:false},index:{type:Number},total:{type:Number},compact:{type:Boolean},showFooterLabel:{type:Boolean,attribute:"show-footer-label"}};
  item:DocumentArtifactDraftItem={title:"",body:"",notes:"",image_prompt:"",slide:null};presentation:SlidePresentation|null=null;index=0;total=1;compact=false;showFooterLabel=true;
  #visual(slide:SlideVisualData){
    const visual=slide.visual;
    if(visual.kind==="hero-type"||visual.kind==="metric"){const size=visual.value.length>48?"4.2cqi":visual.value.length>24?"6.4cqi":"10cqi";return html`<div class="presentation-visual-type" style=${`--slide-visual-size:${size}`}><strong>${visual.value}</strong><span>${visual.label}</span></div>`;}
    if(visual.kind==="bars")return html`<div class="presentation-visual-bars">${visual.data.map((datum)=>html`<div><span>${datum.label}</span><i><b style=${`--slide-value:${Math.round(datum.weight*100)}%`}></b></i><small>${datum.value}</small></div>`)}</div>`;
    if(visual.kind==="timeline")return html`<ol class="presentation-visual-timeline">${visual.data.map((datum)=>html`<li><i></i><span><b>${datum.label}</b><small>${datum.value}</small></span></li>`)}</ol>`;
    if(visual.kind==="diagram")return html`<div class="presentation-visual-diagram"><strong>${visual.value}</strong>${visual.data.map((datum,index)=>html`<span style=${`--slide-node:${index}`}>${datum.label}</span>`)}</div>`;
    return html`<div class="presentation-visual-fields" aria-label=${visual.label}>${visual.data.map((datum,index)=>html`<i style=${`--slide-field:${index};--slide-field-size:${Math.round(34+datum.weight*24)}%;--slide-field-mix:${Math.round(28+datum.weight*38)}%`}><span>${datum.label}</span></i>`)}</div>`;
  }
  override render(){const presentation=normalizeSlidePresentation(this.presentation)??defaultSlidePresentation();const item=normalizeSlideItem(this.item,this.index);const slide=item.slide??normalizeSlideVisual(null,item,this.index);const hasVisual=slideVisualIsComplete(slide),showDeckLabel=this.showFooterLabel&&Boolean(presentation.footerLabel);return html`<article class=${`presentation-slide style-${presentation.stylePreset} layout-${slide.layout} visual-${slide.visual.kind}${hasVisual?"":" no-visual"}${this.compact?" compact":""}`} style=${slideStyle(presentation)} aria-label=${`Slide ${this.index+1} of ${this.total}: ${item.title}`}><header><span>${slide.kicker}</span><small>${String(this.index+1).padStart(2,"0")} / ${String(this.total).padStart(2,"0")}</small></header><div class="presentation-slide-body"><section><h3>${item.title}</h3>${item.body?html`<p>${item.body}</p>`:nothing}${slide.bullets.length?html`<ul>${slide.bullets.map((bullet)=>html`<li>${bullet}</li>`)}</ul>`:nothing}</section>${hasVisual?html`<aside aria-label=${slide.visual.label}>${this.#visual(slide)}</aside>`:nothing}</div><footer>${showDeckLabel?html`<span>${presentation.footerLabel}</span>`:nothing}${hasVisual?html`<span>${slide.visual.label}</span>`:nothing}</footer></article>`;}
}

customElements.define("forma-presentation-slide",PresentationSlide);
declare global{interface HTMLElementTagNameMap{"forma-presentation-slide":PresentationSlide}}
