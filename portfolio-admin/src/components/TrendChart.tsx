import { memo, useState } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from "recharts";
import type { Checkpoint } from "../types";

interface TrendChartProps {
  checkpoints: Checkpoint[];
  onRefresh?: () => void;
}

function fmt(n: number | undefined | null): string {
  if (n == null || isNaN(n)) return "0";
  return n.toLocaleString("ko-KR", { maximumFractionDigits: 0 });
}

function pct(n: number | undefined | null): string {
  if (n == null || isNaN(n)) return "0.00%";
  return (n >= 0 ? "+" : "") + (n * 100).toFixed(2) + "%";
}

interface ChartData {
  date: string;
  profit: number;       // evaluated_profit_amount (current)
  prevProfit: number | null;
  profitRate: number;
}

const PERIODS = [
  { label: "7D", days: 7 },
  { label: "30D", days: 30 },
  { label: "90D", days: 90 },
  { label: "ALL", days: null },
] as const;

// Bar from 0 → profit: green if positive, red if negative
function makeProfitShape(yMin: number, yMax: number) {
  return function ProfitShape(props: any) {
    const { x, width, payload, background } = props;
    if (!background) return null;

    const { y: bgY, height: bgH } = background;
    const range = yMax - yMin;
    const toPixel = (v: number) => bgY + bgH * (1 - (v - yMin) / range);

    const zero = toPixel(0);
    const curr = toPixel(payload.profit);
    const rectY = Math.min(zero, curr);
    const rectH = Math.max(Math.abs(zero - curr), 2);
    const fill = payload.profit >= 0 ? "#22c55e" : "#ef4444";
    const barW = width * 0.6;

    return (
      <rect
        x={x + (width - barW) / 2}
        y={rectY}
        width={barW}
        height={rectH}
        fill={fill}
        fillOpacity={0.85}
        rx={2}
      />
    );
  };
}

export const TrendChart = memo(function TrendChart({ checkpoints, onRefresh }: TrendChartProps) {
  const [period, setPeriod] = useState<number | null>(30);
  const [filling, setFilling] = useState(false);
  const [fillMessage, setFillMessage] = useState<string | null>(null);

  async function handleFillGaps() {
    setFilling(true);
    setFillMessage(null);
    try {
      const resp = await fetch("/api/checkpoints/fill-gaps", { method: "POST" });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "요청 실패");
      setFillMessage(`${data.filled}개 채움, ${data.skipped}개 건너뜀`);
      setTimeout(() => {
        setFillMessage(null);
        if (onRefresh) onRefresh();
        else window.location.reload();
      }, 2000);
    } catch (e: any) {
      setFillMessage(`오류: ${e.message}`);
      setTimeout(() => setFillMessage(null), 3000);
    } finally {
      setFilling(false);
    }
  }

  if (checkpoints.length === 0) {
    return (
      <div className="bg-gray-800/60 backdrop-blur border border-gray-700/50 rounded-2xl p-5">
        <h2 className="text-lg font-semibold text-white mb-4">수익 추이</h2>
        <p className="text-gray-500 text-sm py-12 text-center">
          아직 기록된 체크포인트가 없습니다. 미장 마감 후 자동으로 기록됩니다.
        </p>
      </div>
    );
  }

  const sorted = [...checkpoints].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  const filtered = period
    ? sorted.filter((cp) => {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - period);
        return new Date(cp.timestamp) >= cutoff;
      })
    : sorted;

  const data: ChartData[] = filtered.map((cp, i) => {
    const prev = i > 0 ? filtered[i - 1] : null;
    return {
      date: (cp as any).marketDate || cp.timestamp.split("T")[0],
      profit: cp.summary.evaluated_profit_amount,
      prevProfit: prev ? prev.summary.evaluated_profit_amount : null,
      profitRate: cp.summary.profit_rate,
    };
  });

  // Y domain: span all profit values with padding, always include 0
  const allProfits = data.flatMap((d) =>
    [d.profit, d.prevProfit ?? 0]
  );
  const rawMin = Math.min(0, ...allProfits);
  const rawMax = Math.max(0, ...allProfits);
  const pad = (rawMax - rawMin) * 0.08 || 100000;
  const yMin = rawMin - pad;
  const yMax = rawMax + pad;

  const ProfitShape = makeProfitShape(yMin, yMax);

  // Latest profit info
  const latest = data[data.length - 1];

  return (
    <div className="bg-gray-800/60 backdrop-blur border border-gray-700/50 rounded-2xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-white">
            수익 추이{" "}
            <span className="text-sm font-normal text-gray-500">({data.length}일)</span>
          </h2>
          {latest && (
            <p className={`text-sm font-mono mt-0.5 ${latest.profit >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
              {latest.profit >= 0 ? "+" : ""}₩{fmt(latest.profit)}{" "}
              <span className="text-xs opacity-70">{pct(latest.profitRate)}</span>
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {fillMessage && (
            <span className="text-xs text-gray-400">{fillMessage}</span>
          )}
          <button
            onClick={handleFillGaps}
            disabled={filling}
            className="px-2.5 py-1 text-xs rounded-lg transition-colors bg-gray-700/30 text-gray-500 hover:text-gray-300 hover:bg-gray-700/50 disabled:opacity-50 disabled:cursor-not-allowed border border-gray-700/50"
          >
            {filling ? (
              <span className="flex items-center gap-1">
                <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
                채우는 중...
              </span>
            ) : (
              "빈 날짜 채우기"
            )}
          </button>
          <div className="flex gap-1">
            {PERIODS.map(({ label, days }) => (
              <button
                key={label}
                onClick={() => setPeriod(days)}
                className={`px-2.5 py-1 text-xs rounded-lg transition-colors ${
                  period === days
                    ? "bg-blue-600 text-white"
                    : "bg-gray-700/50 text-gray-400 hover:text-white hover:bg-gray-700"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={data}
            margin={{ top: 5, right: 10, left: 10, bottom: 0 }}
            barCategoryGap="20%"
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fill: "#9ca3af", fontSize: 11 }}
              tickFormatter={(v) => v.slice(5)}
              stroke="#4b5563"
              tickLine={false}
            />
            <YAxis
              domain={[yMin, yMax]}
              tick={{ fill: "#9ca3af", fontSize: 11 }}
              tickFormatter={(v) =>
                v === 0 ? "0" : `${v >= 0 ? "+" : ""}${(v / 10000).toFixed(0)}만`
              }
              stroke="#4b5563"
              tickLine={false}
              axisLine={false}
              width={55}
            />
            <ReferenceLine y={0} stroke="#6b7280" strokeDasharray="4 2" />
            <Tooltip
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0]?.payload as ChartData;
                const daily = d.prevProfit !== null ? d.profit - d.prevProfit : null;
                const isUp = d.profit >= (d.prevProfit ?? 0);
                return (
                  <div className="px-3 py-2 bg-gray-900 border border-gray-700 rounded-xl text-xs space-y-0.5">
                    <p className="text-gray-400">{label}</p>
                    <p className={`font-mono ${d.profit >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                      {d.profit >= 0 ? "+" : ""}₩{fmt(d.profit)}{" "}
                      <span className="opacity-70">({pct(d.profitRate)})</span>
                    </p>
                    {daily !== null && (
                      <p className={`font-mono text-[10px] ${isUp ? "text-emerald-300" : "text-rose-300"}`}>
                        일간 {isUp ? "+" : ""}₩{fmt(daily)}
                      </p>
                    )}
                  </div>
                );
              }}
            />
            <Bar
              dataKey="profit"
              shape={<ProfitShape />}
              isAnimationActive={false}
              fill="transparent"
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
});
