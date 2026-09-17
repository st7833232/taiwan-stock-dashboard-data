import fs from 'node:fs';

const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
const research = JSON.parse(fs.readFileSync(manifest.researchPath, 'utf8'));
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

if (errors.length) {
  console.error('DASHBOARD CONTRACT VALIDATION FAILED');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`DASHBOARD CONTRACT VALIDATION PASSED: ${manifest.revision}`);
