import * as cheerio from 'cheerio';
import { SOURCE_URL, CROKE_PARK_CAPACITY } from './config.js';
import { ocrFixtureFromPosterUrl } from './ocr.js';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
// Croke Park writes fixture headers as "Saturday 11th July" (day before month)
// but restriction-section headers as "Saturday July 11th" (month before day) —
// same page, both orders, so both must match.
const DAY_HEADER_RE = new RegExp(
  `^(${DAY_NAMES.join('|')})\\s+(?:(?<month1>[A-Za-z]+)\\s+(?<day1>\\d{1,2})(?:st|nd|rd|th)?|(?<day2>\\d{1,2})(?:st|nd|rd|th)?\\s+(?<month2>[A-Za-z]+))\\.?$`,
  'i'
);
const DAY_NAME_ANYWHERE_RE = new RegExp(`\\b(${DAY_NAMES.join('|')})\\b`, 'i');
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

function normalizeText(str) {
  return str
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function dayKey(month, day) {
  return `${month.toLowerCase()}-${parseInt(day, 10)}`;
}

function resolveDate(month, day, now = new Date()) {
  const monthIndex = MONTHS.indexOf(month.toLowerCase());
  if (monthIndex === -1) return null;
  const year = now.getFullYear();
  let candidate = new Date(year, monthIndex, parseInt(day, 10));
  // Compare whole days only — candidate is always midnight, so a cutoff that
  // keeps "now"'s time-of-day falsely treats today's own date as "in the
  // past" for anyone checking this after midnight (e.g. "now" at 8am rolled
  // today's exact date-minus-2-days forward a whole year).
  const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 2);
  if (candidate < cutoff) {
    candidate = new Date(year + 1, monthIndex, parseInt(day, 10));
  }
  return candidate;
}

function isoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

// Naive local wall-clock datetime string, no timezone math — this is a
// single-timezone (Dublin) personal tool, so we keep times exactly as printed.
export function localDateTime(dateISO, hour, minute) {
  return `${dateISO}T${pad2(hour)}:${pad2(minute)}:00`;
}

export function parseClockTime(str) {
  if (!str) return null;
  const ampm = str.match(/(\d{1,2})(?:[.:](\d{2}))?\s*([ap])\.?\s*m\.?/i);
  if (ampm) {
    let hour = parseInt(ampm[1], 10);
    const minute = ampm[2] ? parseInt(ampm[2], 10) : 0;
    const isPM = ampm[3].toLowerCase() === 'p';
    if (hour === 12) hour = 0;
    if (isPM) hour += 12;
    return { hour, minute };
  }
  const h24 = str.match(/^(\d{1,2})[:.](\d{2})$/);
  if (h24) {
    return { hour: parseInt(h24[1], 10), minute: parseInt(h24[2], 10) };
  }
  return null;
}

// Single-line form: "15:30 TeamA V TeamB (Competition)".
const SINGLE_LINE_FIXTURE_RE = /(\d{1,2}[:.]\d{2})\s+(.+?)\s+V\s+(.+?)\s*\(([^)]+)\)/i;
// Two-line form (seen on the live page): "15:30 Competition Name" followed by
// "TeamA (Irish name) v TeamB (Irish name)" as a separate paragraph.
const TIME_LEAD_RE = /^(\d{1,2}[:.]\d{2})\s+(.+)$/;
const TEAM_VS_RE = /^(.+?)\s+v\s+(.+)$/i;

function extractFixtures(lines) {
  const fixtures = [];
  for (let i = 0; i < lines.length; i++) {
    const single = lines[i].match(SINGLE_LINE_FIXTURE_RE);
    if (single) {
      fixtures.push({
        timeText: single[1].replace('.', ':'),
        time: parseClockTime(single[1]),
        home: single[2].trim(),
        away: single[3].trim(),
        competition: single[4].trim(),
      });
      continue;
    }

    const timeMatch = lines[i].match(TIME_LEAD_RE);
    const teamsMatch = lines[i + 1] && lines[i + 1].match(TEAM_VS_RE);
    if (timeMatch && teamsMatch) {
      fixtures.push({
        timeText: timeMatch[1].replace('.', ':'),
        time: parseClockTime(timeMatch[1]),
        competition: timeMatch[2].trim(),
        home: teamsMatch[1].trim(),
        away: teamsMatch[2].trim(),
      });
      i++; // consumed the teams line too
    }
  }
  return fixtures;
}

