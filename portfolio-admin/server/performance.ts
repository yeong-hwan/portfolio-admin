import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { getHistoricalCandles } from './toss-api/market.js';
import type { FilledOrder } from './toss-api/orders.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '../data');

const RISK_FREE_RATE = 0.045;
const BENCHMARK = 'SPY';
const DAYS_PER_YEAR = 252;

// --- Data loading ---

async function loadOrders(): Promise<FilledOrder[]> {
  const raw = JSON.parse(await fs.readFile(path.join(DATA_DIR, 'orders-cache.json'), 'utf-8'));
  return raw.orders as FilledOrder[];
}

function sanitizeCloses(raw: Record<string, number>): Record<string, number> {
  const dates = Object.keys(raw).sort();
  const result: Record<string, number> = {};
  let prev = 0;
  for (const d of dates) {
    const c = raw[d];
    if (prev > 0 && (c / prev > 1.7 || c / prev < 1 / 1.7)) {
      result[d] = prev;
    } else {
      result[d] = c;
      prev = c;
    }
  }
  return result;
}

async function loadAllCandles(
  symbols: string[],
  fromDate: string,
): Promise<Record<string, Record<string, number>>> {
  const result: Record<string, Record<string, number>> = {};
  await Promise.all(symbols.map(async (sym) => {
    try {
      const candles = await getHistoricalCandles(sym, fromDate);
      const raw = Object.fromEntries(candles.map(c => [c.date, c.close]));
      result[sym] = sanitizeCloses(raw);
    } catch {
      result[sym] = {};
    }
  }));
  return result;
}

async function loadFxRates(): Promise<Record<string, number>> {
  try {
    const raw = JSON.parse(await fs.readFile(path.join(DATA_DIR, 'fx-rates.json'), 'utf-8'));
    return raw.rates as Record<string, number>;
  } catch { return {}; }
}

function nearestRate(rates: Record<string, number>, date: string): number {
  const prior = Object.keys(rates).sort().filter(d => d <= date).pop();
  return prior ? rates[prior] : 1380;
}

function nearestClose(closes: Record<string, number>, date: string): number | null {
  if (closes[date] !== undefined) return closes[date];
  const prior = Object.keys(closes).sort().filter(d => d < date).pop();
  return prior ? closes[prior] : null;
}

function applyOrder(pos: Record<string, number>, order: FilledOrder) {
  if (order.side === 'BUY') {
    pos[order.symbol] = (pos[order.symbol] ?? 0) + order.filledQuantity;
  } else {
    const rem = (pos[order.symbol] ?? 0) - order.filledQuantity;
    if (rem <= 0.0001) delete pos[order.symbol];
    else pos[order.symbol] = rem;
  }
}

function portfolioValue(
  positions: Record<string, number>,
  date: string,
  candlesBySymbol: Record<string, Record<string, number>>,
  symbolCurrency: Record<string, 'KRW' | 'USD'>,
  fxRates: Record<string, number>,
): number | null {
  let total = 0;
  for (const [sym, qty] of Object.entries(positions)) {
    const p = nearestClose(candlesBySymbol[sym] ?? {}, date);
    if (p == null) return null;
    const fx = symbolCurrency[sym] === 'USD' ? nearestRate(fxRates, date) : 1;
    total += qty * p * fx;
  }
  return total;
}

// --- Time-Weighted Return ---
// For each trading day t:
//   1. Hold yesterday's positions (no today's orders yet)
//   2. TWR_t = value(yesterday_positions, today_prices) / value(yesterday_positions, yesterday_prices) - 1
//   3. Then apply today's orders for next iteration
// This isolates market return from capital additions.

async function computeTWR(
  orders: FilledOrder[],
  candlesBySymbol: Record<string, Record<string, number>>,
  symbolCurrency: Record<string, 'KRW' | 'USD'>,
  fxRates: Record<string, number>,
  fromDate: string,
  toDate: string,
): Promise<Array<{ date: string; cumReturn: number }>> {
  // Trading days: union of all dates that have candle data
  const tradingDays = [...new Set(
    Object.values(candlesBySymbol).flatMap(m => Object.keys(m))
  )].filter(d => d >= fromDate && d <= toDate).sort();

  const sortedOrders = [...orders].sort((a, b) => a.filledAt.localeCompare(b.filledAt));
  const positions: Record<string, number> = {};
  let orderIdx = 0;

  // Fast-forward orders before fromDate
  while (orderIdx < sortedOrders.length && sortedOrders[orderIdx].filledAt.split('T')[0] < fromDate) {
    applyOrder(positions, sortedOrders[orderIdx++]);
  }

  let cumReturn = 1;
  let prevDate: string | null = null;
  const result: Array<{ date: string; cumReturn: number }> = [];

  for (const date of tradingDays) {
    // Use CURRENT positions (before today's orders) for TWR calculation
    if (prevDate && Object.keys(positions).length > 0) {
      const prevVal = portfolioValue(positions, prevDate, candlesBySymbol, symbolCurrency, fxRates);
      const todayVal = portfolioValue(positions, date, candlesBySymbol, symbolCurrency, fxRates);
      if (prevVal != null && todayVal != null && prevVal > 0) {
        cumReturn *= (1 + (todayVal - prevVal) / prevVal);
      }
    }

    result.push({ date, cumReturn });
    prevDate = date;

    // Apply today's orders AFTER computing TWR for this day
    while (orderIdx < sortedOrders.length && sortedOrders[orderIdx].filledAt.split('T')[0] <= date) {
      applyOrder(positions, sortedOrders[orderIdx++]);
    }
  }

  return result;
}

// --- Stats from return series ---

function mean(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function std(arr: number[]): number {
  const m = mean(arr);
  return Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / (arr.length - 1));
}

