import { useSyncExternalStore } from "react";

// 마스킹 모드: 절대 금액·보유 수량·목표 설정값을 ••• 로 가림 (수익률·비중 %는 공개)
// 각 컴포넌트의 로컬 fmt()가 isMasked()를 읽고, useMasked()로 토글 시 리렌더를 구독한다.

const KEY = "maskAmounts";

let masked = (() => {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
})();

const subs = new Set<() => void>();

export const MASK = "***";

export function isMasked(): boolean {
  return masked;
}

export function toggleMasked(): void {
  masked = !masked;
  try {
    localStorage.setItem(KEY, masked ? "1" : "0");
  } catch {
    // localStorage 불가 환경 — 세션 내 토글만 유지
  }
  subs.forEach((f) => f());
}

export function useMasked(): boolean {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => masked
  );
}
