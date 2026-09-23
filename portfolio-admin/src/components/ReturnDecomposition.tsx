import { memo, useEffect, useState } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
} from "recharts";

interface MonthlyReturn {
  month: string;
  portfolio: number;
  benchmark: number;
  fx: number;
  price: number;
}

export const ReturnDecomposition = memo(function ReturnDecomposition() {
  const [monthly, setMonthly] = useState<MonthlyReturn[] | null>(null);

  useEffect(() => {
    fetch("/api/performance-metrics")
      .then((r) => r.json())
      .then((d) => d?.monthlyReturns && setMonthly(d.monthlyReturns))
      .catch(() => {});
  }, []);

  if (!monthly) {
    return (
      <div className="bg-white/[0.05] backdrop-blur border border-white/[0.08] rounded-2xl p-5">
        <h2 className="text-base font-semibold text-white mb-4">수익 분해: 주가 vs 환율</h2>
        <p className="text-xs text-gray-500 py-8 text-center">로딩 중...</p>
      </div>
    );
  }

  const data = monthly.map((m) => ({
    month: m.month,
    주가: Math.round(m.price * 10000) / 100,
    환율: Math.round(m.fx * 10000) / 100,
  }));

  const cumPrice = monthly.reduce((acc, m) => acc * (1 + m.price), 1) - 1;
  const cumFx = monthly.reduce((acc, m) => acc * (1 + m.fx), 1) - 1;
  const cumTotal = monthly.reduce((acc, m) => acc * (1 + m.portfolio), 1) - 1;

  const pctSigned = (v: number) => (v >= 0 ? "+" : "") + (v * 100).toFixed(1) + "%";

  return (
    <div className="bg-white/[0.05] backdrop-blur border border-white/[0.08] rounded-2xl p-5 flex flex-col">
      <div className="flex items-baseline justify-between mb-1">
        <h2 className="text-base font-semibold text-white">수익 분해: 주가 vs 환율</h2>
        <span className="text-[10px] text-gray-600">원화수익 = 주가 × 환율</span>
      </div>
      <p className="text-xs text-gray-500 mb-3">
        누적 <span className={cumTotal >= 0 ? "text-emerald-400" : "text-rose-400"}>{pctSigned(cumTotal)}</span>
        {" = 주가 "}
        <span className={cumPrice >= 0 ? "text-blue-400" : "text-rose-400"}>{pctSigned(cumPrice)}</span>
        {" · 환율 "}
        <span className={cumFx >= 0 ? "text-violet-400" : "text-rose-400"}>{pctSigned(cumFx)}</span>
      </p>

      <div className="flex-1 min-h-[220px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} stackOffset="sign" margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
            <XAxis
              dataKey="month"
              tick={{ fill: "#6b7280", fontSize: 10 }}
              tickFormatter={(m: string) => m.slice(2).replace("-", "/")}
              minTickGap={24}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: "#6b7280", fontSize: 10 }}
              tickFormatter={(v: number) => v + "%"}
              width={40}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              cursor={{ fill: "rgba(255,255,255,0.04)" }}
              contentStyle={{
                background: "#111827",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: "0.75rem",
                fontSize: "12px",
              }}
              labelStyle={{ color: "#9ca3af" }}
              formatter={(v, name) => [`${Number(v) >= 0 ? "+" : ""}${Number(v).toFixed(2)}%`, name]}
            />
            <Legend wrapperStyle={{ fontSize: "11px" }} />
            <ReferenceLine y={0} stroke="rgba(255,255,255,0.15)" />
            <Bar dataKey="주가" stackId="a" fill="#3b82f6" fillOpacity={0.8} />
            <Bar dataKey="환율" stackId="a" fill="#8b5cf6" fillOpacity={0.8} radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
});
