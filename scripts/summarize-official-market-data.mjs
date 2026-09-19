import fs from 'node:fs/promises';
import path from 'node:path';

const TZ='Asia/Taipei';
const parts=new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
const part=(type)=>parts.find((p)=>p.type===type)?.value;
const targetDate=process.env.TARGET_DATE || `${part('year')}-${part('month')}-${part('day')}`;
const dir=path.join('raw',targetDate);
const config=JSON.parse(await fs.readFile('strategy-config.json','utf8'));

function tableRows(value,out=[]) {
  if (!value || typeof value!=='object') return out;
  if (Array.isArray(value)) { for (const item of value) tableRows(item,out); return out; }
  for (const [key,fields] of Object.entries(value)) {
    const match=key.match(/^fields(\d*)$/); if (!match || !Array.isArray(fields)) continue;
    const data=value[`data${match[1]}`]; if (!Array.isArray(data)) continue;
    for (const row of data) {
      if (!Array.isArray(row)) continue;
      const obj={}; fields.forEach((field,i)=>{obj[String(field)]=row[i];}); out.push(obj);
    }
  }
  for (const child of Object.values(value)) if (child && typeof child==='object') tableRows(child,out);
  return out;
}
function objectRows(value,out=[]) {
  if (Array.isArray(value)) {
    for (const item of value) { if (item && !Array.isArray(item) && typeof item==='object') out.push(item); objectRows(item,out); }
  } else if (value && typeof value==='object') for (const child of Object.values(value)) objectRows(child,out);
  return out;
}
function uniqueRows(rows) {
  const seen=new Set();
  return rows.filter((row)=>{const key=JSON.stringify(row); if (seen.has(key)) return false; seen.add(key); return true;});
}
function num(value) {
  if (typeof value==='number') return Number.isFinite(value)?value:null;
  if (value===null || value===undefined) return null;
  const text=String(value).replaceAll(',','').trim();
  if (!text || text==='--' || text==='---' || text==='N/A') return null;
  const n=Number(text.replace(/^\+/,'')); return Number.isFinite(n)?n:null;
}
function codeOf(row) { return String(row['證券代號'] ?? row.SecuritiesCompanyCode ?? row['代號'] ?? row['證券代碼'] ?? '').trim(); }
function nameOf(row) { return String(row['證券名稱'] ?? row.CompanyName ?? row['名稱'] ?? '').trim(); }
function assetType(code) {
  if (/^00[0-9A-Z]{2,5}$/.test(code)) return 'ETF';
  if (/^\d{4}$/.test(code)) return 'STOCK';
  return 'OTHER';
}
function normalizeQuote(row,market) {
  const code=codeOf(row), type=assetType(code); if (type==='OTHER') return null;
  const close=num(row['收盤價'] ?? row.Close ?? row['收盤 ']);
  const open=num(row['開盤價'] ?? row.Open ?? row['開盤 ']);
  const high=num(row['最高價'] ?? row.High ?? row['最高 ']);
  const low=num(row['最低價'] ?? row.Low ?? row['最低']);
  const volume=num(row['成交股數'] ?? row.TradingShares ?? row['成交股數  ']);
  const turnover=num(row['成交金額'] ?? row.TransactionAmount ?? row[' 成交金額(元)']);
  if (!code || close===null || volume===null || turnover===null) return null;
  return {code,name:nameOf(row),market,assetType:type,open,high,low,close,volume,turnover};
}
function normalizeInstitution(row,market) {
  const code=codeOf(row); if (!code) return null;
  if (market==='TWSE') return {code,foreign:num(row['外陸資買賣超股數(不含外資自營商)']),investmentTrust:num(row['投信買賣超股數']),dealer:num(row['自營商買賣超股數']),total:num(row['三大法人買賣超股數'])};
  return {code,foreign:num(row['Foreign Investors include Mainland Area Investors (Foreign Dealers excluded)-Difference'] ?? row['ForeignInvestorsInclude MainlandAreaInvestors-Difference']),investmentTrust:num(row['SecuritiesInvestmentTrustCompanies-Difference']),dealer:num(row['Dealers-Difference']),total:num(row.TotalDifference)};
}
async function rowsFrom(rel) {
  try { const parsed=JSON.parse(await fs.readFile(rel,'utf8')); return uniqueRows([...tableRows(parsed),...objectRows(parsed)]); } catch { return []; }
}
async function currentUniverseFor(date) {
  const base=path.join('raw',date);
  const [twseRows,tpexRows,twseInstRows,tpexInstRows]=await Promise.all([
    rowsFrom(path.join(base,'twse-mi-index.raw.txt')),
    rowsFrom(path.join(base,'tpex-mainboard-daily-close-quotes.raw.txt')),
    rowsFrom(path.join(base,'twse-t86.raw.txt')),
    rowsFrom(path.join(base,'tpex-3insti-daily-trading.raw.txt'))
  ]);
  const quoteMap=new Map(), instMap=new Map();
  for (const row of twseRows) { const q=normalizeQuote(row,'TWSE'); if (q && !quoteMap.has(q.code)) quoteMap.set(q.code,q); }
  for (const row of tpexRows) { const q=normalizeQuote(row,'TPEx'); if (q && !quoteMap.has(q.code)) quoteMap.set(q.code,q); }
  for (const row of twseInstRows) { const x=normalizeInstitution(row,'TWSE'); if (x) instMap.set(x.code,x); }
  for (const row of tpexInstRows) { const x=normalizeInstitution(row,'TPEx'); if (x) instMap.set(x.code,x); }
  return [...quoteMap.values()].map((q)=>({...q,institutional1d:instMap.get(q.code)??null}));
}
function median(values) {
  const a=values.filter(Number.isFinite).sort((a,b)=>a-b); if (!a.length) return null;
  const m=Math.floor(a.length/2); return a.length%2?a[m]:(a[m-1]+a[m])/2;
}
function avg(values) { return values.length ? values.reduce((s,v)=>s+v,0)/values.length : null; }
function ma(closes,n,end=closes.length) { if (end<n) return null; return avg(closes.slice(end-n,end)); }
function emaSeries(values,n) {
  if (!values.length) return [];
  const k=2/(n+1), out=[values[0]];
  for (let i=1;i<values.length;i++) out.push(values[i]*k+out[i-1]*(1-k));
  return out;
}
function rsi14(closes) {
  if (closes.length<15) return null;
  let gains=0,losses=0;
  for (let i=closes.length-14;i<closes.length;i++) { const d=closes[i]-closes[i-1]; if (d>0) gains+=d; else losses-=d; }
  if (losses===0) return 100;
  const rs=(gains/14)/(losses/14); return 100-(100/(1+rs));
}
function atr14(rows) {
  if (rows.length<15) return null;
  const trs=[];
  for (let i=rows.length-14;i<rows.length;i++) {
    const h=rows[i][2], l=rows[i][3], prev=rows[i-1][4];
    if (![h,l,prev].every(Number.isFinite)) return null;
    trs.push(Math.max(h-l,Math.abs(h-prev),Math.abs(l-prev)));
  }
  return avg(trs);
}
function tech(rows,current) {
  const closes=rows.map((r)=>r[4]).filter(Number.isFinite);
  const volumes=rows.map((r)=>r[5]).filter(Number.isFinite);
  const turnovers=rows.map((r)=>r[6]).filter(Number.isFinite);
  const last20=rows.slice(-20), last60=rows.slice(-60);
  const volMA20=rows.length>=20?avg(volumes.slice(-20)):null;
  const e12=emaSeries(closes,12), e26=emaSeries(closes,26);
  let macd=null,signal=null,hist=null;
  if (closes.length>=26) {
    const line=closes.map((_,i)=>i<25?null:e12[i]-e26[i]).filter(Number.isFinite);
    if (line.length) { macd=line.at(-1); const sig=emaSeries(line,9); signal=sig.at(-1); hist=macd-signal; }
  }
  const ma20=ma(closes,20), ma60=ma(closes,60), ma120=ma(closes,120), ma240=ma(closes,240);
  const old20=closes.length>=25?ma(closes,20,closes.length-5):null;
  const old60=closes.length>=65?ma(closes,60,closes.length-5):null;
  return {
    ma5:ma(closes,5),ma10:ma(closes,10),ma20,ma60,ma120,ma240,
    ma20Slope5d:ma20!==null&&old20!==null?(ma20-old20)/5:null,
    ma60Slope5d:ma60!==null&&old60!==null?(ma60-old60)/5:null,
    rsi14:rsi14(closes),macd,macdSignal:signal,macdHistogram:hist,atr14:atr14(rows),
    volumeMA20:volMA20,
    volumeRatio20d:volMA20&&current?current.volume/volMA20:null,
    medianTurnover20d:rows.length>=20?median(turnovers.slice(-20)):null,
    high20:rows.length>=20?Math.max(...last20.map((r)=>r[2]).filter(Number.isFinite)):null,
    low20:rows.length>=20?Math.min(...last20.map((r)=>r[3]).filter(Number.isFinite)):null,
    high60:rows.length>=60?Math.max(...last60.map((r)=>r[2]).filter(Number.isFinite)):null,
    low60:rows.length>=60?Math.min(...last60.map((r)=>r[3]).filter(Number.isFinite)):null
  };
}
async function previousResearchCodes() {
  try { const manifest=JSON.parse(await fs.readFile('manifest.json','utf8')); const research=JSON.parse(await fs.readFile(manifest.researchPath,'utf8')); return (research.candidates??[]).map((c)=>String(c.code??'')).filter(Boolean); } catch { return []; }
}
async function readJsonMaybe(file) { try { return JSON.parse(await fs.readFile(file,'utf8')); } catch { return null; } }

