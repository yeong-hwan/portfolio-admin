# 퀀트 대시보드 + TQQQ 관리 설계 스펙

**날짜**: 2026-06-30  
**출처**: cassandra-ai (gameworkerkim/cassandra-ai) 기능 이식  
**대상**: portfolio-admin (React Vite + Express)

---

## 1. 개요

포트폴리오 어드민에 두 개의 새 탭을 추가한다.

- **퀀트 대시보드** (`/quant` 탭): SPY/QQQ/VIX 기반 미국 시장 국면 분류(ARDS-X) + NASDAQ 상하위 모버 + 보유 종목 모멘텀
- **TQQQ 관리** (`/tqqq` 탭): 매매 신호 + Williams Gauge + 5단계 트랜치 + DCA 시뮬레이터 + 투자 로그

cassandra-ai 대비 변경점:
| 항목 | cassandra-ai | 이 스펙 |
|---|---|---|
| 데이터 소스 | Naver Finance (코스닥) | Yahoo Finance (미국) |
| 퀀트 대상 지수 | KOSDAQ 종목 | SPY / QQQ / VIX |
| 캐시 | Upstash Redis | 인메모리 (기존 패턴) |
| 투자 로그 | Supabase | `data/tqqq-log.json` |
| 인증 | 이메일 체크 | 없음 (개인 어드민) |
| TQQQ 신호/UI 로직 | 원본 | 1:1 이식 |

---

## 2. 데이터 레이어 (서버)

### 2-1. `GET /api/quant`

**역할**: ARDS-X 국면 + 20일 히스토리 + NASDAQ 모버 반환  
**캐시**: 30분 인메모리

**처리 흐름**:
1. Yahoo Finance에서 SPY, QQQ, VIX 최근 60일 일봉 수집 (기존 `fetchYahoo` 재사용)
2. SPY RSI14, QQQ 20일 낙폭, VIX 종가로 국면 분류:

| 조건 | 국면 |
|---|---|
| SPY RSI < 35 또는 VIX > 30 | 0 — 하락 🔴 |
| RSI 35~50 또는 VIX 20~30 | 1 — 횡보 🟡 |
| RSI 50~65, VIX < 20 | 2 — 상승 🟣 |
| RSI > 65, VIX < 15 | 3 — 급등 🟢 |

3. 최근 20거래일 국면 히스토리 배열 반환
4. Yahoo Finance gainers/losers 스크리너로 NASDAQ 상위 10 + 하위 10 수집

**응답 형태**:
```ts
{
  regime: 0 | 1 | 2 | 3;
  regimeHistory: { date: string; regime: number }[];  // 20일
  spy: { rsi14: number; price: number; change1d: number };
  vix: { price: number };
  nasdaq: {
    gainers: { symbol: string; name: string; changePercent: number }[];
    losers:  { symbol: string; name: string; changePercent: number }[];
  };
  cachedAt: number;
}
```

---

### 2-2. `GET /api/tqqq`

**역할**: TQQQ·QQQ·TLT·IEF 지표 + 매매 신호 반환  
**캐시**: 30분 인메모리

**처리 흐름**:
1. Yahoo Finance에서 TQQQ, QQQ, TLT, IEF 최근 60일 일봉 수집
2. 각 종목별 계산:
   - RSI14
   - Williams %R (14일)
   - 20일 고점 대비 낙폭 (drawdown20d)
   - SMA50
3. TQQQ 신호 결정:

| 조건 | 신호 |
|---|---|
| Williams %R ≤ -85 또는 낙폭 ≤ -20% | STRONG_BUY |
| Williams %R ≤ -70 또는 낙폭 ≤ -12% | BUY |
| Williams %R ≤ -50 또는 낙폭 ≤ -8% | WATCH |
| RSI > 75 또는 Williams %R ≥ -10 | REDUCE |
| 그 외 | HOLD |

**응답 형태**:
```ts
{
  signal: 'STRONG_BUY' | 'BUY' | 'WATCH' | 'HOLD' | 'REDUCE';
  quotes: Record<'TQQQ'|'QQQ'|'TLT'|'IEF', {
    price: number; change1d: number;
    rsi14: number; williamsR: number;
    drawdown20d: number; sma50: number;
  }>;
  cachedAt: number;
}
```

---

### 2-3. `GET /api/tqqq/log`

`data/tqqq-log.json` 파일을 읽어 항목 배열 반환.  
파일 없으면 빈 배열 반환.

---

### 2-4. `POST /api/tqqq/log`

**바디**: `{ date: string; tranche: number; amountKrw: number; note: string }`  
id는 서버에서 `Date.now()`로 부여. 파일에 append 후 전체 배열 반환.

