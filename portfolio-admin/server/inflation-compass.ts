// David Varadi의 Inflation Compass 국면 신호
// 성장: SPY > 200일 이동평균
// 인플레이션: T5YIE > 2.0% AND (60거래일 전 대비 상승 OR 인플레 수혜/피해 바스켓 모멘텀 양수)
// 참고: https://github.com/hyunyulhenry/inflation_compass

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';

const T5YIE_THRESHOLD = 2.0;
const SMA_DAYS = 200;
const MOMENTUM_DAYS = 60;

// 인플레이션 수혜 바스켓 / 피해 바스켓 (confirming indicator)
const POS_BASKET: Record<string, number> = { XLE: 0.5, XLI: 1 / 6, XLF: 1 / 6, XLB: 1 / 6 };
const NEG_BASKET: Record<string, number> = { XLU: 1 / 3, XLV: 1 / 3, XLP: 1 / 3 };

export type Quadrant = 'XLE' | 'XLK' | 'XLU' | 'DEFENSE';

const QUADRANT_INFO: Record<Quadrant, { label: string; position: string }> = {
  XLE: { label: '성장↑ · 인플레↑', position: 'XLE (에너지) 100%' },
  XLK: { label: '성장↑ · 인플레↓', position: 'XLK (기술) 100%' },
  XLU: { label: '성장↓ · 인플레↑', position: 'XLU (유틸리티) 100%' },
  DEFENSE: { label: '성장↓ · 인플레↓', position: 'XLP 50% + IEF 50%' },
};

