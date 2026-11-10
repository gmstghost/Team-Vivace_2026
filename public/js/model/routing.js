/**
 * 항로 계산: 두 항구 사이 해역을 정하고, 기존(최단) 항로와 AI 추천 항로를 찾아 지표를 측정.
 *
 * 전 세계를 한 번에 촘촘한 격자로 덮으면 칸이 수억 개라 두 단계로 나눕니다.
 *   1단계 planRegion: 전 세계 0.25° 격자에서 대략의 최단 길을 찾고,
 *          그 길 주변(통로)만 덮는 촘촘한 격자를 새로 만듦. 기존 항로도 여기서 계산
 *   2단계 planRoutes: 통로 격자에서 위험도를 반영한 AI 추천 항로를 찾음 (슬라이더를 움직일 때마다)
 *
 * 이 파일과 model/ 폴더의 다른 파일은 화면(DOM)을 전혀 건드리지 않습니다.
 * 같은 입력이면 항상 같은 결과가 나오는 순수 계산이라 Node에서 따로 테스트할 수 있습니다.
 */
import { HIGH_RISK, CORRIDOR, FINE, FINE_LAT_LIMIT, SNAP_KM, SNAP_MAX_KM, COARSE_SNAP_KM, STRAIGHT_MAX_KM, KM_PER_DEG_LAT, KM_PER_DEG_LON } from './config.js';
import { Grid, labelComponents } from './grid.js';
import { rasterizeLand, carvePassages, openCellsNear } from './land.js';
import { haversineKm, polylineKm, unwrapPath } from './geo.js';
import { computeRisk } from './density.js';
import { astar } from './pathfinding.js';

/** 항로를 찾을 수 없을 때 (화면에 message를 그대로 보여 줌) */
export class RouteError extends Error {}

/**
 * 두 지점 근처의 열린 칸 중, 같은 바다 덩어리에 속한 가장 가까운 쌍을 고름.
 * (가장 가까운 바다 칸이 막힌 석호일 수 있어서, 서로 이어진 칸끼리 짝지음)
 * @returns {{start: number, goal: number} | null}
 */
function pickConnectedPair(grid, blocked, comp, a, b, maxKm) {
  const near = (p) => openCellsNear(grid, blocked, p[0], p[1], maxKm);
  const na = near(a);
  const nb = near(b);
  if (!na.length) throw new RouteError(`출발 항구 ${maxKm} km 안에 바다가 없습니다.`);
  if (!nb.length) throw new RouteError(`도착 항구 ${maxKm} km 안에 바다가 없습니다.`);
  const bestB = new Map(); // 덩어리 번호 → 도착 쪽 가장 가까운 칸
  for (const c of nb) if (!bestB.has(comp[c.k])) bestB.set(comp[c.k], c);
  let best = null;
  for (const c of na) {
    const g = bestB.get(comp[c.k]);
    if (g && (!best || c.km + g.km < best.km)) best = { start: c.k, goal: g.k, km: c.km + g.km };
  }
  return best;
}

