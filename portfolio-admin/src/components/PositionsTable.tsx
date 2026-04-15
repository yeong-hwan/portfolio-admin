import { memo, useState, useMemo } from "react";
import type { Position, SortKey, SortDir } from "../types";

function fmt(n: number | undefined | null): string {
  if (n == null || isNaN(n)) return "0";
  return n.toLocaleString("ko-KR", { maximumFractionDigits: 0 });
}

function pct(n: number | undefined | null): string {
  if (n == null || isNaN(n)) return "0.00%";
  return (n * 100).toFixed(2) + "%";
}

function pnlClass(n: number): string {
  if (n > 0) return "text-emerald-400";
  if (n < 0) return "text-rose-400";
  return "text-gray-400";
}

const COLUMNS: { key: SortKey; label: string; align?: string }[] = [
  { key: "symbol", label: "종목" },
  { key: "quantity", label: "수량", align: "right" },
  { key: "average_price", label: "매입가", align: "right" },
  { key: "current_price", label: "현재가", align: "right" },
  { key: "market_value", label: "평가금", align: "right" },
  { key: "unrealized_pnl", label: "손익", align: "right" },
  { key: "profit_rate", label: "수익률", align: "right" },
  { key: "daily_profit_loss", label: "일간 손익", align: "right" },
  { key: "daily_profit_rate", label: "일간 %", align: "right" },
];

export const PositionsTable = memo(function PositionsTable({ positions }: { positions: Position[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("market_value");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [filter, setFilter] = useState("");

  const sorted = useMemo(() => {
    const filtered = positions.filter(
      (p) =>
        p.symbol.toLowerCase().includes(filter.toLowerCase()) ||
        p.name.toLowerCase().includes(filter.toLowerCase())
    );
    return [...filtered].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === "number" && typeof bv === "number") {
        return sortDir === "asc" ? av - bv : bv - av;
      }
      return sortDir === "asc"
        ? String(av).localeCompare(String(bv))
        : String(bv).localeCompare(String(av));
    });
  }, [positions, sortKey, sortDir, filter]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const totalValue = positions.reduce((s, p) => s + p.market_value, 0);
  const totalPnl = positions.reduce((s, p) => s + p.unrealized_pnl, 0);
  const totalDailyPnl = positions.reduce((s, p) => s + p.daily_profit_loss, 0);

  return (
    <div className="bg-gray-800/60 backdrop-blur border border-gray-700/50 rounded-2xl overflow-hidden">
      <div className="p-4 border-b border-gray-700/50 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">
          보유 종목 ({positions.length})
        </h2>
        <input
          type="text"
          placeholder="종목 검색..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="bg-gray-700/50 border border-gray-600/50 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500/50 w-48"
        />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-700/50">
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  onClick={() => toggleSort(col.key)}
                  className={`px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider cursor-pointer hover:text-white transition-colors ${
                    col.align === "right" ? "text-right" : "text-left"
                  }`}
                >
                  {col.label}
                  {sortKey === col.key && (
                    <span className="ml-1">{sortDir === "asc" ? "▲" : "▼"}</span>
                  )}
                </th>
              ))}
              <th className="px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider text-right">
                비중
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((p) => (
              <tr
                key={p.symbol}
                className="border-b border-gray-700/30 hover:bg-gray-700/30 transition-colors"
              >
                <td className="px-4 py-3">
                  <div className="font-medium text-white">{p.symbol}</div>
                  <div className="text-xs text-gray-500">{p.name}</div>
                </td>
                <td className="px-4 py-3 text-right text-gray-300 font-mono">
                  {p.quantity.toFixed(2)}
                </td>
                <td className="px-4 py-3 text-right text-gray-300 font-mono">
                  ₩{fmt(p.average_price)}
                </td>
                <td className="px-4 py-3 text-right text-gray-300 font-mono">
                  ₩{fmt(p.current_price)}
                </td>
                <td className="px-4 py-3 text-right text-white font-mono font-medium">
                  ₩{fmt(p.market_value)}
                </td>
                <td className={`px-4 py-3 text-right font-mono ${pnlClass(p.unrealized_pnl)}`}>
                  ₩{fmt(p.unrealized_pnl)}
                </td>
                <td className={`px-4 py-3 text-right font-mono font-medium ${pnlClass(p.profit_rate)}`}>
                  {pct(p.profit_rate)}
                </td>
                <td className={`px-4 py-3 text-right font-mono ${pnlClass(p.daily_profit_loss)}`}>
                  ₩{fmt(p.daily_profit_loss)}
                </td>
                <td className={`px-4 py-3 text-right font-mono ${pnlClass(p.daily_profit_rate)}`}>
                  {pct(p.daily_profit_rate)}
                </td>
                <td className="px-4 py-3 text-right text-gray-400 font-mono">
                  {((p.market_value / totalValue) * 100).toFixed(1)}%
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-gray-600/50 bg-gray-800/80">
              <td className="px-4 py-3 font-semibold text-white" colSpan={4}>
                합계
              </td>
              <td className="px-4 py-3 text-right font-mono font-bold text-white">
                ₩{fmt(totalValue)}
              </td>
              <td className={`px-4 py-3 text-right font-mono font-bold ${pnlClass(totalPnl)}`}>
                ₩{fmt(totalPnl)}
              </td>
              <td className={`px-4 py-3 text-right font-mono font-bold ${pnlClass(totalPnl)}`}>
                {pct(totalPnl / (totalValue - totalPnl))}
              </td>
              <td className={`px-4 py-3 text-right font-mono font-bold ${pnlClass(totalDailyPnl)}`}>
                ₩{fmt(totalDailyPnl)}
              </td>
              <td colSpan={2}></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
});
