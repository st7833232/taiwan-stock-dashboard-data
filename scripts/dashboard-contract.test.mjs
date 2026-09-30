import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const validator=fileURLToPath(new URL('./validate-dashboard-contract.mjs',import.meta.url));
test('Dashboard contract blocks no-order records and benchmark omissions before publication',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'dashboard-contract-'));
  const paper={asOf:'2026-09-29',experimentTitle:'Paper',statusLabel:'Observed',description:'Paper only',initialCash:200000,cash:200000,currency:'TWD',rule:'No orders',positions:[],ledger:[{date:'2026-09-29',status:'無既有委託',shares:0,fee:0,tax:0,rationale:'Previous orders empty'}],rationale:[],nextOrders:[],benchmark:{date:'2026-09-29',accountReturn:0,taiexReturn:-0.82,etfCode:'0050',etfReturn:-0.97},monitorCodes:[],sourceNote:'Official',note:'Paper only'};
  const env={...process.env};delete env.NODE_TEST_CONTEXT;
  const check=value=>{fs.writeFileSync(path.join(root,'paper.json'),JSON.stringify(value));return spawnSync(process.execPath,[validator],{cwd:root,encoding:'utf8',env});};
  try {
    fs.writeFileSync(path.join(root,'manifest.json'),JSON.stringify({revision:'r',researchPath:'research.json',paperAccountPath:'paper.json'}));
    fs.writeFileSync(path.join(root,'research.json'),JSON.stringify({conclusion:'No new orders',candidates:[]}));
    assert.equal(check(paper).status,0);
    const broken=structuredClone(paper);delete broken.ledger[0].shares;delete broken.benchmark.accountReturn;
    const result=check(broken);assert.notEqual(result.status,0);assert.match(result.stderr,/ledger\[0\].shares/);assert.match(result.stderr,/benchmark.accountReturn/);
    const unknown=structuredClone(paper);unknown.benchmark.etfReturn=null;assert.notEqual(check(unknown).status,0);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
