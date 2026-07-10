// powerRankings.js
//
// PRE-SEASON RANKINGS: 60% all-time manager grade + 20% prior regular season
//   standing + 20% prior post-season (final placement) standing.
//   First-season managers receive 50 (neutral) for missing components.
//
// IN-SEASON RANKINGS (weeks 1-14):
//   Early  (1-3):  40% manager grade, 30% record, 20% points, 10% form
//   Mid    (4-8):  15% manager grade, 40% record, 25% points, 20% form
//   Late   (9-14): 5%  manager grade, 45% record, 25% points, 25% form

export const REGULAR_SEASON_WEEKS = 14;

const PHASE_WEIGHTS = {
  preseason: { record: 0,    points: 0,    recentForm: 0,    managerGrade: 1.0 },
  early:     { record: 0.30, points: 0.20, recentForm: 0.10, managerGrade: 0.40 },
  mid:       { record: 0.40, points: 0.25, recentForm: 0.20, managerGrade: 0.15 },
  late:      { record: 0.45, points: 0.25, recentForm: 0.25, managerGrade: 0.05 }
};

function getPhase(week) {
  if (!week || week <= 0) return 'preseason';
  if (week <= 3)          return 'early';
  if (week <= 8)          return 'mid';
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
    const weight = 1 - idx * 0.2;
    const margin = r.pointsFor - r.pointsAgainst;
    const winPts = r.result === 'W' ? 1 : r.result === 'T' ? 0.5 : 0;
    score += (winPts * 10 + margin * 0.1) * weight;
  });
  return score;
}

/**
 * Converts a 1-based rank to a 0-100 score (1st = 100, last = 0).
 */
function rankToScore(rank, total) {
  if (rank == null || total <= 1) return 50;
  return ((total - rank) / (total - 1)) * 100;
}

/**
 * Computes pre-season rankings for a given year.
 * Formula: 60% all-time manager grade + 20% prior regular season + 20% prior post-season.
 * Component grades (draft/trade/waiver/lineupIQ) are included in output for table display.
 */
export function computePreSeasonRankings(year, allTimeGradesUpTo, prevStandings, allManagerIds) {
  const numTeams         = allManagerIds.length || 12;
  const hasPrevStandings = prevStandings && prevStandings.length > 0;

  // Regular season rank: sort by wins then PF
  const prevRegularSorted = hasPrevStandings
    ? [...prevStandings].sort((a, b) => {
        const wa = a.regularSeason?.wins || 0;
        const wb = b.regularSeason?.wins || 0;
        if (wb !== wa) return wb - wa;
        return (b.regularSeason?.fptsFor || 0) - (a.regularSeason?.fptsFor || 0);
      })
    : [];

  const prevRegularRankByManager    = {};
  const prevPostSeasonRankByManager = {};
  const totalPrev = prevStandings?.length || numTeams;

  prevRegularSorted.forEach((team, idx) => {
    if (team.managerId) prevRegularRankByManager[team.managerId] = idx + 1;
  });

  prevStandings?.forEach((team) => {
    if (team.managerId && team.finalPlacement != null) {
      prevPostSeasonRankByManager[team.managerId] = team.finalPlacement;
    }
  });

  const ranked = allManagerIds.map((managerId) => {
    const gradeData    = allTimeGradesUpTo?.[managerId];
    const mgrGrade     = gradeData?.allTimeGrade ?? null;
    const prevRegRank  = prevRegularRankByManager[managerId]    ?? null;
    const prevPostRank = prevPostSeasonRankByManager[managerId] ?? null;

    const mgrScore  = mgrGrade != null ? mgrGrade : 50;
    const regScore  = hasPrevStandings && prevRegRank  != null ? rankToScore(prevRegRank,  totalPrev) : 50;
    const postScore = hasPrevStandings && prevPostRank != null ? rankToScore(prevPostRank, totalPrev) : 50;

    // 60% manager grade + 20% regular season + 20% post-season
    const score = mgrScore * 0.60 + regScore * 0.20 + postScore * 0.20;

    return {
      managerId,
      score:         Number(score.toFixed(1)),
      mgrGrade,
      // Component grades for table display
      avgNormDraft:  gradeData?.avgNormDraft  ?? null,
      avgNormTrade:  gradeData?.avgNormTrade  ?? null,
      avgNormWaiver: gradeData?.avgNormWaiver ?? null,
      avgNormLineup: gradeData?.avgNormLineup ?? null,
      prevRegRank,
      prevPostRank,
      regScore:      Number(regScore.toFixed(1)),
      postScore:     Number(postScore.toFixed(1)),
      isFirstSeason: !hasPrevStandings || (prevRegRank == null && prevPostRank == null)
    };
  }).sort((a, b) => b.score - a.score);

  ranked.forEach((t, idx) => { t.rank = idx + 1; });
  return { year, rankings: ranked };
}

/**
 * Computes in-season power rankings for one week (1-14).
 */
export function computePowerRankings(currentWeek, standings, weeklyResults, managerGradesThisSeason, allTimeManagerGrades, rosterToManagerId) {
  const week    = Math.min(Number(currentWeek || 0), REGULAR_SEASON_WEEKS);
  const phase   = getPhase(week);
  const weights = PHASE_WEIGHTS[phase];

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

    const recentForm = week > 0 ? computeRecentForm(myResults, week) : null;
    const mgrGrade   = managerGradesThisSeason?.[managerId]?.overallGrade ??
                       allTimeManagerGrades?.[managerId]?.allTimeGrade ?? null;

    return { rosterId: team.rosterId, managerId, name: team.name, wins, losses, ties, pf, gp, recordPct, recentForm, mgrGrade };
  });

  const allRecordPct  = teamData.map((t) => t.recordPct);
  const allPF         = teamData.map((t) => t.pf);
  const allRecentForm = teamData.map((t) => t.recentForm);
  const allMgrGrade   = teamData.map((t) => t.mgrGrade);

  const ranked = teamData.map((t) => {
    const rScore = normalize(t.recordPct,  allRecordPct);
    const pScore = normalize(t.pf,         allPF);
    const fScore = normalize(t.recentForm, allRecentForm);
    const mScore = normalize(t.mgrGrade,   allMgrGrade);

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
 * Computes rankings for ALL weeks 0-14 for the line chart.
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
