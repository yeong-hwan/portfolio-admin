// 시장 환경 지표: 매크로(FRED) / 수급(CFTC COT, CNN Fear&Greed, VIX 구조) / 지정학(GPR + 시장 대리 지표)
import * as XLSX from 'xlsx';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export interface SeriesPoint { date: string; value: number }

export interface Indicator {
  id: string;
  label: string;
  unit: string;
  value: number;
  chg1m: number; // 1개월 전 대비 변화 (unit 기준)
  series: SeriesPoint[]; // 스파크라인용 (주간 샘플, ~2년)
}

// --- 공통 fetch 헬퍼 ---

async function fetchFredSeries(id: string, startDate: string): Promise<SeriesPoint[]> {
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}&cosd=${startDate}`;
  const resp = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!resp.ok) throw new Error(`FRED ${id} failed (${resp.status})`);
  const csv = await resp.text();
  const rows: SeriesPoint[] = [];
  for (const line of csv.split('\n').slice(1)) {
    const [date, raw] = line.trim().split(',');
    const value = parseFloat(raw);
    if (date && isFinite(value)) rows.push({ date, value });
  }
  return rows;
}

async function fetchYahooCloseSeries(symbol: string, range = '2y'): Promise<SeriesPoint[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=${range}`;
  // 429(레이트리밋) 백오프 재시도
  let resp: Response | null = null;
  for (const waitMs of [0, 3000, 8000, 15000]) {
    if (waitMs) await new Promise(r => setTimeout(r, waitMs));
    resp = await fetch(url, { headers: { 'User-Agent': UA } });
    if (resp.status !== 429) break;
  }
  if (!resp || !resp.ok) throw new Error(`Yahoo ${symbol} failed (${resp?.status})`);
  const json = await resp.json() as any;
  const result = json?.chart?.result?.[0];
  const closes: Array<number | null> =
    result?.indicators?.adjclose?.[0]?.adjclose ?? result?.indicators?.quote?.[0]?.close ?? [];
  const out: SeriesPoint[] = [];
  for (let i = 0; i < (result?.timestamp?.length ?? 0); i++) {
    if (closes[i] == null) continue;
    out.push({ date: new Date(result.timestamp[i] * 1000).toISOString().split('T')[0], value: closes[i]! });
  }
  return out;
}

// 주간 샘플링 (스파크라인 payload 축소)
function weekly(series: SeriesPoint[]): SeriesPoint[] {
  const out: SeriesPoint[] = [];
  let lastWeek = '';
  for (const p of series) {
    const d = new Date(p.date + 'T00:00:00Z');
    const week = `${d.getUTCFullYear()}-${Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(d.getUTCFullYear(), 0, 1)) / (7 * 86400000))}`;
    if (week !== lastWeek) { out.push(p); lastWeek = week; }
    else out[out.length - 1] = p; // 주 내 마지막 값 유지
  }
  return out;
}

function toIndicator(id: string, label: string, unit: string, series: SeriesPoint[]): Indicator | null {
  if (!series.length) return null;
  const last = series[series.length - 1];
  const monthAgoDate = new Date(new Date(last.date).getTime() - 30 * 86400000).toISOString().split('T')[0];
  const prev = [...series].reverse().find(p => p.date <= monthAgoDate) ?? series[0];
  return { id, label, unit, value: last.value, chg1m: last.value - prev.value, series: weekly(series) };
}

// --- 1. 매크로 ---

