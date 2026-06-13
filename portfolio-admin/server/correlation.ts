import { getHistoricalCandles } from './toss-api/market.js';

export interface CorrelationResult {
  symbols: string[];
  matrix: number[][];
  period: { from: string; to: string; days: number };
}

function sanitize(raw: Record<string, number>): Record<string, number> {
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

function dailyReturns(closes: Record<string, number>, dates: string[]): number[] {
  const rets: number[] = [];
  for (let i = 1; i < dates.length; i++) {
    const prev = closes[dates[i - 1]];
    const cur = closes[dates[i]];
    if (prev != null && cur != null && prev > 0) {
      rets.push(cur / prev - 1);
    } else {
      rets.push(0);
    }
  }
  return rets;
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
  return denom === 0 ? 0 : Math.round((cov / denom) * 100) / 100;
}

export async function getCorrelationMatrix(symbols: string[]): Promise<CorrelationResult> {
  const toDate = new Date().toISOString().split('T')[0];
  const fromDate = new Date(Date.now() - 365 * 86400000).toISOString().split('T')[0];

  const closesMap: Record<string, Record<string, number>> = {};
  await Promise.all(symbols.map(async (sym) => {
    try {
      const candles = await getHistoricalCandles(sym, fromDate);
      const raw = Object.fromEntries(candles.map(c => [c.date, c.close]));
      closesMap[sym] = sanitize(raw);
    } catch {
      closesMap[sym] = {};
    }
  }));

  // 공통 거래일 (2개 이상 심볼에 데이터 있는 날짜)
  const dateCount: Record<string, number> = {};
  for (const closes of Object.values(closesMap)) {
    for (const d of Object.keys(closes)) {
      dateCount[d] = (dateCount[d] ?? 0) + 1;
    }
  }
  const dates = Object.keys(dateCount)
    .filter(d => d >= fromDate && d <= toDate && dateCount[d] >= symbols.length * 0.5)
    .sort();

  // 심볼별 일간 수익률 (공통 날짜 기준)
  const retsMap: Record<string, number[]> = {};
  for (const sym of symbols) {
    const closes = closesMap[sym];
    // 각 날짜에 대해 가장 가까운 이전 날짜 값으로 fill-forward
    const filled: Record<string, number> = {};
    let last = 0;
    for (const d of dates) {
      if (closes[d] != null) last = closes[d];
      if (last > 0) filled[d] = last;
    }
    retsMap[sym] = dailyReturns(filled, dates);
  }

  // 상관관계 행렬
  const matrix = symbols.map((symA) =>
    symbols.map((symB) => {
      if (symA === symB) return 1;
      return pearson(retsMap[symA] ?? [], retsMap[symB] ?? []);
    })
  );

  return {
    symbols,
    matrix,
    period: { from: fromDate, to: toDate, days: dates.length },
  };
}
