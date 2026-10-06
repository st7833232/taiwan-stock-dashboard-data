import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {creditReady,fillPrice,inputFingerprint,evaluateUniverse,markPaper,accountRisk,planSignals} from './screen-market.mjs';
import {rowEvidenceState} from './research-evidence.mjs';
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
test('every universe member is recorded; incomplete evidence gets no research or trade rank',()=>{
  const i={targetDate:'2026-09-29',gateMatrix:{targetDate:'2026-09-29',overallStatus:'PASS'},universe:[{code:'3005',name:'神基',assetType:'STOCK',close:117},{code:'9999',assetType:'STOCK',close:5}],deepDive:[]};
  const r=evaluateUniverse(i,config);assert.equal(r.rows.length,2);assert.ok(r.rows.every(c=>c.decision==='NO_TRADE' && c.researchRank===null && c.tradeRank===null && c.universeRank===null));
});
test('evidence-complete names receive research rank even without a tradable setup',()=>{
  const i={targetDate:'2026-09-29',gateMatrix:{targetDate:'2026-09-29',overallStatus:'PASS'},universe:[{code:'0050',name:'元大台灣50',assetType:'ETF',close:100}],deepDive:[{
    code:'0050',assetType:'ETF',historyCoverageTradingDays:120,history:[],volumeRatio20d:1,liquidityMedianTurnover20d:200000000,
    indicators:{ma20:90,ma60:80,ma120:70,ma20Slope5d:1,ma60Slope5d:1,atr14:2,rsi14:55,macdHistogram:1},
    verifiedEvidence:{eventRisk:true,corporateAction:true},
    etfProfile:{eligibleForBuy:false,historyReady:true,historicalRiskReady:true,liquidityGatePass:true,riskLimitsPass:true}
  }]};
  const [row]=evaluateUniverse(i,config).rows;
  assert.equal(row.researchEvidenceStatus,'COMPLETE');
  assert.equal(row.researchRank,1);assert.equal(row.researchPercentile,100);
  assert.equal(row.tradeRank,null);assert.equal(row.tradePercentile,null);
  assert.equal(row.universeRank,null);assert.equal(row.universePercentile,null);
  assert.equal(row.decision,'WATCH');
});
test('per-security evidence readiness does not wait for unrelated symbols',()=>{
  const gates={history:true,institutional:true,credit:true,tdcc:true,fundamental:true,event:true,corporateAction:true};
  const complete=rowEvidenceState({financialAssessment:{status:'PASS',verified:true,qualityPass:true,pending:[],failures:[]}}, {gates});
  const pending=rowEvidenceState({}, {gates:{...gates,fundamental:false}});
  assert.equal(complete.status,'COMPLETE');assert.deepEqual(complete.pending,[]);
  assert.equal(pending.status,'PENDING');assert.deepEqual(pending.pending,['fundamental']);
});
test('same-day reanalysis never repeats a ledger entry',()=>{
  const p={asOf:'2026-09-29',cash:200000,initialCash:200000,positions:[],ledger:[],nextOrders:[]};
  assert.deepEqual(markPaper(p,{targetDate:p.asOf,universe:[]},config),p);
});
test('no-order valuation preserves the Dashboard ledger and benchmark contract',()=>{
  const previous={asOf:'2026-09-24',initialCash:200000,cash:165936.528625,positions:[{code:'1513',shares:150,lastPrice:166},{code:'4961',shares:50,lastPrice:180.5}],ledger:[],nextOrders:[]};
  const input={targetDate:'2026-09-29',universe:[{code:'1513',close:167},{code:'4961',close:184.5}],deepDive:[{code:'0050',history:[['2026-09-24',0,0,0,112.39],['2026-09-29',0,0,0,111.29]]}]};
  const result=markPaper(previous,input,config);
  assert.equal(result.ledger.length,1);assert.equal(result.ledger[0].shares,0);
  assert.equal(result.cash,previous.cash);assert.deepEqual(result.positions.map(p=>p.shares),[150,50]);
  const base=previous.cash+150*166+50*180.5;
  assert.equal(result.benchmark.accountReturn,(result.equity/base-1)*100);
  assert.equal(result.benchmark.accountBaseDate,previous.asOf);
  assert.equal(result.benchmark.etfReturn,(111.29/112.39-1)*100);
  assert.throws(()=>markPaper(previous,{...input,deepDive:[]},config),/benchmark.*unavailable/);
});
test('existing position concentration cannot be hidden by a high candidate score',()=>{
  const p={cash:175000,positions:[{code:'1513',shares:150,lastPrice:167}],ledger:[]};
  const input={targetDate:'2026-09-29',deepDive:[{code:'1513',history:[['2026-09-23',0,0,0,166],['2026-09-24',0,0,0,166]]}]};
  const r=accountRisk(p,input,config);assert.equal(r.pass,false);assert.ok(r.reasons.includes('ACCOUNT_RISK_LIMIT'));
});

test('an unrelated stock with pending evidence cannot freeze qualified candidates or bypass its own gate',()=>{
  const candidate={code:'3005',name:'test',assetType:'STOCK',score:100,universeRank:1,universePercentile:1,gates:{history:true,fundamental:true,credit:true},reasonCodes:[],setup:{strategy:'BREAKOUT',entry:100,maxEntry:101,stop:95}};
  const pending={...structuredClone(candidate),code:'9999',gates:{...candidate.gates,fundamental:false}};
  const paper={cash:200000,positions:[],ledger:[],experiment:{status:'ACTIVE'}};
  const input={targetDate:'2026-10-05',researchComplete:false,deepDive:[{history:[['2026-09-30'],['2026-10-02']]}]};
  const plan=planSignals({regime:'BULL',rows:[candidate,pending]},paper,input,config);
  assert.equal(plan.risk.pass,true);assert.deepEqual(plan.orders.map(o=>o.code),['3005']);
  assert.equal(candidate.decision,'BUY');assert.notEqual(pending.decision,'BUY');
});
