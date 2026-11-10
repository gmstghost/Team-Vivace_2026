/**
 * 위도·경도 격자.
 *
 * 격자는 1차원 배열로 저장합니다. 칸 번호 k = j * nx + i
 * (i: 경도 방향 열, j: 위도 방향 행, j=0이 가장 남쪽).
 * numpy로 치면 shape (ny, nx) 배열을 ravel() 한 것과 같습니다.
 *
 * 항로마다 해역이 달라서 격자도 항로마다 새로 만듭니다 (routing.js).
 * wrap = true인 격자(전 세계 1단계 격자)는 동쪽 끝과 서쪽 끝이 이어져 있습니다.
 */
import { KM_PER_DEG_LAT, KM_PER_DEG_LON } from './config.js';

export class Grid {
  /**
   * @param {{lon0: number, lat0: number, cellDeg: number, nx: number, ny: number, wrap?: boolean}} o
   *   lon0·lat0: 남서쪽 모서리 (lon0은 펼친 경도일 수 있음)
   */
  constructor({ lon0, lat0, cellDeg, nx, ny, wrap = false }) {
    Object.assign(this, { lon0, lat0, cellDeg, nx, ny, wrap });
    this.n = nx * ny;
    this.lon1 = lon0 + nx * cellDeg;
    this.lat1 = lat0 + ny * cellDeg;
    /** 행별 칸 가로 길이 (km) — 위도가 높을수록 짧아짐 */
    this.rowWidthKm = Float64Array.from({ length: ny }, (_, j) => cellDeg * KM_PER_DEG_LON * Math.cos((this.latOf(j) * Math.PI) / 180));
    this.cellHeightKm = cellDeg * KM_PER_DEG_LAT;
  }

  index(i, j) { return j * this.nx + i; }
  col(k) { return k % this.nx; }
  row(k) { return (k / this.nx) | 0; }

  /** 열 i의 중심 경도 */
  lonOf(i) { return this.lon0 + (i + 0.5) * this.cellDeg; }
  /** 행 j의 중심 위도 */
  latOf(j) { return this.lat0 + (j + 0.5) * this.cellDeg; }
  /** 칸 k의 중심 [경도, 위도] */
  center(k) { return [this.lonOf(this.col(k)), this.latOf(this.row(k))]; }

  /** 좌표가 속한 칸 번호. 격자 밖이면 -1 */
  cellOf(lon, lat) {
    const j = Math.floor((lat - this.lat0) / this.cellDeg);
    if (j < 0 || j >= this.ny) return -1;
    let i = Math.floor((lon - this.lon0) / this.cellDeg);
    if (this.wrap) i = ((i % this.nx) + this.nx) % this.nx;
    else if (i < 0 || i >= this.nx) return -1;
    return j * this.nx + i;
  }

  /** 범위 [lon0, lon1] × [lat0, lat1] 안에 있는지 (펼친 경도 기준) */
  contains(lon, lat) {
    return lon >= this.lon0 && lon < this.lon1 && lat >= this.lat0 && lat < this.lat1;
  }
}

/**
 * 막힌 칸(1)을 피해 상하좌우로 이어진 바다 덩어리마다 번호를 매김.
 * 서로 다른 번호의 칸 사이에는 길이 없습니다 (예: 카스피해와 대양).
 * @param {Grid} grid
 * @param {Uint8Array} blocked 1 = 지나갈 수 없음
 * @returns {Int32Array} 칸별 덩어리 번호 (막힌 칸은 -1)
 */
export function labelComponents(grid, blocked) {
  const { nx, ny, n, wrap } = grid;
  const comp = new Int32Array(n).fill(-1);
  const queue = new Int32Array(n);
  let label = 0;
  for (let s = 0; s < n; s++) {
    if (blocked[s] || comp[s] >= 0) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = s;
    comp[s] = label;
    while (head < tail) {
      const k = queue[head++];
      const i = k % nx;
      const j = (k / nx) | 0;
      const visit = (ni, nj) => {
        if (nj < 0 || nj >= ny) return;
        if (ni < 0 || ni >= nx) {
          if (!wrap) return;
          ni = (ni + nx) % nx;
        }
        const m = nj * nx + ni;
        if (!blocked[m] && comp[m] < 0) {
          comp[m] = label;
          queue[tail++] = m;
        }
      };
      visit(i + 1, j); visit(i - 1, j); visit(i, j + 1); visit(i, j - 1);
    }
    label++;
  }
  return comp;
}
