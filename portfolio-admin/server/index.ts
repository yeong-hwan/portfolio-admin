import express from "express";
import cors from "cors";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { getAccounts, getSnapshot, getExchangeRate, clearTokenCache } from "./toss-api/index.js";
import { computePortfolioCandles } from "./portfolio-candles.js";
import { getPerformanceMetrics } from "./performance.js";
import { getCorrelationMatrix } from "./correlation.js";
import { getMacroSensitivity } from "./macro.js";
import { getQuantData } from "./quant.js";
import { getTqqqData } from "./tqqq-api.js";
import { computeCashflow } from "./cashflow.js";
import { getFxCandles, type FxInterval } from "./fx-candles.js";
import { syncSplits } from "./splits.js";
import { computeTaxSummary, simulateSale } from "./tax.js";
import { computeDividendIncome } from "./dividends.js";
import { computeInflationCompass } from "./inflation-compass.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3001;
const DATA_DIR = path.join(__dirname, "..", "data");
const CHECKPOINTS_FILE = path.join(DATA_DIR, "checkpoints.json");
const SECTORS_FILE = path.join(DATA_DIR, "sectors.json");
const LAST_SNAPSHOT_FILE = path.join(DATA_DIR, "last-snapshot.json");

const QUANT_TTL = 30 * 60 * 1000;
const TQQQ_LOG_FILE = path.join(DATA_DIR, "tqqq-log.json");
const COMPUTED_DIR = path.join(DATA_DIR, "computed");

// --- 계산 결과 캐시 (메모리 + 디스크 영속화) ---
// 리플레이/외부 API 기반 계산 결과를 디스크에 남겨 서버 재시작 후에도
// TTL 이내면 재계산 없이 즉시 응답한다. TTL 경과 시 전체 재계산(리플레이)으로 갱신.
interface ComputedEntry { at: number; data: unknown }

function makeCached(name: string, ttlMs: number, compute: () => Promise<unknown>) {
  let mem: ComputedEntry | null = null;
  let diskChecked = false;
  const file = path.join(COMPUTED_DIR, `${name}.json`);

  async function loadDisk(): Promise<void> {
    if (diskChecked) return;
    diskChecked = true;
    try {
      const entry = JSON.parse(await fs.readFile(file, "utf-8")) as ComputedEntry;
      if (!mem || entry.at > mem.at) mem = entry;
    } catch {
      // 디스크 캐시 없음
    }
  }

  async function refresh(): Promise<unknown> {
    const data = await compute();
    mem = { at: Date.now(), data };
    fs.mkdir(COMPUTED_DIR, { recursive: true })
      .then(() => fs.writeFile(file, JSON.stringify(mem)))
      .catch(() => {});
    return data;
  }

  async function get(): Promise<unknown> {
    if (mem && Date.now() - mem.at < ttlMs) return mem.data;
    await loadDisk();
    if (mem && Date.now() - mem.at < ttlMs) return mem.data;
    return refresh();
  }

  return {
    refresh,
    handler: async (_req: express.Request, res: express.Response) => {
      try {
        res.json(await get());
      } catch (e: any) {
        res.status(500).json({ error: e.message });
      }
    },
  };
}

app.use(cors());
app.use(express.json());

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function loadCheckpoints(): Promise<any[]> {
  try {
    const data = await fs.readFile(CHECKPOINTS_FILE, "utf-8");
    return JSON.parse(data);
  } catch {
    return [];
  }
}

async function saveCheckpoints(checkpoints: any[]) {
  await ensureDataDir();
  await fs.writeFile(CHECKPOINTS_FILE, JSON.stringify(checkpoints, null, 2));
}

function getMarketCloseDate(): string {
  const now = new Date();
  const etOffset = isDST(now) ? -4 : -5;
  const etHour = (now.getUTCHours() + etOffset + 24) % 24;
  const etDate = new Date(now.getTime() + etOffset * 3600000);
  const dateStr = etDate.toISOString().split("T")[0];
  if (etHour < 16) {
    const prev = new Date(etDate.getTime() - 86400000);
    return prev.toISOString().split("T")[0];
  }
  return dateStr;
}

