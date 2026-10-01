import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {normalizeFinancial} from './assess-research-evidence.mjs';
import {reviewedFinancialReport} from './research-evidence.mjs';
import {parseMopsCompanyHistoricalIncomeHtml} from './collect-research-evidence.mjs';
const read=p=>{try{return JSON.parse(fs.readFileSync(p));}catch{return null;}};
const save=(p,x)=>fs.writeFileSync(p,JSON.stringify(x,null,2)+'\n');
export async function requestOfficial(url,body,{fetcher=fetch,pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
 for(let attempt=0;attempt<2;attempt++){
  try{
   const res=await fetcher(url,{method:body?'POST':'GET',body,signal:AbortSignal.timeout(30000),headers:body?{'content-type':'application/x-www-form-urlencoded'}:{}});
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
 const year=row['年度']-1911,end=row['季別']*3;
 for(let i=0;i<pages.length;i++){
  const page=pages[i]+(pages[i+1]??''),c=page.replace(/\s/g,'');
  if(!c.includes('綜合損益表')||!/(新台幣|新臺幣)(千|仟)元/.test(c)||!c.includes(String(year))||!c.includes(String(year-1))||!new RegExp(`(1月至${end}月|1月1日至${end}月30日)`).test(c))continue;
  const quarterStart=(row['季別']-1)*3+1,headers=[...c.matchAll(new RegExp(`(${year}|${year-1})年(\\d{1,2}月|第${row['季別']}季)`,'g'))].map(m=>`${m[1]}|${m[2]}`);
  const expected=[`${year}|${quarterStart}月`,`${year-1}|${quarterStart}月`,`${year}|1月`,`${year-1}|1月`];
  if(!headers.some((_,n)=>expected.every((v,j)=>headers[n+j]===v||j<2&&headers[n+j]===`${j===0?year:year-1}|第${row['季別']}季`)))continue;
  const amount=code=>{const lines=page.split('\n'),n=lines.findIndex(l=>new RegExp(`^\\s*${code}\\s`).test(l));if(n<0)return null;const line=lines[n].match(/\d{1,3},\d{3}/)?lines[n]:lines[n+1]??'';const values=[...line.matchAll(/\(?\s*\$?\s*-?\d{1,3}(?:,\d{3})+(?:\.\d+)?\s*\)?/g)].map(m=>Number(m[0].replace(/[\s,$()]/g,''))*(m[0].includes('(')?-1:1));return values.length===4?values[2]:null;};
  if(amount('4000')===row['營業收入']&&amount('8610')===row['淨利（淨損）歸屬於母公司業主'])return [i+1];
 }
 throw Error('PDF_PERIOD_METRICS_OR_PROFIT_BASIS_UNVERIFIED');
}
function verifyPdfWithOcr(pdfText,path,row,deadline){
 try{return verifyPdfText(pdfText.split('\f'),row);}catch{}
 // ponytail: inspect the first 12 pages; later statement pages remain pending until the bound is expanded.
 for(let page=1;page<=12&&Date.now()<deadline;page++){
  const output=`${path}.ocr-${page}`;
  try{
   execFileSync('pdftoppm',['-f',String(page),'-singlefile','-r','180','-png',path+'.pdf',output],{timeout:20000,stdio:'ignore'});
   const text=execFileSync('tesseract',[output+'.png','stdout','-l','chi_tra+eng','--psm','6'],{encoding:'utf8',timeout:20000,stdio:['ignore','pipe','ignore']});
   verifyPdfText([text],row);return [page];
  }catch{}finally{fs.rmSync(output+'.png',{force:true});}
 }
 throw Error('PDF_PERIOD_METRICS_OR_PROFIT_BASIS_UNVERIFIED');
}
export async function collectFinancialPdfs(target){
 const root=`raw/${target}`,input=read(`${root}/research-input.json`),reports=read('history/reviewed-financial-reports.json')??[],state=read('history/financial-pdf-collection.json')??{},periods=new Map();
 if(!input)throw Error('Research input missing');
 for(const c of read(`${root}/financial-evidence-captures.json`)?.captures??[])if(c.kind==='income'&&c.status==='CAPTURED'&&!c.historicalFinancial)for(const row of read(`${root}/${c.id}.raw.txt`)??[]){const n=normalizeFinancial(row,'income',c.url);if(n&&n.periodEnd<=target&&(!periods.has(n.code)||periods.get(n.code).periodEnd<n.periodEnd))periods.set(n.code,n);}
 const manifest=read('manifest.json'),candidates=new Set((read(manifest?.researchPath)?.candidates??[]).map(r=>r.code)),today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei'}).format(new Date()),deadline=Date.now()+5*60*1000;
 const queue=input.deepDive.filter(r=>(r.assetType??r.current?.assetType)==='STOCK'&&periods.has(r.code)).map(r=>({...r,key:`${r.code}|${periods.get(r.code).periodEnd}`})).filter(r=>state[r.key]?.checkedDate!==today).sort((a,b)=>(state[a.key]?.checkedAt??'').localeCompare(state[b.key]?.checkedAt??'')||Number(candidates.has(b.code))-Number(candidates.has(a.code)));
 fs.mkdirSync('history/financial-reports',{recursive:true});
 const request=(url,body)=>requestOfficial(url,body);
 for(const r of queue.slice(0,12)){
  if(Date.now()>deadline)break;
  const current=periods.get(r.code),year=Number(current.periodEnd.slice(0,4))-1,quarter=current.quarter,code=r.code,source=`https://doc.twse.com.tw/server-java/t57sb01?step=1&colorchg=1&co_id=${code}&year=${year-1911}&seamon=&mtype=A`;
  try{
   const index=new TextDecoder('big5').decode(await request(source)),version=filingVersion(index,code,year,quarter,target);
   if(!reports.some(p=>p.filename===version.filename&&p.uploadedAt===version.uploadedAt&&reviewedFinancialReport(p,target))){
    const download=new TextDecoder('big5').decode(await request('https://doc.twse.com.tw/server-java/t57sb01',new URLSearchParams({step:'9',kind:'A',co_id:code,filename:version.filename}))),link=download.match(/href=['"](\/pdf\/[^'"<>]+\.pdf)['"]/);if(!link||!link[1].startsWith('/pdf/'+version.filename.slice(0,-4)+'_'))throw Error('OFFICIAL_PDF_LINK_MISSING');
    const pdfUrl='https://doc.twse.com.tw'+link[1],pdf=reusablePdf(version.filename,version.uploadedAt,code,year,quarter,target)??await request(pdfUrl);if(pdf.subarray(0,5).toString()!=='%PDF-')throw Error('NOT_PDF');
    const sha256=createHash('sha256').update(pdf).digest('hex'),archiveKey=`${version.filename}.${sha256}`,path=`history/financial-reports/${archiveKey}`;fs.writeFileSync(path+'.pdf',pdf);fs.writeFileSync(path+'.html',index);
    const html=new TextDecoder('utf-8').decode(await request('https://mopsov.twse.com.tw/mops/web/ajax_t164sb04',new URLSearchParams({step:'1',firstin:'1',off:'1',TYPEK:r.current?.market==='TPEx'?'otc':'sii',isnew:'false',co_id:code,year:String(year-1911),season:String(quarter).padStart(2,'0')}))),row=parseMopsCompanyHistoricalIncomeHtml(html,{code,year,quarter});
    const pdfText=execFileSync('pdftotext',['-layout',path+'.pdf','-'],{encoding:'utf8',timeout:20000,maxBuffer:12*1024*1024}),reviewedPages=verifyPdfWithOcr(pdfText,path,row,deadline),report={...version,archiveKey,sha256,source,pdfUrl,row,reviewedPages,basis:'YEAR_TO_DATE',unit:'TWD_THOUSAND',verificationMethod:'PDF_TEXT_MATCHED_OFFICIAL_PERIOD_TABLE'};
    if(!reviewedFinancialReport(report,target))throw Error('ARCHIVE_PROVENANCE_UNVERIFIED');reports.push(report);save('history/reviewed-financial-reports.json',reports);
   }
   state[r.key]={status:'VERIFIED',checkedDate:today,checkedAt:new Date().toISOString()};
  }catch(e){state[r.key]={status:'UNVERIFIED',reason:e.message,checkedDate:today,checkedAt:new Date().toISOString()};if(e.message==='OFFICIAL_RATE_LIMITED'){save('history/financial-pdf-collection.json',state);break;}}
  save('history/financial-pdf-collection.json',state);await new Promise(resolve=>setTimeout(resolve,5000));
 }
 save(`${root}/financial-pdf-collection.json`,{targetDate:target,results:state,remaining:queue.filter(r=>state[r.key]?.checkedDate!==today).length});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await collectFinancialPdfs(process.env.TARGET_DATE);
