import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {normalizeFinancial} from './assess-research-evidence.mjs';
import {reviewedFinancialReport} from './research-evidence.mjs';
import {parseMopsCompanyHistoricalIncomeHtml} from './collect-research-evidence.mjs';
const read=p=>{try{return JSON.parse(fs.readFileSync(p));}catch{return null;}};
const save=(p,x)=>fs.writeFileSync(p,JSON.stringify(x,null,2)+'\n');
export function financialQueue(rows,state,now,admitted){
 const reparsed=r=>state[r.key]?.parserVersion!==2&&/PDF_PERIOD|FILING_VERSION|PROFIT_BASIS/.test(state[r.key]?.reason??'');
 return rows.filter(r=>!admitted.has(r.key)&&(!state[r.key]||state[r.key].parserVersion!==2||state[r.key].status==='VERIFIED'||Date.parse(state[r.key].nextRetryAt)<=now.getTime())).sort((a,b)=>Number(reparsed(b))-Number(reparsed(a))||(state[a.key]?.checkedAt??'').localeCompare(state[b.key]?.checkedAt??''));
}
export async function filingIndex(source,request){
 let html=new TextDecoder('big5').decode(await request(source));
 if(/name=['"]check2858['"]\s+value=['"]Y['"]/i.test(html)&&!html.includes('_AI1.pdf')){
  const url=new URL(source);url.searchParams.set('check2858','Y');html=new TextDecoder('big5').decode(await request(url.toString()));
 }
 return html;
}
export async function requestOfficial(url,body,{fetcher=fetch,pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
 for(let attempt=0;attempt<2;attempt++){
  try{
   const origin=new URL(url).origin,headers={'user-agent':'Mozilla/5.0',accept:'text/html,application/pdf,*/*',...(body?{'content-type':'application/x-www-form-urlencoded',referer:origin+'/mops/web/t164sb04'}:{})};
   const res=await fetcher(url,{method:body?'POST':'GET',body,signal:AbortSignal.timeout(30000),headers});
   if(!res.ok)throw Error(`HTTP_${res.status}`);
   const bytes=Buffer.from(await res.arrayBuffer());
   if(new TextDecoder('big5').decode(bytes).includes('查詢過量'))throw Error('OFFICIAL_RATE_LIMITED');
   return bytes;
  }catch(error){
   if(error.message==='OFFICIAL_RATE_LIMITED'||/^HTTP_(?!429|5)/.test(error.message)||attempt===1)throw error;
   await pause(5000);
  }
 }
}
export function reusablePdf(filename,uploadedAt,code,year,quarter,target){
 for(const name of fs.readdirSync('history/financial-reports').filter(p=>p.startsWith(filename+'.')&&/\.[a-f0-9]{64}\.pdf$/.test(p))){
  const path=`history/financial-reports/${name.slice(0,-4)}`;
  try{
   const version=filingVersion(fs.readFileSync(path+'.html','utf8'),code,year,quarter,target),pdf=fs.readFileSync(path+'.pdf');
   if(version.uploadedAt===uploadedAt&&createHash('sha256').update(pdf).digest('hex')===name.slice(-68,-4))return pdf;
  }catch{}
 }
 return null;
}
export function filingVersion(html,code,year,quarter,target){
 const filename=`${year}${String(quarter).padStart(2,'0')}_${code}_AI1.pdf`;
 const tr=[...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].find(m=>m[1].includes(filename));
 const cells=tr?[...tr[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(m=>m[1].replace(/<[^>]*>/g,'').trim()):[];
 if(cells.length!==11||cells[0]!==code||cells[5]!=='IFRSs合併財報'||cells[7]!==filename||cells[10]!=='無')throw Error('FILING_VERSION_UNVERIFIED');
 const d=cells[9].match(/^(\d{3})\/(\d{2})\/(\d{2}) (\d{2}:\d{2}:\d{2})$/),stamp=d?`${Number(d[1])+1911}-${d[2]}-${d[3]}T${d[4]}+08:00`:'';
 if(!Number.isFinite(Date.parse(stamp))||Date.parse(stamp)>Date.parse(`${target}T23:59:59+08:00`))throw Error('FILING_AFTER_CUTOFF_OR_INVALID');
 return {filename,uploadedAt:cells[9]};
}
export function verifyPdfText(pages,row){
 const year=row['年度']-1911,end=row['季別']*3,endDay=new Date(Date.UTC(row['年度'],end,0)).getUTCDate();
 for(let i=0;i<pages.length;i++){
  if(!pages[i].replace(/\s/g,'').includes('綜合損益表'))continue;
  const page=(pages[i]+(pages[i+1]??'')).replace(/(\d{3})\.(\d{2})\.(\d{2})[~～](\d{3})\.(\d{2})\.(\d{2})/g,(s,y,m,d,y2,m2,d2)=>y===y2?`${y}年${Number(m)}月${Number(d)}日至${Number(m2)}月${Number(d2)}日`:s),c=page.replace(/\s/g,'');
  if(!c.includes('綜合損益表')||!/(新台幣|新臺幣)(千|仟)元/.test(c)||!c.includes(String(year))||!c.includes(String(year-1))||!new RegExp(`(1月至${end}月|1月1日至${end}月${endDay}日)`).test(c))continue;
  const quarterStart=(row['季別']-1)*3+1,headers=[...c.matchAll(new RegExp(`(${year}|${year-1})年(\\d{1,2}月|第${row['季別']}季)`,'g'))].map(m=>`${m[1]}|${m[2]}`);
  const expected=[`${year}|${quarterStart}月`,`${year-1}|${quarterStart}月`,`${year}|1月`,`${year-1}|1月`];
  const four=headers.some((_,n)=>expected.every((v,j)=>headers[n+j]===v||j<2&&headers[n+j]===`${j===0?year:year-1}|第${row['季別']}季`)),two=headers.length===2&&headers[0]===`${year}|1月`&&headers[1]===`${year-1}|1月`;
  if(!four&&!two)continue;
  const columns=four?4:2,cumulativeIndex=four?2:0,percentColumns=page.split('\n').some(l=>/金\s*額/.test(l)&&/[％%]/.test(l));
  const amount=code=>{
   const lines=page.split('\n');let n=lines.findIndex(l=>new RegExp(`^\\s*${code}\\s`).test(l));
   if(n<0&&code==='4000')n=lines.findIndex(l=>/^\s*營業收入(?:淨額|合計)?\s{2,}[$(\d-]/.test(l));
   if(n<0&&code==='8610'){
    const start=lines.findIndex(l=>/淨利(?:[（(]淨損[）)])?歸屬於/.test(l));
    if(start>=0){const end=lines.findIndex((l,j)=>j>start&&/綜合損益.*歸屬於/.test(l));n=lines.findIndex((l,j)=>j>start&&(end<0||j<end)&&/^\s*母公司業主\s/.test(l));}
   }
   if(n<0)return null;
   let line=lines[n].replace(/^\s*\d{4}\s+/,'');
   if(code==='8610'&&!/\d/.test(line)){
    const end=lines.findIndex((l,j)=>j>n&&/^\s*\d{4}\s/.test(l));
    const total=lines.slice(n+1,end<0?lines.length:end).find(l=>/歸屬於母公司業主之本期淨利/.test(l));
    if(total)line=total;
   }
   if(!/\d/.test(line)&&lines[n+1]&&!/^\s*\d{4}\s/.test(lines[n+1])&&(!/\p{Script=Han}/u.test(lines[n+1])||/^\s*[\p{Script=Han}、]+[）)]/u.test(lines[n+1])))line=lines[n+1];
   const tokens=[...line.matchAll(/\(?\s*\$?\s*-?\d[\d,]*(?:\.\d+)?\s*\)?|(?<!\S)-(?!\S)/g)].map(m=>m[0]),values=tokens.map(t=>t.trim()==='-'?null:Number(t.replace(/[\s,$()]/g,''))*(t.includes('(')?-1:1));
   return values.length===columns*2?values[cumulativeIndex*2]:!percentColumns&&values.length===columns&&tokens.every(t=>/,\d{3}/.test(t))?values[cumulativeIndex]:null;
  };
  if(amount('4000')===row['營業收入']&&amount('8610')===row['淨利（淨損）歸屬於母公司業主'])return [i+1,...(pages[i+1]?[i+2]:[])];
 }
 throw Error('PDF_PERIOD_METRICS_OR_PROFIT_BASIS_UNVERIFIED');
}
function verifyPdfWithOcr(pdfText,path,row,deadline){
 try{return verifyPdfText(pdfText.split('\f'),row);}catch{}
 const native=pdfText.split('\f'),count=Number(execFileSync('pdfinfo',[path+'.pdf'],{encoding:'utf8'}).match(/^Pages:\s+(\d+)/m)?.[1]);
 if(!Number.isInteger(count)||count<1)throw Error('PDF_PAGE_COUNT_UNVERIFIED');
 const toc=native.slice(0,3).join('\n').match(/合併綜合損益表\s+(\d+)/),guess=Number(toc?.[1]),order=[...new Set([...native.flatMap((p,i)=>p.includes('綜合損益表')&&p.includes('金')?[i+1]:[]),...Array.from({length:5},(_,i)=>guess-1+i),...Array.from({length:count},(_,i)=>i+1)])].filter(p=>Number.isInteger(p)&&p>=1&&p<=count);
 const texts=Array.from({length:count},(_,i)=>{try{return fs.readFileSync(`${path}.ocr-${i+1}.txt`,'utf8');}catch{return '';}});
 try{return verifyPdfText(texts,row);}catch{}
 // ponytail: spend at most 90 seconds per PDF; cached pages let later runs resume the remaining pages.
 const stop=Math.min(deadline,Date.now()+90000);
 for(const page of order){
  if(texts[page-1])continue;
  if(Date.now()>=stop)throw Error('PDF_OCR_REVIEW_PENDING');
  const output=`${path}.ocr-${page}`;
  try{
   execFileSync('pdftoppm',['-f',String(page),'-singlefile','-r','180','-png',path+'.pdf',output],{timeout:20000,stdio:'ignore'});
   const text=execFileSync('tesseract',[output+'.png','stdout','-l','chi_tra+eng','--psm','6'],{encoding:'utf8',timeout:20000,stdio:['ignore','pipe','ignore']});
   fs.writeFileSync(output+'.txt',text);texts[page-1]=text;
   try{return verifyPdfText(texts,row);}catch{}
  }catch{}finally{fs.rmSync(output+'.png',{force:true});}
 }
 throw Error('PDF_PERIOD_METRICS_OR_PROFIT_BASIS_UNVERIFIED');
}
export async function collectFinancialPdfs(target){
 const root=`raw/${target}`,input=read(`${root}/research-input.json`),reports=read('history/reviewed-financial-reports.json')??[],state=read('history/financial-pdf-collection.json')??{},periods=new Map();
 if(!input)throw Error('Research input missing');
 for(const c of read(`${root}/financial-evidence-captures.json`)?.captures??[])if(c.kind==='income'&&c.status==='CAPTURED'&&!c.historicalFinancial)for(const row of read(`${root}/${c.id}.raw.txt`)??[]){const n=normalizeFinancial(row,'income',c.url);if(n&&n.periodEnd<=target&&(!periods.has(n.code)||periods.get(n.code).periodEnd<n.periodEnd))periods.set(n.code,n);}
 const now=new Date(),today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei'}).format(now),deadline=Date.now()+5*60*1000,requestSpacingMs=Number(process.env.FINANCIAL_REQUEST_SPACING_MS||1500);
 const stocks=input.deepDive.filter(r=>(r.assetType??r.current?.assetType)==='STOCK'),rows=stocks.filter(r=>periods.has(r.code)).map(r=>({...r,key:`${r.code}|${periods.get(r.code).periodEnd}`})),admitted=new Set();
 const admit=()=>{for(const r of rows){const current=periods.get(r.code);if(state[r.key]?.checkedDate===today&&state[r.key]?.parserVersion===2&&reports.some(p=>{const n=reviewedFinancialReport(p,target);return n?.code===r.code&&n.periodEnd===`${Number(current.periodEnd.slice(0,4))-1}${current.periodEnd.slice(4)}`&&n.profitBasis===current.profitBasis;}))admitted.add(r.key);}};
 admit();const queue=financialQueue(rows,state,now,admitted);let rateLimited=false;
 fs.mkdirSync('history/financial-reports',{recursive:true});
 const request=(url,body)=>requestOfficial(url,body);
 for(const r of queue){
  if(Date.now()>deadline)break;
  const current=periods.get(r.code),year=Number(current.periodEnd.slice(0,4))-1,quarter=current.quarter,code=r.code,source=`https://doc.twse.com.tw/server-java/t57sb01?step=1&colorchg=1&co_id=${code}&year=${year-1911}&seamon=&mtype=A&check2858=Y`;
  let stage='FILING_INDEX';
  try{
    const index=await filingIndex(source,request),version=filingVersion(index,code,year,quarter,target);
   if(!reports.some(p=>p.filename===version.filename&&p.uploadedAt===version.uploadedAt&&reviewedFinancialReport(p,target)?.profitBasis===current.profitBasis)){
    let pdf=reusablePdf(version.filename,version.uploadedAt,code,year,quarter,target),pdfUrl=null;
    if(!pdf){
     stage='PDF_LINK';
     const download=new TextDecoder('big5').decode(await request('https://doc.twse.com.tw/server-java/t57sb01?'+new URLSearchParams({step:'9',kind:'A',co_id:code,filename:version.filename,check2858:'Y'}))),link=download.match(/href=['"](\/pdf\/[^'"<>]+\.pdf)['"]/);if(!link||!link[1].startsWith('/pdf/'+version.filename.slice(0,-4)+'_'))throw Error('OFFICIAL_PDF_LINK_MISSING');
     stage='PDF_DOWNLOAD';pdfUrl='https://doc.twse.com.tw'+link[1];pdf=await request(pdfUrl);
    }
    if(pdf.subarray(0,5).toString()!=='%PDF-')throw Error('NOT_PDF');
    const sha256=createHash('sha256').update(pdf).digest('hex'),archiveKey=`${version.filename}.${sha256}`,path=`history/financial-reports/${archiveKey}`;fs.writeFileSync(path+'.pdf',pdf);fs.writeFileSync(path+'.html',index);
    stage='MOPS_PERIOD_TABLE';
    const tablePath=path+'.income.html';let html;
    try{html=fs.readFileSync(tablePath,'utf8');parseMopsCompanyHistoricalIncomeHtml(html,{code,year,quarter});}catch{html=new TextDecoder('utf-8').decode(await request('https://mopsov.twse.com.tw/mops/web/ajax_t164sb04',new URLSearchParams({encodeURIComponent:'1',step:'1',firstin:'1',off:'1',queryName:'co_id',inpuType:'co_id',TYPEK:r.current?.market==='TPEx'?'otc':'sii',isnew:'false',co_id:code,year:String(year-1911),season:String(quarter).padStart(2,'0')})));fs.writeFileSync(tablePath,html);}
    const row=parseMopsCompanyHistoricalIncomeHtml(html,{code,year,quarter});
    if(normalizeFinancial(row,'income',source)?.profitBasis!==current.profitBasis)throw Error('PROFIT_BASIS_UNVERIFIED');
    stage='PDF_METRICS';
    const pdfText=execFileSync('pdftotext',['-layout',path+'.pdf','-'],{encoding:'utf8',timeout:20000,maxBuffer:12*1024*1024}),reviewedPages=verifyPdfWithOcr(pdfText,path,row,deadline),report={...version,archiveKey,sha256,source,pdfUrl,row,reviewedPages,basis:'YEAR_TO_DATE',unit:'TWD_THOUSAND',verificationMethod:'PDF_TEXT_MATCHED_OFFICIAL_PERIOD_TABLE'};
    if(!reviewedFinancialReport(report,target))throw Error('ARCHIVE_PROVENANCE_UNVERIFIED');reports.push(report);save('history/reviewed-financial-reports.json',reports);
   }
   state[r.key]={status:'VERIFIED',parserVersion:2,checkedDate:today,checkedAt:new Date().toISOString()};admitted.add(r.key);
  }catch(e){
   const attempts=state[r.key]?.checkedDate===today?(state[r.key]?.attempts??0)+1:1,transient=/fetch failed|timeout|aborted|HTTP_(429|5\d\d)|PDF_OCR_REVIEW_PENDING/i.test(e.message);
   state[r.key]={status:'UNVERIFIED',parserVersion:2,stage,reason:e.message,attempts,checkedDate:today,checkedAt:new Date().toISOString(),nextRetryAt:new Date(Date.now()+(transient?Math.min(300000*2**(attempts-1),86400000):86400000)).toISOString()};
   if(e.message==='OFFICIAL_RATE_LIMITED'){rateLimited=true;save('history/financial-pdf-collection.json',state);break;}
  }
  save('history/financial-pdf-collection.json',state);await new Promise(resolve=>setTimeout(resolve,requestSpacingMs));
 }
 admit();const ready=financialQueue(rows,state,new Date(),admitted);
 save(`${root}/financial-pdf-collection.json`,{targetDate:target,results:state,remaining:rows.filter(r=>!admitted.has(r.key)).length,ready:ready.length,continuationNeeded:!rateLimited&&ready.length>0,rateLimited,missingCurrentPeriodCodes:stocks.filter(r=>!periods.has(r.code)).map(r=>r.code)});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await collectFinancialPdfs(process.env.TARGET_DATE);
