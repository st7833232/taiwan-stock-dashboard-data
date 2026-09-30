import fs from 'node:fs';
import {pathToFileURL} from 'node:url';

const read = p => {try{return JSON.parse(fs.readFileSync(p,'utf8'));}catch{return null;}};
const write = (p,x) => {fs.mkdirSync(p.slice(0,p.lastIndexOf('/')),{recursive:true});fs.writeFileSync(p,JSON.stringify(x,null,2)+'\n');};
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
  const tpexStart=start.replaceAll('-','/'),tpexEnd=end.replaceAll('-','/');
  return [
    {id:'twse-ca-exrights-preview',market:'TWSE',kind:'coverage',coverageTags:['exRightsDividends'],coverageOnly:true,url:'https://openapi.twse.com.tw/v1/exchangeReport/TWT48U_ALL',summary:'上市股票除權除息預告表'},
    {id:'twse-ca-trading-halts',market:'TWSE',kind:'coverage',coverageTags:['tradingHalts'],coverageOnly:true,allowEmpty:true,url:'https://openapi.twse.com.tw/v1/exchangeReport/TWTAWU',summary:'集中市場暫停交易證券'},
    {id:'twse-ca-exrights-history',market:'TWSE',kind:'coverage',coverageTags:['historicalPriceAdjustment:exRights'],coverageOnly:true,allowEmpty:true,url:`https://www.twse.com.tw/exchangeReport/TWT49U?response=json&startDate=${startCompact}&endDate=${targetCompact}`,summary:'上市股票除權除息計算結果表'},
    {id:'twse-ca-reduction-reference',market:'TWSE',kind:'coverage',coverageTags:['splitReductionConversion:reduction','historicalPriceAdjustment:reduction'],coverageOnly:true,allowEmpty:true,url:`https://www.twse.com.tw/exchangeReport/TWTAUU?response=json&startDate=${startCompact}&endDate=${endCompact}`,summary:'股票減資恢復買賣參考價格'},
    {id:'twse-ca-parvalue-preview',market:'TWSE',kind:'coverage',coverageTags:['splitReductionConversion:parValueChange'],coverageOnly:true,allowEmpty:true,url:'https://www.twse.com.tw/exchangeReport/TWTB7U?response=json',summary:'變更股票面額預告表'},
    {id:'twse-ca-parvalue-history',market:'TWSE',kind:'coverage',coverageTags:['historicalPriceAdjustment:parValueChange'],coverageOnly:true,allowEmpty:true,url:`https://www.twse.com.tw/exchangeReport/TWTB8U?response=json&startDate=${startCompact}&endDate=${targetCompact}`,summary:'變更股票面額恢復買賣參考價格'},
    {id:'tpex-ca-parvalue-reference',market:'TPEx',kind:'coverage',coverageTags:['splitReductionConversion:parValueChange','historicalPriceAdjustment:parValueChange'],coverageOnly:true,allowEmpty:true,url:`https://www.tpex.org.tw/www/zh-tw/announce/market/change/reference?startDate=${tpexStart}&endDate=${tpexEnd}&response=json`,summary:'上櫃變更股票面額恢復買賣參考價'}
  ];
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
      if(/計算結果|參考價|恢復.*(買賣|交易)/.test(text))tags.push('historicalPriceAdjustment:exRights');
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
    sources=[...sources,...staticCoverage,...discoveredCoverage];
    for(let i=0;i<sources.length;i+=2) {
      await Promise.all(sources.slice(i,i+2).map(async source=>{
        const file=`${root}/${source.id}.raw.txt`,prior=old?.captures?.find(c=>c.id===source.id);
        const financial=['income','balance'].includes(source.kind),fresh=financial||now.getTime()-Date.parse(prior?.capturedAt)<=config.evidenceCollection.sourceRefreshIntervalMs;
        if(archiveUsable(prior,target) && fs.existsSync(file)&&fresh){captures.push(prior);return;}
        if(target!==today) {
          const dates=fs.readdirSync('raw').filter(d=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&d<target).sort().reverse();
          for(const date of dates){const meta=read(`raw/${date}/financial-evidence-captures.json`)?.captures?.find(c=>c.id===source.id);if(archiveUsable(meta,target)&&fs.existsSync(`raw/${date}/${source.id}.raw.txt`)){fs.copyFileSync(`raw/${date}/${source.id}.raw.txt`,file);captures.push({...meta,archiveOrigin:`raw/${date}/${source.id}.raw.txt`});return;}}
          captures.push({...source,status:'NOT_CAPTURED_RETROSPECTIVE',note:'No point-in-time archive; never backfill a historical decision using the current latest report.'});return;
        }
        try {
          const rows=await requests(source.url);
          if(source.coverageOnly){
            if(!structuredEvidence(rows,source.allowEmpty===true))throw Error('No usable official coverage payload');
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
  write(`${root}/financial-evidence-captures.json`,{targetDate:target,captures});
  console.log(JSON.stringify({stage:'FINANCIAL_EVIDENCE_CAPTURE',targetDate:target,captured:captures.filter(c=>c.status==='CAPTURED').length,unverified:captures.filter(c=>c.status!=='CAPTURED').length}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await collect(process.env.TARGET_DATE);
