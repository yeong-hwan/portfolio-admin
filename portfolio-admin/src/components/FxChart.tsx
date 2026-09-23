import { memo, useEffect, useRef, useState } from "react";
import { createChart, CandlestickSeries, ColorType } from "lightweight-charts";

interface FxCandle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

type Interval = "1d" | "1wk";
type Range = "3M" | "6M" | "1Y" | "All";

const INTERVALS: Array<{ key: Interval; label: string }> = [
  { key: "1d", label: "일봉" },
  { key: "1wk", label: "주봉" },
];
const RANGES: Range[] = ["3M", "6M", "1Y", "All"];

function filterByRange(candles: FxCandle[], range: Range): FxCandle[] {
  if (range === "All") return candles;
  const days = { "3M": 90, "6M": 180, "1Y": 365 }[range];
  const cutoff = new Date(Date.now() - days * 86400000).toISOString().split("T")[0];
  return candles.filter((c) => c.date >= cutoff);
}

export const FxChart = memo(function FxChart() {
  const [data, setData] = useState<Partial<Record<Interval, FxCandle[]>>>({});
  const [interval, setInterval] = useState<Interval>("1d");
  const [range, setRange] = useState<Range>("6M");
  const [error, setError] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<FxCandle | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ReturnType<typeof createChart> | null>(null);

  useEffect(() => {
    if (data[interval]) return;
    fetch(`/api/fx-candles?interval=${interval}`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((d) => Array.isArray(d) && setData((prev) => ({ ...prev, [interval]: d })))
      .catch((e) => setError(e.message));
  }, [interval, data]);

  const candles = data[interval];

  useEffect(() => {
    if (!candles || !containerRef.current) return;

    chartRef.current?.remove();
    chartRef.current = null;
    setTooltip(null);

    const filtered = filterByRange(candles, range);
    if (!filtered.length) return;

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: 380,
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
        formatter: (price: number) => price.toLocaleString("ko-KR", { maximumFractionDigits: 0 }),
      },
    });

    series.setData(
      filtered.map((c) => ({ time: c.date as any, open: c.open, high: c.high, low: c.low, close: c.close }))
    );
    chart.timeScale().fitContent();
    chartRef.current = chart;

    chart.subscribeCrosshairMove((param) => {
      if (!param.point || !param.time || !param.seriesData.size) {
        setTooltip(null);
        return;
      }
      const d = param.seriesData.get(series) as FxCandle | undefined;
      if (!d) { setTooltip(null); return; }
      setTooltip({ ...d, date: param.time as string });
    });

    return () => { chartRef.current?.remove(); chartRef.current = null; };
  }, [candles, range]);

  const filtered = candles ? filterByRange(candles, range) : [];
  const latest = filtered[filtered.length - 1];
  const first = filtered[0];
  const change = latest && first ? latest.close - first.open : 0;
  const changeRate = first?.open ? change / first.open : 0;
  const changePositive = change >= 0;

  return (
    <div className="bg-white/[0.05] backdrop-blur border border-white/[0.08] rounded-2xl p-5 flex flex-col">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div>
          <h2 className="text-base font-semibold text-white">USD/KRW 환율</h2>
          {latest && (
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-lg font-bold text-white">₩ {latest.close.toFixed(2)}</span>
              <span className={`text-xs font-medium ${changePositive ? "text-rose-400" : "text-blue-400"}`}>
                {changePositive ? "+" : ""}{change.toFixed(2)} ({changePositive ? "+" : ""}{(changeRate * 100).toFixed(2)}%)
              </span>
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <div className="flex gap-1 bg-gray-900/60 rounded-lg p-0.5 border border-white/[0.06]">
            {INTERVALS.map((iv) => (
              <button
                key={iv.key}
                onClick={() => setInterval(iv.key)}
                className={`px-2 py-1 rounded-md text-[10px] font-medium transition-colors ${
                  interval === iv.key ? "bg-gray-700 text-white" : "text-gray-500 hover:text-white"
                }`}
              >
                {iv.label}
              </button>
            ))}
          </div>
          <div className="flex gap-1">
            {RANGES.map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`px-2 py-1 rounded-lg text-[10px] font-medium transition-colors ${
                  range === r ? "bg-gray-700 text-white" : "text-gray-500 hover:text-white"
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && !candles && (
        <div className="flex items-center justify-center h-[380px] text-rose-400 text-sm">{error}</div>
      )}
      {!error && !candles && (
        <div className="flex items-center justify-center h-[380px] text-gray-500 text-xs">환율 데이터 로딩 중...</div>
      )}
      {candles && (
        <div className="relative">
          <div ref={containerRef} className="h-[380px]" />
          {tooltip && (
            <div className="absolute top-2 left-2 bg-gray-900/90 backdrop-blur border border-gray-700/60 rounded-xl px-3 py-2.5 text-xs pointer-events-none">
              <p className="text-gray-400 mb-1.5 font-medium">{tooltip.date}</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                <span className="text-gray-500">시가</span>
                <span className="text-white tabular-nums text-right">{tooltip.open.toFixed(2)}</span>
                <span className="text-gray-500">고가</span>
                <span className="text-green-400 tabular-nums text-right">{tooltip.high.toFixed(2)}</span>
                <span className="text-gray-500">저가</span>
                <span className="text-red-400 tabular-nums text-right">{tooltip.low.toFixed(2)}</span>
                <span className="text-gray-500">종가</span>
                <span className={`tabular-nums text-right ${tooltip.close >= tooltip.open ? "text-green-400" : "text-red-400"}`}>
                  {tooltip.close.toFixed(2)}
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
});
