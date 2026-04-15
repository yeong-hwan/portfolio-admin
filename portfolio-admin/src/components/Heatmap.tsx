import { memo, useMemo, useRef, useLayoutEffect, useState } from "react";
import type { Position } from "../types";

function pct(n: number | undefined | null): string {
  if (n == null || isNaN(n)) return "0.00%";
  return (n * 100).toFixed(2) + "%";
}

function fmt(n: number | undefined | null): string {
  if (n == null || isNaN(n)) return "0";
  return n.toLocaleString("ko-KR", { maximumFractionDigits: 0 });
}

// 원금기준: ±40% 스케일
function getTotalColor(rate: number): string {
  const r = rate * 100;
  if (r >= 40) return "#059669";
  if (r >= 20) return "#0d9488";
  if (r >= 10) return "#14b8a6";
  if (r >= -10) return "#374151";
  if (r >= -20) return "#ef4444";
  if (r >= -40) return "#dc2626";
  return "#b91c1c";
}

// 오늘기준: ±5% 스케일
function getDailyColor(rate: number): string {
  const r = rate * 100;
  if (r >= 5) return "#059669";
  if (r >= 2) return "#0d9488";
  if (r >= 0.5) return "#14b8a6";
  if (r >= -0.5) return "#374151";
  if (r >= -2) return "#ef4444";
  if (r >= -5) return "#dc2626";
  return "#b91c1c";
}

interface TreemapRect {
  x: number;
  y: number;
  w: number;
  h: number;
  position: Position;
}

// Squarified treemap algorithm
function squarify(
  items: { value: number; position: Position }[],
  x: number,
  y: number,
  w: number,
  h: number
): TreemapRect[] {
  if (items.length === 0) return [];
  if (items.length === 1) {
    return [{ x, y, w, h, position: items[0].position }];
  }

  const total = items.reduce((s, i) => s + i.value, 0);
  if (total === 0) return [];

  // Sort descending
  const sorted = [...items].sort((a, b) => b.value - a.value);

  const rects: TreemapRect[] = [];
  layoutStrip(sorted, x, y, w, h, total, rects);
  return rects;
}

function layoutStrip(
  items: { value: number; position: Position }[],
  x: number,
  y: number,
  w: number,
  h: number,
  total: number,
  rects: TreemapRect[]
) {
  if (items.length === 0) return;
  if (items.length === 1) {
    rects.push({ x, y, w, h, position: items[0].position });
    return;
  }

  const isVertical = w >= h;

  // Find best split using squarified approach
  let bestIdx = 1;
  let bestWorst = Infinity;

  for (let i = 1; i <= items.length; i++) {
    const stripSum = items.slice(0, i).reduce((s, it) => s + it.value, 0);
    const stripFrac = stripSum / total;
    const stripSize = isVertical ? w * stripFrac : h * stripFrac;
    const crossSize = isVertical ? h : w;

    let worstRatio = 0;
    for (let j = 0; j < i; j++) {
      const itemFrac = items[j].value / stripSum;
      const itemSize = crossSize * itemFrac;
      const ratio = Math.max(stripSize / itemSize, itemSize / stripSize);
      worstRatio = Math.max(worstRatio, ratio);
    }

    if (worstRatio <= bestWorst) {
      bestWorst = worstRatio;
      bestIdx = i;
    } else {
      break;
    }
  }

  const stripItems = items.slice(0, bestIdx);
  const remaining = items.slice(bestIdx);
  const stripSum = stripItems.reduce((s, it) => s + it.value, 0);
  const stripFrac = stripSum / total;

  if (isVertical) {
    const stripW = w * stripFrac;
    let cy = y;
    for (const item of stripItems) {
      const itemH = h * (item.value / stripSum);
      rects.push({ x, y: cy, w: stripW, h: itemH, position: item.position });
      cy += itemH;
    }
    const remTotal = total - stripSum;
    if (remaining.length > 0 && remTotal > 0) {
      layoutStrip(remaining, x + stripW, y, w - stripW, h, remTotal, rects);
    }
  } else {
    const stripH = h * stripFrac;
    let cx = x;
    for (const item of stripItems) {
      const itemW = w * (item.value / stripSum);
      rects.push({ x: cx, y, w: itemW, h: stripH, position: item.position });
      cx += itemW;
    }
    const remTotal = total - stripSum;
    if (remaining.length > 0 && remTotal > 0) {
      layoutStrip(remaining, x, y + stripH, w, h - stripH, remTotal, rects);
    }
  }
}

type HeatmapMode = "today" | "total";

