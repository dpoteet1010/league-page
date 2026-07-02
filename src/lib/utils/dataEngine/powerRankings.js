// powerRankings.js
//
// PRE-SEASON RANKINGS:
//   Year 1: 100% all-time manager grade (only 1 season available or first ever)
//   Year 2+: 60% all-time manager grade (prior seasons only) + 40% previous
//            season's final placement (normalized, best placement = highest score)
//
// IN-SEASON RANKINGS (weeks 1–14 only — regular season):
//   Weeks 1-3:  40% manager grade, 30% record, 20% points, 10% recent form
//   Weeks 4-8:  15% manager grade, 40% record, 25% points, 20% recent form
//   Weeks 9-14: 5% manager grade,  45% record, 25% points, 25% recent form
//
// PROGRESSION: computeAllWeekRankings builds rankings for all 14 regular-season
// weeks (plus week 0 pre-season) so a line chart can show rank over time.

export const REGULAR_SEASON_WEEKS = 14; // weeks used for ranking (no playoffs)

const PHASE_WEIGHTS = {
  preseason: { record: 0,    points: 0,    recentForm: 0,    managerGrade: 1.0 },
  early:     { record: 0.30, points: 0.20, recentForm: 0.10, managerGrade: 0.40 },
  mid:       { record: 0.40, points: 0.25, recentForm: 0.20, managerGrade: 0.15 },
  late:      { record: 0.45, points: 0.25, recentForm: 0.25, managerGrade: 0.05 }
};

function getPhase(week) {
  if (!week || week <= 0)  return 'preseason';
  if (week <= 3)           return 'early';
  if (week <= 8)           return 'mid';
  return 'late';
}

function normalize(value, allValues) {
  const active = allValues.filter((v) => v != null && !isNaN(v));
  if (value == null || active.length === 0) return 50;
  const min = Math.min(...active);
  const max = Math.max(...active);
  if (max === min) return 50;
  return ((value - min) / (max - min)) * 100;
}

function computeRecentForm(managerWeeklyResults, throughWeek, lookback = 3) {
  const recent = managerWeeklyResults
    .filter((r) => !r.isPlayoffs && r.week <= throughWeek && r.week > throughWeek - lookback)
    .sort((a, b) => b.week - a.week);

  if (recent.length === 0) return null;

  let score = 0;
  recent.forEach((r, idx) => {
    const weight  = 1 - idx * 0.2;
    const margin  = r.pointsFor - r.pointsAgainst;
    const winPts  = r.result === 'W' ? 1 : r.result === 'T' ? 0.5 : 0;
    score += (winPts * 10 + margin * 0.1) * weight;
  });
  return score;
}

/**
 * Computes pre-season rankings for a given year, blending manager grade history
 * with the previous season's final standings.
 *
 * @param {string|number} year              - season to rank for
 * @param {Object}        allTimeGradesUpTo - all-time grades computed from seasons BEFORE this year
 * @param {Array}         prevStandings     - standings array from the previous season (with managerId + finalPlacement)
 * @param {Array}         allManagerIds
 */
export function computePreSeasonRankings(year, allTimeGradesUpTo, prevStandings, allManagerIds) {
  const hasPrevStandings = prevStandings && prevStandings.length > 0;

  // Normalize previous placement: 1st = 100, last = 0
  const placements     = hasPrevStandings
    ? prevStandings.map((t) => t.finalPlacement).filter((v) => v != null)
    : [];
  const maxPlacement   = placements.length > 0 ? Math.max(...placements) : 1;
  const minPlacement   = placements.length > 0 ? Math.min(...placements) : 1;

  const placementScore = (placement) => {
    if (!placement) return 50;
    if (maxPlacement === minPlacement) return 50;
    // Invert: lower placement number (1st) = 100
    return ((maxPlacement - placement) / (maxPlacement - minPlacement)) * 100;
  };

  const prevPlacementByManager = {};
  (prevStandings || []).forEach((t) => {
    if (t.managerId) prevPlacementByManager[t.managerId] = t.finalPlacement;
  });

  const ranked = allManagerIds.map((managerId) => {
    const mgrGrade = allTimeGradesUpTo?.[managerId]?.allTimeGrade ?? null;
    const prevPlacement = prevPlacementByManager[managerId] ?? null;
    const prevScore     = prevPlacement != null ? placementScore(prevPlacement) : 50;

    let score;
    if (!hasPrevStandings || mgrGrade == null) {
      // First season or no grade history: use grade only (or 50 if no grade)
      score = mgrGrade ?? 50;
    } else {
      // 60% all-time manager grade, 40% previous season's placement
      score = mgrGrade * 0.60 + prevScore * 0.40;
    }

    return {
      managerId,
      score:         Number(score.toFixed(1)),
      mgrGrade,
      prevPlacement,
      prevScore:     Number(prevScore.toFixed(1))
    };
  }).sort((a, b) => b.score - a.score);

  ranked.forEach((t, idx) => { t.rank = idx + 1; });
  return { year, rankings: ranked };
}

