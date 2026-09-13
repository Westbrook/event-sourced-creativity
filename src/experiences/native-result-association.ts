import { captureExperienceModel3dEvidence, type ExperienceModel3dEvidence } from "./model3d-native-result.ts";
import { captureExperienceAudioEvidence, type ExperienceAudioEvidence } from "./audio-native-result.ts";
import { nativeRetainedAudioMediaUrl } from "../model/native-retained-audio.ts";
import { captureExperienceStoryEvidence, type ExperienceStoryEvidence } from "./story-result.ts";
import { captureExperienceSceneEvidence, type ExperienceSceneEvidence } from "./scene-native-result.ts";
import { captureExperienceStoryboardEvidence, experienceStoryboardItemsMatch, type ExperienceStoryboardEvidence } from "./storyboard-native-result.ts";
/** A candidate association, not authorization, private-content availability or
 * quality acceptance. The caller supplies current server-bound identity and an
 * exact passive job inspection, then uses the canonical private result reader. */
export type ExperienceResultIdentity = Readonly<{
  output: "image" | "slides" | "short_story" | "scene" | "storyboard" | "audio" | "model3d"; documentId: string; projectId: string;
  ownerUserId: string; jobId: string; correlationId: string; expiresAt: string;
}>;
export type ExperienceResultCandidate = Readonly<{
  output: "image"; documentId: string; projectId: string; jobId: string;
  eventId: string; outputId: string; generationId: string; contentRef: string;
  mediaUrl: string; expiresAt: string;
}> | Readonly<{
  output: "slides"; documentId: string; projectId: string; jobId: string;
  eventId: string; artifactId: string; contentRef: string; expiresAt: string;
}> | Readonly<{
  output: "short_story"; documentId: string; projectId: string; jobId: string;
  eventId: string; artifactId: string; contentRef: string; expiresAt: string; narrative: ExperienceStoryEvidence;
}> | Readonly<{
  output: "scene"; documentId: string; projectId: string; jobId: string;
  eventId: string; artifactId: string; contentRef: string; inputRef: string; providerResponseId: string;
  expiresAt: string; scene: ExperienceSceneEvidence;
}> | Readonly<{
  output: "storyboard"; documentId: string; projectId: string; jobId: string;
  eventId: string; artifactId: string; contentRef: string; inputRef: string;
  expiresAt: string; storyboard: ExperienceStoryboardEvidence;
}> | Readonly<{
  output: "audio"; documentId: string; projectId: string; jobId: string; eventId: string; artifactId: string;
  contentRef: string; inputRef: string; mediaUrl: string; plannerResponseId: string; expiresAt: string; audio: ExperienceAudioEvidence;
}> | Readonly<{
  output: "model3d"; documentId: string; projectId: string; jobId: string; eventId: string; artifactId: string;
  contentRef: string; inputRef: string; mediaUrl: string; expiresAt: string; model3d: ExperienceModel3dEvidence;
}>;
type Row = Record<string, unknown>;
const row = (value: unknown): value is Row => Boolean(value && typeof value === "object" && !Array.isArray(value));
const id = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(value);
const expiry = (value: unknown, now: number): value is string => typeof value === "string"
  && Number.isFinite(Date.parse(value)) && Date.parse(value) > now && new Date(value).toISOString() === value;

