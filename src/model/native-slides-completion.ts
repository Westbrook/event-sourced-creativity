import {
  captureNativeOutputHandle, nativeOutputCompletionPath, parseNativeOutputCompletionUrl,
  validateNativeOutputCompletion, nativeOutputRetainedRoute, NATIVE_OUTPUT_COMPLETION_MAX_BYTES,
  type NativeOutputHandle, type NativeOutputCompletion,
} from "./native-output-completion.ts";

export type NativeSlidesHandle = NativeOutputHandle;
export type NativeSlidesCompletion = NativeOutputCompletion<"slides">;
export const NATIVE_SLIDES_COMPLETION_MAX_BYTES = NATIVE_OUTPUT_COMPLETION_MAX_BYTES;
export const captureNativeSlidesHandle = captureNativeOutputHandle;
export const nativeSlidesCompletionPath = (value: NativeSlidesHandle): string => nativeOutputCompletionPath("slides", value);
export const parseNativeSlidesCompletionUrl = (value: string): NativeSlidesHandle | null => parseNativeOutputCompletionUrl("slides", value);
export const validateNativeSlidesCompletion = (value: unknown, expected: NativeSlidesHandle, now = Date.now()): NativeSlidesCompletion | null =>
  validateNativeOutputCompletion("slides", value, expected, now);
export const nativeSlidesRetainedRoute = (value: unknown, expected: NativeSlidesHandle): string | null => nativeOutputRetainedRoute("slides", value, expected);
