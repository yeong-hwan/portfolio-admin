import { memo, useMemo } from "react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import type { Position } from "../types";

const COLORS = [
  "#6366f1", "#8b5cf6", "#a78bfa", "#c4b5fd",
  "#818cf8", "#60a5fa", "#38bdf8", "#22d3ee",
  "#2dd4bf", "#34d399", "#4ade80", "#a3e635",
  "#facc15", "#fb923c", "#f87171", "#e879f9",
];

function fmt(n: number | undefined | null): string {
  if (n == null || isNaN(n)) return "0";
  return n.toLocaleString("ko-KR", { maximumFractionDigits: 0 });
}

export const AllocationChart = memo(function AllocationChart({ positions, cashKrw = 0 }: { positions: Position[]; cashKrw?: number }) {
  const data = useMemo(() => {
    const total = positions.reduce((s, p) => s + p.market_value, 0) + cashKrw;
    const sorted = [...positions].sort((a, b) => b.market_value - a.market_value);
    const top = sorted.slice(0, 13);
    const rest = sorted.slice(13);
    const restValue = rest.reduce((s, p) => s + p.market_value, 0);

    const items = top.map((p, i) => ({
      name: p.symbol,
      value: p.market_value,
      pct: (p.market_value / total) * 100,
      color: COLORS[i % COLORS.length],
    }));

    if (restValue > 0) {
      items.push({
        name: `기타 (${rest.length})`,
        value: restValue,
        pct: (restValue / total) * 100,
        color: "#6b7280",
      });
    }

    if (cashKrw > 0) {
      items.push({
        name: "현금",
        value: cashKrw,
        pct: (cashKrw / total) * 100,
        color: "#94a3b8",
      });
    }

    return items;
  }, [positions]);

  return (
    <div className="bg-gray-800/60 backdrop-blur border border-gray-700/50 rounded-2xl p-5 h-full">
      <h2 className="text-lg font-semibold text-white mb-2">포트폴리오 비중</h2>
      <div style={{ height: 240 }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={60}
              outerRadius={110}
              paddingAngle={1}
              dataKey="value"
              stroke="none"
            >
              {data.map((d) => (
                <Cell key={d.name} fill={d.color} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                backgroundColor: "#1f2937",
                border: "1px solid #374151",
                borderRadius: "12px",
                fontSize: "13px",
              }}
              formatter={(value, name) => [
                `₩${fmt(Number(value))}`,
                String(name),
              ]}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm mt-3">
        {data.map((d) => (
          <div key={d.name} className="flex items-center gap-2 min-w-0">
            <span
              className="w-2.5 h-2.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: d.color }}
            />
            <span className="text-gray-200 truncate">{d.name}</span>
            <span className="text-gray-400 ml-auto font-mono flex-shrink-0">
              {d.pct.toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
});
