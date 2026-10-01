import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
const read=p=>{try{return JSON.parse(fs.readFileSync(p,'utf8'));}catch{return null;}};
export function recoveryDecision({report,status,count,max=12}) {
  if(!Number.isInteger(count)||count<0||count>=max)return {dispatch:false,reason:'RECOVERY_LIMIT'};
  if(report?.researchComplete===true&&report?.validation?.status==='PASS')return {dispatch:false,reason:'COMPLETE'};
  const error=String(status?.error??'');
  const recoverable=/HTTP (429|5\d\d)|timeout|timed out|ECONNRESET|ETIMEDOUT|EAI_AGAIN|MAIN_HEAD_CHANGED|fetch failed|socket/i.test(error);
  const pending=report?.validation?.status==='PASS'&&report?.researchComplete!==true;
  if(recoverable||pending)return {dispatch:true,reason:recoverable?'RECOVERABLE_FAILURE':'EVIDENCE_PENDING'};
  return {dispatch:false,reason:error?'NON_RECOVERABLE_FAILURE':'NO_ACTIONABLE_STATE'};
}
export async function continuePipelineRecovery(){
  const manifest=read('manifest.json'),research=read(manifest?.researchPath),target=research?.researchDate;
  if(!target)throw Error('Cannot resolve recovery target from manifest');
  const root=`raw/${target}`,report=read(`${root}/daily-report.json`),status=read(`${root}/pipeline-status.json`);
  const count=Number(process.env.RECOVERY_COUNT||0),decision=recoveryDecision({report,status,count});
  if(!decision.dispatch){console.log(JSON.stringify({selfHealing:'STOP',reason:decision.reason,chain:count,target}));return;}
  const repo=process.env.GITHUB_REPOSITORY,token=process.env.GITHUB_TOKEN;
  if(!/^[\w.-]+\/[\w.-]+$/.test(repo??'')||!token)throw Error('Self-healing GitHub identity or token missing');
  const body={ref:'main',inputs:{target_date:target,recovery_count:String(count+1)}};
  let last;
  for(let attempt=0;attempt<5;attempt++){
    try{
      const res=await fetch(`https://api.github.com/repos/${repo}/actions/workflows/capture-official-market-data.yml/dispatches`,{method:'POST',headers:{accept:'application/vnd.github+json',authorization:`Bearer ${token}`,'content-type':'application/json','x-github-api-version':'2022-11-28'},body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
      if(res.ok){console.log(JSON.stringify({selfHealing:'DISPATCHED',reason:decision.reason,chain:count+1,target}));return;}
      last=Error(`Self-healing dispatch failed: HTTP_${res.status}`);
      if(![429,500,502,503,504].includes(res.status))throw last;
    }catch(e){last=e;if(attempt===4)break;}
    await new Promise(r=>setTimeout(r,Math.min(1000*2**attempt,16000)));
  }
  throw last;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await continuePipelineRecovery();
