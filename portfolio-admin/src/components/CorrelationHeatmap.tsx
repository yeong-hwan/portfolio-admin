import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface CorrelationResult {
  symbols: string[];
  matrix: number[][];
  period: { from: string; to: string; days: number };
}

function corrColor(v: number): string {
  if (v === 1) return "rgba(239,68,68,0.9)";
  if (v >= 0) return `rgba(239,68,68,${(v * 0.8).toFixed(2)})`;
  return `rgba(59,130,246,${((-v) * 0.8).toFixed(2)})`;
}

function textColor(v: number): string {
  return Math.abs(v) > 0.5 ? "#ffffff" : "#d1d5db";
}

const LABEL_W = 56;

export function CorrelationHeatmap() {
  const [data, setData] = useState<CorrelationResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardWidth, setCardWidth] = useState(0);
  const [tooltip, setTooltip] = useState<{ symA: string; symB: string; v: number; x: number; y: number } | null>(null);

  useEffect(() => {
    fetch("/api/correlation")
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(d => { setData(d); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, []);

  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setCardWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const n = data?.symbols.length ?? 0;
  // grid가 실제 크기를 처리하고, 이 값은 숫자 표시 여부 결정에만 사용
  const estimatedCellPx = n > 0 && cardWidth > 0
    ? (cardWidth - 40 - LABEL_W) / n
    : 32;
  const showText = estimatedCellPx >= 22;

  return (
    <div ref={cardRef} className="bg-gray-800/60 backdrop-blur border border-gray-700/50 rounded-2xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-white">수익률 상관관계</h2>
          {data && (
            <p className="text-xs text-gray-500 mt-0.5">
              {data.period.from} ~ {data.period.to} · {data.period.days} 거래일 · {n}개 종목
            </p>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs text-gray-500">
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded-sm inline-block bg-red-500/80" />양의 상관
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded-sm inline-block bg-blue-500/80" />음의 상관
          </span>
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center h-40 text-gray-500 text-sm gap-2">
          <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
          상관관계 계산 중...
        </div>
      )}
      {!loading && error && (
        <div className="text-rose-400 text-sm text-center py-8">{error}</div>
      )}

      {!loading && !error && data && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `${LABEL_W}px repeat(${n}, 1fr)`,
            gap: 1,
          }}
        >
          {/* 코너 빈 셀 */}
          <div />

          {/* 상단 심볼 헤더 */}
          {data.symbols.map(sym => (
            <div
              key={sym}
              style={{ writingMode: "vertical-rl", transform: "rotate(180deg)", height: "3rem" }}
              className="flex items-end justify-center pb-0.5 text-gray-400 font-mono text-[9px] overflow-hidden"
            >
              {sym}
            </div>
          ))}

          {/* 행렬 행 */}
          {data.symbols.flatMap((symA, i) => [
            <div
              key={`label-${symA}`}
              className="text-right pr-1 text-gray-400 font-mono text-[9px] truncate self-center"
            >
              {symA}
            </div>,
            ...data.matrix[i].map((v, j) => (
              <div
                key={`cell-${i}-${j}`}
                style={{
                  aspectRatio: "1",
                  backgroundColor: corrColor(v),
                  color: textColor(v),
                  fontSize: Math.max(7, estimatedCellPx * 0.32),
                }}
                className="flex items-center justify-center rounded-sm font-mono overflow-hidden cursor-default"
                onMouseEnter={e => setTooltip({ symA, symB: data.symbols[j], v, x: e.clientX, y: e.clientY })}
                onMouseMove={e => setTooltip(t => t ? { ...t, x: e.clientX, y: e.clientY } : null)}
                onMouseLeave={() => setTooltip(null)}
              >
                {showText && (v === 1 ? "—" : v.toFixed(2).replace("0.", ".").replace("-0.", "-.").replace("1.00", "1"))}
              </div>
            )),
          ])}
        </div>
      )}

      {tooltip && createPortal(
        <div
          style={{ position: "fixed", left: tooltip.x + 10, top: tooltip.y + 10, pointerEvents: "none", zIndex: 9999 }}
          className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 shadow-xl text-xs whitespace-nowrap"
        >
          <span className="text-white font-semibold">{tooltip.symA}</span>
          <span className="text-gray-500 mx-1.5">×</span>
          <span className="text-white font-semibold">{tooltip.symB}</span>
          <span className={`ml-2.5 font-mono font-bold ${tooltip.v >= 0 ? "text-red-400" : "text-blue-400"}`}>
            {tooltip.v === 1 ? "1.00" : tooltip.v.toFixed(2)}
          </span>
        </div>,
        document.body
      )}
    </div>
  );
}
