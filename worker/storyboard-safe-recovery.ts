import { buildIdeogramPrompt } from "./ideogram-prompt-adapter.ts";

type StoryboardFrame = {
  title?: string;
  body?: string;
  notes?: string;
  image_prompt?: string;
};

type StoryboardDirection = {
  title: string;
  rationale: string;
  scene: string;
  palette: string[];
  next_moves: string[];
};

type PreparedStoryboardFrame = {
  snapshot: Record<string, unknown>;
  direction: StoryboardDirection;
  size: string;
  ideogramCaptionStrategy: "compact_literal";
};

const UNSAFE_VISUAL_DIRECTION = /\b(?:people|persons?|humans?|faces?|hands?|shoulders?|bodies|body|anatom\w*|reviewers?|colleagues?|photograph\w*|photorealis\w*|realistic|broken|fail(?:ed|ure)?|uncertain\w*|stall\w*|providers?|charges?|payments?|billing|private|identif\w*|credentials?|secrets?|pixels?|render(?:ed|ing)?|completed|exact|taglines?|phrases?|scores?|numerals?|metrics?|receipt\w*|risk\w*|safety|violence|distress|weapon\w*|adult\w*|children|minor\w*|nude\w*|nudity)\b/i;

function safeVisualFact(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const fact = value as Record<string, unknown>;
  const type = String(fact.type ?? "").trim().toLowerCase();
  if (!["palette", "lighting", "style", "exclusion"].includes(type)) return null;
  const source = fact.properties && typeof fact.properties === "object" && !Array.isArray(fact.properties)
    ? fact.properties as Record<string, unknown> : {};
  const text = String(source.text ?? source.instruction ?? source.description ?? "").trim();
  if (text && UNSAFE_VISUAL_DIRECTION.test(text.replace(/[_-]+/g, " "))) return null;
  if (type === "style" && !/\b(?:vector|geometric|graphic|abstract|editorial|illustrat\w*)\b/i.test(text)) return null;
  const properties: Record<string, unknown> = {
    ...(text ? { text } : {}),
    ...(typeof source.weight === "number" ? { weight: source.weight } : {}),
    ...(source.required === true ? { required: true } : {}),
    ...(source.locked === true ? { locked: true } : {}),
    ...(typeof source.authority === "string" ? { authority: source.authority } : {}),
    ...(Array.isArray(source.colors)
      ? { colors: source.colors.filter((color): color is string => typeof color === "string" && !UNSAFE_VISUAL_DIRECTION.test(color)) }
      : {}),
    ...(Array.isArray(source.palette)
      ? { palette: source.palette.filter((color): color is string => typeof color === "string" && !UNSAFE_VISUAL_DIRECTION.test(color)) }
      : {}),
  };
  return {
    ...(typeof fact.block_id === "string" ? { block_id: fact.block_id } : {}),
    type,
    ...(typeof fact.role === "string" ? { role: fact.role } : {}),
    ...(typeof fact.intent === "string" ? { intent: fact.intent } : {}),
    ...(typeof fact.effect === "string" ? { effect: fact.effect } : {}),
    ...(fact.locked === true ? { locked: true } : {}),
    active: true,
    properties,
  };
}

function safeStandingConstraint(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const axis = String(item.axis ?? "").trim();
  const direction = String(item.value ?? "").trim();
  if (!/\b(?:palette|color|colour|lighting|style)\b/i.test(axis) || !direction || UNSAFE_VISUAL_DIRECTION.test(direction.replace(/[_-]+/g, " "))) return null;
  return { axis, polarity: String(item.polarity ?? "prefer"), value: direction };
}

