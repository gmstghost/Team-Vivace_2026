/**
 * 1단계 서식 밀도 (커널 밀도 추정) → 2단계 수온 보정 위험도.
 */
import { KDE_SIGMA_KM, KM_PER_DEG_LAT, KM_PER_DEG_LON } from './config.js';

/**
 * 출현 기록 하나 = [경도, 위도, 분류군, 기록 수, 칸 크기(도)].
 * 낱개 기록은 기록 수 1, 칸 크기 0. OBIS 격자 자료는 칸 중심에 그 칸의 기록 수를 담습니다.
 *
 * 기록 수 n인 칸의 무게는 1 + ln(n): 조사를 많이 한 곳(기록 수만 건)이
 * 나머지를 모두 덮어 버리지 않도록 로그로 줄입니다.
 */
export const pointWeight = (n) => 1 + Math.log(Math.max(1, n));

/**
 * 분류군별 서식 밀도를 각각 0~1로 맞춘 뒤, 칸마다 가장 큰 값을 씀.
 *
 * 기록을 한데 모아 밀도를 내면 기록이 많은 분류군(따개비 수백 건)이
 * 기록이 적은 분류군(물범 2건)을 덮어 버리므로, 분류군마다 따로 정규화합니다.
 * 어느 한 보호 대상이라도 밀집한 곳이면 민감 구역이 됩니다.
 *
 * @param {import('./grid.js').Grid} grid
 * @param {Uint8Array} landMask 1 = 육지
 * @param {Array} points 출현 기록 (격자 범위 안, 펼친 경도)
 * @param {Set<string>|null} groups 쓸 분류군 (null이면 전부)
 * @returns {Float32Array} 길이 grid.n
 */
export function buildDensity(grid, landMask, points, groups = null) {
  const byGroup = new Map();
  for (const p of points) {
    const g = p[2] || '';
    if (groups && !groups.has(g)) continue;
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g).push(p);
  }
  const combined = new Float32Array(grid.n);
  for (const groupPoints of byGroup.values()) {
    const d = groupDensity(grid, landMask, groupPoints);
    for (let k = 0; k < grid.n; k++) if (d[k] > combined[k]) combined[k] = d[k];
  }
  return combined;
}

/**
 * 한 분류군의 출현 기록을 가우시안 커널로 격자에 퍼뜨려 0~1 서식 밀도를 만듦.
 * 커널 반경 σ = max(7.5 km, 데이터 칸 크기 × 0.6, 격자 칸 크기).
 *
 * 정규화: (값 − 중앙값) / (상위 2% 값 − 중앙값)을 0~1로 자름 (값이 있는 바다 칸 기준).
 * 대양처럼 기록이 넓게 고루 퍼진 해역에서도 '주변보다 밀집한 곳'만 민감 구역이 되도록
 * 중앙값을 0으로 맞춥니다. 기록이 드문 연안 해역에서는 중앙값이 거의 0이라 영향이 작습니다.
 */
function groupDensity(grid, landMask, points) {
  const { nx, ny, n, lon0, lat0, cellDeg } = grid;
  const density = new Float32Array(n);
  const cellKmLat = cellDeg * KM_PER_DEG_LAT;

  for (const [lon, lat, , count = 1, dataDeg = 0] of points) {
    const sigmaKm = Math.max(KDE_SIGMA_KM, dataDeg * KM_PER_DEG_LAT * 0.6, cellKmLat);
    const cosLat = Math.max(Math.cos((lat * Math.PI) / 180), 0.05);
    const sy = sigmaKm / cellKmLat; // 칸 단위
    const sx = sigmaKm / (cellDeg * KM_PER_DEG_LON * cosLat);
    // 칸 중심 기준 연속 좌표
    const fx = (lon - lon0) / cellDeg - 0.5;
    const fy = (lat - lat0) / cellDeg - 0.5;
    const i0 = Math.max(0, Math.ceil(fx - 3 * sx));
    const i1 = Math.min(nx - 1, Math.floor(fx + 3 * sx));
    const j0 = Math.max(0, Math.ceil(fy - 3 * sy));
    const j1 = Math.min(ny - 1, Math.floor(fy + 3 * sy));
    if (i1 < i0 || j1 < j0) continue;

    // exp(-(dx²+dy²)/2σ²) = exp(-dx²/2σx²) × exp(-dy²/2σy²): 가로·세로를 따로 계산해 곱함
    const gx = new Float32Array(i1 - i0 + 1);
    for (let i = i0; i <= i1; i++) gx[i - i0] = Math.exp(-((i - fx) ** 2) / (2 * sx * sx));
    const w = pointWeight(count);
    for (let j = j0; j <= j1; j++) {
      const wy = w * Math.exp(-((j - fy) ** 2) / (2 * sy * sy));
      const base = j * nx;
      for (let i = i0; i <= i1; i++) density[base + i] += wy * gx[i - i0];
    }
  }

  const [mid, top] = seaPercentiles(density, landMask, [0.5, 0.98]);
  if (!(top > 0)) return density.fill(0);
  const base = top > mid ? mid : 0;
  const span = top - base;
  for (let k = 0; k < n; k++) density[k] = landMask[k] ? 0 : Math.min(1, Math.max(0, (density[k] - base) / span));
  return density;
}

/** 바다 칸 중 값이 있는 칸(> 1e-4)의 분위수들. 히스토그램으로 근사 (정렬보다 빠름) */
function seaPercentiles(values, landMask, qs) {
  let max = 0;
  let count = 0;
  for (let k = 0; k < values.length; k++) {
    if (landMask[k] || values[k] <= 1e-4) continue;
    count++;
    if (values[k] > max) max = values[k];
  }
  if (!count) return qs.map(() => 0);
  const BINS = 4096;
  const hist = new Uint32Array(BINS);
  for (let k = 0; k < values.length; k++) {
    if (landMask[k] || values[k] <= 1e-4) continue;
    hist[Math.min(BINS - 1, Math.floor((values[k] / max) * BINS))]++;
  }
  return qs.map((q) => {
    const target = Math.floor(count * q);
    let seen = 0;
    for (let b = 0; b < BINS; b++) {
      seen += hist[b];
      if (seen > target) return ((b + 1) / BINS) * max;
    }
    return max;
  });
}

/**
 * 수온 보정 계수: 0.4 + 0.6 × exp(−((수온 − 적정)/5)²)
 * 수온 = 적정이면 1, 멀어질수록 0.4에 가까워짐.
 */
export function temperatureFactor(temp, optimalTemp) {
  return 0.4 + 0.6 * Math.exp(-(((temp - optimalTemp) / 5) ** 2));
}

/** 위험도 = 서식 밀도 × 수온 보정 계수 */
export function computeRisk(density, temp, optimalTemp) {
  const f = temperatureFactor(temp, optimalTemp);
  return density.map((d) => d * f);
}
