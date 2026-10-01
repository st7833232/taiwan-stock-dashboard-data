import {officialDate} from './research-evidence.mjs';

const value=(row,names)=>{for(const name of names){const raw=row?.[name];if(raw!==null&&raw!==undefined&&String(raw).trim()!==''){const n=Number(String(raw).replaceAll(',',''));if(Number.isFinite(n))return n;}}return null;};
const ratio=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&b>0?a/b:null;
export function normalizeFinancial(row,kind,source) {
  const code=String(row?.['公司代號']??row?.['公司代碼']??row?.SecuritiesCompanyCode??row?.CompanyCode??'').trim(),year=value(row,['年度','Year']),quarter=value(row,['季別','季','Season','Quarter']);
  if(!code||!Number.isInteger(year)||!Number.isInteger(quarter)||quarter<1||quarter>4)return null;
  const periodEnd=new Date(Date.UTC(year<1911?year+1911:year,quarter*3,0)).toISOString().slice(0,10);
  const metrics=kind==='income'?{
    revenue:value(row,['營業收入','收入','收益']),grossProfit:value(row,['營業毛利（毛損）淨額','營業毛利（毛損）']),operatingProfit:value(row,['營業利益（損失）','營業利益']),netProfit:value(row,['淨利（淨損）歸屬於母公司業主','淨利（損）歸屬於母公司業主','本期淨利（淨損）','本期稅後淨利（淨損）']),eps:value(row,['基本每股盈餘（元）'])
  }:{assets:value(row,['資產總計','資產總額']),liabilities:value(row,['負債總計','負債總額']),equity:value(row,['權益總計','權益總額']),currentAssets:value(row,['流動資產']),currentLiabilities:value(row,['流動負債'])};
  return {code,periodEnd,quarter,kind,basis:kind==='income'?'YEAR_TO_DATE':'PERIOD_END',extractDate:officialDate(row['出表日期']??row.Date),source,profitBasis:kind==='income'?(value(row,['淨利（淨損）歸屬於母公司業主','淨利（損）歸屬於母公司業主'])!==null?'PARENT':'TOTAL'):null,metrics};
}
export function financialAssessment(current,comparative,policy,{governanceVerified=false,negativeGovernance=false}={}) {
  const income=current?.income,balance=current?.balance,prior=comparative?.income,pending=[];
  if(!income||!balance)pending.push('QUARTERLY_INCOME_OR_BALANCE_NOT_ARCHIVED_ASOF');
  if(income&&balance&&income.periodEnd!==balance.periodEnd)pending.push('FINANCIAL_PERIOD_CONFLICT');
  if(policy.requirePriorYearSameQuarter&&(!prior||prior.quarter!==income?.quarter||prior.basis!==income?.basis||prior.profitBasis!==income?.profitBasis||Number(prior.periodEnd.slice(0,4))!==Number(income?.periodEnd.slice(0,4))-1))pending.push('COMPARATIVE_FINANCIAL_PERIOD_NOT_VERIFIED');
  if(policy.requireGovernanceReview&&!governanceVerified)pending.push('GOVERNANCE_COVERAGE_NOT_VERIFIED');
  const m=income?.metrics??{},b=balance?.metrics??{},p=prior?.metrics??{};
  const metrics={...m,...b,grossMargin:ratio(m.grossProfit,m.revenue),operatingMargin:ratio(m.operatingProfit,m.revenue),liabilityAssetRatio:ratio(b.liabilities,b.assets),currentRatio:ratio(b.currentAssets,b.currentLiabilities),revenueYoY:ratio(m.revenue,p.revenue)===null?null:m.revenue/p.revenue-1,netProfitYoY:ratio(m.netProfit,p.netProfit)===null?null:m.netProfit/p.netProfit-1};
  const required=['revenue','grossProfit','operatingProfit','netProfit','eps','assets','liabilities','equity'];
  if(required.some(k=>!Number.isFinite(metrics[k])))pending.push('FINANCIAL_METRICS_INCOMPLETE');
  if(prior&&['revenue','netProfit'].some(k=>!Number.isFinite(p[k])))pending.push('COMPARATIVE_METRICS_NOT_VERIFIED');
  const failures=[];
  if(prior&&['revenue','netProfit'].some(k=>Number.isFinite(p[k])&&p[k]<=0))failures.push('COMPARATIVE_GROWTH_NOT_APPLICABLE');
  if(Number.isFinite(m.revenue)&&m.revenue<=0)failures.push('NONPOSITIVE_REVENUE');
  if(policy.requirePositiveProfit&&['grossProfit','operatingProfit','netProfit','eps'].some(k=>Number.isFinite(m[k])&&m[k]<=0))failures.push('PROFIT_QUALITY_FAILED');
  if(Number.isFinite(b.equity)&&b.equity<=0)failures.push('NONPOSITIVE_EQUITY');
  if(Number.isFinite(metrics.revenueYoY)&&metrics.revenueYoY<policy.minRevenueYoY)failures.push('REVENUE_DETERIORATION');
  if(Number.isFinite(metrics.netProfitYoY)&&metrics.netProfitYoY<policy.minNetProfitYoY)failures.push('PROFIT_DETERIORATION');
  if(negativeGovernance)failures.push('OFFICIAL_GOVERNANCE_WARNING');
  return {status:pending.length?'UNVERIFIED':failures.length?'FAIL':'PASS',verified:pending.length===0,qualityPass:pending.length===0&&failures.length===0,pending,failures,metrics,periodEnd:income?.periodEnd??null,basis:income?.basis??null,sources:[income?.source,balance?.source,prior?.source].filter(Boolean)};
}
export function normalizeOfficialEvent(row,source) {
  const code=String(row['公司代號']??row['公司代碼']??row.SecuritiesCompanyCode??row.companyId??'').trim(),date=officialDate(row['發言日期']??row.date??row.Date),rawTime=String(row['發言時間']??row.time??'').replace(/\D/g,'');
  const time=rawTime.length===4?rawTime+'00':rawTime.padStart(6,'0');
  if(!code||!date||!/^\d{6}$/.test(time)||Number(time.slice(0,2))>23||Number(time.slice(2,4))>59||Number(time.slice(4,6))>59)return null;
  const subject=String(row['主旨 ']??row['主旨']??row.subject??'').trim(),body=String(row['說明']??''),content=subject+' '+body;
  let eventType='OTHER';
  if(/法人說明會|法說會/.test(subject))eventType='INVESTOR_CONFERENCE';
  else if(/停止買賣|恢復買賣|暫停交易/.test(subject))eventType='TRADING_HALT';
  else if(/面額|分割|減資|除權|除息|股份轉換/.test(subject))eventType='CORPORATE_ACTION';
  else if(/財務報告|盈餘|獲利/.test(subject))eventType='EARNINGS';
  else if(/營收/.test(subject))eventType='REVENUE';
  else if(/裁罰|違規|法院|訴訟/.test(subject))eventType='GOVERNANCE';
  return {code,sourceQuality:'SOURCE_A',source,eventType,direction:'UNCERTAIN',eventTimestamp:`${date}T${time.slice(0,2)}:${time.slice(2,4)}:${time.slice(4,6)}+08:00`,factDate:officialDate(row['事實發生日']),subject,body,catalystStatus:'UNVERIFIED',priceConfirmation:false,volumeConfirmation:false,institutionalConfirmation:false};
}
export function eventAssessment(events,target,coverage,nextTradingDate=null) {
  const cutoff=Date.parse(`${target}T23:59:59+08:00`),asOf=events.filter(e=>Number.isFinite(Date.parse(e.eventTimestamp))&&Date.parse(e.eventTimestamp)<=cutoff).sort((a,b)=>a.eventTimestamp.localeCompare(b.eventTimestamp));
  const scopes=coverage?.scopes??{};
  const complete=['materialAnnouncements','futureBinaryEvents'].every(s=>scopes[s]?.status==='VERIFIED'&&Date.parse(scopes[s].capturedAt)<=cutoff);
  // Latest-list absence and an announcement's fact date are never an exhaustive event calendar.
  const binaryTypes=new Set(['EARNINGS','INVESTOR_CONFERENCE','REGULATION','LITIGATION','CORPORATE_ACTION']);
  const binaryEvents=asOf.filter(e=>binaryTypes.has(e.eventType)&&nextTradingDate&&e.factDate===nextTradingDate);
  return {status:!complete?'COVERAGE_INCOMPLETE':binaryEvents.length?'EVENT_WINDOW_RISK':'VERIFIED',verified:complete&&binaryEvents.length===0,events:asOf,binaryEvents,pending:['materialAnnouncements','futureBinaryEvents'].filter(s=>scopes[s]?.status!=='VERIFIED'||!(Date.parse(scopes[s].capturedAt)<=cutoff)),newsEvent:asOf.at(-1)??null};
}
export function corporateActionAssessment(events,target,coverage) {
  const cutoff=Date.parse(`${target}T23:59:59+08:00`),scopes=coverage?.scopes??{};
  const required=['exRightsDividends','splitReductionConversion','tradingHalts','historicalPriceAdjustment'];
  const pending=required.filter(s=>scopes[s]?.status!=='VERIFIED'||!(Date.parse(scopes[s].capturedAt)<=cutoff));
  const observed=events.filter(e=>Date.parse(e.eventTimestamp)<=cutoff&&['CORPORATE_ACTION','TRADING_HALT'].includes(e.eventType));
  return {status:pending.length?'COVERAGE_INCOMPLETE':'VERIFIED',verified:pending.length===0,pending,observed};
}
