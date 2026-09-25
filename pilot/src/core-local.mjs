// Local UI harness ONLY. Production api.mjs has no synthetic IAP login or fixture path; app test-user selection is supported.
import {readFile,writeFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {generateKeyPair,SignJWT,createLocalJWKSet,exportJWK} from 'jose';
import {poolFromEnvironment} from './database.mjs';
import {CoreRepository,initializeCore} from './core-repository.mjs';
import {createCoreServer} from './core-http.mjs';
import {iapVerifier} from './identity.mjs';
const pool=poolFromEnvironment();await initializeCore(pool);
const path=new URL('../.local/core-root',import.meta.url);let encryptionRoot;try{encryptionRoot=await readFile(path,'utf8');}catch{encryptionRoot=randomBytes(32).toString('base64');await writeFile(path,encryptionRoot,{mode:0o600});}
const repository=new CoreRepository(pool,{encryptionRoot,expiresAt:'open-ended'});
for(const email of ['owner@pilot.invalid','collaborator@pilot.invalid'])await pool.query("INSERT INTO pilot.admissions(email,role) VALUES($1,'creator') ON CONFLICT DO NOTHING",[email]);
const {privateKey,publicKey}=await generateKeyPair('ES256'),jwk=await exportJWK(publicKey);jwk.kid='local-core';
const audience='/projects/1/global/backendServices/1',verify=iapVerifier({audience,keys:createLocalJWKSet({keys:[jwk]})});
const signed=async email=>new SignJWT({email}).setProtectedHeader({alg:'ES256',kid:'local-core'}).setSubject('local-signed:'+email).setIssuer('https://cloud.google.com/iap').setAudience(audience).setIssuedAt().setExpirationTime('5m').sign(privateKey);
for(const email of ['owner@pilot.invalid','collaborator@pilot.invalid']){const p=await repository.enroll({issuer:'https://cloud.google.com/iap',subject:'local-signed:'+email,email});await repository.consent(p.principal_id,'pilot-2026-08-10');}
const server=createCoreServer({repository,origin:'http://127.0.0.1:5230',staticRoot:new URL('../dist/core-web',import.meta.url).pathname,sourceCommit:'local-r1-under-test',verify:async headers=>{const email=headers.get('cookie')?.includes('pilot_local_actor=collaborator')?'collaborator@pilot.invalid':'owner@pilot.invalid';return verify(new Headers({'x-goog-iap-jwt-assertion':await signed(email)}));}});
server.listen(5230,'127.0.0.1',()=>console.log('Persistent local core: http://127.0.0.1:5230/still — local signed identities, not live IAP'));
process.on('SIGTERM',()=>server.close(async()=>{await pool.end();process.exit(0);}));
