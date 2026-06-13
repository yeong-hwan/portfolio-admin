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
    <div className="flex gap-4">
      {/* 메인 블록: 총자산 + 투자원금 + 평가손익 */}
      <div className="flex-1 min-w-0 bg-white/[0.05] backdrop-blur border border-white/[0.08] rounded-2xl py-5 flex items-center divide-x divide-white/[0.08]">
        <div className="px-7 shrink-0">
          <p className="text-xs text-gray-400 uppercase tracking-widest mb-2">총 자산</p>
          <p className="text-xl lg:text-2xl font-bold text-white whitespace-nowrap">
            ₩ {fmt(summary.total_asset_amount)}
          </p>
        </div>
        <div className="px-7 shrink-0">
          <p className="text-xs text-gray-400 uppercase tracking-widest mb-2">투자 원금</p>
          <p className="text-xl lg:text-2xl font-bold text-white whitespace-nowrap">
            ₩ {fmt(principal)}
          </p>
        </div>
        <div className="px-7 shrink-0">
          <p className="text-xs text-gray-400 uppercase tracking-widest mb-2">평가 손익</p>
          <p className={`text-xl lg:text-2xl font-bold whitespace-nowrap ${profitColor}`}>
            {profitSign}₩ {fmt(profit)}
          </p>
          <p className={`text-xs font-medium mt-1 ${profitColor}`}>
            {profitSign}{pct(summary.profit_rate)}
          </p>
        </div>
      </div>

      {/* 보조 블록: 환율 */}
      <div className="w-36 shrink-0 bg-white/[0.03] backdrop-blur border border-white/[0.06] rounded-2xl px-5 py-6 flex flex-col justify-center gap-1">
        <p className="text-[10px] text-gray-600 uppercase tracking-widest">USD/KRW</p>
        <p className="text-base font-semibold text-gray-400 whitespace-nowrap">
          {rate ? `₩ ${rate.toFixed(2)}` : "—"}
        </p>
        <p className="text-[10px] text-gray-600">
          {exchangeRate?.timestamp
            ? new Date(exchangeRate.timestamp).toLocaleDateString("ko-KR")
            : "로딩 중"}
        </p>
      </div>
    </div>
  );
});
