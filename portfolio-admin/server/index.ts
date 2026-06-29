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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3001;
const DATA_DIR = path.join(__dirname, "..", "data");
const CHECKPOINTS_FILE = path.join(DATA_DIR, "checkpoints.json");
const SECTORS_FILE = path.join(DATA_DIR, "sectors.json");
const LAST_SNAPSHOT_FILE = path.join(DATA_DIR, "last-snapshot.json");

let candlesResultCache: { data: unknown; at: number } | null = null;
let quantCache:  { data: unknown; at: number } | null = null;
let tqqqCache:   { data: unknown; at: number } | null = null;
const QUANT_TTL = 30 * 60 * 1000;
const TQQQ_LOG_FILE = path.join(DATA_DIR, "tqqq-log.json");

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
    await saveLastSnapshot(snapshot);
    res.json({ ...snapshot, stale: false });
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

// API: Portfolio performance metrics (Sharpe, MDD, alpha/beta vs SPY)
app.get("/api/performance-metrics", async (_req, res) => {
  try {
    const { summary } = await getSnapshot();
    const cashKrw = summary.orderable_amount_krw ?? 0;
    const metrics = await getPerformanceMetrics(cashKrw);
    res.json(metrics);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// API: Portfolio candlestick (order history + historical OHLC)
// Cached 5 min in-memory — recomputation reads ~100 symbol files + Toss API
app.get("/api/portfolio-candles", async (_req, res) => {
  if (candlesResultCache && Date.now() - candlesResultCache.at < 5 * 60 * 1000) {
    return res.json(candlesResultCache.data);
  }
  try {
    const cashKrw = parseInt(process.env.CASH_KRW ?? "0", 10);
    const candles = await computePortfolioCandles(cashKrw);
    candlesResultCache = { data: candles, at: Date.now() };
    res.json(candles);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// API: Correlation matrix for current positions (1-year daily returns)
// Derives current positions from orders-cache.json to avoid Toss API dependency.
let correlationCache: { data: unknown; at: number } | null = null;
app.get("/api/correlation", async (_req, res) => {
  if (correlationCache && Date.now() - correlationCache.at < 60 * 60 * 1000) {
    return res.json(correlationCache.data);
  }
  try {
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
    const symbols = Object.keys(pos);
    const result = await getCorrelationMatrix(symbols);
    correlationCache = { data: result, at: Date.now() };
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// API: Macro sensitivity (beta/correlation vs SPY, TLT, GLD, etc.)
let macroCache: { data: unknown; at: number } | null = null;
app.get("/api/macro-sensitivity", async (_req, res) => {
  if (macroCache && Date.now() - macroCache.at < 60 * 60 * 1000) {
    return res.json(macroCache.data);
  }
  try {
    const result = await getMacroSensitivity();
    macroCache = { data: result, at: Date.now() };
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

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
  // 서버 시작 후 캔들 캐시 워밍업 — 첫 사용자 요청을 즉시 반환하기 위해
  setTimeout(async () => {
    try {
      const cashKrw = parseInt(process.env.CASH_KRW ?? "0", 10);
      const candles = await computePortfolioCandles(cashKrw);
      candlesResultCache = { data: candles, at: Date.now() };
      console.log(`[warmup] ${candles.length} portfolio candles cached`);
    } catch (e) {
      console.error("[warmup] candles failed:", e);
    }
  }, 500);
});
