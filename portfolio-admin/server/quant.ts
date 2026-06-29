import { getHistoricalCandles, calcRSI, calcDrawdown20d } from './toss-api/market.js';
import type { DayCandle } from './toss-api/market.js';

const NASDAQ_MOVERS_SYMBOLS = [
  'AAPL','MSFT','NVDA','AMZN','META','GOOGL','TSLA','AVGO','COST','NFLX',
  'AMD','QCOM','ADBE','TXN','PANW','CDNS','KLAC','LRCX','SNPS','ABNB',
  'MSTR','PLTR','CRWD','SMCI','MRVL','ON','MU','AMAT','ASML','INTC',
];

function nDaysAgo(n: number): string {
  return new Date(Date.now() - n * 86400000).toISOString().split('T')[0];
}

export type Regime = 0 | 1 | 2 | 3;

export function classifyRegime(spyRsi: number, vixClose: number): Regime {
  if (spyRsi < 35 || vixClose > 30) return 0;
  if (spyRsi < 50 || vixClose > 20) return 1;
  if (spyRsi > 65 && vixClose < 15) return 3;
  return 2;
}

export interface QuantData {
  regime: Regime;
  regimeHistory: { date: string; regime: Regime }[];
  spy: { price: number; change1d: number; rsi14: number };
  vix: { price: number };
  nasdaq: {
    gainers: { symbol: string; changePercent: number }[];
    losers:  { symbol: string; changePercent: number }[];
  };
  cachedAt: number;
}

export async function getQuantData(): Promise<QuantData> {
  const from = nDaysAgo(90);

  const [[spyCandles, vixCandles], moverCandles] = await Promise.all([
    Promise.all([
      getHistoricalCandles('SPY', from),
      getHistoricalCandles('^VIX', from),
    ]),
    Promise.all(
      NASDAQ_MOVERS_SYMBOLS.map(s =>
        getHistoricalCandles(s, nDaysAgo(5)).catch(() => [] as DayCandle[])
      )
    ),
  ]);

  const spyCloses = spyCandles.map(c => c.close);
  const spyRsi14  = calcRSI(spyCloses);
  const spyLast   = spyCandles[spyCandles.length - 1];
  const spyPrev   = spyCandles[spyCandles.length - 2];
  const spyChange = spyPrev ? ((spyLast.close - spyPrev.close) / spyPrev.close) * 100 : 0;

  const vixLast  = vixCandles[vixCandles.length - 1];
  const vixClose = vixLast?.close ?? 20;

  const regimeHistory: { date: string; regime: Regime }[] = [];
  const last20Spy = spyCandles.slice(-20);
  for (let i = 0; i < last20Spy.length; i++) {
    const priorCloses = spyCandles.slice(0, spyCandles.length - last20Spy.length + i + 1).map(c => c.close);
    const vixForDay  = vixCandles.find(c => c.date === last20Spy[i].date)?.close ?? vixClose;
    regimeHistory.push({ date: last20Spy[i].date, regime: classifyRegime(calcRSI(priorCloses), vixForDay) });
  }

  const movers = NASDAQ_MOVERS_SYMBOLS.map((symbol, i) => {
    const candles = moverCandles[i];
    if (!candles || candles.length < 2) return null;
    const last = candles[candles.length - 1];
    const prev = candles[candles.length - 2];
    return { symbol, changePercent: ((last.close - prev.close) / prev.close) * 100 };
  }).filter(Boolean) as { symbol: string; changePercent: number }[];

  movers.sort((a, b) => b.changePercent - a.changePercent);

  return {
    regime: classifyRegime(spyRsi14, vixClose),
    regimeHistory,
    spy: { price: spyLast?.close ?? 0, change1d: spyChange, rsi14: spyRsi14 },
    vix: { price: vixClose },
    nasdaq: { gainers: movers.slice(0, 10), losers: movers.slice(-10).reverse() },
    cachedAt: Date.now(),
  };
}
