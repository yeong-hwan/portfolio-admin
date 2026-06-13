import { useEffect, useRef, useState } from "react";
import { createChart, CandlestickSeries, ColorType } from "lightweight-charts";

interface PortfolioCandle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

type Range = "1M" | "3M" | "6M" | "YTD" | "1Y" | "All";

// 천만원 단위로 표시 (소수점 2자리, 3자리에서 내림)
function formatK(value: number): string {
  const k = Math.floor(value / 10_000_000 * 100) / 100;
  return k.toFixed(2) + " K";
}

const RANGES: Range[] = ["1M", "3M", "6M", "YTD", "1Y", "All"];

function filterByRange(candles: PortfolioCandle[], range: Range): PortfolioCandle[] {
  const today = new Date().toISOString().split("T")[0];
  if (range === "All") return candles;
  if (range === "YTD") return candles.filter(c => c.date >= today.slice(0, 4) + "-01-01");
  const days = { "1M": 30, "3M": 90, "6M": 180, "1Y": 365 }[range];
  const cutoff = new Date(Date.now() - days * 86400000).toISOString().split("T")[0];
  return candles.filter(c => c.date >= cutoff);
}

export function PortfolioCandles() {
  const [candles, setCandles] = useState<PortfolioCandle[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<Range>("All");
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ReturnType<typeof createChart> | null>(null);

  useEffect(() => {
    fetch("/api/portfolio-candles")
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(data => { setCandles(data); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, []);

  useEffect(() => {
    if (!candles || !containerRef.current) return;

    chartRef.current?.remove();
    chartRef.current = null;

    const filtered = filterByRange(candles, range);
    if (!filtered.length) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#9ca3af",
        fontFamily: "inherit",
      },
      grid: {
        vertLines: { color: "#1f2937" },
        horzLines: { color: "#1f2937" },
      },
      crosshair: { mode: 1 },
      rightPriceScale: { borderColor: "#374151" },
      timeScale: { borderColor: "#374151", timeVisible: false },
      width: containerRef.current.clientWidth,
      height: 380,
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderUpColor: "#22c55e",
      borderDownColor: "#ef4444",
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
      priceFormat: {
        type: "custom",
        formatter: (price: number) => formatK(price),
        minMove: 100000,
      },
    });

    series.setData(
      filtered.map(c => ({ time: c.date as any, open: c.open, high: c.high, low: c.low, close: c.close }))
    );
    chart.timeScale().fitContent();
    chartRef.current = chart;

    const onResize = () => {
      if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth });
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [candles, range]);

  return (
    <div className="bg-gray-800/60 backdrop-blur border border-gray-700/50 rounded-2xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-white">포트폴리오 캔들</h2>
          {candles && (
            <p className="text-xs text-gray-500 mt-0.5">{candles.length}거래일 · 매매이력 기반</p>
          )}
        </div>
        <div className="flex gap-1">
          {RANGES.map(r => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-2.5 py-1 text-xs rounded-lg transition-colors ${
                range === r
                  ? "bg-blue-600 text-white"
                  : "bg-gray-700/50 text-gray-400 hover:text-white hover:bg-gray-700"
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <div className="flex flex-col items-center justify-center h-[380px] gap-2 text-gray-500 text-sm">
          <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
          매매 이력 및 시세 데이터 로딩 중...
        </div>
      )}
      {!loading && error && (
        <div className="flex items-center justify-center h-[380px] text-rose-400 text-sm">{error}</div>
      )}
      {!loading && !error && (
        <div ref={containerRef} />
      )}
    </div>
  );
}
