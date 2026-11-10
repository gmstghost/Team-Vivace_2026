/**
 * 생물 출현 기록 불러오기: 예시(가상) 데이터, CSV 파일, OBIS API.
 *
 * 출현 기록은 [경도, 위도] 배열의 배열로 다룹니다.
 */
import { BOUNDS, SAMPLE_SEED } from './config.js';
import { cellOf, landMask } from './grid.js';

const OBIS_URL = 'https://api.obis.org/v3/occurrence';
const OBIS_PAGE_SIZE = 5000;

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

/** 해역 안의 바다에 있는 기록만 남김 */
export function keepSeaPoints(points) {
  return points.filter(([lon, lat]) => {
    const k = cellOf(lon, lat);
    return k >= 0 && !landMask[k];
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

/**
 * CSV/TSV 텍스트에서 위도·경도 열을 찾아 [경도, 위도] 목록을 만듦.
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

  const out = [];
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line, delimiter);
    const lat = parseFloat(cells[latCol]);
    const lon = parseFloat(cells[lonCol]);
    if (Number.isFinite(lon) && Number.isFinite(lat)) out.push([lon, lat]);
  }
  return out;
}

/**
 * OBIS에서 해역 안 출현 기록을 받아옴.
 * @returns {Promise<{points: number[][], total: number}>}
 */
export async function fetchObisPoints() {
  const { lon0, lon1, lat0, lat1 } = BOUNDS;
  const wkt = `POLYGON((${lon0} ${lat0},${lon1} ${lat0},${lon1} ${lat1},${lon0} ${lat1},${lon0} ${lat0}))`;
  const params = new URLSearchParams({
    geometry: wkt,
    size: String(OBIS_PAGE_SIZE),
    fields: 'decimalLongitude,decimalLatitude',
  });

  const res = await fetch(`${OBIS_URL}?${params}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();

  const points = (body.results || [])
    .map((o) => [Number(o.decimalLongitude), Number(o.decimalLatitude)])
    .filter(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat));
  if (!points.length) throw new Error('받은 기록이 없습니다');
  return { points, total: Number(body.total) || points.length };
}