const universe=await currentUniverseFor(targetDate);
const stocks=universe.filter((x)=>x.assetType==='STOCK'), etfs=universe.filter((x)=>x.assetType==='ETF');
const liquidToday=stocks.filter((x)=>x.turnover>=config.liquidityMedianTurnover20dMin).sort((a,b)=>b.turnover-a.turnover);
const preferredToday=liquidToday.filter((x)=>x.close<=config.pricePreference.preferredMaxTwd);
const priorCodes=await previousResearchCodes();
const deepDiveCodes=[...new Set([...preferredToday.slice(0,300).map((x)=>x.code),...priorCodes])];
const currentByCode=new Map(universe.map((x)=>[x.code,x]));

const historyCache=await readJsonMaybe(path.join('history','market-history.json'));
const cacheData=historyCache?.schemaVersion===1 ? historyCache.data ?? {} : {};
const histories=new Map();
for (const code of deepDiveCodes) histories.set(code,(cacheData[code]??[]).filter((r)=>r[0]<=targetDate).sort((a,b)=>a[0].localeCompare(b[0])));

let rawDates=[];
try { rawDates=(await fs.readdir('raw',{withFileTypes:true})).filter((x)=>x.isDirectory()&&/^\d{4}-\d{2}-\d{2}$/.test(x.name)&&x.name<=targetDate).map((x)=>x.name).sort(); } catch {}
const institutionalHistory=new Map(deepDiveCodes.map((code)=>[code,[]]));
const wanted=new Set(deepDiveCodes);
for (const code of deepDiveCodes) {
  const cached=(historyCache?.institutional?.[code]??[])
    .filter((r)=>r[0]<=targetDate)
    .map((r)=>({date:r[0],code,foreign:r[1],investmentTrust:r[2],dealer:r[3],total:r[4]}));
  institutionalHistory.set(code,cached);
}
for (const date of rawDates) {
  const daily=await currentUniverseFor(date);
  for (const row of daily) {
    if (!wanted.has(row.code)||!row.institutional1d) continue;
    const arr=institutionalHistory.get(row.code)??[];
    const next={date,...row.institutional1d};
    const ix=arr.findIndex((x)=>x.date===date);
    if (ix>=0) arr[ix]=next; else arr.push(next);
    institutionalHistory.set(row.code,arr);
  }
}
function instSum(rows,key,n) { if (rows.length<n) return null; return rows.slice(-n).reduce((s,r)=>s+(Number.isFinite(r[key])?r[key]:0),0); }

