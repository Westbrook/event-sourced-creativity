export type PresentationReadingPreference = boolean | null;

export type PresentationViewPosture = {
  contentOverflows: boolean;
  readingPreference: PresentationReadingPreference;
  viewportRequiresReading: boolean;
};

/**
 * Preserve a deliberate audience choice while keeping safe responsive defaults.
 *
 * Overflow is a repair/diagnostic signal, not permission to replace a desktop
 * artboard with raw reading text. Keep the visual mounted so revised content and
 * late fonts can be remeasured. Narrow viewports retain the accessible default.
 */
export const presentationUsesReadingView = ({
  readingPreference,
  viewportRequiresReading,
}: PresentationViewPosture): boolean =>
  readingPreference ?? viewportRequiresReading;
