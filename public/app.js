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
  wrap.appendChild(el('h4', { text: '🤔 Check a time' }));

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
      resultEl.appendChild(el('p', { text: `✅ Grand, go for it — ${formatClock12(startMin)}–${formatClock12(endMin)} looks clear on roads, parking and foot traffic.` }));
    } else {
      const verb = overall === 'critical' ? "🔴 I'd hold off" : '🟡 Doable, but';
      resultEl.appendChild(el('p', { text: `${verb} — here's what's going on ${formatClock12(startMin)}–${formatClock12(endMin)}:` }));
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

function buildFeedbackForm(ev) {
  const wrap = el('div', { class: 'feedback-form' });
  wrap.appendChild(el('h4', { text: '📝 How did this one actually go?' }));

  const laneSelect = el('select', { class: 'feedback-lane' }, [
    el('option', { value: 'General' }, ['General']),
    el('option', { value: 'Roads' }, ['Roads']),
    el('option', { value: 'Parking' }, ['Parking']),
    el('option', { value: 'Foot traffic' }, ['Foot traffic']),
  ]);
  const textarea = el('textarea', {
    class: 'feedback-message',
    rows: '3',
    placeholder: "e.g. \"Russell Street didn't actually reopen until well after 8pm\"",
  });
  const submitBtn = el('button', { type: 'button' }, ['Send']);
  const statusEl = el('p', { class: 'feedback-status muted' });

  submitBtn.addEventListener('click', async () => {
    const message = textarea.value.trim();
    if (!message) {
      statusEl.textContent = 'Pop in a few words first.';
      return;
    }
    submitBtn.disabled = true;
    statusEl.textContent = 'Sending…';
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId: ev.id, dayLabel: ev.dayLabel, lane: laneSelect.value, message }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Something went wrong');
      statusEl.textContent = "Thanks — noted, and it'll help tune the next estimate.";
      textarea.value = '';
    } catch (err) {
      statusEl.textContent = `Couldn't send that (${err.message}).`;
    } finally {
      submitBtn.disabled = false;
    }
  });

  wrap.appendChild(el('div', { class: 'feedback-fields' }, [laneSelect, textarea, submitBtn]));
  wrap.appendChild(statusEl);
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
  details.appendChild(buildDetailsTable('Parking', ev.timeline.parking));
  details.appendChild(buildDetailsTable('Foot traffic', ev.timeline.footTraffic));
  return details;
}

// Planner / feedback apply to one specific day's data, but living inside a
// shared section (picked via a day dropdown) rather than duplicated inside
// every match card keeps the core "what's happening" timeline the focus.
// "Show exact times as a list" stays inside each card, next to the chart it
// explains, rather than moving down here with the interactive tools.
function buildDayTools(ev) {
  const wrap = el('div', { class: 'day-tools-content' });
  wrap.appendChild(buildPlanner(ev));
  wrap.appendChild(buildFeedbackForm(ev));
  return wrap;
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

  card.appendChild(buildExactTimes(ev));

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
  } catch (err) {
    eventsEl.textContent = '';
    eventsEl.appendChild(el('p', { class: 'muted', text: `Could not load events (${err.message}).` }));
  }
}

document.getElementById('refresh-btn').addEventListener('click', loadEvents);

loadEvents();
