/**
 * 캔버스 해도: 위험도 히트맵, 경위선, 출현 기록, 육지, 항로, 항구, 축척.
 *
 * 메르카토르 도법 (항해용 해도와 같은 도법)으로 그리고, 휠·드래그·두 손가락으로 확대·이동합니다.
 * 경도를 펼쳐 날짜변경선을 지나는 항로와 반복되는 세계 지도를 표시합니다.
 */
import { formatLat, formatLon, polylineKm } from '../model/geo.js';
import { KM_PER_DEG_LON, PASSAGES } from '../model/config.js';
import { portLabel } from '../model/ports.js';

/** 위험도 → RGBA 색 구간 [위치, R, G, B, 불투명도] */
const COLOR_STOPS = [
  [0, 95, 208, 255, 0],
  [0.12, 95, 208, 255, 0.18],
  [0.3, 95, 208, 255, 0.5],
  [0.5, 255, 214, 90, 0.75],
  [0.75, 255, 140, 60, 0.88],
  [1, 255, 70, 70, 0.95],
];

/** 위험도 0~1을 256단계 색표로 미리 계산 */
const RISK_LUT = (() => {
  const lut = new Uint8ClampedArray(256 * 4);
  for (let s = 0; s < 256; s++) {
    const v = s / 255;
    let c = COLOR_STOPS[COLOR_STOPS.length - 1].slice(1);
    for (let i = 1; i < COLOR_STOPS.length; i++) {
      if (v <= COLOR_STOPS[i][0]) {
        const a = COLOR_STOPS[i - 1];
        const b = COLOR_STOPS[i];
        const t = (v - a[0]) / (b[0] - a[0]);
        c = [1, 2, 3, 4].map((k) => a[k] + (b[k] - a[k]) * t);
        break;
      }
    }
    lut.set([c[0], c[1], c[2], c[3] * 255], s * 4);
  }
  return lut;
})();

const FONT_LABEL = '500 12px "IBM Plex Sans KR",sans-serif';
const FONT_PORT = '700 13px "IBM Plex Sans KR",sans-serif';
const FONT_MONO = '400 11px "IBM Plex Mono",monospace';
const RAD = Math.PI / 180;
const MAX_LAT = 85;

/** 위도 → 메르카토르 y (적도에서 1도 = 1 단위가 되도록 도 단위로 맞춤) */
const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + (Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * RAD) / 2)) / RAD;
const latOfMercY = (y) => (2 * Math.atan(Math.exp(y * RAD)) - Math.PI / 2) / RAD;

/** 경위선 간격 후보 (도) */
const GRID_STEPS = [0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10, 15, 20, 30, 45, 60, 90];
/** 축척 막대 길이 후보 (km) */
const SCALE_KM = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000];

/** 전 세계 바탕 층 불투명도 (통로 층보다 흐리게) */
const WORLD_HEAT_ALPHA = 0.45;

/**
 * 위험도 격자를 히트맵 이미지로 변환. 메르카토르에 맞게 행을 다시 배치해 둠.
 * 통로 밖(outside = 1) 칸은 흐리게 그려 탐색 범위가 보이게 합니다.
 * @param {{canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D}|null} layer 다시 쓸 이전 층
 * @param {import('../model/grid.js').Grid} grid
 * @param {Float32Array} risk
 * @param {Uint8Array} [outside]
 */
