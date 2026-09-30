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
    let sources=(read('history/financial-source-catalog.json')?.sources??[]).filter(s=>s.market===market);
    if(!sources.some(s=>s.kind==='events'))try{sources=discoverEvidenceSources(await requests(swagger),market,apiRoot);}catch(error){captures.push({market,kind:'discovery',url:swagger,status:'VERIFY_FAILED',error:String(error.message)});}
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
          if(!Array.isArray(rows)||(financial&&!rows.length)||!rows.every(r=>r&&typeof r==='object'&&!Array.isArray(r)))throw Error('No usable official evidence rows');
          fs.writeFileSync(file,JSON.stringify(rows)+'\n');captures.push({...source,status:'CAPTURED',capturedAt:new Date().toISOString(),rows:rows.length});
        }catch(error){if(archiveUsable(prior,target)&&fs.existsSync(file))captures.push({...prior,refreshStatus:'VERIFY_FAILED',refreshError:String(error.message)});else captures.push({...source,status:'VERIFY_FAILED',error:String(error.message)});}
      }));
    }
    const catalog=read('history/financial-source-catalog.json')??{sources:[]};
    if(sources.length)write('history/financial-source-catalog.json',{sources:[...catalog.sources.filter(s=>s.market!==market),...sources]});
  }
  write(`${root}/financial-evidence-captures.json`,{targetDate:target,captures});
  console.log(JSON.stringify({stage:'FINANCIAL_EVIDENCE_CAPTURE',targetDate:target,captured:captures.filter(c=>c.status==='CAPTURED').length,unverified:captures.filter(c=>c.status!=='CAPTURED').length}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await collect(process.env.TARGET_DATE);
