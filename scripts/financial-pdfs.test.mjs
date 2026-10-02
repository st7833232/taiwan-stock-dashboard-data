import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {parseMopsCompanyHistoricalIncomeHtml} from './collect-research-evidence.mjs';
import {filingVersion,verifyPdfText,requestOfficial} from './collect-financial-pdfs.mjs';
test('readable filed income tables verify Chinese dates, half-year headers and amount-only ownership rows without OCR',()=>{
 for(const code of ['1303','1528','2233','2312','2316','2338','2363','2371','2374','2454']){
  const file=fs.readdirSync('history/financial-reports').find(p=>p.startsWith(`202502_${code}_AI1.pdf.`)&&p.endsWith('.pdf'));
  const stem='history/financial-reports/'+file.slice(0,-4),row=parseMopsCompanyHistoricalIncomeHtml(fs.readFileSync(stem+'.income.html','utf8'),{code,year:2025,quarter:2});
  const pages=execFileSync('pdftotext',['-layout',stem+'.pdf','-'],{encoding:'utf8'}).split('\f');
  assert.ok(verifyPdfText(pages,row).length,code);
  assert.throws(()=>verifyPdfText(pages,{...row,'營業收入':row['營業收入']+1}),code);
  assert.throws(()=>verifyPdfText(pages,{...row,'淨利（淨損）歸屬於母公司業主':row['淨利（淨損）歸屬於母公司業主']+1}),code);
 }
});
test('file versions use official upload time and never accept a later or corrected filing',()=>{
 const html=fs.readFileSync('history/financial-reports/2409.html','utf8');
 assert.equal(filingVersion(html,'2409',2025,2,'2026-09-30').filename,'202502_2409_AI1.pdf');
 assert.throws(()=>filingVersion(html,'2409',2025,2,'2025-08-12'));
 assert.throws(()=>filingVersion(html.replace(/>無</g,'>已更正<'),'2409',2025,2,'2026-09-30'));
 assert.throws(()=>filingVersion(html,'8150',2025,2,'2026-09-30'));
});
test('a PDF must independently match cumulative revenue and parent profit rather than quarter-only numbers',()=>{
 const page='合併綜合損益表 新台幣千元 114年4月至6月 113年4月至6月 114年1月至6月 113年1月至6月\n4000 營業收入 10,000 100 11,000 100 20,000 100 22,000 100\n8610 母公司業主 1,000 10 1,100 10 2,000 10 2,200 10';
 const row={'年度':2025,'季別':2,'營業收入':20000,'淨利（淨損）歸屬於母公司業主':2000};
 assert.deepEqual(verifyPdfText([page],row),[1]);
 assert.throws(()=>verifyPdfText([page],{...row,'營業收入':10000}));
 assert.throws(()=>verifyPdfText([page.replaceAll('千元','元')],row));
 assert.throws(()=>verifyPdfText(['scanned or unreadable'],row));
 assert.throws(()=>verifyPdfText([page.replace('114年1月至6月 113年1月至6月','113年1月至6月 114年1月至6月')],row));
});

test('MOPS parent profit labels preserve the ownership basis used by archived PDFs',()=>{
 const html='<tr><th>項目</th><th colspan="2">114年第2季</th><th colspan="2">113年第2季</th><th colspan="2">114年01月01日至114年06月30日</th></tr>'+['營業收入','本期淨利（淨損）','母公司業主（淨利∕損）'].map(label=>`<tr><td>${label}</td><td>1</td><td>1</td><td>2</td><td>2</td><td>3000</td><td>3</td></tr>`).join('');
 assert.equal(parseMopsCompanyHistoricalIncomeHtml(html,{code:'2330',year:2025,quarter:2})['淨利（淨損）歸屬於母公司業主'],3000);
});

