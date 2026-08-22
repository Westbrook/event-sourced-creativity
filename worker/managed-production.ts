import { combinedContextGroups } from "../src/model/combined-context.ts";
import type { DocumentArtifactDraft, DocumentArtifactKind } from "../src/model/document-artifacts.ts";
import { imageFormatForPreset, providerRenderFormat } from "../src/model/image-format.ts";
import {
  productionSceneSnapshot,
  scoreManagedProductionPlan,
  type ManagedProductionPlan,
  type ProductionScene,
} from "../src/model/managed-production.ts";
import { VIDEO_ADAPTER_CONTRACT, type VideoAudioMode } from "../src/model/video-adapter.ts";
import { generateCreativeImage } from "./image-adapter.ts";
import { readGeneratedImageReference, storeGeneratedImage, storeGeneratedMedia } from "./media-api.ts";
import {
  generateCreativeVideo,
  generateDocumentArtifact,
  type CreativeVideoPreparedReceipt,
  type ImageReference,
  type VideoReference,
} from "./openai-adapter.ts";
import type { ProviderCostBreakdown } from "./replay-cost.ts";
import type { WorkerEnv } from "./runtime.ts";

type ProviderUsage = { inputTokens: number; outputTokens: number; totalTokens: number };
type ProductionCheckpoint = Record<string, unknown>;

export type ProductionSceneReceipt = {
  sceneId: string;
  narrativeOrder: number;
  generationOrder: number;
  status: "preparing" | "submitted" | "completed";
  providerJobId?: string;
  providerModel?: string;
  providerStatusUrl?: string;
  providerResponseUrl?: string;
  providerCancelUrl?: string;
  videoInputReceipt?: Record<string, unknown>;
  mediaUrl?: string;
  mediaType?: string;
  durationSeconds: number;
  costMicrousd?: number;
  referenceIds: string[];
  dependsOn: string[];
  startBoundaryGuidanceId: string | null;
  endBoundaryGuidanceId: string | null;
};

type ManagedProductionCallbacks = {
  signal?: AbortSignal;
  progress?: (stage: string, message: string, checkpoint?: ProductionCheckpoint) => void | Promise<void>;
  checkpoint?: (state: ProductionCheckpoint) => void;
};

const addUsage = (left: ProviderUsage, right: ProviderUsage): ProviderUsage => ({
  inputTokens: left.inputTokens + right.inputTokens,
  outputTokens: left.outputTokens + right.outputTokens,
  totalTokens: left.totalTokens + right.totalTokens,
});

function combinedSceneSnapshot(snapshot: Record<string, unknown>, scenes: ProductionScene[]) {
  const facts = new Map<string, Record<string, unknown>>();
  const relationships = new Map<string, Record<string, unknown>>();
  for (const scene of scenes) {
    const scoped = productionSceneSnapshot(snapshot, scene);
    for (const value of Array.isArray(scoped.facts) ? scoped.facts : []) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const fact = value as Record<string, unknown>;
      facts.set(String(fact.block_id ?? facts.size), fact);
    }
    for (const value of Array.isArray(scoped.relationships) ? scoped.relationships : []) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const relationship = value as Record<string, unknown>;
      relationships.set(String(relationship.relation_id ?? relationships.size), relationship);
    }
  }
  const selected = [...facts.values()];
  return { ...snapshot, facts: selected, relationships: [...relationships.values()], context_groups: combinedContextGroups({ facts: selected }) };
}

