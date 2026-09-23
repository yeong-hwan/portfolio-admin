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
  finalValueKrw: number;
}

interface BenchmarkStats {
  symbol: string;
  totalReturn: number;
  annualizedReturn: number;
  volatility: number;
  sharpe: number;
  mdd: number;
  finalValueKrw: number;
}

interface SeriesPoint {
  date: string;
  portfolio: number;
  benchmark: number;
}

interface Metrics {
  period: { from: string; to: string; tradingDays: number };
  deposits: { totalKrw: number; count: number };
  portfolio: PortfolioStats;
  benchmark: BenchmarkStats;
  alpha: number;
  beta: number;
  correlation: number;
  excess: {
    totalReturn: number;
    valueDiffKrw: number;
    informationRatio: number;
  };
  series: SeriesPoint[];
}

function pct(v: number, digits = 1) {
  return (v * 100).toFixed(digits) + "%";
}

function pctPoint(v: number, digits = 1) {
  return (v >= 0 ? "+" : "") + (v * 100).toFixed(digits) + "%p";
}

function fmtMan(v: number) {
  const man = Math.round(v / 10000);
  return (man >= 0 ? "" : "-") + Math.abs(man).toLocaleString("ko-KR") + "만";
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
    <div className="bg-white/[0.04] rounded-xl p-5 flex flex-col gap-1.5">
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
      height: 220,
    });

    const krwFormat = {
      type: "custom" as const,
      formatter: (v: number) => fmtMan(v),
      minMove: 10000,
    };
    const portSeries = chart.addSeries(LineSeries, {
      color: "#60a5fa",
      lineWidth: 2,
      priceFormat: krwFormat,
    });
    const spySeries = chart.addSeries(LineSeries, {
      color: "#6b7280",
      lineWidth: 2,
      lineStyle: 2, // dashed
      priceFormat: krwFormat,
    });

    portSeries.setData(
      data.series.map((p) => ({ time: p.date as any, value: p.portfolio }))
    );
    spySeries.setData(
      data.series.map((p) => ({ time: p.date as any, value: p.benchmark }))
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
    <div className="bg-white/[0.05] backdrop-blur border border-white/[0.08] rounded-2xl p-5 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">성과 지표</h2>
          {data && (
            <p className="text-xs text-gray-500 mt-0.5">
              {data.period.from} ~ {data.period.to} · 실투입 {fmtMan(data.deposits.totalKrw)} · 동일 입금 흐름 {b?.symbol} 적립 시뮬 대비
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
          {/* 포트폴리오 핵심 지표 — SPY 대비 상대 성과 중심 */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <StatCard
              label="실투입 대비 수익률"
              value={pctPoint(data.excess.totalReturn)}
              sub={`내 ${pct(p.totalReturn)} · SPY 적립 ${pct(b.totalReturn)}`}
              color={data.excess.totalReturn >= 0 ? "green" : "red"}
            />
            <StatCard
              label="가치 차이 (vs SPY 적립)"
              value={fmtMan(data.excess.valueDiffKrw)}
              sub={`내 ${fmtMan(p.finalValueKrw)} · SPY 적립 ${fmtMan(b.finalValueKrw)}`}
              color={data.excess.valueDiffKrw >= 0 ? "green" : "red"}
            />
            <StatCard
              label="샤프 (채권 대비 · RF 4.5%)"
              value={p.sharpe.toFixed(2)}
              sub={`SPY 적립 ${b.sharpe.toFixed(2)}`}
              color={sharpeColor(p.sharpe)}
            />
            <StatCard
              label="샤프 (SPY 대비 · IR)"
              value={data.excess.informationRatio.toFixed(2)}
              sub="정보비율: 초과수익 ÷ 추적오차"
              color={data.excess.informationRatio >= 0.5 ? "green" : data.excess.informationRatio >= 0 ? "neutral" : "red"}
            />
            <StatCard
              label="최대 낙폭"
              value={pct(p.mdd)}
              sub={`${p.mddFrom.slice(2,7).replace('-','.')} ~ ${p.mddTo.slice(2,7).replace('-','.')} · SPY 적립 ${pct(b.mdd)}`}
              color="red"
            />
            <StatCard
              label="변동성 (연환산 σ)"
              value={pct(p.volatility)}
              sub={`SPY 적립 ${pct(b.volatility)}`}
              color="neutral"
            />
          </div>

          {/* SPY 비교 */}
          <div className="border-t border-white/[0.08] pt-4">
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
          <div className="border-t border-white/[0.08] pt-4">
            <div className="flex items-center gap-4 mb-3">
              <p className="text-xs text-gray-500 uppercase tracking-wide">자산 가치 비교 (₩ · 동일 입금)</p>
              <div className="flex items-center gap-3 ml-auto">
                <span className="flex items-center gap-1.5 text-xs text-gray-400">
                  <span className="w-4 h-0.5 bg-blue-400 inline-block" />내 포트폴리오
                </span>
                <span className="flex items-center gap-1.5 text-xs text-gray-400">
                  <span className="w-4 h-0.5 bg-gray-500 inline-block rounded" style={{ borderTop: "2px dashed #6b7280" }} />SPY 적립 시뮬
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
