/**
 * 생물 출현 기록 불러오기: 예시(가상) 데이터, CSV 파일, OBIS 보호 대상 데이터.
 *
 * 출현 기록 하나는 [경도, 위도, 분류군, 기록 수, 칸 크기(도)] 배열입니다 (density.js 참고).
 * 분류군이 없으면 ''. 낱개 기록은 기록 수 1, 칸 크기 0.
 *
 * OBIS 데이터는 두 단계입니다.
 *   기본: tools/fetch_obis_targets.py 가 미리 받아 둔 전 세계 격자 (약 1.4° 칸)
 *   상세: 항로가 정해지면 그 해역만 OBIS API에서 더 촘촘한 격자로 바로 받음 (fetchDetail)
 */
import { SAMPLE_BOUNDS, SAMPLE_SEED } from './config.js';
import { nearLon } from './geo.js';

/** tools/fetch_obis_targets.py 가 만드는 파일 */
const TARGET_URL = 'data/obis_targets.json';
const OBIS_GRID_API = 'https://api.obis.org/v3/occurrence/grid/';

/** 지오해시 정밀도별 칸 크기 [경도, 위도] (도) */
const GEOHASH_CELL = { 3: [1.40625, 1.40625], 4: [0.3515625, 0.17578125], 5: [0.0439453125, 0.0439453125] };

/** 시드 고정 난수 (mulberry32). Python의 random.Random(seed).random()에 해당 */
function seededRandom(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 동작 확인용 가상 출현 기록 (실제 관측값 아님). 동해 포항–울릉 해역에만 있음 */
export function samplePoints() {
  const random = seededRandom(SAMPLE_SEED);
  // Box–Muller 정규분포 난수
  const gauss = () => Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());

  // [중심 경도, 중심 위도, 퍼짐(도), 점 개수]
  const clusters = [
    [129.73, 36.72, 0.07, 220],
    [130.15, 36.78, 0.12, 300],
    [130.5, 37.15, 0.08, 150],
    [129.62, 36.3, 0.06, 120],
    [130.72, 37.36, 0.07, 120],
    [129.6, 37.3, 0.08, 110],
  ];
  const out = [];
  for (const [lon, lat, spread, count] of clusters) {
    for (let n = 0; n < count; n++) out.push([lon + gauss() * spread, lat + gauss() * spread * 0.8, '', 1, 0]);
  }
  // 해역 전체에 고르게 흩어진 배경 기록
  const b = SAMPLE_BOUNDS;
  for (let n = 0; n < 150; n++) {
    out.push([b.lon0 + random() * (b.lon1 - b.lon0), b.lat0 + random() * (b.lat1 - b.lat0), '', 1, 0]);
  }
  return out;
}

/**
 * 격자 범위 안의 기록만 골라, 경도를 격자 쪽으로 펼친 사본을 돌려줌.
 * 커널이 경계 너머로 퍼지므로 margin(도)만큼 바깥 기록도 포함합니다.
 */
export function pointsInBounds(points, { lon0, lon1, lat0, lat1 }, margin = 0) {
  const mid = (lon0 + lon1) / 2;
  const out = [];
  for (const p of points) {
    const lon = nearLon(p[0], mid);
    const m = margin + (p[4] || 0);
    if (lon < lon0 - m || lon > lon1 + m || p[1] < lat0 - m || p[1] > lat1 + m) continue;
    out.push(lon === p[0] ? p : [lon, p[1], p[2], p[3], p[4]]);
  }
  return out;
}

/** 따옴표를 고려해 CSV 한 줄을 나눔 (Python csv 모듈의 기본 동작과 비슷) */
function splitCsvLine(line, delimiter) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else quoted = false;
      } else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

const LAT_NAMES = ['decimallatitude', 'latitude', 'lat'];
const LON_NAMES = ['decimallongitude', 'longitude', 'lon', 'lng'];
const GROUP_NAMES = ['group', '분류군'];
const COUNT_NAMES = ['count', 'n', 'individualcount', '기록수', '개체수'];

/**
 * CSV/TSV 텍스트에서 위도·경도 열을 찾아 출현 기록 목록을 만듦.
 * 분류군 열(group 또는 분류군)과 기록 수 열(count 등)은 없어도 됩니다.
 * @throws {Error} 데이터 줄이나 위도·경도 열이 없을 때
 */
