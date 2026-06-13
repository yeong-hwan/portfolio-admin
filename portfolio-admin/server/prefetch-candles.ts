/**
 * Pre-fetches Yahoo Finance candles for all symbols in order history.
 * Run before starting the server to warm the data/candles/ cache.
 *   npm run prefetch
 */
import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { getHistoricalCandles } from './toss-api/market.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../data');
const ORDERS_CACHE = path.join(DATA_DIR, 'orders-cache.json');

async function main() {
  let orders: { symbol: string; filledAt: string }[];
  try {
    const raw = JSON.parse(await fs.readFile(ORDERS_CACHE, 'utf-8'));
    orders = raw.orders;
  } catch {
    console.error('orders-cache.json 없음 — 서버를 한 번 실행해서 주문 이력을 먼저 동기화하세요.');
    process.exit(1);
  }

  const symbolMap: Record<string, string> = {};
  for (const o of orders) {
    if (!symbolMap[o.symbol] || o.filledAt < symbolMap[o.symbol]) {
      symbolMap[o.symbol] = o.filledAt.split('T')[0];
    }
  }

  const symbols = Object.keys(symbolMap);
  // SPY는 성과 벤치마크용
  if (!symbolMap['SPY']) {
    symbolMap['SPY'] = orders[0]?.filledAt.split('T')[0] ?? '2024-01-01';
    symbols.push('SPY');
  }

  console.log(`심볼 ${symbols.length}개 캔들 pre-fetch 시작...`);

  const results = await Promise.allSettled(
    symbols.map(async (sym) => {
      const from = symbolMap[sym];
      const candles = await getHistoricalCandles(sym, from);
      console.log(`  ✓ ${sym.padEnd(10)} ${candles.length}일`);
      return sym;
    })
  );

  const failed = results.filter(r => r.status === 'rejected').length;
  console.log(`\n완료: ${symbols.length - failed}/${symbols.length} 성공${failed ? `, ${failed}개 실패` : ''}`);
}

main().catch(console.error);
