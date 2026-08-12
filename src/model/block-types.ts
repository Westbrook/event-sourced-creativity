export type BlockGroup = "intent" | "scene" | "craft" | "constraint" | "evidence";
export type BlockKind = "direction" | "audience" | "message" | "emotion" | "subject" | "environment" | "motion" | "scale" | "composition" | "camera" | "lighting" | "style" | "material" | "palette" | "typography" | "format" | "brand" | "exclusion" | "accessibility" | "reference";
export type BlockIntent = "include" | "prefer" | "avoid" | "prohibit";
export type ReferencePixelMode = "context_only" | "inspiration" | "preserve_composition" | "preserve_subject" | "preserve_style";

export const REFERENCE_PIXEL_MODES: readonly { id: ReferencePixelMode; label: string; description: string; promptDirective: string }[] = [
  { id:"context_only", label:"Describe only", description:"Use extracted findings and authored notes, but do not send the original pixels.", promptDirective:"Use only the text context derived from this reference; no source pixels are attached." },
  { id:"inspiration", label:"Visual inspiration", description:"Send the original image as flexible visual inspiration.", promptDirective:"Use this image as flexible visual inspiration without copying it literally." },
  { id:"preserve_composition", label:"Preserve composition", description:"Send the image and retain its framing, balance, and spatial relationships.", promptDirective:"Preserve the reference image's composition, framing, balance, and spatial relationships while applying the authored plan." },
  { id:"preserve_subject", label:"Preserve subject", description:"Send the image and keep its principal subject recognizable and structurally consistent.", promptDirective:"Preserve the principal subject's recognizable form and structural identity while applying the authored plan." },
  { id:"preserve_style", label:"Preserve look & materials", description:"Send the image and carry forward its visual treatment, surfaces, and material character.", promptDirective:"Preserve the reference image's visual treatment, surface character, and material language while applying the authored plan." },
];

export const referencePixelMode = (value: unknown): ReferencePixelMode => REFERENCE_PIXEL_MODES.some((option)=>option.id===value) ? value as ReferencePixelMode : "context_only";
export const referencePixelModeDefinition = (value: unknown) => REFERENCE_PIXEL_MODES.find((option)=>option.id===referencePixelMode(value))!;
export const sendsReferencePixels = (value: unknown) => referencePixelMode(value) !== "context_only";

export const BLOCK_INTENTS: readonly { id: BlockIntent; label: string; description: string }[] = [
  { id:"include", label:"Include", description:"Make this part of the result." },
  { id:"prefer", label:"Prefer", description:"Favor this when it supports the direction." },
  { id:"avoid", label:"Avoid", description:"Keep this out unless another explicit requirement overrides it." },
  { id:"prohibit", label:"Never", description:"Treat this as a hard boundary that must not appear." },
];

export type BlockTypeDefinition = {
  type: BlockKind;
  label: string;
  description: string;
  prompt: string;
  group: BlockGroup;
  subtypes: readonly string[];
};

export const BLOCK_GROUPS: readonly { id: BlockGroup; label: string; description: string }[] = [
  { id:"intent", label:"Purpose & audience", description:"Define what the work should accomplish, communicate, and make people feel." },
  { id:"scene", label:"Scene & reality", description:"Describe what exists, where it exists, and how it behaves in space." },
  { id:"craft", label:"Visual craft", description:"Shape the composition, treatment, materials, color, light, and typography." },
  { id:"constraint", label:"Requirements & limits", description:"Set production, brand, accessibility, and exclusion boundaries." },
  { id:"evidence", label:"Grounding evidence", description:"Attach owned or licensed references that support creative decisions." },
];

export type AdaptiveStructure = {
  interpretation: string;
  active_decision: { type: BlockKind; label: string; prompt: string; why: string };
  suggested_blocks: Array<{ type: BlockKind; subtype: string; label: string; instruction: string; reason: string; relationship_to: string }>;
  hidden_until_later: string[];
};

