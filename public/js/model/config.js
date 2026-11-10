/**
 * 시뮬레이션 상수 모음 (Python으로 치면 settings.py / constants.py).
 *
 * 좌표는 모두 [경도, 위도] 순서입니다 (GeoJSON과 같은 x, y 순서).
 */

/** 위도·경도 1도당 km (경도는 cos(위도)를 곱해서 사용) */
export const KM_PER_DEG_LAT = 111.2;
export const KM_PER_DEG_LON = 111.32;
export const EARTH_RADIUS_KM = 6371.0;

/** 이 위험도 이상이면 '민감 구역' */
export const HIGH_RISK = 0.5;

/** 커널 밀도 추정 반경 (km). 데이터 칸이 이보다 크면 칸 크기에 맞춰 넓힘 (density.js) */
export const KDE_SIGMA_KM = 7.5;

/** 예시 데이터: 난수 시드와 범위 (동해 포항–울릉 해역, 가상 값) */
export const SAMPLE_SEED = 20261110;
export const SAMPLE_BOUNDS = Object.freeze({ lon0: 129.0, lon1: 131.2, lat0: 35.8, lat1: 37.8 });

// ---------- 항로 탐색 (routing.js) ----------

/** 1단계 전 세계 격자의 위도 범위 (남극 빙붕 제외) */
export const LAT_MIN = -75;
export const LAT_MAX = 84;

/**
 * 결빙 때문에 일반 상선이 다니지 않는 북극해는 1단계 격자에서 막음:
 * 위도 lat 위쪽은 경도 openLon 범위(그린란드 동쪽~노르웨이~바렌츠해)만 열어 둡니다.
 * 이게 없으면 부산→로테르담이 수에즈 대신 북극 항로(북동항로)로 나옵니다.
 * 북극 항로를 시험하려면 lat을 90으로 올리세요.
 */
export const ARCTIC_ICE = Object.freeze({ lat: 66, openLon: [-60, 60] });

/** 2단계 통로 격자의 위도 한계 */
export const FINE_LAT_LIMIT = 85;

/**
 * 1단계 전 세계 격자: 0.25° (약 28 km) 칸.
 * 칸 안 바다 비율이 COARSE_WATER_MIN 이상이면 바다로 봅니다.
 * 이 격자로 대략의 길(통로)을 찾고, 2단계에서 통로 안만 촘촘하게 다시 찾습니다.
 */
export const COARSE_DEG = 0.25;
export const COARSE_WATER_MIN = 0.25;

/** 2단계 격자: 칸 수가 maxCells를 넘지 않는 선에서 가장 촘촘하게 (minDeg ~ maxDeg) */
export const FINE = Object.freeze({ minDeg: 0.01, maxDeg: 0.15, maxCells: 800_000 });

/** 통로 반경 = 1단계 항로 길이 × ratio (minKm ~ maxKm). 이 밖으로는 우회하지 않음 */
export const CORRIDOR = Object.freeze({ minKm: 50, ratio: 0.2, maxKm: 150 });

/**
 * 항구 좌표에서 이 거리 안의 가장 가까운 바다 칸을 출발·도착점으로 씀 (km).
 * 격자가 성길수록(먼 항로) 칸 크기 × 5까지 넓히되 SNAP_MAX_KM을 넘지 않음.
 */
export const SNAP_KM = 40;
export const SNAP_MAX_KM = 90;
export const COARSE_SNAP_KM = 150;

/** 이보다 짧은 항로는 '기존 항로'로 직선을 먼저 시도 (km). 긴 항로는 지구가 둥글어 직선이 최단이 아님 */
export const STRAIGHT_MAX_KM = 500;

/**
 * 해안선 데이터(1:10m)에서 육지로 막혀 있거나 격자보다 좁은 운하·해협.
 * 이 선을 따라 격자 칸을 바다로 뚫습니다. [경도, 위도] 중심선.
 */
export const PASSAGES = Object.freeze([
  { name: '수에즈 운하', path: [[32.31, 31.34], [32.31, 31.25], [32.32, 30.85], [32.30, 30.58], [32.34, 30.45], [32.40, 30.35], [32.47, 30.22], [32.55, 30.0], [32.56, 29.92], [32.56, 29.84]] },
  { name: '파나마 운하', path: [[-79.92, 9.42], [-79.92, 9.35], [-79.92, 9.27], [-79.87, 9.18], [-79.80, 9.13], [-79.69, 9.11], [-79.65, 9.06], [-79.61, 9.02], [-79.59, 9.0], [-79.56, 8.94], [-79.52, 8.86]] },
  { name: '킬 운하', path: [[8.75, 53.9], [9.14, 53.89], [9.35, 54.05], [9.5, 54.18], [9.67, 54.3], [9.9, 54.33], [10.14, 54.37], [10.2, 54.42]] },
  { name: '보스포루스 해협', path: [[29.13, 41.25], [29.08, 41.18], [29.06, 41.12], [29.03, 41.07], [29.0, 41.02], [28.98, 40.97]] },
  { name: '다르다넬스 해협', path: [[26.15, 40.0], [26.3, 40.08], [26.4, 40.15], [26.45, 40.2], [26.55, 40.3], [26.68, 40.42], [26.78, 40.5]] },
  { name: '지브롤터 해협', path: [[-5.2, 35.98], [-5.6, 35.95], [-6.0, 35.95]] },
  { name: '메시나 해협', path: [[15.66, 38.3], [15.64, 38.27], [15.6, 38.2], [15.62, 38.12], [15.63, 38.05]] },
  { name: '외레순 해협', path: [[12.55, 56.15], [12.65, 56.04], [12.7, 55.9], [12.72, 55.75]] },
  { name: '바브엘만데브 해협', path: [[43.2, 12.75], [43.35, 12.6], [43.5, 12.45]] },
  { name: '싱가포르 해협', path: [[103.55, 1.2], [103.85, 1.2], [104.1, 1.25], [104.4, 1.3]] },
]);

/** 처음 열릴 때의 항로 (UN/LOCODE) */
export const DEFAULT_ROUTE = Object.freeze({ from: 'KRKPO', to: 'KRULL' });

/** 빠른 선택 버튼 */
export const PRESET_ROUTES = Object.freeze([
  { label: '포항 → 울릉', from: 'KRKPO', to: 'KRULL' },
  { label: '부산 → 로테르담', from: 'KRPUS', to: 'NLRTM' },
  { label: '부산 → 로스앤젤레스', from: 'KRPUS', to: 'USLAX' },
  { label: '부산 → 뉴욕 (파나마)', from: 'KRPUS', to: 'USNYC' },
  { label: '인천 → 싱가포르', from: 'KRINC', to: 'SGSIN' },
]);
