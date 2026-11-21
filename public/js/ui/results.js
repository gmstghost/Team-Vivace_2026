/**
 * '항로 비교' 영역(표, 막대, 요약 문장)을 채움.
 */
import { PASSAGES } from '../model/config.js';
import { polylineKm } from '../model/geo.js';

const $ = (id) => document.getElementById(id);

const KM_PER_NM = 1.852;

/** b 대비 a의 변화율 (%) */
const pctChange = (a, b) => (b > 0 ? ((a - b) / b) * 100 : 0);
/** 부호를 붙인 숫자 문자열 (+3.2) */
const signed = (v, digits) => (v > 0 ? '+' : '') + v.toFixed(digits);
/** 거리 표시: 1000 km 이상은 정수에 천 단위 쉼표 */
const fmtKm = (km) => (km >= 1000 ? Math.round(km).toLocaleString('ko-KR') : km.toFixed(1));
const kmHtml = (km) => `${fmtKm(km)} <span class="u">km</span>`;

function setBar(id, value, max, text) {
  $(id).style.width = `${(value / max) * 100}%`;
  $(`${id}V`).textContent = text;
}

/**
 * @param {{km: number, highKm: number, exposure: number}} old 기존 항로 지표
 * @param {{km: number, highKm: number, exposure: number}} ai  AI 추천 항로 지표
 * @param {string[]} [oldVia] 기존 항로가 지나는 운하·해협
 * @param {string[]} [aiVia]  회피 항로가 지나는 운하·해협
 */
export function renderResults(old, ai, oldVia = [], aiVia = []) {
  // 표
  $('dOld').innerHTML = kmHtml(old.km);
  $('dAi').innerHTML = kmHtml(ai.km);
  $('dDelta').textContent = `${signed(pctChange(ai.km, old.km), 1)}%`;
  $('hOld').innerHTML = kmHtml(old.highKm);
  $('hAi').innerHTML = kmHtml(ai.highKm);
  $('hDelta').textContent = old.highKm > 0 ? `${signed(pctChange(ai.highKm, old.highKm), 0)}%` : '–';
  $('eOld').textContent = fmtKm(old.exposure);
  $('eAi').textContent = fmtKm(ai.exposure);
  $('eDelta').textContent = old.exposure > 0 ? `${signed(pctChange(ai.exposure, old.exposure), 0)}%` : '–';

  // 막대: 민감 구역 통과 비율
  const highOld = (old.highKm / old.km) * 100;
  const highAi = (ai.highKm / ai.km) * 100;
  const highMax = Math.max(highOld, highAi, 1);
  setBar('bHOld', highOld, highMax, `${highOld.toFixed(0)}%`);
  setBar('bHAi', highAi, highMax, `${highAi.toFixed(0)}%`);

  const extraDistance = Math.max(0, ai.km - old.km);
  $('distanceExtra').textContent = '+' + fmtKm(extraDistance) + ' km';
  $('distanceExtraPct').textContent = '(+' + Math.max(0, pctChange(ai.km, old.km)).toFixed(1) + '%)';
  $('avoidanceRate').textContent = old.highKm > 0.05
    ? Math.max(0, (1 - ai.highKm / old.highKm) * 100).toFixed(0) + '%'
    : '해당 없음';

  renderVia(oldVia, aiVia);

  // 요약 문장
  const headline = $('headline');
  const extraKm = ai.km - old.km;
  if (old.highKm < 0.05) {
    headline.textContent = '기존 항로가 민감 구역을 지나지 않습니다. 돌아갈 필요가 없습니다.';
  } else if (extraKm < 0.05) {
    headline.textContent = '두 항로가 같습니다. 회피 가중치나 소음을 올리면 우회 항로가 나옵니다.';
  } else {
    const highChange = Math.abs(pctChange(ai.highKm, old.highKm)).toFixed(0);
    const direction = ai.highKm <= old.highKm ? '줄어듭니다' : '늘어납니다';
    headline.innerHTML =
      `${fmtKm(extraKm)} km (${fmtKm(extraKm / KM_PER_NM)}해리, ` +
      `<b class="cost">${signed(pctChange(ai.km, old.km), 1)}%</b>) 더 가는 대신 ` +
      `민감 구역 통과 거리가 <b class="ai">${highChange}% ${direction}</b>.`;
  }
}

/** 경유 운하·해협 목록 (항로에서 지나는 순서) */
function renderVia(oldVia = [], aiVia = []) {
  const names = [...new Set([...oldVia, ...aiVia])];
  const box = $('routeVia');
  box.hidden = !names.length;
  const list = $('routeViaList');
  list.replaceChildren(...names.map((name) => {
    const p = PASSAGES.find((x) => x.name === name);
    const li = document.createElement('li');
    const b = document.createElement('b');
    b.textContent = name;
    const k = document.createElement('span');
    k.className = 'k';
    k.textContent = p ? `${p.canal ? '운하' : '해협'} · ${Math.round(polylineKm(p.path))} km` : '';
    const w = document.createElement('span');
    w.className = 'w';
    const inOld = oldVia.includes(name);
    const inAi = aiVia.includes(name);
    w.textContent = inOld && inAi ? '두 항로 모두' : inOld ? '기존 항로만' : '회피 항로만';
    li.append(b, k, w);
    return li;
  }));
}

/** 항로를 못 찾았을 때 표와 막대를 비움 */
export function clearResults() {
  for (const id of ['dOld', 'dAi', 'dDelta', 'hOld', 'hAi', 'hDelta', 'eOld', 'eAi', 'eDelta']) $(id).textContent = '–';
  for (const id of ['bHOld', 'bHAi']) setBar(id, 0, 1, '');
  for (const id of ['distanceExtra', 'distanceExtraPct', 'avoidanceRate']) $(id).textContent = '–';
  $('headline').textContent = '항로가 없습니다. 다른 항구를 골라 보세요.';
  renderVia();
}