test('dotted ROC date ranges verify the same cumulative period without accepting a shifted year',()=>{
 const page='合併綜合損益表 新台幣仟元 114.04.01~114.06.30 113.04.01~113.06.30 114.01.01~114.06.30 113.01.01~113.06.30\n4000 營業收入 2,524,720 100 2,272,981 100 4,828,640 100 4,245,842 100\n8610 母公司業主 (82,912) (3) 2,037 0 (53,340) (1) 3,599 0';
 const row={'年度':2025,'季別':2,'營業收入':4828640,'淨利（淨損）歸屬於母公司業主':-53340};
 assert.deepEqual(verifyPdfText([page],row),[1]);
 assert.throws(()=>verifyPdfText([page.replace('114.01.01~114.06.30','114.01.01~115.06.30')],row));
 assert.throws(()=>verifyPdfText([page],{...row,'淨利（淨損）歸屬於母公司業主':126707}));
});

test('transient official reads retry once, while an explicit rate limit stops without retrying',async()=>{
 let calls=0;
 const bytes=await requestOfficial('https://doc.twse.com.tw/',null,{pause:async()=>{},fetcher:async()=>{calls++;if(calls===1)throw Error('fetch failed');return new Response('official');}});
 assert.equal(calls,2);assert.equal(bytes.toString(),'official');
 calls=0;
 await assert.rejects(()=>requestOfficial('https://doc.twse.com.tw/',null,{pause:async()=>{},fetcher:async()=>{calls++;return new Response('',{status:403});}}),/HTTP_403/);
 assert.equal(calls,1);
});
test('financial collection stops new reads and retries when its time budget is exhausted, leaving recovery to the next run',async()=>{
 let calls=0;const fetcher=async()=>{calls++;throw Error('fetch failed');};
 await assert.rejects(()=>requestOfficial('https://doc.twse.com.tw/',null,{deadline:Date.now()-1,fetcher,pause:async()=>{}}),/FINANCIAL_COLLECTION_BUDGET_EXHAUSTED/);assert.equal(calls,0);
 await assert.rejects(()=>requestOfficial('https://doc.twse.com.tw/',null,{deadline:Date.now()+5000,fetcher,pause:async()=>{}}),/FINANCIAL_COLLECTION_BUDGET_EXHAUSTED/);assert.equal(calls,1);
});

test('an official query-limit page is never retried as a transport failure',async()=>{
 let calls=0;await assert.rejects(()=>requestOfficial('https://doc.twse.com.tw/',null,{pause:async()=>{},fetcher:async()=>{calls++;return new Response(Buffer.from('ac64b8dfb94cb671','hex'));}}),/OFFICIAL_RATE_LIMITED/);assert.equal(calls,1);
});

test('uncoded revenue and profit subtotals match the filed PDF, never comprehensive income or sales before returns',()=>{
 const header='合併綜合損益表 新台幣千元 114年4月至6月 113年4月至6月 114年1月至6月 113年1月至6月\n';
 const page=header+'4110 銷貨收入 10,000 100 11,000 100 21,000 100 22,000 100\n  營業收入淨額  9,000 100 10,000 100 20,000 100 21,000 100\n淨利歸屬於：\n  母公司業主  100 1 200 2 (300) (3) 400 4\n綜合損益總額歸屬於：\n  母公司業主  1,000 1 2,000 2 3,000 3 4,000 4';
 const row={'年度':2025,'季別':2,'營業收入':20000,'淨利（淨損）歸屬於母公司業主':-300};
 assert.deepEqual(verifyPdfText([page],row),[1]);
 assert.throws(()=>verifyPdfText([page],{...row,'營業收入':21000}));
 assert.throws(()=>verifyPdfText([page],{...row,'淨利（淨損）歸屬於母公司業主':3000}));
});
test('financial holding company menu is followed only for the same official company',async()=>{
 const {filingIndex}=await import('./collect-financial-pdfs.mjs');
 const seen=[];
 const request=async url=>{seen.push(url);return Buffer.from(seen.length===1?"<input type='hidden' name='check2858' value='Y'>":'file index');};
 assert.equal(await filingIndex('https://doc.twse.com.tw/server-java/t57sb01?co_id=2881',request),'file index');
 assert.equal(new URL(seen[1]).searchParams.get('co_id'),'2881');assert.equal(new URL(seen[1]).searchParams.get('check2858'),'Y');
});
test('resumable financial queue prioritizes new work, skips admitted PDFs, and respects retry deadlines',async()=>{
 const {financialQueue}=await import('./collect-financial-pdfs.mjs');
 const now=new Date('2026-10-01T08:00:00Z'),rows=['new','retry','wait','done','blocked'].map(key=>({key,code:key}));
 const state={retry:{parserVersion:2,nextRetryAt:'2026-10-01T07:00:00Z',checkedAt:'2026-10-01T06:00:00Z'},wait:{parserVersion:2,nextRetryAt:'2026-10-01T09:00:00Z'},blocked:{parserVersion:2,nextRetryAt:'2026-10-02T08:00:00Z'}};
 assert.deepEqual(financialQueue(rows,state,now,new Set(['done'])).map(r=>r.key),['new','retry']);
});

