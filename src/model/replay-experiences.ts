export const REPLAY_EXPERIENCE_PROFILES = [
  {
    id: "complete-system",
    label: "Complete creative system",
    summary: "A balanced end-to-end campaign: reusable Library context, exploratory Canvas synthesis, document refinement, every output form, judgment, memory, re-entry, and operational recovery.",
    plannerBrief: "Tell one coherent creative campaign in balanced chapters. Give Library reuse, Canvas synthesis, document work, image exploration, non-image deliverables, review, memory, and recovery comparable narrative importance. Do not turn this into a feature checklist.",
  },
  {
    id: "library-canvas",
    label: "Library + Canvas synthesis",
    summary: "Build a reusable visual language in the Library, combine it spatially on a project Canvas, and promote a selected composite context into documents and outputs.",
    plannerBrief: "Make Library-to-Canvas reuse the central value proposition. Create specific standalone blocks and related references, organize them in collections, find them through search, place them with existing documents and outputs, compare and arrange ideas, formalize only the chosen context, then prepare and render a new document.",
  },
  {
    id: "multi-output-storyworld",
    label: "One world, many outputs",
    summary: "Resolve one durable creative world into images, a short story, a scene, visual slides, a storyboard, and a video handoff without losing provenance.",
    plannerBrief: "Make each output genuinely purpose-built for a different audience and next step. The short story, scene, slides, storyboard, video treatment, draft image, full image, and four-way prompt fan must reveal complementary facets of one authored world, not repeat the same paragraph in different containers.",
  },
  {
    id: "study-to-campaign",
    label: "Studies to campaign",
    summary: "Lock character, location, prop, material, wardrobe, logo, and lighting decisions independently before composing a campaign system.",
    plannerBrief: "Demonstrate why focused studies reduce expensive rework. Every study must isolate a consequential uncertainty, produce lockable decisions, enter the Library as reusable context, and contribute pixels or structured constraints to a later composed image and downstream deliverables.",
  },
  {
    id: "collaborative-review",
    label: "Collaborative review and recovery",
    summary: "Explore alternatives with agents and collaborators, make decisions explicit, recover from interruption or failure, and return with a useful next step.",
    plannerBrief: "Center human judgment and safe assistance. Include proposals rather than silent mutations, comparison, critique, scoped preference, undo and restoration, a real friction episode, a failed or blocked paid action, remediation, a session boundary, and a re-entry brief that returns the creator to useful work.",
  },
] as const;

export type ReplayExperienceId = typeof REPLAY_EXPERIENCE_PROFILES[number]["id"];

export const DEFAULT_REPLAY_EXPERIENCE: ReplayExperienceId = "complete-system";

export function normalizeReplayExperienceId(value: unknown): ReplayExperienceId {
  const id=String(value??"") as ReplayExperienceId;
  return REPLAY_EXPERIENCE_PROFILES.some((profile)=>profile.id===id)?id:DEFAULT_REPLAY_EXPERIENCE;
}

export function replayExperienceDefinition(value: unknown) {
  const id=normalizeReplayExperienceId(value);
  return REPLAY_EXPERIENCE_PROFILES.find((profile)=>profile.id===id)??REPLAY_EXPERIENCE_PROFILES[0];
}
