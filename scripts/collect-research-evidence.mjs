import fs from 'node:fs';
import {pathToFileURL} from 'node:url';

const read = p => {try{return JSON.parse(fs.readFileSync(p,'utf8'));}catch{return null;}};
const write = (p,x) => {fs.mkdirSync(p.slice(0,p.lastIndexOf('/')),{recursive:true});fs.writeFileSync(p,JSON.stringify(x,null,2)+'\n');};
const compactNumber=x=>{const s=String(x??'').trim().replaceAll(',','');if(!s||s==='--')return null;const n=Number(s);return Number.isFinite(n)?n:null;};
const htmlText=x=>String(x??'').replace(/<br\s*\/?\s*>/gi,' ').replace(/<[^>]*>/g,'').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n))).replace(/\s+/g,' ').trim();
export function parseMopsCompanyHistoricalIncomeHtml(html,{code,year,quarter}) {
  const wanted=new Map([
    ['revenue',new Set(['營業收入合計','營業收入'])],
    ['netProfit',new Set(['本期淨利（淨損）','本期淨利(淨損)'])]
  ]), values={};
  for(const m of String(html??'').matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){
    const cells=[...m[1].matchAll(/<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/gi)].map(x=>htmlText(x[1])).filter(Boolean);
    if(cells.length<2)continue;
    const label=cells[0].replace(/\s+/g,'');
    for(const [key,labels] of wanted)if(values[key]===undefined&&[...labels].some(x=>x.replace(/\s+/g,'')===label)){
      const n=cells.slice(1).map(compactNumber).find(Number.isFinite);
      if(Number.isFinite(n))values[key]=n;
    }
  }
  if(!Number.isFinite(values.revenue)||!Number.isFinite(values.netProfit))throw Error('MOPS company historical income: required metrics missing');
  return {'公司代號':String(code),'年度':year,'季別':quarter,'營業收入':values.revenue,'本期淨利（淨損）':values.netProfit};
}
function latestDeepDiveStockCodes(target){
  const dirs=fs.readdirSync('raw').filter(d=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&d<=target).sort().reverse();
  for(const date of dirs){
    const input=read(`raw/${date}/research-input.json`);
    const codes=(input?.deepDive??[]).filter(r=>(r.assetType??r.current?.assetType)==='STOCK').map(r=>String(r.code)).filter(Boolean);
    if(codes.length)return [...new Set(codes)];
  }
  return [];
}
export function parseMopsHistoricalIncomeHtml(html,{year,quarter}) {
  const required=['公司代號','公司名稱','營業收入','營業毛利（毛損）','營業利益（損失）','本期淨利（淨損）'];
  let header=null,indexes=null;const rows=[];
  for(const m of String(html??'').matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){
    const cells=[...m[1].matchAll(/<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/gi)].map(x=>htmlText(x[1]));
    if(cells[0]==='公司代號'){
      if(header)break;
      if(!required.every(field=>cells.includes(field)))continue;
      header=cells;indexes=Object.fromEntries(required.map(field=>[field,cells.indexOf(field)]));continue;
    }
    if(!header||!/^\d{4}$/.test(cells[0]??'')||cells.length!==header.length)continue;
    rows.push({
      '公司代號':cells[indexes['公司代號']],
      '公司名稱':cells[indexes['公司名稱']],
      '年度':year,
      '季別':quarter,
      '營業收入':compactNumber(cells[indexes['營業收入']]),
      '營業毛利（毛損）':compactNumber(cells[indexes['營業毛利（毛損）']]),
      '營業利益（損失）':compactNumber(cells[indexes['營業利益（損失）']]),
      '本期淨利（淨損）':compactNumber(cells[indexes['本期淨利（淨損）']])
    });
  }
  if(!header)throw Error('MOPS historical income: general-industry header missing');
  if(!rows.length)throw Error('MOPS historical income: 0 general-industry rows');
  return rows;
}
function latestFinancialPeriod(root,captures){
  let best=null;
  for(const c of captures.filter(c=>c.status==='CAPTURED'&&c.kind==='income'&&!c.historicalFinancial)){
    const rows=read(`${root}/${c.id}.raw.txt`);if(!Array.isArray(rows))continue;
    for(const row of rows){
      const rawYear=Number(String(row['年度']??row.Year??'').trim()),quarter=Number(String(row['季別']??row['季']??row.Season??row.Quarter??'').trim());
      if(!Number.isInteger(rawYear)||!Number.isInteger(quarter)||quarter<1||quarter>4)continue;
      const year=rawYear<1911?rawYear+1911:rawYear,key=year*10+quarter;
      if(!best||key>best.key)best={year,quarter,key};
    }
  }
  return best;
}
async function captureHistoricalComparativeIncome(root,captures,old,target,now){
  const latest=latestFinancialPeriod(root,captures);if(!latest)return [];
  const year=latest.year-1,quarter=latest.quarter,rocYear=year-1911,season=String(quarter).padStart(2,'0');
  const codes=latestDeepDiveStockCodes(target),url='https://mops.twse.com.tw/mops/web/ajax_t164sb04';
  const out=[];
  for(const market of ['TWSE','TPEx']){
    const id=`mops-historical-income-${market.toLowerCase()}-${year}Q${quarter}`,file=`${root}/${id}.raw.txt`,prior=old?.captures?.find(c=>c.id===id);
    if(archiveUsable(prior,target)&&fs.existsSync(file)){out.push({...prior,preservedTargetArchive:true});continue;}
    const marketCodes=codes;
    const rows=[],failures=[];
    for(let i=0;i<marketCodes.length;i+=3){
      const chunk=marketCodes.slice(i,i+3);
      const settled=await Promise.all(chunk.map(async code=>{
        try{
          const body=new URLSearchParams({encodeURIComponent:'1',step:'1',firstin:'1',off:'1',keyword4:'',code1:'',TYPEK2:'',checkbtn:'',queryName:'co_id',inpuType:'co_id',TYPEK:'all',isnew:'false',co_id:code,year:String(rocYear),season}).toString();
          const response=await fetch(url,{method:'POST',redirect:'follow',headers:{'content-type':'application/x-www-form-urlencoded','user-agent':'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36',referer:'https://mops.twse.com.tw/mops/web/t164sb04',accept:'text/html,*/*'},body,signal:AbortSignal.timeout(12000)});
          if(!response.ok)throw Error(`HTTP ${response.status}`);
          return parseMopsCompanyHistoricalIncomeHtml(await response.text(),{code,year,quarter});
        }catch(error){failures.push({code,error:String(error.message)});return null;}
      }));
      rows.push(...settled.filter(Boolean));
    }
    if(rows.length){
      fs.writeFileSync(file,JSON.stringify(rows)+'\n');
      out.push({id,market,kind:'income',historicalFinancial:true,periodEnd:new Date(Date.UTC(year,quarter*3,0)).toISOString().slice(0,10),url,summary:`MOPS ${year}Q${quarter} 單一公司綜合損益表（deep-dive comparative）`,status:'CAPTURED',capturedAt:now.toISOString(),rows:rows.length,requestedCodes:marketCodes.length,failedCodes:failures.map(x=>x.code)});
    }else out.push({id,market,kind:'income',historicalFinancial:true,periodEnd:new Date(Date.UTC(year,quarter*3,0)).toISOString().slice(0,10),url,status:'VERIFY_FAILED',error:'No company historical income rows captured',requestedCodes:marketCodes.length,failures:failures.slice(0,20)});
  }
  return out;
}
export function discoverEvidenceSources(spec, market, apiRoot) {
  return Object.entries(spec.paths??{}).flatMap(([path,op])=>{
    const summary=op.get?.summary??'';
    // Discover exact endpoint names from the official specification, not guessed aliases.
    const kind=summary.includes('綜合損益表')?'income':summary.includes('資產負債表')?'balance':/t187ap04_(L|O)$/.test(path)?'events':/t187ap23_(L|O)$/.test(path)?'governance':/t187ap26_(L|O)$/.test(path)?'suspensions':null;
    if(!kind || (['income','balance'].includes(kind)&&! /_(L|O)_(ci|basi|bd|fh|ins|mim)$/.test(path)))return [];
    return [{id:`${market.toLowerCase()}-${kind}-${path.split('_').at(-1)}`,market,kind,url:apiRoot+path,summary}];
  });
}
function shiftDate(date,days){const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}
function compactDate(date){return date.replaceAll('-','');}
function coverageSources(target){
  const start=shiftDate(target,-180),end=shiftDate(target,35),startCompact=compactDate(start),targetCompact=compactDate(target),endCompact=compactDate(end);
  const slash=date=>date.replaceAll('-','/'),encoded=date=>encodeURIComponent(slash(date));
  return [
    {id:'twse-ca-exrights-preview',market:'TWSE',kind:'coverage',coverageTags:['exRightsDividends'],coverageOnly:true,url:'https://openapi.twse.com.tw/v1/exchangeReport/TWT48U_ALL',summary:'上市股票除權除息預告表'},
    {id:'twse-ca-trading-halts',market:'TWSE',kind:'coverage',coverageTags:['tradingHalts'],coverageOnly:true,allowEmpty:true,url:'https://openapi.twse.com.tw/v1/exchangeReport/TWTAWU',summary:'集中市場暫停交易證券'},
    {id:'twse-ca-exrights-history',market:'TWSE',kind:'coverage',coverageTags:['historicalPriceAdjustment:exRights'],coverageOnly:true,allowEmpty:true,url:`https://www.twse.com.tw/exchangeReport/TWT49U?response=json&startDate=${startCompact}&endDate=${targetCompact}`,summary:'上市股票除權除息計算結果表'},
    {id:'twse-ca-reduction-reference',market:'TWSE',kind:'coverage',coverageTags:['splitReductionConversion:reduction','historicalPriceAdjustment:reduction'],coverageOnly:true,allowEmpty:true,url:`https://www.twse.com.tw/exchangeReport/TWTAUU?response=json&startDate=${startCompact}&endDate=${endCompact}`,summary:'股票減資恢復買賣參考價格'},
    {id:'twse-ca-parvalue-preview',market:'TWSE',kind:'coverage',coverageTags:['splitReductionConversion:parValueChange'],coverageOnly:true,allowEmpty:true,url:'https://www.twse.com.tw/exchangeReport/TWTB7U?response=json',summary:'變更股票面額預告表'},
    {id:'twse-ca-parvalue-history',market:'TWSE',kind:'coverage',coverageTags:['historicalPriceAdjustment:parValueChange'],coverageOnly:true,allowEmpty:true,url:`https://www.twse.com.tw/exchangeReport/TWTB8U?response=json&startDate=${startCompact}&endDate=${targetCompact}`,summary:'變更股票面額恢復買賣參考價格'},
    {id:'tpex-ca-exrights-history',market:'TPEx',kind:'coverage',coverageTags:['historicalPriceAdjustment:exRights'],coverageOnly:true,allowEmpty:true,expectedDateRange:{start,end:target},url:`https://www.tpex.org.tw/www/zh-tw/bulletin/exDailyQ?startDate=${encoded(start)}&endDate=${encoded(target)}&response=json`,summary:'上櫃股票除權除息計算結果表（歷史）'},
    {id:'tpex-ca-reduction-reference',market:'TPEx',kind:'coverage',coverageTags:['splitReductionConversion:reduction','historicalPriceAdjustment:reduction'],coverageOnly:true,allowEmpty:true,expectedDateRange:{start,end},url:`https://www.tpex.org.tw/www/zh-tw/bulletin/revivt?startDate=${encoded(start)}&endDate=${encoded(end)}&response=json`,summary:'上櫃減資恢復交易參考價'},
    {id:'tpex-ca-parvalue-reference',market:'TPEx',kind:'coverage',coverageTags:['splitReductionConversion:parValueChange','historicalPriceAdjustment:parValueChange'],coverageOnly:true,allowEmpty:true,expectedDateRange:{start,end},url:`https://www.tpex.org.tw/www/zh-tw/bulletin/pvChgRslt?startDate=${encoded(start)}&endDate=${encoded(end)}&response=json`,summary:'上櫃變更股票面額恢復買賣參考價'},
    // Verified TPEx OpenAPI fallbacks. These exact endpoints were previously discovered from the official spec
    // and successfully archived; keep them available when swagger discovery is temporarily unavailable.
    {id:'tpex-coverage-tpex-spendi-today',market:'TPEx',kind:'coverage',coverageTags:['tradingHalts'],coverageOnly:true,allowEmpty:true,url:'https://www.tpex.org.tw/openapi/v1/tpex_spendi_today',summary:'上櫃當日公布暫停/恢復交易股票'},
    {id:'tpex-coverage-tpex-spendi-history',market:'TPEx',kind:'coverage',coverageTags:['tradingHalts'],coverageOnly:true,allowEmpty:true,url:'https://www.tpex.org.tw/openapi/v1/tpex_spendi_history',summary:'上櫃歷史公布暫停/恢復交易股票'},
    {id:'tpex-coverage-mopsfin-t187ap26-O',market:'TPEx',kind:'coverage',coverageTags:['tradingHalts'],coverageOnly:true,allowEmpty:true,url:'https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap26_O',summary:'上櫃公司停止買賣公司'},
    {id:'tpex-coverage-tpex-exright-prepost',market:'TPEx',kind:'coverage',coverageTags:['exRightsDividends'],coverageOnly:true,allowEmpty:true,url:'https://www.tpex.org.tw/openapi/v1/tpex_exright_prepost',summary:'上櫃股票除權除息預告表'}
  ];
}

