const eventsEl = document.getElementById('events');
const warningsEl = document.getElementById('warnings');
const fetchedAtEl = document.getElementById('fetched-at');
const tooltipEl = document.getElementById('tooltip');

// Once real event data has been shown, a later refresh that fails or comes
// back empty (a transient network hiccup, Croke Park's page being briefly
// unreachable) must never blank the screen — residents keep seeing the last
// good data until a fresh, non-empty response actually arrives.
let hasLoadedRealData = false;

function formatClock12(min) {
  const m = Math.max(0, Math.min(1439, Math.round(min)));
  let h = Math.floor(m / 60);
  const mm = m % 60;
  const ampm = h >= 12 ? 'pm' : 'am';
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${String(mm).padStart(2, '0')}${ampm}`;
}

// The first segment's "from" and the last segment's "to" are just where the
// chart window happens to start/end, not a real transition — showing them as
// a range implies a false boundary ("parking available 11:00am-11:30am"
// reads as "only available in that window", not "available up until 11:30").
function formatTimeRange(seg, isFirst, isLast) {
  if (isFirst && !isLast) return `Until ${formatClock12(seg.toMin)}`;
  if (isLast && !isFirst) return `From ${formatClock12(seg.fromMin)}`;
  return `${formatClock12(seg.fromMin)}–${formatClock12(seg.toMin)}`;
}

// Traditional GAA county colours (jersey primary/secondary), used for a
// small identifying swatch next to each team name in the fixtures list.
const COUNTY_COLOURS = {
  waterford: ['#0033a0', '#ffffff'],
  kilkenny: ['#000000', '#ffb81c'],
  galway: ['#7c1c4c', '#ffffff'],
  cork: ['#cc0000', '#ffffff'],
  tipperary: ['#0033a0', '#ffd200'],
  clare: ['#f7d117', '#1b6ec2'],
  limerick: ['#00693e', '#ffffff'],
  dublin: ['#0057b8', '#0057b8'],
  kerry: ['#007a3d', '#ffd200'],
  mayo: ['#00953b', '#ee2f36'],
  meath: ['#006837', '#ffd200'],
  offaly: ['#4a2e83', '#ffd200'],
  laois: ['#0057b8', '#ffffff'],
  wexford: ['#4a2e83', '#ffd200'],
  antrim: ['#f7941d', '#ffffff'],
  down: ['#cc0000', '#000000'],
  derry: ['#cc0000', '#ffffff'],
  armagh: ['#f7941d', '#ffffff'],
};

function teamSwatch(teamName) {
  const colours = COUNTY_COLOURS[teamName.trim().toLowerCase()];
  if (!colours) return null;
  const swatch = el('span', { class: 'team-swatch', title: `${teamName} colours` });
  swatch.style.background = `linear-gradient(135deg, ${colours[0]} 50%, ${colours[1]} 50%)`;
  return swatch;
}

function pct(min, windowStart, windowEnd) {
  return ((min - windowStart) / (windowEnd - windowStart)) * 100;
}

// Position via a CSS custom property rather than setting `left`/`top`
// directly — the default (horizontal) CSS reads --pos as `left`, and the
// phone-breakpoint CSS re-reads the exact same value as `top` instead, so
// the whole chart can flip to a vertical, time-flows-downward layout on a
// narrow screen without any JS having to know or care which mode is active.
function setPos(elm, percent) {
  elm.style.setProperty('--pos', `${percent}%`);
}
function setRange(elm, fromPercent, toPercent) {
  elm.style.setProperty('--from', `${fromPercent}%`);
  elm.style.setProperty('--to', `${toPercent}%`);
}

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const child of [].concat(children)) {
    if (child) node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

// Minimal line icons in place of emoji — bold, evenly-weighted stroke with
// fully rounded caps/joins and rounded corners throughout, matched to a
// reference icon set the user supplied (alarm-clock, shield-check,
// calendar-check, basket — same friendly, chunky-line style). One shared
// path set per concept, sized/coloured via CSS on the wrapping <span class="icon">.
const ICON_PATHS = {
  clock: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 1.5"/><path d="M9 3.5 6.5 5.5"/><path d="M15 3.5l2.5 2"/>',
  check: '<path d="M12 3l6.5 2.8v4.7c0 4.6-3.2 7.4-6.5 8.3-3.3-.9-6.5-3.7-6.5-8.3V5.8L12 3z"/><path d="M9 12.3l2.1 2.1L15.5 10"/>',
  warning: '<path d="M12 4 3 20h18L12 4z"/><path d="M12 10v4"/><path d="M12 16.5h.01"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4"/><path d="M16 3v4"/><path d="M3 10h18"/><path d="M9 15l2 2 4-4"/>',
  car: '<path d="M5 11l1.3-4a2 2 0 0 1 1.9-1.4h7.6a2 2 0 0 1 1.9 1.4l1.3 4"/><rect x="2.5" y="11" width="19" height="6.5" rx="2.5"/><circle cx="7.5" cy="17.5" r="1.6"/><circle cx="16.5" cy="17.5" r="1.6"/>',
  dog: '<circle cx="7.5" cy="8" r="1.5"/><circle cx="12" cy="6" r="1.5"/><circle cx="16.5" cy="8" r="1.5"/><path d="M8.5 14.5a3.5 3.5 0 0 1 7 0c0 2.2-1.7 3.5-3.5 3.5s-3.5-1.3-3.5-3.5z"/>',
  cart: '<path d="M5 9h14l-1.5 8.5a2 2 0 0 1-2 1.5H8.5a2 2 0 0 1-2-1.5L5 9z"/><path d="M8 9a4 4 0 0 1 8 0"/>',
};

function icon(name, extraClass = '') {
  const span = el('span', { class: `icon icon-${name}${extraClass ? ' ' + extraClass : ''}` });
  span.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${ICON_PATHS[name] || ''}</svg>`;
  return span;
}

