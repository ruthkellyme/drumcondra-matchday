import {
  ATTENDANCE_TIERS,
  tierIndexForAttendance,
  PARKING_MAXED_AFTER_RESTRICTION_MIN,
  ROAD_PARTIAL_BEFORE_KICKOFF_MIN,
  PARKING_RESTRICTED_BEFORE_KICKOFF_MIN,
  ROAD_REOPEN_AFTER_FULLTIME_MIN,
  PARKING_FREEUP_AFTER_FULLTIME_MIN,
  ROAD_TAPER_TO_NORMAL_MIN,
  PARKING_TAPER_TO_NORMAL_MIN,
  durationRangeForCompetition,
  CONCERT_DURATION_RANGE_MIN,
  FOOT_TRAFFIC_BUILDUP_BEFORE_KICKOFF_MIN,
  FOOT_TRAFFIC_PEAK_BEFORE_KICKOFF_MIN,
  FOOT_TRAFFIC_STRAGGLERS_AFTER_KICKOFF_MIN,
  FOOT_TRAFFIC_POST_PEAK_DURATION_MIN,
  FOOT_TRAFFIC_POST_TAPER_DURATION_MIN,
} from './config.js';
import { parseClockTime } from './scrape.js';

// Rule: one punchy line per tagline, not several stacked exclamations —
// pick the single best beat rather than piling clauses on top of each other.
const TIER_FLAVOUR = [
  { emoji: '😌', tagline: "Low crowd — ah go on, you'll be grand." },
  { emoji: '🙂', tagline: 'Middling crowd — a small bit of planning goes a long way.' },
  { emoji: '😬', tagline: "Big crowd, this one — plan the day around it or you'll be caught out." },
  { emoji: '🏟️', tagline: 'Full house — careful now.' },
];

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function toMinutesOfDay(t) {
  return t.hour * 60 + t.minute;
}

