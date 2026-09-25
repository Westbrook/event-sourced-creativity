import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPair,SignJWT,exportJWK,createLocalJWKSet} from 'jose';
import {iapVerifier} from '../src/identity.mjs';
const audience='/projects/123/global/backendServices/456',issuer='https://cloud.google.com/iap';
test('IAP verifies signature, issuer, audience, expiry and stable subject; unsigned headers grant nothing',async()=>{
 const {privateKey,publicKey}=await generateKeyPair('ES256'),jwk={...await exportJWK(publicKey),kid:'test'};
 const verify=iapVerifier({audience,keys:createLocalJWKSet({keys:[jwk]})});
 const signed=async overrides=>new SignJWT({sub:'stable-test-sub',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+600,iss:issuer,aud:audience,...overrides}).setProtectedHeader({alg:'ES256',kid:'test'}).sign(privateKey);
 const headers=token=>new Headers({'x-goog-iap-jwt-assertion':token,'x-goog-authenticated-user-email':'spoof@example.invalid'});
 assert.deepEqual(await verify(headers(await signed({}))),{issuer,subject:'stable-test-sub'});
 await assert.rejects(()=>verify(new Headers({'x-goog-authenticated-user-email':'spoof@example.invalid'})),/authentication_required/);
 for(const bad of [{iss:'other'},{aud:'other'},{exp:0},{iat:Math.floor(Date.now()/1000)+90},{sub:''},{exp:Math.floor(Date.now()/1000)+720}])await assert.rejects(()=>signed(bad).then(t=>verify(headers(t))));
 const other=await generateKeyPair('ES256');const forged=await new SignJWT({sub:'stable-test-sub',iss:issuer,aud:audience}).setProtectedHeader({alg:'ES256',kid:'test'}).setIssuedAt().setExpirationTime('5m').sign(other.privateKey);await assert.rejects(()=>verify(headers(forged)));
});
