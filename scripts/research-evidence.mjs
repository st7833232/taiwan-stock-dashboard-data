import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {normalizeFinancial,financialAssessment,normalizeOfficialEvent,eventAssessment,corporateActionAssessment} from './assess-research-evidence.mjs';

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
  const detail=new Set(input.deepDive.map(r=>r.code)),pending={};
  for(const r of result.rows.filter(r=>detail.has(r.code)))for(const key of checks)if(r.gates[key]!==true)(pending[key]??=[]).push(r.code);
  if(!result.regimeVerified)pending.marketRegime=['MARKET'];
  return {researchComplete:Object.keys(pending).length===0,pending,counts:Object.fromEntries(Object.entries(pending).map(([key,codes])=>[key,codes.length]))};
}
export function enrich(target) {
  const root=`raw/${target}`,input=read(`${root}/research-input.json`);if(!input)throw Error('Research input missing');
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
    const fixedHistorical=Boolean(c.historicalFinancial&&c.historicalArchiveSafe&&c.periodEnd&&c.periodEnd<target);
    return capturedInTime||fixedHistorical;
  })) {
    if(c.kind==='coverage')continue;
    const evidenceRows=read(`${c.rawRoot}/${c.id}.raw.txt`);
    if(!Array.isArray(evidenceRows))continue;
    for(const row of evidenceRows) {
      if(c.kind==='events') {const event=normalizeOfficialEvent(row,c.url);if(event&&Date.parse(event.eventTimestamp)<=cutoff){if(!events.has(event.code))events.set(event.code,[]);events.get(event.code).push(event);}continue;}
      if(c.kind==='governance'){const code=String(row['股票代號']??row['公司代號']??row['公司代碼']??row.SecuritiesCompanyCode??'').trim();if(code)governance.set(code,row);continue;}
      if(!['income','balance'].includes(c.kind))continue;
      const code=String(row['公司代號']??row['公司代碼']??row.SecuritiesCompanyCode??'').trim(),year=num(row['年度']??row.Year),quarter=num(row['季別']??row['季']??row.Season??row.Quarter);
      if(!code||!year||!Number.isInteger(quarter)||quarter<1||quarter>4)continue;
      const y=year<1911?year+1911:year,periodEnd=new Date(Date.UTC(y,quarter*3,0)).toISOString().slice(0,10);
      if(periodEnd>target)continue;
      const normalized=normalizeFinancial(row,c.kind,c.url);if(!normalized)continue;
      const key=`${code}|${periodEnd}`,period=financialPeriods.get(key)??{};period[c.kind]=normalized;financialPeriods.set(key,period);
      const data=financial.get(code)??{};
      if(!data[c.kind]||periodEnd>=data[c.kind].periodEnd)data[c.kind]={source:c.url,periodEnd,row,normalized};financial.set(code,data);
    }
  }
  for(const row of input.deepDive) {
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
