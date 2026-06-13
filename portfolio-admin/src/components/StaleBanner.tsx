import type { Snapshot } from "../types";

interface Props {
  snapshot: Snapshot;
  onRefresh: () => void;
}

export function StaleBanner({ snapshot, onRefresh }: Props) {
  return (
    <div className="px-4 py-3 rounded-xl border bg-gray-800/50 border-gray-700/30 text-gray-400">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-sm">
          <svg className="h-4 w-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span>실시간 데이터 가져오기 실패 — 캐시된 데이터 표시 중</span>
          <span className="text-xs opacity-60">
            ({new Date(snapshot.timestamp).toLocaleString("ko-KR")})
          </span>
        </div>
        <button
          onClick={onRefresh}
          className="px-3 py-1.5 bg-gray-700/50 hover:bg-gray-600/50 text-gray-300 text-sm font-medium rounded-lg transition-all active:scale-95 whitespace-nowrap"
        >
          재시도
        </button>
      </div>
    </div>
  );
}
