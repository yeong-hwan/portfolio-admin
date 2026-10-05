import { memo, useEffect, useState } from "react";

interface QqqDd {
  asOf: string;
  price: number;
  ath: number;
  athDate: string;
  drawdown: number;
  ladder: Array<{ level: number; priceAt: number; reached: boolean }>;
  series: Array<{ date: string; dd: number }>;
}

function Sparkline({ series }: { series: Array<{ date: string; dd: number }> }) {
  if (series.length < 2) return null;
  const vals = series.map((p) => p.dd);
  const min = Math.min(...vals, -0.05);
  const W = 120, H = 30;
  const y = (v: number) => 2 + (v / min) * (H - 4); // 0이 위, min이 아래
  const pts = series.map((p, i) => `${(i / (series.length - 1)) * W},${y(p.dd)}`).join(" ");
  return (
    <svg width={W} height={H} className="shrink-0">
      <line x1="0" y1={y(0)} x2={W} y2={y(0)} stroke="rgba(255,255,255,0.15)" strokeWidth="1" />
      <polyline points={pts} fill="none" stroke="#f43f5e" strokeWidth="1.3" opacity="0.9" />
    </svg>
  );
}

export const QqqDrawdown = memo(function QqqDrawdown() {
  const [data, setData] = useState<QqqDd | null>(null);

  useEffect(() => {
    fetch("/api/qqq-drawdown")
      .then((r) => r.json())
      .then((d) => !d.error && setData(d))
      .catch(() => {});
  }, []);

  if (!data) {
    return (
      <div className="bg-white/[0.05] backdrop-blur border border-white/[0.08] rounded-2xl px-5 py-4">
        <p className="text-xs text-gray-500">QQQ 드로다운 로딩 중...</p>
      </div>
    );
  }

  const ddPct = data.drawdown * 100;
  const nearTrigger = data.drawdown <= -0.08;

  return (
    <div className="bg-white/[0.05] backdrop-blur border border-white/[0.08] rounded-2xl px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <div className="shrink-0">
          <div className="flex items-baseline gap-2">
            <h2 className="text-sm font-semibold text-white">QQQ Drawdown</h2>
            <span className="text-xs text-gray-600">TQQQ 매수 래더</span>
          </div>
          <div className="flex items-baseline gap-2 mt-1">
            <span className={`text-xl font-bold tabular-nums ${ddPct <= -10 ? "text-rose-400" : nearTrigger ? "text-amber-400" : "text-white"}`}>
              {ddPct.toFixed(1)}%
            </span>
            <span className="text-xs text-gray-500 tabular-nums">
              ${data.price.toFixed(0)} / 고점 ${data.ath.toFixed(0)} ({data.athDate.slice(2, 7).replace("-", ".")})
            </span>
          </div>
        </div>

        <Sparkline series={data.series} />

        {/* 매수 래더 */}
        <div className="flex gap-2">
          {data.ladder.map((l, i) => (
            <div
              key={l.level}
              className={`rounded-xl px-3 py-2 text-center border ${
                l.reached
                  ? "border-emerald-500/40 bg-emerald-500/10"
                  : "border-white/[0.06] bg-white/[0.03]"
              }`}
            >
              <p className={`text-[13px] font-bold tabular-nums ${l.reached ? "text-emerald-400" : "text-gray-300"}`}>
                {(l.level * 100).toFixed(0)}%
              </p>
              <p className="text-[10px] text-gray-500 tabular-nums">${l.priceAt.toFixed(0)}</p>
              <p className={`text-[10px] ${l.reached ? "text-emerald-400" : "text-gray-600"}`}>
                {l.reached ? `${i + 1}차 매수` : "대기"}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});
