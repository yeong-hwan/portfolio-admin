import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import type { FilledOrder } from './toss-api/orders.js';
import { loadSplits, adjustOrdersForSplits } from './splits.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '../data');

// 해외주식 양도소득세: 연 250만원 기본공제, 초과분 22% (지방소득세 포함)
const BASIC_DEDUCTION_KRW = 2_500_000;
const TAX_RATE = 0.22;

interface Lot {
  qty: number;
  unitCostKrw: number;
}

export interface RealizedTrade {
  date: string;
  symbol: string;
  qty: number;
  proceedsKrw: number;
  costKrw: number;
  realizedKrw: number;
}

export interface TaxSummary {
  years: Array<{
    year: string;
    realizedKrw: number;
    sellCount: number;
    taxableKrw: number;      // max(0, 실현손익 − 250만)
    estimatedTaxKrw: number; // taxable × 22%
  }>;
  currentYear: {
    year: string;
    realizedKrw: number;
    deductionLeftKrw: number; // 250만 공제까지 남은 여유 (실현익 < 250만일 때)
    taxableKrw: number;
    estimatedTaxKrw: number;
    bySymbol: Array<{ symbol: string; realizedKrw: number; sellCount: number }>;
  };
  note: string;
}

function nearestRate(rates: Record<string, number>, sortedDates: string[], date: string): number {
  let lo = 0, hi = sortedDates.length - 1, idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (sortedDates[mid] <= date) { idx = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  return idx >= 0 ? rates[sortedDates[idx]] : 1380;
}

// 체결 이력을 FIFO 로트로 리플레이 — 현재 로트 상태와 실현손익 내역을 반환
async function replayFifo(): Promise<{ lots: Record<string, Lot[]>; trades: RealizedTrade[] } | null> {
  let orders: FilledOrder[];
  try {
    const raw = JSON.parse(await fs.readFile(path.join(DATA_DIR, 'orders-cache.json'), 'utf-8'));
    orders = adjustOrdersForSplits(raw.orders as FilledOrder[], await loadSplits());
  } catch {
    return null;
  }
  let fxRates: Record<string, number> = {};
  try {
    fxRates = JSON.parse(await fs.readFile(path.join(DATA_DIR, 'fx-rates.json'), 'utf-8')).rates ?? {};
  } catch {
    // 폴백 환율 사용
  }
  const fxDates = Object.keys(fxRates).sort();

  const sorted = [...orders].sort((a, b) => a.filledAt.localeCompare(b.filledAt));
  const lots: Record<string, Lot[]> = {};
  const trades: RealizedTrade[] = [];

  for (const o of sorted) {
    const date = o.filledAt.split('T')[0];
    const fx = o.currency === 'USD' ? nearestRate(fxRates, fxDates, date) : 1;
    const gross = o.filledAmount ?? o.filledQuantity * o.averageFilledPrice;
    const fee = (o.commission ?? 0) + (o.tax ?? 0);

    if (o.side === 'BUY') {
      if (o.filledQuantity <= 0) continue;
      const costKrw = (gross + fee) * fx;
      (lots[o.symbol] ??= []).push({ qty: o.filledQuantity, unitCostKrw: costKrw / o.filledQuantity });
    } else {
      const proceedsKrw = (gross - fee) * fx;
      const unitProceeds = o.filledQuantity > 0 ? proceedsKrw / o.filledQuantity : 0;
      let remaining = o.filledQuantity;
      let matchedCost = 0;
      let matchedQty = 0;
      const q = lots[o.symbol] ?? [];
      while (remaining > 1e-9 && q.length) {
        const lot = q[0];
        const take = Math.min(lot.qty, remaining);
        matchedCost += take * lot.unitCostKrw;
        matchedQty += take;
        lot.qty -= take;
        remaining -= take;
        if (lot.qty <= 1e-9) q.shift();
      }
      // 로트가 부족한 잔량(데이터 공백)은 취득가 불명 — 실현손익 계산에서 제외
      if (matchedQty > 1e-9) {
        const matchedProceeds = unitProceeds * matchedQty;
        trades.push({
          date,
          symbol: o.symbol,
          qty: matchedQty,
          proceedsKrw: matchedProceeds,
          costKrw: matchedCost,
          realizedKrw: matchedProceeds - matchedCost,
        });
      }
    }
  }

  return { lots, trades };
}

// 연도별 실현손익(원화) 요약.
// 세법상 취득가/양도가는 결제일 환율 기준이지만, 여기서는 체결일 환율로 근사한 추정치.
export async function computeTaxSummary(): Promise<TaxSummary | null> {
  const state = await replayFifo();
  if (!state || !state.trades.length) return null;
  const { trades } = state;

  const byYear = new Map<string, { realizedKrw: number; sellCount: number }>();
  for (const t of trades) {
    const year = t.date.slice(0, 4);
    const y = byYear.get(year) ?? { realizedKrw: 0, sellCount: 0 };
    y.realizedKrw += t.realizedKrw;
    y.sellCount++;
    byYear.set(year, y);
  }

  const years = [...byYear.entries()]
    .map(([year, y]) => {
      const taxableKrw = Math.max(0, y.realizedKrw - BASIC_DEDUCTION_KRW);
      return { year, ...y, taxableKrw, estimatedTaxKrw: taxableKrw * TAX_RATE };
    })
    .sort((a, b) => a.year.localeCompare(b.year));

  const nowYear = new Date().toISOString().slice(0, 4);
  const cy = byYear.get(nowYear) ?? { realizedKrw: 0, sellCount: 0 };
  const bySymbolMap = new Map<string, { realizedKrw: number; sellCount: number }>();
  for (const t of trades) {
    if (!t.date.startsWith(nowYear)) continue;
    const s = bySymbolMap.get(t.symbol) ?? { realizedKrw: 0, sellCount: 0 };
    s.realizedKrw += t.realizedKrw;
    s.sellCount++;
    bySymbolMap.set(t.symbol, s);
  }
  const cyTaxable = Math.max(0, cy.realizedKrw - BASIC_DEDUCTION_KRW);

  return {
    years,
    currentYear: {
      year: nowYear,
      realizedKrw: cy.realizedKrw,
      deductionLeftKrw: Math.max(0, BASIC_DEDUCTION_KRW - cy.realizedKrw),
      taxableKrw: cyTaxable,
      estimatedTaxKrw: cyTaxable * TAX_RATE,
      bySymbol: [...bySymbolMap.entries()]
        .map(([symbol, s]) => ({ symbol, ...s }))
        .sort((a, b) => b.realizedKrw - a.realizedKrw),
    },
    note: 'FIFO·체결일 환율 기준 추정치. 실제 신고는 결제일 환율 기준이므로 증권사 자료로 확인 필요.',
  };
}

export interface SaleSimulation {
  symbol: string;
  qty: number;          // 실제 매칭된 수량 (로트 부족 시 축소)
  proceedsKrw: number;
  costKrw: number;
  realizedKrw: number;
  yearRealizedAfterKrw: number; // 매도 후 올해 실현손익 합계
  taxBeforeKrw: number;
  taxAfterKrw: number;
  deltaTaxKrw: number;  // 이 매도로 늘어나는(줄어드는) 세금
}

// "이 종목을 지금 X주 팔면" 시뮬레이션: FIFO 취득원가 매칭 + 올해 과세표준 변화
export async function simulateSale(symbol: string, qty: number, priceKrw: number): Promise<SaleSimulation | null> {
  const state = await replayFifo();
  if (!state) return null;

  const q = state.lots[symbol] ?? [];
  let remaining = qty;
  let costKrw = 0;
  let matched = 0;
  for (const lot of q) {
    if (remaining <= 1e-9) break;
    const take = Math.min(lot.qty, remaining);
    costKrw += take * lot.unitCostKrw;
    matched += take;
    remaining -= take;
  }
  if (matched <= 1e-9) return null;

  const proceedsKrw = matched * priceKrw;
  const realizedKrw = proceedsKrw - costKrw;

  const nowYear = new Date().toISOString().slice(0, 4);
  const yearRealized = state.trades
    .filter(t => t.date.startsWith(nowYear))
    .reduce((s, t) => s + t.realizedKrw, 0);

  const taxBeforeKrw = Math.max(0, yearRealized - BASIC_DEDUCTION_KRW) * TAX_RATE;
  const yearRealizedAfterKrw = yearRealized + realizedKrw;
  const taxAfterKrw = Math.max(0, yearRealizedAfterKrw - BASIC_DEDUCTION_KRW) * TAX_RATE;

  return {
    symbol,
    qty: matched,
    proceedsKrw,
    costKrw,
    realizedKrw,
    yearRealizedAfterKrw,
    taxBeforeKrw,
    taxAfterKrw,
    deltaTaxKrw: taxAfterKrw - taxBeforeKrw,
  };
}