const deepDive=deepDiveCodes.map((code)=>{
  const current=currentByCode.get(code)??null;
  const h=histories.get(code)??[];
  const t=tech(h,current);
  const inst=(institutionalHistory.get(code)??[]).sort((a,b)=>a.date.localeCompare(b.date));
  return {
    code,current,
    historyCoverageTradingDays:h.length,
    institutionalHistoryCoverageDays:inst.length,
    liquidityMedianTurnover20d:t.medianTurnover20d,
    volumeMA20:t.volumeMA20,
    volumeRatio20d:t.volumeRatio20d,
    liquidityGateReady:t.medianTurnover20d!==null,
    liquidityGatePass:t.medianTurnover20d!==null?t.medianTurnover20d>=config.liquidityMedianTurnover20dMin:false,
    ma120Ready:h.length>=120,
    indicators:t,
    institutionalTrend:{
      foreign_1d:inst.at(-1)?.foreign??null,foreign_3d:instSum(inst,'foreign',3),foreign_5d:instSum(inst,'foreign',5),foreign_10d:instSum(inst,'foreign',10),foreign_20d:instSum(inst,'foreign',20),
      investment_trust_1d:inst.at(-1)?.investmentTrust??null,investment_trust_3d:instSum(inst,'investmentTrust',3),investment_trust_5d:instSum(inst,'investmentTrust',5),investment_trust_10d:instSum(inst,'investmentTrust',10),investment_trust_20d:instSum(inst,'investmentTrust',20),
      dealer_1d:inst.at(-1)?.dealer??null,dealer_5d:instSum(inst,'dealer',5)
    },
    history:h
  };
});

