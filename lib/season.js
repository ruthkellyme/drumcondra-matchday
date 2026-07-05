// Croke Park publishes a whole-year "master fixture list" PDF — dates and
// fixture names for the year, no times or attendance (those only appear in
// the week-of community notice that lib/scrape.js reads). This gives
// residents a heads-up for the rest of the season, at a rough, keyword-based
// impact guess rather than a real per-event estimate.

import { PDFParse } from 'pdf-parse';

export const MASTER_FIXTURE_LIST_URL = 'https://crokepark.ie/BlankSite/media/Images/GAA%20Museum/Croke-Park-Master-Fixture-List-2026.pdf';

const MONTH_MAP = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
  may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7,
  sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
};

const SKIP_LINE_RE = /^(january|february|march|april|may|june|july|august|september|october|november|december|croke park master fixture list|date\s+fixture)\b|^--\s*\d+\s*of\s*\d+\s*--/i;
const DATE_PREFIX_RE = /^(\d{1,2})(?:st|nd|rd|th)\s*(?:\/\s*(\d{1,2})(?:st|nd|rd|th))?\s+([A-Za-z]+)\.?\s*(?:\((\w+)\))?\s*(.*)$/i;
const GAA_KEYWORDS_RE = /hurling|football|camogie|ladies|lgfa|league|cup|championship|club|schools|sigerson|fitzgibbon|tailteann|sam maguire|mcdonagh|christy ring|rackard|meagher|junior|intermediate|senior/i;

const cache = { fetchedAt: 0, entries: null };
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function isoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function isConcert(fixtureText) {
  return !GAA_KEYWORDS_RE.test(fixtureText.toLowerCase());
}

function impactGuess(fixtureText) {
  const t = fixtureText.toLowerCase();
  if (isConcert(fixtureText)) return 'Very high'; // non-GAA = a touring concert, assume a sellout
  if (t.includes('all-ireland senior') && (t.includes('final') || t.includes('semi-final'))) return 'Very high';
  if (t.includes('triple header') || t.includes('semi-final')) return 'High';
  if (t.includes('quarter final') || t.includes('double header')) return 'Medium';
  return 'Low';
}

export async function fetchSeasonFixtures({ now = new Date(), forceRefresh = false } = {}) {
  if (!forceRefresh && cache.entries && now.getTime() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.entries;
  }

  const res = await fetch(MASTER_FIXTURE_LIST_URL, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DrumcondraMatchday/1.0)' },
  });
  if (!res.ok) throw new Error(`Master fixture list PDF responded with ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());

  const parser = new PDFParse({ data: buf });
  const { text } = await parser.getText();
  await parser.destroy();

  const yearMatch = text.match(/\b(20\d{2})\b/);
  const year = yearMatch ? parseInt(yearMatch[1], 10) : now.getFullYear();

  const rawEntries = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || SKIP_LINE_RE.test(line)) continue;

    const m = line.match(DATE_PREFIX_RE);
    const monthIndex = m ? MONTH_MAP[m[3].toLowerCase()] : undefined;

    if (m && monthIndex !== undefined) {
      const [, day1, day2, monthText, dayAbbr, rest] = m;
      rawEntries.push({
        day1: parseInt(day1, 10),
        day2: day2 ? parseInt(day2, 10) : null,
        monthIndex,
        monthText,
        dayAbbr: dayAbbr || null,
        fixture: rest.trim(),
      });
    } else if (rawEntries.length) {
      // Wrapped continuation of the previous row's fixture text.
      rawEntries[rawEntries.length - 1].fixture += ` ${line}`;
    }
  }

  const seen = new Set();
  const entries = rawEntries.map((e) => {
    const fixture = e.fixture.replace(/\s+/g, ' ').trim();
    const isSingleDate = !e.day2;
    const date = isSingleDate ? isoDate(new Date(year, e.monthIndex, e.day1)) : null;
    const sortKey = isoDate(new Date(year, e.monthIndex, e.day1));
    const dateLabel = e.day2
      ? `${e.day1}–${e.day2} ${e.monthText}`
      : `${e.day1} ${e.monthText}${e.dayAbbr ? ` (${e.dayAbbr})` : ''}`;
    return { date, dateLabel, sortKey, fixture, impactGuess: impactGuess(fixture), isConcert: isConcert(fixture) };
  }).filter((e) => {
    if (!e.fixture) return false;
    // The source PDF's table occasionally repeats an identical row.
    const dedupeKey = `${e.sortKey}|${e.fixture}`;
    if (seen.has(dedupeKey)) return false;
    seen.add(dedupeKey);
    return true;
  });

  entries.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  cache.entries = entries;
  cache.fetchedAt = now.getTime();
  return entries;
}
