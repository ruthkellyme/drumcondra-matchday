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

const MAP_STATUS_HEX = { good: '#0ca30c', critical: '#d03b3b' };

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
    icon: L.divIcon({ className: 'stadium-icon', html: '🏟️', iconSize: [24, 24] }),
  }).addTo(map).bindPopup('Croke Park');

  mapData.markers.forEach((m) => {
    const popupEl = el('div', { class: 'map-popup' }, [el('strong', { text: m.name }), el('br'), m.description || '']);
    const colour = MAP_STATUS_HEX[m.status] || '#52514e';

    // Draw the real street shape when we have it (from OSM way geometry) so
    // a closure reads as "this whole route", not one ambiguous dot guessed
    // to be its centre — a resident can see where a road actually runs.
    if (m.line && m.line.length > 1) {
      L.polyline(m.line, { color: colour, weight: 5, opacity: 0.85 }).addTo(map).bindPopup(popupEl);
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
      el('span', { class: 'legend-item' }, [el('span', { class: 'swatch good' }), 'Resident access maintained']),
    ]),
    el('p', { class: 'map-caption', text: `Based on the notice for ${ev.dayLabel}. Tap a line for details.` }),
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

    document.getElementById('source-note').textContent = data.fetchedAt ? `Last checked ${new Date(data.fetchedAt).toLocaleString()}.` : '';
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
