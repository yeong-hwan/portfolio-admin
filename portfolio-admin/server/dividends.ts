import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import type { FilledOrder } from './toss-api/orders.js';
import { loadSplits, loadDividends, adjustOrdersForSplits } from './splits.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '../data');

// 미국 배당 원천징수 15%
const US_WITHHOLDING = 0.15;

export interface DividendIncome {
  totalGrossKrw: number;
  totalNetKrw: number; // 원천징수 15% 차감 추정
  ttmGrossKrw: number; // 최근 12개월
  ttmNetKrw: number;
  monthly: Array<{ month: string; grossKrw: number }>;
  bySymbol: Array<{ symbol: string; grossKrw: number; events: number }>;
  note: string;
}

// 배당락일 전일 보유수량 × 주당 배당금으로 배당 수입을 추정.
// Yahoo 배당 이벤트(분할 조정) × 분할 조정 보유수량 기준. 실제 입금액·시점과는 차이가 있는 추정치.
export async function computeDividendIncome(): Promise<DividendIncome | null> {
  let orders: FilledOrder[];
  try {
    const raw = JSON.parse(await fs.readFile(path.join(DATA_DIR, 'orders-cache.json'), 'utf-8'));
    orders = adjustOrdersForSplits(raw.orders as FilledOrder[], await loadSplits());
  } catch {
    return null;
  }
  const dividends = await loadDividends();
  if (!Object.keys(dividends).length) return null;

  let fxRates: Record<string, number> = {};
  try {
    fxRates = JSON.parse(await fs.readFile(path.join(DATA_DIR, 'fx-rates.json'), 'utf-8')).rates ?? {};
  } catch {
    // 폴백 환율 사용
  }
  const fxDates = Object.keys(fxRates).sort();
  function rateFor(date: string): number {
    let lo = 0, hi = fxDates.length - 1, idx = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (fxDates[mid] <= date) { idx = mid; lo = mid + 1; }
      else hi = mid - 1;
    }
    return idx >= 0 ? fxRates[fxDates[idx]] : 1380;
  }

  const sorted = [...orders].sort((a, b) => a.filledAt.localeCompare(b.filledAt));
  const firstOrderDate = sorted[0]?.filledAt.split('T')[0] ?? '';

  // 전체 배당 이벤트를 날짜순으로 병합
  const events: Array<{ symbol: string; date: string; amount: number }> = [];
  for (const [symbol, evs] of Object.entries(dividends)) {
    for (const e of evs) {
      if (e.date >= firstOrderDate) events.push({ symbol, ...e });
    }
  }
  events.sort((a, b) => a.date.localeCompare(b.date));
  if (!events.length) return null;

  // 주문과 배당 이벤트를 같이 시간순 스캔 (배당락일 전일까지 체결된 주문 반영)
  const positions: Record<string, number> = {};
  let orderIdx = 0;
  const monthlyMap = new Map<string, number>();
  const bySymbolMap = new Map<string, { grossKrw: number; events: number }>();
  let totalGrossKrw = 0;
  let ttmGrossKrw = 0;
  const ttmCutoff = new Date(Date.now() - 365 * 86400000).toISOString().split('T')[0];

  for (const ev of events) {
    while (orderIdx < sorted.length && sorted[orderIdx].filledAt.split('T')[0] < ev.date) {
      const o = sorted[orderIdx++];
      if (o.side === 'BUY') positions[o.symbol] = (positions[o.symbol] ?? 0) + o.filledQuantity;
      else {
        positions[o.symbol] = (positions[o.symbol] ?? 0) - o.filledQuantity;
        if (positions[o.symbol] <= 0.0001) delete positions[o.symbol];
      }
    }
    const qty = positions[ev.symbol] ?? 0;
    if (qty <= 0) continue;

    const grossKrw = qty * ev.amount * rateFor(ev.date);
    totalGrossKrw += grossKrw;
    if (ev.date >= ttmCutoff) ttmGrossKrw += grossKrw;
    const month = ev.date.slice(0, 7);
    monthlyMap.set(month, (monthlyMap.get(month) ?? 0) + grossKrw);
    const s = bySymbolMap.get(ev.symbol) ?? { grossKrw: 0, events: 0 };
    s.grossKrw += grossKrw;
    s.events++;
    bySymbolMap.set(ev.symbol, s);
  }

  return {
    totalGrossKrw,
    totalNetKrw: totalGrossKrw * (1 - US_WITHHOLDING),
    ttmGrossKrw,
    ttmNetKrw: ttmGrossKrw * (1 - US_WITHHOLDING),
    monthly: [...monthlyMap.entries()]
      .map(([month, grossKrw]) => ({ month, grossKrw }))
      .sort((a, b) => a.month.localeCompare(b.month)),
    bySymbol: [...bySymbolMap.entries()]
      .map(([symbol, s]) => ({ symbol, ...s }))
      .sort((a, b) => b.grossKrw - a.grossKrw),
    note: '배당락일 보유수량 × 주당 배당금(Yahoo) 추정치. 세후는 미국 원천징수 15% 가정. 실제 입금액·시점과 다를 수 있음.',
  };
}
