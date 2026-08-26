export type PresentationReadingPreference = boolean | null;

export type PresentationViewPosture = {
  contentOverflows: boolean;
  readingPreference: PresentationReadingPreference;
  viewportRequiresReading: boolean;
};

/**
 * Preserve a deliberate audience choice while keeping safe responsive defaults.
 *
 * Content that does not fit defaults to its complete semantic reading alternative,
 * but choosing "Slide view" must still recover a previously replaced visual slide.
 * This is especially important after auxiliary source evidence was removed from
 * the audience artboard: an old fit measurement cannot permanently trap a deck.
 */
export const presentationUsesReadingView = ({
  contentOverflows,
  readingPreference,
  viewportRequiresReading,
}: PresentationViewPosture): boolean =>
  readingPreference ?? (viewportRequiresReading || contentOverflows);
