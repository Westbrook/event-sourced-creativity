/** Still unified creation v19. Protected payloads; never copy source/review into public events. */
import type { BlockIntent, BlockKind } from './block-types.ts';
import type { CreativeBlock, CreativeBlockRelation, EventInput } from './events.ts';
import type { IdeaBodyV1 } from './idea-body.ts';
export const CREATION_SCHEMA_VERSION = 1 as const;
export const CREATION_LIMITS = { compiledEvents: 512, envelopeBytes: 1_000_000 } as const;
export type CreationEntryKind = 'project'|'document'|'idea';
export type CreationScope = { actorUserId:string; projectId:string|null; documentId:string|null; custodyKey:string; permissionEpoch:string|number };
export type SourceEvidence = { kind:'span'; start:number; end:number; quote:string } | {kind:'existing'; blockId:string; projectId:string; revision:string; hash:string; excerpt?:string} | {kind:'correction'; decisionId:string};
export type CreationMarker = {id:string; start:number; end:number; text:string; kind:'command'|'reference'|'declaration'; targetId?:string};
export type ReferenceSelection = {id:string; projectId:string; rootIds:string[]; sourceDocumentId?:string; sources:DependencyVersion[]};
export type Decision = {id:string; kind:'remove'|'merge'|'keep-together'|'variation'|'partial'|'correction'|'undo'; nodeIds:string[]; revision:number; accepted:boolean; sourceRanges?:Array<{start:number;end:number}>; undoOf?:string; detail?:string};
export type DecisionLedger = Decision[];
export type ProposedNode = {id:string; kind:CreationEntryKind; projectId:string; title:string; revision:number; disposition:'retained'|'merged'|'removed'; sourceEvidence:SourceEvidence[]; body?:IdeaBodyV1; text?:string; type?:BlockKind; subtype?:string; intent?:BlockIntent; preferredOutputKinds?:string[]; mergedInto?:string; provenance?:SourceEvidence[]};
export type DependencyVersion = {id:string; projectId:string; revision:string; hash:string};
export type ProposedUse = {id:string; documentId:string; ideaId:string; order:number; revision:number; disposition:'retained'|'removed'; dependencyManifest:DependencyVersion[]};
export type ProposedReference = {id:string; fromId:string; toId:string; kind:'semantic'; sourceEvidence:SourceEvidence[]};
export type CoverageEntry = {start:number; end:number; nodeIds:string[]; decisionId?:string};
export type CreationIssue = {code:string; message:string; nodeId?:string; useId?:string; blocking:boolean};
export type CreationPlan = {schemaVersion:1; draftId:string; draftRevision:number; entryKind:CreationEntryKind; scope:CreationScope; sourceText:string; nodes:ProposedNode[]; uses:ProposedUse[]; references:ProposedReference[]; issues:CreationIssue[]; coverage:CoverageEntry[]; decisions:DecisionLedger; modelVersion:string; compiledEventBound:number; titleOnly?:boolean};
export type ReviewEntry = {presentedHash?:string; approvedHash?:string; complete:boolean; coveredUseHashes?:Record<string,string>};
export type ReviewState = {schemaVersion:1; nodes:Record<string,ReviewEntry>; uses:Record<string,ReviewEntry>; stage:'ideas'|'documents'|'project'|'final'; currentId?:string; lastAcknowledgedRevision:number; finalApprovalHash?:string};
export type CreationDraft = {schemaVersion:1; id:string; scope:CreationScope; entryKind:CreationEntryKind; revision:number; originalDocument:IdeaBodyV1['document']; workingDocument:IdeaBodyV1['document']; markers:CreationMarker[]; acknowledgedRevision:number; referenceSelections:ReferenceSelection[]; decisions:DecisionLedger; expiresAt:string; plan?:CreationPlan; correctionBaseline?:CreationPlan; partialIdeas?:ProposedNode[]; review?:ReviewState; state:'editing'|'review'|'saving'|'saved'|'discarded'; operationId?:string};
export type CreationReceipt = {schemaVersion:1; operationId:string; previewId:string; approvalHash:string; idMap:Record<string,string>; created:Array<{id:string;kind:CreationEntryKind}>; uses:Array<{documentId:string;ideaId:string}>; status:'committed'|'no-change'; projectId:string; primaryDocumentId:string|null};
/** Server-supplied current facts, never accepted from a model/client authority assertion. */
export type CreationAuthority = {actorUserId:string; custodyKey:string; permissionEpoch:string|number; canCreateProject:boolean; canAuthorProject:boolean; projectId:string|null; documentIds:string[]; existingBlocks:CreativeBlock[]; existingRelations:CreativeBlockRelation[]; existingVersions:DependencyVersion[]; allocatedIds:Record<string,string>; occupiedIds:string[]; selectedRootIds?:string[]};
export type CompiledCreation = {status:'ready'|'no-change';changedUses:Array<{documentId:string;ideaId:string}>;events:EventInput[]; idMap:Record<string,string>; projectId:string; primaryDocumentId:string|null; approvalHash:string; nodeHashes:Record<string,string>; useHashes:Record<string,string>};
