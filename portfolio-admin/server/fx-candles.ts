import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '../data');

export type FxInterval = '1d' | '1wk';

export interface FxCandle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';

async function fetchYahooFxCandles(interval: FxInterval): Promise<FxCandle[]> {
  const range = interval === '1d' ? '2y' : '5y';
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/KRW=X?interval=${interval}&range=${range}`;
  const resp = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!resp.ok) throw new Error(`Yahoo KRW=X failed (${resp.status})`);
  const json = await resp.json() as any;
  const result = json?.chart?.result?.[0];
  if (!result?.timestamp) throw new Error('Yahoo KRW=X: empty result');

  const timestamps: number[] = result.timestamp;
  const q = result.indicators?.quote?.[0] ?? {};
  const byDate = new Map<string, FxCandle>();
  for (let i = 0; i < timestamps.length; i++) {
    const [open, high, low, close] = [q.open?.[i], q.high?.[i], q.low?.[i], q.close?.[i]];
    if (open == null || high == null || low == null || close == null) continue;
    const date = new Date(timestamps[i] * 1000).toISOString().split('T')[0];
    // 진행 중 캔들이 같은 구간에 중복으로 오면 마지막 값을 사용
    byDate.set(date, { date, open, high, low, close });
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

// Yahoo 실패 시 fx-rates.json 일별 종가로 캔들 합성 (시가=전일 종가)
async function synthesizeFromRates(interval: FxInterval): Promise<FxCandle[]> {
  const raw = JSON.parse(await fs.readFile(path.join(DATA_DIR, 'fx-rates.json'), 'utf-8'));
  const rates = raw.rates as Record<string, number>;
  const dates = Object.keys(rates).sort();

  const daily: FxCandle[] = [];
  let prev: number | null = null;
  for (const date of dates) {
    const close = rates[date];
    const open = prev ?? close;
    daily.push({ date, open, high: Math.max(open, close), low: Math.min(open, close), close });
    prev = close;
  }
  if (interval === '1d') return daily;

  // 주봉: ISO 주 단위로 집계 (월요일 시작)
  const weeks = new Map<string, FxCandle>();
  for (const c of daily) {
    const d = new Date(c.date + 'T00:00:00Z');
    const monday = new Date(d);
    monday.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    const key = monday.toISOString().split('T')[0];
    const w = weeks.get(key);
    if (!w) {
      weeks.set(key, { ...c, date: key });
    } else {
      w.high = Math.max(w.high, c.high);
      w.low = Math.min(w.low, c.low);
      w.close = c.close;
    }
  }
  return [...weeks.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export async function getFxCandles(interval: FxInterval): Promise<FxCandle[]> {
  try {
    return await fetchYahooFxCandles(interval);
  } catch {
    return synthesizeFromRates(interval);
  }
}
