import fs from 'node:fs';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import {evidenceSummary} from './research-evidence.mjs';
import {updatePaperExperiment,experimentAllowsOrder} from './paper-experiment.mjs';
import {EVIDENCE_AUDIT_VERSION,buildEvidenceAudit,auditedReasonDescriptions,auditChipSummary} from './evidence-audit.mjs';

export const finite = x => typeof x === 'number' && Number.isFinite(x);
export const hash = x => crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
export const inputFingerprint = (input, config) => hash({targetDate:input.targetDate,universe:input.universe,deepDive:input.deepDive,tdcc:input.tdcc,verifiedCalendar:input.verifiedCalendar,config});
export const taipeiTime = (date = new Date()) => new Date(date.getTime() + 8*3600000).toISOString().slice(0,19) + '+08:00';
const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const write = (p, x) => { fs.mkdirSync(p.slice(0,p.lastIndexOf('/')) || '.', {recursive:true}); fs.writeFileSync(p, JSON.stringify(x,null,2)+'\n'); };
const round = x => Math.round(x*10000)/10000;

const reasonLabels = {
  TDCC_PERSISTENCE_NOT_VERIFIED:'大戶與散戶持股的連續多週變化尚未核對完成',
  FUNDAMENTAL_QUALITY_NOT_VERIFIED:'營收、獲利及財務品質尚未核對完成',
  EVENT_RISK_NOT_VERIFIED:'近期重大消息與下一交易日的事件風險尚未核對完成',
  CORPORATE_ACTION_NOT_VERIFIED:'除權息、分割或減資等公司行動尚未核對完成',
  ENTRY_SETUP_NOT_CONFIRMED:'尚未確認符合條件的回測或突破買點',
  STRUCTURAL_RR_NOT_VERIFIED:'合理停損與目標價尚未確認，暫時無法判斷這筆交易是否值得承擔風險',
  HISTORY_NOT_VERIFIED:'歷史行情尚不足以驗證均線、波動與成交量',
  LOW_LIQUIDITY:'近期成交金額未達流動性門檻',
  MARKET_REGIME_BLOCK:'目前大盤條件不允許新增買單',
  TREND_NOT_CONFIRMED:'中期上升趨勢尚未確認',
  CREDIT_EVIDENCE_INCOMPLETE:'融資、融券或必要借券資料尚未核對完成',
  INSTITUTIONAL_HISTORY_INCOMPLETE:'外資、投信等法人多日買賣紀錄尚未核對完成',
  ETF_PROFILE_GATE_FAILED:'ETF的商品分類、歷史、流動性或風險條件尚未全部通過',
  SCORE_THRESHOLD_NOT_MET:'綜合評分未達目前市場環境的買進門檻',
  RANKING_THRESHOLD_NOT_MET:'全市場排名未達優先買進門檻',
  NEXT_TRADING_DATE_NOT_OFFICIALLY_VERIFIED:'下一個正式交易日尚未確認',
  DUPLICATE_SIGNAL:'已有相同標的持倉或委託，避免重複加碼',
  POSITION_SIZE_INVALID:'風控計算後沒有合適的可買股數',
  PRIORITY_COUNT_LIMIT:'優先買進標的已達數量上限',
  ACCOUNT_RISK_LIMIT:'既有單股曝險超過帳戶上限，暫不新增買單',
  TOTAL_EXPOSURE_LIMIT:'總持股曝險超過上限',
  SECTOR_EXPOSURE_LIMIT:'產業或相關持股曝險超過上限',
  ACCOUNT_LOSS_HISTORY_UNVERIFIED:'帳戶日／週損失所需的歷史評價尚未確認',
  ACCOUNT_EQUITY_HISTORY_UNVERIFIED:'歷史交易與帳戶權益尚未核對完成',
  REALIZED_LOSS_HISTORY_UNVERIFIED:'已實現損益紀錄尚未核對完成',
  CONSECUTIVE_LOSS_LIMIT:'連續虧損已達上限，暫停新增部位',
  DAILY_LOSS_LIMIT:'單日損失已達風控上限',
  WEEKLY_LOSS_LIMIT:'單週損失已達風控上限',
  EXPERIMENT_OUTSIDE_ORDER_WINDOW:'已超出本次模擬操作期間，停止新增買單，等待結果驗收',
};
export const reasonDescriptions = codes => [...new Set(codes.map(code=>reasonLabels[code]||'其他必要條件尚未確認，暫不建立新買單'))];
export const evidenceLabels = {history:'歷史行情',institutional:'法人多日紀錄',credit:'融資融券等信用資料',tdcc:'大戶與散戶多週持股',fundamental:'財務品質',event:'重大消息與事件風險',corporateAction:'除權息等公司行動'};
export function candidateDisplayFields(row, held, audit=null) {
  const reasons=auditedReasonDescriptions(row.reasonCodes||[],audit,reasonDescriptions), pending=reasons.join('；');
  return {
    thesis:`${row.name}已納入全市場篩選，已驗證項目得分 ${row.score}。${pending?`目前先觀察：${pending}。`:'目前列出的檢查項目均已通過，仍須遵守進場價格與帳戶風控。'}${held?'目前為既有模擬持倉。':''}`,
    avoid:pending?`在以下項目確認前，不新增買單：${pending}。`:'開盤或實際進場價格超過上限、停損或帳戶曝險不符規則時，取消買單。',
    entry:row.decision==='BUY'?`僅供下一交易日條件單：進場價 ${row.entryPrice??row.setup?.entry} 元，最高可接受價格 ${row.maxChase??row.setup?.maxEntry} 元，停損 ${row.stop??row.setup?.stop} 元；超價即取消。`:'目前不新增買單。先完成必要資料核對，再確認回測或突破買點、停損與目標價，並通過排名及帳戶風控。',
  };
}

