import { memo } from "react";
import type { Position } from "../types";

function pct(n: number | undefined | null): string {
  if (n == null || isNaN(n)) return "0.00%";
  return (n * 100).toFixed(2) + "%";
}

function fmt(n: number | undefined | null): string {
  if (n == null || isNaN(n)) return "0";
  return n.toLocaleString("ko-KR", { maximumFractionDigits: 0 });
}

export const TopMovers = memo(function TopMovers({ positions }: { positions: Position[] }) {
  const byDailyRate = [...positions].sort(
    (a, b) => b.daily_profit_rate - a.daily_profit_rate
  );
  const gainers = byDailyRate.filter((p) => p.daily_profit_rate > 0).slice(0, 5);
  const losers = byDailyRate.filter((p) => p.daily_profit_rate < 0).slice(-5).reverse();

  const byProfitRate = [...positions].sort(
    (a, b) => b.profit_rate - a.profit_rate
  );
  const bestAll = byProfitRate.filter((p) => p.profit_rate > 0).slice(0, 5);
  const worstAll = byProfitRate.filter((p) => p.profit_rate < 0).slice(-5).reverse();

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <MoverCard title="오늘 상승 Top 5" items={gainers} rateKey="daily_profit_rate" pnlKey="daily_profit_loss" />
      <MoverCard title="오늘 하락 Top 5" items={losers} rateKey="daily_profit_rate" pnlKey="daily_profit_loss" />
      <MoverCard title="전체 수익 Top 5" items={bestAll} rateKey="profit_rate" pnlKey="unrealized_pnl" />
      <MoverCard title="전체 손실 Top 5" items={worstAll} rateKey="profit_rate" pnlKey="unrealized_pnl" />
    </div>
  );
});

function MoverCard({
  title,
  items,
  rateKey,
  pnlKey,
}: {
  title: string;
  items: Position[];
  rateKey: "daily_profit_rate" | "profit_rate";
  pnlKey: "daily_profit_loss" | "unrealized_pnl";
}) {
  const maxRate = Math.max(...items.map((p) => Math.abs(p[rateKey])), 0);

  return (
    <div className="bg-gray-800/60 backdrop-blur border border-gray-700/50 rounded-2xl p-4">
      <h3 className="text-sm font-medium text-gray-400 mb-3">{title}</h3>
      <div className="space-y-2">
        {items.map((p) => {
          const rate = p[rateKey];
          const pnl = p[pnlKey];
          const color =
            rate > 0 ? "text-emerald-400" : rate < 0 ? "text-rose-400" : "text-gray-400";
          const barColor = rate > 0 ? "bg-emerald-500/20" : "bg-rose-500/20";
          const barWidth = maxRate > 0 ? (Math.abs(rate) / maxRate) * 100 : 0;

          return (
            <div key={p.symbol} className="flex items-center justify-between rounded-lg">
              <div className="relative flex-1 min-w-0 flex items-center gap-2 px-3 py-2.5">
                <div
                  className={`absolute inset-0 rounded-lg ${barColor}`}
                  style={{ width: `${barWidth}%` }}
                />
                <span className="relative text-sm font-medium text-white shrink-0">{p.symbol}</span>
                <span className="relative text-xs text-gray-500 truncate">{p.name}</span>
              </div>
              <div className="flex items-center gap-3 shrink-0 px-3 py-2.5">
                <span className={`text-sm font-mono ${color}`}>₩{fmt(pnl)}</span>
                <span className={`text-sm font-mono font-bold ${color}`}>{pct(rate)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