// A 4-bar gauge, `level` (1-4) bars filled — replaces the old tier emoji
// (😌🙂😬🏟️), same "how much" reading without needing a distinct glyph shape.
function tierIcon(level) {
  const bars = [6, 10, 14, 18].map((h, i) => {
    const x = 3 + i * 5.5;
    const y = 20 - h;
    const filled = i < level;
    return `<rect x="${x}" y="${y}" width="3.5" height="${h}" rx="1.5" ${filled ? 'fill="currentColor" stroke="none"' : 'fill="none"'} />`;
  }).join('');
  const span = el('span', { class: 'icon icon-tier' });
  span.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round">${bars}</svg>`;
  return span;
}

const TIER_ICON_LEVEL = { 'tier-1': 1, 'tier-2': 2, 'tier-3': 3, 'tier-4': 4 };
const PREP_ICON = { car: 'car', dog: 'dog', cart: 'cart' };

function showTooltip(target, text) {
  tooltipEl.textContent = text;
  tooltipEl.hidden = false;
  const rect = target.getBoundingClientRect();
  const top = rect.top - tooltipEl.offsetHeight - 8;
  tooltipEl.style.left = `${Math.max(8, rect.left)}px`;
  tooltipEl.style.top = `${Math.max(8, top)}px`;
}

function hideTooltip() {
  tooltipEl.hidden = true;
}

function buildAxis(windowStart, windowEnd) {
  const span = windowEnd - windowStart;
  const step = span > 480 ? 120 : 60;
  const axis = el('div', { class: 'axis' });
  let t = Math.ceil(windowStart / step) * step;
  for (; t <= windowEnd; t += step) {
    const tick = el('span', { class: 'tick', text: formatClock12(t) });
    setPos(tick, pct(t, windowStart, windowEnd));
    axis.appendChild(tick);
  }
  return axis;
}

