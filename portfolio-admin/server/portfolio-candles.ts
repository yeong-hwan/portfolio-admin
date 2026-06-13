import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { getAllFilledOrders, FilledOrder } from './toss-api/orders.js';
import { getHistoricalCandles } from './toss-api/market.js';
import { resolveAccountSeq } from './toss-api/account.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '../data');
const FX_CACHE_FILE = path.join(DATA_DIR, 'fx-rates.json');
const ORDERS_CACHE_FILE = path.join(DATA_DIR, 'orders-cache.json');
const CANDLES_CACHE_FILE = path.join(DATA_DIR, 'portfolio-candles-cache.json');

export interface PortfolioCandle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

// --- Orders cache ---

interface OrdersCache {
  fetchedUntil: string;
  orders: FilledOrder[];
}

async function loadOrdersCache(): Promise<OrdersCache | null> {
  try { return JSON.parse(await fs.readFile(ORDERS_CACHE_FILE, 'utf-8')); } catch { return null; }
}

async function getOrders(accountSeq: number): Promise<FilledOrder[]> {
  const today = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  const cache = await loadOrdersCache();

  if (cache && cache.fetchedUntil >= yesterday) return cache.orders;

  // Fetch all fresh orders (full history — needed for correct position reconstruction)
  const orders = await getAllFilledOrders(accountSeq);
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(ORDERS_CACHE_FILE, JSON.stringify({ fetchedUntil: today, orders }));
  return orders;
}

// --- FX rates cache ---

interface FxCache { fetchedUntil: string; rates: Record<string, number> }

async function loadFxCache(): Promise<FxCache | null> {
  try { return JSON.parse(await fs.readFile(FX_CACHE_FILE, 'utf-8')); } catch { return null; }
}

async function getHistoricalFxRates(fromDate: string): Promise<Record<string, number>> {
  const today = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  const cache = await loadFxCache();
  if (cache && cache.fetchedUntil >= yesterday) return cache.rates;

  const fetchFrom = cache
    ? (() => { const d = new Date(cache.fetchedUntil); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().split('T')[0]; })()
    : fromDate;

  try {
    const resp = await fetch(`https://api.frankfurter.app/${fetchFrom}..${today}?from=USD&to=KRW`);
    if (!resp.ok) throw new Error();
    const data = await resp.json() as { rates: Record<string, { KRW: number }> };
    const newRates: Record<string, number> = {};
    for (const [date, r] of Object.entries(data.rates ?? {})) newRates[date] = r.KRW;
    const merged = { ...(cache?.rates ?? {}), ...newRates };
    await fs.writeFile(FX_CACHE_FILE, JSON.stringify({ fetchedUntil: today, rates: merged }));
    return merged;
  } catch {
    return cache?.rates ?? {};
  }
}

function nearestRate(rates: Record<string, number>, date: string): number {
  const prior = Object.keys(rates).sort().filter(d => d <= date).pop();
  return prior ? rates[prior] : 1380;
}

// --- Portfolio candles cache ---

interface CandlesCache {
  confirmedUntil: string; // candles up to this date are stable (closed market)
  candles: PortfolioCandle[];
}

async function loadCandlesCache(): Promise<CandlesCache | null> {
  try { return JSON.parse(await fs.readFile(CANDLES_CACHE_FILE, 'utf-8')); } catch { return null; }
}

async function saveCandlesCache(cache: CandlesCache): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(CANDLES_CACHE_FILE, JSON.stringify(cache));
}

// --- Candle sanitization ---

// Clamp per-symbol day-to-day moves to ±70% to suppress bad OTC/Yahoo data.
// Real large-caps rarely move more than 50% in a day; OTC data can be wildly wrong.
function sanitizeCandleMap(
  raw: Record<string, { open: number; high: number; low: number; close: number }>,
): Record<string, { open: number; high: number; low: number; close: number }> {
  const dates = Object.keys(raw).sort();
  const result: typeof raw = {};
  let prevClose = 0;
  for (const date of dates) {
    const c = raw[date];
    if (prevClose > 0) {
      const ratio = c.close / prevClose;
      if (ratio > 1.7 || ratio < 1 / 1.7) {
        // Outlier: replace with previous close so the candle is flat but visible
        result[date] = { open: prevClose, high: prevClose, low: prevClose, close: prevClose };
        continue;
      }
    }
    result[date] = c;
    prevClose = c.close;
  }
  return result;
}

// --- Core computation ---

