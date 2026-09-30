import fs from 'node:fs';
import {pathToFileURL} from 'node:url';

const read=p=>{try{return JSON.parse(fs.readFileSync(p,'utf8'));}catch{return null;}};
const num=x=>x===null||x===undefined||String(x).trim()===''?null:Number.isFinite(Number(String(x).replaceAll(',','')))?Number(String(x).replaceAll(',','')):null;
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
    const code=String(r['證券代號']??r.SecurityCode??''),date=officialDate(r['資料日期']??r['\uFEFF資料日期']??r.DataDate),level=num(r['持股分級']??r.HoldingLevel),ratio=num(r['占集保庫存數比例%']??r['占集保庫存數比例(%)']??r['占集保庫存數比例']??r.HoldingRatio);
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
  const weeks=[];
  for(const date of fs.readdirSync('raw').filter(d=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&d<=target).sort()) {
    const matrix=read(`raw/${date}/gate-matrix.json`),capture=matrix?.captures?.find(c=>c.source==='tdcc-shareholding-distribution'&&c.status==='CAPTURED');
    if(!capture||!Number.isFinite(Date.parse(capture.capturedAt))||Date.parse(capture.capturedAt)>Date.parse(`${target}T23:59:59+08:00`))continue;
    const capturedDate=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei'}).format(new Date(capture.capturedAt));
    const rows=read(`raw/${date}/tdcc-shareholding-distribution.raw.txt`);if(Array.isArray(rows))weeks.push(...tdccWeeks(rows,capturedDate<target?capturedDate:target));
  }
  const unique=new Map(weeks.map(r=>[`${r.code}|${r.date}`,r])),byCode=new Map();
  for(const row of unique.values()){if(!byCode.has(row.code))byCode.set(row.code,[]);byCode.get(row.code).push(row);}
  const captures=read(`${root}/financial-evidence-captures.json`)?.captures??[],financial=new Map();
  for(const c of captures.filter(c=>c.status==='CAPTURED'&&Date.parse(c.capturedAt)<=Date.parse(`${target}T23:59:59+08:00`))) {
    for(const row of read(`${root}/${c.id}.raw.txt`)??[]) {
      const code=String(row['公司代號']??row['公司代碼']??row.SecuritiesCompanyCode??''),year=num(row['年度']??row.Year),quarter=num(row['季別']??row['季']??row.Season??row.Quarter);
      if(!code||!year||!Number.isInteger(quarter)||quarter<1||quarter>4)continue;
      const y=year<1911?year+1911:year,periodEnd=new Date(Date.UTC(y,quarter*3,0)).toISOString().slice(0,10);
      if(periodEnd>target)continue;
      const data=financial.get(code)??{};data[c.kind]={source:c.url,periodEnd,row};financial.set(code,data);
    }
  }
  for(const row of input.deepDive) {
    const records=(byCode.get(row.code)??[]).sort((a,b)=>a.date.localeCompare(b.date));
    const last=records.at(-1),deltaDays=(a,b)=>(Date.parse(a)-Date.parse(b))/86400000;
    const at=n=>last?records.filter(r=>deltaDays(last.date,r.date)>=n*7&&deltaDays(last.date,r.date)<=n*7+3).at(-1):null;
    const old=[1,2,4].map(at),ready=Boolean(last&&deltaDays(target,last.date)<=14&&old.every(Boolean));
    row.tdccEvidence={status:ready?'VERIFIED':'PERSISTENCE_PENDING',latest:last??null,comparisons:Object.fromEntries([1,2,4].map((n,i)=>[`${n}w`,old[i]?{date:old[i].date,large400Change:last.large400-old[i].large400,retail50Change:last.retail50-old[i].retail50}:null]))};
    row.financialEvidence=financial.get(row.code)??null;
    // Verified data is not a verified quality/catalyst decision. Do not grant BUY permission from raw reports.
    row.verifiedEvidence={...row.verifiedEvidence,tdcc:ready,tdccScoreFraction:ready?(old.filter(r=>last.large400>r.large400&&last.retail50<r.retail50).length/old.length):0};
  }
  fs.writeFileSync(`${root}/research-input.json`,JSON.stringify(input,null,2)+'\n');
  console.log(JSON.stringify({stage:'EVIDENCE_ENRICHMENT',targetDate:target,tdccReady:input.deepDive.filter(r=>r.verifiedEvidence.tdcc).length,financialRecords:financial.size}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)enrich(process.env.TARGET_DATE);