export const Heatmap = memo(function Heatmap({ positions, cashKrw = 0 }: { positions: Position[]; cashKrw?: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 800, h: 450 });
  const [mode, setMode] = useState<HeatmapMode>("today");

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      const { width } = entries[0].contentRect;
      setDims({ w: width, h: Math.max(350, width * 0.45) });
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const rects = useMemo(() => {
    const items: { value: number; position: Position }[] = positions.map((p) => ({
      value: p.market_value,
      position: p,
    }));
    if (cashKrw > 0) {
      items.push({
        value: cashKrw,
        position: {
          product_code: "CASH",
          symbol: "CASH",
          name: "현금 (주문가능)",
          market_type: "CASH",
          market_code: "CASH",
          quantity: 1,
          average_price: cashKrw,
          current_price: cashKrw,
          market_value: cashKrw,
          unrealized_pnl: 0,
          profit_rate: 0,
          daily_profit_loss: 0,
          daily_profit_rate: 0,
          average_price_usd: 0,
          current_price_usd: 0,
          market_value_usd: 0,
          unrealized_pnl_usd: 0,
          profit_rate_usd: 0,
          daily_profit_loss_usd: 0,
          daily_profit_rate_usd: 0,
        },
      });
    }
    return squarify(items, 0, 0, dims.w, dims.h);
  }, [positions, cashKrw, dims]);

  const todayLegend: [string, string][] = [
    ["#b91c1c", "-5%"], ["#dc2626", "-2%"], ["#ef4444", "-0.5%"],
    ["#374151", "0%"],
    ["#14b8a6", "+0.5%"], ["#0d9488", "+2%"], ["#059669", "+5%"],
  ];
  const totalLegend: [string, string][] = [
    ["#b91c1c", "-40%"], ["#dc2626", "-20%"], ["#ef4444", "-10%"],
    ["#374151", "0%"],
    ["#14b8a6", "+10%"], ["#0d9488", "+20%"], ["#059669", "+40%"],
  ];
  const legend = mode === "today" ? todayLegend : totalLegend;

  return (
    <div className="bg-gray-800/60 backdrop-blur border border-gray-700/50 rounded-2xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-white">수익률 히트맵</h2>
        <div className="flex gap-1">
          {(["today", "total"] as HeatmapMode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-2.5 py-1 text-xs rounded-lg transition-colors ${
                mode === m
                  ? "bg-blue-600 text-white"
                  : "bg-gray-700/50 text-gray-400 hover:text-white hover:bg-gray-700"
              }`}
            >
              {m === "today" ? "오늘 기준" : "원금 기준"}
            </button>
          ))}
        </div>
      </div>
      <div ref={containerRef} className="relative" style={{ height: dims.h }}>
        {rects.map((r) => {
          const p = r.position;
          const rate = mode === "today" ? p.daily_profit_rate : p.profit_rate;
          const color = mode === "today" ? getDailyColor(rate) : getTotalColor(rate);
          const showName = r.w > 55 && r.h > 40;
          const showPct = r.w > 40 && r.h > 28;
          const fontSize = r.w > 100 && r.h > 60 ? "text-sm" : "text-[10px]";
          const symbolSize = r.w > 100 && r.h > 60 ? "text-sm" : "text-xs";

          return (
            <div
              key={p.symbol}
              className="absolute rounded-sm flex flex-col items-center justify-center cursor-default transition-all hover:brightness-125 hover:z-10 group overflow-hidden"
              style={{
                left: r.x + 1,
                top: r.y + 1,
                width: r.w - 2,
                height: r.h - 2,
                backgroundColor: color,
              }}
            >
              {showName && (
                <span className={`font-bold text-white ${symbolSize} leading-tight`}>
                  {p.symbol}
                </span>
              )}
              {showPct && (
                <span className={`font-mono text-white/90 ${fontSize} leading-tight`}>
                  {pct(rate)}
                </span>
              )}
              {/* Tooltip */}
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-50 pointer-events-none">
                <div className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-xs whitespace-nowrap shadow-2xl">
                  <div className="font-medium text-white">
                    {p.symbol} · {p.name}
                  </div>
                  <div className="text-gray-400 mt-1">
                    평가금: ₩{fmt(p.market_value)}
                  </div>
                  <div className={p.unrealized_pnl >= 0 ? "text-emerald-400" : "text-rose-400"}>
                    손익: ₩{fmt(p.unrealized_pnl)} ({pct(p.profit_rate)})
                  </div>
                  <div className={p.daily_profit_loss >= 0 ? "text-emerald-400" : "text-rose-400"}>
                    일간: ₩{fmt(p.daily_profit_loss)} ({pct(p.daily_profit_rate)})
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {/* Legend */}
      <div className="flex items-center justify-center gap-2 mt-4 text-[10px] text-gray-400">
        {legend.map(([color, label]) => (
          <div key={label} className="flex items-center gap-1">
            <span className="w-4 h-3 rounded-sm inline-block" style={{ backgroundColor: color }} />
            <span>{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
});
