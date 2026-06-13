import { useEffect, useState } from "react";

interface MacroFactor {
  symbol: string;
  label: string;
  beta: number;
  correlation: number;
  factorAnnualizedReturn: number;
  alpha: number;
}

interface MacroResult {
  factors: MacroFactor[];
  portfolio: { totalReturn: number; annualizedReturn: number };
  period: { from: string; to: string; tradingDays: number };
}

function pct(v: number, digits = 1) {
  return (v * 100).toFixed(digits) + "%";
}

function interpret(f: MacroFactor, factors: MacroFactor[]): string {
  const spy = factors.find(x => x.symbol === "SPY");
  const qqq = factors.find(x => x.symbol === "QQQ");

  switch (f.symbol) {
    case "SPY": {
      if (f.beta > 1.15) return `β=${f.beta} — 시장보다 공격적. 상승장엔 더 오르고 하락장엔 더 떨어짐.`;
      if (f.beta > 0.85) return `β=${f.beta} — 시장과 유사한 움직임. 지수 추종에 가까운 포트폴리오.`;
      return `β=${f.beta} — 시장보다 방어적. 변동폭이 시장 대비 작음.`;
    }
    case "QQQ": {
      const spyCorr = spy?.correlation ?? 0;
      if (f.correlation > spyCorr + 0.05)
        return `r=${f.correlation} > SPY r=${spyCorr} — SPY보다 나스닥과 더 동조. 테크·성장주 중심 포트폴리오.`;
      if (f.correlation < spyCorr - 0.05)
        return `r=${f.correlation} < SPY r=${spyCorr} — 나스닥보다 S&P500에 더 가까움. 가치주·배당 비중이 높은 편.`;
      return `r=${f.correlation} ≈ SPY r=${spyCorr} — 나스닥과 S&P500에 비슷하게 연동.`;
    }
    case "TLT": {
      if (Math.abs(f.correlation) < 0.1)
        return `r=${f.correlation} — 금리 변화에 거의 영향 없음. 채권·금리 리스크에 중립적인 포트폴리오.`;
      if (f.correlation < -0.3)
        return `r=${f.correlation} — 금리 상승(채권 하락) 시 포트폴리오도 하락. 금리 리스크 노출 주의.`;
      return `r=${f.correlation} — 장기채와 약한 상관. 금리 변동의 영향이 제한적.`;
    }
    case "GLD": {
      if (f.correlation > 0.35)
        return `r=${f.correlation} — 금과 동조. 인플레이션·안전자산 선호 시 수혜.`;
      if (f.correlation < -0.1)
        return `r=${f.correlation} — 금과 역방향. 리스크온 성향이 강한 포트폴리오.`;
      return `r=${f.correlation} — 금과 낮은 상관. 실물자산 헤지 효과 제한적.`;
    }
    case "UUP": {
      if (f.correlation < -0.2)
        return `r=${f.correlation} — 달러 강세 시 포트폴리오 하락 압력. 해외(미국) 자산 비중이 높을 때 나타나는 패턴.`;
      if (f.correlation > 0.2)
        return `r=${f.correlation} — 달러 강세와 동조. 달러 약세 시 상대적 불리.`;
      return `r=${f.correlation} — 달러 인덱스와 낮은 상관. 환율 방향성에 둔감.`;
    }
    case "VIXY": {
      if (f.correlation < -0.4)
        return `r=${f.correlation} — 시장 공포 시 포트폴리오도 함께 하락. 변동성 헤지 수단 없음. 하락장 방어력 낮음.`;
      if (f.correlation < -0.2)
        return `r=${f.correlation} — 변동성 급등 시 소폭 하락. 부분적 리스크 노출.`;
      return `r=${f.correlation} — 변동성과 낮은 상관. 공포장 대응력이 상대적으로 있음.`;
    }
    case "XLE": {
      if (f.correlation > 0.4)
        return `r=${f.correlation} — 에너지 섹터와 높은 동조. 유가·원자재 사이클에 노출.`;
      return `r=${f.correlation} — 에너지 섹터와 낮은 상관. 유가 변동의 영향 제한적.`;
    }
    case "XLK": {
      const qqqCorr = qqq?.correlation ?? 0;
      if (f.correlation > 0.7)
        return `r=${f.correlation} — 테크 섹터와 매우 높은 동조. 실질적으로 테크 집중 포트폴리오.`;
      if (f.correlation > qqqCorr)
        return `r=${f.correlation} > QQQ r=${qqqCorr} — 나스닥보다 순수 테크(XLK)에 더 가까운 구성.`;
      return `r=${f.correlation} — 테크 섹터와 중간 수준 상관.`;
    }
    default:
      return `β=${f.beta}, r=${f.correlation}`;
  }
}

