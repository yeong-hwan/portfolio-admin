import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import type { FilledOrder } from './toss-api/orders.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '../data');

export interface CashflowResult {
  firstOrderDate: string;
  lastOrderDate: string;
  orderCount: number;
  totalBuyKrw: number;
  totalSellKrw: number;
  /** 추정 순투입(진짜 원금): 가상 현금 잔고가 음수가 될 때마다 외부 입금으로 간주한 합계 */
  inferredDepositKrw: number;
  /** 매도대금이 다시 매수에 쓰인 금액 = 총매수 − 추정 순투입 */
  reinvestedKrw: number;
  /** 매도 후 아직 재투자되지 않은 가상 잔여 현금 (출금·배당은 추적 불가) */
  residualCashKrw: number;
  deposits: Array<{ date: string; amountKrw: number }>;
  monthly: Array<{ month: string; amountKrw: number }>;
}

// 주문 체결 이력을 시간순으로 리플레이하며 가상 현금 잔고를 추적.
// 매수로 잔고가 음수가 되는 순간을 외부 현금 투입 시점으로 추정한다.
// 한계: 배당금·이자·출금·환전 시차는 주문 API에 없으므로 반영되지 않는 추정치.
export async function computeCashflow(): Promise<CashflowResult | null> {
  let ordersRaw: { orders: FilledOrder[] };
  try {
    ordersRaw = JSON.parse(await fs.readFile(path.join(DATA_DIR, 'orders-cache.json'), 'utf-8'));
  } catch {
    return null;
  }
  let fxRates: Record<string, number> = {};
  try {
    fxRates = JSON.parse(await fs.readFile(path.join(DATA_DIR, 'fx-rates.json'), 'utf-8')).rates ?? {};
  } catch {
    // 환율 캐시 없으면 폴백 환율 사용
  }

  const orders = [...ordersRaw.orders].sort((a, b) => a.filledAt.localeCompare(b.filledAt));
  if (!orders.length) return null;

  // 주문이 날짜순이므로 환율 조회는 포인터 전진으로 처리
  const fxDates = Object.keys(fxRates).sort();
  let fxIdx = -1;
  function rateFor(date: string): number {
    while (fxIdx + 1 < fxDates.length && fxDates[fxIdx + 1] <= date) fxIdx++;
    return fxIdx >= 0 ? fxRates[fxDates[fxIdx]] : 1380;
  }

  let cash = 0;
  let totalBuy = 0;
  let totalSell = 0;
  let totalDeposit = 0;
  const depositsByDate = new Map<string, number>();

  for (const o of orders) {
    const date = o.filledAt.split('T')[0];
    const fx = o.currency === 'USD' ? rateFor(date) : 1;
    const gross = o.filledAmount ?? o.filledQuantity * o.averageFilledPrice;
    const fee = (o.commission ?? 0) + (o.tax ?? 0);

    if (o.side === 'BUY') {
      const cost = (gross + fee) * fx;
      totalBuy += cost;
      cash -= cost;
      if (cash < 0) {
        const deposit = -cash;
        totalDeposit += deposit;
        depositsByDate.set(date, (depositsByDate.get(date) ?? 0) + deposit);
        cash = 0;
      }
    } else {
      const proceeds = (gross - fee) * fx;
      totalSell += proceeds;
      cash += proceeds;
    }
  }

  const deposits = [...depositsByDate.entries()]
    .map(([date, amountKrw]) => ({ date, amountKrw }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const monthlyMap = new Map<string, number>();
  for (const d of deposits) {
    const month = d.date.slice(0, 7);
    monthlyMap.set(month, (monthlyMap.get(month) ?? 0) + d.amountKrw);
  }
  const monthly = [...monthlyMap.entries()]
    .map(([month, amountKrw]) => ({ month, amountKrw }))
    .sort((a, b) => a.month.localeCompare(b.month));

  return {
    firstOrderDate: orders[0].filledAt.split('T')[0],
    lastOrderDate: orders[orders.length - 1].filledAt.split('T')[0],
    orderCount: orders.length,
    totalBuyKrw: totalBuy,
    totalSellKrw: totalSell,
    inferredDepositKrw: totalDeposit,
    reinvestedKrw: totalBuy - totalDeposit,
    residualCashKrw: cash,
    deposits,
    monthly,
  };
}
