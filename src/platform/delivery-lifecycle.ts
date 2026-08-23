/** Canonical release-evidence lifecycle shared by storage, authorization, and review UI. */
export const DELIVERY_DECISION_STATUSES=["planned","running","failed","passed","approval_required","approved","revoked","superseded"] as const;

export type DeliveryDecisionStatus=typeof DELIVERY_DECISION_STATUSES[number];

const historicalAliases:Record<string,DeliveryDecisionStatus>={active:"running",blocked:"failed",ready:"approval_required",completed:"passed"};

export function canonicalDeliveryStatus(value:unknown):DeliveryDecisionStatus|null{
  if(typeof value!=="string")return null;
  if((DELIVERY_DECISION_STATUSES as readonly string[]).includes(value))return value as DeliveryDecisionStatus;
  return historicalAliases[value]??null;
}

const transitions:Record<DeliveryDecisionStatus,readonly DeliveryDecisionStatus[]>={
  planned:["planned","running","failed","superseded"],
  running:["running","failed","passed","superseded"],
  failed:["failed","running","superseded"],
  passed:["passed","running","approval_required","superseded"],
  approval_required:["approval_required","failed","approved","superseded"],
  approved:["approved","revoked","superseded"],
  revoked:["revoked","running","superseded"],
  superseded:["superseded"],
};

export const deliveryTransitionAllowed=(previous:unknown,next:DeliveryDecisionStatus)=>{
  const canonical=canonicalDeliveryStatus(previous);
  return canonical?transitions[canonical].includes(next):false;
};

export const deliveryNeedsEvidence=(status:DeliveryDecisionStatus)=>["passed","approval_required","approved","revoked"].includes(status);
export const deliveryNeedsCompleteDependencies=(status:DeliveryDecisionStatus)=>["passed","approval_required","approved"].includes(status);
export const deliveryNeedsReleaseAuthority=(status:DeliveryDecisionStatus)=>status==="approved"||status==="revoked";
