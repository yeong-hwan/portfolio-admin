import { useEffect, useState } from "react";
import { usePortfolio } from "./hooks/usePortfolio";
import { useMasked, toggleMasked } from "./lib/privacy";
import { SummaryCards } from "./components/SummaryCards";
import { PositionsTable } from "./components/PositionsTable";
import { AllocationChart } from "./components/AllocationChart";
import { TopMovers } from "./components/TopMovers";
import { Heatmap } from "./components/Heatmap";
import { StaleBanner } from "./components/StaleBanner";
import { PortfolioCandles } from "./components/PortfolioCandles";
import { PerformanceMetrics } from "./components/PerformanceMetrics";
import { CorrelationHeatmap } from "./components/CorrelationHeatmap";
import { MacroSensitivity } from "./components/MacroSensitivity";
import { QuantDashboard } from "./components/QuantDashboard";
import { TqqqManager } from "./components/TqqqManager";
import { CashflowCard } from "./components/CashflowCard";
import { FxChart } from "./components/FxChart";
import { GoalCard } from "./components/GoalCard";
import { TaxCard } from "./components/TaxCard";
import { MonthlyHeatmap } from "./components/MonthlyHeatmap";
import { ReturnDecomposition } from "./components/ReturnDecomposition";
import { DrawdownChart } from "./components/DrawdownChart";
import { DividendCard } from "./components/DividendCard";
import { InflationCompass } from "./components/InflationCompass";
import { MarketEnvironment } from "./components/MarketEnvironment";
import { RebalanceCard } from "./components/RebalanceCard";
import { QqqDrawdown } from "./components/QqqDrawdown";
import { LimitsMonitor } from "./components/LimitsMonitor";
import { FundamentalsMonitor } from "./components/FundamentalsMonitor";
import { FcfPowerMap } from "./components/FcfPowerMap";
import { SidebarSummary } from "./components/SidebarSummary";

function RefreshIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg
      className={`h-5 w-5 ${spinning ? "animate-spin" : ""}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
      <polyline points="21 3 21 9 15 9" />
    </svg>
  );
}

function SectionHeader({ no, title }: { no: string; title: string }) {
  return (
    <div className="flex items-center gap-3 pt-10 first:pt-0">
      <span className="text-xs font-bold text-gray-600 tabular-nums">{no}</span>
      <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-widest whitespace-nowrap">{title}</h2>
      <div className="flex-1 h-px bg-white/[0.07]" />
    </div>
  );
}

function CollapseSection({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-white/[0.05] backdrop-blur border border-white/[0.08] rounded-2xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-gray-700/30 transition-colors"
      >
        <span className="text-base font-semibold text-white">{title}</span>
        <svg
          className={`h-4 w-4 text-gray-400 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && <div className="border-t border-white/[0.08]">{children}</div>}
    </div>
  );
}

type Tab = 'portfolio' | 'quant' | 'tqqq';

const TAB_LABEL: Record<Tab, string> = {
  portfolio: '포트폴리오',
  quant: '퀀트',
  tqqq: 'TQQQ',
};