function buildFinalWhistleBand(range, windowStart, windowEnd, stagger) {
  if (!range) return null;
  const band = el('div', { class: 'final-whistle-band', tabindex: '0' });
  setRange(band, pct(range.fromMin, windowStart, windowEnd), pct(range.toMin, windowStart, windowEnd));
  band.appendChild(el('span', {
    class: `final-whistle-flag${stagger ? ' final-whistle-flag--low' : ''}`,
    text: `FT ~${formatClock12(range.fromMin)}–${formatClock12(range.toMin)}`,
  }));
  const whoLabel = range.label ? ` (${range.label})` : '';
  const tooltipText = `Estimated final whistle${whoLabel} — somewhere between ${formatClock12(range.fromMin)} and ${formatClock12(range.toMin)}, depending on stoppage time`;
  band.addEventListener('mouseenter', () => showTooltip(band, tooltipText));
  band.addEventListener('focus', () => showTooltip(band, tooltipText));
  band.addEventListener('mouseleave', hideTooltip);
  band.addEventListener('blur', hideTooltip);
  return band;
}

function buildKickoffMarkers(fixtures, windowStart, windowEnd) {
  return fixtures.filter((f) => f.time).map((f) => {
    const min = f.time.hour * 60 + f.time.minute;
    const koTime = formatClock12(min);
    const marker = el('div', { class: 'kickoff-marker', tabindex: '0' });
    setPos(marker, pct(min, windowStart, windowEnd));
    marker.appendChild(el('span', { class: 'kickoff-flag', text: `KO ${koTime}` }));
    const tooltipText = f.home && f.away
      ? `Kick-off ${koTime} — ${f.home} v ${f.away}${f.competition ? ` (${f.competition})` : ''}`
      : `Kick-off ${koTime}`;
    marker.addEventListener('mouseenter', () => showTooltip(marker, tooltipText));
    marker.addEventListener('focus', () => showTooltip(marker, tooltipText));
    marker.addEventListener('mouseleave', hideTooltip);
    marker.addEventListener('blur', hideTooltip);
    return marker;
  });
}

// Only meaningful for today's own card — a "now" line on a future or past
// day's timeline would just be confusing, not useful.
function buildNowMarker(windowStart, windowEnd) {
  const now = new Date();
  const minutesNow = now.getHours() * 60 + now.getMinutes();
  if (minutesNow < windowStart || minutesNow > windowEnd) return null;
  const marker = el('div', { class: 'now-marker now-line' });
  setPos(marker, pct(minutesNow, windowStart, windowEnd));
  marker.appendChild(el('span', { class: 'now-flag', text: 'Now' }));
  return marker;
}

function buildLane(name, segments, windowStart, windowEnd, key) {
  const track = el('div', { class: 'lane-track' });
  segments.forEach((seg, i) => {
    const seg_el = el('div', {
      class: `seg timeline-segment status-${seg.status}${seg.texture ? ' textured' : ''}`,
      tabindex: '0',
    });
    setRange(seg_el, pct(seg.fromMin, windowStart, windowEnd), pct(seg.toMin, windowStart, windowEnd));
    // No visible seam between two segments that look identical (same status,
    // same striped/solid texture) — a gap there reads as "something changes
    // here" when nothing actually does visually, just the label underneath.
    const next = segments[i + 1];
    if (next && next.status === seg.status && !!next.texture === !!seg.texture) {
      seg_el.style.setProperty('--gap', '0px');
    }
    const timeRange = formatTimeRange(seg, i === 0, i === segments.length - 1);
    const tooltipText = `${seg.label}${seg.note ? ' — ' + seg.note : ''} · ${timeRange}${seg.official ? ' · Official info' : ' · Estimate'}`;
    seg_el.addEventListener('mouseenter', () => showTooltip(seg_el, tooltipText));
    seg_el.addEventListener('focus', () => showTooltip(seg_el, tooltipText));
    seg_el.addEventListener('mouseleave', hideTooltip);
    seg_el.addEventListener('blur', hideTooltip);
    track.appendChild(seg_el);
  });
  const laneEl = el('div', { class: 'lane' }, [
    track,
    el('span', { class: 'lane-name', text: name }),
  ]);
  if (key) laneEl.dataset.lane = key;
  return laneEl;
}

