import { freezeCase, hash } from './core.mjs';
import { IMAGE_ADAPTER_EVALUATION_CORPUS } from '../image-adapters/canvas-image-corpus-v6.ts';

const briefs = [
  ['incident-equivalent', 'literary-portrait', 'An original illustration of Atticus Finch, an adult fictional lawyer, in a dark suit and glasses carrying a portfolio on a 1930s street before a courthouse. Muted earth palette. No specific screen actor likeness.'],
  ['adult-portrait', 'adult-portrait', 'An original adult botanist holding a notebook in a greenhouse. Green and cream palette. No logos.'],
  ['rich-literary', 'rich-literary-constraints', 'An original adult fictional archivist in a 1920s library, left of a brass lamp, holding a red atlas. Indigo and brass palette. No actor likeness.'],
  ['spatial', 'spatial-nonportrait', 'Three blue ceramic bowls in the lower-right quadrant of a cream table; one red cloth at upper left. No people.'],
  ['typography', 'exact-typography', 'A cream poster with the exact words FIND TRUE NORTH once, centered above a navy compass illustration. No additional text.'],
  ['negative', 'negative-constraints', 'A quiet ochre desert printshop with one adult printmaker and a blue landscape print. No logos, no crowds, no computer screens.'],
];
export const CASES = briefs.map(([key, stratum, text]) => freezeCase({ key, stratum,
  source: { facts: [{ type:'subject', active:true, authority:'authored', properties:{ text, weight:1, intent:'include', spatial_scope:{kind:'document'} } }], relationships:[], pins:[], standing_constraints:[] },
  direction: { title:key, scene:text, rationale:'Synthetic frozen direction, not reconstructed incident planning.', palette:[], next_moves:[] },
  prompt:text, requirements:[{id:'authored-brief',text,critical:true,mustContain:[text]}],
}));
export const REFERENCES = [1,2].map(i => ({ bytesHash:hash(`mock-reference-pixels-${i}`), originalBytesHash:hash(`mock-reference-pixels-${i}`), width:32,height:24, role:i===1?'composition':'palette', provenance:'synthetic mock digest, not real provider-ready pixels', fixtureOnly:true }));

/** Reuse the existing corpus's authored source, direction, options and rubric, not its two-provider runner. */
export function legacyCorpusInventory() {
  return IMAGE_ADAPTER_EVALUATION_CORPUS.map(c => ({ caseKey:c.id, stratum:c.category, sourceHash:hash(c.snapshot), plannerHash:hash(c.direction), requirements:c.rubric,
    settings:structuredClone(c.options), effectiveProductionModel:c.options.quality==='low'?'gpt-image-2.5-flare':'gpt-image-2.5-sunburst',
    referenceFixtureStatus:c.options.referenceAsset?'must authorize/read/hash exact ordered pixels before admission':'none', execution:'not_scheduled' }));
}
