import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { getHistoricalCandles } from './toss-api/market.js';
import type { FilledOrder } from './toss-api/orders.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../data');

const RISK_FREE = 0.045;
const DAYS_PER_YEAR = 252;

const MACRO_FACTORS = [
  { symbol: 'SPY',  label: 'S&P 500' },
  { symbol: 'QQQ',  label: '나스닥 100' },
  { symbol: 'TLT',  label: '미국 장기채' },
  { symbol: 'GLD',  label: '금' },
  { symbol: 'UUP',  label: '달러 인덱스' },
  { symbol: 'VIXY', label: '변동성 (VIX)' },
  { symbol: 'XLE',  label: '에너지' },
  { symbol: 'XLK',  label: '테크' },
];

function sanitize(raw: Record<string, number>): Record<string, number> {
  const dates = Object.keys(raw).sort();
  const result: Record<string, number> = {};
  let prev = 0;
  for (const d of dates) {
    const c = raw[d];
    if (prev > 0 && (c / prev > 1.7 || c / prev < 1 / 1.7)) result[d] = prev;
    else { result[d] = c; prev = c; }
  }
  return result;
}

function nearestRate(rates: Record<string, number>, date: string): number {
  const prior = Object.keys(rates).sort().filter(d => d <= date).pop();
  return prior ? rates[prior] : 1380;
}

function applyOrder(pos: Record<string, number>, o: FilledOrder) {
  if (o.side === 'BUY') pos[o.symbol] = (pos[o.symbol] ?? 0) + o.filledQuantity;
  else {
    const rem = (pos[o.symbol] ?? 0) - o.filledQuantity;
    if (rem <= 0.0001) delete pos[o.symbol];
    else pos[o.symbol] = rem;
  }
}

function pearson(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  const ma = a.slice(0, n).reduce((s, v) => s + v, 0) / n;
  const mb = b.slice(0, n).reduce((s, v) => s + v, 0) / n;
  let cov = 0, va = 0, vb = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma, db = b[i] - mb;
    cov += da * db; va += da * da; vb += db * db;
  }
  const denom = Math.sqrt(va * vb);
  return denom === 0 ? 0 : cov / denom;
}

function beta(port: number[], factor: number[]): number {
  const n = Math.min(port.length, factor.length);
  if (n < 2) return 0;
  const mb = factor.slice(0, n).reduce((s, v) => s + v, 0) / n;
  let cov = 0, vb = 0;
  const mp = port.slice(0, n).reduce((s, v) => s + v, 0) / n;
  for (let i = 0; i < n; i++) {
    cov += (port[i] - mp) * (factor[i] - mb);
    vb += (factor[i] - mb) ** 2;
  }
  return vb === 0 ? 0 : cov / vb;
}

