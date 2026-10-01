import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
export function shouldContinueFinancial(collection,report,runId,count){
 // ponytail: cap one chain at 40 runs; regular schedules resume any remaining work without an endless retry loop.
 return Boolean(Number.isInteger(count)&&count>=0&&count<40&&runId&&collection?.targetDate===report?.targetDate&&collection?.continuationNeeded===true&&collection?.rateLimited!==true&&collection?.ready>0&&report?.researchComplete!==true&&report?.evidencePending?.fundamental>0&&report?.validation?.status==='PASS'&&report.validation.runId===runId);
}
export async function continueFinancialEvidence(){
 const read=p=>JSON.parse(fs.readFileSync(p,'utf8')),manifest=read('manifest.json'),target=read(manifest.researchPath).researchDate,root=`raw/${target}`,collection=read(`${root}/financial-pdf-collection.json`),report=read(`${root}/daily-report.json`),count=Number(process.env.FINANCIAL_CONTINUATION||0);
 if(!shouldContinueFinancial(collection,report,process.env.GITHUB_RUN_ID,count)){console.log(JSON.stringify({financialContinuation:'NOT_REQUIRED',ready:collection.ready,chain:count}));return;}
 const repo=process.env.GITHUB_REPOSITORY;
 if(!/^[\w.-]+\/[\w.-]+$/.test(repo??'')||!process.env.GITHUB_TOKEN)throw Error('Financial continuation GitHub identity or token missing');
 // Let the existing resolver choose the latest closed market date; never queue a historical account rewind.
 const res=await fetch(`https://api.github.com/repos/${repo}/actions/workflows/capture-official-market-data.yml/dispatches`,{method:'POST',headers:{accept:'application/vnd.github+json',authorization:`Bearer ${process.env.GITHUB_TOKEN}`,'content-type':'application/json','x-github-api-version':'2022-11-28'},body:JSON.stringify({ref:'main',inputs:{financial_continuation:String(count+1)}}),signal:AbortSignal.timeout(30000)});
 if(!res.ok)throw Error(`Financial continuation dispatch failed: HTTP_${res.status}`);
 console.log(JSON.stringify({financialContinuation:'DISPATCHED',ready:collection.ready,chain:count+1}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await continueFinancialEvidence();
