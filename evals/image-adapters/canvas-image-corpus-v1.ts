import type { PromptTechnique } from "../../src/model/prompt-structures";
import type { ImageOutputFormat, ReferencePixelMode } from "../../worker/openai-adapter";

export const IMAGE_ADAPTER_CORPUS_VERSION="canvas-image-corpus-v1";

type Theme={id:string;title:string;subject:string;setting:string;mood:string;palette:string;material:string;composition:string;displayText:string;avoid:string};
export type ImageAdapterEvaluationCase={
  id:string;title:string;category:"composition"|"typography"|"spatial"|"material"|"reference";
  snapshot:Record<string,unknown>;direction:Record<string,unknown>;
  options:{quality:"low"|"medium"|"high";size:`${number}x${number}`;outputFormat:ImageOutputFormat;promptTechnique:PromptTechnique;referenceAsset?:string;referenceMode?:ReferencePixelMode};
  rubric:string[];
};

const themes:Theme[]=[
  {id:"observatory",title:"Midnight Observatory",subject:"a solitary astronomer calibrating a brass telescope",setting:"a circular mountain observatory open to a star-dense sky",mood:"quiet awe with disciplined concentration",palette:"midnight blue, warm brass, chalk white, and one ember-orange accent",material:"patinated brass, dark walnut, frosted glass, and worn paper",composition:"a strong diagonal from the telescope toward a small celestial event",displayText:"THE LAST LIGHT",avoid:"generic science-fiction control panels, neon cyberpunk lighting, or crowded equipment"},
  {id:"tidal-library",title:"Tidal Library",subject:"an adult archivist rescuing a salt-stained atlas",setting:"a monumental coastal library at the edge of a slowly rising tide",mood:"urgent care without disaster spectacle",palette:"sea green, limestone, faded coral, and ink black",material:"watermarked paper, oxidized copper, wet stone, and linen",composition:"layered depth with the atlas crisp in the near foreground and flooded aisles receding",displayText:"WHAT THE TIDE REMEMBERS",avoid:"drowning, panic, ruined books as clutter, or apocalyptic destruction"},
  {id:"night-market",title:"Night Market Radio",subject:"an independent radio host recording a live interview",setting:"a covered night market after closing with paper lanterns and folded stalls",mood:"intimate, curious, and lightly improvised",palette:"aubergine, tobacco brown, rice-paper cream, and signal red",material:"brushed aluminum, canvas awnings, paper, and lacquered wood",composition:"two people in conversational profile with the microphone as a visual hinge",displayText:"AFTER THE STALLS CLOSE",avoid:"podcast clichés, visible brand marks, large crowds, or nightclub lighting"},
  {id:"ceramic-lab",title:"Ceramic Weather Lab",subject:"a ceramicist comparing three experimental glaze tiles",setting:"a daylight workshop with a single long worktable",mood:"tactile, exacting, and optimistic",palette:"celadon, bone, iron oxide, and cobalt",material:"crackle glaze, raw clay, plaster, and pale oak",composition:"ordered triptych of tiles with hands entering only at the lower edge",displayText:"WEATHER, FIRED",avoid:"pottery wheels, rustic farmhouse styling, excessive tools, or glossy plastic"},
  {id:"rail-garden",title:"Rail Garden",subject:"an urban landscape architect examining a modular planting system",setting:"a disused elevated rail platform converted into a resilient garden",mood:"practical hope and measured experimentation",palette:"lichen green, rust, concrete gray, and safety yellow",material:"weathering steel, recycled rubber, grasses, and cast concrete",composition:"long perspective with repeating modules and one clearly inspected detail",displayText:"THE SECOND GROUND",avoid:"utopian skyline clichés, immaculate landscaping, crowds, or luxury real-estate imagery"},
  {id:"paper-theater",title:"Paper Theater",subject:"a stage designer positioning a miniature paper set",setting:"a black-box theater workbench surrounded by darkness",mood:"inventive, precise, and slightly mysterious",palette:"ivory, carbon black, vermilion, and muted gold",material:"cut paper, thread, matte paint, and black velvet",composition:"the miniature set glows at center while the designer remains partially silhouetted",displayText:"A WORLD, FOLDED",avoid:"full-size actors, ornate proscenium decoration, visible computers, or toy-like whimsy"},
  {id:"winter-greenhouse",title:"Winter Greenhouse",subject:"a botanist cataloging a rare night-blooming plant",setting:"a glasshouse during a quiet snowstorm",mood:"sheltered wonder and patient observation",palette:"deep leaf green, snow blue, warm glass amber, and soft violet",material:"condensed glass, dark soil, waxy leaves, and galvanized steel",composition:"the bloom slightly off-center with the botanist and snowy panes forming concentric frames",displayText:"BLOOM AFTER DARK",avoid:"tropical abundance, fantasy flowers, laboratory sterility, or heavy fog"},
  {id:"signal-kitchen",title:"Signal Kitchen",subject:"a food scientist testing the visual rhythm of a plated tasting menu",setting:"a restrained experimental kitchen before service",mood:"playful rigor and controlled anticipation",palette:"tomato red, stainless silver, charcoal, and herb green",material:"brushed steel, glazed ceramic, linen, and translucent gel",composition:"overhead grid interrupted by one intentionally displaced plate",displayText:"COURSE CORRECTION",avoid:"messy prep, restaurant crowds, flames, luxury excess, or illegible plating"},
  {id:"desert-printshop",title:"Desert Printshop",subject:"a printmaker pulling a large abstract landscape from a hand press",setting:"an adobe studio opening onto a high desert afternoon",mood:"bold, grounded, and generous",palette:"ochre, ultramarine, dusty rose, and uncoated white",material:"deckled paper, ink, adobe plaster, and dark steel",composition:"the print occupies most of the frame with the landscape visible as a narrow echo beyond",displayText:"PRESS / HORIZON",avoid:"cowboy imagery, souvenir aesthetics, cluttered walls, or photographic realism in the print"},
  {id:"harbor-workshop",title:"Harbor Repair Workshop",subject:"a marine instrument repairer restoring a compact brass compass",setting:"a small harbor workshop at blue hour",mood:"focused continuity and earned calm",palette:"navy, verdigris, warm brass, and fog gray",material:"brass, oiled leather, scratched glass, and painted timber",composition:"close focus on the compass with harbor lights reduced to soft geometric echoes",displayText:"FIND TRUE NORTH",avoid:"ship wheels, nautical kitsch, storm drama, or luxury-watch advertising"},
];

