import { memo, useEffect, useState } from "react";

interface SeriesPoint { date: string; value: number }

interface Indicator {
  id: string;
  label: string;
  unit: string;
  value: number;
  chg1m: number;
  series: SeriesPoint[];
}

interface MacroData { asOf: string; indicators: Indicator[] }

interface FlowsData {
  asOf: string;
  cot: { spNet: Indicator | null; ndqNet: Indicator | null };
  fearGreed: { score: number; rating: string; prevClose: number; prevMonth: number; series: SeriesPoint[] } | null;
  vixTerm: Indicator | null;
}

interface GeoData {
  asOf: string;
  gpr: { current: number | null; ma30: number | null; series: SeriesPoint[] };
  proxies: Array<{ id: string; label: string; ret3m: number | null; vsSpy: number; series: SeriesPoint[] }>;
}

type Status = { text: string; color: string };
const GREEN = "text-emerald-400 bg-emerald-500/10";
const AMBER = "text-amber-400 bg-amber-500/10";
const RED = "text-rose-400 bg-rose-500/10";
const GRAY = "text-gray-400 bg-white/[0.04]";

// 지표별 상태 판정 규칙
function macroStatus(id: string, v: number): Status | null {
  switch (id) {
    case "t10y2y": return v < 0 ? { text: "역전 (침체 경계)", color: RED } : v < 0.5 ? { text: "완만", color: AMBER } : { text: "정상", color: GREEN };
    case "hySpread": return v < 4 ? { text: "안정", color: GREEN } : v < 5 ? { text: "경계", color: AMBER } : { text: "스트레스", color: RED };
    case "cpiYoy": return v < 2.5 ? { text: "목표권", color: GREEN } : v < 3.5 ? { text: "다소 높음", color: AMBER } : { text: "높음", color: RED };
    case "t5yie": return v < 2 ? { text: "낮음", color: GREEN } : v < 2.5 ? { text: "보통", color: AMBER } : { text: "높음", color: RED };
    default: return null;
  }
}

// 지표별 해석 가이드: 설명 한 줄(intro) + 핵심 포인트(bullets)
export interface Guide { intro?: string; bullets?: string[] }

const MACRO_GUIDE: Record<string, Guide> = {
  t10y2y: {
    bullets: ["음수(역전) = 침체 선행 신호", "역전 후 다시 가팔라지는 구간이 역사적으로 진짜 위험 구간"],
  },
  hySpread: {
    intro: "부실채권 가산금리, 주식 급락에 선행하는 핵심 경보",
    bullets: ["4%p 미만 = 안정", "5%p 이상 = 신용 스트레스"],
  },
  dgs10: {
    bullets: ["급등 시 성장주 밸류에이션 압박", "레벨보다 상승 속도가 중요"],
  },
  dgs2: {
    intro: "연준 정책 기대를 반영",
    bullets: ["기준금리보다 낮으면 시장은 인하를 기대 중"],
  },
  cpiYoy: {
    intro: "연준 목표 2%",
    bullets: ["3%대 재가속 시 금리 인하 기대 후퇴"],
  },
  t5yie: {
    intro: "채권시장이 보는 향후 5년 평균 인플레",
    bullets: ["인플레이션 나침반 신호의 원료"],
  },
  dff: {
    intro: "실효 연방기금금리 (정책금리의 실제 거래 수준)",
  },
  dxy: {
    bullets: ["달러 강세 = 원화 환산 수익 순풍", "신흥국·원자재엔 역풍"],
  },
};

