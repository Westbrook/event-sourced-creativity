import { compileContextAdaptationSections, partitionContextAdaptationFactScopes, requiredContextAdaptationFacts, type CompiledContextAdaptation, type ContextAdaptationSection } from "../src/model/context-adaptation.ts";
import { combinedContextGroups, combinedContextMemberships } from "../src/model/combined-context.ts";
import { promptFactIsActive, providerFacingRenderingContext } from "../src/model/prompt-policy.ts";
import { isVideoAudioMode, VIDEO_ADAPTER_CONTRACT, type VideoAudioMode, type VideoDurationSeconds } from "../src/model/video-adapter.ts";
import type { VideoReference } from "./openai-adapter.ts";
import { ProviderRequestError } from "./provider-errors.ts";
import { applyVideoSourceInterpretations, videoOutputScopedContext, type VideoSourceInterpretation } from "./video-source-scope.ts";

type CreativeRecord = Record<string, unknown>;

export type VideoStoryboardBeat = {
  sequence: number;
  storyboardTitle: string;
  storyboardGroupId: string;
  title: string;
  direction: string;
  cameraDirection: string;
  framePrompt: string;
  blockId: string | null;
};

export type VideoAudioPolicy = {
  requestedMode: VideoAudioMode;
  effectiveMode: VideoAudioMode;
  generateAudio: boolean;
  explicitlyRequested: boolean;
  authoredRequirement: "none" | "optional" | "required";
  residualRisk: "none" | "provider-output-review";
  rationale: string;
};

export type VideoPromptAdaptation = {
  prompt: string;
  adapterId: string;
  adapterVersion: string;
  audio: VideoAudioPolicy;
  compilation: CompiledContextAdaptation;
  storyboardBeats: Array<{ sequence: number; title: string; startsAtSeconds: number; endsAtSeconds: number; sourceBlockId: string | null }>;
  referenceBindings: Array<{ token: string; referenceId: string; blockId: string; sequence: number | null; mode: string; contextGroupIds: string[] }>;
  sourceBlockIds: string[];
  removedAudioDirections: string[];
  sourceInterpretations: VideoSourceInterpretation[];
  audioExclusionInterpretations: Array<{ originalText: string; providerText: string; scope: "global" | "target"; target?: string; role?: string }>;
  timingSource: "authored" | "normalized" | "single-shot";
};

type VideoPromptOptions = {
  snapshot?: CreativeRecord;
  plan?: { title?: string; summary?: string; items?: Array<{ notes?: string; body?: string }> };
  references: VideoReference[];
  seconds: VideoDurationSeconds;
  size: "1280x720" | "720x1280";
  model: string;
  promptProfile: "standard" | "positive-only";
  audioMode?: VideoAudioMode;
  generateAudio?: boolean;
  providedSoundtrack?: boolean;
  productionContinuity?: { prohibitions: string[]; scopedTargets: Array<{ target: string; role: string; prohibitions: string[] }> };
};

const record = (value: unknown): CreativeRecord => value && typeof value === "object" && !Array.isArray(value) ? value as CreativeRecord : {};
const text = (value: unknown, maximum = 500) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maximum);
// Safety classification inspects complete source channels, independently of
// the bounded representation later sent to a provider.
const audioPolicyText = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim();
const activeFacts = (snapshot: CreativeRecord = {}) => Array.isArray(snapshot.facts) ? snapshot.facts.filter(promptFactIsActive).map(record) : [];
// Local safety review must honor existing authored audio restrictions even when
// a reusable recording has not been approved for provider-facing composition.
const activeVideoAudioPolicyFacts = (snapshot: CreativeRecord = {}) => Array.isArray(snapshot.facts)
  ? snapshot.facts.map(record).filter((fact) => {
    const properties = record(fact.properties);
    return fact.active !== false && fact.removed !== true && properties.active !== false
      && (properties.weight === undefined || Number(properties.weight) > 0);
  })
  : [];