const techniques:PromptTechnique[]=["prose","bullets","json","xml"];
const sizes:[`${number}x${number}`,`${number}x${number}`,`${number}x${number}`]=["1024x1024","1536x1024","1024x1536"];
const references=["public/og.png","public/focal-point-lab/children-in-park-01.png","public/focal-point-lab/children-in-park-02.png","public/focal-point-lab/children-in-park-03.png"];

function imageFormat(size:`${number}x${number}`){const[width,height]=size.split("x").map(Number);return{schema_version:1,aspect_ratio:{width,height},dimensions:{width,height,unit:"px"}};}

function facts(theme:Theme,variant:number,size:`${number}x${number}`){
  const spatial=variant===2?{kind:"aabb",label:"lower-right quadrant",aabb:{x:0.52,y:0.48,width:0.4,height:0.42}}:variant===4?{kind:"fuzzy",label:"central subject and immediate surroundings"}:{kind:"document"};
  const create=(suffix:string,type:string,intent:string,text:string,weight:number,scope:Record<string,unknown>={kind:"document"})=>({block_id:`${theme.id}-${suffix}`,document_id:`eval-${theme.id}`,type,role:type,intent,effect:intent==="avoid"?"must_not_include":"include",handle:`${type}/${theme.id}-${suffix}`,position:`e${suffix}`,locked:false,active:true,authority:"authored",properties:{text,label:text,subtype:suffix,weight,intent,authority:"authored",spatial_scope:scope}});
  return[
    create("direction","direction","include",`Create a resolved visual study for ${theme.title}.`,.95),
    create("subject","subject","include",theme.subject,.92,spatial),
    create("setting","setting","include",theme.setting,.86),
    create("mood","mood","prefer",theme.mood,.76),
    create("palette","palette","prefer",theme.palette,.72,variant===2?spatial:{kind:"document"}),
    create("material","material","prefer",theme.material,.68),
    create("composition","composition","include",theme.composition,.84),
    create("typography","typography",variant===1?"include":"prefer",`If typography is present, set the exact display text “${theme.displayText}” once, clearly and without additional copy.`,variant===1?.95:.45),
    create("constraint","constraint","avoid",theme.avoid,.9),
    {...create("format","format","include",`Create for a ${size.replace("x",":")} pixel frame.`,1),properties:{text:`Create for a ${size.replace("x"," × ")} pixel frame.`,label:`${size} output`,subtype:"Resolution",weight:1,intent:"include",authority:"authored",spatial_scope:{kind:"document"},image_format:imageFormat(size)}},
  ];
}

