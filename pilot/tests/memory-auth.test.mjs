import test from 'node:test';import assert from 'node:assert/strict';import {generateKeyPair,exportJWK,SignJWT,createLocalJWKSet} from 'jose';import {machineVerifier,memoryHandler} from '../src/memory-service.mjs';
test('private Memory service verifies audience and allowlisted machine subject before any repository call',async()=>{
 const key=await generateKeyPair('RS256'),jwks=createLocalJWKSet({keys:[{...await exportJWK(key.publicKey),kid:'local'}]});const audience='https://memory-pilot.internal';
 const verify=machineVerifier({audience,subjects:['machine-a'],jwks});let calls=0;const handler=memoryHandler({query:async p=>{calls++;return {principal:p};}},verify);
 const token=async (sub,aud=audience)=>new SignJWT({sub}).setProtectedHeader({alg:'RS256',kid:'local'}).setIssuer('https://accounts.google.com').setAudience(aud).setIssuedAt().setExpirationTime('5m').sign(key.privateKey);
 const request=t=>new Request('http://memory.internal/v1/query',{method:'POST',headers:{authorization:'Bearer '+t,'content-type':'application/json'},body:'{}'});
 assert.equal((await handler(request(await token('machine-b')))).status,401);assert.equal((await handler(request(await token('machine-a','wrong')))).status,401);assert.equal(calls,0);assert.equal((await handler(request(await token('machine-a')))).status,200);assert.equal(calls,1);
});