function coverageRangeMatches(source,payload){
  if(!source.expectedDateRange)return true;
  const raw=typeof payload?.date==='string'?payload.date:'';
  const pieces=raw.split('~').map(x=>x.replace(/\D/g,''));
  const expected=[source.expectedDateRange.start,source.expectedDateRange.end].map(x=>x.replaceAll('-',''));
  return pieces.length===2 && pieces[0]===expected[0] && pieces[1]===expected[1];
}
function structuredEvidence(payload,allowEmpty=false){
  if(payload===null || typeof payload!=='object')return false;
  if(Array.isArray(payload))return allowEmpty || payload.length>0;
  const arrays=[];
  const walk=value=>{if(Array.isArray(value))arrays.push(value);else if(value&&typeof value==='object')for(const child of Object.values(value))walk(child);};
  walk(payload);
  return allowEmpty ? true : arrays.some(a=>a.length>0);
}

export function discoverCoverageSources(spec,market,apiRoot) {
  return Object.entries(spec?.paths??{}).flatMap(([path,op])=>{
    const summary=String(op?.get?.summary??'').trim(), text=`${summary} ${path}`;
    if(!summary || /當日沖銷|停資停券|融券|信用交易|權證/.test(text))return [];
    const tags=[];
    if(/除權|除息/.test(text)){
      if(/預告|公告|基準日|停止過戶/.test(text))tags.push('exRightsDividends');
      if(market!=='TPEx' && /計算結果|參考價|恢復.*(買賣|交易)/.test(text))tags.push('historicalPriceAdjustment:exRights');
    }
    if(/減資/.test(text)){
      if(/預告|公告|參考價|恢復.*(買賣|交易)|計算結果/.test(text))tags.push('splitReductionConversion:reduction');
      if(/參考價|恢復.*(買賣|交易)|計算結果/.test(text))tags.push('historicalPriceAdjustment:reduction');
    }
    if(/面額/.test(text)){
      if(/預告|公告|參考價|恢復.*(買賣|交易)|計算結果/.test(text))tags.push('splitReductionConversion:parValueChange');
      if(/參考價|恢復.*(買賣|交易)|計算結果/.test(text))tags.push('historicalPriceAdjustment:parValueChange');
    }
    if(!/除權|除息|減資|面額/.test(text) && /(暫停.*交易|停止買賣|恢復.*交易)/.test(text))tags.push('tradingHalts');
    const unique=[...new Set(tags)];if(!unique.length)return [];
    const slug=path.replace(/^\/+/, '').replace(/[^a-zA-Z0-9]+/g,'-').replace(/^-|-$/g,'').slice(-96);
    return [{id:`${market.toLowerCase()}-coverage-${slug}`,market,kind:'coverage',coverageTags:unique,coverageOnly:true,allowEmpty:true,url:apiRoot+path,summary}];
  });
}

