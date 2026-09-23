import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { getHistoricalCandles } from './toss-api/market.js';
import type { FilledOrder } from './toss-api/orders.js';
import { computeCashflow } from './cashflow.js';
import { loadSplits, adjustOrdersForSplits } from './splits.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '../data');

const RISK_FREE_RATE = 0.045;
const BENCHMARK = 'SPY';
const DAYS_PER_YEAR = 252;

// --- Data loading ---

async function loadOrders(): Promise<FilledOrder[]> {
  const raw = JSON.parse(await fs.readFile(path.join(DATA_DIR, 'orders-cache.json'), 'utf-8'));
  // 분할/역분할 이후 수량 기준으로 보정 (캔들 가격은 분할 조정가이므로)
  return adjustOrdersForSplits(raw.orders as FilledOrder[], await loadSplits());
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

// 내 포트폴리오와 "동일 입금 흐름으로 SPY만 적립매수한 시뮬레이션"을
// 일별 가치(KRW) 시계열로 나란히 재구성해 비교한다.
// 위험 지표는 입금 효과를 제거한 일일 수익률 (V_t − V_{t−1} − 당일입금)/V_{t−1} 로 양쪽 동일 계산.
export async function getPerformanceMetrics() {
  const orders = await loadOrders();
  if (!orders.length) return null;

  const cashflow = await computeCashflow();
  if (!cashflow || !cashflow.deposits.length) return null;

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

  const spyClose: Record<string, number> = {};
  const spyDates = spyRaw
    .filter(c => c.date >= fromDate && c.date <= toDate)
    .map(c => { spyClose[c.date] = c.close; return c.date; })
    .sort();
  if (spyDates.length < 10) return null;

  const sortedOrders = [...orders].sort((a, b) => a.filledAt.localeCompare(b.filledAt));
  const deposits = cashflow.deposits;

  const positions: Record<string, number> = {};
  let orderIdx = 0;
  let depIdx = 0;
  let simUnits = 0;
  let carryFlow = 0; // 가치 계산이 불가능한 날의 입금을 다음 유효일로 이월
  let prevDate: string | null = null;

  const series: Array<{ date: string; portfolio: number; benchmark: number }> = [];
  // 위험 지표용 일일 수익률: 전일 포지션을 고정해 계산 → 입금·체결 타이밍 노이즈 완전 배제.
  // 초기 소액 구간(±1일 날짜 어긋남만으로 수백% 노이즈)은 기반 자산 100만원 이상부터 반영.
  const MIN_STATS_BASE_KRW = 1_000_000;
  const pRets: number[] = [], bRets: number[] = [], fRets: number[] = [];
  const statDates: string[] = [];

  for (const date of spyDates) {
    // 1) 어제 포지션 그대로 오늘 가격에 노출됐을 때의 수익률 (주문 반영 전)
    if (prevDate && Object.keys(positions).length > 0) {
      const v0 = portfolioValue(positions, prevDate, candlesBySymbol, symbolCurrency, fxRates);
      const v1 = portfolioValue(positions, date, candlesBySymbol, symbolCurrency, fxRates);
      if (v0 != null && v1 != null && v0 >= MIN_STATS_BASE_KRW) {
        const fx0 = nearestRate(fxRates, prevDate);
        const fx1 = nearestRate(fxRates, date);
        pRets.push(v1 / v0 - 1);
        bRets.push((spyClose[date] * fx1) / (spyClose[prevDate] * fx0) - 1);
        fRets.push(fx1 / fx0 - 1);
        statDates.push(date);
      }
    }

    // 2) 오늘 체결 주문 반영
    while (orderIdx < sortedOrders.length && sortedOrders[orderIdx].filledAt.split('T')[0] <= date) {
      applyOrder(positions, sortedOrders[orderIdx++]);
    }

    // 3) 오늘 추정 입금으로 SPY 적립 매수
    let flow = carryFlow;
    while (depIdx < deposits.length && deposits[depIdx].date <= date) {
      flow += deposits[depIdx++].amountKrw;
    }

    const myVal = portfolioValue(positions, date, candlesBySymbol, symbolCurrency, fxRates);
    if (myVal == null) {
      carryFlow = flow;
      continue;
    }
    carryFlow = 0;
    prevDate = date;

    const spyKrw = spyClose[date] * nearestRate(fxRates, date);
    if (flow > 0) simUnits += flow / spyKrw;

    series.push({ date, portfolio: myVal, benchmark: simUnits * spyKrw });
  }

  if (series.length < 10) return null;

  const chain = (rets: number[]) => {
    const cums = [1];
    for (const r of rets) cums.push(cums[cums.length - 1] * (1 + r));
    return cums;
  };
  const pCums = chain(pRets);
  const bCums = chain(bRets);
  const pStats = computeStats(pCums);
  const bStats = computeStats(bCums);
  if (!pStats || !bStats) return null;

  // 실투입(추정 순입금) 대비 수익률 — 양쪽 모두 동일한 입금 흐름 기준
  const totalDeposit = cashflow.inferredDepositKrw;
  const last = series[series.length - 1];
  const moneyReturnP = totalDeposit > 0 ? (last.portfolio - totalDeposit) / totalDeposit : 0;
  const moneyReturnB = totalDeposit > 0 ? (last.benchmark - totalDeposit) / totalDeposit : 0;

  let beta = 1, alpha = 0, correlation = 0, informationRatio = 0;
  if (pRets.length > 10) {
    // 정보비율 (SPY 대비 샤프): 일일 초과수익 평균 / 초과수익 표준편차, 연환산
    const active = pRets.map((r, i) => r - bRets[i]);
    const activeStd = std(active);
    if (activeStd > 0) {
      informationRatio = (mean(active) / activeStd) * Math.sqrt(DAYS_PER_YEAR);
    }
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

  // 월별 수익률: 일일 수익률을 월 단위로 복리 합성.
  // 포트폴리오는 원화 기준이므로 (1+원화수익) = (1+주가수익)×(1+환율수익)으로 분해.
  const monthlyReturns: Array<{ month: string; portfolio: number; benchmark: number; fx: number; price: number }> = [];
  {
    let curMonth = '';
    let mp = 1, mb = 1, mf = 1;
    const flush = () => {
      if (!curMonth) return;
      monthlyReturns.push({
        month: curMonth,
        portfolio: mp - 1,
        benchmark: mb - 1,
        fx: mf - 1,
        price: mp / mf - 1,
      });
    };
    for (let i = 0; i < statDates.length; i++) {
      const month = statDates[i].slice(0, 7);
      if (month !== curMonth) {
        flush();
        curMonth = month;
        mp = 1; mb = 1; mf = 1;
      }
      mp *= 1 + pRets[i];
      mb *= 1 + bRets[i];
      mf *= 1 + fRets[i];
    }
    flush();
  }

  // 드로다운 (고점 대비 낙폭) 시계열
  const drawdown: Array<{ date: string; portfolio: number; benchmark: number }> = [];
  {
    let pk = 1, bk = 1;
    for (let i = 1; i < pCums.length; i++) {
      pk = Math.max(pk, pCums[i]);
      bk = Math.max(bk, bCums[i]);
      drawdown.push({ date: statDates[i - 1], portfolio: pCums[i] / pk - 1, benchmark: bCums[i] / bk - 1 });
    }
  }

  // MDD 구간 (입금 효과 제거된 누적 체인 기준, pCums[i]는 statDates[i-1] 시점)
  const firstStatDate = statDates[0] ?? series[0].date;
  let peak = 1, mddFrom = firstStatDate, mddTo = firstStatDate, peakDate = firstStatDate, maxDd = 0;
  for (let i = 1; i < pCums.length; i++) {
    const v = pCums[i];
    const date = statDates[i - 1];
    if (v > peak) { peak = v; peakDate = date; }
    const dd = (v - peak) / peak;
    if (dd < maxDd) { maxDd = dd; mddFrom = peakDate; mddTo = date; }
  }

  return {
    period: { from: series[0].date, to: last.date, tradingDays: series.length },
    deposits: { totalKrw: totalDeposit, count: deposits.length },
    portfolio: {
      totalReturn: moneyReturnP,
      annualizedReturn: pStats.annualizedReturn,
      volatility: pStats.volatility,
      sharpe: pStats.sharpe,
      mdd: maxDd,
      mddFrom,
      mddTo,
      finalValueKrw: last.portfolio,
    },
    benchmark: {
      symbol: BENCHMARK,
      totalReturn: moneyReturnB,
      annualizedReturn: bStats.annualizedReturn,
      volatility: bStats.volatility,
      sharpe: bStats.sharpe,
      mdd: bStats.mdd,
      finalValueKrw: last.benchmark,
    },
    alpha,
    beta,
    correlation,
    excess: {
      totalReturn: moneyReturnP - moneyReturnB,
      valueDiffKrw: last.portfolio - last.benchmark,
      informationRatio,
    },
    monthlyReturns,
    drawdown,
    series,
  };
}
