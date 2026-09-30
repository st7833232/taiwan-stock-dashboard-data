import test from 'node:test';
import assert from 'node:assert/strict';
import {buildEvidenceAudit,auditedReasonDescriptions} from './evidence-audit.mjs';
test('late historical evidence is visible without granting point-in-time trade permission',()=>{
 const gates={tdcc:false,fundamental:false,event:false,corporateAction:false};
 const row={code:'3005',assetType:'STOCK',current:{market:'TWSE'},fundamental:{monthlyRevenue:{dataMonthKey:'2026-08'}},tdccEvidence:{latest:{date:'2026-09-18',large400:70,retail50:20},comparisons:{'1w':{date:'2026-09-11'}}}};
 const record=date=>({code:'3005',status:'VERIFIED_HISTORICAL_PAYLOAD',dataDate:date,decisionEligible:false,capturedAt:'2026-09-30T12:00:00+08:00',rows:Array.from({length:15},(_,i)=>({level:i+1,ratio:1}))});
 const a=buildEvidenceAudit(row,gates,'2026-09-29',{records:[record('2026-09-04'),record('2026-08-21'),record('2026-10-02')]});
 assert.equal(a.tdcc.status,'HISTORICAL_QUERIES_VERIFIED_ASOF_PENDING');
 assert.equal(a.tdcc.decisionEligible,false);assert.equal(a.tdcc.publicationTimingVerified,false);
 assert.deepEqual(Object.keys(a.tdcc.historicalComparisons),['2w','4w']);
 assert.equal(a.fundamental.status,'QUALITY_ASSESSMENT_PENDING');
 assert.deepEqual(gates,{tdcc:false,fundamental:false,event:false,corporateAction:false});
 const text=auditedReasonDescriptions(['TDCC_PERSISTENCE_NOT_VERIFIED','FUNDAMENTAL_QUALITY_NOT_VERIFIED'],a,()=>['fallback']);
 assert.match(text[0],/當時可得性未驗證/);assert.match(text[1],/已有2026-08營收/);
});
