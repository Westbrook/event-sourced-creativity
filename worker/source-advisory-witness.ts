import type { SourceAuthorityReceipt } from './source-authority-receipt.ts';
import type { SourceAdvisoryInput } from '../src/model/source-advisory.ts';
import { evidenceSha256 } from './generation-evidence.ts';
export type SourceAdvisoryWitness={version:'source-advisory-witness-v1';authority:SourceAuthorityReceipt;createdAt:string;expiresAt:string;
  manifest:Array<SourceAdvisoryInput&{sha256:string;utf16Length:number;utf8Length:number}>};
/** Receives the actual submitted array from its existing construction boundary. */
export async function sourceAdvisoryWitness(authority:SourceAuthorityReceipt,createdAt:string,expiresAt:string,input:string[],mapping:SourceAdvisoryInput[]):Promise<SourceAdvisoryWitness> {
 if(input.length!==mapping.length||input.length<1||input.length>25||input[0]!.length>=28000||await evidenceSha256(input[0]!)!==authority.sourceSha256)throw Error('source_input_binding');
 const manifest=[];
 for(let i=0;i<input.length;i++){
  if(mapping[i]!.index!==i)throw Error('source_input_position');
  manifest.push({...mapping[i]!,sha256:await evidenceSha256(input[i]!),utf16Length:input[i]!.length,utf8Length:new TextEncoder().encode(input[i]!).length});
 }
 return {version:'source-advisory-witness-v1',authority,createdAt,expiresAt,manifest};
}
