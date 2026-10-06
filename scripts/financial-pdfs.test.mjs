import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {parseMopsCompanyHistoricalIncomeHtml} from './collect-research-evidence.mjs';
import {filingVersion,verifyPdfText,requestOfficial} from './collect-financial-pdfs.mjs';
test('readable filed income tables verify Chinese dates, half-year headers and amount-only ownership rows without OCR',()=>{
 for(const code of ['1303','1528','1569','1785','2233','2312','2316','2338','2363','2371','2374','2454','3017','6116','8210']){
  const file=fs.readdirSync('history/financial-reports').find(p=>p.startsWith(`202502_${code}_AI1.pdf.`)&&p.endsWith('.pdf'));
  const stem='history/financial-reports/'+file.slice(0,-4),row=parseMopsCompanyHistoricalIncomeHtml(fs.readFileSync(stem+'.income.html','utf8'),{code,year:2025,quarter:2});
  const pages=execFileSync('pdftotext',['-layout',stem+'.pdf','-'],{encoding:'utf8'}).split('\f');
  assert.ok(verifyPdfText(pages,row).length,code);
  assert.throws(()=>verifyPdfText(pages,{...row,'營業收入':row['營業收入']+1}),code);
  assert.throws(()=>verifyPdfText(pages,{...row,'淨利（淨損）歸屬於母公司業主':row['淨利（淨損）歸屬於母公司業主']+1}),code);
 }
});
test('filed subtotals and Gregorian dates verify net revenue and scoped parent profit without accepting component sales or comprehensive income',()=>{
 for(const code of ['1409','2404','2637','3022','3042','3605','4971','6488','6617']){
  const file=fs.readdirSync('history/financial-reports').find(p=>p.startsWith(`202502_${code}_AI1.pdf.`)&&p.endsWith('.pdf'));
  const stem='history/financial-reports/'+file.slice(0,-4),row=parseMopsCompanyHistoricalIncomeHtml(fs.readFileSync(stem+'.income.html','utf8'),{code,year:2025,quarter:2});
  const pages=execFileSync('pdftotext',['-layout',stem+'.pdf','-'],{encoding:'utf8'}).split('\f');
  assert.ok(verifyPdfText(pages,row).length,code);
  assert.throws(()=>verifyPdfText(pages,{...row,'營業收入':row['營業收入']+1}),code);
  assert.throws(()=>verifyPdfText(pages,{...row,'淨利（淨損）歸屬於母公司業主':row['淨利（淨損）歸屬於母公司業主']+1}),code);
  if(code==='3605')assert.throws(()=>verifyPdfText(pages,{...row,'營業收入':5131273}),'sales exclude other operating revenue');
  if(code==='6488')assert.throws(()=>verifyPdfText(pages,{...row,'淨利（淨損）歸屬於母公司業主':-3278121}),'comprehensive income is not net profit');
 }
});
test('compatibility date glyphs and dash percentage cells preserve exact parent-profit verification',()=>{
 const file=fs.readdirSync('history/financial-reports').find(p=>p.startsWith('202502_3481_AI1.pdf.')&&p.endsWith('.pdf'));
 const stem='history/financial-reports/'+file.slice(0,-4),row=parseMopsCompanyHistoricalIncomeHtml(fs.readFileSync(stem+'.income.html','utf8'),{code:'3481',year:2025,quarter:2});
 const pages=execFileSync('pdftotext',['-layout',stem+'.pdf','-'],{encoding:'utf8'}).split('\f');
 assert.deepEqual(verifyPdfText(pages,row),[8,9]);
 assert.throws(()=>verifyPdfText(pages,{...row,'營業收入':row['營業收入']+1}));
 assert.throws(()=>verifyPdfText(pages,{...row,'淨利（淨損）歸屬於母公司業主':row['本期淨利（淨損）']}),'total profit cannot replace parent profit');
 assert.throws(()=>verifyPdfText(pages,{...row,'年度':2024}),'a different financial period cannot match');
});
test('wrapped parenthetical footnotes retain the filed comparative revenue without crossing account rows',()=>{
 const file=fs.readdirSync('history/financial-reports').find(p=>p.startsWith('202602_1216_AI1.pdf.')&&p.endsWith('.pdf'));
 const stem='history/financial-reports/'+file.slice(0,-4),row=parseMopsCompanyHistoricalIncomeHtml(fs.readFileSync(stem+'.income.html','utf8'),{code:'1216',year:2025,quarter:2});
 const index=fs.readFileSync(stem+'.html','utf8');
 assert.equal(filingVersion(index,'1216',2026,2,'2026-10-01').filename,'202602_1216_AI1.pdf');
 assert.throws(()=>filingVersion(index,'1216',2026,2,'2026-08-06'),'filing must precede the research cutoff');
 const pages=execFileSync('pdftotext',['-layout',stem+'.pdf','-'],{encoding:'utf8'}).split('\f');
 assert.ok(verifyPdfText(pages,row,{filingYear:2026}).length);
 assert.throws(()=>verifyPdfText(pages,{...row,'營業收入':row['營業收入']+1},{filingYear:2026}));
 assert.throws(()=>verifyPdfText(pages,{...row,'淨利（淨損）歸屬於母公司業主':row['本期淨利（淨損）']},{filingYear:2026}));
 assert.throws(()=>verifyPdfText(pages.map(p=>p.replace(/^.*\(二十五\)及七.*$/m,'')),row,{filingYear:2026}),'missing revenue cannot borrow the next account amount');
});
test('staggered comparative headers use their physical column positions and reject missing periods',()=>{
 for(const code of ['3029','6291']){
  const file=fs.readdirSync('history/financial-reports').find(p=>p.startsWith(`202502_${code}_AI1.pdf.`)&&p.endsWith('.pdf'));
  const stem='history/financial-reports/'+file.slice(0,-4),row=parseMopsCompanyHistoricalIncomeHtml(fs.readFileSync(stem+'.income.html','utf8'),{code,year:2025,quarter:2});
  const pages=execFileSync('pdftotext',['-layout',stem+'.pdf','-'],{encoding:'utf8'}).split('\f');
  assert.equal(filingVersion(fs.readFileSync(stem+'.html','utf8'),code,2025,2,'2026-10-01').filename,`202502_${code}_AI1.pdf`);
  assert.ok(verifyPdfText(pages,row).length,code);
  assert.throws(()=>verifyPdfText(pages,{...row,'營業收入':row['營業收入']+1}),code);
  assert.throws(()=>verifyPdfText(pages,{...row,'淨利（淨損）歸屬於母公司業主':row['淨利（淨損）歸屬於母公司業主']+1}),code);
  assert.throws(()=>verifyPdfText(pages.map(p=>p.replace(/113年1月/g,'113年2月')),row),'cannot infer the prior cumulative column without its period');
  assert.throws(()=>verifyPdfText(pages.map(p=>p.replace(/(11[34])年4月/g,(_,y)=>`${y==='114'?'113':'114'}年4月`)),row),'quarter column order must match the cumulative column order');
 }
});
test('coded operating-revenue totals take precedence over gross sales and never change parent-profit checks',()=>{
 for(const code of ['6271','7734','6449']){
  const file=fs.readdirSync('history/financial-reports').find(p=>p.startsWith(`202502_${code}_AI1.pdf.`)&&p.endsWith('.pdf'));
  const stem='history/financial-reports/'+file.slice(0,-4),row=parseMopsCompanyHistoricalIncomeHtml(fs.readFileSync(stem+'.income.html','utf8'),{code,year:2025,quarter:2});
  const pages=execFileSync('pdftotext',['-layout',stem+'.pdf','-'],{encoding:'utf8'}).split('\f');
  assert.ok(verifyPdfText(pages,row).length,code);
  assert.throws(()=>verifyPdfText(pages,{...row,'營業收入':row['營業收入']+1}),code);
  assert.throws(()=>verifyPdfText(pages,{...row,'淨利（淨損）歸屬於母公司業主':row['淨利（淨損）歸屬於母公司業主']+1}),code);
  if(code==='6271')assert.throws(()=>verifyPdfText(pages,{...row,'營業收入':5889411}),'gross sales omit returns and allowances');
 }
});
test('wrapped Chinese footnotes beginning with a word preserve the revenue row without borrowing cost amounts',()=>{
 const file=fs.readdirSync('history/financial-reports').find(p=>p.startsWith('202502_5289_AI1.pdf.')&&p.endsWith('.pdf'));
 const stem='history/financial-reports/'+file.slice(0,-4),row=parseMopsCompanyHistoricalIncomeHtml(fs.readFileSync(stem+'.income.html','utf8'),{code:'5289',year:2025,quarter:2});
 const pages=execFileSync('pdftotext',['-layout',stem+'.pdf','-'],{encoding:'utf8'}).split('\f');
 assert.equal(filingVersion(fs.readFileSync(stem+'.html','utf8'),'5289',2025,2,'2026-10-01').filename,'202502_5289_AI1.pdf');
 assert.ok(verifyPdfText(pages,row).length);
 assert.throws(()=>verifyPdfText(pages,{...row,'營業收入':row['營業收入']+1}));
 assert.throws(()=>verifyPdfText(pages,{...row,'淨利（淨損）歸屬於母公司業主':row['淨利（淨損）歸屬於母公司業主']+1}));
 assert.throws(()=>verifyPdfText(pages.map(p=>p.replace(/^.*七\(二\).*$/m,'')),row),'missing revenue must not borrow the following cost account');
});
test('parent profit disclosed in the dated equity statement verifies without treating total profit as parent profit',()=>{
 for(const code of ['1301','4939','6919','3229','6176','6515','7792','6811']){
  const file=fs.readdirSync('history/financial-reports').find(p=>p.startsWith(`202502_${code}_AI1.pdf.`)&&p.endsWith('.pdf')),stem='history/financial-reports/'+file.slice(0,-4);
  const row=parseMopsCompanyHistoricalIncomeHtml(fs.readFileSync(stem+'.income.html','utf8'),{code,year:2025,quarter:2}),pages=execFileSync('pdftotext',['-layout',stem+'.pdf','-'],{encoding:'utf8'}).split('\f');
  assert.ok(verifyPdfText(pages,row).length,code);
  assert.throws(()=>verifyPdfText(pages,{...row,'淨利（淨損）歸屬於母公司業主':row['淨利（淨損）歸屬於母公司業主']+1}),code);
  assert.throws(()=>verifyPdfText(pages,{...row,'本期淨利（淨損）':row['本期淨利（淨損）']+1}),code);
  assert.throws(()=>verifyPdfText(pages.filter(p=>!p.replace(/\s/g,'').includes('權益變動表')),row),'income total alone does not prove parent attribution');
  assert.throws(()=>verifyPdfText(pages.map(p=>p.replace(/歸屬於(?:母公司|本公司)業主之權益/g,'權益分類')),row),'parent ownership must be explicit in the equity statement');
  if(code==='6176'){
   const eq=page=>page.replace(/\s/g,'').includes('權益變動表');
   assert.throws(()=>verifyPdfText(pages.map(p=>eq(p)?p.replace(/一一四年一月一日/g,'一一四年四月一日'):p),row),'the full current-year January-to-June period must be identified');
   assert.throws(()=>verifyPdfText(pages.map(p=>eq(p)?p.replace(/新台幣千元/g,'新台幣元'):p),row),'the equity amount must use the same filed thousand-dollar unit');
   assert.throws(()=>verifyPdfText(pages.map(p=>eq(p)?p+'非控制權益':p),row),'mixed-owner equity requires a separately identified parent column');
  }
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
test('a pre-cutoff later filing may verify its prior-year comparative column without substituting the current year',()=>{
 const page='合併綜合損益表 新台幣千元 115年4月至6月 114年4月至6月 115年1月至6月 114年1月至6月\n4000 營業收入 10,000 100 11,000 100 20,000 100 22,000 100\n8610 母公司業主 1,000 10 1,100 10 2,000 10 2,200 10',row={'年度':2025,'季別':2,'營業收入':22000,'淨利（淨損）歸屬於母公司業主':2200};
 assert.deepEqual(verifyPdfText([page],row,{filingYear:2026}),[1]);
 assert.throws(()=>verifyPdfText([page],{...row,'營業收入':20000},{filingYear:2026}));assert.throws(()=>verifyPdfText([page],row,{filingYear:2027}));
 const half=page.replace('115年4月至6月 114年4月至6月 ','').replace('10,000 100 11,000 100 ','').replace('1,000 10 1,100 10 ','');assert.deepEqual(verifyPdfText([half],row,{filingYear:2026}),[1]);
});

test('MOPS parent profit labels preserve the ownership basis used by archived PDFs',()=>{
 const html='<tr><th>項目</th><th colspan="2">114年第2季</th><th colspan="2">113年第2季</th><th colspan="2">114年01月01日至114年06月30日</th></tr>'+['營業收入','本期淨利（淨損）','母公司業主（淨利∕損）'].map(label=>`<tr><td>${label}</td><td>1</td><td>1</td><td>2</td><td>2</td><td>3000</td><td>3</td></tr>`).join('');
 assert.equal(parseMopsCompanyHistoricalIncomeHtml(html,{code:'2330',year:2025,quarter:2})['淨利（淨損）歸屬於母公司業主'],3000);
});
test('official half-year and financial-sector subtotal labels preserve cumulative revenue and profit ownership',()=>{
 for(const [code,revenue,profit] of [['1409',20103421,288663],['6005',8442476,2014359],['6620',939799,367419]]){
  const file=fs.readdirSync('history/financial-reports').find(p=>p.startsWith(`202502_${code}_AI1.pdf.`)&&p.endsWith('.income.html')),html=fs.readFileSync('history/financial-reports/'+file,'utf8');
  const row=parseMopsCompanyHistoricalIncomeHtml(html,{code,year:2025,quarter:2});assert.equal(row['營業收入'],revenue);assert.equal(row['淨利（淨損）歸屬於母公司業主'],profit);
  assert.throws(()=>parseMopsCompanyHistoricalIncomeHtml(html,{code,year:2026,quarter:2}));assert.throws(()=>parseMopsCompanyHistoricalIncomeHtml(html,{code,year:2025,quarter:1}));
 }
 const html='<tr><th>項目</th><th>114年01月01日至114年06月30日</th></tr><tr><td>收入合計</td><td>1000</td></tr><tr><td>本期淨利（淨損）</td><td>100</td></tr><tr><td>綜合損益總額歸屬於：</td></tr><tr><td>母公司業主</td><td>300</td></tr>';
 assert.equal(parseMopsCompanyHistoricalIncomeHtml(html,{code:'1409',year:2025,quarter:2})['淨利（淨損）歸屬於母公司業主'],undefined);
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
 const version={parserVersion:2,reason:'FILING_VERSION_UNVERIFIED',nextRetryAt:'2026-10-02T08:00:00Z'};
 assert.deepEqual(financialQueue([{key:'old'},{key:'current'}],{old:version,current:{...version,filingParserVersion:3}},now,new Set()).map(r=>r.key),['old']);
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
 assert.deepEqual(pdfReviewPages(['目錄','資產負債表','合併綜合損益表 金額\n4000 營業收入','續表','附註'],5),[3,4]);
 assert.deepEqual(pdfReviewPages(['','',''],3),[1,2,3]);
 assert.ok(pdfReviewPages(['目錄\n合併綜合損益表 8\n合併現金流量表','會計師核閱報告提及綜合損益表與現金流量',''],12).includes(8));
 const now=new Date('2026-10-02T01:00:00Z'),state={old:{parserVersion:2,textParserVersion:19,nextRetryAt:'2026-10-03T01:00:00Z'},current:{parserVersion:2,textParserVersion:20,nextRetryAt:'2026-10-03T01:00:00Z'}};
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
test('collection recovers through a cached dated comparative PDF before network reads without changing the requested period',async()=>{
 const {collectFinancialPdfs}=await import('./collect-financial-pdfs.mjs'),{default:os}=await import('node:os'),{default:path}=await import('node:path');
 const original=process.cwd(),fetcher=globalThis.fetch,spacing=process.env.FINANCIAL_REQUEST_SPACING_MS,tmp=fs.mkdtempSync(path.join(os.tmpdir(),'financial-comparative-')),file=fs.readdirSync('history/financial-reports').find(f=>f.startsWith('202502_6239_AI1.pdf.')&&f.endsWith('.pdf')),stem=file.slice(0,-4);let requests=0;
 try{
  fs.mkdirSync(path.join(tmp,'history/financial-reports'),{recursive:true});for(const suffix of ['.pdf','.html','.income.html'])fs.copyFileSync('history/financial-reports/'+stem+suffix,path.join(tmp,'history/financial-reports/'+stem+suffix));
  process.chdir(tmp);fs.mkdirSync('raw/2025-09-30',{recursive:true});
  fs.writeFileSync('raw/2025-09-30/research-input.json',JSON.stringify({deepDive:[{code:'6239',assetType:'STOCK',current:{market:'TWSE'}}]}));fs.writeFileSync('raw/2025-09-30/financial-evidence-captures.json',JSON.stringify({captures:[{id:'income',kind:'income',status:'CAPTURED'}]}));
  fs.writeFileSync('raw/2025-09-30/income.raw.txt',JSON.stringify([{'公司代號':'6239','年度':2025,'季別':2,'淨利（淨損）歸屬於母公司業主':100}]));
  globalThis.fetch=async url=>{requests++;assert.equal(new URL(url).searchParams.get('year'),'113');return new Response('<html>Filing version unverified</html>');};process.env.FINANCIAL_REQUEST_SPACING_MS='0';
  await assert.rejects(()=>collectFinancialPdfs('2025-09-30',{onVerified:()=>{throw Error('screening failed');}}),/screening failed/);
  assert.equal(JSON.parse(fs.readFileSync('history/financial-pdf-collection.json'))['6239|2025-06-30'].status,'VERIFIED','downstream failures must preserve official verification');
  await collectFinancialPdfs('2025-09-30',{onVerified:()=>assert.fail('already admitted evidence must not retrigger')});const [report]=JSON.parse(fs.readFileSync('history/reviewed-financial-reports.json'));
  assert.equal(requests,0);assert.equal(report.filingYear,2025);assert.equal(report.row['年度'],2024);assert.equal(report.row['營業收入'],37915361);assert.equal(report.row['淨利（淨損）歸屬於母公司業主'],3564919);assert.equal(new URL(report.source).searchParams.get('year'),'114');assert.equal(JSON.parse(fs.readFileSync('raw/2025-09-30/financial-pdf-collection.json')).remaining,0);
 }finally{globalThis.fetch=fetcher;if(spacing===undefined)delete process.env.FINANCIAL_REQUEST_SPACING_MS;else process.env.FINANCIAL_REQUEST_SPACING_MS=spacing;process.chdir(original);fs.rmSync(tmp,{recursive:true,force:true});}
});
test('individual sales and uncoded net profit preserve the official TOTAL labels and exact amounts',()=>{
 for(const code of ['6530','8086']){
  const file=fs.readdirSync('history/financial-reports').find(p=>p.startsWith(`202502_${code}_AI2.pdf.`)&&p.endsWith('.pdf')),stem='history/financial-reports/'+file.slice(0,-4);
  const row=parseMopsCompanyHistoricalIncomeHtml(fs.readFileSync(stem+'.income.html','utf8'),{code,year:2025,quarter:2}),pages=execFileSync('pdftotext',['-layout',stem+'.pdf','-'],{encoding:'utf8'}).split('\f');
  assert.equal(row['淨利（淨損）歸屬於母公司業主'],undefined,code);assert.ok(verifyPdfText(pages,row).length,code);
  assert.throws(()=>verifyPdfText(pages,{...row,'營業收入':row['營業收入']+1}),code);assert.throws(()=>verifyPdfText(pages,{...row,'本期淨利（淨損）':row['本期淨利（淨損）']+1}),code);
 }
});
test('an official individual filing verifies TOTAL income without manufacturing PARENT profit or fetching during an outage',async()=>{
 const {collectFinancialPdfs}=await import('./collect-financial-pdfs.mjs'),{reviewedFinancialReport}=await import('./research-evidence.mjs'),{default:os}=await import('node:os'),{default:path}=await import('node:path');
 const original=process.cwd(),fetcher=globalThis.fetch,spacing=process.env.FINANCIAL_REQUEST_SPACING_MS,tmp=fs.mkdtempSync(path.join(os.tmpdir(),'financial-individual-')),file=fs.readdirSync('history/financial-reports').find(f=>f.startsWith('202502_2633_AI2.pdf.')&&f.endsWith('.pdf')),stem=file.slice(0,-4);let requests=0;
 try{
  const html=fs.readFileSync('history/financial-reports/'+stem+'.html','utf8');
  assert.equal(filingVersion(html,'2633',2025,2,'2026-10-01',{profitBasis:'TOTAL'}).filename,'202502_2633_AI2.pdf');
  assert.throws(()=>filingVersion(html,'2633',2025,2,'2026-10-01'));
  assert.throws(()=>filingVersion(html.replaceAll('_AI2.pdf','_AI1.pdf').replaceAll('IFRSs個別財報','IFRSs合併財報').replaceAll('>無<','>已更正<')+html,'2633',2025,2,'2026-10-01',{profitBasis:'TOTAL'}));
  fs.mkdirSync(path.join(tmp,'history/financial-reports'),{recursive:true});for(const suffix of ['.pdf','.html','.income.html'])fs.copyFileSync('history/financial-reports/'+stem+suffix,path.join(tmp,'history/financial-reports/'+stem+suffix));
  process.chdir(tmp);fs.mkdirSync('raw/2026-10-01',{recursive:true});
  fs.writeFileSync('raw/2026-10-01/research-input.json',JSON.stringify({deepDive:[{code:'2633',assetType:'STOCK',current:{market:'TWSE'}}]}));fs.writeFileSync('raw/2026-10-01/financial-evidence-captures.json',JSON.stringify({captures:[{id:'income',kind:'income',status:'CAPTURED'}]}));
  fs.writeFileSync('raw/2026-10-01/income.raw.txt',JSON.stringify([{'公司代號':'2633','年度':2026,'季別':2,'本期淨利（淨損）':100}]));
  globalThis.fetch=async()=>{requests++;throw Error('OFFICIAL_RATE_LIMITED');};process.env.FINANCIAL_REQUEST_SPACING_MS='0';
  await collectFinancialPdfs('2026-10-01');const [report]=JSON.parse(fs.readFileSync('history/reviewed-financial-reports.json'));
  assert.equal(requests,0);assert.equal(reviewedFinancialReport(report,'2026-10-01').profitBasis,'TOTAL');assert.equal(report.row['營業收入'],26734525);assert.equal(report.row['本期淨利（淨損）'],3488965);assert.equal(report.row['淨利（淨損）歸屬於母公司業主'],undefined);
  assert.equal(reviewedFinancialReport(report,'2025-08-10'),null);assert.equal(reviewedFinancialReport({...report,row:{...report.row,'淨利（淨損）歸屬於母公司業主':3488965}},'2026-10-01'),null);
  const pages=execFileSync('pdftotext',['-layout','history/financial-reports/'+stem+'.pdf','-'],{encoding:'utf8'}).split('\f');
  assert.throws(()=>verifyPdfText(pages,{...report.row,'本期淨利（淨損）':3488966}));assert.throws(()=>verifyPdfText(pages,{...report.row,'淨利（淨損）歸屬於母公司業主':3488965}));
  assert.equal(JSON.parse(fs.readFileSync('raw/2026-10-01/financial-pdf-collection.json')).remaining,0);
  const table='history/financial-reports/'+stem+'.income.html';fs.writeFileSync(table,fs.readFileSync(table,'utf8').replace('個別綜合損益表','合併綜合損益表'));assert.equal(reviewedFinancialReport(report,'2026-10-01'),null);
 }finally{globalThis.fetch=fetcher;if(spacing===undefined)delete process.env.FINANCIAL_REQUEST_SPACING_MS;else process.env.FINANCIAL_REQUEST_SPACING_MS=spacing;process.chdir(original);fs.rmSync(tmp,{recursive:true,force:true});}
});

test('dated cached comparative resolves an inconsistent historical table without retrying requests or erasing failed evidence',async()=>{
 const {collectFinancialPdfs}=await import('./collect-financial-pdfs.mjs'),{reviewedFinancialReport}=await import('./research-evidence.mjs'),{default:os}=await import('node:os'),{default:path}=await import('node:path');
 const original=process.cwd(),fetcher=globalThis.fetch,spacing=process.env.FINANCIAL_REQUEST_SPACING_MS,tmp=fs.mkdtempSync(path.join(os.tmpdir(),'financial-conflict-')),files=fs.readdirSync('history/financial-reports').filter(f=>/202[56]02_2436_AI1/.test(f)&&f.endsWith('.pdf'));let requests=0;
 const failed={status:'UNVERIFIED',parserVersion:2,textParserVersion:14,stage:'PDF_METRICS',reason:'PDF_PERIOD_METRICS_OR_PROFIT_BASIS_UNVERIFIED',nextRetryAt:'2099-01-01T00:00:00Z'};
 try{
  assert.equal(files.length,2);fs.mkdirSync(path.join(tmp,'history/financial-reports'),{recursive:true});
  for(const file of files)for(const suffix of ['.pdf','.html','.income.html'])fs.copyFileSync('history/financial-reports/'+file.slice(0,-4)+suffix,path.join(tmp,'history/financial-reports/'+file.slice(0,-4)+suffix));
  process.chdir(tmp);fs.mkdirSync('raw/2026-10-01',{recursive:true});
  fs.writeFileSync('history/financial-pdf-collection.json',JSON.stringify({'2436|2026-06-30':failed}));
  fs.writeFileSync('raw/2026-10-01/research-input.json',JSON.stringify({deepDive:[{code:'2436',assetType:'STOCK',current:{market:'TWSE'}}]}));
  fs.writeFileSync('raw/2026-10-01/financial-evidence-captures.json',JSON.stringify({captures:[{id:'income',kind:'income',status:'CAPTURED'}]}));
  fs.writeFileSync('raw/2026-10-01/income.raw.txt',JSON.stringify([{'公司代號':'2436','年度':2026,'季別':2,'淨利（淨損）歸屬於母公司業主':100}]));
  globalThis.fetch=async()=>{requests++;throw Error('OFFICIAL_RATE_LIMITED');};process.env.FINANCIAL_REQUEST_SPACING_MS='0';
  let screenings=0;
  const onVerified=({code})=>{assert.equal(code,'2436');assert.equal(JSON.parse(fs.readFileSync('history/financial-pdf-collection.json'))['2436|2026-06-30'].status,'VERIFIED');screenings++;};
  await collectFinancialPdfs('2026-10-01',{onVerified});assert.equal(screenings,1,'each newly verified stock triggers screening after durable evidence');
  await collectFinancialPdfs('2026-10-01',{onVerified});assert.equal(screenings,1,'reused evidence must not repeatedly trigger screening');
  assert.equal(JSON.parse(fs.readFileSync('raw/2026-10-01/financial-pdf-collection.json')).remaining,0);
  const [report]=JSON.parse(fs.readFileSync('history/reviewed-financial-reports.json'));
  assert.equal(requests,0);assert.equal(report.filingYear,2026);assert.equal(report.row['年度'],2025);assert.equal(report.row['淨利（淨損）歸屬於母公司業主'],50234);assert.equal(reviewedFinancialReport(report,'2026-10-01').profitBasis,'PARENT');assert.equal(reviewedFinancialReport(report,'2026-08-09'),null);
  assert.deepEqual(JSON.parse(fs.readFileSync('history/financial-pdf-collection.json'))['2436|2026-06-30'].lastUnverifiedAttempt,failed);
  const old=files.find(f=>f.startsWith('202502'));assert.equal(parseMopsCompanyHistoricalIncomeHtml(fs.readFileSync('history/financial-reports/'+old.slice(0,-4)+'.income.html','utf8'),{code:'2436',year:2025,quarter:2})['淨利（淨損）歸屬於母公司業主'],52234);
 }finally{globalThis.fetch=fetcher;if(spacing===undefined)delete process.env.FINANCIAL_REQUEST_SPACING_MS;else process.env.FINANCIAL_REQUEST_SPACING_MS=spacing;process.chdir(original);fs.rmSync(tmp,{recursive:true,force:true});}
});

test('stamped filed income tables retain split date headers and coded ownership without borrowing another period',()=>{
 const page=fs.readFileSync('scripts/fixtures/1319-income-ocr.txt','utf8'),file=fs.readdirSync('history/financial-reports').find(f=>f.startsWith('202502_1319_AI1.pdf.')&&f.endsWith('.income.html'));
 const row=parseMopsCompanyHistoricalIncomeHtml(fs.readFileSync('history/financial-reports/'+file,'utf8'),{code:'1319',year:2025,quarter:2});
 assert.deepEqual(verifyPdfText([page],row),[1]);
 for(const changed of [{...row,'營業收入':row['營業收入']+1},{...row,'淨利（淨損）歸屬於母公司業主':row['本期淨利（淨損）']},{...row,'年度':2024}])assert.throws(()=>verifyPdfText([page],changed));
 assert.throws(()=>verifyPdfText([page.replaceAll('一一三年一月一日至','一一四年一月一日至')],row));
 assert.throws(()=>verifyPdfText([page.replaceAll('六月三十日','九月三十日')],row));
 let ends=0;assert.throws(()=>verifyPdfText([page.replace(/六月三十日/g,s=>++ends===3?'九月三十日':s)],row),'the selected cumulative column must retain its own end date');
 assert.throws(()=>verifyPdfText([page.replace(/^8610.*$/m,'')],row));
 assert.throws(()=>verifyPdfText([page.replace('新台幣仟元','新台幣元')],row));
});

test('improved OCR reparses version 19 archives before their cooldown while version 20 waits',async()=>{
 const {financialQueue}=await import('./collect-financial-pdfs.mjs'),rows=[{key:'old',archived:true},{key:'current',archived:true}],now=new Date('2026-10-06T00:00:00Z');
 const state={old:{parserVersion:2,textParserVersion:19,nextRetryAt:'2099-01-01'},current:{parserVersion:2,textParserVersion:20,nextRetryAt:'2099-01-01'}};
 assert.deepEqual(financialQueue(rows,state,now,new Set()).map(r=>r.key),['old']);
});
