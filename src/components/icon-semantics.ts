import type { BlockKind } from "../model/block-types";
import type { DocumentArtifactKind } from "../model/document-artifacts";
import type { CreatorAxis } from "../model/taste";
import type { FormaIconName } from "./icons";
import "./icons-authoring";
import "./icons-media";
import "./icons-navigation";

/** Shared meaning for creative surfaces; never import from the eager shell. */
const blockIcons: Readonly<Record<BlockKind, FormaIconName>> = {
  direction: "spark",
  audience: "user",
  message: "send",
  emotion: "spark",
  subject: "user",
  environment: "image",
  action: "spark",
  motion: "video",
  scale: "expand",
  composition: "grid",
  camera: "eye",
  lighting: "spark",
  style: "palette",
  material: "layers",
  palette: "palette",
  typography: "edit",
  audio: "audio",
  format: "grid",
  output: "share",
  brand: "pin",
  exclusion: "warning",
  accessibility: "eye",
  reference: "image",
  model3d: "layers",
  sketch: "edit",
};

const artifactIcons: Readonly<Record<DocumentArtifactKind, FormaIconName>> = {
  short_story: "story",
  scene: "scene",
  slides: "slides",
  storyboard: "storyboard",
  video: "video",
  audio: "audio",
  model3d: "layers",
};

const creatorAxisIcons: Readonly<Record<CreatorAxis, FormaIconName>> = {
  subject: "user",
  composition: "grid",
  style: "eye",
  palette: "palette",
  lighting: "spark",
  exclusion: "warning",
};

type RealityIconCategory =
  | "all" | "intent" | "subject" | "space" | "light" | "look" | "delivery" | "rules";

const realityCategoryIcons: Readonly<Record<RealityIconCategory, FormaIconName>> = {
  all: "grid",
  intent: "spark",
  subject: "user",
  space: "layers",
  light: "spark",
  look: "palette",
  delivery: "share",
  rules: "lock",
};

export const blockIconName = (kind: string): FormaIconName =>
  blockIcons[kind as BlockKind] ?? "spark";

export const artifactIconName = (kind: DocumentArtifactKind): FormaIconName =>
  artifactIcons[kind];

export const creatorAxisIconName = (axis: CreatorAxis): FormaIconName =>
  creatorAxisIcons[axis];

export const realityCategoryIconName = (category: RealityIconCategory): FormaIconName =>
  realityCategoryIcons[category];
