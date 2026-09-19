import fs from 'node:fs/promises';
import path from 'node:path';

const TZ = 'Asia/Taipei';
const now = new Date();
const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
const value = (type) => parts.find((p) => p.type === type)?.value;
const todayDate = `${value('year')}-${value('month')}-${value('day')}`;
const targetDate = process.env.TARGET_DATE || todayDate;
const compact = targetDate.replaceAll('-', '');
const [year, month, day] = targetDate.split('-').map(Number);
const mm = String(month).padStart(2, '0');
const dd = String(day).padStart(2, '0');
const rocYear = year - 1911;
const rocDate = `${rocYear}/${mm}/${dd}`;
const outDir = path.join('raw', targetDate);
await fs.mkdir(outDir, { recursive: true });
const matrixPath = path.join(outDir, 'gate-matrix.json');

const twseMiIndexUrl = `https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?date=${compact}&type=ALL&response=json`;
const sources = [
  { id: 'twse-mi-index-daily-close', gate: 'twse-daily-close-quotes', institution: 'TWSE', kind: 'daily-close-quotes', url: twseMiIndexUrl },
  { id: 'twse-mi-index', gate: 'twse-market-close-statistics', institution: 'TWSE', kind: 'market-close-statistics', url: twseMiIndexUrl },
  { id: 'twse-fmtqik', gate: 'twse-market-turnover', institution: 'TWSE', kind: 'market-turnover', url: `https://www.twse.com.tw/rwd/zh/afterTrading/FMTQIK?date=${compact}&response=json` },
  { id: 'twse-t86', gate: 'twse-individual-institutional', institution: 'TWSE', kind: 'individual-institutional', url: `https://www.twse.com.tw/rwd/zh/fund/T86?date=${compact}&selectType=ALL&response=json` },
  { id: 'tpex-mainboard-daily-close-quotes', gate: 'tpex-daily-close-quotes', institution: 'TPEx', kind: 'daily-close-quotes', url: 'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes' },
  { id: 'tpex-mainboard-daily-close-quotes-legacy', gate: 'tpex-daily-close-quotes', institution: 'TPEx', kind: 'daily-close-quotes', url: `https://www.tpex.org.tw/web/stock/aftertrading/otc_quotes_no1430/stk_wn1430_result.php?l=zh-tw&d=${rocDate}&se=EW&o=json` },
  { id: 'tpex-daily-trading-index', gate: 'tpex-market-turnover-index', institution: 'TPEx', kind: 'market-turnover-index', url: 'https://www.tpex.org.tw/openapi/v1/tpex_daily_trading_index' },
  { id: 'tpex-3insti-daily-trading', gate: 'tpex-individual-institutional', institution: 'TPEx', kind: 'individual-institutional', url: 'https://www.tpex.org.tw/openapi/v1/tpex_3insti_daily_trading' },
  { id: 'tpex-3insti-summary', gate: 'tpex-institutional-summary', institution: 'TPEx', kind: 'institutional-summary', url: 'https://www.tpex.org.tw/openapi/v1/tpex_3insti_summary' },
  { id: 'tdcc-shareholding-distribution', gate: null, institution: 'TDCC', kind: 'shareholding-distribution', url: 'https://openapi.tdcc.com.tw/v1/opendata/1-5', latestOnly: true },
];

const requiredGates = [
  'twse-daily-close-quotes',
  'twse-market-close-statistics',
  'twse-market-turnover',
  'twse-individual-institutional',
  'tpex-daily-close-quotes',
  'tpex-market-turnover-index',
  'tpex-individual-institutional',
  'tpex-institutional-summary',
];

function dateVariants(date) {
  const [y, m, d] = date.split('-').map(Number);
  const m2 = String(m).padStart(2, '0');
  const d2 = String(d).padStart(2, '0');
  const roc = y - 1911;
  return new Set([
    date, `${y}/${m2}/${d2}`, `${y}${m2}${d2}`, `${y}年${m2}月${d2}日`,
    `${roc}/${m2}/${d2}`, `${roc}${m2}${d2}`, `${roc}年${m2}月${d2}日`,
  ]);
}

function findOfficialDate(value, variants) {
  const text = JSON.stringify(value);
  for (const v of variants) if (text.includes(v)) return v;
  return null;
}

async function readPreviousMatrix() {
  try {
    const parsed = JSON.parse(await fs.readFile(matrixPath, 'utf8'));
    return parsed?.targetDate === targetDate ? parsed : null;
  } catch {
    return null;
  }
}

async function capture(source) {
  const capturedAt = new Date().toISOString();
  const result = { source: source.id, gate: source.gate, institution: source.institution, kind: source.kind, url: source.url, targetDate, capturedAt, status: 'VERIFY_FAILED' };
  if (source.latestOnly && targetDate !== todayDate) {
    return { ...result, status: 'NOT_CAPTURED_RETROSPECTIVE', note: 'Latest-only auxiliary source skipped for a historical target date to prevent hindsight leakage.' };
  }
  try {
    const response = await fetch(source.url, {
      headers: { accept: 'application/json,text/plain,*/*', 'user-agent': 'taiwan-stock-dashboard-data/official-market-capture' },
      redirect: 'follow',
      signal: AbortSignal.timeout(30000),
    });
    result.httpStatus = response.status;
    result.contentType = response.headers.get('content-type');
    const text = await response.text();
    result.bytes = Buffer.byteLength(text);
    await fs.writeFile(path.join(outDir, `${source.id}.raw.txt`), text);
    if (!response.ok) {
      result.error = `HTTP ${response.status}`;
      return result;
    }
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = text; }
    if (!source.gate) {
      result.status = 'CAPTURED';
      result.note = 'Auxiliary source captured; it is not part of the daily publication Gate.';
      return result;
    }
    const matchedDate = findOfficialDate(parsed, dateVariants(targetDate));
    result.officialDateEvidence = matchedDate;
    result.status = matchedDate ? 'PASS' : 'VERIFY_FAILED';
    if (!matchedDate) result.note = 'Readable official payload obtained, but affirmative target-date evidence was not found; do not classify as missing.';
    return result;
  } catch (error) {
    result.error = String(error?.message || error);
    return result;
  }
}

const previousMatrix = await readPreviousMatrix();
const priorPassBySource = new Map((previousMatrix?.captures || []).filter((c) => c.status === 'PASS').map((c) => [c.source, c]));
const captures = [];
for (const source of sources) {
  const attempt = await capture(source);
  const prior = priorPassBySource.get(source.id);
  if (source.gate && attempt.status !== 'PASS' && prior) {
    captures.push({ ...prior, gate: source.gate, preservedPass: true, latestAttempt: attempt });
  } else {
    captures.push(attempt);
  }
}

const gates = requiredGates.map((gate) => {
  const evidence = captures.filter((c) => c.gate === gate);
  const pass = evidence.find((c) => c.status === 'PASS');
  return pass
    ? { gate, status: 'PASS', source: pass.source, officialDateEvidence: pass.officialDateEvidence }
    : { gate, status: 'VERIFY_FAILED', sources: evidence.map((c) => c.source), note: 'No official source produced affirmative target-date evidence in this run or a preserved prior PASS.' };
});
const overallStatus = gates.every((g) => g.status === 'PASS') ? 'PASS' : 'VERIFY_FAILED';
const matrix = { targetDate, timezone: TZ, generatedAt: new Date().toISOString(), overallStatus, requiredGates, gates, captures };
await fs.writeFile(matrixPath, JSON.stringify(matrix, null, 2) + '\n');
console.log(JSON.stringify(matrix, null, 2));
