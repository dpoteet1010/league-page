// powerRankings.js
//
// Weekly in-season power rankings. Blends current performance with manager
// quality, weighted by how far into the season we are — manager grade
// matters most early (weeks 1-3, before there's meaningful in-season signal)
// and fades out as actual results accumulate.
//
// Week 0 (pre-season / post-draft) is a SPECIAL CASE: no in-season data
// exists at all, so rankings are 100% manager-grade-driven (post-draft
// data grade + prior all-time manager grade if available).

const RANKING_WEIGHTS_BY_PHASE = {
  // week: { record, points, recentForm, managerGrade }
  preseason: { record: 0,    points: 0,    recentForm: 0,    managerGrade: 1.0 },
  early:     { record: 0.30, points: 0.20, recentForm: 0.10, managerGrade: 0.40 }, // weeks 1-3
  mid:       { record: 0.40, points: 0.25, recentForm: 0.20, managerGrade: 0.15 }, // weeks 4-8
  late:      { record: 0.45, points: 0.25, recentForm: 0.25, managerGrade: 0.05 }, // weeks 9+
};

function getPhase(currentWeek) {
  if (currentWeek == null || currentWeek <= 0) return 'preseason';
  if (currentWeek <= 3) return 'early';
  if (currentWeek <= 8) return 'mid';
  return 'late';
}

function normalize(value, allValues) {
  if (value == null || allValues.length === 0) return 50;
  const min = Math.min(...allValues);
  const max = Math.max(...allValues);
  if (max === min) return 50;
  return ((value - min) / (max - min)) * 100;
}

/**
 * Computes recent form: win/loss + margin over the last 3 weeks, normalized.
 */
function computeRecentForm(weeklyResultsForManager, currentWeek, lookback = 3) {
  const recent = weeklyResultsForManager
    .filter((r) => !r.isPlayoffs && r.week <= currentWeek && r.week > currentWeek - lookback)
    .sort((a, b) => b.week - a.week);

  if (recent.length === 0) return null;

  let score = 0;
  recent.forEach((r, idx) => {
    const recencyWeight = 1 - (idx * 0.2); // most recent week weighted highest
    const margin = r.pointsFor - r.pointsAgainst;
    const resultPts = r.result === 'W' ? 1 : r.result === 'T' ? 0.5 : 0;
    score += (resultPts * 10 + margin * 0.1) * recencyWeight;
  });

  return score;
}

/**
 * Computes weekly power rankings for the current season.
 *
 * @param {number} currentWeek           - the most recently completed week (0 = pre-season)
 * @param {Array}  standings              - this season's standings array from getLeagueState
 * @param {Array}  weeklyResults           - this season's weeklyResults
 * @param {Object} managerGradesThisSeason - from computeSeasonManagerGrades (current season, may be partial)
 * @param {Object} allTimeManagerGrades    - from computeAllTimeManagerGrades (prior seasons), used as fallback
 * @param {Function} rosterToManagerId     - (rosterId) => managerId
 */
export function computePowerRankings(currentWeek, standings, weeklyResults, managerGradesThisSeason, allTimeManagerGrades, rosterToManagerId) {
  const phase   = getPhase(currentWeek);
  const weights = RANKING_WEIGHTS_BY_PHASE[phase];

  const teamData = standings.map((team) => {
    const managerId = rosterToManagerId(team.rosterId);
    const wins      = team.regularSeason.wins;
    const losses    = team.regularSeason.losses;
    const ties      = team.regularSeason.ties;
    const pf        = team.regularSeason.fptsFor;

    const recordPct = (wins + losses + ties) > 0
      ? (wins + ties * 0.5) / (wins + losses + ties)
      : null;

    const managerResultsForTeam = weeklyResults.filter((r) => r.rosterId === team.rosterId);
    const recentForm = currentWeek > 0 ? computeRecentForm(managerResultsForTeam, currentWeek) : null;

    // Manager grade: prefer this season's in-progress grade, fall back to all-time
    const thisSeasonGrade = managerGradesThisSeason?.[managerId]?.overallGrade ?? null;
    const allTimeGrade    = allTimeManagerGrades?.[managerId]?.allTimeGrade ?? null;
    const managerGrade    = thisSeasonGrade ?? allTimeGrade ?? null;

    return { rosterId: team.rosterId, managerId, name: team.name, wins, losses, ties, pf, recordPct, recentForm, managerGrade };
  });

  // Normalize each component across the league this week
  const allRecordPct   = teamData.map((t) => t.recordPct).filter((v) => v != null);
  const allPF          = teamData.map((t) => t.pf).filter((v) => v != null);
  const allRecentForm  = teamData.map((t) => t.recentForm).filter((v) => v != null);
  const allManagerGrade = teamData.map((t) => t.managerGrade).filter((v) => v != null);

  const ranked = teamData.map((t) => {
    const recordScore = normalize(t.recordPct,   allRecordPct);
    const pointsScore  = normalize(t.pf,          allPF);
    const formScore    = normalize(t.recentForm,  allRecentForm);
    const mgrScore     = normalize(t.managerGrade, allManagerGrade);

    const compositeScore =
      recordScore * weights.record +
      pointsScore  * weights.points +
      formScore    * weights.recentForm +
      mgrScore     * weights.managerGrade;

    return {
      ...t,
      recordScore: Number(recordScore.toFixed(1)),
      pointsScore:  Number(pointsScore.toFixed(1)),
      formScore:    Number(formScore.toFixed(1)),
      managerScore: Number(mgrScore.toFixed(1)),
      compositeScore: Number(compositeScore.toFixed(1))
    };
  }).sort((a, b) => b.compositeScore - a.compositeScore);

  ranked.forEach((t, idx) => { t.rank = idx + 1; });

  return { phase, weights, week: currentWeek, rankings: ranked };
}

/**
 * Tracks rank movement by comparing this week's rankings to last week's,
 * for "↑2" / "↓1" style indicators in the newsletter.
 */
export function computeRankMovement(currentRankings, previousRankings) {
  const prevRankByManager = {};
  (previousRankings || []).forEach((t) => { prevRankByManager[t.managerId] = t.rank; });

  return currentRankings.map((t) => {
    const prevRank = prevRankByManager[t.managerId];
    const movement = prevRank != null ? prevRank - t.rank : null; // positive = moved up
    return { ...t, prevRank, movement };
  });
}