let tdcc={status:'NOT_AVAILABLE',codeMatches:{}};
const tdccRows=await rowsFrom(path.join(dir,'tdcc-shareholding-distribution.raw.txt'));
if (tdccRows.length>0) {
  const codeSet=new Set(deepDiveCodes), codeMatches={};
  for (const row of tdccRows) { const code=codeOf(row); if (!codeSet.has(code)) continue; (codeMatches[code]??=[]).push(row); }
  tdcc={status:'CAPTURED',codeMatches};
}

let gateMatrix=null;
try { gateMatrix=JSON.parse(await fs.readFile(path.join(dir,'gate-matrix.json'),'utf8')); } catch {}
const output={
  schemaVersion:3,targetDate,generatedAt:new Date().toISOString(),strategyVersion:config.version,gateMatrix,
  universeSummary:{total:universe.length,stocks:stocks.length,etfs:etfs.length,liquidTodayStocks:liquidToday.length,preferredPriceAndLiquidTodayStocks:preferredToday.length,deepDiveCount:deepDiveCodes.length},
  universe,codes:deepDiveCodes,deepDive,tdcc,
  historyCache:{asOf:historyCache?.asOf??null,verifiedTradingDays:historyCache?.coverage?.verifiedTradingDays??0,codesWith20Days:historyCache?.coverage?.codesWith20Days??0,codesWith120Days:historyCache?.coverage?.codesWith120Days??0,codesWith20InstitutionDays:historyCache?.coverage?.codesWith20InstitutionDays??0},
  v2Readiness:{
    fullMarketCurrentSnapshot:universe.length>0,dynamicUniverse:true,fixedTenCodeListRemoved:true,
    historicalFoldersAvailable:rawDates.length,
    historicalCacheTradingDays:historyCache?.coverage?.verifiedTradingDays??0,
    buyHistoryReadyCount:deepDive.filter((x)=>x.liquidityGateReady&&x.ma120Ready).length,
    institutional20dReadyCount:deepDive.filter((x)=>x.institutionalHistoryCoverageDays>=20).length,
    note:'BUY must fail closed until required historical, institutional, TDCC, news/event and ranking evidence is verifiably available.'
  }
};
await fs.writeFile(path.join(dir,'research-input.json'),JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify({targetDate,output:path.join(dir,'research-input.json'),universeSummary:output.universeSummary,historyCache:output.historyCache,v2Readiness:output.v2Readiness}));
