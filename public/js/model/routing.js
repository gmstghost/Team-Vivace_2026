/**
 * 기존(최단) 항로와 AI 추천 항로를 계산하고 비교 지표를 측정.
 *
 * 이 파일과 model/ 폴더의 다른 파일은 화면(DOM)을 전혀 건드리지 않습니다.
 * 같은 입력이면 항상 같은 결과가 나오는 순수 계산이라 Node에서 따로 테스트할 수 있습니다.
 */
import { HIGH_RISK, KM_PER_DEG_LAT, KM_PER_DEG_LON, PORTS, DESTINATION } from './config.js';
import { cellOf, cellCenter, isLand, snapToWater } from './grid.js';
import { computeRisk } from './density.js';
import { astar } from './pathfinding.js';

/** 두 점 사이 거리 (km, 평면 근사) */
export function segmentKm(a, b) {
  const midLat = (((a[1] + b[1]) / 2) * Math.PI) / 180;
  const dx = (b[0] - a[0]) * KM_PER_DEG_LON * Math.cos(midLat);
  const dy = (b[1] - a[1]) * KM_PER_DEG_LAT;
  return Math.sqrt(dx * dx + dy * dy);
}

/** 두 점을 잇는 직선이 육지를 지나지 않는지 */
export function isStraightClear(a, b, stepDeg = 0.004) {
  const n = Math.ceil(Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])) / stepDeg);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    if (isLand(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)) return false;
  }
  return true;
}

/**
 * 경로를 0.5 km 간격으로 따라가며 지표를 잼.
 * @returns {{km: number, highKm: number, exposure: number}}
 *   km: 총 거리, highKm: 민감 구역(위험도 ≥ HIGH_RISK) 통과 거리, exposure: Σ(위험도 × 거리)
 */
export function measureRoute(path, risk) {
  let km = 0;
  let highKm = 0;
  let exposure = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const len = segmentKm(a, b);
    const steps = Math.max(1, Math.ceil(len / 0.5));
    const step = len / steps;
    for (let s = 0; s < steps; s++) {
      const t = (s + 0.5) / steps;
      const k = cellOf(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t);
      const r = k >= 0 ? risk[k] : 0;
      km += step;
      exposure += r * step;
      if (r >= HIGH_RISK) highKm += step;
    }
  }
  return { km, highKm, exposure };
}

/** 회피 가중치 = 기본 가중치 × (0.5 + 1.5 × 소음비율) */
export function avoidanceWeight(baseWeight, noisePct) {
  return baseWeight * (0.5 + (1.5 * noisePct) / 100);
}

/**
 * @typedef {Object} Params
 * @property {string} port         PORTS의 키 ('pohang' 등)
 * @property {number} temp         수온 (°C)
 * @property {number} noise        선박 소음 (0~100 %)
 * @property {number} optimalTemp  산란 적정 수온 (°C)
 * @property {number} weight       회피 가중치
 *
 * @typedef {Object} Route
 * @property {number[][]} path
 * @property {{km: number, highKm: number, exposure: number}} metrics
 */

/**
 * 시뮬레이션 한 번 실행.
 * @param {Params} params
 * @param {Float32Array} density buildDensity() 결과
 * @returns {{risk: Float32Array, shortest: Route, safe: Route}}
 */
export function planRoutes(params, density) {
  const risk = computeRisk(density, params.temp, params.optimalTemp);

  const port = PORTS[params.port];
  const start = snapToWater(port.lon, port.lat);
  const goal = snapToWater(DESTINATION.lon, DESTINATION.lat);
  const a = cellCenter(start);
  const b = cellCenter(goal);

  // 기존 항로: 육지에 막히지 않으면 직선, 막히면 위험을 무시한 최단 경로
  const shortestPath = isStraightClear(a, b) ? [a, b] : astar(start, goal, 0, risk) || [a, b];

  const w = avoidanceWeight(params.weight, params.noise);
  const safePath = w > 0 ? astar(start, goal, w, risk) || shortestPath : shortestPath;

  const shortest = { path: shortestPath, metrics: measureRoute(shortestPath, risk) };
  let safe = { path: safePath, metrics: measureRoute(safePath, risk) };
  // 격자 오차로 AI 항로가 최단보다 짧게 나오는 일 방지
  if (safe.metrics.km < shortest.metrics.km) safe = shortest;

  return { risk, shortest, safe };
}
