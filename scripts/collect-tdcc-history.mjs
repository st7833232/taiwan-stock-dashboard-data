import fs from 'node:fs';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {officialDate,tdccWeeks} from './research-evidence.mjs';

const URL='https://www.tdcc.com.tw/portal/zh/smWeb/qryStock';
const read=p=>{try{return JSON.parse(fs.readFileSync(p,'utf8'));}catch{return null;}};
const text=s=>s.replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/&amp;/g,'&').trim();
export function availableWeeks(html) {
  const select=html.match(/<select[^>]*name=["']scaDate["'][^>]*>([\s\S]*?)<\/select>/i)?.[1];
  if(!select)throw Error('Official TDCC date selector missing');
  return [...new Set([...select.matchAll(/<option[^>]*value=["'](\d{8})["']/gi)].map(m=>officialDate(m[1])).filter(Boolean))].sort().reverse();
}
export function parseTdccHistory(html,code,date) {
  const actual=html.match(/資料日期\s*[：:]\s*(\d{3,4})年\s*(\d{1,2})月\s*(\d{1,2})日/);
  const dataDate=actual?officialDate(actual[1]+actual[2].padStart(2,'0')+actual[3].padStart(2,'0')):null;
  const symbol=text(html).match(/證券代號\s*[：:]\s*([A-Z0-9]+)/)?.[1];
  if(dataDate!==date||symbol!==code)throw Error('TDCC response date or symbol mismatch');
  const rows=[];
  for(const tr of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells=[...tr[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(m=>text(m[1]));
    const level=Number(cells[0]),ratio=Number(cells.at(-1)?.replaceAll(',','').replace('%',''));
    if(cells.length>=5&&Number.isInteger(level)&&level>=1&&level<=15&&Number.isFinite(ratio))rows.push({'證券代號':code,'資料日期':date.replaceAll('-',''),'持股分級':level,'占集保庫存數比例%':ratio});
  }
  if(rows.length!==15||tdccWeeks(rows,date).length!==1)throw Error('TDCC holding buckets incomplete');
  return rows;
}
export async function collectTdccHistory(target,{now=new Date(),request=fetch}={}) {
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei'}).format(now),config=read('strategy-config.json')?.evidenceCollection?.tdcc;
  if(!config)throw Error('TDCC collection settings missing from strategy-config');
  const input=read(`raw/${target}/research-input.json`);if(!input)throw Error('Dynamic research universe missing');
  const path=`raw/${today}/tdcc-history-evidence.json`,prior=read(path),records=prior?.records??[],failures=[];
  const known=new Set();
  for(const day of fs.readdirSync('raw').filter(d=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&d<=today)) {
    const cached=read(`raw/${day}/tdcc-history-evidence.json`);
    for(const r of cached?.records??[])if(r.status==='VERIFIED'&&Date.parse(r.capturedAt)<=now.getTime())known.add(`${r.code}|${r.dataDate}`);
    const gate=read(`raw/${day}/gate-matrix.json`),capture=gate?.captures?.find(c=>c.source==='tdcc-shareholding-distribution'&&c.status==='CAPTURED');
    if(capture&&Date.parse(capture.capturedAt)<=now.getTime())for(const r of tdccWeeks(read(`raw/${day}/tdcc-shareholding-distribution.raw.txt`)??[],today))known.add(`${r.code}|${r.date}`);
  }
  const get=async()=>{
    const response=await request(URL,{signal:AbortSignal.timeout(config.requestTimeoutMs)});
    if(!response.ok)throw Error(`TDCC GET HTTP ${response.status}`);
    return {html:await response.text(),cookies:(response.headers.getSetCookie?.()??[]).map(c=>c.split(';')[0]).join('; ')};
  };
  let dates,first;
  try{first=await get();dates=availableWeeks(first.html).filter(d=>d<=today);}catch(e){fs.mkdirSync(`raw/${today}`,{recursive:true});fs.writeFileSync(path,JSON.stringify({targetDate:today,status:'VERIFY_FAILED',source:URL,records,failures:[{error:e.message}],capturedAt:now.toISOString()},null,2)+'\n');return;}
  const selected=config.comparisonOffsets.map(n=>dates[n]).filter(Boolean),queue=[];
  for(const row of input.deepDive.filter(r=>r.assetType==='STOCK'))for(const date of selected)if(!known.has(`${row.code}|${date}`))queue.push({code:row.code,date});
  const started=Date.now();let count=0,cursor=0;
  const save=()=>{fs.mkdirSync(`raw/${today}`,{recursive:true});fs.writeFileSync(path,JSON.stringify({schemaVersion:1,targetDate:today,universeTargetDate:target,source:URL,officialAvailableDates:dates,calendarCapturedAt:now.toISOString(),selectedDates:selected,records,failures,pendingQueries:queue.length-cursor,status:queue.length>cursor||failures.length?'PARTIAL':'VERIFIED',decisionTimingRule:'Captured after a historical target remains audit-only for that target.'},null,2)+'\n');};
  await Promise.all(Array.from({length:config.concurrency},async()=>{
    let session=await get();
    while(cursor<queue.length&&count<config.maxQueriesPerRun&&Date.now()-started<config.budgetMs) {
      const {code,date}=queue[cursor++];count++;
      try {
        const fields=new URLSearchParams();
        for(const m of session.html.matchAll(/<input\b[^>]*>/gi)) {
          const name=m[0].match(/\bname=["']([^"']+)["']/)?.[1],value=m[0].match(/\bvalue=["']([^"']*)["']/)?.[1];
          if(name&&['SYNCHRONIZER_TOKEN','SYNCHRONIZER_URI','method','firDate'].includes(name))fields.set(name,value??'');
        }
        if(!fields.has('SYNCHRONIZER_TOKEN'))throw Error('TDCC form token missing');
        fields.set('scaDate',date.replaceAll('-',''));fields.set('sqlMethod','StockNo');fields.set('stockNo',code);fields.set('stockName','');
        const response=await request(URL,{method:'POST',body:fields,headers:{cookie:session.cookies},signal:AbortSignal.timeout(config.requestTimeoutMs)});
        if(!response.ok)throw Error(`TDCC POST HTTP ${response.status}`);
        const html=await response.text(),rows=parseTdccHistory(html,code,date);
        const freshCookies=response.headers.getSetCookie?.()??[];
        if(freshCookies.length){const jar=new Map(session.cookies.split('; ').filter(Boolean).map(c=>[c.slice(0,c.indexOf('=')),c]));for(const c of freshCookies){const item=c.split(';')[0];jar.set(item.slice(0,item.indexOf('=')),item);}session.cookies=[...jar.values()].join('; ');}
        session.html=html;
        records.push({code,dataDate:date,source:URL,status:'VERIFIED',capturedAt:new Date().toISOString(),payloadSha256:crypto.createHash('sha256').update(html).digest('hex'),rows});
      }catch(e){failures.push({code,dataDate:date,status:'VERIFY_FAILED',error:e.message});session=await get().catch(()=>first);}
      save();
    }
  }));save();
  console.log(JSON.stringify({stage:'TDCC_HISTORY_CAPTURE',targetDate:today,requested:count,verified:records.length,failed:failures.length,pending:queue.length-cursor}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await collectTdccHistory(process.env.TARGET_DATE);
