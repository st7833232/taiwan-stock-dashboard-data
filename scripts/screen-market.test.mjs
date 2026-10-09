import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {creditReady,fillPrice,inputFingerprint,evaluateUniverse,markPaper,accountRisk,planSignals,marketTrendAssessment,entrySetup} from './screen-market.mjs';
import {rowEvidenceState,evidenceSummary} from './research-evidence.mjs';
import {tickSize,alignPrice,isTickPrice,alignStockSetup,displayPrice} from './price-ticks.mjs';
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
    code:'0050',assetType:'ETF',current:{market:'TWSE',close:100},historyCoverageTradingDays:120,history:[],volumeRatio20d:1,liquidityMedianTurnover20d:200000000,
    indicators:{ma20:90,ma60:80,ma120:70,ma20Slope5d:1,ma60Slope5d:1,atr14:2,rsi14:55,macdHistogram:1},
    verifiedEvidence:{eventRisk:true,corporateAction:true},
    etfProfile:{eligibleForBuy:false,historyReady:true,historicalRiskReady:true,liquidityGatePass:true,riskLimitsPass:true}
  }]};
  const incomplete={...i,deepDive:i.deepDive.map(r=>({...r,verifiedEvidence:{eventRisk:false,corporateAction:true}}))};
  assert.equal(evaluateUniverse(incomplete,config).rows[0].researchRank,null,'unadmitted evidence cannot rank');
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
test('prior deep-dive name absent from current official universe remains pending',()=>{
  const input={
    targetDate:'2026-10-08',
    gateMatrix:{targetDate:'2026-10-08',overallStatus:'PASS'},
    universe:[{code:'3005',name:'神基',assetType:'STOCK',close:117}],
    deepDive:[{code:'9999',assetType:'STOCK',current:null}]
  };
  const result=evaluateUniverse(input,config), evidence=evidenceSummary(input,result);
  assert.equal(result.rows.some(r=>r.code==='9999'),false,'no unverified quote may enter ranking');
  assert.equal(result.rows.filter(r=>r.researchRank!==null||r.tradeRank!==null).length,0);
  assert.equal(evidence.completeCodes.length+evidence.pendingCodes.length,input.deepDive.length);
  assert.deepEqual(evidence.pendingCodes,['9999']);
  assert.deepEqual(evidence.pending.history,['9999']);
  assert.equal(evidence.researchComplete,false);
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
test('legacy concentration is reported but does not freeze unrelated diversification',()=>{
  const p={cash:175000,positions:[{code:'1513',shares:150,lastPrice:167}],ledger:[]};
  const input={targetDate:'2026-09-29',deepDive:[{code:'1513',history:[['2026-09-23',0,0,0,166],['2026-09-24',0,0,0,166]]}]};
  const r=accountRisk(p,input,config);assert.equal(r.pass,true);assert.ok(r.warnings.includes('EXISTING_POSITION_CONCENTRATION'));assert.equal(r.concentrationWarnings[0].code,'1513');
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

test('verified strong uptrend creates a bounded 0050 market-beta order without lowering alpha gates',()=>{
  const input={targetDate:'2026-10-05',deepDive:[{code:'0050',assetType:'ETF',current:{close:100},historyCoverageTradingDays:140,history:[['2026-09-30'],['2026-10-02']],indicators:{ma20:95,ma60:90,ma120:80,ma20Slope5d:1,ma60Slope5d:0.5,atr14:2,rsi14:60,macdHistogram:1}}]};
  const trend=marketTrendAssessment(input,config);assert.equal(trend.phase,'STRONG_UPTREND');assert.equal(trend.targetExposurePct,10);assert.equal(trend.overextended,false);
  const proxy={code:'0050',name:'元大台灣50',assetType:'ETF',score:0,universeRank:null,universePercentile:null,reasonCodes:[],gates:{history:true,liquidity:true,assetProfile:true,event:true,corporateAction:true}};
  const paper={cash:200000,positions:[],ledger:[],experiment:{status:'ACTIVE'}};
  const plan=planSignals({regime:'BULL',marketTrend:trend,rows:[proxy]},paper,input,config);
  assert.equal(plan.risk.pass,true);assert.equal(plan.orders.length,1);assert.equal(plan.orders[0].signalClass,'MARKET_BETA_TREND');assert.equal(plan.orders[0].code,'0050');
  assert.ok(plan.orders[0].shares*plan.orders[0].mechanicalRule.maxEntry<=plan.risk.equity*config.risk.singleStockExposureMaxPct/100);
});
test('overextended strong uptrend cuts beta target and forbids chasing above the signal close',()=>{
  const input={targetDate:'2026-10-05',deepDive:[{code:'0050',assetType:'ETF',current:{close:100},historyCoverageTradingDays:140,history:[['2026-09-30'],['2026-10-02']],indicators:{ma20:95,ma60:90,ma120:80,ma20Slope5d:1,ma60Slope5d:0.5,atr14:2,rsi14:81,macdHistogram:1}}]};
  const trend=marketTrendAssessment(input,config);assert.equal(trend.phase,'STRONG_UPTREND');assert.equal(trend.overextended,true);assert.equal(trend.targetExposurePct,5);
  const proxy={code:'0050',name:'元大台灣50',assetType:'ETF',score:0,universeRank:null,universePercentile:null,reasonCodes:[],gates:{history:true,liquidity:true,assetProfile:true,event:true,corporateAction:true}};
  const plan=planSignals({regime:'BULL',marketTrend:trend,rows:[proxy]},{cash:200000,positions:[],ledger:[],experiment:{status:'ACTIVE'}},input,config);
  assert.equal(plan.orders.length,1);assert.equal(plan.orders[0].mechanicalRule.maxEntry,100);
});
test('market-beta sleeve stays off when the proxy trend is defensive',()=>{
  const input={targetDate:'2026-10-05',deepDive:[{code:'0050',assetType:'ETF',current:{close:80},historyCoverageTradingDays:140,history:[['2026-09-30'],['2026-10-02']],indicators:{ma20:90,ma60:95,ma120:100,ma20Slope5d:-1,ma60Slope5d:-1,atr14:2,rsi14:40,macdHistogram:-1}}]};
  const trend=marketTrendAssessment(input,config);assert.equal(trend.phase,'DOWNTREND');assert.equal(trend.targetExposurePct,0);
  const paper={cash:200000,positions:[],ledger:[],experiment:{status:'ACTIVE'}};
  const plan=planSignals({regime:'BEAR',marketTrend:trend,rows:[]},paper,input,config);assert.deepEqual(plan.orders,[]);
});

test('trend continuation admits a verified mid-trend setup without lowering 2R',()=>{
  const c={close:100,low:99.5};
  const history=Array.from({length:120},(_,i)=>{
    const d=`2026-05-${String((i%28)+1).padStart(2,'0')}`;
    const base=90+i*0.07;
    return [d,base,Math.min(102,base+2),Math.max(88,base-2),base+0.5,1000];
  });
  const row={current:c,history,volumeRatio20d:1.15,indicators:{ma20:99.5,ma60:96,ma120:92,ma20Slope5d:0.3,ma60Slope5d:0.2,atr14:1.2,rsi14:64,macdHistogram:0.4}};
  const local=structuredClone(config);local.screening={...local.screening,targetDate:'2026-10-08'};
  const setup=entrySetup(row,local);
  assert.equal(setup?.strategy,'TREND_CONTINUATION');assert.ok(setup.riskReward>=local.minRiskReward);assert.ok(setup.target>setup.entry);assert.ok(setup.zoneLow<setup.entry);
});
test('trend continuation rejects an overextended or weak-volume stock',()=>{
  const history=Array.from({length:120},(_,i)=>[`2026-05-${String((i%28)+1).padStart(2,'0')}`,95,102,90,96,1000]);
  const base={current:{close:100,low:99.5},history,volumeRatio20d:1.15,indicators:{ma20:98.8,ma60:96,ma120:92,ma20Slope5d:0.3,ma60Slope5d:0.2,atr14:1.2,rsi14:64,macdHistogram:0.4}};
  const local=structuredClone(config);local.screening={...local.screening,targetDate:'2026-10-08'};
  assert.equal(entrySetup({...base,indicators:{...base.indicators,rsi14:80}},local),null);
  assert.equal(entrySetup({...base,volumeRatio20d:0.4},local),null);
});
test('alpha order consumes exposure before the market-beta sleeve',()=>{
  const candidate={code:'9945',name:'alpha',assetType:'STOCK',score:100,universeRank:1,universePercentile:1,reasonCodes:[],gates:{history:true,liquidity:true,market:true,trend:true,credit:true,institutional:true,tdcc:true,fundamental:true,event:true,corporateAction:true,strategy:true,riskReward:true,assetProfile:true},setup:{strategy:'TREND_CONTINUATION',entry:100,maxEntry:101,zoneLow:99,stop:95}};
  const proxy={code:'0050',name:'元大台灣50',assetType:'ETF',score:0,universeRank:null,universePercentile:null,reasonCodes:[],gates:{history:true,liquidity:true,assetProfile:true,event:true,corporateAction:true}};
  const paper={cash:200000,positions:[],ledger:[],experiment:{status:'ACTIVE'}};
  const input={targetDate:'2026-10-08',verifiedCalendar:{sourceQuality:'SOURCE_A',asOf:'2026-10-08',nextTradingDate:'2026-10-12'},deepDive:[{code:'0050',assetType:'ETF',history:[['2026-10-02'],['2026-10-07']],indicators:{},current:{close:100}},{code:'9945',history:[['2026-10-02'],['2026-10-07']]}]};
  const result={regime:'BULL',marketTrend:{verified:true,proxyCode:'0050',phase:'STRONG_UPTREND',targetExposurePct:10,overextended:false,close:100,ma20:98,ma60:95,atr14:2},rows:[candidate,proxy]};
  const plan=planSignals(result,paper,input,config);
  assert.equal(plan.orders[0].code,'9945');assert.equal(plan.orders[0].signalClass,undefined);
  assert.ok(plan.orders.length>=1);
});

test('alpha planner processes the best verified trade rank before lower-ranked names',()=>{
  const make=(code,rank)=>({code,name:code,assetType:'STOCK',score:100,tradeRank:rank,tradePercentile:rank,universeRank:rank,universePercentile:rank,reasonCodes:[],gates:{history:true,liquidity:true,market:true,trend:true,credit:true,institutional:true,tdcc:true,fundamental:true,event:true,corporateAction:true,strategy:true,riskReward:true,assetProfile:true},setup:{strategy:'TREND_CONTINUATION',entry:100,maxEntry:101,zoneLow:99,stop:95}});
  const paper={cash:200000,positions:[],ledger:[],experiment:{status:'ACTIVE'}};
  const input={targetDate:'2026-10-08',verifiedCalendar:{sourceQuality:'SOURCE_A',asOf:'2026-10-08',nextTradingDate:'2026-10-12'},deepDive:[{history:[['2026-10-02'],['2026-10-07']]}]};
  const plan=planSignals({regime:'BULL',marketTrend:{verified:false},rows:[make('RANK2',2),make('RANK1',1)]},paper,input,config);
  assert.equal(plan.orders[0].code,'RANK1');
});

test('Taiwan stock and ETF price ticks are aligned without widening entry',()=>{
  assert.equal(tickSize(29.8,'STOCK'),0.05);
  assert.equal(tickSize(114.95,'ETF'),0.05);
  assert.equal(alignPrice(29.460714,'STOCK','UP'),29.50);
  assert.equal(alignPrice(29.886904,'STOCK','DOWN'),29.85);
  assert.equal(alignPrice(28.951785,'STOCK','UP'),29.00);
  assert.equal(alignPrice(31.757142,'STOCK','DOWN'),31.75);
  assert.equal(alignPrice(113.403571,'ETF','UP'),113.45);
  assert.equal(alignPrice(111.857142,'ETF','UP'),111.90);
  assert.equal(alignPrice(49.99,'STOCK','UP'),50.00);
  assert.equal(alignPrice(99.99,'STOCK','UP'),100.00);
  assert.equal(alignPrice(999.99,'STOCK','UP'),1000.00);
  assert.equal(alignPrice(9.996,'STOCK','UP'),10.00);
  assert.equal(alignPrice(49.999,'ETF','UP'),50.00);
  for(const p of [29.50,29.85,29,31.75])assert.equal(isTickPrice(p,'STOCK'),true);
  assert.equal(isTickPrice(29.8869,'STOCK'),false);
  assert.equal(displayPrice(29.5),'29.50');
});
test('rounded price bands require at least 2R even at the upper entry limit',()=>{
 const valid=alignStockSetup({strategy:'TREND_CONTINUATION',entry:29.8,zoneLow:29.460714,maxEntry:29.886904,stop:28.951785,target:31.757142},'STOCK',2);
 assert.ok(valid);assert.deepEqual([valid.zoneLow,valid.maxEntry,valid.stop,valid.target],[29.50,29.85,29.00,31.75]);
 assert.ok(valid.worstEntryRR>=2);
 assert.equal(alignStockSetup({entry:29.8,zoneLow:29.5,maxEntry:29.8869,stop:28.9518,target:30.5},'STOCK',2),null);
});
