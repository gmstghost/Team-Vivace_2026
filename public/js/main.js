/**
 * 진입점: 화면 요소와 계산 모듈을 연결합니다 (Python의 `if __name__ == "__main__":` 부분).
 *
 *   model/  순수 계산 (육지, 항구, 격자, 데이터, 밀도, A*, 항로 비교) — DOM 없음
 *   ui/     화면 (지도, 항구 검색, 결과표, 아두이노)
 *
 * 흐름: 항구 선택 → planRegion (해역·기존 항로, 무거움) → 출현 기록·밀도 → planRoutes (AI 항로, 가벼움)
 * 슬라이더는 planRoutes만 다시 부릅니다.
 */
import { HIGH_RISK, DEFAULT_ROUTE, PRESET_ROUTES } from './model/config.js';
import { loadLand, buildWorldGrid } from './model/land.js';
import { loadPorts, portLabel, countryName } from './model/ports.js';
import { formatLat, formatLon } from './model/geo.js';
import {
  samplePoints, parseCsv, loadTargetBaseline, pointsInBounds, detailPrecision, precisionCellKm, fetchDetail,
} from './model/occurrences.js';
import { buildDensity } from './model/density.js';
import { planRegion, planRoutes, RouteError } from './model/routing.js';
import { MapView } from './ui/map-view.js';
import { PortPicker } from './ui/port-picker.js';
import { renderResults, clearResults } from './ui/results.js';
import { ArduinoLink } from './ui/arduino.js';

