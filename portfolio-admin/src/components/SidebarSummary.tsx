import { memo } from "react";
import type { AccountSummary } from "../types";
import type { ExchangeRate } from "../hooks/usePortfolio";
import { isMasked, useMasked, MASK } from "../lib/privacy";

function fmt(n: number | undefined | null): string {
  if (isMasked()) return MASK;
  if (n == null || isNaN(n)) return "0";
  return n.toLocaleString("ko-KR", { maximumFractionDigits: 0 });
}

interface Props {
  summary: AccountSummary;
  exchangeRate: ExchangeRate | null;
}

// 와이드 사이드바용 자산 요약 — 세로형 컴팩트
export const SidebarSummary = memo(function SidebarSummary({ summary, exchangeRate }: Props) {
  useMasked(); // 마스킹 토글 시 리렌더 구독
  const profit = summary.evaluated_profit_amount;
  const positive = profit >= 0;
  const color = positive ? "text-emerald-400" : "text-rose-400";
  const sign = positive ? "+" : "";

  return (
    <div className="bg-white/[0.05] backdrop-blur border border-white/[0.08] rounded-2xl px-5 py-4">
      <p className="text-xs text-gray-400 uppercase tracking-widest">총 자산</p>
      <p className="text-2xl font-bold text-white mt-1">₩ {fmt(summary.total_asset_amount)}</p>
      <div className="mt-2 flex items-baseline justify-between">
        <span className={`text-sm font-semibold ${color}`}>
          {sign}₩ {fmt(profit)} ({sign}{(summary.profit_rate * 100).toFixed(2)}%)
        </span>
        <span className="text-xs text-gray-500">
          USD/KRW {exchangeRate ? `₩${exchangeRate.rate.toFixed(1)}` : "—"}
        </span>
      </div>
    </div>
  );
});
