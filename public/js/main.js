/**
 * 진입점: 화면 요소와 계산 모듈을 연결합니다 (Python의 `if __name__ == "__main__":` 부분).
 *
 *   model/  순수 계산 (격자, 데이터, 밀도, A*, 항로 비교) — DOM 없음
 *   ui/     화면 (지도, 결과표, 아두이노)
 */
import { PORTS, HIGH_RISK } from './model/config.js';
import { cellOf, landMask } from './model/grid.js';
import { samplePoints, keepSeaPoints, parseCsv, fetchObisPoints } from './model/occurrences.js';
import { buildDensity } from './model/density.js';
import { planRoutes } from './model/routing.js';
import { MapView } from './ui/map-view.js';
import { renderResults } from './ui/results.js';
import { ArduinoLink } from './ui/arduino.js';

const $ = (id) => document.getElementById(id);
const fmtKo = (n) => n.toLocaleString('ko-KR');

const SAMPLE_LABEL = '예시 데이터 (가상)';
const SERIAL_IDLE = '연결 안 됨 · 슬라이더로 값을 직접 넣는 중';

// ---------- 상태 ----------
const state = {
  port: 'pohang',
  temp: 15,
  noise: 50,
  optimalTemp: 15,
  weight: 6,
  points: [],
  density: null,
  risk: null,
};

const mapView = new MapView($('map'));

// ---------- 계산 → 화면 ----------
function recompute() {
  const { risk, shortest, safe } = planRoutes(state, state.density);
  state.risk = risk;
  mapView.setRisk(risk);
  mapView.draw({
    points: state.points,
    showPoints: $('showPts').checked,
    shortestPath: shortest.path,
    safePath: safe.path,
    port: PORTS[state.port],
  });
  renderResults(shortest.metrics, safe.metrics);
}

/** 슬라이더를 끄는 동안 프레임당 한 번만 계산 */
let frameRequested = false;
function scheduleRecompute() {
  if (frameRequested) return;
  frameRequested = true;
  requestAnimationFrame(() => {
    frameRequested = false;
    recompute();
  });
}

/** 출현 기록 교체 → 밀도 다시 계산 */
function setPoints(all, label, isSample = false) {
  state.points = keepSeaPoints(all);
  state.density = buildDensity(state.points);

  const badge = $('dataBadge');
  badge.textContent = label;
  badge.className = isSample ? 'badge' : 'badge real';

  const dropped = all.length - state.points.length;
  $('dataMsg').textContent =
    `이 해역 안의 출현 기록 ${fmtKo(state.points.length)}건` + (dropped ? ` (범위 밖·육지 ${fmtKo(dropped)}건 제외)` : '');
  recompute();
}

// ---------- 슬라이더 ----------
/** 슬라이더 id → [state 키, 표시 형식] */
const SLIDERS = {
  temp: ['temp', (v) => `${v.toFixed(1)} °C`],
  noise: ['noise', (v) => `${v.toFixed(0)} %`],
  topt: ['optimalTemp', (v) => `${v.toFixed(1)} °C`],
  weight: ['weight', (v) => v.toFixed(1)],
};

/** 상태값을 슬라이더와 숫자 표시에 반영 (아두이노 값이 들어올 때도 사용) */
function setSlider(id, value) {
  const [key, format] = SLIDERS[id];
  state[key] = value;
  $(id).value = value;
  $(`${id}Out`).textContent = format(value);
}

for (const id of Object.keys(SLIDERS)) {
  const el = $(id);
  setSlider(id, parseFloat(el.value));
  el.addEventListener('input', () => {
    setSlider(id, parseFloat(el.value));
    scheduleRecompute();
  });
}

$('port').addEventListener('change', (e) => {
  state.port = e.target.value;
  recompute();
});
state.port = $('port').value;

$('showPts').addEventListener('change', (e) => {
  mapView.draw({ ...mapView.scene, showPoints: e.target.checked });
});

