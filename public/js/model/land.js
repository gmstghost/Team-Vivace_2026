/**
 * 육지 다각형 (Natural Earth 1:10m)을 불러와 격자에 칠함.
 *
 * public/data/world/land.json 은 tools/build_world_data.py 가 만듭니다.
 * 바깥 고리는 반시계, 구멍(호수 등)은 시계 방향이라 'nonzero' 규칙으로 칠합니다:
 * 어떤 점에서 왼쪽으로 고리를 몇 번 감는지(winding) 세어 0이 아니면 육지.
 */
import { COARSE_DEG, COARSE_WATER_MIN, LAT_MIN, LAT_MAX, ARCTIC_ICE, PASSAGES } from './config.js';
import { Grid, labelComponents } from './grid.js';
import { haversineKm } from './geo.js';

export const LAND_URL = 'data/world/land.json';

/**
 * @typedef {Object} Ring
 * @property {Float64Array} xy  [경도0, 위도0, 경도1, 위도1, ...]
 * @property {number} minX
 * @property {number} minY
 * @property {number} maxX
 * @property {number} maxY
 *
 * @typedef {{rings: Ring[]}} Land
 */

/** land.json (정수 차분 인코딩) → 고리 목록 */
export function decodeLand(data) {
  const s = data.scale;
  const rings = data.rings.map((enc) => {
    const xy = new Float64Array(enc.length);
    let x = enc[0];
    let y = enc[1];
    let minX = x, maxX = x, minY = y, maxY = y;
    xy[0] = x / s;
    xy[1] = y / s;
    for (let p = 2; p < enc.length; p += 2) {
      x += enc[p];
      y += enc[p + 1];
      xy[p] = x / s;
      xy[p + 1] = y / s;
      if (x < minX) minX = x; else if (x > maxX) maxX = x;
      if (y < minY) minY = y; else if (y > maxY) maxY = y;
    }
    return { xy, minX: minX / s, minY: minY / s, maxX: maxX / s, maxY: maxY / s };
  });
  return { rings };
}

export async function loadLand(url = LAND_URL) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return decodeLand(await res.json());
}

/**
 * 주사선(scanline) 칠하기의 핵심.
 * 위도 y_r = y0 + r × dy (r = 0..rows-1) 가로선마다 육지 구간 [xa, xb)를 onSpan(r, xa, xb)로 알려 줌.
 * 경도 범위 [lonMin, lonMax]는 펼친 경도일 수 있어서, 고리를 ±360 옮긴 사본도 함께 봅니다.
 */
function scanLand(land, { y0, dy, rows, lonMin, lonMax }, onSpan) {
  const up = Array.from({ length: rows }, () => []);   // 위로 가는 변과의 교점 x (winding +1)
  const down = Array.from({ length: rows }, () => []); // 아래로 가는 변 (winding -1)
  const yLo = y0 - dy;
  const yHi = y0 + rows * dy;

  for (const ring of land.rings) {
    if (ring.maxY < yLo || ring.minY > yHi) continue;
    for (const shift of [-360, 0, 360]) {
      if (ring.maxX + shift <= lonMin || ring.minX + shift >= lonMax) continue;
      const { xy } = ring;
      const n = xy.length;
      for (let p = 0; p < n; p += 2) {
        const q = p + 2 < n ? p + 2 : 0;
        const ya = xy[p + 1];
        const yb = xy[q + 1];
        if (ya === yb) continue;
        const lo = ya < yb ? ya : yb;
        const hi = ya < yb ? yb : ya;
        // y_r 가 [lo, hi) 안에 드는 r
        const r0 = Math.max(0, Math.ceil((lo - y0) / dy));
        const r1 = Math.min(rows, Math.ceil((hi - y0) / dy));
        if (r1 <= r0) continue;
        const xa = xy[p] + shift;
        const slope = (xy[q] + shift - xa) / (yb - ya);
        const target = yb > ya ? up : down;
        for (let r = r0; r < r1; r++) target[r].push(xa + (y0 + r * dy - ya) * slope);
      }
    }
  }

  for (let r = 0; r < rows; r++) {
    if (!up[r].length && !down[r].length) continue;
    const u = Float64Array.from(up[r]).sort();
    const d = Float64Array.from(down[r]).sort();
    let a = 0;
    let b = 0;
    let winding = 0;
    let start = 0;
    while (a < u.length || b < d.length) {
      const takeUp = b >= d.length || (a < u.length && u[a] <= d[b]);
      const x = takeUp ? u[a++] : d[b++];
      const before = winding;
      winding += takeUp ? 1 : -1;
      if (before === 0 && winding !== 0) start = x;
      else if (before !== 0 && winding === 0) onSpan(r, start, x);
    }
  }
}

/**
 * 격자 칸마다 육지 여부 (1 = 육지). 칸 중심이 육지 안이면 육지.
 * @param {Land} land
 * @param {Grid} grid
 */
export function rasterizeLand(land, grid) {
  const { nx, lon0, cellDeg } = grid;
  const mask = new Uint8Array(grid.n);
  scanLand(land, { y0: grid.latOf(0), dy: cellDeg, rows: grid.ny, lonMin: lon0, lonMax: grid.lon1 }, (r, xa, xb) => {
    const i0 = Math.max(0, Math.ceil((xa - lon0) / cellDeg - 0.5));
    const i1 = Math.min(nx, Math.ceil((xb - lon0) / cellDeg - 0.5));
    if (i1 > i0) mask.fill(1, r * nx + i0, r * nx + i1);
  });
  return mask;
}

