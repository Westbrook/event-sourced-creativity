import { decodeRichDocument, richDocumentText, richDocumentFromRuns, type RichDocument, type RichNode } from '../still/vendor/elements/rich-document.js';

export type IdeaBodyV1 = { schemaVersion: 1; document: RichDocument };
export type IdeaBodyReference = { occurrenceId: string; projectId: string; blockId: string; text: string; label: string };
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const identity = (value: unknown) => typeof value === 'string' && value.length > 0 && value.length <= 180 && !Array.from(value).some(character=>character.charCodeAt(0)<32);

export function decodeIdeaBody(value: unknown): IdeaBodyV1 {
  const envelope = record(value);
  if (envelope.schemaVersion !== 1) throw new TypeError('This Idea body requires a compatible Still editor. Open the Idea in Still; its readable text is preserved.');
  const body: IdeaBodyV1 = { schemaVersion: 1, document: decodeRichDocument(envelope.document) };
  for (const node of bodyNodes(body.document.doc)) if (node.type === 'token') {
    const run = record(node.attrs?.run), data = record(run.data);
    if (run.type !== 'still-idea-reference' || data.schemaVersion !== 1 || data.kind !== 'idea-reference' || !identity(data.projectId) || !identity(data.blockId)) throw new TypeError('Resolve or remove this command or reference in Still before saving the Idea.');
  }
  return body;
}
function* bodyNodes(node: RichNode): Generator<RichNode> { yield node; for (const child of node.content ?? []) yield* bodyNodes(child); }
export const ideaBodyText = (body: IdeaBodyV1): string => richDocumentText(body.document);
export const plainTextIdeaBody = (text: string): IdeaBodyV1 => ({ schemaVersion: 1, document: richDocumentFromRuns([{ kind: 'text', text }]) });
/** All occurrences remain available for editing; dependency consumers deduplicate block identities. */
export function ideaBodyReferences(value: unknown): IdeaBodyReference[] {
  const body = decodeIdeaBody(value);
  return [...bodyNodes(body.document.doc)].filter(node => node.type === 'token').map(node => {
    const run = record(node.attrs?.run), data = record(run.data);
    return { occurrenceId: String(run.id), projectId: String(data.projectId), blockId: String(data.blockId), text: String(run.text), label: String(run.label) };
  });
}
export function validateIdeaBodyProperties(properties: Record<string, unknown>): IdeaBodyV1 | null {
  if (!Object.hasOwn(properties, 'rich_text_body')) return null;
  const body = decodeIdeaBody(properties.rich_text_body);
  if (properties.text !== ideaBodyText(body)) throw new TypeError('Idea text and rich body differ. Reopen the Idea in Still and save its complete body together.');
  return body;
}
export function remapIdeaBodyReferences(value: unknown, ids: ReadonlyMap<string, string>, projectId?: string): IdeaBodyV1 {
  const body = decodeIdeaBody(value);
  const rewrite = (node: RichNode): RichNode => {
    if (node.type === 'token') {
      const run = record(node.attrs?.run), data = record(run.data), mapped = ids.get(String(data.blockId));
      if (!mapped) throw new TypeError('This copy is missing a referenced Idea. Copy the complete dependency group in Still.');
      return { ...node, attrs: { ...node.attrs, run: { ...run, data: { ...data, blockId: mapped, projectId: projectId ?? data.projectId } } as never } };
    }
    return { ...node, ...(node.content ? { content: node.content.map(rewrite) } : {}) };
  };
  return decodeIdeaBody({ ...body, document: { ...body.document, doc: rewrite(body.document.doc) } });
}