test('an admitted record with a missing local archive is rechecked rather than silently skipped',async()=>{
 const {financialQueue}=await import('./collect-financial-pdfs.mjs');
 assert.equal(financialQueue([{key:'lost',code:'lost'}],{lost:{status:'VERIFIED',parserVersion:2}},new Date(),new Set()).length,1);
});
test('financial continuation requires this run validation, actionable work and a bounded chain',async()=>{
 const {shouldContinueFinancial}=await import('./continue-financial-evidence.mjs');
 const c={targetDate:'2026-09-30',continuationNeeded:true,ready:3},r={targetDate:'2026-09-30',researchComplete:false,evidencePending:{fundamental:530},validation:{status:'PASS',runId:'123'}};
 assert.equal(shouldContinueFinancial(c,r,'123',0),true);
 for(const [collection,report,run,count] of [[{...c,rateLimited:true},r,'123',0],[{...c,ready:0},r,'123',0],[c,{...r,validation:{status:'PASS',runId:'old'}},'123',0],[c,r,'123',40],[c,r,'123',NaN],[c,{...r,researchComplete:true},'123',0]])assert.equal(shouldContinueFinancial(collection,report,run,count),false);
});

test('explicit cumulative-only PDF columns can be verified without accepting a quarter-only table',()=>{
 const row={'年度':2025,'季別':2,'營業收入':20000,'淨利（淨損）歸屬於母公司業主':2000};
 const page='合併綜合損益表 新台幣千元 114年1月至6月 113年1月至6月\n4000 營業收入 20,000 100 22,000 100\n8610 母公司業主 2,000 10 2,200 10';
 assert.deepEqual(verifyPdfText([page],row),[1]);
 assert.throws(()=>verifyPdfText([page.replaceAll('1月至6月','4月至6月')],row));
});
test('MOPS cumulative dates and parent labels normalize formatting without mixing years or profit ownership',()=>{
 const html='<tr><th>項目</th><th colspan="2">114年第2季</th><th colspan="2">113年第2季</th><th colspan="2">114年1月1日至114年6月30日</th></tr><tr><td>營業收入</td><td>1</td><td>1</td><td>2</td><td>2</td><td>3000</td><td>3</td></tr><tr><td>本期淨利(淨損)</td><td>1</td><td>1</td><td>2</td><td>2</td><td>500</td><td>3</td></tr><tr><td>母公司業主(淨利/損)</td><td>1</td><td>1</td><td>2</td><td>2</td><td>(100)</td><td>3</td></tr>';
 const parsed=parseMopsCompanyHistoricalIncomeHtml(html,{code:'8150',year:2025,quarter:2});
 assert.equal(parsed['本期淨利（淨損）'],500);assert.equal(parsed['淨利（淨損）歸屬於母公司業主'],-100);
 assert.throws(()=>parseMopsCompanyHistoricalIncomeHtml(html.replaceAll('114年6月30日','115年6月30日'),{code:'8150',year:2025,quarter:2}));
});

