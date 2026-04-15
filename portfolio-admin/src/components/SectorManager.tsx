import { useRef, useState } from "react";
import type { Position } from "../types";
import type { SectorConfig } from "../hooks/usePortfolio";

interface Props {
  positions: Position[];
  sectorConfig: SectorConfig;
  onAddSector: (name: string) => Promise<void>;
  onDeleteSector: (name: string) => Promise<void>;
  onAssignSymbol: (sectorName: string, symbol: string) => Promise<void>;
  onRemoveSymbol: (sectorName: string, symbol: string) => Promise<void>;
}

export function SectorManager({
  positions,
  sectorConfig,
  onAddSector,
  onDeleteSector,
  onAssignSymbol,
  onRemoveSymbol,
}: Props) {
  const [newSectorName, setNewSectorName] = useState("");
  const [deleteToast, setDeleteToast] = useState<string | null>(null);
  const [dragSymbol, setDragSymbol] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  // Ref-based fallback in case dataTransfer is lost between events
  const dragDataRef = useRef<{ symbol: string; fromSector: string | null } | null>(null);

  const heldSymbols = new Set(positions.map((p) => p.symbol));
  const mappedSymbols = new Set(
    sectorConfig.sectors.flatMap((s) => s.symbols)
  );
  const unmapped = positions.filter((p) => !mappedSymbols.has(p.symbol));

  // Symbols assigned to sectors but no longer held
  const staleEntries = sectorConfig.sectors.flatMap((s) =>
    s.symbols
      .filter((sym) => !heldSymbols.has(sym))
      .map((sym) => ({ sector: s.name, symbol: sym }))
  );

  const handleCleanup = () => {
    for (const { sector, symbol } of staleEntries) {
      onRemoveSymbol(sector, symbol);
    }
  };

  const handleDragStart = (symbol: string, fromSector?: string) => (e: React.DragEvent) => {
    dragDataRef.current = { symbol, fromSector: fromSector ?? null };
    e.dataTransfer.setData("text/plain", `${symbol}|${fromSector ?? ""}`);
    e.dataTransfer.effectAllowed = "move";
    // Defer state update to next frame: synchronous setState here triggers a
    // re-render that mutates the source element's CSS (scale-95 transform)
    // during dragstart, which causes Chrome to silently cancel the drag when
    // the source chip is inside its own drop target (sector div).
    requestAnimationFrame(() => setDragSymbol(symbol));
  };

  const handleDragEnter = (sectorName: string) => (e: React.DragEvent) => {
    e.preventDefault();
    setDropTarget(sectorName);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleDragLeave = (sectorName: string) => (e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node) && dropTarget === sectorName) {
      setDropTarget(null);
    }
  };

  const handleDrop = (sectorName: string) => (e: React.DragEvent) => {
    e.preventDefault();
    const raw = e.dataTransfer.getData("text/plain");
    const [rawSymbol, rawFrom] = raw.split("|");
    // Fallback to ref if dataTransfer returns empty (some browsers/contexts)
    const symbol = rawSymbol || dragDataRef.current?.symbol || "";
    const fromSector = rawFrom || dragDataRef.current?.fromSector || "";
    if (symbol && sectorName !== fromSector) {
      onAssignSymbol(sectorName, symbol);
    }
    dragDataRef.current = null;
    setDragSymbol(null);
    setDropTarget(null);
  };

  const handleDragEnd = () => {
    dragDataRef.current = null;
    setDragSymbol(null);
    setDropTarget(null);
  };

  return (
    <>
      <div className="bg-gray-800/60 backdrop-blur border border-gray-700/50 rounded-2xl p-5">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-white">섹터 관리</h2>
        </div>

        {/* Add new sector */}
        <div className="flex gap-2 mb-4">
          <input
            type="text"
            placeholder="새 섹터 이름..."
            value={newSectorName}
            onChange={(e) => setNewSectorName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newSectorName.trim()) {
                onAddSector(newSectorName.trim());
                setNewSectorName("");
              }
            }}
            className="flex-1 bg-gray-700/50 border border-gray-600/50 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500/50"
          />
          <button
            onClick={() => {
              if (newSectorName.trim()) {
                onAddSector(newSectorName.trim());
                setNewSectorName("");
              }
            }}
            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg transition-colors"
          >
            추가
          </button>
        </div>

        {/* Stale symbols cleanup banner */}
        {staleEntries.length > 0 && (
          <div className="mb-4 px-3 py-2.5 bg-rose-900/20 border border-rose-700/30 rounded-lg flex items-center justify-between gap-3">
            <p className="text-xs text-rose-400">
              미보유 종목 {staleEntries.length}개가 섹터에 남아 있습니다 ({staleEntries.map((e) => e.symbol).join(", ")})
            </p>
            <button
              onClick={handleCleanup}
              className="shrink-0 px-2.5 py-1 bg-rose-700/40 hover:bg-rose-600/50 text-rose-200 text-xs rounded-lg transition-colors whitespace-nowrap"
            >
              클린업
            </button>
          </div>
        )}

        {/* Unmapped stocks */}
        {unmapped.length > 0 && (
          <div className="mb-4 px-3 py-2.5 bg-amber-900/20 border border-amber-700/30 rounded-lg">
            <p className="text-xs text-amber-400 mb-2">
              매핑 필요 ({unmapped.length}) — 드래그하여 섹터에 놓기
            </p>
            <div className="flex flex-wrap gap-1.5">
              {unmapped.map((p) => (
                <span
                  key={p.symbol}
                  draggable
                  onDragStart={handleDragStart(p.symbol)}
                  onDragEnd={handleDragEnd}
                  className={`text-xs px-2 py-1 rounded font-mono cursor-grab active:cursor-grabbing select-none transition-all ${
                    dragSymbol === p.symbol
                      ? "bg-blue-600 text-white scale-105 opacity-70"
                      : "bg-amber-800/30 text-amber-300 hover:bg-amber-700/40"
                  }`}
                >
                  {p.symbol}
                </span>
              ))}
            </div>
          </div>
        )}

        {dragSymbol && (
          <p className="text-xs text-blue-400 mb-2 text-center animate-pulse">
            {dragSymbol}을(를) 섹터에 드롭하세요
          </p>
        )}

        {/* Sector grid */}
        <div className="grid grid-cols-2 xl:grid-cols-3 gap-2">
          {sectorConfig.sectors.map((sec) => (
            <div
              key={sec.name}
              onDragEnter={handleDragEnter(sec.name)}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave(sec.name)}
              onDrop={handleDrop(sec.name)}
              className={`rounded-lg px-3 py-2.5 transition-all ${
                dropTarget === sec.name
                  ? "bg-blue-600/20 border-2 border-blue-500/50 border-dashed"
                  : "bg-gray-700/30 border-2 border-transparent"
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-sm font-medium text-white">{sec.name}</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">{sec.symbols.length}종목</span>
                  <button
                    onClick={() => setDeleteToast(sec.name)}
                    className="text-xs text-gray-600 hover:text-rose-400 transition-colors leading-none"
                    title={`${sec.name} 섹터 삭제`}
                  >
                    ×
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap gap-1">
                {sec.symbols.map((sym) => {
                  const held = positions.some((p) => p.symbol === sym);
                  return (
                    <span
                      key={sym}
                      draggable
                      onDragStart={handleDragStart(sym, sec.name)}
                      onDragEnd={handleDragEnd}
                      className={`text-[10px] px-1.5 py-0.5 rounded font-mono select-none cursor-grab active:cursor-grabbing transition-all ${
                        held ? "bg-gray-600/50 text-gray-300" : "bg-gray-700/50 text-gray-500"
                      } ${dragSymbol === sym ? "opacity-40 scale-95" : "hover:brightness-125"}`}
                    >
                      {sym}
                    </span>
                  );
                })}
                {dropTarget === sec.name && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded font-mono bg-blue-500/30 text-blue-300 border border-dashed border-blue-500/50">
                    {dragSymbol} 여기에 놓기
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Delete confirmation toast */}
      {deleteToast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-5 py-3 bg-gray-800 border border-gray-600/50 rounded-2xl shadow-2xl text-sm">
          <span className="text-gray-200">
            <span className="font-semibold text-white">"{deleteToast}"</span> 섹터를 삭제할까요?
          </span>
          <button
            onClick={() => {
              onDeleteSector(deleteToast);
              setDeleteToast(null);
            }}
            className="px-3 py-1 bg-rose-600 hover:bg-rose-500 text-white rounded-lg transition-colors"
          >
            삭제
          </button>
          <button
            onClick={() => setDeleteToast(null)}
            className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg transition-colors"
          >
            취소
          </button>
        </div>
      )}
    </>
  );
}
