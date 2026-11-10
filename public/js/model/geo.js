/**
 * 지구 위 거리 계산과 경도 다루기.
 *
 * 경도는 -180~180으로 돌지만, 태평양을 건너는 항로는 날짜변경선(180°)을 넘어가므로
 * 계산할 때는 '펼친 경도'(예: 129 → 241)를 씁니다. 같은 지점은 ±360을 더해도 같습니다.
 */
import { EARTH_RADIUS_KM } from './config.js';

const RAD = Math.PI / 180;

/** 두 점 사이 대권 거리 (km, 하버사인 공식) */
export function haversineKm(a, b) {
  const dLat = (b[1] - a[1]) * RAD;
  const dLon = (b[0] - a[0]) * RAD;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** 경로 전체 길이 (km) */
export function polylineKm(path) {
  let km = 0;
  for (let i = 1; i < path.length; i++) km += haversineKm(path[i - 1], path[i]);
  return km;
}

/** 경도를 -180~180 범위로 */
export const wrapLon = (lon) => ((((lon + 180) % 360) + 360) % 360) - 180;

/** lon에 ±360을 더해 ref에 가장 가까운 값으로 (펼친 경도) */
export function nearLon(lon, ref) {
  return lon + 360 * Math.round((ref - lon) / 360);
}

/** 점 목록의 경도를 앞 점에서 180° 넘게 튀지 않도록 펼침 (새 배열) */
export function unwrapPath(points) {
  const out = [];
  for (const [lon, lat] of points) {
    out.push([out.length ? nearLon(lon, out[out.length - 1][0]) : lon, lat]);
  }
  return out;
}

/** 경도 표시 문자열: 129.5 → '129.5°E', -74 → '74.0°W' */
export function formatLon(lon, digits = 1) {
  const w = wrapLon(lon);
  if (Math.abs(w) < 1e-9 || Math.abs(Math.abs(w) - 180) < 1e-9) return `${Math.abs(w).toFixed(digits)}°`;
  return `${Math.abs(w).toFixed(digits)}°${w > 0 ? 'E' : 'W'}`;
}

/** 위도 표시 문자열: 36.5 → '36.5°N' */
export function formatLat(lat, digits = 1) {
  if (Math.abs(lat) < 1e-9) return `0°`;
  return `${Math.abs(lat).toFixed(digits)}°${lat > 0 ? 'N' : 'S'}`;
}
