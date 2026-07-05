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
  // street shape instead of one point guessed to be its centre.
  const url = `${NOMINATIM_URL}?format=json&polygon_geojson=1&limit=1&bounded=1&viewbox=${viewbox}&q=${encodeURIComponent(`${cleaned}, Dublin, Ireland`)}`;

  let result = null;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (res.ok) {
      const data = await res.json();
      if (data.length) {
        const hit = data[0];
        const line = hit.geojson?.type === 'LineString'
          ? hit.geojson.coordinates.map(([lon, lat]) => [lat, lon])
          : null;
        result = { name: cleaned, lat: parseFloat(hit.lat), lon: parseFloat(hit.lon), line };
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
