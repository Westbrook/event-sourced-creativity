import type { CreativeEvent, CreativeProjection } from "./events.ts";
import type { AssignedReviewTask } from "../state/store.ts";
import { documentArtifactRevision, DOCUMENT_ARTIFACT_KINDS } from "./document-artifacts.ts";
import { describeOutputs, qualifyDisplayCollisions } from "./output-naming.ts";
import { creativeActionSourceRevision, creativePreparationChoice, requestedCreativeMedium, type CreativeMedium, type CreativeNextTarget, type CreativeWorkspaceFacts } from "./workspace-intelligence.ts";

export type CommandReviewIdentity = Pick<AssignedReviewTask, "id" | "organizationId" | "projectAccessId" | "projectId" | "documentId" | "artifactId" | "revision" | "contentSha256">;
export type CommandDiscoveryTarget =
  | { kind:"project"; projectId:string; createdSequence:number }
  | { kind:"document"; projectId:string; documentId:string; createdSequence:number }
  | { kind:"decision"; projectId:string; documentId:string; canvasId:string; scope:"document"|"library"|"canvas"; blockId:string; sourceEvents:readonly string[] }
  | { kind:"image"; projectId:string; documentId:string; outputId:string; sequence:number; sourceEventId:string; mediaUrl:string }
  | { kind:"artifact"; projectId:string; documentId:string; artifactId:string; sequence:number; sourceEventId:string; contentRef:string|null; revision:number }
  | { kind:"review"; identity:CommandReviewIdentity }
  | { kind:"prepare"; target:Extract<CreativeNextTarget,{kind:"configure"}> };
export type CommandDiscoveryRow = {
  key:string; label:string; hint:string; terms:readonly string[]; target:CommandDiscoveryTarget; preparationChoice?:"generic"|CreativeMedium;
};
export type CommandDiscoveryCopy = {
  project:string; document:string; decision:string; review:string; saved:string; untitled:string;
  open:string; prepare:string; prepareFormat:string; generateAlias:string; reference:string;
  search:string; placeholder:string; scope:string; empty:string; unavailable:string; changed:string; chooseDocument:string; preparing:string;
};
export type CommandDiscoveryInput = {
  readable:boolean; authorityKey:string;
  projection:Pick<CreativeProjection,"projectId"|"documentId"|"projects"|"documents"|"libraryBlocks"|"libraryOutputs"|"libraryArtifacts">;
  events:readonly CreativeEvent[]; reviews:readonly AssignedReviewTask[];
  locale:string; copy:CommandDiscoveryCopy; formatLabel:(kind:CreativeMedium)=>string;
  /** The existing facts adapter owns eligibility. Null means no exact preparation document. */
  preparation:CreativeWorkspaceFacts|null;
};

export const normalizeCommandQuery=(value:string,locale:string)=>value.toLocaleLowerCase(locale).normalize("NFD")
  .replace(/(\p{Script=Latin})\p{Mark}+/gu,"$1").normalize("NFC");
export function commandMatchScore(row:Pick<CommandDiscoveryRow,"label"|"hint"|"terms">,query:string,locale:string):number{
  const wanted=normalizeCommandQuery(query,locale).trim();if(!wanted)return 0;
  const label=normalizeCommandQuery(row.label,locale),terms=[label,normalizeCommandQuery(row.hint,locale),...row.terms.map(value=>normalizeCommandQuery(value,locale))];
  if(terms.some(value=>value===wanted))return 0;
  if(terms.some(value=>value.startsWith(wanted)))return 1;
  return wanted.split(/\s+/u).every(token=>terms.some(value=>value.includes(token)))?2:-1;
}
export const commandReviewIdentity=(task:AssignedReviewTask):CommandReviewIdentity=>({
  id:task.id,organizationId:task.organizationId,projectAccessId:task.projectAccessId,projectId:task.projectId,
  documentId:task.documentId,artifactId:task.artifactId,revision:task.revision,contentSha256:task.contentSha256,
});
export function commandReviewMatches(identity:CommandReviewIdentity,task:AssignedReviewTask):boolean{
  return task.status==="pending"&&JSON.stringify(commandReviewIdentity(task))===JSON.stringify(identity);
}

