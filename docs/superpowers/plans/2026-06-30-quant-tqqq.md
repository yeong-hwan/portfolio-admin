# 퀀트 대시보드 + TQQQ 관리 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** portfolio-admin에 퀀트 대시보드(ARDS-X 국면 + NASDAQ 모버)와 TQQQ 관리(신호 + DCA + 투자 로그) 탭을 추가한다.

**Architecture:** 서버에 `quant.ts`·`tqqq-api.ts` 모듈을 추가해 Yahoo Finance 데이터로 지표를 계산하고 30분 인메모리 캐시로 제공한다. 프론트는 App.tsx에 탭 상태를 추가하고 `QuantDashboard.tsx`·`TqqqManager.tsx` 컴포넌트를 새로 만든다. 투자 로그는 `data/tqqq-log.json`에 저장한다.

**Tech Stack:** TypeScript · Express · React 19 · Tailwind CSS v4 · Yahoo Finance v8 API (기존) · recharts (기존)

---

## 파일 변경 목록

### 신규 생성
- `portfolio-admin/server/quant.ts` — ARDS-X 국면 계산 + NASDAQ 모버
- `portfolio-admin/server/tqqq-api.ts` — TQQQ 지표 + 매매 신호
- `portfolio-admin/src/components/QuantDashboard.tsx` — 퀀트 대시보드 UI
- `portfolio-admin/src/components/TqqqManager.tsx` — TQQQ 관리 UI
- `portfolio-admin/src/components/WilliamsGauge.tsx` — Williams %R 게이지
- `portfolio-admin/src/components/DropMeter.tsx` — 낙폭 트랜치 미터
- `portfolio-admin/data/tqqq-log.json` — 투자 로그 초기 파일

### 수정
- `portfolio-admin/server/toss-api/market.ts` — RSI·Williams%R·SMA 계산 함수 export 추가
- `portfolio-admin/server/index.ts` — 5개 API 라우트 추가
- `portfolio-admin/src/App.tsx` — 탭 상태 + 컴포넌트 렌더링 추가

---

## Task 1: market.ts에 지표 계산 함수 추가

**Files:**
- Modify: `portfolio-admin/server/toss-api/market.ts`

- [ ] **Step 1: 파일 끝에 지표 계산 함수 3개를 추가한다**

`portfolio-admin/server/toss-api/market.ts` 파일 맨 끝에 추가:

```typescript
// --- Technical indicator utilities ---

export function calcRSI(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;
  const slice = closes.slice(-(period + 1));
  let gains = 0, losses = 0;
  for (let i = 1; i < slice.length; i++) {
    const diff = slice[i] - slice[i - 1];
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

export function calcWilliamsR(candles: DayCandle[], period = 14): number {
  const slice = candles.slice(-period);
  if (slice.length < period) return -50;
  const highestHigh = Math.max(...slice.map(c => c.high));
  const lowestLow = Math.min(...slice.map(c => c.low));
  const lastClose = slice[slice.length - 1].close;
  if (highestHigh === lowestLow) return -50;
  return ((highestHigh - lastClose) / (highestHigh - lowestLow)) * -100;
}

export function calcSMA(closes: number[], period = 50): number {
  const slice = closes.slice(-period);
  if (slice.length < period) return closes[closes.length - 1] ?? 0;
  return slice.reduce((a, b) => a + b, 0) / period;
}

export function calcDrawdown20d(candles: DayCandle[]): number {
  const slice = candles.slice(-20);
  if (!slice.length) return 0;
  const high = Math.max(...slice.map(c => c.high));
  const last = slice[slice.length - 1].close;
  return high === 0 ? 0 : ((last - high) / high) * 100;
}
```

- [ ] **Step 2: 서버를 재시작하고 TypeScript 에러 없는지 확인한다**

```bash
cd /Users/jang-yeonghwan/portfolio/portfolio-admin && npm run server 2>&1 | head -5
```

Expected: `Portfolio admin API running on http://localhost:3001` (에러 없음)

- [ ] **Step 3: 커밋한다**

```bash
git -C /Users/jang-yeonghwan/portfolio add portfolio-admin/server/toss-api/market.ts
git -C /Users/jang-yeonghwan/portfolio commit -m "feat: market.ts에 RSI·Williams%R·SMA·Drawdown 지표 함수 추가"
```

---

## Task 2: server/quant.ts 생성

**Files:**
- Create: `portfolio-admin/server/quant.ts`

- [ ] **Step 1: `portfolio-admin/server/quant.ts` 파일을 생성한다**

