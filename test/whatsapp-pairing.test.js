import test from 'node:test';
import assert from 'node:assert/strict';
import {pairingPhoneNumber} from '../src/connectors/whatsapp.js';
test('pairing phone requires an international digits-only number',()=>{
 assert.equal(pairingPhoneNumber('972501234567'),'972501234567');
 for(const value of ['0501234567','+972501234567','972-501234567','','123','0'.repeat(13)])assert.throws(()=>pairingPhoneNumber(value),/invalid_whatsapp_pairing_number/);
});
