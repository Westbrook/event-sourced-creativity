import {
  captureNativeOutputHandle, nativeOutputCompletionPath, parseNativeOutputCompletionUrl,
  validateNativeOutputCompletion, nativeOutputRetainedRoute, NATIVE_OUTPUT_COMPLETION_MAX_BYTES,
  type NativeOutputHandle, type NativeOutputCompletion,
} from "./native-output-completion.ts";

export type NativeAudioHandle = NativeOutputHandle;
export type NativeAudioCompletion = NativeOutputCompletion<"audio">;
export const NATIVE_AUDIO_COMPLETION_MAX_BYTES = NATIVE_OUTPUT_COMPLETION_MAX_BYTES;
export const captureNativeAudioHandle = captureNativeOutputHandle;
export const nativeAudioCompletionPath = (value: NativeAudioHandle): string => nativeOutputCompletionPath("audio", value);
export const parseNativeAudioCompletionUrl = (value: string): NativeAudioHandle | null => parseNativeOutputCompletionUrl("audio", value);
export const validateNativeAudioCompletion = (value: unknown, expected: NativeAudioHandle, now = Date.now()): NativeAudioCompletion | null =>
  validateNativeOutputCompletion("audio", value, expected, now);
export const nativeAudioRetainedRoute = (value: unknown, expected: NativeAudioHandle): string | null => nativeOutputRetainedRoute("audio", value, expected);
