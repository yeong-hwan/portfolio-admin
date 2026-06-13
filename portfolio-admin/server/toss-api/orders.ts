import { tossGet } from './client.js';

export interface FilledOrder {
  orderId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  filledQuantity: number;
  averageFilledPrice: number;
  currency: 'KRW' | 'USD';
  filledAt: string;
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
        });
      }
    }

    if (!data.hasNext || !data.nextCursor) break;
    cursor = data.nextCursor;
  }

  return result.sort((a, b) => a.filledAt.localeCompare(b.filledAt));
}
