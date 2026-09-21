import fs from 'node:fs';

const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
const research = JSON.parse(fs.readFileSync(manifest.researchPath, 'utf8'));
const config = JSON.parse(fs.readFileSync('strategy-config.json', 'utf8'));
const errors = [];

const fail = (message) => errors.push(message);
const assert = (condition, message) => { if (!condition) fail(message); };
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const allowedDecision = new Set(['BUY','SELL','REDUCE','HOLD','WATCH','NO_TRADE']);
const allowedStrategy = new Set(['BREAKOUT','TREND_PULLBACK','CHIP_ACCUMULATION_BREAKOUT','EXIT','NONE']);
const allowedEntryStrategy = new Set(['BREAKOUT','TREND_PULLBACK','CHIP_ACCUMULATION_BREAKOUT']);
const allowedRegime = new Set(['BULL','NEUTRAL','BEAR','HIGH_RISK']);
const allowedAsset = new Set(['STOCK','ETF']);
const allowedSource = new Set(['SOURCE_A','SOURCE_B','SOURCE_C','NONE']);
const allowedCatalyst = new Set(['CONFIRMED','DIVERGENCE','STALE','UNVERIFIED','NONE']);

if (research.strategyVersion !== config.version) {
  console.log(`STRATEGY V2 VALIDATION SKIPPED: current strategyVersion=${research.strategyVersion ?? 'missing'}`);
  process.exit(0);
}

const p = research.strategyProfile;
assert(p && typeof p === 'object' && !Array.isArray(p), 'v2 research.strategyProfile is required');
if (p) {
  assert(p.version === config.version, `strategyProfile.version must be ${config.version}`);
  assert(p.signalMode === 'EOD', 'strategyProfile.signalMode must be EOD');
  assert(allowedRegime.has(p.marketRegime), 'strategyProfile.marketRegime invalid');
  const expectedThreshold = config.buyScoreThreshold[p.marketRegime];
  assert(p.buyScoreThreshold === expectedThreshold, `buyScoreThreshold must be ${expectedThreshold}`);
  assert(p.liquidityMedianTurnover20dMin === config.liquidityMedianTurnover20dMin, `liquidityMedianTurnover20dMin must be ${config.liquidityMedianTurnover20dMin}`);
  assert(p.priorityMaxCandidates === config.priority.maxCandidates, `priorityMaxCandidates must be ${config.priority.maxCandidates}`);
  assert(p.priorityPercentileMax === config.priority.percentileMax, `priorityPercentileMax must be ${config.priority.percentileMax}`);
  assert(p.priorityRankMax === config.priority.rankMax, `priorityRankMax must be ${config.priority.rankMax}`);
  assert(p.minRiskReward === config.minRiskReward, `minRiskReward must be ${config.minRiskReward}`);
  assert(p.riskPerTradePct === config.risk.riskPerTradePct, 'riskPerTradePct must be 0.5');
  assert(p.riskPerTradeHardCapPct === config.risk.riskPerTradeHardCapPct, 'riskPerTradeHardCapPct must be 1');
  assert(p.singleStockExposureMaxPct === config.risk.singleStockExposureMaxPct, 'singleStockExposureMaxPct must be 10');
  assert(p.sectorExposureMaxPct === config.risk.sectorExposureMaxPct, 'sectorExposureMaxPct must be 20');
  assert(p.totalExposureMaxPct === config.risk.totalExposureMaxPct, 'totalExposureMaxPct must be 50');
  assert(p.dailyLossLimitPct === config.risk.dailyLossLimitPct, 'dailyLossLimitPct must be 1.5');
  assert(p.weeklyLossLimitPct === config.risk.weeklyLossLimitPct, 'weeklyLossLimitPct must be 4');

  const w = p.scoreWeights;
  const expected = config.scoreWeights;
  assert(w && typeof w === 'object', 'strategyProfile.scoreWeights is required');
  if (w) for (const [key,val] of Object.entries(expected)) assert(w[key] === val, `scoreWeights.${key} must be ${val}`);

  const expectedEtf = config.assetProfiles?.ETF;
  const actualEtf = p.assetProfiles?.ETF;
  assert(expectedEtf && expectedEtf.enabled === true, 'strategy-config assetProfiles.ETF must be enabled');
  assert(actualEtf && typeof actualEtf === 'object', 'strategyProfile.assetProfiles.ETF is required');
  if (expectedEtf && actualEtf) {
    assert(actualEtf.profileVersion === expectedEtf.profileVersion, `ETF profileVersion must be ${expectedEtf.profileVersion}`);
    assert(actualEtf.classificationSource === expectedEtf.classificationSource, 'ETF classificationSource mismatch');
    assert(actualEtf.liquidityMedianTurnover20dMin === expectedEtf.liquidityMedianTurnover20dMin, 'ETF liquidity threshold mismatch');
    assert(actualEtf.historyTradingDaysMin === expectedEtf.historyTradingDaysMin, 'ETF history threshold mismatch');
    assert(JSON.stringify(actualEtf.scoreWeights) === JSON.stringify(expectedEtf.scoreWeights), 'ETF scoreWeights mismatch');
  }
}