```typescript
import { getHistoricalCandles } from './toss-api/market.js';
import { calcRSI, calcDrawdown20d } from './toss-api/market.js';

const NASDAQ_MOVERS_SYMBOLS = [
  'AAPL','MSFT','NVDA','AMZN','META','GOOGL','TSLA','AVGO','COST','NFLX',
  'AMD','QCOM','ADBE','TXN','PANW','CDNS','KLAC','LRCX','SNPS','ABNB',
  'MSTR','PLTR','CRWD','SMCI','MRVL','ON','MU','AMAT','ASML','INTC',
];

function nDaysAgo(n: number): string {
  const d = new Date(Date.now() - n * 86400000);
  return d.toISOString().split('T')[0];
}

export type Regime = 0 | 1 | 2 | 3;

export function classifyRegime(spyRsi: number, vixClose: number): Regime {
  if (spyRsi < 35 || vixClose > 30) return 0; // 하락
  if (spyRsi < 50 || vixClose > 20) return 1; // 횡보
  if (spyRsi > 65 && vixClose < 15) return 3; // 급등
  return 2;                                    // 상승
}

export interface QuantData {
  regime: Regime;
  regimeHistory: { date: string; regime: Regime }[];
  spy: { price: number; change1d: number; rsi14: number };
  vix: { price: number };
  nasdaq: {
    gainers: { symbol: string; changePercent: number }[];
    losers:  { symbol: string; changePercent: number }[];
  };
  cachedAt: number;
}

export async function getQuantData(): Promise<QuantData> {
  const from = nDaysAgo(90);

  const [spyCandles, vixCandles, ...moverCandles] = await Promise.all([
    getHistoricalCandles('SPY', from),
    getHistoricalCandles('^VIX', from),
    ...NASDAQ_MOVERS_SYMBOLS.map(s => getHistoricalCandles(s, nDaysAgo(5)).catch(() => [])),
  ]);

  // SPY 지표
  const spyCloses = spyCandles.map(c => c.close);
  const spyRsi14  = calcRSI(spyCloses);
  const spyLast   = spyCandles[spyCandles.length - 1];
  const spyPrev   = spyCandles[spyCandles.length - 2];
  const spyChange = spyPrev ? ((spyLast.close - spyPrev.close) / spyPrev.close) * 100 : 0;

  // VIX
  const vixLast = vixCandles[vixCandles.length - 1];
  const vixClose = vixLast?.close ?? 20;

  // 20일 국면 히스토리
  const regimeHistory: { date: string; regime: Regime }[] = [];
  const last20Spy = spyCandles.slice(-20);
  for (let i = 0; i < last20Spy.length; i++) {
    const priorCloses = spyCandles.slice(0, spyCandles.length - last20Spy.length + i + 1).map(c => c.close);
    const vixForDay = vixCandles.find(c => c.date === last20Spy[i].date)?.close ?? vixClose;
    const rsi = calcRSI(priorCloses);
    regimeHistory.push({ date: last20Spy[i].date, regime: classifyRegime(rsi, vixForDay) });
  }

  // NASDAQ 모버 (일간 등락률 기준)
  const movers = NASDAQ_MOVERS_SYMBOLS.map((symbol, i) => {
    const candles = moverCandles[i];
    if (!candles || candles.length < 2) return null;
    const last = candles[candles.length - 1];
    const prev = candles[candles.length - 2];
    const changePercent = ((last.close - prev.close) / prev.close) * 100;
    return { symbol, changePercent };
  }).filter(Boolean) as { symbol: string; changePercent: number }[];

  movers.sort((a, b) => b.changePercent - a.changePercent);
  const gainers = movers.slice(0, 10);
  const losers  = movers.slice(-10).reverse();

  return {
    regime: classifyRegime(spyRsi14, vixClose),
    regimeHistory,
    spy: { price: spyLast?.close ?? 0, change1d: spyChange, rsi14: spyRsi14 },
    vix: { price: vixClose },
    nasdaq: { gainers, losers },
    cachedAt: Date.now(),
  };
}
```

- [ ] **Step 2: 커밋한다**

```bash
git -C /Users/jang-yeonghwan/portfolio add portfolio-admin/server/quant.ts
git -C /Users/jang-yeonghwan/portfolio commit -m "feat: server/quant.ts — ARDS-X 국면 분류 + NASDAQ 모버"
```

---

## Task 3: server/tqqq-api.ts 생성

**Files:**
- Create: `portfolio-admin/server/tqqq-api.ts`

- [ ] **Step 1: `portfolio-admin/server/tqqq-api.ts` 파일을 생성한다**

