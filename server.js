import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchEvents } from './lib/scrape.js';
import { applyHeuristics } from './lib/heuristics.js';
import {
  geocodeRoads, findRoadEnds, nearestApproach, nearestPointOnLines,
  extendLineToPoint, bearingDeg, CROKE_PARK,
} from './lib/geocode.js';
import { fetchSeasonFixtures } from './lib/season.js';
import { appendFeedback, readFeedback } from './lib/feedback.js';
import {
  RESIDENT_REPORTED_ACCESS_ROADS, RESIDENT_REPORTED_CORDON_POINTS,
  RESIDENT_REPORTED_CLOSURES, RESIDENT_REPORTED_ENTRANCE_ANCHORS,
} from './lib/config.js';

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const cleanRoadName = (n) => n.replace(/^stadium side of\s+/i, '').replace(/\.$/, '').trim();

// The map is about road closures specifically — no-parking streets are a
// parking-lane concern (already covered there), not a road-closure one, and
// showing them here just added visual noise for a fact that doesn't change
// which roads a driver can or can't get through on.
const ROLE_TEXT = {
  critical: (name) => `${name} — closed to through-traffic on match day. Resident-pass access is maintained via the entrance(s) shown on this map.`,
  good: (name) => `${name} — resident vehicle access maintained here during the closure.`,
  'good-resident': (name) => `${name} — resident-reported access route (not on Croke Park's official notice, but confirmed by a local).`,
  barrier: (name) => `${name} — reported Garda barrier/cordon point (not on Croke Park's official notice, confirmed by a local).`,
};

// Junction/end points reported by a resident aren't in Croke Park's own
// street lists, but still need geocoding — folded into the same lookup as
// the closure/access roads so one Nominatim pass covers everything.
const CORDON_ROAD_NAMES = RESIDENT_REPORTED_CORDON_POINTS.flatMap((p) => p.roads || (p.road ? [p.road] : []));
const ENTRANCE_ANCHOR_ROAD_NAMES = Object.values(RESIDENT_REPORTED_ENTRANCE_ANCHORS);

// For an 'end-fixed' cordon point: the fixed point is the known-good end;
// "the other end" is whichever of the road's own extremities sits farthest
// from it — that holds regardless of how many OSM way segments Nominatim
// happened to return for the road this time.
function computeFixedEnd(lookup, point) {
  const road = lookup.get(point.road.toLowerCase());
  if (!road?.lines?.length) return null;
  const ends = findRoadEnds(road.lines);
  if (!ends.length) return null;
  const farEnd = ends.reduce((best, e) => (!best || dist(e, point.point) > dist(best, point.point) ? e : best), null);
  return { road, anchorSpot: point.point, farEnd };
}

function buildCordonMarkers(lookup) {
  const markers = [];
  for (const point of RESIDENT_REPORTED_CORDON_POINTS) {
    if (point.kind === 'junction') {
      const [a, b] = point.roads.map((r) => lookup.get(r.toLowerCase()));
      if (!a?.lines?.length || !b?.lines?.length) continue;
      const spot = nearestApproach(a.lines, b.lines);
      if (!spot) continue;
      markers.push({
        name: point.label, lat: spot[0], lon: spot[1], lines: [],
        status: 'barrier', description: ROLE_TEXT.barrier(point.label),
      });
    } else if (point.kind === 'end-fixed') {
      const found = computeFixedEnd(lookup, point);
      if (!found) continue;
      const { anchorSpot, farEnd } = found;
      // Label by longitude so the pair reads "west end" / "east end" rather
      // than an arbitrary order — Dublin's west of Greenwich, so the more
      // negative longitude is further west.
      const withLabels = anchorSpot[1] < farEnd[1]
        ? [[anchorSpot, 'west end'], [farEnd, 'east end']]
        : [[farEnd, 'west end'], [anchorSpot, 'east end']];
      for (const [pt, suffix] of withLabels) {
        const name = `${point.label} (${suffix})`;
        markers.push({ name, lat: pt[0], lon: pt[1], lines: [], status: 'barrier', description: ROLE_TEXT.barrier(name) });
      }
    }
  }
  return markers;
}