async function fetchYahooCloses(symbol: string): Promise<Record<string, number>> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=2y`;
  const resp = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!resp.ok) throw new Error(`Yahoo ${symbol} failed (${resp.status})`);
  const json = await resp.json() as any;
  const result = json?.chart?.result?.[0];
  if (!result?.timestamp) throw new Error(`Yahoo ${symbol}: empty`);
  const closes: Array<number | null> =
    result.indicators?.adjclose?.[0]?.adjclose ?? result.indicators?.quote?.[0]?.close ?? [];
  const out: Record<string, number> = {};
  for (let i = 0; i < result.timestamp.length; i++) {
    if (closes[i] == null) continue;
    out[new Date(result.timestamp[i] * 1000).toISOString().split('T')[0]] = closes[i]!;
  }
  return out;
}

async function fetchT5yie(): Promise<Array<{ date: string; value: number }>> {
  const resp = await fetch('https://fred.stlouisfed.org/graph/fredgraph.csv?id=T5YIE', {
    headers: { 'User-Agent': UA },
  });
  if (!resp.ok) throw new Error(`FRED T5YIE failed (${resp.status})`);
  const csv = await resp.text();
  const rows: Array<{ date: string; value: number }> = [];
  for (const line of csv.split('\n').slice(1)) {
    const [date, raw] = line.trim().split(',');
    const value = parseFloat(raw);
    if (date && isFinite(value)) rows.push({ date, value });
  }
  return rows;
}

function linearSlope(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const xm = (n - 1) / 2;
  const ym = values.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xm) * (values[i] - ym);
    den += (i - xm) ** 2;
  }
  return den > 0 ? num / den : 0;
}

export async function computeInflationCompass() {
  const symbols = ['SPY', ...Object.keys(POS_BASKET), ...Object.keys(NEG_BASKET)];
  const closesBySymbol: Record<string, Record<string, number>> = {};
  for (const s of symbols) {
    closesBySymbol[s] = await fetchYahooCloses(s);
    await new Promise(r => setTimeout(r, 150));
  }
  const t5yieRows = await fetchT5yie();

  // 공통 거래일: SPY 기준
  const dates = Object.keys(closesBySymbol['SPY']).sort();
  if (dates.length < SMA_DAYS + 5) throw new Error('SPY 데이터 부족');

  // T5YIE를 거래일에 정렬 (해당일 없으면 직전값)
  const t5Map = new Map(t5yieRows.map(r => [r.date, r.value]));
  const t5Sorted = t5yieRows.map(r => r.date);
  let tIdx = 0;
  const t5ByDate: Record<string, number> = {};
  for (const d of dates) {
    while (tIdx + 1 < t5Sorted.length && t5Sorted[tIdx + 1] <= d) tIdx++;
    if (t5Sorted[tIdx] <= d) t5ByDate[d] = t5Map.get(t5Sorted[tIdx])!;
  }

  // 바스켓 누적수익률 비율 (confirming indicator)
  const ratio: number[] = [];
  const ratioDates: string[] = [];
  let posCum = 1, negCum = 1;
  for (let i = 1; i < dates.length; i++) {
    const d0 = dates[i - 1], d1 = dates[i];
    let posRet = 0, negRet = 0, ok = true;
    for (const [sym, w] of Object.entries(POS_BASKET)) {
      const a = closesBySymbol[sym][d0], b = closesBySymbol[sym][d1];
      if (!a || !b) { ok = false; break; }
      posRet += w * (b / a - 1);
    }
    if (ok) for (const [sym, w] of Object.entries(NEG_BASKET)) {
      const a = closesBySymbol[sym][d0], b = closesBySymbol[sym][d1];
      if (!a || !b) { ok = false; break; }
      negRet += w * (b / a - 1);
    }
    if (!ok) continue;
    posCum *= 1 + posRet;
    negCum *= 1 + negRet;
    ratio.push(posCum / negCum);
    ratioDates.push(d1);
  }
  const ratioIdxByDate = new Map(ratioDates.map((d, i) => [d, i]));

  // 일별 국면 계산 (T5YIE 시계열은 거래일 기준 60일 시프트)
  const t5Series = dates.map(d => t5ByDate[d]).filter((v): v is number => v != null);
  const t5SeriesDates = dates.filter(d => t5ByDate[d] != null);
  const t5IdxByDate = new Map(t5SeriesDates.map((d, i) => [d, i]));

  const spy = closesBySymbol['SPY'];
  const daily: Array<{
    date: string;
    quadrant: Quadrant;
    growthOn: boolean;
    inflationOn: boolean;
  }> = [];

  for (let i = SMA_DAYS - 1; i < dates.length; i++) {
    const d = dates[i];
    let sma = 0;
    for (let j = i - SMA_DAYS + 1; j <= i; j++) sma += spy[dates[j]];
    sma /= SMA_DAYS;
    const growthOn = spy[d] > sma;

    const ti = t5IdxByDate.get(d);
    if (ti == null || ti < MOMENTUM_DAYS) continue;
    const t5 = t5Series[ti];
    const levelOn = t5 > T5YIE_THRESHOLD;
    const breakevenOn = t5 > t5Series[ti - MOMENTUM_DAYS];

    const ri = ratioIdxByDate.get(d);
    if (ri == null || ri < MOMENTUM_DAYS) continue;
    const assetOn = linearSlope(ratio.slice(ri - MOMENTUM_DAYS + 1, ri + 1)) > 0;

    const inflationOn = levelOn && (breakevenOn || assetOn);
    const quadrant: Quadrant = growthOn ? (inflationOn ? 'XLE' : 'XLK') : (inflationOn ? 'XLU' : 'DEFENSE');
    daily.push({ date: d, quadrant, growthOn, inflationOn });
  }

  if (!daily.length) throw new Error('국면 계산 실패');
  const cur = daily[daily.length - 1];
  const curDate = cur.date;
  const ti = t5IdxByDate.get(curDate)!;
  const ri = ratioIdxByDate.get(curDate)!;
  let sma = 0;
  const i = dates.indexOf(curDate);
  for (let j = i - SMA_DAYS + 1; j <= i; j++) sma += spy[dates[j]];
  sma /= SMA_DAYS;

  // 최근 국면 전환 이력 (최대 6개)
  const transitions: Array<{ date: string; from: Quadrant; to: Quadrant }> = [];
  for (let k = 1; k < daily.length; k++) {
    if (daily[k].quadrant !== daily[k - 1].quadrant) {
      transitions.push({ date: daily[k].date, from: daily[k - 1].quadrant, to: daily[k].quadrant });
    }
  }

  return {
    asOf: curDate,
    quadrant: cur.quadrant,
    label: QUADRANT_INFO[cur.quadrant].label,
    position: QUADRANT_INFO[cur.quadrant].position,
    signals: {
      growthOn: cur.growthOn,
      spy: spy[curDate],
      sma200: sma,
      spyVsSma: spy[curDate] / sma - 1,
      inflationOn: cur.inflationOn,
      t5yie: t5Series[ti],
      t5yieLevelOn: t5Series[ti] > T5YIE_THRESHOLD,
      t5yie60Ago: t5Series[ti - MOMENTUM_DAYS],
      breakevenMomentumOn: t5Series[ti] > t5Series[ti - MOMENTUM_DAYS],
      assetMomentumOn: linearSlope(ratio.slice(ri - MOMENTUM_DAYS + 1, ri + 1)) > 0,
    },
    transitions: transitions.slice(-6),
    quadrants: QUADRANT_INFO,
  };
}