const STATUS_RANK = { good: 0, warning: 1, critical: 2 };
const PLANNER_LANES = [
  { key: 'roads', name: 'Roads' },
  { key: 'parking', name: 'Parking' },
  { key: 'footTraffic', name: 'Foot traffic' },
];

function segmentsOverlapping(lane, fromMin, toMin) {
  return lane.filter((seg) => seg.fromMin < toMin && seg.toMin > fromMin);
}

function combinedStatusAt(ev, minute) {
  let worst = 'good';
  for (const { key } of PLANNER_LANES) {
    const seg = ev.timeline[key].find((s) => minute >= s.fromMin && minute < s.toMin);
    if (seg && STATUS_RANK[seg.status] > STATUS_RANK[worst]) worst = seg.status;
  }
  return worst;
}

// Scans the whole day minute-by-minute for a run of "good" (on every lane)
// at least `durationMin` long, and returns whichever one starts closest to
// the time the resident actually asked about.
function findBestWindow(ev, durationMin, preferredMin) {
  const runs = [];
  let runStart = null;
  for (let m = ev.windowStart; m <= ev.windowEnd; m += 5) {
    const isGood = combinedStatusAt(ev, m) === 'good';
    if (isGood && runStart === null) runStart = m;
    if ((!isGood || m === ev.windowEnd) && runStart !== null) {
      const runEnd = m;
      if (runEnd - runStart >= durationMin) runs.push({ fromMin: runStart, toMin: runEnd });
      runStart = null;
    }
  }
  if (!runs.length) return null;
  // Within a run, the closest usable start to what was asked for is
  // `preferredMin` itself, clamped to fit the run (a run longer than the
  // requested duration can start anywhere between its edges).
  const distanceFor = (run) => {
    const latestStart = run.toMin - durationMin;
    const clampedStart = Math.min(Math.max(preferredMin, run.fromMin), latestStart);
    return { clampedStart, dist: Math.abs(clampedStart - preferredMin) };
  };
  const best = runs
    .map((run) => ({ run, ...distanceFor(run) }))
    .reduce((closest, candidate) => (candidate.dist < closest.dist ? candidate : closest));
  return { fromMin: best.clampedStart, toMin: best.clampedStart + durationMin };
}

function buildPlanner(ev) {
  const wrap = el('div', { class: 'planner' });
  wrap.appendChild(el('h4', {}, [icon('clock'), ' Check a time']));

  const timeInput = el('input', { type: 'time', class: 'planner-time', value: '13:00' });
  const durationSelect = el('select', { class: 'planner-duration' }, [
    el('option', { value: '30' }, ['30 min']),
    el('option', { value: '60' }, ['1 hour']),
    el('option', { value: '90' }, ['1.5 hours']),
    el('option', { value: '120' }, ['2 hours']),
    el('option', { value: '180' }, ['3 hours']),
  ]);
  durationSelect.value = '60';
  const checkBtn = el('button', { type: 'button' }, ['Check']);
  const resultEl = el('div', { class: 'planner-result' });

  const form = el('div', { class: 'planner-form' }, [
    el('label', { class: 'planner-label' }, ['Leaving around', timeInput]),
    el('label', { class: 'planner-label' }, ['For about', durationSelect]),
    checkBtn,
  ]);

  checkBtn.addEventListener('click', () => {
    const [h, m] = timeInput.value.split(':').map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) {
      resultEl.textContent = 'Pop in a time first.';
      return;
    }
    const startMin = h * 60 + m;
    const durationMin = Number(durationSelect.value);
    const endMin = startMin + durationMin;

    const perLane = PLANNER_LANES.map(({ key, name }) => {
      const overlapping = segmentsOverlapping(ev.timeline[key], startMin, endMin);
      const worst = overlapping.reduce((acc, s) => (STATUS_RANK[s.status] > STATUS_RANK[acc] ? s.status : acc), 'good');
      const worstSeg = overlapping.find((s) => s.status === worst);
      return { name, worst, label: worstSeg ? worstSeg.label : 'Normal' };
    });
    const overall = perLane.reduce((acc, l) => (STATUS_RANK[l.worst] > STATUS_RANK[acc] ? l.worst : acc), 'good');

    resultEl.textContent = '';
    resultEl.className = `planner-result planner-result--${overall}`;

    if (overall === 'good') {
      resultEl.appendChild(el('p', {}, [
        icon('check'), ` Grand, go for it — ${formatClock12(startMin)}–${formatClock12(endMin)} looks clear on roads, parking and foot traffic.`,
      ]));
    } else {
      const verbIcon = overall === 'critical' ? icon('warning') : el('span', { class: 'swatch warning' });
      const verb = overall === 'critical' ? "I'd hold off" : 'Doable, but';
      resultEl.appendChild(el('p', {}, [
        verbIcon, ` ${verb} — here's what's going on ${formatClock12(startMin)}–${formatClock12(endMin)}:`,
      ]));
      const ul = el('ul');
      perLane.filter((l) => l.worst !== 'good').forEach((l) => {
        ul.appendChild(el('li', { text: `${l.name}: ${l.label}` }));
      });
      resultEl.appendChild(ul);

      const best = findBestWindow(ev, durationMin, startMin);
      if (best) {
        resultEl.appendChild(el('p', { class: 'planner-suggestion', text: `Try ${formatClock12(best.fromMin)}–${formatClock12(best.toMin)} instead — that stretch looks clear.` }));
      } else {
        resultEl.appendChild(el('p', { class: 'planner-suggestion', text: "Couldn't find a fully clear window that long today — best to build in some slack whenever you go." }));
      }
    }
  });

  wrap.appendChild(form);
  wrap.appendChild(resultEl);
  return wrap;
}

