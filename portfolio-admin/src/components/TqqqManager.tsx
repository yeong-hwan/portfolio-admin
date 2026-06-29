import { useEffect, useState } from "react";
import { WilliamsGauge } from "./WilliamsGauge";
import { DropMeter } from "./DropMeter";

type Signal = 'STRONG_BUY' | 'BUY' | 'WATCH' | 'HOLD' | 'REDUCE';

interface QuoteData {
  price: number; change1d: number;
  rsi14: number; williamsR: number;
  drawdown20d: number; sma50: number;
}
interface TqqqData {
  signal: Signal;
  quotes: Record<'TQQQ' | 'QQQ' | 'TLT' | 'IEF', QuoteData>;
}
interface LogEntry { id: number; date: string; tranche: number; amountKrw: number; note: string }

const SIG_STYLE: Record<Signal, { bg: string; border: string; text: string; label: string }> = {
  STRONG_BUY: { bg: "bg-emerald-500/10", border: "border-emerald-500/40", text: "text-emerald-400", label: "강력 매수" },
  BUY:        { bg: "bg-emerald-300/10", border: "border-emerald-300/30", text: "text-emerald-300", label: "매수" },
  WATCH:      { bg: "bg-amber-400/10",   border: "border-amber-400/30",   text: "text-amber-400",   label: "관망" },
  HOLD:       { bg: "bg-white/[0.04]",   border: "border-white/[0.08]",   text: "text-gray-400",    label: "보유" },
  REDUCE:     { bg: "bg-rose-500/10",    border: "border-rose-500/30",    text: "text-rose-400",    label: "비중 축소" },
};

const DCA_SCENARIOS = [
  { label: "QQQ (1x)",  cagr: 13, color: "#64748b" },
  { label: "QLD (2x)",  cagr: 19, color: "#3b82f6" },
  { label: "TQQQ (3x)", cagr: 24, color: "#22c55e" },
  { label: "혼합 DCA",  cagr: 17, color: "#a78bfa" },
];
const DCA_AMOUNTS = [100, 200, 300, 500];
const DCA_YEARS   = [5, 10, 15, 20];

function calcDCA(monthlyKrw: number, years: number, cagr: number): number {
  const r = cagr / 100 / 12;
  const n = years * 12;
  if (r === 0) return monthlyKrw * n;
  return monthlyKrw * ((Math.pow(1 + r, n) - 1) / r);
}

