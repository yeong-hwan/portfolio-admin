import { memo } from "react";
import type { AccountSummary } from "../types";
import type { ExchangeRate } from "../hooks/usePortfolio";

function fmt(n: number | undefined | null): string {
  if (n == null || isNaN(n)) return "0";
  return n.toLocaleString("ko-KR", { maximumFractionDigits: 0 });
}

function pct(n: number | undefined | null): string {
  if (n == null || isNaN(n)) return "0.00%";
  return (n * 100).toFixed(2) + "%";
}

interface Props {
  summary: AccountSummary;
  exchangeRate: ExchangeRate | null;
}

export const SummaryCards = memo(function SummaryCards({ summary, exchangeRate }: Props) {
  const principal = summary.total_asset_amount - summary.evaluated_profit_amount;
  const profit = summary.evaluated_profit_amount;
  const profitPositive = profit >= 0;
  const profitColor = profitPositive ? "text-emerald-400" : "text-rose-400";
  const profitSign = profitPositive ? "+" : "";
  const rate = exchangeRate?.rate ?? null;

  return (
    <div className="flex flex-col sm:flex-row gap-4">
      {/* 메인 블록: 총자산 + 투자원금 + 평가손익 */}
      <div className="flex-1 bg-gray-800/60 backdrop-blur border border-gray-700/50 rounded-2xl px-6 py-5 flex flex-col sm:flex-row sm:items-center gap-5 sm:gap-0">
        {/* 총 자산 */}
        <div className="sm:pr-6 sm:border-r sm:border-gray-700/50">
          <p className="text-xs text-gray-400 uppercase tracking-widest mb-1.5">총 자산</p>
          <p className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
            {`₩ ${fmt(summary.total_asset_amount)}`}
          </p>
        </div>

        {/* 투자원금 + 평가손익 */}
        <div className="sm:pl-6 flex gap-6 sm:gap-8">
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-widest mb-1.5">투자 원금</p>
            <p className="text-xl sm:text-2xl font-semibold text-gray-200">{`₩ ${fmt(principal)}`}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-widest mb-1.5">평가 손익</p>
            <p className={`text-xl sm:text-2xl font-semibold ${profitColor}`}>
              {`${profitSign}₩ ${fmt(profit)}`}
            </p>
            <p className={`text-xs font-medium mt-0.5 ${profitColor}`}>
              {profitSign}{pct(summary.profit_rate)}
            </p>
          </div>
        </div>
      </div>

      {/* 보조 블록: 환율 */}
      <div className="sm:w-40 bg-gray-800/40 backdrop-blur border border-gray-700/30 rounded-2xl px-5 py-5 flex flex-row sm:flex-col justify-between sm:justify-start sm:gap-1">
        <p className="text-[10px] text-gray-600 uppercase tracking-widest sm:mb-1.5">USD/KRW</p>
        <div className="text-right sm:text-left">
          <p className="text-base font-semibold text-gray-400">
            {rate ? `₩${rate.toFixed(2)}` : "—"}
          </p>
          <p className="text-[10px] text-gray-600 mt-0.5">
            {exchangeRate?.timestamp
              ? new Date(exchangeRate.timestamp).toLocaleDateString("ko-KR")
              : "로딩 중"}
          </p>
        </div>
      </div>
    </div>
  );
});