/** Page provider planning so a long production never inherits the legacy 12-item ceiling. */
export async function generateManagedArtifactDraft(
  env: WorkerEnv,
  ownerId: string,
  kind: DocumentArtifactKind,
  input: {
    documentTitle: string;
    snapshot: Record<string, unknown>;
    production: ManagedProductionPlan;
    audience?: string;
    tone?: string;
    videoSize?: "1280x720" | "720x1280";
    videoAudioMode?: VideoAudioMode;
  } & ManagedProductionCallbacks,
) {
  const pages: Array<Awaited<ReturnType<typeof generateDocumentArtifact>>> = [];
  for (let index = 0; index < input.production.scenes.length; index += 8) {
    const scenes = input.production.scenes.slice(index, index + 8);
    await input.progress?.("planning", `${input.production.team.label}: planning scenes ${index + 1}–${index + scenes.length} of ${input.production.scenes.length}.`);
    pages.push(await generateDocumentArtifact(env, ownerId, kind, {
      documentTitle: input.documentTitle,
      snapshot: combinedSceneSnapshot(input.snapshot, scenes),
      options: {
        itemCount: scenes.length,
        audience: input.audience,
        tone: input.tone,
        videoSize: input.videoSize,
        videoAudioMode: input.videoAudioMode,
        productionMode: "managed",
        productionPlan: input.production,
        productionScenes: scenes,
        signal: input.signal,
      },
    }));
  }
  const first = pages[0]!;
  const output: DocumentArtifactDraft = {
    title: first.output.title,
    summary: first.output.summary,
    presentation: first.output.presentation,
    content_markdown: pages.map((page) => page.output.content_markdown).join("\n\n"),
    items: pages.flatMap((page) => page.output.items),
  };
  return {
    output,
    model: first.model,
    responseId: first.responseId,
    responseIds: pages.map((page) => page.responseId),
    latencyMs: pages.reduce((sum, page) => sum + page.latencyMs, 0),
    usage: pages.reduce((sum, page) => addUsage(sum, page.usage), { inputTokens: 0, outputTokens: 0, totalTokens: 0 }),
    inputReceipt: {
      production_mode: "managed",
      team: input.production.team,
      page_count: pages.length,
      pages: pages.map((page, index) => ({ page: index + 1, response_id: page.responseId, item_count: page.output.items.length, ...page.inputReceipt })),
    },
  };
}

const ownedImageReference = (value: NonNullable<Awaited<ReturnType<typeof readGeneratedImageReference>>>, label: string): ImageReference => ({
  ...value,
  label,
  source: "locked-study",
  mode: "preserve_subject",
});

function generatedVideoReference(
  value: NonNullable<Awaited<ReturnType<typeof readGeneratedImageReference>>>,
  artifactId: string,
  scene: ProductionScene,
): VideoReference {
  return {
    ...value,
    blockId: `production-anchor:${artifactId}`,
    referenceId: `production-anchor:${artifactId}`,
    label: "Account-generated production continuity anchor",
    mode: "preserve_subject",
    sequence: null,
    shotDirection: scene.action,
    cameraDirection: scene.cameraDirection,
    framePrompt: scene.imagePrompt,
    sourceArtifactId: artifactId,
    sourceArtifactItemId: null,
    sourceArtifactKind: "production-anchor",
    storyboardTitle: "Shared production continuity",
    contextGroups: [],
  };
}

const retainedVideoReceipt = (value: Record<string, unknown> | undefined): CreativeVideoPreparedReceipt | undefined => value ? {
  provider: String(value.provider ?? "fal"),
  model: String(value.model ?? VIDEO_ADAPTER_CONTRACT.model),
  submittedPrompt: String(value.submitted_prompt ?? ""),
  parameters: value.parameters && typeof value.parameters === "object" ? value.parameters as Record<string, unknown> : {},
  referenceInputs: Array.isArray(value.reference_inputs) ? value.reference_inputs as Array<Record<string, unknown>> : [],
  usedReferencePixels: value.used_reference_pixels === true,
  ...(value.adaptation ? { adaptation: value.adaptation as CreativeVideoPreparedReceipt["adaptation"] } : {}),
} : undefined;

