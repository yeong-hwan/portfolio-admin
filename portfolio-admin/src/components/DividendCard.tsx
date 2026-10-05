import { memo, useEffect, useState } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { isMasked, useMasked, MASK } from "../lib/privacy";

interface DividendIncome {
  totalGrossKrw: number;
  totalNetKrw: number;
  ttmGrossKrw: number;
  ttmNetKrw: number;
  monthly: Array<{ month: string; grossKrw: number }>;
  bySymbol: Array<{ symbol: string; grossKrw: number; events: number }>;
  note: string;
}

function fmtMan(n: number): string {
  if (isMasked()) return MASK;
  const man = n / 10000;
  return (man < 0 ? "-" : "") + Math.abs(man).toFixed(man < 100 ? 1 : 0) + "만";
}

export const DividendCard = memo(function DividendCard() {
  useMasked(); // 마스킹 토글 시 리렌더 구독
  const [data, setData] = useState<DividendIncome | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch("/api/dividends")
      .then((r) => r.json())
      .then((d) => (d && !d.error ? setData(d) : setError(true)))
      .catch(() => setError(true));
  }, []);

  if (error) {
    return (
      <div className="bg-white/[0.05] backdrop-blur border border-white/[0.08] rounded-2xl p-5 h-full">
        <h2 className="text-base font-semibold text-white mb-2">배당 인컴 (추정)</h2>
        <p className="text-xs text-gray-500">데이터 로드 실패 — 새로고침하면 다시 시도합니다.</p>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="bg-white/[0.05] backdrop-blur border border-white/[0.08] rounded-2xl p-5">
        <h2 className="text-base font-semibold text-white mb-4">배당 인컴 (추정)</h2>
        <p className="text-xs text-gray-500 py-8 text-center">로딩 중...</p>
      </div>
    );
  }

  return (
    <div className="bg-white/[0.05] backdrop-blur border border-white/[0.08] rounded-2xl p-5 flex flex-col">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-base font-semibold text-white">배당 인컴 (추정)</h2>
        <span className="text-[10px] text-gray-600">
          최근 1년 세전 <span className="text-emerald-400">{fmtMan(data.ttmGrossKrw)}</span>
          {" · 세후 "}<span className="text-emerald-400">{fmtMan(data.ttmNetKrw)}</span>
          {" · 월평균 "}<span className="text-gray-400">{fmtMan(data.ttmNetKrw / 12)}</span>
        </span>
      </div>

      <div className="flex-1 min-h-[180px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data.monthly} margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
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
              tickFormatter={(v: number) => (isMasked() ? MASK : Math.round(v / 10000) + "만")}
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
              formatter={(v) => [isMasked() ? MASK : `₩ ${Math.round(Number(v)).toLocaleString()}`, "세전 배당"]}
            />
            <Bar dataKey="grossKrw" fill="#10b981" fillOpacity={0.75} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
        {data.bySymbol.slice(0, 6).map((s) => (
          <span key={s.symbol} className="text-[11px] text-gray-500">
            {s.symbol} <span className="text-emerald-400/80 tabular-nums">{fmtMan(s.grossKrw)}</span>
          </span>
        ))}
      </div>
      <p className="mt-2 text-[10px] text-gray-600 leading-relaxed">{data.note}</p>
    </div>
  );
});
