const TRANCHE_ZONES = [
  { label: "정상", min: 0,  max: 3,  color: "bg-gray-600" },
  { label: "1차",  min: 3,  max: 5,  color: "bg-emerald-300/70" },
  { label: "2차",  min: 5,  max: 8,  color: "bg-emerald-500/70" },
  { label: "3차",  min: 8,  max: 12, color: "bg-amber-400/80" },
  { label: "4차",  min: 12, max: 20, color: "bg-orange-400/80" },
  { label: "5차",  min: 20, max: 35, color: "bg-rose-500/80" },
];

interface Props { drop: number }

export function DropMeter({ drop }: Props) {
  const abs = Math.abs(drop);
  const activeZone = [...TRANCHE_ZONES].reverse().find(z => abs >= z.min);

  return (
    <div className="space-y-2">
      <div className="flex items-end gap-1 h-10">
        {TRANCHE_ZONES.map((z, i) => {
          const fill = abs >= z.min ? Math.min(1, (abs - z.min) / (z.max - z.min)) * 100 : 0;
          return (
            <div key={i} className="flex-1 flex flex-col justify-end gap-0.5">
              <div className="relative h-8 bg-white/[0.04] rounded-sm overflow-hidden">
                <div className={`absolute bottom-0 left-0 right-0 ${z.color} transition-all`} style={{ height: `${fill}%` }} />
              </div>
              <span className="text-[8px] text-center text-gray-500">{z.label}</span>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-gray-400 text-center">
        현재 낙폭 <span className="font-mono font-bold text-white">{drop.toFixed(1)}%</span>
        {activeZone && activeZone.label !== "정상" && (
          <span className="ml-2 text-amber-400">→ {activeZone.label} 진입 구간</span>
        )}
      </p>
    </div>
  );
}
