import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import type { FilledOrder } from './toss-api/orders.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '../data');
const SPLITS_FILE = path.join(DATA_DIR, 'splits.json');
const ORDERS_CACHE_FILE = path.join(DATA_DIR, 'orders-cache.json');

const DIVIDENDS_FILE = path.join(DATA_DIR, 'dividends.json');
const SYNC_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 주 1회 갱신
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';

export interface SplitEvent {
  date: string;
  /** 보유수량 배수: 3:1 분할 = 3, 1:10 병합(역분할) = 0.1 */
  ratio: number;
}

export interface DividendEvent {
  date: string; // 배당락일
  amount: number; // 주당 배당금 (USD, 분할 조정)
}

interface SplitsCache {
  fetchedAt: string;
  splits: Record<string, SplitEvent[]>;
}

interface DividendsCache {
  fetchedAt: string;
  dividends: Record<string, DividendEvent[]>;
}

let memCache: SplitsCache | null = null;

async function loadSplitsFile(): Promise<SplitsCache | null> {
  if (memCache) return memCache;
  try {
    memCache = JSON.parse(await fs.readFile(SPLITS_FILE, 'utf-8'));
    return memCache;
  } catch {
    return null;
  }
}

async function fetchSymbolEvents(symbol: string): Promise<{ splits: SplitEvent[]; dividends: DividendEvent[] }> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5y&events=div%2Csplits`;
  const resp = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!resp.ok) throw new Error(`Yahoo events ${symbol} failed (${resp.status})`);
  const json = await resp.json() as any;
  const events = json?.chart?.result?.[0]?.events ?? {};

  const splits: SplitEvent[] = [];
  for (const s of Object.values(events.splits ?? {}) as any[]) {
    const num = Number(s.numerator);
    const den = Number(s.denominator);
    if (!num || !den) continue;
    splits.push({ date: new Date(Number(s.date) * 1000).toISOString().split('T')[0], ratio: num / den });
  }

  const dividends: DividendEvent[] = [];
  for (const d of Object.values(events.dividends ?? {}) as any[]) {
    const amount = Number(d.amount);
    if (!amount) continue;
    dividends.push({ date: new Date(Number(d.date) * 1000).toISOString().split('T')[0], amount });
  }

  return {
    splits: splits.sort((a, b) => a.date.localeCompare(b.date)),
    dividends: dividends.sort((a, b) => a.date.localeCompare(b.date)),
  };
}

// 주문 이력에 등장한 전 심볼의 분할·배당 이벤트를 Yahoo에서 수집해 디스크 캐싱 (7일 TTL)
export async function syncSplits(): Promise<Record<string, SplitEvent[]>> {
  const cached = await loadSplitsFile();
  const hasDividends = await fs.access(DIVIDENDS_FILE).then(() => true).catch(() => false);
  if (cached && hasDividends && Date.now() - new Date(cached.fetchedAt).getTime() < SYNC_TTL_MS) {
    return cached.splits;
  }

  let symbols: string[] = [];
  try {
    const raw = JSON.parse(await fs.readFile(ORDERS_CACHE_FILE, 'utf-8'));
    symbols = [...new Set((raw.orders as FilledOrder[]).map(o => o.symbol))];
  } catch {
    return cached?.splits ?? {};
  }

  const splits: Record<string, SplitEvent[]> = {};
  const dividends: Record<string, DividendEvent[]> = {};
  for (const symbol of symbols) {
    try {
      const ev = await fetchSymbolEvents(symbol);
      if (ev.splits.length) splits[symbol] = ev.splits;
      if (ev.dividends.length) dividends[symbol] = ev.dividends;
    } catch {
      // 개별 심볼 실패는 무시 — 이전 캐시 값 유지
      if (cached?.splits[symbol]) splits[symbol] = cached.splits[symbol];
    }
    await new Promise(r => setTimeout(r, 200));
  }

  const changed = JSON.stringify(splits) !== JSON.stringify(cached?.splits ?? {});
  memCache = { fetchedAt: new Date().toISOString(), splits };
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(SPLITS_FILE, JSON.stringify(memCache, null, 2));
  const divCache: DividendsCache = { fetchedAt: new Date().toISOString(), dividends };
  await fs.writeFile(DIVIDENDS_FILE, JSON.stringify(divCache, null, 2));

  // 분할 정보가 바뀌면 과거 구간이 굳어있는 증분 캔들 캐시를 무효화해 전체 재계산 유도
  if (changed) {
    await fs.unlink(path.join(DATA_DIR, 'portfolio-candles-cache.json')).catch(() => {});
  }
  return splits;
}

export async function loadDividends(): Promise<Record<string, DividendEvent[]>> {
  try {
    return (JSON.parse(await fs.readFile(DIVIDENDS_FILE, 'utf-8')) as DividendsCache).dividends ?? {};
  } catch {
    return {};
  }
}

export async function loadSplits(): Promise<Record<string, SplitEvent[]>> {
  return (await loadSplitsFile())?.splits ?? {};
}

// 주문 수량을 분할 반영(현재 주식 수 기준)으로 보정.
// 체결일 이후 발생한 분할의 ratio를 누적 적용: 수량 ×factor, 단가 ÷factor (금액 불변).
// 캔들 가격은 분할 조정가로 내려오므로, 이렇게 맞춰야 수량×가격이 실제 평가액과 일치한다.
export function adjustOrdersForSplits(
  orders: FilledOrder[],
  splits: Record<string, SplitEvent[]>,
): FilledOrder[] {
  return orders.map(o => {
    const events = splits[o.symbol];
    if (!events?.length) return o;
    const orderDate = o.filledAt.split('T')[0];
    let factor = 1;
    for (const s of events) {
      if (s.date > orderDate) factor *= s.ratio;
    }
    if (factor === 1) return o;
    return {
      ...o,
      filledQuantity: o.filledQuantity * factor,
      averageFilledPrice: o.averageFilledPrice / factor,
    };
  });
}