---

### 2-5. `DELETE /api/tqqq/log/:id`

id 일치 항목 제거 후 저장.

---

## 3. 프론트엔드

### 3-1. 사이드바 탭

`App.tsx`에 탭 2개 추가. 기존 탭 전환 패턴 그대로 사용.

```
[ 포트폴리오 ]    ← 기존
[ 퀀트 대시보드 ] ← 신규
[ TQQQ 관리 ]    ← 신규
```

---

### 3-2. `QuantDashboard.tsx`

**레이아웃**:
```
┌─────────────────────────────────────────────────┐
│  ARDS-X  [🟢 급등]   SPY RSI 67  VIX 14.2      │
│  20일 국면 히스토리 바 차트                      │
├─────────────────┬───────────────────────────────┤
│  NASDAQ 오늘    │  NASDAQ 이번 주                │
│  상위 10 / 하위 10                               │
├─────────────────┴───────────────────────────────┤
│  보유 종목 모멘텀 (RSI + 신호)                   │
└─────────────────────────────────────────────────┘
```

- 국면 색상: `{ 0: #ef4444, 1: #f59e0b, 2: #6c5ce7, 3: #22c55e }` (cassandra-ai 동일)
- 보유 종목 모멘텀: 현재 포지션 심볼로 Yahoo Finance RSI 계산 후 BUY/WATCH/HOLD 배지 표시

---

### 3-3. `TqqqManager.tsx`

**레이아웃**:
```
┌────────────┬────────────┬────────────┬──────────┐
│ TQQQ       │ QQQ        │ TLT        │ IEF      │
│ QuoteCard  │ QuoteCard  │ QuoteCard  │ QuoteCard│
│ + Williams │            │            │          │
│   Gauge    │            │            │          │
├────────────┴────────────┴────────────┴──────────┤
│  신호 배지 + DropMeter (5단계 트랜치)            │
├─────────────────────────────────────────────────┤
│  DCA 시뮬레이터                                  │
│  월 납입액 × 투자 기간 × 4개 시나리오 표         │
├─────────────────────────────────────────────────┤
│  투자 로그  [+ 추가]                             │
└─────────────────────────────────────────────────┘
```

---

### 3-4. 공용 컴포넌트

| 파일 | 출처 | 설명 |
|---|---|---|
| `WilliamsGauge.tsx` | cassandra-ai 1:1 | Williams %R 시각화 게이지 |
| `DropMeter.tsx` | cassandra-ai 1:1 | 낙폭별 5단계 트랜치 미터 |

---

### 3-5. DCA 시나리오 (cassandra-ai 1:1)

```ts
const DCA_SCENARIOS = [
  { label: 'QQQ (1x)',  cagr: 13, color: '#64748b' },
  { label: 'QLD (2x)',  cagr: 19, color: '#3b82f6' },
  { label: 'TQQQ (3x)', cagr: 24, color: '#22c55e' },
  { label: '혼합 DCA',  cagr: 17, color: '#a78bfa' },
];
// calcDCA(monthlyKrw, years, cagr) = monthlyKrw * ((1+r)^n - 1) / r
```

---

## 4. 파일 변경 목록

### 신규 생성
```
portfolio-admin/server/quant.ts          # ARDS-X + NASDAQ 모버 계산
portfolio-admin/server/tqqq-api.ts       # TQQQ 지표 + 신호 계산
portfolio-admin/src/components/QuantDashboard.tsx
portfolio-admin/src/components/TqqqManager.tsx
portfolio-admin/src/components/WilliamsGauge.tsx
portfolio-admin/src/components/DropMeter.tsx
portfolio-admin/data/tqqq-log.json       # 빈 배열로 초기화
```

### 수정
```
portfolio-admin/server/index.ts          # 5개 API 엔드포인트 추가
portfolio-admin/src/App.tsx              # 탭 2개 추가
portfolio-admin/server/toss-api/market.ts # RSI/Williams%R 계산 함수 export 추가
```

---

## 5. 캐시 전략

기존 `candlesResultCache` 패턴 동일하게 적용:

```ts
let quantCache: { data: unknown; at: number } | null = null;
let tqqqCache:  { data: unknown; at: number } | null = null;
const CACHE_TTL = 30 * 60 * 1000; // 30분
```

---

## 6. 에러 처리

- Yahoo Finance 실패 시 `{ error: string }` 반환, 프론트에서 "데이터 로드 실패" 표시
- `tqqq-log.json` 없으면 자동 생성
- 캐시 만료 전 요청은 stale 데이터 그대로 반환 (로딩 없이)