export async function getMacroSensitivity() {
  const raw = JSON.parse(await fs.readFile(path.join(DATA_DIR, 'orders-cache.json'), 'utf-8'));
  const allOrders: FilledOrder[] = raw.orders;

  const BLACKLIST = new Set(['GTIJF']);
  const orders = allOrders.filter(o => !BLACKLIST.has(o.symbol));
  if (!orders.length) return null;

  const fromDate = orders[0].filledAt.split('T')[0];
  const toDate = new Date().toISOString().split('T')[0];

  const symbolCurrency: Record<string, 'KRW' | 'USD'> = {};
  for (const o of orders) symbolCurrency[o.symbol] = o.currency;
  const symbols = Object.keys(symbolCurrency);

  const fxRaw = JSON.parse(await fs.readFile(path.join(DATA_DIR, 'fx-rates.json'), 'utf-8'));
  const fxRates: Record<string, number> = fxRaw.rates;

  // 포트폴리오 심볼 + 매크로 심볼 모두 로드
  const allSymbols = [...new Set([...symbols, ...MACRO_FACTORS.map(f => f.symbol)])];
  const closesMap: Record<string, Record<string, number>> = {};
  await Promise.all(allSymbols.map(async (sym) => {
    try {
      const candles = await getHistoricalCandles(sym, fromDate);
      const raw2 = Object.fromEntries(candles.map(c => [c.date, c.close]));
      closesMap[sym] = sanitize(raw2);
    } catch { closesMap[sym] = {}; }
  }));

  // 공통 거래일
  const dates = [...new Set(Object.values(closesMap).flatMap(m => Object.keys(m)))]
    .filter(d => d >= fromDate && d <= toDate).sort();

  // TWR 계산
  const sortedOrders = [...orders].sort((a, b) => a.filledAt.localeCompare(b.filledAt));
  const positions: Record<string, number> = {};
  let orderIdx = 0;
  let cumReturn = 1;
  let prevDate: string | null = null;
  const twrByDate: Record<string, number> = {};

  for (const date of dates) {
    if (prevDate && Object.keys(positions).length > 0) {
      let prevVal = 0, todayVal = 0;
      let ok = true;
      for (const [sym, qty] of Object.entries(positions)) {
        const fx = symbolCurrency[sym] === 'USD' ? nearestRate(fxRates, date) : 1;
        const fxPrev = symbolCurrency[sym] === 'USD' ? nearestRate(fxRates, prevDate) : 1;
        const closes = closesMap[sym] ?? {};
        const datesForSym = Object.keys(closes).sort();
        const pd = datesForSym.filter(d => d <= prevDate!).pop();
        const cd = datesForSym.filter(d => d <= date).pop();
        if (!pd || !cd) { ok = false; break; }
        prevVal += qty * closes[pd] * fxPrev;
        todayVal += qty * closes[cd] * fx;
      }
      if (ok && prevVal > 0) cumReturn *= 1 + (todayVal - prevVal) / prevVal;
    }
    twrByDate[date] = cumReturn;
    prevDate = date;
    while (orderIdx < sortedOrders.length && sortedOrders[orderIdx].filledAt.split('T')[0] <= date) {
      applyOrder(positions, sortedOrders[orderIdx++]);
    }
  }

  // 포트폴리오 일간 수익률
  const portDates = Object.keys(twrByDate).sort();
  const portRets: number[] = [];
  for (let i = 1; i < portDates.length; i++) {
    portRets.push(twrByDate[portDates[i]] / twrByDate[portDates[i - 1]] - 1);
  }

  // 각 매크로 지표와 비교
  const factors = MACRO_FACTORS.map(({ symbol, label }) => {
    const closes = closesMap[symbol] ?? {};
    const factorRets: number[] = [];
    for (let i = 1; i < portDates.length; i++) {
      const d = portDates[i], dp = portDates[i - 1];
      const dDates = Object.keys(closes).sort();
      const c = dDates.filter(x => x <= d).pop();
      const cp = dDates.filter(x => x <= dp).pop();
      factorRets.push(c && cp && closes[cp] > 0 ? closes[c] / closes[cp] - 1 : 0);
    }

    const corr = pearson(portRets, factorRets);
    const b = beta(portRets, factorRets);

    // 팩터 자체 연환산 수익률
    const factorDates = Object.keys(closes).filter(d => d >= fromDate && d <= toDate).sort();
    let factorReturn = 0;
    if (factorDates.length >= 2) {
      const first = closes[factorDates[0]], last = closes[factorDates[factorDates.length - 1]];
      factorReturn = Math.pow(last / first, DAYS_PER_YEAR / factorDates.length) - 1;
    }

    // 포트폴리오 연환산 수익률
    const portAnnualized = Math.pow(cumReturn, DAYS_PER_YEAR / portDates.length) - 1;
    const alpha = portAnnualized - (RISK_FREE + b * (factorReturn - RISK_FREE));

    return {
      symbol,
      label,
      beta: Math.round(b * 100) / 100,
      correlation: Math.round(corr * 100) / 100,
      factorAnnualizedReturn: Math.round(factorReturn * 10000) / 10000,
      alpha: Math.round(alpha * 10000) / 10000,
    };
  });

  return {
    factors,
    portfolio: {
      totalReturn: Math.round((cumReturn - 1) * 10000) / 10000,
      annualizedReturn: Math.round((Math.pow(cumReturn, DAYS_PER_YEAR / portDates.length) - 1) * 10000) / 10000,
    },
    period: { from: fromDate, to: toDate, tradingDays: portDates.length },
  };
}
