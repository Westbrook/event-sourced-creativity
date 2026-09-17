import { copySelectedOutputShareAudioBytes, SELECTED_OUTPUT_SHARE_AUDIO_POLICY,
  type QualifiedSelectedOutputShareAudio } from "./selected-output-share-audio.ts";
import { copySelectedOutputShareVideoBytes, SELECTED_OUTPUT_SHARE_VIDEO_POLICY, SELECTED_OUTPUT_SHARE_VIDEO_X264_POLICY,
  type QualifiedSelectedOutputShareVideo } from "./selected-output-share-video.ts";
import { copySelectedOutputShareModel3dBytes, SELECTED_OUTPUT_SHARE_MODEL3D_POLICY, SELECTED_OUTPUT_SHARE_MODEL3D_TEXTURE_POLICY,
  type QualifiedSelectedOutputShareModel3d, type QualifiedSelectedOutputShareTexturedModel3d } from "./selected-output-share-model3d.ts";
import { isSelectedOutputShareStableAudioSelection, parseSelectedOutputShareStableAudioSelection,
  type SelectedOutputShareStableAudioSelection } from "./selected-output-share-mp3-contract.ts";

/** Declared selection only. No value in this module proves canonical custody. */
type DeclaredSelection = Readonly<{ documentId: string; artifactId: string; revision: number; contentSha256: string; mediaSha256: string }>;
export type SelectedOutputShareExactMediaSelection = DeclaredSelection & (
  | Readonly<{ output: "audio"; policy: typeof SELECTED_OUTPUT_SHARE_AUDIO_POLICY }>
  | Readonly<{ output: "video"; policy: typeof SELECTED_OUTPUT_SHARE_VIDEO_POLICY | typeof SELECTED_OUTPUT_SHARE_VIDEO_X264_POLICY }>
  | Readonly<{ output: "model3d"; policy: typeof SELECTED_OUTPUT_SHARE_MODEL3D_POLICY | typeof SELECTED_OUTPUT_SHARE_MODEL3D_TEXTURE_POLICY }>
);
export type SelectedOutputShareMediaSelection = SelectedOutputShareExactMediaSelection | SelectedOutputShareStableAudioSelection;
type AssetFacts = Readonly<{ sha256: string; byteLength: number }>;
/** Finite recipient data only: no URL/key, filename, private identity or source. */
export type SelectedOutputShareMediaDescriptor = AssetFacts & (
  | Readonly<{ kind: "audio"; mimeType: "audio/wav"; sampleRate: number; channels: number; sampleCount: number;
    durationSeconds: number; durationBasis: "pcm-samples" }>
  | Readonly<{ kind: "video"; mimeType: "video/mp4"; width: number; height: number; durationSeconds: number }>
  | Readonly<{ kind: "model3d"; mimeType: "model/gltf-binary" }>
);
declare const attachedMedia: unique symbol;
export type SelectedOutputShareMediaAttachment = Readonly<{
  [attachedMedia]: true;
  /** Private, declared identity and exact requested profile. Never send as public output. */
  selection: SelectedOutputShareExactMediaSelection;
  descriptor: SelectedOutputShareMediaDescriptor;
}>;

const attachments = new WeakMap<SelectedOutputShareMediaAttachment, Uint8Array<ArrayBuffer>>();
const keys = ["output", "documentId", "artifactId", "revision", "contentSha256", "mediaSha256", "policy"] as const;
const identifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;
const digest = /^[a-f0-9]{64}$/u;

/** Descriptor capture does not call accessors/serialization hooks. A valid
 * declared identity is not evidence that the selected Document/output exists. */
export function parseSelectedOutputShareMediaSelection(value: unknown): SelectedOutputShareMediaSelection | null {
  try {
    const derivative = parseSelectedOutputShareStableAudioSelection(value);
    if (derivative) return derivative;
    if (value === null || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype
      && Object.getPrototypeOf(value) !== null) return null;
    const names = Reflect.ownKeys(value), captured: Record<string, unknown> = Object.create(null);
    if (names.length !== keys.length || names.some(name => typeof name !== "string" || !keys.includes(name as typeof keys[number]))) return null;
    for (const key of keys) {
      const field = Object.getOwnPropertyDescriptor(value, key);
      if (!field?.enumerable || !Object.hasOwn(field, "value")) return null;
      captured[key] = field.value;
    }
    if (![captured.documentId, captured.artifactId].every(id => typeof id === "string" && identifier.test(id))
      || typeof captured.revision !== "number" || !Number.isSafeInteger(captured.revision) || captured.revision < 0
      || ![captured.contentSha256, captured.mediaSha256].every(hash => typeof hash === "string" && digest.test(hash))) return null;
    const { output, policy } = captured;
    if (!(output === "audio" && policy === SELECTED_OUTPUT_SHARE_AUDIO_POLICY
      || output === "video" && (policy === SELECTED_OUTPUT_SHARE_VIDEO_POLICY || policy === SELECTED_OUTPUT_SHARE_VIDEO_X264_POLICY)
      || output === "model3d" && (policy === SELECTED_OUTPUT_SHARE_MODEL3D_POLICY || policy === SELECTED_OUTPUT_SHARE_MODEL3D_TEXTURE_POLICY))) return null;
    return Object.freeze(captured) as SelectedOutputShareExactMediaSelection;
  } catch { return null; }
}

