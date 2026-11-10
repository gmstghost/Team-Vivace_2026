/**
 * 3단계: A* 탐색으로 위험 가중 비용이 가장 작은 항로를 찾음.
 *
 * 비용 = 거리 × (1 + 가중치 × 위험도)
 *
 * 전 세계 1단계 격자(동서가 이어짐)와 항로별 2단계 격자에 모두 씁니다.
 */
import { EARTH_RADIUS_KM } from './config.js';

/** 최소 힙 (Python의 heapq에 해당). 키와 우선순위를 나란한 타입 배열로 보관 */
class MinHeap {
  constructor(capacity = 1024) {
    this.keys = new Int32Array(capacity);
    this.prio = new Float64Array(capacity);
    this.size = 0;
  }

  push(key, priority) {
    if (this.size === this.keys.length) {
      const keys = new Int32Array(this.size * 2);
      const prio = new Float64Array(this.size * 2);
      keys.set(this.keys);
      prio.set(this.prio);
      this.keys = keys;
      this.prio = prio;
    }
    const { keys, prio } = this;
    let i = this.size++;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (prio[parent] <= priority) break;
      keys[i] = keys[parent];
      prio[i] = prio[parent];
      i = parent;
    }
    keys[i] = key;
    prio[i] = priority;
  }

  pop() {
    const { keys, prio } = this;
    const top = keys[0];
    const n = --this.size;
    if (n > 0) {
      const key = keys[n];
      const p = prio[n];
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const c = l + 1 < n && prio[l + 1] < prio[l] ? l + 1 : l;
        if (prio[c] >= p) break;
        keys[i] = keys[c];
        prio[i] = prio[c];
        i = c;
      }
      keys[i] = key;
      prio[i] = p;
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

/**
 * @param {import('./grid.js').Grid} grid
 * @param {Uint8Array} blocked 1 = 지나갈 수 없는 칸 (육지, 통로 밖)
 * @param {number} start 출발 칸 번호
 * @param {number} goal 도착 칸 번호
 * @param {{weight?: number, risk?: Float32Array}} [opts] weight: 위험 회피 가중치 (0이면 최단 거리)
 * @returns {number[] | null} 출발→도착 칸 번호 목록, 길이 없으면 null
 */
export function astar(grid, blocked, start, goal, { weight = 0, risk = null } = {}) {
  const { nx, ny, n, wrap, rowWidthKm, cellHeightKm, cellDeg } = grid;
  const useRisk = weight > 0 && risk;
  const gScore = new Float64Array(n).fill(Infinity);
  const cameFrom = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const open = new MinHeap();

  // 휴리스틱: 도착점까지 대권 거리 (하버사인). 격자 거리보다 조금 작게 잡아 과대평가하지 않게 함
  const RAD = Math.PI / 180;
  const sinHalfLat = Float64Array.from({ length: ny }, (_, j) => Math.sin(grid.latOf(j) * RAD / 2));
  const cosHalfLat = Float64Array.from({ length: ny }, (_, j) => Math.cos(grid.latOf(j) * RAD / 2));
  const cosLat = Float64Array.from({ length: ny }, (_, j) => Math.cos(grid.latOf(j) * RAD));
  const gi = goal % nx;
  const gj = (goal / nx) | 0;
  const H_SCALE = 2 * EARTH_RADIUS_KM * 0.995;
  const heuristic = (i, j) => {
    // sin((φ1-φ2)/2) = sin(φ1/2)cos(φ2/2) - cos(φ1/2)sin(φ2/2)
    const sdLat = sinHalfLat[j] * cosHalfLat[gj] - cosHalfLat[j] * sinHalfLat[gj];
    const sdLon = Math.sin(((i - gi) * cellDeg * RAD) / 2);
    const s = sdLat * sdLat + cosLat[j] * cosLat[gj] * sdLon * sdLon;
    return H_SCALE * Math.asin(Math.min(1, Math.sqrt(s)));
  };

  const colOf = (i) => {
    if (i >= 0 && i < nx) return i;
    return wrap ? (i + nx) % nx : -1;
  };
  const isOpen = (i, j) => {
    const c = colOf(i);
    return c >= 0 && j >= 0 && j < ny && !blocked[j * nx + c];
  };
  /** 대각·나이트 이동 시 지나치는 사이 칸이 막혀 있으면 통과 불가 (모서리 끼기 방지) */
  const cutsCorner = (ci, cj, di, dj) => {
    const si = Math.sign(di);
    const sj = Math.sign(dj);
    const adi = Math.abs(di);
    const adj = Math.abs(dj);
    if (adi === 1 && adj === 1) return !isOpen(ci + si, cj) || !isOpen(ci, cj + sj);
    if (adi === 2) return !isOpen(ci + si, cj) || !isOpen(ci + si, cj + dj);
    if (adj === 2) return !isOpen(ci, cj + sj) || !isOpen(ci + di, cj + sj);
    return false;
  };

  gScore[start] = 0;
  open.push(start, heuristic(start % nx, (start / nx) | 0));

  while (open.size) {
    const cur = open.pop();
    if (cur === goal) break;
    if (closed[cur]) continue;
    closed[cur] = 1;

    const ci = cur % nx;
    const cj = (cur / nx) | 0;
    for (const [di, dj] of MOVES) {
      const nj = cj + dj;
      if (nj < 0 || nj >= ny) continue;
      const ni = colOf(ci + di);
      if (ni < 0) continue;
      const next = nj * nx + ni;
      if (blocked[next] || closed[next]) continue;
      if (cutsCorner(ci, cj, di, dj)) continue;

      const dx = (di * (rowWidthKm[cj] + rowWidthKm[nj])) / 2;
      const dy = dj * cellHeightKm;
      const distKm = Math.sqrt(dx * dx + dy * dy);
      const step = useRisk ? distKm * (1 + (weight * (risk[cur] + risk[next])) / 2) : distKm;
      const tentative = gScore[cur] + step;
      if (tentative < gScore[next]) {
        gScore[next] = tentative;
        cameFrom[next] = cur;
        // sin²(Δ경도/2)는 360° 주기라 날짜변경선 너머도 그대로 맞음
        open.push(next, tentative + heuristic(ni, nj));
      }
    }
  }

  if (cameFrom[goal] < 0 && goal !== start) return null;
  const path = [];
  for (let k = goal; k >= 0; k = cameFrom[k]) {
    path.push(k);
    if (k === start) break;
  }
  return path.reverse();
}
