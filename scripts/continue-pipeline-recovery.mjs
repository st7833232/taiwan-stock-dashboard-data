import fs from 'node:fs';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {shouldContinueFinancial} from './continue-financial-evidence.mjs';
import {resolvePipelineTarget} from './run-daily-pipeline.mjs';
const read=p=>{try{return JSON.parse(fs.readFileSync(p,'utf8'));}catch{return null;}};
export function classifyRecoveryError(error) {
  const message=String(error??'').trim();
  if(!message)return {kind:'NONE',recoverable:false,signature:null};
  const normalized=message
    .replace(/https:\/\/github\.com\/[^\s]+\/actions\/runs\/\d+/g,'<RUN_URL>')
    .replace(/\b[0-9a-f]{40}\b/gi,'<SHA>')
    .replace(/\b\d{8,}\b/g,'<ID>')
    .replace(/\s+/g,' ')
    .trim();
  const recoverable=/HTTP[_ ](?:429|5\d\d)|timeout|timed out|ECONNRESET|ETIMEDOUT|EAI_AGAIN|MAIN_HEAD_CHANGED|fetch failed|socket hang up|network/i.test(message);
  const deterministic=/VALIDATION FAILED|validate-[\w-]+\.mjs|AssertionError|SyntaxError|ReferenceError|TypeError|logic invariant|ERR_ASSERTION|schema|contract/i.test(message);
  return {
    kind:deterministic?'CODE_OR_VALIDATION':recoverable?'TRANSIENT':'UNKNOWN_FATAL',
    recoverable:recoverable&&!deterministic,
    signature:crypto.createHash('sha256').update(normalized).digest('hex').slice(0,16)
  };
}

export function recoveryDecision({report,status,count,max=12,collection,runId,progress=false,stagnant=0}) {
  if(report?.researchComplete===true&&report?.validation?.status==='PASS')return {dispatch:false,reason:'COMPLETE'};
  const error=String(status?.error??'').trim();
  if(error){
    const classified=classifyRecoveryError(error);
    if(!classified.recoverable)return {dispatch:false,reason:'NON_RECOVERABLE_FAILURE'};
    if(!Number.isInteger(count)||count<0||count>=max)return {dispatch:false,reason:'RECOVERY_LIMIT'};
    return {dispatch:true,reason:'RECOVERABLE_FAILURE'};
  }
  if(stagnant>=3)return {dispatch:false,reason:collection?.rateLimited===true||collection?.ready===0&&collection?.remaining>0?'EVIDENCE_RETRY_COOLDOWN':'UNCHANGED_EVIDENCE'};
  if(count>=max&&progress&&report?.validation?.status==='PASS'&&Object.values(report?.evidencePending??{}).some(n=>n>0))return {dispatch:true,reason:'NEW_EVIDENCE_CHAIN',nextCount:0};
  if(shouldContinueFinancial(collection,report,runId,count))return {dispatch:true,reason:'FINANCIAL_WORK_READY'};
  if(!Number.isInteger(count)||count<0||count>=max)return {dispatch:false,reason:'RECOVERY_LIMIT'};
  const pending=report?.validation?.status==='PASS'&&report?.researchComplete!==true;
  if(pending)return {dispatch:true,reason:'EVIDENCE_PENDING'};
  return {dispatch:false,reason:'NO_ACTIONABLE_STATE'};
}
export async function continuePipelineRecovery(){
  if(process.env.TEST_OUTCOME==='failure'||process.env.CAPTURE_OUTCOME==='skipped'){console.log(JSON.stringify({selfHealing:'STOP',reason:'PRECONDITION_FAILED'}));return;}
  const target=resolvePipelineTarget(process.env.TARGET_DATE);
  if(!target)throw Error('Cannot resolve recovery target from manifest');
  const root=`raw/${target}`,report=read(`${root}/daily-report.json`),status=read(`${root}/pipeline-status.json`);
  const collection=read(`${root}/financial-pdf-collection.json`);
  // Fingerprint admitted/pending evidence, never attempt timestamps or publication revisions.
  const pending=read(`${root}/evidence-pending.json`);
  const fingerprint=crypto.createHash('sha256').update(JSON.stringify({target,pending:pending?.pending??report?.evidencePending,ranked:report?.incrementalScreening?.researchRanked,ocrProgress:collection?.ocrProgress})).digest('hex').slice(0,16);
  const progress=fingerprint!==process.env.RECOVERY_EVIDENCE_SIGNATURE;
  const stagnant=progress?0:Number(process.env.RECOVERY_STAGNANT_COUNT||0)+1;
  const count=Number(process.env.RECOVERY_COUNT||0),decision=recoveryDecision({report,status,count,collection,runId:process.env.GITHUB_RUN_ID,progress,stagnant});
  const classified=classifyRecoveryError(status?.error);
  const previousSignature=String(process.env.RECOVERY_ERROR_SIGNATURE||'');
  const previousRepeat=Number(process.env.RECOVERY_ERROR_COUNT||0);
  const repeated=classified.signature&&classified.signature===previousSignature?previousRepeat+1:classified.signature?1:0;
  if(decision.dispatch&&decision.reason==='RECOVERABLE_FAILURE'&&repeated>=3){
    console.log(JSON.stringify({selfHealing:'STOP',reason:'REPEATED_RECOVERABLE_ERROR',errorKind:classified.kind,errorSignature:classified.signature,errorRepeat:repeated,chain:count,target}));
    return;
  }
  if(!decision.dispatch){
    console.log(JSON.stringify({selfHealing:'STOP',reason:decision.reason,errorKind:classified.kind,errorSignature:classified.signature,errorRepeat:repeated,chain:count,target}));
    return;
  }
  const repo=process.env.GITHUB_REPOSITORY,token=process.env.GITHUB_TOKEN;
  if(!/^[\w.-]+\/[\w.-]+$/.test(repo??'')||!token)throw Error('Self-healing GitHub identity or token missing');
  const body={ref:'main',inputs:{
    target_date:target,
    recovery_count:String(decision.nextCount??count+1),
    recovery_evidence_signature:fingerprint,
    recovery_stagnant_count:String(stagnant),
    recovery_error_signature:decision.reason==='RECOVERABLE_FAILURE'?(classified.signature??''):'',
    recovery_error_count:decision.reason==='RECOVERABLE_FAILURE'?String(repeated):'0'
  }};
  let last;
  for(let attempt=0;attempt<5;attempt++){
    try{
      const res=await fetch(`https://api.github.com/repos/${repo}/actions/workflows/capture-official-market-data.yml/dispatches`,{method:'POST',headers:{accept:'application/vnd.github+json',authorization:`Bearer ${token}`,'content-type':'application/json','x-github-api-version':'2022-11-28'},body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
      if(res.ok){console.log(JSON.stringify({selfHealing:'DISPATCHED',reason:decision.reason,errorKind:classified.kind,errorSignature:classified.signature,errorRepeat:repeated,chain:decision.nextCount??count+1,stagnant,target}));return;}
      last=Error(`Self-healing dispatch failed: HTTP_${res.status}`);
      if(![429,500,502,503,504].includes(res.status))throw last;
    }catch(e){last=e;if(attempt===4)break;}
    await new Promise(r=>setTimeout(r,Math.min(1000*2**attempt,16000)));
  }
  throw last;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await continuePipelineRecovery();
