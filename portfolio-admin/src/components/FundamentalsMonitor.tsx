import { Fragment, memo, useEffect, useState } from "react";
import type { Position } from "../types";

type FundamentalStatus = "netDebtBurn" | "runwayAlert" | "runwayWatch" | "burnOk" | "compounder";

interface FcfYear {
  fy: string;
  cfo: number | null;
  capex: number | null;
  fcf: number | null;
  margin: number | null;
}

interface Row {
  symbol: string;
  currency: string;
  fcfTTM: number | null;
  netCash: number | null;
  runwayYears: number | null;
  fcfYield: number | null;
  fcfMargin: number | null;
  fcfCagr3y: number | null;
  status: FundamentalStatus;
  years?: FcfYear[];
}

interface Data {
  asOf: string;
  rows: Row[];
  failed: string[];
}

const STATUS_INFO: Record<FundamentalStatus, { text: string; cls: string }> = {
  netDebtBurn: { text: "순부채 번", cls: "text-rose-400 bg-rose-500/10" },
  runwayAlert: { text: "런웨이 경보", cls: "text-rose-400 bg-rose-500/10" },
  runwayWatch: { text: "런웨이 주의", cls: "text-amber-400 bg-amber-500/10" },
  burnOk: { text: "번 (여유)", cls: "text-gray-400 bg-white/[0.05]" },
  compounder: { text: "FCF 흑자", cls: "text-emerald-400 bg-emerald-500/10" },
};

function fmtB(v: number | null, currency: string): string {
  if (v == null) return "—";
  const abs = Math.abs(v);
  const num = abs >= 1e9 ? (v / 1e9).toFixed(1) + "B" : (v / 1e6).toFixed(0) + "M";
  return (currency === "USD" ? "$" : currency ? currency + " " : "") + num;
}

function pct(v: number | null): string {
  return v == null ? "—" : (v * 100).toFixed(1) + "%";
}

