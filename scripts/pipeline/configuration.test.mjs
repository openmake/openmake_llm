import test from 'node:test';
import assert from 'node:assert/strict';
import { readiness } from './configuration.mjs';
const CI='CI Gate (Test → Build → Size → Lint)';
function configured(){return {repository:'o/r',secrets:[{name:'OMK_AUTOMATION_TOKEN'}],branches:Object.fromEntries(['dev','main'].map(b=>[b,{required_status_checks:{strict:true,contexts:[CI]}}])),workflows:['auto-merge.yml','promote.yml','release-verified.yml'].map(n=>({path:`.github/workflows/${n}`,state:'active'}))};}
test('activation audit distinguishes configuration from actual completion without secret values',()=>{
 const doc=configured();assert.equal(readiness(doc).status,'configured');
 for(const mutate of [d=>{d.secrets=[];},d=>{d.branches.main.required_status_checks.strict=false;},d=>{d.workflows=[];}]){const broken=configured();mutate(broken);assert.equal(readiness(broken).status,'blocked');}
 assert.match(readiness(doc).note,/not execution/);
});