function isDST(date: Date): boolean {
  const year = date.getUTCFullYear();
  const marchSecondSunday = new Date(Date.UTC(year, 2, 8));
  marchSecondSunday.setUTCDate(8 + ((7 - marchSecondSunday.getUTCDay()) % 7));
  const novFirstSunday = new Date(Date.UTC(year, 10, 1));
  novFirstSunday.setUTCDate(1 + ((7 - novFirstSunday.getUTCDay()) % 7));
  return date >= marchSecondSunday && date < novFirstSunday;
}

async function saveDailyCheckpoint() {
  try {
    const marketDate = getMarketCloseDate();
    const checkpoints = await loadCheckpoints();
    const alreadySaved = checkpoints.some((c) => c.marketDate === marketDate);
    if (alreadySaved) return;

    const { summary, positions } = await getSnapshot();
    const checkpoint = {
      id: Date.now(),
      marketDate,
      timestamp: new Date().toISOString(),
      summary,
      positions,
    };
    checkpoints.push(checkpoint);
    await saveCheckpoints(checkpoints);
    console.log(`[auto] Daily checkpoint saved for ${marketDate}`);
  } catch (e: any) {
    console.error(`[auto] Failed to save daily checkpoint: ${e.message}`);
  }
}

setInterval(async () => {
  const now = new Date();
  const kstHour = (now.getUTCHours() + 9) % 24;
  const kstMin = now.getUTCMinutes();
  if (kstHour === 5 && kstMin >= 0 && kstMin < 20) {
    await saveDailyCheckpoint();
  }
}, 10 * 60 * 1000);

