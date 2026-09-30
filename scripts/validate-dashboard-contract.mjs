import fs from 'node:fs';

const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
const research = JSON.parse(fs.readFileSync(manifest.researchPath, 'utf8'));
const paper = JSON.parse(fs.readFileSync(manifest.paperAccountPath, 'utf8'));
const errors = [];

const nonBlank = (value) => typeof value === 'string' && value.trim().length > 0;
const placeholder = /(?:資料不足|資料失效|不在資料不足時執行|資料失效時重新評估)/;

if (!nonBlank(research.conclusion)) {
  errors.push('research.conclusion must be a non-blank Dashboard conclusion');
}

if (nonBlank(research?.decision?.summary) && research.decision.summary.trim() !== research.conclusion?.trim()) {
  errors.push('research.conclusion must equal decision.summary when decision.summary is present');
}

if (!Array.isArray(research.candidates)) {
  errors.push('research.candidates must be an array');
} else {
  for (const candidate of research.candidates) {
    const code = candidate?.code ?? '?';
    for (const field of ['thesis', 'avoid', 'entry']) {
      if ((candidate.reasonCodes ?? []).some(reason => typeof reason === 'string' && candidate[field]?.includes(reason))) {
        errors.push(`candidate ${code} ${field} exposes machine reason codes to Dashboard readers`);
      }
    }
    for (const field of ['avoid', 'invalid']) {
      const value = candidate?.[field];
      if (!nonBlank(value)) {
        errors.push(`candidate ${code} missing non-blank ${field}`);
      } else if (placeholder.test(value)) {
        errors.push(`candidate ${code} ${field} contains a forbidden placeholder: ${value}`);
      }
    }

    if (candidate?.group === 'priority') {
      if (!nonBlank(candidate.invalidCondition)) {
        errors.push(`priority candidate ${code} missing invalidCondition`);
      } else if (nonBlank(candidate.invalid) && candidate.invalid.trim() !== candidate.invalidCondition.trim()) {
        errors.push(`priority candidate ${code} invalid must equal invalidCondition`);
      }

      if (typeof candidate.maxChase !== 'number' || !Number.isFinite(candidate.maxChase)) {
        errors.push(`priority candidate ${code} missing finite maxChase`);
      }
    }
  }
}

// Mirror required values consumed by Dashboard parsePaperTradingAccount.
// A research-only check misses failures that discard the entire remote bundle.
const finite = value => typeof value === 'number' && Number.isFinite(value);
const textFields = (row, fields, prefix) => {
  for (const key of fields) if (!nonBlank(row?.[key])) errors.push(`${prefix}.${key} must be non-blank text`);
};
const numberFields = (row, fields, prefix) => {
  for (const key of fields) if (!finite(row?.[key])) errors.push(`${prefix}.${key} must be finite`);
};
const rows = (value, field) => {
  if (!Array.isArray(value)) { errors.push(`${field} must be an array`); return []; }
  return value;
};
textFields(paper, ['asOf', 'experimentTitle', 'statusLabel', 'description', 'rule', 'sourceNote', 'note'], 'paper');
numberFields(paper, ['initialCash', 'cash'], 'paper');
if (paper.currency !== 'TWD') errors.push('paper.currency must be TWD');
for (const [i, row] of rows(paper.positions, 'paper.positions').entries()) {
  const field = `paper.positions[${i}]`;
  textFields(row, ['code', 'name'], field);
  numberFields(row, ['shares', 'averageCost'], field);
  if (row.lastPrice !== undefined) numberFields(row, ['lastPrice'], field);
  if (!Number.isInteger(row.shares) || row.shares <= 0 || row.averageCost <= 0) errors.push(`${field} must have positive shares and averageCost`);
}
for (const [i, row] of rows(paper.ledger, 'paper.ledger').entries()) {
  const field = `paper.ledger[${i}]`;
  textFields(row, ['date', 'status', 'rationale'], field);
  numberFields(row, ['shares', 'fee', 'tax'], field);
  if (!Number.isInteger(row.shares) || row.shares < 0 || row.fee < 0 || row.tax < 0) errors.push(`${field} must have non-negative shares and fees`);
  for (const key of ['price', 'closePnl']) if (row[key] !== undefined) numberFields(row, [key], field);
  for (const key of ['code', 'name']) if (row[key] !== undefined) textFields(row, [key], field);
}
for (const [i, row] of rows(paper.rationale, 'paper.rationale').entries()) textFields(row, ['title', 'detail'], `paper.rationale[${i}]`);
for (const [i, row] of rows(paper.nextOrders, 'paper.nextOrders').entries()) {
  const field = `paper.nextOrders[${i}]`;
  textFields(row, ['tradingDate', 'code', 'name', 'executionRule', 'cancelCondition'], field);
  numberFields(row, ['shares'], field);
  if (!['buy', 'sell'].includes(row.side) || !Number.isInteger(row.shares) || row.shares <= 0) errors.push(`${field} must have valid side and positive shares`);
  for (const key of ['route', 'mutualExclusionGroup', 'estimatedAllocation', 'invalidation', 'note']) if (row[key] !== undefined) textFields(row, [key], field);
  for (const key of ['triggerPrice', 'maxChase', 'priority']) if (row[key] !== undefined) numberFields(row, [key], field);
}
textFields(paper.benchmark, ['date', 'etfCode'], 'paper.benchmark');
numberFields(paper.benchmark, ['accountReturn', 'taiexReturn', 'etfReturn'], 'paper.benchmark');
for (const key of ['cumulativeAccountReturn', 'cumulativeTaiexReturn', 'cumulativeEtfReturn']) if (paper.benchmark?.[key] !== undefined) numberFields(paper.benchmark, [key], 'paper.benchmark');
for (const [i, code] of rows(paper.monitorCodes, 'paper.monitorCodes').entries()) if (!nonBlank(code)) errors.push(`paper.monitorCodes[${i}] must be text`);

if (errors.length) {
  console.error('DASHBOARD CONTRACT VALIDATION FAILED');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`DASHBOARD CONTRACT VALIDATION PASSED: ${manifest.revision}`);
