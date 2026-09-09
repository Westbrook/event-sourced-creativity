import {
  captureNativeOutputHandle, nativeOutputCompletionPath, parseNativeOutputCompletionUrl,
  validateNativeOutputCompletion, nativeOutputRetainedRoute, NATIVE_OUTPUT_COMPLETION_MAX_BYTES,
  type NativeOutputHandle, type NativeOutputCompletion,
} from "./native-output-completion.ts";

export type NativeVideoHandle = NativeOutputHandle;
export type NativeVideoCompletion = NativeOutputCompletion<"video">;
export const NATIVE_VIDEO_COMPLETION_MAX_BYTES = NATIVE_OUTPUT_COMPLETION_MAX_BYTES;
export const captureNativeVideoHandle = captureNativeOutputHandle;
export const nativeVideoCompletionPath = (value: NativeVideoHandle): string => nativeOutputCompletionPath("video", value);
export const parseNativeVideoCompletionUrl = (value: string): NativeVideoHandle | null => parseNativeOutputCompletionUrl("video", value);
export const validateNativeVideoCompletion = (value: unknown, expected: NativeVideoHandle, now = Date.now()): NativeVideoCompletion | null =>
  validateNativeOutputCompletion("video", value, expected, now);
export const nativeVideoRetainedRoute = (value: unknown, expected: NativeVideoHandle): string | null => nativeOutputRetainedRoute("video", value, expected);
