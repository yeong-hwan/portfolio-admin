import { memo, useEffect, useState } from "react";

type Quadrant = "XLE" | "XLK" | "XLU" | "DEFENSE";

interface CompassData {
  asOf: string;
  quadrant: Quadrant;
  label: string;
  position: string;
  signals: {
    growthOn: boolean;
    spy: number;
    sma200: number;
    spyVsSma: number;
    inflationOn: boolean;
    t5yie: number;
    t5yieLevelOn: boolean;
    t5yie60Ago: number;
    breakevenMomentumOn: boolean;
    assetMomentumOn: boolean;
  };
  transitions: Array<{ date: string; from: Quadrant; to: Quadrant }>;
  quadrants: Record<Quadrant, { label: string; position: string }>;
}

// 4분면 배치: [성장↓인플레↑, 성장↑인플레↑] / [성장↓인플레↓, 성장↑인플레↓]
const GRID: Quadrant[][] = [
  ["XLU", "XLE"],
  ["DEFENSE", "XLK"],
];

const QUADRANT_COLOR: Record<Quadrant, string> = {
  XLE: "#f59e0b",
  XLK: "#3b82f6",
  XLU: "#a78bfa",
  DEFENSE: "#6b7280",
};

const QUADRANT_NAME: Record<Quadrant, string> = {
  XLE: "에너지",
  XLK: "기술",
  XLU: "유틸리티",
  DEFENSE: "필수소비+채권",
};

function SignalDot({ on }: { on: boolean }) {
  return <span className={`inline-block w-1.5 h-1.5 rounded-full ${on ? "bg-emerald-400" : "bg-gray-600"}`} />;
}

export const InflationCompass = memo(function InflationCompass() {
  const [data, setData] = useState<CompassData | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch("/api/inflation-compass")
      .then((r) => r.json())
      .then((d) => (d && !d.error ? setData(d) : setError(true)))
      .catch(() => setError(true));
  }, []);

  if (error) return null;
  if (!data) {
    return (
      <div className="bg-white/[0.05] border border-white/[0.08] rounded-2xl p-5">
        <p className="text-xs text-gray-500">인플레이션 나침반 계산 중... (최초 로드 시 수 초 소요)</p>
      </div>
    );
  }

  const s = data.signals;

  return (
    <div className="bg-white/[0.05] border border-white/[0.08] rounded-2xl overflow-hidden">
      <div className="px-5 py-4 border-b border-white/[0.08] flex items-baseline justify-between">
        <h2 className="font-semibold text-white">인플레이션 나침반 (Varadi)</h2>
        <span className="text-[10px] text-gray-600">SPY 200MA × T5YIE · 월말 리밸런싱 기준 · {data.asOf}</span>
      </div>

      <div className="p-5 grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 4분면 그리드 */}
        <div>
          <div className="grid grid-cols-[auto_1fr_1fr] gap-1.5 text-[10px] text-gray-500">
            <div />
            <div className="text-center pb-1">성장 ↓</div>
            <div className="text-center pb-1">성장 ↑</div>
            {GRID.map((row, ri) => (
              <>
                <div key={`l${ri}`} className="flex items-center pr-1" style={{ writingMode: "vertical-rl" }}>
                  {ri === 0 ? "인플레 ↑" : "인플레 ↓"}
                </div>
                {[row[0], row[1]].map((q) => {
                  const active = q === data.quadrant;
                  return (
                    <div
                      key={q}
                      className={`rounded-xl px-3 py-4 text-center border transition-all ${
                        active ? "border-white/40" : "border-white/[0.06] opacity-45"
                      }`}
                      style={{ background: `${QUADRANT_COLOR[q]}${active ? "33" : "14"}` }}
                    >
                      <p className="text-sm font-bold" style={{ color: QUADRANT_COLOR[q] }}>
                        {q === "DEFENSE" ? "XLP+IEF" : q}
                      </p>
                      <p className="text-[10px] text-gray-400 mt-0.5">{QUADRANT_NAME[q]}</p>
                    </div>
                  );
                })}
              </>
            ))}
          </div>
          <p className="mt-3 text-xs text-gray-400">
            현재 국면: <span className="text-white font-semibold">{data.label}</span>
            {" → "}
            <span className="font-semibold" style={{ color: QUADRANT_COLOR[data.quadrant] }}>{data.position}</span>
          </p>
        </div>

        {/* 신호 상세 */}
        <div className="space-y-2 text-[11px]">
          <p className="text-xs text-gray-400 mb-2">신호 구성</p>
          <div className="flex items-center gap-2">
            <SignalDot on={s.growthOn} />
            <span className="text-gray-400">성장: SPY <span className="text-white">{s.spy.toFixed(0)}</span> vs 200MA <span className="text-white">{s.sma200.toFixed(0)}</span></span>
            <span className={s.spyVsSma >= 0 ? "text-emerald-400" : "text-rose-400"}>
              {(s.spyVsSma * 100).toFixed(1)}%
            </span>
          </div>
          <div className="flex items-center gap-2">
            <SignalDot on={s.t5yieLevelOn} />
            <span className="text-gray-400">
              T5YIE <span className="text-white">{s.t5yie.toFixed(2)}%</span> {s.t5yieLevelOn ? ">" : "≤"} 2.0%
            </span>
          </div>
          <div className="flex items-center gap-2">
            <SignalDot on={s.breakevenMomentumOn} />
            <span className="text-gray-400">
              기대인플레 모멘텀 (60일 전 <span className="text-white">{s.t5yie60Ago.toFixed(2)}%</span>)
            </span>
          </div>
          <div className="flex items-center gap-2">
            <SignalDot on={s.assetMomentumOn} />
            <span className="text-gray-400">자산 모멘텀 (인플레 수혜/피해 바스켓 60일 기울기)</span>
          </div>
          <p className="pt-1 text-gray-600 leading-relaxed">
            인플레 신호 = T5YIE &gt; 2% AND (기대인플레 모멘텀 OR 자산 모멘텀) →{" "}
            <span className={s.inflationOn ? "text-emerald-400" : "text-gray-400"}>{s.inflationOn ? "ON" : "OFF"}</span>
          </p>
        </div>

        {/* 최근 전환 이력 */}
        <div>
          <p className="text-xs text-gray-400 mb-2">최근 국면 전환</p>
          <div className="space-y-1.5">
            {[...data.transitions].reverse().map((t) => (
              <div key={t.date} className="flex items-center gap-2 text-[11px]">
                <span className="text-gray-600 tabular-nums w-20">{t.date}</span>
                <span style={{ color: QUADRANT_COLOR[t.from] }}>{t.from === "DEFENSE" ? "XLP+IEF" : t.from}</span>
                <span className="text-gray-600">→</span>
                <span className="font-medium" style={{ color: QUADRANT_COLOR[t.to] }}>{t.to === "DEFENSE" ? "XLP+IEF" : t.to}</span>
              </div>
            ))}
            {!data.transitions.length && <p className="text-[11px] text-gray-600">최근 2년 내 전환 없음</p>}
          </div>
          <p className="mt-3 text-[10px] text-gray-600 leading-relaxed">
            일별 신호 기준 전환 시점. 원 전략은 매월 말 신호로 리밸런싱하므로 월중 전환은 참고용.
          </p>
        </div>
      </div>
    </div>
  );
});