export function parseCsv(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) throw new Error('데이터 줄이 없습니다.');

  const delimiter = lines[0].includes('\t') ? '\t' : ',';
  const header = splitCsvLine(lines[0], delimiter).map((h) => h.trim().toLowerCase());
  const latCol = header.findIndex((h) => LAT_NAMES.includes(h) || h.includes('위도'));
  const lonCol = header.findIndex((h) => LON_NAMES.includes(h) || h.includes('경도'));
  if (latCol < 0 || lonCol < 0) throw new Error('위도·경도 열을 찾지 못했습니다. 첫 줄의 열 이름을 확인하세요.');
  const groupCol = header.findIndex((h) => GROUP_NAMES.includes(h));
  const countCol = header.findIndex((h) => COUNT_NAMES.includes(h));

  const out = [];
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line, delimiter);
    const lat = parseFloat(cells[latCol]);
    const lon = parseFloat(cells[lonCol]);
    const group = groupCol >= 0 ? (cells[groupCol] || '').trim() : '';
    const count = countCol >= 0 ? parseFloat(cells[countCol]) : 1;
    if (Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lat) <= 90) {
      out.push([lon, lat, group, Number.isFinite(count) && count > 0 ? count : 1, 0]);
    }
  }
  return out;
}

/**
 * @typedef {Object} TargetGroup
 * @property {string} key    분류군 키 ('cetacean' 등)
 * @property {string} label  화면 표시 이름
 * @property {string[]} taxa OBIS 학명
 * @property {number} count  전 세계 기록 수
 */

/**
 * 미리 받아 둔 OBIS 보호 대상 격자 (전 세계 기본값).
 * @returns {Promise<{points: Array, meta: {generatedAt: string, precision: number, groups: TargetGroup[]}}>}
 */
export async function loadTargetBaseline() {
  const res = await fetch(TARGET_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const cell = Math.max(...data.cellDeg);
  const points = [];
  for (const g of data.groups) {
    const c = g.cells;
    for (let i = 0; i < c.length; i += 3) points.push([c[i], c[i + 1], g.key, c[i + 2], cell]);
  }
  const groups = data.groups.map(({ key, label, taxa, count }) => ({ key, label, taxa, count }));
  return { points, meta: { generatedAt: data.generatedAt, precision: data.precision, groups } };
}

/**
 * 해역 넓이에 맞는 상세 격자 정밀도. 너무 넓으면 null (기본 격자를 그대로 씀).
 * 정밀도 5 ≈ 4.9 km 칸, 4 ≈ 39 × 20 km 칸.
 */
export function detailPrecision({ lon0, lon1, lat0, lat1 }) {
  const area = (lon1 - lon0) * (lat1 - lat0);
  if (area <= 40) return 5;
  if (area <= 900) return 4;
  return null;
}

export const precisionCellKm = (precision) => Math.round(GEOHASH_CELL[precision][1] * 111.2);

/** 펼친 경도 범위를 -180~180 안의 상자 여러 개로 나눔 (날짜변경선을 넘는 해역) */
function splitBox({ lon0, lon1, lat0, lat1 }) {
  const boxes = [];
  for (const shift of [-360, 0, 360]) {
    const a = Math.max(-180, lon0 + shift);
    const b = Math.min(180, lon1 + shift);
    if (b - a > 1e-6) boxes.push([a, b, Math.max(-90, lat0), Math.min(90, lat1)]);
  }
  return boxes;
}

const boxWkt = ([a, b, c, d]) => {
  const f = (v) => v.toFixed(3);
  return `POLYGON((${f(a)} ${f(c)},${f(b)} ${f(c)},${f(b)} ${f(d)},${f(a)} ${f(d)},${f(a)} ${f(c)}))`;
};

/**
 * 해역의 보호 대상 기록을 OBIS 격자 API에서 바로 받음 (브라우저에서 직접 호출, CORS 허용됨).
 * @param {TargetGroup[]} groups
 * @param {{lon0: number, lon1: number, lat0: number, lat1: number}} bounds
 * @param {number} precision 지오해시 정밀도 (4 또는 5)
 * @param {AbortSignal} [signal]
 * @returns {Promise<Array>} 출현 기록 목록
 */
export async function fetchDetail(groups, bounds, precision, signal) {
  const cell = Math.max(...GEOHASH_CELL[precision]);
  const boxes = splitBox(bounds);
  const jobs = [];
  for (const g of groups) {
    for (const box of boxes) {
      const params = new URLSearchParams({ scientificname: g.taxa.join(','), geometry: boxWkt(box) });
      jobs.push(
        fetch(`${OBIS_GRID_API}${precision}?${params}`, { signal })
          .then((res) => {
            if (!res.ok) throw new Error(`OBIS HTTP ${res.status}`);
            return res.json();
          })
          .then((data) =>
            (data.features || []).map((f) => {
              const ring = f.geometry.coordinates[0];
              const xs = ring.map((p) => p[0]);
              const ys = ring.map((p) => p[1]);
              const lon = (Math.min(...xs) + Math.max(...xs)) / 2;
              const lat = (Math.min(...ys) + Math.max(...ys)) / 2;
              return [lon, lat, g.key, f.properties.n, cell];
            }),
          ),
      );
    }
  }
  return (await Promise.all(jobs)).flat();
}