// ≥2200px(34" 모니터 2/3 창 이상)에서 메인+사이드바 배치
function useWideLayout(): boolean {
  const [wide] = useState(() => window.matchMedia("(min-width: 2200px)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 2200px)");
    // 레이아웃 모드 전환 시 차트·그리드가 꼬이지 않게 전체 새로고침
    const onChange = () => window.location.reload();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return wide;
}

export default function App() {
  const [tab, setTab] = useState<Tab>('portfolio');
  // 방문한 탭은 마운트를 유지해서 탭 전환 시 재fetch/차트 재생성을 방지
  const [visited, setVisited] = useState<Set<Tab>>(() => new Set<Tab>(['portfolio']));
  const selectTab = (t: Tab) => {
    setTab(t);
    setVisited(prev => (prev.has(t) ? prev : new Set(prev).add(t)));
  };
  const masked = useMasked();
  const wide = useWideLayout();
  const {
    snapshot,
    exchangeRate,
    loading,
    error,
    lastRefresh,
    refresh,
  } = usePortfolio();

  const cashKrw = snapshot?.summary.orderable_amount_krw ?? 0;

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Loading bar */}
      <div className={`fixed top-0 left-0 right-0 z-[60] h-0.5 overflow-hidden transition-opacity duration-300 ${loading ? "opacity-100" : "opacity-0"}`}>
        <div
          className="h-full w-2/5 rounded-full"
          style={{
            background: "linear-gradient(90deg, #3b82f6, #8b5cf6, #3b82f6)",
            animation: "loadingBar 1.2s linear infinite",
          }}
        />
      </div>
      <style>{`@keyframes loadingBar { 0% { transform: translateX(-150%); } 100% { transform: translateX(350%); } }`}</style>

      {/* Header */}
      <header className="bg-gray-950 border-b border-gray-800/50">
        <div className="max-w-[1600px] 3xl:max-w-[2280px] mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold bg-gradient-to-r from-blue-400 to-violet-400 bg-clip-text text-transparent">
              Portfolio Admin
            </h1>
            <p className="text-xs text-gray-500 mt-0.5">
              v0.1.6
            </p>
          </div>
          <div className="flex gap-1 bg-gray-900/60 rounded-xl p-1 border border-white/[0.06]">
            {(['portfolio', 'quant', 'tqqq'] as const).map(t => (
              <button
                key={t}
                onClick={() => selectTab(t)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  tab === t ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'
                }`}
              >
                {TAB_LABEL[t]}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3">
            {lastRefresh && (
              <span className="text-xs text-gray-500">
                {lastRefresh.toLocaleTimeString("ko-KR")}
              </span>
            )}
            <button
              onClick={toggleMasked}
              className={`p-2.5 rounded-xl transition-all active:scale-90 border ${
                masked
                  ? "bg-amber-500/15 border-amber-500/40 text-amber-400"
                  : "bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white border-white/[0.08] hover:border-gray-600/50"
              }`}
              title={masked ? "마스킹 해제" : "금액 마스킹"}
            >
              {masked ? (
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                  <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                  <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
                  <line x1="1" y1="1" x2="23" y2="23" />
                </svg>
              ) : (
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              )}
            </button>
            <a
              href="http://100.110.86.86:3001"
              target="_blank"
              rel="noopener noreferrer"
              className="p-2.5 bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white rounded-xl transition-all active:scale-90 border border-white/[0.08] hover:border-gray-600/50"
              title="홈서버 대시보드"
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                <polyline points="9 22 9 12 15 12 15 22" />
              </svg>
            </a>
            <button
              onClick={refresh}
              disabled={loading}
              className="p-2.5 bg-gray-800 hover:bg-gray-700 disabled:bg-white/[0.04] disabled:text-gray-600 text-gray-300 hover:text-white rounded-xl transition-all active:scale-90 border border-white/[0.08] hover:border-gray-600/50"
              title="새로고침"
            >
              <RefreshIcon spinning={loading} />
            </button>
          </div>
        </div>
      </header>

      {/* Error */}
      {error && (
        <div className="max-w-[1600px] 3xl:max-w-[2280px] mx-auto px-6 pt-4">
          <div className="px-4 py-3 bg-rose-900/30 border border-rose-700/30 rounded-xl text-sm text-rose-400">
            {error}
          </div>
        </div>
      )}

      {/* Tab content — 방문한 탭은 hidden으로 유지 */}
      {visited.has('quant') && <div hidden={tab !== 'quant'}><QuantDashboard /></div>}
      {visited.has('tqqq') && <div hidden={tab !== 'tqqq'}><TqqqManager /></div>}
      <div hidden={tab !== 'portfolio'}>
      {snapshot ? (
        <main className="max-w-[1600px] 3xl:max-w-[2280px] mx-auto px-6 py-6 space-y-6">
          {snapshot.stale && (
            <StaleBanner snapshot={snapshot} onRefresh={refresh} />
          )}
          {(() => {
            // 섹션 정의 — 내부 레이아웃은 맥북 기준 그대로, 와이드에선 섹션 단위로 2컬럼 재배치
            const s01 = (
              <div className="space-y-6">
                <SectionHeader no="01" title="자산 현황" />
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
                  <div className="flex flex-col gap-6">
                    {!wide && <SummaryCards summary={snapshot.summary} exchangeRate={exchangeRate} />}
                    {!wide && <GoalCard totalAsset={snapshot.summary.total_asset_amount} />}
                    <PortfolioCandles />
                    {!wide && <QqqDrawdown />}
                  </div>
                  <PerformanceMetrics />
                </div>
              </div>
            );
            const s02 = (
              <div className="space-y-6">
                <SectionHeader no="02" title="배분 · 리스크 규율" />
                <RebalanceCard positions={snapshot.positions} totalAsset={snapshot.summary.total_asset_amount} />
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch">
                  {!wide && <LimitsMonitor positions={snapshot.positions} totalAsset={snapshot.summary.total_asset_amount} />}
                  <div className={wide ? "lg:col-span-3" : "lg:col-span-2"}>
                    <FundamentalsMonitor positions={snapshot.positions} />
                  </div>
                </div>
                <FcfPowerMap positions={snapshot.positions} />
                <MacroSensitivity />
              </div>
            );
            const s03 = (
              <div className="space-y-6">
                <SectionHeader no="03" title="시장 환경" />
                <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 items-stretch">
                  <div className={wide ? "lg:col-span-5" : "lg:col-span-3"}>
                    <InflationCompass />
                  </div>
                  {!wide && (
                    <div className="lg:col-span-2">
                      <FxChart compact />
                    </div>
                  )}
                </div>
                <MarketEnvironment />
              </div>
            );
            const s04 = (
              <div className="space-y-6">
                <SectionHeader no="04" title="수익 · 현금흐름" />
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
                  <CashflowCard totalAsset={snapshot.summary.total_asset_amount} />
                  <MonthlyHeatmap />
                  <ReturnDecomposition />
                  <DrawdownChart />
                  <div className="lg:col-span-2">
                    <DividendCard />
                  </div>
                </div>
              </div>
            );
            const s05 = (
              <div className="space-y-6">
                <SectionHeader no="05" title="보유 · 세금" />
                <TaxCard positions={snapshot.positions} />
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  <div className="lg:col-span-2">
                    <Heatmap positions={snapshot.positions} cashKrw={cashKrw} />
                  </div>
                  <AllocationChart positions={snapshot.positions} cashKrw={cashKrw} />
                </div>
                <CollapseSection title="수익률 상관관계">
                  <CorrelationHeatmap positions={snapshot.positions} embedded />
                </CollapseSection>
                <CollapseSection title="오늘 상승/하락">
                  <TopMovers positions={snapshot.positions} />
                </CollapseSection>
                <CollapseSection title="보유종목">
                  <PositionsTable positions={snapshot.positions} />
                </CollapseSection>
              </div>
            );

            if (!wide) {
              return <div className="space-y-12">{s01}{s02}{s03}{s04}{s05}</div>;
            }
            // 와이드(≥1880px): 메인(맥북 레이아웃 유지) + 상시 모니터링 사이드바
            return (
              <div className="flex gap-6 items-start">
                <div className="flex-1 min-w-0 max-w-[1680px] space-y-12">{s01}{s02}{s03}{s04}{s05}</div>
                <aside className="w-[560px] shrink-0 space-y-6 sticky top-6 max-h-[calc(100vh-3rem)] overflow-y-auto no-scrollbar">
                  <div className="flex items-center gap-3">
                    <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-widest whitespace-nowrap">모니터링</h2>
                    <div className="flex-1 h-px bg-white/[0.07]" />
                  </div>
                  <SidebarSummary summary={snapshot.summary} exchangeRate={exchangeRate} />
                  <GoalCard totalAsset={snapshot.summary.total_asset_amount} />
                  <QqqDrawdown />
                  <LimitsMonitor positions={snapshot.positions} totalAsset={snapshot.summary.total_asset_amount} />
                  <InflationCompass compact />
                  <div className="h-[360px]">
                    <FxChart compact />
                  </div>
                </aside>
              </div>
            );
          })()}
        </main>
      ) : (
        !loading && (
          <div className="flex items-center justify-center h-[60vh]">
            <p className="text-gray-500">
              데이터를 불러올 수 없습니다. 서버를 확인해주세요.
            </p>
          </div>
        )
      )}
      </div>
    </div>
  );
}