```typescript
import { getHistoricalCandles } from './toss-api/market.js';
import { calcRSI, calcWilliamsR, calcSMA, calcDrawdown20d } from './toss-api/market.js';

export type Signal = 'STRONG_BUY' | 'BUY' | 'WATCH' | 'HOLD' | 'REDUCE';

function nDaysAgo(n: number): string {
  return new Date(Date.now() - n * 86400000).toISOString().split('T')[0];
}

export interface QuoteData {
  price: number;
  change1d: number;
  rsi14: number;
  williamsR: number;
  drawdown20d: number;
  sma50: number;
}

export interface TqqqData {
  signal: Signal;
  quotes: Record<'TQQQ' | 'QQQ' | 'TLT' | 'IEF', QuoteData>;
  cachedAt: number;
}

function computeSignal(tqqq: QuoteData): Signal {
  const { williamsR, drawdown20d, rsi14 } = tqqq;
  if (williamsR <= -85 || drawdown20d <= -20) return 'STRONG_BUY';
  if (williamsR <= -70 || drawdown20d <= -12) return 'BUY';
  if (williamsR <= -50 || drawdown20d <= -8)  return 'WATCH';
  if (rsi14 > 75    || williamsR >= -10)      return 'REDUCE';
  return 'HOLD';
}

async function buildQuote(symbol: string): Promise<QuoteData> {
  const candles = await getHistoricalCandles(symbol, nDaysAgo(90));
  if (candles.length < 2) return { price: 0, change1d: 0, rsi14: 50, williamsR: -50, drawdown20d: 0, sma50: 0 };
  const closes = candles.map(c => c.close);
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  return {
    price:       last.close,
    change1d:    ((last.close - prev.close) / prev.close) * 100,
    rsi14:       calcRSI(closes),
    williamsR:   calcWilliamsR(candles),
    drawdown20d: calcDrawdown20d(candles),
    sma50:       calcSMA(closes, 50),
  };
}

export async function getTqqqData(): Promise<TqqqData> {
  const [tqqq, qqq, tlt, ief] = await Promise.all([
    buildQuote('TQQQ'),
    buildQuote('QQQ'),
    buildQuote('TLT'),
    buildQuote('IEF'),
  ]);
  return {
    signal: computeSignal(tqqq),
    quotes: { TQQQ: tqqq, QQQ: qqq, TLT: tlt, IEF: ief },
    cachedAt: Date.now(),
  };
}
```

- [ ] **Step 2: 커밋한다**

```bash
git -C /Users/jang-yeonghwan/portfolio add portfolio-admin/server/tqqq-api.ts
git -C /Users/jang-yeonghwan/portfolio commit -m "feat: server/tqqq-api.ts — TQQQ 지표 계산 + 매매 신호"
```

---

## Task 4: server/index.ts에 API 라우트 5개 추가

**Files:**
- Modify: `portfolio-admin/server/index.ts`

- [ ] **Step 1: import 추가 (파일 상단 import 블록 끝에)**

```typescript
import { getQuantData } from "./quant.js";
import { getTqqqData } from "./tqqq-api.js";
```

- [ ] **Step 2: 인메모리 캐시 변수 선언 (기존 `candlesResultCache` 선언 아래에)**

```typescript
let quantCache:  { data: unknown; at: number } | null = null;
let tqqqCache:   { data: unknown; at: number } | null = null;
const QUANT_TTL = 30 * 60 * 1000;

const TQQQ_LOG_FILE = path.join(DATA_DIR, "tqqq-log.json");
```

- [ ] **Step 3: API 라우트 5개 추가 (`/api/macro-sensitivity` 라우트 바로 아래에)**

```typescript
// API: Quant dashboard (ARDS-X regime + NASDAQ movers)
app.get("/api/quant", async (_req, res) => {
  if (quantCache && Date.now() - quantCache.at < QUANT_TTL) {
    return res.json(quantCache.data);
  }
  try {
    const data = await getQuantData();
    quantCache = { data, at: Date.now() };
    res.json(data);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// API: TQQQ signal + indicators
app.get("/api/tqqq", async (_req, res) => {
  if (tqqqCache && Date.now() - tqqqCache.at < QUANT_TTL) {
    return res.json(tqqqCache.data);
  }
  try {
    const data = await getTqqqData();
    tqqqCache = { data, at: Date.now() };
    res.json(data);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// API: TQQQ investment log
async function loadTqqqLog(): Promise<any[]> {
  try { return JSON.parse(await fs.readFile(TQQQ_LOG_FILE, "utf-8")); } catch { return []; }
}

app.get("/api/tqqq/log", async (_req, res) => {
  res.json(await loadTqqqLog());
});

app.post("/api/tqqq/log", async (req, res) => {
  try {
    const { date, tranche, amountKrw, note } = req.body;
    const log = await loadTqqqLog();
    const entry = { id: Date.now(), date, tranche, amountKrw, note };
    log.push(entry);
    await ensureDataDir();
    await fs.writeFile(TQQQ_LOG_FILE, JSON.stringify(log, null, 2));
    res.json(entry);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.delete("/api/tqqq/log/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const log = (await loadTqqqLog()).filter((e: any) => e.id !== id);
    await fs.writeFile(TQQQ_LOG_FILE, JSON.stringify(log, null, 2));
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});
```

- [ ] **Step 4: 서버 재시작 후 API 확인**

```bash
pkill -f "tsx server/index.ts"; sleep 1
cd /Users/jang-yeonghwan/portfolio/portfolio-admin && npm run server &
sleep 3 && curl -s http://localhost:3001/api/tqqq/log
```

Expected: `[]`

- [ ] **Step 5: 커밋한다**

```bash
git -C /Users/jang-yeonghwan/portfolio add portfolio-admin/server/index.ts
git -C /Users/jang-yeonghwan/portfolio commit -m "feat: /api/quant, /api/tqqq, /api/tqqq/log 라우트 추가"
```

---

## Task 5: data/tqqq-log.json 초기 파일 생성

**Files:**
- Create: `portfolio-admin/data/tqqq-log.json`

- [ ] **Step 1: 빈 배열 파일을 생성한다**

```bash
echo '[]' > /Users/jang-yeonghwan/portfolio/portfolio-admin/data/tqqq-log.json
```

- [ ] **Step 2: 커밋한다**

