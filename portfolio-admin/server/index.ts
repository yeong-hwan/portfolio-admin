import express from "express";
import cors from "cors";
import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const execFileAsync = promisify(execFile);
const app = express();
const PORT = 3001;
const DATA_DIR = path.join(__dirname, "..", "data");
const CHECKPOINTS_FILE = path.join(DATA_DIR, "checkpoints.json");
const SECTORS_FILE = path.join(DATA_DIR, "sectors.json");
const LAST_SNAPSHOT_FILE = path.join(DATA_DIR, "last-snapshot.json");

app.use(cors());
app.use(express.json());

async function runTossctl(args: string[]): Promise<any> {
  const { stdout } = await execFileAsync("tossctl", [...args, "--output", "json"], {
    timeout: 30000,
  });
  return JSON.parse(stdout);
}

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

// Check if a checkpoint already exists for today's market close date
function getMarketCloseDate(): string {
  // US market close = 16:00 ET → KST 05:00~06:00 next day
  // The "trading date" is the US date when market closed
  const now = new Date();
  // US Eastern time offset: UTC-5 (EST) or UTC-4 (EDT)
  const etOffset = isDST(now) ? -4 : -5;
  const etHour = (now.getUTCHours() + etOffset + 24) % 24;
  const etDate = new Date(now.getTime() + etOffset * 3600000);
  // If before 16:00 ET, the last close was previous trading day
  const dateStr = etDate.toISOString().split("T")[0];
  if (etHour < 16) {
    // Use previous day
    const prev = new Date(etDate.getTime() - 86400000);
    return prev.toISOString().split("T")[0];
  }
  return dateStr;
}

function isDST(date: Date): boolean {
  // US DST: second Sunday of March to first Sunday of November
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

    const [summary, positions] = await Promise.all([
      runTossctl(["account", "summary"]),
      runTossctl(["portfolio", "positions"]),
    ]);
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

// Auto-save: check every 10 minutes, save at KST 05:10 (right after US market close)
setInterval(async () => {
  const now = new Date();
  const kstHour = (now.getUTCHours() + 9) % 24;
  const kstMin = now.getUTCMinutes();
  // Window: KST 05:00 ~ 05:20 (captures market close in both EST and EDT)
  if (kstHour === 5 && kstMin >= 0 && kstMin < 20) {
    await saveDailyCheckpoint();
  }
}, 10 * 60 * 1000);

// API: Exchange rate (USD/KRW) from public API
app.get("/api/exchange-rate", async (_req, res) => {
  try {
    const response = await fetch(
      "https://open.er-api.com/v6/latest/USD"
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    res.json({
      rate: data.rates.KRW,
      timestamp: data.time_last_update_utc,
    });
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

function isSessionExpired(message: string): boolean {
  return /session is no longer valid|auth login|403/i.test(message);
}

// API: Full snapshot (summary + positions) with cache fallback
app.get("/api/snapshot", async (_req, res) => {
  try {
    const [summary, positions] = await Promise.all([
      runTossctl(["account", "summary"]),
      runTossctl(["portfolio", "positions"]),
    ]);
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
        sessionExpired: isSessionExpired(e.message),
        error: e.message,
      });
    } else {
      res.status(500).json({ error: e.message, sessionExpired: isSessionExpired(e.message) });
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

// API: Force save today's checkpoint (for testing / manual trigger)
app.post("/api/checkpoints/today", async (_req, res) => {
  try {
    const marketDate = getMarketCloseDate();
    const checkpoints = await loadCheckpoints();
    // Remove existing for same date (overwrite)
    const filtered = checkpoints.filter((c) => c.marketDate !== marketDate);
    const [summary, positions] = await Promise.all([
      runTossctl(["account", "summary"]),
      runTossctl(["portfolio", "positions"]),
    ]);
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

// Get sectors
app.get("/api/sectors", async (_req, res) => {
  try {
    const data = await loadSectors();
    res.json(data);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Update entire sectors config
app.put("/api/sectors", async (req, res) => {
  try {
    await saveSectors(req.body);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Add a new sector
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

// Delete a sector
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

// Assign symbol to sector
app.post("/api/sectors/:name/symbols", async (req, res) => {
  try {
    const { symbol } = req.body;
    if (!symbol) return res.status(400).json({ error: "symbol required" });
    const data = await loadSectors();
    // Remove from any existing sector
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

// Remove symbol from sector
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

// API: Trigger tossctl auth login (opens browser on server machine)
// If running on a machine that can ssh to atlas, also sync session.
app.post("/api/auth/login", async (_req, res) => {
  try {
    const { spawn } = await import("child_process");
    const child = spawn("tossctl", ["auth", "login"], {
      detached: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let errorOutput = "";
    child.stdout?.on("data", (d) => (output += d.toString()));
    child.stderr?.on("data", (d) => (errorOutput += d.toString()));

    const exitCode = await new Promise<number>((resolve) => {
      const timer = setTimeout(() => {
        child.kill();
        resolve(-1);
      }, 180000); // 3 min timeout
      child.on("exit", (code) => {
        clearTimeout(timer);
        resolve(code ?? 0);
      });
    });

    if (exitCode === 0) {
      // Best-effort: sync session to atlas if we're not atlas itself
      const hostname = (await execFileAsync("hostname", [])).stdout.trim();
      const isAtlas = /atlas|Mac-mini/i.test(hostname);
      if (!isAtlas) {
        try {
          await execFileAsync("scp", [
            `${process.env.HOME}/Library/Application Support/tossctl/session.json`,
            "atlas:~/Library/Application Support/tossctl/",
          ], { timeout: 10000 });
          await execFileAsync("ssh", [
            "atlas",
            "export PATH=/opt/homebrew/bin:/usr/local/bin:$PATH && ~/portfolio-admin/scripts/start-server.sh stop && ~/portfolio-admin/scripts/start-server.sh start",
          ], { timeout: 15000 });
        } catch {
          // Sync failed but local login succeeded - don't fail the request
        }
      }
      res.json({ ok: true, output, syncedToAtlas: !isAtlas });
    } else if (exitCode === -1) {
      res.status(408).json({ error: "로그인 타임아웃 (3분)" });
    } else {
      res.status(500).json({ error: errorOutput || output || "로그인 실패" });
    }
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// API: Check auth status
app.get("/api/auth/status", async (_req, res) => {
  try {
    await runTossctl(["account", "list"]);
    res.json({ ok: true });
  } catch (e: any) {
    res.json({ ok: false, error: e.message });
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
  // Save checkpoint on startup if within market close window or for initial data
  saveDailyCheckpoint();
});
