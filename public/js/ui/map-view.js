/**
 * 캔버스 해도 그리기: 위험도 히트맵, 경위선, 출현 기록, 육지, 항로, 항구, 축척.
 */
import { BOUNDS, COASTLINE, ULLEUNG, DESTINATION, KM_PER_DEG_LAT, KM_PER_DEG_LON, REF_LAT } from '../model/config.js';
import { NX, NY } from '../model/grid.js';

/** 위험도 → RGBA 색 구간 [위치, R, G, B, 불투명도] */
const COLOR_STOPS = [
  [0, 95, 208, 255, 0],
  [0.12, 95, 208, 255, 0.18],
  [0.3, 95, 208, 255, 0.5],
  [0.5, 255, 214, 90, 0.75],
  [0.75, 255, 140, 60, 0.88],
  [1, 255, 70, 70, 0.95],
];

function riskColor(v) {
  for (let i = 1; i < COLOR_STOPS.length; i++) {
    if (v <= COLOR_STOPS[i][0]) {
      const a = COLOR_STOPS[i - 1];
      const b = COLOR_STOPS[i];
      const t = (v - a[0]) / (b[0] - a[0]);
      return [1, 2, 3, 4].map((c) => a[c] + (b[c] - a[c]) * t);
    }
  }
  return COLOR_STOPS[COLOR_STOPS.length - 1].slice(1);
}

const FONT_LABEL = '500 12px "IBM Plex Sans KR",sans-serif';
const FONT_PORT = '700 13px "IBM Plex Sans KR",sans-serif';
const FONT_MONO = '400 11px "IBM Plex Mono",monospace';
const LON_SPAN = BOUNDS.lon1 - BOUNDS.lon0;
const LAT_SPAN = BOUNDS.lat1 - BOUNDS.lat0;
const KM_PER_DEG_LON_REF = KM_PER_DEG_LON * Math.cos((REF_LAT * Math.PI) / 180);

export class MapView {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.width = 600;
    this.height = 680;
    /** 마지막으로 그린 장면 (크기 변경·글꼴 로드 후 다시 그릴 때 사용) */
    this.scene = null;

    // 위험도 히트맵은 격자 크기(NX×NY) 캔버스에 그린 뒤 확대해서 붙임
    this.heat = document.createElement('canvas');
    this.heat.width = NX;
    this.heat.height = NY;
    this.heatCtx = this.heat.getContext('2d');