function parseAttendanceSummary(text) {
  const byDay = {};
  const clauses = text.split(/\band\b/i);
  for (const clause of clauses) {
    const dn = clause.match(DAY_NAME_ANYWHERE_RE);
    if (!dn) continue;
    const key = dn[1].toLowerCase();
    if (/full house/i.test(clause)) {
      byDay[key] = { isFullHouse: true, value: CROKE_PARK_CAPACITY };
    } else {
      const num = clause.match(/(\d{1,3}(?:,\d{3})+|\d{4,6})/);
      if (num) {
        byDay[key] = { isFullHouse: false, value: parseInt(num[1].replace(/,/g, ''), 10) };
      }
    }
  }
  return byDay;
}

// Fallback for pages that state attendance per-day inside the fixture block
// itself (e.g. "Estimated Attendance : FULL HOUSE  Turnstiles Open : 14:30")
// rather than in one summary paragraph above all the day headers.
function parseAttendanceFromLines(lines) {
  for (const line of lines) {
    const m = line.match(/attendance\s*:?\s*(.*?)(?:turnstiles|$)/i);
    if (!m) continue;
    if (/full house/i.test(m[1])) return { isFullHouse: true, value: CROKE_PARK_CAPACITY };
    const num = m[1].match(/(\d{1,3}(?:,\d{3})+|\d{4,6})/);
    if (num) return { isFullHouse: false, value: parseInt(num[1].replace(/,/g, ''), 10) };
  }
  return null;
}

function looksLikeTime(str) {
  return /^\d{1,2}([.:]\d{2})?\s*[ap]\.?\s*m\.?$/i.test(str.trim());
}

function extractRestrictionInfo($, elements) {
  const info = {
    parkingRestrictionTime: null,
    restrictedStreets: [],
    exitRouteNote: null,
    roadClosureTime: null,
    closureRoads: [],
    accessRoads: [],
  };

  for (const { tag, text, $el } of elements) {
    if (/parking restrictions will be in operation/i.test(text)) {
      const m = text.match(/from\s+([\d.:]+\s*[ap]\.?\s*m\.?)/i);
      if (m) info.parkingRestrictionTime = m[1].trim();
    }

    if (tag === 'ul') {
      $el.find('li').each((_, li) => {
        const liText = normalizeText($(li).text());
        if (!liText) return;
        if (/exit route/i.test(liText)) {
          info.exitRouteNote = liText;
        } else {
          info.restrictedStreets.push(liText.replace(/\.$/, ''));
        }
      });
    }

    // "Jones Road and Russell Street will be closed" and "Clonliffe Road...
    // subject to closure (from 3pm approximately)" are separate paragraphs on
    // the live page — the road names and the approximate time don't always
    // share a sentence, so each is captured independently rather than requiring
    // both "will close" and "approximately" in the same text.
    if (/\bwill\s+(?:be\s+)?closed?\b/i.test(text) || /\bsubject to closure\b/i.test(text)) {
      $el.find('strong').each((_, s) => {
        const t = normalizeText($(s).text());
        if (t && !looksLikeTime(t) && !info.closureRoads.includes(t)) info.closureRoads.push(t);
      });
    }

    if (/approx/i.test(text)) {
      // Seen in a few orders: "approximately 3pm", "3pm approximately",
      // and "11.30am (approx)".
      const m = text.match(/approx(?:imately)?\.?\s+([\d.:]+\s*[ap]\.?\s*m\.?)/i)
        || text.match(/([\d.:]+\s*[ap]\.?\s*m\.?)\s*\(?approx(?:imately)?\.?\)?/i);
      if (m) info.roadClosureTime = m[1].trim();
      $el.find('strong').each((_, s) => {
        const t = normalizeText($(s).text());
        if (t && !looksLikeTime(t) && !info.closureRoads.includes(t)) info.closureRoads.push(t);
      });
    }

    if (/clonliffe road/i.test(text)) {
      $el.find('strong').each((_, s) => {
        const t = normalizeText($(s).text());
        if (t && !looksLikeTime(t) && !info.closureRoads.includes(t)) info.closureRoads.push(t);
      });
    }

    if (/resident vehicular access will be (?:maintained )?via/i.test(text)) {
      $el.find('strong').each((_, s) => {
        const t = normalizeText($(s).text());
        if (t && !looksLikeTime(t)) info.accessRoads.push(t);
      });
    }
  }

  info.closureRoads = [...new Set(info.closureRoads)];
  info.accessRoads = [...new Set(info.accessRoads)];
  return info;
}

