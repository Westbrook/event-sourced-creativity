export type CharacterFieldDefinition = {
  id:string;
  label:string;
  placeholder?:string;
  multiline?:boolean;
};

export type CharacterFieldSection = {
  id:string;
  label:string;
  parent?:string;
  fields:readonly CharacterFieldDefinition[];
};

/** Optional, self-authored descriptions. Identity is never inferred from an image. */
export const CHARACTER_FIELD_SECTIONS:readonly CharacterFieldSection[]=[
  {id:"identity",label:"Identity",fields:[
    {id:"name",label:"Name"},{id:"pronouns",label:"Pronouns"},{id:"age",label:"Age"},
    {id:"ethnicity",label:"Ethnicity or heritage"},{id:"origin",label:"Place of origin"},
    {id:"residence",label:"Current residence"},
  ]},
  {id:"face",label:"Face",fields:[
    {id:"skin_tone",label:"Skin tone"},{id:"undertone",label:"Undertone"},
    {id:"face_shape",label:"Face shape"},{id:"skin_texture",label:"Skin texture"},
    {id:"nose",label:"Nose"},{id:"cheeks",label:"Cheeks"},{id:"lips",label:"Lips and mouth"},
    {id:"ears",label:"Ears"},{id:"teeth",label:"Teeth"},
  ]},
  {id:"eyes",label:"Eyes",parent:"face",fields:[
    {id:"eye_color",label:"Eye color"},{id:"eye_shape",label:"Eye shape"},
    {id:"eye_spacing",label:"Eye spacing"},{id:"eyelids",label:"Eyelids"},
    {id:"eyelashes",label:"Eyelashes"},{id:"eyebrows",label:"Eyebrows"},
  ]},
  {id:"distinguishing",label:"Distinctive details",parent:"face",fields:[
    {id:"moles",label:"Moles or beauty marks"},{id:"freckles",label:"Freckles"},
    {id:"scars",label:"Scars"},{id:"wrinkles",label:"Wrinkles"},
  ]},
  {id:"hair",label:"Hair",fields:[
    {id:"hair_color",label:"Hair color"},{id:"hair_length",label:"Hair length"},
    {id:"hair_texture",label:"Hair texture"},{id:"hair_density",label:"Hair density"},
    {id:"hair_part",label:"Hair part"},{id:"hair_style",label:"Hair style"},
    {id:"hair_preparation",label:"Hair preparation"},
  ]},
  {id:"body",label:"Body",fields:[
    {id:"height",label:"Height"},{id:"build",label:"Build"},
    {id:"weight",label:"Weight"},{id:"posture",label:"Posture"},
  ]},
  {id:"wardrobe",label:"Wardrobe",fields:[
    {id:"clothing_cut",label:"Clothing and cut"},{id:"fabric",label:"Fabric"},
    {id:"clothing_color",label:"Clothing colors"},{id:"pattern",label:"Pattern"},
    {id:"layers",label:"Layers"},{id:"accessories",label:"Accessories"},
  ]},
  {id:"personality",label:"Personality and role",fields:[
    {id:"demeanor",label:"Demeanor",multiline:true},{id:"personality",label:"Personality",multiline:true},
    {id:"occupation",label:"Occupation or role"},
  ]},
  {id:"shot",label:"Portrait direction",fields:[
    {id:"view",label:"View or angle"},{id:"framing",label:"Framing"},
    {id:"expression",label:"Expression"},{id:"lighting",label:"Portrait lighting"},
    {id:"background",label:"Background"},{id:"lens",label:"Lens"},
    {id:"visual_style",label:"Visual style"},{id:"sheet_views",label:"Character-sheet views"},
  ]},
];

const record=(value:unknown):Record<string,unknown>=>value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};

export const isCharacterContext=(type:string,properties:Record<string,unknown>)=>
  type==="subject"&&(properties.character_context===true||["Character headshot","Character sheet"].includes(String(properties.subtype??"")));

export function characterProfileValue(properties:Record<string,unknown>,section:string,field:string){
  const profile=record(properties.character_profile);
  return String(record(profile[section])[field]??"");
}

export function withCharacterProfileField(properties:Record<string,unknown>,section:string,field:string,value:string){
  const profile=record(properties.character_profile),previous=record(profile[section]);
  const next={...previous};
  if(value.trim())next[field]=value.trim();else delete next[field];
  const result={...profile};
  if(Object.keys(next).length)result[section]=next;else delete result[section];
  return result;
}

export function characterProfileSummary(properties:Record<string,unknown>){
  const values=CHARACTER_FIELD_SECTIONS.flatMap((section)=>section.fields.map((field)=>({label:field.label,value:characterProfileValue(properties,section.id,field.id)})).filter((field)=>field.value));
  return values.map(({label,value})=>`${label}: ${value}`).join(" · ");
}
