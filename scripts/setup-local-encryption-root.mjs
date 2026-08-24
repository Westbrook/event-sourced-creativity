import { randomBytes, randomUUID } from "node:crypto";
import { chmod, readFile, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const destination=resolve(process.cwd(),".env.local");
let previous="";
try{previous=await readFile(destination,"utf8");}
catch(error){if(!error||typeof error!=="object"||error.code!=="ENOENT")throw error;}

const current=previous.match(/^\s*FORMA_ENCRYPTION_ROOT_KEY\s*=\s*([^\r\n]*)/m);
if(current?.[1]?.trim()){
  const value=current[1].trim();
  let valid=/^[a-f0-9]{64}$/i.test(value);
  if(!valid){try{valid=Buffer.from(value,"base64").byteLength===32&&Buffer.from(value,"base64").toString("base64").replace(/=+$/,"")===value.replace(/=+$/,"");}catch{valid=false;}}
  if(!valid)throw new Error("The existing local development encryption root is invalid. Correct it before configuring recovery.");
  await chmod(destination,0o600);
  process.stdout.write("The ignored local development encryption root is already configured.\n");
}else{
  const secret=randomBytes(32).toString("hex");
  const entry=`FORMA_ENCRYPTION_ROOT_KEY=${secret}`;
  const next=current?previous.replace(/^\s*FORMA_ENCRYPTION_ROOT_KEY\s*=\s*[^\r\n]*/m,entry):`${previous}${previous&&!previous.endsWith("\n")?"\n":""}${entry}\n`;
  const temporary=resolve(process.cwd(),`.env.local.forma-${randomUUID()}.tmp`);
  try{
    await writeFile(temporary,next,{encoding:"utf8",mode:0o600,flag:"wx"});
    await rename(temporary,destination);
    await chmod(destination,0o600);
  }catch(error){await rm(temporary,{force:true}).catch(()=>undefined);throw error;}
  process.stdout.write("Configured a new local-only 32-byte encryption root in the ignored development environment.\n");
}
