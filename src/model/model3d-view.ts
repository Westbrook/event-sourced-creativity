export type Model3dVector = [number, number, number];
export type Model3dBackground = "transparent" | "#ffffff" | "#18181b";
export type Model3dViewPreset = "perspective" | "front" | "back" | "left" | "right" | "top";

/** Camera coordinates use a centered model whose longest bounding-box side is 2. */
export type Model3dView = {
  version: 1;
  position: Model3dVector;
  target: Model3dVector;
  fov: 35;
  background: Model3dBackground;
};

export type Model3dCaptureDetail = { blob: Blob; view: Model3dView; src: string };

export const MODEL3D_CAPTURE_SIZE = 1024;
export const MODEL3D_MIN_DISTANCE = 1.8;
export const MODEL3D_MAX_DISTANCE = 20;

const PRESET_POSITIONS: Record<Model3dViewPreset, Model3dVector> = {
  perspective: [3.6, 2.7, 4.5],
  front: [0, 0, 6.4],
  back: [0, 0, -6.4],
  left: [-6.4, 0, 0],
  right: [6.4, 0, 0],
  top: [0, 6.4, 0.00001],
};

export function model3dPresetView(preset: Model3dViewPreset = "perspective", background: Model3dBackground = "#ffffff"): Model3dView {
  return { version: 1, position: [...PRESET_POSITIONS[preset]], target: [0, 0, 0], fov: 35, background };
}

function vector(value: unknown): Model3dVector | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const entries: unknown[] = Array.from(value);
  if (entries.some((entry) => typeof entry !== "number" || !Number.isFinite(entry) || Math.abs(entry) > 32)) return null;
  return entries.map((entry) => Math.round((entry as number) * 1e6) / 1e6) as Model3dVector;
}

/** Reject unusable persisted cameras rather than opening an empty or unstable view. */
export function normalizeModel3dView(value: unknown): Model3dView | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<Model3dView>;
  if (candidate.version !== 1 || candidate.fov !== 35 || typeof candidate.background !== "string" || !["transparent", "#ffffff", "#18181b"].includes(candidate.background)) return null;
  const position = vector(candidate.position); const target = vector(candidate.target);
  if (!position || !target || Math.hypot(...target) > 2.000001) return null;
  const distance = Math.hypot(...position.map((entry, index) => entry - target[index]));
  if (distance < MODEL3D_MIN_DISTANCE - 0.000001 || distance > MODEL3D_MAX_DISTANCE + 0.000001) return null;
  return { version: 1, position, target, fov: 35, background: candidate.background as Model3dBackground };
}

/** A viewer never opens a provider URL or a file outside Forma's media route. */
export function isModel3dMediaSource(value: unknown): value is string {
  if (typeof value !== "string" || !value.startsWith("/api/media/") && !value.startsWith("/api/shared/")) return false;
  try {
    const path = decodeURIComponent(value.split(/[?#]/u, 1)[0]);
    if (path.includes("\\") || path.split("/").some((segment) => segment === "." || segment === "..")) return false;
    const url = new URL(value, "https://forma.invalid");
    return url.origin === "https://forma.invalid" && !url.username && !url.password && !url.hash
      && (url.pathname.startsWith("/api/media/") || url.pathname.startsWith("/api/shared/"));
  } catch { return false; }
}
