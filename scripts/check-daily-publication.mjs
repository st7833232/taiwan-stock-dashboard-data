import fs from 'node:fs';
import path from 'node:path';

const TZ = 'Asia/Taipei';
const dateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const targetDate = process.env.TARGET_DATE || dateFmt.format(new Date());
const rawDir = path.join('raw', targetDate);
const gatePath = path.join(rawDir, 'gate-matrix.json');
const manifestPath = 'manifest.json';
const statePath = path.join(rawDir, 'publication-state.json');

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const exists = (p) => fs.existsSync(p);

let state = {
  targetDate,
  timezone: TZ,
  checkedAt: new Date().toISOString(),
  stage: 'CAPTURE_PENDING',
  gateStatus: 'UNKNOWN',
  manifestRevision: null,
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
      state.manifestRevision = manifest.revision || null;
      const paths = [manifest.researchPath, manifest.selectionHistoryPath, manifest.paperAccountPath];
      const pathsExist = paths.every((p) => typeof p === 'string' && exists(p));
      let datesMatch = false;
      let selectionUnique = false;
      if (pathsExist) {
        const research = readJson(manifest.researchPath);
        const history = readJson(manifest.selectionHistoryPath);
        const paper = readJson(manifest.paperAccountPath);
        datesMatch = research.researchDate === targetDate && research.latestTradingDate === targetDate && paper.asOf === targetDate;
        selectionUnique = Array.isArray(history) && history.filter((row) => row?.date === targetDate).length === 1;
      }
      const revisionMatches = typeof manifest.revision === 'string' && manifest.revision.startsWith(`${targetDate}-`);
      state.publicationComplete = revisionMatches && pathsExist && datesMatch && selectionUnique;
      if (state.publicationComplete) {
        state.stage = 'DATA_UPDATED';
        state.reason = 'Gate PASS and manifest plus all referenced snapshot files are complete for target date';
      } else {
        state.stage = 'RESEARCH_REQUIRED';
        state.reason = 'Official Gate PASS but manifest/snapshot publication is not complete for target date';
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
