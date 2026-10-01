import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parseMopsCompanyHistoricalIncomeHtml} from './collect-research-evidence.mjs';
import {filingVersion,verifyPdfText,requestOfficial} from './collect-financial-pdfs.mjs';
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

test('an official query-limit page is never retried as a transport failure',async()=>{
 let calls=0;await assert.rejects(()=>requestOfficial('https://doc.twse.com.tw/',null,{pause:async()=>{},fetcher:async()=>{calls++;return new Response(Buffer.from('ac64b8dfb94cb671','hex'));}}),/OFFICIAL_RATE_LIMITED/);assert.equal(calls,1);
});