// ---------- 데이터 불러오기 ----------
$('sampleBtn').addEventListener('click', () => setPoints(samplePoints(), SAMPLE_LABEL, true));

$('csvFile').addEventListener('change', async (e) => {
  const input = e.target;
  const file = input.files[0];
  if (!file) return;
  try {
    setPoints(parseCsv(await file.text()), `CSV · ${file.name}`);
  } catch (err) {
    $('dataMsg').textContent = `불러오지 못했습니다. ${err.message}`;
  } finally {
    input.value = ''; // 같은 파일을 다시 고를 수 있게
  }
});

$('obisBtn').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  $('dataMsg').textContent = 'OBIS에서 불러오는 중…';
  try {
    const { points, total } = await fetchObisPoints();
    const more = total > points.length ? ` · 전체 ${fmtKo(total)}건 중 일부` : '';
    setPoints(points, `OBIS 실데이터${more}`);
  } catch {
    $('dataMsg').textContent = 'OBIS에 접속하지 못했습니다. 잠시 후 다시 시도하거나, obis.org에서 내려받은 CSV를 불러오세요.';
  } finally {
    btn.disabled = false;
  }
});

// ---------- 지도 위 좌표·위험도 표시 ----------
$('map').addEventListener('pointermove', (e) => {
  const [lon, lat] = mapView.toLonLat(e.clientX, e.clientY);
  const k = cellOf(lon, lat);
  if (k < 0 || !state.risk) return;
  const r = state.risk[k];
  const where = `${lat.toFixed(2)}°N ${lon.toFixed(2)}°E`;
  if (landMask[k]) {
    $('readout').textContent = `${where} · 육지`;
  } else {
    const zone = r >= HIGH_RISK ? '높음' : r >= 0.25 ? '보통' : '낮음';
    $('readout').textContent = `${where} · 위험도 ${r.toFixed(2)} (${zone})`;
  }
});

// ---------- 아두이노 ----------
function setSerialStatus(text, kind = '') {
  const el = $('serialStatus');
  el.textContent = text;
  el.className = kind ? `status ${kind}` : 'status';
}

const arduino = new ArduinoLink({
  onReading({ temp, noise, raw }) {
    if (temp !== null) setSlider('temp', temp);
    setSlider('noise', noise);
    setSerialStatus(`수신 중 · ${raw}${temp === null ? ' (수온 센서 미연결)' : ''}`, 'on');
    scheduleRecompute();
  },
  onStatus: setSerialStatus,
  onConnectionChange(connected) {
    // 연결 중에는 센서가 수온·소음을 정하므로 슬라이더를 잠금
    $('temp').disabled = connected;
    $('noise').disabled = connected;
    $('serialBtn').textContent = connected ? '연결 끊기' : '아두이노 연결';
    if (!connected) setSerialStatus(SERIAL_IDLE);
  },
});

$('serialBtn').addEventListener('click', () => (arduino.connected ? arduino.disconnect() : arduino.connect()));

// ---------- 아두이노 스케치 표시·복사 ----------
async function loadSketch() {
  const pre = $('sketch');
  try {
    const res = await fetch('arduino/safe_route_sensor.ino');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    pre.textContent = await res.text();
  } catch {
    pre.textContent = '// 스케치를 불러오지 못했습니다. 위의 링크로 내려받으세요.';
  }
}

$('copyBtn').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  try {
    await navigator.clipboard.writeText($('sketch').textContent);
    btn.textContent = '복사됨';
  } catch {
    // 클립보드 권한이 없으면 글자를 선택해 두고 직접 복사하게 함
    const range = document.createRange();
    range.selectNodeContents($('sketch'));
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    btn.textContent = '선택됨 · Ctrl+C';
  }
  setTimeout(() => (btn.textContent = '복사'), 2000);
});

// ---------- 시작 ----------
window.addEventListener('resize', () => mapView.resize());
document.fonts?.ready.then(() => mapView.redraw());
mapView.resize();
setPoints(samplePoints(), SAMPLE_LABEL, true);
loadSketch();
