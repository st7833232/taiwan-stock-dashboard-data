import fs from 'node:fs/promises';
import path from 'node:path';

const targetDate = process.env.TARGET_DATE;
const doBackfill = process.env.BACKFILL_V2_HISTORY === '1';
const targetDepth = Number(process.env.HISTORY_TARGET_DEPTH || 130);
const maxCalendarDays = Number(process.env.HISTORY_MAX_CALENDAR_DAYS || 230);
const concurrency = Number(process.env.HISTORY_FETCH_CONCURRENCY || 4);
const historyDir = 'history';
const historyPath = path.join(historyDir, 'market-history.json');
const inputPath = targetDate ? path.join('raw', targetDate, 'research-input.json') : null;

if (!targetDate || !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) throw new Error('TARGET_DATE YYYY-MM-DD is required');
await fs.mkdir(historyDir, { recursive: true });

const compact = (date) => date.replaceAll('-', '');
function rocSlash(date) {
  const [y,m,d] = date.split('-').map(Number);
  return `${y - 1911}/${String(m).padStart(2,'0')}/${String(d).padStart(2,'0')}`;
}
function dateVariants(date) {
  const [y,m,d] = date.split('-').map(Number);
  const mm=String(m).padStart(2,'0'), dd=String(d).padStart(2,'0'), roc=y-1911;
  return [date,`${y}/${mm}/${dd}`,`${y}${mm}${dd}`,`${roc}/${mm}/${dd}`,`${roc}${mm}${dd}`];
}
function hasDateEvidence(value,date) {
  const text=JSON.stringify(value);
  return dateVariants(date).some((v)=>text.includes(v));
}
function previousDate(date,days=1) {
  const dt=new Date(`${date}T12:00:00Z`);
  dt.setUTCDate(dt.getUTCDate()-days);
  return dt.toISOString().slice(0,10);
}
function isWeekday(date) {
  const d=new Date(`${date}T12:00:00Z`).getUTCDay();
  return d!==0 && d!==6;
}
function tableRows(value,out=[]) {
  if (!value || typeof value!=='object') return out;
  if (Array.isArray(value)) {
    for (const item of value) tableRows(item,out);
    return out;
  }
  for (const [key,fields] of Object.entries(value)) {
    const match=key.match(/^fields(\d*)$/);
    if (!match || !Array.isArray(fields)) continue;
    const data=value[`data${match[1]}`];
    if (!Array.isArray(data)) continue;
    for (const row of data) {
      if (!Array.isArray(row)) continue;
      const obj={};
      fields.forEach((field,i)=>{obj[String(field)]=row[i];});
      out.push(obj);
    }
  }
  for (const child of Object.values(value)) if (child && typeof child==='object') tableRows(child,out);
  return out;
}
function objectRows(value,out=[]) {
  if (Array.isArray(value)) {
    for (const item of value) {
      if (item && !Array.isArray(item) && typeof item==='object') out.push(item);
      objectRows(item,out);
    }
  } else if (value && typeof value==='object') {
    for (const child of Object.values(value)) objectRows(child,out);
  }
  return out;
}
function uniqueRows(rows) {
  const seen=new Set();
  return rows.filter((row)=>{
    const key=JSON.stringify(row);
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}
function num(value) {
  if (typeof value==='number') return Number.isFinite(value)?value:null;
  if (value===null || value===undefined) return null;
  const text=String(value).replaceAll(',','').trim();
  if (!text || text==='--' || text==='---' || text==='N/A') return null;
  const n=Number(text.replace(/^\+/,''));
  return Number.isFinite(n)?n:null;
}
function codeOf(row) {
  return String(row['證券代號'] ?? row.SecuritiesCompanyCode ?? row['代號'] ?? '').trim();
}
function assetType(code) {
  if (/^00[0-9A-Z]{2,5}$/.test(code)) return 'ETF';
  if (/^\d{4}$/.test(code)) return 'STOCK';
  return 'OTHER';
}
function normalizeQuote(row,market) {
  const code=codeOf(row), type=assetType(code);
  if (type==='OTHER') return null;
  const close=num(row['收盤價'] ?? row.Close ?? row['收盤 ']);
  const open=num(row['開盤價'] ?? row.Open ?? row['開盤 ']);
  const high=num(row['最高價'] ?? row.High ?? row['最高 ']);
  const low=num(row['最低價'] ?? row.Low ?? row['最低']);
  const volume=num(row['成交股數'] ?? row.TradingShares ?? row['成交股數  ']);
  const turnover=num(row['成交金額'] ?? row.TransactionAmount ?? row[' 成交金額(元)']);
  if (!code || close===null || volume===null || turnover===null) return null;
  return {code,market,assetType:type,open,high,low,close,volume,turnover};
}
async function fetchJson(url,attempts=2) {
  let last;
  for (let i=0;i<attempts;i++) {
    try {
      const res=await fetch(url,{headers:{accept:'application/json,text/plain,*/*','user-agent':'taiwan-stock-dashboard-data/history-backfill'},redirect:'follow',signal:AbortSignal.timeout(30000)});
      const text=await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return JSON.parse(text);
    } catch (error) {
      last=error;
      if (i+1<attempts) await new Promise((r)=>setTimeout(r,500*(i+1)));
    }
  }
  throw last;
}
async function fetchPriceDay(date) {
  const twseUrl=`https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?date=${compact(date)}&type=ALL&response=json`;
  const tpexUrl=`https://www.tpex.org.tw/web/stock/aftertrading/otc_quotes_no1430/stk_wn1430_result.php?l=zh-tw&d=${rocSlash(date)}&se=EW&o=json`;
  const [twseResult,tpexResult]=await Promise.allSettled([fetchJson(twseUrl),fetchJson(tpexUrl)]);
  const rows=[], provenance={};
  if (twseResult.status==='fulfilled' && hasDateEvidence(twseResult.value,date)) {
    for (const row of uniqueRows([...tableRows(twseResult.value),...objectRows(twseResult.value)])) {
      const q=normalizeQuote(row,'TWSE'); if (q) rows.push(q);
    }
    provenance.twse={status:'PASS',url:twseUrl};
  } else provenance.twse={status:'VERIFY_FAILED',error:twseResult.status==='rejected'?String(twseResult.reason?.message||twseResult.reason):'date evidence missing'};
  if (tpexResult.status==='fulfilled' && hasDateEvidence(tpexResult.value,date)) {
    for (const row of uniqueRows([...tableRows(tpexResult.value),...objectRows(tpexResult.value)])) {
      const q=normalizeQuote(row,'TPEx'); if (q) rows.push(q);
    }
    provenance.tpex={status:'PASS',url:tpexUrl};
  } else provenance.tpex={status:'VERIFY_FAILED',error:tpexResult.status==='rejected'?String(tpexResult.reason?.message||tpexResult.reason):'date evidence missing'};
  const dedup=new Map();
  for (const q of rows) if (!dedup.has(q.code)) dedup.set(q.code,q);
  return {date,rows:[...dedup.values()],provenance,verified:dedup.size>=100};
}
async function readJsonMaybe(file) {
  try { return JSON.parse(await fs.readFile(file,'utf8')); } catch { return null; }
}

const input=await readJsonMaybe(inputPath);
if (!input || input.targetDate!==targetDate || !Array.isArray(input.universe)) throw new Error(`research input missing or invalid: ${inputPath}`);
let history=await readJsonMaybe(historyPath);
if (!history || history.schemaVersion!==1) {
  history={schemaVersion:1,generatedAt:null,asOf:null,targetDepthTradingDays:targetDepth,sourcePolicy:'Official TWSE MI_INDEX and TPEx historical daily quotes; compact derived cache only',dates:[],provenance:{},data:{}};
}
function upsertRows(date,rows,provenance) {
  for (const q of rows) {
    const arr=history.data[q.code] ?? [];
    const ix=arr.findIndex((x)=>x[0]===date);
    const row=[date,q.open,q.high,q.low,q.close,q.volume,q.turnover,q.market];
    if (ix>=0) arr[ix]=row; else arr.push(row);
    arr.sort((a,b)=>a[0].localeCompare(b[0]));
    history.data[q.code]=arr.slice(-(targetDepth+10));
  }
  history.provenance[date]=provenance;
  if (!history.dates.includes(date)) history.dates.push(date);
  history.dates.sort();
  history.dates=history.dates.slice(-(targetDepth+10));
}

upsertRows(targetDate,input.universe.map((x)=>({code:x.code,market:x.market,assetType:x.assetType,open:x.open,high:x.high,low:x.low,close:x.close,volume:x.volume,turnover:x.turnover})),{currentResearchInput:true});

if (doBackfill) {
  const candidates=[];
  for (let i=0;i<=maxCalendarDays;i++) {
    const date=previousDate(targetDate,i);
    if (!isWeekday(date)) continue;
    if (history.dates.includes(date)) continue;
    candidates.push(date);
  }
  for (let i=0;i<candidates.length && history.dates.filter((d)=>d<=targetDate).length<targetDepth;i+=concurrency) {
    const batch=candidates.slice(i,i+concurrency);
    const results=await Promise.all(batch.map(async(date)=>{
      try { return await fetchPriceDay(date); }
      catch(error) { return {date,rows:[],provenance:{error:String(error?.message||error)},verified:false}; }
    }));
    for (const result of results) if (result.verified) upsertRows(result.date,result.rows,result.provenance);
    console.log(JSON.stringify({phase:'price-backfill',processed:Math.min(i+concurrency,candidates.length),candidates:candidates.length,verifiedTradingDays:history.dates.filter((d)=>d<=targetDate).length}));
  }
}

const usableDates=history.dates.filter((d)=>d<=targetDate).sort().slice(-targetDepth);
const usableSet=new Set(usableDates);
for (const [code,rows] of Object.entries(history.data)) {
  const filtered=rows.filter((r)=>usableSet.has(r[0])).sort((a,b)=>a[0].localeCompare(b[0]));
  if (filtered.length) history.data[code]=filtered; else delete history.data[code];
}
history.dates=usableDates;
history.asOf=targetDate;
history.generatedAt=new Date().toISOString();
history.targetDepthTradingDays=targetDepth;
history.coverage={
  verifiedTradingDays:usableDates.length,
  codes:Object.keys(history.data).length,
  codesWith20Days:Object.values(history.data).filter((rows)=>rows.length>=20).length,
  codesWith120Days:Object.values(history.data).filter((rows)=>rows.length>=120).length
};
await fs.writeFile(historyPath,JSON.stringify(history)+'\\n');
console.log(JSON.stringify({output:historyPath,asOf:history.asOf,coverage:history.coverage}));
