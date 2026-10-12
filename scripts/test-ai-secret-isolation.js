'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// The production loader globally patches Firebase's onCall and defineSecret.
// Test the same startup shim in isolation without importing real Firebase.
const code=fs.readFileSync(path.resolve(__dirname,'../functions/no-secret-loader.js'),'utf8');
const marker="const app = require('./no-sms-index');";
assert.ok(code.includes(marker),'Startup shim separator missing');
const startup=code.split(marker)[0];
const https={onCall:(options,handler)=>({options,handler})};
const params={defineSecret:name=>({name,value:()=> 'REAL:'+name})};
vm.runInNewContext(startup,{
  require:name=>{
    if(name==='firebase-functions/v2/https')return https;
    if(name==='firebase-functions/params')return params;
    throw new Error('Unexpected startup dependency '+name);
  }
},{filename:'no-secret-loader-startup.js',timeout:2000});

const sms=params.defineSecret('TWILIO_AUTH_TOKEN');
const ai=params.defineSecret('SKYDREAM_AI_API_KEY');
assert.throws(()=>sms.value(),/disabled/i,'Twilio must remain disabled');
assert.equal(ai.value(),'REAL:SKYDREAM_AI_API_KEY','The optional AI secret must remain bound');
const aiCall=https.onCall({enforceAppCheck:true,secrets:[sms,ai]},()=>true);
assert.equal(aiCall.options.enforceAppCheck,true);
assert.equal(aiCall.options.secrets.length,1);
assert.equal(aiCall.options.secrets[0].name,'SKYDREAM_AI_API_KEY');
const smsOnly=https.onCall({enforceAppCheck:true,secrets:[sms]},()=>true);
assert.equal(smsOnly.options.secrets,undefined);
console.log('SkyDream AI secret isolation passed: optional AI key works and Twilio secrets stay disabled.');
