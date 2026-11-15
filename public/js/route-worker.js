import { buildWorldGrid } from './model/land.js';
import { buildDensity } from './model/density.js';
import { planRegion, planRoutes } from './model/routing.js';

let land, world, region, regionVersion, density, densityVersion;
// Large geometry and density arrays stay in this worker between input changes.
self.onmessage = ({ data: { id, type, payload } }) => {
  try {
    let result;
    if (type === 'init') {
      land = payload.land;
      world = buildWorldGrid(land);
      result = true;
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
    } else throw new Error('Unknown calculation request');
    self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({ id, error: error.message });
  }
};