// This function never assigns ranks to incomplete evidence or treats a score as a Hard Gate.
export function creditReady(row, config) {
  const c = row?.marginShortLending, r = config.creditEvidence;
  return Boolean(c) && (!r.requireMarginBalance || finite(c.marginBalance))
    && (!r.requireShortBalance || finite(c.shortBalance))
    && (!r.requireSecuritiesLending || finite(c.lendingBalance));
}
export function entrySetup(row, config) {
  const t=row.indicators||{}, c=row.current, rules=config.screening;
  const prior=(row.history||[]).filter(r=>r[0]<rules.targetDate).slice(-rules.breakoutLookback);
  if (prior.length<rules.breakoutLookback || !finite(t.atr14) || t.atr14<=0) return null;
  const resistance=Math.max(...prior.map(r=>r[2])), support=Math.min(...prior.map(r=>r[3]));
  const previous=prior.at(-1), ceiling=Math.max(...(row.history||[]).filter(r=>r[0]<rules.targetDate).slice(-rules.targetLookback).map(r=>r[2]));
  const trend=c.close>t.ma20 && t.ma20>t.ma60 && t.ma60>t.ma120 && t.ma20Slope5d>0 && t.ma60Slope5d>0;
  if (!trend || t.rsi14>rules.maxEntryRsi || t.macdHistogram<0) return null;
  let strategy=null, entry=null, stop=null;
  if(c.close>resistance && row.volumeRatio20d>=config.breakout.minVolumeRatio20d) {
    strategy='BREAKOUT'; entry=c.close; stop=Math.max(support,resistance-t.atr14*rules.stopAtrMultiplier);
  } else if(c.low<=t.ma20 && c.close>t.ma20 && c.close>previous[4] && row.volumeRatio20d<rules.pullbackVolumeRatioMax) {
    strategy='TREND_PULLBACK'; entry=c.close; stop=Math.min(c.low,t.ma20)-t.atr14*rules.stopAtrMultiplier;
  }
  // A historic structural target is required; never manufacture a 2R target.
  if(!strategy || !finite(ceiling) || ceiling<=entry || stop<=0 || stop>=entry) return null;
  const rr=(ceiling-entry)/(entry-stop), maxEntry=Math.min(entry+t.atr14*rules.maxChaseAtrMultiplier, (ceiling+config.minRiskReward*stop)/(1+config.minRiskReward));
  if(maxEntry<entry || rr<config.minRiskReward) return null;
  return {strategy,entry,stop,target:ceiling,riskReward:rr,maxEntry,resistance,support};
}