test('a truncated percentage row cannot impersonate four complete amount columns',()=>{
 const page='合併綜合損益表 新台幣千元 114年4月至6月 113年4月至6月 114年1月至6月 113年1月至6月\n金額 ％ 金額 ％ 金額 ％ 金額 ％\n4000 營業收入 10,000 100 11,000 100\n8610 母公司業主 1,000 10 1,100 10';
 assert.throws(()=>verifyPdfText([page],{'年度':2025,'季別':2,'營業收入':11000,'淨利（淨損）歸屬於母公司業主':1100}));
});

test('wrapped official footnotes retain the amount row without consuming another account',()=>{
 const header='合併綜合損益表 新台幣千元 114年4月1日至6月30日 113年4月1日至6月30日 114年1月1日至6月30日 113年1月1日至6月30日\n金額 ％ 金額 ％ 金額 ％ 金額 ％\n';
 const row={'年度':2025,'季別':2,'營業收入':20000,'淨利（淨損）歸屬於母公司業主':2000};
 const page=header+'4000 營業收入淨額（附註二五及\n 三四）   $ 10,000 100 11,000 100 20,000 100 22,000 100\n8610 母公司業主 1,000 10 1,100 10 2,000 10 2,200 10';
 assert.deepEqual(verifyPdfText([page],row),[1]);
 assert.throws(()=>verifyPdfText([page.replace(' 三四）','5000 營業成本')],row));
});
test('parent profit includes the explicit total of continuing and discontinued operations',()=>{
 const page='合併綜合損益表 新台幣千元 114年4月至6月 113年4月至6月 114年1月至6月 113年1月至6月\n金額 ％ 金額 ％ 金額 ％ 金額 ％\n4000 營業收入 10,000 100 11,000 100 20,000 100 22,000 100\n8610 母公司業主\n 繼續營業單位本期淨利 1,000 10 1,100 10 2,000 10 2,200 10\n 停業單位本期淨利 (100) (1) (110) (1) (200) (1) (220) (1)\n 歸屬於母公司業主之本期淨利(損) $ 900 9 990 9 1,800 9 1,980 9\n8620 非控制權益 10 1 10 1 20 1 20 1';
 const row={'年度':2025,'季別':2,'營業收入':20000,'淨利（淨損）歸屬於母公司業主':1800};
 assert.deepEqual(verifyPdfText([page],row),[1]);
 assert.throws(()=>verifyPdfText([page],{...row,'淨利（淨損）歸屬於母公司業主':2000}));
});

test('an intact official archive resumes without a fresh index request, while tampering or future filings cannot',async()=>{
 const {archivedFilingIndex}=await import('./collect-financial-pdfs.mjs');
 const {createHash}=await import('node:crypto');const {default:os}=await import('node:os');const {default:path}=await import('node:path');
 const original=process.cwd(),html=fs.readFileSync('history/financial-reports/2409.html','utf8'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'filing-cache-'));
 try{
  process.chdir(tmp);fs.mkdirSync('history/financial-reports',{recursive:true});
  const pdf=Buffer.from('%PDF-official-test-archive'),sha=createHash('sha256').update(pdf).digest('hex'),stem=`history/financial-reports/202502_2409_AI1.pdf.${sha}`;
  fs.writeFileSync(stem+'.pdf',pdf);fs.writeFileSync(stem+'.html',html);
  assert.equal(archivedFilingIndex('2409',2025,2,'2026-10-01'),html);
  assert.equal(archivedFilingIndex('2409',2025,2,'2025-08-12'),null);
  fs.writeFileSync(stem+'.pdf','%PDF-changed');assert.equal(archivedFilingIndex('2409',2025,2,'2026-10-01'),null);
 }finally{process.chdir(original);fs.rmSync(tmp,{recursive:true,force:true});}
});

