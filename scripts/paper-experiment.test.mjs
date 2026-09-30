import test from 'node:test';
import assert from 'node:assert/strict';
import {updatePaperExperiment,experimentAllowsOrder} from './paper-experiment.mjs';
const config={paperExperiment:{id:'test',enabled:true,startDate:'2026-10-01',durationTradingDays:5,reviewEveryTradingDays:5,plannedEndDate:'2026-10-07',maxEvidenceBlockedTradingDays:2}};
const input=date=>({targetDate:date,gateMatrix:{targetDate:date,overallStatus:'PASS'},deepDive:[{history:[['2026-09-30'],['2026-10-01'],['2026-10-02'],['2026-10-05'],['2026-10-06'],['2026-10-07']].filter(h=>h[0]<=date)}]});
const account=()=>({asOf:'2026-09-30',cash:200000,positions:[],ledger:[],nextOrders:[],rationale:[]});
test('period counts official trading days once and stops new buys at the boundary',()=>{
  let old=account();
  for(const date of ['2026-10-01','2026-10-02','2026-10-05','2026-10-06','2026-10-07']){const paper=structuredClone(old);paper.asOf=date;updatePaperExperiment(paper,old,input(date),config,false);old=paper;}
  assert.equal(old.experiment.completedTradingDays,5);assert.equal(old.experiment.status,'REVIEW_DUE');
  assert.equal(old.experiment.reviews.length,1);assert.equal(old.experiment.metrics.evidenceBlockedDays,5);assert.equal(old.experiment.metrics.noNewOrderDays,0);
  assert.equal(old.experiment.processReviewRequired,true);assert.equal(old.experiment.metrics.maxDrawdownPct,0);
  assert.equal(experimentAllowsOrder(old.experiment,'2026-10-08',config),false);
  const repeat=structuredClone(old);updatePaperExperiment(repeat,old,input(old.asOf),config,false);assert.equal(repeat.experiment.dailyMarks.length,5);
  assert.equal(experimentAllowsOrder({status:'ACTIVE'},'2026-10-02',config),true);
  assert.equal(experimentAllowsOrder({status:'PLANNED'},'2026-09-30',config),false);
});
test('missed valuations and an unverified baseline cannot become performance claims',()=>{
  const old=account();old.asOf='2026-09-29';const paper=structuredClone(old);paper.asOf='2026-10-05';
  updatePaperExperiment(paper,old,input(paper.asOf),config,true);
  assert.equal(paper.experiment.metrics.returnPct,null);assert.equal(paper.experiment.metrics.maxDrawdownPct,null);
  assert.deepEqual(paper.experiment.metrics.missingValuationDates,['2026-10-01','2026-10-02']);
  assert.throws(()=>updatePaperExperiment(paper,old,{...input(paper.asOf),gateMatrix:{}},config,true),/verified official/);
});
