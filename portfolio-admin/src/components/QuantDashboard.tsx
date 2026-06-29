import { useEffect, useState } from "react";
import { BarChart, Bar, Cell, XAxis, Tooltip, ResponsiveContainer } from "recharts";

type Regime = 0 | 1 | 2 | 3;

const REGIME_COLOR: Record<Regime, string> = {
  0: "#ef4444", 1: "#f59e0b", 2: "#6c5ce7", 3: "#22c55e",
};
const REGIME_LABEL: Record<Regime, string> = {
  0: "하락", 1: "횡보", 2: "상승", 3: "급등",
};

interface QuantData {
  regime: Regime;
  regimeHistory: { date: string; regime: Regime }[];
  spy: { price: number; change1d: number; rsi14: number };
  vix: { price: number };
  nasdaq: {
    gainers: { symbol: string; changePercent: number }[];
    losers:  { symbol: string; changePercent: number }[];
  };
}

function pct(n: number) {
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

export function QuantDashboard() {
  const [data, setData] = useState<QuantData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/quant")
      .then(r => r.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500">
        퀀트 데이터 로딩 중…
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center h-64 text-rose-400">
        데이터 로드 실패
      </div>
    );
  }

  const regimeColor = REGIME_COLOR[data.regime];
  const regimeLabel = REGIME_LABEL[data.regime];

  return (
    <main className="max-w-[1600px] mx-auto px-6 py-6 space-y-6">
      <div className="bg-white/[0.05] border border-white/[0.08] rounded-2xl p-5 flex flex-wrap items-center gap-6">
        <div>
          <p className="text-xs text-gray-400 uppercase tracking-widest mb-1">ARDS-X 시장 국면</p>
          <p className="text-3xl font-bold" style={{ color: regimeColor }}>{regimeLabel}</p>
        </div>
        <div className="flex gap-4 text-sm text-gray-400 flex-wrap">
          <span>SPY <span className="font-mono text-white">${data.spy.price.toFixed(2)}</span> <span className={data.spy.change1d >= 0 ? "text-emerald-400" : "text-rose-400"}>{pct(data.spy.change1d)}</span></span>
          <span>RSI14 <span className="font-mono text-white">{data.spy.rsi14.toFixed(0)}</span></span>
          <span>VIX <span className="font-mono text-white">{data.vix.price.toFixed(1)}</span></span>
        </div>
        <div className="flex-1 min-w-[200px] h-12">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.regimeHistory} barSize={8}>
              <XAxis dataKey="date" hide />
              <Tooltip
                formatter={(_v: unknown, _n: unknown, props: { payload?: { regime?: Regime } }) => [
                  REGIME_LABEL[props.payload?.regime ?? 2], "국면"
                ]}
                contentStyle={{ backgroundColor: "#1f2937", border: "none", borderRadius: 6, fontSize: 11 }}
              />
              <Bar dataKey="regime" maxBarSize={10}>
                {data.regimeHistory.map((entry, i) => (
                  <Cell key={i} fill={REGIME_COLOR[entry.regime]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="bg-white/[0.05] border border-white/[0.08] rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-white/[0.08]">
          <h2 className="font-semibold text-white">NASDAQ 모버 (일간)</h2>
        </div>
        <div className="grid grid-cols-2 divide-x divide-white/[0.08]">
          <div className="p-4 space-y-1">
            <p className="text-xs text-emerald-400 font-medium mb-2 uppercase tracking-widest">상위 10</p>
            {data.nasdaq.gainers.map(m => (
              <div key={m.symbol} className="flex justify-between text-sm">
                <span className="font-mono text-gray-300">{m.symbol}</span>
                <span className="text-emerald-400 font-mono">{pct(m.changePercent)}</span>
              </div>
            ))}
          </div>
          <div className="p-4 space-y-1">
            <p className="text-xs text-rose-400 font-medium mb-2 uppercase tracking-widest">하위 10</p>
            {data.nasdaq.losers.map(m => (
              <div key={m.symbol} className="flex justify-between text-sm">
                <span className="font-mono text-gray-300">{m.symbol}</span>
                <span className="text-rose-400 font-mono">{pct(m.changePercent)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