function buildDetailsTable(name, segments) {
  const list = el('ul', { class: 'phase-list' });
  segments.forEach((seg, i) => {
    const row = el('li', { class: 'phase-row' });
    if (seg.note) row.setAttribute('title', seg.note);
    row.appendChild(el('span', { class: `swatch ${seg.status}${seg.texture ? ' striped' : ''}` }));
    row.appendChild(el('span', { class: 'phase-time', text: formatTimeRange(seg, i === 0, i === segments.length - 1) }));
    row.appendChild(el('span', { class: 'phase-label', text: seg.label }));
    row.appendChild(el('span', { class: `phase-source${seg.official ? ' official' : ''}`, text: seg.official ? 'Official info' : 'Estimate' }));
    list.appendChild(row);
  });
  return el('div', { class: 'phase-group' }, [el('h4', { text: name }), list]);
}

function buildExactTimes(ev) {
  const details = el('details', { class: 'details-table' });
  details.appendChild(el('summary', { text: 'Show exact times as a list' }));
  details.appendChild(buildDetailsTable('Roads', ev.timeline.roads));
  return details;
}

// The planner applies to one specific day's data, but lives inside a shared
// section (picked via a day dropdown) rather than duplicated inside every
// match card, keeping the core "what's happening" timeline the focus.
// "Show exact times as a list" stays inside each card, next to the chart it
// explains, rather than moving down here with the interactive tools.
function buildDayTools(ev) {
  const wrap = el('div', { class: 'day-tools-content' });
  wrap.appendChild(buildPlanner(ev));
  return wrap;
}

function relativePastLabel(dateISO, todayISO) {
  const diffDays = Math.round((new Date(todayISO) - new Date(dateISO)) / 86400000);
  if (diffDays === 1) return 'This was yesterday';
  if (diffDays > 1) return `This was ${diffDays} days ago`;
  return 'This has already happened';
}

