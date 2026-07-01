// strengthOfSchedule.js
//
// Computes strength of schedule per manager, per season and all-time.
//
// Points-based SOS: average points your opponents scored against you in
// regular season games. Higher = tougher schedule (faced high-scoring teams).
//
// Record-based SOS: average final-season win % of your regular-season
// opponents. Higher = faced better teams.
//
// Luck metric: for each week, what % of other managers would you have
// beaten with your actual score? Average this across weeks = expected
// win rate. Luck = actual wins / (games played) - expected win rate.
// Positive = won more than expected (lucky schedule). Negative = unlucky.

/**
 * Computes SOS and luck for a single season.
 *
 * @param {Array}  weeklyResults - this season's weeklyResults (all managers)
 * @param {Array}  standings     - this season's standings
 * @param {Array}  allManagerIds - all manager IDs active this season
 * @returns {{ [managerId]: sosResult }}
 */
export function computeSeasonSOS(weeklyResults, standings, allManagerIds) {
  const regularSeason = weeklyResults.filter((r) => !r.isPlayoffs);

  // Build final record map: managerId → { wins, losses, ties, gamesPlayed, winPct }
  const finalRecords = {};
  standings.forEach((team) => {
    const mgrId = team.managerId;
    if (!mgrId) return;
    const w = team.regularSeason.wins;
    const l = team.regularSeason.losses;
    const t = team.regularSeason.ties;
    const gp = w + l + t;
    finalRecords[mgrId] = { wins: w, losses: l, ties: t, gamesPlayed: gp, winPct: gp > 0 ? (w + t * 0.5) / gp : 0 };
  });

  // Group regular season results by manager
  const managerGames = {};
  regularSeason.forEach((r) => {
    if (!managerGames[r.managerId]) managerGames[r.managerId] = [];
    managerGames[r.managerId].push(r);
  });

  // Group all scores by week (for luck calculation)
  const scoresByWeek = {};
  regularSeason.forEach((r) => {
    if (!scoresByWeek[r.week]) scoresByWeek[r.week] = [];
    scoresByWeek[r.week].push({ managerId: r.managerId, score: r.pointsFor });
  });

  const result = {};

  allManagerIds.forEach((managerId) => {
    const games = managerGames[managerId] || [];
    if (games.length === 0) return;

    // Points-based SOS: average of what opponents scored against you
    const avgOpponentPts = games.reduce((s, g) => s + g.pointsAgainst, 0) / games.length;

    // Record-based SOS: average opponent final win %
    const opponentWinPcts = games
      .map((g) => finalRecords[g.opponentManagerId]?.winPct)
      .filter((v) => v != null);
    const avgOpponentWinPct = opponentWinPcts.length > 0
      ? opponentWinPcts.reduce((s, v) => s + v, 0) / opponentWinPcts.length
      : null;

    // Luck: expected win rate based on your score vs all scores each week
    let totalExpectedWins = 0;
    let weeksWithData    = 0;
    games.forEach((g) => {
      const weekScores = (scoresByWeek[g.week] || []).map((e) => e.score);
      if (weekScores.length < 2) return;
      // % of opponents you would have beaten with your score this week
      const beaten = weekScores.filter((s) => s !== g.pointsFor && s < g.pointsFor).length;
      const tied   = weekScores.filter((s) => s !== g.pointsFor && s === g.pointsFor).length;
      const others = weekScores.length - 1; // exclude yourself
      if (others <= 0) return;
      totalExpectedWins += (beaten + tied * 0.5) / others;
      weeksWithData++;
    });

    const actualWins       = games.filter((g) => g.result === 'W').length;
    const actualWinRate    = games.length > 0 ? actualWins / games.length : null;
    const expectedWinRate  = weeksWithData > 0 ? totalExpectedWins / weeksWithData : null;
    const luck             = actualWinRate != null && expectedWinRate != null
      ? actualWinRate - expectedWinRate
      : null;

    result[managerId] = {
      managerId,
      gamesPlayed:        games.length,
      avgOpponentPts:     Number(avgOpponentPts.toFixed(2)),
      avgOpponentWinPct:  avgOpponentWinPct != null ? Number(avgOpponentWinPct.toFixed(4)) : null,
      actualWins,
      actualWinRate:      actualWinRate != null ? Number(actualWinRate.toFixed(4)) : null,
      expectedWinRate:    expectedWinRate != null ? Number(expectedWinRate.toFixed(4)) : null,
      luck:               luck != null ? Number(luck.toFixed(4)) : null,
      luckLabel:          luck == null       ? null
                        : luck >  0.15       ? 'very lucky'
                        : luck >  0.05       ? 'lucky'
                        : luck > -0.05       ? 'neutral'
                        : luck > -0.15       ? 'unlucky'
                        : 'very unlucky'
    };
  });

  return result;
}

/**
 * Computes all-time SOS by averaging per-season values across years.
 *
 * @param {Object} seasonSOSByYear - { [year]: { [managerId]: sosResult } }
 * @param {Array}  allManagerIds
 */
export function computeAllTimeSOS(seasonSOSByYear, allManagerIds) {
  const result = {};

  allManagerIds.forEach((managerId) => {
    const seasons = [];
    Object.entries(seasonSOSByYear).forEach(([year, yearSOS]) => {
      const data = yearSOS[managerId];
      if (data) seasons.push({ year, ...data });
    });

    if (seasons.length === 0) return;

    const avgOpponentPts    = seasons.reduce((s, d) => s + d.avgOpponentPts, 0) / seasons.length;
    const winPctSeasons     = seasons.filter((d) => d.avgOpponentWinPct != null);
    const avgOpponentWinPct = winPctSeasons.length > 0
      ? winPctSeasons.reduce((s, d) => s + d.avgOpponentWinPct, 0) / winPctSeasons.length
      : null;

    const luckSeasons    = seasons.filter((d) => d.luck != null);
    const avgLuck        = luckSeasons.length > 0
      ? luckSeasons.reduce((s, d) => s + d.luck, 0) / luckSeasons.length
      : null;

    result[managerId] = {
      managerId,
      seasons:            seasons.length,
      avgOpponentPts:     Number(avgOpponentPts.toFixed(2)),
      avgOpponentWinPct:  avgOpponentWinPct != null ? Number(avgOpponentWinPct.toFixed(4)) : null,
      avgLuck:            avgLuck != null ? Number(avgLuck.toFixed(4)) : null,
      luckLabel:          avgLuck == null      ? null
                        : avgLuck >  0.10      ? 'consistently lucky'
                        : avgLuck >  0.03      ? 'slightly lucky'
                        : avgLuck > -0.03      ? 'neutral'
                        : avgLuck > -0.10      ? 'slightly unlucky'
                        : 'consistently unlucky',
      perSeason: seasons
    };
  });

  return result;
}
