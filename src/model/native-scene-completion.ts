import {
  captureNativeOutputHandle, nativeOutputCompletionPath, parseNativeOutputCompletionUrl,
  validateNativeOutputCompletion, nativeOutputRetainedRoute, NATIVE_OUTPUT_COMPLETION_MAX_BYTES,
  type NativeOutputHandle, type NativeOutputCompletion,
} from "./native-output-completion.ts";

export type NativeSceneHandle = NativeOutputHandle;
export type NativeSceneCompletion = NativeOutputCompletion<"scene">;
export const NATIVE_SCENE_COMPLETION_MAX_BYTES = NATIVE_OUTPUT_COMPLETION_MAX_BYTES;
export const captureNativeSceneHandle = captureNativeOutputHandle;
export const nativeSceneCompletionPath = (value: NativeSceneHandle): string => nativeOutputCompletionPath("scene", value);
export const parseNativeSceneCompletionUrl = (value: string): NativeSceneHandle | null => parseNativeOutputCompletionUrl("scene", value);
export const validateNativeSceneCompletion = (value: unknown, expected: NativeSceneHandle, now = Date.now()): NativeSceneCompletion | null =>
  validateNativeOutputCompletion("scene", value, expected, now);
export const nativeSceneRetainedRoute = (value: unknown, expected: NativeSceneHandle): string | null => nativeOutputRetainedRoute("scene", value, expected);
