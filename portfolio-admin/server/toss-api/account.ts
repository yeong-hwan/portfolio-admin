import { tossGet } from './client.js';
import type { TossAccount, HoldingsResponse, HoldingItem, ExchangeRateResult } from './types.js';
import type { AccountSummary, Position } from '../../src/types.js';
import { computeHistoricalPrincipalKrw } from '../portfolio-candles.js';

function num(s: string | null | undefined): number {
  if (!s) return 0;
  return parseFloat(s) || 0;
}

export async function resolveAccountSeq(): Promise<number> {
  const envSeq = process.env.TOSS_ACCOUNT_SEQ;
  if (envSeq) return parseInt(envSeq, 10);
  const accounts = await getAccounts();
  if (!accounts.length) throw new Error('No accounts found');
  return accounts[0].accountSeq;
}

export async function getAccounts(): Promise<TossAccount[]> {
  return tossGet<TossAccount[]>('/api/v1/accounts');
}

export async function getHoldings(accountSeq: number): Promise<HoldingsResponse> {
  return tossGet<HoldingsResponse>('/api/v1/holdings', { accountSeq });
}

async function getUsdKrwRate(): Promise<number> {
  try {
    const rate = await tossGet<ExchangeRateResult>('/api/v1/exchange-rate', {
      params: { baseCurrency: 'USD', quoteCurrency: 'KRW' },
    });
    return num(rate.rate);
  } catch {
    return 1380;
  }
}

function toPosition(item: HoldingItem, usdKrw: number): Position {
  const isUs = item.marketCountry === 'US';
  const qty = num(item.quantity);
  const lastNative = num(item.lastPrice);
  const avgNative = num(item.averagePurchasePrice);
  const mvNative = num(item.marketValue.amount);
  const plNative = num(item.profitLoss.amount);
  const dailyPlNative = num(item.dailyProfitLoss.amount);
  const plRate = num(item.profitLoss.rate);
  const dailyPlRate = num(item.dailyProfitLoss.rate);

  const lastUsd = isUs ? lastNative : lastNative / usdKrw;
  const lastKrw = isUs ? lastNative * usdKrw : lastNative;
  const avgUsd = isUs ? avgNative : avgNative / usdKrw;
  const avgKrw = isUs ? avgNative * usdKrw : avgNative;
  const mvUsd = isUs ? mvNative : mvNative / usdKrw;
  const mvKrw = isUs ? mvNative * usdKrw : mvNative;
  const plUsd = isUs ? plNative : plNative / usdKrw;
  const plKrw = isUs ? plNative * usdKrw : plNative;
  const dailyPlUsd = isUs ? dailyPlNative : dailyPlNative / usdKrw;
  const dailyPlKrw = isUs ? dailyPlNative * usdKrw : dailyPlNative;

  return {
    product_code: item.symbol,
    symbol: item.symbol,
    name: item.name,
    market_type: item.marketCountry,
    market_code: isUs ? 'US' : 'KR',
    quantity: qty,
    average_price: avgKrw,
    current_price: lastKrw,
    market_value: mvKrw,
    unrealized_pnl: plKrw,
    profit_rate: plRate,
    daily_profit_loss: dailyPlKrw,
    daily_profit_rate: dailyPlRate,
    average_price_usd: avgUsd,
    current_price_usd: lastUsd,
    market_value_usd: mvUsd,
    unrealized_pnl_usd: plUsd,
    profit_rate_usd: plRate,
    daily_profit_loss_usd: dailyPlUsd,
    daily_profit_rate_usd: dailyPlRate,
  };
}

export async function getSnapshot(): Promise<{ summary: AccountSummary; positions: Position[] }> {
  const accountSeq = await resolveAccountSeq();
  const [holdings, usdKrw] = await Promise.all([
    getHoldings(accountSeq),
    getUsdKrwRate(),
  ]);

  const positions = holdings.items.map((item) => toPosition(item, usdKrw));
  const totalMarketValueKrw = positions.reduce((sum, p) => sum + p.market_value, 0);

  // Toss가 자체 보관 환율로 산출한 수익률로 역산. Frankfurter API와의 환율 괴리를 제거.
  const tossRate = num(holdings.profitLoss.rate);
  const totalPurchaseKrw = tossRate > -1 ? totalMarketValueKrw / (1 + tossRate) : totalMarketValueKrw;
  const evaluatedProfitKrw = totalMarketValueKrw - totalPurchaseKrw;

  const summary: AccountSummary = {
    total_asset_amount: totalMarketValueKrw,
    evaluated_profit_amount: evaluatedProfitKrw,
    profit_rate: tossRate,
    // TODO: Toss 공개 API에 현금 잔액 엔드포인트 없음 (14개 경로 전수 확인).
    //       파트너 API 또는 신규 엔드포인트 추가 시 여기서 반영.
    //       현재는 .env의 CASH_KRW 로 수동 설정.
    orderable_amount_krw: parseInt(process.env.CASH_KRW ?? '0', 10),
    orderable_amount_usd: 0,
    markets: {},
  };
  return { summary, positions };
}

export async function getExchangeRate(): Promise<{ rate: number; timestamp: string }> {
  const rate = await tossGet<ExchangeRateResult>('/api/v1/exchange-rate', {
    params: { baseCurrency: 'USD', quoteCurrency: 'KRW' },
  });
  return { rate: num(rate.rate), timestamp: rate.validFrom };
}
