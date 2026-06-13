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
    color === "green"
      ? "text-green-400"
      : color === "red"
      ? "text-red-400"
      : "text-white";
  return (
    <div className="bg-gray-900/60 rounded-xl p-4 flex flex-col gap-1">
      <span className="text-xs text-gray-500 uppercase tracking-wide">{label}</span>
      <span className={`text-xl font-bold ${textColor}`}>{value}</span>
      {sub && <span className="text-xs text-gray-500">{sub}</span>}
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
      width: containerRef.current.clientWidth,
      height: 260,
    });

    const portSeries = chart.addSeries(LineSeries, {
      color: "#60a5fa",
      lineWidth: 2,
      priceFormat: { type: "custom", formatter: (v: number) => v.toFixed(1), minMove: 0.1 },
    });
    const spySeries = chart.addSeries(LineSeries, {
      color: "#6b7280",
      lineWidth: 2,
      lineStyle: 2, // dashed
      priceFormat: { type: "custom", formatter: (v: number) => v.toFixed(1), minMove: 0.1 },
    });

    portSeries.setData(
      data.series.map((p) => ({ time: p.date as any, value: p.portfolio }))
    );
    spySeries.setData(
      data.series
        .filter((p) => p.benchmark != null)
        .map((p) => ({ time: p.date as any, value: p.benchmark! }))
    );

    chart.timeScale().fitContent();
    chartRef.current = chart;

    const onResize = () => {
      if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth });
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [data]);

  const p = data?.portfolio;
  const b = data?.benchmark;

  const sharpeColor = (s: number) =>
    s >= 1 ? "green" : s >= 0.5 ? "neutral" : "red";

  return (
    <div className="bg-gray-800/60 backdrop-blur border border-gray-700/50 rounded-2xl p-5 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">성과 지표</h2>
          {data && (
            <p className="text-xs text-gray-500 mt-0.5">
              {data.period.from} ~ {data.period.to} · {data.period.tradingDays}거래일 · vs {b?.symbol}
            </p>
          )}
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center h-40 text-gray-500 text-sm gap-2">
          <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
          성과 지표 계산 중...
        </div>
      )}
      {!loading && error && (
        <div className="text-rose-400 text-sm text-center py-8">{error}</div>
      )}

      {!loading && !error && p && b && (
        <>
          {/* 포트폴리오 핵심 지표 */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <StatCard
              label="총 수익률"
              value={pct(p.totalReturn)}
              color={p.totalReturn >= 0 ? "green" : "red"}
            />
            <StatCard
              label="연환산 수익률"
              value={pct(p.annualizedReturn)}
              sub="CAGR"
              color={p.annualizedReturn >= 0 ? "green" : "red"}
            />
            <StatCard
              label="샤프 비율"
              value={p.sharpe.toFixed(2)}
              sub="무위험 4.5%"
              color={sharpeColor(p.sharpe)}
            />
            <StatCard
              label="최대 낙폭"
              value={pct(p.mdd)}
              sub={`${p.mddFrom} ~ ${p.mddTo}`}
              color="red"
            />
            <StatCard
              label="변동성"
              value={pct(p.volatility)}
              sub="연환산 σ"
              color="neutral"
            />
          </div>

          {/* SPY 비교 */}
          <div className="border-t border-gray-700/50 pt-4">
            <p className="text-xs text-gray-500 mb-3 uppercase tracking-wide">vs SPY 비교</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <StatCard
                label="알파"
                value={pct(data.alpha)}
                sub="Jensen's α"
                color={data.alpha >= 0 ? "green" : "red"}
              />
              <StatCard
                label="베타"
                value={data.beta.toFixed(2)}
                sub={data.beta > 1 ? "시장보다 공격적" : "시장보다 방어적"}
                color={data.beta > 1.5 ? "red" : data.beta < 0.8 ? "green" : "neutral"}
              />
              <StatCard
                label="상관계수"
                value={data.correlation.toFixed(2)}
                color="neutral"
              />
              <StatCard
                label="SPY 수익률"
                value={pct(b.totalReturn)}
                color={b.totalReturn >= 0 ? "green" : "red"}
              />
              <StatCard
                label="SPY 샤프"
                value={b.sharpe.toFixed(2)}
                color={sharpeColor(b.sharpe)}
              />
              <StatCard
                label="SPY 변동성"
                value={pct(b.volatility)}
                sub="연환산 σ"
                color="neutral"
              />
            </div>
          </div>

          {/* 상대 성과 차트 */}
          <div className="border-t border-gray-700/50 pt-4">
            <div className="flex items-center gap-4 mb-3">
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
            <div ref={containerRef} />
          </div>
        </>
      )}
    </div>
  );
}
