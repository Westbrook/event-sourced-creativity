import { captureStoryboardRawEnvelope, storyboardEnvelopeText, type StoryboardRawEnvelope } from "./output-storyboard-envelope.ts";
export type VideoPlannerRawEnvelope = Omit<StoryboardRawEnvelope, "version"> & { readonly version: "output-video-planner-envelope-v1" };
/** Reuse the tested bounded byte reader. Only the artifact tag differs; no
 * parsing, candidate substitution or accounting occurs during custody. */
export async function captureVideoPlannerEnvelope(response: Response, identity: { clientRequestId: string; requestDigest: string; model: string }, signal?: AbortSignal): Promise<VideoPlannerRawEnvelope> {
  const raw = await captureStoryboardRawEnvelope(response, identity, signal);
  return Object.freeze({ ...raw, version: "output-video-planner-envelope-v1" });
}
export function videoPlannerEnvelopeText(envelope: VideoPlannerRawEnvelope) {
  if (envelope.version !== "output-video-planner-envelope-v1") throw new Error("output_video_planner_envelope_invalid");
  return storyboardEnvelopeText({ ...envelope, version: "output-storyboard-raw-envelope-v1" });
}
