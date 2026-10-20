import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { runTarget, validateConfig, scheduleArgs, assertChatResponse } from './bean.mjs';

const sha = 'a'.repeat(40);
async function fixture(fn) {
 const server = createServer((req,res)=>{
  res.setHeader('Content-Type','application/json');
  if(req.url==='/health') return res.end(JSON.stringify({data:{build:{gitHash:sha,version:'1.2.3'}}}));
  if(req.url==='/ready') return res.end('{"ready":true}');
  if(req.url==='/api/csrf-token') return res.end('{"token":"csrf-test"}');
  if(req.url==='/api/auth/login' && req.headers['x-csrf-token']==='csrf-test') {
   res.setHeader('Set-Cookie','auth_token=secret-test; HttpOnly'); return res.end('{"success":true}');
  }
  if(req.url==='/api/chat' && req.headers.cookie?.includes('auth_token=secret-test')) return res.end('{"success":true,"data":{"response":"ok"}}');
  res.statusCode=403;res.end('{}');
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try { return await fn(`http://127.0.0.1:${server.address().port}`); }
 finally { await new Promise(r=>server.close(r)); }
}
test('external scenarios record installed identity and normal login/chat without leaking credentials',async()=>{
 await fixture(async baseUrl=>{
 const result=await runTarget({id:'tom',baseUrl,expectedSha:sha,emailEnv:'QA_EMAIL',passwordEnv:'QA_PASSWORD',checks:['health','ready','login','chat']},{QA_EMAIL:'qa@local.test',QA_PASSWORD:'password-secret'});
 assert.equal(result.status,'passed');assert.equal(result.sha,sha);assert.equal(result.checks.length,4);
 assert.doesNotMatch(JSON.stringify(result),/password-secret|secret-test|qa@local/);
 });
});
test('a different installed SHA fails even when health is 200',async()=>{
 await fixture(async baseUrl=>{
 const r=await runTarget({id:'tom',baseUrl,expectedSha:'b'.repeat(40),checks:['health']},{});
 assert.equal(r.status,'failed');assert.match(r.error,/identity/i);
 });
});
test('missing account configuration is failure, not a skipped pass',async()=>{
 await fixture(async baseUrl=>{
 const r=await runTarget({id:'tom',baseUrl,emailEnv:'MISSING',passwordEnv:'MISSING',checks:['login']},{});
 assert.equal(r.status,'failed');
 });
});
test('configuration requires named targets, explicit scenarios and safe identity URL',()=>{
 assert.throws(()=>validateConfig({targets:[]}),/target/i);
 assert.throws(()=>validateConfig({targets:[{id:'x',baseUrl:'file:///etc/passwd',checks:['health']}]}),/HTTP/i);
 assert.throws(()=>validateConfig({targets:[{id:'x',baseUrl:'http://localhost',checks:[]}]}),/check/i);
 assert.throws(()=>validateConfig({targets:[{id:'x',baseUrl:'http://localhost',checks:['deploy']}]}),/check/i);
});
test('scheduling requires explicit cron and uses argv without a shell',()=>{
 assert.throws(()=>scheduleArgs('/tmp/check.json','/tmp/out',''),/cron/i);
 const args=scheduleArgs('/tmp/check.json','/tmp/out','*/30 * * * *');
 assert(args.includes('--no-autorestart'));assert(args.includes('*/30 * * * *'));
 assert(args.includes('run'));assert(!args.includes('bash'));
});

test('chat HTTP 200 still requires a successful nonempty assistant response',()=>{
 assert.doesNotThrow(()=>assertChatResponse({success:true,data:{response:'OK'}}));
 for(const body of [{},{success:false,error:{message:'failed'}},{success:true,data:{}},{success:true,data:{response:''}},{response:'fake'}]) assert.throws(()=>assertChatResponse(body),/Chat/);
});
