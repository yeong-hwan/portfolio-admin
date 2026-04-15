export interface Position {
  product_code: string;
  symbol: string;
  name: string;
  market_type: string;
  market_code: string;
  quantity: number;
  average_price: number;
  current_price: number;
  market_value: number;
  unrealized_pnl: number;
  profit_rate: number;
  daily_profit_loss: number;
  daily_profit_rate: number;
  average_price_usd: number;
  current_price_usd: number;
  market_value_usd: number;
  unrealized_pnl_usd: number;
  profit_rate_usd: number;
  daily_profit_loss_usd: number;
  daily_profit_rate_usd: number;
}

export interface MarketSummary {
  market: string;
  pending_buy_order_amount: number;
  evaluated_amount: number;
  principal_amount: number;
  evaluated_profit_amount: number;
  profit_rate: number;
  total_asset_amount: number;
  orderable_amount_krw: number;
  orderable_amount_usd: number;
}

export interface AccountSummary {
  total_asset_amount: number;
  evaluated_profit_amount: number;
  profit_rate: number;
  orderable_amount_krw: number;
  orderable_amount_usd: number;
  markets: Record<string, MarketSummary>;
}

export interface Snapshot {
  summary: AccountSummary;
  positions: Position[];
  timestamp: string;
  stale?: boolean;
  sessionExpired?: boolean;
  error?: string;
}

export interface Checkpoint {
  id: number;
  timestamp: string;
  marketDate?: string;
  synthetic?: boolean;
  summary: AccountSummary;
  positions: Position[];
}

export type SortKey = keyof Position;
export type SortDir = "asc" | "desc";
