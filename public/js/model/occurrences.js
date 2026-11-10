/**
 * 생물 출현 기록 불러오기: 예시(가상) 데이터, CSV 파일, OBIS 보호 대상 데이터.
 *
 * 출현 기록 하나는 [경도, 위도, 분류군] 배열입니다. 분류군이 없으면 ''.
 * 분류군별로 따로 밀도를 계산하므로 (density.js) 기록 수가 적은 분류군도 묻히지 않습니다.
 */
import { BOUNDS, SAMPLE_SEED } from './config.js';
import { cellOf, nearSeaMask } from './grid.js';

/** tools/fetch_obis_targets.py 가 만드는 파일 */
const TARGET_CSV_URL = 'data/obis_targets.csv';
const TARGET_META_URL = 'data/obis_targets.meta.json';

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

/** 동작 확인용 가상 출현 기록 (실제 관측값 아님) */
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
    for (let n = 0; n < count; n++) out.push([lon + gauss() * spread, lat + gauss() * spread * 0.8]);
  }
  // 해역 전체에 고르게 흩어진 배경 기록
  for (let n = 0; n < 150; n++) {
    out.push([
      BOUNDS.lon0 + random() * (BOUNDS.lon1 - BOUNDS.lon0),
      BOUNDS.lat0 + random() * (BOUNDS.lat1 - BOUNDS.lat0),
    ]);
  }
  return out;
}

/** 해역 안의 바다(또는 해안에서 COAST_REACH 칸 이내)에 있는 기록만 남김 */
export function keepSeaPoints(points) {
  return points.filter(([lon, lat]) => {
    const k = cellOf(lon, lat);
    return k >= 0 && nearSeaMask[k] === 1;
  });
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

/**
 * CSV/TSV 텍스트에서 위도·경도 열을 찾아 [경도, 위도, 분류군] 목록을 만듦.
 * 분류군 열(group 또는 분류군)은 없어도 됩니다.
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

  const out = [];
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line, delimiter);
    const lat = parseFloat(cells[latCol]);
    const lon = parseFloat(cells[lonCol]);
    const group = groupCol >= 0 ? (cells[groupCol] || '').trim() : '';
    if (Number.isFinite(lon) && Number.isFinite(lat)) out.push([lon, lat, group]);
  }
  return out;
}

/**
 * @typedef {Object} TargetGroup
 * @property {string} key    CSV의 group 값 ('cetacean' 등)
 * @property {string} label  화면 표시 이름
 * @property {string[]} taxa OBIS 학명
 * @property {number} count  기록 수
 */

/**
 * 미리 받아 둔 OBIS 보호 대상 기록을 불러옴.
 * @returns {Promise<{points: Array, meta: {generatedAt: string, groups: TargetGroup[]}}>}
 */
export async function loadTargetDataset() {
  const [csvRes, metaRes] = await Promise.all([fetch(TARGET_CSV_URL), fetch(TARGET_META_URL)]);
  if (!csvRes.ok || !metaRes.ok) throw new Error(`HTTP ${csvRes.status}/${metaRes.status}`);
  const [text, meta] = await Promise.all([csvRes.text(), metaRes.json()]);
  return { points: parseCsv(text), meta };
}