export function archiveUsable(meta,target) {
  return meta?.status==='CAPTURED' && Number.isFinite(Date.parse(meta.capturedAt))
    && Date.parse(meta.capturedAt)<=Date.parse(`${target}T23:59:59+08:00`);
}
export function shouldReuseTargetArchive(meta,target,{fileExists,historical,fresh}) {
  return Boolean(fileExists && archiveUsable(meta,target) && (historical || fresh));
}
export async function collect(target,{now=new Date()}={}) {
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei'}).format(now);
  // Archive today's quarterly and event evidence even during yesterday's recovery.
  // Historical enrichment still excludes anything captured after its cutoff.
  if(target!==today)await collect(today,{now});
  const root=`raw/${target}`;fs.mkdirSync(root,{recursive:true});
  const config=read('strategy-config.json');
  const old=read(`${root}/financial-evidence-captures.json`),captures=[];
  const requests=async url=>{
    const response=await fetch(url,{signal:AbortSignal.timeout(20000),headers:{accept:'application/json'}});
    if(!response.ok)throw Error(`HTTP ${response.status}`);
    return response.json();
  };
  for(const [market,swagger,apiRoot] of [
    ['TWSE','https://openapi.twse.com.tw/v1/swagger.json','https://openapi.twse.com.tw/v1'],
    ['TPEx','https://www.tpex.org.tw/openapi/swagger.json','https://www.tpex.org.tw/openapi/v1']
  ]) {
    let sources=(read('history/financial-source-catalog.json')?.sources??[]).filter(s=>s.market===market),spec=null;
    try{spec=await requests(swagger);}catch(error){captures.push({market,kind:'discovery',url:swagger,status:'VERIFY_FAILED',error:String(error.message)});}
    if(!sources.some(s=>s.kind==='events')&&spec)sources=discoverEvidenceSources(spec,market,apiRoot);
    const staticCoverage=coverageSources(target).filter(s=>s.market===market);
    const discoveredCoverage=market==='TPEx'&&spec?discoverCoverageSources(spec,market,apiRoot):[];
    if(market==='TPEx'&&spec&&!discoveredCoverage.length)captures.push({market,kind:'coverage-discovery',url:swagger,status:'VERIFY_FAILED',error:'No corporate-action coverage endpoints matched the official OpenAPI specification'});
    sources=[...new Map([...sources,...staticCoverage,...discoveredCoverage].map(source=>[source.id,source])).values()];
    for(let i=0;i<sources.length;i+=2) {
      await Promise.all(sources.slice(i,i+2).map(async source=>{
        const file=`${root}/${source.id}.raw.txt`,prior=old?.captures?.find(c=>c.id===source.id);
        const financial=['income','balance'].includes(source.kind),fresh=financial||now.getTime()-Date.parse(prior?.capturedAt)<=config.evidenceCollection.sourceRefreshIntervalMs;
        const historical=target!==today,fileExists=fs.existsSync(file);
        // Historical replays must preserve same-target point-in-time evidence captured before the target cutoff.
        // Refresh age is relevant only for the live target; a retrospective run cannot safely replace an older daily feed.
        if(shouldReuseTargetArchive(prior,target,{fileExists,historical,fresh})){captures.push({...prior,preservedTargetArchive:historical||undefined});return;}
        if(historical) {
          const dates=fs.readdirSync('raw').filter(d=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&d<target).sort().reverse();
          for(const date of dates){const meta=read(`raw/${date}/financial-evidence-captures.json`)?.captures?.find(c=>c.id===source.id);if(archiveUsable(meta,target)&&fs.existsSync(`raw/${date}/${source.id}.raw.txt`)){fs.copyFileSync(`raw/${date}/${source.id}.raw.txt`,file);captures.push({...meta,archiveOrigin:`raw/${date}/${source.id}.raw.txt`});return;}}
          captures.push({...source,status:'NOT_CAPTURED_RETROSPECTIVE',note:'No point-in-time archive; never backfill a historical decision using the current latest report.'});return;
        }
        try {
          const rows=await requests(source.url);
          if(source.coverageOnly){
            if(!structuredEvidence(rows,source.allowEmpty===true))throw Error('No usable official coverage payload');
            if(!coverageRangeMatches(source,rows))throw Error('Official coverage response date range did not match the requested range');
            fs.writeFileSync(file,JSON.stringify(rows)+'\n');captures.push({...source,status:'CAPTURED',capturedAt:new Date().toISOString(),rows:Array.isArray(rows)?rows.length:null});
          }else{
            if(!Array.isArray(rows)||(financial&&!rows.length)||!rows.every(r=>r&&typeof r==='object'&&!Array.isArray(r)))throw Error('No usable official evidence rows');
            fs.writeFileSync(file,JSON.stringify(rows)+'\n');captures.push({...source,status:'CAPTURED',capturedAt:new Date().toISOString(),rows:rows.length});
          }
        }catch(error){if(archiveUsable(prior,target)&&fs.existsSync(file))captures.push({...prior,refreshStatus:'VERIFY_FAILED',refreshError:String(error.message)});else captures.push({...source,status:'VERIFY_FAILED',error:String(error.message)});}
      }));
    }
    const catalog=read('history/financial-source-catalog.json')??{sources:[]};
    const discovered=sources.filter(s=>!s.coverageOnly);
    if(discovered.length)write('history/financial-source-catalog.json',{sources:[...catalog.sources.filter(s=>s.market!==market),...discovered]});
  }
  if(target===today)captures.push(...await captureHistoricalComparativeIncome(root,captures,old,target,now));
  write(`${root}/financial-evidence-captures.json`,{targetDate:target,captures});
  console.log(JSON.stringify({stage:'FINANCIAL_EVIDENCE_CAPTURE',targetDate:target,captured:captures.filter(c=>c.status==='CAPTURED').length,unverified:captures.filter(c=>c.status!=='CAPTURED').length}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await collect(process.env.TARGET_DATE);