function computeStats(cumReturns: number[], rfRate = RISK_FREE_RATE) {
  if (cumReturns.length < 2) return null;
  const dailyRets: number[] = [];
  for (let i = 1; i < cumReturns.length; i++) {
    dailyRets.push(cumReturns[i] / cumReturns[i - 1] - 1);
  }
  const n = cumReturns.length;
  const totalReturn = cumReturns[n - 1] - 1;
  const annualizedReturn = Math.pow(cumReturns[n - 1], DAYS_PER_YEAR / (n - 1)) - 1;
  const volatility = std(dailyRets) * Math.sqrt(DAYS_PER_YEAR);
  const sharpe = (annualizedReturn - rfRate) / volatility;

  // MDD
  let peak = 1, maxDrawdown = 0;
  for (const v of cumReturns) {
    if (v > peak) peak = v;
    const dd = (v - peak) / peak;
    if (dd < maxDrawdown) maxDrawdown = dd;
  }

  return { totalReturn, annualizedReturn, volatility, sharpe, mdd: maxDrawdown, dailyRets };
}

// --- Public API ---

export async function getPerformanceMetrics(cashKrw: number) {
  const orders = await loadOrders();
  if (!orders.length) return null;

  const symbolCurrency: Record<string, 'KRW' | 'USD'> = {};
  for (const o of orders) symbolCurrency[o.symbol] = o.currency;
  const symbols = Object.keys(symbolCurrency);

  const fromDate = orders[0].filledAt.split('T')[0];
  const toDate = new Date().toISOString().split('T')[0];

  const [candlesBySymbol, fxRates, spyRaw] = await Promise.all([
    loadAllCandles(symbols, fromDate),
    loadFxRates(),
    getHistoricalCandles(BENCHMARK, fromDate),
  ]);

  // Portfolio TWR
  const twrSeries = await computeTWR(orders, candlesBySymbol, symbolCurrency, fxRates, fromDate, toDate);
  if (twrSeries.length < 10) return null;

  const spyCloseMap: Record<string, number> = {};
  const spyFiltered = spyRaw.filter(c => c.date >= fromDate && c.date <= toDate);
  for (const c of spyFiltered) spyCloseMap[c.date] = c.close;

  // SPY cumulative return series (aligned to TWR dates)
  const spyBase = spyFiltered[0]?.close ?? 1;
  const spyCumReturns = twrSeries.map(p => {
    const c = spyCloseMap[p.date];
    return c != null ? c / spyBase : null;
  }).filter((v): v is number => v != null);

  const pStats = computeStats(twrSeries.map(p => p.cumReturn));
  const bStats = computeStats(spyCumReturns);
  if (!pStats || !bStats) return null;

  // Align daily returns for beta/alpha/correlation
  const spyCumMap: Record<string, number> = {};
  for (const c of spyFiltered) {
    spyCumMap[c.date] = c.close / spyBase;
  }

  const pRets: number[] = [], bRets: number[] = [];
  for (let i = 1; i < twrSeries.length; i++) {
    const date = twrSeries[i].date;
    const prevDate = twrSeries[i - 1].date;
    const bc = spyCumMap[date];
    const bcp = spyCumMap[prevDate];
    if (bc != null && bcp != null) {
      pRets.push(twrSeries[i].cumReturn / twrSeries[i - 1].cumReturn - 1);
      bRets.push(bc / bcp - 1);
    }
  }

  let beta = 1, alpha = 0, correlation = 0;
  if (pRets.length > 10) {
    const pm = mean(pRets), bm = mean(bRets);
    let cov = 0, varB = 0, varP = 0;
    for (let i = 0; i < pRets.length; i++) {
      const pd = pRets[i] - pm, bd = bRets[i] - bm;
      cov += pd * bd; varB += bd * bd; varP += pd * pd;
    }
    const n = pRets.length - 1;
    cov /= n; varB /= n; varP /= n;
    beta = cov / varB;
    correlation = cov / (Math.sqrt(varP) * Math.sqrt(varB));
    alpha = pStats.annualizedReturn - (RISK_FREE_RATE + beta * (bStats.annualizedReturn - RISK_FREE_RATE));
  }

  // Normalized series for chart (portfolio TWR and SPY both rebased to 100)
  const spyCumByDate: Record<string, number> = {};
  for (const c of spyFiltered) spyCumByDate[c.date] = (c.close / spyBase) * 100;

  const series = twrSeries.map(p => ({
    date: p.date,
    portfolio: Math.round(p.cumReturn * 10000) / 100,  // e.g. 1.52 → 152.0
    benchmark: spyCumByDate[p.date] ?? null,
  }));

  // Find MDD dates
  let peak = 1, mddPeak = 1, mddFrom = twrSeries[0].date, mddTo = twrSeries[0].date, peakDate = twrSeries[0].date, maxDd = 0;
  for (const p of twrSeries) {
    if (p.cumReturn > peak) { peak = p.cumReturn; peakDate = p.date; }
    const dd = (p.cumReturn - peak) / peak;
    if (dd < maxDd) { maxDd = dd; mddFrom = peakDate; mddTo = p.date; }
  }

  return {
    period: { from: fromDate, to: toDate, tradingDays: twrSeries.length },
    portfolio: {
      totalReturn: pStats.totalReturn,
      annualizedReturn: pStats.annualizedReturn,
      volatility: pStats.volatility,
      sharpe: pStats.sharpe,
      mdd: maxDd,
      mddFrom,
      mddTo,
    },
    benchmark: {
      symbol: BENCHMARK,
      totalReturn: bStats.totalReturn,
      annualizedReturn: bStats.annualizedReturn,
      volatility: bStats.volatility,
      sharpe: bStats.sharpe,
    },
    alpha,
    beta,
    correlation,
    series,
  };
}
