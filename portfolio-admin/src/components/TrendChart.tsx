import { memo } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from "recharts";
import type { Checkpoint } from "../types";

function fmt(n: number | undefined | null): string {
  if (n == null || isNaN(n)) return "0";
  return n.toLocaleString("ko-KR", { maximumFractionDigits: 0 });
}

interface ChartData {
  date: string;
  totalAsset: number;
  dailyChange: number;
  dailyChangeUp: number;
  dailyChangeDown: number;
  profitRate: number;
}

export const TrendChart = memo(function TrendChart({ checkpoints }: { checkpoints: Checkpoint[] }) {
  if (checkpoints.length === 0) {
    return (
      <div className="bg-gray-800/60 backdrop-blur border border-gray-700/50 rounded-2xl p-5">
        <h2 className="text-lg font-semibold text-white mb-4">자산 추이</h2>
        <p className="text-gray-500 text-sm py-12 text-center">
          아직 기록된 체크포인트가 없습니다. 미장 마감 후 자동으로 기록됩니다.
        </p>
      </div>
    );
  }

  const sorted = [...checkpoints].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  const data: ChartData[] = sorted.map((cp, i) => {
    const prev = i > 0 ? sorted[i - 1] : null;
    const dailyChange = prev
      ? cp.summary.total_asset_amount - prev.summary.total_asset_amount
      : 0;
    return {
      date: (cp as any).marketDate || cp.timestamp.split("T")[0],
      totalAsset: cp.summary.total_asset_amount,
      dailyChange,
      dailyChangeUp: dailyChange >= 0 ? dailyChange : 0,
      dailyChangeDown: dailyChange < 0 ? dailyChange : 0,
      profitRate: cp.summary.profit_rate * 100,
    };
  });

  return (
    <div className="bg-gray-800/60 backdrop-blur border border-gray-700/50 rounded-2xl p-5">
      <h2 className="text-lg font-semibold text-white mb-4">
        자산 추이{" "}
        <span className="text-sm font-normal text-gray-500">
          ({data.length}일)
        </span>
      </h2>

      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis
              dataKey="date"
              tick={{ fill: "#9ca3af", fontSize: 11 }}
              tickFormatter={(v) => v.slice(5)}
              stroke="#4b5563"
            />
            <YAxis
              yAxisId="asset"
              orientation="left"
              tick={{ fill: "#9ca3af", fontSize: 11 }}
              tickFormatter={(v) => `${(v / 10000).toFixed(0)}만`}
              stroke="#4b5563"
              domain={["dataMin - 500000", "dataMax + 500000"]}
            />
            <YAxis
              yAxisId="change"
              orientation="right"
              tick={{ fill: "#9ca3af", fontSize: 11 }}
              tickFormatter={(v) => `${(v / 10000).toFixed(0)}만`}
              stroke="#4b5563"
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "#1f2937",
                border: "1px solid #374151",
                borderRadius: "12px",
                fontSize: "13px",
              }}
              labelStyle={{ color: "#9ca3af" }}
              formatter={(value, name) => {
                const v = Number(value);
                if (name === "totalAsset") return [`₩${fmt(v)}`, "총 자산"];
                if (name === "dailyChangeUp" && v > 0)
                  return [`+₩${fmt(v)}`, "일간 상승"];
                if (name === "dailyChangeDown" && v < 0)
                  return [`₩${fmt(v)}`, "일간 하락"];
                return null;
              }}
            />
            <ReferenceLine yAxisId="change" y={0} stroke="#4b5563" />
            <Bar
              yAxisId="change"
              dataKey="dailyChangeUp"
              fill="#22c55e"
              radius={[3, 3, 0, 0]}
              opacity={0.7}
            />
            <Bar
              yAxisId="change"
              dataKey="dailyChangeDown"
              fill="#ef4444"
              radius={[0, 0, 3, 3]}
              opacity={0.7}
            />
            <Line
              yAxisId="asset"
              type="monotone"
              dataKey="totalAsset"
              stroke="#818cf8"
              strokeWidth={2}
              dot={{ fill: "#818cf8", r: 3 }}
              activeDot={{ r: 5 }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
});