/** Render real individual clips and retain an honest, chronological reel manifest. */
export async function renderManagedVideoProduction(
  env: WorkerEnv,
  ownerId: string,
  artifactId: string,
  draft: DocumentArtifactDraft,
  production: ManagedProductionPlan,
  input: {
    snapshot: Record<string, unknown>;
    references: VideoReference[];
    videoSize: "1280x720" | "720x1280";
    audioMode: VideoAudioMode;
    existingItems?: Array<Record<string, unknown>>;
    existingSceneReceipts?: Record<string, ProductionSceneReceipt>;
    existingAnchor?: Record<string, unknown>;
    prepaidSceneIds?: string[];
  } & ManagedProductionCallbacks,
) {
  const receipts = { ...(input.existingSceneReceipts ?? {}) };
  const prepaidScenes = new Set(input.prepaidSceneIds ?? []);
  const rendered = new Map<string, Record<string, unknown>>((input.existingItems ?? []).flatMap((item) => item.scene_id ? [[String(item.scene_id), { ...item }]] : []));
  const costs: ProviderCostBreakdown[] = [];
  let imageUsage: ProviderUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  let anchor = input.existingAnchor;
  let serializedCheckpoint = Promise.resolve();
  const persist = (message: string) => {
    const state = {
      productionPlan: production,
      productionSceneReceipts: { ...receipts },
      productionAnchor: anchor ?? null,
      renderedItems: [...rendered.values()],
      productionQuality: scoreManagedProductionPlan(production),
      recoverableProductionProviderRequest: Object.values(receipts).some((scene) => Boolean(scene.providerJobId) && (scene.status === "submitted" || scene.status === "completed")),
      productionSceneCount: production.scenes.length,
      productionCompletedSceneCount: [...rendered.values()].filter((item) => item.media_url).length,
    };
    input.checkpoint?.(state);
    serializedCheckpoint = serializedCheckpoint.then(() => input.progress?.("rendering-scenes", message, state)).then(() => undefined);
    return serializedCheckpoint;
  };

  if (production.scenes.some((scene) => !scene.referenceIds.length) && !anchor) {
    const anchorScene = production.scenes.find((scene) => scene.id === production.anchorSceneId)!;
    await input.progress?.("anchor-generation", `Creating the shared visual anchor from scene ${anchorScene.narrativeOrder}: ${anchorScene.title}.`);
    const prior = input.references[0];
    const reference = prior ? [{ ...prior, source: "locked-study" as const }] satisfies ImageReference[] : [];
    const format = providerRenderFormat(imageFormatForPreset(input.videoSize === "720x1280" ? "9:16" : "16:9"), "preview");
    const image = await generateCreativeImage(env, ownerId, productionSceneSnapshot(input.snapshot, anchorScene), {
      title: anchorScene.title,
      rationale: production.anchorRationale,
      scene: `${anchorScene.imagePrompt}. Preserve this recurring production identity, wardrobe, location, palette, lighting, and lens: ${JSON.stringify(production.continuityBible)}.`,
      palette: production.continuityBible.palette,
      next_moves: ["Preserve subject identity", "Carry visual continuity across every scene"],
    }, { quality: "low", size: format.size, outputFormat: "jpeg", outputCompression: 82, references: reference, signal: input.signal });
    const stored = await storeGeneratedImage(env, ownerId, `${artifactId}-continuity-anchor`, image.bytes, image.model, image.mimeType, {
      artifactId,
      artifactRole: "production-continuity-anchor",
      provider: image.provider,
      providerModel: image.model,
      providerRequestId: image.providerRequestId ?? "",
      providerMediaUrl: image.providerMediaUrl ?? "",
      rights: "account-generated",
    });
    anchor = { mediaUrl: stored.url, mediaType: stored.mimeType, sceneId: anchorScene.id, source: "account-generated", rights: "account-generated", frameGuidance: "prompt-guided-reference-not-native-frame-lock" };
    imageUsage = addUsage(imageUsage, image.usage);
    costs.push(image.costBreakdown);
    await persist("The reusable production anchor is safely stored with account-generated provenance.");
  }

  let anchorReference: VideoReference | null = null;
  if (anchor?.mediaUrl) {
    const image = await readGeneratedImageReference(env, ownerId, anchor.mediaUrl);
    if (!image) throw new Error("production_anchor_reference_unavailable");
    anchorReference = generatedVideoReference(image, artifactId, production.scenes.find((scene) => scene.id === production.anchorSceneId)!);
  }

  const sceneById = new Map(production.scenes.map((scene) => [scene.id, scene]));
  const completedFromState = () => [...rendered.values()].filter((item) => item.media_url).length;
  for (const wave of production.parallelWaves) {
    const pending = wave.filter((sceneId) => !rendered.get(sceneId)?.media_url);
    const settled = await Promise.allSettled(pending.map(async (sceneId) => {
      const scene = sceneById.get(sceneId)!;
      const item = draft.items[scene.narrativeOrder - 1]!;
      const existing = receipts[scene.id];
      const approved = input.references.filter((reference) => scene.referenceIds.includes(reference.referenceId));
      const references = [...approved, ...(anchorReference && !approved.some((reference) => reference.referenceId === anchorReference?.referenceId) ? [anchorReference] : [])].slice(0, VIDEO_ADAPTER_CONTRACT.maxReferenceImages);
      const checkpoint: ProductionSceneReceipt = existing ?? {
        sceneId: scene.id,
        narrativeOrder: scene.narrativeOrder,
        generationOrder: production.executionOrder.indexOf(scene.id) + 1,
        status: "preparing",
        durationSeconds: scene.durationSeconds,
        referenceIds: references.map((reference) => reference.referenceId),
        dependsOn: scene.dependsOn,
        startBoundaryGuidanceId: scene.startBoundaryId,
        endBoundaryGuidanceId: scene.endBoundaryId,
      };
      receipts[scene.id] = checkpoint;
      await persist(`Rendering scene ${scene.narrativeOrder} of ${production.scenes.length}: ${scene.title}.`);
      const sceneSnapshot = productionSceneSnapshot(input.snapshot, scene);
      const sceneDraft = { title: draft.title, summary: `${draft.summary} Visual continuity: ${JSON.stringify(production.continuityBible)}.`, items: [{ ...item, notes: `${item.notes} ${scene.transitionIn}; ${scene.transitionOut}.` }] };
      const video = await generateCreativeVideo(env, item.image_prompt || item.body || scene.action, {
        seconds: scene.durationSeconds,
        size: input.videoSize,
        audioMode: input.audioMode,
        endUserId: ownerId,
        snapshot: sceneSnapshot,
        plan: sceneDraft,
        references,
        signal: input.signal,
        providerJobId: existing?.providerJobId,
        providerModel: existing?.providerModel,
        providerStatusUrl: existing?.providerStatusUrl,
        providerResponseUrl: existing?.providerResponseUrl,
        providerCancelUrl: existing?.providerCancelUrl,
        retainedReceipt: retainedVideoReceipt(existing?.videoInputReceipt),
        onPrepared: async (prepared) => {
          checkpoint.videoInputReceipt = {
            provider: prepared.provider,
            model: prepared.model,
            submitted_prompt: prepared.submittedPrompt,
            parameters: prepared.parameters,
            reference_inputs: prepared.referenceInputs,
            used_reference_pixels: prepared.usedReferencePixels,
            adaptation: prepared.adaptation,
          };
          checkpoint.providerModel = prepared.model;
          await persist(`Scene ${scene.narrativeOrder}: validated ${references.length} authorized reference${references.length === 1 ? "" : "s"}.`);
        },
        onReceipt: async (provider) => {
          checkpoint.status = "submitted";
          checkpoint.providerJobId = provider.providerJobId;
          checkpoint.providerModel = provider.model;
          checkpoint.providerStatusUrl = provider.providerStatusUrl;
          checkpoint.providerResponseUrl = provider.providerResponseUrl;
          checkpoint.providerCancelUrl = provider.providerCancelUrl;
          await persist(`Scene ${scene.narrativeOrder} accepted by Fal; its paid request can be resumed without resubmission.`);
        },
        onStage: async (_stage, message) => persist(`Scene ${scene.narrativeOrder}: ${message}`),
      });
      const media = await storeGeneratedMedia(env, ownerId, `${artifactId}-${scene.id}`, video.bytes, video.model, video.mimeType, {
        artifactId,
        artifactRole: "production-video-scene",
        sceneId: scene.id,
        narrativeOrder: String(scene.narrativeOrder),
        providerJobId: video.providerJobId,
      });
      Object.assign(checkpoint, {
        status: "completed",
        providerJobId: video.providerJobId,
        providerModel: video.model,
        providerStatusUrl: video.providerStatusUrl,
        providerResponseUrl: video.providerResponseUrl,
        providerCancelUrl: video.providerCancelUrl,
        mediaUrl: media.url,
        mediaType: media.mimeType,
        costMicrousd: video.costMicrousd,
        videoInputReceipt: {
          provider: video.provider,
          model: video.model,
          provider_job_id: video.providerJobId,
          submitted_prompt: video.submittedPrompt,
          parameters: video.providerParameters,
          reference_inputs: video.referenceInputs,
          used_reference_pixels: video.usedReferencePixels,
          adaptation: video.adaptation,
        },
      });
      rendered.set(scene.id, { id: `${artifactId}-${scene.id}`, scene_id: scene.id, sequence: scene.narrativeOrder, title: item.title, media_url: media.url, media_type: media.mimeType, provider: video.provider, provider_job_id: video.providerJobId, duration_seconds: scene.durationSeconds, generation_order: checkpoint.generationOrder });
      await persist(`${completedFromState()} of ${production.scenes.length} production scenes are safely stored.`);
    }));
    const failed = settled.find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failed) throw failed.reason;
  }
  await serializedCheckpoint;

  const orderedItems = production.scenes.map((scene) => rendered.get(scene.id)!).filter(Boolean);
  const orderedReceipts = production.scenes.map((scene) => receipts[scene.id]!).filter(Boolean);
  return {
    items: orderedItems,
    receipts: orderedReceipts,
    anchor,
    imageUsage,
    imageCosts: costs,
    videoCostMicrousd: orderedReceipts.reduce((sum, receipt) => sum + (prepaidScenes.has(receipt.sceneId) ? 0 : Number(receipt.costMicrousd ?? 0)), 0),
    latencyMs: 0,
    quality: scoreManagedProductionPlan(production),
    assembly: {
      kind: "ordered-scene-reel" as const,
      composed: false,
      reason: "No supported video compositor is configured; individual chronological clips remain independently playable.",
      narrative_order: orderedReceipts.map((receipt) => receipt.sceneId),
      generation_order: production.executionOrder,
      native_boundary_frames: false,
    },
  };
}

