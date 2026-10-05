// 보유 개별 종목의 FCF·순현금·런웨이 자동 추적 (stockanalysis.com, 주 1회 갱신)
// 매도원칙 사다리 1순위(펀더멘털 악화)를 자동 감시: 런웨이 <1.5년 경보, 순부채 번 위반
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '../data');

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36';

// ETF·레버리지는 펀더멘털 분석 대상 아님
const ETF_SET = new Set([
  'SCHD', 'QLD', 'SMH', 'URA', 'ITA', 'REMX', 'ETHU', 'BITU', 'BITO',
  'TQQQ', 'ULTY', 'DRAM', 'CONL', 'PTIR', 'KMLM', 'NVDL', 'QQQ',
]);

export type FundamentalStatus = 'netDebtBurn' | 'runwayAlert' | 'runwayWatch' | 'burnOk' | 'compounder';

export interface FcfYear {
  fy: string;          // "TTM" 또는 회계연도
  cfo: number | null;
  capex: number | null;
  fcf: number | null;
  margin: number | null;
}

export interface SymbolFundamentals {
  symbol: string;
  currency: string;        // 재무제표 통화 (USD 아니면 금액 해석 주의)
  fcfTTM: number | null;   // 재무 통화 기준
  netCash: number | null;
  runwayYears: number | null; // 통화 무관 (동일 통화 비율)
  fcfYield: number | null;    // statistics 페이지 — 통화 안전
  fcfMargin: number | null;
  fcfCagr3y: number | null;
  status: FundamentalStatus;
  years: FcfYear[];        // 최신(TTM)부터 과거 순
}

function arr(html: string, key: string): Array<number | null> | null {
  const m = html.match(new RegExp(key + ':\\[([^\\]]*)\\]'));
  return m ? m[1].split(',').map(v => (v === 'null' ? null : parseFloat(v))) : null;
}

function strArr(html: string, key: string): string[] | null {
  const m = html.match(new RegExp(key + ':\\[([^\\]]*)\\]'));
  return m ? m[1].split(',').map(v => v.replace(/"/g, '')) : null;
}

async function fetchText(url: string): Promise<string> {
  const resp = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!resp.ok) throw new Error(`${url} → ${resp.status}`);
  return resp.text();
}

async function fetchSymbol(symbol: string): Promise<SymbolFundamentals | null> {
  const base = `https://stockanalysis.com/stocks/${symbol.toLowerCase()}`;
  const cf = await fetchText(`${base}/financials/cash-flow-statement/`);
  await new Promise(r => setTimeout(r, 350));
  const bs = await fetchText(`${base}/financials/balance-sheet/`);
  await new Promise(r => setTimeout(r, 350));
  const stat = await fetchText(`${base}/statistics/`);
  await new Promise(r => setTimeout(r, 350));

  const cfo = arr(cf, 'cfo');
  const capex = arr(cf, 'capex');
  const margin = arr(cf, 'fcfMargin');
  const netcash = arr(bs, 'netcash');
  const fiscalYears = strArr(cf, 'fiscalYear');
  const fiscalQuarters = strArr(cf, 'fiscalQuarter');
  if (!cfo || !capex) return null;

  const currency = cf.match(/financial:"([A-Z]{3})"/)?.[1] ?? 'USD';
  const fcf = cfo.map((v, i) => (v == null || capex[i] == null ? null : v + capex[i]!));
  const fcfTTM = fcf[0] ?? null;
  const netCash = netcash?.[0] ?? null;

  const fy = fcf.slice(1).filter((v): v is number => v != null);
  // 3년 CAGR 우선, 기저가 음수·결측이면 측정 가능한 최장 구간(2년→1년)으로 폴백
  let fcfCagr3y: number | null = null;
  for (const k of [3, 2, 1]) {
    if (fy.length > k && fy[0] > 0 && fy[k] > 0) {
      fcfCagr3y = Math.pow(fy[0] / fy[k], 1 / k) - 1;
      break;
    }
  }

  const yieldStr = stat.match(/fcfYield",title:"[^"]*",value:"([^"]*)"/)?.[1];
  const fcfYield = yieldStr && yieldStr !== 'n/a' ? parseFloat(yieldStr) / 100 : null;

  const runwayYears = fcfTTM != null && fcfTTM < 0 && netCash != null && netCash > 0
    ? netCash / -fcfTTM
    : null;

  let status: FundamentalStatus;
  if (fcfTTM != null && fcfTTM < 0) {
    if (netCash != null && netCash <= 0) status = 'netDebtBurn';
    else if (runwayYears != null && runwayYears < 1.5) status = 'runwayAlert';
    else if (runwayYears != null && runwayYears < 2.5) status = 'runwayWatch';
    else status = 'burnOk';
  } else {
    status = 'compounder';
  }

  // 연도별 표 (idx 0 = TTM, 이후 회계연도)
  const years: FcfYear[] = fcf.map((v, i) => ({
    fy: i === 0 ? 'TTM' : `FY${fiscalYears?.[i] ?? '?'}${fiscalQuarters?.[i] && fiscalQuarters[i] !== 'Q4' ? ` (${fiscalQuarters[i]})` : ''}`,
    cfo: cfo[i] ?? null,
    capex: capex[i] ?? null,
    fcf: v,
    margin: margin?.[i] ?? null,
  }));

  return { symbol, currency, fcfTTM, netCash, runwayYears, fcfYield, fcfMargin: margin?.[0] ?? null, fcfCagr3y, status, years };
}

export async function computeFundamentals() {
  // 보유 개별 종목 = 주문 캐시 리플레이 기준 현재 보유 중 비ETF
  const raw = JSON.parse(await fs.readFile(path.join(DATA_DIR, 'orders-cache.json'), 'utf-8'));
  const qty: Record<string, number> = {};
  for (const o of (raw.orders as Array<{ symbol: string; side: string; filledQuantity: number; filledAt: string }>)
    .sort((a, b) => a.filledAt.localeCompare(b.filledAt))) {
    if (o.side === 'BUY') qty[o.symbol] = (qty[o.symbol] ?? 0) + o.filledQuantity;
    else {
      qty[o.symbol] = (qty[o.symbol] ?? 0) - o.filledQuantity;
      if (qty[o.symbol] <= 0.0001) delete qty[o.symbol];
    }
  }
  const symbols = Object.keys(qty).filter(s => !ETF_SET.has(s) && s !== 'GTIJF').sort();

  const rows: SymbolFundamentals[] = [];
  const failed: string[] = [];
  for (const s of symbols) {
    try {
      const r = await fetchSymbol(s);
      if (r) rows.push(r);
      else failed.push(s);
    } catch {
      failed.push(s);
    }
  }

  const order: Record<FundamentalStatus, number> = { netDebtBurn: 0, runwayAlert: 1, runwayWatch: 2, burnOk: 3, compounder: 4 };
  rows.sort((a, b) => order[a.status] - order[b.status] || a.symbol.localeCompare(b.symbol));

  return { asOf: new Date().toISOString().split('T')[0], rows, failed };
}