export async function computeMacroEnv() {
  const start = new Date(Date.now() - 2 * 365 * 86400000).toISOString().split('T')[0];
  const cpiStart = new Date(Date.now() - 4 * 365 * 86400000).toISOString().split('T')[0];

  const [dgs10, dgs2, t10y2y, hy, t5yie, dff, cpi, dxy] = await Promise.all([
    fetchFredSeries('DGS10', start),
    fetchFredSeries('DGS2', start),
    fetchFredSeries('T10Y2Y', start),
    fetchFredSeries('BAMLH0A0HYM2', start),
    fetchFredSeries('T5YIE', start),
    fetchFredSeries('DFF', start),
    fetchFredSeries('CPIAUCSL', cpiStart),
    fetchFredSeries('DTWEXBGS', start), // 광의 달러지수 (DXY 대용, FRED)
  ]);

  // CPI YoY (월간)
  const cpiYoy: SeriesPoint[] = [];
  for (let i = 12; i < cpi.length; i++) {
    cpiYoy.push({ date: cpi[i].date, value: (cpi[i].value / cpi[i - 12].value - 1) * 100 });
  }

  const indicators = [
    toIndicator('t10y2y', '장단기 금리차 (10Y−2Y)', '%p', t10y2y),
    toIndicator('hySpread', '하이일드 스프레드', '%p', hy),
    toIndicator('dgs10', '미국 10년물 금리', '%', dgs10),
    toIndicator('dgs2', '미국 2년물 금리', '%', dgs2),
    toIndicator('cpiYoy', 'CPI (전년 대비)', '%', cpiYoy.filter(p => p.date >= start)),
    toIndicator('t5yie', '기대인플레 (T5YIE)', '%', t5yie),
    toIndicator('dff', '연준 기준금리 (실효)', '%', dff),
    toIndicator('dxy', '달러 인덱스 (광의)', '', dxy),
  ].filter((x): x is Indicator => x != null);

  return { asOf: new Date().toISOString().split('T')[0], indicators };
}

// --- 2. 수급 ---

async function fetchCotNetPositions(nameFilter: string): Promise<SeriesPoint[]> {
  const where = encodeURIComponent(`contract_market_name='${nameFilter}'`);
  const url = `https://publicreporting.cftc.gov/resource/6dca-aqww.json?$where=${where}&$order=report_date_as_yyyy_mm_dd%20DESC&$limit=110`;
  const resp = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!resp.ok) throw new Error(`CFTC ${nameFilter} failed (${resp.status})`);
  const rows = await resp.json() as any[];
  return rows
    .map(r => ({
      date: String(r.report_date_as_yyyy_mm_dd).split('T')[0],
      value: parseInt(r.noncomm_positions_long_all, 10) - parseInt(r.noncomm_positions_short_all, 10),
    }))
    .filter(p => isFinite(p.value))
    .sort((a, b) => a.date.localeCompare(b.date));
}

async function fetchFearGreed() {
  const resp = await fetch('https://production.dataviz.cnn.io/index/fearandgreed/graphdata', {
    headers: {
      'User-Agent': UA,
      Accept: 'application/json',
      Referer: 'https://edition.cnn.com/markets/fear-and-greed',
      Origin: 'https://edition.cnn.com',
    },
  });
  if (!resp.ok) throw new Error(`CNN F&G failed (${resp.status})`);
  const json = await resp.json() as any;
  const hist: SeriesPoint[] = (json.fear_and_greed_historical?.data ?? [])
    .map((p: any) => ({ date: new Date(p.x).toISOString().split('T')[0], value: p.y as number }));
  return {
    score: json.fear_and_greed.score as number,
    rating: json.fear_and_greed.rating as string,
    prevClose: json.fear_and_greed.previous_close as number,
    prevMonth: json.fear_and_greed.previous_1_month as number,
    series: weekly(hist),
  };
}

export async function computeFlows() {
  const [spCot, ndCot] = await Promise.all([
    fetchCotNetPositions('E-MINI S&P 500'),
    fetchCotNetPositions('NASDAQ MINI'),
  ]);
  // CNN은 비공식 엔드포인트 — 실패해도 나머지는 반환
  let fearGreed = null;
  try { fearGreed = await fetchFearGreed(); } catch { /* 비공식 소스 차단 시 생략 */ }

  const start1y = new Date(Date.now() - 365 * 86400000).toISOString().split('T')[0];
  const [vix, vix3m] = await Promise.all([
    fetchFredSeries('VIXCLS', start1y),
    fetchFredSeries('VXVCLS', start1y), // CBOE 3개월 변동성
  ]);
  const vix3mByDate = new Map(vix3m.map(p => [p.date, p.value]));
  const termRatio: SeriesPoint[] = vix
    .filter(p => vix3mByDate.has(p.date))
    .map(p => ({ date: p.date, value: p.value / vix3mByDate.get(p.date)! }));

  return {
    asOf: new Date().toISOString().split('T')[0],
    cot: {
      spNet: toIndicator('spCot', 'S&P500 선물 투기 순포지션', '계약', spCot),
      ndqNet: toIndicator('ndqCot', '나스닥 선물 투기 순포지션', '계약', ndCot),
    },
    fearGreed,
    vixTerm: toIndicator('vixTerm', 'VIX 기간구조 (VIX/VIX3M)', '', termRatio),
  };
}

