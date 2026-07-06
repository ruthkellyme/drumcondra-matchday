import * as cheerio from 'cheerio';
import { SOURCE_URL, CROKE_PARK_CAPACITY } from './config.js';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_HEADER_RE = new RegExp(
  `^(${DAY_NAMES.join('|')})\\s+([A-Za-z]+)\\s+(\\d{1,2})(?:st|nd|rd|th)?\\.?$`,
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

function extractFixtures(lines) {
  const fixtures = [];
  const fixtureRe = /(\d{1,2}[:.]\d{2})\s+(.+?)\s+V\s+(.+?)\s*\(([^)]+)\)/i;
  for (const line of lines) {
    const m = line.match(fixtureRe);
    if (m) {
      const time = parseClockTime(m[1]);
      fixtures.push({
        timeText: m[1].replace('.', ':'),
        time,
        home: m[2].trim(),
        away: m[3].trim(),
        competition: m[4].trim(),
      });
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
    if (/parking restrictions will be in operation from/i.test(text)) {
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

    if (/will close/i.test(text) && /approximately/i.test(text)) {
      const m = text.match(/approximately\s+([\d.:]+\s*[ap]\.?\s*m\.?)/i);
      if (m) info.roadClosureTime = m[1].trim();
      $el.find('strong').each((_, s) => {
        const t = normalizeText($(s).text());
        if (t && !looksLikeTime(t)) info.closureRoads.push(t);
      });
    }

    if (/clonliffe road/i.test(text)) {
      $el.find('strong').each((_, s) => {
        const t = normalizeText($(s).text());
        if (t && !looksLikeTime(t) && !info.closureRoads.includes(t)) info.closureRoads.push(t);
      });
    }

    if (/resident vehicular access will be maintained via/i.test(text)) {
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

export function parseEventsFromHtml(html, { now = new Date() } = {}) {
  const $ = cheerio.load(html);
  const content = $('.well-content').first();
  const warnings = [];

  if (!content.length) {
    return {
      events: [],
      warnings: ['Could not find the expected content block on the Croke Park page — the page layout may have changed. Use the manual entry form instead.'],
    };
  }

  const children = content.children().toArray();
  const fixtureBlocks = new Map();
  const restrictionBlocks = new Map();
  const preSummaryLines = [];

  let mode = null;
  let currentKey = null;
  let sawAnyDayHeader = false;
  let capturingImportant = false;
  const importantNoteLines = [];

  for (const el of children) {
    const $el = $(el);
    const tag = (el.tagName || '').toLowerCase();
    const text = normalizeText($el.text());
    if (!text) continue;

    const dayMatch = text.match(DAY_HEADER_RE);
    if (dayMatch && (tag === 'p' || tag === 'h3')) {
      const key = dayKey(dayMatch[2], dayMatch[3]);
      sawAnyDayHeader = true;
      capturingImportant = false;
      if (tag === 'p') {
        mode = 'fixtures';
        currentKey = key;
        if (!fixtureBlocks.has(key)) {
          fixtureBlocks.set(key, { dayName: dayMatch[1], month: dayMatch[2], day: dayMatch[3], lines: [] });
        }
      } else {
        mode = 'restrictions';
        currentKey = key;
        if (!restrictionBlocks.has(key)) {
          restrictionBlocks.set(key, { dayName: dayMatch[1], month: dayMatch[2], day: dayMatch[3], elements: [] });
        }
      }
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
    if (/^traffic\s*&\s*parking restrictions$/i.test(text)) continue;

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
    const fixtures = extractFixtures(block.lines);
    const attendance = attendanceByDay[block.dayName.toLowerCase()] || null;
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
    const { events, warnings } = parseEventsFromHtml(html);
    return { events, warnings, fetchedAt: new Date().toISOString(), sourceUrl: SOURCE_URL };
  } finally {
    clearTimeout(timeout);
  }
}
