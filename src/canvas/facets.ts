import type { CreativeBlock } from "../model/events";
import type { ReferenceFinding } from "../model/extractors";
import type { CanvasItem } from "./model";

export type CanvasFacetKind = "subject" | "location" | "palette" | "mood" | "composition" | "material" | "lighting";
export type CanvasFacet = { kind: CanvasFacetKind; label: string; value: string; colors: string[]; confidence: number | null; source: "authored" | "extracted" };

const LABELS: Record<CanvasFacetKind,string> = { subject:"Subject", location:"Location", palette:"Palette", mood:"Mood", composition:"Composition", material:"Material", lighting:"Lighting" };
const KIND_FOR_BLOCK: Partial<Record<string,CanvasFacetKind>> = { subject:"subject", environment:"location", palette:"palette", emotion:"mood", composition:"composition", material:"material", lighting:"lighting" };
const strings=(value:unknown)=>Array.isArray(value)?value.map(String).filter(Boolean):typeof value==="string"&&value.trim()?[value.trim()]:[];
const description=(block:CreativeBlock)=>String(block.properties.label??block.properties.text??block.properties.value??block.handle.split("/").at(-1)?.replaceAll("-"," ")??block.type).trim();

function dedupe(facets:CanvasFacet[]){const seen=new Set<string>();return facets.filter((facet)=>{const key=`${facet.kind}:${facet.value.toLowerCase()}`;if(seen.has(key))return false;seen.add(key);return true;});}

/**
 * Builds a view-only semantic index from authored blocks and extractor receipts.
 * These facets may rank and organize the board; they never become creative truth
 * until a person explicitly promotes one into a block or composite context.
 */
export function canvasFacetsForBlocks(blocks:CreativeBlock[]):CanvasFacet[]{
  const facets:CanvasFacet[]=[];
  for(const block of blocks){
    const kind=KIND_FOR_BLOCK[block.type];
    if(kind){const colors=kind==="palette"?strings(block.properties.colors):[];facets.push({kind,label:LABELS[kind],value:description(block),colors,confidence:null,source:"authored"});}
    const findings=Array.isArray(block.properties.reference_findings)?block.properties.reference_findings as ReferenceFinding[]:[];
    for(const finding of findings){const mapped:Partial<Record<ReferenceFinding["kind"],CanvasFacetKind>>={palette:"palette",mood:"mood",composition:"composition",material:"material",lighting:"lighting",spatial:"location"};const findingKind=mapped[finding.kind];if(!findingKind)continue;facets.push({kind:findingKind,label:LABELS[findingKind],value:String(finding.label||finding.value||finding.kind),colors:strings(finding.colors),confidence:Number.isFinite(Number(finding.confidence))?Number(finding.confidence):null,source:"extracted"});}
  }
  return dedupe(facets);
}

export function canvasFacetsForItem(item:CanvasItem,blocks:CreativeBlock[]){
  if(item.sourceKind==="block"||item.sourceKind==="reference"||item.sourceKind==="sketch")return canvasFacetsForBlocks(blocks.filter((block)=>block.id===item.sourceId));
  if(item.sourceKind==="document")return canvasFacetsForBlocks(blocks.filter((block)=>block.documentId===item.sourceId));
  return [];
}

export function canvasFacetKey(facet:Pick<CanvasFacet,"kind"|"value">){return`${facet.kind}:${facet.value}`;}
export function canvasFacetLabel(kind:CanvasFacetKind){return LABELS[kind];}
