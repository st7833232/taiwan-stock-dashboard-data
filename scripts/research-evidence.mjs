import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {normalizeFinancial,financialAssessment,normalizeOfficialEvent,eventAssessment,corporateActionAssessment} from './assess-research-evidence.mjs';
import {parseListingHtml} from './collect-research-evidence.mjs';

const read=p=>{try{return JSON.parse(fs.readFileSync(p,'utf8'));}catch{return null;}};
const num=x=>x===null||x===undefined||String(x).trim()===''?null:Number.isFinite(Number(String(x).replaceAll(',','')))?Number(String(x).replaceAll(',','')):null;
const verifiedScope=c=>c?{status:'VERIFIED',capturedAt:c.capturedAt,source:c.url,id:c.id}:{status:'UNVERIFIED',capturedAt:null,source:null,id:null};
const compositeScope=(usable,tags)=>{
  const matched=tags.map(tag=>usable.filter(c=>c.coverageTags?.includes(tag)).sort((a,b)=>Date.parse(a.capturedAt)-Date.parse(b.capturedAt)).at(-1)??null);
  if(matched.some(x=>!x))return {status:'UNVERIFIED',capturedAt:null,sources:matched.filter(Boolean).map(x=>x.url),ids:matched.filter(Boolean).map(x=>x.id),requiredTags:tags,missingTags:tags.filter((_,i)=>!matched[i])};
  return {status:'VERIFIED',capturedAt:new Date(Math.max(...matched.map(x=>Date.parse(x.capturedAt)))).toISOString(),sources:matched.map(x=>x.url),ids:matched.map(x=>x.id),requiredTags:tags,missingTags:[]};
};
export function evidenceCoverage(captures,market,target) {
  const cutoff=Date.parse(`${target}T23:59:59+08:00`);
  const usable=(captures??[]).filter(c=>c?.market===market&&c.status==='CAPTURED'&&c.rawUsable!==false&&Number.isFinite(Date.parse(c.capturedAt))&&Date.parse(c.capturedAt)<=cutoff);
  const latest=(...kinds)=>usable.filter(c=>kinds.includes(c.kind)).sort((a,b)=>Date.parse(a.capturedAt)-Date.parse(b.capturedAt)).at(-1)??null;
  const governanceScope=verifiedScope(latest('governance'));
  const materialAnnouncements=verifiedScope(latest('events'));
  const exRightsDividends=compositeScope(usable,['exRightsDividends']);
  const splitReductionConversion=compositeScope(usable,['splitReductionConversion:reduction','splitReductionConversion:parValueChange']);
  const tradingHalts=compositeScope(usable,['tradingHalts']);
  const historicalPriceAdjustment=compositeScope(usable,['historicalPriceAdjustment:exRights','historicalPriceAdjustment:reduction','historicalPriceAdjustment:parValueChange']);
  const futureInputs=[materialAnnouncements,exRightsDividends,splitReductionConversion,tradingHalts];
  const futureBinaryEvents=futureInputs.every(s=>s.status==='VERIFIED')
    ? {status:'VERIFIED',capturedAt:new Date(Math.max(...futureInputs.map(s=>Date.parse(s.capturedAt)))).toISOString(),method:'OFFICIAL_DISCLOSURES_PLUS_EXCHANGE_CORPORATE_ACTION_CALENDARS'}
    : {status:'UNVERIFIED',capturedAt:null,method:'OFFICIAL_DISCLOSURES_PLUS_EXCHANGE_CORPORATE_ACTION_CALENDARS',missingScopes:['materialAnnouncements','exRightsDividends','splitReductionConversion','tradingHalts'].filter((_,i)=>futureInputs[i].status!=='VERIFIED')};
  return {
    governanceVerified:governanceScope.status==='VERIFIED',
    governanceScope,
    eventCoverage:{scopes:{materialAnnouncements,futureBinaryEvents}},
    corporateActionCoverage:{scopes:{exRightsDividends,splitReductionConversion,tradingHalts,historicalPriceAdjustment}}
  };
}
export function officialDate(x) {
  const s=String(x??'').replace(/\D/g,'');
  let date=null;
  if(s.length===8)date=`${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6)}`;
  if(s.length===7)date=`${Number(s.slice(0,3))+1911}-${s.slice(3,5)}-${s.slice(5)}`;
  return date && !Number.isNaN(Date.parse(date+'T00:00:00Z')) && new Date(date+'T00:00:00Z').toISOString().slice(0,10)===date?date:null;
}
export function tdccWeeks(rows,target) {
  const groups=new Map();
  for(const r of rows) {
    const code=String(r['證券代號']??r.SecurityCode??'').trim(),date=officialDate(r['資料日期']??r['\uFEFF資料日期']??r.DataDate),level=num(r['持股分級']??r.HoldingLevel),ratio=num(r['占集保庫存數比例%']??r['占集保庫存數比例(%)']??r['占集保庫存數比例']??r.HoldingRatio);
    if(!code||!date||date>target||!Number.isInteger(level)||!Number.isFinite(ratio)||ratio<0||ratio>100)continue;
    const key=`${code}|${date}`;if(!groups.has(key))groups.set(key,{code,date,levels:new Map()});groups.get(key).levels.set(level,ratio);
  }
  return [...groups.values()].filter(g=>Array.from({length:15},(_,i)=>i+1).every(l=>g.levels.has(l))).map(g=>({code:g.code,date:g.date,large400:[12,13,14,15].reduce((s,l)=>s+g.levels.get(l),0),retail50:[1,2,3,4,5,6,7,8].reduce((s,l)=>s+g.levels.get(l),0)}));
}
export function evidenceSummary(input,result) {
  // A rejected strategy is a finished decision. Missing evidence is unfinished research.
  const checks=['history','institutional','credit','tdcc','fundamental','event','corporateAction'];
  const detail=new Map(input.deepDive.map(r=>[r.code,r])),pending={},fundamentalQualityRejected=[],historyQualityRejected=[];
  for(const r of result.rows.filter(r=>detail.has(r.code))) {
    const assessment=detail.get(r.code).financialAssessment;
    const rejected=assessment?.status==='FAIL'&&assessment.verified===true&&assessment.qualityPass===false&&assessment.pending?.length===0&&assessment.failures?.length>0;
    if(rejected)fundamentalQualityRejected.push({code:r.code,failures:assessment.failures});
    const h=detail.get(r.code).historyAssessment,historyRejected=h?.verified===true&&h.qualityPass===false&&h.pending?.length===0&&h.failures?.includes('INSUFFICIENT_HISTORY_SINCE_LISTING');
    if(historyRejected)historyQualityRejected.push({code:r.code,...h});
    for(const key of checks)if(r.gates[key]!==true&&!(key==='fundamental'&&rejected)&&!(key==='history'&&historyRejected))(pending[key]??=[]).push(r.code);
  }
  if(!result.regimeVerified)pending.marketRegime=['MARKET'];
  return {researchComplete:Object.keys(pending).length===0,pending,counts:Object.fromEntries(Object.entries(pending).map(([key,codes])=>[key,codes.length])),fundamentalQualityRejected,historyQualityRejected};
}
export function historyAssessment(row,archive,cache,required,target){
 const unverified=reason=>({status:'VERIFY_FAILED',verified:false,qualityPass:false,pending:[reason],failures:[]}),market=row.current?.market??row.market;
 const sources=archive?.records?.find(r=>r.code===row.code)?.sources,calendar=archive?.calendar,c=calendar?.payload;
 if(archive?.targetDate!==target||sources?.length!==2||sources.some(s=>s.status!=='CAPTURED')||new Set(sources.map(s=>s.url)).size!==2)return unverified('OFFICIAL_LISTING_SOURCES_UNVERIFIED');
 const dates=sources.map(s=>{
  if(s.url===`https://isin.twse.com.tw/isin/single_main.jsp?owncode=${row.code}&stockname=&isincode=`||market==='TPEx'&&s.url==='https://isin.twse.com.tw/isin/C_public.jsp?strMode=4')return officialDate(parseListingHtml(s.recordHtml,row.code,market)?.listingDate);
  const r=s.record;
  if(market==='TWSE'&&s.url==='https://openapi.twse.com.tw/v1/opendata/t187ap47_L'&&r?.['基金代號']===row.code&&officialDate(r['出表日期'])<=target)return officialDate(r['上市日期']);
  if(market==='TPEx'&&s.url==='https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O'&&r?.SecuritiesCompanyCode===row.code&&officialDate(r.Date)<=target)return officialDate(r.DateOfListing);
  return null;
 });
 const listingDate=dates[0];if(!listingDate||dates.some(d=>d!==listingDate)||listingDate>target||listingDate.slice(0,4)!==target.slice(0,4))return unverified('OFFICIAL_LISTING_DATE_UNVERIFIED');
 if(calendar?.url!==`https://www.twse.com.tw/holidaySchedule/holidaySchedule?response=json&queryYear=${Number(target.slice(0,4))-1911}`||calendar.status!=='CAPTURED'||String(c?.stat).toLowerCase()!=='ok'||c.queryYear!==Number(target.slice(0,4))||!officialDate(c.date)||officialDate(c.date)>target||!c.data?.length||c.data.some(r=>!officialDate(r[0])))return unverified('OFFICIAL_TRADING_CALENDAR_UNVERIFIED');
 const closed=new Set(c.data.filter(r=>/放假|無交易/.test(r.slice(1).join(''))).map(r=>officialDate(r[0]))),opened=new Set(c.data.filter(r=>/開始交易|最後交易|補行交易/.test(r.slice(1).join(''))).map(r=>officialDate(r[0]))),expected=[];
 for(let d=new Date(listingDate+'T00:00:00Z');d.toISOString().slice(0,10)<=target;d.setUTCDate(d.getUTCDate()+1)){const date=d.toISOString().slice(0,10);if(!closed.has(date)&&(d.getUTCDay()%6!==0||opened.has(date)))expected.push(date);}
 const quotes=new Map((row.history??[]).filter(h=>h[0]>=listingDate&&h[0]<=target&&h.slice(1,7).length===6&&h.slice(1,7).every(Number.isFinite)).map(h=>[h[0],h]));
 // The calendar is an upper bound: suspensions or exceptional closures can only reduce available history.
 // This proves rejection without claiming that every historical candle was retrieved or missing.
 if(!expected.length||expected.length>=required||!quotes.has(target)||[...quotes.keys()].some(date=>!(cache?.provenance?.[date]?.[market?.toLowerCase()]?.status==='PASS'||cache?.provenance?.[date]?.currentResearchInput===true&&read(`raw/${date}/gate-matrix.json`)?.overallStatus==='PASS')))return unverified('HISTORY_ELIGIBILITY_NOT_VERIFIED');
 return {status:'FAIL',verified:true,qualityPass:false,pending:[],failures:['INSUFFICIENT_HISTORY_SINCE_LISTING'],listingDate,availableTradingDays:quotes.size,verifiedTradingDays:quotes.size,maximumPossibleTradingDays:expected.length,requiredTradingDays:required,sources:sources.map(s=>s.url),calendarSource:calendar.url};
}
export function reviewedFinancialReport(report,target) {
  try {
    const row=report.row,code=String(row?.['公司代號']??''),year=row?.['年度'],quarter=row?.['季別'];
    if(!/^\d{4}$/.test(code)||!Number.isInteger(year)||!Number.isInteger(quarter)||quarter<1||quarter>4)return null;
    if(report.filename!==`${year}${String(quarter).padStart(2,'0')}_${code}_AI1.pdf`||report.basis!=='YEAR_TO_DATE'||report.unit!=='TWD_THOUSAND'||!report.reviewedPages?.length)return null;
    const source=new URL(report.source);
    if(source.origin!=='https://doc.twse.com.tw'||source.pathname!=='/server-java/t57sb01'||source.searchParams.get('co_id')!==code||source.searchParams.get('year')!==String(year-1911))return null;
    if(!/^[a-f0-9]{64}$/.test(report.sha256))return null;
    const archiveKey=report.archiveKey;
    if(archiveKey&&archiveKey!==`${report.filename}.${report.sha256}`)return null;
    const index=fs.readFileSync(archiveKey?`history/financial-reports/${archiveKey}.html`:`history/financial-reports/${code}.html`,'utf8');
    const filing=[...index.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].find(m=>m[1].includes(report.filename));
    if(!filing)return null;
    const cells=[...filing[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(m=>m[1].replace(/<[^>]*>/g,'').trim());
    if(cells.length!==11||cells[0]!==code||cells[5]!=='IFRSs合併財報'||cells[7]!==report.filename||cells[9]!==report.uploadedAt||cells[10]!=='無')return null;
    const date=report.uploadedAt.match(/^(\d{3})\/(\d{2})\/(\d{2}) (\d{2}:\d{2}:\d{2})$/);
    if(!date)return null;
    const publication=`${Number(date[1])+1911}-${date[2]}-${date[3]}T${date[4]}+08:00`;
    if(!Number.isFinite(Date.parse(publication))||Date.parse(publication)>Date.parse(`${target}T23:59:59+08:00`))return null;
    const pdf=fs.readFileSync(archiveKey?`history/financial-reports/${archiveKey}.pdf`:`history/financial-reports/${report.filename}`);
    if(pdf.subarray(0,5).toString()!=='%PDF-'||createHash('sha256').update(pdf).digest('hex')!==report.sha256)return null;
    const normalized=normalizeFinancial(row,'income',report.source);
    return normalized?.periodEnd<=target?{...normalized,publicationTimestamp:publication,filename:report.filename,sha256:report.sha256,reviewedPages:report.reviewedPages}:null;
  }catch{return null;}
}
export function enrich(target) {
  const root=`raw/${target}`,input=read(`${root}/research-input.json`);if(!input)throw Error('Research input missing');
  const listingArchive=read(`${root}/listing-history-evidence.json`),historyCache=read('history/market-history.json');
  const config=read('strategy-config.json'),weeks=[],editions=new Set(),cutoff=Date.parse(`${target}T23:59:59+08:00`);
  for(const date of fs.readdirSync('raw').filter(d=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&d<=target).sort()) {
    const archive=read(`raw/${date}/tdcc-history-evidence.json`);
    if(Date.parse(archive?.calendarCapturedAt)<=cutoff)for(const d of archive.officialAvailableDates??[])if(d<=target)editions.add(d);
    for(const r of archive?.records??[])if(r.status==='VERIFIED'&&Date.parse(r.capturedAt)<=cutoff)weeks.push(...tdccWeeks(r.rows,target));
    const matrix=read(`raw/${date}/gate-matrix.json`),capture=matrix?.captures?.find(c=>c.source==='tdcc-shareholding-distribution'&&c.status==='CAPTURED');
    if(!capture||!Number.isFinite(Date.parse(capture.capturedAt))||Date.parse(capture.capturedAt)>Date.parse(`${target}T23:59:59+08:00`))continue;
    const capturedDate=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei'}).format(new Date(capture.capturedAt));
    const rows=read(`raw/${date}/tdcc-shareholding-distribution.raw.txt`);if(Array.isArray(rows))weeks.push(...tdccWeeks(rows,capturedDate<target?capturedDate:target));
  }
  const unique=new Map(weeks.map(r=>[`${r.code}|${r.date}`,r])),byCode=new Map();
  for(const row of unique.values()){if(!byCode.has(row.code))byCode.set(row.code,[]);byCode.get(row.code).push(row);}
  const financial=new Map(),financialPeriods=new Map(),events=new Map(),governance=new Map();
  const captures=fs.readdirSync('raw').filter(d=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&d<=target).sort().flatMap(d=>(read(`raw/${d}/financial-evidence-captures.json`)?.captures??[]).map(c=>{const rawRoot=`raw/${d}`;return {...c,rawRoot,rawUsable:Boolean(c.id&&fs.existsSync(`${rawRoot}/${c.id}.raw.txt`))};}));
  for(const c of captures.filter(c=>{
    if(c.status!=='CAPTURED'||!c.rawUsable)return false;
    const capturedInTime=Date.parse(c.capturedAt)<=Date.parse(`${target}T23:59:59+08:00`);
    return capturedInTime&&(!c.historicalFinancial||c.parserVersion===2);
  })) {
    if(c.kind==='coverage')continue;
    const evidenceRows=read(`${c.rawRoot}/${c.id}.raw.txt`);
    if(!Array.isArray(evidenceRows))continue;
    for(const row of evidenceRows) {
      if(c.kind==='events') {const event=normalizeOfficialEvent(row,c.url);if(event&&Date.parse(event.eventTimestamp)<=cutoff){if(!events.has(event.code))events.set(event.code,[]);events.get(event.code).push(event);}continue;}
      if(c.kind==='governance'){const code=String(row['股票代號']??row['公司代號']??row['公司代碼']??row.SecuritiesCompanyCode??'').trim();if(code)governance.set(code,row);continue;}
      if(!['income','balance'].includes(c.kind))continue;
      const normalized=normalizeFinancial(row,c.kind,c.url);if(!normalized||normalized.periodEnd>target||normalized.extractDate>target)continue;
      const {code,periodEnd}=normalized;
      const key=`${code}|${periodEnd}`,period=financialPeriods.get(key)??{};period[c.kind]=normalized;financialPeriods.set(key,period);
      const data=financial.get(code)??{};
      if(!data[c.kind]||periodEnd>=data[c.kind].periodEnd)data[c.kind]={source:c.url,periodEnd,row,normalized};financial.set(code,data);
    }
  }
  // Reviewed official files retain their documented publication version; latest-only feeds do not.
  for(const report of read('history/reviewed-financial-reports.json')??[]) {
    const normalized=reviewedFinancialReport(report,target);if(!normalized)continue;
    const key=`${normalized.code}|${normalized.periodEnd}`,period=financialPeriods.get(key)??{};
    period.income=normalized;financialPeriods.set(key,period);
  }
  for(const row of input.deepDive) {
    row.historyAssessment=Number.isFinite(row.historyCoverageTradingDays)&&row.historyCoverageTradingDays<config.screening.historyTradingDaysMin?historyAssessment(row,listingArchive,historyCache,config.screening.historyTradingDaysMin,target):null;
    const records=(byCode.get(row.code)??[]).sort((a,b)=>a.date.localeCompare(b.date));
    const last=records.at(-1),deltaDays=(a,b)=>(Date.parse(a)-Date.parse(b))/86400000;
    // Compare official weekly editions, not seven-calendar-day windows (holidays shift publication).
    const calendar=[...editions].filter(d=>!last||d<=last.date).sort().reverse();
    const at=n=>last&&calendar.length?records.find(r=>r.date===calendar[n]):null;
    const offsets=config.evidenceCollection.tdcc.comparisonOffsets.filter(n=>n>0),old=offsets.map(at),ready=Boolean(last&&calendar[0]===last.date&&deltaDays(target,last.date)<=config.evidenceCollection.tdcc.freshnessCalendarDaysMax&&old.every(Boolean));
    row.tdccEvidence={status:ready?'VERIFIED':'PERSISTENCE_PENDING',latest:last??null,comparisonBasis:'OFFICIAL_WEEKLY_EDITION',comparisons:Object.fromEntries(offsets.map((n,i)=>[`${n}w`,old[i]?{date:old[i].date,large400Change:last.large400-old[i].large400,retail50Change:last.retail50-old[i].retail50}:null]))};
    row.financialEvidence=financial.get(row.code)??null;
    const current=row.financialEvidence;
    const periodEnd=current?.income?.periodEnd,priorPeriod=periodEnd?`${Number(periodEnd.slice(0,4))-1}${periodEnd.slice(4)}`:null;
    const coverage=evidenceCoverage(captures,row.current?.market??row.market,target);
    row.evidenceCoverage=coverage;
    row.financialAssessment=financialAssessment({income:current?.income?.normalized,balance:current?.balance?.normalized},financialPeriods.get(`${row.code}|${priorPeriod}`),config.evidenceCollection.financialQuality,{governanceVerified:coverage.governanceVerified,negativeGovernance:governance.has(row.code)});
    row.eventAssessment=eventAssessment(events.get(row.code)??[],target,coverage.eventCoverage,input.verifiedCalendar?.nextTradingDate??null);
    row.corporateActionAssessment=corporateActionAssessment(events.get(row.code)??[],target,coverage.corporateActionCoverage);
    // Verified data is not a verified quality/catalyst decision. Do not grant BUY permission from raw reports.
    row.verifiedEvidence={...row.verifiedEvidence,tdcc:ready,tdccScoreFraction:ready?(old.filter(r=>last.large400>r.large400&&last.retail50<r.retail50).length/old.length):0,fundamental:row.financialAssessment.qualityPass,fundamentalScoreFraction:row.financialAssessment.qualityPass?config.evidenceCollection.financialQuality.qualityWeightFraction:0,eventRisk:row.eventAssessment.verified,corporateAction:row.corporateActionAssessment.verified};
  }
  fs.writeFileSync(`${root}/research-input.json`,JSON.stringify(input,null,2)+'\n');
  console.log(JSON.stringify({stage:'EVIDENCE_ENRICHMENT',targetDate:target,tdccReady:input.deepDive.filter(r=>r.verifiedEvidence.tdcc).length,financialRecords:financial.size}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)enrich(process.env.TARGET_DATE);