function renderEvent(ev, { isPast = false, todayISO = null } = {}) {
  const card = el('div', { class: `event-card day-card${ev.needsReview ? ' needs-review' : ''}${isPast ? ' past-event' : ''}` });
  card.appendChild(el('h2', {}, ev.tier ? [tierIcon(TIER_ICON_LEVEL[ev.tier.icon] || 1), ' ', ev.dayLabel] : [ev.dayLabel]));

  if (isPast) {
    card.appendChild(el('div', { class: 'past-banner' }, [icon('calendar'), ` ${relativePastLabel(ev.date, todayISO)} — kept here for reference only.`]));
  }

  if (ev.error) {
    card.appendChild(el('p', { class: 'muted', text: ev.error }));
    // No kick-off time means no timeline chart can be built, but Croke
    // Park's own restriction notice doesn't depend on kick-off time — show
    // that much plainly rather than leaving the card empty.
    if (ev.attendance) {
      const att = ev.attendance.isFullHouse ? 'Full house expected.' : `~${ev.attendance.value.toLocaleString()} expected.`;
      card.appendChild(el('p', { class: 'muted', text: att }));
    }
    if (ev.official) {
      const { roadClosureTime, closureRoads, accessRoads, parkingRestrictionTime, restrictedStreets, exitRouteNote } = ev.official;
      const list = el('ul', { class: 'official-fallback-list' });
      if (roadClosureTime && closureRoads?.length) {
        list.appendChild(el('li', {
          text: `${closureRoads.join(' & ')} closed from ${roadClosureTime}`
            + (accessRoads?.length ? ` — resident access via ${accessRoads.join(' & ')}.` : '.'),
        }));
      }
      if (parkingRestrictionTime && restrictedStreets?.length) {
        list.appendChild(el('li', { text: `Parking restricted from ${parkingRestrictionTime} on: ${restrictedStreets.join(', ')}.` }));
      }
      if (exitRouteNote) list.appendChild(el('li', { text: exitRouteNote }));
      if (list.children.length) {
        card.appendChild(el('p', { class: 'muted', text: "Croke Park's official notice for this day:" }));
        card.appendChild(list);
      }
    }
    return card;
  }

  const attendanceText = ev.attendance
    ? `~${ev.attendance.value.toLocaleString()} expected`
    : 'Attendance unknown — assumed medium crowd for this estimate';
  card.appendChild(el('p', { class: 'tagline', text: `${ev.tier.tagline} ${attendanceText}.` }));

  if (ev.needsReview) {
    card.appendChild(el('div', { class: 'review-banner' }, [
      icon('warning'), " Couldn't make head or tail of some of this day's details automatically — best check the official notice yourself.",
    ]));
  }

  const fixturesList = el('ul', { class: 'fixtures-list' });
  ev.fixtures.forEach((f, i) => {
    const li = el('li');
    const displayTime = f.time ? formatClock12(f.time.hour * 60 + f.time.minute) : f.timeText;
    li.appendChild(document.createTextNode(`${displayTime} `));
    if (f.home && f.away) {
      const homeSwatch = teamSwatch(f.home);
      if (homeSwatch) li.appendChild(homeSwatch);
      li.appendChild(document.createTextNode(f.home));
      li.appendChild(document.createTextNode(' v '));
      const awaySwatch = teamSwatch(f.away);
      if (awaySwatch) li.appendChild(awaySwatch);
      li.appendChild(document.createTextNode(f.away + (f.competition ? ` (${f.competition})` : '')));
    } else {
      li.appendChild(document.createTextNode('kick-off'));
    }
    const range = ev.finalWhistleRanges && ev.finalWhistleRanges[i];
    if (range) {
      li.appendChild(el('span', {
        class: 'fixture-end-estimate',
        text: ` — ends ~${formatClock12(range.fromMin)}–${formatClock12(range.toMin)}`,
      }));
    }
    fixturesList.appendChild(li);
  });
  card.appendChild(fixturesList);
  card.appendChild(el('p', { class: 'muted', text: `Estimated final whistle ~${ev.estimatedFinalWhistle}` }));

  card.appendChild(el('p', { class: 'tip-callout' }, [icon(ev.tip.icon), ` ${ev.tip.text}`]));

  const group = el('div', { class: 'timeline-group' });

  const lanesWrapper = el('div', { class: 'lanes-wrapper' });
  lanesWrapper.appendChild(buildLane('Roads', ev.timeline.roads, ev.windowStart, ev.windowEnd, 'roads'));
  lanesWrapper.appendChild(buildLane('Parking', ev.timeline.parking, ev.windowStart, ev.windowEnd, 'parking'));
  lanesWrapper.appendChild(buildLane('Foot traffic', ev.timeline.footTraffic, ev.windowStart, ev.windowEnd, 'footTraffic'));
  // Only drop a flag onto the row below when it would actually collide with
  // the previous one — a doubleheader with fixtures hours apart (the common
  // case) doesn't need the extra vertical space a blanket every-other-one
  // stagger would cost it.
  const COLLISION_THRESHOLD_PCT = 16;
  let lastRowCenterPct = -Infinity;
  (ev.finalWhistleRanges || [ev.finalWhistleRange]).forEach((range) => {
    const centerPct = (pct(range.fromMin, ev.windowStart, ev.windowEnd) + pct(range.toMin, ev.windowStart, ev.windowEnd)) / 2;
    const stagger = Math.abs(centerPct - lastRowCenterPct) < COLLISION_THRESHOLD_PCT;
    if (!stagger) lastRowCenterPct = centerPct;
    const whistleBand = buildFinalWhistleBand(range, ev.windowStart, ev.windowEnd, stagger);
    if (whistleBand) lanesWrapper.appendChild(whistleBand);
  });
  buildKickoffMarkers(ev.fixtures, ev.windowStart, ev.windowEnd).forEach((m) => lanesWrapper.appendChild(m));
  if (ev.date === todayISO) {
    const nowMarker = buildNowMarker(ev.windowStart, ev.windowEnd);
    if (nowMarker) lanesWrapper.appendChild(nowMarker);
  }
  group.appendChild(lanesWrapper);

  group.appendChild(buildAxis(ev.windowStart, ev.windowEnd));
  card.appendChild(group);

  card.appendChild(buildExactTimes(ev));

  return card;
}