const variants=[
  {category:"composition" as const,label:"resolved composition",quality:"high" as const,direction:"Resolve the complete scene as a polished editorial image. Preserve the primary subject, composition, material specificity, and exclusions."},
  {category:"typography" as const,label:"typographic key art",quality:"medium" as const,direction:"Create restrained key art with the requested exact display text used once. The text must be legible, deliberately positioned, and subordinate to the visual idea."},
  {category:"spatial" as const,label:"spatially scoped study",quality:"medium" as const,direction:"Honor the scoped subject and palette decisions only in their named region while preserving coherent treatment elsewhere in the frame."},
  {category:"material" as const,label:"fast material study",quality:"low" as const,direction:"Produce a fast but readable study emphasizing the named material, palette, light, and mood. Keep the scene simple enough to judge those decisions."},
  {category:"reference" as const,label:"single-reference interpretation",quality:"low" as const,direction:"Use the supplied image pixels as loose visual inspiration for rhythm and composition while creating the named subject and setting. Do not copy incidental text or identities from the reference."},
];

export const IMAGE_ADAPTER_EVALUATION_CORPUS:ImageAdapterEvaluationCase[]=themes.flatMap((theme,themeIndex)=>variants.map((variant,variantIndex)=>{
  const size=sizes[(themeIndex+variantIndex)%sizes.length];
  return{
    id:`${String(themeIndex+1).padStart(2,"0")}-${theme.id}-${variant.category}`,
    title:`${theme.title} · ${variant.label}`,
    category:variant.category,
    snapshot:{document:{id:`eval-${theme.id}`,title:theme.title},as_of_sequence:100+variantIndex,facts:facts(theme,variantIndex,size),relationships:[],pins:[],standing_constraints:[{axis:"quality",polarity:"prefer",value:"Suitable for professional creative review."},{axis:"presentation",polarity:"avoid",value:"Watermarks, signatures, and unrequested interface chrome."}]},
    direction:{title:theme.title,rationale:`Frozen ${variant.category} capability case.`,scene:variant.direction,palette:theme.palette.split(", "),next_moves:[]},
    options:{quality:variant.quality,size,outputFormat:(themeIndex+variantIndex)%2?"jpeg":"png",promptTechnique:techniques[(themeIndex+variantIndex)%techniques.length],...(variant.category==="reference"?{referenceAsset:references[themeIndex%references.length],referenceMode:(themeIndex%2?"preserve_composition":"inspiration") as ReferencePixelMode}:{})},
    rubric:["The named subject and setting are unmistakable.","Composition and any spatially scoped instruction are followed.","Palette, mood, and material cues are coherent rather than merely mentioned.","Avoid instructions are respected.",...(variant.category==="typography"?[`The exact display text “${theme.displayText}” appears once and is legible.`]:[]),...(variant.category==="reference"?["The reference contributes the authorized visual property without replacing the requested subject."]:[])],
  };
}));

if(IMAGE_ADAPTER_EVALUATION_CORPUS.length!==50)throw new Error("image_adapter_corpus_must_contain_50_cases");
