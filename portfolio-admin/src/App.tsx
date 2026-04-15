import { useState } from "react";
import { usePortfolio } from "./hooks/usePortfolio";
import { SummaryCards } from "./components/SummaryCards";
import { PositionsTable } from "./components/PositionsTable";
import { AllocationChart } from "./components/AllocationChart";
import { TrendChart } from "./components/TrendChart";
import { TopMovers } from "./components/TopMovers";
import { Heatmap } from "./components/Heatmap";
import { SectorView } from "./components/SectorView";
import { SectorManager } from "./components/SectorManager";
import { StaleBanner } from "./components/StaleBanner";

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

export default function App() {
  const [sectorMode, setSectorMode] = useState<"view" | "manage">("view");
  const {
    snapshot,
    checkpoints,
    exchangeRate,
    sectorConfig,
    loading,
    error,
    lastRefresh,
    refresh,
    addSector,
    deleteSector,
    assignSymbol,
    removeSymbol,
  } = usePortfolio();

  const cashKrw = snapshot?.summary.markets.us.orderable_amount_krw ?? 0;

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-gray-950/80 backdrop-blur border-b border-gray-800/50">
        <div className="max-w-[1600px] mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold bg-gradient-to-r from-blue-400 to-violet-400 bg-clip-text text-transparent">
              Portfolio Admin
            </h1>
            <p className="text-xs text-gray-500 mt-0.5">
              tossinvest-cli dashboard
            </p>
          </div>
          <div className="flex items-center gap-3">
            {lastRefresh && (
              <span className="text-xs text-gray-500">
                {lastRefresh.toLocaleTimeString("ko-KR")}
              </span>
            )}
            <a
              href="http://100.110.86.86:3001"
              target="_blank"
              rel="noopener noreferrer"
              className="p-2.5 bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white rounded-xl transition-all active:scale-90 border border-gray-700/50 hover:border-gray-600/50"
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
              className="p-2.5 bg-gray-800 hover:bg-gray-700 disabled:bg-gray-800/50 disabled:text-gray-600 text-gray-300 hover:text-white rounded-xl transition-all active:scale-90 border border-gray-700/50 hover:border-gray-600/50"
              title="새로고침"
            >
              <RefreshIcon spinning={loading} />
            </button>
          </div>
        </div>
      </header>

      {/* Error */}
      {error && (
        <div className="max-w-[1600px] mx-auto px-6 pt-4">
          <div className="px-4 py-3 bg-rose-900/30 border border-rose-700/30 rounded-xl text-sm text-rose-400">
            {error}
          </div>
        </div>
      )}

      {/* Content */}
      {snapshot ? (
        <main className="max-w-[1600px] mx-auto px-6 py-6 space-y-6">
          {snapshot.stale && (
            <StaleBanner
              snapshot={snapshot}
              onRefresh={refresh}
            />
          )}
          <SummaryCards summary={snapshot.summary} exchangeRate={exchangeRate} />

          <TrendChart checkpoints={checkpoints} onRefresh={refresh} />

          {sectorConfig && (
            <div className="bg-gray-800/60 backdrop-blur border border-gray-700/50 rounded-2xl p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-white">
                  {sectorMode === "view" ? "섹터별 현황" : "섹터 관리"}
                </h2>
                <div className="flex gap-1">
                  {(["view", "manage"] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => setSectorMode(m)}
                      className={`px-2.5 py-1 text-xs rounded-lg transition-colors ${
                        sectorMode === m
                          ? "bg-blue-600 text-white"
                          : "bg-gray-700/50 text-gray-400 hover:text-white hover:bg-gray-700"
                      }`}
                    >
                      {m === "view" ? "현황" : "관리"}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                {sectorMode === "view" ? (
                  <SectorView
                    positions={snapshot.positions}
                    sectorConfig={sectorConfig}
                    cashKrw={cashKrw}
                  />
                ) : (
                  <SectorManager
                    positions={snapshot.positions}
                    sectorConfig={sectorConfig}
                    onAddSector={addSector}
                    onDeleteSector={deleteSector}
                    onAssignSymbol={assignSymbol}
                    onRemoveSymbol={removeSymbol}
                  />
                )}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <Heatmap positions={snapshot.positions} cashKrw={cashKrw} />
            </div>
            <AllocationChart positions={snapshot.positions} cashKrw={cashKrw} />
          </div>

          <TopMovers positions={snapshot.positions} />

          <PositionsTable positions={snapshot.positions} />
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
  );
}