export const FundamentalsMonitor = memo(function FundamentalsMonitor({ positions }: { positions: Position[] }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/fundamentals")
      .then((r) => r.json())
      .then((d) => (d && !d.error ? setData(d) : setError(true)))
      .catch(() => setError(true));
  }, []);

  if (error) return null;
  if (!data) {
    return (
      <div className="bg-white/[0.05] backdrop-blur border border-white/[0.08] rounded-2xl p-5 h-full">
        <h2 className="text-base font-semibold text-white mb-3">펀더멘털 모니터</h2>
        <p className="text-xs text-gray-500 py-8 text-center">
          FCF·런웨이 수집 중... (최초 1회 ~1분, 이후 주 1회 자동 갱신)
        </p>
      </div>
    );
  }

  // 매도한 종목은 즉시 제외 (펀더멘털 캐시는 주 1회지만 보유 여부는 실시간 스냅샷 기준)
  const held = new Set(positions.map((p) => p.symbol));
  const rows = data.rows.filter((r) => held.has(r.symbol));
  const alerts = rows.filter((r) => r.status === "netDebtBurn" || r.status === "runwayAlert").length;

  return (
    <div className="bg-white/[0.05] backdrop-blur border border-white/[0.08] rounded-2xl overflow-hidden h-full flex flex-col">
      <div className="px-5 pt-4 pb-3 flex items-baseline justify-between">
        <h2 className="text-base font-semibold text-white">펀더멘털 모니터</h2>
        <span className="text-xs text-gray-600">
          {alerts > 0 && <span className="text-rose-400 mr-2">경보 {alerts}건</span>}
          stockanalysis · 주 1회 · {data.asOf}
        </span>
      </div>
      <div className="border-t border-white/[0.08] flex-1 overflow-y-auto max-h-[420px]">
        <table className="w-full text-[13px]">
          <thead className="sticky top-0 bg-gray-950/90 backdrop-blur">
            <tr className="text-xs text-gray-500">
              <th className="text-left font-normal px-5 py-2">종목</th>
              <th className="text-right font-normal px-2 py-2">FCF(TTM)</th>
              <th className="text-right font-normal px-2 py-2">순현금</th>
              <th className="text-right font-normal px-2 py-2">런웨이·수익률</th>
              <th className="text-right font-normal px-2 py-2">마진</th>
              <th className="text-right font-normal px-5 py-2">상태</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const info = STATUS_INFO[r.status];
              const isBurn = r.fcfTTM != null && r.fcfTTM < 0;
              const isOpen = open === r.symbol;
              return (
                <Fragment key={r.symbol}>
                <tr
                  className="border-t border-white/[0.04] cursor-pointer hover:bg-white/[0.02] transition-colors"
                  onClick={() => setOpen(isOpen ? null : r.symbol)}
                >
                  <td className="px-5 py-2 font-medium text-gray-300">
                    <span className={`inline-block mr-1 text-gray-600 transition-transform ${isOpen ? "rotate-90" : ""}`}>▸</span>
                    {r.symbol}
                    {r.currency !== "USD" && <span className="ml-1 text-[10px] text-gray-600">{r.currency}</span>}
                  </td>
                  <td className={`px-2 py-2 text-right tabular-nums ${isBurn ? "text-rose-400" : "text-gray-300"}`}>
                    {fmtB(r.fcfTTM, r.currency)}
                  </td>
                  <td className={`px-2 py-2 text-right tabular-nums ${r.netCash != null && r.netCash < 0 ? "text-rose-400" : "text-gray-400"}`}>
                    {fmtB(r.netCash, r.currency)}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-gray-300">
                    {isBurn
                      ? r.runwayYears != null ? r.runwayYears.toFixed(1) + "년" : "—"
                      : pct(r.fcfYield)}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-gray-400">{pct(r.fcfMargin)}</td>
                  <td className="px-5 py-2 text-right">
                    <span className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${info.cls}`}>{info.text}</span>
                  </td>
                </tr>
                {isOpen && r.years && (
                  <tr className="border-t border-white/[0.04]">
                    <td colSpan={6} className="px-5 py-3 bg-white/[0.02]">
                      {/* 연도별 FCF 표 — 연도를 열로 (stockanalysis 스타일) */}
                      <div className="overflow-x-auto">
                        <table className="text-xs tabular-nums">
                          <thead>
                            <tr className="text-gray-500">
                              <th className="text-left font-normal pr-4 py-1">({r.currency})</th>
                              {r.years.map((y) => (
                                <th key={y.fy} className="text-right font-medium px-3 py-1 text-gray-400">{y.fy}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            <tr>
                              <td className="pr-4 py-1 text-gray-500">영업현금흐름</td>
                              {r.years.map((y) => (
                                <td key={y.fy} className="text-right px-3 py-1 text-gray-300">{fmtB(y.cfo, "")}</td>
                              ))}
                            </tr>
                            <tr>
                              <td className="pr-4 py-1 text-gray-500">CapEx</td>
                              {r.years.map((y) => (
                                <td key={y.fy} className="text-right px-3 py-1 text-gray-400">{fmtB(y.capex, "")}</td>
                              ))}
                            </tr>
                            <tr className="border-t border-white/[0.06]">
                              <td className="pr-4 py-1 text-gray-300 font-medium">FCF</td>
                              {r.years.map((y) => (
                                <td key={y.fy} className={`text-right px-3 py-1 font-semibold ${y.fcf != null && y.fcf < 0 ? "text-rose-400" : "text-emerald-400"}`}>
                                  {fmtB(y.fcf, "")}
                                </td>
                              ))}
                            </tr>
                            <tr>
                              <td className="pr-4 py-1 text-gray-500">FCF 마진</td>
                              {r.years.map((y) => (
                                <td key={y.fy} className={`text-right px-3 py-1 ${y.margin != null && y.margin < 0 ? "text-rose-400/80" : "text-gray-400"}`}>
                                  {pct(y.margin)}
                                </td>
                              ))}
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </td>
                  </tr>
                )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="px-5 py-3 text-xs text-gray-600 border-t border-white/[0.08]">
        런웨이 = 순현금 ÷ 연간 FCF 소진. 1.5년 미만 경보(증자 리스크 — 매도원칙 사다리 1순위), 순부채 번은 편입원칙 위반.
        {data.failed.length > 0 && ` · 수집 실패: ${data.failed.join(", ")}`}
      </p>
    </div>
  );
});