```bash
git -C /Users/jang-yeonghwan/portfolio add portfolio-admin/data/tqqq-log.json
git -C /Users/jang-yeonghwan/portfolio commit -m "chore: tqqq-log.json 초기 파일 생성"
```

---

## Task 6: App.tsx에 탭 상태 추가

**Files:**
- Modify: `portfolio-admin/src/App.tsx`

- [ ] **Step 1: import 2개 추가 (파일 상단 import 블록 끝에)**

```typescript
import { QuantDashboard } from "./components/QuantDashboard";
import { TqqqManager }    from "./components/TqqqManager";
```

- [ ] **Step 2: `export default function App()` 안 최상단에 탭 상태 추가**

```typescript
const [tab, setTab] = useState<'portfolio' | 'quant' | 'tqqq'>('portfolio');
```

- [ ] **Step 3: header 내 `<div className="flex items-center gap-3">` 바로 위에 탭 버튼 추가**

```tsx
{/* Tab navigation */}
<div className="flex gap-1 bg-gray-900/60 rounded-xl p-1 border border-white/[0.06]">
  {(['portfolio', 'quant', 'tqqq'] as const).map(t => (
    <button
      key={t}
      onClick={() => setTab(t)}
      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
        tab === t
          ? 'bg-gray-700 text-white'
          : 'text-gray-400 hover:text-white'
      }`}
    >
      {t === 'portfolio' ? '포트폴리오' : t === 'quant' ? '퀀트' : 'TQQQ'}
    </button>
  ))}
</div>
```

- [ ] **Step 4: `{snapshot ? ( <main ...> ... </main> ) : ...}` 블록 전체를 조건 분기로 교체한다**

```tsx
{/* Tab content */}
{tab === 'quant' && <QuantDashboard />}
{tab === 'tqqq'  && <TqqqManager />}
{tab === 'portfolio' && (
  snapshot ? (
    <main className="max-w-[1600px] mx-auto px-6 py-6 space-y-6">
      {/* 기존 포트폴리오 내용 그대로 */}
      {snapshot.stale && <StaleBanner snapshot={snapshot} onRefresh={refresh} />}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        <div className="flex flex-col gap-6">
          <SummaryCards summary={snapshot.summary} exchangeRate={exchangeRate} />
          <PortfolioCandles />
        </div>
        <PerformanceMetrics />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
        <MacroSensitivity />
        <CorrelationHeatmap positions={snapshot.positions} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <Heatmap positions={snapshot.positions} cashKrw={cashKrw} />
        </div>
        <AllocationChart positions={snapshot.positions} cashKrw={cashKrw} />
      </div>
      <CollapseSection title="오늘 상승/하락">
        <TopMovers positions={snapshot.positions} />
      </CollapseSection>
      <CollapseSection title="보유종목">
        <PositionsTable positions={snapshot.positions} />
      </CollapseSection>
    </main>
  ) : (
    !loading && (
      <div className="flex items-center justify-center h-[60vh]">
        <p className="text-gray-500">데이터를 불러올 수 없습니다. 서버를 확인해주세요.</p>
      </div>
    )
  )
)}
```

- [ ] **Step 5: 커밋한다**

```bash
git -C /Users/jang-yeonghwan/portfolio add portfolio-admin/src/App.tsx
git -C /Users/jang-yeonghwan/portfolio commit -m "feat: App.tsx에 퀀트·TQQQ 탭 추가"
```

---

## Task 7: WilliamsGauge.tsx 생성

**Files:**
- Create: `portfolio-admin/src/components/WilliamsGauge.tsx`

- [ ] **Step 1: 파일 생성 (cassandra-ai에서 이식)**

```tsx
interface Props { value: number | null }