/**
 * Computes in-season power rankings for one specific week (1-14).
 * Returns null for week > REGULAR_SEASON_WEEKS.
 */
export function computePowerRankings(currentWeek, standings, weeklyResults, managerGradesThisSeason, allTimeManagerGrades, rosterToManagerId) {
  const week = Math.min(Number(currentWeek || 0), REGULAR_SEASON_WEEKS);
  const phase   = getPhase(week);
  const weights = PHASE_WEIGHTS[phase];

  // Only count regular season weeks up to the cap
  const regularResults = weeklyResults.filter((r) => !r.isPlayoffs && r.week <= REGULAR_SEASON_WEEKS);

  const teamData = standings.map((team) => {
    const managerId = team.managerId || rosterToManagerId(team.rosterId);
    const myResults = regularResults.filter((r) => r.managerId === managerId && r.week <= week);

    const wins   = myResults.filter((r) => r.result === 'W').length;
    const losses = myResults.filter((r) => r.result === 'L').length;
    const ties   = myResults.filter((r) => r.result === 'T').length;
    const pf     = myResults.reduce((s, r) => s + r.pointsFor, 0);
    const gp     = wins + losses + ties;
    const recordPct = gp > 0 ? (wins + ties * 0.5) / gp : null;

    const recentForm  = week > 0 ? computeRecentForm(myResults, week) : null;
    const mgrGrade    = managerGradesThisSeason?.[managerId]?.overallGrade ??
                        allTimeManagerGrades?.[managerId]?.allTimeGrade ?? null;

    return { rosterId: team.rosterId, managerId, name: team.name, wins, losses, ties, pf, gp, recordPct, recentForm, mgrGrade };
  });

  const allRecordPct  = teamData.map((t) => t.recordPct);
  const allPF         = teamData.map((t) => t.pf);
  const allRecentForm = teamData.map((t) => t.recentForm);
  const allMgrGrade   = teamData.map((t) => t.mgrGrade);

  const ranked = teamData.map((t) => {
    const rScore   = normalize(t.recordPct,   allRecordPct);
    const pScore   = normalize(t.pf,          allPF);
    const fScore   = normalize(t.recentForm,  allRecentForm);
    const mScore   = normalize(t.mgrGrade,    allMgrGrade);

    const composite =
      rScore * weights.record +
      pScore * weights.points +
      fScore * weights.recentForm +
      mScore * weights.managerGrade;

    return {
      ...t,
      recordScore:    Number(rScore.toFixed(1)),
      pointsScore:    Number(pScore.toFixed(1)),
      formScore:      Number(fScore.toFixed(1)),
      managerScore:   Number(mScore.toFixed(1)),
      compositeScore: Number(composite.toFixed(1))
    };
  }).sort((a, b) => b.compositeScore - a.compositeScore);

  ranked.forEach((t, idx) => { t.rank = idx + 1; });
  return { phase, weights, week, rankings: ranked };
}

/**
 * Computes rankings for ALL weeks 0-14, returning an array indexed by week.
 * Week 0 = pre-season. Used to build the progression line chart.
 */
export function computeAllWeekRankings(standings, weeklyResults, managerGradesThisSeason, allTimeManagerGrades, rosterToManagerId) {
  const all = [];
  for (let w = 0; w <= REGULAR_SEASON_WEEKS; w++) {
    all.push(computePowerRankings(w, standings, weeklyResults, managerGradesThisSeason, allTimeManagerGrades, rosterToManagerId));
  }
  return all;
}

export function computeRankMovement(currentRankings, previousRankings) {
  const prevRankByManager = {};
  (previousRankings || []).forEach((t) => { prevRankByManager[t.managerId] = t.rank; });
  return currentRankings.map((t) => {
    const prevRank = prevRankByManager[t.managerId];
    return { ...t, prevRank, movement: prevRank != null ? prevRank - t.rank : null };
  });
}
