function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v);
  }
  for (const child of [].concat(children)) {
    if (child) node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

// Deliberately not reusing "critical striped" here — on the roads map,
// stripes specifically mean "closed, but a resident pass gets you through."
// This is a general attendance-impact scale, a different thing entirely, so
// it gets its own plain escalation: green -> amber -> orange -> red.
const IMPACT_STATUS = {
  Low: 'good',
  Medium: 'warning',
  High: 'serious',
  'Very high': 'critical',
};

function monthOf(dateLabel) {
  const m = dateLabel.match(/[A-Za-z]+/);
  return m ? m[0] : '';
}

function moonIcon() {
  const span = el('span', { class: 'icon icon-moon' });
  span.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>';
  return span;
}

function renderFixtureRow(f) {
  const status = IMPACT_STATUS[f.impactGuess] || 'warning';
  // Concert time isn't in the source data, but touring gigs at Croke Park are
  // reliably an evening/night show — worth flagging since that's a different
  // disruption pattern (late crowds, dark) than a GAA match, most of which
  // (though not all — some league fixtures are evening too) play by day.
  const fixtureSpan = f.isConcert
    ? el('span', { class: 'season-fixture' }, [`${f.fixture} — `, moonIcon(), ' evening/night gig'])
    : el('span', { class: 'season-fixture', text: f.fixture });
  const row = el('div', { class: 'season-row' }, [
    el('span', { class: 'season-date', text: f.dateLabel }),
    el('span', { class: `swatch ${status}` }),
    fixtureSpan,
  ]);
  if (f.hasDetailedEstimate) {
    row.appendChild(el('a', { class: 'season-link', href: 'index.html' }, ['See detailed estimate →']));
  } else {
    row.appendChild(el('span', { class: 'season-tbc muted', text: 'Time/attendance TBC' }));
  }
  return row;
}

async function loadSeason() {
  const listEl = document.getElementById('season-list');
  const warningsEl = document.getElementById('warnings');
  try {
    const res = await fetch('/api/season');
    const data = await res.json();
    listEl.textContent = '';

    if (data.warning) {
      warningsEl.hidden = false;
      warningsEl.textContent = data.warning;
    }

    if (!data.fixtures || data.fixtures.length === 0) {
      listEl.appendChild(el('p', { class: 'muted', text: 'No upcoming fixtures found.' }));
      return;
    }

    let currentMonth = null;
    let group = null;
    data.fixtures.forEach((f) => {
      const month = monthOf(f.dateLabel);
      if (month !== currentMonth) {
        currentMonth = month;
        group = el('div', { class: 'event-card' });
        group.appendChild(el('h2', { text: month }));
        listEl.appendChild(group);
      }
      group.appendChild(renderFixtureRow(f));
    });
  } catch (err) {
    listEl.textContent = '';
    listEl.appendChild(el('p', { class: 'muted', text: `Could not load the season list (${err.message}).` }));
  }
}

loadSeason();