/** Attach exactly one already-qualified local byte object. The profile is
 * explicitly requested: no automatic fallback to a broader policy is allowed.
 * At most one gate accessor is called and one complete owned copy is retained.
 * No native DTO, caller-selected URL, Request, actor or permission is accepted.
 */
export function attachSelectedOutputShareMedia(selection: unknown, qualification: unknown): SelectedOutputShareMediaAttachment | null {
  let bytes: Uint8Array<ArrayBuffer> | null = null, retained = false;
  try {
    const selected = parseSelectedOutputShareMediaSelection(selection);
    // This factory owns exact bytes only. A derivative declaration cannot use
    // a WAV qualification as an MP3 custody or projection witness.
    if (!selected || isSelectedOutputShareStableAudioSelection(selected)) return null;
    let descriptor: SelectedOutputShareMediaDescriptor;
    if (selected.output === "audio") {
      bytes = copySelectedOutputShareAudioBytes(qualification);
      if (!bytes) return null;
      // The gate's private WeakMap proved the object before any fields are read.
      const audio = qualification as QualifiedSelectedOutputShareAudio;
      if (audio.policy !== selected.policy || audio.sha256 !== selected.mediaSha256 || audio.byteLength !== bytes.length) return null;
      descriptor = { kind: "audio", mimeType: audio.mimeType, sha256: audio.sha256, byteLength: audio.byteLength,
        sampleRate: audio.sampleRate, channels: audio.channels, sampleCount: audio.sampleCount,
        durationSeconds: audio.durationSeconds, durationBasis: audio.durationBasis };
    } else if (selected.output === "video") {
      bytes = copySelectedOutputShareVideoBytes(qualification);
      if (!bytes) return null;
      const video = qualification as QualifiedSelectedOutputShareVideo<typeof SELECTED_OUTPUT_SHARE_VIDEO_POLICY | typeof SELECTED_OUTPUT_SHARE_VIDEO_X264_POLICY>;
      if (video.policy !== selected.policy || video.sha256 !== selected.mediaSha256 || video.byteLength !== bytes.length) return null;
      descriptor = { kind: "video", mimeType: video.mimeType, sha256: video.sha256, byteLength: video.byteLength,
        width: video.width, height: video.height, durationSeconds: video.durationSeconds };
    } else {
      bytes = copySelectedOutputShareModel3dBytes(qualification);
      if (!bytes) return null;
      const model = qualification as QualifiedSelectedOutputShareModel3d | QualifiedSelectedOutputShareTexturedModel3d;
      if (model.policy !== selected.policy || model.sha256 !== selected.mediaSha256 || model.byteLength !== bytes.length) return null;
      descriptor = { kind: "model3d", mimeType: model.mimeType, sha256: model.sha256, byteLength: model.byteLength };
    }
    const attachment = Object.freeze({ selection: selected, descriptor: Object.freeze(descriptor) }) as SelectedOutputShareMediaAttachment;
    attachments.set(attachment, bytes); retained = true;
    return attachment;
  } catch { return null; }
  finally { if (!retained) bytes?.fill(0); }
}

/** A fresh copy of exactly the attachment's locally owned bytes. Callers still
 * need current native custody, approval, token/lifetime and final read proofs.
 * Serialized/copied attachments cannot recover bytes or confer authorization. */
export function copySelectedOutputShareMediaBytes(attachment: unknown): Uint8Array<ArrayBuffer> | null {
  if (attachment === null || typeof attachment !== "object") return null;
  const bytes = attachments.get(attachment as SelectedOutputShareMediaAttachment);
  return bytes ? new Uint8Array(bytes) : null;
}