/** 경로 주변 radiusKm 안의 칸을 1로 표시 (통로) */
export function corridorMask(grid, path, radiusKm) {
  const mask = new Uint8Array(grid.n);
  const { nx, ny, lon0, lat0, cellDeg } = grid;
  const disk = ([lon, lat]) => {
    const dLat = radiusKm / KM_PER_DEG_LAT;
    const j0 = Math.max(0, Math.floor((lat - dLat - lat0) / cellDeg));
    const j1 = Math.min(ny - 1, Math.floor((lat + dLat - lat0) / cellDeg));
    for (let j = j0; j <= j1; j++) {
      const dyKm = (grid.latOf(j) - lat) * KM_PER_DEG_LAT;
      const rem = radiusKm * radiusKm - dyKm * dyKm;
      if (rem < 0) continue;
      const half = Math.sqrt(rem) / (KM_PER_DEG_LON * Math.max(Math.cos((grid.latOf(j) * Math.PI) / 180), 0.02));
      const i0 = Math.max(0, Math.ceil((lon - half - lon0) / cellDeg - 0.5));
      const i1 = Math.min(nx - 1, Math.floor((lon + half - lon0) / cellDeg - 0.5));
      if (i1 >= i0) mask.fill(1, j * nx + i0, j * nx + i1 + 1);
    }
  };
  const step = radiusKm / 3;
  for (let s = 0; s < path.length; s++) {
    if (s === 0) { disk(path[0]); continue; }
    const a = path[s - 1];
    const b = path[s];
    const n = Math.max(1, Math.ceil(haversineKm(a, b) / step));
    for (let t = 1; t <= n; t++) disk([a[0] + ((b[0] - a[0]) * t) / n, a[1] + ((b[1] - a[1]) * t) / n]);
  }
  return mask;
}

/** 두 칸 중심을 잇는 직선이 막힌 칸을 지나지 않는지 */
function isStraightClear(grid, blocked, a, b) {
  const step = grid.cellDeg / 3;
  const n = Math.ceil(Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])) / step);
  for (let i = 0; i <= n; i++) {
    const t = n ? i / n : 0;
    const k = grid.cellOf(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t);
    if (k < 0 || blocked[k]) return false;
  }
  return true;
}

/**
 * @typedef {Object} Region  항로 하나를 위한 해역
 * @property {Grid} grid            통로를 덮는 촘촘한 격자 (펼친 경도)
 * @property {Uint8Array} land      1 = 육지
 * @property {Uint8Array} blocked   1 = 지나갈 수 없음 (육지 또는 통로 밖)
 * @property {Uint8Array} outside   1 = 통로 밖 바다 (화면 표시용)
 * @property {number} start         출발 칸
 * @property {number} goal          도착 칸
 * @property {number[]} fromPt      출발 항구 [경도, 위도] (격자와 같은 펼친 경도)
 * @property {number[]} toPt        도착 항구
 * @property {number[][]} shortestPath 기존 항로 (위험 무시, 최단)
 * @property {number} corridorKm    통로 반경
 * @property {{lon0: number, lon1: number, lat0: number, lat1: number}} bounds
 */

/**
 * 1단계: 두 항구 사이 해역(통로 격자)과 기존 최단 항로.
 * @param {{grid: Grid, blocked: Uint8Array, comp: Int32Array}} world buildWorldGrid() 결과
 * @param {import('./land.js').Land} land
 * @param {{lon: number, lat: number}} from
 * @param {{lon: number, lat: number}} to
 * @returns {Region}
 */
export function planRegion(world, land, from, to) {
  if (from.lon === to.lon && from.lat === to.lat) throw new RouteError('출발 항구와 도착 항구가 같습니다.');

  const pair = pickConnectedPair(world.grid, world.blocked, world.comp, [from.lon, from.lat], [to.lon, to.lat], COARSE_SNAP_KM);
  if (!pair) throw new RouteError('두 항구가 바다로 이어져 있지 않습니다 (예: 카스피해와 대양).');

  // 1단계 격자는 칸이 커서, 육지로 막힌 좁은 곳(예: 코린트 지협)을 바다로 보고 지나갈 때가 있습니다.
  // 2단계에서 통로가 끊기면 끊긴 곳의 1단계 칸을 막고 다시 찾습니다.
  let worldBlocked = world.blocked;
  for (let attempt = 0; attempt < MAX_REPAIRS; attempt++) {
    const coarse = astar(world.grid, worldBlocked, pair.start, pair.goal);
    if (!coarse) break;
    // 출발 항구 → 1단계 경로 → 도착 항구, 날짜변경선을 넘어도 이어지게 경도를 펼침
    const guide = unwrapPath([[from.lon, from.lat], ...coarse.map((k) => world.grid.center(k)), [to.lon, to.lat]]);
    const region = corridorRegion(land, guide);
    if (region.start >= 0) return finishRegion(region);

    const breakAt = findBreak(region, guide);
    if (!breakAt) break;
    if (worldBlocked === world.blocked) worldBlocked = world.blocked.slice();
    const k = world.grid.cellOf(breakAt[0], breakAt[1]);
    const ci = world.grid.col(k);
    const cj = world.grid.row(k);
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        const m = world.grid.cellOf(world.grid.lonOf(ci + di), world.grid.latOf(cj + dj));
        if (m >= 0 && m !== pair.start && m !== pair.goal) worldBlocked[m] = 1;
      }
    }
  }
  throw new RouteError('항구 근처의 바다가 서로 이어져 있지 않거나 길을 찾지 못했습니다.');
}

