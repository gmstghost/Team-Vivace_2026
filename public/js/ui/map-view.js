/**
 * 캔버스 해도: 위험도 히트맵, 경위선, 출현 기록, 육지, 항로, 항구, 축척.
 *
 * 메르카토르 도법 (항해용 해도와 같은 도법)으로 그리고, 휠·드래그·두 손가락으로 확대·이동합니다.
 * 경도는 '펼친 경도'(날짜변경선을 넘으면 180 이상)를 그대로 쓰고, 육지는 ±360 사본을 함께 그립니다.
 */
import { formatLat, formatLon } from '../model/geo.js';
import { KM_PER_DEG_LON } from '../model/config.js';
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
    this.heat = null; // { canvas, lon0, lon1, y0, y1 }
    this._drawnPorts = [];
    this._frame = 0;

    const css = getComputedStyle(document.documentElement);
    const v = (name) => css.getPropertyValue(name).trim();
    this.colors = {
      abyss: v('--abyss'), line: v('--line'), ink: v('--ink'), mute: v('--mute'),
      old: v('--route-old'), ai: v('--route-ai'), land: v('--land'), sonar: v('--sonar'),
    };
    this._bindInput();
  }

  // ---------- 데이터 ----------

  /**
   * 육지 다각형을 경로 객체로 한 번 만들어 둠 (좌표: 경도, 메르카토르 y).
   * lineTo를 수십만 번 부르면 브라우저에서 몇 초씩 걸려서, SVG 경로 문자열로 만든 뒤 한 번에 넘깁니다.
   */
  setLand(land) {
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
    this.redraw();
  }

  /** 지도에 점으로 보일 항구 목록 */
  setPorts(ports) {
    this.ports = ports;
  }

  /**
   * 위험도 격자를 히트맵 이미지로 변환. 메르카토르에 맞게 행을 다시 배치해 둠.
   * 통로 밖(outside = 1) 칸은 흐리게 그려 탐색 범위가 보이게 합니다.
   * @param {import('../model/grid.js').Grid} grid
   * @param {Float32Array} risk
   * @param {Uint8Array} [outside]
   */
  setRisk(grid, risk, outside = null) {
    const { nx, ny } = grid;
    const y0 = mercY(grid.lat0);
    const y1 = mercY(grid.lat1);
    const rows = ny;
    if (!this.heat || this.heat.canvas.width !== nx || this.heat.canvas.height !== rows) {
      const c = this.heat?.canvas || document.createElement('canvas');
      c.width = nx;
      c.height = rows;
      this.heat = { canvas: c, ctx: c.getContext('2d') };
    }
    const img = this.heat.ctx.createImageData(nx, rows);
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
    this.heat.ctx.putImageData(img, 0, 0);
    Object.assign(this.heat, { lon0: grid.lon0, lon1: grid.lon1, y0, y1 });
  }

  /**
   * @param {Object} scene
   * @param {Array} scene.points         출현 기록 (펼친 경도)
   * @param {boolean} scene.showPoints
   * @param {number[][]} scene.shortestPath 기존 항로
   * @param {number[][]} scene.safePath     AI 추천 항로
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

  /** 범위가 화면에 다 들어오게 맞춤. 위쪽은 좌표 표시, 오른쪽은 확대 버튼 자리를 비움 */
  fitBounds({ lon0, lon1, lat0, lat1 }, pad = { top: 64, right: 60, bottom: 44, left: 44 }) {
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

  /** 부모 너비에 맞추고 높이는 너비 비례 (최소·최대 제한) */
  resize() {
    const w = this.canvas.parentNode.clientWidth;
    if (!w) return;
    const oldW = this.width;
    this.width = w;
    this.height = Math.round(Math.min(720, Math.max(340, w * 0.82)));
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = this.width * this.dpr;
    this.canvas.height = this.height * this.dpr;
    this.canvas.style.height = `${this.height}px`;
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
      this._drawEnds(s);
    }
    this._drawScaleBar();
  }

  /** 화면에 보이는 경도 범위를 덮는 ±360 사본 목록 */
  _shifts(lon0 = -180, lon1 = 180) {
    const { lon0: v0, lon1: v1 } = this.visibleBounds();
    const out = [];
    for (let k = Math.floor((v0 - lon1) / 360); k <= Math.ceil((v1 - lon0) / 360); k++) out.push(k * 360);
    return out;
  }

  _drawHeat() {
    const h = this.heat;
    if (!h || h.lon0 === undefined) return;
    const { ctx } = this;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    const x0 = this.x(h.lon0);
    const x1 = this.x(h.lon1);
    const yTop = this.height / 2 - (h.y1 - this.view.y) * this.view.scale;
    const yBot = this.height / 2 - (h.y0 - this.view.y) * this.view.scale;
    ctx.drawImage(h.canvas, x0, yTop, x1 - x0, yBot - yTop);
  }

  _drawLand() {
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