/**
 * 운하·좁은 해협(config.js PASSAGES)을 따라 칸을 바다로 뚫음.
 * 2×2 칸 붓으로 칠해서 대각선으로만 이어지는 일 없이 상하좌우로 연결되게 합니다.
 */
export function carvePassages(grid, mask, passages = PASSAGES) {
  const step = grid.cellDeg / 3;
  for (const { path } of passages) {
    for (let s = 1; s < path.length; s++) {
      const [ax, ay] = path[s - 1];
      const [bx, by] = path[s];
      const n = Math.max(1, Math.ceil(Math.max(Math.abs(bx - ax), Math.abs(by - ay)) / step));
      for (let t = 0; t <= n; t++) {
        const lon = ax + ((bx - ax) * t) / n;
        const lat = ay + ((by - ay) * t) / n;
        for (const shift of grid.wrap ? [0] : [-360, 0, 360]) {
          for (const [di, dj] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
            const k = grid.cellOf(lon + shift + di * grid.cellDeg * 0.999, lat + dj * grid.cellDeg * 0.999);
            if (k >= 0) mask[k] = 0;
          }
        }
      }
    }
  }
}

/**
 * 1단계용 전 세계 격자 (0.25°, 동서가 이어짐).
 * 칸마다 가로선 4개로 육지 길이를 재서 바다 비율을 구하고, COARSE_WATER_MIN 이상이면 바다.
 * @returns {{grid: Grid, blocked: Uint8Array, comp: Int32Array}}
 */
export function buildWorldGrid(land) {
  const nx = Math.round(360 / COARSE_DEG);
  const ny = Math.round((LAT_MAX - LAT_MIN) / COARSE_DEG);
  const grid = new Grid({ lon0: -180, lat0: LAT_MIN, cellDeg: COARSE_DEG, nx, ny, wrap: true });

  const SUB = 4;
  const landDeg = new Float32Array(grid.n); // 칸 안 가로선들이 육지를 지난 길이 합 (도)
  scanLand(land, { y0: LAT_MIN + COARSE_DEG / (2 * SUB), dy: COARSE_DEG / SUB, rows: ny * SUB, lonMin: -180, lonMax: 180 }, (r, xa, xb) => {
    const base = ((r / SUB) | 0) * nx;
    const a = Math.max(-180, xa);
    const b = Math.min(180, xb);
    if (b <= a) return;
    const i0 = Math.floor((a + 180) / COARSE_DEG);
    const i1 = Math.min(nx - 1, Math.floor((b + 180) / COARSE_DEG));
    for (let i = i0; i <= i1; i++) {
      const c0 = -180 + i * COARSE_DEG;
      landDeg[base + i] += Math.min(b, c0 + COARSE_DEG) - Math.max(a, c0);
    }
  });

  const blocked = new Uint8Array(grid.n);
  const maxLand = SUB * COARSE_DEG * (1 - COARSE_WATER_MIN);
  for (let k = 0; k < grid.n; k++) blocked[k] = landDeg[k] > maxLand ? 1 : 0;
  carvePassages(grid, blocked);
  // 북극해 결빙 구역
  for (let j = 0; j < ny; j++) {
    if (grid.latOf(j) < ARCTIC_ICE.lat) continue;
    for (let i = 0; i < nx; i++) {
      const lon = grid.lonOf(i);
      if (lon < ARCTIC_ICE.openLon[0] || lon > ARCTIC_ICE.openLon[1]) blocked[j * nx + i] = 1;
    }
  }
  return { grid, blocked, comp: labelComponents(grid, blocked) };
}

/**
 * 좌표에서 maxKm 안의 열린(막히지 않은) 칸을 가까운 순서로.
 * @returns {{k: number, km: number}[]}
 */
export function openCellsNear(grid, blocked, lon, lat, maxKm) {
  const rj = Math.ceil(maxKm / grid.cellHeightKm) + 1;
  const j0 = Math.floor((lat - grid.lat0) / grid.cellDeg);
  const out = [];
  for (let j = Math.max(0, j0 - rj); j <= Math.min(grid.ny - 1, j0 + rj); j++) {
    const w = Math.max(grid.rowWidthKm[j], 1e-3);
    const ri = Math.min(Math.ceil(maxKm / w) + 1, grid.wrap ? grid.nx >> 1 : grid.nx);
    const i0 = Math.floor((lon - grid.lon0) / grid.cellDeg);
    for (let i = i0 - ri; i <= i0 + ri; i++) {
      let ii = i;
      if (grid.wrap) ii = ((i % grid.nx) + grid.nx) % grid.nx;
      else if (i < 0 || i >= grid.nx) continue;
      const k = j * grid.nx + ii;
      if (blocked[k]) continue;
      const km = haversineKm([lon, lat], [grid.lon0 + (i + 0.5) * grid.cellDeg, grid.latOf(j)]);
      if (km <= maxKm) out.push({ k, km });
    }
  }
  return out.sort((a, b) => a.km - b.km);
}
