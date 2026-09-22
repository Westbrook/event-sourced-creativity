import type {WorkerEnv} from './runtime.ts';

const receiptLifetime=Symbol('native-memory-image-receipt-lifetime');
type Lifetime={env:WorkerEnv;db:WorkerEnv['DB'];wall:number;monotonic:number;until:number};
declare const receiptBrand:unique symbol;
export type MemoryImageReceiptLifetime=Readonly<{[receiptBrand]:true}>;
const issued=new WeakMap<MemoryImageReceiptLifetime,Lifetime>();
const MAX_RECEIPT_MS=120000;

/** A server-only processing deadline, issued once before image execution.
 * This is NOT a presentation lease or an access decision. Every native SQL
 * source/authority predicate must still execute at transmission and retention.
 * Only the request-local environment receives it; HTTP cannot supply a token. */
export function bindMemoryImageReceiptLifetime(env:WorkerEnv){
 if(Object.prototype.hasOwnProperty.call(env,receiptLifetime))throw Error('memory_image_lifetime_already_issued');
 const wall=Date.now(),monotonic=performance.now();
 if(!Number.isSafeInteger(wall)||!Number.isFinite(monotonic))throw Error('memory_image_lifetime_invalid');
 const token=Object.freeze({}) as MemoryImageReceiptLifetime;issued.set(token,{env,db:env.DB,wall,monotonic,until:wall+MAX_RECEIPT_MS});
 Object.defineProperty(env,receiptLifetime,{value:token});
}
/** Native read-batch views forward this private symbol. Their own DB identity
 * checks remain mandatory; the original environment cannot replace its DB. */
function current(token:MemoryImageReceiptLifetime){
 const value=issued.get(token),wall=Date.now(),monotonic=performance.now();
 if(!value||value.env.DB!==value.db||!Number.isSafeInteger(wall)||!Number.isFinite(monotonic)||wall<value.wall||monotonic<value.monotonic
  ||wall>=value.until||monotonic-value.monotonic>=MAX_RECEIPT_MS)throw Error('memory_image_lifetime_expired');
 return value;
}
export function memoryImageReceiptLifetime(env:WorkerEnv){
 const token=(env as WorkerEnv&{[receiptLifetime]?:MemoryImageReceiptLifetime})[receiptLifetime];
 if(token!==undefined)current(token);return token;
}
export function memoryNativeProcessingDeadline(env:WorkerEnv,defaultDeadline:number){
 const token=memoryImageReceiptLifetime(env);return token===undefined?defaultDeadline:current(token).until;
}
/** Parsing still has no access/publication authority. Only an issued native
 * paid-response token selects its longer processing window; ordinary result
 * parsers and all HTTP presentations keep their existing bounds. */
export function memoryImageParsingWindow(token?:MemoryImageReceiptLifetime):60000|120000{
 if(token===undefined)return 60000;current(token);return 120000;
}
