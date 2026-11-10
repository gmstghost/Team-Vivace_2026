/**
 * 1단계 서식 밀도 (커널 밀도 추정) → 2단계 수온 보정 위험도.
 */
import { BOUNDS, CELL_DEG, KDE_SIGMA_DEG } from './config.js';
import { N, NX, NY, landMask } from './grid.js';

/**
 * 분류군별 서식 밀도를 각각 0~1로 맞춘 뒤, 칸마다 가장 큰 값을 씀.
 *
 * 기록을 한데 모아 밀도를 내면 기록이 많은 분류군(따개비 수백 건)이
 * 기록이 적은 분류군(물범 2건)을 덮어 버리므로, 분류군마다 따로 정규화합니다.
 * 어느 한 보호 대상이라도 밀집한 곳이면 민감 구역이 됩니다.
 *
 * @param {Array} points [경도, 위도, 분류군?] 목록
 * @param {Set<string>|null} groups 쓸 분류군 (null이면 전부)
 * @returns {Float32Array} 길이 N
 */
export function buildDensity(points, groups = null) {
  const byGroup = new Map();
  for (const p of points) {
    const g = p[2] || '';
    if (groups && !groups.has(g)) continue;
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g).push(p);
  }
  if (byGroup.size === 1) return groupDensity([...byGroup.values()][0]);

  const combined = new Float32Array(N);
  for (const groupPoints of byGroup.values()) {
    const d = groupDensity(groupPoints);
    for (let k = 0; k < N; k++) if (d[k] > combined[k]) combined[k] = d[k];
  }
  return combined;
}

/**
 * 한 분류군의 출현 기록을 가우시안 커널로 격자에 퍼뜨려 0~1 서식 밀도를 만듦.
 * 바다 칸 상위 2% 값을 1로 맞추고 그 이상은 1로 자릅니다.
 * @returns {Float32Array} 길이 N
 */
function groupDensity(points) {
  const density = new Float32Array(N);
  const sigma = KDE_SIGMA_DEG / CELL_DEG; // 칸 단위
  const radius = Math.ceil(3 * sigma);
  const inv2s2 = 1 / (2 * sigma * sigma);

  for (const [lon, lat] of points) {
    // 칸 중심 기준 연속 좌표
    const fx = (lon - BOUNDS.lon0) / CELL_DEG - 0.5;
    const fy = (lat - BOUNDS.lat0) / CELL_DEG - 0.5;
    const ci = Math.round(fx);
    const cj = Math.round(fy);
    for (let dj = -radius; dj <= radius; dj++) {
      const j = cj + dj;
      if (j < 0 || j >= NY) continue;
      for (let di = -radius; di <= radius; di++) {
        const i = ci + di;
        if (i < 0 || i >= NX) continue;
        const dx = i - fx;
        const dy = j - fy;
        density[j * NX + i] += Math.exp(-(dx * dx + dy * dy) * inv2s2);
      }
    }
  }

  const seaValues = [];
  for (let k = 0; k < N; k++) if (!landMask[k] && density[k] > 1e-4) seaValues.push(density[k]);
  if (!seaValues.length) return density;

  seaValues.sort((a, b) => a - b);
  const ref = seaValues[Math.floor(seaValues.length * 0.98)] || seaValues[seaValues.length - 1];
  for (let k = 0; k < N; k++) density[k] = landMask[k] ? 0 : Math.min(1, density[k] / ref);
  return density;
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
