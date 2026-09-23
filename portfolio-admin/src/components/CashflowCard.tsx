import { memo, useEffect, useState } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";

interface Cashflow {
  firstOrderDate: string;
  lastOrderDate: string;
  orderCount: number;
  totalBuyKrw: number;
  totalSellKrw: number;
  inferredDepositKrw: number;
  reinvestedKrw: number;
  residualCashKrw: number;
  deposits: Array<{ date: string; amountKrw: number }>;
  monthly: Array<{ month: string; amountKrw: number }>;
}

function fmt(n: number): string {
  return Math.round(n).toLocaleString("ko-KR");
}

function fmtMan(n: number): string {
  return Math.round(n / 10000).toLocaleString("ko-KR") + "만";
}

interface Props {
  totalAsset: number;
}

export const CashflowCard = memo(function CashflowCard({ totalAsset }: Props) {
  const [data, setData] = useState<Cashflow | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch("/api/cashflow")
      .then((r) => r.json())
      .then((d) => (d && !d.error ? setData(d) : setError(true)))
      .catch(() => setError(true));
  }, []);

  if (error) return null;
  if (!data) {
    return (
      <div className="bg-white/[0.05] backdrop-blur border border-white/[0.08] rounded-2xl p-5">
        <p className="text-xs text-gray-500">현금 흐름 분석 로딩 중...</p>
      </div>
    );
  }

  const deposit = data.inferredDepositKrw;
  const realReturn = deposit > 0 ? (totalAsset + data.residualCashKrw - deposit) / deposit : 0;
  const retPositive = realReturn >= 0;
  const retColor = retPositive ? "text-emerald-400" : "text-rose-400";
  const retSign = retPositive ? "+" : "";


  return (
    <div className="bg-white/[0.05] backdrop-blur border border-white/[0.08] rounded-2xl overflow-hidden">
      <div className="px-5 pt-4 pb-3 flex items-baseline justify-between">
        <h2 className="text-base font-semibold text-white">현금 흐름 · 투자 원금</h2>
        <span className="text-[10px] text-gray-600">
          주문 이력 {data.orderCount.toLocaleString()}건 기반 추정 ({data.firstOrderDate} ~)
        </span>
      </div>

      {/* 요약 지표 */}
      <div className="grid grid-cols-2 divide-x divide-white/[0.08] border-y border-white/[0.08]">
        <div className="px-5 py-3">
          <p className="text-[10px] text-gray-400 uppercase tracking-widest mb-1">투자 원금 (추정)</p>
          <p className="text-sm lg:text-base font-bold text-white">₩ {fmt(deposit)}</p>
        </div>
        <div className="px-5 py-3">
          <p className="text-[10px] text-gray-400 uppercase tracking-widest mb-1">투자 원금 기준 수익률</p>
          <p className={`text-sm lg:text-base font-bold ${retColor}`}>
            {retSign}{(realReturn * 100).toFixed(2)}%
          </p>
        </div>
      </div>

      {/* 월별 추정 입금 타임라인 */}
      <div className="px-5 py-4">
        <p className="text-xs text-gray-400 mb-3">월별 추정 현금 투입</p>
        <div className="h-52">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.monthly} margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
              <XAxis
                dataKey="month"
                tick={{ fill: "#6b7280", fontSize: 10 }}
                tickFormatter={(m: string) => m.slice(2).replace("-", "/")}
                minTickGap={20}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: "#6b7280", fontSize: 10 }}
                tickFormatter={(v: number) => Math.round(v / 10000).toLocaleString() + "만"}
                width={48}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                cursor={{ fill: "rgba(255,255,255,0.04)" }}
                contentStyle={{
                  background: "#111827",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: "0.75rem",
                  fontSize: "12px",
                }}
                labelStyle={{ color: "#9ca3af" }}
                formatter={(v) => [`₩ ${fmt(Number(v))} (${fmtMan(Number(v))})`, "추정 투입"]}
              />
              <Bar dataKey="amountKrw" fill="#3b82f6" fillOpacity={0.75} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-3 text-[10px] text-gray-600 leading-relaxed">
          매수·매도 체결을 시간순으로 재생해 현금 잔고가 음수가 되는 시점을 외부 입금으로 추정.
          배당금·이자·출금·환전 시차는 주문 API에 없어 반영되지 않으며, 실제 이체 내역과 다를 수 있음.
        </p>
      </div>
    </div>
  );
});
