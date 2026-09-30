// Supplementary historical queries never grant a strategy gate or change fills.
export const EVIDENCE_AUDIT_VERSION = 1;
export function buildEvidenceAudit(row, gates, targetDate, supplement = null) {
  const etf = row?.assetType === 'ETF', latest = row?.tdccEvidence?.latest;
  const records = (supplement?.records || []).filter(r => r.code === row?.code && r.status === 'VERIFIED_HISTORICAL_PAYLOAD' && r.dataDate <= targetDate && r.decisionEligible === false);
  const comparisons = {};
  if (latest) for (const record of records) {
    const days = (Date.parse(latest.date) - Date.parse(record.dataDate)) / 86400000;
    const period = [2, 4].find(n => days >= n * 7 && days <= n * 7 + 3);
    if (!period || record.rows?.length !== 15 || !record.rows.every((r,i) => r.level === i+1 && Number.isFinite(r.ratio))) continue;
    const large = record.rows.filter(r => r.level >= 12).reduce((s,r) => s+r.ratio,0);
    const retail = record.rows.filter(r => r.level <= 8).reduce((s,r) => s+r.ratio,0);
    comparisons[`${period}w`] = {date:record.dataDate,large400Change:Number((latest.large400-large).toFixed(4)),retail50Change:Number((latest.retail50-retail).toFixed(4)),source:record.source,capturedAt:record.capturedAt,decisionEligible:false};
  }
  const revenue = row?.fundamental?.monthlyRevenue || null;
  const action = row?.current?.market==='TWSE'?supplement?.corporateActionQuery:null;
  return {
    schemaVersion:EVIDENCE_AUDIT_VERSION,targetDate,
    tdcc:{status:etf?'NOT_REQUIRED':gates.tdcc?'VERIFIED':Object.keys(comparisons).length===2?'HISTORICAL_QUERIES_VERIFIED_ASOF_PENDING':'HISTORY_INCOMPLETE',asOfEvidence:row?.tdccEvidence || null,historicalComparisons:comparisons,decisionEligible:gates.tdcc===true,publicationTimingVerified:gates.tdcc===true},
    fundamental:{status:etf?'NOT_REQUIRED':gates.fundamental?'VERIFIED':'QUALITY_ASSESSMENT_PENDING',monthlyRevenue:revenue,quarterlyReportCaptured:Boolean(row?.financialEvidence),assessment:row?.financialAssessment??null,qualityVerified:gates.fundamental===true},
    eventRisk:{status:gates.event?'VERIFIED':'UNVERIFIED',assessment:row?.eventAssessment??null,historicalQuery:supplement?.eventQuery || null},
    corporateAction:{status:gates.corporateAction?'VERIFIED':'UNVERIFIED',assessment:row?.corporateActionAssessment??null,partialHistoricalQuery:action?{status:action.status,source:action.source,actualDate:action.actualDate,scope:action.scope,otherCorporateActionsVerified:action.otherCorporateActionsVerified}:null},
  };
}
export function auditedReasonDescriptions(codes, audit, fallback) {
  return [...new Set(codes.map(code => {
    if (code === 'TDCC_PERSISTENCE_NOT_VERIFIED' && audit?.tdcc.asOfEvidence?.latest) {
      const dates = [audit.tdcc.asOfEvidence.latest.date,...Object.values(audit.tdcc.asOfEvidence.comparisons || {}).filter(Boolean).map(r=>r.date),...Object.values(audit.tdcc.historicalComparisons).map(r=>r.date)];
      return audit.tdcc.status==='HISTORICAL_QUERIES_VERIFIED_ASOF_PENDING'?`大戶／散戶歷史已補查（${dates.join('、')}）；補查資料的當時可得性未驗證，尚不納入買進判斷`:`已有${dates.join('、')}持股資料；仍缺完整2／4週比較，不能宣稱官方沒有資料`;
    }
    if(code==='FUNDAMENTAL_QUALITY_NOT_VERIFIED' && audit?.fundamental.assessment?.periodEnd) return `已核對截至${audit.fundamental.assessment.periodEnd}的累計財報；${audit.fundamental.assessment.pending.includes('COMPARATIVE_FINANCIAL_PERIOD_NOT_VERIFIED')?'去年同期比較仍未驗證；':''}${audit.fundamental.assessment.pending.includes('GOVERNANCE_COVERAGE_NOT_VERIFIED')?'完整公司治理涵蓋範圍仍未驗證；':''}目前不新增買單`;
    if(code==='FUNDAMENTAL_QUALITY_NOT_VERIFIED' && audit?.fundamental.monthlyRevenue) return `已有${audit.fundamental.monthlyRevenue.dataMonthKey}營收；尚無當時保存的完整季財報及財務品質核對結果`;
    if(code==='EVENT_RISK_NOT_VERIFIED' && audit?.eventRisk.assessment?.events?.length)return `已核對${audit.eventRisk.assessment.events.length}筆官方公告；下一交易日二元事件的完整日曆仍未驗證，不能用沒有看到新聞推定安全`;
    if(code==='EVENT_RISK_NOT_VERIFIED' && audit?.eventRisk.historicalQuery?.status==='VERIFY_FAILED')return `${audit.targetDate}重大訊息歷史查詢遭官方安全頁拒絕；事件風險仍未驗證，不能判定沒有公告`;
    if(code==='CORPORATE_ACTION_NOT_VERIFIED' && audit?.corporateAction.partialHistoricalQuery?.status==='PARTIAL_VERIFIED')return `${audit.targetDate}上市除權息結果已取得；分割、減資、停復牌等完整公司行動尚未核對`;
    return fallback([code])[0];
  }))];
}
export function auditChipSummary(audit) {
 const latest=audit?.tdcc.asOfEvidence?.latest;
 if(!latest || !Object.keys(audit.tdcc.historicalComparisons).length)return '';
 const round=n=>Number(n.toFixed(2));
 return `歷史補核：${latest.date}大戶400張以上占${round(latest.large400)}%、散戶50張以下占${round(latest.retail50)}%；${Object.entries(audit.tdcc.historicalComparisons).map(([period,r])=>`${period==='2w'?'2週':'4週'}大戶變動${round(r.large400Change)}、散戶變動${round(r.retail50Change)}個百分點`).join('；')}。此為事後歷史核對，不改寫原買進判斷。`;
}
