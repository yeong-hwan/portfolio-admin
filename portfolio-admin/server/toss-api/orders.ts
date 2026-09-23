import { tossGet } from './client.js';

export interface FilledOrder {
  orderId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  filledQuantity: number;
  averageFilledPrice: number;
  currency: 'KRW' | 'USD';
  filledAt: string;
  // 아래 필드는 캐시 마이그레이션 전 데이터에는 없을 수 있음 (qty×price로 폴백)
  filledAmount?: number;
  commission?: number;
  tax?: number;
}

interface TossOrdersResponse {
  orders: Array<{
    orderId: string;
    symbol: string;
    side: 'BUY' | 'SELL';
    status: string;
    currency: 'KRW' | 'USD';
    execution: {
      filledQuantity: string;
      averageFilledPrice: string | null;
      filledAmount: string | null;
      commission: string | null;
      tax: string | null;
      filledAt: string | null;
    };
  }>;
  nextCursor: string | null;
  hasNext: boolean;
}

export async function getAllFilledOrders(accountSeq: number): Promise<FilledOrder[]> {
  const result: FilledOrder[] = [];
  let cursor: string | undefined;

  while (true) {
    const params: Record<string, string> = { status: 'CLOSED', limit: '100' };
    if (cursor) params.cursor = cursor;

    const data = await tossGet<TossOrdersResponse>('/api/v1/orders', { accountSeq, params });

    for (const order of data.orders) {
      if (order.status === 'FILLED' && order.execution.filledAt && order.execution.filledQuantity) {
        result.push({
          orderId: order.orderId,
          symbol: order.symbol,
          side: order.side,
          filledQuantity: parseFloat(order.execution.filledQuantity),
          averageFilledPrice: parseFloat(order.execution.averageFilledPrice ?? '0'),
          currency: order.currency,
          filledAt: order.execution.filledAt,
          filledAmount: parseFloat(order.execution.filledAmount ?? '0') || undefined,
          commission: parseFloat(order.execution.commission ?? '0') || 0,
          tax: parseFloat(order.execution.tax ?? '0') || 0,
        });
      }
    }

    if (!data.hasNext || !data.nextCursor) break;
    cursor = data.nextCursor;
  }

  return result.sort((a, b) => a.filledAt.localeCompare(b.filledAt));
}