    const css = getComputedStyle(document.documentElement);
    const v = (name) => css.getPropertyValue(name).trim();
    this.colors = {
      abyss: v('--abyss'), line: v('--line'), ink: v('--ink'), mute: v('--mute'),
      old: v('--route-old'), ai: v('--route-ai'), land: v('--land'),
    };
  }

  // ---------- 좌표 변환 ----------
  x(lon) { return ((lon - BOUNDS.lon0) / LON_SPAN) * this.width; }
  y(lat) { return ((BOUNDS.lat1 - lat) / LAT_SPAN) * this.height; }

  /** 마우스 위치 → [경도, 위도] */
  toLonLat(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    return [
      BOUNDS.lon0 + ((clientX - r.left) / this.width) * LON_SPAN,
      BOUNDS.lat1 - ((clientY - r.top) / this.height) * LAT_SPAN,
    ];
  }

  /** 부모 너비에 맞추고 실제 거리 비율로 높이를 정함 */
  resize() {
    const w = this.canvas.parentNode.clientWidth;
    if (!w) return;
    this.width = w;
    this.height = Math.round((w * LAT_SPAN * KM_PER_DEG_LAT) / (LON_SPAN * KM_PER_DEG_LON_REF));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = this.width * dpr;
    this.canvas.height = this.height * dpr;
    this.canvas.style.height = `${this.height}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.redraw();
  }

  /** 위험도 격자를 히트맵 이미지로 변환 (위도 행 순서를 뒤집어 북쪽이 위로) */
  setRisk(risk) {
    const img = this.heatCtx.createImageData(NX, NY);
    const d = img.data;
    for (let row = 0; row < NY; row++) {
      const j = NY - 1 - row;
      for (let i = 0; i < NX; i++) {
        const [r, g, b, a] = riskColor(risk[j * NX + i]);
        const o = (row * NX + i) * 4;
        d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = a * 255;
      }
    }
    this.heatCtx.putImageData(img, 0, 0);
  }

  /**
   * @param {Object} scene
   * @param {number[][]} scene.points       출현 기록
   * @param {boolean}    scene.showPoints
   * @param {number[][]} scene.shortestPath 기존 항로
   * @param {number[][]} scene.safePath     AI 추천 항로
   * @param {{name: string, lon: number, lat: number}} scene.port 출발 항구
   */
  draw(scene) {
    this.scene = scene;
    this.redraw();
  }

  redraw() {
    if (!this.scene) return;
    const { ctx, width: W, height: H, colors: C } = this;
    const s = this.scene;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = C.abyss;
    ctx.fillRect(0, 0, W, H);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.heat, 0, 0, W, H);

    this._drawGraticule();
    if (s.showPoints) this._drawPoints(s.points);
    this._drawLand();
    this._drawGraticuleLabels();
    this._drawRoutes(s.shortestPath, s.safePath);
    this._drawPorts(s.port, s.safePath);
    this._drawScaleBar(20);
  }

  // ---------- 그리기 세부 ----------
  _tracePath(path) {
    const { ctx } = this;
    ctx.beginPath();
    path.forEach(([lon, lat], i) => (i ? ctx.lineTo(this.x(lon), this.y(lat)) : ctx.moveTo(this.x(lon), this.y(lat))));
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

  _drawGraticule() {
    const { ctx, width: W, height: H } = this;
    ctx.lineWidth = 1;
    ctx.strokeStyle = this.colors.line;
    ctx.globalAlpha = 0.55;
    ctx.setLineDash([2, 5]);
    for (let lon = 129.5; lon < BOUNDS.lon1; lon += 0.5) {
      ctx.beginPath(); ctx.moveTo(this.x(lon), 0); ctx.lineTo(this.x(lon), H); ctx.stroke();
    }
    for (let lat = 36; lat < BOUNDS.lat1; lat += 0.5) {
      ctx.beginPath(); ctx.moveTo(0, this.y(lat)); ctx.lineTo(W, this.y(lat)); ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  _drawGraticuleLabels() {
    const { width: W, height: H } = this;
    const opts = { color: this.colors.mute, font: FONT_MONO };
    for (let lon = 129.5; lon < BOUNDS.lon1; lon += 0.5) this._label(`${lon.toFixed(1)}°E`, this.x(lon) + 4, H - 6, opts);
    for (let lat = 36; lat < BOUNDS.lat1; lat += 0.5) this._label(`${lat.toFixed(1)}°N`, W - 5, this.y(lat) - 4, { ...opts, align: 'right' });
  }

  _drawPoints(points) {
    const { ctx } = this;
    ctx.fillStyle = this.colors.ink;
    ctx.globalAlpha = points.length > 1500 ? 0.3 : 0.5;
    const step = Math.max(1, Math.ceil(points.length / 4000)); // 너무 많으면 솎아서 그림
    for (let p = 0; p < points.length; p += step) ctx.fillRect(this.x(points[p][0]) - 1, this.y(points[p][1]) - 1, 2, 2);
    ctx.globalAlpha = 1;
  }

  _drawLand() {
    const { ctx, width: W, height: H } = this;
    ctx.fillStyle = this.colors.land;
    ctx.strokeStyle = this.colors.mute;
    ctx.lineWidth = 1.2;
    this._tracePath(COASTLINE);
    ctx.closePath();
    ctx.fill();
    this._tracePath(COASTLINE.slice(0, -1)); // 지도 가장자리 쪽 선은 긋지 않음
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(this.x(ULLEUNG.lon), this.y(ULLEUNG.lat), (ULLEUNG.rx / LON_SPAN) * W, (ULLEUNG.ry / LAT_SPAN) * H, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
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

  _drawPorts(port, path) {
    const { ctx, colors: C } = this;
    const ends = [
      { place: port, at: path.length ? path[0] : [port.lon, port.lat], align: 'right', dx: -9, dy: 4 },
      { place: DESTINATION, at: path.length ? path[path.length - 1] : [DESTINATION.lon, DESTINATION.lat], align: 'left', dx: 10, dy: -12 },
    ];
    for (const { place, at, align, dx, dy } of ends) {
      const x = this.x(at[0]);
      const y = this.y(at[1]);
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fillStyle = C.ink; ctx.fill();
      ctx.strokeStyle = C.abyss; ctx.lineWidth = 2; ctx.stroke();
      this._label(place.name, x + dx, y + dy, { align, font: FONT_PORT });
    }
  }

  _drawScaleBar(km) {
    const { ctx, width: W, height: H } = this;
    const pxPerKm = W / (LON_SPAN * KM_PER_DEG_LON_REF);
    const len = pxPerKm * km;
    const x0 = W - 20 - len;
    const y0 = H - 30;
    ctx.strokeStyle = this.colors.ink;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x0, y0 - 4); ctx.lineTo(x0, y0); ctx.lineTo(x0 + len, y0); ctx.lineTo(x0 + len, y0 - 4);
    ctx.stroke();
    this._label(`${km} km`, x0 + len / 2, y0 - 6, { align: 'center', font: FONT_MONO });
  }
}