/** 1단계 재시도 횟수 */
const MAX_REPAIRS = 10;

/** 1단계 경로(guide)를 따라 통로 격자를 만들고 출발·도착 칸을 고름 (못 고르면 start = -1) */
function corridorRegion(land, guide) {
  const fromPt = guide[0];
  const toPt = guide[guide.length - 1];
  const corridorKm = Math.min(CORRIDOR.maxKm, Math.max(CORRIDOR.minKm, polylineKm(guide) * CORRIDOR.ratio));

  let lonMin = Infinity, lonMax = -Infinity, latMin = Infinity, latMax = -Infinity;
  for (const [lon, lat] of guide) {
    lonMin = Math.min(lonMin, lon); lonMax = Math.max(lonMax, lon);
    latMin = Math.min(latMin, lat); latMax = Math.max(latMax, lat);
  }
  const dLat = corridorKm / KM_PER_DEG_LAT;
  const lat0 = Math.max(-FINE_LAT_LIMIT, latMin - dLat);
  const lat1 = Math.min(FINE_LAT_LIMIT, latMax + dLat);
  const maxAbsLat = Math.min(80, Math.max(Math.abs(lat0), Math.abs(lat1)));
  const dLon = corridorKm / (KM_PER_DEG_LON * Math.cos((maxAbsLat * Math.PI) / 180));
  const lon0 = lonMin - dLon;
  const lon1 = lonMax + dLon;
  const ideal = Math.sqrt(((lon1 - lon0) * (lat1 - lat0)) / FINE.maxCells);
  const cellDeg = Math.round(Math.min(FINE.maxDeg, Math.max(FINE.minDeg, ideal)) * 1000) / 1000;
  const grid = new Grid({
    lon0, lat0, cellDeg,
    nx: Math.ceil((lon1 - lon0) / cellDeg),
    ny: Math.ceil((lat1 - lat0) / cellDeg),
  });

  const landMask = rasterizeLand(land, grid);
  carvePassages(grid, landMask);
  const inCorridor = corridorMask(grid, guide, corridorKm);
  const blocked = new Uint8Array(grid.n);
  for (let k = 0; k < grid.n; k++) blocked[k] = landMask[k] || !inCorridor[k] ? 1 : 0;
  const comp = labelComponents(grid, blocked);

  // 격자가 성기면 좁은 만·피오르(예: 무르만스크)가 막히므로 칸 크기에 맞춰 찾는 반경을 넓힘
  const snapKm = Math.min(SNAP_MAX_KM, Math.max(SNAP_KM, 5 * grid.cellHeightKm));
  const pair = pickConnectedPair(grid, blocked, comp, fromPt, toPt, snapKm);
  return {
    grid, land: landMask, blocked, comp, fromPt, toPt, corridorKm, snapKm,
    start: pair ? pair.start : -1, goal: pair ? pair.goal : -1,
  };
}

/**
 * 통로가 끊긴 곳: 출발 쪽 가장 큰 바다 덩어리에서 1단계 경로를 따라가다
 * 처음으로 그 덩어리에 닿지 않는 지점. 못 찾으면 null.
 */
