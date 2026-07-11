// Turns the road/street names Croke Park publishes into real map coordinates
// via OpenStreetMap's free Nominatim geocoder, biased to a box around the
// stadium so common street names don't resolve somewhere else in Ireland.
// Results are cached for the life of the process — the same handful of
// street names come up on every request.

export const CROKE_PARK = { lat: 53.3607, lon: -6.2512 };

const cache = new Map();
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'DrumcondraMatchdayWatch/1.0 (personal community project; not for high-volume use)';

function cleanName(name) {
  return name.replace(/^stadium side of\s+/i, '').replace(/\.$/, '').trim();
}

async function geocodeOne(rawName) {
  const cleaned = cleanName(rawName);
  const key = cleaned.toLowerCase();
  if (cache.has(key)) return cache.get(key);

  const half = 0.02;
  const viewbox = [
    CROKE_PARK.lon - half, CROKE_PARK.lat + half,
    CROKE_PARK.lon + half, CROKE_PARK.lat - half,
  ].join(',');
  // polygon_geojson=1 asks Nominatim for the road's actual line geometry
  // (it usually resolves as an OSM "way") so the map can draw the real
  // street shape instead of one point guessed to be its centre. A single
  // road name is frequently split across several OSM ways (e.g. Clonliffe
  // Road is 3 separate ways end-to-end) — limit=1 only ever drew the first
  // of those, leaving the rest of the road blank, so this takes every
  // LineString hit for the name, not just the top match.
  const url = `${NOMINATIM_URL}?format=json&polygon_geojson=1&limit=10&bounded=1&viewbox=${viewbox}&q=${encodeURIComponent(`${cleaned}, Dublin, Ireland`)}`;

  let result = null;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (res.ok) {
      const data = await res.json();
      const roadHits = data.filter((hit) => hit.geojson?.type === 'LineString');
      if (roadHits.length) {
        const lines = roadHits.map((hit) => hit.geojson.coordinates.map(([lon, lat]) => [lat, lon]));
        const first = roadHits[0];
        result = { name: cleaned, lat: parseFloat(first.lat), lon: parseFloat(first.lon), lines };
      } else if (data.length) {
        const hit = data[0];
        result = { name: cleaned, lat: parseFloat(hit.lat), lon: parseFloat(hit.lon), lines: [] };
      }
    }
  } catch {
    result = null;
  }
  cache.set(key, result);
  return result;
}

/**
 * Geocodes a list of road names, respecting Nominatim's ~1 request/second
 * usage policy (only for names not already cached), and returns whatever
 * resolved successfully.
 */
export async function geocodeRoads(names) {
  const unique = [...new Set(names.map(cleanName))];
  const results = [];
  for (const name of unique) {
    const key = name.toLowerCase();
    const alreadyCached = cache.has(key);
    const result = await geocodeOne(name);
    if (result) results.push(result);
    if (!alreadyCached) await new Promise((resolve) => setTimeout(resolve, 1100));
  }
  return results;
}

function samePoint(a, b, toleranceDeg = 0.0003) {
  return Math.abs(a[0] - b[0]) < toleranceDeg && Math.abs(a[1] - b[1]) < toleranceDeg;
}

/**
 * A long road is usually several separate OSM ways chained end-to-end —
 * the shared point between two consecutive ways shows up twice (once as
 * each way's endpoint), while the road's two true extremities show up only
 * once. So "the ends of the road" are whichever segment endpoints don't
 * match any other segment's endpoint.
 */
export function findRoadEnds(lines) {
  const endpoints = lines.filter((l) => l.length > 1).map((l) => [l[0], l[l.length - 1]]).flat();
  return endpoints.filter((pt, i) => !endpoints.some((other, j) => j !== i && samePoint(pt, other)));
}

function distance([lat1, lon1], [lat2, lon2]) {
  return Math.hypot(lat1 - lat2, lon1 - lon2);
}

/**
 * Where two streets meet, approximated as the midpoint of the closest pair
 * of points across their geometries — good enough for placing a marker,
 * without needing true line-segment intersection math.
 */
export function nearestApproach(linesA, linesB) {
  let best = null;
  for (const lineA of linesA) {
    for (const ptA of lineA) {
      for (const lineB of linesB) {
        for (const ptB of lineB) {
          const d = distance(ptA, ptB);
          if (!best || d < best.d) best = { d, ptA, ptB };
        }
      }
    }
  }
  if (!best) return null;
  return [(best.ptA[0] + best.ptB[0]) / 2, (best.ptA[1] + best.ptB[1]) / 2];
}

// Compass bearing in degrees (0 = north, clockwise) from one point to another.
export function bearingDeg([lat1, lon1], [lat2, lon2]) {
  const toRad = (d) => (d * Math.PI) / 180;
  const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2))
    - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
  return (Math.atan2(y, x) * 180) / Math.PI;
}

/**
 * The point on `mainLines` closest to `otherLines` — e.g. where an access
 * road meets the closed roads it connects through, which is the actual
 * "entrance" a resident would use, not just whichever end of the road
 * happens to sit nearest the stadium's centre point. Also returns the
 * adjacent point along the same line, so the caller can derive a direction
 * pointing away from the junction and into the residential street.
 */
export function nearestPointOnLines(mainLines, otherLines) {
  let best = null;
  for (const line of mainLines) {
    for (let i = 0; i < line.length; i++) {
      for (const otherLine of otherLines) {
        for (const otherPt of otherLine) {
          const d = distance(line[i], otherPt);
          if (!best || d < best.d) best = { d, line, index: i };
        }
      }
    }
  }
  if (!best) return null;
  const { line, index } = best;
  const adjIndex = index === 0 ? Math.min(1, line.length - 1)
    : index === line.length - 1 ? line.length - 2
    : index + 1;
  return { point: line[index], next: line[adjIndex] };
}

/** Whichever point across all of `lines` sits closest to `target` ([lat, lon]). */
export function nearestPointTo(lines, target) {
  let best = null;
  for (const line of lines) {
    for (const pt of line) {
      const d = distance(pt, target);
      if (!best || d < best.d) best = { pt, d };
    }
  }
  return best ? best.pt : null;
}

/**
 * If a road's drawn line falls short of a point we know it should reach
 * (e.g. Nominatim didn't return every OSM way segment for a long road, so
 * the line stops short of the junction a resident named), stitch on a
 * connecting segment from the nearest existing endpoint out to that point —
 * so the drawn line visually reaches it instead of leaving a gap before the
 * marker sitting there.
 */
export function extendLineToPoint(lines, target, toleranceDeg = 0.0005) {
  let nearest = null;
  let nearestDist = Infinity;
  for (const line of lines) {
    if (line.length < 2) continue;
    for (const pt of [line[0], line[line.length - 1]]) {
      const d = distance(pt, target);
      if (d < nearestDist) { nearestDist = d; nearest = pt; }
    }
  }
  if (!nearest || nearestDist < toleranceDeg) return lines;
  return [...lines, [nearest, target]];
}
