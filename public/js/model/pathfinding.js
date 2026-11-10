/**
 * 3단계: A* 탐색으로 위험 가중 비용이 가장 작은 항로를 찾음.
 *
 * 비용 = 거리 × (1 + 가중치 × 위험도)
 */
import { CELL_DEG, KM_PER_DEG_LAT, KM_PER_DEG_LON, BOUNDS } from './config.js';
import { N, NX, NY, cellIndex, cellLat, cellCenter, colOf, rowOf, landMask } from './grid.js';

/** 최소 힙 (Python의 heapq에 해당). 키와 우선순위를 나란한 배열로 보관 */
class MinHeap {
  constructor() {
    this.keys = [];
    this.prio = [];
  }

  get size() {
    return this.keys.length;
  }

  _swap(a, b) {
    [this.keys[a], this.keys[b]] = [this.keys[b], this.keys[a]];
    [this.prio[a], this.prio[b]] = [this.prio[b], this.prio[a]];
  }

  push(key, priority) {
    this.keys.push(key);
    this.prio.push(priority);
    let i = this.keys.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.prio[parent] <= this.prio[i]) break;
      this._swap(parent, i);
      i = parent;
    }
  }

  pop() {
    const top = this.keys[0];
    const lastKey = this.keys.pop();
    const lastPrio = this.prio.pop();
    if (this.keys.length) {
      this.keys[0] = lastKey;
      this.prio[0] = lastPrio;
      const n = this.keys.length;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < n && this.prio[l] < this.prio[m]) m = l;
        if (r < n && this.prio[r] < this.prio[m]) m = r;
        if (m === i) break;
        this._swap(m, i);
        i = m;
      }
    }
    return top;
  }
}

/** 이동 방향: 상하좌우 4 + 대각 4 + 나이트 이동 8 (더 매끄러운 각도) */
const MOVES = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
  [1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1],
];

/** 행별 칸 가로 길이 (km) — 위도가 높을수록 짧아짐 */
const cellWidthKm = Float32Array.from({ length: NY }, (_, j) => CELL_DEG * KM_PER_DEG_LON * Math.cos((cellLat(j) * Math.PI) / 180));
const cellHeightKm = CELL_DEG * KM_PER_DEG_LAT;
/** 휴리스틱이 과대평가하지 않도록 가장 좁은 칸 폭 사용 */
const minCellWidthKm = CELL_DEG * KM_PER_DEG_LON * Math.cos((BOUNDS.lat1 * Math.PI) / 180);

/** 대각·나이트 이동 시 지나치는 사이 칸이 육지면 통과 불가 (모서리 끼기 방지) */
function cutsCorner(ci, cj, di, dj) {
  const si = Math.sign(di);
  const sj = Math.sign(dj);
  const adi = Math.abs(di);
  const adj = Math.abs(dj);
  if (adi === 1 && adj === 1) return landMask[cellIndex(ci + si, cj)] || landMask[cellIndex(ci, cj + sj)];
  if (adi === 2) return landMask[cellIndex(ci + si, cj)] || landMask[cellIndex(ci + si, cj + dj)];
  if (adj === 2) return landMask[cellIndex(ci, cj + sj)] || landMask[cellIndex(ci + di, cj + sj)];
  return false; // 상하좌우
}

/**
 * @param {number} start 출발 칸 번호
 * @param {number} goal 도착 칸 번호
 * @param {number} weight 위험 회피 가중치 (0이면 최단 거리)
 * @param {Float32Array} risk 칸별 위험도 0~1
 * @returns {number[][] | null} [경도, 위도] 경로 (칸 중심), 길이 없으면 null
 */
export function astar(start, goal, weight, risk) {
  const gScore = new Float32Array(N).fill(Infinity);
  const cameFrom = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const open = new MinHeap();

  const gi = colOf(goal);
  const gj = rowOf(goal);
  const heuristic = (k) => {
    const dx = (colOf(k) - gi) * minCellWidthKm;
    const dy = (rowOf(k) - gj) * cellHeightKm;
    return Math.sqrt(dx * dx + dy * dy);
  };

  gScore[start] = 0;
  open.push(start, heuristic(start));

  while (open.size) {
    const cur = open.pop();
    if (cur === goal) break;
    if (closed[cur]) continue;
    closed[cur] = 1;

    const ci = colOf(cur);
    const cj = rowOf(cur);
    for (const [di, dj] of MOVES) {
      const ni = ci + di;
      const nj = cj + dj;
      if (ni < 0 || nj < 0 || ni >= NX || nj >= NY) continue;
      const next = cellIndex(ni, nj);
      if (landMask[next] || closed[next]) continue;
      if (cutsCorner(ci, cj, di, dj)) continue;

      const dx = (di * (cellWidthKm[cj] + cellWidthKm[nj])) / 2;
      const dy = dj * cellHeightKm;
      const distKm = Math.sqrt(dx * dx + dy * dy);
      const tentative = gScore[cur] + distKm * (1 + (weight * (risk[cur] + risk[next])) / 2);
      if (tentative < gScore[next]) {
        gScore[next] = tentative;
        cameFrom[next] = cur;
        open.push(next, tentative + heuristic(next));
      }
    }
  }

  if (cameFrom[goal] < 0 && goal !== start) return null;
  const path = [];
  for (let k = goal; k >= 0; k = cameFrom[k]) {
    path.push(cellCenter(k));
    if (k === start) break;
  }
  return path.reverse();
}
