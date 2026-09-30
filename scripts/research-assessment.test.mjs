import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {normalizeFinancial,financialAssessment,normalizeOfficialEvent,eventAssessment,corporateActionAssessment} from './assess-research-evidence.mjs';
import {availableWeeks,parseTdccHistory} from './collect-tdcc-history.mjs';
import {enrich} from './research-evidence.mjs';

const policy={requirePriorYearSameQuarter:true,requireGovernanceReview:true,requirePositiveProfit:true,minRevenueYoY:0,minNetProfitYoY:0};
const income=year=>normalizeFinancial({'公司代號':'3005 ','年度':year,'季別':'2','出表日期':'1150930','營業收入':'200','營業毛利（毛損）':'60','營業利益（損失）':'30','淨利（淨損）歸屬於母公司業主':'20','基本每股盈餘（元）':'4'},'income','https://openapi.twse.com.tw/v1/opendata/t187ap06_L_ci');
const balance=normalizeFinancial({'公司代號':'3005','年度':'115','季別':'2','出表日期':'1150930','資產總計':'500','負債總計':'200','權益總計':'300','流動資產':' ','流動負債':''},'balance','https://openapi.twse.com.tw/v1/opendata/t187ap07_L_ci');
test('YTD reports do not become Q2-only results or invented blank values',()=>{
 assert.equal(income(115).basis,'YEAR_TO_DATE');assert.equal(income(115).periodEnd,'2026-06-30');assert.equal(balance.metrics.currentAssets,null);
 const assessment=financialAssessment({income:income(115),balance},null,policy);
 assert.equal(assessment.qualityPass,false);assert.equal(assessment.metrics.currentRatio,null);assert.equal(assessment.metrics.grossMargin,0.3);
 assert.ok(assessment.pending.includes('COMPARATIVE_FINANCIAL_PERIOD_NOT_VERIFIED'));
 assert.ok(assessment.pending.includes('GOVERNANCE_COVERAGE_NOT_VERIFIED'));
});
test('comparative year and actual deterioration are checked before financial permission',()=>{
 const assess=(prior,governanceVerified=true)=>financialAssessment({income:income(115),balance},{income:prior},policy,{governanceVerified});
 assert.equal(assess(income(114)).qualityPass,true);
 assert.equal(assess(income(113)).qualityPass,false);
 const stronger={...income(114),metrics:{...income(114).metrics,revenue:300}};
 assert.equal(assess(stronger).status,'FAIL');assert.ok(assess(stronger).failures.includes('REVENUE_DETERIORATION'));
});
test('latest eight-list absence is not complete event coverage; future notices cannot leak backward',()=>{
 const source='https://openapi.twse.com.tw/v1/opendata/t187ap04_L';
 const event=normalizeOfficialEvent({'公司代號':'3005','發言日期':'1150930','發言時間':'70004','主旨 ':'法人說明會','事實發生日':'1151001'},source);
 assert.equal(event.eventTimestamp,'2026-09-30T07:00:04+08:00');
 assert.equal(eventAssessment([event],'2026-09-29',null).events.length,0);
 assert.equal(eventAssessment([],'2026-09-30',null).verified,false);
 const scope={status:'VERIFIED',capturedAt:'2026-09-30T08:00:00+08:00'};
 assert.equal(eventAssessment([event],'2026-09-30',{scopes:{materialAnnouncements:scope,futureBinaryEvents:scope}},'2026-10-01').status,'EVENT_WINDOW_RISK');
 assert.equal(corporateActionAssessment([],'2026-09-30',{scopes:{exRightsDividends:scope}}).verified,false);
});
test('TDCC parser requires matching dates, symbols and all fifteen official buckets',()=>{
 const body='資料日期：115年08月28日 證券代號：3005 <table>'+Array.from({length:15},(_,i)=>`<tr><td>${i+1}</td><td>range</td><td>10</td><td>1000</td><td>1.0</td></tr>`).join('')+'</table>';
 assert.equal(parseTdccHistory(body,'3005','2026-08-28').length,15);
 assert.throws(()=>parseTdccHistory(body,'3006','2026-08-28'));
 assert.throws(()=>parseTdccHistory(body,'3005','2026-09-04'));
 assert.throws(()=>parseTdccHistory(body.replace('<td>15</td>','<td>16</td>'),'3005','2026-08-28'));
 assert.deepEqual(availableWeeks('<select name="scaDate"><option value="20260924"></option><option value="20260918"></option></select>'),['2026-09-24','2026-09-18']);
});
test('official weekly editions accept a holiday-shifted six-day interval without historical look-ahead',()=>{
 const cwd=process.cwd(),dir=fs.mkdtempSync(path.join(os.tmpdir(),'weekly-editions-'));
 try{
  process.chdir(dir);fs.mkdirSync('raw/2026-09-30',{recursive:true});fs.mkdirSync('raw/2026-09-29',{recursive:true});
  const dates=['2026-09-24','2026-09-18','2026-09-11','2026-09-04','2026-08-28'];
  const records=[0,1,2,4].map(i=>({code:'3005',dataDate:dates[i],status:'VERIFIED',capturedAt:'2026-09-30T09:00:00+08:00',rows:Array.from({length:15},(_,j)=>({'證券代號':'3005','資料日期':dates[i].replaceAll('-',''),'持股分級':j+1,'占集保庫存數比例%':1}))}));
  fs.writeFileSync('raw/2026-09-30/tdcc-history-evidence.json',JSON.stringify({officialAvailableDates:dates,calendarCapturedAt:'2026-09-30T09:00:00+08:00',records}));
  fs.writeFileSync('strategy-config.json',JSON.stringify({evidenceCollection:{tdcc:{comparisonOffsets:[0,1,2,4],freshnessCalendarDaysMax:14},financialQuality:policy}}));
  for(const d of ['2026-09-29','2026-09-30']){
   fs.writeFileSync(`raw/${d}/research-input.json`,JSON.stringify({deepDive:[{code:'3005'}]}));enrich(d);
   const row=JSON.parse(fs.readFileSync(`raw/${d}/research-input.json`)).deepDive[0];
   assert.equal(row.verifiedEvidence.tdcc,d==='2026-09-30');
   if(d==='2026-09-30')assert.equal(row.tdccEvidence.comparisons['1w'].date,'2026-09-18');
  }
 }finally{process.chdir(cwd);fs.rmSync(dir,{recursive:true,force:true});}
});
