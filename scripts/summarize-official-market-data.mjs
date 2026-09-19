import fs from 'node:fs/promises';
import path from 'node:path';

const TZ = 'Asia/Taipei';
const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
const part = (type) => parts.find((p) => p.type === type)?.value;
const targetDate = process.env.TARGET_DATE || `${part('year')}-${part('month')}-${part('day')}`;
const dir = path.join('raw', targetDate);
const config = JSON.parse(await fs.readFile('strategy-config.json', 'utf8'));

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

function num(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value === null || value === undefined) return null;
  const text = String(value).replaceAll(',', '').trim();
  if (!text || text === '--' || text === '---' || text === 'N/A') return null;
  const n = Number(text.replace(/^\+/, ''));
  return Number.isFinite(n) ? n : null;
}

function codeOf(row) {
  return String(row['證券代號'] ?? row.SecuritiesCompanyCode ?? row['代號'] ?? row['證券代碼'] ?? row['證券代號/股票代號'] ?? '').trim();
}

function nameOf(row) {
  return String(row['證券名稱'] ?? row.CompanyName ?? row['名稱'] ?? row['證券名稱/股票名稱'] ?? '').trim();
}

function assetType(code) {
  if (/^00[0-9A-Z]{2,5}$/.test(code)) return 'ETF';
  if (/^\d{4}$/.test(code)) return 'STOCK';
  return 'OTHER';
}

function normalizeQuote(row, market) {
  const code = codeOf(row);
  const type = assetType(code);
  if (type === 'OTHER') return null;
  const close = num(row['收盤價'] ?? row.Close ?? row['收盤 ']);
  const open = num(row['開盤價'] ?? row.Open ?? row['開盤 ']);
  const high = num(row['最高價'] ?? row.High ?? row['最高 ']);
  const low = num(row['最低價'] ?? row.Low ?? row['最低']);
  const volume = num(row['成交股數'] ?? row.TradingShares ?? row['成交股數  ']);
  const turnover = num(row['成交金額'] ?? row.TransactionAmount ?? row[' 成交金額(元)']);
  if (!code || close === null || volume === null || turnover === null) return null;
  return { code, name: nameOf(row), market, assetType: type, open, high, low, close, volume, turnover };
}

function normalizeInstitution(row, market) {
  const code = codeOf(row);
  if (!code) return null;
  if (market === 'TWSE') {
    return {
      code,
      foreign: num(row['外陸資買賣超股數(不含外資自營商)']),
      investmentTrust: num(row['投信買賣超股數']),
      dealer: num(row['自營商買賣超股數']),
      total: num(row['三大法人買賣超股數']),
    };
  }
  return {
    code,
    foreign: num(row['Foreign Investors include Mainland Area Investors (Foreign Dealers excluded)-Difference'] ?? row['ForeignInvestorsInclude MainlandAreaInvestors-Difference']),
    investmentTrust: num(row['SecuritiesInvestmentTrustCompanies-Difference']),
    dealer: num(row['Dealers-Difference']),
    total: num(row.TotalDifference),
  };
}

async function rowsFrom(rel) {
  try {
    const text = await fs.readFile(rel, 'utf8');
    const parsed = JSON.parse(text);
    return uniqueRows([...tableRows(parsed), ...objectRows(parsed)]);
  } catch {
    return [];
  }
}

async function currentUniverseFor(date) {
  const base = path.join('raw', date);
  const [twseRows, tpexRows, twseInstRows, tpexInstRows] = await Promise.all([
    rowsFrom(path.join(base, 'twse-mi-index.raw.txt')),
    rowsFrom(path.join(base, 'tpex-mainboard-daily-close-quotes.raw.txt')),
    rowsFrom(path.join(base, 'twse-t86.raw.txt')),
    rowsFrom(path.join(base, 'tpex-3insti-daily-trading.raw.txt')),
  ]);

  const quoteMap = new Map();
  for (const { row } of twseRows) {
    const q = normalizeQuote(row, 'TWSE');
    if (q && !quoteMap.has(q.code)) quoteMap.set(q.code, q);
  }
  for (const { row } of tpexRows) {
    const q = normalizeQuote(row, 'TPEx');
    if (q && !quoteMap.has(q.code)) quoteMap.set(q.code, q);
  }

  const instMap = new Map();
  for (const { row } of twseInstRows) {
    const x = normalizeInstitution(row, 'TWSE');
    if (x) instMap.set(x.code, x);
  }
  for (const { row } of tpexInstRows) {
    const x = normalizeInstitution(row, 'TPEx');
    if (x) instMap.set(x.code, x);
  }

  return [...quoteMap.values()].map((q) => ({ ...q, institutional1d: instMap.get(q.code) ?? null }));
}

function median(values) {
  const a = values.filter(Number.isFinite).sort((a,b) => a-b);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m-1] + a[m]) / 2;
}

