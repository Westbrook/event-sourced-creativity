/** Readable history emitted only by dedicated Output commands; never generic client mutations. */
export const OUTPUT_REQUIREMENT_EVENT_TYPES = [
  "OutputPlanConfirmed", "OutputPlanPreflighted", "OutputExecutionAuthorized", "OutputExecutionRunRequested",
  "OutputAssetAdopted", "OutputResultBound", "OutputTargetAccepted", "OutputTargetChangesRequested", "OutputFulfillmentSelected", "OutputDeliveryPrepared",
] as const;

const outputRequirementEvents = new Set<string>(OUTPUT_REQUIREMENT_EVENT_TYPES);
export const isOutputRequirementEvent = (type: string) => outputRequirementEvents.has(type);