/** Produce storyboard frames out of timeline order without losing durable chronology. */
export async function renderManagedStoryboardProduction(
  env: WorkerEnv,
  ownerId: string,
  artifactId: string,
  draft: DocumentArtifactDraft,
  production: ManagedProductionPlan,
  input: { snapshot: Record<string, unknown>; existingItems?: Array<Record<string, unknown>> } & ManagedProductionCallbacks,
) {
  const rendered = new Map<string, Record<string, unknown>>((input.existingItems ?? []).flatMap((item) => item.scene_id ? [[String(item.scene_id), { ...item }]] : []));
  const usage: ProviderUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  const costs: ProviderCostBreakdown[] = [];
  const sceneById = new Map(production.scenes.map((scene) => [scene.id, scene]));
  let latestModel = "";
  let latestProvider = "";
  let latestProviderJobId = "";
  let serializedCheckpoint = Promise.resolve();
  const persist = (message: string) => {
    const checkpoint = { productionPlan: production, renderedItems: [...rendered.values()] };
    input.checkpoint?.(checkpoint);
    serializedCheckpoint = serializedCheckpoint.then(() => input.progress?.("rendering-frames", message, checkpoint)).then(() => undefined);
    return serializedCheckpoint;
  };

  for (const wave of production.parallelWaves) {
    const settled = await Promise.allSettled(wave.filter((sceneId) => !rendered.has(sceneId)).map(async (sceneId) => {
      const scene = sceneById.get(sceneId)!;
      const item = draft.items[scene.narrativeOrder - 1]!;
      const parent = scene.dependsOn[0] ? rendered.get(scene.dependsOn[0]) : scene.id !== production.anchorSceneId ? rendered.get(production.anchorSceneId) : undefined;
      const inherited = parent?.media_url ? await readGeneratedImageReference(env, ownerId, parent.media_url) : null;
      const references = inherited ? [ownedImageReference(inherited, "Account-generated storyboard continuity anchor")] : [];
      await persist(`Rendering storyboard frame ${scene.narrativeOrder} of ${production.scenes.length}${references.length ? " from the approved production anchor" : ""}.`);
      const image = await generateCreativeImage(env, ownerId, productionSceneSnapshot(input.snapshot, scene), {
        title: item.title,
        rationale: `${item.notes} Preserve this production continuity: ${JSON.stringify(production.continuityBible)}.`,
        scene: item.image_prompt,
        palette: production.continuityBible.palette,
        next_moves: [scene.transitionIn, scene.transitionOut],
      }, { quality: "low", size: "1024x1024", outputFormat: "jpeg", outputCompression: 78, references, signal: input.signal });
      const media = await storeGeneratedImage(env, ownerId, `${artifactId}-frame-${scene.narrativeOrder}`, image.bytes, image.model, image.mimeType, {
        artifactRole: "storyboard-frame",
        artifactId,
        sceneId: scene.id,
        provider: image.provider,
        providerModel: image.model,
        providerRequestId: image.providerRequestId ?? "",
        providerMediaUrl: image.providerMediaUrl ?? "",
        rights: "account-generated",
      });
      rendered.set(scene.id, { id: `${artifactId}-frame-${scene.narrativeOrder}`, scene_id: scene.id, sequence: scene.narrativeOrder, title: item.title, media_url: media.url, media_type: media.mimeType, width: image.width, height: image.height, provider: image.provider, provider_request_id: image.providerRequestId, generation_order: production.executionOrder.indexOf(scene.id) + 1, inherited_reference_count: references.length });
      Object.assign(usage, addUsage(usage, image.usage));
      costs.push(image.costBreakdown);
      latestModel = image.model;
      latestProvider = image.provider;
      latestProviderJobId = image.providerRequestId ?? latestProviderJobId;
      await persist(`${rendered.size} of ${production.scenes.length} storyboard frames are safely stored.`);
    }));
    const failed = settled.find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failed) throw failed.reason;
  }
  await serializedCheckpoint;
  return {
    items: production.scenes.map((scene) => rendered.get(scene.id)!).filter(Boolean),
    usage,
    costs,
    model: latestModel,
    provider: latestProvider,
    providerJobId: latestProviderJobId,
    quality: scoreManagedProductionPlan(production),
  };
}