async function previousResearchCodes() {
  try {
    const manifest = JSON.parse(await fs.readFile('manifest.json', 'utf8'));
    const research = JSON.parse(await fs.readFile(manifest.researchPath, 'utf8'));
    return (research.candidates ?? []).map((c) => String(c.code ?? '')).filter(Boolean);
  } catch {
    return [];
  }
}

const universe = await currentUniverseFor(targetDate);
const stocks = universe.filter((x) => x.assetType === 'STOCK');
const etfs = universe.filter((x) => x.assetType === 'ETF');

const liquidToday = stocks
  .filter((x) => x.turnover >= config.liquidityMedianTurnover20dMin)
  .sort((a,b) => b.turnover - a.turnover);
const preferredToday = liquidToday.filter((x) => x.close <= config.pricePreference.preferredMaxTwd);
const priorCodes = await previousResearchCodes();
const deepDiveCodes = [...new Set([...preferredToday.slice(0, 300).map((x) => x.code), ...priorCodes])];

let rawDates = [];
try {
  rawDates = (await fs.readdir('raw', { withFileTypes: true }))
    .filter((x) => x.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(x.name) && x.name <= targetDate)
    .map((x) => x.name)
    .sort();
} catch {}

const histories = new Map(deepDiveCodes.map((code) => [code, []]));
for (const date of rawDates) {
  const daily = await currentUniverseFor(date);
  const wanted = new Set(deepDiveCodes);
  for (const row of daily) {
    if (!wanted.has(row.code)) continue;
    histories.get(row.code).push({
      date, open: row.open, high: row.high, low: row.low, close: row.close,
      volume: row.volume, turnover: row.turnover,
    });
  }
}

const currentByCode = new Map(universe.map((x) => [x.code, x]));
const deepDive = deepDiveCodes.map((code) => {
  const current = currentByCode.get(code) ?? null;
  const h = (histories.get(code) ?? []).sort((a,b) => a.date.localeCompare(b.date));
  const last20 = h.slice(-20);
  const medianTurnover20d = last20.length >= 20 ? median(last20.map((x) => x.turnover)) : null;
  const volumeMA20 = last20.length >= 20 ? last20.reduce((s,x) => s + x.volume, 0) / 20 : null;
  const volumeRatio20d = volumeMA20 && current ? current.volume / volumeMA20 : null;
  return {
    code,
    current,
    historyCoverageTradingDays: h.length,
    liquidityMedianTurnover20d: medianTurnover20d,
    volumeMA20,
    volumeRatio20d,
    liquidityGateReady: medianTurnover20d !== null,
    liquidityGatePass: medianTurnover20d !== null ? medianTurnover20d >= config.liquidityMedianTurnover20dMin : false,
    ma120Ready: h.length >= 120,
    history: h,
  };
});

let tdcc = { status: 'NOT_AVAILABLE', codeMatches: {} };
try {
  const tdccRows = await rowsFrom(path.join(dir, 'tdcc-shareholding-distribution.raw.txt'));
  const codeSet = new Set(deepDiveCodes);
  const codeMatches = {};
  for (const { row } of tdccRows) {
    const code = codeOf(row);
    if (!codeSet.has(code)) continue;
    (codeMatches[code] ??= []).push(row);
  }
  tdcc = { status: 'CAPTURED', codeMatches };
} catch {}

let gateMatrix = null;
try { gateMatrix = JSON.parse(await fs.readFile(path.join(dir, 'gate-matrix.json'), 'utf8')); } catch {}

const output = {
  schemaVersion: 2,
  targetDate,
  generatedAt: new Date().toISOString(),
  strategyVersion: config.version,
  gateMatrix,
  universeSummary: {
    total: universe.length,
    stocks: stocks.length,
    etfs: etfs.length,
    liquidTodayStocks: liquidToday.length,
    preferredPriceAndLiquidTodayStocks: preferredToday.length,
    deepDiveCount: deepDiveCodes.length,
  },
  universe,
  codes: deepDiveCodes,
  deepDive,
  tdcc,
  v2Readiness: {
    fullMarketCurrentSnapshot: universe.length > 0,
    dynamicUniverse: true,
    fixedTenCodeListRemoved: true,
    historicalFoldersAvailable: rawDates.length,
    buyHistoryReadyCount: deepDive.filter((x) => x.liquidityGateReady && x.ma120Ready).length,
    note: 'BUY must fail closed until required historical/TDCC/news/event evidence is verifiably available. Current-day turnover is not a substitute for the 20-day median turnover gate.',
  },
};

await fs.writeFile(path.join(dir, 'research-input.json'), JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify({
  targetDate,
  output: path.join(dir, 'research-input.json'),
  universeSummary: output.universeSummary,
  v2Readiness: output.v2Readiness,
}));
