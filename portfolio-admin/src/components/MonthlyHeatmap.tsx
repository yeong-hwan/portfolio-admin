import { memo, useEffect, useState } from "react";

interface MonthlyReturn {
  month: string; // YYYY-MM
  portfolio: number;
  benchmark: number;
  fx: number;
  price: number;
}

// 수익률 → 셀 배경색 (±8%에서 포화)
function cellStyle(r: number | null): React.CSSProperties {
  if (r == null) return { background: "rgba(255,255,255,0.02)" };
  const t = Math.min(Math.abs(r) / 0.08, 1);
  const alpha = 0.08 + t * 0.55;
  return {
    background: r >= 0 ? `rgba(16,185,129,${alpha})` : `rgba(244,63,94,${alpha})`,
  };
}

export const MonthlyHeatmap = memo(function MonthlyHeatmap() {
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
        <h2 className="text-base font-semibold text-white mb-4">월별 수익률</h2>
        <p className="text-xs text-gray-500 py-8 text-center">로딩 중...</p>
      </div>
    );
  }

  const byKey = new Map(monthly.map((m) => [m.month, m]));
  const years = [...new Set(monthly.map((m) => m.month.slice(0, 4)))].sort();

  function yearReturn(year: string): number | null {
    const ms = monthly!.filter((m) => m.month.startsWith(year));
    if (!ms.length) return null;
    return ms.reduce((acc, m) => acc * (1 + m.portfolio), 1) - 1;
  }

  return (
    <div className="bg-white/[0.05] backdrop-blur border border-white/[0.08] rounded-2xl p-5">
      <div className="flex items-baseline justify-between mb-4">
        <h2 className="text-base font-semibold text-white">월별 수익률</h2>
        <span className="text-[10px] text-gray-600">시간가중 · 입금 효과 제거</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[11px] border-separate" style={{ borderSpacing: "3px" }}>
          <thead>
            <tr className="text-gray-500">
              <th className="text-left font-normal w-10"></th>
              {Array.from({ length: 12 }, (_, i) => (
                <th key={i} className="font-normal">{i + 1}월</th>
              ))}
              <th className="font-medium text-gray-400">연간</th>
            </tr>
          </thead>
          <tbody>
            {years.map((year) => {
              const yr = yearReturn(year);
              return (
                <tr key={year}>
                  <td className="text-gray-400 font-medium">{year}</td>
                  {Array.from({ length: 12 }, (_, i) => {
                    const key = `${year}-${String(i + 1).padStart(2, "0")}`;
                    const m = byKey.get(key);
                    return (
                      <td
                        key={i}
                        className="text-center rounded-md py-1.5 text-white/90 tabular-nums"
                        style={cellStyle(m?.portfolio ?? null)}
                        title={m ? `${key}\n내 ${(m.portfolio * 100).toFixed(2)}% · SPY ${(m.benchmark * 100).toFixed(2)}%` : ""}
                      >
                        {m ? (m.portfolio * 100).toFixed(1) : ""}
                      </td>
                    );
                  })}
                  <td
                    className="text-center rounded-md py-1.5 font-semibold text-white tabular-nums"
                    style={cellStyle(yr)}
                  >
                    {yr != null ? (yr * 100).toFixed(1) : ""}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
});
