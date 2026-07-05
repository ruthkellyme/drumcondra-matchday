import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchEvents } from './lib/scrape.js';
import { applyHeuristics } from './lib/heuristics.js';
import { geocodeRoads, CROKE_PARK } from './lib/geocode.js';
import { fetchSeasonFixtures } from './lib/season.js';
import { appendFeedback, readFeedback } from './lib/feedback.js';
import { RESIDENT_REPORTED_ACCESS_ROADS } from './lib/config.js';

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
  critical: (name) => `${name} — closed to through-traffic on match day. Resident-pass access is maintained via the green route(s) shown on this map.`,
  good: (name) => `${name} — resident vehicle access maintained here during the closure.`,
  'good-resident': (name) => `${name} — resident-reported access route (not on Croke Park's official notice, but confirmed by a local).`,
};

async function attachMap(event) {
  if (!event.official) return event;
  const { closureRoads = [], accessRoads = [] } = event.official;
  const allNames = [...closureRoads, ...accessRoads, ...RESIDENT_REPORTED_ACCESS_ROADS];
  if (allNames.length === 0) return event;

  const geocoded = await geocodeRoads(allNames);
  const lookup = new Map(geocoded.map((g) => [g.name.toLowerCase(), g]));

  // Keep the original wording (e.g. "Stadium side of St James' Avenue") for
  // display, even though the cleaned version is what gets geocoded — the
  // qualifier matters, a resident reading "St James' Avenue" alone would
  // reasonably assume the whole street, not just the stadium-facing side.
  const buildMarkers = (names, status, textKey = status) => names
    .map((n) => {
      const g = lookup.get(cleanRoadName(n).toLowerCase());
      if (!g) return null;
      const displayName = n.replace(/\.$/, '').trim();
      return {
        name: displayName,
        lat: g.lat,
        lon: g.lon,
        line: g.line,
        status,
        description: ROLE_TEXT[textKey](displayName),
      };
    })
    .filter(Boolean);

  const allMarkers = [
    ...buildMarkers(closureRoads, 'critical'),
    ...buildMarkers(accessRoads, 'good'),
    ...buildMarkers(RESIDENT_REPORTED_ACCESS_ROADS, 'good', 'good-resident'),
  ];

  // The same road can legitimately appear in more than one official list —
  // keep one marker per location, the most severe status, rather than
  // stacking dots.
  const severity = { critical: 2, good: 0 };
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
