/**
 * 전 세계 항구 목록 (UN/LOCODE + Natural Earth)과 검색.
 *
 * public/data/world/ports.json 은 tools/build_world_data.py 가 만듭니다.
 */
export const PORTS_URL = 'data/world/ports.json';

/**
 * @typedef {Object} Port
 * @property {string} id       UN/LOCODE ('KRPUS'). Natural Earth에만 있는 항구는 'KR~123' 꼴
 * @property {string} name     영문(현지) 이름
 * @property {string} [ko]     한국어 이름 (있을 때만)
 * @property {string} country  국가 코드 2자리
 * @property {number} lon
 * @property {number} lat
 * @property {boolean} major   주요 항구 (Natural Earth 항구 목록에 있거나 한국어 이름이 있는 곳)
 */

const regionNames = (lang) => {
  try {
    return new Intl.DisplayNames([lang], { type: 'region' });
  } catch {
    return null;
  }
};
const KO_REGIONS = regionNames('ko');
const EN_REGIONS = regionNames('en');

/** 국가 코드 → 한국어 국가 이름 (브라우저가 모르면 코드 그대로) */
export function countryName(code, names = KO_REGIONS) {
  try {
    return names?.of(code) || code;
  } catch {
    return code;
  }
}

/** 화면 표시 이름: 한국어 이름이 있으면 그것, 없으면 영문 이름 */
export const portLabel = (p) => p.ko || p.name;

/** 검색용 정규화: 악센트 제거, 소문자, 공백 정리 */
const norm = (s) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export async function loadPorts(url = PORTS_URL) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data.ports.map(([id, name, lon, lat, major, ko]) => {
    const country = id.slice(0, 2);
    return {
      id, name, lon, lat, country, major: major === 1, ...(ko ? { ko } : {}),
      // 검색 키 (화면에는 안 씀)
      _keys: [norm(name), ko ? norm(ko) : '', id.toLowerCase()],
      _country: [norm(countryName(country)), norm(countryName(country, EN_REGIONS))],
    };
  });
}

/**
 * 이름·한국어 이름·UN/LOCODE·국가 이름으로 항구 검색.
 * 순위: 코드 일치 > 이름이 검색어로 시작 > 이름 안 단어가 검색어로 시작 > 이름에 포함 > 국가 이름 일치.
 * 같은 순위면 주요 항구, 짧은 이름 순.
 * @param {Port[]} ports
 * @param {string} query
 * @param {number} [limit]
 */
export function searchPorts(ports, query, limit = 12) {
  const q = norm(query);
  if (!q) return ports.filter((p) => p.ko && p.country === 'KR').slice(0, limit);
  const scored = [];
  for (const p of ports) {
    const [en, ko, id] = p._keys;
    let score = -1;
    const code = q.replace(/ /g, '');
    if (id === code) score = 0;
    else if (code.length >= 3 && id.startsWith(code)) score = 1;
    else if (en.startsWith(q) || ko.startsWith(q)) score = 1;
    else if (en.includes(` ${q}`) || ko.includes(` ${q}`)) score = 2;
    else if (q.length >= 2 && (en.includes(q) || ko.includes(q))) score = 3;
    else if (q.length >= 2 && p._country.some((c) => c === q || c.startsWith(q))) score = 4;
    if (score >= 0) scored.push([score, p.major ? 0 : 1, portLabel(p).length, p]);
  }
  scored.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  return scored.slice(0, limit).map((s) => s[3]);
}
