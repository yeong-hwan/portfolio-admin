import { useMemo } from "react";
import type { Position } from "../types";
import type { SectorConfig } from "../hooks/usePortfolio";

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

const SECTOR_COLORS = [
  "#6366f1", "#8b5cf6", "#ec4899", "#f43f5e",
  "#f97316", "#eab308", "#22c55e", "#14b8a6",
  "#06b6d4", "#3b82f6", "#a855f7", "#64748b",
  "#d946ef", "#0ea5e9", "#84cc16", "#fb923c",
];

interface Props {
  positions: Position[];
  sectorConfig: SectorConfig;
  cashKrw: number;
}

interface SectorData {
  name: string;
  color: string;
  positions: Position[];
  totalValue: number;
  totalPnl: number;
  totalDailyPnl: number;
  weightedProfitRate: number;
}

export function SectorView({ positions, sectorConfig, cashKrw }: Props) {
  const { sectors, unmapped } = useMemo(() => {
    const posMap = new Map(positions.map((p) => [p.symbol, p]));
    const mappedSymbols = new Set<string>();
    const totalPortfolio =
      positions.reduce((s, p) => s + p.market_value, 0) + cashKrw;

    const sectors: SectorData[] = sectorConfig.sectors.map((sec, i) => {
      const sectorPositions: Position[] = [];
      for (const sym of sec.symbols) {
        const p = posMap.get(sym);
        if (p) {
          sectorPositions.push(p);
          mappedSymbols.add(sym);
        }
      }
      const totalValue = sectorPositions.reduce((s, p) => s + p.market_value, 0);
      const totalPnl = sectorPositions.reduce((s, p) => s + p.unrealized_pnl, 0);
      const totalDailyPnl = sectorPositions.reduce(
        (s, p) => s + p.daily_profit_loss, 0
      );
      const principal = totalValue - totalPnl;
      const weightedProfitRate = principal > 0 ? totalPnl / principal : 0;

      return {
        name: sec.name,
        color: SECTOR_COLORS[i % SECTOR_COLORS.length],
        positions: sectorPositions,
        totalValue,
        totalPnl,
        totalDailyPnl,
        weightedProfitRate,
      };
    });

    const unmapped = positions.filter((p) => !mappedSymbols.has(p.symbol));

    return { sectors, unmapped, totalPortfolio };
  }, [positions, sectorConfig, cashKrw]);

  const totalPortfolio =
    positions.reduce((s, p) => s + p.market_value, 0) + cashKrw;

  return (
    <div className="bg-gray-800/60 backdrop-blur border border-gray-700/50 rounded-2xl p-5">
      <h2 className="text-lg font-semibold text-white mb-4">섹터별 현황</h2>

      {/* Sector bar */}
      <div className="flex rounded-lg overflow-hidden h-8 mb-4">
        {sectors
          .filter((s) => s.totalValue > 0)
          .map((s) => (
            <div
              key={s.name}
              className="relative group cursor-default transition-[width] duration-200 ease-out"
              style={{
                width: `${(s.totalValue / totalPortfolio) * 100}%`,
                backgroundColor: s.color,
              }}
            >
              {(s.totalValue / totalPortfolio) * 100 > 5 && (
                <span className="absolute inset-0 flex items-center justify-center text-[10px] font-medium text-white truncate px-1">
                  {s.name}
                </span>
              )}
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-20 pointer-events-none">
                <div className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-xs whitespace-nowrap shadow-2xl">
                  <div className="font-medium text-white">{s.name}</div>
                  <div className="text-gray-400">
                    ₩{fmt(s.totalValue)} ({((s.totalValue / totalPortfolio) * 100).toFixed(1)}%)
                  </div>
                </div>
              </div>
            </div>
          ))}
        {cashKrw > 0 && (
          <div
            className="relative"
            style={{
              width: `${(cashKrw / totalPortfolio) * 100}%`,
              backgroundColor: "#475569",
            }}
          >
            {(cashKrw / totalPortfolio) * 100 > 5 && (
              <span className="absolute inset-0 flex items-center justify-center text-[10px] font-medium text-white">
                현금
              </span>
            )}
          </div>
        )}
      </div>

      {/* Sector cards grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {sectors
          .filter((s) => s.totalValue > 0)
          .map((s) => (
            <div
              key={s.name}
              className="bg-gray-700/30 rounded-xl p-4 hover:bg-gray-700/50 transition-all duration-300"
            >
              <div className="flex items-center gap-2 mb-2">
                <span
                  className="w-3 h-3 rounded-full flex-shrink-0"
                  style={{ backgroundColor: s.color }}
                />
                <span className="font-medium text-white text-sm">{s.name}</span>
                <span className="text-gray-500 text-xs ml-auto">
                  {((s.totalValue / totalPortfolio) * 100).toFixed(1)}%
                </span>
              </div>
              <div className="flex items-baseline justify-between mb-2">
                <span className="text-white font-mono text-sm">
                  ₩{fmt(s.totalValue)}
                </span>
                <span className={`font-mono text-sm font-medium ${pnlClass(s.weightedProfitRate)}`}>
                  {pct(s.weightedProfitRate)}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className={`font-mono ${pnlClass(s.totalPnl)}`}>
                  손익 ₩{fmt(s.totalPnl)}
                </span>
                <span className={`font-mono ${pnlClass(s.totalDailyPnl)}`}>
                  일간 ₩{fmt(s.totalDailyPnl)}
                </span>
              </div>
            </div>
          ))}
      </div>

      {/* Unmapped stocks warning */}
      {unmapped.length > 0 && (
        <div className="mt-4 px-4 py-3 bg-amber-900/20 border border-amber-700/30 rounded-xl">
          <p className="text-sm text-amber-400 mb-2">
            매핑되지 않은 종목 ({unmapped.length}개)
          </p>
          <div className="flex flex-wrap gap-1.5">
            {unmapped.map((p) => (
              <span
                key={p.symbol}
                className="text-xs px-2 py-1 bg-amber-800/30 text-amber-300 rounded font-mono"
              >
                {p.symbol}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
