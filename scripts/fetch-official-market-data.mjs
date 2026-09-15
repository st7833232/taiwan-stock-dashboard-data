import fs from 'node:fs/promises';
import path from 'node:path';

const TZ = 'Asia/Taipei';
const now = new Date();
const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
const value = (type) => parts.find((p) => p.type === type)?.value;
const targetDate = process.env.TARGET_DATE || `${value('year')}-${value('month')}-${value('day')}`;
const compact = targetDate.replaceAll('-', '');
const outDir = path.join('raw', targetDate);
await fs.mkdir(outDir, { recursive: true });

const sources = [
  { id: 'twse-stock-day-all', institution: 'TWSE', kind: 'daily-close-quotes', url: 'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL' },
  { id: 'twse-mi-index', institution: 'TWSE', kind: 'market-close-statistics', url: 'https://openapi.twse.com.tw/v1/exchangeReport/MI_INDEX' },
  { id: 'twse-fmtqik', institution: 'TWSE', kind: 'market-turnover', url: 'https://openapi.twse.com.tw/v1/exchangeReport/FMTQIK' },
  { id: 'twse-t86', institution: 'TWSE', kind: 'individual-institutional', url: `https://www.twse.com.tw/rwd/zh/fund/T86?date=${compact}&selectType=ALL&response=json` },
  { id: 'tpex-mainboard-daily-close-quotes', institution: 'TPEx', kind: 'daily-close-quotes', url: 'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes' },
  { id: 'tpex-daily-trading-index', institution: 'TPEx', kind: 'market-turnover-index', url: 'https://www.tpex.org.tw/openapi/v1/tpex_daily_trading_index' },
  { id: 'tpex-3insti-daily-trading', institution: 'TPEx', kind: 'individual-institutional', url: 'https://www.tpex.org.tw/openapi/v1/tpex_3insti_daily_trading' },
  { id: 'tpex-3insti-summary', institution: 'TPEx', kind: 'institutional-summary', url: 'https://www.tpex.org.tw/openapi/v1/tpex_3insti_summary' },
];

function dateVariants(date) {
  const [y, m, d] = date.split('-').map(Number);
  const mm = String(m).padStart(2, '0');
  const dd = String(d).padStart(2, '0');
  const roc = y - 1911;
  return new Set([date, `${y}/${mm}/${dd}`, `${y}${mm}${dd}`, `${roc}/${mm}/${dd}`, `${roc}${mm}${dd}`]);
}

function findOfficialDate(value, variants) {
  const text = JSON.stringify(value);
  for (const v of variants) if (text.includes(v)) return v;
  return null;
}

async function capture(source) {
  const capturedAt = new Date().toISOString();
  const result = { source: source.id, institution: source.institution, kind: source.kind, url: source.url, targetDate, capturedAt, status: 'VERIFY_FAILED' };
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
    if (!response.ok) { result.error = `HTTP ${response.status}`; return result; }
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = text; }
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

const captures = [];
for (const source of sources) captures.push(await capture(source));
const requiredKinds = ['daily-close-quotes', 'market-close-statistics', 'market-turnover', 'market-turnover-index', 'individual-institutional', 'institutional-summary'];
const matrix = { targetDate, timezone: TZ, generatedAt: new Date().toISOString(), requiredKinds, captures };
await fs.writeFile(path.join(outDir, 'gate-matrix.json'), JSON.stringify(matrix, null, 2) + '\n');
console.log(JSON.stringify(matrix, null, 2));