function heatLayer(layer, grid, risk, outside = null) {
  const { nx, ny } = grid;
  const y0 = mercY(grid.lat0);
  const y1 = mercY(grid.lat1);
  const rows = ny;
  if (!layer || layer.canvas.width !== nx || layer.canvas.height !== rows) {
    const c = layer?.canvas || document.createElement('canvas');
    c.width = nx;
    c.height = rows;
    layer = { canvas: c, ctx: c.getContext('2d') };
  }
  const img = layer.ctx.createImageData(nx, rows);
  const d = img.data;
  for (let row = 0; row < rows; row++) {
    // 이미지 위쪽 = 북쪽. 메르카토르 y가 고르게 나뉘도록 원래 위도 행을 골라 옴
    const lat = latOfMercY(y1 - ((row + 0.5) / rows) * (y1 - y0));
    const j = Math.min(ny - 1, Math.max(0, Math.floor((lat - grid.lat0) / grid.cellDeg)));
    const src = j * nx;
    const dst = row * nx * 4;
    for (let i = 0; i < nx; i++) {
      const s = Math.min(255, Math.round(risk[src + i] * 255)) * 4;
      const o = dst + i * 4;
      d[o] = RISK_LUT[s]; d[o + 1] = RISK_LUT[s + 1]; d[o + 2] = RISK_LUT[s + 2];
      d[o + 3] = outside && outside[src + i] ? RISK_LUT[s + 3] * 0.28 : RISK_LUT[s + 3];
    }
  }
  layer.ctx.putImageData(img, 0, 0);
  return Object.assign(layer, { lon0: grid.lon0, lon1: grid.lon1, y0, y1 });
}