assert(Array.isArray(research.candidates), 'research.candidates must be an array');
let buyCount = 0;
for (const c of research.candidates ?? []) {
  const code = c?.code ?? '?';
  assert(allowedAsset.has(c.assetType), `candidate ${code} assetType invalid/missing`);
  assert(allowedDecision.has(c.decision), `candidate ${code} decision invalid/missing`);
  assert(allowedStrategy.has(c.strategy), `candidate ${code} strategy invalid/missing`);
  assert(finite(c.score) && c.score >= 0 && c.score <= 100, `candidate ${code} score invalid`);

  const s = c.scores;
  const caps = c.assetType === 'ETF'
    ? config.assetProfiles.ETF.scoreWeights
    : {trend:config.scoreWeights.trend,momentum:config.scoreWeights.momentum,volume:config.scoreWeights.volume,market_regime:config.scoreWeights.marketRegime,institutional:config.scoreWeights.institutional,large_holder:config.scoreWeights.largeHolder,margin_short_lending:config.scoreWeights.marginShortLending,fundamental:config.scoreWeights.fundamental,risk_reward:config.scoreWeights.riskReward};
  assert(s && typeof s === 'object', `candidate ${code} scores missing`);
  if (s) {
    let total = 0;
    for (const [key,cap] of Object.entries(caps)) {
      assert(finite(s[key]) && s[key] >= 0 && s[key] <= cap, `candidate ${code} scores.${key} invalid`);
      if (finite(s[key])) total += s[key];
    }
    if (finite(c.score)) assert(Math.abs(total - c.score) < 1e-9, `candidate ${code} score mismatch: components=${total}, score=${c.score}`);
  }

  assert(c.universeRank === null || (Number.isInteger(c.universeRank) && c.universeRank > 0), `candidate ${code} universeRank invalid`);
  assert(c.universePercentile === null || (finite(c.universePercentile) && c.universePercentile >= 0 && c.universePercentile <= 100), `candidate ${code} universePercentile invalid`);
  assert(c.liquidityMedianTurnover20d === null || (finite(c.liquidityMedianTurnover20d) && c.liquidityMedianTurnover20d >= 0), `candidate ${code} liquidityMedianTurnover20d invalid`);
  assert(c.volumeRatio20d === null || (finite(c.volumeRatio20d) && c.volumeRatio20d >= 0), `candidate ${code} volumeRatio20d invalid`);
  assert(c.riskReward === null || (finite(c.riskReward) && c.riskReward >= 0), `candidate ${code} riskReward invalid`);

  const n = c.newsEvent;
  assert(n && typeof n === 'object' && !Array.isArray(n), `candidate ${code} newsEvent missing`);
  if (n) {
    assert(allowedSource.has(n.sourceQuality), `candidate ${code} newsEvent.sourceQuality invalid`);
    assert(typeof n.eventType === 'string' && n.eventType.length > 0, `candidate ${code} newsEvent.eventType missing`);
    assert(['POSITIVE','NEUTRAL','NEGATIVE','UNCERTAIN'].includes(n.direction), `candidate ${code} newsEvent.direction invalid`);
    assert(n.eventTimestamp === null || typeof n.eventTimestamp === 'string', `candidate ${code} newsEvent.eventTimestamp invalid`);
    assert(allowedCatalyst.has(n.catalystStatus), `candidate ${code} newsEvent.catalystStatus invalid`);
  }

  if (c.assetType === 'ETF') {
    const ep=c.etfProfile;
    const ec=config.assetProfiles.ETF;
    assert(ep && typeof ep === 'object' && !Array.isArray(ep), `candidate ${code} etfProfile missing`);
    if (ep) {
      assert(ep.profileVersion === ec.profileVersion, `candidate ${code} ETF profileVersion mismatch`);
      assert(typeof ep.category === 'string' && ep.category.length>0, `candidate ${code} ETF category missing`);
      assert(ep.classificationSource === ec.classificationSource, `candidate ${code} ETF classificationSource mismatch`);
      assert(typeof ep.historyReady === 'boolean', `candidate ${code} ETF historyReady invalid`);
      assert(typeof ep.historicalRiskReady === 'boolean', `candidate ${code} ETF historicalRiskReady invalid`);
      assert(typeof ep.liquidityGatePass === 'boolean', `candidate ${code} ETF liquidityGatePass invalid`);
      assert(typeof ep.riskLimitsPass === 'boolean', `candidate ${code} ETF riskLimitsPass invalid`);
      assert(typeof ep.eligibleForBuy === 'boolean', `candidate ${code} ETF eligibleForBuy invalid`);
      if (c.group === 'core') assert(ec.coreCategories.includes(ep.category), `candidate ${code} core ETF category is not core-eligible`);
    }
  }

  if (c.decision === 'BUY') {
    buyCount += 1;
    assert(allowedEntryStrategy.has(c.strategy), `candidate ${code} BUY strategy is not an allowed entry strategy`);
    assert(p?.marketRegime === 'BULL' || p?.marketRegime === 'NEUTRAL', `candidate ${code} BUY not allowed in ${p?.marketRegime}`);
    const threshold = c.assetType === 'ETF' ? config.assetProfiles.ETF.buyScoreThreshold[p?.marketRegime] : config.buyScoreThreshold[p?.marketRegime];
    assert(finite(c.score) && c.score >= threshold, `candidate ${code} BUY score below regime threshold ${threshold}`);
    const liquidityMin=c.assetType === 'ETF' ? config.assetProfiles.ETF.liquidityMedianTurnover20dMin : config.liquidityMedianTurnover20dMin;
    assert(finite(c.liquidityMedianTurnover20d) && c.liquidityMedianTurnover20d >= liquidityMin, `candidate ${code} BUY liquidity below configured median turnover`);
    assert(finite(c.riskReward) && c.riskReward >= config.minRiskReward, `candidate ${code} BUY riskReward below configured minimum`);
    if (c.strategy === 'BREAKOUT') assert(finite(c.volumeRatio20d) && c.volumeRatio20d >= config.breakout.minVolumeRatio20d, `candidate ${code} BREAKOUT volumeRatio20d below configured minimum`);
    assert(Number.isInteger(c.universeRank) && c.universeRank > 0 && c.universeRank <= config.priority.rankMax, `candidate ${code} BUY requires verified universeRank <= configured maximum`);
    assert(finite(c.universePercentile) && c.universePercentile >= 0 && c.universePercentile <= config.priority.percentileMax, `candidate ${code} BUY requires verified universePercentile <= configured maximum`);
    assert(finite(c.maxChase), `candidate ${code} BUY missing maxChase`);
    assert(typeof c.invalidCondition === 'string' && c.invalidCondition.trim(), `candidate ${code} BUY missing invalidCondition`);
    assert(!(n?.sourceQuality === 'SOURCE_C' && n?.direction === 'POSITIVE'), `candidate ${code} BUY cannot rely on positive SOURCE_C news`);
    if (c.assetType === 'ETF') {
      const ep=c.etfProfile;
      const ec=config.assetProfiles.ETF;
      assert(ep?.eligibleForBuy === true, `candidate ${code} ETF BUY is not eligible under independent ETF profile`);
      assert(ec.eligibleCategories.includes(ep?.category), `candidate ${code} ETF BUY category is excluded`);
      assert(ep?.historyReady === true && ep?.historicalRiskReady === true, `candidate ${code} ETF BUY requires verified historical risk coverage`);
      assert(ep?.liquidityGatePass === true && ep?.riskLimitsPass === true, `candidate ${code} ETF BUY failed ETF liquidity/risk limits`);
    }
  }
}

assert(buyCount <= config.priority.maxCandidates, `v2 BUY candidate count ${buyCount} exceeds priority max ${config.priority.maxCandidates}`);

if (errors.length) {
  console.error('STRATEGY V2 VALIDATION FAILED');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`STRATEGY V2 VALIDATION PASSED: ${manifest.revision}`);
