import fs from 'node:fs';

const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
const research = JSON.parse(fs.readFileSync(manifest.researchPath, 'utf8'));
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

if (research.strategyVersion !== 'entry-dual-track-v2') {
  console.log(`STRATEGY V2 VALIDATION SKIPPED: current strategyVersion=${research.strategyVersion ?? 'missing'}`);
  process.exit(0);
}

const p = research.strategyProfile;
assert(p && typeof p === 'object' && !Array.isArray(p), 'v2 research.strategyProfile is required');
if (p) {
  assert(p.version === 'entry-dual-track-v2', 'strategyProfile.version must be entry-dual-track-v2');
  assert(p.signalMode === 'EOD', 'strategyProfile.signalMode must be EOD');
  assert(allowedRegime.has(p.marketRegime), 'strategyProfile.marketRegime invalid');
  const expectedThreshold = p.marketRegime === 'BULL' ? 82 : p.marketRegime === 'NEUTRAL' ? 86 : null;
  assert(p.buyScoreThreshold === expectedThreshold, `buyScoreThreshold must be ${expectedThreshold}`);
  assert(p.liquidityMedianTurnover20dMin === 50000000, 'liquidityMedianTurnover20dMin must be 50000000');
  assert(p.priorityMaxCandidates === 3, 'priorityMaxCandidates must be 3');
  assert(p.priorityPercentileMax === 10, 'priorityPercentileMax must be 10');
  assert(p.priorityRankMax === 50, 'priorityRankMax must be 50');
  assert(p.minRiskReward === 2, 'minRiskReward must be 2');
  assert(p.riskPerTradePct === 0.5, 'riskPerTradePct must be 0.5');
  assert(p.riskPerTradeHardCapPct === 1, 'riskPerTradeHardCapPct must be 1');
  assert(p.singleStockExposureMaxPct === 10, 'singleStockExposureMaxPct must be 10');
  assert(p.sectorExposureMaxPct === 20, 'sectorExposureMaxPct must be 20');
  assert(p.totalExposureMaxPct === 50, 'totalExposureMaxPct must be 50');
  assert(p.dailyLossLimitPct === 1.5, 'dailyLossLimitPct must be 1.5');
  assert(p.weeklyLossLimitPct === 4, 'weeklyLossLimitPct must be 4');

  const w = p.scoreWeights;
  const expected = {
    trend:18,
    momentum:8,
    volume:10,
    marketRegime:8,
    institutional:15,
    largeHolder:8,
    marginShortLending:6,
    fundamental:15,
    riskReward:12
  };
  assert(w && typeof w === 'object', 'strategyProfile.scoreWeights is required');
  if (w) for (const [key,val] of Object.entries(expected)) assert(w[key] === val, `scoreWeights.${key} must be ${val}`);
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
  const caps = {trend:18,momentum:8,volume:10,market_regime:8,institutional:15,large_holder:8,margin_short_lending:6,fundamental:15,risk_reward:12};
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

  if (c.decision === 'BUY') {
    buyCount += 1;
    assert(c.assetType === 'STOCK', `candidate ${code} ETF BUY requires independent ETF profile and is not allowed by STOCK v2 validator`);
    assert(allowedEntryStrategy.has(c.strategy), `candidate ${code} BUY strategy is not an allowed entry strategy`);
    assert(p?.marketRegime === 'BULL' || p?.marketRegime === 'NEUTRAL', `candidate ${code} BUY not allowed in ${p?.marketRegime}`);
    const threshold = p?.marketRegime === 'BULL' ? 82 : 86;
    assert(finite(c.score) && c.score >= threshold, `candidate ${code} BUY score below regime threshold ${threshold}`);
    assert(finite(c.liquidityMedianTurnover20d) && c.liquidityMedianTurnover20d >= 50000000, `candidate ${code} BUY liquidity below 50M median turnover`);
    assert(finite(c.riskReward) && c.riskReward >= 2, `candidate ${code} BUY riskReward below 2`);
    if (c.strategy === 'BREAKOUT') assert(finite(c.volumeRatio20d) && c.volumeRatio20d >= 1.5, `candidate ${code} BREAKOUT volumeRatio20d below 1.5`);
    if (c.universeRank !== null) assert(c.universeRank <= 50, `candidate ${code} BUY universeRank > 50`);
    if (c.universePercentile !== null) assert(c.universePercentile <= 10, `candidate ${code} BUY universePercentile > 10`);
    assert(finite(c.maxChase), `candidate ${code} BUY missing maxChase`);
    assert(typeof c.invalidCondition === 'string' && c.invalidCondition.trim(), `candidate ${code} BUY missing invalidCondition`);
    assert(!(n?.sourceQuality === 'SOURCE_C' && n?.direction === 'POSITIVE'), `candidate ${code} BUY cannot rely on positive SOURCE_C news`);
  }
}

assert(buyCount <= 3, `v2 BUY candidate count ${buyCount} exceeds priority max 3`);

if (errors.length) {
  console.error('STRATEGY V2 VALIDATION FAILED');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`STRATEGY V2 VALIDATION PASSED: ${manifest.revision}`);