function findBreak({ grid, blocked, comp, fromPt, snapKm }, guide) {
  const size = new Map();
  for (const c of comp) if (c >= 0) size.set(c, (size.get(c) || 0) + 1);
  let main = -1;
  for (const { k } of openCellsNear(grid, blocked, fromPt[0], fromPt[1], snapKm)) {
    if (main < 0 || size.get(comp[k]) > size.get(main)) main = comp[k];
  }
  if (main < 0) return null;
  const reachKm = Math.max(25, 3 * grid.cellHeightKm);
  for (let i = 1; i < guide.length - 1; i++) {
    const near = openCellsNear(grid, blocked, guide[i][0], guide[i][1], reachKm);
    if (!near.some(({ k }) => comp[k] === main)) return guide[i];
  }
  return null;
}

/** 기존 항로: 짧으면 직선(막히지 않을 때), 아니면 위험을 무시한 최단 경로 */
function finishRegion({ grid, land, blocked, start, goal, fromPt, toPt, corridorKm }) {
  // 화면에서 통로 밖 바다를 흐리게 그릴 때 씀
  const outside = new Uint8Array(grid.n);
  for (let k = 0; k < grid.n; k++) outside[k] = blocked[k] && !land[k] ? 1 : 0;
  const a = grid.center(start);
  const b = grid.center(goal);
  let shortestPath;
  if (haversineKm(a, b) <= STRAIGHT_MAX_KM && isStraightClear(grid, blocked, a, b)) shortestPath = [a, b];
  else {
    const cells = astar(grid, blocked, start, goal);
    if (!cells) throw new RouteError('통로 안에서 길을 찾지 못했습니다.');
    shortestPath = cells.map((k) => grid.center(k));
  }
  return {
    grid, land, blocked, outside, start, goal, fromPt, toPt, shortestPath, corridorKm,
    bounds: { lon0: grid.lon0, lon1: grid.lon1, lat0: grid.lat0, lat1: grid.lat1 },
  };
}

/**
 * 경로를 따라가며 지표를 잼 (0.5 km 또는 격자 칸 절반 간격).
 * @returns {{km: number, highKm: number, exposure: number}}
 *   km: 총 거리, highKm: 민감 구역(위험도 ≥ HIGH_RISK) 통과 거리, exposure: Σ(위험도 × 거리)
 */
export function measureRoute(path, grid, risk) {
  const sampleKm = Math.max(0.5, grid.cellHeightKm / 2);
  let km = 0;
  let highKm = 0;
  let exposure = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const len = haversineKm(a, b);
    const steps = Math.max(1, Math.ceil(len / sampleKm));
    const step = len / steps;
    for (let s = 0; s < steps; s++) {
      const t = (s + 0.5) / steps;
      const k = grid.cellOf(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t);
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
 * 2단계: 위험도를 계산하고 AI 추천 항로를 찾음.
 * @param {Region} region planRegion() 결과
 * @param {Float32Array} density buildDensity() 결과 (region.grid 기준)
 * @param {Params} params
 * @returns {{risk: Float32Array, shortest: Route, safe: Route}}
 */
export function planRoutes(region, density, params) {
  const { grid, blocked, start, goal, shortestPath } = region;
  const risk = computeRisk(density, params.temp, params.optimalTemp);

  const w = avoidanceWeight(params.weight, params.noise);
  const cells = w > 0 ? astar(grid, blocked, start, goal, { weight: w, risk }) : null;
  const safePath = cells ? cells.map((k) => grid.center(k)) : shortestPath;

  const shortest = { path: shortestPath, metrics: measureRoute(shortestPath, grid, risk) };
  let safe = { path: safePath, metrics: measureRoute(safePath, grid, risk) };
  // 격자 오차로 AI 항로가 최단보다 짧게 나오는 일 방지
  if (safe.metrics.km < shortest.metrics.km) safe = shortest;

  return { risk, shortest, safe };
}

