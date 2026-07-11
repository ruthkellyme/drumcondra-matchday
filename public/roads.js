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

const MAP_STATUS_HEX = { good: '#2F6B4F', critical: '#A13A2F', barrier: '#5B6B66' };

// Bold rounded arrow (matches the app-wide icon set) rather than a CSS
// border-trick triangle — round linecap/linejoin gives it the same chunky,
// friendly weight as the other icons instead of a sharp geometric wedge.
const ARROW_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h13"/><path d="M13 6l6 6-6 6"/></svg>';

function entranceIcon(angleDeg) {
  return L.divIcon({
    className: 'entrance-icon',
    html: `<div class="entrance-icon-dot" style="transform: rotate(${angleDeg}deg)">${ARROW_SVG}</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
}

const WARNING_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4 3 20h18L12 4z"/><path d="M12 10v4"/><path d="M12 16.5h.01"/></svg>';

function barrierIcon() {
  return L.divIcon({ className: 'barrier-icon', html: WARNING_SVG, iconSize: [22, 22], iconAnchor: [11, 11] });
}

function warningIcon(className) {
  const span = el('span', { class: className });
  span.innerHTML = WARNING_SVG;
  return span;
}

function arrowIcon(className) {
  const span = el('span', { class: className });
  span.innerHTML = ARROW_SVG;
  return span;
}

function initLeafletMap(mapId, mapData) {
  const container = document.getElementById(mapId);
  if (!container || typeof L === 'undefined') return;
  const map = L.map(container, { scrollWheelZoom: true, zoomControl: false }).setView([mapData.center.lat, mapData.center.lon], 15);
  // Both top corners sit under the full-width overlay bar, and bottom-left is
  // the legend chip's spot — bottom-right is the only free corner.
  L.control.zoom({ position: 'bottomright' }).addTo(map);

  // CARTO's light basemap instead of the standard OSM tiles — the standard
  // style bakes in red-cross pharmacy/hospital icons that look confusingly
  // similar to our own red closure markers. This one is deliberately plain
  // (streets, labels, no POI clutter) so our data is the only thing that pops.
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>',
    maxZoom: 19,
    subdomains: 'abcd',
  }).addTo(map);

  L.marker([mapData.center.lat, mapData.center.lon], {
    icon: L.divIcon({ className: 'stadium-icon', html: '<span class="stadium-label">Croke Park</span>', iconSize: [150, 26], iconAnchor: [75, 13] }),
  }).addTo(map).bindPopup('Croke Park');

  mapData.markers.forEach((m) => {
    const popupEl = el('div', { class: 'map-popup' }, [el('strong', { text: m.name }), el('br'), m.description || '']);
    const colour = MAP_STATUS_HEX[m.status] || '#5B6B66';

    // Access roads get a single "entrance" pin (a circle + arrow pointing
    // into the street) rather than tracing the whole road, since the point
    // that actually matters to a resident is where they can get through —
    // not the full length of a street that's otherwise open as normal. The
    // point/angle are computed server-side, from where the road actually
    // meets the closed roads — not just whichever end is nearest the map centre.
    if (m.status === 'good' || m.status === 'good-resident') {
      const point = m.entrancePoint || [m.lat, m.lon];
      L.marker(point, { icon: entranceIcon(m.entranceAngle || 0) })
        .addTo(map)
        .bindTooltip('Residents only', { permanent: true, direction: 'right', className: 'map-pin-label' })
        .bindPopup(popupEl);
      return;
    }

    if (m.status === 'barrier') {
      L.marker([m.lat, m.lon], { icon: barrierIcon() })
        .addTo(map)
        .bindTooltip('Cordoned area', { permanent: true, direction: 'right', className: 'map-pin-label' })
        .bindPopup(popupEl);
      return;
    }

    // Draw the real street shape when we have it (from OSM way geometry) so
    // a closure reads as "this whole route", not one ambiguous dot guessed
    // to be its centre — a resident can see where a road actually runs. Long
    // roads are often several OSM ways chained together, so draw every
    // segment, not just the first.
    if (m.lines && m.lines.length) {
      m.lines.forEach((path) => {
        if (path.length > 1) L.polyline(path, { color: colour, weight: 5, opacity: 0.85 }).addTo(map).bindPopup(popupEl);
      });
    } else {
      L.circleMarker([m.lat, m.lon], {
        radius: 8,
        color: '#ffffff',
        weight: 2,
        fillColor: colour,
        fillOpacity: 0.9,
      }).addTo(map).bindPopup(popupEl);
    }
  });

  setTimeout(() => map.invalidateSize(), 100);
}

function buildLegendChip(ev) {
  return el('div', { class: 'map-legend-chip' }, [
    el('div', { class: 'map-legend-chip-swatches' }, [
      el('span', { class: 'legend-item' }, [el('span', { class: 'swatch critical' }), 'Closed to through-traffic']),
      el('span', { class: 'legend-item' }, [arrowIcon('legend-icon-entrance'), 'Residents only']),
      el('span', { class: 'legend-item' }, [warningIcon('legend-icon'), 'Cordoned area']),
    ]),
    el('p', { class: 'map-caption', text: 'Same core set of streets every event. Tap a line or pin for details.' }),
  ]);
}

async function loadRoadsMap() {
  const section = document.getElementById('road-map-section');
  const mapPage = document.querySelector('.map-page');
  const warningsEl = document.getElementById('warnings');
  try {
    const res = await fetch('/api/events');
    const data = await res.json();

    const withMap = (data.events || []).find((e) => e.map && e.map.markers && e.map.markers.length);
    if (!withMap) {
      section.textContent = '';
      section.appendChild(el('p', { class: 'muted map-loading', text: 'No road closure data available right now — check crokepark.ie/communityinfo directly.' }));
      return;
    }

    section.textContent = '';
    initLeafletMap('road-map-section', withMap.map);
    mapPage.appendChild(buildLegendChip(withMap));
  } catch (err) {
    section.textContent = '';
    warningsEl.hidden = false;
    warningsEl.textContent = `Could not load road closure data (${err.message}).`;
  }
}

loadRoadsMap();
