interface Props { value: number | null }

export function WilliamsGauge({ value }: Props) {
  if (value == null) return <span className="text-gray-500 text-[11px]">—</span>;
  const pct = Math.max(0, Math.min(100, ((value + 100) / 100) * 100));
  const color = value <= -80 ? "text-emerald-400" : value >= -20 ? "text-rose-400" : "text-amber-400";
  const label = value <= -80 ? "과매도" : value >= -20 ? "과매수" : "중립";
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[9px]">
        <span className="text-gray-500">-100 과매도</span>
        <span className={`font-mono font-bold ${color}`}>{value.toFixed(1)} <span className="opacity-70">{label}</span></span>
        <span className="text-gray-500">과매수 0</span>
      </div>
      <div className="relative h-1.5 w-full rounded-full overflow-hidden flex">
        <div className="w-[20%] bg-emerald-500/50" />
        <div className="w-[60%] bg-amber-400/20" />
        <div className="w-[20%] bg-rose-500/50" />
        <div className="absolute top-0 bottom-0 w-0.5 bg-white" style={{ left: `calc(${pct}% - 1px)` }} />
      </div>
    </div>
  );
}