export function evaluateUniverse(input, config) {
  if(input.gateMatrix?.overallStatus!=='PASS' || input.gateMatrix.targetDate!==input.targetDate) throw Error('Official Gate is not PASS for targetDate');
  if(!Array.isArray(input.universe) || !input.universe.length) throw Error('Dynamic full-market universe missing');
  const detailed=new Map(input.deepDive.map(r=>[r.code,r]));
  const proxy=detailed.get(config.screening.marketProxyCode), t=proxy?.indicators, close=proxy?.current.close;
  const regimeVerified=Boolean(t && [t.ma20,t.ma60,t.ma120,t.ma20Slope5d,t.ma60Slope5d].every(finite));
  const regime=!regimeVerified?'HIGH_RISK':close<t.ma60?'BEAR':close>t.ma20 && t.ma20>t.ma60 && t.ma60>t.ma120 && t.ma20Slope5d>0 && t.ma60Slope5d>0?'BULL':'NEUTRAL';
  const rows=input.universe.map(current=>{
    const row=detailed.get(current.code), etf=current.assetType==='ETF', ind=row?.indicators||{}, inst=row?.institutionalTrend||{};
    const reasons=[], gates={};
    const liq=etf?config.assetProfiles.ETF.liquidityMedianTurnover20dMin:config.liquidityMedianTurnover20dMin;
    gates.history=Boolean(row && row.historyCoverageTradingDays>=config.screening.historyTradingDaysMin && [ind.ma20,ind.ma60,ind.ma120,ind.atr14,ind.rsi14,ind.macdHistogram,row.volumeRatio20d,row.liquidityMedianTurnover20d].every(finite));
    gates.liquidity=Boolean(row && finite(row.liquidityMedianTurnover20d) && row.liquidityMedianTurnover20d>=liq);
    gates.market=regimeVerified && ['BULL','NEUTRAL'].includes(regime);
    const trendChecks=[current.close>ind.ma20,ind.ma20>ind.ma60,ind.ma60>ind.ma120,ind.ma20Slope5d>0,ind.ma60Slope5d>0];
    gates.trend=gates.history && trendChecks.every(Boolean);
    gates.credit=etf || creditReady(row,config);
    gates.institutional=etf || Boolean(row && row.institutionalHistoryCoverageDays>=config.screening.institutionalTradingDaysMin && ['foreign','investment_trust'].every(k=>[1,3,5,10,20].every(n=>finite(inst[`${k}_${n}d`]))));
    // Raw records alone cannot assert complete TDCC persistence or financial quality.
    gates.tdcc=etf || row?.verifiedEvidence?.tdcc===true;
    gates.fundamental=etf || row?.verifiedEvidence?.fundamental===true;
    gates.event=row?.verifiedEvidence?.eventRisk===true;
    gates.corporateAction=row?.verifiedEvidence?.corporateAction===true;
    const rules={...config,screening:{...config.screening,targetDate:input.targetDate}};
    const setup=row && gates.history ? entrySetup(row,rules):null;
    gates.strategy=Boolean(setup); gates.riskReward=Boolean(setup && setup.riskReward>=config.minRiskReward);
    gates.assetProfile=!etf || Boolean(row?.etfProfile?.eligibleForBuy && row.etfProfile.historyReady && row.etfProfile.historicalRiskReady && row.etfProfile.liquidityGatePass && row.etfProfile.riskLimitsPass);
    const weight=etf?config.assetProfiles.ETF.scoreWeights:{trend:config.scoreWeights.trend,momentum:config.scoreWeights.momentum,volume:config.scoreWeights.volume,market_regime:config.scoreWeights.marketRegime,institutional:config.scoreWeights.institutional,large_holder:config.scoreWeights.largeHolder,margin_short_lending:config.scoreWeights.marginShortLending,fundamental:config.scoreWeights.fundamental,risk_reward:config.scoreWeights.riskReward};
    const scores=Object.fromEntries(Object.keys(weight).map(k=>[k,0]));
    const award=(key,fraction)=>{scores[key]=round(weight[key]*Math.max(0,Math.min(1,fraction)));};
    if(gates.history) {
      award('trend',trendChecks.filter(Boolean).length/trendChecks.length);
      const momentum=[ind.rsi14>=config.screening.momentumRsiMin && ind.rsi14<=config.screening.maxEntryRsi, ind.macdHistogram>0];
      award('momentum',momentum.filter(Boolean).length/momentum.length);
      award(etf?'volume_liquidity':'volume',gates.liquidity?Math.min(row.volumeRatio20d/config.breakout.minVolumeRatio20d,1):0);
      award('market_regime',regime==='BULL'?1:regime==='NEUTRAL'?config.screening.neutralMarketScoreFraction:0);
      award('risk_reward',gates.riskReward?1:0);
      if(etf) {
        award('volatility_drawdown',row?.etfProfile?.riskLimitsPass?1:0);
        award('product_structure',gates.assetProfile?1:0);
      } else {
        const positive=k=>[1,3,5,10,20].filter(n=>inst[`${k}_${n}d`]>0).length/5;
        award('institutional',gates.institutional?(positive('foreign')+positive('investment_trust'))/2:0);
        award('margin_short_lending',gates.credit?(row.marginShortLending.marginChange<=0?1:config.screening.marginIncreaseScoreFraction):0);
        award('large_holder',gates.tdcc?row.verifiedEvidence.tdccScoreFraction:0);
        award('fundamental',gates.fundamental?row.verifiedEvidence.fundamentalScoreFraction:0);
      }
    }
    const reasonMap={history:'HISTORY_NOT_VERIFIED',liquidity:'LOW_LIQUIDITY',market:'MARKET_REGIME_BLOCK',trend:'TREND_NOT_CONFIRMED',credit:'CREDIT_EVIDENCE_INCOMPLETE',institutional:'INSTITUTIONAL_HISTORY_INCOMPLETE',tdcc:'TDCC_PERSISTENCE_NOT_VERIFIED',fundamental:'FUNDAMENTAL_QUALITY_NOT_VERIFIED',event:'EVENT_RISK_NOT_VERIFIED',corporateAction:'CORPORATE_ACTION_NOT_VERIFIED',strategy:'ENTRY_SETUP_NOT_CONFIRMED',riskReward:'STRUCTURAL_RR_NOT_VERIFIED',assetProfile:'ETF_PROFILE_GATE_FAILED'};
    for(const [k,passed] of Object.entries(gates)) if(!passed) reasons.push(reasonMap[k]);
    return {code:current.code,name:current.name,market:current.market,assetType:current.assetType,close:current.close,decision:row?'WATCH':'NO_TRADE',strategy:setup?.strategy||'NONE',score:round(Object.values(scores).reduce((a,b)=>a+b,0)),scores,gates,reasonCodes:reasons,universeRank:null,universePercentile:null,liquidityMedianTurnover20d:row?.liquidityMedianTurnover20d??null,volumeRatio20d:row?.volumeRatio20d??null,riskReward:setup?.riskReward??null,setup,etfProfile:row?.etfProfile??null,historyCoverageTradingDays:row?.historyCoverageTradingDays??0};
  });
  // Cross-sectional ranks exist only for the fully eligible pre-account universe, separately by asset.
  for(const asset of ['STOCK','ETF']) {
    const eligible=rows.filter(r=>r.assetType===asset && Object.values(r.gates).every(Boolean)).sort((a,b)=>b.score-a.score || a.code.localeCompare(b.code));
    eligible.forEach((r,i)=>{r.universeRank=i+1;r.universePercentile=(i+1)*100/eligible.length;});
  }
  return {regime,regimeVerified,marketProxyCode:config.screening.marketProxyCode,rows};
}