export function captureExperienceNativeResult(identity: ExperienceResultIdentity, job: unknown, current: {
  documentId: string; projectId: string; documents: readonly unknown[];
  events: readonly unknown[]; outputs: readonly unknown[]; artifacts: readonly unknown[];
}, now = Date.now()): ExperienceResultCandidate | null {
  try {
    if (!identity || !["image", "slides", "short_story", "scene", "storyboard", "audio", "model3d"].includes(identity.output) || !Number.isFinite(now)
      || ![identity.documentId, identity.projectId, identity.ownerUserId, identity.jobId, identity.correlationId].every(id)
      || !expiry(identity.expiresAt, now) || current.documentId !== identity.documentId || current.projectId !== identity.projectId
      || !row(job) || job.jobId !== identity.jobId || job.documentId !== identity.documentId
      || job.sourceSurface !== "outputs" || job.status !== "completed"
      || job.kind !== (identity.output === "image" ? "generate" : "render_document") || !row(job.result)) return null;
    const documents = current.documents.filter(value => row(value) && value.id === identity.documentId);
    if (documents.length !== 1 || !row(documents[0]) || documents[0].projectId !== identity.projectId || documents[0].removed !== false) return null;
    const appended = job.result.appendedEventIds;
    if (!Array.isArray(appended) || appended.length === 0 || !appended.every(id)) return null;
    const type = identity.output === "image" ? "GenerationCompleted" : "DocumentRenderCompleted";
    const completions = current.events.filter(value => row(value) && value.type === type && value.correlationId === identity.correlationId);
    if (completions.length !== 1 || !row(completions[0])) return null;
    const event = completions[0];
    if (!id(event.eventId) || !appended.includes(event.eventId) || event.streamId !== `creative:${identity.ownerUserId}`
      || event.actor !== (identity.output === "image" ? "worker:generator" : "worker:renderer") || !row(event.payload)) return null;
    const payload = event.payload;
    // Personal Image completion carries Document identity, but its native
    // producer does not add project_id. The current Document and the canonical
    // private image reader establish that join; reject a contradictory value.
    if (payload.document_id !== identity.documentId || payload.source_surface !== "outputs"
      || (payload.project_id !== undefined && payload.project_id !== identity.projectId)) return null;
    const common = { documentId: identity.documentId, projectId: identity.projectId, jobId: identity.jobId, eventId: event.eventId, expiresAt: identity.expiresAt };
    if (identity.output === "slides" || identity.output === "short_story" || identity.output === "scene" || identity.output === "storyboard" || identity.output === "audio" || identity.output === "model3d") {
      const story = identity.output === "short_story", expectedItems = identity.output === "model3d" ? 0 : story ? 3 : identity.output === "scene" || identity.output === "audio" ? 1 : identity.output === "storyboard" ? 4 : 5;
      const artifactId = payload.artifact_id;
      if (!id(artifactId) || !id(payload.content_ref) || payload.project_id !== identity.projectId || payload.artifact_kind !== identity.output || payload.item_count !== expectedItems
        || payload.requested_by_user_id !== identity.ownerUserId || job.result.artifactId !== artifactId || job.result.artifactKind !== identity.output
        || current.events.some(value => row(value) && value.type === "DocumentArtifactEdited" && row(value.payload) && value.payload.artifact_id === artifactId)) return null;
      const matches = current.artifacts.filter(value => row(value) && value.id === artifactId);
      if (matches.length !== 1 || !row(matches[0])) return null;
      const artifact = matches[0];
      if (artifact.documentId !== identity.documentId || artifact.kind !== identity.output || artifact.itemCount !== expectedItems
        || artifact.sourceEventId !== event.eventId || artifact.sourceSurface !== "outputs" || artifact.contentRef !== payload.content_ref) return null;
      if (identity.output === "model3d") {
        const model3d = captureExperienceModel3dEvidence(payload.settings), projected = captureExperienceModel3dEvidence(artifact.settings);
        if (!model3d || !projected || JSON.stringify(model3d) !== JSON.stringify(projected) || !id(payload.input_ref)
          || artifact.inputRef !== payload.input_ref || !expiry(payload.content_expires_at, now) || !expiry(payload.input_expires_at, now)
          || model3d.jobId !== identity.jobId || model3d.actorUserId !== identity.ownerUserId || model3d.documentId !== identity.documentId
          || model3d.projectId !== identity.projectId || model3d.artifactId !== artifactId || payload.provider !== "fal"
          || payload.model_id !== model3d.costPreview.model || payload.provider_job_id !== model3d.receipt.providerRequestId
          || payload.planner_model_id !== null || payload.planner_response_id !== null || payload.presentation !== null
          || payload.media_type !== "model/gltf-binary" || payload.media_url !== model3d.files[0]?.url || artifact.mediaUrl !== payload.media_url
          || payload.used_reference_pixels !== Boolean(model3d.contract.reference)
          || !Array.isArray(payload.reference_inputs) || payload.reference_inputs.length !== (model3d.contract.reference ? 1 : 0)) return null;
        const expiresAt = new Date(Math.min(Date.parse(identity.expiresAt), Date.parse(payload.content_expires_at), Date.parse(payload.input_expires_at))).toISOString();
        return Object.freeze({ ...common, output: "model3d", artifactId, contentRef: payload.content_ref, inputRef: payload.input_ref,
          mediaUrl: model3d.files[0]!.url, expiresAt, model3d });
      }
      if (identity.output === "audio") {
        const audio = captureExperienceAudioEvidence(payload.settings), projected = captureExperienceAudioEvidence(artifact.settings);
        const mediaUrl = nativeRetainedAudioMediaUrl(payload.media_url);
        if (!audio || !projected || JSON.stringify(audio) !== JSON.stringify(projected) || !id(payload.input_ref)
          || artifact.inputRef !== payload.input_ref || !expiry(payload.content_expires_at, now) || !expiry(payload.input_expires_at, now)
          || payload.provider !== "fal" || payload.model_id !== "fal-ai/stable-audio-3/medium/text-to-audio"
          || payload.provider_job_id !== audio.receipt.providerRequestId || payload.planner_model_id !== "gpt-5.6-terra"
          || !id(payload.planner_response_id) || !mediaUrl || payload.media_type !== "audio/mpeg" || artifact.mediaUrl !== mediaUrl
          || payload.presentation !== null || payload.used_reference_pixels !== false
          || !Array.isArray(payload.reference_inputs) || payload.reference_inputs.length !== 0) return null;
        const expiresAt = new Date(Math.min(Date.parse(identity.expiresAt), Date.parse(payload.content_expires_at), Date.parse(payload.input_expires_at))).toISOString();
        return Object.freeze({ ...common, output: "audio", artifactId, contentRef: payload.content_ref, inputRef: payload.input_ref, mediaUrl, plannerResponseId: payload.planner_response_id, expiresAt, audio });
      }
      if (identity.output === "scene") {
        const scene = captureExperienceSceneEvidence(payload.settings), projected = captureExperienceSceneEvidence(artifact.settings);
        if (!scene || !projected || JSON.stringify(scene) !== JSON.stringify(projected) || !id(payload.input_ref)
          || artifact.inputRef !== payload.input_ref || !id(payload.planner_response_id)
          || !expiry(payload.content_expires_at, now) || !expiry(payload.input_expires_at, now)
          || payload.provider !== "openai" || payload.planner_model_id !== "gpt-5.6-terra"
          || payload.media_url !== null || payload.media_type !== null || payload.presentation !== null) return null;
        const expiresAt = new Date(Math.min(Date.parse(identity.expiresAt), Date.parse(payload.content_expires_at), Date.parse(payload.input_expires_at))).toISOString();
        return Object.freeze({ ...common, output: "scene", artifactId, contentRef: payload.content_ref, inputRef: payload.input_ref,
          providerResponseId: payload.planner_response_id, expiresAt, scene });
      }
      if(identity.output==="storyboard"){
        const storyboard=captureExperienceStoryboardEvidence(payload.settings),projected=captureExperienceStoryboardEvidence(artifact.settings);
        if(!storyboard||!projected||JSON.stringify(storyboard)!==JSON.stringify(projected)||!id(payload.input_ref)||artifact.inputRef!==payload.input_ref
          ||!expiry(payload.content_expires_at,now)||!expiry(payload.input_expires_at,now)||payload.presentation!==null
          ||storyboard.receipt.jobId!==identity.jobId||storyboard.receipt.documentId!==identity.documentId||storyboard.receipt.actorUserId!==identity.ownerUserId
          ||storyboard.receipt.artifactId!==artifactId||storyboard.receipt.correlationId!==identity.correlationId
          ||storyboard.receipt.plannerResponseId!==payload.planner_response_id||payload.planner_model_id!=="gpt-5.6-terra"
          ||payload.provider!=="fal"||payload.model_id!=="ideogram/v4"||payload.media_url!==null||payload.media_type!==null
          ||!experienceStoryboardItemsMatch(payload.items,storyboard))return null;
        const expiresAt=new Date(Math.min(Date.parse(identity.expiresAt),Date.parse(payload.content_expires_at),Date.parse(payload.input_expires_at))).toISOString();
        return Object.freeze({...common,output:"storyboard",artifactId,contentRef:payload.content_ref,inputRef:payload.input_ref,expiresAt,storyboard});
      }
      if (story) {
        const narrative = captureExperienceStoryEvidence(payload.settings), projected = captureExperienceStoryEvidence(artifact.settings);
        if (!narrative || !projected || JSON.stringify(narrative) !== JSON.stringify(projected)) return null;
        return Object.freeze({ ...common, output: "short_story", artifactId, contentRef: payload.content_ref, narrative });
      }
      return Object.freeze({ ...common, output: "slides", artifactId, contentRef: payload.content_ref });
    }
    if (!Array.isArray(payload.object_ids) || payload.object_ids.length !== 1 || !id(payload.object_ids[0])
      || !id(payload.generation_id) || !id(payload.output_ref) || typeof payload.media_url !== "string" || !payload.media_url
      || payload.simulation !== false) return null;
    const outputId = payload.object_ids[0];
    if (current.events.some(value => row(value) && value.type === "GeneratedImageEdited" && row(value.payload)
      && (value.payload.output_id === outputId || value.payload.object_id === outputId))) return null;
    const matches = current.outputs.filter(value => row(value) && value.id === outputId);
    if (matches.length !== 1 || !row(matches[0])) return null;
    const output = matches[0];
    if (output.documentId !== identity.documentId || output.discarded !== false || output.sourceEventId !== event.eventId
      || output.sourceSurface !== "outputs" || output.generationId !== payload.generation_id || output.contentRef !== payload.output_ref
      || output.mediaUrl !== payload.media_url || output.imageRevision) return null;
    return Object.freeze({ ...common, output: "image", outputId, generationId: payload.generation_id, contentRef: payload.output_ref, mediaUrl: payload.media_url });
  } catch { return null; }
}
