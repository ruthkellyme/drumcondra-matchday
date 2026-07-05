// Tunable assumptions behind the estimates. None of this is official data —
// adjust the numbers as you observe what actually happens on match days.

export const SOURCE_URL = 'https://crokepark.ie/communityinfo';

// Corrections/additions from actual residents, layered on top of Croke
// Park's official notice rather than replacing it — the map keeps these
// clearly labelled "resident-reported", not "Croke Park", since they aren't
// on the official page. Add to this list as more local knowledge comes in
// (e.g. from the in-app feedback form).
export const RESIDENT_REPORTED_ACCESS_ROADS = ['Clonliffe Avenue'];

export const CROKE_PARK_CAPACITY = 82300; // used when the page just says "full house"

// Attendance tiers used to scale every estimate below. Thresholds are the
// upper bound of each tier (in attendees).
export const ATTENDANCE_TIERS = [
  { name: 'Low', max: 24000 },
  { name: 'Medium', max: 45000 },
  { name: 'High', max: 65000 },
  { name: 'Very high', max: Infinity },
];

// Minutes after the official "restrictions start" time before parking is
// estimated to be fully maxed out, indexed by tier.
export const PARKING_MAXED_AFTER_RESTRICTION_MIN = [30, 45, 60, 75];

// Fallback offsets (minutes before first throw-in) used ONLY when the page
// doesn't give an explicit restriction/closure start time.
export const ROAD_PARTIAL_BEFORE_KICKOFF_MIN = [60, 90, 120, 150];
export const PARKING_RESTRICTED_BEFORE_KICKOFF_MIN = [60, 90, 120, 150];

// How long the roads/parking take to return to normal after the last final
// whistle, indexed by tier. This is when each starts easing off, not when
// it's fully clear — see the TAPER constants below for that.
export const ROAD_REOPEN_AFTER_FULLTIME_MIN = [30, 45, 75, 105];
export const PARKING_FREEUP_AFTER_FULLTIME_MIN = [30, 50, 80, 110];

// Nothing goes from "critical" straight to "fully normal" in real life —
// there's always a tail of stragglers/residual congestion. These are that
// tail's duration, indexed by tier.
export const ROAD_TAPER_TO_NORMAL_MIN = [15, 20, 30, 40];
export const PARKING_TAPER_TO_NORMAL_MIN = [15, 20, 30, 40];

// Foot traffic — pedestrian volume on the surrounding streets, entirely
// estimated. Builds as people walk in, peaks right before throw-in, drops
// while the match is on, spikes hardest at full-time (mass exit), then tapers.
export const FOOT_TRAFFIC_BUILDUP_BEFORE_KICKOFF_MIN = [45, 70, 100, 130];
export const FOOT_TRAFFIC_PEAK_BEFORE_KICKOFF_MIN = [15, 20, 25, 30];
// Even after throw-in, stragglers keep arriving for a while — at least 15
// minutes — before the streets actually go quiet.
export const FOOT_TRAFFIC_STRAGGLERS_AFTER_KICKOFF_MIN = [15, 15, 20, 25];
export const FOOT_TRAFFIC_POST_PEAK_DURATION_MIN = [15, 25, 35, 45];
export const FOOT_TRAFFIC_POST_TAPER_DURATION_MIN = [20, 30, 45, 60];

// Throw-in to final-whistle duration, as a [low, high] range in minutes —
// real games don't run to a fixed length. Each includes the mandatory
// 15-minute half-time break plus a plausible range of referee-discretion
// stoppage time; the high end leans generous rather than optimistic, since
// residents plan around when it's actually clear, not the tidy number.
// Sourced from GAA's official playing rules (70 min for senior inter-county
// hurling/football, 60 min for senior camogie).
export const MATCH_DURATION_RANGE_MIN = {
  hurling: [95, 120],
  football: [95, 120],
  camogie: [80, 105],
  default: [90, 120], // unknown/mixed competition wording
};
export const CONCERT_DURATION_RANGE_MIN = [120, 180];

export function durationRangeForCompetition(competitionText = '') {
  const t = competitionText.toLowerCase();
  if (t.includes('camogie')) return MATCH_DURATION_RANGE_MIN.camogie;
  if (t.includes('football')) return MATCH_DURATION_RANGE_MIN.football;
  if (t.includes('hurling')) return MATCH_DURATION_RANGE_MIN.hurling;
  return MATCH_DURATION_RANGE_MIN.default;
}

export function tierIndexForAttendance(attendance) {
  const idx = ATTENDANCE_TIERS.findIndex((t) => attendance <= t.max);
  return idx === -1 ? ATTENDANCE_TIERS.length - 1 : idx;
}

export function tierNameForAttendance(attendance) {
  return ATTENDANCE_TIERS[tierIndexForAttendance(attendance)].name;
}