// Unknown/legacy textual order formats are logged as unconfirmed, never interpreted by a model.
export function fillPrice(order, quote) {
  if(!quote || ![quote.open,quote.high,quote.low].every(finite)) return {reason:'OFFICIAL_OHLC_UNVERIFIED'};
  const r=order.mechanicalRule;
  if(order.side==='sell' && r?.type==='OPEN_EXIT') return {price:quote.open};
  if(order.side==='sell' && r?.type==='STOP_EXIT' && finite(r.stop)) return quote.open<=r.stop?{price:quote.open}:quote.low<=r.stop?{price:r.stop}:{reason:'STOP_NOT_REACHED'};
  if(!r || !finite(r.maxEntry)) return {reason:'ORDER_RULE_NOT_MACHINE_READABLE'};
  if(quote.open>r.maxEntry) return {reason:'GAP_ABOVE_MAX_ENTRY'};
  if(r.type==='OPEN_RANGE' && [r.zoneLow,r.zoneHigh].every(finite)) return quote.open>=r.zoneLow && quote.open<=r.zoneHigh?{price:quote.open}:{reason:'OPEN_OUTSIDE_ENTRY_ZONE'};
  if(r.type==='STOP_ENTRY' && finite(r.trigger)) {
    if(quote.open>=r.trigger) return {price:quote.open};
    if(quote.high>=r.trigger && r.trigger<=r.maxEntry) return {price:r.trigger};
    return {reason:'TRIGGER_NOT_REACHED'};
  }
  return {reason:'ORDER_RULE_NOT_MACHINE_READABLE'};
}
export function accountRisk(paper,input,config) {
  const equity=paper.cash+paper.positions.reduce((a,p)=>a+p.shares*p.lastPrice,0), reasons=[];
  if(!finite(equity)||equity<=0) return {pass:false,reasons:['ACCOUNT_EQUITY_INVALID'],equity};
  const exposure=paper.positions.reduce((a,p)=>a+p.shares*p.lastPrice,0);
  if(exposure/equity*100>config.risk.totalExposureMaxPct) reasons.push('TOTAL_EXPOSURE_LIMIT');
  // Treat unknown sectors as one correlated bucket. This is conservative and never invents sectors.
  if(exposure/equity*100>config.risk.sectorExposureMaxPct) reasons.push('SECTOR_EXPOSURE_LIMIT');
  if(paper.positions.some(p=>p.shares*p.lastPrice/equity*100>config.risk.singleStockExposureMaxPct)) reasons.push('ACCOUNT_RISK_LIMIT');
  const previousDates=[...new Set(input.deepDive.flatMap(r=>r.history.map(h=>h[0])).filter(d=>d<input.targetDate))].sort();
  const daily=previousDates.at(-1), week=new Date(input.targetDate+'T00:00:00Z');week.setUTCDate(week.getUTCDate()-((week.getUTCDay()+6)%7));
  const weekBefore=previousDates.filter(d=>d<week.toISOString().slice(0,10)).at(-1);
  for(const [date,limit,label] of [[daily,config.risk.dailyLossLimitPct,'DAILY_LOSS_LIMIT'],[weekBefore,config.risk.weeklyLossLimitPct,'WEEKLY_LOSS_LIMIT']]) {
    const at=paper.positions.map(p=>input.deepDive.find(d=>d.code===p.code)?.history.find(h=>h[0]===date)?.[4]);
    if(!date || !at.every(finite)) {reasons.push('ACCOUNT_LOSS_HISTORY_UNVERIFIED');continue;}
    // No new trades in the interval in a checkpoint; trade-bearing intervals require equity archives.
    if(paper.ledger.some(e=>e.date>date && e.date<=input.targetDate && finite(e.price))) {reasons.push('ACCOUNT_EQUITY_HISTORY_UNVERIFIED');continue;}
    const past=paper.cash+paper.positions.reduce((a,p,i)=>a+p.shares*at[i],0);
    if((past-equity)/past*100>limit) reasons.push(label);
  }
  const sells=paper.ledger.filter(e=>e.side==='sell'&&finite(e.price));
  if(sells.some(e=>!finite(e.realizedPnl))) reasons.push('REALIZED_LOSS_HISTORY_UNVERIFIED');
  let consecutive=0;for(const e of sells.slice().reverse()){if(e.realizedPnl<0)consecutive++;else break;}
  if(consecutive>=config.risk.consecutiveRealizedLossLimit)reasons.push('CONSECUTIVE_LOSS_LIMIT');
  return {pass:reasons.length===0,reasons:[...new Set(reasons)],equity,exposurePct:exposure/equity*100,sectorMethod:'ALL_HOLDINGS_ONE_CORRELATED_BUCKET'};
}

