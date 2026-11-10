/**
 * 진입점: 화면 요소와 계산 모듈을 연결합니다 (Python의 `if __name__ == "__main__":` 부분).
 *
 *   model/  순수 계산 (격자, 데이터, 밀도, A*, 항로 비교) — DOM 없음
 *   ui/     화면 (지도, 결과표, 아두이노)
 */
import { PORTS, HIGH_RISK } from './model/config.js';
import { cellOf, landMask } from './model/grid.js';
import { samplePoints, keepSeaPoints, parseCsv, loadTargetDataset } from './model/occurrences.js';
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
  points: [],          // 해역 안 출현 기록 [경도, 위도, 분류군]
  groups: [],          // 화면에 보일 분류군 [{key, label, count}] (분류군이 없는 데이터면 빈 배열)
  activeGroups: null,  // 켜 둔 분류군 key의 Set (null = 전부)
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
    points: visiblePoints(),
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

const visiblePoints = () =>
  state.activeGroups ? state.points.filter((p) => state.activeGroups.has(p[2])) : state.points;

/**
 * 출현 기록 교체 → 분류군 선택지와 밀도를 다시 만듦.
 * @param {Array} all [경도, 위도, 분류군] 목록
 * @param {string} label 배지 문구
 * @param {{isSample?: boolean, groups?: Array<{key: string, label: string}>}} [opts]
 *   groups: 분류군 표시 이름 (OBIS 메타데이터). 없으면 CSV의 group 값을 그대로 이름으로 씀
 */
function setPoints(all, label, { isSample = false, groups = null } = {}) {
  state.points = keepSeaPoints(all);
  const dropped = all.length - state.points.length;

  // 분류군 목록: 메타데이터 순서를 따르고, 실제 기록이 있는 것만
  const counts = new Map();
  for (const p of state.points) counts.set(p[2], (counts.get(p[2]) || 0) + 1);
  const known = groups || [...counts.keys()].map((key) => ({ key, label: key || '(분류군 없음)' }));
  state.groups = counts.size > 1 || !counts.has('')
    ? known.filter((g) => counts.has(g.key)).map((g) => ({ ...g, count: counts.get(g.key) }))
    : [];
  state.activeGroups = state.groups.length ? new Set(state.groups.map((g) => g.key)) : null;
  renderGroupFilters();

  const badge = $('dataBadge');
  badge.textContent = label;
  badge.className = isSample ? 'badge' : 'badge real';
  $('dataMsg').textContent =
    `이 해역 안의 출현 기록 ${fmtKo(state.points.length)}건` + (dropped ? ` (범위 밖·내륙 ${fmtKo(dropped)}건 제외)` : '');

  rebuildDensity();
}

function rebuildDensity() {
  state.density = buildDensity(state.points, state.activeGroups);
  recompute();
}

/** 분류군 켜기/끄기 체크박스 */
function renderGroupFilters() {
  const list = $('groupList');
  list.replaceChildren();
  $('groupBox').hidden = state.groups.length === 0;
  for (const g of state.groups) {
    const chip = document.createElement('label');
    chip.className = 'chip';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = true;
    box.addEventListener('change', () => {
      if (box.checked) state.activeGroups.add(g.key);
      else state.activeGroups.delete(g.key);
      rebuildDensity();
    });
    const count = document.createElement('span');
    count.className = 'n';
    count.textContent = fmtKo(g.count);
    chip.append(box, ` ${g.label} `, count);
    list.append(chip);
  }
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
$('sampleBtn').addEventListener('click', () => setPoints(samplePoints(), SAMPLE_LABEL, { isSample: true }));

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

/** 미리 받아 둔 OBIS 보호 대상 데이터. 실패하면 false */
async function loadTargets() {
  const btn = $('obisBtn');
  btn.disabled = true;
  $('dataMsg').textContent = '보호 대상 데이터를 불러오는 중…';
  try {
    const { points, meta } = await loadTargetDataset();
    const date = (meta.generatedAt || '').slice(0, 10);
    $('dataDate').textContent = date ? `${date}에 OBIS에서 받은` : 'OBIS에서 받은';
    setPoints(points, 'OBIS 실데이터', { groups: meta.groups });
    return true;
  } catch {
    $('dataMsg').textContent = '보호 대상 데이터 파일을 불러오지 못했습니다. tools/fetch_obis_targets.py로 public/data/ 파일을 만드세요.';
    return false;
  } finally {
    btn.disabled = false;
  }
}

$('obisBtn').addEventListener('click', loadTargets);

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
loadTargets().then((ok) => {
  if (!ok) setPoints(samplePoints(), SAMPLE_LABEL, { isSample: true });
});
loadSketch();
