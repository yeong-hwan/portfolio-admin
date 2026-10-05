import { memo, useEffect, useMemo, useState } from "react";
import type { Position } from "../types";

// 10년 뒤 매수원금 대비 FCF 수익률 = Y × (1+g)^10
// Y = 현재 FCF 수익률, g = 향후 10년 연평균 FCF 성장률 (3Y 실적 CAGR을 0~30%로 클램프해 근사)

interface FundRow {
  symbol: string;
  fcfYield: number | null;
  fcfCagr3y: number | null;
  status: string;
}

interface Point {
  symbol: string;
  y: number;
  g: number;
  tenYr: number;
  assumed: boolean;
  capped: boolean;
}

const G_DEFAULT = 0.10;
const G_CAP = 0.30;
const X_MAX = 0.10;
const COLS = [0.02, 0.03, 0.05, 0.08, 0.10];
const ROWS = [0.05, 0.10, 0.15, 0.20, 0.25];

function tenYear(y: number, g: number): number {
  return y * Math.pow(1 + g, 10);
}

function colorFor(v: number): string {
  const stops: Array<[number, [number, number, number]]> = [
    [0.00, [10, 45, 40]],
    [0.05, [18, 77, 66]],
    [0.10, [26, 118, 95]],
    [0.20, [52, 168, 124]],
    [0.40, [233, 196, 90]],
    [0.90, [246, 213, 92]],
  ];
  let lo = stops[0], hi = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (v >= stops[i][0] && v <= stops[i + 1][0]) { lo = stops[i]; hi = stops[i + 1]; break; }
  }
  if (v >= stops[stops.length - 1][0]) lo = hi;
  const t = hi[0] === lo[0] ? 0 : (v - lo[0]) / (hi[0] - lo[0]);
  const c = lo[1].map((a, i) => Math.round(a + (hi[1][i] - a) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

// 밝은(골드) 셀엔 어두운 글자
function textColorFor(v: number): string {
  return v >= 0.3 ? "#172023" : "rgba(255,255,255,0.92)";
}

export const FcfPowerMap = memo(function FcfPowerMap({ positions }: { positions: Position[] }) {
  const [rows, setRows] = useState<FundRow[] | null>(null);

  useEffect(() => {
    fetch("/api/fundamentals")
      .then((r) => r.json())
      .then((d) => d?.rows && setRows(d.rows))
      .catch(() => {});
  }, []);

  const points = useMemo<Point[]>(() => {
    if (!rows) return [];
    const held = new Set(positions.map((p) => p.symbol));
    return rows
      .filter((r) => held.has(r.symbol) && r.status === "compounder" && r.fcfYield != null && r.fcfYield > 0)
      .map((r) => {
        const assumed = r.fcfCagr3y == null;
        const raw = assumed ? G_DEFAULT : Math.max(0, r.fcfCagr3y!);
        const g = Math.min(raw, G_CAP);
        return {
          symbol: r.symbol,
          y: Math.min(r.fcfYield!, X_MAX),
          g,
          tenYr: tenYear(r.fcfYield!, g),
          assumed,
          capped: raw > G_CAP,
        };
      })
      .sort((a, b) => b.tenYr - a.tenYr);
  }, [rows, positions]);

  const cellChips = useMemo(() => {
    const map = new Map<string, Array<{ s: string; capped: boolean }>>();
    for (const p of points) {
      const col = COLS.reduce((best, c) => (Math.abs(c - p.y) < Math.abs(best - p.y) ? c : best), COLS[0]);
      const row = ROWS.reduce((best, r) => (Math.abs(r - p.g) < Math.abs(best - p.g) ? r : best), ROWS[0]);
      const key = `${row}-${col}`;
      map.set(key, [...(map.get(key) ?? []), { s: p.symbol, capped: p.capped }]);
    }
    return map;
  }, [points]);

  // --- 히트맵 지오메트리 ---
  const W = 560, H = 380;
  const PAD_L = 46, PAD_B = 42, PAD_T = 14, PAD_R = 14;
  const plotW = W - PAD_L - PAD_R, plotH = H - PAD_T - PAD_B;
  const xAt = (y: number) => PAD_L + (y / X_MAX) * plotW;
  const yAt = (g: number) => PAD_T + (g / G_CAP) * plotH;
  const NX = 110, NY = 72;

  // 점이 플롯 경계에서 잘리지 않게 안쪽으로 클램프
  const INSET = 7;
  const px = (p: Point) => Math.min(Math.max(xAt(p.y), PAD_L + INSET), PAD_L + plotW - INSET);
  const py = (p: Point) => Math.min(Math.max(yAt(p.g), PAD_T + INSET), PAD_T + plotH - INSET);

  // 라벨: 점 아래 중앙 정렬 (하단 경계 종목은 점 위) · 겹치면 위로 밀어 올림
  const labels = useMemo(() => {
    const sorted = [...points].sort((a, b) => xAt(a.y) - xAt(b.y));
    const placed: Array<{ x0: number; x1: number; yTop: number; yBot: number }> = [];
    const out = new Map<string, { lx: number; ly: number }>();
    for (const p of sorted) {
      const cx = px(p), cy = py(p);
      const text = p.symbol + (p.assumed ? "*" : "");
      const w = text.length * 6.2;
      const lx = Math.min(Math.max(cx, PAD_L + w / 2 + 2), PAD_L + plotW - w / 2 - 2);
      const nearBottom = cy > PAD_T + plotH - 22;
      let ly = nearBottom ? cy - 9 : cy + 16;
      for (let tries = 0; tries < 8; tries++) {
        const hit = placed.some((b) => lx - w / 2 < b.x1 + 4 && lx + w / 2 > b.x0 - 4 && ly - 9 < b.yBot && ly > b.yTop);
        if (!hit) break;
        ly -= 11;
      }
      placed.push({ x0: lx - w / 2, x1: lx + w / 2, yTop: ly - 9, yBot: ly + 2 });
      out.set(p.symbol, { lx, ly });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points]);

  if (!rows) {
    return (
      <div className="bg-white/[0.05] backdrop-blur border border-white/[0.08] rounded-2xl p-5">
        <h2 className="text-base font-semibold text-white mb-3">FCF 10년 파워</h2>
        <p className="text-xs text-gray-500 py-8 text-center">펀더멘털 데이터 로딩 중...</p>
      </div>
    );
  }

  // 20% 목표 경계선
  const isoPts: string[] = [];
  for (let i = 0; i <= 120; i++) {
    const y = 0.004 + (i / 120) * (X_MAX - 0.004);
    const g = Math.pow(0.2 / y, 0.1) - 1;
    if (g < 0 || g > G_CAP) continue;
    isoPts.push(`${xAt(y).toFixed(1)},${yAt(g).toFixed(1)}`);
  }

  return (
    <div className="bg-white/[0.05] backdrop-blur border border-white/[0.08] rounded-2xl overflow-hidden h-full">
      <div className="px-5 pt-4 pb-1 flex items-baseline justify-between flex-wrap gap-x-4 gap-y-1">
        <h2 className="text-base font-semibold text-white">FCF 10년 파워</h2>
        <span className="text-xs text-gray-600">10년 뒤 원금 대비 FCF 수익률 = Y × (1+g)¹⁰</span>
      </div>

      <div className="px-5 pb-5 pt-2 grid grid-cols-1 xl:grid-cols-2 gap-x-10 gap-y-6 items-start">
        {/* 좌: 그라데이션 맵 */}
        <div>
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-xl">
            {Array.from({ length: NY }, (_, iy) =>
              Array.from({ length: NX }, (_, ix) => {
                const y = ((ix + 0.5) / NX) * X_MAX;
                const g = ((iy + 0.5) / NY) * G_CAP;
                return (
                  <rect
                    key={`${ix}-${iy}`}
                    x={PAD_L + (ix / NX) * plotW}
                    y={PAD_T + (iy / NY) * plotH}
                    width={plotW / NX + 0.6}
                    height={plotH / NY + 0.6}
                    fill={colorFor(tenYear(y, g))}
                  />
                );
              })
            )}
            <polyline points={isoPts.join(" ")} fill="none" stroke="#f3cf57" strokeWidth="2.2" opacity="0.95" />
            {/* 축 눈금 */}
            {[0.02, 0.04, 0.06, 0.08, 0.10].map((v) => (
              <text key={v} x={xAt(v)} y={PAD_T + plotH + 16} textAnchor="middle" fontSize="11" fill="#6b7280">{(v * 100).toFixed(0)}%</text>
            ))}
            {[0, 0.10, 0.20, 0.30].map((v) => (
              <text key={v} x={PAD_L - 7} y={yAt(v) + 4} textAnchor="end" fontSize="11" fill="#6b7280">{(v * 100).toFixed(0)}%</text>
            ))}
            {/* 축 제목 */}
            <text x={PAD_L + plotW / 2} y={H - 6} textAnchor="middle" fontSize="11" fill="#9ca3af">현재 FCF 수익률 Y →</text>
            <text x={12} y={PAD_T + plotH / 2} textAnchor="middle" fontSize="11" fill="#9ca3af" transform={`rotate(-90 12 ${PAD_T + plotH / 2})`}>FCF 성장률 g ↓</text>
            {/* 종목 점 + 충돌 회피 라벨 */}
            {points.map((p) => {
              const lp = labels.get(p.symbol);
              return (
                <g key={p.symbol}>
                  <circle cx={px(p)} cy={py(p)} r="4.5" fill={p.capped ? "#f3cf57" : "#fff"} stroke="#111827" strokeWidth="1.5" opacity={p.assumed ? 0.55 : 1} />
                  {lp && (
                    <text
                      x={lp.lx} y={lp.ly}
                      textAnchor="middle"
                      fontSize="10" fontWeight="700"
                      fill={p.capped ? "#f3cf57" : p.assumed ? "rgba(255,255,255,0.6)" : "#fff"}
                      stroke="rgba(10,15,20,0.75)" strokeWidth="2.5" paintOrder="stroke"
                    >
                      {p.symbol}{p.assumed ? "*" : ""}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
          <p className="text-xs text-gray-600 mt-2">
            <span className="text-[#f3cf57] font-medium">금색선</span> = 10년 뒤 20% 경계 · <span className="text-[#f3cf57] font-medium">금색 종목</span> = 실적 성장률 30% 초과 → 상한 30%로 보수 적용 · * = CAGR 미산출 (기본가정 10%)
          </p>
        </div>

        {/* 우: 매트릭스 */}
        <div>
          <p className="text-sm text-gray-300 mb-2.5">성장률 × 현재 수익률 조합별 — 보유 종목 위치</p>
          <table className="w-full text-xs tabular-nums border-separate" style={{ borderSpacing: "4px" }}>
            <thead>
              <tr>
                <th className="text-left font-normal text-gray-500 pb-1 w-14">g \ Y</th>
                {COLS.map((c) => (
                  <th key={c} className="text-center font-semibold text-gray-400 pb-1">{(c * 100).toFixed(0)}%</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((r) => (
                <tr key={r}>
                  <td className="text-gray-400 font-semibold pr-1">{(r * 100).toFixed(0)}%</td>
                  {COLS.map((c) => {
                    const v = tenYear(c, r);
                    const chips = cellChips.get(`${r}-${c}`) ?? [];
                    const has = chips.length > 0;
                    return (
                      <td
                        key={c}
                        className={`rounded-xl px-1 ${has ? "ring-2 ring-white/80" : ""}`}
                        style={{ background: colorFor(v), height: 58 }}
                      >
                        <div className="flex flex-col items-center justify-center gap-1 h-full">
                          <span className="font-bold text-[13px]" style={{ color: textColorFor(v) }}>
                            {(v * 100).toFixed(1)}%
                          </span>
                          {has && (
                            <div className="flex flex-wrap justify-center gap-0.5 leading-none">
                              {chips.map((c) => (
                                <span
                                  key={c.s}
                                  className={`text-[10px] font-bold px-1 py-px rounded ${c.capped ? "bg-[#f3cf57] text-gray-900" : "bg-gray-950/75 text-white"}`}
                                >
                                  {c.s}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-gray-600 mt-2.5 leading-snug">
            종목은 가장 가까운 (Y, g) 셀에 근사 — Y 2% 미만(AMD·PLTR·HOOD)은 2% 열로. g는 10년 연평균 가정이라 단기 급성장은 30%로 할인.
          </p>
        </div>
      </div>
    </div>
  );
});
