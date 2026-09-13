export type ExperienceImageRatio = Readonly<{ width: number; height: number }>;
export type ExperienceImageRatioChoice = ExperienceImageRatio & Readonly<{
  label: string; dimensions: Readonly<{ width: number; height: number }>;
}>;
/** Bounded metadata from canonical outputExactImageRender + provider dimensions
 * validation at Sites254/255. These are geometry choices, not provider/admission
 * qualification. No default is defined; an authored selection is required.
 */
export const EXPERIENCE_IMAGE_RATIOS: readonly ExperienceImageRatioChoice[] = Object.freeze([
  { width: 1, height: 1, label: "1:1", dimensions: { width: 1024, height: 1024 } },
  { width: 3, height: 2, label: "3:2", dimensions: { width: 1536, height: 1024 } },
  { width: 2, height: 3, label: "2:3", dimensions: { width: 1024, height: 1536 } },
  { width: 4, height: 5, label: "4:5", dimensions: { width: 1024, height: 1280 } },
  { width: 5, height: 4, label: "5:4", dimensions: { width: 1280, height: 1024 } },
  { width: 16, height: 9, label: "16:9", dimensions: { width: 2048, height: 1152 } },
  { width: 9, height: 16, label: "9:16", dimensions: { width: 1152, height: 2048 } },
].map(item => Object.freeze({ ...item, dimensions: Object.freeze(item.dimensions) })));
export function readExperienceImageRatio(value: unknown): ExperienceImageRatio | null {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== 2 || !Object.hasOwn(descriptors, "width") || !Object.hasOwn(descriptors, "height")
    || Object.values(descriptors).some(item => !item.enumerable || item.get || item.set)) return null;
  const width: unknown = descriptors.width.value, height: unknown = descriptors.height.value;
  return EXPERIENCE_IMAGE_RATIOS.some(item => item.width === width && item.height === height)
    ? Object.freeze({ width: width as number, height: height as number }) : null;
}
export function experienceImageFormat(value: unknown) {
  const ratio = readExperienceImageRatio(value), choice = ratio && EXPERIENCE_IMAGE_RATIOS.find(item => item.width === ratio.width && item.height === ratio.height);
  return choice ? Object.freeze({ schema_version: 1 as const, aspect_ratio: ratio!, dimensions: Object.freeze({ ...choice.dimensions, unit: "px" as const }) }) : null;
}
