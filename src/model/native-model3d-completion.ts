import {
  captureNativeOutputHandle, nativeOutputCompletionPath, parseNativeOutputCompletionUrl,
  validateNativeOutputCompletion, nativeOutputRetainedRoute, NATIVE_OUTPUT_COMPLETION_MAX_BYTES,
  type NativeOutputHandle, type NativeOutputCompletion,
} from "./native-output-completion.ts";

export type NativeModel3dHandle = NativeOutputHandle;
export type NativeModel3dCompletion = NativeOutputCompletion<"model3d">;
export const NATIVE_MODEL3D_COMPLETION_MAX_BYTES = NATIVE_OUTPUT_COMPLETION_MAX_BYTES;
export const captureNativeModel3dHandle = captureNativeOutputHandle;
export const nativeModel3dCompletionPath = (value: NativeModel3dHandle): string => nativeOutputCompletionPath("model3d", value);
export const parseNativeModel3dCompletionUrl = (value: string): NativeModel3dHandle | null => parseNativeOutputCompletionUrl("model3d", value);
export const validateNativeModel3dCompletion = (value: unknown, expected: NativeModel3dHandle, now = Date.now()): NativeModel3dCompletion | null =>
  validateNativeOutputCompletion("model3d", value, expected, now);
export const nativeModel3dRetainedRoute = (value: unknown, expected: NativeModel3dHandle): string | null => nativeOutputRetainedRoute("model3d", value, expected);
