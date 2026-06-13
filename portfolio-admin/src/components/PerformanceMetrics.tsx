import { useEffect, useRef, useState } from "react";
import { createChart, LineSeries, ColorType } from "lightweight-charts";

interface PortfolioStats {
  totalReturn: number;
  annualizedReturn: number;
  volatility: number;
  sharpe: number;
  mdd: number;
  mddFrom: string;
  mddTo: string;
}

interface BenchmarkStats {
  symbol: string;
  totalReturn: number;
  annualizedReturn: number;
  volatility: number;
  sharpe: number;
}

interface SeriesPoint {
  date: string;
  portfolio: number;
  benchmark: number | null;
}

interface Metrics {
  period: { from: string; to: string; tradingDays: number };
  portfolio: PortfolioStats;
  benchmark: BenchmarkStats;
  alpha: number;
  beta: number;
  correlation: number;
  series: SeriesPoint[];
}

function pct(v: number, digits = 1) {
  return (v * 100).toFixed(digits) + "%";
}

function StatCard({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub?: string;
  color?: "green" | "red" | "neutral";
}) {
  const textColor =
    color === "green" ? "text-green-400" : color === "red" ? "text-red-400" : "text-white";
  const accentColor =
    color === "green" ? "border-green-500/40" : color === "red" ? "border-red-500/40" : "border-white/10";
  return (
    <div className={`bg-white/[0.04] rounded-xl px-4 py-4 flex flex-col gap-1.5 border-t-2 ${accentColor}`}>
      <span className="text-[10px] text-gray-500 uppercase tracking-widest leading-none">{label}</span>
      <span className={`text-2xl font-bold leading-none ${textColor}`}>{value}</span>
      {sub && <span className="text-[11px] text-gray-500">{sub}</span>}
    </div>
  );
}

export function PerformanceMetrics() {
  const [data, setData] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ReturnType<typeof createChart> | null>(null);

  useEffect(() => {
    fetch("/api/performance-metrics")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => { setData(d); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, []);

  useEffect(() => {
    if (!data || !containerRef.current) return;
    chartRef.current?.remove();
    chartRef.current = null;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#9ca3af",
        fontFamily: "inherit",
      },
      grid: { vertLines: { color: "#1f2937" }, horzLines: { color: "#1f2937" } },
      crosshair: { mode: 1 },
      rightPriceScale: { borderColor: "#374151" },
      timeScale: { borderColor: "#374151", timeVisible: false },
      autoSize: true,
    });

    const portSeries = chart.addSeries(LineSeries, {
      color: "#60a5fa",
      lineWidth: 2,
      priceFormat: { type: "custom", formatter: (v: number) => v.toFixed(1), minMove: 0.1 },
    });
    const spySeries = chart.addSeries(LineSeries, {
      color: "#6b7280",
      lineWidth: 2,
      lineStyle: 2,
      priceFormat: { type: "custom", formatter: (v: number) => v.toFixed(1), minMove: 0.1 },
    });

    portSeries.setData(data.series.map((p) => ({ time: p.date as any, value: p.portfolio })));
    spySeries.setData(
      data.series.filter((p) => p.benchmark != null).map((p) => ({ time: p.date as any, value: p.benchmark! }))
    );

    chart.timeScale().fitContent();
    chartRef.current = chart;
  }, [data]);

  const p = data?.portfolio;
  const b = data?.benchmark;
  const sharpeColor = (s: number) => s >= 1 ? "green" : s >= 0.5 ? "neutral" : "red";

  return (
    <div className="bg-white/[0.05] backdrop-blur border border-white/[0.08] rounded-2xl p-5 h-full flex flex-col gap-5">
      <div className="flex items-center justify-between shrink-0">
        <div>
          <h2 className="text-lg font-semibold text-white">성과 지표</h2>
          {data && (
            <p className="text-xs text-gray-500 mt-0.5">
              {data.period.from} ~ {data.period.to} · {data.period.tradingDays} 거래일 · vs {b?.symbol}
            </p>
          )}
        </div>
      </div>

      {loading && (
        <div className="flex-1 flex items-center justify-center text-gray-500 text-sm gap-2">
          <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
          성과 지표 계산 중...
        </div>
      )}
      {!loading && error && (
        <div className="flex-1 flex items-center justify-center text-rose-400 text-sm">{error}</div>
      )}

      {!loading && !error && p && b && (
        <>
          {/* 포트폴리오 핵심 지표 */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 shrink-0">
            <StatCard
              label="총 수익률"
              value={pct(p.totalReturn)}
              color={p.totalReturn >= 0 ? "green" : "red"}
            />
            <StatCard
              label="연환산 수익률 (CAGR)"
              value={pct(p.annualizedReturn)}
              color={p.annualizedReturn >= 0 ? "green" : "red"}
            />
            <StatCard
              label="샤프 비율 (RF 4.5%)"
              value={p.sharpe.toFixed(2)}
              color={sharpeColor(p.sharpe)}
            />
            <StatCard
              label="최대 낙폭"
              value={pct(p.mdd)}
              sub={`${p.mddFrom.slice(2,7).replace('-','.')} ~ ${p.mddTo.slice(2,7).replace('-','.')}`}
              color="red"
            />
            <StatCard
              label="변동성 (연환산 σ)"
              value={pct(p.volatility)}
              color="neutral"
            />
          </div>

          {/* SPY 비교 */}
          <div className="border-t border-white/[0.08] pt-4 shrink-0">
            <div className="grid grid-cols-3 gap-3">
              <StatCard
                label="알파 (Jensen's α)"
                value={pct(data.alpha)}
                color={data.alpha >= 0 ? "green" : "red"}
              />
              <StatCard
                label="베타"
                value={data.beta.toFixed(2)}
                color={data.beta > 1.5 ? "red" : data.beta < 0.8 ? "green" : "neutral"}
              />
              <StatCard
                label="상관계수"
                value={data.correlation.toFixed(2)}
                color="neutral"
              />
            </div>
          </div>

          {/* 상대 성과 차트 */}
          <div className="border-t border-white/[0.08] pt-4 flex-1 min-h-0 flex flex-col">
            <div className="flex items-center gap-4 mb-3 shrink-0">
              <p className="text-xs text-gray-500 uppercase tracking-wide">상대 성과 (기준=100)</p>
              <div className="flex items-center gap-3 ml-auto">
                <span className="flex items-center gap-1.5 text-xs text-gray-400">
                  <span className="w-4 h-0.5 bg-blue-400 inline-block" />내 포트폴리오
                </span>
                <span className="flex items-center gap-1.5 text-xs text-gray-400">
                  <span className="w-4 h-0.5 bg-gray-500 inline-block rounded" style={{ borderTop: "2px dashed #6b7280" }} />SPY
                </span>
              </div>
            </div>
            <div ref={containerRef} className="flex-1 min-h-0" />
          </div>
        </>
      )}
    </div>
  );
}
