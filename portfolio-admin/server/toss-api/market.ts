import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CANDLES_DIR = path.join(__dirname, '../../data/candles');

export interface DayCandle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface CandleCache {
  symbol: string;
  fetchedUntil: string;
  candles: DayCandle[];
}

async function loadCandleCache(symbol: string): Promise<CandleCache | null> {
  try {
    const data = await fs.readFile(path.join(CANDLES_DIR, `${symbol}.json`), 'utf-8');
    return JSON.parse(data) as CandleCache;
  } catch {
    return null;
  }
}

async function saveCandleCache(cache: CandleCache): Promise<void> {
  await fs.mkdir(CANDLES_DIR, { recursive: true });
  await fs.writeFile(path.join(CANDLES_DIR, `${cache.symbol}.json`), JSON.stringify(cache));
}

// Yahoo Finance uses hyphens instead of dots (e.g. BRK.B → BRK-B)
function toYahooSymbol(symbol: string): string {
  return symbol.replace(/\./g, '-');
}

async function fetchYahoo(symbol: string, fromDate: string, toDate: string): Promise<DayCandle[]> {
  const p1 = Math.floor(new Date(fromDate + 'T00:00:00Z').getTime() / 1000);
  const p2 = Math.floor(new Date(toDate + 'T23:59:59Z').getTime() / 1000);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${toYahooSymbol(symbol)}?interval=1d&period1=${p1}&period2=${p2}`;

  const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!resp.ok) throw new Error(`Yahoo Finance ${symbol}: ${resp.status}`);

  const data = await resp.json() as any;
  const result = data?.chart?.result?.[0];
  if (!result) return [];

  const timestamps: number[] = result.timestamp ?? [];
  const q = result.indicators?.quote?.[0] ?? {};

  return timestamps.reduce<DayCandle[]>((acc, ts, i) => {
    const o = (q.open as number[])[i], h = (q.high as number[])[i];
    const l = (q.low as number[])[i], c = (q.close as number[])[i];
    if (o != null && h != null && l != null && c != null) {
      acc.push({ date: new Date(ts * 1000).toISOString().split('T')[0], open: o, high: h, low: l, close: c });
    }
    return acc;
  }, []);
}

export async function getHistoricalCandles(symbol: string, fromDate: string): Promise<DayCandle[]> {
  const today = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  const cache = await loadCandleCache(symbol);

  if (cache && cache.fetchedUntil >= yesterday) {
    return cache.candles.filter(c => c.date >= fromDate);
  }

  if (cache && cache.fetchedUntil >= fromDate) {
    const nextDay = new Date(cache.fetchedUntil);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    const fetchFrom = nextDay.toISOString().split('T')[0];

    if (fetchFrom <= today) {
      const newCandles = await fetchYahoo(symbol, fetchFrom, today);
      const merged = [...new Map(
        [...cache.candles, ...newCandles].map(c => [c.date, c])
      ).values()].sort((a, b) => a.date.localeCompare(b.date));
      await saveCandleCache({ symbol, fetchedUntil: today, candles: merged });
      return merged.filter(c => c.date >= fromDate);
    }
    return cache.candles.filter(c => c.date >= fromDate);
  }

  const candles = await fetchYahoo(symbol, fromDate, today);
  if (candles.length) await saveCandleCache({ symbol, fetchedUntil: today, candles });
  return candles;
}
