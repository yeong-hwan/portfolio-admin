import { useState, useCallback, useEffect } from "react";
import type { Snapshot, Checkpoint } from "../types";

const API = "/api";

export interface ExchangeRate {
  rate: number;
  timestamp: string;
}

export interface SectorConfig {
  sectors: { name: string; symbols: string[] }[];
}

export function usePortfolio() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [exchangeRate, setExchangeRate] = useState<ExchangeRate | null>(null);
  const [sectorConfig, setSectorConfig] = useState<SectorConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const fetchSnapshot = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API}/snapshot`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setSnapshot(data);
      setLastRefresh(new Date());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchCheckpoints = useCallback(async () => {
    try {
      const res = await fetch(`${API}/checkpoints`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setCheckpoints(data);
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  const fetchExchangeRate = useCallback(async () => {
    try {
      const res = await fetch(`${API}/exchange-rate`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setExchangeRate(data);
    } catch {
      // non-critical
    }
  }, []);

  const fetchSectors = useCallback(async () => {
    try {
      const res = await fetch(`${API}/sectors`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setSectorConfig(data);
    } catch {
      // non-critical
    }
  }, []);

  const addSector = useCallback(async (name: string) => {
    setSectorConfig((prev) => {
      if (!prev) return { sectors: [{ name, symbols: [] }] };
      return { sectors: [...prev.sectors, { name, symbols: [] }] };
    });
    // Fire-and-forget persistence (no state update from response)
    fetch(`${API}/sectors`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }).catch(() => {});
  }, []);

  const deleteSector = useCallback(async (name: string) => {
    setSectorConfig((prev) => {
      if (!prev) return prev;
      return { sectors: prev.sectors.filter((s) => s.name !== name) };
    });
    fetch(`${API}/sectors/${encodeURIComponent(name)}`, {
      method: "DELETE",
    }).catch(() => {});
  }, []);

  const assignSymbol = useCallback(async (sectorName: string, symbol: string) => {
    setSectorConfig((prev) => {
      if (!prev) return prev;
      return {
        sectors: prev.sectors.map((s) => ({
          ...s,
          symbols: s.name === sectorName
            ? [...s.symbols.filter((sym) => sym !== symbol), symbol]
            : s.symbols.filter((sym) => sym !== symbol),
        })),
      };
    });
    fetch(`${API}/sectors/${encodeURIComponent(sectorName)}/symbols`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol }),
    }).catch(() => {});
  }, []);

  const removeSymbol = useCallback(async (sectorName: string, symbol: string) => {
    setSectorConfig((prev) => {
      if (!prev) return prev;
      return {
        sectors: prev.sectors.map((s) =>
          s.name === sectorName
            ? { ...s, symbols: s.symbols.filter((sym) => sym !== symbol) }
            : s
        ),
      };
    });
    fetch(
      `${API}/sectors/${encodeURIComponent(sectorName)}/symbols/${encodeURIComponent(symbol)}`,
      { method: "DELETE" }
    ).catch(() => {});
  }, []);

  useEffect(() => {
    fetchSnapshot();
    fetchCheckpoints();
    fetchExchangeRate();
    fetchSectors();
  }, [fetchSnapshot, fetchCheckpoints, fetchExchangeRate, fetchSectors]);

  return {
    snapshot,
    checkpoints,
    exchangeRate,
    sectorConfig,
    loading,
    error,
    lastRefresh,
    refresh: () => {
      fetchSnapshot();
      fetchExchangeRate();
    },
    addSector,
    deleteSector,
    assignSymbol,
    removeSymbol,
  };
}
