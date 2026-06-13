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
  const principalAmount = summary.total_asset_amount - summary.evaluated_profit_amount;
  const profitColor =
    summary.evaluated_profit_amount >= 0 ? "text-emerald-400" : "text-rose-400";
  const rate = exchangeRate?.rate ?? null;
  const orderableKrwFromUsd = rate
    ? summary.orderable_amount_usd * rate
    : null;

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
      <Card label="총 자산" value={`₩${fmt(summary.total_asset_amount)}`} />
      <Card
        label="평가 손익"
        value={`₩${fmt(summary.evaluated_profit_amount)}`}
        sub={pct(summary.profit_rate)}
        color={profitColor}
      />
      <Card
        label="투자 원금"
        value={`₩${fmt(principalAmount)}`}
        sub={`평가 ₩${fmt(summary.total_asset_amount)}`}
      />
      <Card
        label="주문 가능"
        value={`$${summary.orderable_amount_usd.toLocaleString("en-US", { minimumFractionDigits: 2 })}`}
        sub={
          orderableKrwFromUsd
            ? `≈ ₩${fmt(orderableKrwFromUsd)}`
            : `₩${fmt(summary.orderable_amount_krw)}`
        }
      />
      <Card
        label="USD/KRW 환율"
        value={rate ? `₩${rate.toFixed(2)}` : "—"}
        sub={
          exchangeRate?.timestamp
            ? new Date(exchangeRate.timestamp).toLocaleDateString("ko-KR")
            : "로딩 중"
        }
      />
    </div>
  );
});

function Card({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
}) {
  return (
    <div className="bg-gray-800/60 backdrop-blur border border-gray-700/50 rounded-2xl p-5 hover:border-gray-600/50 transition-colors">
      <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">
        {label}
      </p>
      <p className={`text-xl font-bold ${color || "text-white"}`}>{value}</p>
      {sub && <p className={`text-sm mt-1 ${color || "text-gray-400"}`}>{sub}</p>}
    </div>
  );
}