test('saved PDFs make progress before new network work during official outages',async()=>{
 const {financialQueue}=await import('./collect-financial-pdfs.mjs');
 const rows=[{key:'network',archived:false},{key:'local',archived:true}];
 assert.deepEqual(financialQueue(rows,{},new Date(),new Set()).map(r=>r.key),['local','network']);
});
test('OCR reviews the identified income table and its continuation instead of unrelated notes, but scanned files still resume all pages',async()=>{
 const {pdfReviewPages,financialQueue}=await import('./collect-financial-pdfs.mjs');
 assert.deepEqual(pdfReviewPages(['目錄','資產負債表','合併綜合損益表 金額','續表','附註'],5),[3,4]);
 assert.deepEqual(pdfReviewPages(['','',''],3),[1,2,3]);
 const now=new Date('2026-10-02T01:00:00Z'),state={old:{parserVersion:2,textParserVersion:2,nextRetryAt:'2026-10-03T01:00:00Z'},current:{parserVersion:2,textParserVersion:4,nextRetryAt:'2026-10-03T01:00:00Z'}};
 assert.deepEqual(financialQueue([{key:'old',archived:true},{key:'current',archived:true}],state,now,new Set()).map(r=>r.key),['old']);
});

test('verified historical PDFs stay admitted across days with linear archive reads and no network work',async()=>{
 const {collectFinancialPdfs}=await import('./collect-financial-pdfs.mjs');
 const {default:os}=await import('node:os');const {default:path}=await import('node:path');
 const original=process.cwd(),fetcher=globalThis.fetch,reader=fs.readFileSync,reports=JSON.parse(fs.readFileSync('history/reviewed-financial-reports.json')).filter(r=>['2409','3605'].includes(r.row['公司代號'])),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'financial-admission-'));let requests=0,pdfReads=0;
 try{
  fs.mkdirSync(path.join(tmp,'history/financial-reports'),{recursive:true});
  for(const report of reports){const code=report.row['公司代號'],prefix=report.archiveKey??code;fs.copyFileSync(`history/financial-reports/${prefix}.html`,path.join(tmp,`history/financial-reports/${prefix}.html`));
   const pdf=report.archiveKey?report.archiveKey+'.pdf':report.filename;fs.copyFileSync('history/financial-reports/'+pdf,path.join(tmp,'history/financial-reports/'+pdf));}
  process.chdir(tmp);fs.mkdirSync('raw/2026-10-01',{recursive:true});
  fs.writeFileSync('history/reviewed-financial-reports.json',JSON.stringify(reports));fs.writeFileSync('history/financial-pdf-collection.json',JSON.stringify(Object.fromEntries(['2409','3605'].map(code=>[`${code}|2026-06-30`,{status:'VERIFIED',parserVersion:2,checkedDate:'2026-09-30'}]))));
  fs.writeFileSync('raw/2026-10-01/research-input.json',JSON.stringify({deepDive:['2409','3605'].map(code=>({code,assetType:'STOCK'}))}));fs.writeFileSync('raw/2026-10-01/financial-evidence-captures.json',JSON.stringify({captures:[{id:'income',kind:'income',status:'CAPTURED'}]}));
  fs.writeFileSync('raw/2026-10-01/income.raw.txt',JSON.stringify(['2409','3605'].map(code=>({'公司代號':code,'年度':2026,'季別':2,'淨利（淨損）歸屬於母公司業主':100}))));
  globalThis.fetch=async()=>{requests++;throw Error('OFFICIAL_RATE_LIMITED');};fs.readFileSync=(p,...args)=>{if(String(p).endsWith('.pdf'))pdfReads++;return reader(p,...args);};
  await collectFinancialPdfs('2026-10-01');
  assert.equal(requests,0);assert.equal(JSON.parse(fs.readFileSync('raw/2026-10-01/financial-pdf-collection.json')).remaining,0);assert.equal(pdfReads,4);
 }finally{globalThis.fetch=fetcher;fs.readFileSync=reader;process.chdir(original);fs.rmSync(tmp,{recursive:true,force:true});}
});