export function planSignals(result,paper,input,config) {
  const risk=accountRisk(paper,input,config), orders=[];
  const calendar=input.verifiedCalendar;
  const periodCalendar=config.paperExperiment;
  const nextDate=calendar?.sourceQuality==='SOURCE_A' && calendar?.asOf<=input.targetDate && calendar?.nextTradingDate>input.targetDate?calendar.nextTradingDate:periodCalendar?.calendarAsOf<=input.targetDate?periodCalendar.plannedTradingDates.find(d=>d>input.targetDate)??null:null;
  for(const r of result.rows) {
    if(!Object.values(r.gates).every(Boolean))continue;
    const threshold=r.assetType==='ETF'?config.assetProfiles.ETF.buyScoreThreshold[result.regime]:config.buyScoreThreshold[result.regime];
    if(!finite(threshold)||r.score<threshold){r.reasonCodes.push('SCORE_THRESHOLD_NOT_MET');continue;}
    if(!finite(r.universePercentile)||r.universePercentile>config.priority.percentileMax||r.universeRank>config.priority.rankMax){r.reasonCodes.push('RANKING_THRESHOLD_NOT_MET');continue;}
    if(!risk.pass){r.reasonCodes.push(...risk.reasons);continue;}
    if(!nextDate){r.reasonCodes.push('NEXT_TRADING_DATE_NOT_OFFICIALLY_VERIFIED');continue;}
    if(!experimentAllowsOrder(paper.experiment,nextDate,config)){r.reasonCodes.push('EXPERIMENT_OUTSIDE_ORDER_WINDOW');continue;}
    if(paper.positions.some(p=>p.code===r.code)||orders.some(o=>o.code===r.code)){r.reasonCodes.push('DUPLICATE_SIGNAL');continue;}
    const s=r.setup, feeRate=config.execution.feeRate;
    const capital=risk.equity*Math.min(config.risk.riskPerTradePct,config.risk.riskPerTradeHardCapPct)/100;
    const exposureBudget=Math.min(risk.equity*config.risk.singleStockExposureMaxPct/100,risk.equity*config.risk.sectorExposureMaxPct/100-(risk.equity-paper.cash),risk.equity*config.risk.totalExposureMaxPct/100-(risk.equity-paper.cash));
    const reserved=orders.reduce((a,o)=>a+o.shares*o.mechanicalRule.maxEntry*(1+feeRate),0);
    const shares=Math.floor(Math.min(capital/(s.maxEntry-s.stop+s.maxEntry*feeRate+s.stop*(feeRate+config.execution.stockTaxRate)),(paper.cash-reserved)/(s.maxEntry*(1+feeRate)),(exposureBudget-reserved)/s.maxEntry));
    if(shares<=0){r.reasonCodes.push('POSITION_SIZE_INVALID');continue;}
    if(orders.length>=config.priority.maxCandidates){r.reasonCodes.push('PRIORITY_COUNT_LIMIT');continue;}
    const route=s.strategy==='BREAKOUT'?'STOP_ENTRY':'OPEN_RANGE', mutualExclusionGroup=`${input.targetDate}-${r.code}`;
    r.decision='BUY';r.candidatePositionSize=shares;
    orders.push({code:r.code,name:r.name,side:'buy',shares,tradingDate:nextDate,createdFromDate:input.targetDate,signalId:mutualExclusionGroup,mutualExclusionGroup,mechanicalRule:{type:route,trigger:s.entry,zoneLow:s.entry,zoneHigh:s.maxEntry,maxEntry:s.maxEntry,stop:s.stop,feeRate,taxRate:r.assetType==='ETF'?config.execution.etfTaxRate:config.execution.stockTaxRate},executionRule:route==='STOP_ENTRY'?'Open > maxEntry取消；Open>=trigger且未超價依Open；否則High>=trigger依trigger；未觸發到期取消。':'只在官方Open位於zoneLow至zoneHigh含端點時依Open成交；区間外取消。',cancelCondition:'超maxEntry、官方OHLC未驗證、風控超限、現金不足、互斥路徑已成交或到期則整筆取消。'});
  }
  return {risk,orders,nextDate};
}
export function markPaper(previous, input, config) {
  const paper=structuredClone(previous), quotes=new Map(input.universe.map(r=>[r.code,r]));
  if(previous.asOf>input.targetDate) throw Error('Cannot roll paper account backwards');
  if(previous.asOf===input.targetDate) return paper; // Same-day reanalysis never executes orders twice.
  for(const order of previous.nextOrders) {
    const q=quotes.get(order.code),rule=order.mechanicalRule;
    const outcome=order.tradingDate===input.targetDate?fillPrice(order,q):{reason:'SIGNAL_EXPIRED_OR_WRONG_TRADING_DATE'};
    if(outcome.price && order.side==='sell') {
      const pos=paper.positions.find(p=>p.code===order.code);
      if(!pos || !Number.isInteger(order.shares) || order.shares<=0 || pos.shares<order.shares) outcome.reason='SELL_EXCEEDS_HOLDING';
      else {
        const gross=outcome.price*order.shares,fee=gross*config.execution.feeRate,tax=gross*(q.assetType==='ETF'?config.execution.etfTaxRate:config.execution.stockTaxRate),pnl=gross-fee-tax-pos.averageCost*order.shares;
        paper.cash+=gross-fee-tax;pos.shares-=order.shares;paper.positions=paper.positions.filter(p=>p.shares>0);
        paper.ledger.push({date:input.targetDate,status:'模擬賣出成交',code:order.code,name:order.name,side:'sell',shares:order.shares,price:outcome.price,fee,tax,realizedPnl:pnl,rationale:`依 ${previous.asOf} 已提交出場規則与官方OHLC機械判定，僅為paper成交。`});
      }
    }
    if(outcome.price && order.side!=='sell') {
      if(order.side!=='buy'||!Number.isInteger(order.shares)||order.shares<=0||!finite(rule.stop)||rule.stop>=outcome.price) outcome.reason='ORDER_RISK_FIELDS_NOT_VERIFIED';
      else if(q.low<=rule.stop) outcome.reason='INTRADAY_ENTRY_STOP_SEQUENCE_UNCONFIRMED';
      else if(paper.ledger.some(e=>e.date===input.targetDate&&e.mutualExclusionGroup===order.mutualExclusionGroup&&finite(e.price))) outcome.reason='MUTUALLY_EXCLUSIVE_ROUTE_ALREADY_FILLED';
      else {
        const openPaper=structuredClone(paper);
        for(const p of openPaper.positions){const held=quotes.get(p.code);if(!held||!finite(held.open))throw Error(`Held ${p.code} official Open unverified`);p.lastPrice=held.open;}
        const risk=accountRisk(openPaper,input,config), feeRate=config.execution.feeRate, fee=outcome.price*order.shares*feeRate;
        const exposure=openPaper.positions.reduce((a,p)=>a+p.shares*p.lastPrice,0), existing=openPaper.positions.find(p=>p.code===order.code);
        const value=outcome.price*order.shares, maxLoss=(outcome.price-rule.stop)*order.shares+fee+rule.stop*order.shares*(feeRate+config.execution.stockTaxRate);
        if(!risk.pass)outcome.reason=risk.reasons.join(',');
        else if(value+fee>paper.cash)outcome.reason='CASH_INSUFFICIENT';
        else if(maxLoss/risk.equity*100>Math.min(config.risk.riskPerTradePct,config.risk.riskPerTradeHardCapPct))outcome.reason='ACCOUNT_RISK_LIMIT';
        else if(((existing?.shares||0)*outcome.price+value)/risk.equity*100>config.risk.singleStockExposureMaxPct)outcome.reason='SINGLE_STOCK_EXPOSURE_LIMIT';
        else if((exposure+value)/risk.equity*100>Math.min(config.risk.sectorExposureMaxPct,config.risk.totalExposureMaxPct))outcome.reason='SECTOR_OR_TOTAL_EXPOSURE_LIMIT';
        else {
          const position=paper.positions.find(p=>p.code===order.code);
          if(position){position.averageCost=(position.shares*position.averageCost+value+fee)/(position.shares+order.shares);position.shares+=order.shares;}
          else paper.positions.push({code:order.code,name:order.name,shares:order.shares,averageCost:(value+fee)/order.shares,lastPrice:outcome.price});
          paper.cash-=value+fee;
          paper.ledger.push({date:input.targetDate,status:'模擬買進成交',code:order.code,name:order.name,side:'buy',shares:order.shares,price:outcome.price,fee,tax:0,mutualExclusionGroup:order.mutualExclusionGroup||order.signalId,rationale:`依 ${previous.asOf} 已提交機械委託與正式OHLC，Open風控重算通過；僅為paper成交。`});
        }
      }
    }
    if(outcome.reason) paper.ledger.push({date:input.targetDate,status:'未成交／待確認',code:order.code,name:order.name,side:order.side,shares:order.shares,fee:0,tax:0,reasonCode:outcome.reason,rationale:`僅依 ${previous.asOf} 已提交委託判定：${outcome.reason}；不得依今日結果補寫成交條件。`});
  }
  paper.asOf=input.targetDate;
  for(const pos of paper.positions) { const q=quotes.get(pos.code);if(!q || !finite(q.close)) throw Error(`Official close unavailable for held ${pos.code}`);pos.lastPrice=q.close; }
  const equity=paper.cash+paper.positions.reduce((a,p)=>a+p.shares*p.lastPrice,0);
  paper.equity=equity;paper.marketValue=equity-paper.cash;
  if(!previous.nextOrders.length) paper.ledger.push({date:input.targetDate,status:'無既有委託',shares:0,fee:0,tax:0,rationale:`前一正式帳戶 ${previous.asOf} 的 nextOrders=[]；當日沒有可執行委託。僅按官方收盤評價持倉。`});
  const benchmark=input.deepDive.find(r=>r.code==='0050'), day=benchmark?.history?.filter(r=>r[0]<=input.targetDate).slice(-2);
  const previousEquity=previous.cash+previous.positions.reduce((sum,p)=>sum+p.shares*p.lastPrice,0);
  if(!finite(previousEquity)||previousEquity<=0 || day?.length!==2 || day[1][0]!==input.targetDate || !finite(day[0][4]) || day[0][4]<=0 || !finite(day[1][4])) throw Error('Paper benchmark official valuation history unavailable');
  paper.benchmark={date:input.targetDate,accountReturn:(equity/previousEquity-1)*100,cumulativeAccountReturn:(equity/paper.initialCash-1)*100,etfCode:'0050',etfReturn:(day[1][4]/day[0][4]-1)*100,accountBaseDate:previous.asOf,accountBaseEquity:previousEquity,method:'Account percent return since previous published valuation; cumulative return from initial cash; ETF daily percent return from verified official OHLCV.'};
  paper.nextOrders=[];paper.statusLabel=`${input.targetDate}正式評價已更新；當日成交0筆；研究證據仍待補驗證`;
  paper.rule=`現股／ETF、無槓桿；新單依strategy-config風控：單股${config.risk.singleStockExposureMaxPct}%、產業${config.risk.sectorExposureMaxPct}%、總曝險${config.risk.totalExposureMaxPct}%；既有持倉超限不事後改寫成交。個股賣出稅0.3%、ETF 0.1%，買賣手續費沿用0.1425%。`;
  paper.rationale=[{title:'無前視偏誤',detail:`僅讀前一正式帳戶 ${previous.asOf} 的 nextOrders；今日新研究不產生今日成交。`},{title:'逐檔信用與研究證據',detail:'未驗證欄位保留缺項；ETF與普通股分流，不以ETF覆蓋普通股信用證據。'}];
  paper.sourceNote=`${input.targetDate}官方Gate PASS；維持既有帳簿費率與成本；當日無委託，未新增任何真實或模擬交易。`;
  return paper;
}

