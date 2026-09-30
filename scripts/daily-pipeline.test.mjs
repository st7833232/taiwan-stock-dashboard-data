import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {completionCurrent,recoveryTargets,isFutureAfterCloseTarget,runPipeline} from './run-daily-pipeline.mjs';
import {inputFingerprint} from './screen-market.mjs';
import {discoverEvidenceSources,archiveUsable} from './collect-research-evidence.mjs';
import {tdccWeeks,officialDate,evidenceSummary} from './research-evidence.mjs';

test('partial checkpoint never stops automated evidence recovery',()=>{
  const config={version:'v2'},input={targetDate:'2026-09-29',universe:[],deepDive:[]};
  const fixture={target:input.targetDate,config,input,manifest:{revision:'r',researchPath:'snapshots/r/research.json',selectionHistoryPath:'snapshots/r/selection-history.json',paperAccountPath:'snapshots/r/paper-account.json'},research:{researchDate:input.targetDate,strategyVersion:config.version,inputFingerprint:inputFingerprint(input,config),researchComplete:true,creditEvidenceComplete:true},paper:{asOf:input.targetDate},history:[{date:input.targetDate}],state:{targetDate:input.targetDate,gateStatus:'PASS',publicationComplete:true}};
  assert.equal(completionCurrent(fixture),true);
  assert.equal(completionCurrent({...fixture,research:{...fixture.research,researchComplete:false}}),false);
  assert.equal(completionCurrent({...fixture,config:{version:'v3'}}),false);
  assert.equal(completionCurrent({...fixture,input:{...input,universe:[{code:'3005'}]}}),false);
});
test('orders on a missed day are processed before the new target',()=>{
  assert.deepEqual(recoveryTargets('2026-09-30',{asOf:'2026-09-24',nextOrders:[{tradingDate:'2026-09-29'},{tradingDate:'2026-09-25'},{tradingDate:'2026-10-01'}]}),['2026-09-25','2026-09-29','2026-09-30']);
});
test('morning recovery never uses today incomplete OHLC',()=>{
  assert.equal(isFutureAfterCloseTarget('2026-09-30',new Date('2026-09-30T01:00:00Z')),true);
  assert.equal(isFutureAfterCloseTarget('2026-09-29',new Date('2026-09-30T01:00:00Z')),false);
});
test('financial endpoints must be discovered in the official specification',()=>{
  const spec={paths:{'/mopsfin_t187ap06_O_ci':{get:{summary:'上櫃公司綜合損益表(一般業)'}},'/unrelated':{get:{summary:'綜合損益表'}}}};
  assert.equal(discoverEvidenceSources(spec,'TPEx','https://www.tpex.org.tw/openapi/v1').length,1);
  assert.equal(archiveUsable({status:'CAPTURED',capturedAt:'2026-09-30T01:00:00Z'},'2026-09-29'),false);
});
test('TDCC counts 400+ once, includes the 40-50 retail bucket, and rejects future weeks',()=>{
  const rows=Array.from({length:15},(_,i)=>({'證券代號':'3005','資料日期':'1150925','持股分級':String(i+1),'占集保庫存數比例%':'1'}));
  const result=tdccWeeks([...rows,...rows.map(r=>({...r,'資料日期':'1151002'}))],'2026-09-29');
  assert.equal(result.length,1);assert.equal(result[0].large400,4);assert.equal(result[0].retail50,8);
  assert.equal(tdccWeeks(rows.map(r=>({...r,'資料日期':undefined,'\uFEFF資料日期':'20260925'})),'2026-09-29').length,1);
  assert.equal(officialDate('20260230'),null);
});
test('no valid BUY setup can still be a completed study; missing credit cannot',()=>{
  const gates={history:true,institutional:true,credit:true,tdcc:true,fundamental:true,event:true,corporateAction:true,strategy:false,riskReward:false};
  const input={deepDive:[{code:'3005'}]},result={regimeVerified:true,rows:[{code:'3005',gates}]};
  assert.equal(evidenceSummary(input,result).researchComplete,true);
  assert.equal(evidenceSummary(input,{...result,rows:[{code:'3005',gates:{...gates,credit:false}}]}).researchComplete,false);
});
test('failed verification never skips an old order day',()=>{
  const original=process.cwd(),targetEnv=process.env.TARGET_DATE,tmp=fs.mkdtempSync(path.join(os.tmpdir(),'daily-pipeline-'));
  try {
    process.chdir(tmp);fs.mkdirSync('snapshots/r',{recursive:true});fs.writeFileSync('DAILY_UPDATE_PROTOCOL.md','fixture');
    const manifest={revision:'r',researchPath:'snapshots/r/research.json',selectionHistoryPath:'snapshots/r/selection-history.json',paperAccountPath:'snapshots/r/paper-account.json'};
    for(const [file,value] of [['manifest.json',manifest],['strategy-config.json',{version:'v2'}],[manifest.researchPath,{researchDate:'2026-09-24'}],[manifest.selectionHistoryPath,[]],[manifest.paperAccountPath,{asOf:'2026-09-24',nextOrders:[{tradingDate:'2026-09-25'}]}]])fs.writeFileSync(file,JSON.stringify(value));
    const calls=[];
    const execute=(cmd,args,options)=>{
      if(cmd==='git')return 'sha';
      const script=args[0],day=options.env.TARGET_DATE;calls.push([script,day]);
      if(script.endsWith('fetch-official-market-data.mjs'))fs.writeFileSync(`raw/${day}/gate-matrix.json`,JSON.stringify({targetDate:day,overallStatus:'VERIFY_FAILED'}));
    };
    runPipeline('2026-09-29',{execute,now:new Date('2026-09-30T01:00:00Z')});
    assert.ok(calls.every(c=>c[1]==='2026-09-25'));assert.ok(!calls.some(c=>c[0].endsWith('screen-market.mjs')));
    assert.equal(JSON.parse(fs.readFileSync('raw/2026-09-25/pipeline-status.json')).stage,'WAITING_OFFICIAL_VERIFICATION');
  }finally{process.chdir(original);if(targetEnv===undefined)delete process.env.TARGET_DATE;else process.env.TARGET_DATE=targetEnv;fs.rmSync(tmp,{recursive:true,force:true});}
});
test('new-day recovery builds input before history and records validation only after testing published main',()=>{
  const original=process.cwd(),targetEnv=process.env.TARGET_DATE,tmp=fs.mkdtempSync(path.join(os.tmpdir(),'daily-pipeline-'));
  try {
    process.chdir(tmp);fs.mkdirSync('snapshots/r',{recursive:true});fs.writeFileSync('DAILY_UPDATE_PROTOCOL.md','fixture');
    const manifest={revision:'r',researchPath:'snapshots/r/research.json',selectionHistoryPath:'snapshots/r/selection-history.json',paperAccountPath:'snapshots/r/paper-account.json'};
    for(const [file,value] of [['manifest.json',manifest],['strategy-config.json',{version:'v2'}],[manifest.researchPath,{}],[manifest.selectionHistoryPath,[]],[manifest.paperAccountPath,{asOf:'2026-09-28',nextOrders:[]}]])fs.writeFileSync(file,JSON.stringify(value));
    const calls=[];
    const execute=(cmd,args,options)=>{
      if(cmd==='git'){calls.push('git '+args.join(' '));return 'published-sha';}
      const script=args[0],day=options.env.TARGET_DATE;calls.push(script);
      if(script.endsWith('fetch-official-market-data.mjs'))fs.writeFileSync(`raw/${day}/gate-matrix.json`,JSON.stringify({targetDate:day,overallStatus:'PASS'}));
      if(script.endsWith('summarize-official-market-data.mjs'))fs.writeFileSync(`raw/${day}/research-input.json`,'{}');
      if(script.endsWith('backfill-v2-market-history.mjs'))assert.ok(fs.existsSync(`raw/${day}/research-input.json`));
      if(script.endsWith('screen-market.mjs')){fs.writeFileSync('manifest.json',JSON.stringify({...manifest,revision:'new'}));fs.writeFileSync(`raw/${day}/daily-report.json`,JSON.stringify({researchComplete:false,evidencePending:{credit:1}}));}
    };
    runPipeline('2026-09-29',{execute,now:new Date('2026-09-30T01:00:00Z')});
    assert.ok(calls.indexOf('scripts/summarize-official-market-data.mjs')<calls.indexOf('scripts/backfill-v2-market-history.mjs'));
    assert.equal(calls.filter(c=>c==='scripts/publish-data-atomic.mjs').length,2);
    const receipt=JSON.parse(fs.readFileSync('raw/2026-09-29/pipeline-status.json'));
    assert.equal(receipt.stage,'VALIDATION_PASS');assert.equal(receipt.researchComplete,false);assert.equal(receipt.retryPolicy,'AUTOMATIC_NEXT_SCHEDULE');
    assert.equal(JSON.parse(fs.readFileSync('raw/2026-09-29/daily-report.json')).validation.validatedCommit,'published-sha');
  }finally{process.chdir(original);if(targetEnv===undefined)delete process.env.TARGET_DATE;else process.env.TARGET_DATE=targetEnv;fs.rmSync(tmp,{recursive:true,force:true});}
});