function fmt(n: number) { return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`; }
function krw(n: number) { return `${(n / 100_000_000).toFixed(1)}억`; }

function QuoteCard({ symbol, q }: { symbol: string; q: QuoteData }) {
  const up = q.change1d >= 0;
  return (
    <div className="bg-white/[0.04] border border-white/[0.08] rounded-xl p-3 space-y-2">
      <div className="flex justify-between items-center">
        <span className="text-xs font-bold text-white">{symbol}</span>
        <span className={`text-xs font-mono font-bold ${up ? "text-emerald-400" : "text-rose-400"}`}>{fmt(q.change1d)}</span>
      </div>
      <p className="text-lg font-mono font-bold text-white">${q.price.toFixed(2)}</p>
      <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[9px] text-gray-500">
        <span>RSI <span className={`font-bold ${q.rsi14 < 30 ? "text-emerald-400" : q.rsi14 > 70 ? "text-rose-400" : "text-white"}`}>{q.rsi14.toFixed(0)}</span></span>
        <span>W%R <span className={`font-bold ${q.williamsR <= -80 ? "text-emerald-400" : q.williamsR >= -20 ? "text-rose-400" : "text-white"}`}>{q.williamsR.toFixed(0)}</span></span>
        <span>20d↓ <span className={`font-bold ${Math.abs(q.drawdown20d) >= 5 ? "text-amber-400" : "text-white"}`}>{fmt(q.drawdown20d)}</span></span>
        <span>SMA50 <span className="font-bold text-white">${q.sma50.toFixed(0)}</span></span>
      </div>
      {symbol === "TQQQ" && <WilliamsGauge value={q.williamsR} />}
    </div>
  );
}

export function TqqqManager() {
  const [data, setData]       = useState<TqqqData | null>(null);
  const [log, setLog]         = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [amount, setAmount]   = useState(200);
  const [years, setYears]     = useState(10);
  const [adding, setAdding]   = useState(false);
  const [form, setForm]       = useState({
    date: new Date().toISOString().slice(0, 10),
    tranche: 1,
    amountKrw: 200,
    note: "",
  });

  useEffect(() => {
    Promise.all([
      fetch("/api/tqqq").then(r => r.json()),
      fetch("/api/tqqq/log").then(r => r.json()),
    ]).then(([d, l]) => { setData(d); setLog(l); }).finally(() => setLoading(false));
  }, []);

  async function addEntry() {
    const entry: LogEntry = await fetch("/api/tqqq/log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, amountKrw: form.amountKrw * 10_000 }),
    }).then(r => r.json());
    setLog(prev => [...prev, entry]);
    setAdding(false);
  }

  async function deleteEntry(id: number) {
    await fetch(`/api/tqqq/log/${id}`, { method: "DELETE" });
    setLog(prev => prev.filter(e => e.id !== id));
  }

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-500">TQQQ 데이터 로딩 중…</div>;
  if (!data)   return <div className="flex items-center justify-center h-64 text-rose-400">데이터 로드 실패</div>;

  const sig = SIG_STYLE[data.signal];

  return (
    <main className="max-w-[1600px] mx-auto px-6 py-6 space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {(["TQQQ", "QQQ", "TLT", "IEF"] as const).map(sym => (
          <QuoteCard key={sym} symbol={sym} q={data.quotes[sym]} />
        ))}
      </div>

      <div className="bg-white/[0.05] border border-white/[0.08] rounded-2xl p-5 space-y-4">
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-400">매매 신호</span>
          <span className={`px-3 py-1 rounded-lg text-sm font-bold border ${sig.bg} ${sig.border} ${sig.text}`}>
            {sig.label}
          </span>
        </div>
        <DropMeter drop={data.quotes.TQQQ.drawdown20d} />
      </div>

      <div className="bg-white/[0.05] border border-white/[0.08] rounded-2xl p-5 space-y-4">
        <h2 className="font-semibold text-white">DCA 시뮬레이터</h2>
        <div className="flex gap-4 flex-wrap">
          <label className="flex items-center gap-2 text-sm text-gray-400">
            월 납입
            <select
              value={amount}
              onChange={e => setAmount(Number(e.target.value))}
              className="bg-gray-800 text-white rounded-lg px-2 py-1 text-sm border border-white/[0.08]"
            >
              {DCA_AMOUNTS.map(a => <option key={a} value={a}>{a}만원</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-400">
            기간
            <select
              value={years}
              onChange={e => setYears(Number(e.target.value))}
              className="bg-gray-800 text-white rounded-lg px-2 py-1 text-sm border border-white/[0.08]"
            >
              {DCA_YEARS.map(y => <option key={y} value={y}>{y}년</option>)}
            </select>
          </label>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {DCA_SCENARIOS.map(s => (
            <div key={s.label} className="bg-white/[0.04] border border-white/[0.08] rounded-xl p-3 text-center">
              <p className="text-[10px] mb-1" style={{ color: s.color }}>{s.label}</p>
              <p className="text-lg font-bold text-white">{krw(calcDCA(amount * 10_000, years, s.cagr))}</p>
              <p className="text-[9px] text-gray-500">CAGR {s.cagr}%</p>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white/[0.05] border border-white/[0.08] rounded-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.08]">
          <h2 className="font-semibold text-white">투자 로그</h2>
          <button
            onClick={() => setAdding(a => !a)}
            className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white text-xs rounded-lg transition-colors"
          >
            {adding ? "취소" : "+ 추가"}
          </button>
        </div>

        {adding && (
          <div className="p-4 border-b border-white/[0.08] grid grid-cols-2 lg:grid-cols-4 gap-3">
            <input
              type="date"
              value={form.date}
              onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
              className="bg-gray-800 text-white rounded-lg px-3 py-1.5 text-sm border border-white/[0.08]"
            />
            <select
              value={form.tranche}
              onChange={e => setForm(f => ({ ...f, tranche: Number(e.target.value) }))}
              className="bg-gray-800 text-white rounded-lg px-3 py-1.5 text-sm border border-white/[0.08]"
            >
              {[1,2,3,4,5].map(t => <option key={t} value={t}>{t}차 트랜치</option>)}
            </select>
            <input
              type="number"
              placeholder="금액 (만원)"
              value={form.amountKrw}
              onChange={e => setForm(f => ({ ...f, amountKrw: Number(e.target.value) }))}
              className="bg-gray-800 text-white rounded-lg px-3 py-1.5 text-sm border border-white/[0.08]"
            />
            <input
              type="text"
              placeholder="메모"
              value={form.note}
              onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
              className="bg-gray-800 text-white rounded-lg px-3 py-1.5 text-sm border border-white/[0.08]"
            />
            <button
              onClick={addEntry}
              className="col-span-2 lg:col-span-4 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm rounded-lg transition-colors"
            >
              저장
            </button>
          </div>
        )}

        <div className="divide-y divide-white/[0.06]">
          {log.length === 0 && (
            <p className="px-5 py-8 text-center text-gray-500 text-sm">투자 로그가 없습니다.</p>
          )}
          {[...log].reverse().map(e => (
            <div key={e.id} className="px-5 py-3 flex items-center justify-between">
              <div className="flex items-center gap-3 text-sm">
                <span className="text-gray-400 font-mono">{e.date}</span>
                <span className="text-amber-400 text-xs">{e.tranche}차</span>
                <span className="text-white font-bold">{(e.amountKrw / 10_000).toFixed(0)}만원</span>
                {e.note && <span className="text-gray-500">{e.note}</span>}
              </div>
              <button
                onClick={() => deleteEntry(e.id)}
                className="text-gray-600 hover:text-rose-400 text-xs transition-colors"
              >
                삭제
              </button>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
