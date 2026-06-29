import { getHistoricalCandles, calcRSI, calcWilliamsR, calcSMA, calcDrawdown20d } from './toss-api/market.js';

export type Signal = 'STRONG_BUY' | 'BUY' | 'WATCH' | 'HOLD' | 'REDUCE';

function nDaysAgo(n: number): string {
  return new Date(Date.now() - n * 86400000).toISOString().split('T')[0];
}

export interface QuoteData {
  price: number;
  change1d: number;
  rsi14: number;
  williamsR: number;
  drawdown20d: number;
  sma50: number;
}

export interface TqqqData {
  signal: Signal;
  quotes: Record<'TQQQ' | 'QQQ' | 'TLT' | 'IEF', QuoteData>;
  cachedAt: number;
}

function computeSignal(tqqq: QuoteData): Signal {
  const { williamsR, drawdown20d, rsi14 } = tqqq;
  if (williamsR <= -85 || drawdown20d <= -20) return 'STRONG_BUY';
  if (williamsR <= -70 || drawdown20d <= -12) return 'BUY';
  if (williamsR <= -50 || drawdown20d <= -8)  return 'WATCH';
  if (rsi14 > 75    || williamsR >= -10)      return 'REDUCE';
  return 'HOLD';
}

async function buildQuote(symbol: string): Promise<QuoteData> {
  const candles = await getHistoricalCandles(symbol, nDaysAgo(90));
  if (candles.length < 2) return { price: 0, change1d: 0, rsi14: 50, williamsR: -50, drawdown20d: 0, sma50: 0 };
  const closes = candles.map(c => c.close);
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  return {
    price:       last.close,
    change1d:    ((last.close - prev.close) / prev.close) * 100,
    rsi14:       calcRSI(closes),
    williamsR:   calcWilliamsR(candles),
    drawdown20d: calcDrawdown20d(candles),
    sma50:       calcSMA(closes, 50),
  };
}

export async function getTqqqData(): Promise<TqqqData> {
  const [tqqq, qqq, tlt, ief] = await Promise.all([
    buildQuote('TQQQ'),
    buildQuote('QQQ'),
    buildQuote('TLT'),
    buildQuote('IEF'),
  ]);
  return {
    signal: computeSignal(tqqq),
    quotes: { TQQQ: tqqq, QQQ: qqq, TLT: tlt, IEF: ief },
    cachedAt: Date.now(),
  };
}