async function attachMap(event) {
  if (!event.official) return event;
  const { closureRoads = [], accessRoads = [] } = event.official;
  // A resident reports this one isn't a real access route — its actual
  // status is unclear, so leave it off the map entirely rather than draw it
  // as either an entrance or a closure.
  const accessRoadsFiltered = accessRoads.filter(
    (n) => !RESIDENT_REPORTED_CLOSURES.some((c) => c.toLowerCase() === cleanRoadName(n).toLowerCase())
  );
  const allNames = [
    ...closureRoads, ...accessRoads, ...RESIDENT_REPORTED_ACCESS_ROADS,
    ...CORDON_ROAD_NAMES, ...ENTRANCE_ANCHOR_ROAD_NAMES,
  ];
  if (allNames.length === 0) return event;

  const geocoded = await geocodeRoads(allNames);
  const lookup = new Map(geocoded.map((g) => [g.name.toLowerCase(), g]));
  const closureLines = closureRoads.flatMap((n) => lookup.get(cleanRoadName(n).toLowerCase())?.lines || []);
  const entranceAnchors = new Map(Object.entries(RESIDENT_REPORTED_ENTRANCE_ANCHORS).map(([k, v]) => [k.toLowerCase(), v]));

  // Keep the original wording (e.g. "Stadium side of St James' Avenue") for
  // display, even though the cleaned version is what gets geocoded — the
  // qualifier matters, a resident reading "St James' Avenue" alone would
  // reasonably assume the whole street, not just the stadium-facing side.
  const buildMarkers = (names, status, textKey = status) => names
    .map((n) => {
      const g = lookup.get(cleanRoadName(n).toLowerCase());
      if (!g) return null;
      const displayName = n.replace(/\.$/, '').trim();
      const marker = {
        name: displayName,
        lat: g.lat,
        lon: g.lon,
        lines: g.lines,
        status,
        description: ROLE_TEXT[textKey](displayName),
      };
      if ((status === 'good' || status === 'good-resident') && g.lines.length) {
        // A named override takes priority — where a resident says the
        // entrance actually is beats a distance-based guess. Otherwise,
        // "entrance" is where this road meets the closed roads it connects
        // through — not whichever end happens to sit nearest the stadium's
        // centre point, which can be the wrong end entirely.
        const anchorRoadName = entranceAnchors.get(cleanRoadName(n).toLowerCase());
        const anchorRoad = anchorRoadName && lookup.get(anchorRoadName.toLowerCase());
        const otherLines = anchorRoad?.lines?.length ? anchorRoad.lines : closureLines;
        const found = otherLines.length ? nearestPointOnLines(g.lines, otherLines) : null;
        if (found) {
          marker.entrancePoint = found.point;
          marker.entranceAngle = bearingDeg(found.point, found.next) - 90;
        }
      }
      return marker;
    })
    .filter(Boolean);

  const allMarkers = [
    ...buildMarkers(closureRoads, 'critical'),
    ...buildMarkers(accessRoadsFiltered, 'good'),
    ...buildMarkers(RESIDENT_REPORTED_ACCESS_ROADS, 'good', 'good-resident'),
    ...buildCordonMarkers(lookup),
  ];

  // The barrier icon at a road's true end is only half the picture — the
  // drawn closure line itself needs to reach that same point, or there's a
  // visible gap between where the red line stops and the "Cordoned area"
  // marker sits.
  for (const point of RESIDENT_REPORTED_CORDON_POINTS) {
    if (point.kind !== 'end-fixed') continue;
    const found = computeFixedEnd(lookup, point);
    if (!found) continue;
    const closureMarker = allMarkers.find(
      (m) => m.status === 'critical' && m.name.toLowerCase() === cleanRoadName(point.road).toLowerCase()
    );
    if (closureMarker) closureMarker.lines = extendLineToPoint(closureMarker.lines, found.anchorSpot);
  }

  // The same road can legitimately appear in more than one official list —
  // keep one marker per location, the most severe status, rather than
  // stacking dots.
  const severity = { critical: 2, good: 0, barrier: 1 };
  const byName = new Map();
  for (const m of allMarkers) {
    const existing = byName.get(m.name.toLowerCase());
    if (!existing || severity[m.status] > severity[existing.status]) {
      byName.set(m.name.toLowerCase(), m);
    }
  }
  const markers = [...byName.values()];

  if (markers.length === 0) return event;
  return { ...event, map: { center: CROKE_PARK, markers } };
}

app.get('/api/events', async (req, res) => {
  try {
    const { events, warnings, fetchedAt, sourceUrl } = await fetchEvents();
    // Sequential, not Promise.all — attachMap's geocoding shares one
    // in-memory cache and a courtesy delay per Nominatim's usage policy, so
    // events must not fire concurrent lookups for the same road names.
    const computed = [];
    for (const e of events) {
      computed.push(await attachMap(applyHeuristics(e)));
    }
    res.json({ events: computed, warnings, fetchedAt, sourceUrl });
  } catch (err) {
    res.status(502).json({
      events: [],
      warnings: [`Could not reach or parse the Croke Park page (${err.message}).`],
      fetchedAt: new Date().toISOString(),
      sourceUrl: null,
    });
  }
});

app.get('/api/season', async (req, res) => {
  try {
    const [fixtures, { events: detailedEvents }] = await Promise.all([
      fetchSeasonFixtures(),
      fetchEvents().catch(() => ({ events: [] })),
    ]);
    const detailedDates = new Set(detailedEvents.map((e) => e.date));
    const todayISO = new Date().toISOString().slice(0, 10);
    const upcoming = fixtures
      .filter((f) => f.sortKey >= todayISO)
      .map((f) => ({ ...f, hasDetailedEstimate: f.date ? detailedDates.has(f.date) : false }));
    res.json({ fixtures: upcoming, sourceUrl: 'https://crokepark.ie/matchday' });
  } catch (err) {
    res.status(502).json({
      fixtures: [],
      warning: `Could not load the season fixture list (${err.message}).`,
      sourceUrl: 'https://crokepark.ie/matchday',
    });
  }
});

app.post('/api/feedback', (req, res) => {
  const { eventId, dayLabel, lane, message } = req.body || {};
  const text = (message || '').trim();
  if (!text) {
    return res.status(400).json({ error: 'Say a bit about what actually happened first.' });
  }
  if (text.length > 1000) {
    return res.status(400).json({ error: 'That\'s a lot — keep it under 1000 characters.' });
  }
  appendFeedback({
    submittedAt: new Date().toISOString(),
    eventId: eventId || null,
    dayLabel: dayLabel || null,
    lane: lane || null,
    message: text,
  });
  res.json({ ok: true });
});

// No auth on this one — fine for a personal community tool where the worst
// case is someone reads other neighbours' match-day notes, but don't put
// anything sensitive through the feedback form.
app.get('/api/feedback', (req, res) => {
  res.json({ feedback: readFeedback() });
});

const PORT = process.env.PORT || 4173;
app.listen(PORT, () => {
  console.log(`Drumcondra matchday watch running at http://localhost:${PORT}`);
});
