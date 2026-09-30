import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {creditReady,fillPrice,inputFingerprint,evaluateUniverse,markPaper,accountRisk} from './screen-market.mjs';
const config=JSON.parse(fs.readFileSync('strategy-config.json','utf8'));
test('missing stock credit cannot be supplied by ETFs or by zero substitution',()=>{
  assert.equal(creditReady({marginShortLending:{marginBalance:null,shortBalance:0}},config),false);
  assert.equal(creditReady({marginShortLending:{marginBalance:0,shortBalance:0}},config),true);
});
test('gap above max entry cancels despite a later intraday low',()=>{
  const order={mechanicalRule:{type:'STOP_ENTRY',trigger:100,maxEntry:102}};
  assert.equal(fillPrice(order,{open:103,high:104,low:99}).reason,'GAP_ABOVE_MAX_ENTRY');
  assert.equal(fillPrice(order,{open:101,high:104,low:99}).price,101);
  assert.equal(fillPrice(order,{open:99,high:101,low:98}).price,100);
});
test('unparseable legacy rules never fabricate a fill',()=>{
  assert.equal(fillPrice({executionRule:'model decides'}, {open:100,high:110,low:90}).reason,'ORDER_RULE_NOT_MACHINE_READABLE');
});
test('capture retries with only timestamps changed deduplicate',()=>{
  const a={targetDate:'2026-09-29',universe:[],deepDive:[],tdcc:null,generatedAt:'a',gateMatrix:{generatedAt:'a'}};
  assert.equal(inputFingerprint(a,config),inputFingerprint({...a,generatedAt:'b',gateMatrix:{generatedAt:'b'}},config));
  assert.notEqual(inputFingerprint(a,config),inputFingerprint({...a,universe:[{code:'3005'}]},config));
});
test('every universe member is recorded; incomplete evidence gets no eligible rank',()=>{
  const i={targetDate:'2026-09-29',gateMatrix:{targetDate:'2026-09-29',overallStatus:'PASS'},universe:[{code:'3005',name:'神基',assetType:'STOCK',close:117},{code:'9999',assetType:'STOCK',close:5}],deepDive:[]};
  const r=evaluateUniverse(i,config);assert.equal(r.rows.length,2);assert.ok(r.rows.every(c=>c.decision==='NO_TRADE' && c.universeRank===null));
});
test('same-day reanalysis never repeats a ledger entry',()=>{
  const p={asOf:'2026-09-29',cash:200000,initialCash:200000,positions:[],ledger:[],nextOrders:[]};
  assert.deepEqual(markPaper(p,{targetDate:p.asOf,universe:[]},config),p);
});
test('existing position concentration cannot be hidden by a high candidate score',()=>{
  const p={cash:175000,positions:[{code:'1513',shares:150,lastPrice:167}],ledger:[]};
  const input={targetDate:'2026-09-29',deepDive:[{code:'1513',history:[['2026-09-23',0,0,0,166],['2026-09-24',0,0,0,166]]}]};
  const r=accountRisk(p,input,config);assert.equal(r.pass,false);assert.ok(r.reasons.includes('ACCOUNT_RISK_LIMIT'));
});