export function publishCheckpoint(target) {
  const root=`raw/${target}`, input=read(`${root}/research-input.json`), gate=read(`${root}/gate-matrix.json`), config=read('strategy-config.json'), manifest=read('manifest.json');
  // Read all three before data processing; never silently reuse malformed state.
  const previousResearch=read(manifest.researchPath), history=read(manifest.selectionHistoryPath), previousPaper=read(manifest.paperAccountPath);
  read(`${root}/publication-state.json`);
  if(input.targetDate!==target || gate.targetDate!==target || gate.overallStatus!=='PASS') throw Error('Target Gate not PASS');
  const fingerprint=inputFingerprint(input,config);
  const supplementPath=`${root}/historical-evidence-supplement.json`, supplement=fs.existsSync(supplementPath)?read(supplementPath):null, auditFingerprint=hash(supplement);
  if(previousResearch.researchDate===target && previousPaper.asOf===target && previousResearch.inputFingerprint===fingerprint && previousResearch.strategyVersion===config.version && previousResearch.evidenceAuditVersion===EVIDENCE_AUDIT_VERSION && previousResearch.auditFingerprint===auditFingerprint) {console.log('NO_CHANGE');return;}
  const result=evaluateUniverse({...input,gateMatrix:gate},config), paper=markPaper(previousPaper,input,config), now=taipeiTime();
  const evidence=evidenceSummary(input,result);
  updatePaperExperiment(paper,previousPaper,{...input,gateMatrix:gate},config,evidence.researchComplete);
  const plan=planSignals(result,paper,input,config);paper.nextOrders=plan.orders;paper.riskCheck=plan.risk;
  updatePaperExperiment(paper,previousPaper,{...input,gateMatrix:gate},config,evidence.researchComplete);
  let marketOverview=null;
  if(fs.existsSync(`${root}/market-overview.json`)) marketOverview=read(`${root}/market-overview.json`);
  else if(fs.existsSync(`${root}/twse-mi-index.raw.txt`)) {
    const payload=read(`${root}/twse-mi-index.raw.txt`);
    const record=payload.tables?.flatMap(t=>t.data||[]).find(r=>r[0]==='發行量加權股價指數');
    if(payload.date===target.replaceAll('-','')&&record) marketOverview={date:target,taiexClose:Number(record[1].replaceAll(',','')),taiexChangePct:Number(record[4]),source:`raw/${target}/twse-mi-index.raw.txt`,officialDateEvidence:payload.date};
  }
  if(marketOverview?.date===target && finite(marketOverview.taiexChangePct)) paper.benchmark.taiexReturn=marketOverview.taiexChangePct;
  if(!finite(paper.benchmark.taiexReturn)) throw Error('Official TAIEX benchmark return unavailable');
  const sorted=result.rows.slice().sort((a,b)=>b.score-a.score || a.code.localeCompare(b.code));
  const keep=new Set([...sorted.filter(r=>r.assetType==='STOCK' && r.historyCoverageTradingDays>=config.screening.historyTradingDaysMin).slice(0,config.screening.displayStockCount).map(r=>r.code),...result.rows.filter(r=>r.decision==='BUY').map(r=>r.code),...paper.positions.map(p=>p.code),...previousResearch.candidates.map(c=>c.code),...result.rows.filter(r=>r.etfProfile?.eligibleForCore).map(r=>r.code)]);
  const detailed=new Map(input.deepDive.map(r=>[r.code,r]));
  const candidates=sorted.filter(r=>keep.has(r.code)).map(r=>{
    const d=detailed.get(r.code),t=d?.indicators||{}, held=paper.positions.some(p=>p.code===r.code), core=r.etfProfile?.eligibleForCore && r.etfProfile?.historyReady && r.etfProfile?.riskLimitsPass && r.etfProfile?.liquidityGatePass;
    const invalid=finite(t.ma20)?`正式收盤跌破MA20 ${round(t.ma20)}元且5日法人轉為淨賣，重新判定目前觀察；既有持倉須另依原始出場委託規則處理。`:`必須先取得 ${target} 官方OHLC與至少 ${config.screening.historyTradingDaysMin} 日可驗證歷史；在此之前不建立進場路徑。`;
    const evidenceAudit=buildEvidenceAudit(d||{code:r.code,assetType:r.assetType,current:{market:r.market}},r.gates,target,supplement);
    return {...r,evidenceAudit,group:core?'core':r.decision==='BUY'?'priority':r.decision==='NO_TRADE'?'excluded':'watch',rating:r.decision==='BUY'?'A-／條件買進':core?'Core／觀察':'B／條件觀察',tone:core?'core':'watch',rank:core?'Core':'Watch',closeDate:target,priceStatus:'final-close',...candidateDisplayFields(r,held,evidenceAudit),
      technical:finite(t.ma20)?`MA20/60/120=${round(t.ma20)}/${round(t.ma60)}/${round(t.ma120)}；RSI14=${round(t.rsi14)}；量比=${round(r.volumeRatio20d)}。`:'尚無足夠官方歷史可计算MA/ATR。',
      chips:r.assetType==='ETF'?'使用ETF專用評估，不套用普通股的營收、大戶持股與法人評分權重。':`外資1/3/5/10/20日=${[1,3,5,10,20].map(n=>d?.institutionalTrend?.[`foreign_${n}d`]??'未驗證').join('/')}股；投信1/3/5/10/20日=${[1,3,5,10,20].map(n=>d?.institutionalTrend?.[`investment_trust_${n}d`]??'未驗證').join('/')}股。${auditChipSummary(evidenceAudit)}`,
      invalid,invalidCondition:invalid,
      pullbackEntry:{status:r.decision==='BUY'&&r.strategy==='TREND_PULLBACK'?'available':'unavailable',reason:r.reasonCodes.join(',')||'PULLBACK_CONFIRMATION_NOT_PRESENT'},breakoutTrigger:{status:r.decision==='BUY'&&r.strategy==='BREAKOUT'?'available':'unavailable',reason:r.reasonCodes.join(',')||'BREAKOUT_CONFIRMATION_NOT_PRESENT'},entryPrice:r.decision==='BUY'?r.setup.entry:null,maxChase:r.decision==='BUY'?r.setup.maxEntry:null,stop:r.decision==='BUY'?r.setup.stop:null,target:r.decision==='BUY'?r.setup.target:null,
      entryRoutes:r.decision==='BUY'?[{route_id:`${target}-${r.code}-${r.strategy}`,route_type:r.strategy==='BREAKOUT'?'BREAKOUT_ROUTE':'PULLBACK_ROUTE',trigger_price:r.setup.entry,zone_low:r.setup.entry,zone_high:r.setup.maxEntry,max_entry_price:r.setup.maxEntry,stop_loss:r.setup.stop,candidate_position_size:r.candidatePositionSize,expires_at:plan.nextDate,route_status:'PLANNED',mutual_exclusion_group:`${target}-${r.code}`}]:[],allocationMax:r.decision==='BUY'?`${config.risk.singleStockExposureMaxPct}%上限`:'0%',candidatePositionSize:r.candidatePositionSize||0,positionSize:0,executionReady:false,executionStatus:'NOT_SUBMITTED',hardGatesPassed:r.decision==='BUY',
      financialAssessment:d?.financialAssessment??null,eventAssessment:d?.eventAssessment??null,corporateActionAssessment:d?.corporateActionAssessment??null,
      newsEvent:d?.eventAssessment?.newsEvent??{sourceQuality:'NONE',eventType:'EVENT_COVERAGE_NOT_VERIFIED',direction:'UNCERTAIN',eventTimestamp:null,catalystStatus:'UNVERIFIED'},
      dataQuality:{price:'VALID',ohlcv:r.gates.history?'VALID':'MISSING',institutional:r.assetType==='ETF'?'NOT_REQUIRED':r.gates.institutional?'VALID':'MISSING',margin:r.assetType==='ETF'?'NOT_REQUIRED':r.gates.credit?'VALID':'MISSING',tdcc:r.assetType==='ETF'?'NOT_REQUIRED':r.gates.tdcc?'VALID':'MISSING',fundamental:r.assetType==='ETF'?'NOT_REQUIRED':r.gates.fundamental?'VALID':'MISSING',news:r.gates.event?'VALID':'MISSING',securitiesLending:r.assetType==='ETF'?'NOT_REQUIRED':finite(d?.marginShortLending?.lendingBalance)?'VALID':config.creditEvidence.requireSecuritiesLending?'MISSING':'NOT_REQUIRED'}};
  });
  const stocks=input.deepDive.filter(r=>r.assetType==='STOCK'), missingCredit=stocks.filter(r=>!creditReady(r,config)).map(r=>r.code);
  const coverage={universe:input.universe.length,stocks:input.universe.filter(r=>r.assetType==='STOCK').length,etfs:input.universe.filter(r=>r.assetType==='ETF').length,deepDive:input.deepDive.length,deepDiveStocks:stocks.length,deepDiveEtfs:input.deepDive.length-stocks.length,creditReadyStocks:stocks.length-missingCredit.length,creditMissingCodes:missingCredit,eligibleRanked:result.rows.filter(r=>r.universeRank!==null).length};
  const complete=evidence.researchComplete,publicationStatus=complete?'DATA_UPDATED':'SNAPSHOT_UPDATED_EVIDENCE_PENDING';
  const conclusion=`${target}全市場 ${coverage.universe} 檔已完成初步篩選（普通股 ${coverage.stocks}、ETF ${coverage.etfs}），深度檢查 ${coverage.deepDive} 檔。普通股信用資料已核對 ${coverage.creditReadyStocks}/${coverage.deepDiveStocks} 檔。${complete?'必要研究資料均已核對；沒有合適買點也可以是完整研究結果。':`仍待核對：${Object.entries(evidence.counts).filter(([,n])=>n>0).map(([k,n])=>`${evidenceLabels[k]||'其他必要資料'} ${n}檔`).join('、')}。研究尚未完成。`}本次優先買進標的 ${candidates.filter(c=>c.group==='priority'&&c.decision==='BUY').length} 檔，下一交易日委託 ${paper.nextOrders.length} 筆；ETF專用評估條件通過，也不代表已出現買點。`;
  const p={version:config.version,signalMode:'EOD',marketRegime:result.regime,buyScoreThreshold:config.buyScoreThreshold[result.regime],liquidityMedianTurnover20dMin:config.liquidityMedianTurnover20dMin,priorityMaxCandidates:config.priority.maxCandidates,priorityPercentileMax:config.priority.percentileMax,priorityRankMax:config.priority.rankMax,minRiskReward:config.minRiskReward,...config.risk,scoreWeights:config.scoreWeights,assetProfiles:config.assetProfiles};
  const research={researchDate:target,latestTradingDate:target,strategyVersion:config.version,strategyProfile:p,conclusion,decision:{summary:conclusion},candidates,coverage,researchStatus:complete?'COMPLETE':'EVIDENCE_PENDING',researchComplete:complete,evidencePending:evidence.counts,screeningComplete:true,creditEvidenceComplete:missingCredit.length===0,inputFingerprint:fingerprint,inputGeneratedAt:input.generatedAt,researchInputGeneratedAt:input.generatedAt,simulationMode:false,liquiditySelectionBasis:'MEDIAN_TURNOVER_20D',sourceNote:`使用raw/${target}已PASS官方證據與本版inputFingerprint；未把後續資料回填為當時已知資訊。`,engineVersion:config.screening.engineVersion,marketOverview,marketRegimeEvidence:{source:'OFFICIAL_BROAD_MARKET_ETF_PROXY',code:result.marketProxyCode,verified:result.regimeVerified},screeningPath:`${root}/screening-results.json`,sourceGate:gate.gates};
  research.evidenceAuditVersion=EVIDENCE_AUDIT_VERSION;research.auditFingerprint=auditFingerprint;
  const selected=candidates.filter(c=>c.group==='priority'&&c.decision==='BUY').map(c=>c.code), before=history.at(-1)?.selected||[];
  const row={date:target,selected,added:selected.filter(c=>!before.includes(c)),retained:selected.filter(c=>before.includes(c)),removed:before.filter(c=>!selected.includes(c)),upgraded:[],downgraded:[],note:complete?'必要研究證據已驗證；無BUY亦可為完成。':'EVIDENCE_PENDING，尚未視為研究完成；必要信用等證據繼續自動補驗。'};
  const selection=[...history.filter(h=>h.date!==target),row].sort((a,b)=>a.date.localeCompare(b.date));
  const revision=now.slice(0,10)+'-'+now.slice(11,19).replaceAll(':',''), prefix=`snapshots/${revision}`;
  if(fs.existsSync(prefix)) throw Error('Immutable revision already exists');
  write(`${prefix}/research.json`,research);write(`${prefix}/selection-history.json`,selection);write(`${prefix}/paper-account.json`,paper);
  write(`${root}/evidence-pending.json`,{targetDate:target,researchComplete:complete,counts:evidence.counts,pending:evidence.pending,retryPolicy:'AUTOMATIC_NEXT_SCHEDULE'});
  write(`${root}/screening-results.json`,{schemaVersion:1,targetDate:target,strategyVersion:config.version,inputFingerprint:fingerprint,coverage,marketRegime:result.regime,results:result.rows});
  write(`${root}/daily-report.json`,{schemaVersion:1,targetDate:target,revision,strategyVersion:config.version,status:publicationStatus,screeningComplete:true,researchComplete:complete,evidencePending:evidence.counts,creditEvidenceComplete:missingCredit.length===0,coverage,conclusion,priority:candidates.filter(c=>c.group==='priority').map(c=>({code:c.code,name:c.name,decision:c.decision,score:c.score})),core:candidates.filter(c=>c.group==='core').map(c=>({code:c.code,name:c.name,decision:c.decision,score:c.score,reasonCodes:c.reasonCodes})),paperAccount:{asOf:paper.asOf,cash:paper.cash,positions:paper.positions,equity:paper.equity,benchmark:paper.benchmark,nextOrders:paper.nextOrders,experiment:paper.experiment},gate:gate.gates,validation:'AWAITING_CI',inputFingerprint:fingerprint});
  write('manifest.json',{...manifest,revision,updatedAt:now,researchPath:`${prefix}/research.json`,selectionHistoryPath:`${prefix}/selection-history.json`,paperAccountPath:`${prefix}/paper-account.json`});
  console.log(JSON.stringify({revision,status:publicationStatus,coverage,equity:paper.equity}));
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) publishCheckpoint(process.env.TARGET_DATE || process.argv[2]);
