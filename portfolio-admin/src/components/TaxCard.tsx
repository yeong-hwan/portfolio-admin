import { memo, useEffect, useState } from "react";
import type { Position } from "../types";

interface TaxSummary {
  years: Array<{ year: string; realizedKrw: number; sellCount: number; taxableKrw: number; estimatedTaxKrw: number }>;
  currentYear: {
    year: string;
    realizedKrw: number;
    deductionLeftKrw: number;
    taxableKrw: number;
    estimatedTaxKrw: number;
    bySymbol: Array<{ symbol: string; realizedKrw: number; sellCount: number }>;
  };
  note: string;
}

function fmt(n: number): string {
  return Math.round(n).toLocaleString("ko-KR");
}

function fmtMan(n: number): string {
  const man = Math.round(n / 10000);
  return (man < 0 ? "-" : "") + Math.abs(man).toLocaleString("ko-KR") + "만";
}

interface Props {
  positions: Position[];
}

interface SaleSimulation {
  symbol: string;
  qty: number;
  proceedsKrw: number;
  costKrw: number;
  realizedKrw: number;
  yearRealizedAfterKrw: number;
  taxBeforeKrw: number;
  taxAfterKrw: number;
  deltaTaxKrw: number;
}

export const TaxCard = memo(function TaxCard({ positions }: Props) {
  const [data, setData] = useState<TaxSummary | null>(null);
  const [error, setError] = useState(false);
  const [simSymbol, setSimSymbol] = useState("");
  const [simQty, setSimQty] = useState("");
  const [simResult, setSimResult] = useState<SaleSimulation | null>(null);
  const [simError, setSimError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/tax")
      .then((r) => r.json())
      .then((d) => (d && !d.error ? setData(d) : setError(true)))
      .catch(() => setError(true));
  }, []);

  if (error) return null;
  if (!data) {
    return (
      <div className="bg-white/[0.05] backdrop-blur border border-white/[0.08] rounded-2xl p-5">
        <p className="text-xs text-gray-500">양도세 계산 중...</p>
      </div>
    );
  }

  const cy = data.currentYear;
  const overDeduction = cy.taxableKrw > 0;
  // 절세매도 후보: 평가손실 종목 (실현하면 올해 과세표준 상쇄)
  const lossCandidates = [...positions]
    .filter((p) => p.unrealized_pnl < 0)
    .sort((a, b) => a.unrealized_pnl - b.unrealized_pnl)
    .slice(0, 5);

  return (
    <div className="bg-white/[0.05] backdrop-blur border border-white/[0.08] rounded-2xl overflow-hidden">
      <div className="px-5 pt-4 pb-3 flex items-baseline justify-between">
        <h2 className="text-base font-semibold text-white">양도세 트래커 ({cy.year})</h2>
        <span className="text-[10px] text-gray-600">해외주식 · 기본공제 250만 · 세율 22%</span>
      </div>

      <div className="grid grid-cols-3 divide-x divide-white/[0.08] border-y border-white/[0.08]">
        <div className="px-5 py-3">
          <p className="text-[10px] text-gray-400 uppercase tracking-widest mb-1">올해 실현손익</p>
          <p className={`text-sm lg:text-base font-bold ${cy.realizedKrw >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
            {cy.realizedKrw >= 0 ? "+" : ""}₩ {fmt(cy.realizedKrw)}
          </p>
        </div>
        <div className="px-5 py-3">
          <p className="text-[10px] text-gray-400 uppercase tracking-widest mb-1">
            {overDeduction ? "과세표준 (공제 후)" : "공제 한도 여유"}
          </p>
          <p className={`text-sm lg:text-base font-bold ${overDeduction ? "text-amber-400" : "text-white"}`}>
            ₩ {fmt(overDeduction ? cy.taxableKrw : cy.deductionLeftKrw)}
          </p>
        </div>
        <div className="px-5 py-3">
          <p className="text-[10px] text-gray-400 uppercase tracking-widest mb-1">예상 세액</p>
          <p className={`text-sm lg:text-base font-bold ${cy.estimatedTaxKrw > 0 ? "text-amber-400" : "text-gray-300"}`}>
            ₩ {fmt(cy.estimatedTaxKrw)}
          </p>
        </div>
      </div>

      <div className="px-5 py-4 grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* 연도별 */}
        <div>
          <p className="text-xs text-gray-400 mb-2">연도별 실현손익</p>
          <div className="space-y-1">
            {data.years.map((y) => (
              <div key={y.year} className="flex items-center justify-between text-[11px]">
                <span className="text-gray-500">{y.year} <span className="text-gray-600">({y.sellCount}건)</span></span>
                <span className={`tabular-nums ${y.realizedKrw >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                  {fmtMan(y.realizedKrw)}
                  {y.estimatedTaxKrw > 0 && <span className="text-amber-500 ml-1.5">세 {fmtMan(y.estimatedTaxKrw)}</span>}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* 올해 종목별 */}
        <div>
          <p className="text-xs text-gray-400 mb-2">올해 종목별 실현</p>
          <div className="space-y-1 max-h-32 overflow-y-auto pr-1">
            {cy.bySymbol.slice(0, 8).map((s) => (
              <div key={s.symbol} className="flex items-center justify-between text-[11px]">
                <span className="text-gray-500">{s.symbol}</span>
                <span className={`tabular-nums ${s.realizedKrw >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                  {fmtMan(s.realizedKrw)}
                </span>
              </div>
            ))}
            {!cy.bySymbol.length && <p className="text-[11px] text-gray-600">올해 매도 없음</p>}
          </div>
        </div>

        {/* 절세매도 후보 */}
        <div>
          <p className="text-xs text-gray-400 mb-2">절세매도 후보 (평가손실)</p>
          <div className="space-y-1">
            {lossCandidates.map((p) => (
              <div key={p.symbol} className="flex items-center justify-between text-[11px]">
                <span className="text-gray-500">{p.symbol}</span>
                <span className="text-rose-400 tabular-nums">{fmtMan(p.unrealized_pnl)}</span>
              </div>
            ))}
            {!lossCandidates.length && <p className="text-[11px] text-gray-600">평가손실 종목 없음</p>}
          </div>
          {overDeduction && lossCandidates.length > 0 && (
            <p className="mt-2 text-[10px] text-amber-500/80 leading-relaxed">
              과세표준 {fmtMan(cy.taxableKrw)} — 손실 실현 시 상쇄 가능
            </p>
          )}
        </div>
      </div>

      {/* 매도 세금 시뮬레이터 */}
      <div className="px-5 py-4 border-t border-white/[0.08]">
        <p className="text-xs text-gray-400 mb-2.5">매도 세금 시뮬레이터 — 지금 팔면?</p>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <select
            value={simSymbol}
            onChange={(e) => { setSimSymbol(e.target.value); setSimResult(null); setSimError(null); }}
            className="bg-gray-900/60 border border-white/[0.08] rounded-lg px-2.5 py-1.5 text-white focus:outline-none focus:border-blue-500/50"
          >
            <option value="">종목 선택</option>
            {[...positions].sort((a, b) => a.symbol.localeCompare(b.symbol)).map((p) => (
              <option key={p.symbol} value={p.symbol}>{p.symbol} (보유 {p.quantity.toFixed(2)})</option>
            ))}
          </select>
          <input
            value={simQty}
            onChange={(e) => { setSimQty(e.target.value); setSimResult(null); }}
            placeholder="수량"
            className="w-24 bg-gray-900/60 border border-white/[0.08] rounded-lg px-2.5 py-1.5 text-white focus:outline-none focus:border-blue-500/50"
          />
          <button
            onClick={() => {
              const p = positions.find((x) => x.symbol === simSymbol);
              if (p) setSimQty(String(p.quantity));
            }}
            className="px-2.5 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-lg text-gray-300 transition-colors"
          >
            전량
          </button>
          <button
            onClick={async () => {
              setSimError(null);
              setSimResult(null);
              const p = positions.find((x) => x.symbol === simSymbol);
              const qty = parseFloat(simQty);
              if (!p || !(qty > 0)) { setSimError("종목과 수량을 입력하세요"); return; }
              try {
                const res = await fetch(
                  `/api/tax/simulate?symbol=${encodeURIComponent(simSymbol)}&qty=${qty}&priceKrw=${p.current_price}`
                );
                const d = await res.json();
                if (!res.ok || d.error) setSimError(d.error ?? "계산 실패");
                else setSimResult(d);
              } catch {
                setSimError("요청 실패");
              }
            }}
            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded-lg text-white transition-colors"
          >
            계산
          </button>
        </div>
        {simError && <p className="mt-2 text-[11px] text-rose-400">{simError}</p>}
        {simResult && (
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[11px]">
            <span className="text-gray-500">
              실현손익{" "}
              <span className={`font-semibold ${simResult.realizedKrw >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                {simResult.realizedKrw >= 0 ? "+" : ""}₩ {fmt(simResult.realizedKrw)}
              </span>
            </span>
            <span className="text-gray-500">
              매도 후 올해 실현 합계 <span className="text-white">₩ {fmt(simResult.yearRealizedAfterKrw)}</span>
            </span>
            <span className="text-gray-500">
              추가 세금{" "}
              <span className={`font-semibold ${simResult.deltaTaxKrw > 0 ? "text-amber-400" : "text-emerald-400"}`}>
                {simResult.deltaTaxKrw >= 0 ? "+" : ""}₩ {fmt(simResult.deltaTaxKrw)}
              </span>
            </span>
            {simResult.qty < parseFloat(simQty) - 0.001 && (
              <span className="text-gray-600">(로트 기준 {simResult.qty.toFixed(4)}주만 매칭됨)</span>
            )}
          </div>
        )}
      </div>

      <p className="px-5 pb-4 text-[10px] text-gray-600 leading-relaxed">{data.note}</p>
    </div>
  );
});