// API: Exchange rate (USD/KRW) from Toss Securities official API
app.get("/api/exchange-rate", async (_req, res) => {
  try {
    const { rate, timestamp } = await getExchangeRate();
    res.json({ rate, timestamp });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

async function loadLastSnapshot(): Promise<any> {
  try {
    const data = await fs.readFile(LAST_SNAPSHOT_FILE, "utf-8");
    return JSON.parse(data);
  } catch {
    return null;
  }
}

async function saveLastSnapshot(snapshot: any) {
  await ensureDataDir();
  await fs.writeFile(LAST_SNAPSHOT_FILE, JSON.stringify(snapshot, null, 2));
}

function isAuthError(message: string): boolean {
  return /invalid_client|TOSS_CLIENT|oauth token|401|403/i.test(message);
}

// API: Full snapshot (summary + positions) with cache fallback
app.get("/api/snapshot", async (_req, res) => {
  try {
    const { summary, positions } = await getSnapshot();
    const snapshot = {
      summary,
      positions,
      timestamp: new Date().toISOString(),
    };
    res.json({ ...snapshot, stale: false });
    // 응답 후 백그라운드로 캐시 저장 — 디스크 쓰기를 응답 경로에서 제거
    saveLastSnapshot(snapshot).catch(() => {});
  } catch (e: any) {
    const cached = await loadLastSnapshot();
    if (cached) {
      res.json({
        ...cached,
        stale: true,
        sessionExpired: isAuthError(e.message),
        error: e.message,
      });
    } else {
      res.status(500).json({ error: e.message, sessionExpired: isAuthError(e.message) });
    }
  }
});

// API: Get checkpoints
app.get("/api/checkpoints", async (_req, res) => {
  try {
    const checkpoints = await loadCheckpoints();
    res.json(checkpoints);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// API: Fill gaps between existing checkpoints with synthetic entries
app.post("/api/checkpoints/fill-gaps", async (_req, res) => {
  try {
    const checkpoints = await loadCheckpoints();
    if (checkpoints.length < 2) {
      return res.json({ filled: 0, skipped: 0 });
    }

    const sorted = [...checkpoints].sort((a, b) => {
      const da = a.marketDate || a.timestamp.split("T")[0];
      const db = b.marketDate || b.timestamp.split("T")[0];
      return da < db ? -1 : da > db ? 1 : 0;
    });

    const existingDates = new Set(
      sorted.map((c) => c.marketDate || c.timestamp.split("T")[0])
    );

    const firstDate = sorted[0].marketDate || sorted[0].timestamp.split("T")[0];
    const lastDate = sorted[sorted.length - 1].marketDate || sorted[sorted.length - 1].timestamp.split("T")[0];

    const allWeekdays: string[] = [];
    const cursor = new Date(firstDate + "T00:00:00Z");
    const endDate = new Date(lastDate + "T00:00:00Z");
    while (cursor <= endDate) {
      const dow = cursor.getUTCDay();
      if (dow !== 0 && dow !== 6) {
        allWeekdays.push(cursor.toISOString().split("T")[0]);
      }
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    const missingDates = allWeekdays.filter((d) => !existingDates.has(d));
    if (missingDates.length === 0) {
      return res.json({ filled: 0, skipped: 0 });
    }

    const rateMap: Record<string, number> = {};
    try {
      const fxUrl = `https://api.frankfurter.app/${firstDate}..${lastDate}?from=USD&to=KRW`;
      const fxResp = await fetch(fxUrl);
      if (fxResp.ok) {
        const fxData = await fxResp.json();
        if (fxData.rates) {
          for (const [date, rates] of Object.entries(fxData.rates as Record<string, { KRW: number }>)) {
            rateMap[date] = rates.KRW;
          }
        }
      }
    } catch (e) {
      console.error("[fill-gaps] Failed to fetch exchange rates:", e);
    }

    function getUsdKrw(date: string): number {
      const sortedDates = Object.keys(rateMap).sort();
      const prior = sortedDates.filter((d) => d <= date).pop();
      return prior ? rateMap[prior] : 1380;
    }

    const allSymbols = new Set<string>();
    for (const cp of sorted) {
      for (const pos of cp.positions || []) {
        if (pos.symbol) allSymbols.add(pos.symbol);
      }
    }

    const priceMap: Record<string, Record<string, number>> = {};
    const startUnix = Math.floor(new Date(firstDate + "T00:00:00Z").getTime() / 1000) - 86400;
    const endUnix = Math.floor(new Date(lastDate + "T00:00:00Z").getTime() / 1000) + 86400;

    for (const symbol of allSymbols) {
      try {
        const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&period1=${startUnix}&period2=${endUnix}`;
        const yahooResp = await fetch(yahooUrl);
        if (!yahooResp.ok) continue;
        const yahooData = await yahooResp.json();
        const result = yahooData?.chart?.result?.[0];
        if (!result) continue;
        const timestamps: number[] = result.timestamp || [];
        const closes: number[] = result.indicators?.quote?.[0]?.close || [];
        priceMap[symbol] = {};
        for (let i = 0; i < timestamps.length; i++) {
          if (closes[i] == null) continue;
          const dateStr = new Date(timestamps[i] * 1000).toISOString().split("T")[0];
          priceMap[symbol][dateStr] = closes[i];
        }
      } catch (e) {
        console.error(`[fill-gaps] Failed to fetch Yahoo Finance for ${symbol}:`, e);
        continue;
      }
      await new Promise((r) => setTimeout(r, 100));
    }

    let filled = 0;
    let skipped = 0;
    const syntheticCheckpoints: any[] = [];

    for (let idx = 0; idx < missingDates.length; idx++) {
      const date = missingDates[idx];
      try {
        const prior = sorted.filter((c) => {
          const d = c.marketDate || c.timestamp.split("T")[0];
          return d < date;
        }).pop();

        if (!prior) {
          skipped++;
          continue;
        }

        const usdKrw = getUsdKrw(date);
        const calculatedPositions: any[] = [];
        let hasAllPrices = true;

        for (const pos of prior.positions || []) {
          const symbol = pos.symbol;
          if (!symbol) continue;
          const closePrice = priceMap[symbol]?.[date];
          if (closePrice == null) {
            hasAllPrices = false;
            break;
          }
          const market_value_usd = pos.quantity * closePrice;
          const market_value = market_value_usd * usdKrw;
          const unrealized_pnl_usd = (closePrice - (pos.average_price_usd || 0)) * pos.quantity;
          const unrealized_pnl = unrealized_pnl_usd * usdKrw;
          const profit_rate_usd =
            pos.average_price_usd > 0
              ? (closePrice - pos.average_price_usd) / pos.average_price_usd
              : 0;

          calculatedPositions.push({
            ...pos,
            current_price_usd: closePrice,
            current_price: closePrice * usdKrw,
            market_value_usd,
            market_value,
            unrealized_pnl_usd,
            unrealized_pnl,
            profit_rate_usd,
            profit_rate: pos.average_price > 0
              ? unrealized_pnl / (pos.average_price * pos.quantity)
              : 0,
            daily_profit_loss: 0,
            daily_profit_rate: 0,
            daily_profit_loss_usd: 0,
            daily_profit_rate_usd: 0,
          });
        }

        if (!hasAllPrices) {
          skipped++;
          continue;
        }

        const totalMarketValueKrw = calculatedPositions.reduce((sum, p) => sum + p.market_value, 0);
        const cashKrw = prior.summary.orderable_amount_krw;
        const totalAsset = totalMarketValueKrw + cashKrw;
        const totalPrincipal = calculatedPositions.reduce(
          (sum, p) => sum + p.quantity * (p.average_price_usd || 0) * usdKrw,
          0
        );

        const syntheticCheckpoint = {
          id: Date.now() + idx,
          marketDate: date,
          timestamp: `${date}T21:00:00.000Z`,
          synthetic: true,
          summary: {
            ...prior.summary,
            total_asset_amount: totalAsset,
            evaluated_profit_amount: totalAsset - totalPrincipal - cashKrw,
            profit_rate:
              totalPrincipal > 0 ? (totalAsset - totalPrincipal - cashKrw) / totalPrincipal : 0,
            orderable_amount_krw: cashKrw,
          },
          positions: calculatedPositions,
        };

        syntheticCheckpoints.push(syntheticCheckpoint);
        filled++;
      } catch (e) {
        console.error(`[fill-gaps] Error processing date ${date}:`, e);
        skipped++;
      }
    }

    const combined = [...sorted, ...syntheticCheckpoints].sort((a, b) => {
      const da = a.marketDate || a.timestamp.split("T")[0];
      const db = b.marketDate || b.timestamp.split("T")[0];
      return da < db ? -1 : da > db ? 1 : 0;
    });
    await saveCheckpoints(combined);

    res.json({ filled, skipped });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// API: Force save today's checkpoint
app.post("/api/checkpoints/today", async (_req, res) => {
  try {
    const marketDate = getMarketCloseDate();
    const checkpoints = await loadCheckpoints();
    const filtered = checkpoints.filter((c) => c.marketDate !== marketDate);
    const { summary, positions } = await getSnapshot();
    const checkpoint = {
      id: Date.now(),
      marketDate,
      timestamp: new Date().toISOString(),
      summary,
      positions,
    };
    filtered.push(checkpoint);
    await saveCheckpoints(filtered);
    res.json(checkpoint);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// --- Sectors API ---
async function loadSectors(): Promise<any> {
  try {
    const data = await fs.readFile(SECTORS_FILE, "utf-8");
    return JSON.parse(data);
  } catch {
    return { sectors: [] };
  }
}

async function saveSectors(data: any) {
  await ensureDataDir();
  await fs.writeFile(SECTORS_FILE, JSON.stringify(data, null, 2));
}

app.get("/api/sectors", async (_req, res) => {
  try {
    const data = await loadSectors();
    res.json(data);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.put("/api/sectors", async (req, res) => {
  try {
    await saveSectors(req.body);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/sectors", async (req, res) => {
  try {
    const { name, symbols = [] } = req.body;
    if (!name) return res.status(400).json({ error: "name required" });
    const data = await loadSectors();
    if (data.sectors.some((s: any) => s.name === name)) {
      return res.status(409).json({ error: "sector already exists" });
    }
    data.sectors.push({ name, symbols });
    await saveSectors(data);
    res.json(data);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.delete("/api/sectors/:name", async (req, res) => {
  try {
    const data = await loadSectors();
    data.sectors = data.sectors.filter((s: any) => s.name !== req.params.name);
    await saveSectors(data);
    res.json(data);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/sectors/:name/symbols", async (req, res) => {
  try {
    const { symbol } = req.body;
    if (!symbol) return res.status(400).json({ error: "symbol required" });
    const data = await loadSectors();
    for (const s of data.sectors) {
      s.symbols = s.symbols.filter((sym: string) => sym !== symbol);
    }
    const sector = data.sectors.find((s: any) => s.name === req.params.name);
    if (!sector) return res.status(404).json({ error: "sector not found" });
    sector.symbols.push(symbol);
    await saveSectors(data);
    res.json(data);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.delete("/api/sectors/:name/symbols/:symbol", async (req, res) => {
  try {
    const data = await loadSectors();
    const sector = data.sectors.find((s: any) => s.name === req.params.name);
    if (sector) {
      sector.symbols = sector.symbols.filter((sym: string) => sym !== req.params.symbol);
    }
    await saveSectors(data);
    res.json(data);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// API: Portfolio performance metrics (SPY 적립 시뮬 대비, 주문 전체 리플레이)
const perfCached = makeCached("performance-metrics", 10 * 60 * 1000, () => getPerformanceMetrics());
app.get("/api/performance-metrics", perfCached.handler);

// API: Portfolio candlestick (order history + historical OHLC)
const candlesCached = makeCached("portfolio-candles", 5 * 60 * 1000, () =>
  computePortfolioCandles(parseInt(process.env.CASH_KRW ?? "0", 10))
);
app.get("/api/portfolio-candles", candlesCached.handler);

// API: Correlation matrix for current positions (1-year daily returns)
// Derives current positions from orders-cache.json to avoid Toss API dependency.
const correlationCached = makeCached("correlation", 60 * 60 * 1000, async () => {
  const ordersRaw = JSON.parse(await fs.readFile(path.join(DATA_DIR, "orders-cache.json"), "utf-8"));
  const BLACKLIST = new Set(["GTIJF"]);
  const pos: Record<string, number> = {};
  for (const o of (ordersRaw.orders as any[]).sort((a: any, b: any) => a.filledAt.localeCompare(b.filledAt))) {
    if (BLACKLIST.has(o.symbol)) continue;
    if (o.side === "BUY") pos[o.symbol] = (pos[o.symbol] ?? 0) + o.filledQuantity;
    else {
      pos[o.symbol] = (pos[o.symbol] ?? 0) - o.filledQuantity;
      if (pos[o.symbol] <= 0.0001) delete pos[o.symbol];
    }
  }
  return getCorrelationMatrix(Object.keys(pos));
});
app.get("/api/correlation", correlationCached.handler);

// API: Macro sensitivity (beta/correlation vs SPY, TLT, GLD, etc.)
const macroCached = makeCached("macro-sensitivity", 60 * 60 * 1000, () => getMacroSensitivity());
app.get("/api/macro-sensitivity", macroCached.handler);

// API: Quant dashboard (ARDS-X regime + NASDAQ movers)
const quantCached = makeCached("quant", QUANT_TTL, () => getQuantData());
app.get("/api/quant", quantCached.handler);

// API: Inflation Compass 국면 신호 (SPY 200MA × T5YIE 기반 4국면)
const compassCached = makeCached("inflation-compass", 60 * 60 * 1000, () => computeInflationCompass());
app.get("/api/inflation-compass", compassCached.handler);

// API: TQQQ signal + indicators
const tqqqCached = makeCached("tqqq", QUANT_TTL, () => getTqqqData());
app.get("/api/tqqq", tqqqCached.handler);

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

// API: USD/KRW daily history from fx-rates cache (Frankfurter, 캔들 계산 시 갱신됨)
app.get("/api/fx-history", async (_req, res) => {
  try {
    const raw = JSON.parse(await fs.readFile(path.join(DATA_DIR, "fx-rates.json"), "utf-8"));
    const series = Object.entries(raw.rates as Record<string, number>)
      .map(([date, rate]) => ({ date, rate }))
      .sort((a, b) => a.date.localeCompare(b.date));
    res.json(series);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// API: USD/KRW OHLC candles (Yahoo KRW=X, 실패 시 fx-rates 합성 폴백)
const fxCandlesCached: Record<FxInterval, ReturnType<typeof makeCached>> = {
  "1d": makeCached("fx-candles-1d", QUANT_TTL, () => getFxCandles("1d")),
  "1wk": makeCached("fx-candles-1wk", QUANT_TTL, () => getFxCandles("1wk")),
};
app.get("/api/fx-candles", (req, res) => {
  const interval: FxInterval = req.query.interval === "1wk" ? "1wk" : "1d";
  return fxCandlesCached[interval].handler(req, res);
});

// API: Cash flow reconstruction from order history (추정 순투입 vs 재투자 구분)
const cashflowCached = makeCached("cashflow", QUANT_TTL, () => computeCashflow());
app.get("/api/cashflow", cashflowCached.handler);

// API: Realized P&L + 양도세 추정 (FIFO, 체결일 환율)
const taxCached = makeCached("tax", QUANT_TTL, () => computeTaxSummary());
app.get("/api/tax", taxCached.handler);

// API: 매도 세금 시뮬레이션 — "이 종목 X주 팔면 세금이 얼마나 변하나"
app.get("/api/tax/simulate", async (req, res) => {
  try {
    const symbol = String(req.query.symbol ?? "");
    const qty = parseFloat(String(req.query.qty ?? "0"));
    const priceKrw = parseFloat(String(req.query.priceKrw ?? "0"));
    if (!symbol || !(qty > 0) || !(priceKrw > 0)) {
      return res.status(400).json({ error: "symbol, qty, priceKrw required" });
    }
    const result = await simulateSale(symbol, qty, priceKrw);
    if (!result) return res.status(404).json({ error: "해당 종목의 보유 로트가 없습니다" });
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// API: 배당 인컴 추정 (배당락일 보유수량 × Yahoo 배당 이벤트)
const dividendsCached = makeCached("dividends", 60 * 60 * 1000, () => computeDividendIncome());
app.get("/api/dividends", dividendsCached.handler);

// API: 목표 설정 (1억 모으기 등)
const GOAL_FILE = path.join(DATA_DIR, "goal.json");
const DEFAULT_GOAL = { targetKrw: 100_000_000, monthlySavingKrw: 4_000_000 };
app.get("/api/goal", async (_req, res) => {
  try {
    res.json({ ...DEFAULT_GOAL, ...JSON.parse(await fs.readFile(GOAL_FILE, "utf-8")) });
  } catch {
    res.json(DEFAULT_GOAL);
  }
});
app.put("/api/goal", async (req, res) => {
  try {
    const { targetKrw, monthlySavingKrw } = req.body;
    if (!targetKrw || targetKrw <= 0) return res.status(400).json({ error: "targetKrw required" });
    const goal = { targetKrw, monthlySavingKrw: monthlySavingKrw ?? 0 };
    await ensureDataDir();
    await fs.writeFile(GOAL_FILE, JSON.stringify(goal, null, 2));
    res.json(goal);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// API: Check auth status by verifying credentials can fetch accounts
app.get("/api/auth/status", async (_req, res) => {
  try {
    await getAccounts();
    res.json({ ok: true });
  } catch (e: any) {
    res.json({ ok: false, error: e.message });
  }
});

// API: Validate credentials and reset token cache
app.post("/api/auth/login", async (_req, res) => {
  try {
    clearTokenCache();
    await getAccounts();
    res.json({ ok: true });
  } catch (e: any) {
    res.status(401).json({ error: e.message });
  }
});

// Serve frontend static files
const distDir = path.join(__dirname, "..", "dist");
app.use(express.static(distDir));
app.get("/{*splat}", (_req, res) => {
  res.sendFile(path.join(distDir, "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Portfolio admin API running on http://localhost:${PORT}`);
  saveDailyCheckpoint();
  // 서버 시작 후 캐시 워밍업 — 디스크 캐시가 TTL을 지났을 때만 실제 재계산됨
  setTimeout(async () => {
    try {
      await syncSplits();
      console.log("[warmup] splits synced");
    } catch (e) {
      console.error("[warmup] splits sync failed:", e);
    }
    try {
      const candles = (await candlesCached.refresh()) as unknown[];
      console.log(`[warmup] ${candles.length} portfolio candles cached`);
    } catch (e) {
      console.error("[warmup] candles failed:", e);
    }
    try {
      await perfCached.refresh();
      console.log("[warmup] performance metrics cached");
    } catch (e) {
      console.error("[warmup] performance metrics failed:", e);
    }
  }, 500);
});
