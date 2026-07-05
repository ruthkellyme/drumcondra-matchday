const eventsEl = document.getElementById('events');
const warningsEl = document.getElementById('warnings');
const fetchedAtEl = document.getElementById('fetched-at');
const tooltipEl = document.getElementById('tooltip');

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

// Matches .lane's `82px label + 10px gap` before the track starts, so
// kickoff markers (positioned relative to the whole lanes-wrapper) line up
// with the lane tracks and the axis ticks underneath them.
const LANE_OFFSET_PX = 92;

function leftWithLaneOffset(min, windowStart, windowEnd) {
  const p = pct(min, windowStart, windowEnd) / 100;
  return `calc(${LANE_OFFSET_PX}px + (100% - ${LANE_OFFSET_PX}px) * ${p.toFixed(4)})`;
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
    tick.style.left = `${pct(t, windowStart, windowEnd)}%`;
    axis.appendChild(tick);
  }
  return axis;
}

function buildFinalWhistleBand(range, windowStart, windowEnd, stagger) {
  if (!range) return null;
  const band = el('div', { class: 'final-whistle-band', tabindex: '0' });
  const leftPct = pct(range.fromMin, windowStart, windowEnd);
  const rightPct = pct(range.toMin, windowStart, windowEnd);
  band.style.left = leftWithLaneOffset(range.fromMin, windowStart, windowEnd);
  band.style.width = `calc((100% - ${LANE_OFFSET_PX}px) * ${((rightPct - leftPct) / 100).toFixed(4)})`;
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
    const marker = el('div', { class: 'kickoff-marker', tabindex: '0' });
    marker.style.left = leftWithLaneOffset(min, windowStart, windowEnd);
    marker.appendChild(el('span', { class: 'kickoff-flag', text: `KO ${f.timeText}` }));
    const tooltipText = f.home && f.away
      ? `Kick-off ${f.timeText} — ${f.home} v ${f.away}${f.competition ? ` (${f.competition})` : ''}`
      : `Kick-off ${f.timeText}`;
    marker.addEventListener('mouseenter', () => showTooltip(marker, tooltipText));
    marker.addEventListener('focus', () => showTooltip(marker, tooltipText));
    marker.addEventListener('mouseleave', hideTooltip);
    marker.addEventListener('blur', hideTooltip);
    return marker;
  });
}

