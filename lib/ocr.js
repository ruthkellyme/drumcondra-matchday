// Fallback for weeks where Croke Park publishes the kick-off time and teams
// only as a poster image, not text — the scraper's text-based extractFixtures
// finds nothing, but the poster itself follows a consistent template
// ("DATE | TEAM v TEAM | THROW-IN: TIME", team names in solid caps) that OCR
// reads reliably at full resolution. Only ever used as a last resort when the
// normal text parse comes back empty — the text notice is more precise (it's
// literal text, not a machine's best guess at pixels) whenever it's there.
import { createWorker } from 'tesseract.js';
import { parseClockTime } from './scrape.js';

const TIME_TOKEN_RE = /([\d.:]+\s*[ap]\.?\s*m\.?)/i;
// Croke Park renders team names in solid caps on the poster — matching only
// all-caps runs avoids false positives from the lowercase prose elsewhere on
// the same page (e.g. the "residents should expect..." paragraph).
const TEAMS_RE = /\b([A-Z]{3,20}(?:['\s][A-Z]{2,20}){0,3})\s+v\s+([A-Z]{3,20}(?:['\s][A-Z]{2,20}){0,3})\b/;
const COMPETITION_KEYWORDS_RE = /hurling|football|camogie|championship|final|semi-final|league|cup|leinster|munster|ulster|connacht|all-ireland/i;
// A run of 2+ consecutive all-caps words — the competition name on the
// poster. OCR reads the icon glyphs beside each heading as stray mixed-case
// junk (e.g. an outline icon becomes "Bd" or "*%"), which breaks a pure-caps
// run wherever it lands, splitting one heading into two runs; joining every
// keyword-bearing run back up (in original order) reassembles it.
const CAPS_RUN_RE = /\b[A-Z][A-Z'-]*(?:\s+[A-Z][A-Z'-]*){1,10}\b/g;

function normalizeOcrText(raw) {
  return raw
    .split('\n')
    .map((line) => line.replace(/[|_~]/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

// The poster's column layout means "THROW-IN:" and its actual time don't
// always land on the same OCR line (the reader walks row-by-row across
// columns) — so this scans forward a couple of lines from the label rather
// than requiring them adjacent. The later "TURNSTILES OPEN: ..." time is a
// different section further down the page, well outside that window.
function findThrowInTime(lines) {
  const idx = lines.findIndex((l) => /throw[\s-]*in/i.test(l));
  if (idx === -1) return null;
  for (let i = idx; i < Math.min(lines.length, idx + 3); i++) {
    const m = lines[i].match(TIME_TOKEN_RE);
    if (m) return m[1];
  }
  return null;
}

// Exported separately from the fetch+OCR step so it can be tested directly
// against captured OCR output, without needing a real image or network call.
export function extractFixtureFromOcrText(rawText) {
  const lines = normalizeOcrText(rawText);
  const joined = lines.join('\n');

  const throwInTime = findThrowInTime(lines);
  const teams = joined.match(TEAMS_RE);
  if (!throwInTime || !teams) return null;

  const capsRuns = joined.replace(/\n/g, ' ').match(CAPS_RUN_RE) || [];
  // A caps run can bleed into the next heading (e.g. "...FINAL" straight
  // into "SUNDAY,") since nothing but a comma separates them — trim any
  // trailing day name back off, it's never part of the competition itself.
  const competition = capsRuns
    .filter((r) => COMPETITION_KEYWORDS_RE.test(r))
    .join(' ')
    .replace(/\s+(SUNDAY|MONDAY|TUESDAY|WEDNESDAY|THURSDAY|FRIDAY|SATURDAY)\b.*$/i, '')
    .trim() || null;

  const timeText = throwInTime.replace(/\s+/g, '').toLowerCase();
  return {
    timeText,
    time: parseClockTime(timeText),
    home: teams[1].trim(),
    away: teams[2].trim(),
    competition,
  };
}

// OCR takes real seconds — /api/events is otherwise a cheap fetch-and-parse
// hit fresh on every page load/refresh, so without this every visitor would
// re-pay that cost for the same still-current notice. Keyed by URL, cleared
// only by a process restart — fine for a personal tool with no deploy churn
// mid-week, and a new match always comes with a new image URL anyway.
const cache = new Map();

export async function ocrFixtureFromPosterUrl(rawUrl) {
  // The community-info page requests a small, pre-scaled rendition (e.g.
  // "?width=512&height=600") sized for display, not for reading — dropping
  // the query string gets the original full-resolution image, which is the
  // difference between OCR reading "3:30pm" cleanly and reading noise.
  const url = new URL(rawUrl);
  url.search = '';
  const fullResUrl = url.href;

  if (cache.has(fullResUrl)) return cache.get(fullResUrl);

  const promise = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    let buf;
    try {
      const res = await fetch(fullResUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DrumcondraMatchday/1.0)' },
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Poster image responded with ${res.status}`);
      buf = Buffer.from(await res.arrayBuffer());
    } finally {
      clearTimeout(timeout);
    }

    const worker = await createWorker('eng');
    try {
      const { data } = await worker.recognize(buf);
      return extractFixtureFromOcrText(data.text);
    } finally {
      await worker.terminate();
    }
  })();

  cache.set(fullResUrl, promise);
  try {
    return await promise;
  } catch (err) {
    cache.delete(fullResUrl); // don't let a transient failure poison the cache
    throw err;
  }
}