export const BLOCK_TYPES: readonly BlockTypeDefinition[] = [
  { type:"direction", label:"Direction", description:"The outcome or change the work should create", prompt:"Describe the creative outcome…", group:"intent", subtypes:["Campaign goal","Emotional outcome","Behavioral objective","Exploration question"] },
  { type:"audience", label:"Audience", description:"Who the work needs to reach and in what context", prompt:"Who is this for, and where will they meet it?", group:"intent", subtypes:["Primary audience","Use context","Cultural lens","Accessibility need"] },
  { type:"message", label:"Message", description:"The idea or narrative the audience should retain", prompt:"What should the work communicate?", group:"intent", subtypes:["Single proposition","Narrative beat","Call to action","Subtext"] },
  { type:"emotion", label:"Emotion", description:"The affect, energy, or tension the work should carry", prompt:"What should the work make someone feel?", group:"intent", subtypes:["Primary affect","Emotional contrast","Energy level","Temporal mood"] },
  { type:"subject", label:"Subject", description:"What must exist or be depicted", prompt:"What should exist in the frame?", group:"scene", subtypes:["Hero subject","Supporting subject","Human presence","Object study"] },
  { type:"environment", label:"Environment", description:"The world, place, or spatial setting", prompt:"Where does this reality take place?", group:"scene", subtypes:["Interior","Exterior","Abstract space","Social setting"] },
  { type:"motion", label:"Motion", description:"Movement, stillness, and change through the scene", prompt:"What moves, or deliberately stays still?", group:"scene", subtypes:["Subject motion","Camera motion","Implied motion","Stillness"] },
  { type:"scale", label:"Scale", description:"Perceived size and distance relationships", prompt:"How should scale be experienced?", group:"scene", subtypes:["Intimate","Human","Monumental","Relative contrast"] },
  { type:"composition", label:"Composition", description:"Framing, balance, and reading order", prompt:"How should the elements occupy the frame?", group:"craft", subtypes:["Focal hierarchy","Grid","Negative space","Crop"] },
  { type:"camera", label:"Camera", description:"Viewpoint, lens behavior, depth, and perspective", prompt:"How should the viewer encounter the scene?", group:"craft", subtypes:["Viewpoint","Lens character","Depth of field","Perspective"] },
  { type:"lighting", label:"Lighting", description:"Light direction, quality, color, and time", prompt:"What light makes the scene believable?", group:"craft", subtypes:["Direction","Quality","Color temperature","Time of day"] },
  { type:"style", label:"Style", description:"The visual language and treatment", prompt:"What visual language should unify the work?", group:"craft", subtypes:["Art direction","Era","Medium","Finish"] },
  { type:"material", label:"Material", description:"Surface, texture, fabrication, and wear", prompt:"What should the work feel made from?", group:"craft", subtypes:["Surface","Fabrication","Texture","Wear"] },
  { type:"palette", label:"Palette", description:"A deliberate family of colors and tonal relationships", prompt:"Name or describe this palette…", group:"craft", subtypes:["Extracted","Brand","Emotional","Tonal"] },
  { type:"typography", label:"Typography", description:"Type roles, voice, layout, and letterform rules", prompt:"How should type behave?", group:"craft", subtypes:["Role","Voice","Layout","Letterform constraint"] },
  { type:"format", label:"Format", description:"The destination, proportions, and production frame", prompt:"Where and at what dimensions will this live?", group:"constraint", subtypes:["Aspect ratio","Channel","Resolution","Safe area"] },
  { type:"brand", label:"Brand", description:"Identity cues and mandatory or forbidden treatments", prompt:"What identity rules must be carried forward?", group:"constraint", subtypes:["Identity cue","Mandatory asset","Tone rule","Forbidden treatment"] },
  { type:"exclusion", label:"Exclusion", description:"A failure mode or motif the work must avoid", prompt:"What would break the direction?", group:"constraint", subtypes:["Visual exclusion","Semantic exclusion","Safety boundary","Failure mode"] },
  { type:"accessibility", label:"Accessibility", description:"Perceptual and cultural requirements for clear access", prompt:"What must remain perceivable and understandable?", group:"constraint", subtypes:["Contrast","Legibility","Motion sensitivity","Cultural clarity"] },
  { type:"reference", label:"Reference", description:"Owned or licensed evidence that grounds a decision", prompt:"Choose an owned or licensed reference…", group:"evidence", subtypes:["Mood","Composition","Material","Color"] },
] as const;

export const blockTypeDefinition = (type: string) => BLOCK_TYPES.find((definition) => definition.type === type);
export const isBlockKind = (type: string): type is BlockKind => Boolean(blockTypeDefinition(type));
export const suggestedSubtype = (type: string) => blockTypeDefinition(type)?.subtypes[0] ?? "General";
export const isBlockIntent = (intent: string): intent is BlockIntent => BLOCK_INTENTS.some((definition) => definition.id === intent);
export const blockIntentFor = (type: string, properties: Record<string, unknown>): BlockIntent => {
  const intent = String(properties.intent ?? "");
  if (isBlockIntent(intent)) return intent;
  return type === "exclusion" ? "avoid" : "include";
};
export const isNegativeIntent = (intent: BlockIntent) => intent === "avoid" || intent === "prohibit";
export const blockEffectFor = (type: string, properties: Record<string, unknown>) => isNegativeIntent(blockIntentFor(type, properties)) ? "must_not_include" : "shape_or_include";
