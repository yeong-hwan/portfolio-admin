import { memo, useEffect, useState } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";

interface DrawdownPoint {
  date: string;
  portfolio: number;
  benchmark: number;
}

export const DrawdownChart = memo(function DrawdownChart() {
  const [drawdown, setDrawdown] = useState<DrawdownPoint[] | null>(null);
  const [mdd, setMdd] = useState<number>(0);

  useEffect(() => {
    fetch("/api/performance-metrics")
      .then((r) => r.json())
      .then((d) => {
        if (d?.drawdown) {
          setDrawdown(d.drawdown);
          setMdd(d.portfolio?.mdd ?? 0);
        }
      })
      .catch(() => {});
  }, []);

  if (!drawdown) {
    return (
      <div className="bg-white/[0.05] backdrop-blur border border-white/[0.08] rounded-2xl p-5">
        <h2 className="text-base font-semibold text-white mb-4">드로다운</h2>
        <p className="text-xs text-gray-500 py-8 text-center">로딩 중...</p>
      </div>
    );
  }

  const current = drawdown[drawdown.length - 1];
  const data = drawdown.map((d) => ({
    date: d.date,
    내포트: Math.round(d.portfolio * 10000) / 100,
    SPY적립: Math.round(d.benchmark * 10000) / 100,
  }));

  return (
    <div className="bg-white/[0.05] backdrop-blur border border-white/[0.08] rounded-2xl p-5 flex flex-col">
      <div className="flex items-baseline justify-between mb-1">
        <h2 className="text-base font-semibold text-white">드로다운 (고점 대비 낙폭)</h2>
        <span className="text-[10px] text-gray-600">시간가중 · 입금 효과 제거</span>
      </div>
      <p className="text-xs text-gray-500 mb-3">
        현재 <span className={current.portfolio < -0.01 ? "text-rose-400" : "text-emerald-400"}>
          {(current.portfolio * 100).toFixed(1)}%
        </span>
        {" · 최대 "}
        <span className="text-rose-400">{(mdd * 100).toFixed(1)}%</span>
        {" · SPY 적립 현재 "}
        <span className="text-gray-400">{(current.benchmark * 100).toFixed(1)}%</span>
      </p>

      <div className="flex-1 min-h-[220px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="ddGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#f43f5e" stopOpacity={0.05} />
                <stop offset="100%" stopColor="#f43f5e" stopOpacity={0.45} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fill: "#6b7280", fontSize: 10 }}
              tickFormatter={(d: string) => d.slice(2, 7).replace("-", "/")}
              minTickGap={40}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: "#6b7280", fontSize: 10 }}
              tickFormatter={(v: number) => v + "%"}
              width={42}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              contentStyle={{
                background: "#111827",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: "0.75rem",
                fontSize: "12px",
              }}
              labelStyle={{ color: "#9ca3af" }}
              formatter={(v, name) => [`${Number(v).toFixed(2)}%`, name]}
            />
            <Area type="monotone" dataKey="내포트" stroke="#f43f5e" strokeWidth={1.5} fill="url(#ddGradient)" dot={false} />
            <Area type="monotone" dataKey="SPY적립" stroke="#6b7280" strokeWidth={1.5} strokeDasharray="4 3" fill="none" dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
});
