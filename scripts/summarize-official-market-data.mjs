import fs from 'node:fs/promises';
import path from 'node:path';

const TZ = 'Asia/Taipei';
const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
const part = (type) => parts.find((p) => p.type === type)?.value;
const targetDate = process.env.TARGET_DATE || `${part('year')}-${part('month')}-${part('day')}`;
const compact = targetDate.replaceAll('-', '');
const [y, m, d] = targetDate.split('-').map(Number);
const roc = `${y - 1911}${String(m).padStart(2, '0')}${String(d).padStart(2, '0')}`;
const dateVariants = [targetDate, compact, `${y}/${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}`, roc, `${y - 1911}/${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}`];
const dir = path.join('raw', targetDate);
const codes = ['1513','2303','0050','4961','6770','2884','00981A','3231','2409','1815'];
const files = [
  'twse-mi-index.raw.txt',
  'twse-fmtqik.raw.txt',
  'twse-t86.raw.txt',
  'tpex-mainboard-daily-close-quotes.raw.txt',
  'tpex-mainboard-daily-close-quotes-legacy.raw.txt',
  'tpex-daily-trading-index.raw.txt',
  'tpex-3insti-daily-trading.raw.txt',
  'tpex-3insti-summary.raw.txt',
];

function tableRows(value, label = 'root', out = []) {
  if (!value || typeof value !== 'object') return out;
  if (Array.isArray(value)) {
    for (const item of value) tableRows(item, label, out);
    return out;
  }
  for (const [key, fields] of Object.entries(value)) {
    const match = key.match(/^fields(\d*)$/);
    if (!match || !Array.isArray(fields)) continue;
    const dataKey = `data${match[1]}`;
    const data = value[dataKey];
    if (!Array.isArray(data)) continue;
    for (const row of data) {
      if (!Array.isArray(row)) continue;
      const obj = {};
      fields.forEach((field, i) => { obj[String(field)] = row[i]; });
      out.push({ table: `${label}.${dataKey}`, row: obj });
    }
  }
  for (const [key, child] of Object.entries(value)) {
    if (child && typeof child === 'object') tableRows(child, `${label}.${key}`, out);
  }
  return out;
}

function objectRows(value, label = 'root', out = []) {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const item = value[i];
      if (item && !Array.isArray(item) && typeof item === 'object') out.push({ table: `${label}[${i}]`, row: item });
      objectRows(item, `${label}[${i}]`, out);
    }
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) objectRows(child, `${label}.${key}`, out);
  }
  return out;
}

function uniqueRows(rows) {
  const seen = new Set();
  return rows.filter((x) => {
    const key = JSON.stringify(x.row);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function hasExactValue(row, value) {
  return Object.values(row).some((v) => String(v ?? '').trim() === value);
}

const summary = { targetDate, generatedAt: new Date().toISOString(), codes, sources: {} };
for (const file of files) {
  try {
    const text = await fs.readFile(path.join(dir, file), 'utf8');
    const parsed = JSON.parse(text);
    const rows = uniqueRows([...tableRows(parsed), ...objectRows(parsed)]);
    const codeMatches = {};
    for (const code of codes) {
      const matches = rows.filter(({ row }) => hasExactValue(row, code)).slice(0, 8);
      if (matches.length) codeMatches[code] = matches;
    }
    const keywordMatches = rows.filter(({ row }) => {
      const s = JSON.stringify(row);
      return s.includes('發行量加權股價指數') || s.includes('成交金額') || s.includes('櫃買指數') || s.includes('三大法人') || s.includes('合計');
    }).slice(0, 30);
    const targetDateMatches = rows.filter(({ row }) => {
      const s = JSON.stringify(row);
      return dateVariants.some((v) => s.includes(v));
    }).slice(0, 30);
    summary.sources[file] = {
      bytes: Buffer.byteLength(text),
      topLevelDate: parsed?.date ?? parsed?.Date ?? parsed?.reportDate ?? null,
      codeMatches,
      keywordMatches,
      targetDateMatches,
    };
  } catch (error) {
    summary.sources[file] = { error: String(error?.message || error) };
  }
}

try {
  summary.gateMatrix = JSON.parse(await fs.readFile(path.join(dir, 'gate-matrix.json'), 'utf8'));
} catch {}

await fs.writeFile(path.join(dir, 'research-input.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify({ targetDate, output: path.join(dir, 'research-input.json'), sourceCount: Object.keys(summary.sources).length }));
