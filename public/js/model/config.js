/**
 * 시뮬레이션 상수 모음 (Python으로 치면 settings.py / constants.py).
 *
 * 좌표는 모두 [경도, 위도] 순서입니다 (GeoJSON과 같은 x, y 순서).
 */

/** 시뮬레이션 해역 범위 (도) */
export const BOUNDS = Object.freeze({ lon0: 129.0, lon1: 131.2, lat0: 35.8, lat1: 37.8 });

/** 격자 한 칸 크기 (도). 0.02° ≈ 2 km */
export const CELL_DEG = 0.02;

/** 위도·경도 1도당 km (경도는 cos(위도)를 곱해서 사용) */
export const KM_PER_DEG_LAT = 111.2;
export const KM_PER_DEG_LON = 111.32;

/** 이 위험도 이상이면 '민감 구역' */
export const HIGH_RISK = 0.5;

/** 지도 표시에 쓰는 기준 위도 (해역 중앙 근처) */
export const REF_LAT = 36.8;

/** 커널 밀도 추정 반경 (도). 0.07° ≈ 7 km */
export const KDE_SIGMA_DEG = 0.07;

/** 예시 데이터 난수 시드 (항상 같은 그림이 나오도록 고정) */
export const SAMPLE_SEED = 20261110;

/** 단순화한 동해안 다각형 [경도, 위도], 북→남. 마지막 점은 다각형을 닫기 위한 남서쪽 모서리 */
export const COASTLINE = Object.freeze([
  [129.0, 37.72], [129.03, 37.69], [129.05, 37.62], [129.12, 37.55], [129.19, 37.44], [129.28, 37.33],
  [129.35, 37.23], [129.43, 37.06], [129.42, 36.99], [129.45, 36.85], [129.46, 36.68], [129.45, 36.51],
  [129.39, 36.36], [129.37, 36.2], [129.40, 36.13], [129.43, 36.11], [129.39, 36.07], [129.38, 36.03],
  [129.45, 36.0], [129.52, 36.03], [129.57, 36.08], [129.585, 36.05], [129.56, 35.99], [129.52, 35.88],
  [129.50, 35.8], [129.0, 35.8],
]);

/** 울릉도 (타원으로 근사) */
export const ULLEUNG = Object.freeze({ lon: 130.866, lat: 37.506, rx: 0.062, ry: 0.046 });

/** 출발 항구 */
export const PORTS = Object.freeze({
  pohang: { name: '포항', lon: 129.46, lat: 36.06 },
  hupo:   { name: '후포', lon: 129.49, lat: 36.68 },
  mukho:  { name: '묵호', lon: 129.15, lat: 37.55 },
});

/** 도착지 (울릉도 사동항) */
export const DESTINATION = Object.freeze({ name: '울릉도', lon: 130.90, lat: 37.44 });
