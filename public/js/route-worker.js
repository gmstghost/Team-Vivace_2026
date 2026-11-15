import { buildWorldGrid } from './model/land.js';
import { buildDensity } from './model/density.js';
import { planRegion, planRoutes } from './model/routing.js';

/** 전 세계 바탕 층: 날짜변경선 근처 기록은 ±360 사본도 넣어 커널이 반대쪽 끝까지 이어지게 함 */
const WRAP_MARGIN_DEG = 15;

function worldDensity(world, points, exclude) {
  const skip = new Set(exclude || []);
  const pts = [];
  for (const p of points) {
    if (skip.has(p[2] || '')) continue;
    const lon = ((((p[0] + 180) % 360) + 360) % 360) - 180;
    const q = lon === p[0] ? p : [lon, ...p.slice(1)];
    pts.push(q);
    if (lon > 180 - WRAP_MARGIN_DEG) pts.push([lon - 360, ...p.slice(1)]);
    else if (lon < -180 + WRAP_MARGIN_DEG) pts.push([lon + 360, ...p.slice(1)]);
  }
  return buildDensity(world.grid, world.land, pts);
}

let land, world, region, regionVersion, density, densityVersion;
// Large geometry and density arrays stay in this worker between input changes.
self.onmessage = ({ data: { id, type, payload } }) => {
  try {
    let result;
    let transfer = [];
    if (type === 'init') {
      land = payload.land;
      world = buildWorldGrid(land);
      result = world.grid;
    } else if (type === 'region') {
      region = null;
      density = null;
      regionVersion = payload.version;
      region = planRegion(world, land, payload.from, payload.to);
      result = region;
    } else if (type === 'density') {
      if (payload.regionVersion !== regionVersion || !region) throw new Error('STALE');
      density = buildDensity(region.grid, region.land, payload.points, payload.groups);
      densityVersion = payload.version;
      result = true;
    } else if (type === 'compute') {
      if (payload.regionVersion !== regionVersion || payload.densityVersion !== densityVersion || !density) throw new Error('STALE');
      result = planRoutes(region, density, payload.params);
    } else if (type === 'world-density') {
      if (!world) throw new Error('STALE');
      const d = worldDensity(world, payload.points, payload.exclude);
      result = { grid: world.grid, density: d };
      transfer = [d.buffer];
    } else throw new Error('Unknown calculation request');
    self.postMessage({ id, result }, transfer);
  } catch (error) {
    self.postMessage({ id, error: error.message });
  }
};
