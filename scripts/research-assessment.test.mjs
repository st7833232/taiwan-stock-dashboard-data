import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {normalizeFinancial,financialAssessment,normalizeOfficialEvent,eventAssessment,corporateActionAssessment} from './assess-research-evidence.mjs';
import {availableWeeks,parseTdccHistory} from './collect-tdcc-history.mjs';
import {captureHistoricalComparativeIncome,shouldReuseTargetArchive,parseMopsHistoricalIncomeHtml,parseMopsCompanyHistoricalIncomeHtml} from './collect-research-evidence.mjs';
import {enrich,evidenceCoverage,reviewedFinancialReport} from './research-evidence.mjs';

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
test('fixed-period historical financial archive is distinct from latest-only evidence',()=>{
 const target='2026-09-30';
 const meta={status:'CAPTURED',historicalFinancial:true,historicalArchiveSafe:true,periodEnd:'2025-06-30',capturedAt:'2026-10-01T01:00:00Z'};
 assert.equal(meta.periodEnd<target,true);
 assert.equal(meta.historicalArchiveSafe,true);
 assert.equal(meta.historicalFinancial,true);
});
test('MOPS company historical income parser selects cumulative rather than single-quarter values',()=>{
 const html='<table><tr><th>會計項目</th><th colspan="2">114年第2季</th><th colspan="2">113年第2季</th><th colspan="2">114年01月01日至114年06月30日</th><th colspan="2">113年01月01日至113年06月30日</th></tr><tr><td>營業收入合計</td><td>124594602</td><td>100.00</td><td>1</td><td>1</td><td>124594602</td><td>100.00</td><td>98311776</td><td>100.00</td></tr><tr><td>本期淨利（淨損）</td><td>22644071</td><td>18.17</td><td>1</td><td>1</td><td>22644071</td><td>18.17</td><td>10322800</td><td>10.50</td></tr></table>';
 assert.deepEqual(parseMopsCompanyHistoricalIncomeHtml(html,{code:'1101',year:2025,quarter:2}),{'公司代號':'1101','年度':2025,'季別':2,'營業收入':124594602,'本期淨利（淨損）':22644071});
 assert.throws(()=>parseMopsCompanyHistoricalIncomeHtml(html,{code:'1101',year:2023,quarter:2}),/required metrics missing/);
 assert.throws(()=>parseMopsCompanyHistoricalIncomeHtml('<table></table>',{code:'1101',year:2025,quarter:2}),/required metrics missing/);
});
test('MOPS historical income parser accepts only a complete general-industry table',()=>{
 const html=`<table><tr><th>公司代號</th><th>公司名稱</th><th>營業收入</th><th>營業毛利（毛損）</th><th>營業利益（損失）</th><th>本期淨利（淨損）</th></tr><tr><td>2409</td><td>友達</td><td>100,000</td><td>20,000</td><td>8,000</td><td>6,000</td></tr></table>`;
 const rows=parseMopsHistoricalIncomeHtml(html,{year:2025,quarter:2});
 assert.deepEqual(rows,[{'公司代號':'2409','公司名稱':'友達','年度':2025,'季別':2,'營業收入':100000,'營業毛利（毛損）':20000,'營業利益（損失）':8000,'本期淨利（淨損）':6000}]);
 assert.throws(()=>parseMopsHistoricalIncomeHtml('<table><tr><th>公司代號</th></tr></table>',{year:2025,quarter:2}),/no usable company rows/);
});
test('historical replay preserves same-target point-in-time evidence even when refresh age expired',()=>{
 const meta={status:'CAPTURED',capturedAt:'2026-09-30T14:00:00Z'};
 assert.equal(shouldReuseTargetArchive(meta,'2026-09-30',{fileExists:true,historical:true,fresh:false}),true);
 assert.equal(shouldReuseTargetArchive(meta,'2026-09-30',{fileExists:true,historical:false,fresh:false}),false);
 assert.equal(shouldReuseTargetArchive(meta,'2026-09-30',{fileExists:false,historical:true,fresh:false}),false);
 assert.equal(shouldReuseTargetArchive({status:'CAPTURED',capturedAt:'2026-09-30T16:30:00Z'},'2026-09-30',{fileExists:true,historical:true,fresh:false}),false);
});
test('official capture metadata becomes market-scoped coverage only when every required part exists',()=>{
 const base={market:'TPEx',kind:'coverage',status:'CAPTURED',capturedAt:'2026-09-30T12:10:00+08:00',rawUsable:true};
 const captures=[
  {id:'tpex-governance-O',market:'TPEx',kind:'governance',status:'CAPTURED',capturedAt:'2026-09-30T12:00:00+08:00',url:'https://example/governance',rawUsable:true},
  {id:'tpex-events-O',market:'TPEx',kind:'events',status:'CAPTURED',capturedAt:'2026-09-30T12:05:00+08:00',url:'https://example/events',rawUsable:true},
  {...base,id:'ex',url:'https://example/ex',coverageTags:['exRightsDividends','historicalPriceAdjustment:exRights']},
  {...base,id:'halt',url:'https://example/halt',coverageTags:['tradingHalts']},
  {...base,id:'reduction',url:'https://example/reduction',coverageTags:['splitReductionConversion:reduction','historicalPriceAdjustment:reduction']},
  {...base,id:'par',url:'https://example/par',coverageTags:['splitReductionConversion:parValueChange','historicalPriceAdjustment:parValueChange']}
 ];
 const coverage=evidenceCoverage(captures,'TPEx','2026-09-30');
 assert.equal(coverage.governanceVerified,true);
 assert.equal(coverage.eventCoverage.scopes.materialAnnouncements.status,'VERIFIED');
 assert.equal(coverage.eventCoverage.scopes.futureBinaryEvents.status,'VERIFIED');
 assert.equal(coverage.corporateActionCoverage.scopes.exRightsDividends.status,'VERIFIED');
 assert.equal(coverage.corporateActionCoverage.scopes.splitReductionConversion.status,'VERIFIED');
 assert.equal(coverage.corporateActionCoverage.scopes.tradingHalts.status,'VERIFIED');
 assert.equal(coverage.corporateActionCoverage.scopes.historicalPriceAdjustment.status,'VERIFIED');
 assert.equal(evidenceCoverage(captures.filter(c=>c.id!=='par'),'TPEx','2026-09-30').corporateActionCoverage.scopes.splitReductionConversion.status,'UNVERIFIED');
 assert.equal(evidenceCoverage([{...captures[0],rawUsable:false}],'TPEx','2026-09-30').governanceVerified,false);
 const event=normalizeOfficialEvent({SecuritiesCompanyCode:'3005','發言日期':'1150930','發言時間':'120000','主旨':'法說會','事實發生日':'1151001'},'https://example/events');
 assert.equal(event.code,'3005');
 const notCorporate=normalizeOfficialEvent({'公司代號':'8150','發言日期':'1150930','發言時間':'120000','主旨':'公布注意交易資訊','說明':'完整財務資訊可至合併/個別報表查閱'},'https://example/events');
 assert.equal(notCorporate.eventType,'OTHER');
 const tpexIncome=normalizeFinancial({SecuritiesCompanyCode:'3005',Year:'115',Season:'2','營業收入':'200','營業毛利（毛損）':'60','營業利益（損失）':'30','淨利（淨損）歸屬於母公司業主':'20','基本每股盈餘（元）':'4'},'income','https://example/income');
 assert.equal(tpexIncome.code,'3005');assert.equal(tpexIncome.periodEnd,'2026-06-30');
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

test('same quarter cannot grant permission with a different cumulative or profit basis',()=>{
 for(const prior of [{...income(114),basis:'QUARTER_ONLY'},{...income(114),profitBasis:'TOTAL'}])assert.ok(financialAssessment({income:income(115),balance},{income:prior},policy,{governanceVerified:true}).pending.includes('COMPARATIVE_FINANCIAL_PERIOD_NOT_VERIFIED'));
});
test('late or obsolete historical captures never authorize a retrospective financial gate',()=>{
 const cwd=process.cwd(),dir=fs.mkdtempSync(path.join(os.tmpdir(),'financial-cutoff-'));
 try{
  process.chdir(dir);fs.mkdirSync('raw/2026-09-30',{recursive:true});
  fs.writeFileSync('strategy-config.json',JSON.stringify({evidenceCollection:{tdcc:{comparisonOffsets:[1],freshnessCalendarDaysMax:14},financialQuality:policy}}));
  for(const meta of [{capturedAt:'2026-10-01T01:00:00Z',parserVersion:2},{capturedAt:'2026-09-30T01:00:00Z'}]){
   fs.writeFileSync('raw/2026-09-30/research-input.json',JSON.stringify({deepDive:[{code:'3005'}]}));
   fs.writeFileSync('raw/2026-09-30/financial-evidence-captures.json',JSON.stringify({captures:[{id:'prior',kind:'income',status:'CAPTURED',historicalFinancial:true,historicalArchiveSafe:true,periodEnd:'2025-06-30',...meta}]}));
   fs.writeFileSync('raw/2026-09-30/prior.raw.txt',JSON.stringify([{'公司代號':'3005','年度':114,'季別':2,'營業收入':100,'本期淨利（淨損）':10}]));
   enrich('2026-09-30');assert.equal(JSON.parse(fs.readFileSync('raw/2026-09-30/research-input.json')).deepDive[0].financialEvidence,null);
  }
 }finally{process.chdir(cwd);fs.rmSync(dir,{recursive:true,force:true});}
});

test('historical recovery never refetches financial reports that cannot be admitted as of its cutoff',async()=>{
 const old={captures:[
  {id:'prior-safe',historicalFinancial:true,kind:'income',parserVersion:2,status:'CAPTURED',capturedAt:'2026-09-30T01:00:00Z'},
  {id:'prior-late',historicalFinancial:true,kind:'income',parserVersion:2,status:'CAPTURED',capturedAt:'2026-10-01T01:00:00Z'},
  {id:'prior-obsolete',historicalFinancial:true,kind:'income',status:'CAPTURED',capturedAt:'2026-09-30T01:00:00Z'}
 ]};
 // An absent root proves retrospective recovery does not begin a network or filesystem collection.
 const rows=await captureHistoricalComparativeIncome('/absent',[],old,'2026-09-30',new Date('2026-10-01T01:00:00Z'));
 assert.equal(rows[0].status,'CAPTURED');assert.equal(rows[0].preservedTargetArchive,true);
 assert.ok(rows.slice(1).every(r=>r.status==='NOT_CAPTURED_RETROSPECTIVE'));
});

test('reviewed filed PDFs require the actual archived file, unchanged hash and publication before cutoff',()=>{
 const report=JSON.parse(fs.readFileSync('history/reviewed-financial-reports.json'))[0];
 assert.equal(reviewedFinancialReport(report,'2026-09-30').metrics.revenue,141338620);
 assert.equal(reviewedFinancialReport(report,'2025-08-12'),null);
 for(const change of [{sha256:'0'.repeat(64)},{uploadedAt:'114/08/14 15:14:07'},{filename:'../other.pdf'},{basis:'QUARTER_ONLY'},{unit:'TWD'},{source:'https://example.com/'}])assert.equal(reviewedFinancialReport({...report,...change},'2026-09-30'),null);
 assert.equal(reviewedFinancialReport({...report,row:{...report.row,'公司代號':'8150'}},'2026-09-30'),null);
});