export function WilliamsGauge({ value }: Props) {
  if (value == null) return <span className="text-gray-500 text-[11px]">—</span>;
  const pct = Math.max(0, Math.min(100, ((value + 100) / 100) * 100));
  const color = value <= -80 ? "text-emerald-400" : value >= -20 ? "text-rose-400" : "text-amber-400";
  const label = value <= -80 ? "과매도" : value >= -20 ? "과매수" : "중립";
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[9px]">
        <span className="text-gray-500">-100 과매도</span>
        <span className={`font-mono font-bold ${color}`}>{value.toFixed(1)} <span className="opacity-70">{label}</span></span>
        <span className="text-gray-500">과매수 0</span>
      </div>
      <div className="relative h-1.5 w-full rounded-full overflow-hidden flex">
        <div className="w-[20%] bg-emerald-500/50" />
        <div className="w-[60%] bg-amber-400/20" />
        <div className="w-[20%] bg-rose-500/50" />
        <div className="absolute top-0 bottom-0 w-0.5 bg-white" style={{ left: `calc(${pct}% - 1px)` }} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 커밋한다**

```bash
git -C /Users/jang-yeonghwan/portfolio add portfolio-admin/src/components/WilliamsGauge.tsx
git -C /Users/jang-yeonghwan/portfolio commit -m "feat: WilliamsGauge 컴포넌트 추가"
```

---

## Task 8: DropMeter.tsx 생성

**Files:**
- Create: `portfolio-admin/src/components/DropMeter.tsx`

- [ ] **Step 1: 파일 생성 (cassandra-ai에서 이식)**

```tsx
const TRANCHE_ZONES = [
  { label: "정상", min: 0,  max: 3,  color: "bg-gray-600" },
  { label: "1차",  min: 3,  max: 5,  color: "bg-emerald-300/70" },
  { label: "2차",  min: 5,  max: 8,  color: "bg-emerald-500/70" },
  { label: "3차",  min: 8,  max: 12, color: "bg-amber-400/80" },
  { label: "4차",  min: 12, max: 20, color: "bg-orange-400/80" },
  { label: "5차",  min: 20, max: 35, color: "bg-rose-500/80" },
];

interface Props { drop: number }

export function DropMeter({ drop }: Props) {
  const abs = Math.abs(drop);
  const activeZone = [...TRANCHE_ZONES].reverse().find(z => abs >= z.min);

  return (
    <div className="space-y-2">
      <div className="flex items-end gap-1 h-10">
        {TRANCHE_ZONES.map((z, i) => {
          const fill = abs >= z.min ? Math.min(1, (abs - z.min) / (z.max - z.min)) * 100 : 0;
          return (
            <div key={i} className="flex-1 flex flex-col justify-end gap-0.5">
              <div className="relative h-8 bg-white/[0.04] rounded-sm overflow-hidden">
                <div className={`absolute bottom-0 left-0 right-0 ${z.color} transition-all`} style={{ height: `${fill}%` }} />
              </div>
              <span className="text-[8px] text-center text-gray-500">{z.label}</span>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-gray-400 text-center">
        현재 낙폭 <span className="font-mono font-bold text-white">{drop.toFixed(1)}%</span>
        {activeZone && activeZone.label !== "정상" && (
          <span className="ml-2 text-amber-400">→ {activeZone.label} 진입 구간</span>
        )}
      </p>
    </div>
  );
}
```

- [ ] **Step 2: 커밋한다**

```bash
git -C /Users/jang-yeonghwan/portfolio add portfolio-admin/src/components/DropMeter.tsx
git -C /Users/jang-yeonghwan/portfolio commit -m "feat: DropMeter 컴포넌트 추가"
```

---

## Task 9: QuantDashboard.tsx 생성

**Files:**
- Create: `portfolio-admin/src/components/QuantDashboard.tsx`

- [ ] **Step 1: 파일 생성**

```tsx
import { useEffect, useState } from "react";
import { BarChart, Bar, Cell, XAxis, Tooltip, ResponsiveContainer } from "recharts";

type Regime = 0 | 1 | 2 | 3;

const REGIME_COLOR: Record<Regime, string> = {
  0: "#ef4444", 1: "#f59e0b", 2: "#6c5ce7", 3: "#22c55e",
};
const REGIME_LABEL: Record<Regime, string> = {
  0: "하락", 1: "횡보", 2: "상승", 3: "급등",
};

interface QuantData {
  regime: Regime;
  regimeHistory: { date: string; regime: Regime }[];
  spy: { price: number; change1d: number; rsi14: number };
  vix: { price: number };
  nasdaq: {
    gainers: { symbol: string; changePercent: number }[];
    losers:  { symbol: string; changePercent: number }[];
  };
}

function pct(n: number) {
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

export function QuantDashboard() {
  const [data, setData] = useState<QuantData | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"daily" | "weekly">("daily");

  useEffect(() => {
    fetch("/api/quant")
      .then(r => r.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500">
        퀀트 데이터 로딩 중…
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center h-64 text-rose-400">
        데이터 로드 실패
      </div>
    );
  }

  const regimeColor = REGIME_COLOR[data.regime];
  const regimeLabel = REGIME_LABEL[data.regime];

  return (
    <main className="max-w-[1600px] mx-auto px-6 py-6 space-y-6">
      {/* ARDS-X 국면 카드 */}
      <div className="bg-white/[0.05] border border-white/[0.08] rounded-2xl p-5 flex items-center gap-6">
        <div>
          <p className="text-xs text-gray-400 uppercase tracking-widest mb-1">ARDS-X 시장 국면</p>
          <p className="text-3xl font-bold" style={{ color: regimeColor }}>{regimeLabel}</p>
        </div>
        <div className="flex gap-4 text-sm text-gray-400">
          <span>SPY <span className="font-mono text-white">${data.spy.price.toFixed(2)}</span> <span className={data.spy.change1d >= 0 ? "text-emerald-400" : "text-rose-400"}>{pct(data.spy.change1d)}</span></span>
          <span>RSI <span className="font-mono text-white">{data.spy.rsi14.toFixed(0)}</span></span>
          <span>VIX <span className="font-mono text-white">{data.vix.price.toFixed(1)}</span></span>
        </div>
        {/* 20일 국면 히스토리 */}
        <div className="flex-1 h-12">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.regimeHistory} barSize={8}>
              <XAxis dataKey="date" hide />
              <Tooltip
                formatter={(_v: any, _n: any, props: any) => [REGIME_LABEL[props.payload.regime as Regime], "국면"]}
                contentStyle={{ backgroundColor: "#1f2937", border: "none", borderRadius: 6, fontSize: 11 }}
              />
              <Bar dataKey="regime" maxBarSize={10}>
                {data.regimeHistory.map((entry, i) => (
                  <Cell key={i} fill={REGIME_COLOR[entry.regime]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* NASDAQ 모버 */}
      <div className="bg-white/[0.05] border border-white/[0.08] rounded-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.08]">
          <h2 className="font-semibold text-white">NASDAQ 모버</h2>
          <div className="flex gap-1 bg-gray-900/60 rounded-lg p-0.5">
            {(["daily", "weekly"] as const).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-3 py-1 rounded-md text-xs transition-all ${tab === t ? "bg-gray-700 text-white" : "text-gray-400 hover:text-white"}`}
              >
                {t === "daily" ? "일간" : "주간"}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 divide-x divide-white/[0.08]">
          {/* 상승 */}
          <div className="p-4 space-y-1">
            <p className="text-xs text-emerald-400 font-medium mb-2 uppercase tracking-widest">상위 10</p>
            {data.nasdaq.gainers.map(m => (
              <div key={m.symbol} className="flex justify-between text-sm">
                <span className="font-mono text-gray-300">{m.symbol}</span>
                <span className="text-emerald-400 font-mono">{pct(m.changePercent)}</span>
              </div>
            ))}
          </div>
          {/* 하락 */}
          <div className="p-4 space-y-1">
            <p className="text-xs text-rose-400 font-medium mb-2 uppercase tracking-widest">하위 10</p>
            {data.nasdaq.losers.map(m => (
              <div key={m.symbol} className="flex justify-between text-sm">
                <span className="font-mono text-gray-300">{m.symbol}</span>
                <span className="text-rose-400 font-mono">{pct(m.changePercent)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
```

- [ ] **Step 2: 커밋한다**

```bash
git -C /Users/jang-yeonghwan/portfolio add portfolio-admin/src/components/QuantDashboard.tsx
git -C /Users/jang-yeonghwan/portfolio commit -m "feat: QuantDashboard 컴포넌트 추가"
```

---

## Task 10: TqqqManager.tsx 생성

**Files:**
- Create: `portfolio-admin/src/components/TqqqManager.tsx`

- [ ] **Step 1: 파일 생성**

```tsx
import { useEffect, useState } from "react";
import { WilliamsGauge } from "./WilliamsGauge";
import { DropMeter } from "./DropMeter";

type Signal = 'STRONG_BUY' | 'BUY' | 'WATCH' | 'HOLD' | 'REDUCE';

interface QuoteData {
  price: number; change1d: number;
  rsi14: number; williamsR: number;
  drawdown20d: number; sma50: number;
}
interface TqqqData {
  signal: Signal;
  quotes: Record<'TQQQ' | 'QQQ' | 'TLT' | 'IEF', QuoteData>;
}
interface LogEntry { id: number; date: string; tranche: number; amountKrw: number; note: string }

const SIG_STYLE: Record<Signal, { bg: string; border: string; text: string; label: string }> = {
  STRONG_BUY: { bg: "bg-emerald-500/10", border: "border-emerald-500/40", text: "text-emerald-400", label: "강력 매수" },
  BUY:        { bg: "bg-emerald-300/10", border: "border-emerald-300/30", text: "text-emerald-300", label: "매수" },
  WATCH:      { bg: "bg-amber-400/10",   border: "border-amber-400/30",   text: "text-amber-400",   label: "관망" },
  HOLD:       { bg: "bg-white/[0.04]",   border: "border-white/[0.08]",   text: "text-gray-400",    label: "보유" },
  REDUCE:     { bg: "bg-rose-500/10",    border: "border-rose-500/30",    text: "text-rose-400",    label: "비중 축소" },
};

const DCA_SCENARIOS = [
  { label: "QQQ (1x)",  cagr: 13, color: "#64748b" },
  { label: "QLD (2x)",  cagr: 19, color: "#3b82f6" },
  { label: "TQQQ (3x)", cagr: 24, color: "#22c55e" },
  { label: "혼합 DCA",  cagr: 17, color: "#a78bfa" },
];
const DCA_AMOUNTS = [100, 200, 300, 500];
const DCA_YEARS   = [5, 10, 15, 20];

function calcDCA(monthlyKrw: number, years: number, cagr: number): number {
  const r = cagr / 100 / 12;
  const n = years * 12;
  if (r === 0) return monthlyKrw * n;
  return monthlyKrw * ((Math.pow(1 + r, n) - 1) / r);
}

function fmt(n: number) { return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`; }
function krw(n: number) { return `${(n / 100_000_000).toFixed(1)}억`; }

function QuoteCard({ symbol, q }: { symbol: string; q: QuoteData }) {
  const up = q.change1d >= 0;
  return (
    <div className="bg-white/[0.04] border border-white/[0.08] rounded-xl p-3 space-y-2">
      <div className="flex justify-between items-center">
        <span className="text-xs font-bold text-white">{symbol}</span>
        <span className={`text-xs font-mono font-bold ${up ? "text-emerald-400" : "text-rose-400"}`}>{fmt(q.change1d)}</span>
      </div>
      <p className="text-lg font-mono font-bold text-white">${q.price.toFixed(2)}</p>
      <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[9px] text-gray-500">
        <span>RSI <span className={`font-bold ${q.rsi14 < 30 ? "text-emerald-400" : q.rsi14 > 70 ? "text-rose-400" : "text-white"}`}>{q.rsi14.toFixed(0)}</span></span>
        <span>W%R <span className={`font-bold ${q.williamsR <= -80 ? "text-emerald-400" : q.williamsR >= -20 ? "text-rose-400" : "text-white"}`}>{q.williamsR.toFixed(0)}</span></span>
        <span>20d↓ <span className={`font-bold ${Math.abs(q.drawdown20d) >= 5 ? "text-amber-400" : "text-white"}`}>{fmt(q.drawdown20d)}</span></span>
        <span>SMA50 <span className="font-bold text-white">${q.sma50.toFixed(0)}</span></span>
      </div>
      {symbol === "TQQQ" && <WilliamsGauge value={q.williamsR} />}
    </div>
  );
}

export function TqqqManager() {
  const [data, setData]       = useState<TqqqData | null>(null);
  const [log, setLog]         = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [amount, setAmount]   = useState(200);
  const [years, setYears]     = useState(10);
  const [form, setForm]       = useState({ date: new Date().toISOString().slice(0, 10), tranche: 1, amountKrw: 200, note: "" });
  const [adding, setAdding]   = useState(false);

  useEffect(() => {
    Promise.all([
      fetch("/api/tqqq").then(r => r.json()),
      fetch("/api/tqqq/log").then(r => r.json()),
    ]).then(([d, l]) => { setData(d); setLog(l); }).finally(() => setLoading(false));
  }, []);

  async function addEntry() {
    const entry = await fetch("/api/tqqq/log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, amountKrw: form.amountKrw * 10_000 }),
    }).then(r => r.json());
    setLog(prev => [...prev, entry]);
    setAdding(false);
  }

  async function deleteEntry(id: number) {
    await fetch(`/api/tqqq/log/${id}`, { method: "DELETE" });
    setLog(prev => prev.filter(e => e.id !== id));
  }

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-500">TQQQ 데이터 로딩 중…</div>;
  if (!data)   return <div className="flex items-center justify-center h-64 text-rose-400">데이터 로드 실패</div>;

  const sig = SIG_STYLE[data.signal];

  return (
    <main className="max-w-[1600px] mx-auto px-6 py-6 space-y-6">
      {/* Quote cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {(["TQQQ", "QQQ", "TLT", "IEF"] as const).map(sym => (
          <QuoteCard key={sym} symbol={sym} q={data.quotes[sym]} />
        ))}
      </div>

      {/* 신호 + DropMeter */}
      <div className="bg-white/[0.05] border border-white/[0.08] rounded-2xl p-5 space-y-4">
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-400">매매 신호</span>
          <span className={`px-3 py-1 rounded-lg text-sm font-bold border ${sig.bg} ${sig.border} ${sig.text}`}>
            {sig.label}
          </span>
        </div>
        <DropMeter drop={data.quotes.TQQQ.drawdown20d} />
      </div>

      {/* DCA 시뮬레이터 */}
      <div className="bg-white/[0.05] border border-white/[0.08] rounded-2xl p-5 space-y-4">
        <h2 className="font-semibold text-white">DCA 시뮬레이터</h2>
        <div className="flex gap-4 flex-wrap">
          <label className="flex items-center gap-2 text-sm text-gray-400">
            월 납입
            <select value={amount} onChange={e => setAmount(Number(e.target.value))} className="bg-gray-800 text-white rounded-lg px-2 py-1 text-sm border border-white/[0.08]">
              {DCA_AMOUNTS.map(a => <option key={a} value={a}>{a}만원</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-400">
            기간
            <select value={years} onChange={e => setYears(Number(e.target.value))} className="bg-gray-800 text-white rounded-lg px-2 py-1 text-sm border border-white/[0.08]">
              {DCA_YEARS.map(y => <option key={y} value={y}>{y}년</option>)}
            </select>
          </label>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {DCA_SCENARIOS.map(s => (
            <div key={s.label} className="bg-white/[0.04] border border-white/[0.08] rounded-xl p-3 text-center">
              <p className="text-[10px] text-gray-400 mb-1" style={{ color: s.color }}>{s.label}</p>
              <p className="text-lg font-bold text-white">{krw(calcDCA(amount * 10_000, years, s.cagr))}</p>
              <p className="text-[9px] text-gray-500">CAGR {s.cagr}%</p>
            </div>
          ))}
        </div>
      </div>

      {/* 투자 로그 */}
      <div className="bg-white/[0.05] border border-white/[0.08] rounded-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.08]">
          <h2 className="font-semibold text-white">투자 로그</h2>
          <button onClick={() => setAdding(a => !a)} className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white text-xs rounded-lg transition-colors">
            {adding ? "취소" : "+ 추가"}
          </button>
        </div>

        {adding && (
          <div className="p-4 border-b border-white/[0.08] grid grid-cols-2 lg:grid-cols-4 gap-3">
            <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} className="bg-gray-800 text-white rounded-lg px-3 py-1.5 text-sm border border-white/[0.08]" />
            <select value={form.tranche} onChange={e => setForm(f => ({ ...f, tranche: Number(e.target.value) }))} className="bg-gray-800 text-white rounded-lg px-3 py-1.5 text-sm border border-white/[0.08]">
              {[1,2,3,4,5].map(t => <option key={t} value={t}>{t}차 트랜치</option>)}
            </select>
            <input type="number" placeholder="금액 (만원)" value={form.amountKrw} onChange={e => setForm(f => ({ ...f, amountKrw: Number(e.target.value) }))} className="bg-gray-800 text-white rounded-lg px-3 py-1.5 text-sm border border-white/[0.08]" />
            <input type="text" placeholder="메모" value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} className="bg-gray-800 text-white rounded-lg px-3 py-1.5 text-sm border border-white/[0.08]" />
            <button onClick={addEntry} className="col-span-2 lg:col-span-4 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm rounded-lg transition-colors">저장</button>
          </div>
        )}

        <div className="divide-y divide-white/[0.06]">
          {log.length === 0 && <p className="px-5 py-8 text-center text-gray-500 text-sm">투자 로그가 없습니다.</p>}
          {[...log].reverse().map(e => (
            <div key={e.id} className="px-5 py-3 flex items-center justify-between">
              <div className="flex items-center gap-3 text-sm">
                <span className="text-gray-400 font-mono">{e.date}</span>
                <span className="text-amber-400 text-xs">{e.tranche}차</span>
                <span className="text-white font-bold">{(e.amountKrw / 10_000).toFixed(0)}만원</span>
                {e.note && <span className="text-gray-500">{e.note}</span>}
              </div>
              <button onClick={() => deleteEntry(e.id)} className="text-gray-600 hover:text-rose-400 text-xs transition-colors">삭제</button>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
```

- [ ] **Step 2: 커밋한다**

```bash
git -C /Users/jang-yeonghwan/portfolio add portfolio-admin/src/components/TqqqManager.tsx
git -C /Users/jang-yeonghwan/portfolio commit -m "feat: TqqqManager 컴포넌트 추가"
```

---

## Task 11: 빌드 확인 + 서버 재시작 + 동작 검증

**Files:**
- 없음 (검증 단계)

- [ ] **Step 1: 빌드 에러 확인**

```bash
cd /Users/jang-yeonghwan/portfolio/portfolio-admin && npx tsc --noEmit 2>&1 | head -30
```

Expected: 에러 없음 (출력 없음)

- [ ] **Step 2: 서버 재시작 + /api/quant 응답 확인**

```bash
pkill -f "tsx server/index.ts"; sleep 1
cd /Users/jang-yeonghwan/portfolio/portfolio-admin && npm run server &
sleep 5 && curl -s http://localhost:3001/api/quant | python3 -c "
import sys, json; d = json.load(sys.stdin)
print('regime:', d['regime'], '| spy RSI:', round(d['spy']['rsi14'], 1), '| VIX:', round(d['vix']['price'], 1))
print('gainers:', [g['symbol'] for g in d['nasdaq']['gainers'][:3]])
print('losers:', [l['symbol'] for l in d['nasdaq']['losers'][:3]])
"
```

Expected (예시):
```
regime: 2 | spy RSI: 58.3 | VIX: 16.2
gainers: ['NVDA', 'META', 'AAPL']
losers: ['INTC', 'ABNB', 'QCOM']
```

- [ ] **Step 3: /api/tqqq 응답 확인**

```bash
curl -s http://localhost:3001/api/tqqq | python3 -c "
import sys, json; d = json.load(sys.stdin)
print('signal:', d['signal'])
t = d['quotes']['TQQQ']
print(f'TQQQ: \${t[\"price\"]:.2f} | RSI {t[\"rsi14\"]:.0f} | W%R {t[\"williamsR\"]:.0f} | drawdown {t[\"drawdown20d\"]:.1f}%')
"
```

Expected (예시):
```
signal: HOLD
TQQQ: $62.40 | RSI 48 | W%R -52 | drawdown -3.2%
```

- [ ] **Step 4: 프론트 개발서버로 탭 전환 동작 확인**

```bash
cd /Users/jang-yeonghwan/portfolio/portfolio-admin && npm run dev &
sleep 3 && open http://localhost:5173
```

브라우저에서 확인:
- [ ] 헤더에 `포트폴리오 / 퀀트 / TQQQ` 탭 3개 보임
- [ ] 퀀트 탭: ARDS-X 국면 배지 + 20일 히스토리 바차트 + NASDAQ 모버 상/하 10종목 표시
- [ ] TQQQ 탭: QuoteCard 4개 + 신호 배지 + DropMeter + DCA 시뮬레이터 + 투자 로그 빈 상태

- [ ] **Step 5: 최종 커밋 + 푸시**

```bash
git -C /Users/jang-yeonghwan/portfolio add -A
git -C /Users/jang-yeonghwan/portfolio commit -m "feat: 퀀트 대시보드 + TQQQ 관리 기능 추가"
git -C /Users/jang-yeonghwan/portfolio push origin main
```
