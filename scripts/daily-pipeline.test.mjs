import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {completionCurrent,recoveryTargets,isFutureAfterCloseTarget,runPipeline,resolvePipelineTarget} from './run-daily-pipeline.mjs';
import {inputFingerprint} from './screen-market.mjs';
import {discoverEvidenceSources,discoverCoverageSources,archiveUsable} from './collect-research-evidence.mjs';
import {tdccWeeks,officialDate,evidenceSummary} from './research-evidence.mjs';
import {recoveryDecision} from './continue-pipeline-recovery.mjs';

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
test('scheduled push with an empty optional date resolves the last completed date',()=>{
  assert.equal(resolvePipelineTarget('',new Date('2026-09-30T01:00:00Z')),'2026-09-29');
});
test('financial endpoints must be discovered in the official specification',()=>{
  const spec={paths:{'/mopsfin_t187ap06_O_ci':{get:{summary:'上櫃公司綜合損益表(一般業)'}},'/unrelated':{get:{summary:'綜合損益表'}}}};
  assert.equal(discoverEvidenceSources(spec,'TPEx','https://www.tpex.org.tw/openapi/v1').length,1);
  assert.equal(archiveUsable({status:'CAPTURED',capturedAt:'2026-09-30T01:00:00Z'},'2026-09-29'),false);
});
test('TPEx corporate-action coverage is discovered from the official OpenAPI specification without unrelated trading endpoints',()=>{
  const spec={paths:{
    '/tpex_exright_preannounce':{get:{summary:'上櫃公司除權除息預告表'}},
    '/tpex_exright_calc':{get:{summary:'上櫃股票除權除息計算結果表'}},
    '/tpex_reduction_reference':{get:{summary:'上櫃公司減資恢復交易參考價'}},
    '/tpex_parvalue_reference':{get:{summary:'上櫃公司變更股票面額恢復交易參考價'}},
    '/tpex_halt_resume':{get:{summary:'公布暫停/恢復交易有價證券'}},
    '/tpex_daytrade_suspend':{get:{summary:'當日沖銷交易暫停名單'}}
  }};
  const sources=discoverCoverageSources(spec,'TPEx','https://www.tpex.org.tw/openapi/v1');
  const tags=new Set(sources.flatMap(s=>s.coverageTags));
  assert.ok(tags.has('exRightsDividends'));
  assert.equal(tags.has('historicalPriceAdjustment:exRights'),false); // TPEx OpenAPI result is current-day only; history uses the official range backend.
  assert.ok(tags.has('splitReductionConversion:reduction'));
  assert.ok(tags.has('historicalPriceAdjustment:reduction'));
  assert.ok(tags.has('splitReductionConversion:parValueChange'));
  assert.ok(tags.has('historicalPriceAdjustment:parValueChange'));
  assert.ok(tags.has('tradingHalts'));
  assert.equal(sources.some(s=>s.url.includes('daytrade_suspend')),false);
});
test('TDCC counts 400+ once, includes the 40-50 retail bucket, and rejects future weeks',()=>{
  const rows=Array.from({length:15},(_,i)=>({'證券代號':'3005','資料日期':'1150925','持股分級':String(i+1),'占集保庫存數比例%':'1'}));
  const result=tdccWeeks([...rows,...rows.map(r=>({...r,'資料日期':'1151002'}))],'2026-09-29');
  assert.equal(result.length,1);assert.equal(result[0].large400,4);assert.equal(result[0].retail50,8);
  assert.equal(tdccWeeks(rows.map(r=>({...r,'資料日期':undefined,'\uFEFF資料日期':'20260925'})),'2026-09-29').length,1);
  const padded=tdccWeeks(rows.map(r=>({...r,'證券代號':Number(r['持股分級'])%2?'3005  ':'3005','資料日期':undefined,'\uFEFF資料日期':'20260925'})),'2026-09-29');
  assert.deepEqual(padded,result); // Official codes are space-padded; all holding buckets must join one normalized symbol.
  assert.equal(officialDate('20260230'),null);
});
test('no valid BUY setup can still be a completed study; missing credit cannot',()=>{
  const gates={history:true,institutional:true,credit:true,tdcc:true,fundamental:true,event:true,corporateAction:true,strategy:false,riskReward:false};
  const input={deepDive:[{code:'3005'}]},result={regimeVerified:true,rows:[{code:'3005',gates}]};
  assert.equal(evidenceSummary(input,result).researchComplete,true);
  assert.equal(evidenceSummary(input,{...result,rows:[{code:'3005',gates:{...gates,credit:false}}]}).researchComplete,false);
});
test('verified financial rejection completes research without granting a fundamental gate',()=>{
  const gates={history:true,institutional:true,credit:true,tdcc:true,fundamental:false,event:true,corporateAction:true};
  const assessment={status:'FAIL',verified:true,qualityPass:false,pending:[],failures:['PROFIT_DETERIORATION']};
  const input={deepDive:[{code:'3005',financialAssessment:assessment}]},result={regimeVerified:true,rows:[{code:'3005',gates}]};
  const summary=evidenceSummary(input,result);
  assert.equal(summary.researchComplete,true);
  assert.deepEqual(summary.counts,{});
  assert.deepEqual(summary.fundamentalQualityRejected,[{code:'3005',failures:['PROFIT_DETERIORATION']}]);
  assert.equal(gates.fundamental,false);
  for(const financialAssessment of [undefined,{...assessment,status:'UNVERIFIED',verified:false,pending:['COMPARATIVE_FINANCIAL_PERIOD_NOT_VERIFIED']},{...assessment,pending:['FINANCIAL_METRICS_INCOMPLETE']},{...assessment,verified:false},{...assessment,failures:[]}]){
    const pending=evidenceSummary({deepDive:[{code:'3005',financialAssessment}]},result);
    assert.equal(pending.researchComplete,false);
    assert.deepEqual(pending.counts,{fundamental:1});
    assert.deepEqual(pending.fundamentalQualityRejected,[]);
  }
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

test('pending-only recovery reuses PASS daily capture and skips completed history and TDCC',()=>{
  const original=process.cwd(),targetEnv=process.env.TARGET_DATE,tmp=fs.mkdtempSync(path.join(os.tmpdir(),'daily-pipeline-'));
  try {
    process.chdir(tmp);fs.mkdirSync('snapshots/r',{recursive:true});fs.mkdirSync('raw/2026-09-29',{recursive:true});fs.writeFileSync('DAILY_UPDATE_PROTOCOL.md','fixture');
    const manifest={revision:'r',researchPath:'snapshots/r/research.json',selectionHistoryPath:'snapshots/r/selection-history.json',paperAccountPath:'snapshots/r/paper-account.json'};
    for(const [file,value] of [['manifest.json',manifest],['strategy-config.json',{version:'v2'}],[manifest.researchPath,{}],[manifest.selectionHistoryPath,[]],[manifest.paperAccountPath,{asOf:'2026-09-28',nextOrders:[]}],['raw/2026-09-29/research-input.json',{targetDate:'2026-09-29'}],['raw/2026-09-29/gate-matrix.json',{targetDate:'2026-09-29',overallStatus:'PASS'}],['raw/2026-09-29/evidence-pending.json',{targetDate:'2026-09-29',counts:{history:0,fundamental:1,credit:1}}]])fs.writeFileSync(file,JSON.stringify(value));
    const calls=[];
    const execute=(cmd,args,options)=>{
      if(cmd==='git')return 'published-sha';
      const script=args[0];calls.push(script);
      if(script.endsWith('screen-market.mjs')){fs.writeFileSync('manifest.json',JSON.stringify({...manifest,revision:'new'}));fs.writeFileSync('raw/2026-09-29/daily-report.json',JSON.stringify({researchComplete:false,evidencePending:{fundamental:1,credit:1}}));}
    };
    runPipeline('2026-09-29',{execute,now:new Date('2026-09-30T01:00:00Z')});
    assert.equal(calls.includes('scripts/fetch-official-market-data.mjs'),true);
    assert.ok(calls.indexOf('scripts/fetch-official-market-data.mjs')<calls.indexOf('scripts/summarize-official-market-data.mjs'));
    assert.equal(JSON.parse(fs.readFileSync('raw/2026-09-29/gate-matrix.json')).overallStatus,'PASS');
    assert.equal(calls.includes('scripts/backfill-v2-market-history.mjs'),false);
    assert.equal(calls.includes('scripts/collect-tdcc-history.mjs'),false);
    assert.equal(calls.includes('scripts/collect-financial-pdfs.mjs'),true);
    assert.equal(calls.includes('scripts/collect-research-evidence.mjs'),true);
  }finally{process.chdir(original);if(targetEnv===undefined)delete process.env.TARGET_DATE;else process.env.TARGET_DATE=targetEnv;fs.rmSync(tmp,{recursive:true,force:true});}
});

test('self-healing retries pending evidence and transient failures but stops on completion or breaker',()=>{
  assert.deepEqual(recoveryDecision({report:{researchComplete:false,validation:{status:'PASS'}},status:{},count:0}),{dispatch:true,reason:'EVIDENCE_PENDING'});
  assert.deepEqual(recoveryDecision({report:{researchComplete:false},status:{error:'GitHub POST git/blobs: HTTP 502'},count:3}),{dispatch:true,reason:'RECOVERABLE_FAILURE'});
  assert.deepEqual(recoveryDecision({report:{researchComplete:true,validation:{status:'PASS'}},status:{},count:3}),{dispatch:false,reason:'COMPLETE'});
  assert.deepEqual(recoveryDecision({report:{researchComplete:false},status:{error:'logic invariant violated'},count:3}),{dispatch:false,reason:'NON_RECOVERABLE_FAILURE'});
  assert.deepEqual(recoveryDecision({report:{researchComplete:false,validation:{status:'PASS'}},status:{},count:12}),{dispatch:false,reason:'RECOVERY_LIMIT'});
});

test('TPEx balances use official named columns, never repayments or trades',async()=>{
  const source=fs.readFileSync(new URL('./summarize-official-market-data.mjs',import.meta.url),'utf8');
  const body=source.slice(source.indexOf('async function creditRowsFrom'),source.indexOf('function mergeCreditRows'));
  const parse=new Function('fs','tableRows','normalizeMargin','num','uniqueRows',body+';return creditRowsFrom;')({readFile:async()=>JSON.stringify({tables:[{title:'上櫃股票融資融券餘額',fields:['代號','名稱','前資餘額(張)','資買','資賣','現償','資餘額','資屬證金','資使用率(%)','資限額','前券餘額(張)','券賣','券買','券償','券餘額'],data:[['1569','stock','100','9','8','7','94','0','0','0','20','3','4','5','14']]}]})},()=>[],()=>null,x=>x==null?null:Number(x),x=>x);
  const [row]=await parse('fixture','TPEx');
  assert.equal(row.marginPrev,100);assert.equal(row.marginBalance,94);
  assert.equal(row.shortPrev,20);assert.equal(row.shortBalance,14);
  assert.equal(row.marginChange,-6);assert.equal(row.shortChange,-6);
});

test('empty official tables contain zero observations despite table metadata',()=>{
 const source=fs.readFileSync(new URL('./fetch-official-market-data.mjs',import.meta.url),'utf8');
 const body=source.slice(source.indexOf('function payloadRowCount'),source.indexOf('async function readPreviousMatrix'));
 const count=new Function(body+';return payloadRowCount;')();
 assert.equal(count({date:'20261001',tables:[{title:'balance',fields:['code'],data:[],notes:[]}]}),0);
 assert.equal(count({tables:[{fields:['code'],data:[['1569']]}]}),1);
 assert.equal(count([{code:'1569',balance:'100'}]),1);
});
test('an empty auxiliary cache is retried without downgrading official PASS Gates on fetch failure',async()=>{
 const {execFileSync}=await import('node:child_process'),script=new URL('./fetch-official-market-data.mjs',import.meta.url).href;
 const original=process.cwd(),matrix=JSON.parse(fs.readFileSync('raw/2026-10-01/gate-matrix.json','utf8')),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'empty-credit-'));
 try{
  process.chdir(tmp);fs.mkdirSync('raw/2026-10-01',{recursive:true});fs.writeFileSync('raw/2026-10-01/gate-matrix.json',JSON.stringify(matrix));
  for(const capture of matrix.captures)if(['PASS','CAPTURED'].includes(capture.status))fs.writeFileSync(`raw/2026-10-01/${capture.source}.raw.txt`,JSON.stringify({date:'20261001',tables:[{fields:['code'],data:[]}]}));
  execFileSync(process.execPath,['--input-type=module','-e',`globalThis.fetch=async()=>new Response('',{status:503});await import(${JSON.stringify(script)});`],{env:{...process.env,TARGET_DATE:'2026-10-01',SIMULATED_TODAY_DATE:'2026-10-02'},stdio:'pipe'});
  const result=JSON.parse(fs.readFileSync('raw/2026-10-01/gate-matrix.json'));
  assert.equal(result.overallStatus,'PASS');assert.ok(result.gates.every(g=>g.status==='PASS'));
  assert.equal(result.captures.find(c=>c.source==='tpex-margin-balance').status,'VERIFY_FAILED');
 }finally{process.chdir(original);fs.rmSync(tmp,{recursive:true,force:true});}
});