function summary(factors: MacroFactor[]): string[] {
  const lines: string[] = [];
  const spy = factors.find(f => f.symbol === "SPY");
  const qqq = factors.find(f => f.symbol === "QQQ");
  const tlt = factors.find(f => f.symbol === "TLT");
  const vixy = factors.find(f => f.symbol === "VIXY");

  if (spy && spy.beta > 1.1) lines.push(`시장보다 공격적 (SPY β=${spy.beta})`);
  else if (spy && spy.beta < 0.9) lines.push(`시장보다 방어적 (SPY β=${spy.beta})`);

  if (qqq && spy && qqq.correlation > spy.correlation + 0.05)
    lines.push(`테크·성장주 중심 (QQQ r=${qqq.correlation})`);

  if (tlt && Math.abs(tlt.correlation) < 0.1)
    lines.push(`금리 변화에 중립 (TLT r=${tlt.correlation})`);
  else if (tlt && tlt.correlation < -0.3)
    lines.push(`금리 상승에 취약 (TLT r=${tlt.correlation})`);

  if (vixy && vixy.correlation < -0.4)
    lines.push(`하락장 방어력 낮음 (VIXY r=${vixy.correlation})`);

  return lines;
}

function Bar({ value, max }: { value: number; max: number }) {
  const w = Math.min(Math.abs(value) / max, 1) * 100;
  return (
    <div className="flex items-center gap-2 w-full">
      <div className="flex-1 h-2 bg-gray-700 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${value >= 0 ? "bg-blue-500" : "bg-rose-500"}`}
          style={{ width: `${w}%` }}
        />
      </div>
      <span className={`text-xs font-mono w-10 text-right ${value >= 0 ? "text-blue-400" : "text-rose-400"}`}>
        {value.toFixed(2)}
      </span>
    </div>
  );
}

export function MacroSensitivity() {
  const [data, setData] = useState<MacroResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"beta" | "corr" | "alpha">("beta");

  useEffect(() => {
    fetch("/api/macro-sensitivity")
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(d => { setData(d); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, []);

  const maxBeta = Math.max(...(data?.factors.map(f => Math.abs(f.beta)) ?? [1]));
  const maxAlpha = Math.max(...(data?.factors.map(f => Math.abs(f.alpha)) ?? [0.01]), 0.01);
  const TAB_LABELS = { beta: "베타 (β)", corr: "상관계수", alpha: "알파 (α)" };

  return (
    <div className="bg-gray-800/60 backdrop-blur border border-gray-700/50 rounded-2xl p-5 h-full flex flex-col">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-white">매크로 민감도</h2>
          {data && (
            <p className="text-xs text-gray-500 mt-0.5">
              {data.period.from} ~ {data.period.to} · {data.period.tradingDays} 거래일
            </p>
          )}
        </div>
        {data && (
          <div className="flex gap-1">
            {(["beta", "corr", "alpha"] as const).map(t => (
              <button key={t} onClick={() => setTab(t)}
                className={`px-2.5 py-1 text-xs rounded-lg transition-colors ${
                  tab === t ? "bg-blue-600 text-white" : "bg-gray-700/50 text-gray-400 hover:text-white hover:bg-gray-700"
                }`}>
                {TAB_LABELS[t]}
              </button>
            ))}
          </div>
        )}
      </div>

      {loading && (
        <div className="flex items-center justify-center h-40 text-gray-500 text-sm gap-2">
          <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
          매크로 민감도 계산 중...
        </div>
      )}
      {!loading && error && (
        <div className="text-rose-400 text-sm text-center py-8">{error}</div>
      )}

      {!loading && !error && data && (
        <div className="flex-1 flex flex-col gap-4">
          {/* 요약 태그 */}
          {summary(data.factors).length > 0 && (
            <div className="flex flex-wrap gap-2">
              {summary(data.factors).map(s => (
                <span key={s} className="px-2.5 py-1 bg-gray-700/60 text-gray-300 text-xs rounded-lg border border-gray-600/40">
                  {s}
                </span>
              ))}
            </div>
          )}

          {/* 지표별 행 */}
          <div className="flex-1 flex flex-col justify-between">
            {data.factors.map(f => (
              <div key={f.symbol} className="space-y-1 py-2 border-b border-gray-700/30 last:border-0">
                <div className="flex items-center gap-3">
                  <div className="w-32 shrink-0">
                    <p className="text-sm text-white font-medium">{f.label}</p>
                    <p className="text-[10px] text-gray-500">{f.symbol} · {pct(f.factorAnnualizedReturn)} CAGR</p>
                  </div>
                  <div className="flex-1">
                    <Bar
                      value={tab === "beta" ? f.beta : tab === "corr" ? f.correlation : f.alpha}
                      max={tab === "beta" ? maxBeta : tab === "corr" ? 1 : maxAlpha}
                    />
                  </div>
                </div>
                <p className="text-[11px] text-gray-500 pl-[8.5rem]">
                  {interpret(f, data.factors)}
                </p>
              </div>
            ))}
          </div>

          <div className="border-t border-gray-700/50 pt-3 flex gap-6 text-xs text-gray-500">
            <span>포트폴리오 CAGR <span className={data.portfolio.annualizedReturn >= 0 ? "text-green-400" : "text-rose-400"}>{pct(data.portfolio.annualizedReturn)}</span></span>
            <span>총 수익 <span className={data.portfolio.totalReturn >= 0 ? "text-green-400" : "text-rose-400"}>{pct(data.portfolio.totalReturn)}</span></span>
          </div>
        </div>
      )}
    </div>
  );
}