async function loadEvents() {
  if (!hasLoadedRealData) {
    eventsEl.textContent = '';
    eventsEl.appendChild(el('p', { class: 'muted', text: 'Loading upcoming events…' }));
  }
  try {
    const res = await fetch('/api/events');
    const data = await res.json();

    if (!data.events || data.events.length === 0) {
      // Nothing new to show yet — if we already have real data on screen,
      // leave it exactly as it is rather than replacing it with an empty
      // state. Still surface the warnings/last-checked time so it's clear a
      // check did happen.
      if (data.warnings && data.warnings.length) {
        warningsEl.textContent = '';
        warningsEl.hidden = false;
        warningsEl.appendChild(el('strong', { text: 'Heads up:' }));
        const ul = el('ul');
        data.warnings.forEach((w) => ul.appendChild(el('li', { text: w })));
        warningsEl.appendChild(ul);
      } else if (!hasLoadedRealData) {
        warningsEl.hidden = true;
      }
      fetchedAtEl.textContent = data.fetchedAt ? `Last checked ${new Date(data.fetchedAt).toLocaleString()}` : fetchedAtEl.textContent;
      if (!hasLoadedRealData) {
        eventsEl.textContent = '';
        eventsEl.appendChild(el('p', { class: 'muted', text: 'No upcoming events found on the Croke Park page right now.' }));
      }
      return;
    }

    eventsEl.textContent = '';
    hasLoadedRealData = true;

    if (data.warnings && data.warnings.length) {
      warningsEl.textContent = '';
      warningsEl.hidden = false;
      warningsEl.appendChild(el('strong', { text: 'Heads up:' }));
      const ul = el('ul');
      data.warnings.forEach((w) => ul.appendChild(el('li', { text: w })));
      warningsEl.appendChild(ul);
    } else {
      warningsEl.hidden = true;
    }

    fetchedAtEl.textContent = data.fetchedAt ? `Last checked ${new Date(data.fetchedAt).toLocaleString()}` : '';

    // Persistent rule: today/upcoming leads the page, no matter what order
    // the source lists things in — a match that already happened yesterday
    // is stale information and shouldn't be the first thing anyone sees.
    const todayISO = new Date().toISOString().slice(0, 10);
    const upcoming = data.events.filter((ev) => ev.date >= todayISO);
    const past = data.events.filter((ev) => ev.date < todayISO);

    upcoming.forEach((ev) => eventsEl.appendChild(renderEvent(ev, { todayISO })));

    if (past.length) {
      if (!upcoming.length) {
        eventsEl.appendChild(el('p', {
          class: 'muted past-events-note',
          text: "No upcoming event is published yet — this'll update as soon as Croke Park releases the details for the next one.",
        }));
      }
      // Collapsed by default — past matches are reference material, not the
      // thing anyone opens this page to see, so they shouldn't push the
      // actually-relevant upcoming event further down the page.
      const pastDetails = el('details', { class: 'past-events-toggle' });
      pastDetails.appendChild(el('summary', { class: 'past-events-header', text: 'Past — for reference' }));
      past
        .sort((a, b) => b.date.localeCompare(a.date))
        .forEach((ev) => pastDetails.appendChild(renderEvent(ev, { isPast: true, todayISO })));
      eventsEl.appendChild(pastDetails);
    }

    const dayToolsSection = document.getElementById('day-tools');
    const dayPicker = document.getElementById('day-picker');
    const dayToolsContent = document.getElementById('day-tools-content');
    if (dayToolsSection && dayPicker && dayToolsContent) {
      if (upcoming.length) {
        dayToolsSection.hidden = false;
        dayPicker.textContent = '';
        upcoming.forEach((ev) => dayPicker.appendChild(el('option', { value: ev.id, text: ev.dayLabel })));
        const renderSelectedDay = () => {
          const selected = upcoming.find((ev) => ev.id === dayPicker.value) || upcoming[0];
          dayToolsContent.textContent = '';
          dayToolsContent.appendChild(buildDayTools(selected));
        };
        dayPicker.onchange = renderSelectedDay;
        renderSelectedDay();
      } else {
        dayToolsSection.hidden = true;
      }
    }

    observeDayCards();
  } catch (err) {
    // A failed refresh must not wipe out data that's already on screen —
    // surface the failure in the warnings banner instead, and only fall
    // back to replacing the events list if there was nothing there yet.
    warningsEl.textContent = '';
    warningsEl.hidden = false;
    warningsEl.appendChild(el('strong', { text: 'Heads up:' }));
    const ul = el('ul');
    ul.appendChild(el('li', { text: `Could not check for updates (${err.message}) — showing the last data loaded.` }));
    warningsEl.appendChild(ul);
    if (!hasLoadedRealData) {
      eventsEl.textContent = '';
      eventsEl.appendChild(el('p', { class: 'muted', text: `Could not load events (${err.message}).` }));
    }
  }
}

// Bars fill in left to right, staggered, the first time a day card scrolls
// into view — once played, a card is unobserved and left alone, never
// touching anything else on it (KO/FT badges, the Now line, labels, legend,
// and the "Show exact times" toggle always stay exactly as they are).
let dayCardObserver = null;
function observeDayCards() {
  if (dayCardObserver) dayCardObserver.disconnect();
  dayCardObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.querySelectorAll('.timeline-segment').forEach((seg, i) => {
        seg.style.animationDelay = `${i * 60}ms`;
        seg.classList.add('play');
      });
      dayCardObserver.unobserve(entry.target);
    });
  }, { threshold: 0.4 });
  document.querySelectorAll('.day-card').forEach((card) => dayCardObserver.observe(card));
}

document.getElementById('refresh-btn').addEventListener('click', loadEvents);

// Parking is hidden by default (Roads + Foot traffic covers what most
// residents need at a glance) — this just toggles a body class, so it
// applies to every card at once and survives a Refresh re-render.
const showParkingToggle = document.getElementById('show-parking-toggle');
if (showParkingToggle) {
  showParkingToggle.addEventListener('change', () => {
    document.body.classList.toggle('show-parking', showParkingToggle.checked);
  });
}

loadEvents();
