import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
export function contentCipher(encoded){
 const key=Buffer.from(encoded??'','base64');if(key.length!==32)throw Error('fresh_32_byte_encryption_root_required');
 return {
  seal(value,context){const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key,iv);c.setAAD(Buffer.from(context));return Buffer.concat([iv,c.update(JSON.stringify(value)),c.final(),c.getAuthTag()]);},
  open(value,context){const b=Buffer.from(value),c=createDecipheriv('aes-256-gcm',key,b.subarray(0,12));c.setAAD(Buffer.from(context));c.setAuthTag(b.subarray(-16));return JSON.parse(Buffer.concat([c.update(b.subarray(12,-16)),c.final()]).toString());}
 };
}