const $ = (id) => document.getElementById(id);
const fmtKo = (n) => Math.round(n).toLocaleString('ko-KR');
const fmtMs = (ms) => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)}초`);
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

const SAMPLE_LABEL = '예시 데이터 (가상)';
const SERIAL_IDLE = '연결 안 됨 · 슬라이더로 값을 직접 넣는 중';

// ---------- 상태 ----------
const state = {
  temp: 15,
  noise: 50,
  optimalTemp: 15,
  weight: 6,
  from: null,          // 출발 항구
  to: null,            // 도착 항구
  region: null,        // planRegion() 결과 (해역 격자, 기존 항로)
  dataMode: 'obis',    // 'obis' | 'csv' | 'sample'
  dataName: '',        // CSV 파일 이름
  allPoints: [],       // 지금 데이터의 전체 출현 기록
  csvGroups: null,
  detail: null,        // 현재 해역의 OBIS 상세 격자 { key, precision, points }
  detailStatus: '',    // 'loading' | 'failed' | 'too-wide' | ''
  points: [],          // 해역 안 출현 기록 (펼친 경도)
  groups: [],          // 화면에 보일 분류군 [{key, label, count}]
  activeGroups: null,  // 켜 둔 분류군 key의 Set (null = 전부)
  density: null,
  risk: null,
};

/** 한 번 불러오면 바뀌지 않는 데이터 */
const data = { land: null, world: null, ports: [], portById: new Map(), baseline: null };

const mapView = new MapView($('map'), { onPortClick: showPortPopup, onHover: showReadout });

// ---------- 계산 → 화면 ----------
function recompute() {
  const { region } = state;
  if (!region || !state.density) return;
  const { risk, shortest, safe } = planRoutes(region, state.density, state);
  state.risk = risk;
  mapView.setRisk(region.grid, risk, region.outside);
  mapView.draw({
    points: visiblePoints(),
    showPoints: $('showPts').checked,
    shortestPath: shortest.path,
    safePath: safe.path,
    from: { port: state.from, pt: region.fromPt },
    to: { port: state.to, pt: region.toPt },
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

// ---------- 항로 (항구) ----------
function setRouteMsg(text, kind = '') {
  const el = $('routeMsg');
  el.textContent = text;
  el.className = kind ? `hint ${kind}` : 'hint';
}

let routeSeq = 0;
/** 출발·도착 항구를 정하고 해역과 기존 항로를 계산 */
async function setRoute(from, to) {
  if (!from || !to) return;
  state.from = from;
  state.to = to;
  fromPicker.set(from);
  toPicker.set(to);
  hidePortPopup();
  const seq = ++routeSeq;
  if (!data.world) return; // 아직 데이터를 불러오는 중이면 끝난 뒤 다시 부름

  setRouteMsg(`${portLabel(from)} → ${portLabel(to)} 항로를 찾는 중…`);
  $('mapbox').classList.add('busy');
  await nextFrame(); // 안내 문구가 먼저 보이도록
  if (seq !== routeSeq) return;

  try {
    const t0 = performance.now();
    const region = planRegion(data.world, data.land, from, to);
    state.region = region;
    state.detail = null;
    const g = region.grid;
    const cellKm = g.cellHeightKm < 10 ? g.cellHeightKm.toFixed(1) : g.cellHeightKm.toFixed(0);
    setRouteMsg(
      `탐색 해역 ${fmtKo(g.nx)}×${fmtKo(g.ny)}칸 (칸 ${g.cellDeg}° ≈ ${cellKm} km) · ` +
      `통로 반경 ${fmtKo(region.corridorKm)} km · 계산 ${fmtMs(performance.now() - t0)}`,
    );
    fitRoute();
    refreshPoints();
    if (state.dataMode === 'obis') requestDetail();
  } catch (err) {
    state.region = null;
    state.density = null;
    clearResults();
    mapView.heat = null;
    mapView.draw(null);
    mapView.fitBounds(boundsOf([[from.lon, from.lat], [to.lon, to.lat]]));
    setRouteMsg(err instanceof RouteError ? err.message : `계산 중 오류: ${err.message}`, 'err');
    if (!(err instanceof RouteError)) console.error(err);
  } finally {
    if (seq === routeSeq) $('mapbox').classList.remove('busy');
  }
}

function boundsOf(points) {
  let lon0 = Infinity, lon1 = -Infinity, lat0 = Infinity, lat1 = -Infinity;
  for (const [lon, lat] of points) {
    lon0 = Math.min(lon0, lon); lon1 = Math.max(lon1, lon);
    lat0 = Math.min(lat0, lat); lat1 = Math.max(lat1, lat);
  }
  const pad = Math.max(0.15, (lon1 - lon0) * 0.04, (lat1 - lat0) * 0.04);
  return { lon0: lon0 - pad, lon1: lon1 + pad, lat0: lat0 - pad, lat1: lat1 + pad };
}

/** 지도를 항로에 맞춤 */
function fitRoute() {
  const r = state.region;
  if (r) mapView.fitBounds(boundsOf([...r.shortestPath, r.fromPt, r.toPt]));
}

const portById = (id) => data.portById.get(id);

// ---------- 출현 기록 ----------
/** 지금 데이터와 해역으로 해역 안 기록·분류군·밀도를 다시 만듦 */
function refreshPoints() {
  const { region } = state;
  if (!region) return;
  const useDetail = state.dataMode === 'obis' && state.detail?.key === regionKey(region);
  const source = useDetail ? state.detail.points : state.allPoints;
  state.points = pointsInBounds(source, region.bounds, 0.5);

  // 분류군 목록: OBIS는 메타데이터 순서, CSV는 나온 순서. 해역 안에 기록이 있는 것만
  const counts = new Map();
  for (const p of state.points) counts.set(p[2], (counts.get(p[2]) || 0) + (p[3] || 1));
  const known = state.dataMode === 'obis' && data.baseline
    ? data.baseline.meta.groups
    : [...counts.keys()].map((key) => ({ key, label: key || '(분류군 없음)' }));
  const prevActive = state.activeGroups;
  state.groups = counts.size > 1 || (counts.size === 1 && !counts.has(''))
    ? known.filter((g) => counts.has(g.key)).map((g) => ({ ...g, count: counts.get(g.key) }))
    : [];
  // 끈 분류군은 해역이 바뀌어도 꺼 둔 채로
  state.activeGroups = state.groups.length
    ? new Set(state.groups.map((g) => g.key).filter((k) => !prevActive || prevActive.has(k) || !state._knownGroups?.has(k)))
    : null;
  state._knownGroups = new Set([...(state._knownGroups || []), ...state.groups.map((g) => g.key)]);
  renderGroupFilters();
  renderDataStatus(useDetail);
  rebuildDensity();
}

function rebuildDensity() {
  const { region } = state;
  if (!region) return;
  state.density = buildDensity(region.grid, region.land, state.points, state.activeGroups);
  recompute();
}

const regionKey = (r) => [r.grid.lon0, r.grid.lat0, r.grid.lon1, r.grid.lat1].map((v) => v.toFixed(3)).join(',');

/** OBIS 상세 격자를 해역별로 기억 (같은 항로로 돌아오면 다시 받지 않음) */
const detailCache = new Map();
let detailAbort = null;

/** 현재 해역의 보호 대상 기록을 OBIS에서 촘촘한 격자로 받아 기본 격자를 대신함 */
async function requestDetail() {
  const { region } = state;
  if (!region || !data.baseline) return;
  detailAbort?.abort();
  const precision = detailPrecision(region.bounds);
  if (!precision) {
    state.detailStatus = 'too-wide';
    renderDataStatus(false);
    return;
  }
  const key = regionKey(region);
  const cacheKey = `${precision}:${key}`;
  if (detailCache.has(cacheKey)) {
    state.detail = { key, precision, points: detailCache.get(cacheKey) };
    state.detailStatus = '';
    refreshPoints();
    return;
  }
  const ctrl = new AbortController();
  detailAbort = ctrl;
  state.detailStatus = 'loading';
  renderDataStatus(false);
  try {
    const points = await fetchDetail(data.baseline.meta.groups, region.bounds, precision, ctrl.signal);
    if (ctrl.signal.aborted || state.region !== region || state.dataMode !== 'obis') return;
    detailCache.set(cacheKey, points);
    state.detail = { key, precision, points };
    state.detailStatus = '';
    refreshPoints();
  } catch (err) {
    if (ctrl.signal.aborted) return;
    console.warn('OBIS 상세 기록을 받지 못함', err);
    state.detailStatus = 'failed';
    renderDataStatus(false);
  }
}

/** 데이터 배지와 안내 문구 */
function renderDataStatus(useDetail) {
  const badge = $('dataBadge');
  const msg = $('dataMsg');
  const total = state.points.reduce((s, p) => s + (p[3] || 1), 0);
  let text = `이 해역 안 출현 기록 ${fmtKo(total)}건`;

  if (state.dataMode === 'obis') {
    const base = data.baseline;
    const baseKm = precisionCellKm(base.meta.precision);
    badge.className = 'badge real';
    if (useDetail) {
      badge.textContent = `OBIS · 상세 격자 ≈${precisionCellKm(state.detail.precision)} km`;
      text += ` (OBIS에서 이 해역만 바로 받은 ${fmtKo(state.points.length)}칸)`;
    } else {
      badge.textContent = `OBIS · 기본 격자 ≈${baseKm} km`;
      text += {
        loading: ' · 이 해역의 촘촘한 기록을 OBIS에서 받는 중…',
        failed: ' · OBIS에 연결하지 못해 미리 받아 둔 전 세계 기본 격자를 씁니다.',
        'too-wide': ' · 해역이 넓어 미리 받아 둔 전 세계 기본 격자를 씁니다.',
      }[state.detailStatus] || '';
    }
  } else if (state.dataMode === 'csv') {
    badge.className = 'badge real';
    badge.textContent = `CSV · ${state.dataName}`;
    const outside = state.allPoints.length - state.points.length;
    if (outside > 0) text += ` (해역 밖 ${fmtKo(outside)}건 제외)`;
  } else {
    badge.className = 'badge';
    badge.textContent = SAMPLE_LABEL;
    if (!state.points.length) text = '예시 데이터는 동해 포항–울릉 해역에만 있습니다. 이 항로에서는 민감 구역이 없습니다.';
  }
  msg.textContent = text;
}

/** 데이터 종류를 바꿈 */
function setDataMode(mode, { points = [], name = '' } = {}) {
  detailAbort?.abort();
  state.dataMode = mode;
  state.dataName = name;
  state.detailStatus = '';
  state.activeGroups = null;
  state._knownGroups = null;
  if (mode === 'obis') state.allPoints = data.baseline.points;
  else if (mode === 'sample') state.allPoints = samplePoints();
  else state.allPoints = points;
  refreshPoints();
  if (mode === 'obis') requestDetail();
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
    box.checked = state.activeGroups.has(g.key);
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

// ---------- 항구 검색·빠른 선택 ----------
const fromPicker = new PortPicker($('fromPort'), {
  getPorts: () => data.ports,
  onSelect: (p) => setRoute(p, state.to),
});
const toPicker = new PortPicker($('toPort'), {
  getPorts: () => data.ports,
  onSelect: (p) => setRoute(state.from, p),
});
$('swapBtn').addEventListener('click', () => setRoute(state.to, state.from));

for (const preset of PRESET_ROUTES) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'preset';
  btn.textContent = preset.label;
  btn.addEventListener('click', () => setRoute(portById(preset.from), portById(preset.to)));
  $('presets').append(btn);
}

// ---------- 지도: 확대 버튼, 항구 누르기, 좌표 표시 ----------
$('zoomIn').addEventListener('click', () => mapView.zoomBy(2));
$('zoomOut').addEventListener('click', () => mapView.zoomBy(0.5));
$('zoomFit').addEventListener('click', fitRoute);

let popupPort = null;
function showPortPopup(port, x, y) {
  const pop = $('portPop');
  if (!port) return hidePortPopup();
  popupPort = port;
  $('portPopName').textContent = `${portLabel(port)} · ${countryName(port.country)}`;
  pop.hidden = false;
  const box = $('mapbox').getBoundingClientRect();
  pop.style.left = `${Math.min(Math.max(8, x - pop.offsetWidth / 2), box.width - pop.offsetWidth - 8)}px`;
  pop.style.top = `${y + 14 + pop.offsetHeight > box.height ? y - pop.offsetHeight - 14 : y + 14}px`;
}
function hidePortPopup() {
  $('portPop').hidden = true;
  popupPort = null;
}
$('popFrom').addEventListener('click', () => setRoute(popupPort, state.to));
$('popTo').addEventListener('click', () => setRoute(state.from, popupPort));
$('popClose').addEventListener('click', hidePortPopup);

function showReadout(lon, lat, port) {
  const where = `${formatLat(lat, 2)} ${formatLon(lon, 2)}`;
  if (port) {
    $('readout').textContent = `${where} · ${portLabel(port)} (${countryName(port.country)}) · 눌러서 출발·도착 선택`;
    return;
  }
  const r = state.region;
  const k = r && state.risk ? r.grid.cellOf(lon, lat) : -1;
  if (k < 0) {
    $('readout').textContent = r ? `${where} · 탐색 해역 밖` : where;
  } else if (r.land[k]) {
    $('readout').textContent = `${where} · 육지`;
  } else {
    const v = state.risk[k];
    const zone = v >= HIGH_RISK ? '높음' : v >= 0.25 ? '보통' : '낮음';
    $('readout').textContent = `${where} · 위험도 ${v.toFixed(2)} (${zone})${r.blocked[k] ? ' · 통로 밖' : ''}`;
  }
}

$('showPts').addEventListener('change', (e) => {
  if (mapView.scene) mapView.draw({ ...mapView.scene, showPoints: e.target.checked });
});

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

// ---------- 데이터 불러오기 ----------
$('sampleBtn').addEventListener('click', () => setDataMode('sample'));
$('obisBtn').addEventListener('click', () => {
  if (data.baseline) setDataMode('obis');
  else $('dataMsg').textContent = '보호 대상 데이터 파일이 없습니다. tools/fetch_obis_targets.py로 public/data/obis_targets.json을 만드세요.';
});

$('csvFile').addEventListener('change', async (e) => {
  const input = e.target;
  const file = input.files[0];
  if (!file) return;
  try {
    setDataMode('csv', { points: parseCsv(await file.text()), name: file.name });
  } catch (err) {
    $('dataMsg').textContent = `불러오지 못했습니다. ${err.message}`;
  } finally {
    input.value = ''; // 같은 파일을 다시 고를 수 있게
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
loadSketch();

async function start() {
  setRouteMsg('전 세계 해안선과 항구 데이터를 불러오는 중…');
  $('mapbox').classList.add('busy');
  try {
    const [land, ports, baseline] = await Promise.all([
      loadLand(),
      loadPorts(),
      loadTargetBaseline().catch((err) => {
        console.warn('OBIS 기본 데이터 없음', err);
        return null;
      }),
    ]);
    data.land = land;
    data.ports = ports;
    data.portById = new Map(ports.map((p) => [p.id, p]));
    data.baseline = baseline;
    mapView.setLand(land);
    mapView.setPorts(ports);
    await nextFrame();
    data.world = buildWorldGrid(land);
  } catch (err) {
    console.error(err);
    setRouteMsg('해안선·항구 데이터를 불러오지 못했습니다. tools/build_world_data.py로 public/data/world/ 파일을 만드세요.', 'err');
    $('mapbox').classList.remove('busy');
    return;
  }

  if (data.baseline) {
    const date = (data.baseline.meta.generatedAt || '').slice(0, 10);
    $('dataDate').textContent = date ? `${date}에 OBIS에서 받은` : 'OBIS에서 받은';
    state.dataMode = 'obis';
    state.allPoints = data.baseline.points;
  } else {
    state.dataMode = 'sample';
    state.allPoints = samplePoints();
  }
  await setRoute(state.from || portById(DEFAULT_ROUTE.from), state.to || portById(DEFAULT_ROUTE.to));
}
start();