export class MapView {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{onPortClick?: Function, onHover?: Function}} [handlers]
   *   onPortClick(port, x, y): 항구 점을 눌렀을 때 (x, y는 캔버스 안 좌표)
   *   onHover(lon, lat, port|null): 커서가 움직일 때
   */
  constructor(canvas, handlers = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.handlers = handlers;
    this.width = 600;
    this.height = 560;
    this.dpr = 1;
    /** 화면 중심 (펼친 경도, 메르카토르 y)과 확대 비율 (화면 px / 도) */
    this.view = { lon: 130, y: mercY(36.7), scale: 200 };
    this.scene = null;
    this.landFill = null;
    this.landStroke = null;
    this.ports = [];
    this.heat = null; // 통로 층 { canvas, ctx, lon0, lon1, y0, y1 }
    this.worldHeat = null; // 전 세계 바탕 층 (같은 모양)
    this.showWorld = true;
    this._drawnPorts = [];
    this._frame = 0;

    this.updateColors();
    this._bindInput();
  }

  updateColors() {
    const css = getComputedStyle(document.documentElement);
    const v = (name) => css.getPropertyValue(name).trim();
    this.colors = {
      abyss: v('--abyss'), line: v('--line'), ink: v('--ink'), mute: v('--mute'),
      old: v('--route-old'), ai: v('--route-ai'), land: v('--land'), sonar: v('--sonar'),
    };
    this.landCacheKey = null;
    this.requestRedraw();
  }

  // ---------- 데이터 ----------

  /**
   * 육지 다각형을 경로 객체로 한 번 만들어 둠 (좌표: 경도, 메르카토르 y).
   * lineTo를 수십만 번 부르면 브라우저에서 몇 초씩 걸려서, SVG 경로 문자열로 만든 뒤 한 번에 넘깁니다.
   */
  setLand(land) {
    this.landCacheKey = null;
    const fill = [];
    const stroke = [];
    const f = (v) => v.toFixed(3);
    for (const { xy } of land.rings) {
      const n = xy.length;
      const pts = [];
      for (let p = 0; p < n; p += 2) pts.push(`${f(xy[p])} ${f(mercY(xy[p + 1]))}`);
      fill.push(`M${pts.join('L')}Z`);
      // 해안선: 날짜변경선(±180)이나 남극 끝(-90)을 따라 자른 인공 경계에서는 펜을 듦
      let line = '';
      for (let p = 0; p < n; p += 2) {
        const q = p + 2 < n ? p + 2 : 0;
        const ax = xy[p], ay = xy[p + 1], bx = xy[q], by = xy[q + 1];
        if ((Math.abs(ax) === 180 && ax === bx) || (ay < -84.9 && by < -84.9)) {
          if (line) stroke.push(line);
          line = '';
          continue;
        }
        if (!line) line = `M${pts[p / 2]}`;
        line += `L${pts[q / 2]}`;
      }
      if (line) stroke.push(line);
    }
    this.landFill = new Path2D(fill.join(''));
    this.landStroke = new Path2D(stroke.join(''));
    // 해안선 데이터에 없는 운하(수에즈·파나마·킬)는 육지 위에 물길로 덧그림
    this.canalStroke = new Path2D(PASSAGES.filter((c) => c.canal)
      .map(({ path }) => `M${path.map(([lon, lat]) => `${f(lon)} ${f(mercY(lat))}`).join('L')}`).join(''));
    this.redraw();
  }

  /** 지도에 점으로 보일 항구 목록 */
  setPorts(ports) {
    this.ports = ports;
  }

  /** 항로 통로 층 (heatLayer 참고) */
  setRisk(grid, risk, outside = null) {
    this.heat = heatLayer(this.heat, grid, risk, outside);
  }

  /**
   * 전 세계 바탕 층 (기본 데이터로 계산한 위험도). 통로 층 밖에서만 흐리게 보입니다.
   * 정규화 기준이 통로 층과 달라서 같은 곳의 색이 다를 수 있으므로 통로 범위는 비워 둡니다.
   */
  setWorldRisk(grid, risk) {
    this.worldHeat = risk ? heatLayer(this.worldHeat, grid, risk) : null;
    this.requestRedraw();
  }

  /** 전 세계 바탕 층 켜기/끄기 */
  setShowWorld(on) {
    this.showWorld = on;
    this.requestRedraw();
  }

  /**
   * @param {Object} scene
   * @param {Array} scene.points         출현 기록 (펼친 경도)
   * @param {boolean} scene.showPoints
   * @param {number[][]} scene.shortestPath 기존 항로
   * @param {number[][]} scene.safePath     AI 추천 항로
   * @param {string[]} [scene.via]       항로가 지나는 운하·해협 이름 (PASSAGES)
   * @param {{port: Object, pt: number[]}} scene.from 출발 항구와 펼친 좌표
   * @param {{port: Object, pt: number[]}} scene.to
   */
  draw(scene) {
    this.scene = scene;
    this.redraw();
  }

  // ---------- 좌표 변환 ----------
  x(lon) { return (lon - this.view.lon) * this.view.scale + this.width / 2; }
  y(lat) { return this.height / 2 - (mercY(lat) - this.view.y) * this.view.scale; }

  /** 캔버스 안 좌표 → [펼친 경도, 위도] */
  toLonLat(px, py) {
    return [this.view.lon + (px - this.width / 2) / this.view.scale, latOfMercY(this.view.y - (py - this.height / 2) / this.view.scale)];
  }

  /** 지금 보이는 범위 */
  visibleBounds() {
    const [lon0, lat1] = this.toLonLat(0, 0);
    const [lon1, lat0] = this.toLonLat(this.width, this.height);
    return { lon0, lon1, lat0, lat1 };
  }

  // ---------- 화면 맞추기·확대 ----------

  /** 범위가 화면에 다 들어오게 맞춤. 지도 위에 떠 있는 패널 자리는 handlers.getPadding()으로 비움 */
  fitBounds({ lon0, lon1, lat0, lat1 }, pad = this.handlers.getPadding?.() ?? { top: 64, right: 60, bottom: 44, left: 44 }) {
    const ya = mercY(lat0);
    const yb = mercY(lat1);
    const w = Math.max(40, this.width - pad.left - pad.right);
    const h = Math.max(40, this.height - pad.top - pad.bottom);
    const scale = this._clampScale(Math.min(w / Math.max(lon1 - lon0, 1e-3), h / Math.max(yb - ya, 1e-3)));
    // 내용의 가운데가 비워 둔 여백을 뺀 영역의 가운데에 오도록
    this.view = {
      lon: (lon0 + lon1) / 2 - (pad.left + w / 2 - this.width / 2) / scale,
      y: (ya + yb) / 2 + (pad.top + h / 2 - this.height / 2) / scale,
      scale,
    };
    this._clampView();
    this.redraw();
  }

  zoomBy(factor, px = this.width / 2, py = this.height / 2) {
    const [lon, lat] = this.toLonLat(px, py);
    const my = mercY(lat);
    this.view.scale = this._clampScale(this.view.scale * factor);
    // 커서 아래 지점이 그대로 커서 아래 있게
    this.view.lon = lon - (px - this.width / 2) / this.view.scale;
    this.view.y = my + (py - this.height / 2) / this.view.scale;
    this._clampView();
    this.requestRedraw();
  }

  _clampScale(s) {
    return Math.min(4000, Math.max(this.width / 720, s));
  }

  _clampView() {
    const half = this.height / 2 / this.view.scale;
    const top = mercY(MAX_LAT);
    this.view.y = half >= top ? 0 : Math.min(top - half, Math.max(-top + half, this.view.y));
  }

  /** 부모(화면 전체를 채우는 배경) 크기에 맞춤 */
  resize() {
    const w = this.canvas.parentNode.clientWidth;
    const h = this.canvas.parentNode.clientHeight;
    if (!w || !h) return;
    const oldW = this.width;
    this.width = w;
    this.height = h;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = this.width * this.dpr;
    this.canvas.height = this.height * this.dpr;
    if (oldW && oldW !== w) this.view.scale = this._clampScale((this.view.scale * w) / oldW);
    this._clampView();
    this.redraw();
  }

  requestRedraw() {
    if (this._frame) return;
    this._frame = requestAnimationFrame(() => {
      this._frame = 0;
      this.redraw();
    });
  }

  // ---------- 그리기 ----------

  redraw() {
    const { ctx, width: W, height: H, colors: C, dpr } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = C.abyss;
    ctx.fillRect(0, 0, W, H);
    const s = this.scene;

    this._drawHeat();
    this._drawGraticule();
    if (s?.showPoints) this._drawPoints(s.points);
    this._drawLand();
    this._drawGraticuleLabels();
    this._drawPortDots();
    if (s) {
      this._drawRoutes(s.shortestPath, s.safePath);
      this._drawPassages(s.via || []);
      this._drawEnds(s);
    } else this._drawPassages([]);
    this._drawScaleBar();
  }

  /** 화면에 보이는 경도 범위를 덮는 ±360 사본 목록 */
  _shifts(lon0 = -180, lon1 = 180) {
    const { lon0: v0, lon1: v1 } = this.visibleBounds();
    const out = [];
    for (let k = Math.floor((v0 - lon1) / 360) + 1; k < (v1 - lon0) / 360; k++) out.push(k * 360);
    return out;
  }

  /** 히트맵 층이 화면에 놓일 사각형 (경도 shift만큼 옮김) */
  _heatRect(h, shift = 0) {
    const x0 = this.x(h.lon0 + shift);
    const x1 = this.x(h.lon1 + shift);
    const yTop = this.height / 2 - (h.y1 - this.view.y) * this.view.scale;
    const yBot = this.height / 2 - (h.y0 - this.view.y) * this.view.scale;
    return [x0, yTop, x1 - x0, yBot - yTop];
  }

  _drawHeat() {
    const { ctx } = this;
    const h = this.heat?.lon0 !== undefined ? this.heat : null;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    const w = this.worldHeat;
    if (w && this.showWorld) {
      ctx.save();
      if (h) {
        // 통로 층 자리는 비움 (화면 전체 − 통로 사각형, evenodd)
        const clip = new Path2D();
        clip.rect(0, 0, this.width, this.height);
        clip.rect(...this._heatRect(h));
        ctx.clip(clip, 'evenodd');
      }
      ctx.globalAlpha = WORLD_HEAT_ALPHA;
      for (const shift of this._shifts(w.lon0, w.lon1)) ctx.drawImage(w.canvas, ...this._heatRect(w, shift));
      ctx.restore();
    }
    if (h) ctx.drawImage(h.canvas, ...this._heatRect(h));
  }

  _drawLand() {
    if (!this.landFill) return;
    const key = [this.view.lon, this.view.y, this.view.scale, this.width, this.height, this.dpr].join(':');
    if (key !== this.landCacheKey) {
      const layer = this.landLayer || (this.landLayer = document.createElement('canvas'));
      layer.width = this.canvas.width;
      layer.height = this.canvas.height;
      const screen = this.ctx;
      this.ctx = layer.getContext('2d');
      this._paintLand();
      this.ctx = screen;
      this.landCacheKey = key;
    }
    this.ctx.drawImage(this.landLayer, 0, 0, this.width, this.height);
  }

  _paintLand() {
    if (!this.landFill) return;
    const { ctx, dpr, view, colors: C } = this;
    for (const shift of this._shifts()) {
      // 경로 객체 좌표(경도, 메르카토르 y) → 화면 좌표 변환을 캔버스에 맡김 (y는 위아래 뒤집힘)
      const tx = (shift - view.lon) * view.scale + this.width / 2;
      const ty = this.height / 2 + view.y * view.scale;
      ctx.setTransform(dpr * view.scale, 0, 0, -dpr * view.scale, dpr * tx, dpr * ty);
      ctx.fillStyle = C.land;
      ctx.fill(this.landFill, 'nonzero');
      ctx.strokeStyle = C.mute;
      ctx.lineWidth = 1 / view.scale;
      ctx.globalAlpha = 0.85;
      ctx.stroke(this.landStroke);
      ctx.globalAlpha = 1;
      if (this.canalStroke) {
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.strokeStyle = C.abyss;
        ctx.lineWidth = 2.5 / view.scale;
        ctx.stroke(this.canalStroke);
      }
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  _gridStep() {
    // 선 사이가 화면에서 90 px 이상 떨어지도록 (좁은 화면에서 글자가 겹치지 않게)
    const span = this.width / this.view.scale;
    const maxLines = Math.max(2, Math.min(7, this.width / 90));
    return GRID_STEPS.find((s) => span / s <= maxLines) || 90;
  }

  _drawGraticule() {
    const { ctx, width: W, height: H } = this;
    const step = this._gridStep();
    const b = this.visibleBounds();
    ctx.lineWidth = 1;
    ctx.strokeStyle = this.colors.line;
    ctx.globalAlpha = 0.55;
    ctx.setLineDash([2, 5]);
    for (let lon = Math.ceil(b.lon0 / step) * step; lon < b.lon1; lon += step) {
      ctx.beginPath(); ctx.moveTo(this.x(lon), 0); ctx.lineTo(this.x(lon), H); ctx.stroke();
    }
    for (let lat = Math.ceil(b.lat0 / step) * step; lat < b.lat1; lat += step) {
      ctx.beginPath(); ctx.moveTo(0, this.y(lat)); ctx.lineTo(W, this.y(lat)); ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  _drawGraticuleLabels() {
    const { width: W, height: H } = this;
    const step = this._gridStep();
    const digits = step < 1 ? (step < 0.25 ? 1 : 2) : 0;
    const b = this.visibleBounds();
    const opts = { color: this.colors.mute, font: FONT_MONO };
    for (let lon = Math.ceil(b.lon0 / step) * step; lon < b.lon1; lon += step) {
      this._label(formatLon(lon, digits), this.x(lon) + 4, H - 6, opts);
    }
    for (let lat = Math.ceil(b.lat0 / step) * step; lat < b.lat1; lat += step) {
      const y = this.y(lat) - 4;
      if (y < 128) continue; // 오른쪽 위 확대 버튼 자리
      this._label(formatLat(lat, digits), W - 5, y, { ...opts, align: 'right' });
    }
  }

  _drawPoints(points) {
    if (!points?.length) return;
    const { ctx } = this;
    ctx.fillStyle = this.colors.ink;
    // 격자 자료(OBIS)는 칸 중심이라 점이 바둑판처럼 보이므로 더 흐리게
    ctx.globalAlpha = points[0][4] > 0 ? 0.22 : points.length > 1500 ? 0.3 : 0.5;
    const step = Math.max(1, Math.ceil(points.length / 6000)); // 너무 많으면 솎아서 그림
    for (let p = 0; p < points.length; p += step) {
      const x = this.x(points[p][0]);
      const y = this.y(points[p][1]);
      if (x < -2 || y < -2 || x > this.width + 2 || y > this.height + 2) continue;
      ctx.fillRect(x - 1, y - 1, 2, 2);
    }
    ctx.globalAlpha = 1;
  }

  /** 확대했을 때 주변 항구를 작은 점으로 (누르면 출발·도착으로 고를 수 있음) */
  _drawPortDots() {
    this._drawnPorts = [];
    const span = this.width / this.view.scale;
    if (!this.ports.length || span > 140) return;
    const all = span < 14;
    const { ctx, width: W, height: H } = this;
    const b = this.visibleBounds();
    ctx.fillStyle = this.colors.sonar;
    for (const shift of this._shifts()) {
      for (const p of this.ports) {
        if (!all && !p.major) continue;
        const lon = p.lon + shift;
        if (lon < b.lon0 || lon > b.lon1 || p.lat < b.lat0 || p.lat > b.lat1) continue;
        const x = this.x(lon);
        const y = this.y(p.lat);
        if (x < 0 || y < 0 || x > W || y > H) continue;
        ctx.globalAlpha = p.major ? 0.9 : 0.55;
        ctx.beginPath();
        ctx.arc(x, y, p.major ? 2.6 : 1.8, 0, Math.PI * 2);
        ctx.fill();
        this._drawnPorts.push({ p, x, y });
      }
    }
    ctx.globalAlpha = 1;
  }

  _tracePath(path) {
    const { ctx } = this;
    ctx.beginPath();
    path.forEach(([lon, lat], i) => (i ? ctx.lineTo(this.x(lon), this.y(lat)) : ctx.moveTo(this.x(lon), this.y(lat))));
  }

  _drawRoutes(shortestPath, safePath) {
    const { ctx, colors: C } = this;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    this._tracePath(shortestPath);
    ctx.strokeStyle = C.abyss; ctx.lineWidth = 6; ctx.stroke();
    ctx.setLineDash([9, 7]);
    ctx.strokeStyle = C.old; ctx.lineWidth = 3; ctx.stroke();
    ctx.setLineDash([]);

    this._tracePath(safePath);
    ctx.strokeStyle = C.abyss; ctx.lineWidth = 7; ctx.stroke();
    ctx.strokeStyle = C.ai; ctx.lineWidth = 3.5; ctx.stroke();
  }

  /**
   * 운하·해협 표시: 항로가 지나는 곳은 양쪽 입구 표시와 이름·길이를 붙이고,
   * 지나지 않는 운하는 화면에서 충분히 크게 보일 때만 이름을 흐리게 붙임.
   */
  _drawPassages(via) {
    const { ctx, colors: C } = this;
    for (const { name, canal, path } of PASSAGES) {
      const used = via.includes(name);
      if (!used && !canal) continue;
      const shift = Math.round((this.view.lon - path[0][0]) / 360) * 360;
      const pts = path.map(([lon, lat]) => [this.x(lon + shift), this.y(lat)]);
      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      if (Math.max(...xs) < -50 || Math.min(...xs) > this.width + 50 || Math.max(...ys) < -50 || Math.min(...ys) > this.height + 50) continue;
      let screenLen = 0;
      for (let i = 1; i < pts.length; i++) screenLen += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      if (!used && screenLen < 80) continue;

      // 이름표 위치: 선 길이의 가운데
      let acc = 0;
      let mid = pts[0];
      for (let i = 1; i < pts.length; i++) {
        const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
        if (acc + d >= screenLen / 2) {
          const t = d ? (screenLen / 2 - acc) / d : 0;
          mid = [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t];
          break;
        }
        acc += d;
      }

      if (used) {
        // 입구·출구 표시 (화면에서 짧으면 가운데 하나만)
        const marks = screenLen < 24 ? [mid] : [pts[0], pts[pts.length - 1]];
        for (const [mx, my] of marks) {
          ctx.beginPath();
          ctx.arc(mx, my, 4.5, 0, Math.PI * 2);
          ctx.fillStyle = C.abyss; ctx.fill();
          ctx.strokeStyle = C.ink; ctx.lineWidth = 2; ctx.stroke();
        }
      }

      const sub = `${canal ? '운하' : '해협'} · ${Math.round(polylineKm(path))} km`;
      ctx.font = FONT_PORT;
      const w = Math.max(ctx.measureText(name).width, 80);
      let align = 'left';
      let dx = 14;
      if (mid[0] + dx + w > this.width - 8) { align = 'right'; dx = -14; }
      const color = used ? C.ink : C.mute;
      this._label(name, mid[0] + dx, mid[1] - 2, { align, color, font: FONT_PORT });
      this._label(sub, mid[0] + dx, mid[1] + 12, { align, color: C.mute, font: FONT_MONO });
    }
  }

  /** 출발·도착 항구 표시. 항구가 바다 칸에서 떨어져 있으면 점선으로 이어 줌 */
  _drawEnds({ from, to, safePath }) {
    const { ctx, colors: C } = this;
    const ends = [
      { ...from, at: safePath[0], align: 'right', dx: -10, dy: 4 },
      { ...to, at: safePath[safePath.length - 1], align: 'left', dx: 10, dy: -10 },
    ];
    // 두 항구의 화면 위치로 이름표 방향을 정함 (서로 겹치지 않게 바깥쪽으로)
    if (this.x(from.pt[0]) > this.x(to.pt[0])) {
      ends[0].align = 'left'; ends[0].dx = 10;
      ends[1].align = 'right'; ends[1].dx = -10;
    }
    for (const end of ends) {
      const { port, pt, at } = end;
      let { align, dx } = end;
      const { dy } = end;
      const px = this.x(pt[0]);
      const py = this.y(pt[1]);
      // 이름표가 화면 밖으로 나가면 반대쪽에 붙임
      this.ctx.font = FONT_PORT;
      const w = this.ctx.measureText(portLabel(port)).width;
      if (align === 'left' && px + dx + w > this.width - 8) { align = 'right'; dx = -10; }
      else if (align === 'right' && px + dx - w < 8) { align = 'left'; dx = 10; }
      if (at && Math.hypot(this.x(at[0]) - px, this.y(at[1]) - py) > 3) {
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(this.x(at[0]), this.y(at[1]));
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = C.ink; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.beginPath();
      ctx.arc(px, py, 5, 0, Math.PI * 2);
      ctx.fillStyle = C.ink; ctx.fill();
      ctx.strokeStyle = C.abyss; ctx.lineWidth = 2; ctx.stroke();
      this._label(portLabel(port), px + dx, py + dy, { align, font: FONT_PORT });
    }
  }

  _drawScaleBar() {
    const { ctx, width: W, height: H } = this;
    const [, lat] = this.toLonLat(W / 2, H / 2);
    const pxPerKm = this.view.scale / (KM_PER_DEG_LON * Math.cos(lat * RAD));
    const km = [...SCALE_KM].reverse().find((k) => k * pxPerKm <= W * 0.22) || SCALE_KM[0];
    const len = pxPerKm * km;
    const x0 = W - 20 - len;
    const y0 = H - 30;
    ctx.strokeStyle = this.colors.ink;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x0, y0 - 4); ctx.lineTo(x0, y0); ctx.lineTo(x0 + len, y0); ctx.lineTo(x0 + len, y0 - 4);
    ctx.stroke();
    this._label(`${km.toLocaleString('ko-KR')} km`, x0 + len / 2, y0 - 6, { align: 'center', font: FONT_MONO });
  }

  /** 테두리(배경색)를 두른 글자 */
  _label(text, x, y, { align = 'left', color = this.colors.ink, font = FONT_LABEL } = {}) {
    const { ctx } = this;
    ctx.font = font;
    ctx.textAlign = align;
    ctx.lineWidth = 3;
    ctx.strokeStyle = this.colors.abyss;
    ctx.lineJoin = 'round';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }

  // ---------- 마우스·터치 ----------

  /** 캔버스 좌표 근처(반경 r px)의 항구 */
  portAt(px, py, r = 8) {
    let best = null;
    let bestD = r * r;
    for (const d of this._drawnPorts) {
      const dd = (d.x - px) ** 2 + (d.y - py) ** 2;
      if (dd <= bestD) { bestD = dd; best = d.p; }
    }
    return best;
  }

  _bindInput() {
    const el = this.canvas;
    const pointers = new Map(); // pointerId → [x, y]
    let drag = null; // { x, y, lon, y0, moved }
    let pinch = null; // { dist, scale }
    const local = (e) => {
      const r = el.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };

    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      const [px, py] = local(e);
      this.zoomBy(Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015)), px, py);
    }, { passive: false });

    el.addEventListener('dblclick', (e) => {
      const [px, py] = local(e);
      this.zoomBy(e.shiftKey ? 0.5 : 2, px, py);
    });

    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      const p = local(e);
      pointers.set(e.pointerId, p);
      if (pointers.size === 1) {
        drag = { x: p[0], y: p[1], lon: this.view.lon, vy: this.view.y, moved: false };
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { dist: Math.hypot(a[0] - b[0], a[1] - b[1]), scale: this.view.scale };
        drag = null;
      }
    });

    el.addEventListener('pointermove', (e) => {
      const p = local(e);
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, p);
      if (pinch && pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const factor = (pinch.scale * Math.hypot(a[0] - b[0], a[1] - b[1])) / pinch.dist / this.view.scale;
        this.zoomBy(factor, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
        return;
      }
      if (drag) {
        const dx = p[0] - drag.x;
        const dy = p[1] - drag.y;
        if (!drag.moved && Math.hypot(dx, dy) < 4) return;
        drag.moved = true;
        el.classList.add('dragging');
        this.view.lon = drag.lon - dx / this.view.scale;
        this.view.y = drag.vy + dy / this.view.scale;
        this._clampView();
        this.requestRedraw();
        return;
      }
      if (e.pointerType === 'mouse') {
        const [lon, lat] = this.toLonLat(p[0], p[1]);
        const port = this.portAt(p[0], p[1]);
        el.style.cursor = port ? 'pointer' : '';
        this.handlers.onHover?.(lon, lat, port);
      }
    });

    const end = (e) => {
      const p = local(e);
      if (drag && !drag.moved && pointers.size === 1) {
        const port = this.portAt(p[0], p[1], e.pointerType === 'mouse' ? 8 : 16);
        if (port) this.handlers.onPortClick?.(port, p[0], p[1]);
        else this.handlers.onPortClick?.(null);
        const [lon, lat] = this.toLonLat(p[0], p[1]);
        if (e.pointerType !== 'mouse') this.handlers.onHover?.(lon, lat, port);
      }
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (!pointers.size) drag = null;
      el.classList.remove('dragging');
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }
}
