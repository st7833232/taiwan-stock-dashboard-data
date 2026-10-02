import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {resolveCaptureTargetDate} from './resolve-capture-target-date.mjs';
import {inputFingerprint} from './screen-market.mjs';

const read=p=>{try{return JSON.parse(fs.readFileSync(p,'utf8'));}catch{return null;}};
export function resolvePipelineTarget(explicit,now=new Date()){
  if(explicit)return explicit;
  const ready=resolveCaptureTargetDate({now}),manifest=read('manifest.json'),target=read(manifest?.researchPath)?.researchDate,report=target?read(`raw/${target}/daily-report.json`):null;
  return target<=ready&&read(manifest?.paperAccountPath)?.asOf===target&&report?.targetDate===target&&report.screeningComplete===true&&report.researchComplete===false&&report.validation?.status==='PASS'?target:ready;
}
export function completionCurrent({target,config,manifest,research,paper,history,input,state}) {
  const paths=[manifest?.researchPath,manifest?.selectionHistoryPath,manifest?.paperAccountPath];
  return Boolean(manifest?.revision&&paths.every(p=>p?.startsWith(`snapshots/${manifest.revision}/`))
    && research?.researchDate===target&&paper?.asOf===target&&research?.strategyVersion===config?.version
    && Array.isArray(history)&&history.filter(h=>h.date===target).length===1
    && state?.targetDate===target&&state?.gateStatus==='PASS'&&state?.publicationComplete===true
    && research?.researchComplete===true&&research?.creditEvidenceComplete===true
    && input?.targetDate===target&&research.inputFingerprint===inputFingerprint(input,config));
}
export function recoveryTargets(target,paper) {
  // Resolve unprocessed pre-existing order dates first; never infer old fills from today's prices.
  return [...new Set((paper.nextOrders??[]).map(o=>o.tradingDate).filter(d=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&d>paper.asOf&&d<target).concat(target))].sort();
}
export function isFutureAfterCloseTarget(target,now=new Date()) {
  const ready=resolveCaptureTargetDate({now});
  return target>ready;
}
export function runPipeline(target=resolveCaptureTargetDate(),{execute=execFileSync,now=new Date()}={}) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(target)||Number.isNaN(Date.parse(target))||new Date(target).toISOString().slice(0,10)!==target||isFutureAfterCloseTarget(target,now))throw Error('Target must be a closed Taipei market weekday, never an unfinished daily candle');
  fs.readFileSync('DAILY_UPDATE_PROTOCOL.md','utf8');
  const initial=read('manifest.json'),initialPaper=read(initial?.paperAccountPath);
  if(!initialPaper)throw Error('Existing paper account is unreadable');
  const run=(script,{retry=false,pending=false}={})=>{
    let error;
    for(let attempt=0;attempt<(retry?2:1);attempt++)try{return execute(process.execPath,[script],{stdio:'inherit',timeout:12*60*1000,env:{...process.env,TARGET_DATE:process.env.TARGET_DATE,...(pending?{VALIDATE_PENDING:'1'}:{})}});}catch(e){error=e;console.error(`Stage failed: ${script}; attempt ${attempt+1}`);}
    throw error;
  };
  const validate=pending=>{for(const s of ['validate-data','validate-dashboard-contract','validate-strategy-v2'])run(`scripts/${s}.mjs`,{pending});};
  for(const day of recoveryTargets(target,initialPaper)) {
    process.env.TARGET_DATE=day;
    const root=`raw/${day}`;fs.mkdirSync(root,{recursive:true});
    const manifest=read('manifest.json'),research=read(manifest?.researchPath),paper=read(manifest?.paperAccountPath),history=read(manifest?.selectionHistoryPath),input=read(`${root}/research-input.json`),config=read('strategy-config.json'),state=read(`${root}/publication-state.json`);
    if(paper?.asOf>day)throw Error('Historical target cannot rewind the published account');
    // Full completion is checked before any market requests. Partial checkpoints never short-circuit evidence retries.
    if(completionCurrent({target:day,config,manifest,research,paper,history,input,state})) {validate(false);console.log(`NO_CHANGE ${day}: complete and current`);continue;}
    const status={targetDate:day,runId:process.env.GITHUB_RUN_ID??null,runUrl:process.env.GITHUB_RUN_ID?`https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`:null,stage:'CAPTURE',researchComplete:false};
    const save=()=>fs.writeFileSync(`${root}/pipeline-status.json`,JSON.stringify(status,null,2)+'\n');
    try {
      const priorPending=read(`${root}/evidence-pending.json`);
      let gate=read(`${root}/gate-matrix.json`);
      const reusableDailyCapture=gate?.overallStatus==='PASS'&&input?.targetDate===day;
      const retryCredit=!priorPending||Number(priorPending?.counts?.credit??0)>0;
      if(!reusableDailyCapture||retryCredit) {
        run('scripts/fetch-official-market-data.mjs',{retry:true});
        gate=read(`${root}/gate-matrix.json`);
      } else {
        console.log(`PENDING_ONLY ${day}: reuse PASS daily capture`);
      }
      if(gate?.overallStatus!=='PASS') {
        run('scripts/check-daily-publication.mjs');status.stage='WAITING_OFFICIAL_VERIFICATION';status.gateStatus=gate?.overallStatus??'VERIFY_FAILED';status.retryPolicy='AUTOMATIC_NEXT_SCHEDULE';save();
        run('scripts/publish-data-atomic.mjs');
        // An old order still lacks official candles. Do not skip ahead and expire it without those candles.
        break;
      }
      if(!reusableDailyCapture||retryCredit) {status.stage='INPUT';run('scripts/summarize-official-market-data.mjs');}
      if(!priorPending||Number(priorPending?.counts?.history??0)>0) {
        status.stage='HISTORY';run('scripts/backfill-v2-market-history.mjs',{retry:true});
        status.stage='INPUT';run('scripts/summarize-official-market-data.mjs');
      } else {
        console.log(`PENDING_ONLY ${day}: history complete, skip backfill`);
      }
      status.stage='EVIDENCE';
      // Evidence collectors are incremental. Keep financial/credit retries active while pending;
      // skip TDCC only when the prior checkpoint proves it is already complete.
      run('scripts/collect-research-evidence.mjs',{retry:true});
      if(!priorPending||Number(priorPending?.counts?.fundamental??0)>0)run('scripts/collect-financial-pdfs.mjs');
      if(!priorPending||Number(priorPending?.counts?.tdcc??0)>0)run('scripts/collect-tdcc-history.mjs',{retry:true});
      run('scripts/research-evidence.mjs');
      run('scripts/check-daily-publication.mjs');
      status.stage='SCREENING';run('scripts/screen-market.mjs');
      status.stage='PREPUBLICATION_VALIDATION';validate(true);run('scripts/check-daily-publication.mjs');
      const next=read('manifest.json'),report=read(`${root}/daily-report.json`);
      status.revision=next.revision;status.researchComplete=report?.researchComplete===true;status.evidencePending=report?.evidencePending??null;status.stage='PREPUBLICATION_VALIDATED';status.retryPolicy=status.researchComplete?'STOP_AFTER_SUCCESS':'AUTOMATIC_NEXT_SCHEDULE';save();
      run('scripts/publish-data-atomic.mjs');
      execute('git',['fetch','origin','main'],{stdio:'inherit'});execute('git',['reset','--hard','origin/main'],{stdio:'inherit'});
      status.stage='POSTPUBLICATION_VALIDATION';validate(false);
      const live=read('manifest.json');
      if(live.revision!==next.revision)throw Error('MAIN_HEAD_CHANGED: validate the latest checkpoint on next automatic run');
      status.stage='VALIDATION_PASS';status.validatedCommit=execute('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();status.validation={status:'PASS',validators:['validate-data','validate-dashboard-contract','validate-strategy-v2'],revision:live.revision};save();
      const liveReport=read(`${root}/daily-report.json`);if(liveReport){liveReport.validation={...status.validation,runId:status.runId,runUrl:status.runUrl,validatedCommit:status.validatedCommit};fs.writeFileSync(`${root}/daily-report.json`,JSON.stringify(liveReport,null,2)+'\n');}
      // A raw-only validation receipt follows the atomic snapshot commit; immutable snapshots are never rewritten.
      run('scripts/publish-data-atomic.mjs');
      execute('git',['fetch','origin','main'],{stdio:'inherit'});execute('git',['reset','--hard','origin/main'],{stdio:'inherit'});
      console.log(JSON.stringify(status));
    }catch(error){status.failedStage=status.stage;status.stage='RECOVERY_PENDING';status.error=String(error.message);status.retryPolicy='AUTOMATIC_NEXT_SCHEDULE';save();throw error;}
    finally{if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,`\n## ${day}\n\n- Pipeline: ${status.stage}\n- Research complete: ${status.researchComplete}\n- Retry: ${status.retryPolicy}\n- Revision: ${status.revision??'unchanged'}\n- Pending evidence: ${JSON.stringify(status.evidencePending??{})}\n`);}
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)runPipeline(resolvePipelineTarget(process.env.TARGET_DATE));