function storyboardVisualBeat(frame: StoryboardFrame, index: number) {
  const meaning = [frame.title, frame.body].map((value) => String(value ?? "")).join(" ").toLowerCase();
  if (index >= 3 || /\b(?:prioriti[sz]|roadmap|improvement plan|fix the friction)\b/i.test(meaning)) {
    return {
      title: "Organized visual pathways",
      scene: "Three clean vertical planning columns step from a broad amber panel to two progressively slimmer charcoal panels. Rounded blank cards align neatly within each column. A luminous central context shape connects through gently branching curved paths to three distinct geometric destination tiles. The overall composition moves confidently from organized priorities to flexible delivery paths.",
    };
  }
  if (index === 2 || /\b(?:submission|delivery|timeline|paused|stalls?)\b/i.test(meaning)) {
    return {
      title: "A visible delivery pause",
      scene: "A broad charcoal workspace contains a simple amber progress path interrupted by two soft rounded vertical shapes. An empty softly outlined destination panel sits to the right, while one glowing central context card remains intact on the left. Fine curved connector lines and a small circular amber accent make the interrupted visual pathway immediately clear.",
    };
  }
  if (index === 1 || /\b(?:workflow|navigation|friction|difficult|obscur\w*)\b/i.test(meaning)) {
    return {
      title: "A crowded visual pathway",
      scene: "Five blank rounded amber and charcoal context cards form an orderly grid on the left. On the right, a large neutral sidebar partly overlaps a softly glowing rounded action control. Beneath the workspace, three plain horizontal indicator bars descend from a long amber bar to a short charcoal bar and a slightly longer warm gray bar. Clean overlapping geometry clearly communicates the competing interface layers.",
    };
  }
  return {
    title: "One shared visual context",
    scene: "Five separate blank document-shaped cards begin around the outer edges of a calm charcoal canvas. Warm amber connector paths gather those shapes into one softly glowing central context tile. Three distinct abstract destination panels branch outward on the opposite side, forming one clear left-to-right visual story.",
  };
}

/**
 * A server-authorized recovery may replace a definitively rejected bitmap only.
 * User-authored context, storyboard copy, and source evidence remain untouched.
 */
export function storyboardSafeRecoveryRenderingInput(
  prepared: PreparedStoryboardFrame,
  frame: StoryboardFrame,
  frameIndex: number,
) {
  const source = prepared.snapshot;
  const facts = (Array.isArray(source.facts) ? source.facts : []).map(safeVisualFact)
    .filter((fact): fact is NonNullable<typeof fact> => fact !== null);
  const constraints = (Array.isArray(source.standing_constraints) ? source.standing_constraints : [])
    .map(safeStandingConstraint)
    .filter((constraint): constraint is NonNullable<typeof constraint> => constraint !== null);
  const beat = storyboardVisualBeat(frame, Math.max(0, Math.floor(Number(frameIndex) || 0)));

  return {
    snapshot: { facts, ...(constraints.length ? { standing_constraints: constraints } : {}) },
    direction: {
      title: beat.title,
      rationale: "A clean geometric editorial illustration of the current storyboard beat.",
      scene: `Landscape flat-vector editorial product illustration. Warm amber, soft charcoal, and gentle dusk-gray palette. ${beat.scene} Objects-only still-life composition, simple rounded geometric shapes, subtle gradients, generous negative space, and a calm polished infographic treatment. Every surface remains blank and unmarked.`,
      palette: ["warm amber", "soft charcoal", "dusk gray"],
      next_moves: [] as string[],
    },
    size: "1536x1024" as const,
    ideogramCaptionStrategy: "compact_literal" as const,
  };
}

/** Compile precisely the pixel-free low-quality Ideogram prompt used by recovery. */
export function storyboardSafeRecoveryProviderPrompt(prepared: ReturnType<typeof storyboardSafeRecoveryRenderingInput>) {
  const adaptation = buildIdeogramPrompt(prepared.snapshot, prepared.direction, "", [], {
    quality: "low",
    size: prepared.size,
    ideogramCaptionStrategy: prepared.ideogramCaptionStrategy,
  });
  if (!adaptation.valid) throw new Error(`storyboard_safe_recovery_prompt_invalid: ${adaptation.issues.join("; ")}`);
  return adaptation.prompt;
}