export function formatClock12(min) {
  const m = clamp(Math.round(min), 0, 1439);
  let h = Math.floor(m / 60);
  const mm = m % 60;
  const ampm = h >= 12 ? 'pm' : 'am';
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${String(mm).padStart(2, '0')}${ampm}`;
}

function toSegments(boundaries, windowEnd) {
  const clamped = [];
  let prevMin = -Infinity;
  for (const b of boundaries) {
    const atMin = Math.max(b.atMin, prevMin);
    clamped.push({ ...b, atMin });
    prevMin = atMin;
  }
  const segments = [];
  for (let i = 0; i < clamped.length; i++) {
    const from = clamped[i].atMin;
    const to = i + 1 < clamped.length ? clamped[i + 1].atMin : windowEnd;
    if (to <= from) continue;
    segments.push({
      status: clamped[i].status,
      label: clamped[i].label,
      note: clamped[i].note || null,
      official: clamped[i].official,
      texture: !!clamped[i].texture,
      fromMin: from,
      toMin: to,
    });
  }
  return segments;
}

// Physical rule, applied everywhere: when foot traffic is genuinely maxed out
// (packed shoulder-to-shoulder), no vehicle can get through a street — not
// even a resident with a pass. So wherever the Foot Traffic lane says
// "critical", the Roads lane can't claim pass-access is maintained there,
// regardless of what the official notice says about access roads. This
// overrides the roads segment for just that overlapping window.
function overlayFootTrafficGridlock(roadsSegments, footSegments) {
  const criticalFoot = footSegments.filter((s) => s.status === 'critical');
  if (!criticalFoot.length) return roadsSegments;

  const boundaries = new Set([0]);
  [...roadsSegments, ...criticalFoot].forEach((s) => { boundaries.add(s.fromMin); boundaries.add(s.toMin); });
  const points = [...boundaries].sort((a, b) => a - b);

  const merged = [];
  for (let i = 0; i < points.length - 1; i++) {
    const from = points[i];
    const to = points[i + 1];
    if (to <= from) continue;
    const mid = (from + to) / 2;
    const roadSeg = roadsSegments.find((s) => mid >= s.fromMin && mid < s.toMin);
    if (!roadSeg) continue;
    const gridlocked = roadSeg.status !== 'good' && criticalFoot.some((s) => mid >= s.fromMin && mid < s.toMin);
    if (gridlocked) {
      merged.push({
        status: 'critical',
        label: 'Gridlocked — foot traffic too dense for any vehicle, pass or not',
        note: roadSeg.note,
        official: false,
        texture: false,
        fromMin: from,
        toMin: to,
      });
    } else {
      merged.push({ ...roadSeg, fromMin: from, toMin: to });
    }
  }

  // Collapse back-to-back segments the overlay left identical, so this
  // doesn't fragment the lane into slivers matching every foot-traffic edge.
  const collapsed = [];
  for (const seg of merged) {
    const last = collapsed[collapsed.length - 1];
    if (last && last.status === seg.status && last.label === seg.label && last.texture === seg.texture && last.official === seg.official) {
      last.toMin = seg.toMin;
    } else {
      collapsed.push({ ...seg });
    }
  }
  return collapsed;
}

// Simple deterministic string hash so the same event always picks the same
// tip on reload, but different events (different dates) land on different
// ones — variety without it feeling random/untrustworthy.
function seededPick(candidates, seed) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return candidates[hash % candidates.length];
}

// One human, whole-day overview per event, always the same three-part shape
// (do X before Y, some freedom between Y and Z, clear of the crowd by W) —
// the shape stays constant so it's scannable at a glance, only the action
// verb varies (seeded by date) so back-to-back events don't read identically.
const PREP_ACTIONS = [
  { icon: '🚗', verb: 'Move the car' },
  { icon: '🐕', verb: 'Walk the dog and grab the messages' },
  { icon: '🛒', verb: 'Get the messages done' },
];

function buildTip({ tierIndex, roadClosureMin, finalWhistleEarly, finalWhistleLate, roadFullyClearMin, parkingFullyClearMin, footTaperEnd, firstKickoff, seed }) {
  const flavour = TIER_FLAVOUR[tierIndex];

  if (tierIndex === 0) {
    return { flavour, tip: { min: firstKickoff, icon: '😌', text: "Grand and quiet, this one — go on, go on, go on, no need to change the plans." } };
  }

  const action = seededPick(PREP_ACTIONS, seed);
  const allClear = Math.max(roadFullyClearMin, parkingFullyClearMin, footTaperEnd);
  const whistleRange = finalWhistleEarly === finalWhistleLate
    ? `around ${formatClock12(finalWhistleEarly)}`
    : `somewhere between ${formatClock12(finalWhistleEarly)} and ${formatClock12(finalWhistleLate)}`;

  let text = `${action.verb} before ${formatClock12(roadClosureMin)} — you'll still have a bit of freedom to get in and out (resident pass gets you through) up till the final whistle, ${whistleRange}, then you're grand again once it clears by about ${formatClock12(allClear)}.`;
  if (tierIndex === 3) {
    text += " Full house today, so the hold at the Garda cordon after could run on a fair while — that'd be a Garda matter, patience now.";
  }

  return { flavour, tip: { min: roadClosureMin, icon: action.icon, text } };
}

/**
 * event shape:
 * {
 *   date, dayLabel, fixtures: [{ time: {hour, minute}, timeText, home, away, competition }],
 *   attendance: { value, isFullHouse } | null,
 *   official: { parkingRestrictionTime, roadClosureTime, closureRoads, restrictedStreets, accessRoads, exitRouteNote } | null,
 *   isConcert?: boolean,
 * }
 */
export function applyHeuristics(event) {
  const fixtures = (event.fixtures || []).filter((f) => f.time);
  if (fixtures.length === 0) {
    return {
      ...event,
      tier: null,
      timeline: null,
      tips: null,
      error: 'No parseable kick-off times — cannot generate an estimate. Use manual entry to add one.',
    };
  }

  const kickoffMins = fixtures.map((f) => toMinutesOfDay(f.time));
  const firstKickoff = Math.min(...kickoffMins);
  const lastKickoff = Math.max(...kickoffMins);
  const lastFixture = fixtures.find((f) => toMinutesOfDay(f.time) === lastKickoff) || fixtures[fixtures.length - 1];

  const attendanceValue = event.attendance?.value ?? null;
  const attendanceUnknown = attendanceValue == null;
  const effectiveAttendance = attendanceValue ?? 30000;
  const tierIndex = tierIndexForAttendance(effectiveAttendance);
  const tierName = ATTENDANCE_TIERS[tierIndex].name;

  // Real games don't finish at a fixed minute — model the final whistle as a
  // range (early = best case, late = generous stoppage/extra time) and lean
  // on the late end for anything safety-relevant (when it's actually clear).
  const [durationLow, durationHigh] = event.isConcert
    ? CONCERT_DURATION_RANGE_MIN
    : durationRangeForCompetition(lastFixture?.competition || '');
  const finalWhistleEarly = lastKickoff + durationLow;
  const finalWhistleLate = lastKickoff + durationHigh;

  // The LAST fixture's whistle governs the day-wide surge/reopen timing
  // (fans stay for the whole double-header), but a resident asking "when's
  // the first match likely to finish" wants EVERY fixture's own estimate,
  // not just the final one.
  const finalWhistleRanges = fixtures.map((f) => {
    const kickoff = toMinutesOfDay(f.time);
    const [lo, hi] = event.isConcert ? CONCERT_DURATION_RANGE_MIN : durationRangeForCompetition(f.competition || '');
    return { fromMin: kickoff + lo, toMin: kickoff + hi, label: f.competition || f.timeText };
  });

  const officialParkingTime = event.official?.parkingRestrictionTime ? parseClockTime(event.official.parkingRestrictionTime) : null;
  const officialRoadTime = event.official?.roadClosureTime ? parseClockTime(event.official.roadClosureTime) : null;

  const parkingRestrictionMin = officialParkingTime
    ? toMinutesOfDay(officialParkingTime)
    : firstKickoff - PARKING_RESTRICTED_BEFORE_KICKOFF_MIN[tierIndex];
  const roadClosureMin = officialRoadTime
    ? toMinutesOfDay(officialRoadTime)
    : firstKickoff - ROAD_PARTIAL_BEFORE_KICKOFF_MIN[tierIndex];

  // Croke Park's own notice gives exactly one real road time: the closure
  // start. It also states access is maintained via specific roads *during*
  // that closure — not just after a settling-in period — so from that one
  // official timestamp straight through to the final whistle is "closed to
  // through-traffic, but pass-holder access maintained." The only genuinely
  // unpredictable window is the post-match mass exit — which starts as early
  // as the earliest plausible final whistle, to be safe.
  const postMatchSurgeStart = finalWhistleEarly;
  const parkingMaxedMin = parkingRestrictionMin + PARKING_MAXED_AFTER_RESTRICTION_MIN[tierIndex];

  // Nothing snaps straight from critical to fully-normal — there's always a
  // tail of stragglers/residual congestion before it's genuinely clear.
  const roadReopenMin = finalWhistleLate + ROAD_REOPEN_AFTER_FULLTIME_MIN[tierIndex];
  const roadFullyClearMin = roadReopenMin + ROAD_TAPER_TO_NORMAL_MIN[tierIndex];
  const parkingFreeUpMin = finalWhistleLate + PARKING_FREEUP_AFTER_FULLTIME_MIN[tierIndex];
  const parkingFullyClearMin = parkingFreeUpMin + PARKING_TAPER_TO_NORMAL_MIN[tierIndex];

  // A double-header gets a foot-traffic bump around EACH throw-in, not just
  // the first — the crowd doesn't stay "quiet, everyone's inside" for a
  // fixture it hasn't happened yet. Roads/parking already stay elevated for
  // the whole day for exactly this reason.
  const footKickoffBumps = [...new Set(kickoffMins)].sort((a, b) => a - b).map((k) => ({
    kickoff: k,
    buildupStart: k - FOOT_TRAFFIC_BUILDUP_BEFORE_KICKOFF_MIN[tierIndex],
    peakStart: k - FOOT_TRAFFIC_PEAK_BEFORE_KICKOFF_MIN[tierIndex],
    stragglersEnd: k + FOOT_TRAFFIC_STRAGGLERS_AFTER_KICKOFF_MIN[tierIndex],
  }));
  const footExitPeakEnd = finalWhistleLate + FOOT_TRAFFIC_POST_PEAK_DURATION_MIN[tierIndex];
  const footTaperEnd = footExitPeakEnd + FOOT_TRAFFIC_POST_TAPER_DURATION_MIN[tierIndex];

  const allMins = [
    parkingRestrictionMin, roadClosureMin, parkingMaxedMin,
    roadReopenMin, roadFullyClearMin, parkingFreeUpMin, parkingFullyClearMin,
    ...footKickoffBumps.flatMap((b) => [b.buildupStart, b.peakStart, b.kickoff, b.stragglersEnd]),
    footExitPeakEnd, footTaperEnd,
    firstKickoff, finalWhistleEarly, finalWhistleLate,
  ];
  const windowStart = clamp(Math.min(...allMins) - 30, 0, 1439);
  const windowEnd = clamp(Math.max(...allMins) + 30, 1, 1440);

  const closureRoadsText = event.official?.closureRoads?.length ? event.official.closureRoads.join(' & ') : 'Local roads';
  const restrictedStreetsText = event.official?.restrictedStreets?.length ? event.official.restrictedStreets.join(', ') : 'nearby streets';
  const accessRoadsText = event.official?.accessRoads?.length ? event.official.accessRoads.join(' & ') : 'the designated access route';
  const gardaCordonNote = event.importantNote || 'An Garda Síochána may restrict entry/exit during periods of high pedestrian traffic — a resident pass does not guarantee immediate access.';

  const roadsLane = toSegments([
    { atMin: windowStart, status: 'good', label: 'Open as normal', official: false },
    { atMin: roadClosureMin, status: 'critical', texture: true, label: `${closureRoadsText} closed — pass access via ${accessRoadsText}`, official: !!officialRoadTime },
    { atMin: postMatchSurgeStart, status: 'critical', label: 'Post-match surge — no exceptions, even with a pass', note: gardaCordonNote, official: false },
    { atMin: roadReopenMin, status: 'warning', label: 'Reopening — residual delays', official: false },
    { atMin: roadFullyClearMin, status: 'good', label: 'Back to normal', official: false },
  ], windowEnd);

  const parkingLane = toSegments([
    { atMin: windowStart, status: 'good', label: 'Parking available', official: false },
    { atMin: parkingRestrictionMin, status: 'warning', label: `Restricted — avoid ${restrictedStreetsText}`, official: !!officialParkingTime },
    { atMin: parkingMaxedMin, status: 'critical', label: 'Likely full / maxed out', official: false },
    { atMin: parkingFreeUpMin, status: 'warning', label: 'Freeing up gradually', official: false },
    { atMin: parkingFullyClearMin, status: 'good', label: 'Back to normal', official: false },
  ], windowEnd);

  const footTrafficBoundaries = [{ atMin: windowStart, status: 'good', label: 'Quiet streets', official: false }];
  footKickoffBumps.forEach((b) => {
    footTrafficBoundaries.push(
      { atMin: b.buildupStart, status: 'warning', label: 'Crowds building', official: false },
      { atMin: b.peakStart, status: 'critical', label: 'Streets packed — throw-in approaching', official: false },
      { atMin: b.kickoff, status: 'warning', label: 'Stragglers still arriving', official: false },
      { atMin: b.stragglersEnd, status: 'good', label: 'Quieter — most people inside', official: false },
    );
  });
  footTrafficBoundaries.push(
    { atMin: postMatchSurgeStart, status: 'critical', label: 'Mass exit — footpaths packed', official: false },
    { atMin: footExitPeakEnd, status: 'warning', label: 'Crowds thinning out', official: false },
    { atMin: footTaperEnd, status: 'good', label: 'Back to normal', official: false },
  );
  const footTrafficLane = toSegments(footTrafficBoundaries, windowEnd);

  // Applied everywhere, not just here: packed-solid foot traffic means no
  // vehicle gets through, pass or not — so gridlock overrides any "closed but
  // pass-access maintained" claim on the roads lane for that overlapping time.
  const roadsLaneFinal = overlayFootTrafficGridlock(roadsLane, footTrafficLane);

  const { flavour, tip } = buildTip({
    tierIndex, roadClosureMin, postMatchSurgeStart, finalWhistleEarly, finalWhistleLate,
    roadFullyClearMin, parkingFullyClearMin, footTaperEnd,
    firstKickoff, seed: event.date,
  });

  return {
    ...event,
    tier: { index: tierIndex, name: tierName, attendanceUnknown, emoji: flavour.emoji, tagline: flavour.tagline },
    estimatedFinalWhistle: `${formatClock12(finalWhistleEarly)}–${formatClock12(finalWhistleLate)}`,
    finalWhistleRange: { fromMin: finalWhistleEarly, toMin: finalWhistleLate },
    finalWhistleRanges,
    windowStart,
    windowEnd,
    tip,
    timeline: {
      roads: roadsLaneFinal,
      parking: parkingLane,
      footTraffic: footTrafficLane,
    },
  };
}
