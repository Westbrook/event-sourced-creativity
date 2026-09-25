import test from 'node:test';import assert from 'node:assert/strict';import {randomBytes} from 'node:crypto';import {contentCipher} from '../src/cipher.mjs';
test('private content binds authenticated encryption to row identity and detects tampering',()=>{
 const key=randomBytes(32).toString('base64'),cipher=contentCipher(key),body={text:'Private synthetic harbor note'},sealed=cipher.seal(body,'row-a');
 assert.equal(sealed.includes(Buffer.from(body.text)),false);assert.deepEqual(cipher.open(sealed,'row-a'),body);assert.throws(()=>cipher.open(sealed,'row-b'));const damaged=Buffer.from(sealed);damaged[15]^=1;assert.throws(()=>cipher.open(damaged,'row-a'));assert.throws(()=>contentCipher(randomBytes(32).toString('base64')).open(sealed,'row-a'));assert.throws(()=>contentCipher(''));
});
