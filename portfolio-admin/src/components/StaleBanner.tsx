import { useState } from "react";
import type { Snapshot } from "../types";

interface Props {
  snapshot: Snapshot;
  onRefresh: () => void;
}

export function StaleBanner({ snapshot, onRefresh }: Props) {
  const [loggingIn, setLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  const handleLogin = async () => {
    setLoggingIn(true);
    setLoginError(null);
    try {
      const res = await fetch("/api/auth/login", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "로그인 실패");
      }
      // Login success - refresh data
      onRefresh();
    } catch (e: any) {
      setLoginError(e.message);
    } finally {
      setLoggingIn(false);
    }
  };

  const color = snapshot.sessionExpired
    ? "bg-amber-900/20 border-amber-700/30 text-amber-300"
    : "bg-gray-800/50 border-gray-700/30 text-gray-400";

  return (
    <div className={`px-4 py-3 rounded-xl border ${color}`}>
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-sm">
          <svg
            className="h-4 w-4 flex-shrink-0"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span>
            {snapshot.sessionExpired
              ? "토스 세션 만료 - 마지막 정상 데이터 표시 중"
              : "실시간 데이터 가져오기 실패 - 캐시된 데이터 표시 중"}
          </span>
          <span className="text-xs opacity-60">
            ({new Date(snapshot.timestamp).toLocaleString("ko-KR")})
          </span>
        </div>
        {snapshot.sessionExpired && (
          <button
            onClick={handleLogin}
            disabled={loggingIn}
            className="px-3 py-1.5 bg-amber-700/40 hover:bg-amber-600/50 disabled:bg-gray-700/40 disabled:text-gray-500 text-amber-100 text-sm font-medium rounded-lg transition-all active:scale-95 flex items-center gap-2 whitespace-nowrap"
          >
            {loggingIn ? (
              <>
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                    fill="none"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
                로그인 대기 중...
              </>
            ) : (
              <>
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
                  <polyline points="10 17 15 12 10 7" />
                  <line x1="15" y1="12" x2="3" y2="12" />
                </svg>
                토스 로그인
              </>
            )}
          </button>
        )}
      </div>
      {loggingIn && (
        <p className="text-xs mt-2 opacity-75">
          서버에서 브라우저가 열립니다. QR 코드로 로그인을 완료해주세요.
        </p>
      )}
      {loginError && (
        <p className="text-xs mt-2 text-rose-400">오류: {loginError}</p>
      )}
    </div>
  );
}
