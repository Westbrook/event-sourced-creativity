import { Schema, type Node as PMNode, type NodeSpec } from 'prosemirror-model';
import { type RichDocument } from '../rich-document.js';
export { decodeRichDocument, richDocumentFromRuns, safeEditorLink, richDocumentText, type RichDocument, type RichNode, type RichDocumentLimits } from '../rich-document.js';
export declare const richSchema: Schema<keyof import("orderedmap").default<NodeSpec>, string>;
export declare function validateRichDocument(value: RichDocument): PMNode;
export declare function richSnapshot(node: PMNode): RichDocument;
export declare function richText(node: PMNode): string;
/** Safe initial semantic HTML, also usable without a browser DOM during SSR. */
export declare function richHTML(node: PMNode): string;