// --- 3. 지정학 ---

async function fetchGprDaily(): Promise<{ gprd: SeriesPoint[]; ma30: SeriesPoint[] }> {
  const resp = await fetch('https://www.matteoiacoviello.com/gpr_files/data_gpr_daily_recent.xls', {
    headers: { 'User-Agent': UA },
  });
  if (!resp.ok) throw new Error(`GPR fetch failed (${resp.status})`);
  const buf = await resp.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'buffer' });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 }) as any[][];
  const header = rows[0] as string[];
  const dayIdx = header.indexOf('DAY');
  const gprdIdx = header.indexOf('GPRD');
  const ma30Idx = header.indexOf('GPRD_MA30');
  const cutoff = new Date(Date.now() - 2 * 365 * 86400000).toISOString().split('T')[0].replace(/-/g, '');

  const gprd: SeriesPoint[] = [];
  const ma30: SeriesPoint[] = [];
  for (const r of rows.slice(1)) {
    const day = String(r[dayIdx]);
    if (day < cutoff || day.length !== 8) continue;
    const date = `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}`;
    if (isFinite(r[gprdIdx])) gprd.push({ date, value: r[gprdIdx] });
    if (isFinite(r[ma30Idx])) ma30.push({ date, value: r[ma30Idx] });
  }
  return { gprd, ma30 };
}

export async function computeGeopolitics() {
  const { gprd, ma30 } = await fetchGprDaily();

  // 시장 대리 지표: 금·유가·방산의 3개월 수익률 (SPY 대비)
  // 유가는 FRED, 나머지는 야후 순차 조회. 야후 레이트리밋 시 해당 프록시만 생략 (GPR은 항상 반환)
  const start1y = new Date(Date.now() - 365 * 86400000).toISOString().split('T')[0];
  const oil = await fetchFredSeries('DCOILBRENTEU', start1y).catch(() => [] as SeriesPoint[]);
  const seq: SeriesPoint[][] = [];
  for (const sym of ['GLD', 'ITA', 'SPY']) {
    seq.push(await fetchYahooCloseSeries(sym, '1y').catch(() => [] as SeriesPoint[]));
    await new Promise(r => setTimeout(r, 500));
  }
  const [gld, ita, spy] = seq;

  function ret3m(series: SeriesPoint[]): number | null {
    if (series.length < 5) return null;
    const last = series[series.length - 1];
    const cutoff = new Date(new Date(last.date).getTime() - 91 * 86400000).toISOString().split('T')[0];
    const base = series.find(p => p.date >= cutoff);
    return base ? last.value / base.value - 1 : null;
  }

  const spyR = ret3m(spy) ?? 0;
  const proxies = [
    { id: 'gld', label: '금 (GLD)', ret3m: ret3m(gld), vsSpy: (ret3m(gld) ?? 0) - spyR, series: weekly(gld) },
    { id: 'oil', label: '브렌트유', ret3m: ret3m(oil), vsSpy: (ret3m(oil) ?? 0) - spyR, series: weekly(oil) },
    { id: 'ita', label: '방산 (ITA)', ret3m: ret3m(ita), vsSpy: (ret3m(ita) ?? 0) - spyR, series: weekly(ita) },
  ];

  return {
    asOf: gprd[gprd.length - 1]?.date,
    gpr: {
      current: gprd[gprd.length - 1]?.value ?? null,
      ma30: ma30[ma30.length - 1]?.value ?? null,
      series: weekly(ma30), // 일간은 노이즈가 커서 30일 이동평균으로 표시
    },
    proxies,
  };
}
