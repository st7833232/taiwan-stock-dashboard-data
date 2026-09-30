import fs from 'node:fs';
import path from 'node:path';
import { creditReady, inputFingerprint } from './screen-market.mjs';

const TZ = 'Asia/Taipei';
const dateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const targetDate = process.env.TARGET_DATE || dateFmt.format(new Date());
const rawDir = path.join('raw', targetDate);
const gatePath = path.join(rawDir, 'gate-matrix.json');
const researchInputPath = path.join(rawDir, 'research-input.json');
const manifestPath = 'manifest.json';
const statePath = path.join(rawDir, 'publication-state.json');
const strategyConfigPath = 'strategy-config.json';

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const exists = (p) => fs.existsSync(p);
const normalizeHistory = (value) => Array.isArray(value) ? value : Array.isArray(value?.history) ? value.history : Array.isArray(value?.items) ? value.items : [];
const strategyConfig = exists(strategyConfigPath) ? readJson(strategyConfigPath) : null;
const requiredStrategyVersion = strategyConfig?.version ?? null;

let state = {
  targetDate,
  timezone: TZ,
  checkedAt: new Date().toISOString(),
  stage: 'CAPTURE_PENDING',
  gateStatus: 'UNKNOWN',
  manifestRevision: null,
  requiredStrategyVersion,
  currentStrategyVersion: null,
  strategyMatch: false,
  creditEvidenceReady: false,
  publicationUsesLatestResearchInput: false,
  publicationComplete: false,
  reason: null,
};

if (!exists(gatePath)) {
  state.reason = 'gate-matrix.json does not exist yet';
} else {
  const gate = readJson(gatePath);
  state.gateStatus = gate.overallStatus || 'UNKNOWN';
  if (state.gateStatus === 'PASS') {
    state.stage = 'GATE_PASS';
    if (exists(manifestPath)) {
      const manifest = readJson(manifestPath);
      const researchInput = exists(researchInputPath) ? readJson(researchInputPath) : null;
      const stockRows = (researchInput?.deepDive ?? []).filter(row => row.assetType === 'STOCK');
      const stockCount = researchInput ? stockRows.length : null;
      const marginReady = researchInput ? stockRows.filter(row => creditReady(row, strategyConfig)).length : null;
      const lendingReady = researchInput ? stockRows.filter(row => Number.isFinite(row.marginShortLending?.lendingBalance)).length : null;
      const requireMargin = strategyConfig?.creditEvidence?.requireMarginBalance === true || strategyConfig?.creditEvidence?.requireShortBalance === true;
      const requireLending = strategyConfig?.creditEvidence?.requireSecuritiesLending === true;
      const coverageReady = Number.isInteger(stockCount) && stockCount >= 0
        && (!requireMargin || (Number.isInteger(marginReady) && marginReady >= stockCount))
        && (!requireLending || (Number.isInteger(lendingReady) && lendingReady >= stockCount));
      state.creditEvidence = { stockCount, marginShortReadyCount: marginReady, securitiesLendingReadyCount: lendingReady, requireMargin, requireLending };
      state.creditEvidenceReady = coverageReady;
      // A refreshed generatedAt is not changed research evidence. Compare the content fingerprint below.
      state.manifestRevision = manifest.revision || null;
      const paths = [manifest.researchPath, manifest.selectionHistoryPath, manifest.paperAccountPath];
      const pathsExist = paths.every((p) => typeof p === 'string' && exists(p));
      const revisionDir = typeof manifest.revision === 'string' ? `snapshots/${manifest.revision}/` : null;
      const sameRevision = Boolean(revisionDir) && paths.every((p) => typeof p === 'string' && p.startsWith(revisionDir));
      let datesMatch = false;
      let selectionUnique = false;
      let strategyMatch = false;
      let publishedCreditFieldsReady = false;
      let screeningCurrent = false;
      let researchComplete = false;
      if (pathsExist) {
        const research = readJson(manifest.researchPath);
        const history = normalizeHistory(readJson(manifest.selectionHistoryPath));
        const paper = readJson(manifest.paperAccountPath);
        state.currentStrategyVersion = research.strategyVersion ?? null;
        strategyMatch = Boolean(requiredStrategyVersion) && research.strategyVersion === requiredStrategyVersion;
        state.strategyMatch = strategyMatch;
        researchComplete = research.researchComplete === true;
        screeningCurrent = research.screeningComplete === true && researchInput && research.inputFingerprint === inputFingerprint(researchInput, strategyConfig);
        state.publicationUsesLatestResearchInput = Boolean(screeningCurrent);
        state.screeningComplete = Boolean(screeningCurrent);
        state.researchComplete = researchComplete;
        datesMatch = research.researchDate === targetDate && research.latestTradingDate === targetDate && paper.asOf === targetDate;
        selectionUnique = history.filter((row) => row?.date === targetDate).length === 1;
        const stocks = (research.candidates ?? []).filter((row) => row?.assetType === 'STOCK');
        publishedCreditFieldsReady = stocks.every((row) => !requireMargin || row?.dataQuality?.margin === 'VALID')
          && stocks.every((row) => !requireLending || row?.dataQuality?.securitiesLending === 'VALID');
      }
      state.publishedCreditFieldsReady = publishedCreditFieldsReady;
      state.publicationComplete = sameRevision && pathsExist && datesMatch && selectionUnique && strategyMatch
        && coverageReady && screeningCurrent && researchComplete && publishedCreditFieldsReady;
      if (state.publicationComplete) {
        state.stage = 'DATA_UPDATED';
        state.reason = 'Gate PASS, required credit evidence is complete, and manifest references research built from the latest research input';
      } else if (sameRevision && pathsExist && datesMatch && selectionUnique && strategyMatch && screeningCurrent) {
        state.stage = 'SCREENING_UPDATED_EVIDENCE_PENDING';
        state.reason = 'Snapshot and full-universe screening are current; required per-stock credit or research evidence is unfinished. This is not a completed research publication. Retry only changed evidence.';
      } else {
        state.stage = 'RESEARCH_REQUIRED';
        state.reason = !coverageReady
          ? 'Official Gate PASS but required margin/short/lending coverage is incomplete'
          : !state.publicationUsesLatestResearchInput
            ? 'Official Gate PASS and credit evidence is ready, but the published snapshot predates the latest research input'
            : !publishedCreditFieldsReady
              ? 'Published stock candidates do not contain VALID required credit evidence'
              : !strategyMatch
          ? `Official Gate PASS but current publication strategyVersion=${state.currentStrategyVersion ?? 'missing'} does not match required strategyVersion=${requiredStrategyVersion ?? 'missing'}`
          : 'Official Gate PASS but manifest/snapshot publication is not complete for target date';
      }
    }
  } else if (state.gateStatus === 'CONFIRMED_MISSING') {
    state.stage = 'NO_UPDATE';
    state.reason = 'Official Gate confirmed target-date data missing';
  } else {
    state.stage = 'VERIFY_FAILED';
    state.reason = 'Official Gate is not PASS';
  }
}

fs.mkdirSync(rawDir, { recursive: true });
fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
console.log(JSON.stringify(state, null, 2));

if (process.env.FAIL_IF_INCOMPLETE === '1' && state.stage === 'RESEARCH_REQUIRED') {
  console.error(`::error::${state.reason}. Retry research/paper-account publication; do not recapture a locked PASS Gate.`);
  process.exitCode = 2;
}
