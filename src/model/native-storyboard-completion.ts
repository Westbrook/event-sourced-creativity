import {
  captureNativeOutputHandle, nativeOutputCompletionPath, parseNativeOutputCompletionUrl,
  validateNativeOutputCompletion, nativeOutputRetainedRoute, NATIVE_OUTPUT_COMPLETION_MAX_BYTES,
  type NativeOutputHandle, type NativeOutputCompletion,
} from "./native-output-completion.ts";

export type NativeStoryboardHandle = NativeOutputHandle;
export type NativeStoryboardCompletion = NativeOutputCompletion<"storyboard">;
export const NATIVE_STORYBOARD_COMPLETION_MAX_BYTES = NATIVE_OUTPUT_COMPLETION_MAX_BYTES;
export const captureNativeStoryboardHandle = captureNativeOutputHandle;
export const nativeStoryboardCompletionPath = (value: NativeStoryboardHandle): string => nativeOutputCompletionPath("storyboard", value);
export const parseNativeStoryboardCompletionUrl = (value: string): NativeStoryboardHandle | null => parseNativeOutputCompletionUrl("storyboard", value);
export const validateNativeStoryboardCompletion = (value: unknown, expected: NativeStoryboardHandle, now = Date.now()): NativeStoryboardCompletion | null =>
  validateNativeOutputCompletion("storyboard", value, expected, now);
export const nativeStoryboardRetainedRoute = (value: unknown, expected: NativeStoryboardHandle): string | null => nativeOutputRetainedRoute("storyboard", value, expected);
