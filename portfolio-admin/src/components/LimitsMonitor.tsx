import { memo, useMemo } from "react";
import type { Position } from "../types";

// 레버리지 단일종목 ETF → 기초 기업 매핑 (단일기업 합산용)
const UNDERLYING: Record<string, string> = { PTIR: "PLTR", CONL: "COIN", NVDL: "NVDA" };
// 레버리지 ETF (합계 상한 감시)
const LEVERAGED = new Set(["QLD", "TQQQ", "PTIR", "CONL", "ETHU", "BITU", "NVDL"]);
// 크립토 연동 (가격 베팅 + 간접)
const CRYPTO = new Set(["ETHU", "BITU", "BITO", "CRCL", "COIN", "CONL", "BMNR", "IREN"]);

const LIMITS = {
  singleCompany: 10,
  leveraged: 15,
  crypto: 15,
  maxPositions: 25,
  minWeight: 2,
};

interface Props {
  positions: Position[];
  totalAsset: number;
}

type RowStatus = "ok" | "warn" | "breach";

function StatusBadge({ status, text }: { status: RowStatus; text: string }) {
  const cls =
    status === "breach" ? "text-rose-400 bg-rose-500/10"
    : status === "warn" ? "text-amber-400 bg-amber-500/10"
    : "text-emerald-400 bg-emerald-500/10";
  return <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full ${cls}`}>{text}</span>;
}

export const LimitsMonitor = memo(function LimitsMonitor({ positions, totalAsset }: Props) {
  const rows = useMemo(() => {
    if (totalAsset <= 0) return null;
    const w = (syms: Iterable<string>) => {
      let sum = 0;
      const set = new Set(syms);
      for (const p of positions) if (set.has(p.symbol)) sum += p.market_value;
      return (sum / totalAsset) * 100;
    };

    // 단일기업 합산 (레버리지 포함) 최대치
    const byCompany = new Map<string, number>();
    for (const p of positions) {
      const key = UNDERLYING[p.symbol] ?? p.symbol;
      if (LEVERAGED.has(p.symbol) && !UNDERLYING[p.symbol]) continue; // 지수·크립토 레버리지는 기업 아님
      byCompany.set(key, (byCompany.get(key) ?? 0) + (p.market_value / totalAsset) * 100);
    }
    const [topCompany, topWeight] = [...byCompany.entries()].sort((a, b) => b[1] - a[1])[0] ?? ["—", 0];

    const leveraged = w(LEVERAGED);
    const crypto = w(CRYPTO);
    const count = positions.length;
    const below2 = positions.filter((p) => (p.market_value / totalAsset) * 100 < LIMITS.minWeight).length;

    const judge = (v: number, limit: number): RowStatus =>
      v > limit ? "breach" : v > limit * 0.9 ? "warn" : "ok";

    const result: Array<{ label: string; value: string; status: RowStatus; detail: string }> = [
      {
        label: `단일기업 합산 ≤ ${LIMITS.singleCompany}%`,
        value: `${topCompany} ${topWeight.toFixed(1)}%`,
        status: judge(topWeight, LIMITS.singleCompany),
        detail: "레버리지 ETF는 기초 기업에 합산 (PTIR→PLTR 등)",
      },
      {
        label: `레버리지 합계 ≤ ${LIMITS.leveraged}%`,
        value: `${leveraged.toFixed(1)}%`,
        status: judge(leveraged, LIMITS.leveraged),
        detail: "QLD·TQQQ·PTIR·CONL·ETHU·BITU",
      },
      {
        label: `크립토 연동 ≤ ${LIMITS.crypto}%`,
        value: `${crypto.toFixed(1)}%`,
        status: judge(crypto, LIMITS.crypto),
        detail: "가격 베팅 + 간접(IREN·BMNR) 포함",
      },
      {
        label: `종목 수 ≤ ${LIMITS.maxPositions}개`,
        value: `${count}개`,
        status: judge(count, LIMITS.maxPositions),
        detail: "원-인 원-아웃",
      },
      {
        label: `최소 비중 ${LIMITS.minWeight}% 미만`,
        value: `${below2}종목`,
        status: below2 === 0 ? "ok" : below2 <= 5 ? "warn" : "breach",
        detail: "확신 없는 소수점 포지션 — 정리 대상",
      },
    ];
    return result;
  }, [positions, totalAsset]);

  if (!rows) return null;
  const breaches = rows.filter((r) => r.status === "breach").length;

  return (
    <div className="bg-white/[0.05] backdrop-blur border border-white/[0.08] rounded-2xl overflow-hidden h-full">
      <div className="px-5 pt-4 pb-3 flex items-baseline justify-between">
        <h2 className="text-base font-semibold text-white">원칙 한도 모니터</h2>
        <span className={`text-xs ${breaches ? "text-rose-400" : "text-gray-600"}`}>
          {breaches ? `${breaches}건 초과` : "전체 준수"}
        </span>
      </div>
      <div className="border-t border-white/[0.08]">
        {rows.map((r) => (
          <div key={r.label} className="px-5 py-2.5 border-b border-white/[0.05] last:border-0">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[13px] text-gray-300">{r.label}</p>
              <div className="flex items-center gap-2.5">
                <span className="text-[13px] font-semibold text-white tabular-nums">{r.value}</span>
                <StatusBadge
                  status={r.status}
                  text={r.status === "breach" ? "초과" : r.status === "warn" ? "경계" : "OK"}
                />
              </div>
            </div>
            <p className="mt-0.5 text-xs text-gray-600">{r.detail}</p>
          </div>
        ))}
      </div>
    </div>
  );
});
