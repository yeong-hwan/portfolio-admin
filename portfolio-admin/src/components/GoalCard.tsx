import { memo, useEffect, useState } from "react";

interface Goal {
  targetKrw: number;
  monthlySavingKrw: number;
}

function fmtMan(n: number): string {
  return Math.round(n / 10000).toLocaleString("ko-KR") + "만";
}

// 월 단위 시뮬레이션: 연수익률 r 가정 하에 목표 도달 시점
function projectMonths(current: number, target: number, monthly: number, annualReturn: number): number | null {
  if (current >= target) return 0;
  const mr = Math.pow(1 + annualReturn, 1 / 12);
  let asset = current;
  for (let m = 1; m <= 240; m++) {
    asset = asset * mr + monthly;
    if (asset >= target) return m;
  }
  return null;
}

function monthLabel(monthsFromNow: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + monthsFromNow);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}`;
}

interface Props {
  totalAsset: number;
}

export const GoalCard = memo(function GoalCard({ totalAsset }: Props) {
  const [goal, setGoal] = useState<Goal | null>(null);
  const [editing, setEditing] = useState(false);
  const [draftTarget, setDraftTarget] = useState("");
  const [draftMonthly, setDraftMonthly] = useState("");

  useEffect(() => {
    fetch("/api/goal")
      .then((r) => r.json())
      .then(setGoal)
      .catch(() => {});
  }, []);

  if (!goal) return null;

  const progress = Math.min(totalAsset / goal.targetKrw, 1);
  const remaining = Math.max(goal.targetKrw - totalAsset, 0);
  const m0 = projectMonths(totalAsset, goal.targetKrw, goal.monthlySavingKrw, 0);
  const m8 = projectMonths(totalAsset, goal.targetKrw, goal.monthlySavingKrw, 0.08);

  async function save() {
    const targetKrw = Math.round(parseFloat(draftTarget) * 10000);
    const monthlySavingKrw = Math.round(parseFloat(draftMonthly) * 10000);
    if (!targetKrw || targetKrw <= 0) return;
    const res = await fetch("/api/goal", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetKrw, monthlySavingKrw: monthlySavingKrw || 0 }),
    });
    if (res.ok) setGoal(await res.json());
    setEditing(false);
  }

  return (
    <div className="bg-white/[0.05] backdrop-blur border border-white/[0.08] rounded-2xl px-5 py-4">
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-baseline gap-2">
          <h2 className="text-sm font-semibold text-white">목표 {fmtMan(goal.targetKrw)}</h2>
          <span className="text-xs text-gray-500">월 {fmtMan(goal.monthlySavingKrw)} 적립 가정</span>
        </div>
        <div className="flex items-baseline gap-3">
          <span className="text-sm font-bold text-white">{(progress * 100).toFixed(1)}%</span>
          <button
            onClick={() => {
              setDraftTarget(String(goal.targetKrw / 10000));
              setDraftMonthly(String(goal.monthlySavingKrw / 10000));
              setEditing((e) => !e);
            }}
            className="text-[10px] text-gray-600 hover:text-gray-300 transition-colors"
          >
            편집
          </button>
        </div>
      </div>

      <div className="h-2.5 bg-white/[0.06] rounded-full overflow-hidden">
        <div
          className="h-full rounded-full bg-gradient-to-r from-blue-500 to-violet-500 transition-all duration-500"
          style={{ width: `${Math.max(progress * 100, 1)}%` }}
        />
      </div>

      <div className="mt-2.5 flex items-center justify-between text-[11px] text-gray-500">
        <span>
          현재 {fmtMan(totalAsset)} · 남은 금액 <span className="text-gray-300">{fmtMan(remaining)}</span>
        </span>
        <span>
          도달 예상{" "}
          <span className="text-gray-300">
            {m0 === 0 ? "달성!" : m0 != null ? monthLabel(m0) : "20년+"}
          </span>
          <span className="text-gray-600"> (수익 0%)</span>
          {" · "}
          <span className="text-gray-300">{m8 === 0 ? "달성!" : m8 != null ? monthLabel(m8) : "20년+"}</span>
          <span className="text-gray-600"> (연 8%)</span>
        </span>
      </div>

      {editing && (
        <div className="mt-3 flex items-center gap-2 text-xs">
          <input
            value={draftTarget}
            onChange={(e) => setDraftTarget(e.target.value)}
            placeholder="목표 (만원)"
            className="w-28 bg-gray-900/60 border border-white/[0.08] rounded-lg px-2.5 py-1.5 text-white focus:outline-none focus:border-blue-500/50"
          />
          <input
            value={draftMonthly}
            onChange={(e) => setDraftMonthly(e.target.value)}
            placeholder="월 적립 (만원)"
            className="w-28 bg-gray-900/60 border border-white/[0.08] rounded-lg px-2.5 py-1.5 text-white focus:outline-none focus:border-blue-500/50"
          />
          <button onClick={save} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded-lg text-white transition-colors">
            저장
          </button>
        </div>
      )}
    </div>
  );
});
