import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = process.cwd();
const errors = [];
const LEGACY_REVISIONS = new Set(['2026-09-01-140000', '2026-09-02-141615']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const REV_RE = /^\d{4}-\d{2}-\d{2}-\d{6}$/;
const CODE_RE = /^\d{4,6}[A-Z]?$/;
const TPE_ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?\+08:00$/;
const EPS = 1e-6;

function fail(message) {
  errors.push(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function readJson(rel) {
  const full = path.join(ROOT, rel);
  assert(fs.existsSync(full), `missing file: ${rel}`);
  if (!fs.existsSync(full)) return null;
  try {
    return JSON.parse(fs.readFileSync(full, 'utf8'));
  } catch (error) {
    fail(`invalid JSON: ${rel}: ${error.message}`);
    return null;
  }
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function validCode(code) {
  return typeof code === 'string' && CODE_RE.test(code);
}

function collectStrings(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => collectStrings(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => collectStrings(v, out));
  return out;
}

function getGitChanges() {
  try {
    const text = execFileSync('git', ['diff', '--name-status', 'HEAD^', 'HEAD'], { encoding: 'utf8' }).trim();
    if (!text) return [];
    return text.split('\n').map((line) => {
      const parts = line.split('\t');
      return { status: parts[0], path: parts.at(-1) };
    });
  } catch {
    return [];
  }
}

const manifest = readJson('manifest.json');
if (!manifest) {
  console.error(errors.join('\n'));
  process.exit(1);
}

assert(manifest.schemaVersion === 1, 'manifest.schemaVersion must remain 1 unless an explicit compatibility migration is approved');
assert(typeof manifest.revision === 'string' && REV_RE.test(manifest.revision), 'manifest.revision must be YYYY-MM-DD-HHmmss');
assert(typeof manifest.updatedAt === 'string' && TPE_ISO_RE.test(manifest.updatedAt), 'manifest.updatedAt must be full ISO 8601 with +08:00');
assert(!Number.isNaN(Date.parse(manifest.updatedAt)), 'manifest.updatedAt is not parseable');

const expected = {
  researchPath: `snapshots/${manifest.revision}/research.json`,
  selectionHistoryPath: `snapshots/${manifest.revision}/selection-history.json`,
  paperAccountPath: `snapshots/${manifest.revision}/paper-account.json`,
};
for (const [key, expectedPath] of Object.entries(expected)) {
  assert(manifest[key] === expectedPath, `${key} must point to ${expectedPath}`);
}

const research = readJson(manifest.researchPath);
const history = readJson(manifest.selectionHistoryPath);
const paper = readJson(manifest.paperAccountPath);

if (research) {
  assert(typeof research === 'object' && !Array.isArray(research), 'research.json must be an object');
  assert(DATE_RE.test(research.researchDate ?? ''), 'research.researchDate must be YYYY-MM-DD');
  assert(DATE_RE.test(research.latestTradingDate ?? ''), 'research.latestTradingDate must be YYYY-MM-DD');
  if (!LEGACY_REVISIONS.has(manifest.revision)) {
    assert(research.researchDate === research.latestTradingDate, 'new revisions require researchDate === latestTradingDate');
  }
  assert(Array.isArray(research.candidates), 'research.candidates must be an array');
  for (const c of research.candidates ?? []) {
    assert(validCode(c.code), `invalid candidate code: ${c.code}`);
    assert(typeof c.group === 'string' && c.group.length > 0, `candidate ${c.code} missing group`);
    assert(typeof c.rating === 'string' && c.rating.length > 0, `candidate ${c.code} missing rating`);
  }
}

if (history) {
  assert(Array.isArray(history), 'selection-history.json must be an array');
  const seenDates = new Set();
  for (const row of history ?? []) {
    assert(DATE_RE.test(row.date ?? ''), `invalid selection-history date: ${row.date}`);
    if (seenDates.has(row.date)) fail(`duplicate selection-history date: ${row.date}`);
    seenDates.add(row.date);
    assert(Array.isArray(row.selected), `selection-history ${row.date} selected must be an array`);
    const selectedSeen = new Set();
    for (const code of row.selected ?? []) {
      assert(validCode(code), `invalid selected code ${code} on ${row.date}`);
      if (selectedSeen.has(code)) fail(`duplicate selected code ${code} on ${row.date}`);
      selectedSeen.add(code);
    }
  }

  if (research?.researchDate) {
    const latest = history.at(-1);
    assert(latest?.date === research.researchDate, 'latest selection-history date must equal research.researchDate');
    const eligible = new Set((research.candidates ?? [])
      .filter((c) => c.group === 'priority' && /^A(?:[+-])?(?=\s|\/|／|$)/.test(c.rating ?? ''))
      .map((c) => c.code));
    for (const code of latest?.selected ?? []) {
      assert(eligible.has(code), `selected code ${code} is not priority + A-tier in current research`);
    }
  }
}

if (paper) {
  assert(typeof paper === 'object' && !Array.isArray(paper), 'paper-account.json must be an object');
  assert(DATE_RE.test(paper.asOf ?? ''), 'paper.asOf must be YYYY-MM-DD');
  assert(paper.initialCash === 200000, 'paper.initialCash must remain 200000 TWD');
  assert(paper.currency === 'TWD', 'paper.currency must be TWD');
  assert(isFiniteNumber(paper.cash) && paper.cash >= 0, 'paper.cash must be a non-negative number');
  assert(Array.isArray(paper.positions), 'paper.positions must be an array');
  assert(Array.isArray(paper.ledger), 'paper.ledger must be an array');
  assert(Array.isArray(paper.nextOrders), 'paper.nextOrders must be an array');

  if (!LEGACY_REVISIONS.has(manifest.revision) && research?.researchDate) {
    assert(paper.asOf === research.researchDate, 'new revisions require paper.asOf === research.researchDate');
  }
  if (paper.benchmark?.date) {
    assert(paper.benchmark.date === paper.asOf, 'benchmark.date must equal paper.asOf');
  }

  const positionCodes = new Set();
  for (const pos of paper.positions ?? []) {
    assert(validCode(pos.code), `invalid position code: ${pos.code}`);
    if (positionCodes.has(pos.code)) fail(`duplicate position code: ${pos.code}`);
    positionCodes.add(pos.code);
    assert(Number.isInteger(pos.shares) && pos.shares > 0, `position ${pos.code} shares must be a positive integer`);
    assert(isFiniteNumber(pos.averageCost) && pos.averageCost >= 0, `position ${pos.code} averageCost invalid`);
    assert(isFiniteNumber(pos.lastPrice) && pos.lastPrice >= 0, `position ${pos.code} lastPrice invalid`);
  }

  let rebuiltCash = paper.initialCash;
  const rebuilt = new Map();
  const getHolding = (code) => {
    if (!rebuilt.has(code)) rebuilt.set(code, { shares: 0, costBasis: 0 });
    return rebuilt.get(code);
  };

  for (const entry of paper.ledger ?? []) {
    assert(DATE_RE.test(entry.date ?? ''), `invalid ledger date: ${entry.date}`);
    const isTrade = validCode(entry.code) && (entry.side === 'buy' || entry.side === 'sell') && Number.isInteger(entry.shares) && entry.shares > 0 && isFiniteNumber(entry.price) && entry.price > 0;

    if (isTrade) {
      const fee = isFiniteNumber(entry.fee) ? entry.fee : 0;
      const tax = isFiniteNumber(entry.tax) ? entry.tax : 0;
      assert(fee >= 0 && tax >= 0, `negative fee/tax in ledger ${entry.date} ${entry.code}`);
      const gross = entry.price * entry.shares;
      const h = getHolding(entry.code);

      if (entry.side === 'buy') {
        rebuiltCash -= gross + fee + tax;
        h.shares += entry.shares;
        h.costBasis += gross + fee + tax;
      } else {
        assert(h.shares >= entry.shares, `sell exceeds rebuilt holding for ${entry.code} on ${entry.date}`);
        const avg = h.shares > 0 ? h.costBasis / h.shares : 0;
        rebuiltCash += gross - fee - tax;
        h.shares -= entry.shares;
        h.costBasis -= avg * entry.shares;
      }
    } else {
      if (isFiniteNumber(entry.cashDelta)) rebuiltCash += entry.cashDelta;
      if (validCode(entry.code) && isFiniteNumber(entry.sharesDelta)) {
        const h = getHolding(entry.code);
        h.shares += entry.sharesDelta;
        if (isFiniteNumber(entry.costBasisDelta)) h.costBasis += entry.costBasisDelta;
      }
    }
  }

  assert(Math.abs(rebuiltCash - paper.cash) <= EPS, `paper.cash is not reproducible from ledger: expected ${rebuiltCash}, got ${paper.cash}`);

  const actualByCode = new Map((paper.positions ?? []).map((p) => [p.code, p]));
  const allCodes = new Set([...rebuilt.keys(), ...actualByCode.keys()]);
  for (const code of allCodes) {
    const h = rebuilt.get(code) ?? { shares: 0, costBasis: 0 };
    const p = actualByCode.get(code);
    if (h.shares === 0) {
      assert(!p, `position ${code} exists but rebuilt ledger holding is zero`);
      continue;
    }
    assert(Boolean(p), `position ${code} missing from positions`);
    if (!p) continue;
    assert(p.shares === h.shares, `position ${code} shares mismatch: expected ${h.shares}, got ${p.shares}`);
    const rebuiltAvg = h.costBasis / h.shares;
    assert(Math.abs(rebuiltAvg - p.averageCost) <= EPS, `position ${code} averageCost mismatch: expected ${rebuiltAvg}, got ${p.averageCost}`);
  }

  for (const order of paper.nextOrders ?? []) {
    assert(DATE_RE.test(order.tradingDate ?? ''), `nextOrder ${order.code ?? '?'} missing valid tradingDate`);
    assert(order.tradingDate > paper.asOf, `nextOrder ${order.code ?? '?'} tradingDate must be after paper.asOf`);
    assert(validCode(order.code), `invalid nextOrder code: ${order.code}`);
    assert(order.side === 'buy' || order.side === 'sell', `nextOrder ${order.code} side must be buy/sell`);
    assert(Number.isInteger(order.shares) && order.shares > 0, `nextOrder ${order.code} shares must be positive integer`);
    assert(typeof order.executionRule === 'string' && order.executionRule.trim(), `nextOrder ${order.code} missing executionRule`);
    assert(typeof order.cancelCondition === 'string' && order.cancelCondition.trim(), `nextOrder ${order.code} missing cancelCondition`);
  }
}

for (const [name, obj] of [['research', research], ['selection-history', history], ['paper-account', paper]]) {
  for (const text of collectStrings(obj)) {
    if (/(?:github_pat_[A-Za-z0-9_]+|gh[pousr]_[A-Za-z0-9]+|sk-[A-Za-z0-9_-]{20,}|Bearer\s+[A-Za-z0-9._-]{20,})/.test(text)) {
      fail(`possible secret detected in ${name}`);
      break;
    }
  }
}

const changes = getGitChanges();
if (changes.length) {
  const manifestChanged = changes.some((c) => c.path === 'manifest.json' && c.status !== 'D');
  const snapshotChanges = changes.filter((c) => c.path.startsWith('snapshots/'));

  for (const c of snapshotChanges) {
    assert(c.status === 'A', `existing snapshot files are immutable: ${c.status} ${c.path}`);
  }

  if (snapshotChanges.length > 0) {
    assert(manifestChanged, 'adding snapshot files requires manifest.json to change in the same commit');
  }

  if (manifestChanged) {
    const added = new Set(changes.filter((c) => c.status === 'A').map((c) => c.path));
    for (const rel of Object.values(expected)) {
      assert(added.has(rel), `manifest update must add ${rel} in the same commit`);
    }
  }
}

if (errors.length) {
  console.error('DATA VALIDATION FAILED');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`DATA VALIDATION PASSED: ${manifest.revision}`);