export async function parseEventsFromHtml(html, { now = new Date() } = {}) {
  const $ = cheerio.load(html);
  const content = $('.well-content').first();
  const warnings = [];

  if (!content.length) {
    return {
      events: [],
      warnings: ['Could not find the expected content block on the Croke Park page — the page layout may have changed. Use the manual entry form instead.'],
    };
  }

  // Some weeks' notice states the kick-off time and teams only as an image
  // (a poster graphic) rather than text — extractFixtures finds nothing in
  // that case, so this is kept aside as a last-resort OCR source below.
  const posterSrc = content.find('img').first().attr('src') || null;
  const posterUrl = posterSrc ? new URL(posterSrc, SOURCE_URL).href : null;

  const children = content.children().toArray();
  const fixtureBlocks = new Map();
  const restrictionBlocks = new Map();
  const preSummaryLines = [];

  let mode = null;
  let currentKey = null;
  let sawAnyDayHeader = false;
  let capturingImportant = false;
  // Normally the "Traffic & Parking Restrictions" line is followed by an
  // <h3> day header, giving restrictions their own section. Some notices
  // (e.g. ones where the fixture details are only in an image, not text)
  // skip the separate fixtures paragraph entirely and reuse a single <p> day
  // header for everything — in that case, the following lines are really
  // restriction text and must be captured as such, not silently dropped as
  // unparsed "fixture" lines.
  let justSawRestrictionsMarker = false;
  const importantNoteLines = [];

  for (const el of children) {
    const $el = $(el);
    const tag = (el.tagName || '').toLowerCase();
    const text = normalizeText($el.text());
    if (!text) continue;

    const dayMatch = text.match(DAY_HEADER_RE);
    if (dayMatch && (tag === 'p' || tag === 'h3')) {
      const month = dayMatch.groups.month1 || dayMatch.groups.month2;
      const day = dayMatch.groups.day1 || dayMatch.groups.day2;
      const key = dayKey(month, day);
      sawAnyDayHeader = true;
      capturingImportant = false;
      if (tag === 'p') {
        mode = justSawRestrictionsMarker ? 'both' : 'fixtures';
        currentKey = key;
        if (!fixtureBlocks.has(key)) {
          fixtureBlocks.set(key, { dayName: dayMatch[1], month, day, lines: [] });
        }
        if (justSawRestrictionsMarker && !restrictionBlocks.has(key)) {
          restrictionBlocks.set(key, { dayName: dayMatch[1], month, day, elements: [] });
        }
      } else {
        mode = 'restrictions';
        currentKey = key;
        if (!restrictionBlocks.has(key)) {
          restrictionBlocks.set(key, { dayName: dayMatch[1], month, day, elements: [] });
        }
      }
      justSawRestrictionsMarker = false;
      continue;
    }

    if (/^important information$/i.test(text)) {
      mode = null;
      currentKey = null;
      capturingImportant = true;
      continue;
    }
    if (/^community contact details$/i.test(text)) {
      mode = null;
      currentKey = null;
      capturingImportant = false;
      continue;
    }
    if (/^traffic\s*&\s*parking restrictions$/i.test(text)) {
      justSawRestrictionsMarker = true;
      continue;
    }

    if (capturingImportant && tag === 'p') {
      importantNoteLines.push(text);
      continue;
    }

    if (!sawAnyDayHeader) {
      preSummaryLines.push(text);
      continue;
    }

    if (mode === 'fixtures' && currentKey) {
      fixtureBlocks.get(currentKey).lines.push(text);
    } else if (mode === 'restrictions' && currentKey) {
      restrictionBlocks.get(currentKey).elements.push({ tag, text, $el });
    } else if (mode === 'both' && currentKey) {
      fixtureBlocks.get(currentKey).lines.push(text);
      restrictionBlocks.get(currentKey).elements.push({ tag, text, $el });
    }
  }

  const importantNote = importantNoteLines.find((t) => /garda/i.test(t)) || importantNoteLines[0] || null;

  const attendanceByDay = parseAttendanceSummary(preSummaryLines.join(' '));
  const events = [];

  for (const [key, block] of fixtureBlocks) {
    const date = resolveDate(block.month, block.day, now);
    if (!date) {
      warnings.push(`Could not resolve a date for "${block.dayName} ${block.month} ${block.day}" — skipped.`);
      continue;
    }
    const dateISO = isoDate(date);
    let fixtures = extractFixtures(block.lines);
    // No text-based kick-off time/teams found — if this notice has a poster
    // image, it's the last place they could be (some weeks Croke Park
    // publishes the fixture graphic instead of writing it out). OCR is
    // best-effort: if it can't make sense of the poster either, fall through
    // to needsReview exactly as before.
    if (fixtures.length === 0 && posterUrl) {
      try {
        const ocrFixture = await ocrFixtureFromPosterUrl(posterUrl);
        if (ocrFixture?.time) fixtures = [ocrFixture];
      } catch (err) {
        warnings.push(`Could not read the match poster image for "${block.dayName} ${block.month} ${block.day}" (${err.message}).`);
      }
    }
    // Attendance is sometimes stated in the pre-summary text without the day
    // name attached (e.g. a single "Attendance: FULL HOUSE" line with no
    // "Sunday" anywhere near it) — safe to fall back to it only when there's
    // exactly one day's event that week, so it can't be misattributed.
    const attendance = attendanceByDay[block.dayName.toLowerCase()]
      || parseAttendanceFromLines(block.lines)
      || (fixtureBlocks.size === 1 ? parseAttendanceFromLines(preSummaryLines) : null);
    const restriction = restrictionBlocks.get(key) ? extractRestrictionInfo($, restrictionBlocks.get(key).elements) : null;

    const needsReview = fixtures.length === 0 || !attendance || !restriction || (!restriction.parkingRestrictionTime && !restriction.roadClosureTime);
    if (needsReview) {
      warnings.push(`"${block.dayName} ${block.month} ${block.day}" parsed incompletely — check it against ${SOURCE_URL} or use manual entry to correct it.`);
    }

    events.push({
      id: dateISO,
      date: dateISO,
      dayLabel: `${block.dayName} ${block.month} ${block.day}`,
      fixtures,
      attendance,
      official: restriction && {
        parkingRestrictionTime: restriction.parkingRestrictionTime,
        restrictedStreets: restriction.restrictedStreets,
        exitRouteNote: restriction.exitRouteNote,
        roadClosureTime: restriction.roadClosureTime,
        closureRoads: restriction.closureRoads,
        accessRoads: restriction.accessRoads,
      },
      importantNote,
      needsReview,
    });
  }

  events.sort((a, b) => a.date.localeCompare(b.date));
  return { events, warnings };
}

export async function fetchEvents() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(SOURCE_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DrumcondraMatchday/1.0)' },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`Croke Park page responded with ${res.status}`);
    }
    const html = await res.text();
    const { events, warnings } = await parseEventsFromHtml(html);
    return { events, warnings, fetchedAt: new Date().toISOString(), sourceUrl: SOURCE_URL };
  } finally {
    clearTimeout(timeout);
  }
}
