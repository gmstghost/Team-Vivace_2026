/**
 * 해역 격자와 육지 판정.
 *
 * 격자는 1차원 배열로 저장합니다. 칸 번호 k = j * NX + i
 * (i: 경도 방향 열, j: 위도 방향 행, j=0이 가장 남쪽).
 * numpy로 치면 shape (NY, NX) 배열을 ravel() 한 것과 같습니다.
 */
import { BOUNDS, CELL_DEG, COASTLINE, ULLEUNG } from './config.js';

export const NX = Math.round((BOUNDS.lon1 - BOUNDS.lon0) / CELL_DEG);
export const NY = Math.round((BOUNDS.lat1 - BOUNDS.lat0) / CELL_DEG);
export const N = NX * NY;

export const cellIndex = (i, j) => j * NX + i;
export const colOf = (k) => k % NX;
export const rowOf = (k) => (k / NX) | 0;

/** 열 i의 중심 경도 */
export const cellLon = (i) => BOUNDS.lon0 + (i + 0.5) * CELL_DEG;
/** 행 j의 중심 위도 */
export const cellLat = (j) => BOUNDS.lat0 + (j + 0.5) * CELL_DEG;
/** 칸 k의 중심 [경도, 위도] */
export const cellCenter = (k) => [cellLon(colOf(k)), cellLat(rowOf(k))];

/** 좌표가 속한 칸 번호. 해역 밖이면 -1 */
export function cellOf(lon, lat) {
  const i = Math.floor((lon - BOUNDS.lon0) / CELL_DEG);
  const j = Math.floor((lat - BOUNDS.lat0) / CELL_DEG);
  if (i < 0 || j < 0 || i >= NX || j >= NY) return -1;
  return cellIndex(i, j);
}

/** 점이 다각형 안에 있는지 (ray casting) */
function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** 좌표가 육지(본토 또는 울릉도)인지 */
export function isLand(lon, lat) {
  const dx = (lon - ULLEUNG.lon) / ULLEUNG.rx;
  const dy = (lat - ULLEUNG.lat) / ULLEUNG.ry;
  return dx * dx + dy * dy <= 1 || pointInPolygon(lon, lat, COASTLINE);
}

/** 칸별 육지 여부 (1 = 육지). 모듈을 불러올 때 한 번만 계산 */
export const landMask = (() => {
  const mask = new Uint8Array(N);
  for (let j = 0; j < NY; j++) {
    for (let i = 0; i < NX; i++) mask[cellIndex(i, j)] = isLand(cellLon(i), cellLat(j)) ? 1 : 0;
  }
  return mask;
})();

/**
 * 바다에서 COAST_REACH 칸 안쪽까지의 칸 (바다 칸 포함).
 * 해안선을 단순화해서 생긴 오차로 갯바위·항구의 기록(따개비, 멍게 등)이
 * 육지 칸에 떨어지는 경우가 많아서, 이 범위 안의 기록은 버리지 않고 씁니다.
 */
export const COAST_REACH = 3; // 칸 (약 6 km)
export const nearSeaMask = (() => {
  const mask = new Uint8Array(N);
  for (let j = 0; j < NY; j++) {
    for (let i = 0; i < NX; i++) {
      if (landMask[cellIndex(i, j)]) continue; // 바다 칸에서 출발해
      // 주변 칸을 모두 표시
      for (let dj = -COAST_REACH; dj <= COAST_REACH; dj++) {
        for (let di = -COAST_REACH; di <= COAST_REACH; di++) {
          const ni = i + di;
          const nj = j + dj;
          if (ni >= 0 && nj >= 0 && ni < NX && nj < NY) mask[cellIndex(ni, nj)] = 1;
        }
      }
    }
  }
  return mask;
})();

/** 좌표에서 가장 가까운 바다 칸 번호 (항구가 육지 칸에 걸쳐 있을 때 사용) */
export function snapToWater(lon, lat, maxRadius = 12) {
  const i0 = Math.min(NX - 1, Math.max(0, Math.floor((lon - BOUNDS.lon0) / CELL_DEG)));
  const j0 = Math.min(NY - 1, Math.max(0, Math.floor((lat - BOUNDS.lat0) / CELL_DEG)));
  for (let r = 0; r < maxRadius; r++) {
    let best = -1;
    let bestDist = Infinity;
    for (let dj = -r; dj <= r; dj++) {
      for (let di = -r; di <= r; di++) {
        const i = i0 + di;
        const j = j0 + dj;
        if (i < 0 || j < 0 || i >= NX || j >= NY) continue;
        const k = cellIndex(i, j);
        if (landMask[k]) continue;
        const d = di * di + dj * dj;
        if (d < bestDist) { bestDist = d; best = k; }
      }
    }
    if (best >= 0) return best;
  }
  return cellIndex(i0, j0);
}
