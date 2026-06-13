export interface OAuth2TokenResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
}

export interface ApiResponse<T> {
  result: T;
}

export interface TossAccount {
  accountNo: string;
  accountSeq: number;
  accountType: string;
}

export interface AmountPair {
  krw: string;
  usd: string | null;
}

export interface HoldingItem {
  symbol: string;
  name: string;
  marketCountry: 'KR' | 'US';
  currency: 'KRW' | 'USD';
  quantity: string;
  lastPrice: string;
  averagePurchasePrice: string;
  marketValue: {
    purchaseAmount: string;
    amount: string;
    amountAfterCost: string;
  };
  profitLoss: {
    amount: string;
    amountAfterCost: string;
    rate: string;
    rateAfterCost: string;
  };
  dailyProfitLoss: {
    amount: string;
    rate: string;
  };
  cost: {
    commission: string;
    tax: string | null;
  };
}

export interface HoldingsResponse {
  totalPurchaseAmount: AmountPair;
  marketValue: {
    amount: AmountPair;
    amountAfterCost: AmountPair;
  };
  profitLoss: {
    amount: AmountPair;
    amountAfterCost: AmountPair;
    rate: string;
    rateAfterCost: string;
  };
  dailyProfitLoss: {
    amount: AmountPair;
    rate: string;
  };
  items: HoldingItem[];
}

export interface ExchangeRateResult {
  baseCurrency: string;
  quoteCurrency: string;
  rate: string;
  midRate: string;
  basisPoint: string;
  rateChangeType: 'UP' | 'DOWN' | 'UNCHANGED';
  validFrom: string;
  validUntil: string;
}