/** A disposable view of already-readable metadata. No fetch, cache, permission or action policy. */
export function projectCommandDiscovery(input:CommandDiscoveryInput):CommandDiscoveryRow[]{
  if(!input.readable||!input.authorityKey)return[];
  const {projection:p,copy,formatLabel}=input,rows:CommandDiscoveryRow[]=[];
  const documents=p.documents.filter(document=>document.projectId===p.projectId&&!document.removed);
  const documentById=new Map(documents.map(document=>[document.id,document]));
  const project=p.projects.find(value=>value.id===p.projectId),projectName=project?.name??"";
  const add=(target:CommandDiscoveryTarget,title:string,hint:string,terms:readonly string[]=[],variant="")=>{
    const name=title||copy.untitled;
    rows.push({key:JSON.stringify([input.authorityKey,variant,target]),label:copy.open.replace("{name}",name),hint,terms:[name,...terms],target});
  };
  if(project)add({kind:"project",projectId:project.id,createdSequence:project.createdSequence},project.name,copy.project);
  for(const document of documents)add({kind:"document",projectId:p.projectId,documentId:document.id,createdSequence:document.createdSequence},
    document.title,[copy.document,projectName].filter(Boolean).join(" · "),[document.handle]);
  for(const block of p.libraryBlocks){
    if(block.removed||block.projectId!==p.projectId||block.type==="output"
      ||block.scope==="document"&&!documentById.has(block.documentId))continue;
    const title=typeof block.properties.label==="string"&&block.properties.label.trim()?block.properties.label:block.handle;
    add({kind:"decision",projectId:p.projectId,documentId:block.documentId,canvasId:block.canvasId,scope:block.scope,
      blockId:block.id,sourceEvents:[...block.sourceEvents]},title,
      [copy.decision,projectName,documentById.get(block.documentId)?.title,block.handle].filter(Boolean).join(" · "),[block.type,block.handle]);
  }
  const images=p.libraryOutputs.filter(output=>documentById.has(output.documentId)&&!output.discarded&&output.provider!=="simulation"&&Boolean(output.mediaUrl));
  const artifacts=p.libraryArtifacts.filter(artifact=>documentById.has(artifact.documentId));
  // Keep shared take/title naming without importing its optional private
  // summary, audience, tone or provider-prompt snippets into global search.
  const candidates=[...images.map(output=>({id:output.id,documentId:output.documentId,kind:"image" as const,title:output.title,
    titleSource:output.titleSource,sequence:output.sequence,sourceEventId:output.sourceEventId})),
    ...artifacts.map(artifact=>({id:artifact.id,documentId:artifact.documentId,kind:artifact.kind,title:artifact.title,
      titleSource:artifact.titleSource,sequence:artifact.sequence,sourceEventId:artifact.sourceEventId}))];
  const descriptions=describeOutputs(candidates,{events:input.events,locale:input.locale,formatKind:formatLabel,
    scopedLabels:{documents,formatDocument:number=>copy.document+" "+number,formatResult:number=>copy.saved+" "+number}});
  const names=new Map(descriptions.map((description,index)=>[JSON.stringify([candidates[index]!.documentId,candidates[index]!.kind,candidates[index]!.id]),description]));
  for(const output of images){
    const description=names.get(JSON.stringify([output.documentId,"image",output.id]));
    const title=description?.displayScope?.title??description?.title??output.title??formatLabel("image");
    add({kind:"image",projectId:p.projectId,documentId:output.documentId,outputId:output.id,sequence:output.sequence,
      sourceEventId:output.sourceEventId,mediaUrl:output.mediaUrl!},description?.displayScope?.context??[title,documentById.get(output.documentId)?.title].filter(Boolean).join(" · "),
      [copy.saved,formatLabel("image"),projectName].filter(Boolean).join(" · "),[title]);
  }
  for(const artifact of artifacts){
    const description=names.get(JSON.stringify([artifact.documentId,artifact.kind,artifact.id]));
    const title=description?.displayScope?.title??description?.title??artifact.title;
    add({kind:"artifact",projectId:p.projectId,documentId:artifact.documentId,artifactId:artifact.id,sequence:artifact.sequence,
      sourceEventId:artifact.sourceEventId,contentRef:artifact.contentRef??null,revision:documentArtifactRevision(input.events,artifact.id)},
      description?.displayScope?.context??[title,documentById.get(artifact.documentId)?.title].filter(Boolean).join(" · "),
      [copy.saved,formatLabel(artifact.kind),projectName].filter(Boolean).join(" · "),[title]);
  }
  // The caller supplies scopedFormaActivity's already-authorized assigned envelopes.
  for(const task of input.reviews){
    if(task.status!=="pending"||!Number.isSafeInteger(task.revision)||task.revision<0||!/^[a-f0-9]{64}$/u.test(task.contentSha256))continue;
    add({kind:"review",identity:commandReviewIdentity(task)},task.artifactTitle,
      [copy.review,task.organizationName,task.projectName,task.documentTitle].filter(Boolean).join(" · "));
  }
  const facts=input.preparation;
  if(facts?.canConfigure&&facts.canRead&&facts.authorityKey===input.authorityKey&&facts.projectId===p.projectId&&documentById.has(facts.documentId)&&facts.canvasId===null){
    const sourceRevision=creativeActionSourceRevision(facts),seed:Extract<CreativeNextTarget,{kind:"configure"}>={
      kind:"configure",projectId:facts.projectId,documentId:facts.documentId,canvasId:null,authorityKey:facts.authorityKey,sourceRevision,medium:null,
    };
    const title=documentById.get(facts.documentId)!.title;
    const choices:Array<{id:"generic"|CreativeMedium;medium:CreativeMedium|null;label:string}>=[
      {id:"generic",medium:requestedCreativeMedium(facts),label:copy.prepare},
      ...(["image",...DOCUMENT_ARTIFACT_KINDS] as const).map(medium=>({id:medium,medium,label:copy.prepareFormat.replace("{format}",formatLabel(medium))})),
    ];
    for(const choice of choices){
      const target=choice.medium?creativePreparationChoice(seed,choice.medium,facts):seed;if(!target)continue;
      rows.push({key:JSON.stringify([input.authorityKey,"prepare:"+choice.id,target]),preparationChoice:choice.id,label:choice.label,
        hint:[title,projectName,copy.preparing].filter(Boolean).join(" · "),
        terms:[title,...(choice.medium?[formatLabel(choice.medium)]:[]),...(choice.id==="generic"?[copy.generateAlias]:[])],
        target:{kind:"prepare",target}});
    }
  }
  // Shared presentation policy closes NFC/whitespace and composed-label collisions.
  // A visible fallback contains only the nonsecret object address, never row.key's
  // authority, content receipt, media URL or source-revision evidence.
  const references=new Map(rows.map(row=>{
    const target=row.target,ids=target.kind==="project"?[target.kind,target.projectId]
      :target.kind==="document"?[target.kind,target.projectId,target.documentId]
        :target.kind==="decision"?[target.kind,target.projectId,target.documentId,target.canvasId,target.scope,target.blockId]
          :target.kind==="image"?[target.kind,target.projectId,target.documentId,target.outputId]
            :target.kind==="artifact"?[target.kind,target.projectId,target.documentId,target.artifactId]
              :target.kind==="review"?[target.kind,target.identity.organizationId,target.identity.id]
                :[target.kind,target.target.projectId,target.target.documentId,row.preparationChoice];
    return[row.key,copy.reference+" \u2068"+encodeURIComponent(JSON.stringify(ids))+"\u2069"];
  }));
  const numbers=new Intl.NumberFormat(input.locale);
  const labels=qualifyDisplayCollisions(rows.map(row=>({key:row.key,label:[row.label,row.hint].filter(Boolean).join(" ")})),
    number=>numbers.format(number),key=>references.get(key)!);
  for(const row of rows){
    const qualifier=labels.get(row.key)?.qualifier;
    if(qualifier)row.hint=[row.hint,qualifier].filter(Boolean).join(" · ");
  }
  return rows;
}
export function commandDiscoveryTargetAvailable(row:CommandDiscoveryRow,input:CommandDiscoveryInput):boolean{
  return projectCommandDiscovery(input).some(candidate=>candidate.key===row.key);
}
