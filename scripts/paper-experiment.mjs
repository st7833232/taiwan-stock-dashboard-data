const finite=x=>typeof x==='number'&&Number.isFinite(x);
export function experimentAllowsOrder(experiment,nextDate,config) {
  const rule=config.paperExperiment;
  if(!rule?.enabled)return true;
  return Boolean(nextDate&&nextDate>=rule.startDate&&experiment?.status!=='REVIEW_DUE');
}
export function updatePaperExperiment(paper,previous,input,config,researchComplete) {
  const rule=config.paperExperiment;if(!rule?.enabled)return null;
  if(input.gateMatrix?.overallStatus!=='PASS'||input.gateMatrix.targetDate!==input.targetDate)throw Error('Experiment requires verified official trading data');
  const old=previous.experiment?.id===rule.id?previous.experiment:null;
  const actualDates=[...new Set([...(old?.tradingDates??[]),...input.deepDive.flatMap(r=>(r.history??[]).map(h=>h[0])),...(input.targetDate>=rule.startDate?[input.targetDate]:[])])].filter(d=>d>=rule.startDate&&d<=input.targetDate).sort();
  const dates=actualDates.slice(0,rule.durationTradingDays), inPeriod=dates.includes(input.targetDate);
  const marks=(old?.dailyMarks??[]).filter(m=>m.date!==input.targetDate);
  const equity=paper.cash+paper.positions.reduce((sum,p)=>sum+p.shares*p.lastPrice,0);
  const priorDate=[...new Set(input.deepDive.flatMap(r=>(r.history??[]).map(h=>h[0])).filter(d=>d<rule.startDate))].sort().at(-1);
  const baseEquity=old?.baselineEquity??(inPeriod&&actualDates[0]===input.targetDate&&previous.asOf===priorDate?previous.cash+previous.positions.reduce((sum,p)=>sum+p.shares*p.lastPrice,0):null);
  if(inPeriod)marks.push({date:input.targetDate,equity,researchComplete:researchComplete===true,plannedOrders:paper.nextOrders.length,filledTrades:paper.ledger.filter(e=>e.date===input.targetDate&&['buy','sell'].includes(e.side)&&finite(e.price)&&e.shares>0).length});
  marks.sort((a,b)=>a.date.localeCompare(b.date));
  const coverageComplete=finite(baseEquity)&&dates.every(d=>marks.some(m=>m.date===d));
  let peak=baseEquity,maxDrawdown=0;
  for(const mark of marks){peak=Math.max(peak??mark.equity,mark.equity);maxDrawdown=Math.max(maxDrawdown,(peak-mark.equity)/peak*100);}
  const blockedDays=marks.filter(m=>!m.researchComplete).length;
  const status=dates.length>=rule.durationTradingDays?'REVIEW_DUE':input.targetDate<rule.startDate?'PLANNED':'ACTIVE';
  const reviews=Array.from({length:Math.floor(dates.length/rule.reviewEveryTradingDays)},(_,i)=>{
    const day=(i+1)*rule.reviewEveryTradingDays,through=dates[day-1],periodMarks=marks.filter(m=>m.date<=through),last=periodMarks.find(m=>m.date===through);
    return {tradingDay:day,date:through,valuedDays:periodMarks.length,evidenceBlockedDays:periodMarks.filter(m=>!m.researchComplete).length,filledTrades:periodMarks.reduce((s,m)=>s+m.filledTrades,0),returnPct:coverageComplete&&last?(last.equity/baseEquity-1)*100:null};
  });
  const summary=status==='PLANNED'?`${rule.durationTradingDays}個交易日試驗：${rule.startDate}開始，預計${rule.plannedEndDate}收盤驗收；每${rule.reviewEveryTradingDays}個交易日檢查一次。`:`${rule.durationTradingDays}日試驗進度${dates.length}/${rule.durationTradingDays}；研究資料未核對完成${blockedDays}天，這些天不算「市場沒有買點」。${status==='REVIEW_DUE'?'已到期，停止新增買單並進行結果驗收。':''}${blockedDays>=rule.maxEvidenceBlockedTradingDays?'資料流程已達檢討門檻，須優先修復。':''}`;
  paper.experiment={id:rule.id,status,startDate:rule.startDate,plannedEndDate:rule.plannedEndDate,durationTradingDays:rule.durationTradingDays,reviewEveryTradingDays:rule.reviewEveryTradingDays,completedTradingDays:dates.length,tradingDates:dates,baselineDate:old?.baselineDate??(finite(baseEquity)?previous.asOf:null),baselineEquity:baseEquity,dailyMarks:marks,reviews,metrics:{filledTrades:marks.reduce((s,m)=>s+m.filledTrades,0),evidenceBlockedDays:blockedDays,noNewOrderDays:marks.filter(m=>m.researchComplete&&m.plannedOrders===0).length,returnPct:coverageComplete&&marks.length?(marks.at(-1).equity/baseEquity-1)*100:null,maxDrawdownPct:coverageComplete?maxDrawdown:null,valuationCoverageComplete:coverageComplete,missingValuationDates:dates.filter(d=>!marks.some(m=>m.date===d))},processReviewRequired:blockedDays>=rule.maxEvidenceBlockedTradingDays,summary};
  paper.experimentTitle=`20 萬虛擬操作實驗｜${rule.durationTradingDays}個交易日`;
  paper.statusLabel=summary;
  paper.rationale=paper.rationale.filter(r=>!['固定期間驗收','期間驗收指標'].includes(r.title)&&!/^第\d+個交易日檢查$/.test(r.title));paper.rationale.push({title:'固定期間驗收',detail:summary});
  const metrics=paper.experiment.metrics;
  paper.rationale.push({title:'期間驗收指標',detail:`試驗期間成交${metrics.filledTrades}筆；研究未完成${blockedDays}天；研究完成但無新委託${metrics.noNewOrderDays}天。${metrics.returnPct===null?'尚無完整期間評價，暫不公布期間報酬或最大回撤。':`期間報酬${metrics.returnPct.toFixed(3)}%；最大回撤${metrics.maxDrawdownPct.toFixed(3)}%。`}`});
  for(const review of reviews)paper.rationale.push({title:`第${review.tradingDay}個交易日檢查`,detail:`截至${review.date}，成交${review.filledTrades}筆，研究資料未完成${review.evidenceBlockedDays}天；${review.returnPct===null?'期間評價尚未完整，報酬暫不公布。':`期間報酬${review.returnPct.toFixed(3)}%。`}`});
  return paper.experiment;
}
