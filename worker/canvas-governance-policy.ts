import type { WorkerEnv } from "./runtime";

export const CANVAS_GOVERNANCE_VERSION = "canvas-pilot-2026-08-20";
export const CANVAS_GOVERNANCE_REQUIREMENTS = ["trust_safety", "counsel", "second_image_adapter"] as const;
export type CanvasGovernanceRequirementId = typeof CANVAS_GOVERNANCE_REQUIREMENTS[number];
export type CanvasGovernanceRequirement = {
  id: CanvasGovernanceRequirementId;
  label: string;
  summary: string;
  approved: boolean;
  approvedBy: string | null;
  approvedByUserId: string | null;
  approvedAt: string | null;
  evidenceRef: string | null;
  details: Record<string, unknown>;
};
export type CanvasGovernance = {
  version: string;
  mode: "internal" | "pilot";
  pilotAvailable: boolean;
  access: boolean;
  accessReason: "administrator-internal-review" | "pilot-approved" | "pilot-gate-incomplete" | "role-not-eligible";
  requirements: CanvasGovernanceRequirement[];
  blockedBy: CanvasGovernanceRequirementId[];
};

const definitions: Record<CanvasGovernanceRequirementId, Pick<CanvasGovernanceRequirement, "label" | "summary">> = {
  trust_safety: { label: "Trust & Safety ownership", summary: "A named owner accepts accountability for the Canvas safety and consent boundary." },
  counsel: { label: "Counsel finding", summary: "Counsel has cleared the consent, offline-custody, rights-propagation, and jurisdiction language." },
  second_image_adapter: { label: "Second image-adapter contract", summary: "A second image adapter is contracted, registered, and evaluated against the same frozen Canvas corpus." },
};

type GovernanceRow = { requirement_id:string; status:string; approved_by_user_id:string|null; approved_by_name:string|null; approved_at:string|null; evidence_ref:string|null; details_json:string|null };

export async function readCanvasGovernance(env:WorkerEnv,role:string):Promise<CanvasGovernance>{
  const result=await env.DB.prepare("SELECT requirement_id,status,approved_by_user_id,approved_by_name,approved_at,evidence_ref,details_json FROM canvas_governance_requirements").all<GovernanceRow>();
  const rows=new Map(result.results.map((row)=>[row.requirement_id,row]));
  const requirements=CANVAS_GOVERNANCE_REQUIREMENTS.map((id)=>{const row=rows.get(id);let details:Record<string,unknown>={};let evidenceValid=true;try{details=row?.details_json?JSON.parse(row.details_json) as Record<string,unknown>:{};}catch{evidenceValid=false;}return{id,...definitions[id],approved:row?.status==="approved"&&evidenceValid,approvedBy:row?.approved_by_name??null,approvedByUserId:row?.approved_by_user_id??null,approvedAt:row?.approved_at??null,evidenceRef:row?.evidence_ref??null,details};});
  const blockedBy=requirements.filter((item)=>!item.approved).map((item)=>item.id);const pilotAvailable=blockedBy.length===0;const internal=role==="admin";const eligible=role==="creator"||role==="viewer";
  return{version:CANVAS_GOVERNANCE_VERSION,mode:pilotAvailable?"pilot":"internal",pilotAvailable,access:internal||pilotAvailable&&eligible,accessReason:internal&&!pilotAvailable?"administrator-internal-review":pilotAvailable&&eligible||internal?"pilot-approved":eligible?"pilot-gate-incomplete":"role-not-eligible",requirements,blockedBy};
}

export const isCanvasGovernanceRequirement=(value:unknown):value is CanvasGovernanceRequirementId=>CANVAS_GOVERNANCE_REQUIREMENTS.includes(String(value) as CanvasGovernanceRequirementId);
