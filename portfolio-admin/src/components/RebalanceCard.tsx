import { memo, useEffect, useMemo, useState } from "react";
import type { Position } from "../types";
import { isMasked, useMasked, MASK } from "../lib/privacy";

interface Bucket {
  name: string;
  target: number; // %
  band: number;   // 상대 밴드 (0.25 = ±25%)
  symbols: string[];
}

interface RebalanceConfig {
  buckets: Bucket[];
}

interface Props {
  positions: Position[];
  totalAsset: number;
  monthlySavingKrw?: number;
}

function fmtMan(n: number): string {
  if (isMasked()) return MASK;
  const man = Math.round(n / 10000);
  return (man < 0 ? "-" : "") + Math.abs(man).toLocaleString("ko-KR") + "만";
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="mt-2 space-y-0.5">
      {items.map((b) => (
        <li key={b} className="text-xs text-gray-600 leading-snug flex gap-1.5">
          <span className="text-gray-700 shrink-0">•</span>
          <span>{b}</span>
        </li>
      ))}
    </ul>
  );
}

export const RebalanceCard = memo(function RebalanceCard({ positions, totalAsset }: Props) {
  useMasked(); // 마스킹 토글 시 리렌더 구독
  const [config, setConfig] = useState<RebalanceConfig | null>(null);
  const [monthlySaving, setMonthlySaving] = useState(4_000_000);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Bucket[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const toggleExpand = (name: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  useEffect(() => {
    fetch("/api/rebalance").then((r) => r.json()).then(setConfig).catch(() => {});
    fetch("/api/goal").then((r) => r.json()).then((g) => g?.monthlySavingKrw && setMonthlySaving(g.monthlySavingKrw)).catch(() => {});
  }, []);

  const valueBySymbol = useMemo(
    () => Object.fromEntries(positions.map((p) => [p.symbol, p.market_value])),
    [positions]
  );

  const analysis = useMemo(() => {
    if (!config || totalAsset <= 0) return null;
    const assigned = new Set(config.buckets.flatMap((b) => b.symbols));
    const unassigned = positions.filter((p) => !assigned.has(p.symbol));

    const rows = config.buckets.map((b) => {
      const valueKrw = b.symbols.reduce((s, sym) => s + (valueBySymbol[sym] ?? 0), 0);
      const current = (valueKrw / totalAsset) * 100;
      const t = b.target;
      // 5/25 규칙: 절대 5%p 또는 상대 밴드 중 먼저 걸리는 쪽 (버킷별 상대 밴드 조정 가능)
      const threshold = Math.min(5, t * b.band);
      const drift = current - t;
      const status: "over" | "under" | "ok" =
        drift > threshold ? "over" : drift < -threshold ? "under" : "ok";
      return {
        ...b,
        valueKrw,
        current,
        drift,
        threshold,
        lower: t - threshold,
        upper: t + threshold,
        status,
        adjustKrw: (drift / 100) * totalAsset, // 양수 = 초과분(매도 필요액), 음수 = 부족분
      };
    });

    // 적립금 배분 제안: 언더웨이트 버킷에 부족분 비례 배분
    const under = rows.filter((r) => r.drift < 0);
    const totalGap = under.reduce((s, r) => s + -r.adjustKrw, 0);
    const allocation = under
      .map((r) => ({
        name: r.name,
        amountKrw: totalGap > 0 ? Math.min(-r.adjustKrw, (monthlySaving * -r.adjustKrw) / totalGap) : 0,
      }))
      .filter((a) => a.amountKrw > 10000)
      .sort((a, b) => b.amountKrw - a.amountKrw);

    // 밴드 초과 버킷의 손실 종목 = 절세 매도 후보
    const overBuckets = rows.filter((r) => r.status === "over");
    const sellCandidates = overBuckets.flatMap((r) =>
      r.symbols
        .map((sym) => positions.find((p) => p.symbol === sym))
        .filter((p): p is Position => !!p && p.unrealized_pnl < 0)
        .map((p) => ({ bucket: r.name, symbol: p.symbol, pnl: p.unrealized_pnl, valueKrw: p.market_value }))
    ).sort((a, b) => a.pnl - b.pnl).slice(0, 5);

    return { rows, unassigned, allocation, sellCandidates, overBuckets };
  }, [config, positions, totalAsset, valueBySymbol, monthlySaving]);

  if (!config || !analysis) {
    return (
      <div className="bg-white/[0.05] backdrop-blur border border-white/[0.08] rounded-2xl p-5">
        <p className="text-sm text-gray-500">리밸런싱 설정 로딩 중...</p>
      </div>
    );
  }

  async function saveDraft() {
    const total = draft.reduce((s, b) => s + b.target, 0);
    if (Math.abs(total - 100) > 0.5) {
      alert(`목표 비중 합이 ${total.toFixed(1)}%입니다. 100%에 맞춰주세요.`);
      return;
    }
    const res = await fetch("/api/rebalance", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ buckets: draft }),
    });
    if (res.ok) setConfig(await res.json());
    setEditing(false);
  }

  async function assignSymbol(symbol: string, bucketName: string) {
    if (!config) return;
    const buckets = config.buckets.map((b) => ({
      ...b,
      symbols: b.name === bucketName ? [...b.symbols, symbol] : b.symbols.filter((s) => s !== symbol),
    }));
    const res = await fetch("/api/rebalance", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ buckets }),
    });
    if (res.ok) setConfig(await res.json());
  }

  const anyBreach = analysis.rows.some((r) => r.status !== "ok");

  return (
    <div className="bg-white/[0.05] backdrop-blur border border-white/[0.08] rounded-2xl overflow-hidden h-full">
      <div className="px-5 pt-4 pb-3 flex items-baseline justify-between">
        <h2 className="text-base font-semibold text-white">레이어 배분</h2>
        <div className="flex items-baseline gap-3">
          <span className="text-xs text-gray-600">테제 레이어별 비중 · 밴드(5/25) 이탈 시에만 행동</span>
          <button
            onClick={() => {
              setDraft(config.buckets.map((b) => ({ ...b })));
              setEditing((e) => !e);
            }}
            className="text-xs text-gray-600 hover:text-gray-300 transition-colors"
          >
            {editing ? "닫기" : "편집"}
          </button>
        </div>
      </div>

      {/* 버킷 테이블 */}
      <div className="border-y border-white/[0.08]">
        {analysis.rows.map((r, i) => {
          const barColor = r.status === "over" ? "bg-rose-500/70" : r.status === "under" ? "bg-blue-500/70" : "bg-emerald-500/60";
          const pos = Math.min(Math.max(r.current, 0), 50) / 50 * 100;
          const lo = r.lower / 50 * 100, hi = Math.min(r.upper, 50) / 50 * 100;
          const isOpen = expanded.has(r.name);
          // 보유 중인 종목만, 평가액 내림차순
          const holdings = r.symbols
            .map((sym) => positions.find((p) => p.symbol === sym))
            .filter((p): p is Position => !!p)
            .sort((a, b) => b.market_value - a.market_value);
          return (
            <div key={r.name} className="border-b border-white/[0.05] last:border-0">
            <div
              className={`px-5 py-2.5 flex items-center gap-4 ${!editing ? "cursor-pointer hover:bg-white/[0.02] transition-colors" : ""}`}
              onClick={() => !editing && toggleExpand(r.name)}
            >
              <div className="w-40 shrink-0 flex items-center gap-1.5">
                {!editing && (
                  <svg
                    className={`h-3 w-3 shrink-0 text-gray-600 transition-transform ${isOpen ? "rotate-90" : ""}`}
                    viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                  >
                    <polyline points="9 6 15 12 9 18" />
                  </svg>
                )}
                <div className="min-w-0">
                  <p className="text-sm text-gray-300 truncate">{r.name}</p>
                  <p className="text-xs text-gray-600">{holdings.length}종목 · {fmtMan(r.valueKrw)}</p>
                </div>
              </div>
              {editing ? (
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-gray-500">목표</span>
                  <input
                    value={draft[i]?.target ?? r.target}
                    onChange={(e) => {
                      const d = [...draft];
                      d[i] = { ...d[i], target: parseFloat(e.target.value) || 0 };
                      setDraft(d);
                    }}
                    className="w-14 bg-gray-900/60 border border-white/[0.08] rounded-lg px-2 py-1 text-white text-right focus:outline-none focus:border-blue-500/50"
                  />
                  <span className="text-gray-500">% · 밴드 ±</span>
                  <input
                    value={Math.round((draft[i]?.band ?? r.band) * 100)}
                    onChange={(e) => {
                      const d = [...draft];
                      d[i] = { ...d[i], band: (parseFloat(e.target.value) || 0) / 100 };
                      setDraft(d);
                    }}
                    className="w-12 bg-gray-900/60 border border-white/[0.08] rounded-lg px-2 py-1 text-white text-right focus:outline-none focus:border-blue-500/50"
                  />
                  <span className="text-gray-500">%</span>
                </div>
              ) : (
                <>
                  {/* 밴드 게이지: 0~50% 스케일 */}
                  <div className="flex-1 relative h-4 bg-white/[0.04] rounded-full overflow-hidden">
                    <div className="absolute inset-y-0 bg-white/[0.07]" style={{ left: `${lo}%`, width: `${hi - lo}%` }} />
                    <div className="absolute inset-y-0 w-px bg-gray-400" style={{ left: `${r.target / 50 * 100}%` }} />
                    <div className={`absolute inset-y-0.5 w-2 rounded-full ${barColor}`} style={{ left: `calc(${pos}% - 4px)` }} />
                  </div>
                  <div className="w-40 shrink-0 text-right text-[13px] tabular-nums">
                    <span className="text-white font-semibold">{r.current.toFixed(1)}%</span>
                    <span className="text-gray-600"> / {r.target}%</span>
                    <span className="text-gray-600"> (±{r.threshold.toFixed(1)})</span>
                  </div>
                  <span className={`shrink-0 w-28 text-center text-xs px-2 py-1 rounded-full ${
                    r.status === "over" ? "text-rose-400 bg-rose-500/10"
                    : r.status === "under" ? "text-blue-400 bg-blue-500/10"
                    : "text-emerald-400 bg-emerald-500/10"
                  }`}>
                    {r.status === "over" ? `초과 ${fmtMan(r.adjustKrw)}` : r.status === "under" ? `부족 ${fmtMan(-r.adjustKrw)}` : "밴드 내"}
                  </span>
                </>
              )}
            </div>

            {/* 레이어 내 종목 상세 */}
            {isOpen && !editing && (
              <div className="px-5 pb-3 pt-0.5">
                <div className="ml-[18px] rounded-xl bg-white/[0.02] border border-white/[0.05] divide-y divide-white/[0.04]">
                  {holdings.map((p) => {
                    const w = (p.market_value / totalAsset) * 100;
                    const inBucket = r.valueKrw > 0 ? (p.market_value / r.valueKrw) * 100 : 0;
                    return (
                      <div key={p.symbol} className="px-4 py-2 flex items-center gap-3">
                        <span className="w-14 shrink-0 text-[13px] font-medium text-gray-300">{p.symbol}</span>
                        <span className="w-32 shrink-0 text-xs text-gray-600 truncate">{p.name}</span>
                        {/* 버킷 내 비중 바 */}
                        <div className="flex-1 h-2 bg-white/[0.04] rounded-full overflow-hidden">
                          <div className="h-full rounded-full bg-blue-500/50" style={{ width: `${Math.max(inBucket, 1)}%` }} />
                        </div>
                        <span className="w-24 shrink-0 text-right text-xs text-gray-500 tabular-nums">
                          버킷 내 {inBucket.toFixed(0)}%
                        </span>
                        <span className="w-16 shrink-0 text-right text-[13px] font-semibold text-white tabular-nums">
                          {w.toFixed(1)}%
                        </span>
                        <span className="w-20 shrink-0 text-right text-xs text-gray-500 tabular-nums">
                          {fmtMan(p.market_value)}
                        </span>
                        <span className={`w-14 shrink-0 text-right text-xs tabular-nums ${p.profit_rate >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                          {(p.profit_rate >= 0 ? "+" : "") + (p.profit_rate * 100).toFixed(0)}%
                        </span>
                      </div>
                    );
                  })}
                  {!holdings.length && (
                    <p className="px-4 py-2 text-xs text-gray-600">보유 종목 없음</p>
                  )}
                </div>
              </div>
            )}
            </div>
          );
        })}
        {editing && (
          <div className="px-5 py-3 flex items-center gap-3">
            <button onClick={saveDraft} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm text-white transition-colors">
              저장
            </button>
            <span className="text-xs text-gray-600">
              목표 합 {draft.reduce((s, b) => s + (b.target || 0), 0).toFixed(0)}% (100% 필요) · 밴드는 상대값 — 5/25 규칙상 절대 5%p와 비교해 좁은 쪽 적용
            </span>
          </div>
        )}
      </div>

      {/* 실행 제안 */}
      <div className="px-5 py-4 grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div>
          <p className="text-sm text-gray-400 mb-2">이번 달 적립금 배분 제안 ({fmtMan(monthlySaving)})</p>
          {analysis.allocation.length ? (
            <div className="space-y-1">
              {analysis.allocation.map((a) => (
                <div key={a.name} className="flex items-center justify-between text-[13px]">
                  <span className="text-gray-400">{a.name}</span>
                  <span className="text-blue-400 font-medium tabular-nums">+{fmtMan(a.amountKrw)} 매수</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[13px] text-gray-600">언더웨이트 버킷 없음 — 목표 비중대로 분산 매수</p>
          )}
          <Bullets items={["매도 없이 신규 자금으로 비중 수렴 (무세금 리밸런싱)", "부족분에 비례해 배분"]} />
        </div>
        <div>
          <p className="text-sm text-gray-400 mb-2">
            {analysis.overBuckets.length ? "매도 필요 시 — 절세(손실) 후보 우선" : "매도 불필요"}
          </p>
          {analysis.sellCandidates.length ? (
            <div className="space-y-1">
              {analysis.sellCandidates.map((c) => (
                <div key={c.symbol} className="flex items-center justify-between text-[13px]">
                  <span className="text-gray-400">{c.symbol} <span className="text-gray-600">({c.bucket})</span></span>
                  <span className="text-rose-400 tabular-nums">평가손 {fmtMan(c.pnl)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[13px] text-gray-600">
              {analysis.overBuckets.length ? "초과 버킷에 손실 종목 없음 — 이익 매도는 연초(공제 리셋 후) 권장" : "모든 버킷이 밴드 안입니다."}
            </p>
          )}
          {analysis.overBuckets.length > 0 && (
            <Bullets items={[
              "올해 양도세 공제 소진 시 이익 실현엔 22% 과세",
              "손실 종목 매도 = 리밸런싱 + 절세 동시 달성",
              "매도 전 세금 시뮬레이터로 확인",
            ]} />
          )}
        </div>
      </div>

      {/* 미분류 종목 */}
      {analysis.unassigned.length > 0 && (
        <div className="px-5 pb-4">
          <p className="text-xs text-gray-600 mb-1.5">미분류 종목 — 버킷을 지정하면 계산에 포함됩니다</p>
          <div className="flex flex-wrap gap-2">
            {analysis.unassigned.map((p) => (
              <div key={p.symbol} className="flex items-center gap-1.5 text-[13px] bg-white/[0.03] rounded-lg px-2 py-1">
                <span className="text-gray-400">{p.symbol}</span>
                <select
                  defaultValue=""
                  onChange={(e) => e.target.value && assignSymbol(p.symbol, e.target.value)}
                  className="bg-gray-900/60 border border-white/[0.08] rounded px-1 py-0.5 text-xs text-gray-300 focus:outline-none"
                >
                  <option value="">버킷 선택</option>
                  {config.buckets.map((b) => (
                    <option key={b.name} value={b.name}>{b.name}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>
      )}

      {!anyBreach && !editing && (
        <div className="px-5 pb-4 -mt-1">
          <Bullets items={["모든 버킷이 밴드 안 — 지금은 아무것도 하지 않는 것이 규칙", "월급일에 다시 확인"]} />
        </div>
      )}
    </div>
  );
});