const AUDIO_HEADING = /^\s*(?:[-*•]\s*)?(?:\*{0,2})?(?:audio|soundtrack|music|score|song|sound design|sound effects|sfx|foley|voiceover|voice-over|dialogue|speech)(?:\*{0,2})?\s*[:—-]\s*(.+)$/gim;
const UNSUPPORTED_AUDIO = /\b(?:music|musical|orchestral|score|soundtrack|melod(?:y|ic)|harmon(?:y|ic)|songs?|sung|sing(?:s|ing)?|hums?|humming|whistl(?:e|es|ing)|lyrics?|vocal(?:s|ist)?|voices?|voiceover|voice-over|dialog(?:ue)?|speech|speak(?:s|ing)?|spoken|narrat(?:e|es|ed|ing|ion)|whisper(?:s|ed|ing)?|chant(?:s|ed|ing)?|riffs?|jingles?|beatbox(?:er|ers|es|ed|ing)?|rapp(?:er|ers|ed|ing)|freestyl(?:e|es|ed|ing)|concerto|overture|sonata|symphony|instrumental|imitat(?:e|es|ed|ing|ion)|impersonat(?:e|es|ed|ing|ion)|cover version|copyright(?:ed)?)\b/i;
const AUDIO_FACT = /\b(?:audio|soundtrack|music|sound design|sound effects|foley|voiceover|voice-over|dialogue|speech)\b/i;
const REQUIRED_AUDIO_DIRECTION = /\b(?:must|requires?|required|essential|needs?|mandatory)\b[^.\n]{0,100}\b(?:audible|audio|sound(?:\s+effects?)?|soundtrack|music|score|songs?|lyrics?|dialog(?:ue)?|voice(?:over)?|speech|melod(?:y|ies)|vocals?|sing(?:s|ing)?|hum(?:s|ming)?|whistl(?:e|es|ing)|hear(?:d)?|foley|ambien(?:ce|t))\b|\b(?:audible|audio|sound(?:\s+effects?)?|soundtrack|music|score|songs?|lyrics?|dialog(?:ue)?|voice(?:over)?|speech|melod(?:y|ies)|vocals?|sing(?:s|ing)?|hum(?:s|ming)?|whistl(?:e|es|ing)|hear(?:d)?|foley|ambien(?:ce|t))\b[^.\n]{0,100}\b(?:must|requires?|required|essential|needs?|mandatory|cannot\s+be\s+omitted)\b/i;
const AUDIO_BEARING_FACT_TYPES = new Set(["direction", "message", "motion", "emotion", "brand", "accessibility", "reference"]);
const NEGATED_AUDIO = /\b(?:no|without|excluding|exclude|never|avoid|prohibit(?:ed)?)\s+(?:(?:all|any|generated|audible|background|recorded|copyrighted|licensed|recognizable)\s+){0,4}(?:audio|sound(?:\s+effects?)?|music|musical scoring|score|soundtrack|melod(?:y|ies)|songs?|lyrics?|vocals?|voice(?:s|over)?|dialogue|speech)(?:(?:\s*,\s*(?:(?:or|and)\s+)?|\s+(?:or|and)\s+)(?:audio|sound(?:\s+effects?)?|music|musical scoring|score|soundtrack|melod(?:y|ies)|songs?|lyrics?|vocals?|voice(?:s|over)?|dialogue|speech))*/gi;
const AUDIO_PROHIBITION = /\b(?:do|does|did|must|should|may|will|can|need)\s+(?:not|never)\s+(?:(?:have|include|contain|use|generate|play|feature|add|create|be)\s+){0,2}(?:(?:all|any|generated|audible|background|recorded|copyrighted|licensed|recognizable)\s+){0,4}(?:audio|sound(?:\s+effects?)?|music|score|soundtrack|songs?|vocals?|voices?|dialogue|speech)\b|\b(?:audio|sound(?:\s+effects?)?|music|score|soundtrack|songs?|vocals?|voices?|dialogue|speech)\s+(?:must|should|may|will|can)\s+(?:not|never|be\s+(?:off|disabled|excluded|absent))\b/i;
const MUSIC_FREE = /\b(?:music|musical|soundtrack|songs?|melod(?:y|ic))[-\s]+free\b/i;
const NONMUSICAL = /\bnon[-\s]?(?:musical|melodic)\b/gi;
const NAMED_SONG_PLAYBACK = /\b(?:while|as|with|to|set to|accompanied by)\s+(?:[\p{L}][\p{L}.'’-]*\s+){0,3}[\p{L}][\p{L}.'’-]*[’']s\s+[A-Z][\p{L}0-9'’-]*(?:\s+[A-Z][\p{L}0-9'’-]*){0,7}\s+plays?\b|\b(?:danc(?:er|e|es|ing)|perform(?:s|ing)?|soundtrack|music|song|sings?)\b[^.;\n]{0,50}\b(?:to|set to)\s+(?:[\p{L}][\p{L}.'’-]*\s+){0,3}[\p{L}][\p{L}.'’-]*[’']s\s+[A-Z][\p{L}0-9'’-]*(?:\s+[A-Z][\p{L}0-9'’-]*){0,7}/u;
const COPYRIGHT_RISK_AUDIO = /\b(?:recognizable|copyrighted|licensed|famous|existing|named)\b[^.;\n]{0,90}\b(?:music|song|track|soundtrack|orchestral(?:\s+theme)?|theme(?:\s+song)?|melody|score)\b|\b(?:recognizable|copyrighted|licensed|famous|unmistakable)\b[^.;\n]{0,100}\b(?:fanfare|beats?|rhythm|jingles?|riffs?)\b|\b(?:sound design|audio|music|soundtrack|score|theme|song)\b[^.;\n]{0,70}\b(?:in the style of|style of|imitat(?:ing|es?)|cover(?:\s+version)?\s+of)\b|\b(?:orchestral\s+(?:score|theme)|orchestra|soundtrack|theme\s+song|recorded\s+(?:music|song))\b[^.;\n]{0,70}\b(?:plays?|playing|swells?|fills?|underscores?)\b|\b(?:to|with|set to|underscored by)\s+(?:the\s+)?(?:[A-Z][\p{L}'’-]*\s+){1,5}theme\b|\bplay\s+(?:the\s+)?(?:[A-Z][\p{L}'’-]*\s+){0,6}(?:theme|song|track|music|score|soundtrack)\b|\b(?:march|theme|song|track|music|score|soundtrack)\b[^.;\n]{0,45}\bby\s+(?:[A-Z][\p{L}'’-]*\s*){1,4}[^.;\n]{0,25}\b(?:plays?|playing|soundtrack|music)\b|\b(?:soundtrack|score|audio|music)\s*[:—-][^.;\n]{0,90}\b(?:sings?|singing|plays?|playing)\b/iu;
const NAMED_MUSICAL_ATTRIBUTION = /\b(?:[A-Z][\p{L}'’-]*\s+){0,6}(?:[Mm]arch|[Oo]verture|[Ss]onata|[Ss]ymphony|[Cc]oncerto|[Tt]heme|[Ss]ong|[Ss]oundtrack)\s+by\s+(?:[A-Z][\p{L}'’-]*\s+){1,3}[A-Z][\p{L}'’-]*\b/u;
const NAMED_MUSICAL_TITLE = /\b(?!The\b|A\b|An\b)(?:[A-Z][\p{L}'’-]*\s+){1,3}[A-Z][\p{L}'’-]*[’']s\s+(?:[A-Z][\p{L}'’-]*\s+){1,6}[A-Z][\p{L}'’-]*\b|\b[A-Z]\p{L}*[\u0080-\u02AF]\p{L}*[’']s\s+[A-Z][\p{L}'’-]*\b|\b(?:[A-Z][\p{L}'’-]*(?:\s+(?:of|the|and|in|on|for))?\s+){1,5}[A-Z][\p{L}'’-]*\s+by\s+[A-Z][\p{L}'’-]*(?:\s+[A-Z][\p{L}'’-]*){0,3}\b|\b(?:[A-Z][\p{L}'’-]*\s+){1,3}[A-Z][\p{L}'’-]*\s*:\s+(?:[A-Z][\p{L}'’-]*\s+){0,6}(?:March|Overture|Sonata|Symphony|Concerto|Theme|Song|Soundtrack)\b/u;
const SYNTHETIC_NAMED_NARRATION = /\b(?:synthetic|digital|ai-generated|cloned)\s+(?:replica|clone|imitation|reproduction)\s+of\s+(?:[A-Z][\p{L}'’-]*\s+){1,3}[A-Z][\p{L}'’-]*[^.;\n]{0,90}\b(?:describ(?:e|es|ing)|narrat(?:e|es|ing)|speak(?:s|ing)?|whisper(?:s|ing)?|voices?)\b/u;
const NAMED_MUSICAL_PERFORMANCE = /\b(?:[A-Z][\p{L}'’-]*\s+){1,3}[A-Z][\p{L}'’-]*(?:[’']s?)?\s+(?:performs?|plays?|sings?)\s+(?:the\s+)?(?:[A-Z][\p{L}'’-]*\s*){1,8}|\b(?:[A-Z][\p{L}'’-]*\s+){1,3}[A-Z][\p{L}'’-]*[’']s?\s+(?:[A-Z][\p{L}'’-]*\s+){1,8}(?:plays?|playing|swells?|performs?)\b|\b(?:recognizable|famous|copyrighted|licensed)\s+((?:[A-Z][\p{L}'’-]*\s+){0,5})(?:[Mm]arch|[Oo]verture|[Ss]onata|[Ss]ymphony|[Cc]oncerto|[Tt]heme)\s+(?:plays?|playing|swells?|performs?)\b|\b(?:piano|orchestra|violin|ensemble|guitar|choir|band)\b[^.;\n]{0,45}\b(?:performs?|plays?|sings?)\b[^.;\n]{0,90}\b(?:overture|sonata|symphony|concerto|theme|march|[A-Z][\p{L}'’-]*\s+[A-Z][\p{L}'’-]*)\b/u;

function visualAudioSubject(direction: string) {
  const performanceDirection = direction.replace(/\bwithout\s+(?:playing|singing|speaking|vocalizing)\b/gi, "");
  const explicitAudiblePerformance = /\b(?:audible|hear|heard|soundtrack|plays?|playing|swells?|sings?|singing|chants?|chanting|narrat(?:e|es|ed|ing|ion)|whisper(?:s|ed|ing)?|beatbox(?:er|ers|es|ed|ing)?|imitat(?:e|es|ed|ing|ion)|impersonat(?:e|es|ed|ing|ion))\b/i.test(performanceDirection) || SYNTHETIC_NAMED_NARRATION.test(performanceDirection);
  if (/\b(?:brand|authorial|editorial|narrative|written|creative)\s+voice\b|\bvoice\s+of\s+(?:the\s+)?(?:brand|customer|community|product)\b/i.test(direction) && !explicitAudiblePerformance) return true;
  if (/\b(?:tone\s+of\s+voice|voice\s+and\s+tone)\b/i.test(direction) && /\b(?:brand|campaign|written|editorial|marketing|copy|creative)\b/i.test(direction) && !explicitAudiblePerformance) return true;
  if (/\b(?:wind|breeze|rigging|engine|motor|machinery|ventilation|generator)\b[^.;\n]{0,70}\b(?:whistl(?:e|es|ed|ing)|hums?|humming)\b/i.test(direction) && !/\b(?:music|melod(?:y|ic)|songs?|person|singer|voice|vocal|lyrics?)\b/i.test(direction)) return true;
  if (/\b(?:visual|editing|editorial|compositional|typographic)\s+(?:rhythm|beats?)\b/i.test(direction) && !explicitAudiblePerformance) return true;
  const namedWorkMatch = direction.match(NAMED_MUSICAL_TITLE);
  const namedWork = namedWorkMatch?.[0] ?? "";
  const audioEvidence = explicitAudiblePerformance || /\b(?:music|songs?|voices?|vocals?|lyrics?|riffs?|jingles?)\b/i.test(direction);
  const visualSuffix = namedWorkMatch ? direction.slice((namedWorkMatch.index ?? 0) + namedWork.length).replace(/^[\s,.;:—-]+/, "") : "";
  const visualRole = /^(?:Captain|Princess|Prince|Queen|King|Lady|Lord|Commander|Doctor|Professor|General|Sir|Dame|Admiral)\s/u.test(namedWork);
  const visualObject = /\b(?:fleet|armada|ships?|sails?|shields?|spells?|scar(?:f|ves)|wardrobe|garments?|coats?|jackets?|hats?|tattoos?|silk|fabrics?|dresses?|cameras?|frames?|storyboards?|manuscripts?|tomes?|armor|maps?|books?|lanterns?|swords?|runes?|ribbons?|crowns?|compass(?:es)?|portraits?|paintings?|artworks?|illustrations?|sketches?|landscapes?|harbors?|views?)\b/i.test(namedWork);
  if (namedWork && (visualRole || visualObject || visualSuffix && /\b(?:protects?|advances?|forms?|unfurls?|catches?|lights?|gleams?|points?|hangs?|cross(?:es|ing)?|wears?|holds?|stands?|moves?|appears?|glows?|shines?|rests?|walks?|runs?|looks?)\b/i.test(visualSuffix)) && !audioEvidence) return true;
  if (/\b(?:in silence|silent(?:ly)?|without (?:playing|singing|speaking|vocalizing)|frozen in silence)\b/i.test(direction) && !explicitAudiblePerformance) return true;
  if (/\b(?:speech therapist|vocal coach|musical instrument (?:store|shop)|music (?:store|shop)|melody[\s-]+shaped tattoo|score(?:board)?\b[^.;\n]{0,30}\b\d+\s*[-–:]\s*\d+)\b/i.test(direction) && !/\b(?:audible|hear|heard|soundtrack|plays?|playing|swells?|sings?|singing)\b/i.test(direction)) return true;
  if (/\b(?:printed|visible|visibly|displayed|written)\b[^.;\n]{0,90}\b(?:lyrics?|music|score|voices?|narration|jingles?|riffs?)\b/i.test(direction) && !explicitAudiblePerformance) return true;
  const audible = explicitAudiblePerformance || /\b(?:voices?|vocals?|lyrics?|copyrighted|licensed|accompanied by|underscored by|orchestral(?:\s+(?:score|theme|music))?)\b/i.test(direction) || COPYRIGHT_RISK_AUDIO.test(direction) || NAMED_MUSICAL_PERFORMANCE.test(direction);
  if (/\b(?:scoreboard|sports score|game score|match score|sheet music|music notation|printed score|music hall|music shop|audio cassette|audio equipment|audio cable|vintage audio)\b/i.test(direction) && !audible) return true;
  return /\b(?:visual|visible|visibly|show|shows|showing|display|displays|displayed|depict|depicts|depicted|printed|written|poster|sign|lettering|typography|manuscript)\b/i.test(direction)
    && !audible;
}

function audioFactDirection(fact: CreativeRecord) {
  const properties = record(fact.properties);
  return audioPolicyText(properties.text ?? properties.instruction ?? properties.description ?? properties.value ?? properties.label);
}

const stripAudioNegations = (direction: string) => direction.replace(NEGATED_AUDIO, "").replace(AUDIO_PROHIBITION, "").replace(MUSIC_FREE, "").replace(NONMUSICAL, "");

function requiresGeneratedAudio(direction: string) {
  if (AUDIO_PROHIBITION.test(direction) || visualAudioSubject(direction)) return false;
  const cleaned = stripAudioNegations(direction);
  const cannotBeSilent = /\b(?:cannot|can't|must not|may not)\s+(?:be\s+)?silent\b/i.test(cleaned);
  if (cannotBeSilent) return true;
  if (/\b(?:silent|silence|silently)\b/i.test(cleaned)) return false;
  if (/\b(?:audio|sound(?:\s+effects?)?|music|musical scoring|score|soundtrack|melod(?:y|ies)|songs?|lyrics?|vocals?|voice(?:s|over)?|dialogue|speech)\b[^.;\n]{0,32}\b(?:must|should|may|will|can)\s+(?:not|never)\b/i.test(cleaned)) return false;
  if (/\b(?:orchestral|recognizable|copyrighted|licensed|musical)\b[^.;\n]{0,70}\b(?:theme|score|music|song|melody|composition|track)\b[^.;\n]{0,70}\b(?:must|requires?|required|mandatory|essential|plays?|be\s+played)\b|\b(?:must|requires?|required|mandatory|essential)\b[^.;\n]{0,70}\b(?:orchestral|recognizable|copyrighted|licensed|musical)\b[^.;\n]{0,70}\b(?:theme|score|music|song|melody|composition|track)\b/i.test(cleaned)) return true;
  return REQUIRED_AUDIO_DIRECTION.test(cleaned);
}

function forbidsGeneratedAudio(snapshot: CreativeRecord = {}) {
  const prohibitsAllSound = (value: string) => /\b(?:must|requires?|required|essential|needs?)\b[^.;\n]{0,90}\b(?:silent|silence)\b|\b(?:silent|silence)\b[^.;\n]{0,90}\b(?:must|requires?|required|essential|needs?)\b|\b(?:no|without|forbid(?:den)?|prohibit(?:ed)?|exclude|excluding)\s+(?:(?:all|any|generated|audible|background|recorded)\s+){0,4}(?:audio|sound(?:\s+effects?)?)\b|\b(?:audio|sound(?:\s+effects?)?)\s+(?:must|should|may|will|can)\s+(?:not|never|be\s+(?:off|disabled|absent))\b|\b(?:do|does|did|must|should|may|will|can)\s+(?:not|never)\s+(?:have|include|contain|use|generate|play|feature|add|create)\s+(?:(?:all|any|generated|audible|background|recorded)\s+){0,4}(?:audio|sound(?:\s+effects?)?)\b|\b(?:audio|sound)[-\s]+free\b|\b(?:audio|sound(?:\s+design)?)\s*:\s*(?:silent|silence|off|disabled|absent)\b|\b(?:audio|sound)\s+(?:off|disabled|absent)\b/i.test(value);
  if (activeVideoAudioPolicyFacts(snapshot).some((fact) => {
    if (text(fact.type ?? fact.role, 80).toLowerCase() === "typography") return false;
    const direction = audioFactDirection(fact);
    if (visualAudioSubject(direction) && /\b(?:poster|sign|lettering|typography|printed|written|manuscript|labels?|display(?:ed|s)?|reads?)\b/i.test(direction)) return false;
    const explicitAudioFact = AUDIO_FACT.test(text(fact.type ?? fact.role, 80));
    return prohibitsAllSound(direction) || explicitAudioFact && /\b(?:silent|silence)\b/i.test(direction) || factIsNegative(fact) && /\b(?:audio|sound(?:\s+effects?)?)\b/i.test(direction);
  })) return true;
  return (Array.isArray(snapshot.standing_constraints) ? snapshot.standing_constraints.map(record) : []).some((constraint) => {
    const direction = audioPolicyText(constraint.value ?? constraint.text);
    if (visualAudioSubject(direction) && /\b(?:poster|sign|lettering|typography|printed|written|manuscript|labels?|display(?:ed|s)?|reads?)\b/i.test(direction)) return false;
    const explicitAudioAxis = /\b(?:audio|sound)\b/i.test(text(constraint.axis, 80));
    return prohibitsAllSound(direction) || explicitAudioAxis && /\b(?:silent|silence)\b/i.test(direction) || /^(?:forbid|prohibit|avoid)$/i.test(String(constraint.polarity ?? "")) && (/\b(?:all|any|generated)\s+(?:audible\s+)?(?:audio|sound(?:\s+effects?)?)\b/i.test(direction) || explicitAudioAxis && /\b(?:audio|sound|silent|silence)\b/i.test(direction) && !/\b(?:music|songs?|soundtrack|score|voices?|vocals?|dialogue)\b/i.test(direction));
  });
}

export function unsupportedAudioIntent(direction: string) {
  // Inspect coordinated prohibitions and contrast clauses independently. A
  // restriction followed by "but imitate this voice" is not a blanket waiver.
  return direction.split(/[.!?]\s+|;\s*|\s+(?=(?:but|however|except|instead|yet)\b)/iu).some((sentence) => {
    const clause = sentence.trim().replace(/\b(?:do not|never)\s+read\s+(?:the\s+)?(?:captions?|transcripts?)(?:\s+or\s+(?:captions?|transcripts?))?(?:\s+for\s+(?:spoken|voiced)\s+media)?\s+(?:aloud|out loud|audibly)\b/giu, "");
    const beginsNegative = /^(?:no|without|exclude|excluding|never include|do not (?:include|portray|promise|claim|imply))\b/iu.test(clause);
    const spokenDelivery = /\bread(?:s|ing)?\b[^.;\n]{0,150}\b(?:aloud|out loud|audibly)\b/iu.test(clause);
    const audiblePerformance = spokenDelivery || /\b(?:play(?:s|ing)?|sing(?:s|ing)?|sung|speak(?:s|ing)?|spoken aloud|narrat(?:e|es|ing)|imitat(?:e|es|ing)|impersonat(?:e|es|ing)|chant(?:s|ing)?|whisper(?:s|ing)?|perform(?:s|ing)?|recreat(?:e|es|ing)|accompan(?:y|ies|ying)|underscor(?:e|es|ing)|swells?|recit(?:e|es|ing))\b/iu.test(clause);
    const supplementaryDirection = /\b(?:while|when|as|with|alongside|accompanied|underscored|featuring|plus)\b/iu.test(clause);
    const positiveAfterNegative = /(?:,\s*|\b(?:and|or)\s+)(?:add|include|play|generate|imitate|use|speak|narrate|compose|sing|whisper|perform|recreate)\b/iu.test(clause)
      || beginsNegative && /\b(?:shall|will|must|should|needs?|requires?)\s+(?!not\b|never\b)/iu.test(clause);
    if (beginsNegative && !positiveAfterNegative && !audiblePerformance && !supplementaryDirection) return false;
    if (spokenDelivery) return true;
    let cleaned = (positiveAfterNegative ? clause : stripAudioNegations(clause))
      .replace(/\b(?:no|without|avoid|never)\s+(?:(?:recognizable|copyrighted|licensed)\s+)?(?:melody|music)(?:\s+or\s+(?:artist|voice|style)\s+imitation)\b/giu, "");
    if (!audiblePerformance) cleaned = cleaned
      .replace(/\bscore\s+(?:numbers?|values?|ratings?|percentages?)\b/giu, "evaluation values")
      .replace(/\b(?:captions?|transcripts?)(?:\s+or\s+(?:captions?|transcripts?))?\s+for\s+(?:spoken|voiced)\s+media\b/giu, "conditional accessibility text");
    if (!cleaned.trim() || visualAudioSubject(cleaned)) return false;
    return UNSUPPORTED_AUDIO.test(cleaned) || COPYRIGHT_RISK_AUDIO.test(cleaned) || NAMED_SONG_PLAYBACK.test(cleaned) || NAMED_MUSICAL_ATTRIBUTION.test(cleaned) || NAMED_MUSICAL_TITLE.test(cleaned) || NAMED_MUSICAL_PERFORMANCE.test(cleaned) || SYNTHETIC_NAMED_NARRATION.test(cleaned);
  });
}

const factIsNegative = (fact: CreativeRecord) => {
  const properties = record(fact.properties);
  return [fact.intent, fact.effect, properties.intent].some((value) => /^(?:avoid|prohibit|must_not_include)$/i.test(String(value ?? ""))) || String(fact.type ?? "") === "exclusion";
};

function videoAdaptationFailure(code: string, message: string, prompt: string | null = null): never {
  throw new ProviderRequestError({ code, category: "provider", scope: "request", action: "edit_request", message, retryable: false, retryAfterMs: null, requestId: null, httpStatus: 400 }, prompt);
}

function authoredAudioFacts(snapshot: CreativeRecord = {}) {
  const affirmativeAudioPreferences: CreativeRecord[] = (Array.isArray(snapshot.standing_constraints) ? snapshot.standing_constraints.map(record) : []).filter((constraint) => /^(?:affirm|include|required)$/i.test(String(constraint.polarity ?? ""))).filter((constraint) => { const direction = audioPolicyText(constraint.value ?? constraint.text); return AUDIO_FACT.test(direction) || requiresGeneratedAudio(direction) || /\b(?:audio|sound|music|score|soundtrack|voice)\b/i.test(text(constraint.axis, 80)); }).map((constraint) => ({ type: "audio", properties: { text: audioPolicyText(constraint.value ?? constraint.text), required: true } }));
  return [...activeVideoAudioPolicyFacts(snapshot), ...affirmativeAudioPreferences].filter((fact) => {
    if (factIsNegative(fact)) return false;
    const properties = record(fact.properties);
    const type = text(fact.type ?? fact.role, 80).toLowerCase();
    // A reusable soundtrack has independent influence, attachment, and transfer
    // decisions; describing it never requests provider-generated ambience.
    if (type === "audio" && properties.inform_generation === true && properties.required !== true) return false;
    if (type === "audio" && properties.inform_generation === false && fact.locked !== true && properties.locked !== true && properties.required !== true) return false;
    const direction = audioFactDirection(fact);
    return AUDIO_FACT.test(text(fact.type, 80)) || AUDIO_FACT.test(text(fact.role, 80))
      || AUDIO_FACT.test(text(properties.subtype, 120)) || AUDIO_FACT.test(text(properties.audio_mode, 80))
      || AUDIO_BEARING_FACT_TYPES.has(type) && (requiresGeneratedAudio(direction) || /(?:^|[.;]\s*)(?:audio|soundtrack|music|sound design|voiceover|dialogue)\s*[:—-]/i.test(direction));
  });
}

export function resolveVideoAudioPolicy(options: { snapshot?: CreativeRecord; audioMode?: unknown; generateAudio?: unknown; providedSoundtrack?: boolean } = {}): VideoAudioPolicy {
  if (options.audioMode !== undefined && !isVideoAudioMode(options.audioMode)) {
    videoAdaptationFailure("video_audio_mode_unsupported", "Choose silent video or explicitly opt in to original, non-musical ambient sound.");
  }
  if (options.generateAudio !== undefined && typeof options.generateAudio !== "boolean") {
    videoAdaptationFailure("video_audio_option_invalid", "The video audio setting must be an explicit boolean.");
  }
  if (options.audioMode === "silent" && options.generateAudio === true || options.audioMode === "original_ambient" && options.generateAudio === false) {
    videoAdaptationFailure("video_audio_settings_conflict", "The requested audio mode conflicts with the provider audio-generation setting.");
  }

  const requestedMode: VideoAudioMode = options.audioMode === "original_ambient" || options.generateAudio === true ? "original_ambient" : "silent";
  const audioFacts = authoredAudioFacts(options.snapshot);
  const required = audioFacts.filter((fact) => {
    const properties = record(fact.properties);
    const direction=audioFactDirection(fact);
    const negativeDirection = AUDIO_PROHIBITION.test(direction) || direction.replace(NEGATED_AUDIO, "") !== direction || MUSIC_FREE.test(direction) || /\b(?:audio|sound)[-\s]+free\b|\b(?:audio|sound)\s*:?\s*(?:off|disabled|absent)\b/i.test(direction);
    return (fact.locked === true || properties.required === true) && !negativeDirection && !visualAudioSubject(direction) && !/\b(?:silent|silence|silently)\b/i.test(direction) || requiresGeneratedAudio(direction);
  });

  if (required.length && requestedMode === "silent" && !options.providedSoundtrack) {
    videoAdaptationFailure("video_audio_required", "This document explicitly requires sound, but video renders are silent by default. Choose original ambient sound or revise the authored audio requirement before starting a paid render.");
  }
  if (options.providedSoundtrack && forbidsGeneratedAudio(options.snapshot)) {
    videoAdaptationFailure("video_audio_forbidden", "This document explicitly requires a silent result. Remove the selected soundtrack or revise the protected audio restriction before starting a paid render.");
  }
  if (requestedMode === "original_ambient" && forbidsGeneratedAudio(options.snapshot)) {
    videoAdaptationFailure("video_audio_forbidden", "This document explicitly requires a silent result or forbids generated audio. Keep the video silent or revise the authored restriction before starting a paid render.");
  }
  if (requestedMode === "original_ambient" && audioFacts.some((fact) => unsupportedAudioIntent(audioFactDirection(fact)))) {
    videoAdaptationFailure("video_audio_profile_unsupported", "Original ambient sound supports newly generated, non-musical environmental effects only. Authored music, orchestral scores, recognizable melodies, songs, lyrics, dialogue, and imitated voices require a separately rights-cleared workflow.");
  }

  return {
    requestedMode,
    effectiveMode: requestedMode,
    generateAudio: requestedMode === "original_ambient",
    explicitlyRequested: options.audioMode === "original_ambient" || options.generateAudio === true,
    authoredRequirement: required.length ? "required" : audioFacts.length ? "optional" : "none",
    residualRisk: requestedMode === "original_ambient" ? "provider-output-review" : "none",
    rationale: requestedMode === "original_ambient"
      ? "The user explicitly selected original, non-musical environmental ambience; the downstream provider still reviews generated output."
      : "Sound was not explicitly requested. Silent video preserves authored visual intent and avoids unrequested soundtrack-generation risk.",
  };
}

function removeAudioDirections(value: string) {
  const removed: string[] = [];
  let cleaned = value.replace(/[([]\s*(?:audio|soundtrack|music|score|song|sound design|voiceover|dialogue)\s*[:—-]\s*([^\])]+)[\])]/gi, (_match: string, direction: string) => {
    removed.push(text(direction, 700));
    return "";
  }).replace(AUDIO_HEADING, (match: string, direction: string) => {
    if (/^\s*\d+\s*[-–:]\s*\d+\b/.test(direction)) return match;
    const explicitVisual = direction.search(/(?:^|[.;]\s+)(?:visual|subject|action|camera|environment|lighting|shot|beat)\s*[:—-]/i);
    const nextSentence = direction.search(/[.!?]\s+(?=[A-Z][\p{L}])/u);
    const nextVisual = explicitVisual >= 0 && nextSentence >= 0 ? Math.min(explicitVisual, nextSentence) : Math.max(explicitVisual, nextSentence);
    if (nextVisual < 0) {
      const continuation = [...direction.matchAll(/\b(?:as|while)\s+(.+)/gi)].find((candidate) => candidate[1] && !unsupportedAudioIntent(candidate[1]));
      if (continuation && continuation.index !== undefined) {
        removed.push(text(direction.slice(0, continuation.index), 700));
        return continuation[1]!.trim();
      }
    }
    const audio = nextVisual >= 0 ? direction.slice(0, nextVisual) : direction;
    removed.push(text(audio, 700));
    return nextVisual >= 0 ? direction.slice(nextVisual).replace(/^[.!?;]\s*/, "") : "";
  });
  cleaned = cleaned.replace(/(?:^|[.;]\s+)(?:audio|soundtrack|music|score|song|sound design)\s*[:—-]\s*([^\n.;]+)(?=[\n.;]|$)/gi, (match: string, direction: string) => {
    if (/^\s*\d+\s*[-–:]\s*\d+\b/.test(direction)) return match;
    removed.push(text(direction, 700));
    return match.startsWith(".") ? "." : "";
  });
  cleaned = cleaned.replace(/\b(?:while|as|with|accompanied by|underscored by|set to)\s+(?:(?:an?|the|original|rising|low|swelling|dramatic|cinematic|recognizable)\s+){0,4}(?:orchestral(?:\s+(?:score|pulses?|lift|music))?|soundtrack|music|score|song|melody|vocals?|lyrics?|dialogue|voiceover)(?:\s+(?:swells?|builds?|rises?|plays?|pulses?|crescendos?|fades?|underscores?|accompanies?)){0,2}/gi, (direction: string, offset: number, source: string) => {
    if (/^\s+(?:notation|notes|marks?|printed|etched|painted|sheet|written|visible|visibly|in her hands|in his hands)\b/i.test(source.slice(offset + direction.length))) return direction;
    removed.push(text(direction, 700));
    return "";
  });
  cleaned = cleaned.replace(/(?:^|(?<=[.!?]\s))(?:(?:an?|the|original|rising|low|swelling|dramatic|cinematic|recognizable)\s+){0,3}(?:orchestral(?:\s+(?:score|pulses?|lift|music))?|soundtrack|music|musical scoring|song|melody|vocals?|lyrics?|dialogue|voiceover)\s+(?:swells?|builds?|rises?|plays?|pulses?|crescendos?|fades?|underscores?|accompanies?|fills?)[^.!?\n]*[.!?]?/gim, (direction: string) => {
    const continuationMatch = direction.match(/(?:,\s*|\s+)((?:revealing|showing|as|while|and)\s+.+)$/i);
    const continuation = continuationMatch?.[1];
    removed.push(text(continuation ? direction.slice(0, continuationMatch!.index) : direction, 700));
    return continuation ? continuation.replace(/^and\s+/i, "") : "";
  });
  return { text: cleaned.replace(/\n{3,}/g, "\n\n").trim(), removed };
}

export function videoStoryboardBeats(snapshot: CreativeRecord = {}, references: VideoReference[] = []): VideoStoryboardBeat[] {
  const beats = activeFacts(snapshot).flatMap((fact) => {
    const properties = record(fact.properties);
    const sequence = Number(properties.storyboard_frame_index ?? properties.storyboard_sequence ?? properties.video_scene_index ?? properties.narrative_order ?? 0);
    if (!Number.isSafeInteger(sequence) || sequence < 1) return [];
    return [{
      sequence,
      storyboardTitle: text(properties.storyboard_title ?? properties.video_title ?? properties.reference_set_id ?? properties.context_set_root_id, 180),
      storyboardGroupId: text(properties.source_artifact_id ?? properties.reference_set_id ?? properties.context_set_id ?? properties.context_set_root_id ?? properties.storyboard_title ?? properties.video_title, 180),
      title: text(properties.storyboard_shot_title ?? properties.video_scene_title ?? properties.label ?? `Shot ${sequence}`, 140),
      direction: text(properties.storyboard_shot_direction ?? properties.video_scene_direction ?? properties.text ?? "", 750),
      cameraDirection: text(properties.storyboard_camera_direction ?? properties.video_scene_camera_direction, 240),
      framePrompt: text(properties.storyboard_frame_prompt ?? properties.video_scene_frame_prompt, 1_200),
      blockId: text(fact.block_id, 120) || null,
    }];
  });

  const authoredBlockIds = new Set(beats.map((beat) => beat.blockId).filter(Boolean));
  const fallback = references.flatMap((reference) => reference.sequence && reference.sequence > 0 && !authoredBlockIds.has(reference.blockId) ? [{
    sequence: reference.sequence,
    storyboardTitle: text(reference.storyboardTitle, 180),
    storyboardGroupId: text(reference.sourceArtifactId ?? reference.storyboardTitle, 180),
    title: text(reference.label || `Shot ${reference.sequence}`, 140),
    direction: text(reference.shotDirection, 750),
    cameraDirection: text(reference.cameraDirection, 240),
    framePrompt: text(reference.framePrompt, 1_200),
    blockId: reference.blockId || null,
  }] : []);

  const groupOrder = new Map<string, number>();
  for (const beat of [...beats, ...fallback]) if (!groupOrder.has(beat.storyboardGroupId)) groupOrder.set(beat.storyboardGroupId, groupOrder.size);
  const bySequence = new Map<string, VideoStoryboardBeat>();
  for (const beat of [...beats, ...fallback].sort((left, right) => (groupOrder.get(left.storyboardGroupId) ?? 0) - (groupOrder.get(right.storyboardGroupId) ?? 0) || left.sequence - right.sequence)) {
    const key = `${beat.storyboardGroupId}\u0000${beat.sequence}`;
    if (!bySequence.has(key)) bySequence.set(key, beat);
  }
  return [...bySequence.values()];
}

function parseAuthoredTimecodes(prompt: string, count: number, totalSeconds: number) {
  const ranges: Array<{ startsAtSeconds: number; endsAtSeconds: number }> = [];
  const clock = /(?:^|\s)(\d{1,2}):(\d{2}(?:\.\d+)?)\s*(?:–|—|-|to)\s*(?:(\d{1,2}):)?(\d{2}(?:\.\d+)?)/g;
  for (const match of prompt.matchAll(clock)) {
    const startsAtSeconds = Number(match[1]) * 60 + Number(match[2]);
    const endsAtSeconds = Number(match[3] ?? match[1]) * 60 + Number(match[4]);
    ranges.push({ startsAtSeconds, endsAtSeconds });
  }
  if (ranges.length < count) {
    const decimal = /(?:^|\s)(\d+(?:\.\d+)?)\s*(?:s(?:ec(?:onds?)?)?)?\s*(?:–|—|-|to)\s*(\d+(?:\.\d+)?)\s*s(?:ec(?:onds?)?)?/gi;
    for (const match of prompt.matchAll(decimal)) ranges.push({ startsAtSeconds: Number(match[1]), endsAtSeconds: Number(match[2]) });
  }

  const chosen = ranges.slice(0, count);
  if (chosen.length !== count || Math.abs(chosen[0]!.startsAtSeconds) > .05 || Math.abs(chosen.at(-1)!.endsAtSeconds - totalSeconds) > .05) return null;
  if (chosen.some((range, index) => range.endsAtSeconds <= range.startsAtSeconds || index > 0 && Math.abs(range.startsAtSeconds - chosen[index - 1]!.endsAtSeconds) > .05)) return null;
  return chosen;
}

function referenceToken(model: string, index: number) {
  return model === "bytedance/seedance-2.0/reference-to-video" || model === "bytedance/seedance-2.5/reference-to-video" ? `@Image${index + 1}` : `<IMAGE_REF_${index}>`;
}

function referenceModeDirection(mode: string) {
  if (mode === "preserve_composition") return "COMPOSITION ONLY: preserve framing, geometry, balance, depth, and camera placement; all subjects, wardrobe, action, and story come from the authored visual direction.";
  if (mode === "preserve_subject") return "SUBJECT ONLY: preserve the authorized principal subject's recognizable appearance and defining form; composition, environment, and treatment follow authored direction.";
  if (mode === "preserve_style") return "STYLE ONLY: preserve visual treatment, material language, texture, and color behavior; subject, action, setting, and framing follow authored direction.";
  return "INSPIRATION ONLY: use broad visual rhythm and atmosphere while the authored subject, action, setting, and composition remain authoritative.";
}

function groupBoundary(reference: VideoReference) {
  return (reference.contextGroups ?? []).map((group) => `Combined Context “${text(group.name, 120)}” applies this image only to ${text(group.role, 60).replaceAll("_", " ")} “${text(group.target, 160)}” at ${Math.round(Math.max(0, Math.min(1, group.relativity)) * 100)}% relativity; ${text(group.application, 80).replaceAll("_", " ")}.`).join(" ");
}

function sourceFactDirective(snapshot: CreativeRecord = {}) {
  const negative = partitionContextAdaptationFactScopes(activeFacts(snapshot).filter(factIsNegative));
  const hardDecisions = new Map(requiredContextAdaptationFacts(snapshot).map((decision) => [decision.fact, decision]));
  const negativeDirection = (fact: CreativeRecord) => {
    const required = hardDecisions.get(fact);
    if (required && !required.direction) videoAdaptationFailure("video_required_context_unrepresentable", `The locked ${required.type} exclusion${required.blockId ? ` ${required.blockId}` : ""} has no provider-safe representable authorial value.`);
    if (required) return required.direction;
    const properties = record(fact.properties);
    const values = [properties.text ?? properties.instruction ?? properties.description ?? properties.value ?? properties.label, ...(Array.isArray(properties.colors) ? properties.colors : [])];
    return [...new Set(values.map((value) => text(value, 320)).filter(Boolean))].join(" · ");
  };
  const excluded = [
    ...negative.global.map(negativeDirection),
    ...(Array.isArray(snapshot.standing_constraints) ? snapshot.standing_constraints.map(record).filter((constraint) => /^(?:avoid|prohibit|forbid)$/i.test(String(constraint.polarity ?? ""))).map((constraint) => text(constraint.value ?? constraint.text, 320)) : []),
  ].filter(Boolean);
  const scopedExcluded = negative.scoped.flatMap(({ fact, memberships }) => memberships.map((membership) => ({
    direction: negativeDirection(fact),
    role: membership.role,
    target: membership.target,
  }))).filter((exclusion) => exclusion.direction);
  const emphasis = activeFacts(snapshot).filter((fact) => !factIsNegative(fact) && ["direction", "message", "emotion", "subject", "environment", "action", "audience", "lighting", "palette", "style", "material", "camera", "composition", "scale", "location", "wardrobe", "object", "prop"].includes(String(fact.type ?? fact.role ?? ""))).flatMap((fact) => {
    const properties = record(fact.properties);
    const authored = [properties.text ?? properties.instruction ?? properties.description ?? properties.value ?? properties.label, ...(Array.isArray(properties.colors) ? properties.colors : []), ...(Array.isArray(properties.palette) ? properties.palette : properties.palette ? [properties.palette] : []), ...(Array.isArray(properties.materials) ? properties.materials : properties.materials ? [properties.materials] : []), properties.lighting, properties.camera_direction, properties.lens];
    const direction = text(removeAudioDirections([...new Set(authored.map((value) => text(value, 320)).filter(Boolean))].join(" · ")).text, 360);
    if (!direction) return [];
    const prefix = text(fact.type ?? fact.role, 60).toUpperCase();
    const memberships = combinedContextMemberships(properties);
    return memberships.length ? memberships.map((membership) => `${prefix} for ${membership.role.replaceAll("_", " ")} “${text(membership.target, 160)}”: ${direction}`) : [`${prefix}: ${direction}`];
  });
  const affirmed = Array.isArray(snapshot.standing_constraints) ? snapshot.standing_constraints.map(record).filter((constraint) => /^(?:affirm|include|required)$/i.test(String(constraint.polarity ?? ""))).map((constraint) => `${text(constraint.axis ?? "direction", 55).toUpperCase()}: ${text(constraint.value ?? constraint.text, 520)}`).filter(Boolean) : [];
  return { excluded: [...new Set(excluded)], scopedExcluded, emphasis: [...new Set(emphasis)], affirmed: [...new Set(affirmed)] };
}

function salientFrameAnchor(frame: string, direction: string, camera: string) {
  const clauses = frame.split(/[.;]\s+|,\s+(?=[A-Za-z])/).map((clause) => clause.trim()).filter(Boolean);
  if (clauses.length < 2) return text(frame, 190);
  const existing = `${direction} ${camera}`.toLocaleLowerCase();
  const scored = clauses.map((clause, index) => {
    const matches = [...clause.matchAll(/\b(?:never|must|protect(?:ive)?|defen(?:se|sive)|destruct(?:ive)?|runes?|spell|shield|tome|book|map|tattoo|scarf|left|right|hands?|arms?|open|amber|exact|only|under|spiral(?:ing)?)\b/gi)].length;
    const words = clause.toLocaleLowerCase().split(/\W+/).filter((word) => word.length > 3);
    const novel = words.filter((word) => !existing.includes(word)).length;
    return { clause, index, score: matches * 7 + novel + index * .2 - (/^cinematic\s+(?:adult\s+)?fantasy\s+storyboard/i.test(clause) ? 12 : 0) };
  }).sort((left, right) => right.score - left.score).slice(0, 2).sort((left, right) => left.index - right.index);
  return text(scored.map((item) => item.clause).join("; "), 190);
}

function groupedMemberDirection(snapshot: CreativeRecord, member: { blockId: string; label: string }) {
  const fact = activeFacts(snapshot).find((candidate) => String(candidate.block_id ?? "") === member.blockId);
  const properties = record(fact?.properties);
  const storyboardFrame = Number(properties.storyboard_frame_index ?? 0) > 0;
  const storyboardRoot = properties.source_artifact_kind === "storyboard" || properties.reference_set_kind === "storyboard";
  const label = storyboardFrame ? properties.storyboard_shot_title ?? properties.label ?? member.label : storyboardRoot ? properties.label ?? member.label : member.label;
  const colors = Array.isArray(properties.colors) ? properties.colors.map((value) => text(value, 35)).filter(Boolean) : [];
  return [...new Set([removeAudioDirections(text(label, 240)).text, ...colors])].filter(Boolean).join(" · ");
}

const PRODUCT_RESEARCH_OPERATIONAL_DIRECTION = /\b(?:provider(?:\s+(?:charge|charges|submission|request|failure|status))?|paid\s+generation|payment\s+settlement|private\s+identifiers?|reference\s+pixels?|(?:failed|failure)\s+(?:original\s+)?(?:slideshow|request|delivery|generation)|(?:slideshow|request|generation|delivery)\s+(?:failed|failure))\b/i;
const NONVISUAL_PRODUCT_RESEARCH_BOUNDARY = /\b(?:provider|paid|payment|settlement|charge|charges|private\s+identifiers?|reference\s+pixels?|failed|failure|request|submission|conceal|invent\s+metrics|human\s+review|(?:claim|completed|demonstrated)\b|P[012]\b)\b/i;

type ProductResearchVisualProjection = {
  motion: string;
  emphasis: string[];
  continuity: string;
  anonymousInterfaces: boolean;
  truthfulScores: boolean;
  protectedExclusions: Set<string>;
};

function productResearchVisualProjection(snapshot: CreativeRecord, options: VideoPromptOptions, prompt: string): ProductResearchVisualProjection | null {
  if (options.references.length || options.productionContinuity || options.providedSoundtrack || options.generateAudio === true || options.audioMode && options.audioMode !== "silent") return null;
  const facts = activeFacts(snapshot);
  const authored = facts.flatMap((fact) => {
    const properties = record(fact.properties);
    return [properties.text, properties.instruction, properties.description, properties.value, properties.label].filter((value): value is string => typeof value === "string");
  });
  const source = [text(record(snapshot.document).title, 200), ...authored].join("\n");
  if (!/\b(?:feedback|end[-\s]user|ux|research|readout|review|scorecard)\b/i.test(source)
    || !/\b(?:product|workflow|slideshow|storyboard|creative\s+context|generation)\b/i.test(source)
    || !PRODUCT_RESEARCH_OPERATIONAL_DIRECTION.test(source)) return null;

  const directions = `${source}\n${prompt}`;
  const formats = [...new Set([...directions.matchAll(/\.(?:doc|ppt|mov|mp3|psd)\b/gi)].map((match) => match[0].toLowerCase()))];
  const scores = [...new Set([...directions.matchAll(/\b(?:10|[0-9])\s*\/\s*10\b/g)].map((match) => match[0].replace(/\s+/g, "")))].slice(0, 3);
  const tagline = directions.match(/Your content\.\s*One context\.\s*Infinite paths to your target\./i)?.[0].replace(/\s+/g, " ") ?? "";
  if (!/\bForma\b/i.test(source)
    || !/\b(?:one|single|shared|living|reusable)[-\s]+(?:(?:living|shared|creative)[-\s]+)?context\b/i.test(source)
    || formats.length < 2 && !tagline) return null;
  const visualFormatEvidence = formats.length ? ` Authored legacy-format tiles: ${formats.join(", ")}.` : "";
  const visualScoreEvidence = scores.length ? ` The only authored scorecard values are ${scores.join(", ")}.` : "";
  const visualTagline = tagline ? ` Preserve the exact authored tagline: ${tagline}` : "";
  const motion = `Create an abstract, high-contrast editorial product visualization: scattered creative-format tiles converge into one shared living context; a progress path briefly pauses to make real workflow friction visible, then clear delivery paths branch toward the storyteller and the recipient.${visualFormatEvidence}${visualScoreEvidence}${visualTagline}`;
  const protectedExclusions = new Set(requiredContextAdaptationFacts(snapshot).filter((decision) => factIsNegative(decision.fact)).map((decision) => decision.direction).filter(Boolean));
  return {
    motion,
    emphasis: [
      "DIRECTION: Visually connect fractured creative formats, one reusable context, an honest interrupted workflow, practical experience improvements, and audience-led delivery.",
      "AUDIENCE: Product teams, designers, engineers, founders, and end users evaluating a reusable creative workflow.",
      ...(formats.length ? [`LEGACY FORMAT SYMBOLS: ${formats.join(", ")}.`] : []),
      ...(scores.length ? [`AUTHORED SCORECARD VALUES: ${scores.join(", ")}; show no additional numerical claims.`] : []),
      ...(tagline ? [`EXACT AUTHORED TAGLINE: ${tagline}`] : []),
    ],
    continuity: "Keep one continuous visual progression: scattered format tiles converge into a shared context, an incomplete progress indicator briefly interrupts the path, and clear creator-led or recipient-led delivery branches emerge.",
    anonymousInterfaces: /\b(?:private\s+identifiers?|personal\s+(?:details|data|information)|identifiable\s+(?:people|persons?))\b/i.test(source),
    truthfulScores: /\b(?:invent\s+metrics|fake\s+(?:metrics|statistics|quotes)|invented\s+(?:numbers|claims))\b/i.test(source),
    protectedExclusions,
  };
}

function productResearchVisualBoundaries(direction: string, projection: ProductResearchVisualProjection) {
  if (projection.protectedExclusions.has(direction)) return [direction];
  return direction.split(/\s*(?:;|,|\.\s+)\s*/).map((clause) => clause.trim()).filter((clause) => clause && !NONVISUAL_PRODUCT_RESEARCH_BOUNDARY.test(clause));
}

function compactMotionThesis(prompt: string, snapshot: CreativeRecord = {}) {
  const lead = prompt.split(/\n+/).map((line) => line.trim()).find((line) => line && !/^\s*(?:shot|beat|\d+[.)]|\d+:\d+)/i.test(line)) ?? prompt;
  const title = text(record(snapshot.document).title, 160);
  return [title && `Creative world: ${title}.`, text(lead, 700)].filter(Boolean).join(" ");
}

/** Minimize repeated storyboard/provenance payloads before the one existing planner call. */
export function videoPlannerCreativeContext(snapshot: CreativeRecord) {
  const normalized = record(providerFacingRenderingContext(videoOutputScopedContext(snapshot).snapshot));
  const facts = Array.isArray(normalized.facts) ? normalized.facts.map(record) : [];
  const storyboardCount = facts.filter((fact) => Number(record(fact.properties).storyboard_frame_index ?? record(fact.properties).video_scene_index ?? 0) > 0).length;
  const safeProperties = (fact: CreativeRecord) => {
    const properties = record(fact.properties);
    const storyboardFrame = Number(properties.storyboard_frame_index ?? properties.video_scene_index ?? properties.narrative_order ?? 0) > 0;
    const values: CreativeRecord = {};
    const common = ["label", "subtype", "intent", "weight", "authority", "spatial_scope", "pixel_reference_mode", "source_artifact_kind", "exact_text", "colors", "palette", "image_format", "format", "aspect_ratio", "resolution", "safe_area", "accessibility", "contrast", "minimum_contrast", "font_family", "font_weight", "brand_name", "required", "motion", "camera", "camera_direction", "lens", "lighting", "materials"];
    for (const key of common) if (properties[key] !== undefined && properties[key] !== null && properties[key] !== "") values[key] = properties[key];
    if(fact.type==="audio"||fact.role==="audio"){
      for(const key of ["audio_role","mood","emotional_arc","narrative_purpose","instrumentation","texture","tempo_bpm","vocal_policy","transcript"] as const){
        const value=properties[key];
        if(value!==undefined&&value!==null&&value!=="")values[key]=typeof value==="string"?text(value,1_000):Array.isArray(value)?value.map((item)=>text(item,100)).slice(0,20):value;
      }
      if(Array.isArray(properties.audio_cues))values.audio_cues=properties.audio_cues.flatMap((value)=>{
        const cue=record(value);if(typeof cue.start_seconds!=="number")return[];
        return[{start_seconds:cue.start_seconds,...(typeof cue.end_seconds==="number"?{end_seconds:cue.end_seconds}:{}),target_kind:text(cue.target_kind,40),label:text(cue.label,120),emotional_intent:text(cue.emotional_intent,240)}];
      }).slice(0,24);
    }
    if (storyboardFrame) {
      for (const key of ["storyboard_frame_index", "storyboard_frame_count", "storyboard_title", "storyboard_shot_title", "storyboard_shot_direction", "storyboard_camera_direction", "storyboard_frame_prompt", "video_scene_index", "video_scene_count", "video_title", "video_scene_title", "video_scene_direction", "video_scene_camera_direction", "video_scene_frame_prompt", "narrative_order"] as const) {
        const value = properties[key];
        if (value === undefined || value === null || value === "") continue;
        values[key] = typeof value === "string" ? text(value, key === "storyboard_frame_prompt" || key === "video_scene_frame_prompt" ? 1_200 : key === "storyboard_shot_direction" || key === "video_scene_direction" ? 900 : 240) : value;
      }
    } else {
      for (const key of ["text", "instruction", "description", "value"] as const) {
        if (properties[key] !== undefined && properties[key] !== null && properties[key] !== "") values[key] = text(properties[key], storyboardCount && properties.source_artifact_kind === "storyboard" ? 1_200 : 2_000);
      }
    }
    return values;
  };

  return {
    facts: facts.map((fact) => ({
      decision_key: fact.decision_key,
      type: fact.type,
      role: fact.role,
      intent: fact.intent,
      active: fact.active,
      effect: fact.effect,
      authority: fact.authority,
      order: fact.order,
      ...(fact.locked ? { locked: true } : {}),
      properties: safeProperties(fact),
    })),
    ...(Array.isArray(normalized.relationships) && normalized.relationships.length ? { relationships: normalized.relationships.map(record).map((relation) => ({
      from_decision: relation.from_decision,
      to_decision: relation.to_decision,
      kind: relation.kind,
      ...(record(relation.properties).ordered === true ? { ordered: true } : {}),
    })) } : {}),
    ...(Array.isArray(normalized.standing_constraints) && normalized.standing_constraints.length ? { standing_constraints: normalized.standing_constraints } : {}),
    ...(Array.isArray(normalized.pins) && normalized.pins.length ? { pins: normalized.pins } : {}),
    ...(record(normalized.document).title ? { document: { title: text(record(normalized.document).title, 200) } } : {}),
  };
}

export function compactVideoCombinedContextPlan(groups: Array<Record<string, unknown>>) {
  return groups.map((group) => ({
    context_key: group.context_key,
    name: text(group.name, 140),
    role: text(group.role, 60),
    target: text(group.target, 180),
    application: text(group.application, 60),
    relativity: group.relativity,
    members: Array.isArray(group.members) ? group.members.map(record).map((member) => ({
      label: text(member.label, 180),
      role: member.role,
      relativity: member.relativity,
      order: member.order,
    })) : [],
    instruction: `Keep this group's members isolated to “${text(group.target, 180)}” in the same shots or ordered shot range; preserve their ${text(group.application, 60).replaceAll("_", " ")} authorial relationship.`,
  }));
}

/** Translate authored meaning into a short, provider-safe, auditable video contract. */
export function adaptVideoPrompt(prompt: string, options: VideoPromptOptions): VideoPromptAdaptation {
  const audio = resolveVideoAudioPolicy({ snapshot: options.snapshot, audioMode: options.audioMode, generateAudio: options.generateAudio, providedSoundtrack: options.providedSoundtrack });
  const sourceScope = videoOutputScopedContext(options.snapshot ?? {});
  prompt = applyVideoSourceInterpretations(prompt, sourceScope.interpretations);
  options = { ...options, snapshot: sourceScope.snapshot, ...(options.plan ? { plan: {
    ...options.plan,
    ...(options.plan.title ? { title: applyVideoSourceInterpretations(options.plan.title, sourceScope.interpretations) } : {}),
    ...(options.plan.summary ? { summary: applyVideoSourceInterpretations(options.plan.summary, sourceScope.interpretations) } : {}),
    ...(options.plan.items ? { items: options.plan.items.map((item) => ({ ...item, ...(item.body ? { body: applyVideoSourceInterpretations(item.body, sourceScope.interpretations) } : {}), ...(item.notes ? { notes: applyVideoSourceInterpretations(item.notes, sourceScope.interpretations) } : {}) })) } : {}),
  } } : {}) };
  const cleanedPrompt = removeAudioDirections(prompt);
  if (!cleanedPrompt.text) videoAdaptationFailure("video_prompt_required", "The document did not produce usable visual motion direction after soundtrack-only instructions were removed.", prompt);
  const authoredAudioChannels = [prompt, options.plan?.title, options.plan?.summary, ...(options.plan?.items ?? []).flatMap((item) => [item.notes, item.body]), ...activeFacts(options.snapshot).filter((fact) => !factIsNegative(fact) && !["typography","audio"].includes(String(fact.type ?? fact.role ?? ""))).flatMap((fact) => { const properties = record(fact.properties); return [audioFactDirection(fact), properties.storyboard_title, properties.storyboard_shot_title, properties.storyboard_shot_direction, properties.storyboard_frame_prompt]; }), ...options.references.flatMap((reference) => [reference.label, reference.storyboardTitle, reference.shotDirection, reference.cameraDirection, reference.framePrompt])].map(audioPolicyText);
  if (audio.generateAudio && (cleanedPrompt.removed.some((direction) => unsupportedAudioIntent(direction)) || authoredAudioChannels.some((direction) => unsupportedAudioIntent(direction)))) {
    videoAdaptationFailure("video_audio_profile_unsupported", "The generated video direction requested musical scoring, voices, or another unsupported soundtrack. Original ambient mode permits newly generated, non-musical environmental effects only.", prompt);
  }

  const snapshot = options.snapshot ?? {};
  const beats = videoStoryboardBeats(snapshot, options.references);
  const authoredTiming = beats.length ? parseAuthoredTimecodes(cleanedPrompt.text, beats.length, options.seconds) : null;
  const scheduledBeats = beats.map((beat, index) => ({
    ...beat,
    startsAtSeconds: authoredTiming?.[index]?.startsAtSeconds ?? Math.round(index * options.seconds / beats.length * 100) / 100,
    endsAtSeconds: authoredTiming?.[index]?.endsAtSeconds ?? (index === beats.length - 1 ? options.seconds : Math.round((index + 1) * options.seconds / beats.length * 100) / 100),
  }));
  const visualProjection = productResearchVisualProjection(snapshot, options, cleanedPrompt.text);
  const providerMotion = visualProjection?.motion ?? cleanedPrompt.text;
  const sourceDecisions = sourceFactDirective(snapshot);
  const excluded = [...new Set([...sourceDecisions.excluded, ...(options.productionContinuity?.prohibitions ?? [])])];
  const scopedExcluded = [...sourceDecisions.scopedExcluded, ...(options.productionContinuity?.scopedTargets ?? []).flatMap((target) => target.prohibitions.map((direction) => ({ direction, role: target.role, target: target.target })))];
  const emphasis = visualProjection
    ? [...sourceDecisions.emphasis.filter((direction) => !/^(?:DIRECTION|MESSAGE|AUDIENCE)(?:\s+for[^:]*)?:/i.test(direction) || !PRODUCT_RESEARCH_OPERATIONAL_DIRECTION.test(direction)), ...visualProjection.emphasis]
    : sourceDecisions.emphasis;
  const { affirmed } = sourceDecisions;
  const interpretedHardDecisions = requiredContextAdaptationFacts(snapshot)
    .filter((decision) => !factIsNegative(decision.fact) && !(decision.type === "reference" && Number(decision.properties.storyboard_frame_index ?? 0) > 0))
    .map((decision) => {
      if (decision.type === "typography") return { ...decision, audioOnly: false, audioDirections: [] as string[] };
      const sanitized = removeAudioDirections(decision.direction);
      return { ...decision, direction: sanitized.text, audioOnly: !sanitized.text && sanitized.removed.length > 0, audioDirections: sanitized.removed };
    });
  const requiredDecisions = interpretedHardDecisions.filter((decision) => !decision.audioOnly);
  const unrepresentableDecision = requiredDecisions.find((decision) => !decision.direction);
  if (unrepresentableDecision) videoAdaptationFailure("video_required_context_unrepresentable", `The locked ${unrepresentableDecision.type} decision${unrepresentableDecision.blockId ? ` ${unrepresentableDecision.blockId}` : ""} has no provider-safe representable authorial value.`, prompt);
  const authoredAmbientDirections = audio.generateAudio ? [...new Set(interpretedHardDecisions.filter((decision) => decision.audioOnly).flatMap((decision) => decision.audioDirections).filter((direction) => stripAudioNegations(direction).replace(/[\s.;,]+/g, "") && !unsupportedAudioIntent(direction)))] : [];
  const sections: ContextAdaptationSection[] = [
    {
      id: "output-contract",
      priority: "required",
      content: `OUTPUT CONTRACT\nCreate exactly ${options.seconds} seconds of ${options.size === "720x1280" ? "9:16 portrait" : "16:9 landscape"} video. Preserve every authored story beat within that single continuous runtime.`,
    },
    {
      id: "audio-contract",
      priority: "required",
      content: options.providedSoundtrack
        ? audio.generateAudio
          ? `AUTHORIZED SOUNDTRACK\nUse only the separately authorized @AudioN references as the musical soundtrack. Additional generated sound must remain newly created, non-musical, non-melodic environmental ambience and physical scene sounds only.${authoredAmbientDirections.length ? ` Required authored environmental details: ${authoredAmbientDirections.join("; ")}.` : ""}`
          : "AUTHORIZED SOUNDTRACK\nUse only the separately authorized @AudioN references as the audible soundtrack. Do not generate additional music, speech, vocals, dialogue, or environmental ambience. Match visual timing and emotional progression to the authorized recording."
        : audio.generateAudio
          ? `SOUND DESIGN\nNewly created, non-musical, non-melodic environmental ambience and physical scene sounds only.${authoredAmbientDirections.length ? ` Required authored environmental details: ${authoredAmbientDirections.join("; ")}.` : ""}`
          : "VISUAL RHYTHM\nDeliver silent visual-only motion. Convey the complete emotional progression through performance, camera movement, editing cadence, weather, physical action, and changing light.",
    },
    {
      id: "creative-meaning",
      priority: "required",
      content: `CREATIVE MEANING\n${compactMotionThesis(providerMotion, snapshot)}${emphasis.length ? `\n${emphasis.join("\n")}` : ""}`,
    },
  ];

  if (requiredDecisions.length || affirmed.length) sections.push({
    id: "mandatory-authored-decisions",
    priority: "required",
    content: `MANDATORY AUTHORIAL DECISIONS\n${[...requiredDecisions.flatMap((decision) => {
      const label = text(decision.type, 55).toUpperCase();
      const memberships = combinedContextMemberships(decision.properties);
      return memberships.length ? memberships.map((membership) => `${label} for ${membership.role.replaceAll("_", " ")} “${text(membership.target, 160)}”: ${decision.direction}`) : [`${label}: ${decision.direction}`];
    }), ...affirmed].join("\n")}`,
  });

  const continuityNotes = visualProjection
    ? [visualProjection.continuity]
    : [...new Set([options.plan?.summary, ...(options.plan?.items ?? []).map((item) => item.notes)].map((value) => removeAudioDirections(text(value, 750)).text).filter(Boolean))];
  if (continuityNotes.length) sections.push({
    id: "production-continuity",
    priority: "required",
    content: `PRODUCTION CONTINUITY\n${continuityNotes.map((note) => text(note, 520)).join("\n")}`,
  });

  const audioExclusionInterpretations: VideoPromptAdaptation["audioExclusionInterpretations"] = [];
  const preserveExclusion = (value: string, scope: "global" | "target", target?: string, role?: string) => {
    const titleOnly = value.trim().replace(/\s+(?:plays?|is playing)\.?$/iu, "").replace(/[.!?]$/u, "");
    const namedWorkOnly = !visualAudioSubject(value) && [NAMED_MUSICAL_TITLE, NAMED_MUSICAL_ATTRIBUTION].some((pattern) => pattern.exec(titleOnly)?.[0] === titleOnly);
    if (!namedWorkOnly) return value;
    // A standalone prohibited recording can be covered by a stronger generic
    // absence, without prompting its recognizable title. Mixed constraints
    // must remain atomic: never split or drop their visual/semantic clauses.
    const providerText = "musical playback, recognizable songs, lyrics, speech, and vocal performances";
    audioExclusionInterpretations.push({ originalText: value, providerText, scope, ...(target ? { target, role } : {}) });
    return providerText;
  };
  const safeVisualExclusions = [...new Set([
    ...excluded.map((value) => preserveExclusion(value, "global")).flatMap((value) => visualProjection ? productResearchVisualBoundaries(value, visualProjection) : [value]),
    ...(visualProjection?.anonymousInterfaces ? ["readable personal details"] : []),
    ...(visualProjection?.truthfulScores ? ["unauthored numerical claims"] : []),
  ])];
  if (safeVisualExclusions.length) sections.push({
    id: "authored-boundaries",
    priority: "required",
    content: `AUTHORIAL BOUNDARIES\nKeep the finished frame limited to the permitted authored world; these prohibited elements remain outside the composition: ${safeVisualExclusions.join("; ")}.`,
  });
  const safeScopedVisualExclusions = scopedExcluded.flatMap((exclusion) => {
    const directions = [preserveExclusion(exclusion.direction, "target", exclusion.target, exclusion.role)];
    return directions.flatMap((direction) => visualProjection ? productResearchVisualBoundaries(direction, visualProjection) : [direction]).map((direction) => ({ ...exclusion, direction }));
  });
  if (safeScopedVisualExclusions.length) sections.push({
    id: "target-scoped-authored-boundaries",
    priority: "required",
    content: `TARGET-SCOPED AUTHORIAL BOUNDARIES\n${safeScopedVisualExclusions.map((exclusion) => `Exclude ${exclusion.direction} only from ${exclusion.role.replaceAll("_", " ")} “${text(exclusion.target, 160)}”; this prohibition does not apply to any other target.`).join("\n")}`,
  });

  const contextGroups = combinedContextGroups(snapshot);
  if (contextGroups.length) sections.push({
    id: "combined-context-boundaries",
    priority: "required",
    content: `COMBINED AUTHORIAL CONTEXT\n${contextGroups.map((group) => {const members=group.members.filter((member)=>{const source=activeFacts(snapshot).find((fact)=>String(fact.block_id??"")===member.blockId);return!source||!factIsNegative(source);});return `“${text(group.name, 120)}” belongs only to ${text(group.role, 60).replaceAll("_", " ")} “${text(group.target, 160)}”; ${text(group.application, 80).replaceAll("_", " ")}; ${Math.round(group.relativity * 100)}% influence. Members: ${members.map((member) => `${text(member.role, 50)} “${text(groupedMemberDirection(snapshot, member), 210)}”`).join("; ")}.`;}).join("\n")}`,
  });

  if (scheduledBeats.length) sections.push({
    id: "ordered-storyboard-beats",
    priority: "required",
    content: `ORDERED STORYBOARD CHRONOLOGY\n${scheduledBeats.map((beat) => {
      const direction = removeAudioDirections(beat.direction);
      const camera = removeAudioDirections(beat.cameraDirection);
      const frame = removeAudioDirections(beat.framePrompt);
      const frameAnchor = frame.text && !direction.text.toLocaleLowerCase().includes(frame.text.toLocaleLowerCase()) ? ` Visual anchors: ${salientFrameAnchor(frame.text, direction.text, camera.text)}.` : "";
      const storyboard = `Storyboard shot ${beat.sequence}${beat.storyboardTitle ? ` from “${beat.storyboardTitle}”` : ""}`;
      return `${beat.startsAtSeconds}–${beat.endsAtSeconds}s · ${storyboard} — ${beat.title}: ${text(direction.text, 340)}${camera.text ? ` Camera: ${text(camera.text, 140)}` : ""}${frameAnchor}`;
    }).join("\n")}\nEach beat is a linked visual progression; short durations may use continuous transitions rather than forcing separate cuts.`,
  });

  const referenceBindings = options.references.map((reference, index) => ({
    token: referenceToken(options.model, index),
    referenceId: reference.referenceId,
    blockId: reference.blockId,
    sequence: reference.sequence,
    mode: reference.mode,
    contextGroupIds: [...new Set((reference.contextGroups ?? []).map((group) => group.id).filter(Boolean))],
  }));

  if (options.references.length) {
    const generated = options.references.every((reference) => reference.sourceArtifactKind === "storyboard" || Boolean(reference.provider));
    const ageEvidence = authoredAudioChannels.join(" ");
    const depictsChild = /\b(?:child|children|minor|infant|baby|toddler|teen(?:ager)?|adolescent|(?:[1-9]|1[0-7])[\s-]+year[\s-]+old)\b/i.test(ageEvidence);
    const depictsAdult = /\b(?:adult|grown(?:[\s-]+up)?)\b/i.test(ageEvidence) && !depictsChild;
    sections.push({
      id: "reference-provenance",
      priority: "required",
      content: generated
        ? `REFERENCE PROVENANCE\nEvery attached image is an authorized, generated creative reference for this project. ${depictsAdult ? "Any intentionally depicted person is an adult fictional character." : "Any intentionally depicted character is fictional and synthetic."}`
        : "REFERENCE PROVENANCE\nEvery attached image is an authorized creative reference for this project.",
    });

    for (const [index, reference] of options.references.entries()) {
      const token = referenceBindings[index]!.token;
      const shot = reference.sequence ? `Storyboard shot ${reference.sequence}${reference.storyboardTitle ? ` from “${text(reference.storyboardTitle, 120)}”` : ""}` : `Reference image ${index + 1}`;
      const direction = removeAudioDirections(reference.shotDirection);
      const camera = removeAudioDirections(reference.cameraDirection);
      const boundary = groupBoundary(reference);
      const alreadyDescribed = scheduledBeats.some((beat) => beat.blockId === reference.blockId || beat.storyboardGroupId === (reference.sourceArtifactId || reference.storyboardTitle) && beat.sequence === reference.sequence);
      sections.push({
        id: `reference-${index + 1}`,
        priority: "required",
        content: `${token} — ${shot} — ${text(reference.label, 140)}. ${referenceModeDirection(reference.mode)}${boundary ? ` ${boundary}` : ""}${!alreadyDescribed && direction.text ? ` Shot direction: ${text(direction.text, 350)}.` : ""}${!alreadyDescribed && camera.text ? ` Camera: ${text(camera.text, 150)}.` : ""}`,
      });
    }
  }

  sections.push({ id: "motion-and-story-direction", priority: "important", content: `MOTION AND STORY DIRECTION\n${providerMotion}`, allowCompaction: true });
  for (const [index, beat] of scheduledBeats.entries()) if (beat.framePrompt && !beat.direction) {
    sections.push({ id: `shot-${index + 1}-${beat.sequence}-visual-detail`, priority: "optional", content: `SHOT ${beat.sequence} VISUAL DETAIL\n${removeAudioDirections(beat.framePrompt).text}`, allowCompaction: true });
  }

  let compilation = compileContextAdaptationSections(sections, VIDEO_ADAPTER_CONTRACT.targetPromptCharacters);
  if (!compilation.valid && compilation.issues.every((issue) => issue.code === "required_context_exceeds_budget")) {
    const expandedBudget = Math.min(VIDEO_ADAPTER_CONTRACT.maxPromptCharacters, Math.max(VIDEO_ADAPTER_CONTRACT.targetPromptCharacters, compilation.adaptedCharacters + 750));
    compilation = compileContextAdaptationSections(sections, expandedBudget);
  }
  if (!compilation.valid || !compilation.prompt) {
    videoAdaptationFailure("video_required_context_exceeds_budget", compilation.issues.map((issue) => issue.message).join(" ") || "The video adaptation did not produce a complete provider prompt.", compilation.prompt || prompt);
  }
  if (audio.generateAudio) {
    for (const section of sections.filter((candidate) => compilation.includedSectionIds.includes(candidate.id) && !["audio-contract", "authored-boundaries", "target-scoped-authored-boundaries"].includes(candidate.id))) {
      const lines = section.content.includes("\n") ? section.content.split("\n").slice(1) : [section.content];
      for (const line of lines) {
        if (/^TYPOGRAPHY(?:\s+for[^:]*)?:/i.test(line)) continue;
        if (unsupportedAudioIntent(line)) videoAdaptationFailure("video_audio_profile_unsupported", "A provider-facing visual context section contains musical scoring, copyrighted playback, or spoken audio. Original ambient mode permits only newly generated environmental effects.", compilation.prompt);
      }
    }
  }
  for (const binding of referenceBindings) if (!compilation.prompt.includes(binding.token)) {
    videoAdaptationFailure("video_reference_binding_missing", `The prepared video prompt lost the required ${binding.token} reference binding. No reference was uploaded or submitted.`, compilation.prompt);
  }
  if (options.model === "bytedance/seedance-2.0/reference-to-video" || options.model === "bytedance/seedance-2.5/reference-to-video") {
    const unknownReference = [...compilation.prompt.matchAll(/@Image(\d+)/g)].find((match) => Number(match[1]) < 1 || Number(match[1]) > referenceBindings.length);
    if (unknownReference) videoAdaptationFailure("video_reference_binding_invalid", `The prepared video prompt refers to ${unknownReference[0]}, but only ${referenceBindings.length} image reference${referenceBindings.length === 1 ? " is" : "s are"} attached.`, compilation.prompt);
  }

  return {
    prompt: compilation.prompt,
    adapterId: VIDEO_ADAPTER_CONTRACT.promptAdapterId,
    adapterVersion: VIDEO_ADAPTER_CONTRACT.promptAdapterVersion,
    audio,
    compilation,
    storyboardBeats: scheduledBeats.map(({ sequence, title, startsAtSeconds, endsAtSeconds, blockId }) => ({ sequence, title, startsAtSeconds, endsAtSeconds, sourceBlockId: blockId })),
    referenceBindings,
    sourceBlockIds: [...new Set(activeFacts(snapshot).map((fact) => text(fact.block_id, 120)).filter(Boolean))],
    removedAudioDirections: [...new Set(cleanedPrompt.removed)],
    sourceInterpretations: sourceScope.interpretations,
    audioExclusionInterpretations,
    timingSource: authoredTiming ? "authored" : scheduledBeats.length ? "normalized" : "single-shot",
  };
}