function buildLane(name, segments, windowStart, windowEnd) {
  const track = el('div', { class: 'lane-track' });
  segments.forEach((seg, i) => {
    const seg_el = el('div', {
      class: `seg status-${seg.status}${seg.texture ? ' textured' : ''}`,
      tabindex: '0',
    });
    seg_el.style.left = `${pct(seg.fromMin, windowStart, windowEnd)}%`;
    seg_el.style.width = `calc(${pct(seg.toMin, windowStart, windowEnd) - pct(seg.fromMin, windowStart, windowEnd)}% - 2px)`;
    const timeRange = formatTimeRange(seg, i === 0, i === segments.length - 1);
    const tooltipText = `${seg.label}${seg.note ? ' — ' + seg.note : ''} · ${timeRange}${seg.official ? ' · Official info' : ' · Estimate'}`;
    seg_el.addEventListener('mouseenter', () => showTooltip(seg_el, tooltipText));
    seg_el.addEventListener('focus', () => showTooltip(seg_el, tooltipText));
    seg_el.addEventListener('mouseleave', hideTooltip);
    seg_el.addEventListener('blur', hideTooltip);
    track.appendChild(seg_el);
  });
  return el('div', { class: 'lane' }, [
    el('span', { class: 'lane-name', text: name }),
    track,
  ]);
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

function relativePastLabel(dateISO, todayISO) {
  const diffDays = Math.round((new Date(todayISO) - new Date(dateISO)) / 86400000);
  if (diffDays === 1) return 'This was yesterday';
  if (diffDays > 1) return `This was ${diffDays} days ago`;
  return 'This has already happened';
}

function renderEvent(ev, { isPast = false, todayISO = null } = {}) {
  const card = el('div', { class: `event-card${ev.needsReview ? ' needs-review' : ''}${isPast ? ' past-event' : ''}` });
  card.appendChild(el('h2', { text: `${ev.tier ? ev.tier.emoji + ' ' : ''}${ev.dayLabel}` }));

  if (isPast) {
    card.appendChild(el('div', { class: 'past-banner', text: `📅 ${relativePastLabel(ev.date, todayISO)} — kept here for reference only.` }));
  }

  if (ev.error) {
    card.appendChild(el('p', { class: 'muted', text: ev.error }));
    return card;
  }

  card.appendChild(el('p', { class: 'tagline', text: ev.tier.tagline }));

  if (ev.needsReview) {
    card.appendChild(el('div', {
      class: 'review-banner',
      text: "⚠️ Couldn't make head or tail of some of this day's details automatically — best check the official notice yourself.",
    }));
  }

  const fixturesList = el('ul', { class: 'fixtures-list' });
  ev.fixtures.forEach((f, i) => {
    const li = el('li');
    li.appendChild(document.createTextNode(`${f.timeText} `));
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

  // The tagline above already says "full house" for that tier — repeat the
  // actual number here instead of the same phrase twice in a row.
  const attendanceText = ev.attendance
    ? `~${ev.attendance.value.toLocaleString()} expected`
    : 'Attendance unknown — assumed medium crowd for this estimate';
  card.appendChild(el('p', { class: 'muted', text: `${attendanceText} · ${ev.tier.name} tier · estimated final whistle ~${ev.estimatedFinalWhistle}` }));

  card.appendChild(el('p', { class: 'tip-callout', text: `${ev.tip.icon} ${ev.tip.text}` }));

  const group = el('div', { class: 'timeline-group' });

  const lanesWrapper = el('div', { class: 'lanes-wrapper' });
  lanesWrapper.appendChild(buildLane('Roads', ev.timeline.roads, ev.windowStart, ev.windowEnd));
  lanesWrapper.appendChild(buildLane('Parking', ev.timeline.parking, ev.windowStart, ev.windowEnd));
  lanesWrapper.appendChild(buildLane('Foot traffic', ev.timeline.footTraffic, ev.windowStart, ev.windowEnd));
  (ev.finalWhistleRanges || [ev.finalWhistleRange]).forEach((range, i) => {
    const whistleBand = buildFinalWhistleBand(range, ev.windowStart, ev.windowEnd, i % 2 === 1);
    if (whistleBand) lanesWrapper.appendChild(whistleBand);
  });
  buildKickoffMarkers(ev.fixtures, ev.windowStart, ev.windowEnd).forEach((m) => lanesWrapper.appendChild(m));
  group.appendChild(lanesWrapper);

  group.appendChild(buildAxis(ev.windowStart, ev.windowEnd));
  card.appendChild(group);

  const details = el('details', { class: 'details-table' });
  details.appendChild(el('summary', { text: 'Show exact times as a list' }));
  details.appendChild(buildDetailsTable('Roads', ev.timeline.roads));
  details.appendChild(buildDetailsTable('Parking', ev.timeline.parking));
  details.appendChild(buildDetailsTable('Foot traffic', ev.timeline.footTraffic));
  card.appendChild(details);

  return card;
}

async function loadEvents() {
  eventsEl.textContent = '';
  eventsEl.appendChild(el('p', { class: 'muted', text: 'Loading upcoming events…' }));
  try {
    const res = await fetch('/api/events');
    const data = await res.json();
    eventsEl.textContent = '';

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

    if (!data.events || data.events.length === 0) {
      eventsEl.appendChild(el('p', { class: 'muted', text: 'No upcoming events found on the Croke Park page right now.' }));
      return;
    }

    // Persistent rule: today/upcoming leads the page, no matter what order
    // the source lists things in — a match that already happened yesterday
    // is stale information and shouldn't be the first thing anyone sees.
    const todayISO = new Date().toISOString().slice(0, 10);
    const upcoming = data.events.filter((ev) => ev.date >= todayISO);
    const past = data.events.filter((ev) => ev.date < todayISO);

    upcoming.forEach((ev) => eventsEl.appendChild(renderEvent(ev, { todayISO })));

    if (past.length) {
      eventsEl.appendChild(el('h3', { class: 'past-events-header', text: 'Past — for reference' }));
      past
        .sort((a, b) => b.date.localeCompare(a.date))
        .forEach((ev) => eventsEl.appendChild(renderEvent(ev, { isPast: true, todayISO })));
    }
  } catch (err) {
    eventsEl.textContent = '';
    eventsEl.appendChild(el('p', { class: 'muted', text: `Could not load events (${err.message}).` }));
  }
}

document.getElementById('refresh-btn').addEventListener('click', loadEvents);

loadEvents();