function buildCandles(
  orders: FilledOrder[],
  candlesBySymbol: Record<string, Record<string, { open: number; high: number; low: number; close: number }>>,
  symbolCurrency: Record<string, 'KRW' | 'USD'>,
  fxRates: Record<string, number>,
  fromDate: string,
  toDate: string,
  cashKrw = 0,
): PortfolioCandle[] {
  const tradingDays = [...new Set(
    Object.keys(symbolCurrency).flatMap(s => Object.keys(candlesBySymbol[s] ?? {}))
  )].filter(d => d >= fromDate && d <= toDate).sort();

  const sortedOrders = [...orders].sort((a, b) => a.filledAt.localeCompare(b.filledAt));
  const positions: Record<string, number> = {};
  let orderIdx = 0;
  const result: PortfolioCandle[] = [];

  // Fast-forward orders before fromDate to build initial positions
  while (orderIdx < sortedOrders.length && sortedOrders[orderIdx].filledAt.split('T')[0] < fromDate) {
    const order = sortedOrders[orderIdx++];
    applyOrder(positions, order);
  }

  for (const date of tradingDays) {
    while (orderIdx < sortedOrders.length && sortedOrders[orderIdx].filledAt.split('T')[0] <= date) {
      applyOrder(positions, sortedOrders[orderIdx++]);
    }

    const held = Object.keys(positions);
    if (!held.length) continue;

    const usdKrw = nearestRate(fxRates, date);
    let open = 0, high = 0, low = 0, close = 0, skip = false;

    for (const symbol of held) {
      const qty = positions[symbol];
      const fx = symbolCurrency[symbol] === 'USD' ? usdKrw : 1;
      const sanitized = sanitizeCandleMap(candlesBySymbol[symbol] ?? {});
      let c = sanitized[date];
      if (!c) {
        const prior = Object.keys(sanitized).sort().filter(d => d < date).pop();
        if (!prior) { skip = true; break; }
        const p = sanitized[prior];
        c = { open: p.close, high: p.close, low: p.close, close: p.close };
      }
      open  += qty * c.open  * fx;
      high  += qty * c.high  * fx;
      low   += qty * c.low   * fx;
      close += qty * c.close * fx;
    }

    if (!skip) result.push({ date, open: open + cashKrw, high: high + cashKrw, low: low + cashKrw, close: close + cashKrw });
  }

  return result;
}

function applyOrder(positions: Record<string, number>, order: FilledOrder) {
  if (order.side === 'BUY') {
    positions[order.symbol] = (positions[order.symbol] ?? 0) + order.filledQuantity;
  } else {
    const rem = (positions[order.symbol] ?? 0) - order.filledQuantity;
    if (rem <= 0.0001) delete positions[order.symbol];
    else positions[order.symbol] = rem;
  }
}

// --- Public API ---

export async function computePortfolioCandles(cashKrw = 0): Promise<PortfolioCandle[]> {
  const accountSeq = await resolveAccountSeq();
  const [orders, cache] = await Promise.all([
    getOrders(accountSeq),
    loadCandlesCache(),
  ]);
  if (!orders.length) return [];

  const today = new Date().toISOString().split('T')[0];
  const allFromDate = orders[0].filledAt.split('T')[0];

  // Recompute window: last 7 days to catch any recent trade changes
  const recomputeFrom = cache
    ? (() => { const d = new Date(cache.confirmedUntil); d.setUTCDate(d.getUTCDate() - 7); return d.toISOString().split('T')[0]; })()
    : allFromDate;

  const symbolCurrency: Record<string, 'KRW' | 'USD'> = {};
  for (const o of orders) symbolCurrency[o.symbol] = o.currency;
  const symbols = Object.keys(symbolCurrency);

  // Fetch candles (disk-cached per symbol, incremental)
  const candlesBySymbol: Record<string, Record<string, { open: number; high: number; low: number; close: number }>> = {};
  await Promise.all(symbols.map(async (symbol) => {
    try {
      const candles = await getHistoricalCandles(symbol, allFromDate);
      candlesBySymbol[symbol] = Object.fromEntries(
        candles.map(c => [c.date, { open: c.open, high: c.high, low: c.low, close: c.close }])
      );
    } catch {
      candlesBySymbol[symbol] = {};
    }
  }));

  const hasUsd = symbols.some(s => symbolCurrency[s] === 'USD');
  const fxRates = hasUsd ? await getHistoricalFxRates(allFromDate) : {};

  // Fresh candles for the recompute window
  const freshCandles = buildCandles(orders, candlesBySymbol, symbolCurrency, fxRates, recomputeFrom, today, cashKrw);

  // Merge: confirmed cache + fresh window (fresh overwrites overlapping dates)
  const cachedStable = (cache?.candles ?? []).filter(c => c.date < recomputeFrom);
  const merged = [...cachedStable, ...freshCandles].sort((a, b) => a.date.localeCompare(b.date));

  // Save cache — mark yesterday as confirmed (today's market may still be open)
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  await saveCandlesCache({ confirmedUntil: yesterday, candles: merged });

  return merged;
}
