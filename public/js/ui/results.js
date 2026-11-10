/**
 * '항로 비교' 영역(표, 막대, 요약 문장)을 채움.
 */
const $ = (id) => document.getElementById(id);

const KM_PER_NM = 1.852;

/** b 대비 a의 변화율 (%) */
const pctChange = (a, b) => (b > 0 ? ((a - b) / b) * 100 : 0);
/** 부호를 붙인 숫자 문자열 (+3.2) */
const signed = (v, digits) => (v > 0 ? '+' : '') + v.toFixed(digits);
const kmHtml = (km) => `${km.toFixed(1)} <span class="u">km</span>`;

function setBar(id, value, max, text) {
  $(id).style.width = `${(value / max) * 100}%`;
  $(`${id}V`).textContent = text;
}

/**
 * @param {{km: number, highKm: number, exposure: number}} old 기존 항로 지표
 * @param {{km: number, highKm: number, exposure: number}} ai  AI 추천 항로 지표
 */
export function renderResults(old, ai) {
  // 표
  $('dOld').innerHTML = kmHtml(old.km);
  $('dAi').innerHTML = kmHtml(ai.km);
  $('dDelta').textContent = `${signed(pctChange(ai.km, old.km), 1)}%`;
  $('hOld').innerHTML = kmHtml(old.highKm);
  $('hAi').innerHTML = kmHtml(ai.highKm);
  $('hDelta').textContent = old.highKm > 0 ? `${signed(pctChange(ai.highKm, old.highKm), 0)}%` : '–';
  $('eOld').textContent = old.exposure.toFixed(1);
  $('eAi').textContent = ai.exposure.toFixed(1);
  $('eDelta').textContent = old.exposure > 0 ? `${signed(pctChange(ai.exposure, old.exposure), 0)}%` : '–';

  // 막대: 민감 구역 통과 비율
  const highOld = (old.highKm / old.km) * 100;
  const highAi = (ai.highKm / ai.km) * 100;
  const highMax = Math.max(highOld, highAi, 1);
  setBar('bHOld', highOld, highMax, `${highOld.toFixed(0)}%`);
  setBar('bHAi', highAi, highMax, `${highAi.toFixed(0)}%`);

  // 막대: 총 이동 거리 (기존 = 100%)
  const distAi = (ai.km / old.km) * 100;
  const distMax = Math.max(distAi, 100);
  setBar('bDOld', 100, distMax, '100%');
  setBar('bDAi', distAi, distMax, `${distAi.toFixed(0)}%`);

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
      `${extraKm.toFixed(1)} km (${(extraKm / KM_PER_NM).toFixed(1)}해리, ` +
      `<b class="cost">${signed(pctChange(ai.km, old.km), 1)}%</b>) 더 가는 대신 ` +
      `민감 구역 통과 거리가 <b class="ai">${highChange}% ${direction}</b>.`;
  }
}