function GuideText({ guide }: { guide: Guide }) {
  return (
    <div className="mt-1.5 space-y-0.5">
      {guide.intro && <p className="text-xs text-gray-600 leading-snug">{guide.intro}</p>}
      {guide.bullets && (
        <ul className="space-y-0.5">
          {guide.bullets.map((b) => (
            <li key={b} className="text-xs text-gray-600 leading-snug flex gap-1.5">
              <span className="text-gray-700 shrink-0">•</span>
              <span>{b}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Sparkline({ series, color = "#60a5fa" }: { series: SeriesPoint[]; color?: string }) {
  if (series.length < 2) return <div className="w-[84px] h-[26px]" />;
  const vals = series.map((p) => p.value);
  const min = Math.min(...vals), max = Math.max(...vals);
  const range = max - min || 1;
  const W = 84, H = 26;
  const pts = series.map((p, i) => `${(i / (series.length - 1)) * W},${H - 2 - ((p.value - min) / range) * (H - 4)}`).join(" ");
  return (
    <svg width={W} height={H} className="shrink-0">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.2" opacity="0.85" />
    </svg>
  );
}

function fmtVal(v: number, unit: string): string {
  const digits = Math.abs(v) >= 1000 ? 0 : 2;
  return v.toLocaleString("ko-KR", { maximumFractionDigits: digits }) + (unit === "계약" ? "" : unit);
}

function IndicatorRow({ ind, status, guide }: { ind: Indicator; status: Status | null; guide?: Guide }) {
  const up = ind.chg1m >= 0;
  return (
    <div className="py-2 border-b border-white/[0.05] last:border-0">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[13px] text-gray-300 truncate">{ind.label}</p>
        {status && (
          <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full ${status.color}`}>{status.text}</span>
        )}
      </div>
      <div className="flex items-center gap-2.5 mt-1">
        <Sparkline series={ind.series} />
        <span className="text-base font-semibold text-white tabular-nums">{fmtVal(ind.value, ind.unit)}</span>
        <span className={`text-xs tabular-nums ${up ? "text-emerald-400" : "text-rose-400"}`}>
          {up ? "▲" : "▼"} {fmtVal(Math.abs(ind.chg1m), ind.unit)}<span className="text-gray-600">/1M</span>
        </span>
      </div>
      {guide && <GuideText guide={guide} />}
    </div>
  );
}

function SectionCard({ title, subtitle, children }: { title: string; subtitle: Guide; children: React.ReactNode }) {
  return (
    <div className="bg-white/[0.05] border border-white/[0.08] rounded-2xl overflow-hidden h-full">
      <div className="px-4 py-3.5 border-b border-white/[0.08]">
        <h2 className="text-base font-semibold text-white">{title}</h2>
        <GuideText guide={subtitle} />
      </div>
      <div className="px-4 py-1.5">{children}</div>
    </div>
  );
}

function Loading({ label }: { label: string }) {
  return <p className="text-sm text-gray-500 py-8 text-center">{label} 로딩 중...</p>;
}

export const MarketEnvironment = memo(function MarketEnvironment() {
  const [macro, setMacro] = useState<MacroData | null>(null);
  const [flows, setFlows] = useState<FlowsData | null>(null);
  const [geo, setGeo] = useState<GeoData | null>(null);

  useEffect(() => {
    fetch("/api/market-env/macro").then((r) => r.json()).then((d) => !d.error && setMacro(d)).catch(() => {});
    fetch("/api/market-env/flows").then((r) => r.json()).then((d) => !d.error && setFlows(d)).catch(() => {});
    fetch("/api/market-env/geo").then((r) => r.json()).then((d) => !d.error && setGeo(d)).catch(() => {});
  }, []);

  const fg = flows?.fearGreed;
  const fgStatus: Status | null = fg
    ? fg.score < 25 ? { text: "극단적 공포", color: RED }
    : fg.score < 45 ? { text: "공포", color: AMBER }
    : fg.score < 55 ? { text: "중립", color: GRAY }
    : fg.score < 75 ? { text: "탐욕", color: GREEN }
    : { text: "극단적 탐욕", color: AMBER }
    : null;

  const vt = flows?.vixTerm;
  const vtStatus: Status | null = vt
    ? vt.value < 0.9 ? { text: "콘탱고 (안정)", color: GREEN }
    : vt.value < 1 ? { text: "평탄", color: AMBER }
    : { text: "백워데이션 (스트레스)", color: RED }
    : null;

  const gprVal = geo?.gpr.ma30 ?? null;
  const gprStatus: Status | null = gprVal != null
    ? gprVal < 100 ? { text: "평균 이하", color: GREEN }
    : gprVal < 150 ? { text: "다소 높음", color: AMBER }
    : { text: "높음", color: RED }
    : null;

  return (
    <div className="space-y-6">
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 items-stretch">
      {/* 매크로 — 넓은 영역에 지표 2열 배치 */}
      <div className="lg:col-span-3">
        <SectionCard
          title="매크로"
          subtitle={{
            intro: "금리·물가·신용 환경 (FRED, 일간 갱신)",
            bullets: ["핵심 경보 1: 하이일드 스프레드 확대", "핵심 경보 2: 역전됐던 장단기 금리차의 재확대"],
          }}
        >
          {!macro ? <Loading label="FRED 데이터" /> : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8">
              {macro.indicators.map((ind) => (
                <IndicatorRow key={ind.id} ind={ind} status={macroStatus(ind.id, ind.value)} guide={MACRO_GUIDE[ind.id]} />
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      <div className="lg:col-span-2 flex flex-col gap-6">
      {/* 수급 */}
      <SectionCard
        title="수급 · 심리"
        subtitle={{
          intro: "선물 포지셔닝과 투자심리 — 극단값은 역발상 신호",
          bullets: ["모두가 공포 = 통계적으로 유리한 진입 구간", "모두가 탐욕 = 위험 구간"],
        }}
      >
        {!flows ? <Loading label="CFTC·심리 데이터" /> : (
          <>
            {fg && (
              <div className="py-2 border-b border-white/[0.05]">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[13px] text-gray-300 truncate">Fear & Greed (CNN)</p>
                  {fgStatus && <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full ${fgStatus.color}`}>{fgStatus.text}</span>}
                </div>
                <div className="flex items-center gap-2.5 mt-1">
                  <Sparkline series={fg.series} color="#f59e0b" />
                  <span className="text-base font-semibold text-white tabular-nums">{fg.score.toFixed(0)}</span>
                  <span className="text-xs text-gray-500">1달 전 {fg.prevMonth.toFixed(0)}</span>
                </div>
                <GuideText guide={{
                  intro: "7개 심리지표 합성 (0~100)",
                  bullets: ["25 미만 극공포 = 역발상 매수 구간", "75 초과 극탐욕 = 경계 구간"],
                }} />
              </div>
            )}
            {flows.cot.spNet && (
              <IndicatorRow
                ind={flows.cot.spNet}
                status={{ text: flows.cot.spNet.value >= 0 ? "순매수" : "순매도", color: flows.cot.spNet.value >= 0 ? GREEN : RED }}
                guide={{
                  intro: "헤지펀드 등 투기세력의 S&P500 선물 순포지션 (주 1회, 화요일 기준 금요일 발표)",
                  bullets: ["극단적 순매수 = 과열", "극단적 순매도 = 반등 연료", "레벨보다 방향 전환이 중요"],
                }}
              />
            )}
            {flows.cot.ndqNet && (
              <IndicatorRow
                ind={flows.cot.ndqNet}
                status={{ text: flows.cot.ndqNet.value >= 0 ? "순매수" : "순매도", color: flows.cot.ndqNet.value >= 0 ? GREEN : RED }}
                guide={{
                  intro: "나스닥100 선물 투기 순포지션",
                  bullets: ["기술주 비중이 큰 이 포트폴리오와 상관 높음"],
                }}
              />
            )}
            {vt && (
              <IndicatorRow
                ind={vt}
                status={vtStatus}
                guide={{
                  intro: "단기 VIX ÷ 3개월 VIX",
                  bullets: ["1 미만 (콘탱고) = 정상", "1 초과 (백워데이션) = 급성 스트레스, 바닥 근처에서 자주 관측"],
                }}
              />
            )}
          </>
        )}
      </SectionCard>
      </div>
      </div>

      {/* 지정학 — 전폭 가로 스트립: GPR | 시장 대리 지표 */}
      <SectionCard
        title="지정학"
        subtitle={{
          intro: "GPR = 뉴스 텍스트 기반 지정학 리스크 지수 (Caldara & Iacoviello, Fed) · 100 = 장기 평균 · 스파이크보다 높은 수준의 지속 여부가 중요",
        }}
      >
        {!geo ? <Loading label="GPR 데이터" /> : (
          <div className="flex flex-col lg:flex-row gap-8 lg:gap-14 py-2">
            <div className="lg:w-80 shrink-0">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[13px] text-gray-300 truncate">GPR 지수 (30일 평균)</p>
                {gprStatus && <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full ${gprStatus.color}`}>{gprStatus.text}</span>}
              </div>
              <div className="flex items-center gap-2.5 mt-1">
                <Sparkline series={geo.gpr.series} color="#f43f5e" />
                <span className="text-base font-semibold text-white tabular-nums">{gprVal?.toFixed(0) ?? "—"}</span>
                <span className="text-xs text-gray-500">일간 {geo.gpr.current?.toFixed(0)}</span>
              </div>
              <GuideText guide={{
                bullets: ["150 이상 = 전쟁·분쟁 헤드라인 고조 국면", "우크라이나 침공(2022) ~350 · 평시 60~120"],
              }} />
            </div>
            <div className="flex-1">
              <p className="text-[13px] text-gray-300 mb-2">시장 대리 지표 — 3개월 수익률 (vs SPY)</p>
              <div className="grid grid-cols-3 gap-6">
                {geo.proxies.map((p) => (
                  <div key={p.id} className="bg-white/[0.03] rounded-xl px-4 py-3 space-y-0.5">
                    <p className="text-xs text-gray-500 truncate">{p.label}</p>
                    <p className={`text-base font-semibold tabular-nums ${(p.ret3m ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                      {p.ret3m != null ? ((p.ret3m >= 0 ? "+" : "") + (p.ret3m * 100).toFixed(1) + "%") : "—"}
                    </p>
                    <p className={`text-xs tabular-nums ${p.vsSpy >= 0 ? "text-emerald-500/70" : "text-gray-600"}`}>
                      vs SPY {(p.vsSpy >= 0 ? "+" : "") + (p.vsSpy * 100).toFixed(1)}%p
                    </p>
                  </div>
                ))}
              </div>
              <div className="mt-1">
                <GuideText guide={{
                  bullets: ["금·유가·방산이 SPY 동반 아웃퍼폼 = 리스크 프리미엄 반영 중", "보유 중인 방산·우라늄 포지션과 직접 연관"],
                }} />
              </div>
            </div>
          </div>
        )}
      </SectionCard>
    </div>
  );
});
